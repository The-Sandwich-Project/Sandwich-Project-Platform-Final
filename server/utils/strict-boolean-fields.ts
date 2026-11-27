/**
 * Event request columns with a fixed set of allowed values, enforced in the
 * database (NOT NULL / CHECK). A bad value is refused here with a clear
 * message rather than reaching the database as a constraint error.
 */
import { NEXT_DAY_PICKUP_VALUES } from '@shared/next-day-pickup';
import { VAN_TIMES } from '@shared/van-rules';

/** Strictly true or false (NOT NULL). */
export const STRICT_BOOLEAN_FIELDS = ['isTspShopped', 'vanTeamOk'] as const;

/** One of a fixed list (null allowed where the column allows it). */
export const STRICT_ENUM_FIELDS: Record<string, { values: readonly string[]; nullable: boolean }> = {
  nextDayPickup: { values: NEXT_DAY_PICKUP_VALUES, nullable: true },
  vanTimeOverride: { values: VAN_TIMES, nullable: true },
};

/** An error message when `updates` sends a constrained field with a value it can't hold. */
export function strictBooleanFieldError(updates: Record<string, unknown> | null | undefined): string | null {
  if (!updates || typeof updates !== 'object') return null;
  for (const field of STRICT_BOOLEAN_FIELDS) {
    if (field in updates && typeof updates[field] !== 'boolean') {
      return `${field} must be true or false`;
    }
  }
  for (const [field, rule] of Object.entries(STRICT_ENUM_FIELDS)) {
    if (!(field in updates)) continue;
    const v = updates[field];
    if (v === null && rule.nullable) continue;
    if (typeof v !== 'string' || !rule.values.includes(v)) {
      return `${field} must be one of: ${rule.values.join(', ')}`;
    }
  }
  return null;
}
