/**
 * Van details in the edit form, under "Van driver needed?" (TSP's own van only;
 * not for DHL-van or self-transport events):
 *  - the van time of day (AM / Mid-day / PM / All day), worked out from the
 *    event times or set on the planning sheet;
 *  - a required reason when the estimate is under 800 (or there's none);
 *  - when another event that day already has the van: who, when and why,
 *    plus "Events team OK'd sharing the van". Until that's ticked the van
 *    shows as "Van pending – discuss with team".
 * Everything shows inline in the form (no popups). The warning never blocks
 * saving; only a missing under-800 reason does.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { totalFromFields } from '@shared/sandwich-estimate';
import {
  SAME_DAY_VAN_QUERY_KEY,
  VAN_REASON_THRESHOLD,
  describeVanEvent,
  effectiveVanTime,
  usesTspVan,
  vanConflicts,
  vanIsPending,
  vanReasonRequired,
  type SameDayVanEvent,
} from '@shared/van-rules';

/** The largest the form's sandwich estimate could be (a range's top), or null. */
export function formEstimateMax(formData: any): number | null {
  const est = totalFromFields({
    estimatedSandwichCount: formData.totalSandwichCount || null,
    estimatedSandwichCountMin: formData.estimatedSandwichCountMin || null,
    estimatedSandwichCountMax: formData.estimatedSandwichCountMax || null,
  } as any);
  return est?.max ?? null;
}

/** Whether the form can't be saved yet: the van needs an under-800 reason. */
export function vanReasonMissing(formData: any): boolean {
  return vanReasonRequired(formData, formEstimateMax(formData)) && !String(formData.vanReason ?? '').trim();
}

/**
 * Set the form's event date. "Events team OK'd sharing the van" was about the
 * conflict on the saved day, so a different day starts unticked (the panel
 * then shows that day's conflicts as pending); going back to the saved day
 * restores the saved OK. The server clears a saved OK on a date change too
 * (normalizeVanPatch).
 */
export function withEventDate<T extends { eventDate?: string; vanTeamOk?: boolean }>(
  prev: T,
  newDate: string,
  saved: { date: string; vanTeamOk: boolean } | null | undefined,
): T {
  if (newDate === prev.eventDate) return { ...prev, eventDate: newDate };
  const backToSavedDay = !!saved && newDate === saved.date;
  return { ...prev, eventDate: newDate, vanTeamOk: backToSavedDay ? saved!.vanTeamOk : false };
}

function dateOnly(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function useSameDayVanEvents(eventDate: unknown, eventRequestId: number | null | undefined, enabled: boolean) {
  const date = dateOnly(eventDate);
  return useQuery<{ otherEvents: SameDayVanEvent[] }>({
    queryKey: [SAME_DAY_VAN_QUERY_KEY, date, eventRequestId ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({ date: date! });
      if (eventRequestId) params.set('excludeEventId', String(eventRequestId));
      const res = await fetch(`/api/event-requests/van-requests-for-date?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch same-day van requests');
      return res.json();
    },
    enabled: enabled && !!date,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

interface VanDetailsPanelProps {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  eventRequestId?: number | null;
  /** The saved event: its planning-sheet time override applies while the times are unchanged. */
  storedEvent?: { vanTimeOverride?: string | null; eventStartTime?: string | null; eventEndTime?: string | null } | null;
  /** Show the "reason required" message (after a save attempt). */
  showReasonError?: boolean;
}

/**
 * The van time for the form: the sheet's override while the form's times
 * still match the saved ones (saving new times clears the override on the
 * server), otherwise worked out from the form's times.
 */
export function formVanTime(formData: any, storedEvent?: VanDetailsPanelProps['storedEvent']) {
  const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');
  const timesUnchanged =
    !!storedEvent && same(formData.eventStartTime, storedEvent.eventStartTime) && same(formData.eventEndTime, storedEvent.eventEndTime);
  return effectiveVanTime({
    vanTimeOverride: timesUnchanged ? storedEvent?.vanTimeOverride : null,
    eventStartTime: formData.eventStartTime,
    eventEndTime: formData.eventEndTime,
  });
}

export const VanDetailsPanel: React.FC<VanDetailsPanelProps> = ({ formData, setFormData, eventRequestId, storedEvent, showReasonError }) => {
  const active = usesTspVan(formData);
  const { data } = useSameDayVanEvents(formData.eventDate, eventRequestId, active);
  if (!active) return null;

  const time = formVanTime(formData, storedEvent);
  const reasonNeeded = vanReasonRequired(formData, formEstimateMax(formData));
  const conflicts = vanConflicts(data?.otherEvents);

  return (
    <div className="space-y-3" data-testid="van-details">
      <p className="text-sm text-gray-700 flex items-center gap-1" data-testid="van-time">
        <Clock className="w-4 h-4" aria-hidden="true" />
        Van time: <strong>{time.value || 'add event times to work it out'}</strong>
        {time.value && (
          <span className="text-xs text-gray-500">{time.fromSheet ? '(set on the planning sheet)' : '(from the event times)'}</span>
        )}
      </p>

      {reasonNeeded && (
        <div className="space-y-1">
          <Label htmlFor="vanReason">
            Why does this event need the van? <span className="text-red-600">*</span>
          </Label>
          <Input
            id="vanReason"
            value={formData.vanReason || ''}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, vanReason: e.target.value }))}
            placeholder="e.g. no fridge space on site"
            aria-invalid={showReasonError && !String(formData.vanReason ?? '').trim()}
            data-testid="input-van-reason"
          />
          <p className={`text-xs ${showReasonError && !String(formData.vanReason ?? '').trim() ? 'text-red-700' : 'text-gray-600'}`}>
            The van is for events of {VAN_REASON_THRESHOLD} sandwiches or more, so a smaller (or unknown) estimate needs a reason.
          </p>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-lg border-2 border-[#FBAD3F] bg-[#FEF3E2] p-3 space-y-2" data-testid="van-conflict">
          <p className="text-sm text-[#114145] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-[#D68319] shrink-0" aria-hidden="true" />
            <span>
              <strong>The van is already booked that day:</strong>{' '}
              {conflicts.map(describeVanEvent).join('; ')}.{' '}
              Talk to the events team before telling this group they can use the van.
            </span>
          </p>
          <label className="flex items-center gap-2 text-sm text-[#114145] cursor-pointer ml-6">
            <input
              type="checkbox"
              checked={formData.vanTeamOk === true}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, vanTeamOk: e.target.checked }))}
              data-testid="checkbox-van-team-ok"
            />
            Events team OK'd sharing the van
          </label>
          {vanIsPending(formData, data?.otherEvents) && (
            <p className="text-xs text-[#114145]/80 ml-6">Until this is ticked, the card shows "Van pending – discuss with team".</p>
          )}
        </div>
      )}
    </div>
  );
};
