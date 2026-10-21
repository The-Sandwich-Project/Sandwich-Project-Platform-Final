/**
 * Event ↔ Collection Log matching
 *
 * The collections log (sandwich_collections) is the single source of truth for
 * sandwich counts. Event requests don't record an actual count; instead admins
 * link the collection-log groups that came from an event (event_collection_links).
 *
 * One collection entry often lists several groups, each of which may have had
 * its own event request, so links are per group. A link with groupIndex -1
 * covers the whole entry (the host is the organization). Older links stored in
 * sandwich_collections.eventRequestId are read as whole-entry links.
 *
 * This module suggests likely entries for an event (dated the event day or the
 * day after, with a group or host name resembling the organization), pre-picks
 * the groups that look like the event, and totals what's linked.
 *
 * Pure functions only — no DB access — so the rules are easy to test.
 */

import {
  calculateSimilarity,
  canonicalizeOrgName,
  organizationNamesMatch,
} from '../utils/organization-canonicalization';
import { APP_TIMEZONE } from '@shared/date-utils';

/** Minimum name similarity for a collection entry to be suggested. */
export const MATCH_THRESHOLD = 0.75;

/** groupIndex value meaning "the whole entry". */
export const WHOLE_ENTRY = -1;

/** Score treated as an exact name match (identical after canonicalization). */
const EXACT_SCORE = 0.99;

/**
 * When no group matches exactly, groups scoring within this margin of the best
 * one are pre-picked together (e.g. an org split across two department lines).
 */
const NEAR_TIE_MARGIN = 0.05;

export interface CollectionGroup {
  index: number;
  name: string;
  department?: string;
  count: number;
}

/** The subset of a sandwich_collections row this module reads. */
export interface CollectionLike {
  id: number;
  collectionDate: string;
  hostName: string;
  individualSandwiches: number | null;
  groupCollections: unknown;
  group1Name?: string | null;
  group1Count?: number | null;
  group2Name?: string | null;
  group2Count?: number | null;
  eventRequestId?: number | null;
}

/** The subset of an event_collection_links row this module reads. */
export interface LinkLike {
  eventRequestId: number;
  collectionId: number;
  groupIndex: number;
  groupName: string | null;
}

/**
 * Read an entry's groups, preferring the groupCollections JSONB array and
 * falling back to the legacy group1/group2 columns (same priority as
 * client/src/lib/analytics-utils.ts calculateGroupSandwiches).
 */
export function getCollectionGroups(collection: CollectionLike): CollectionGroup[] {
  let raw: unknown = collection.groupCollections;
  if (typeof raw === 'string' && raw !== '' && raw !== '[]') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }

  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((g: any, index) => ({
      index,
      name: String(g?.name ?? ''),
      department: g?.department ? String(g.department) : undefined,
      count: Number(g?.count || g?.sandwichCount || 0),
    }));
  }

  const legacy: CollectionGroup[] = [];
  if (collection.group1Name || collection.group1Count) {
    legacy.push({ index: legacy.length, name: collection.group1Name || '', count: Number(collection.group1Count || 0) });
  }
  if (collection.group2Name || collection.group2Count) {
    legacy.push({ index: legacy.length, name: collection.group2Name || '', count: Number(collection.group2Count || 0) });
  }
  return legacy;
}

/** Whole entry: individual + all groups (the project-wide formula). */
export function getEntryTotal(collection: CollectionLike): number {
  const groupTotal = getCollectionGroups(collection).reduce((sum, g) => sum + g.count, 0);
  return (collection.individualSandwiches || 0) + groupTotal;
}

/** Similarity between an organization and a collection name, 0–1. */
export function nameScore(organizationName: string, candidate: string): number {
  if (!organizationName || !candidate) return 0;
  const similarity = calculateSimilarity(organizationName, candidate);
  // organizationNamesMatch accepts substring matches calculateSimilarity
  // scores lower (e.g. "Allied World" inside a much longer name).
  return organizationNamesMatch(organizationName, candidate)
    ? Math.max(similarity, 0.85)
    : similarity;
}

