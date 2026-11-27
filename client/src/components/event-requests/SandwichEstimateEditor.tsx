/**
 * SandwichEstimateEditor - the one editor for an event's ESTIMATED sandwiches.
 *
 * Used by the full event form, the quick edit on Scheduled cards and the
 * spreadsheet view, so all of them work the same way. Two fixed rows, Deli
 * and PB&J: tick the types the group is making and give each a number, a
 * range (400-500) or nothing yet. While the split isn't fully known (no type
 * ticked, or a ticked type without an amount) a "Total, if known" box shows;
 * once every ticked type has an amount the total is worked out from them, so
 * the two can never disagree. Examples:
 *   Deli 400-500 + PB&J 100-150    -> "500–650 (400–500 Deli, 100–150 PB&J)"
 *   Deli + PB&J, total 300-400     -> "300–400, Deli & PB&J (split TBD)"
 *   Deli 150 + PB&J, total 300     -> "300 (150 Deli, PB&J TBD)"
 *   nothing ticked, total 250      -> "250, type TBD"
 *
 * The text is turned into stored fields by resolveDraft (shared/
 * sandwich-estimate.ts), the same rule the server applies, and the line under
 * the editor shows exactly how it will be saved. Older events tagged Turkey,
 * Ham or Chicken show in the Deli row.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  draftFromFields,
  draftFromTwoTypeState,
  resolveDraft,
  totalFromFields,
  totalIsTyped,
  twoTypeStateFromDraft,
  type DraftResult,
  type EstimateDraft,
  type EstimateFields,
  type TwoTypeState,
} from '@shared/sandwich-estimate';

export type { EstimateDraft };
export { draftFromFields, resolveDraft };

interface SandwichEstimateEditorProps {
  value: EstimateDraft;
  onChange: (next: EstimateDraft) => void;
  /** 'onDark' for the quick edit on a card's dark background. */
  tone?: 'light' | 'onDark';
  /** Prefix for input ids (several editors can be on one page). */
  idPrefix?: string;
}

const ROWS: Array<{ key: 'deli' | 'pbj'; label: string }> = [
  { key: 'deli', label: 'Deli' },
  { key: 'pbj', label: 'PB&J' },
];

