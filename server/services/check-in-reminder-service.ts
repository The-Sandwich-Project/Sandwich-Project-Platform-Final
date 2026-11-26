/**
 * Event alerts (formerly "check-in reminders"): one daily email per TSP contact.
 *
 * Once a day, for each active person, check every event they're the TSP
 * contact for (New, In Process, Scheduled, Rescheduled) against their alert
 * settings, and send ONE email listing every alert due today, most urgent
 * first, with everything needed to act from the email. Nothing due = no email.
 *
 * Timing rules (which alert fires when) are in ./event-alerts/rules.ts; the
 * email/text/bell content is in ./event-alerts/digest-email.ts. This file
 * loads the data, enforces the daily limit, sends, and records what went out.
 *
 * - Runs hourly (cron-jobs.ts) and sends on the first run at or after 9 AM
 *   Eastern, so a server restart at 9:00 doesn't cost a day.
 * - HARD LIMIT: one digest per person per Eastern day. Today's slot is claimed
 *   by inserting a row in event_alert_digest_sends (primary key: person + day)
 *   before anything is sent, so a double run or two servers can't send twice.
 *   It lives in its own table, not users.metadata, so a settings save that
 *   rewrites metadata can't erase a claim mid-send.
 * - Each person's events and account are re-read right before their digest is
 *   built, so a reassignment or deactivation during the run is respected.
 * - Each real run first forgets sent-history that no longer applies (event
 *   reassigned, moved to a status the alert doesn't cover, deleted), so a
 *   returned event or a status reversal gets fresh alerts.
 * - The bell entry is written first; if that fails the slot is released and
 *   the next hourly run retries. Email/text failures are logged (the bell
 *   still has it).
 * - What was sent is recorded per event + person + alert in
 *   event_check_in_reminders (last_sent_at / last_sent_key). That drives the
 *   "every X days" and "once per checkpoint" timing.
 * - Dry run (CHECK_IN_REMINDERS_DRY_RUN=true, or the admin dry-run endpoint):
 *   works out exactly what each person would get and writes NOTHING.
 */
import { sendEmailOrThrow, isEmailConfigured } from './email';
import { db, executeRawSql } from '../db';
import { eventCheckInReminders, eventReminderSnoozes, eventRequests, users, notifications, eventAlertDigestSends } from '@shared/schema';
import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { getAppBaseUrl } from '../config/constants';
import { getUserMetadata, getCheckInReminderPreferences, ACTIVE_ALERT_RULE_TYPES } from '@shared/types';
import { sendTSPFollowupReminderSMS } from '../sms-service';
import {
  ALERT_STATUSES,
  easternDateString,
  easternHour,
  evaluateEventAlerts,
  maxSnoozeDays,
  toAlertLines,
  urgencyCompare,
  type AlertRuleType,
  type AlertSnooze,
  type AlertState,
  type DueAlert,
} from './event-alerts/rules';
import { renderDigest, type DigestItem, type RenderedDigest } from './event-alerts/digest-email';

/** First Eastern hour the daily digest may go out. */
export const DIGEST_SEND_HOUR = 9;

type UserRow = typeof users.$inferSelect;
type EventRow = typeof eventRequests.$inferSelect;

export function isCheckInReminderDryRun(): boolean {
  return process.env.CHECK_IN_REMINDERS_DRY_RUN === 'true';
}

export type DryRunEntry = {
  kind: 'digest';
  userId: string;
  userName: string;
  /** Where it would go (the bell always gets it too) */
  wouldEmail: string | null;
  wouldText: string | null;
  subject: string;
  events: { id: number; organization: string; detail: string }[];
};

export type DigestRunResult = {
  /** People whose events were evaluated */
  processed: number;
  /** Digests delivered by email or text */
  sent: number;
  errors: number;
  dryRun: boolean;
  /** Set when the run did nothing on purpose (e.g. before 9 AM) */
  skipped?: string;
  /** Dry run only: everything that would have gone out */
  plan: DryRunEntry[];
};

function displayName(user: UserRow): string {
  return user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id;
}

function plannedChannels(user: UserRow, channel: string): { wouldEmail: string | null; wouldText: string | null } {
  const email = user.preferredEmail || user.email || null;
  const consent = getUserMetadata(user).smsConsent;
  const phone = consent?.enabled && consent.phoneNumber ? consent.phoneNumber : null;
  return {
    wouldEmail: channel === 'email' || channel === 'both' ? email : null,
    wouldText: channel === 'sms' || channel === 'both' ? phone : null,
  };
}

/** Same rule everywhere: tspContact wins; the legacy field counts only when it's empty. */
function ownerOf(event: Pick<EventRow, 'tspContact' | 'tspContactAssigned'>): string | null {
  return event.tspContact || event.tspContactAssigned || null;
}

