/**
 * Admin Weekly Digest Service
 *
 * Proactive notification system that pushes key operational data to the admin
 * instead of requiring them to navigate into the app to find it.
 *
 * Sends two things:
 * 1. A rich HTML email digest (Sunday evening) with full operational overview
 * 2. A concise SMS pulse (Monday morning) with top-line numbers + #1 action item
 *
 * Data sources:
 * - Weekly impact report metrics (sandwiches, locations, trends)
 * - Yearly calendar items approaching/due this week
 * - Tracked calendar items (school breaks, holidays)
 * - Event request pipeline (new, in_process, scheduled, completed)
 * - Operational alerts (locations needing attention, pending actions)
 */

import { db } from '../db';
import { eventRequests, yearlyCalendarItems, trackedCalendarItems, users } from '@shared/schema';
import { eq, and, gte, lte, sql, inArray, desc, count } from 'drizzle-orm';
import { sendEmail } from './email';
import { sendTSPFollowupReminderSMS } from '../sms-service';
import { getUserPhoneNumber } from '@shared/types';
import { logger } from '../utils/production-safe-logger';
import { logApplicationError, logFromException } from './application-error-logger';
import { ADMIN_EMAIL, FROM_EMAIL, ORG_NAME, BRAND_PRIMARY, BRAND_SECONDARY } from '../config/organization';
import { EMAIL_FOOTER_HTML, EMAIL_FOOTER_TEXT } from '../utils/email-footer';
import { getAppBaseUrl } from '../config/constants';
import { USER_ROLES } from '@shared/auth-utils';
import { ALERT_TYPES } from '@shared/alert-catalog';
import { shouldSendOverChannel } from './notifications/preferences';

// ─── Data Gathering ────────────────────────────────────────────────

interface PipelineSnapshot {
  new_requests: number;
  in_process: number;
  scheduled: number;
  completed_this_week: number;
  standby: number;
  total_active: number;
}

interface CalendarItem {
  id: number;
  title: string;
  description?: string | null;
  category: string;
  priority?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  month?: number;
  year?: number;
}

interface TrackedItem {
  id: number;
  title: string;
  category: string;
  startDate: string;
  endDate: string;
  notes?: string | null;
}

interface AdminDigestData {
  weekOf: string;
  pipeline: PipelineSnapshot;
  upcomingCalendarItems: CalendarItem[];
  upcomingTrackedItems: TrackedItem[];
  recentCompletions: Array<{ id: number; organization: string; completedAt: string }>;
  stalledEvents: Array<{ id: number; organization: string; status: string; daysSinceUpdate: number }>;
  topActionItem: string | null;
}

/**
 * Gather all data for the admin weekly digest
 */
