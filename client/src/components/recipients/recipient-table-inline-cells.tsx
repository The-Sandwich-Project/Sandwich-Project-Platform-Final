import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, MapPin, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { Recipient } from '@shared/schema';
import { ScheduleDayChips } from './ScheduleDayChips';
import {
  WEEK_DAYS,
  DAY_ABBREV,
  RECIPIENT_FOCUS_AREAS,
  DELIVERY_CADENCE_OPTIONS,
  getCadenceMeta,
  getCollectionSchedules,
  getFeedingSchedules,
  getPlannedSandwichBreakdown,
  getEstimatedSandwichesRange,
  sumBreakdownRange,
  formatRange,
  buildScheduleFromDaysAndTime,
  parseScheduleForInlineEdit,
  type ScheduleEntry,
  type DeliveryCadence,
} from './recipient-schedule-utils';

type SaveHandler = (updates: Partial<Recipient>) => void;

function stopRowClick(e: React.SyntheticEvent) {
  e.stopPropagation();
}

interface InlineBaseProps {
  canEdit: boolean;
  isSaving?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function InlineTextCell({
  value,
  placeholder = '—',
  canEdit,
  isSaving,
  className = '',
  onSave,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  onSave: (value: string) => void;
} & InlineBaseProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (!canEdit) {
    return (
      <span className={`text-sm text-slate-600 truncate block ${className}`}>
        {value || placeholder}
      </span>
    );
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={stopRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`h-7 text-xs ${className}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        stopRowClick(e);
        setEditing(true);
      }}
      className={`group text-left text-sm w-full truncate rounded px-1 py-0.5 hover:bg-white hover:ring-1 hover:ring-[#236383]/30 ${className}`}
    >
      {isSaving ? (
        <Loader2 className="w-3 h-3 animate-spin inline" />
      ) : (
        <>
          <span className={value ? 'text-slate-700' : 'text-slate-400 italic'}>
            {value || placeholder}
          </span>
          <Pencil className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-50" />
        </>
      )}
    </button>
  );
}

/**
 * Address cell — renders the address as a clickable Google Maps link when
 * present, with an inline-edit affordance for editors. Mirrors
 * InlineTextCell's keyboard/blur commit behavior but uses an `<a>` for the
 * default read view so users can jump to Maps without entering edit mode.
 * The pencil shows on hover to enter edit mode for changing the value.
 */
export function InlineAddressCell({
  value,
  canEdit,
  isSaving,
  onSave,
}: {
  value: string;
  onSave: (value: string) => void;
} & InlineBaseProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const mapsUrl = value
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`
    : null;

  // Read-only view: just the Maps link, no edit affordance.
  if (!canEdit) {
    if (!value) {
      return <span className="text-sm text-slate-400 italic">—</span>;
    }
    return (
      <a
        href={mapsUrl!}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopRowClick}
        className="text-sm text-[#236383] hover:text-[#236383] hover:underline inline-flex items-center gap-1 truncate"
        title={`Open ${value} in Google Maps`}
      >
        <MapPin className="w-3 h-3 shrink-0" />
        <span className="truncate">{value}</span>
        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
      </a>
    );
  }

  // Edit mode: text input identical to InlineTextCell's edit shape.
  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={stopRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder="123 Main St, City, State 12345"
        className="h-7 text-xs"
      />
    );
  }

  // Editable read view: the address itself is a Google Maps link (click goes
  // to Maps), and a small pencil chip beside it enters edit mode. This keeps
  // the navigation action (Maps) one click away without forcing a route
  // through edit mode just to view the location.
  if (!value) {
    // No address yet — render an empty pencil-triggered editor like InlineTextCell.
    return (
      <button
        type="button"
        onClick={(e) => {
          stopRowClick(e);
          setEditing(true);
        }}
        className="group text-left text-sm w-full truncate rounded px-1 py-0.5 hover:bg-white hover:ring-1 hover:ring-[#236383]/30"
      >
        {isSaving ? (
          <Loader2 className="w-3 h-3 animate-spin inline" />
        ) : (
          <>
            <span className="text-slate-400 italic">— add address —</span>
            <Pencil className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-50" />
          </>
        )}
      </button>
    );
  }

  return (
    <div className="group flex items-center gap-1 min-w-0" onClick={stopRowClick}>
      <a
        href={mapsUrl!}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-[#236383] hover:text-[#236383] hover:underline inline-flex items-center gap-1 min-w-0 flex-1"
        title={`Open ${value} in Google Maps`}
      >
        <MapPin className="w-3 h-3 shrink-0" />
        <span className="truncate">{value}</span>
        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
      </a>
      {isSaving ? (
        <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 p-0.5 rounded hover:bg-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit address"
          aria-label="Edit address"
        >
          <Pencil className="w-3 h-3 text-slate-500" />
        </button>
      )}
    </div>
  );
}

export function InlineNumberCell({
  value,
  canEdit,
  isSaving,
  onSave,
}: {
  value: number | null;
  onSave: (value: number | null) => void;
} & InlineBaseProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.toString() ?? '');

  useEffect(() => {
    if (!editing) setDraft(value?.toString() ?? '');
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : parseInt(trimmed, 10);
    if (next !== value && (next === null || !Number.isNaN(next))) {
      onSave(next);
    }
  };

  if (!canEdit) {
    return (
      <span className="text-sm text-slate-700 tabular-nums">
        {value != null ? value.toLocaleString() : '—'}
      </span>
    );
  }

  if (editing) {
    return (
      <Input
        type="number"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={stopRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value?.toString() ?? '');
            setEditing(false);
          }
        }}
        className="h-7 text-xs w-20"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        stopRowClick(e);
        setEditing(true);
      }}
      className="group text-sm tabular-nums rounded px-1 py-0.5 hover:bg-white hover:ring-1 hover:ring-[#236383]/30"
    >
      {isSaving ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <>
          {value != null ? value.toLocaleString() : '—'}
          <Pencil className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-50" />
        </>
      )}
    </button>
  );
}

export function InlineStatusSelect({
  status,
  canEdit,
  isSaving,
  onSave,
}: {
  status: string;
  onSave: (status: 'active' | 'inactive') => void;
} & InlineBaseProps) {
  if (!canEdit) {
    return (
      <Badge variant={status === 'active' ? 'default' : 'secondary'} className="text-xs">
        {status}
      </Badge>
    );
  }

  return (
    <div onClick={stopRowClick}>
      <Select
        value={status}
        disabled={isSaving}
        onValueChange={(v) => onSave(v as 'active' | 'inactive')}
      >
        <SelectTrigger className="h-7 text-xs w-[88px] border-dashed">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">active</SelectItem>
          <SelectItem value="inactive">inactive</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function InlineContractCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const signed = recipient.contractSigned;

  if (!canEdit) {
    return signed ? (
      <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Signed</Badge>
    ) : (
      <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-800">
        Pending
      </Badge>
    );
  }

  return (
    <div onClick={stopRowClick}>
      <Select
        value={signed ? 'signed' : 'pending'}
        disabled={isSaving}
        onValueChange={(v) => {
          const nextSigned = v === 'signed';
          onSave({
            contractSigned: nextSigned,
            contractSignedDate: nextSigned ? new Date() : null,
          });
        }}
      >
        <SelectTrigger className="h-7 text-xs w-[90px] border-dashed">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="signed">Signed</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Estimated sandwiches cell — displays planned breakdown by type if present,
 * otherwise the single-number `estimatedSandwiches` field (inline-editable).
 *
 * When a breakdown exists, the single-number inline edit is hidden — the
 * breakdown is authoritative. Edit the breakdown from the recipient form.
 */
export function InlineEstimatedSandwichesCell({
  recipient,
  canEdit: _canEdit,
  isSaving: _isSaving,
  onSave: _onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const breakdown = getPlannedSandwichBreakdown(recipient);

  // Per-type breakdown takes precedence when present.
  if (breakdown.length > 0) {
    const total = sumBreakdownRange(breakdown);
    return (
      <div className="text-xs leading-tight space-y-0.5">
        {breakdown.map((row, i) => (
          <div key={i} className="text-slate-700">
            <span className="font-medium tabular-nums">{formatRange(row.min, row.max)}</span>{' '}
            <span className="text-slate-500">{row.type}</span>
          </div>
        ))}
        {total && (
          <div className="pt-0.5 border-t border-slate-200 mt-1 text-[11px] text-slate-500">
            = <span className="font-semibold text-slate-700 tabular-nums">{formatRange(total.min, total.max)}</span>
          </div>
        )}
      </div>
    );
  }

  const range = getEstimatedSandwichesRange(recipient);
  if (!range) {
    return <span className="text-xs text-slate-400 italic">—</span>;
  }

  return (
    <span
      className="text-sm font-medium text-slate-800 tabular-nums"
      title={
        range.min === range.max
          ? `${range.min.toLocaleString()} sandwiches`
          : `Range: ${range.min.toLocaleString()}–${range.max.toLocaleString()} sandwiches`
      }
    >
      {formatRange(range.min, range.max)}
    </span>
  );
}

export function InlineCadenceCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const cadence = (recipient as Recipient & { deliveryCadence?: string | null }).deliveryCadence;
  const note = (recipient as Recipient & { deliveryCadenceNote?: string | null }).deliveryCadenceNote;
  const meta = getCadenceMeta(cadence);

  if (!canEdit) {
    if (!meta) {
      return <span className="text-xs text-slate-400 italic">—</span>;
    }
    return (
      <Badge
        className={`text-xs ${meta.badgeClass}`}
        title={note || meta.description}
      >
        {meta.label}
      </Badge>
    );
  }

  return (
    <div onClick={stopRowClick}>
      <Select
        value={cadence || 'none'}
        disabled={isSaving}
        onValueChange={(v) => {
          onSave({
            deliveryCadence: (v === 'none' ? null : (v as DeliveryCadence)),
          } as Partial<Recipient>);
        }}
      >
        <SelectTrigger
          className={`h-7 text-xs w-[140px] border-dashed ${
            meta ? meta.badgeClass : ''
          }`}
          title={note || meta?.description || 'Not categorized'}
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— Not set</SelectItem>
          {DELIVERY_CADENCE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function InlinePeopleServedCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const count = (recipient as Recipient & { averagePeopleServed?: number | null })
    .averagePeopleServed;

  return (
    <InlineNumberCell
      value={count ?? null}
      canEdit={canEdit}
      isSaving={isSaving}
      onSave={(val) => onSave({ averagePeopleServed: val } as Partial<Recipient>)}
    />
  );
}

const PEOPLE_SERVED_FREQ_OPTIONS = [
  { value: 'daily', label: 'Daily', short: 'daily' },
  { value: 'weekly', label: 'Weekly', short: 'weekly' },
  { value: 'monthly', label: 'Monthly', short: 'monthly' },
] as const;

/**
 * Combined "People served" cell: count + frequency rendered together as
 * "~80 weekly". Conceptually one piece of info — # people on what cadence.
 * Editor stacks two compact inputs (number + dropdown) inside the cell.
 */
export function InlinePeopleServedCombinedCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const count = (recipient as Recipient & { averagePeopleServed?: number | null })
    .averagePeopleServed;
  const freq = (recipient as Recipient & { peopleServedFrequency?: string | null })
    .peopleServedFrequency;
  const freqShort = PEOPLE_SERVED_FREQ_OPTIONS.find((o) => o.value === freq)?.short;

  if (!canEdit) {
    if (count == null && !freq) {
      return <span className="text-xs text-slate-400 italic">—</span>;
    }
    return (
      <span className="text-sm text-slate-800">
        {count != null && (
          <span className="font-semibold tabular-nums">~{count.toLocaleString()}</span>
        )}
        {count != null && freqShort && <span> </span>}
        {freqShort && <span className="text-slate-600">{freqShort}</span>}
      </span>
    );
  }

  return (
    <div onClick={stopRowClick} className="flex items-center gap-1">
      <Input
        type="number"
        min={0}
        value={count ?? ''}
        disabled={isSaving}
        onChange={(e) => {
          const v = e.target.value;
          onSave({
            averagePeopleServed: v === '' ? null : Math.max(0, parseInt(v, 10) || 0),
          } as Partial<Recipient>);
        }}
        placeholder="—"
        className="h-7 text-xs w-[60px] tabular-nums"
        aria-label="People served"
      />
      <Select
        value={freq || 'none'}
        disabled={isSaving}
        onValueChange={(v) =>
          onSave({ peopleServedFrequency: v === 'none' ? null : v } as Partial<Recipient>)
        }
      >
        <SelectTrigger
          className="h-7 text-xs w-[78px] border-dashed"
          aria-label="Frequency"
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">—</SelectItem>
          {PEOPLE_SERVED_FREQ_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function InlinePeopleServedFrequencyCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const freq = (recipient as Recipient & { peopleServedFrequency?: string | null })
    .peopleServedFrequency;
  const label = PEOPLE_SERVED_FREQ_OPTIONS.find((o) => o.value === freq)?.label;

  if (!canEdit) {
    return label ? (
      <span className="text-sm text-slate-700">{label}</span>
    ) : (
      <span className="text-xs text-slate-400 italic">—</span>
    );
  }

  return (
    <div onClick={stopRowClick}>
      <Select
        value={freq || 'none'}
        disabled={isSaving}
        onValueChange={(v) =>
          onSave({ peopleServedFrequency: v === 'none' ? null : v } as Partial<Recipient>)
        }
      >
        <SelectTrigger className="h-7 text-xs w-[100px] border-dashed">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— Not set</SelectItem>
          {PEOPLE_SERVED_FREQ_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Combined fruit + snacks state.
 * Per business rule: if we give an org fruit we also give them snacks — they
 * always move together. The only signal is the survey-derived state:
 *   receiving  → "Yes" chip (currently getting both)
 *   interested → "Wants" chip (not getting, said they'd like to)
 *   none       → dim dash
 * Editor cycles: none → wants → receiving → none. Writes both receivingFruit/Snacks
 * and wantsFruit/Snacks together.
 */
export function InlineFruitSnacksCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  // Receiving = the org gets fruit/snacks. Use OR across both legacy fields so
  // data captured before the merge still surfaces correctly.
  const recv =
    !!(recipient as Recipient & { receivingFruit?: boolean }).receivingFruit ||
    !!(recipient as Recipient & { receivingSnacks?: boolean }).receivingSnacks;
  const want =
    !recv &&
    (!!(recipient as Recipient & { wantsFruit?: boolean }).wantsFruit ||
      !!(recipient as Recipient & { wantsSnacks?: boolean }).wantsSnacks);

  const nextState = (): { recv: boolean; want: boolean } => {
    if (!recv && !want) return { recv: false, want: true }; // none → wants
    if (want) return { recv: true, want: false }; // wants → receiving
    return { recv: false, want: false }; // receiving → none
  };

  const display = (recvState: boolean, wantState: boolean) => {
    if (recvState) {
      return (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border bg-[#47B3CB]/15 text-[#236383] border-[#47B3CB]/40"
          title="Currently receiving fruit & snacks"
        >
          Yes
        </span>
      );
    }
    if (wantState) {
      return (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border bg-[#FBAD3F]/20 text-[#B8860B] border-[#FBAD3F]/40"
          title="Said they'd like to receive fruit & snacks"
        >
          Wants
        </span>
      );
    }
    return (
      <span className="text-xs text-slate-400" title="Not receiving / not interested">
        —
      </span>
    );
  };

  if (!canEdit) {
    return display(recv, want);
  }

  return (
    <div onClick={stopRowClick}>
      <button
        type="button"
        disabled={isSaving}
        onClick={() => {
          const n = nextState();
          onSave({
            // Keep both fields synced so legacy data stays consistent.
            receivingFruit: n.recv,
            receivingSnacks: n.recv,
            wantsFruit: n.want,
            wantsSnacks: n.want,
          } as unknown as Partial<Recipient>);
        }}
        className={`cursor-pointer hover:opacity-75 transition-opacity ${
          isSaving ? 'opacity-50 cursor-wait' : ''
        }`}
        title="Click to cycle: none → interested → receiving → none"
      >
        {display(recv, want)}
      </button>
    </div>
  );
}

export function InlineSurveyCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const submitted = !!(recipient as Recipient & { surveySubmitted?: boolean }).surveySubmitted;
  const submittedDate = (recipient as Recipient & { surveySubmittedDate?: Date | string | null })
    .surveySubmittedDate;

  const titleText = submitted
    ? `Survey returned${submittedDate ? ` on ${new Date(submittedDate).toLocaleDateString()}` : ''}`
    : 'Survey not yet returned';

  if (!canEdit) {
    return submitted ? (
      <Badge
        className="bg-[#47B3CB]/15 text-[#236383] border-[#47B3CB]/40 text-xs gap-1"
        title={titleText}
      >
        <Check className="w-3 h-3" />
        Returned
      </Badge>
    ) : (
      <span className="text-xs text-slate-400 italic" title={titleText}>
        —
      </span>
    );
  }

  return (
    <div onClick={stopRowClick}>
      <button
        type="button"
        disabled={isSaving}
        title={titleText}
        onClick={() =>
          onSave({
            surveySubmitted: !submitted,
            // Only auto-stamp the date when flipping to submitted AND no date is set.
            surveySubmittedDate: !submitted && !submittedDate ? new Date() : submittedDate,
          } as Partial<Recipient>)
        }
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${
          submitted
            ? 'bg-[#47B3CB]/15 text-[#236383] border-[#47B3CB]/40 hover:bg-[#47B3CB]/25'
            : 'bg-white text-slate-500 border-dashed border-slate-300 hover:border-[#47B3CB] hover:text-[#236383]'
        } ${isSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
      >
        {submitted ? (
          <>
            <Check className="w-3 h-3" />
            Returned
          </>
        ) : (
          <>Not yet</>
        )}
      </button>
    </div>
  );
}

export function InlineScheduleCell({
  recipient,
  variant,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  variant: 'collection' | 'feeding';
  onSave: SaveHandler;
} & InlineBaseProps) {
  const schedules =
    variant === 'collection'
      ? getCollectionSchedules(recipient)
      : getFeedingSchedules(recipient);

  const readOnly = (
    <ScheduleDayChips schedules={schedules} variant={variant} />
  );

  if (!canEdit) return readOnly;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stopRowClick}
          className="group w-full text-left rounded p-0.5 hover:ring-1 hover:ring-[#236383]/30 min-h-[24px]"
        >
          {isSaving ? (
            <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
          ) : (
            <>
              {readOnly}
              <Pencil className="w-3 h-3 mt-0.5 opacity-0 group-hover:opacity-40 text-slate-500" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start" onClick={stopRowClick}>
        <ScheduleInlineEditor
          schedules={schedules}
          label={variant === 'collection' ? 'Collection' : 'Feeding'}
          onSave={(next) => {
            if (variant === 'collection') {
              onSave({
                collectionSchedules: next,
                collectionDay: next[0]?.day ?? null,
                collectionTime: next[0]?.time ?? null,
              });
            } else {
              onSave({
                feedingSchedules: next,
                feedingDay: next[0]?.day ?? null,
                feedingTime: next[0]?.time ?? null,
              });
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ScheduleInlineEditor({
  schedules,
  label,
  onSave,
}: {
  schedules: ScheduleEntry[];
  label: string;
  onSave: (schedules: ScheduleEntry[]) => void;
}) {
  const initial = parseScheduleForInlineEdit(schedules);
  const [days, setDays] = useState<string[]>(initial.days);
  const [time, setTime] = useState(initial.time);

  useEffect(() => {
    const parsed = parseScheduleForInlineEdit(schedules);
    setDays(parsed.days);
    setTime(parsed.time);
  }, [schedules]);

  const toggleDay = (day: string) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-slate-700">{label} schedule</p>
      <div className="flex flex-wrap gap-1">
        {WEEK_DAYS.map((day) => {
          const selected = days.includes(day);
          const chipClass =
            label === 'Collection'
              ? selected
                ? 'bg-[#236383]/20 text-[#236383] border-[#236383]/40'
                : 'bg-white border-slate-200 text-slate-500'
              : selected
                ? 'bg-[#FBAD3F]/25 text-[#B8860B] border-[#FBAD3F]/50'
                : 'bg-white border-slate-200 text-slate-500';
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`px-2 py-1 text-xs font-semibold rounded border ${chipClass}`}
            >
              {DAY_ABBREV[day]}
            </button>
          );
        })}
      </div>
      <Input
        value={time}
        onChange={(e) => setTime(e.target.value)}
        placeholder="Time, e.g. 9:00 AM"
        className="h-8 text-xs"
      />
      <Button
        type="button"
        size="sm"
        className="w-full h-8 text-xs"
        onClick={() => onSave(buildScheduleFromDaysAndTime(days, time))}
      >
        Save schedule
      </Button>
    </div>
  );
}

export function InlineFocusAreasCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const areas =
    Array.isArray((recipient as Recipient & { focusAreas?: string[] }).focusAreas) &&
    (recipient as Recipient & { focusAreas?: string[] }).focusAreas!.length > 0
      ? (recipient as Recipient & { focusAreas?: string[] }).focusAreas!
      : recipient.focusArea
        ? [recipient.focusArea]
        : [];

  const display = (
    <div className="flex flex-wrap gap-1 max-w-[160px]">
      {areas.length > 0 ? (
        areas.map((area) => (
          <Badge
            key={area}
            variant="outline"
            className="text-xs bg-brand-primary-lighter/50 text-brand-primary border-brand-primary-border px-1.5 py-0"
          >
            {area}
          </Badge>
        ))
      ) : (
        <span className="text-sm text-slate-400">—</span>
      )}
    </div>
  );

  if (!canEdit) return display;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stopRowClick}
          className="group w-full text-left rounded p-0.5 hover:ring-1 hover:ring-[#236383]/30"
        >
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : display}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start" onClick={stopRowClick}>
        <p className="text-xs font-semibold text-slate-700 mb-2">Focus areas</p>
        <div className="flex flex-wrap gap-1 mb-3">
          {RECIPIENT_FOCUS_AREAS.map((area) => {
            const selected = areas.includes(area);
            return (
              <Badge
                key={area}
                variant={selected ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => {
                  const next = selected
                    ? areas.filter((a) => a !== area)
                    : [...areas, area];
                  onSave({ focusAreas: next, focusArea: next[0] ?? null });
                }}
              >
                {area}
              </Badge>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PrimaryContactInlineEditor({
  name,
  phone,
  email,
  onSave,
}: {
  name: string;
  phone: string;
  email: string;
  onSave: SaveHandler;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftPhone, setDraftPhone] = useState(phone);
  const [draftEmail, setDraftEmail] = useState(email);

  useEffect(() => {
    setDraftName(name);
    setDraftPhone(phone);
    setDraftEmail(email);
  }, [name, phone, email]);

  const commit = () => {
    if (
      draftName === name &&
      draftPhone === phone &&
      draftEmail === email
    ) {
      return;
    }
    onSave({
      contactPersonName: draftName || null,
      contactPersonPhone: draftPhone || null,
      contactPersonEmail: draftEmail || null,
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-700">Primary contact</p>
      <Input
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        placeholder="Name"
        className="h-8 text-xs"
      />
      <Input
        value={draftPhone}
        onChange={(e) => setDraftPhone(e.target.value)}
        placeholder="Phone"
        className="h-8 text-xs"
      />
      <Input
        value={draftEmail}
        onChange={(e) => setDraftEmail(e.target.value)}
        placeholder="Email"
        className="h-8 text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <Button type="button" size="sm" className="w-full h-8 text-xs" onClick={commit}>
        Save contact
      </Button>
    </div>
  );
}

export function InlinePrimaryContactCell({
  recipient,
  canEdit,
  isSaving,
  onSave,
}: {
  recipient: Recipient;
  onSave: SaveHandler;
} & InlineBaseProps) {
  const name = recipient.contactPersonName || recipient.contactName || '';
  const phone = recipient.contactPersonPhone || '';
  const email = recipient.contactPersonEmail || '';
  const [open, setOpen] = useState(false);

  if (!canEdit) {
    return (
      <div className="space-y-0.5">
        {name && <div className="text-sm font-medium truncate">{name}</div>}
        {phone && <div className="text-xs text-slate-500 truncate">{phone}</div>}
        {!name && !phone && !email && (
          <span className="text-sm text-slate-400 italic">—</span>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stopRowClick}
          className="group w-full text-left rounded p-0.5 hover:ring-1 hover:ring-[#236383]/30 min-h-[24px]"
        >
          {isSaving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              {name ? (
                <div className="text-sm font-medium truncate">{name}</div>
              ) : (
                <span className="text-sm text-slate-400 italic">Add contact</span>
              )}
              {phone && (
                <div className="text-xs text-slate-500 truncate">{phone}</div>
              )}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start" onClick={stopRowClick}>
        {open && (
          <PrimaryContactInlineEditor
            name={name}
            phone={phone}
            email={email}
            onSave={onSave}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}