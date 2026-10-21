/**
 * Event ↔ Collection Log matching
 *
 * The collections log (sandwich_collections) is the single source of truth for
 * sandwich counts. Event requests don't record an actual count; instead a
 * collection entry can be linked to the event via sandwich_collections.eventRequestId.
 *
 * Nothing sets that link automatically. This module finds likely matches
 * (collection entries dated on the event day or the day after, with a group or
 * host name that resembles the organization) so an admin can confirm them, and
 * works out how many sandwiches in a linked entry belong to the event.
 *
 * Pure functions only — no DB access — so the rules are easy to test.
 */

import {
  calculateSimilarity,
  organizationNamesMatch,
} from '../utils/organization-canonicalization';
import { APP_TIMEZONE } from '@shared/date-utils';

/** Minimum name similarity for a collection entry to be suggested. */
export const MATCH_THRESHOLD = 0.75;

/** Score treated as an exact name match (identical after canonicalization). */
const EXACT_SCORE = 0.99;

/**
 * When no group matches exactly, groups scoring within this margin of the best
 * one are counted together (e.g. an org split across two department lines).
 */
const NEAR_TIE_MARGIN = 0.05;

export interface CollectionGroup {
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

/**
 * How the event's share of a collection entry was determined:
 * - matched_groups: only the groups whose name matches the organization
 * - host: the entry's host is the organization, so the whole entry counts
 * - single_group: the entry has exactly one group, so it's assumed to be theirs
 * - all_groups: no name matched; every group is counted (may overcount)
 */
export type CountBasis = 'matched_groups' | 'host' | 'single_group' | 'all_groups';

export interface CollectionMatch {
  collectionId: number;
  collectionDate: string;
  hostName: string;
  /** Whole entry: individual + all groups (the project-wide formula). */
  entryTotal: number;
  groups: CollectionGroup[];
  /** Sandwiches in this entry attributed to the event. */
  eventCount: number;
  countBasis: CountBasis;
  /** Best name similarity between the organization and this entry (0–1). */
  score: number;
  matchedGroupNames: string[];
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
    return raw.map((g: any) => ({
      name: String(g?.name ?? ''),
      department: g?.department ? String(g.department) : undefined,
      count: Number(g?.count || g?.sandwichCount || 0),
    }));
  }

  const legacy: CollectionGroup[] = [];
  if (collection.group1Name || collection.group1Count) {
    legacy.push({ name: collection.group1Name || '', count: Number(collection.group1Count || 0) });
  }
  if (collection.group2Name || collection.group2Count) {
    legacy.push({ name: collection.group2Name || '', count: Number(collection.group2Count || 0) });
  }
  return legacy;
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

/** Score an entry against an organization and work out the event's share. */
export function matchCollection(
  collection: CollectionLike,
  organizationName: string
): CollectionMatch {
  const groups = getCollectionGroups(collection);
  const groupTotal = groups.reduce((sum, g) => sum + g.count, 0);
  const entryTotal = (collection.individualSandwiches || 0) + groupTotal;

  const groupScores = groups.map((g) => nameScore(organizationName, g.name));
  const hostScore = nameScore(organizationName, collection.hostName);
  const score = Math.max(hostScore, ...groupScores, 0);

  // Which groups count toward the event. Passing the suggestion threshold isn't
  // enough on its own: "Girl Scout Troop 456" clears it for "Girl Scout Troop
  // 123", so a shared entry would credit both troops to one event. Exact matches
  // win outright; otherwise only the best-scoring group(s) count.
  const bestGroupScore = Math.max(0, ...groupScores);
  const exactIdx = groupScores
    .map((score, i) => (score >= EXACT_SCORE ? i : -1))
    .filter((i) => i >= 0);
  const matched =
    exactIdx.length > 0
      ? exactIdx.map((i) => groups[i])
      : groups.filter(
          (_, i) =>
            groupScores[i] >= MATCH_THRESHOLD &&
            groupScores[i] >= bestGroupScore - NEAR_TIE_MARGIN
        );

  let eventCount: number;
  let countBasis: CountBasis;
  if (matched.length > 0) {
    eventCount = matched.reduce((sum, g) => sum + g.count, 0);
    countBasis = 'matched_groups';
  } else if (hostScore >= MATCH_THRESHOLD) {
    eventCount = entryTotal;
    countBasis = 'host';
  } else if (groups.length === 1) {
    eventCount = groups[0].count;
    countBasis = 'single_group';
  } else {
    eventCount = groupTotal;
    countBasis = 'all_groups';
  }

  return {
    collectionId: collection.id,
    collectionDate: collection.collectionDate,
    hostName: collection.hostName,
    entryTotal,
    groups,
    eventCount,
    countBasis,
    score,
    matchedGroupNames: matched.map((g) => g.name),
  };
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

/**
 * Rank candidate entries for an event: keep those whose name resembles the
 * organization, best match first.
 */
export function rankSuggestions(
  candidates: CollectionLike[],
  organizationName: string
): CollectionMatch[] {
  return candidates
    .map((c) => matchCollection(c, organizationName))
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.collectionDate.localeCompare(b.collectionDate));
}
