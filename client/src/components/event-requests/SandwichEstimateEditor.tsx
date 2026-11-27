/**
 * SandwichEstimateEditor - the one editor for an event's ESTIMATED sandwiches.
 *
 * Used by the full event form and the quick edit on event cards, so both work
 * the same way. One total box (a number, a range like 200-300, or blank while
 * it isn't known) plus type rows, each with an optional amount. Every shape
 * the team uses fits:
 *   300 + PB&J                     -> "300 PB&J"
 *   200-300 + Turkey               -> "200–300 Turkey"
 *   Deli 100-150 + PB&J 200-250    -> total worked out: "300–400 (...)"
 *   300-400 + Deli + PB&J          -> "300–400, Deli & PB&J (split TBD)"
 *   250, no types                  -> "250, type TBD"
 *
 * The text is turned into stored fields by resolveDraft (shared/
 * sandwich-estimate.ts), the same rule the server applies, and the line under
 * the editor shows exactly how it will be saved.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, X } from 'lucide-react';
import {
  draftFromFields,
  resolveDraft,
  type DraftResult,
  type EstimateDraft,
  type EstimateFields,
} from '@shared/sandwich-estimate';
import { SANDWICH_TYPES } from './constants';

export type { EstimateDraft };
export { draftFromFields, resolveDraft };

/** Default type for a newly added row: one the dropdown offers. */
export const NEW_ROW_TYPE = 'deli_turkey';

const TYPE_OPTIONS = SANDWICH_TYPES.map((t) =>
  t.value === 'unknown' ? { value: t.value, label: 'Not decided' } : { value: t.value, label: t.label }
);

interface SandwichEstimateEditorProps {
  value: EstimateDraft;
  onChange: (next: EstimateDraft) => void;
  /** 'onDark' for the quick edit on a card's dark background. */
  tone?: 'light' | 'onDark';
  /** Prefix for input ids (several editors can be on one page). */
  idPrefix?: string;
}

export const SandwichEstimateEditor: React.FC<SandwichEstimateEditorProps> = ({
  value,
  onChange,
  tone = 'light',
  idPrefix = 'sandwich-estimate',
}) => {
  const result: DraftResult = React.useMemo(() => resolveDraft(value), [value]);
  const onDark = tone === 'onDark';
  const labelClass = onDark ? 'text-white' : 'text-gray-900';
  const hintClass = onDark ? 'text-white/80' : 'text-[#236383]';
  const inputClass = 'bg-white text-gray-900';

  const setTotal = (total: string) => onChange({ ...value, total });
  const setLine = (index: number, patch: Partial<{ type: string; amount: string }>) =>
    onChange({ ...value, lines: value.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const addLine = () => onChange({ ...value, lines: [...value.lines, { type: NEW_ROW_TYPE, amount: '' }] });
  const removeLine = (index: number) => onChange({ ...value, lines: value.lines.filter((_, i) => i !== index) });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-total`} className={labelClass}>
          Estimated sandwiches
        </Label>
        <Input
          id={`${idPrefix}-total`}
          inputMode="numeric"
          value={value.total}
          onChange={(e) => setTotal(e.target.value)}
          placeholder="e.g. 300 or 200-300"
          className={`w-48 ${inputClass}`}
        />
        <p className={`text-xs ${hintClass}`}>A number, a range, or blank if you only know the types.</p>
      </div>

      <div className="space-y-2">
        <Label className={labelClass}>Types</Label>
        {value.lines.length === 0 && (
          <p className={`text-xs ${hintClass}`}>No types yet (type TBD). Add one if you know it.</p>
        )}
        {value.lines.map((line, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select value={line.type} onValueChange={(type) => setLine(index, { type })}>
              <SelectTrigger className={`w-36 ${inputClass}`} aria-label={`Sandwich type ${index + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              inputMode="numeric"
              value={line.amount}
              onChange={(e) => setLine(index, { amount: e.target.value })}
              placeholder="amount (optional)"
              aria-label={`Amount for sandwich type ${index + 1}`}
              className={`w-36 ${inputClass}`}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => removeLine(index)}
              className={onDark ? 'text-white hover:bg-white/20' : ''}
              aria-label={`Remove sandwich type ${index + 1}`}
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={addLine}>
          <Plus className="w-3 h-3 mr-1" aria-hidden="true" /> Add type
        </Button>
        {value.lines.length > 1 && (
          <p className={`text-xs ${hintClass}`}>Leave an amount blank if the split isn't decided yet.</p>
        )}
      </div>

      <div className="text-sm space-y-1" aria-live="polite">
        {result.errors.map((e) => (
          <p key={e} className={onDark ? 'text-red-200' : 'text-red-700'}>
            {e}
          </p>
        ))}
        {result.errors.length === 0 && (
          <p className={labelClass}>
            Saves as: <strong>{result.preview || 'no estimate yet'}</strong>
          </p>
        )}
        {result.notes.map((n) => (
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
