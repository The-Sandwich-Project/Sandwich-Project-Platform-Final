/**
 * SandwichPlanningSection - estimated sandwiches in the full event form.
 *
 * Uses the shared SandwichEstimateEditor (the same editor as the quick edit
 * on event cards): one total box plus type rows with optional amounts. The
 * editor's text is resolved by the shared estimate rule and written back into
 * the form's estimate fields, so the form always holds consistent values and
 * buildEventDataForServer sends exactly what the editor previewed.
 */

import * as React from 'react';
import { Sandwich, CheckCircle2 } from 'lucide-react';
import type { FormSectionProps } from './types';
import {
  SandwichEstimateEditor,
  draftFromFields,
  resolveDraft,
  type EstimateDraft,
} from '../SandwichEstimateEditor';

interface SandwichPlanningSectionProps extends FormSectionProps {
  /** Kept for callers; the shared editor has no modes. */
  sandwichMode?: 'total' | 'range' | 'types';
  setSandwichMode?: React.Dispatch<React.SetStateAction<'total' | 'range' | 'types'>>;
  /** Whether section is complete (shows checkmark) */
  isComplete?: boolean;
}

/** The form's estimate fields in stored-field names. */
const fieldsOfForm = (f: SandwichPlanningSectionProps['formData']) => ({
  estimatedSandwichCount: f.totalSandwichCount || null,
  estimatedSandwichCountMin: f.estimatedSandwichCountMin || null,
  estimatedSandwichCountMax: f.estimatedSandwichCountMax || null,
  estimatedSandwichRangeType: f.rangeSandwichType || null,
  sandwichTypes: f.sandwichTypes,
});

export const SandwichPlanningSection: React.FC<SandwichPlanningSectionProps> = ({
  formData,
  setFormData,
  isComplete,
}) => {
  const [draft, setDraft] = React.useState<EstimateDraft>(() => draftFromFields(fieldsOfForm(formData)));

  // The form's fields can change from outside (a restored draft, a reload).
  // Re-read them unless they're simply what the editor already wrote.
  const formKey = JSON.stringify(resolveDraft(draftFromFields(fieldsOfForm(formData))).fields);
  const lastWritten = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (formKey !== lastWritten.current) {
      setDraft(draftFromFields(fieldsOfForm(formData)));
      lastWritten.current = formKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  const onChange = (next: EstimateDraft) => {
    setDraft(next);
    const r = resolveDraft(next);
    if (r.errors.length) {
      setFormData((prev) => ({ ...prev, sandwichEstimateError: r.errors[0] }));
      return;
    }
    const f = r.fields;
    lastWritten.current = JSON.stringify(f);
    setFormData((prev) => ({
      ...prev,
      sandwichEstimateError: undefined,
      totalSandwichCount: f.estimatedSandwichCount ?? 0,
      estimatedSandwichCountMin: f.estimatedSandwichCountMin ?? 0,
      estimatedSandwichCountMax: f.estimatedSandwichCountMax ?? 0,
      rangeSandwichType: f.estimatedSandwichRangeType ?? '',
      sandwichTypes: (f.sandwichTypes ?? []) as any,
    }));
  };

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-white">
      <div className="flex items-center gap-3 pb-2 border-b">
        <Sandwich className="w-5 h-5 text-[#236383]" />
        <span className="text-lg font-semibold text-[#236383]">Sandwich Planning</span>
        {isComplete && <CheckCircle2 className="w-4 h-4 text-green-600" />}
      </div>
      <SandwichEstimateEditor value={draft} onChange={onChange} idPrefix="form-sandwich-estimate" />
    </div>
  );
};
