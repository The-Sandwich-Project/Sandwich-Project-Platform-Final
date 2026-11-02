import { getRegionFromCoordinates, getRecipientDisplayRegion } from '@/lib/atlanta-regions';
import { normalizeFocusArea } from '@/lib/focus-area-groups';
import type { Recipient } from '@shared/schema';

export const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const DAY_ABBREV: Record<string, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

export type ScheduleEntry = { day: string; time: string; notes?: string };

export type SortColumn =
  | 'name'
  | 'status'
  | 'focusArea'
  | 'region'
  | 'collectionDays'
  | 'feedingDays'
  | 'estimatedSandwiches'
  | 'sandwichType'
  | 'primaryContact'
  | 'tspContact'
  | 'contract'
  | 'reportingGroup'
  | 'address'
  | 'survey'
  | 'cadence'
  | 'peopleServed'
  | 'peopleServedFrequency'
  | 'fruitSnacks';

export type SortDirection = 'asc' | 'desc';

export function extractDaysFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return WEEK_DAYS.filter((d) => lower.includes(d.toLowerCase()));
}

export function getCollectionSchedules(recipient: Recipient): ScheduleEntry[] {
  const schedules = (recipient as Recipient & { collectionSchedules?: ScheduleEntry[] }).collectionSchedules;
  if (Array.isArray(schedules) && schedules.length > 0) return schedules;
  if (recipient.collectionDay || recipient.collectionTime) {
    return [{ day: recipient.collectionDay || '', time: recipient.collectionTime || '' }];
  }
  return [];
}

export function getFeedingSchedules(recipient: Recipient): ScheduleEntry[] {
  const schedules = (recipient as Recipient & { feedingSchedules?: ScheduleEntry[] }).feedingSchedules;
  if (Array.isArray(schedules) && schedules.length > 0) return schedules;
  if (recipient.feedingDay || recipient.feedingTime) {
    return [{ day: recipient.feedingDay || '', time: recipient.feedingTime || '' }];
  }
  return [];
}

export function getRecipientCollectionDays(recipient: Recipient): string[] {
  const days = new Set<string>();
  for (const s of getCollectionSchedules(recipient)) {
    for (const d of extractDaysFromText(s.day)) days.add(d);
  }
  for (const d of extractDaysFromText(recipient.collectionDay)) days.add(d);
  return Array.from(days);
}

export function getRecipientFeedingDays(recipient: Recipient): string[] {
  const days = new Set<string>();
  for (const s of getFeedingSchedules(recipient)) {
    for (const d of extractDaysFromText(s.day)) days.add(d);
  }
  for (const d of extractDaysFromText(recipient.feedingDay)) days.add(d);
  return Array.from(days);
}

/** Map weekday → tooltip lines (time + notes) for schedule chips. */
export function getScheduleDayDetails(schedules: ScheduleEntry[]): Map<string, string[]> {
  const details = new Map<string, string[]>();

  for (const entry of schedules) {
    const matchedDays = extractDaysFromText(entry.day);
    const targets = matchedDays.length > 0 ? matchedDays : entry.day ? [entry.day] : [];

    for (const day of targets) {
      const canonical = WEEK_DAYS.find((d) => d.toLowerCase() === day.toLowerCase()) || day;
      const line = [entry.time, entry.notes].filter(Boolean).join(' · ') || entry.day || 'Scheduled';
      const existing = details.get(canonical) || [];
      if (!existing.includes(line)) existing.push(line);
      details.set(canonical, existing);
    }
  }

  return details;
}

export function earliestDayIndex(days: string[]): number {
  if (!days.length) return Infinity;
  let min = Infinity;
  for (const d of days) {
    const i = WEEK_DAYS.indexOf(d as (typeof WEEK_DAYS)[number]);
    if (i !== -1 && i < min) min = i;
  }
  return min;
}

export function getFocusAreas(recipient: Recipient): string[] {
  const rawAreas =
    Array.isArray((recipient as Recipient & { focusAreas?: string[] }).focusAreas) &&
    (recipient as Recipient & { focusAreas?: string[] }).focusAreas!.length > 0
      ? (recipient as Recipient & { focusAreas?: string[] }).focusAreas!
      : recipient.focusArea
        ? [recipient.focusArea]
        : [];
  return [...new Set(rawAreas.map((a) => normalizeFocusArea(a)).filter(Boolean))];
}

export function getRecipientRegion(recipient: Recipient): string {
  return getRecipientDisplayRegion(recipient) ||
    (recipient.latitude && recipient.longitude
      ? getRegionFromCoordinates(recipient.latitude, recipient.longitude)
      : 'Not geocoded');
}

