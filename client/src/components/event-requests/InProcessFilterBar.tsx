/**
 * Filters + sort for the In Process tab.
 *
 * Day options start as fixed choices. Once a user saves their own reminder
 * settings (Profile → Alerts), each filter uses that user's day count instead,
 * so the filters line up with the reminders they get.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X } from 'lucide-react';
import type { CheckInReminderPreferences } from '@shared/types';
import {
  EMPTY_IN_PROCESS_FILTERS,
  FIXED_OPTIONS,
  hasActiveInProcessFilters,
  type InProcessFilters,
  type InProcessSort,
} from './lib/inProcessFilters';

interface InProcessFilterBarProps {
  filters: InProcessFilters;
  onChange: (next: InProcessFilters) => void;
  resultCount: number;
}

export function InProcessFilterBar({ filters, onChange, resultCount }: InProcessFilterBarProps) {
  const { data: prefs } = useQuery<CheckInReminderPreferences | null>({
    queryKey: ['/api/me/check-in-reminder-preferences'],
    queryFn: () => apiRequest('GET', '/api/me/check-in-reminder-preferences'),
    staleTime: 5 * 60 * 1000,
  });

  // Once the user has saved their own reminder settings, use their day counts.
  const own = (ruleType: string): number | null => {
    if (!prefs?.configured) return null;
    return prefs.rules.find((r) => r.ruleType === ruleType)?.thresholdDays ?? null;
  };
  const options = (ruleType: string, fixed: number[]) => {
    const mine = own(ruleType);
    return mine ? [mine] : fixed;
  };
  const noContactOptions = options('no_contact', FIXED_OPTIONS.noContact);
  const noUpdateOptions = options('stale_event', FIXED_OPTIONS.noUpdate);
  const dateWithinOptions = options('date_approaching_inprocess', FIXED_OPTIONS.dateWithin);
  const usingOwn = !!prefs?.configured;

  const set = (patch: Partial<InProcessFilters>) => onChange({ ...filters, ...patch });
  const toNum = (v: string) => (v === 'any' ? null : Number(v));
  const active = hasActiveInProcessFilters(filters);

  return (
    <div className="mb-4 rounded-lg border bg-white p-3" data-testid="in-process-filter-bar">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          value={filters.noContactDays === null ? 'any' : String(filters.noContactDays)}
          onValueChange={(v) => set({ noContactDays: toNum(v) })}
        >
          <SelectTrigger data-testid="filter-no-contact">
            <SelectValue placeholder="No contact in…" />
          </SelectTrigger>
          <SelectContent className="z-[100]" position="popper" sideOffset={5}>
            <SelectItem value="any">Any last contact</SelectItem>
            {noContactOptions.map((d) => (
              <SelectItem key={d} value={String(d)}>No contact in {d}+ days</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.noUpdateDays === null ? 'any' : String(filters.noUpdateDays)}
          onValueChange={(v) => set({ noUpdateDays: toNum(v) })}
        >
          <SelectTrigger data-testid="filter-no-update">
            <SelectValue placeholder="Not updated in…" />
          </SelectTrigger>
          <SelectContent className="z-[100]" position="popper" sideOffset={5}>
            <SelectItem value="any">Any last update</SelectItem>
            {noUpdateOptions.map((d) => (
              <SelectItem key={d} value={String(d)}>Not updated in {d}+ days</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.dateWithinDays === null ? 'any' : String(filters.dateWithinDays)}
          onValueChange={(v) => set({ dateWithinDays: toNum(v) })}
        >
          <SelectTrigger data-testid="filter-date-within">
            <SelectValue placeholder="Requested date within…" />
          </SelectTrigger>
          <SelectContent className="z-[100]" position="popper" sideOffset={5}>
            <SelectItem value="any">Any requested date</SelectItem>
            {dateWithinOptions.map((d) => (
              <SelectItem key={d} value={String(d)}>Requested date within {d} days</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.sort} onValueChange={(v) => set({ sort: v as InProcessSort })}>
          <SelectTrigger data-testid="sort-in-process">
            <SelectValue placeholder="Sort by…" />
          </SelectTrigger>
          <SelectContent className="z-[100]" position="popper" sideOffset={5}>
            <SelectItem value="default">Default order</SelectItem>
            <SelectItem value="event_date">Event date (soonest first)</SelectItem>
            <SelectItem value="last_contact">Last contact (longest ago first)</SelectItem>
            <SelectItem value="created">Request filed (oldest first)</SelectItem>
            <SelectItem value="updated">Last updated (longest ago first)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(active || usingOwn) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            {active && `${resultCount} matching event${resultCount === 1 ? '' : 's'}`}
            {active && usingOwn && ' · '}
            {usingOwn && 'Day options come from your reminder settings'}
          </span>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange(EMPTY_IN_PROCESS_FILTERS)}
              data-testid="button-clear-in-process-filters"
            >
              <X className="mr-1 h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
