import { parseSandwichTypes } from '@/lib/sandwich-utils';
import { determineSandwichMode } from '../form-utils';

/**
 * Open/save logic for the inline sandwich-estimate editor on scheduled cards,
 * shared by every tab that renders that card (Scheduled, My Assignments), so
 * each one opens the editor the same way and sends the same update.
 *
 * The server's shared estimate rule (shared/sandwich-estimate.ts) reconciles
 * the count, range, range type and breakdown on save.
 */

export type InlineSandwichMode = 'total' | 'range' | 'types';

export interface InlineSandwichState {
  mode: InlineSandwichMode;
  totalCount: number;
  types: Array<{ type: string; quantity: number }>;
  rangeMin: number;
  rangeMax: number;
  rangeType: string;
}

/** The editor's starting state for an event: same mode choice as the full form. */
export function inlineSandwichStateFromEvent(event: any): InlineSandwichState {
  const types = parseSandwichTypes(event?.sandwichTypes) || [];
  const mode = determineSandwichMode(
    event?.sandwichTypes,
    event?.estimatedSandwichCountMin,
    event?.estimatedSandwichCountMax,
    event?.estimatedSandwichCount,
  );
  const inRange = mode === 'range';
  return {
    mode,
    totalCount: event?.estimatedSandwichCount || 0,
    types: mode === 'types' ? types : [],
    // Always set (never left from the previous event edited).
    rangeMin: inRange ? event?.estimatedSandwichCountMin || 0 : 0,
    rangeMax: inRange ? event?.estimatedSandwichCountMax || 0 : 0,
    rangeType: inRange ? event?.estimatedSandwichRangeType || '' : '',
  };
}

/**
 * The PATCH body for the editor's current state. Each mode sends only what it
 * edits; the server's estimate rule keeps the rest. So saving the total never
 * deletes the event's types, and a breakdown with some amounts TBD never
 * replaces a known total.
 */
export function buildInlineSandwichPatch(state: InlineSandwichState): Record<string, unknown> {
  if (state.mode === 'total') {
    // An exact total: clear any range, keep the types (amounts that no longer
    // fit are dropped by the server rule).
    return {
      estimatedSandwichCount: state.totalCount > 0 ? state.totalCount : null,
      estimatedSandwichCountMin: null,
      estimatedSandwichCountMax: null,
    };
  }
  if (state.mode === 'range') {
    const patch: Record<string, unknown> = {
      // 0 means "not entered", not a bound of zero.
      estimatedSandwichCountMin: state.rangeMin > 0 ? state.rangeMin : null,
      estimatedSandwichCountMax: state.rangeMax > 0 ? state.rangeMax : null,
      estimatedSandwichCount: null,
    };
    // A picked range type IS the type (replacing whatever types were there);
    // no pick leaves the types alone.
    if (state.rangeType) {
      patch.estimatedSandwichRangeType = state.rangeType;
      patch.sandwichTypes = [{ type: state.rangeType }];
    }
    return patch;
  }
  // By type: send the lines only. Amounts left at 0 are "TBD"; the server keeps
  // the known total unless the amounts are all filled in.
  return { sandwichTypes: state.types.filter((t) => t.type) };
}

/** Default type for a newly added row: a value the type dropdown actually offers. */
export const DEFAULT_NEW_SANDWICH_TYPE = 'deli_turkey';
