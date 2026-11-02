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

/** The PATCH body for the editor's current state. */
export function buildInlineSandwichPatch(state: InlineSandwichState): Record<string, unknown> {
  if (state.mode === 'total') {
    return {
      estimatedSandwichCount: state.totalCount > 0 ? state.totalCount : null,
      sandwichTypes: null,
      estimatedSandwichCountMin: null,
      estimatedSandwichCountMax: null,
      estimatedSandwichRangeType: null,
    };
  }
  if (state.mode === 'range') {
    return {
      // 0 means "not entered", not a bound of zero.
      estimatedSandwichCountMin: state.rangeMin > 0 ? state.rangeMin : null,
      estimatedSandwichCountMax: state.rangeMax > 0 ? state.rangeMax : null,
      estimatedSandwichRangeType: state.rangeType || null,
      estimatedSandwichCount: null,
      sandwichTypes: null,
    };
  }
  const types = state.types.filter((t) => t.type);
  return {
    sandwichTypes: types,
    estimatedSandwichCount: types.reduce((sum, t) => sum + (Number(t.quantity) || 0), 0) || null,
    estimatedSandwichCountMin: null,
    estimatedSandwichCountMax: null,
    estimatedSandwichRangeType: null,
  };
}

/** Default type for a newly added row: a value the type dropdown actually offers. */
export const DEFAULT_NEW_SANDWICH_TYPE = 'deli_turkey';