export const SandwichEstimateEditor: React.FC<SandwichEstimateEditorProps> = ({
  value,
  onChange,
  tone = 'light',
  idPrefix = 'sandwich-estimate',
}) => {
  const state: TwoTypeState = React.useMemo(() => twoTypeStateFromDraft(value), [value]);
  const result: DraftResult = React.useMemo(() => resolveDraft(value), [value]);
  const onDark = tone === 'onDark';
  const labelClass = onDark ? 'text-white' : 'text-gray-900';
  const hintClass = onDark ? 'text-white/80' : 'text-[#236383]';
  const inputClass = 'bg-white text-gray-900';
  const typed = totalIsTyped(state);

  const update = (next: TwoTypeState) => onChange(draftFromTwoTypeState(next));
  const setRow = (key: 'deli' | 'pbj', patch: Partial<TwoTypeState['deli']>) =>
    update({ ...state, [key]: { ...state[key], ...patch } });

  // The worked-out total once every ticked type has an amount.
  const computed = result.errors.length === 0 ? totalFromFields(result.fields as any) : null;
  const computedTotal = computed ? (computed.min === computed.max ? `${computed.min}` : `${computed.min}–${computed.max}`) : '';

  return (
    <div className="space-y-3" data-testid={`${idPrefix}-editor`}>
      <Label className={labelClass}>Estimated sandwiches</Label>
      <div className="space-y-2">
        {ROWS.map(({ key, label }) => {
          const row = state[key];
          const id = `${idPrefix}-${key}`;
          return (
            <div key={key} className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-24">
                <Checkbox
                  id={`${id}-check`}
                  checked={row.checked}
                  onCheckedChange={(c) => setRow(key, { checked: c === true, ...(c === true ? {} : { amount: '' }) })}
                  className={onDark ? 'border-white data-[state=checked]:bg-white data-[state=checked]:text-[#236383]' : ''}
                  data-testid={`${id}-check`}
                />
                <Label htmlFor={`${id}-check`} className={`cursor-pointer ${labelClass}`}>
                  {label}
                </Label>
              </div>
              <Input
                id={`${id}-amount`}
                inputMode="numeric"
                value={row.amount}
                disabled={!row.checked}
                onChange={(e) => setRow(key, { amount: e.target.value })}
                placeholder={row.checked ? 'e.g. 400 or 400-500' : ''}
                aria-label={`${label} amount`}
                className={`w-44 ${inputClass}`}
                data-testid={`${id}-amount`}
              />
            </div>
          );
        })}
      </div>

      {typed ? (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-total`} className={labelClass}>
            Total, if known
          </Label>
          <Input
            id={`${idPrefix}-total`}
            inputMode="numeric"
            value={state.total}
            onChange={(e) => update({ ...state, total: e.target.value })}
            placeholder="e.g. 300 or 300-400"
            className={`w-44 ${inputClass}`}
            data-testid={`${idPrefix}-total`}
          />
          <p className={`text-xs ${hintClass}`}>
            For when the group knows roughly how many but not the split yet.
          </p>
        </div>
      ) : (
        <p className={`text-sm ${labelClass}`} data-testid={`${idPrefix}-computed-total`}>
          Total: <strong>{computedTotal || '—'}</strong>
        </p>
      )}

      <div className="text-sm space-y-1" aria-live="polite">
        {result.errors.map((e) => (
          <p key={e} className={onDark ? 'text-red-200' : 'text-red-700'}>
            {e}
          </p>
        ))}
        {result.errors.length === 0 && (
          <p className={labelClass}>
            Saves as: <strong data-testid={`${idPrefix}-preview`}>{result.preview || 'no estimate yet'}</strong>
          </p>
        )}
        {result.notes
          .filter((n) => !n.startsWith('Total worked out from the types'))
          .map((n) => (
            <p key={n} className={onDark ? 'text-amber-200 text-xs' : 'text-amber-700 text-xs'}>
              {n}
            </p>
          ))}
      </div>
    </div>
  );
};

/** The stored fields a draft saves as, or null while it has errors. */
export function estimateFieldsFromDraft(draft: EstimateDraft): EstimateFields | null {
  const r = resolveDraft(draft);
  return r.errors.length ? null : r.fields;
}

/**
 * Stored estimate fields as a PATCH/POST body. The type lines go as JSON text:
 * the request schema strips unknown keys from array entries, which would drop
 * a line's range (min/max); the text form is parsed without that.
 */
export function estimateRequestBody(fields: EstimateFields): Record<string, unknown> {
  return {
    estimatedSandwichCount: fields.estimatedSandwichCount,
    estimatedSandwichCountMin: fields.estimatedSandwichCountMin,
    estimatedSandwichCountMax: fields.estimatedSandwichCountMax,
    estimatedSandwichRangeType: fields.estimatedSandwichRangeType,
    sandwichTypes: fields.sandwichTypes ? JSON.stringify(fields.sandwichTypes) : null,
  };
}

interface CardSandwichEstimateEditProps {
  /** The event (its stored estimate fields are read). */
  request: Record<string, any>;
  saving?: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}

/** The quick edit on an event card: the shared editor plus Save / Cancel. */
export const CardSandwichEstimateEdit: React.FC<CardSandwichEstimateEditProps> = ({
  request,
  saving,
  onSave,
  onCancel,
}) => {
  const [draft, setDraft] = React.useState<EstimateDraft>(() => draftFromFields(request));
  const fields = estimateFieldsFromDraft(draft);
  return (
    <div className="rounded border border-amber-300 bg-amber-50/60 p-3 space-y-3">
      <SandwichEstimateEditor value={draft} onChange={setDraft} idPrefix={`card-${request.id}-sandwich`} />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving || !fields}
          onClick={() => fields && onSave(estimateRequestBody(fields))}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};