export function getEstimatedSandwiches(recipient: Recipient): number | null {
  // Falls back to weeklyEstimate (legacy) then estimatedSandwiches.
  // Treated as the MIN of any range — see getEstimatedSandwichesRange for the full range.
  return recipient.weeklyEstimate ?? recipient.estimatedSandwiches ?? null;
}

/**
 * Estimated sandwiches as a range. Returns null when no number is set.
 * If only a single number is stored, min === max.
 */
export function getEstimatedSandwichesRange(
  recipient: Recipient
): { min: number; max: number } | null {
  const min = getEstimatedSandwiches(recipient);
  if (min == null) return null;
  const maxRaw = (recipient as Recipient & { estimatedSandwichesMax?: number | null })
    .estimatedSandwichesMax;
  const max = typeof maxRaw === 'number' && maxRaw >= min ? maxRaw : min;
  return { min, max };
}

export type PlannedBreakdownRow = { type: string; min: number; max: number };

/** Read the planned sandwich breakdown safely, filtering out empty rows. */
export function getPlannedSandwichBreakdown(recipient: Recipient): PlannedBreakdownRow[] {
  const raw = (recipient as Recipient & { plannedSandwichBreakdown?: PlannedBreakdownRow[] })
    .plannedSandwichBreakdown;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is PlannedBreakdownRow =>
      !!r && typeof r.type === 'string' && Number.isFinite(r.min) && Number.isFinite(r.max)
  );
}

/** Sum the breakdown into a total min/max range. Returns null when the list is empty. */
export function sumBreakdownRange(
  rows: PlannedBreakdownRow[]
): { min: number; max: number } | null {
  if (rows.length === 0) return null;
  let min = 0;
  let max = 0;
  for (const r of rows) {
    min += r.min;
    max += r.max;
  }
  return { min, max };
}

/** Format a min/max pair: "200" if single, "150-200" if range. */
export function formatRange(min: number, max: number): string {
  if (min === max) return min.toLocaleString();
  return `${min.toLocaleString()}-${max.toLocaleString()}`;
}

export type ContractStatus = 'signed' | 'pending' | 'none';

export function getContractStatus(recipient: Recipient): ContractStatus {
  if (recipient.contractSigned) return 'signed';
  if (recipient.status === 'inactive') return 'none';
  return 'pending';
}

export function getPrimaryContactName(recipient: Recipient): string {
  return recipient.contactPersonName || recipient.contactName || '';
}

