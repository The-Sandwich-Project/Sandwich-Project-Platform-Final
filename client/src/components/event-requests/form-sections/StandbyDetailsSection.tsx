/**
 * StandbyDetailsSection
 *
 * Shown right in the edit form (not in a popup) whenever the status is
 * Standby: what the group is waiting on, plus when to check back. It replaced
 * a popup that opened on top of the form and kept ending up hidden behind it.
 *
 * The server also sets a check-back date a week out on ANY move into Standby
 * that doesn't choose one, so the reminder can't be skipped by another route.
 */
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Hourglass } from 'lucide-react';
import type { EventFormData } from './types';

export const STANDBY_REASONS = ['Budget', 'Date/time', 'Volunteers', '# of sandwiches', 'Other'] as const;

export type StandbyCheckBackMode = 'one_week' | 'specific' | 'none';

interface StandbyDetailsSectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  checkBackMode: StandbyCheckBackMode;
  setCheckBackMode: (mode: StandbyCheckBackMode) => void;
  checkBackDate: string;
  setCheckBackDate: (date: string) => void;
  /** Show the "pick a reason" / "pick a date" hints after a save attempt. */
  showReasonError: boolean;
}

/** YYYY-MM-DD for today + days, in the viewer's timezone. */
export function datePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The check-back date to save for a mode ('' = no reminder). */
export function standbyCheckBackValue(mode: StandbyCheckBackMode, specificDate: string): string {
  if (mode === 'none') return '';
  if (mode === 'one_week') return datePlusDays(7);
  return specificDate;
}

/**
 * A check-back choice is complete unless it's "on a specific date" with no
 * date: only "No reminder" may turn the reminder off.
 */
export function isStandbyCheckBackComplete(mode: StandbyCheckBackMode, specificDate: string): boolean {
  return mode !== 'specific' || /^\d{4}-\d{2}-\d{2}$/.test(specificDate.trim());
}

/** A reason is required; "Other" also needs a note. */
export function isStandbyReasonComplete(reason: string, notes: string): boolean {
  if (!reason) return false;
  if (reason === 'Other') return notes.trim().length > 0;
  return true;
}

export const StandbyDetailsSection: React.FC<StandbyDetailsSectionProps> = ({
  formData,
  setFormData,
  checkBackMode,
  setCheckBackMode,
  checkBackDate,
  setCheckBackDate,
  showReasonError,
}) => {
  const reason = formData.standbyReason || '';
  const notes = formData.standbyNotes || '';
  const reasonMissing = showReasonError && !isStandbyReasonComplete(reason, notes);

  return (
    <div
      className="rounded-lg border-2 border-[#FBAD3F] bg-[#FEF3E2] p-4 space-y-4"
      data-testid="standby-details"
    >
      <div className="flex items-center gap-2 text-[#114145]">
        <Hourglass className="h-4 w-4" />
        <span className="font-semibold">Standby details</span>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-[#114145]">
          What are we waiting on? <span className="text-red-600">*</span>
        </Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What are we waiting on?">
          {STANDBY_REASONS.map((r) => (
            <Button
              key={r}
              type="button"
              size="sm"
              role="radio"
              aria-checked={reason === r}
              variant={reason === r ? 'default' : 'outline'}
              className={reason === r ? 'bg-[#236383] hover:bg-[#1d5270]' : 'bg-white'}
              onClick={() => setFormData((prev: any) => ({ ...prev, standbyReason: r }))}
              data-testid={`standby-reason-${r}`}
            >
              {r}
            </Button>
          ))}
        </div>
        <Input
          value={notes}
          onChange={(e) => setFormData((prev: any) => ({ ...prev, standbyNotes: e.target.value }))}
          placeholder={
            reason === 'Other'
              ? 'What are they waiting on? (required)'
              : 'Details (optional), e.g. "waiting on PTA budget vote Dec 10"'
          }
          className="bg-white"
          data-testid="standby-notes"
        />
        {reasonMissing && (
          <p className="text-sm text-red-600" data-testid="standby-reason-error">
            {reason === 'Other' ? 'Add a note saying what they are waiting on.' : 'Pick what the group is waiting on.'}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-[#114145]">Check back on</Label>
        <div className="space-y-2" role="radiogroup" aria-label="Check back on">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="standbyCheckBack"
              checked={checkBackMode === 'one_week'}
              onChange={() => setCheckBackMode('one_week')}
              data-testid="standby-checkback-week"
            />
            In one week ({datePlusDays(7)})
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="standbyCheckBack"
              checked={checkBackMode === 'specific'}
              onChange={() => {
                setCheckBackMode('specific');
                if (!checkBackDate) setCheckBackDate(datePlusDays(7));
              }}
              data-testid="standby-checkback-specific"
            />
            On a specific date
          </label>
          {checkBackMode === 'specific' && (
            <>
              <Input
                type="date"
                value={checkBackDate}
                min={datePlusDays(0)}
                onChange={(e) => setCheckBackDate(e.target.value)}
                className="ml-6 w-48 bg-white"
                data-testid="standby-checkback-date"
              />
              {showReasonError && !isStandbyCheckBackComplete(checkBackMode, checkBackDate) && (
                <p className="ml-6 text-sm text-red-600" data-testid="standby-checkback-error">
                  Pick a date, or choose "No reminder".
                </p>
              )}
            </>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="standbyCheckBack"
              checked={checkBackMode === 'none'}
              onChange={() => setCheckBackMode('none')}
              data-testid="standby-checkback-none"
            />
            No reminder
          </label>
        </div>
        <p className="text-xs text-[#114145]/80">
          The TSP contact gets an email reminder on the check-back date.
        </p>
      </div>
    </div>
  );
};