async function gatherDigestData(): Promise<AdminDigestData> {
  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(now.getDate() - 7);
  const oneWeekAhead = new Date(now);
  oneWeekAhead.setDate(now.getDate() + 14); // Look 2 weeks ahead for calendar

  const weekOfStr = now.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    timeZone: 'America/New_York'
  });

  // 1. Pipeline snapshot — count events by status
  const pipelineCounts = await db
    .select({
      status: eventRequests.status,
      count: count(),
    })
    .from(eventRequests)
    .groupBy(eventRequests.status);

  const statusMap: Record<string, number> = {};
  for (const row of pipelineCounts) {
    statusMap[row.status] = Number(row.count);
  }

  // Completed this week specifically
  const completedThisWeek = await db
    .select({ count: count() })
    .from(eventRequests)
    .where(
      and(
        eq(eventRequests.status, 'completed'),
        gte(eventRequests.statusChangedAt, oneWeekAgo)
      )
    );

  const pipeline: PipelineSnapshot = {
    new_requests: statusMap['new'] || 0,
    in_process: statusMap['in_process'] || 0,
    scheduled: statusMap['scheduled'] || 0,
    completed_this_week: Number(completedThisWeek[0]?.count || 0),
    standby: statusMap['standby'] || 0,
    total_active: (statusMap['new'] || 0) + (statusMap['in_process'] || 0) + (statusMap['scheduled'] || 0),
  };

  // 2. Upcoming yearly calendar items (this month + next month)
  const currentMonth = now.getMonth() + 1; // 1-indexed
  const currentYear = now.getFullYear();
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const nextMonthYear = currentMonth === 12 ? currentYear + 1 : currentYear;

  const calendarItems = await db
    .select()
    .from(yearlyCalendarItems)
    .where(
      sql`(${yearlyCalendarItems.month} = ${currentMonth} AND ${yearlyCalendarItems.year} = ${currentYear})
        OR (${yearlyCalendarItems.month} = ${nextMonth} AND ${yearlyCalendarItems.year} = ${nextMonthYear})`
    )
    .orderBy(yearlyCalendarItems.month, yearlyCalendarItems.priority);

  // 3. Upcoming tracked calendar items (school breaks, holidays within next 2 weeks)
  const trackedItems = await db
    .select()
    .from(trackedCalendarItems)
    .where(
      and(
        lte(trackedCalendarItems.startDate, oneWeekAhead.toISOString().split('T')[0]),
        gte(trackedCalendarItems.endDate, now.toISOString().split('T')[0])
      )
    )
    .orderBy(trackedCalendarItems.startDate);

  // 4. Recent completions (last 7 days)
  const recentCompletions = await db
    .select({
      id: eventRequests.id,
      organization: eventRequests.organizationName,
      completedAt: eventRequests.statusChangedAt,
    })
    .from(eventRequests)
    .where(
      and(
        eq(eventRequests.status, 'completed'),
        gte(eventRequests.statusChangedAt, oneWeekAgo)
      )
    )
    .orderBy(desc(eventRequests.statusChangedAt))
    .limit(10);

  // 5. Stalled events (in_process or new for 5+ days with no recent activity)
  const fiveDaysAgo = new Date(now);
  fiveDaysAgo.setDate(now.getDate() - 5);

  const stalledEvents = await db
    .select({
      id: eventRequests.id,
      organization: eventRequests.organizationName,
      status: eventRequests.status,
      updatedAt: eventRequests.updatedAt,
    })
    .from(eventRequests)
    .where(
      and(
        inArray(eventRequests.status, ['new', 'in_process']),
        lte(eventRequests.updatedAt, fiveDaysAgo)
      )
    )
    .orderBy(eventRequests.updatedAt)
    .limit(10);

  const stalledWithDays = stalledEvents.map(e => ({
    id: e.id,
    organization: e.organization || 'Unknown',
    status: e.status,
    daysSinceUpdate: Math.floor((now.getTime() - new Date(e.updatedAt!).getTime()) / (1000 * 60 * 60 * 24)),
  }));

  // 6. Determine the #1 action item
  let topActionItem: string | null = null;
  if (pipeline.new_requests > 0) {
    topActionItem = `${pipeline.new_requests} new event request${pipeline.new_requests > 1 ? 's' : ''} waiting for review`;
  } else if (stalledWithDays.length > 0) {
    const worst = stalledWithDays[0];
    topActionItem = `Event #${worst.id} (${worst.organization}) stalled for ${worst.daysSinceUpdate} days`;
  } else if (calendarItems.filter(c => c.priority === 'high').length > 0) {
    const highPri = calendarItems.filter(c => c.priority === 'high')[0];
    topActionItem = `High-priority calendar item: "${highPri.title}" coming up`;
  } else if (pipeline.total_active > 0) {
    topActionItem = `${pipeline.total_active} active events in the pipeline — all on track`;
  }

  return {
    weekOf: weekOfStr,
    pipeline,
    upcomingCalendarItems: calendarItems.map(c => ({
      id: c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      priority: c.priority,
      startDate: c.startDate,
      endDate: c.endDate,
      month: c.month,
      year: c.year,
    })),
    upcomingTrackedItems: trackedItems.map(t => ({
      id: t.id,
      title: t.title,
      category: t.category,
      startDate: t.startDate!,
      endDate: t.endDate!,
      notes: t.notes,
    })),
    recentCompletions: recentCompletions.map(c => ({
      id: c.id,
      organization: c.organization || 'Unknown',
      completedAt: c.completedAt ? new Date(c.completedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : 'Unknown',
    })),
    stalledEvents: stalledWithDays,
    topActionItem,
  };
}