// ---------------------------------------------------------------------------
// Daily limit
// ---------------------------------------------------------------------------

async function alreadySentToday(userId: string, today: string): Promise<boolean> {
  const rows = await db
    .select({ userId: eventAlertDigestSends.userId })
    .from(eventAlertDigestSends)
    .where(and(eq(eventAlertDigestSends.userId, userId), eq(eventAlertDigestSends.sentOn, today)))
    .limit(1);
  return rows.length > 0;
}

/** Atomically claim today's digest for this person. False = already sent today. */
async function claimDailySlot(userId: string, today: string): Promise<boolean> {
  const claimed = await db
    .insert(eventAlertDigestSends)
    .values({ userId, sentOn: today })
    .onConflictDoNothing()
    .returning({ userId: eventAlertDigestSends.userId });
  return claimed.length > 0;
}

/** Give today's slot back (nothing was delivered), so the next hourly run retries. */
async function releaseDailySlot(userId: string, today: string): Promise<void> {
  await db
    .delete(eventAlertDigestSends)
    .where(and(eq(eventAlertDigestSends.userId, userId), eq(eventAlertDigestSends.sentOn, today)));
}

/**
 * Forget sent-history that no longer applies, so the alert starts fresh:
 * - the event now belongs to someone else (a later return to this person gets
 *   a catch-up alert), or is deleted / gone
 * - the event left the statuses that alert covers (e.g. Scheduled back to In
 *   Process gets its requested-date checkpoints again)
 * A status change and change back between two hourly runs isn't seen; that's
 * an accepted gap.
 */