export function sortRecipients(
  list: Recipient[],
  column: SortColumn,
  direction: SortDirection
): Recipient[] {
  const sorted = [...list];
  const factor = direction === 'asc' ? 1 : -1;

  const compareStrings = (a: string, b: string) => (a || '').localeCompare(b || '') * factor;
  const compareNumbers = (a: number, b: number) => (a - b) * factor;

  sorted.sort((a, b) => {
    switch (column) {
      case 'name':
        return compareStrings(a.name || '', b.name || '');
      case 'status':
        return compareStrings(a.status || '', b.status || '');
      case 'focusArea':
        return compareStrings(getFocusAreas(a).join(', '), getFocusAreas(b).join(', '));
      case 'region':
        return compareStrings(getRecipientRegion(a), getRecipientRegion(b));
      case 'collectionDays': {
        const da = earliestDayIndex(getRecipientCollectionDays(a));
        const db = earliestDayIndex(getRecipientCollectionDays(b));
        if (da !== db) return compareNumbers(da, db);
        return compareStrings(a.name || '', b.name || '');
      }
      case 'feedingDays': {
        const da = earliestDayIndex(getRecipientFeedingDays(a));
        const db = earliestDayIndex(getRecipientFeedingDays(b));
        if (da !== db) return compareNumbers(da, db);
        return compareStrings(a.name || '', b.name || '');
      }
      case 'estimatedSandwiches': {
        const ea = getEstimatedSandwiches(a) ?? -1;
        const eb = getEstimatedSandwiches(b) ?? -1;
        if (ea !== eb) return compareNumbers(ea, eb);
        return compareStrings(a.name || '', b.name || '');
      }
      case 'sandwichType':
        return compareStrings(a.sandwichType || '', b.sandwichType || '');
      case 'primaryContact':
        return compareStrings(getPrimaryContactName(a), getPrimaryContactName(b));
      case 'tspContact':
        return compareStrings(a.tspContact || '', b.tspContact || '');
      case 'contract': {
        const order = { signed: 0, pending: 1, none: 2 };
        const ca = order[getContractStatus(a)];
        const cb = order[getContractStatus(b)];
        if (ca !== cb) return compareNumbers(ca, cb);
        return compareStrings(a.name || '', b.name || '');
      }
      case 'reportingGroup':
        return compareStrings(a.reportingGroup || '', b.reportingGroup || '');
      case 'address':
        // Alphabetical sort by address; blank addresses sink to the bottom.
        return compareStrings(a.address || '￿', b.address || '￿');
      case 'survey': {
        // Submitted before not-submitted in ascending order.
        const sa = (a as Recipient & { surveySubmitted?: boolean }).surveySubmitted ? 0 : 1;
        const sb = (b as Recipient & { surveySubmitted?: boolean }).surveySubmitted ? 0 : 1;
        if (sa !== sb) return compareNumbers(sa, sb);
        return compareStrings(a.name || '', b.name || '');
      }
      case 'cadence': {
        // Order: most reliable → least reliable → none.
        const order = {
          weekly_priority: 0,
          as_requested_consistently: 1,
          when_extras: 2,
          as_requested: 3,
          as_needed: 4,
        } as const;
        const ca = (a as Recipient & { deliveryCadence?: string | null }).deliveryCadence;
        const cb = (b as Recipient & { deliveryCadence?: string | null }).deliveryCadence;
        const ra = ca && ca in order ? order[ca as keyof typeof order] : 5;
        const rb = cb && cb in order ? order[cb as keyof typeof order] : 5;
        if (ra !== rb) return compareNumbers(ra, rb);
        return compareStrings(a.name || '', b.name || '');
      }
      case 'peopleServed': {
        const pa = (a as Recipient & { averagePeopleServed?: number | null }).averagePeopleServed ?? -1;
        const pb = (b as Recipient & { averagePeopleServed?: number | null }).averagePeopleServed ?? -1;
        if (pa !== pb) return compareNumbers(pa, pb);
        return compareStrings(a.name || '', b.name || '');
      }
      case 'peopleServedFrequency': {
        // daily (most frequent) → weekly → monthly → none (least), asc.
        const order = { daily: 0, weekly: 1, monthly: 2 } as const;
        const fa = (a as Recipient & { peopleServedFrequency?: string | null }).peopleServedFrequency;
        const fb = (b as Recipient & { peopleServedFrequency?: string | null }).peopleServedFrequency;
        const ra = fa && fa in order ? order[fa as keyof typeof order] : 3;
        const rb = fb && fb in order ? order[fb as keyof typeof order] : 3;
        if (ra !== rb) return compareNumbers(ra, rb);
        return compareStrings(a.name || '', b.name || '');
      }
      case 'fruitSnacks': {
        // receiving (0) → interested (1) → none (2). Combined across both
        // fruit + snacks fields since the business rule treats them as one.
        const rank = (r: Recipient) => {
          const recv =
            !!(r as Recipient & { receivingFruit?: boolean }).receivingFruit ||
            !!(r as Recipient & { receivingSnacks?: boolean }).receivingSnacks;
          const want =
            !!(r as Recipient & { wantsFruit?: boolean }).wantsFruit ||
            !!(r as Recipient & { wantsSnacks?: boolean }).wantsSnacks;
          if (recv) return 0;
          if (want) return 1;
          return 2;
        };
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return compareNumbers(ra, rb);
        return compareStrings(a.name || '', b.name || '');
      }
      default:
        return compareStrings(a.name || '', b.name || '');
    }
  });

  return sorted;
}

export type DeliveryCadence =
  | 'weekly_priority'
  | 'as_requested_consistently'
  | 'when_extras'
  | 'as_requested'
  | 'as_needed';

/**
 * Delivery cadence describes HOW OFTEN we serve an org — independent of the
 * sandwich count. Used as a planning / prioritization signal.
 */
export const DELIVERY_CADENCE_OPTIONS: ReadonlyArray<{
  value: DeliveryCadence;
  label: string;
  description: string;
  /** Class for badge background + text + border in one shot. */
  badgeClass: string;
}> = [
  {
    value: 'weekly_priority',
    label: 'Weekly priority',
    description: 'Regular committed orgs we serve every week.',
    badgeClass: 'bg-[#236383]/15 text-[#236383] border-[#236383]/40',
  },
  {
    value: 'as_requested_consistently',
    label: 'As requested (consistent)',
    description: 'They request reliably on a regular cadence.',
    badgeClass: 'bg-[#47B3CB]/15 text-[#236383] border-[#47B3CB]/40',
  },
  {
    value: 'when_extras',
    label: 'When we have extras',
    description: 'Served when we have surplus / leftovers.',
    badgeClass: 'bg-[#FBAD3F]/15 text-[#B8860B] border-[#FBAD3F]/40',
  },
  {
    value: 'as_requested',
    label: 'As requested',
    description: 'They ask occasionally; we serve when they do.',
    badgeClass: 'bg-[#FBAD3F]/10 text-[#B8860B] border-[#FBAD3F]/30',
  },
  {
    value: 'as_needed',
    label: 'As needed',
    description: 'Irregular or special-circumstance orgs.',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
  },
];

