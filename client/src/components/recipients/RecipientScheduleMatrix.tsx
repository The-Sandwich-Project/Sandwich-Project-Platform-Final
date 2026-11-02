/**
 * Schedule Matrix view for recipients.
 *
 * The data is fundamentally a grid of organizations × weekdays — not a
 * calendar of events. This view renders that grid directly: each row is a
 * recipient, each column is a weekday, each cell shows whether that recipient
 * does a collection (C, teal) or feeding (F, amber) on that day. A compact
 * day-strip summary at the top gives at-a-glance counts per day.
 *
 * Above the matrix, a focused-lookup mode lets the user pick a schedule type
 * (Collection or Feeding) and a specific day to see an ordered (by time) list
 * of just the orgs that match — answering "who feeds on Friday?" directly.
 *
 * Same brand language as the existing weekly-calendar view:
 *   - Teal = collection / pickup
 *   - Amber = feeding / distribution
 */
import { useMemo, useState } from 'react';
import { Truck, UtensilsCrossed, Clock, Info, Search } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Recipient } from '@shared/schema';
import {
  WEEK_DAYS,
  DAY_ABBREV,
  getRecipientCollectionDays,
  getRecipientFeedingDays,
  getCollectionSchedules,
  getFeedingSchedules,
  getTimeForDayOnSchedule,
  getNotesForDayOnSchedule,
  timeStringToMinutes,
} from './recipient-schedule-utils';

interface RecipientScheduleMatrixProps {
  recipients: Recipient[];
  onRecipientClick: (recipient: Recipient) => void;
}

type CellInfo = {
  collects: boolean;
  feeds: boolean;
  collectTime: string | null;
  feedTime: string | null;
  collectNote: string | null;
  feedNote: string | null;
};

type ScheduleType = 'collection' | 'feeding';
type FilterDay = (typeof WEEK_DAYS)[number] | 'any';

function buildMatrix(recipients: Recipient[]) {
  const rows = recipients.map((r) => {
    const collectionDays = new Set(getRecipientCollectionDays(r));
    const feedingDays = new Set(getRecipientFeedingDays(r));
    const collectionSchedules = getCollectionSchedules(r);
    const feedingSchedules = getFeedingSchedules(r);

    const cells: Record<string, CellInfo> = {};
    for (const day of WEEK_DAYS) {
      const collects = collectionDays.has(day);
      const feeds = feedingDays.has(day);
      cells[day] = {
        collects,
        feeds,
        collectTime: collects ? getTimeForDayOnSchedule(collectionSchedules, day) ?? null : null,
        feedTime: feeds ? getTimeForDayOnSchedule(feedingSchedules, day) ?? null : null,
        collectNote: collects ? getNotesForDayOnSchedule(collectionSchedules, day) ?? null : null,
        feedNote: feeds ? getNotesForDayOnSchedule(feedingSchedules, day) ?? null : null,
      };
    }
    return { recipient: r, cells };
  });

  const totals: Record<string, { collects: number; feeds: number }> = {};
  for (const day of WEEK_DAYS) {
    totals[day] = { collects: 0, feeds: 0 };
  }
  for (const row of rows) {
    for (const day of WEEK_DAYS) {
      if (row.cells[day].collects) totals[day].collects += 1;
      if (row.cells[day].feeds) totals[day].feeds += 1;
    }
  }

  return { rows, totals };
}

