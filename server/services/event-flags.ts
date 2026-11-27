/**
 * New Event Flags: the notes intake leaves on a New request for the TSP
 * contact (stored as event_collaboration_comments; "Team Comments" was
 * retired). They're included in the "you've been assigned" alert, so the
 * contact sees them before reaching out.
 *
 * The formatting helpers are pure so they can be unit tested; loading is
 * separate.
 */

export interface EventFlag {
  userName: string;
  content: string;
  createdAt: Date;
}

/**
 * Statuses where the thread can still be written (add, edit, delete). Once an
 * event leaves New its comments are "Earlier comments": read-only, on every
 * write path (HTTP create/edit/delete and the socket create).
 */
export const FLAG_STATUSES = new Set(['new']);

export function canWriteFlags(status: string | null | undefined): boolean {
  return FLAG_STATUSES.has(String(status || 'new'));
}

export const FLAGS_READ_ONLY_ERROR = {
  error: 'Flags can only be added or changed while an event is New',
  details: 'Team comments were retired; comments on events past New are read-only. Use the event notes or Log Contact instead.',
};

/**
 * The event a comment really belongs to, and that event's status (null when
 * the comment doesn't exist). Write routes check this, not the event id in the
 * URL, so a mismatched URL can't get around the read-only rule.
 */
export async function loadCommentEvent(
  commentId: number,
): Promise<{ eventRequestId: number; status: string | null } | null> {
  const { db } = await import('../db');
  const { eventCollaborationComments, eventRequests } = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');
  const [row] = await db
    .select({ eventRequestId: eventCollaborationComments.eventRequestId, status: eventRequests.status })
    .from(eventCollaborationComments)
    .innerJoin(eventRequests, eq(eventRequests.id, eventCollaborationComments.eventRequestId))
    .where(eq(eventCollaborationComments.id, commentId))
    .limit(1);
  return row ?? null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One flag can be long; the email links to the event for the rest. */
const MAX_FLAG_CHARS = 1000;

function trimFlag(content: string): string {
  const t = content.trim();
  return t.length > MAX_FLAG_CHARS ? `${t.slice(0, MAX_FLAG_CHARS)}…` : t;
}

/** The "Notes before you reach out" block for the assignment email ('' when none). */
export function flagsEmailHtml(flags: EventFlag[]): string {
  if (flags.length === 0) return '';
  const items = flags
    .map(
      (f) => `
        <div style="background: white; padding: 12px 15px; border-left: 4px solid #FBAD3F; margin: 10px 0;">
          <div style="white-space: pre-wrap;">${escapeHtml(trimFlag(f.content))}</div>
          <div style="color: #666; font-size: 12px; margin-top: 6px;">${escapeHtml(f.userName)}</div>
        </div>`,
    )
    .join('');
  return `
              <div style="background: #FEF3E2; padding: 12px 15px; border-radius: 6px; margin: 15px 0;">
                <strong style="color: #114145;">🚩 Notes before you reach out</strong>
                ${items}
              </div>`;
}

/** Plain-text version of the same block ('' when none). */
export function flagsEmailText(flags: EventFlag[]): string {
  if (flags.length === 0) return '';
  return `\n\nNotes before you reach out:\n${flags.map((f) => `- ${trimFlag(f.content)} (${f.userName})`).join('\n')}`;
}

/** A full note won't fit in a text, so the SMS only says there are some. */
export function flagsSmsSuffix(flags: EventFlag[]): string {
  return flags.length > 0 ? ' Has notes, see event.' : '';
}

/** The event's flags, oldest first (replies included, in order). */
export async function loadEventFlags(eventId: number): Promise<EventFlag[]> {
  const { db } = await import('../db');
  const { eventCollaborationComments } = await import('@shared/schema');
  const { asc, eq } = await import('drizzle-orm');
  const rows = await db
    .select({
      userName: eventCollaborationComments.userName,
      content: eventCollaborationComments.content,
      createdAt: eventCollaborationComments.createdAt,
    })
    .from(eventCollaborationComments)
    .where(eq(eventCollaborationComments.eventRequestId, eventId))
    .orderBy(asc(eventCollaborationComments.createdAt), asc(eventCollaborationComments.id));
  return rows;
}