export function getCadenceMeta(cadence: string | null | undefined) {
  return DELIVERY_CADENCE_OPTIONS.find((c) => c.value === cadence) || null;
}

export const RECIPIENT_FOCUS_AREAS = [
  'Youth',
  'Veterans',
  'Seniors',
  'Families',
  'Unhoused',
  'Refugees',
  'Disabilities',
  'Other',
] as const;

export type WeeklyScheduleBuckets = {
  collection: Record<string, Recipient[]>;
  feeding: Record<string, Recipient[]>;
  collectionUnscheduled: Recipient[];
  feedingUnscheduled: Recipient[];
};

function emptyDayBuckets(): Record<string, Recipient[]> {
  return {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: [],
  };
}

/** Bucket recipients into collection + feeding day columns for the weekly calendar. */
export function buildWeeklyScheduleBuckets(recipients: Recipient[]): WeeklyScheduleBuckets {
  const collection = emptyDayBuckets();
  const feeding = emptyDayBuckets();
  const collectionUnscheduled: Recipient[] = [];
  const feedingUnscheduled: Recipient[] = [];

  for (const recipient of recipients) {
    const collectionDays = getRecipientCollectionDays(recipient);
    const feedingDays = getRecipientFeedingDays(recipient);

    if (collectionDays.length === 0) {
      collectionUnscheduled.push(recipient);
    } else {
      for (const day of collectionDays) {
        if (collection[day]) collection[day].push(recipient);
      }
    }

    if (feedingDays.length === 0) {
      feedingUnscheduled.push(recipient);
    } else {
      for (const day of feedingDays) {
        if (feeding[day]) feeding[day].push(recipient);
      }
    }
  }

  return { collection, feeding, collectionUnscheduled, feedingUnscheduled };
}

/** Time string for a specific weekday within a schedule list. */
export function getTimeForDayOnSchedule(
  schedules: ScheduleEntry[],
  day: string
): string | undefined {
  for (const entry of schedules) {
    const matchedDays = extractDaysFromText(entry.day);
    if (matchedDays.includes(day)) {
      return entry.time || undefined;
    }
  }
  return undefined;
}

/** Notes/frequency string for a specific weekday within a schedule list. */
export function getNotesForDayOnSchedule(
  schedules: ScheduleEntry[],
  day: string
): string | undefined {
  for (const entry of schedules) {
    const matchedDays = extractDaysFromText(entry.day);
    if (matchedDays.includes(day)) {
      return entry.notes?.trim() || undefined;
    }
  }
  return undefined;
}

/**
 * Convert a free-text time string (e.g. "9:00 AM", "11:30 AM - 1:00 PM", "noon")
 * to minutes-since-midnight for sorting. Returns Infinity for unparseable times
 * so they sort to the end. Uses only the FIRST time when a range is given.
 */
export function timeStringToMinutes(time: string | undefined | null): number {
  if (!time) return Number.POSITIVE_INFINITY;
  const trimmed = time.trim().toLowerCase();
  if (!trimmed) return Number.POSITIVE_INFINITY;

  // Quick keyword cases.
  if (/^noon\b/.test(trimmed)) return 12 * 60;
  if (/^midnight\b/.test(trimmed)) return 0;

  // Match HH or HH:MM, optionally followed by am/pm. Use the first occurrence.
  const match = trimmed.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return Number.POSITIVE_INFINITY;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3];

  if (Number.isNaN(hours) || hours > 23 || hours < 0) return Number.POSITIVE_INFINITY;
  if (Number.isNaN(minutes) || minutes > 59 || minutes < 0) return Number.POSITIVE_INFINITY;

  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

/** Build schedule array from day chip selection + time (table inline edit). */
export function buildScheduleFromDaysAndTime(
  days: string[],
  time: string
): ScheduleEntry[] {
  const sortedDays = [...days].sort(
    (a, b) =>
      WEEK_DAYS.indexOf(a as (typeof WEEK_DAYS)[number]) -
      WEEK_DAYS.indexOf(b as (typeof WEEK_DAYS)[number])
  );
  if (sortedDays.length === 0 && !time.trim()) return [];
  return [{ day: sortedDays.join(', '), time: time.trim() }];
}

/** Parse existing schedules into selected weekdays + shared time for inline editor. */
export function parseScheduleForInlineEdit(schedules: ScheduleEntry[]): {
  days: string[];
  time: string;
} {
  const days = new Set<string>();
  let time = '';
  for (const entry of schedules) {
    for (const d of extractDaysFromText(entry.day)) days.add(d);
    if (!time && entry.time) time = entry.time;
  }
  const sorted = WEEK_DAYS.filter((d) => days.has(d));
  return { days: sorted, time };
}