// ─── Email Builder ─────────────────────────────────────────────────

function buildDigestEmailHtml(data: AdminDigestData): string {
  const baseUrl = getAppBaseUrl();

  // Priority badge helper
  const priorityBadge = (priority: string | null | undefined) => {
    const colors: Record<string, string> = {
      high: '#e74c3c',
      medium: '#f39c12',
      low: '#27ae60',
    };
    const color = colors[priority || 'low'] || '#999';
    return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;text-transform:uppercase;">${priority || 'low'}</span>`;
  };

  // Category emoji helper
  const categoryEmoji = (cat: string) => {
    const map: Record<string, string> = {
      'preparation': '📋',
      'event-rush': '🔥',
      'staffing': '👥',
      'board': '🏛️',
      'seasonal': '🌸',
      'school_breaks': '🏫',
      'holidays': '🎄',
      'events': '📅',
    };
    return map[cat] || '📌';
  };

  // Pipeline section
  const pipelineHtml = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0;">
      ${[
        { label: 'New', value: data.pipeline.new_requests, color: '#e74c3c', link: `${baseUrl}/events?status=new` },
        { label: 'In Process', value: data.pipeline.in_process, color: '#f39c12', link: `${baseUrl}/events?status=in_process` },
        { label: 'Scheduled', value: data.pipeline.scheduled, color: BRAND_PRIMARY, link: `${baseUrl}/events?status=scheduled` },
        { label: 'Completed (7d)', value: data.pipeline.completed_this_week, color: '#27ae60', link: `${baseUrl}/events?status=completed` },
        { label: 'Standby', value: data.pipeline.standby, color: '#95a5a6', link: `${baseUrl}/events?status=standby` },
      ].map(s => `
        <a href="${s.link}" style="text-decoration:none;flex:1;min-width:100px;">
          <div style="background:#f8f9fa;border-radius:8px;padding:14px;text-align:center;border-left:4px solid ${s.color};">
            <div style="font-size:24px;font-weight:700;color:${s.color};">${s.value}</div>
            <div style="font-size:12px;color:#666;margin-top:4px;">${s.label}</div>
          </div>
        </a>
      `).join('')}
    </div>`;

  // Calendar items section
  let calendarHtml = '';
  if (data.upcomingCalendarItems.length > 0) {
    calendarHtml = `
      <h3 style="color:${BRAND_PRIMARY};margin:24px 0 12px;font-size:16px;">📅 Upcoming Calendar Items</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #ddd;">Item</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #ddd;">Category</th>
            <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #ddd;">Priority</th>
          </tr>
        </thead>
        <tbody>
          ${data.upcomingCalendarItems.slice(0, 8).map(item => `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:8px 12px;">
                <strong>${item.title}</strong>
                ${item.description ? `<br><span style="color:#888;font-size:12px;">${item.description.substring(0, 80)}${item.description.length > 80 ? '...' : ''}</span>` : ''}
              </td>
              <td style="padding:8px 12px;">${categoryEmoji(item.category)} ${item.category}</td>
              <td style="padding:8px 12px;text-align:center;">${priorityBadge(item.priority)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${data.upcomingCalendarItems.length > 8 ? `<p style="color:#888;font-size:12px;margin-top:8px;">+ ${data.upcomingCalendarItems.length - 8} more items — <a href="${baseUrl}/yearly-calendar" style="color:${BRAND_PRIMARY};">view all</a></p>` : ''}
    `;
  }

  // Tracked items (school breaks, holidays)
  let trackedHtml = '';
  if (data.upcomingTrackedItems.length > 0) {
    trackedHtml = `
      <h3 style="color:${BRAND_PRIMARY};margin:24px 0 12px;font-size:16px;">🏫 Upcoming School Breaks &amp; Holidays</h3>
      <div style="margin:0;">
        ${data.upcomingTrackedItems.map(item => {
          const start = new Date(item.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
          const end = new Date(item.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
          return `
          <div style="background:#fff8e1;border-left:3px solid #f39c12;padding:10px 14px;margin:8px 0;border-radius:4px;">
            <strong>${categoryEmoji(item.category)} ${item.title}</strong>
            <span style="color:#888;font-size:12px;margin-left:8px;">${start} – ${end}</span>
            ${item.notes ? `<br><span style="color:#666;font-size:12px;">${item.notes}</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    `;
  }

  // Stalled events alert
  let stalledHtml = '';
  if (data.stalledEvents.length > 0) {
    stalledHtml = `
      <h3 style="color:#e74c3c;margin:24px 0 12px;font-size:16px;">⚠️ Needs Attention</h3>
      <div style="background:#fdf2f2;border:1px solid #f5c6cb;border-radius:8px;padding:14px;">
        ${data.stalledEvents.map(e => `
          <div style="padding:6px 0;border-bottom:1px solid #f5c6cb;">
            <a href="${baseUrl}/events/${e.id}" style="color:${BRAND_PRIMARY};font-weight:600;">#${e.id} ${e.organization}</a>
            <span style="color:#888;font-size:12px;margin-left:8px;">${e.status} · ${e.daysSinceUpdate}d no activity</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Recent completions
  let completionsHtml = '';
  if (data.recentCompletions.length > 0) {
    completionsHtml = `
      <h3 style="color:#27ae60;margin:24px 0 12px;font-size:16px;">✅ Completed This Week</h3>
      <div style="background:#f0faf0;border-radius:8px;padding:14px;">
        ${data.recentCompletions.map(c => `
          <div style="padding:4px 0;">
            <a href="${baseUrl}/events/${c.id}" style="color:${BRAND_PRIMARY};">#${c.id}</a> ${c.organization}
            <span style="color:#888;font-size:12px;margin-left:8px;">${c.completedAt}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Top action item callout
  let actionCallout = '';
  if (data.topActionItem) {
    actionCallout = `
      <div style="background:${BRAND_PRIMARY};color:#fff;padding:16px 20px;border-radius:8px;margin:20px 0;">
        <strong style="font-size:14px;">🎯 This Week's #1 Priority</strong>
        <p style="margin:8px 0 0;font-size:15px;">${data.topActionItem}</p>
      </div>
    `;
  }

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;color:#333;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,${BRAND_PRIMARY},${BRAND_SECONDARY});padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">${ORG_NAME}</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">Weekly Admin Digest · ${data.weekOf}</p>
      </div>

      <div style="padding:20px;background:#fff;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px;">
        ${actionCallout}

        <h3 style="color:${BRAND_PRIMARY};margin:20px 0 8px;font-size:16px;">📊 Event Pipeline</h3>
        ${pipelineHtml}

        ${stalledHtml}
        ${calendarHtml}
        ${trackedHtml}
        ${completionsHtml}

        <!-- Quick Links -->
        <div style="margin:28px 0 10px;padding-top:20px;border-top:1px solid #eee;text-align:center;">
          <a href="${baseUrl}/dashboard" style="display:inline-block;background:${BRAND_PRIMARY};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:4px;">Open Dashboard</a>
          <a href="${baseUrl}/yearly-calendar" style="display:inline-block;background:${BRAND_SECONDARY};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:4px;">View Calendar</a>
          <a href="${baseUrl}/analytics" style="display:inline-block;background:#27ae60;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:4px;">Analytics</a>
        </div>
      </div>

      ${EMAIL_FOOTER_HTML}
    </div>
  `;
}

function buildDigestEmailText(data: AdminDigestData): string {
  let text = `${ORG_NAME} — Weekly Admin Digest\nWeek of ${data.weekOf}\n\n`;

  if (data.topActionItem) {
    text += `🎯 #1 PRIORITY: ${data.topActionItem}\n\n`;
  }

  text += `📊 EVENT PIPELINE\n`;
  text += `  New: ${data.pipeline.new_requests} | In Process: ${data.pipeline.in_process} | Scheduled: ${data.pipeline.scheduled}\n`;
  text += `  Completed (7d): ${data.pipeline.completed_this_week} | Standby: ${data.pipeline.standby}\n\n`;

  if (data.stalledEvents.length > 0) {
    text += `⚠️ NEEDS ATTENTION\n`;
    data.stalledEvents.forEach(e => {
      text += `  #${e.id} ${e.organization} — ${e.status}, ${e.daysSinceUpdate}d stalled\n`;
    });
    text += '\n';
  }

  if (data.upcomingCalendarItems.length > 0) {
    text += `📅 UPCOMING CALENDAR (${data.upcomingCalendarItems.length} items)\n`;
    data.upcomingCalendarItems.slice(0, 5).forEach(item => {
      text += `  [${item.priority || 'low'}] ${item.title} (${item.category})\n`;
    });
    text += '\n';
  }

  if (data.upcomingTrackedItems.length > 0) {
    text += `🏫 SCHOOL BREAKS & HOLIDAYS\n`;
    data.upcomingTrackedItems.forEach(item => {
      text += `  ${item.title}: ${item.startDate} – ${item.endDate}\n`;
    });
    text += '\n';
  }

  if (data.recentCompletions.length > 0) {
    text += `✅ COMPLETED THIS WEEK: ${data.recentCompletions.length}\n`;
    data.recentCompletions.forEach(c => {
      text += `  #${c.id} ${c.organization}\n`;
    });
    text += '\n';
  }

  text += `---\nOpen Dashboard: ${getAppBaseUrl()}/dashboard\n`;
  text += EMAIL_FOOTER_TEXT;

  return text;
}


// ─── SMS Builder ───────────────────────────────────────────────────

function buildAdminSmsText(data: AdminDigestData): string {
  // SMS must be concise — under 320 chars ideally, max 1600
  const parts: string[] = [];

  parts.push(`TSP Weekly Pulse`);
  parts.push(`Pipeline: ${data.pipeline.new_requests} new, ${data.pipeline.in_process} in-process, ${data.pipeline.scheduled} scheduled`);

  if (data.pipeline.completed_this_week > 0) {
    parts.push(`✅ ${data.pipeline.completed_this_week} completed this week`);
  }

  if (data.stalledEvents.length > 0) {
    parts.push(`⚠️ ${data.stalledEvents.length} stalled event${data.stalledEvents.length > 1 ? 's' : ''} need attention`);
  }

  if (data.upcomingTrackedItems.length > 0) {
    const next = data.upcomingTrackedItems[0];
    parts.push(`📅 Coming up: ${next.title}`);
  }

  if (data.topActionItem) {
    parts.push(`🎯 Priority: ${data.topActionItem}`);
  }

  parts.push(`Full digest in your email. Reply STOP to opt out.`);

  return parts.join('\n');
}


// ─── Main Process Functions ────────────────────────────────────────

/**
 * Process and send the admin weekly email digest
 * Called by cron: Sunday at 6:00 PM ET
 */
export async function processAdminWeeklyDigest(): Promise<{ success: boolean; message: string }> {
  logger.log('Starting admin weekly digest...');

  try {
    const data = await gatherDigestData();

    const html = buildDigestEmailHtml(data);
    const text = buildDigestEmailText(data);

    const emailSent = await sendEmail({
      emailStream: 'operational',
      to: ADMIN_EMAIL,
      from: FROM_EMAIL,
      subject: `📊 TSP Weekly Digest — ${data.weekOf}`,
      html,
      text,
    });

    if (emailSent) {
      logger.log('Admin weekly digest email sent successfully');
      return { success: true, message: 'Admin digest email sent' };
    } else {
      logger.error('Admin weekly digest email failed to send');
      logApplicationError({
        source: 'cron',
        severity: 'error',
        category: 'admin_weekly_digest',
        message: 'Admin weekly digest email failed to send',
        notifyAdmin: true,
      });
      return { success: false, message: 'Email send failed' };
    }
  } catch (error) {
    logger.error('Error processing admin weekly digest:', error);
    logFromException(error, {
      source: 'cron',
      severity: 'error',
      category: 'admin_weekly_digest',
      context: 'Admin weekly digest processing failed',
      notifyAdmin: true,
    });
    return { success: false, message: (error as Error).message };
  }
}

/**
 * Process and send the admin Monday morning SMS pulse
 * Called by cron: Monday at 8:00 AM ET
 */
export async function processAdminWeeklySms(): Promise<{ success: boolean; message: string }> {
  logger.log('Starting admin weekly SMS pulse...');

  try {
    // Recipient policy:
    //   • super_admin role → always receives the pulse (no opt-out here)
    //   • admin role       → receives it only if they have opted in via the
    //                        Alert Preferences screen (ADMIN_WEEKLY_PULSE, SMS)
    //   • anyone else      → never receives it
    const candidateUsers = await db
      .select()
      .from(users)
      .where(inArray(users.role, [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN]));

    if (candidateUsers.length === 0) {
      logger.warn('No super_admin or admin users found for SMS pulse');
      return { success: false, message: 'No super_admin or admin users found' };
    }

    const recipients: Array<{
      user: (typeof candidateUsers)[number];
      phone: string;
      reason: 'super_admin_auto' | 'admin_opt_in';
    }> = [];
    let skippedNoPhone = 0;
    let skippedNotOptedIn = 0;

    for (const user of candidateUsers) {
      const phone = getUserPhoneNumber(user);
      if (!phone) {
        skippedNoPhone += 1;
        continue;
      }

      if (user.role === USER_ROLES.SUPER_ADMIN) {
        recipients.push({ user, phone, reason: 'super_admin_auto' });
        continue;
      }

      // Plain admin: gated by their notification preference for this alert.
      const optedIn = await shouldSendOverChannel(
        user.id,
        ALERT_TYPES.ADMIN_WEEKLY_PULSE,
        'sms'
      );
      if (optedIn) {
        recipients.push({ user, phone, reason: 'admin_opt_in' });
      } else {
        skippedNotOptedIn += 1;
      }
    }

    if (skippedNoPhone > 0) {
      logger.warn(
        `Admin SMS pulse: ${skippedNoPhone} candidate user(s) skipped — no phone number on file`
      );
    }
    if (skippedNotOptedIn > 0) {
      logger.log(
        `Admin SMS pulse: ${skippedNotOptedIn} admin(s) skipped — not opted in to ADMIN_WEEKLY_PULSE SMS`
      );
    }

    if (recipients.length === 0) {
      logger.warn('No eligible recipients for admin weekly SMS pulse');
      return { success: false, message: 'No eligible recipients' };
    }

    const data = await gatherDigestData();
    const smsText = buildAdminSmsText(data);

    let sent = 0;
    const failures: string[] = [];

    for (const { user, phone, reason } of recipients) {
      const result = await sendTSPFollowupReminderSMS(phone, smsText);
      if (result.success) {
        sent += 1;
        logger.log(
          `Admin weekly SMS pulse sent to ${user.email || user.id} (${reason})`
        );
      } else {
        const failureReason = result.message || 'SMS send failed';
        failures.push(`${user.email || user.id}: ${failureReason}`);
        logger.error(
          `Admin weekly SMS pulse failed for ${user.email || user.id}:`,
          failureReason
        );
      }
    }

    if (sent === 0) {
      return {
        success: false,
        message: failures.length > 0 ? failures.join('; ') : 'SMS send failed',
      };
    }

    const summary =
      failures.length === 0
        ? `SMS pulse sent to ${sent} recipient${sent === 1 ? '' : 's'}`
        : `SMS pulse sent to ${sent} recipient${sent === 1 ? '' : 's'}; failures: ${failures.join('; ')}`;
    return { success: true, message: summary };
  } catch (error) {
    logger.error('Error processing admin weekly SMS:', error);
    logFromException(error, {
      source: 'cron',
      severity: 'error',
      category: 'admin_weekly_sms',
      context: 'Admin weekly SMS pulse failed',
      notifyAdmin: true,
    });
    return { success: false, message: (error as Error).message };
  }
}