export interface GroupSuggestion {
  /** Best name similarity between the organization and this entry (0–1). */
  score: number;
  /** Groups that look like this event, to pre-tick. */
  suggestedGroupIndexes: number[];
  /** Pre-pick the whole entry instead (the host is the organization). */
  suggestWholeEntry: boolean;
}

/**
 * Score an entry against an organization and pre-pick the groups that look
 * like the event. Passing the suggestion threshold isn't enough on its own:
 * "Girl Scout Troop 456" clears it for "Girl Scout Troop 123", so exact matches
 * win outright and otherwise only the best-scoring group(s) are picked.
 */
export function suggestGroups(collection: CollectionLike, organizationName: string): GroupSuggestion {
  const groups = getCollectionGroups(collection);
  const groupScores = groups.map((g) => nameScore(organizationName, g.name));
  const hostScore = nameScore(organizationName, collection.hostName);
  const bestGroupScore = Math.max(0, ...groupScores);
  const score = Math.max(hostScore, bestGroupScore);

  const exact = groups.filter((_, i) => groupScores[i] >= EXACT_SCORE);
  const picked =
    exact.length > 0
      ? exact
      : groups.filter(
          (_, i) =>
            groupScores[i] >= MATCH_THRESHOLD &&
            groupScores[i] >= bestGroupScore - NEAR_TIE_MARGIN
        );

  if (picked.length > 0) {
    return { score, suggestedGroupIndexes: picked.map((g) => g.index), suggestWholeEntry: false };
  }
  if (hostScore >= MATCH_THRESHOLD || groups.length === 0) {
    return { score, suggestedGroupIndexes: [], suggestWholeEntry: true };
  }
  if (groups.length === 1) {
    return { score, suggestedGroupIndexes: [groups[0].index], suggestWholeEntry: false };
  }
  return { score, suggestedGroupIndexes: [], suggestWholeEntry: false };
}

/**
 * Find the group a link points at. The index is trusted while the name still
 * matches the snapshot; if the entry was edited and reordered, fall back to a
 * unique name match. Returns null when the group can't be found any more.
 */
export function resolveLinkedGroup(
  groups: CollectionGroup[],
  link: Pick<LinkLike, 'groupIndex' | 'groupName'>
): CollectionGroup | null {
  const byIndex = groups.find((g) => g.index === link.groupIndex);
  if (!link.groupName) return byIndex ?? null;

  const snapshot = canonicalizeOrgName(link.groupName);
  if (byIndex && canonicalizeOrgName(byIndex.name) === snapshot) return byIndex;

  const byName = groups.filter((g) => canonicalizeOrgName(g.name) === snapshot);
  return byName.length === 1 ? byName[0] : null;
}

export interface LinkedCount {
  count: number;
  countedGroupNames: string[];
  wholeEntry: boolean;
  /** A linked group can no longer be found in the entry (edited since linking). */
  hasMissingGroup: boolean;
}

/** Sandwiches an event gets from one entry, given that event's links to it. */
export function countForLinks(collection: CollectionLike, links: LinkLike[]): LinkedCount {
  if (links.some((l) => l.groupIndex === WHOLE_ENTRY)) {
    return { count: getEntryTotal(collection), countedGroupNames: [], wholeEntry: true, hasMissingGroup: false };
  }
  const groups = getCollectionGroups(collection);
  let count = 0;
  let hasMissingGroup = false;
  const countedGroupNames: string[] = [];
  for (const link of links) {
    const group = resolveLinkedGroup(groups, link);
    if (group) {
      count += group.count;
      countedGroupNames.push(group.name);
    } else {
      hasMissingGroup = true;
    }
  }
  return { count, countedGroupNames, wholeEntry: false, hasMissingGroup };
}

/**
 * All links on an entry, with an older sandwich_collections.eventRequestId
 * link folded in as a whole-entry link when the table has none for the entry.
 */
export function effectiveLinks(collection: CollectionLike, tableLinks: LinkLike[]): LinkLike[] {
  if (tableLinks.length === 0 && collection.eventRequestId) {
    return [{
      eventRequestId: collection.eventRequestId,
      collectionId: collection.id,
      groupIndex: WHOLE_ENTRY,
      groupName: null,
    }];
  }
  return tableLinks;
}

