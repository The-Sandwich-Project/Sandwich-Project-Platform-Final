import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  WEEK_DAYS,
  DAY_ABBREV,
  extractDaysFromText,
  type ScheduleEntry,
} from './recipient-schedule-utils';

interface ScheduleDayChipsProps {
  schedules: ScheduleEntry[];
  variant: 'collection' | 'feeding';
}

// Solid label header + lighter body — gives strong contrast on the day label
// AND a calm background for the readable time line beneath.
const VARIANT_STYLES = {
  collection: {
    container: 'border border-[#236383]/40 bg-white',
    header: 'bg-[#236383] text-white',
    timeText: 'text-[#0F4A52]',
    noteDot: 'bg-[#236383]',
  },
  feeding: {
    container: 'border border-[#FBAD3F]/50 bg-white',
    header: 'bg-[#B8860B] text-white',
    timeText: 'text-[#7A5A07]',
    noteDot: 'bg-[#B8860B]',
  },
} as const;

type DayDetail = { time: string; notes: string }[];

/** Group schedule entries by canonical weekday, preserving time + notes per entry. */
function groupByDay(schedules: ScheduleEntry[]): Map<string, DayDetail> {
  const byDay = new Map<string, DayDetail>();

  for (const entry of schedules) {
    const matched = extractDaysFromText(entry.day);
    const targets = matched.length > 0 ? matched : entry.day ? [entry.day] : [];

    for (const day of targets) {
      const canonical = WEEK_DAYS.find((d) => d.toLowerCase() === day.toLowerCase()) || day;
      const list = byDay.get(canonical) || [];
      const time = (entry.time || '').trim();
      const notes = (entry.notes || '').trim();
      // Dedup identical (time, notes) pairs.
      if (!list.some((d) => d.time === time && d.notes === notes)) {
        list.push({ time, notes });
      }
      byDay.set(canonical, list);
    }
  }

  return byDay;
}

export function ScheduleDayChips({ schedules, variant }: ScheduleDayChipsProps) {
  const byDay = groupByDay(schedules);

  if (byDay.size === 0) {
    return (
      <span className="text-sm text-slate-400 italic" title="No schedule entered">
        not set
      </span>
    );
  }

  const orderedDays = WEEK_DAYS.filter((d) => byDay.has(d));
  const extraDays = [...byDay.keys()].filter(
    (d) => !WEEK_DAYS.includes(d as (typeof WEEK_DAYS)[number])
  );

  const styles = VARIANT_STYLES[variant];

  return (
    <div className="flex flex-col gap-1.5">
      {[...orderedDays, ...extraDays].map((day) => {
        const details = byDay.get(day) || [];
        const label = DAY_ABBREV[day] || day.slice(0, 3);
        const times = details.map((d) => d.time).filter(Boolean);
        const hasNote = details.some((d) => d.notes);
        const timesDisplay = times.join(', ');

        return (
          <Tooltip key={day}>
            <TooltipTrigger asChild>
              <div
                className={`inline-flex flex-col rounded overflow-hidden cursor-default w-fit min-w-[56px] ${styles.container}`}
              >
                <div className={`px-2 py-0.5 text-xs font-bold tracking-wide flex items-center gap-1 ${styles.header}`}>
                  <span>{label}</span>
                  {hasNote && (
                    <span
                      aria-label="Has frequency note"
                      title="Has frequency / scheduling note"
                      className="inline-block w-1.5 h-1.5 rounded-full bg-white"
                    />
                  )}
                </div>
                {timesDisplay && (
                  <div className={`px-2 py-0.5 text-sm font-medium tabular-nums leading-tight ${styles.timeText}`}>
                    {timesDisplay}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="font-medium text-sm mb-1">{day}</p>
              {details.map((d, i) => (
                <div key={i} className="text-sm text-slate-700">
                  {d.time && <span className="font-semibold">{d.time}</span>}
                  {d.notes && (
                    <span className={d.time ? ' — ' : ''}>{d.notes}</span>
                  )}
                </div>
              ))}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