async function pruneStaleAlertHistory(): Promise<void> {
  // executeRawSql: works on both the Neon HTTP driver (production) and node-postgres.
  await executeRawSql(sql`
    DELETE FROM event_check_in_reminders r
     WHERE NOT EXISTS (SELECT 1 FROM event_requests e WHERE e.id = r.event_request_id)
        OR EXISTS (
          SELECT 1 FROM event_requests e
           WHERE e.id = r.event_request_id
             AND (
               e.deleted_at IS NOT NULL
               OR coalesce(nullif(e.tsp_contact, ''), nullif(e.tsp_contact_assigned, '')) IS DISTINCT FROM r.user_id
               OR (r.rule_type IN ('no_contact', 'stale_event', 'date_approaching_inprocess')
                   AND e.status NOT IN ('new', 'in_process'))
               OR (r.rule_type = 'date_approaching_scheduled'
                   AND e.status NOT IN ('scheduled', 'rescheduled'))
             )
        )`);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type AlertData = {
  usersById: Map<string, UserRow>;
  eventsByOwner: Map<string, EventRow[]>;
  /** `${eventId}:${userId}:${ruleType}` -> state */
  state: Map<string, AlertState>;
  /** `${eventId}:${userId}` -> active snoozes */
  snoozes: Map<string, AlertSnooze[]>;
};

async function loadAlertData(onlyUserId?: string): Promise<AlertData> {
  const assigned = or(
    sql`coalesce(${eventRequests.tspContact}, '') <> ''`,
    sql`coalesce(${eventRequests.tspContactAssigned}, '') <> ''`,
  );
  const events = await db
    .select()
    .from(eventRequests)
    .where(and(
      inArray(eventRequests.status, [...ALERT_STATUSES]),
      isNull(eventRequests.deletedAt),
      assigned,
    ));

  const eventsByOwner = new Map<string, EventRow[]>();
  for (const ev of events) {
    const owner = ownerOf(ev);
    if (!owner || (onlyUserId && owner !== onlyUserId)) continue;
    eventsByOwner.set(owner, [...(eventsByOwner.get(owner) ?? []), ev]);
  }

  const ownerIds = [...eventsByOwner.keys()];
  const usersById = new Map<string, UserRow>();
  const state = new Map<string, AlertState>();
  const snoozes = new Map<string, AlertSnooze[]>();
  if (ownerIds.length === 0) return { usersById, eventsByOwner, state, snoozes };

  for (const u of await db.select().from(users).where(inArray(users.id, ownerIds))) usersById.set(u.id, u);

  const rows = await db
    .select()
    .from(eventCheckInReminders)
    .where(inArray(eventCheckInReminders.userId, ownerIds));
  for (const r of rows) {
    state.set(`${r.eventRequestId}:${r.userId}:${r.ruleType}`, { lastSentAt: r.lastSentAt, lastSentKey: r.lastSentKey });
  }

  const sn = await db
    .select()
    .from(eventReminderSnoozes)
    .where(and(inArray(eventReminderSnoozes.userId, ownerIds), eq(eventReminderSnoozes.active, true)));
  for (const s of sn) {
    const k = `${s.eventRequestId}:${s.userId}`;
    snoozes.set(k, [...(snoozes.get(k) ?? []), {
      id: s.id, ruleType: s.ruleType, snoozeType: s.snoozeType, snoozedUntil: s.snoozedUntil, createdAt: s.createdAt,
    }]);
  }
  return { usersById, eventsByOwner, state, snoozes };
}

// ---------------------------------------------------------------------------
// Building one person's digest
// ---------------------------------------------------------------------------

type PersonDigest = {
  items: DigestItem[];
  /** Every alert to record as sent: event id + the alert */
  sentAlerts: { eventId: number; alert: DueAlert }[];
  endedSnoozeIds: number[];
  disabledRules: AlertRuleType[];
};

function buildPersonDigest(user: UserRow, data: AlertData, now: Date): PersonDigest {
  const prefs = getCheckInReminderPreferences(user);
  const disabledRules = prefs.rules.filter(r => !r.enabled).map(r => r.ruleType as AlertRuleType);
  const scored: { item: DigestItem; due: DueAlert[] }[] = [];
  const sentAlerts: PersonDigest['sentAlerts'] = [];
  const endedSnoozeIds: number[] = [];

  for (const event of data.eventsByOwner.get(user.id) ?? []) {
    const state: Partial<Record<AlertRuleType, AlertState>> = {};
    for (const r of prefs.rules) {
      const s = data.state.get(`${event.id}:${user.id}:${r.ruleType}`);
      if (s) state[r.ruleType as AlertRuleType] = s;
    }
    const result = evaluateEventAlerts(
      event as any,
      prefs.rules,
      state,
      data.snoozes.get(`${event.id}:${user.id}`) ?? [],
      now,
    );
    endedSnoozeIds.push(...result.endedSnoozeIds);
    if (result.due.length === 0) continue;
    result.due.forEach(alert => sentAlerts.push({ eventId: event.id, alert }));
    scored.push({
      due: result.due,
      item: { event: event as any, lines: toAlertLines(result.due), maxSnoozeDays: maxSnoozeDays(event as any, now) },
    });
  }

  scored.sort((a, b) => urgencyCompare(a.due, b.due));
  return { items: scored.map(s => s.item), sentAlerts, endedSnoozeIds, disabledRules };
}

/** The digest a person would get right now, or null if nothing is due. For admin previews. */
export async function previewDigestForUser(userId: string, now = new Date()): Promise<RenderedDigest | null> {
  const data = await loadAlertData(userId);
  const user = data.usersById.get(userId);
  if (!user) return null;
  const { items } = buildPersonDigest(user, data, now);
  if (items.length === 0) return null;
  return renderDigest(user.displayName || user.firstName || 'there', items, getAppBaseUrl());
}

// ---------------------------------------------------------------------------
// After sending
// ---------------------------------------------------------------------------

async function recordSent(userId: string, channel: string, sent: PersonDigest['sentAlerts'], at: Date): Promise<void> {
  for (const { eventId, alert } of sent) {
    await db
      .insert(eventCheckInReminders)
      .values({
        eventRequestId: eventId,
        userId,
        ruleType: alert.ruleType,
        enabled: true,
        channel,
        lastSentAt: at,
        lastSentKey: alert.stateKey,
      })
      .onConflictDoUpdate({
        target: [eventCheckInReminders.eventRequestId, eventCheckInReminders.userId, eventCheckInReminders.ruleType],
        set: { lastSentAt: at, lastSentKey: alert.stateKey, enabled: true, updatedAt: at },
      });
  }
}

async function endSnoozes(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(eventReminderSnoozes)
    .set({ active: false, cancelledAt: new Date() })
    .where(and(inArray(eventReminderSnoozes.id, ids), eq(eventReminderSnoozes.active, true)));
}

/**
 * Forget what was sent for alerts the person has turned off, so turning one
 * back on starts fresh (one catch-up alert, then normal timing).
 */
async function forgetDisabledAlerts(userId: string, disabled: AlertRuleType[]): Promise<void> {
  if (disabled.length === 0) return;
  await db
    .delete(eventCheckInReminders)
    .where(and(eq(eventCheckInReminders.userId, userId), inArray(eventCheckInReminders.ruleType, disabled)));
}

/**
 * Old per-event reminder types that no longer exist (general check-in,
 * staffing, missing details): their rows are dead weight. Cheap and idempotent.
 */
async function deleteRetiredRows(): Promise<void> {
  await db
    .delete(eventCheckInReminders)
    .where(notInArray(eventCheckInReminders.ruleType, [...ACTIVE_ALERT_RULE_TYPES]));
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function processCheckInReminders(
  options: { dryRun?: boolean; ignoreSendHour?: boolean; now?: Date } = {},
): Promise<DigestRunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? isCheckInReminderDryRun();
  const result: DigestRunResult = { processed: 0, sent: 0, errors: 0, dryRun, plan: [] };

  if (!options.ignoreSendHour && easternHour(now) < DIGEST_SEND_HOUR) {
    result.skipped = `before ${DIGEST_SEND_HOUR} AM Eastern`;
    return result;
  }

  const today = easternDateString(now);
  const baseUrl = getAppBaseUrl();
  let ownerIds: string[];
  try {
    if (!dryRun) {
      await deleteRetiredRows();
      await pruneStaleAlertHistory();
    }
    ownerIds = [...(await loadAlertData()).usersById.keys()];
  } catch (error) {
    logger.error('[EventAlerts] Failed to load alert data:', error);
    result.errors++;
    return result;
  }

  for (const userId of ownerIds) {
    try {
      if (!dryRun && (await alreadySentToday(userId, today))) continue;
      // Re-read this person's account, events, history and snoozes right
      // before building their digest: earlier sends in this run take time, and
      // an event reassigned (or an account deactivated) meanwhile must not go
      // to its former contact.
      const data = await loadAlertData(userId);
      const user = data.usersById.get(userId);
      if (!user || user.isActive === false) continue;
      result.processed++;
      const digest = buildPersonDigest(user, data, now);
      const prefs = getCheckInReminderPreferences(user);

      if (dryRun) {
        if (digest.items.length === 0) continue;
        const rendered = renderDigest(displayName(user), digest.items, baseUrl);
        result.plan.push({
          kind: 'digest',
          userId,
          userName: displayName(user),
          ...plannedChannels(user, prefs.defaultChannel),
          subject: rendered.subject,
          events: digest.items.map(i => ({
            id: i.event.id,
            organization: i.event.organizationName || 'Unnamed group',
            detail: i.lines.map(l => l.line).join('; '),
          })),
        });
        logger.info(`[EventAlerts][DRY RUN] would send ${displayName(user)}: ${rendered.subject}`);
        continue;
      }

      if (digest.items.length === 0) {
        // Nothing to send; still tidy up snoozes whose problem was fixed.
        await endSnoozes(digest.endedSnoozeIds);
        await forgetDisabledAlerts(userId, digest.disabledRules);
        continue;
      }

      if (!(await claimDailySlot(userId, today))) continue;

      const userName = user.displayName || user.firstName || 'there';
      const rendered = renderDigest(userName, digest.items, baseUrl);

      // Bell first: it's the record. If it fails, give the slot back and retry next hour.
      try {
        await db.insert(notifications).values({
          userId,
          type: 'reminder',
          priority: 'medium',
          title: rendered.subject,
          message: rendered.bellMessage,
          category: 'events',
          relatedType: 'event_request_summary',
          actionUrl: '/dashboard?section=event-requests&tab=my_assignments',
          actionText: 'Open my events',
          metadata: { eventIds: digest.items.map(i => i.event.id), source: 'event_alert_digest' },
        });
      } catch (error) {
        await releaseDailySlot(userId, today);
        throw error;
      }

      let delivered = false;
      const channel = prefs.defaultChannel;
      const email = user.preferredEmail || user.email;
      if ((channel === 'email' || channel === 'both') && email && isEmailConfigured()) {
        try {
          const sent = await sendEmailOrThrow({
            to: email,
            from: 'katie@thesandwichproject.org',
            subject: rendered.subject,
            headers: {
              'List-Unsubscribe': `<mailto:katie@thesandwichproject.org?subject=Unsubscribe%20from%20event%20alerts>, <${baseUrl}/profile?tab=notifications>`,
            },
            html: rendered.html,
            emailStream: 'operational',
          });
          delivered = delivered || sent.success; // false = they unsubscribed
        } catch (error) {
          result.errors++;
          logger.error(`[EventAlerts] Email to user ${userId} failed (bell has it):`, error);
        }
      }
      const consent = getUserMetadata(user).smsConsent;
      if ((channel === 'sms' || channel === 'both') && consent?.enabled && consent.phoneNumber) {
        try {
          const sms = await sendTSPFollowupReminderSMS(consent.phoneNumber, rendered.sms);
          delivered = delivered || sms.success;
        } catch (error) {
          result.errors++;
          logger.error(`[EventAlerts] Text to user ${userId} failed (bell has it):`, error);
        }
      }
      if (delivered) result.sent++;

      await recordSent(userId, channel, digest.sentAlerts, now);
      await endSnoozes(digest.endedSnoozeIds);
      await forgetDisabledAlerts(userId, digest.disabledRules);
      logger.info(`[EventAlerts] Sent ${userId} a digest of ${digest.items.length} event(s)`);
    } catch (error) {
      result.errors++;
      logger.error(`[EventAlerts] Failed for user ${userId}:`, error);
    }
  }

  logger.info(`[EventAlerts] ${dryRun ? 'DRY RUN ' : ''}done: ${result.processed} people checked, ${result.sent} sent, ${result.errors} errors`);
  return result;
}