/** One entry as the Collection Log dialog sees it, relative to one event. */
export interface EntryView extends GroupSuggestion, LinkedCount {
  collectionId: number;
  collectionDate: string;
  hostName: string;
  individualSandwiches: number;
  entryTotal: number;
  /** Each group, with the event it's linked to (if any). */
  groups: Array<CollectionGroup & { linkedEventId: number | null }>;
  /** Event the whole entry is linked to, if any. */
  wholeEntryLinkedEventId: number | null;
  /** This event's current picks on the entry. */
  linkedGroupIndexes: number[];
  /** True when the entry is linked to this event by the old whole-entry column. */
  legacyLink: boolean;
}

export function describeEntry(
  collection: CollectionLike,
  organizationName: string,
  tableLinks: LinkLike[],
  eventId: number
): EntryView {
  const links = effectiveLinks(collection, tableLinks);
  const groups = getCollectionGroups(collection);
  const mine = links.filter((l) => l.eventRequestId === eventId);
  const whole = links.find((l) => l.groupIndex === WHOLE_ENTRY);

  const linkedEventByIndex = new Map<number, number>();
  for (const link of links) {
    if (link.groupIndex === WHOLE_ENTRY) continue;
    const group = resolveLinkedGroup(groups, link);
    if (group) linkedEventByIndex.set(group.index, link.eventRequestId);
  }

  const mineResolved = mine
    .filter((l) => l.groupIndex !== WHOLE_ENTRY)
    .map((l) => resolveLinkedGroup(groups, l))
    .filter((g): g is CollectionGroup => !!g)
    .map((g) => g.index);

  return {
    collectionId: collection.id,
    collectionDate: collection.collectionDate,
    hostName: collection.hostName,
    individualSandwiches: collection.individualSandwiches || 0,
    entryTotal: getEntryTotal(collection),
    groups: groups.map((g) => ({ ...g, linkedEventId: linkedEventByIndex.get(g.index) ?? null })),
    wholeEntryLinkedEventId: whole?.eventRequestId ?? null,
    linkedGroupIndexes: mineResolved,
    legacyLink: tableLinks.length === 0 && collection.eventRequestId === eventId,
    ...suggestGroups(collection, organizationName),
    ...countForLinks(collection, mine),
  };
}

/** Whether an entry still has something this event could link. */
function hasLinkableRoom(view: EntryView, eventId: number): boolean {
  if (view.wholeEntryLinkedEventId !== null) return false;
  if (view.suggestWholeEntry) return view.groups.every((g) => g.linkedEventId === null || g.linkedEventId === eventId);
  return view.groups.some((g) => g.linkedEventId === null);
}

/**
 * Rank candidate entries for an event: keep those whose name resembles the
 * organization and that aren't already linked to it, best match first.
 */
export function rankSuggestions(
  candidates: CollectionLike[],
  linksByCollection: Map<number, LinkLike[]>,
  organizationName: string,
  eventId: number
): EntryView[] {
  return candidates
    .map((c) => describeEntry(c, organizationName, linksByCollection.get(c.id) ?? [], eventId))
    .filter(
      (v) =>
        v.score >= MATCH_THRESHOLD &&
        v.linkedGroupIndexes.length === 0 &&
        v.wholeEntryLinkedEventId !== eventId &&
        hasLinkableRoom(v, eventId)
    )
    .sort((a, b) => b.score - a.score || a.collectionDate.localeCompare(b.collectionDate));
}

function addDays(dateString: string, days: number): string {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Collection dates (YYYY-MM-DD, inclusive) to search for an event's entries:
 * the event day and the day after.
 *
 * Event dates are timestamps, and depending on how they were entered they can
 * land on a different calendar day in UTC than in Eastern time. Both readings
 * are covered so a date stored as UTC midnight doesn't miss its own day.
 */
export function getCollectionDateWindow(
  eventDate: Date | string | null | undefined
): { start: string; end: string } | null {
  if (!eventDate) return null;
  const d = eventDate instanceof Date ? eventDate : new Date(eventDate);
  if (isNaN(d.getTime())) return null;

  const utcDay = d.toISOString().slice(0, 10);
  const easternDay = d.toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE });
  const [first, last] = [utcDay, easternDay].sort();
  return { start: first, end: addDays(last, 1) };
}
