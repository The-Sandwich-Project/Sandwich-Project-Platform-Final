/**
 * email_suppressions: addresses the app must not email (see docs/data-model.md).
 *
 * Twilio Email keeps its own bounce/spam/unsubscribe list and skips those
 * addresses itself, but nothing can be imported into it and it has no
 * unsubscribe link. This table holds the SendGrid history plus everything our
 * own preferences page records, and the email helper checks it before sending.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  emailSuppressions,
  type EmailSuppressionReason,
  type EmailSuppressionScope,
  type EmailSuppressionSource,
} from '@shared/schema';
import type { EmailStream } from './types';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Map of normalized address -> scopes it is suppressed for. */
export type SuppressionMap = Map<string, Set<EmailSuppressionScope>>;

export async function getSuppressionScopes(emails: string[]): Promise<SuppressionMap> {
  const normalized = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
  const map: SuppressionMap = new Map();
  if (normalized.length === 0) return map;

  const rows = await db
    .select({ email: emailSuppressions.email, scope: emailSuppressions.scope })
    .from(emailSuppressions)
    .where(inArray(emailSuppressions.email, normalized));

  for (const row of rows) {
    const set = map.get(row.email) ?? new Set<EmailSuppressionScope>();
    set.add(row.scope as EmailSuppressionScope);
    map.set(row.email, set);
  }
  return map;
}

export function isSuppressedFor(
  scopes: Set<EmailSuppressionScope> | undefined,
  stream: EmailStream
): boolean {
  return !!scopes && (scopes.has('all') || scopes.has(stream));
}

export async function addSuppression(input: {
  email: string;
  scope: EmailSuppressionScope;
  reason: EmailSuppressionReason;
  source: EmailSuppressionSource;
  note?: string;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email) return;
  await db
    .insert(emailSuppressions)
    .values({ ...input, email })
    .onConflictDoNothing({ target: [emailSuppressions.email, emailSuppressions.scope] });
}

/**
 * Undo the person's own unsubscribes (any source). Never removes bounces,
 * spam reports or invalid-address rows: those mean mail can't or shouldn't
 * be delivered, whatever the person clicks.
 */
export async function removeUnsubscribes(email: string): Promise<number> {
  const normalized = normalizeEmail(email);
  const deleted = await db
    .delete(emailSuppressions)
    .where(
      and(eq(emailSuppressions.email, normalized), eq(emailSuppressions.reason, 'unsubscribe'))
    )
    .returning({ id: emailSuppressions.id });
  return deleted.length;
}