function MatrixCell({ info }: { info: CellInfo }) {
  if (!info.collects && !info.feeds) {
    return (
      <span className="text-slate-300 text-sm" aria-label="No activity">
        —
      </span>
    );
  }

  const lines: string[] = [];
  if (info.collects) {
    const t = info.collectTime ? ` · ${info.collectTime}` : '';
    const n = info.collectNote ? ` · ${info.collectNote}` : '';
    lines.push(`Collection${t}${n}`);
  }
  if (info.feeds) {
    const t = info.feedTime ? ` · ${info.feedTime}` : '';
    const n = info.feedNote ? ` · ${info.feedNote}` : '';
    lines.push(`Feeding${t}${n}`);
  }

  const collectHasNote = !!info.collectNote;
  const feedHasNote = !!info.feedNote;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex flex-wrap items-center justify-center gap-1">
          {info.collects && (
            <span
              className="relative inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold bg-[#236383] text-white"
              aria-label="Collection day"
            >
              C
              {collectHasNote && (
                <span
                  aria-label="Has frequency note"
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white border border-[#236383]"
                />
              )}
            </span>
          )}
          {info.feeds && (
            <span
              className="relative inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold bg-[#FBAD3F] text-white"
              aria-label="Feeding day"
            >
              F
              {feedHasNote && (
                <span
                  aria-label="Has frequency note"
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white border border-[#B8860B]"
                />
              )}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-sm">
        {lines.map((line) => (
          <div key={line} className="font-medium">{line}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function DayStripSummary({
  totals,
}: {
  totals: Record<string, { collects: number; feeds: number }>;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {WEEK_DAYS.map((day) => {
        const t = totals[day];
        const total = t.collects + t.feeds;
        return (
          <div
            key={day}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 flex flex-col"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">
                {DAY_ABBREV[day]}
              </span>
              <span className="text-xs text-slate-400 tabular-nums">{total}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="flex items-center gap-1 text-[#236383]">
                <Truck className="w-3 h-3" />
                <span className="tabular-nums font-semibold">{t.collects}</span>
              </span>
              <span className="flex items-center gap-1 text-[#B8860B]">
                <UtensilsCrossed className="w-3 h-3" />
                <span className="tabular-nums font-semibold">{t.feeds}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Build the filtered, time-sorted list when the user picks a type + day. */
function getFilteredList(
  recipients: Recipient[],
  scheduleType: ScheduleType,
  day: (typeof WEEK_DAYS)[number]
) {
  const entries = recipients
    .map((r) => {
      const dayList =
        scheduleType === 'collection'
          ? getRecipientCollectionDays(r)
          : getRecipientFeedingDays(r);
      if (!dayList.includes(day)) return null;
      const schedules =
        scheduleType === 'collection'
          ? getCollectionSchedules(r)
          : getFeedingSchedules(r);
      return {
        recipient: r,
        time: getTimeForDayOnSchedule(schedules, day) ?? null,
        notes: getNotesForDayOnSchedule(schedules, day) ?? null,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  entries.sort((a, b) => {
    const ta = timeStringToMinutes(a.time ?? undefined);
    const tb = timeStringToMinutes(b.time ?? undefined);
    if (ta !== tb) return ta - tb;
    return (a.recipient.name || '').localeCompare(b.recipient.name || '');
  });

  return entries;
}

function FilterBar({
  scheduleType,
  setScheduleType,
  day,
  setDay,
  totals,
}: {
  scheduleType: ScheduleType;
  setScheduleType: (t: ScheduleType) => void;
  day: FilterDay;
  setDay: (d: FilterDay) => void;
  totals: Record<string, { collects: number; feeds: number }>;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Search className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-slate-700">Who</span>
        {/* Type toggle */}
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setScheduleType('collection')}
            aria-pressed={scheduleType === 'collection'}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              scheduleType === 'collection'
                ? 'bg-[#236383] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            collects
          </button>
          <button
            type="button"
            onClick={() => setScheduleType('feeding')}
            aria-pressed={scheduleType === 'feeding'}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              scheduleType === 'feeding'
                ? 'bg-[#FBAD3F] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <UtensilsCrossed className="w-3.5 h-3.5" />
            feeds
          </button>
        </div>
        <span className="font-semibold text-slate-700">on</span>
        {/* Day pills */}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setDay('any')}
            aria-pressed={day === 'any'}
            className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
              day === 'any'
                ? 'bg-slate-700 text-white border-slate-700'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            any day
          </button>
          {WEEK_DAYS.map((d) => {
            const count =
              scheduleType === 'collection' ? totals[d].collects : totals[d].feeds;
            const active = day === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                aria-pressed={active}
                className={`px-2 py-1 rounded text-xs font-medium border transition-colors flex items-center gap-1 ${
                  active
                    ? scheduleType === 'collection'
                      ? 'bg-[#236383] text-white border-[#236383]'
                      : 'bg-[#FBAD3F] text-white border-[#FBAD3F]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span>{DAY_ABBREV[d]}</span>
                <span
                  className={`text-[10px] tabular-nums ${
                    active ? 'text-white/90' : 'text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500 pl-6">
        Pick a day to see just the orgs that {scheduleType === 'collection' ? 'we pick up from' : 'distribute that day'}, sorted by time.
      </p>
    </div>
  );
}

function FilteredList({
  scheduleType,
  day,
  entries,
  onRecipientClick,
}: {
  scheduleType: ScheduleType;
  day: (typeof WEEK_DAYS)[number];
  entries: ReturnType<typeof getFilteredList>;
  onRecipientClick: (recipient: Recipient) => void;
}) {
  const accent =
    scheduleType === 'collection'
      ? 'border-[#236383]/30 bg-[#236383]/5'
      : 'border-[#FBAD3F]/40 bg-[#FBAD3F]/5';
  const tag =
    scheduleType === 'collection'
      ? { bg: 'bg-[#236383]', text: 'text-[#236383]', label: 'Collection' }
      : { bg: 'bg-[#FBAD3F]', text: 'text-[#B8860B]', label: 'Feeding' };

  return (
    <div className={`rounded-lg border ${accent} overflow-hidden`}>
      <div className="px-3 py-2 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold text-white ${tag.bg}`}>
            {scheduleType === 'collection' ? 'C' : 'F'}
          </span>
          <span className="text-sm font-semibold text-slate-800">
            {tag.label} on {day}
          </span>
        </div>
        <span className="text-xs text-slate-500 tabular-nums">
          {entries.length} {entries.length === 1 ? 'org' : 'orgs'}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="px-3 py-6 text-sm text-slate-500 italic text-center">
          No recipients match this filter.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 bg-white">
          {entries.map(({ recipient, time, notes }) => (
            <li key={recipient.id}>
              <button
                type="button"
                onClick={() => onRecipientClick(recipient)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex items-start gap-3"
              >
                <div className="w-20 shrink-0 pt-0.5">
                  {time ? (
                    <div className={`text-sm font-semibold ${tag.text} flex items-center gap-1`}>
                      <Clock className="w-3.5 h-3.5" />
                      {time}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic">no time</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#236383] truncate">
                    {recipient.name}
                  </div>
                  {recipient.reportingGroup && (
                    <div className="text-xs text-slate-500 truncate">
                      {recipient.reportingGroup}
                    </div>
                  )}
                  {notes && (
                    <div className="text-xs text-slate-600 italic flex items-start gap-1 mt-0.5">
                      <Info className="w-3 h-3 shrink-0 mt-px" />
                      <span>{notes}</span>
                    </div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecipientScheduleMatrix({
  recipients,
  onRecipientClick,
}: RecipientScheduleMatrixProps) {
  const [scheduleType, setScheduleType] = useState<ScheduleType>('collection');
  const [day, setDay] = useState<FilterDay>('any');

  const { rows, totals } = useMemo(() => buildMatrix(recipients), [recipients]);

  const filteredEntries = useMemo(() => {
    if (day === 'any') return [];
    return getFilteredList(recipients, scheduleType, day);
  }, [recipients, scheduleType, day]);

  if (recipients.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        No recipients match your current filters.
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Focused lookup: who collects / feeds on a given day */}
        <FilterBar
          scheduleType={scheduleType}
          setScheduleType={setScheduleType}
          day={day}
          setDay={setDay}
          totals={totals}
        />

        {/* Focused list — only when a specific day is picked */}
        {day !== 'any' && (
          <FilteredList
            scheduleType={scheduleType}
            day={day}
            entries={filteredEntries}
            onRecipientClick={onRecipientClick}
          />
        )}

        {/* Day-strip summary — at-a-glance per-day load */}
        <DayStripSummary totals={totals} />

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-slate-600 px-1 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-[#236383] text-white">
              C
            </span>
            <span>Collection (we pick up)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-[#FBAD3F] text-white">
              F
            </span>
            <span>Feeding (they distribute)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-slate-400 text-white">
              C
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white border border-slate-400" />
            </span>
            <span>Dot = frequency note (e.g., 3rd Monday)</span>
          </div>
        </div>

        {/* Matrix */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="max-h-[calc(100vh-360px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgb(226,232,240)]">
                <tr>
                  <th
                    scope="col"
                    className="text-left text-sm font-semibold text-slate-700 px-3 py-2.5 sticky left-0 bg-slate-50 z-20 min-w-[200px]"
                  >
                    Organization
                  </th>
                  {WEEK_DAYS.map((d) => (
                    <th
                      key={d}
                      scope="col"
                      className="text-center text-sm font-semibold text-slate-700 px-2 py-2.5 min-w-[88px]"
                    >
                      <div className="flex flex-col items-center leading-tight">
                        <span>{DAY_ABBREV[d]}</span>
                        <span className="text-[10px] font-normal text-slate-400">
                          {totals[d].collects + totals[d].feeds}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ recipient, cells }) => {
                  const isInactive = recipient.status === 'inactive';
                  return (
                    <tr
                      key={recipient.id}
                      onClick={() => onRecipientClick(recipient)}
                      className={`cursor-pointer border-t border-slate-100 transition-colors ${
                        isInactive
                          ? 'bg-slate-50/80 text-slate-500 hover:bg-slate-100/80'
                          : 'hover:bg-[#236383]/5'
                      }`}
                    >
                      <td className="px-3 py-2 sticky left-0 bg-inherit z-10">
                        <div className="font-medium text-sm text-[#236383] truncate max-w-[260px]">
                          {recipient.name}
                        </div>
                        {recipient.reportingGroup && (
                          <div className="text-xs text-slate-500 truncate max-w-[260px]">
                            {recipient.reportingGroup}
                          </div>
                        )}
                      </td>
                      {WEEK_DAYS.map((d) => (
                        <td
                          key={d}
                          className="text-center px-2 py-2"
                          aria-label={`${recipient.name} on ${d}`}
                        >
                          <MatrixCell info={cells[d]} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer hint */}
        <p className="text-xs text-slate-500 px-1">
          Click any row to open the recipient's details. Hover a chip to see the
          scheduled time and any frequency note.
        </p>
      </div>
    </TooltipProvider>
  );
}
