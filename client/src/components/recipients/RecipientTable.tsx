import type React from 'react';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from 'lucide-react';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Recipient } from '@shared/schema';
import {
  getRecipientRegion,
  type SortColumn,
  type SortDirection,
} from './recipient-schedule-utils';
import {
  InlineTextCell,
  InlineAddressCell,
  InlineContractCell,
  InlineScheduleCell,
  InlineSurveyCell,
  InlineCadenceCell,
  InlineEstimatedSandwichesCell,
  InlinePeopleServedCombinedCell,
  InlineFruitSnacksCell,
  InlineFocusAreasCell,
  InlinePrimaryContactCell,
} from './recipient-table-inline-cells';

// localStorage key for persisted column widths. Bump the suffix if column
// IDs ever change so stale persisted widths don't break a new layout.
const COLUMN_WIDTHS_STORAGE_KEY = 'recipientTableColumnWidths.v1';

// localStorage key for persisted column ORDER. Stored as an array of column
// ids. Versioned so default-order changes don't surprise existing users —
// bump when adding/removing columns or changing the canonical default order
// in a way that should reset everyone's saved layout.
const COLUMN_ORDER_STORAGE_KEY = 'recipientTableColumnOrder.v1';

// Minimum column width while resizing — small enough to be useful, large
// enough to keep the resize handle clickable.
const MIN_COLUMN_WIDTH_PX = 80;

// Default column order + metadata. Primary Contact lives immediately to the
// right of Cadence per user request — it groups "who runs this org" with
// the cadence/scheduling info that operators look at together.
const COLUMNS: { id: SortColumn; label: string; className?: string; defaultWidth: number }[] = [
  { id: 'name', label: 'Name', className: 'min-w-[160px]', defaultWidth: 200 },
  { id: 'collectionDays', label: 'Collection Days', className: 'min-w-[130px]', defaultWidth: 150 },
  { id: 'feedingDays', label: 'Feeding Days', className: 'min-w-[120px]', defaultWidth: 140 },
  { id: 'estimatedSandwiches', label: 'Est. Sandwiches', className: 'w-[110px]', defaultWidth: 120 },
  { id: 'sandwichType', label: 'Sandwich Type', className: 'w-[110px]', defaultWidth: 120 },
  { id: 'cadence', label: 'Cadence', className: 'min-w-[130px]', defaultWidth: 150 },
  { id: 'primaryContact', label: 'Primary Contact', className: 'min-w-[160px]', defaultWidth: 180 },
  { id: 'peopleServed', label: 'People served', className: 'min-w-[130px]', defaultWidth: 140 },
  { id: 'fruitSnacks', label: 'Fruit & Snacks', className: 'w-[110px]', defaultWidth: 120 },
  { id: 'address', label: 'Address', className: 'min-w-[180px]', defaultWidth: 220 },
  { id: 'tspContact', label: 'TSP Contact', className: 'min-w-[120px]', defaultWidth: 140 },
  { id: 'focusArea', label: 'Focus Area', className: 'min-w-[140px]', defaultWidth: 160 },
  { id: 'region', label: 'Region', className: 'min-w-[120px]', defaultWidth: 140 },
  { id: 'contract', label: 'Contract', className: 'w-[100px]', defaultWidth: 110 },
  { id: 'survey', label: 'Survey', className: 'w-[90px]', defaultWidth: 100 },
];

// Lookup of column metadata by id — used during dynamic render and reorder.
const COLUMN_BY_ID: Record<string, typeof COLUMNS[number]> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c])
) as Record<string, typeof COLUMNS[number]>;

// Default column order as an array of ids — written to localStorage on first
// render, used as the fallback for new users.
const DEFAULT_COLUMN_ORDER: SortColumn[] = COLUMNS.map((c) => c.id);

interface RecipientTableProps {
  recipients: Recipient[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
  onRowClick: (recipient: Recipient) => void;
  highlightedId?: number;
  highlightRowRef?: React.RefObject<HTMLTableRowElement>;
  canEdit?: boolean;
  savingId?: number | null;
  onUpdateRecipient?: (recipient: Recipient, updates: Partial<Recipient>) => void;
}

function SortIcon({
  column,
  sortColumn,
  sortDirection,
}: {
  column: SortColumn;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
}) {
  if (sortColumn !== column) {
    return <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />;
  }
  return sortDirection === 'asc' ? (
    <ArrowUp className="w-3.5 h-3.5 text-[#236383]" />
  ) : (
    <ArrowDown className="w-3.5 h-3.5 text-[#236383]" />
  );
}

export function RecipientTable({
  recipients,
  sortColumn,
  sortDirection,
  onSort,
  onRowClick,
  highlightedId,
  highlightRowRef,
  canEdit = false,
  savingId = null,
  onUpdateRecipient,
}: RecipientTableProps) {
  const save = (recipient: Recipient, updates: Partial<Recipient>) => {
    if (!canEdit || !onUpdateRecipient) return;
    onUpdateRecipient(recipient, updates);
  };

  // ── Column resize ──────────────────────────────────────────────────────
  // Pattern mirrors ScheduledSpreadsheetView: per-column width persisted to
  // localStorage, mouse-driven drag handle on the right edge of each header.
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [resizingColumn, setResizingColumn] = useState<
    { id: SortColumn; startX: number; startWidth: number } | null
  >(null);

  const getColumnWidth = (col: typeof COLUMNS[number]): number =>
    columnWidths[col.id] ?? col.defaultWidth;

  const handleResizeStart = (e: React.MouseEvent, col: typeof COLUMNS[number]) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn({
      id: col.id,
      startX: e.clientX,
      startWidth: getColumnWidth(col),
    });
  };

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizingColumn.startX;
      const newWidth = Math.max(MIN_COLUMN_WIDTH_PX, resizingColumn.startWidth + deltaX);
      setColumnWidths((prev) => ({ ...prev, [resizingColumn.id]: newWidth }));
    };

    const handleUp = () => {
      // Persist using the latest state (functional update closes over latest).
      setColumnWidths((prev) => {
        try {
          localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(prev));
        } catch {
          // Quota or disabled storage — silently skip persistence.
        }
        return prev;
      });
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizingColumn]);

  // ── Column order (drag-to-reorder) ────────────────────────────────────
  // Persisted to localStorage so each operator can shape the table to fit
  // their workflow. If the saved order is missing IDs (e.g. a column was
  // added to the codebase since they last used the app), append the new IDs
  // at the end so the column appears rather than going missing. Conversely
  // strip IDs that no longer exist to avoid render errors.
  const [columnOrder, setColumnOrder] = useState<SortColumn[]>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_ORDER_STORAGE_KEY);
      if (!saved) return DEFAULT_COLUMN_ORDER;
      const parsed = JSON.parse(saved) as SortColumn[];
      if (!Array.isArray(parsed)) return DEFAULT_COLUMN_ORDER;
      const known = new Set(DEFAULT_COLUMN_ORDER);
      const filtered = parsed.filter((id) => known.has(id));
      // Append any new ids that exist in defaults but not in saved order.
      for (const id of DEFAULT_COLUMN_ORDER) {
        if (!filtered.includes(id)) filtered.push(id);
      }
      return filtered;
    } catch {
      return DEFAULT_COLUMN_ORDER;
    }
  });

  const [draggedColumn, setDraggedColumn] = useState<SortColumn | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<SortColumn | null>(null);

  const persistColumnOrder = (next: SortColumn[]) => {
    setColumnOrder(next);
    try {
      localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage disabled / over quota — fall back to in-session order.
    }
  };

  const handleHeaderDragStart = (e: React.DragEvent, id: SortColumn) => {
    // Name column is sticky and acts as the row's identifier — locking it
    // in place avoids weird sticky-cell behavior and surprising reorders.
    if (id === 'name') {
      e.preventDefault();
      return;
    }
    setDraggedColumn(id);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox to start the drag.
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {
      // Some browsers throw if setData runs outside a real drag context.
    }
  };

  const handleHeaderDragOver = (e: React.DragEvent, id: SortColumn) => {
    if (!draggedColumn || draggedColumn === id || id === 'name') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== id) setDragOverColumn(id);
  };

  const handleHeaderDragLeave = (id: SortColumn) => {
    if (dragOverColumn === id) setDragOverColumn(null);
  };

  const handleHeaderDrop = (e: React.DragEvent, targetId: SortColumn) => {
    e.preventDefault();
    setDragOverColumn(null);
    if (!draggedColumn || draggedColumn === targetId || targetId === 'name') {
      setDraggedColumn(null);
      return;
    }
    const next = [...columnOrder];
    const fromIdx = next.indexOf(draggedColumn);
    const toIdx = next.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDraggedColumn(null);
      return;
    }
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggedColumn);
    persistColumnOrder(next);
    setDraggedColumn(null);
  };

  const handleHeaderDragEnd = () => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  // ── Cell renderers ────────────────────────────────────────────────────
  // Each column id maps to a function returning the cell content for a given
  // recipient. The TableCell wrapper (with column-specific styling) is added
  // by the body render below. Keeping the renderer as a function (not JSX)
  // lets us reuse it across the header-driven body render without prop drilling.
  const renderCellContent = (id: SortColumn, recipient: Recipient, isSaving: boolean) => {
    switch (id) {
      case 'name':
        return (
          <InlineTextCell
            value={recipient.name || ''}
            canEdit={canEdit}
            isSaving={isSaving}
            className="text-sm text-[#236383] font-medium max-w-[180px]"
            onSave={(name) => save(recipient, { name })}
          />
        );
      case 'collectionDays':
        return (
          <InlineScheduleCell
            recipient={recipient}
            variant="collection"
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'feedingDays':
        return (
          <InlineScheduleCell
            recipient={recipient}
            variant="feeding"
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'estimatedSandwiches':
        return (
          <InlineEstimatedSandwichesCell
            recipient={recipient}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'sandwichType':
        return (
          <InlineTextCell
            value={recipient.sandwichType || ''}
            placeholder="—"
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(sandwichType) =>
              save(recipient, { sandwichType: sandwichType || null })
            }
          />
        );
      case 'cadence':
        return (
          <InlineCadenceCell
            recipient={recipient}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'primaryContact':
        return (
          <InlinePrimaryContactCell
            recipient={recipient}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'peopleServed':
        return (
          <InlinePeopleServedCombinedCell
            recipient={recipient}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'fruitSnacks':
        return (
          <InlineFruitSnacksCell
            recipient={recipient}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'address':
        return (
          <InlineAddressCell
            value={recipient.address || ''}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(address) =>
              save(recipient, { address: address || null })
            }
          />
        );
      case 'tspContact':
        return (
          <InlineTextCell
            value={recipient.tspContact || ''}
            placeholder="—"
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(tspContact) =>
              save(recipient, { tspContact: tspContact || null })
            }
          />
        );
      case 'focusArea':
        return (
          <InlineFocusAreasCell
            recipient={recipient}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'region':
        return (
          <span className="text-sm text-slate-600 max-w-[120px] truncate block">
            {getRecipientRegion(recipient)}
          </span>
        );
      case 'contract':
        return (
          <InlineContractCell
            recipient={recipient}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      case 'survey':
        return (
          <InlineSurveyCell
            recipient={recipient}
            canEdit={canEdit}
            isSaving={isSaving}
            onSave={(updates) => save(recipient, updates)}
          />
        );
      // Status/reportingGroup are valid SortColumn ids but not rendered as
      // table columns. Fall through harmlessly.
      default:
        return null;
    }
  };

  // Per-column TableCell styling (sticky Name, tinted day columns).
  const getCellClassName = (id: SortColumn, rowBgClass: string): string => {
    if (id === 'name') {
      return `font-medium sticky left-0 z-10 ${rowBgClass} group-hover:bg-[#E6F4F6] shadow-[2px_0_3px_-1px_rgb(0_0_0/0.08)]`;
    }
    if (id === 'collectionDays') return 'bg-[#236383]/[0.03]';
    if (id === 'feedingDays') return 'bg-[#FBAD3F]/[0.04]';
    return '';
  };

  // Resolve the columns to render IN ORDER, ignoring any saved-order entries
  // we don't recognize. (Already handled at state-init time but guarded here
  // again for safety against bad runtime data.)
  const orderedColumns = columnOrder
    .map((id) => COLUMN_BY_ID[id])
    .filter((c): c is typeof COLUMNS[number] => !!c);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
      {canEdit && (
        <div className="px-3 py-2 bg-[#FBAD3F]/10 border-b border-[#FBAD3F]/20 text-sm text-slate-600">
          Click any cell to edit inline. Row click opens full details.
        </div>
      )}
      <div className="max-h-[calc(100vh-320px)] overflow-auto">
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgb(226,232,240)]">
            <TableRow className="hover:bg-slate-50">
              {orderedColumns.map((col) => {
                const isDragTarget = dragOverColumn === col.id;
                const isBeingDragged = draggedColumn === col.id;
                const isLocked = col.id === 'name'; // Sticky Name column stays put.
                return (
                  <TableHead
                    key={col.id}
                    // HTML5 drag-and-drop. The header acts both as a drag
                    // source (whole header is draggable) and a drop target,
                    // so users can drag any column to any other position.
                    // The Name column is locked because it's sticky.
                    draggable={!isLocked}
                    onDragStart={(e) => handleHeaderDragStart(e, col.id)}
                    onDragOver={(e) => handleHeaderDragOver(e, col.id)}
                    onDragLeave={() => handleHeaderDragLeave(col.id)}
                    onDrop={(e) => handleHeaderDrop(e, col.id)}
                    onDragEnd={handleHeaderDragEnd}
                    style={{ width: getColumnWidth(col), minWidth: MIN_COLUMN_WIDTH_PX }}
                    className={`relative whitespace-nowrap text-sm font-semibold text-slate-700 group ${col.className || ''} ${
                      col.id === 'name'
                        ? 'sticky left-0 z-20 bg-slate-50 shadow-[2px_0_3px_-1px_rgb(0_0_0/0.08)]'
                        : col.id === 'collectionDays'
                          ? 'bg-[#236383]/8'
                          : col.id === 'feedingDays'
                            ? 'bg-[#FBAD3F]/10'
                            : ''
                    } ${resizingColumn?.id === col.id ? 'select-none' : ''} ${
                      isBeingDragged ? 'opacity-40' : ''
                    } ${
                      isDragTarget
                        ? 'outline outline-2 outline-[#236383] outline-offset-[-2px]'
                        : ''
                    } ${!isLocked ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    <div className="inline-flex items-center gap-1.5">
                      {/* Drag grip — visual cue that the header is draggable.
                          Only shown on hover so the chrome stays calm at rest. */}
                      {!isLocked && (
                        <GripVertical
                          className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors"
                          aria-label={`Drag to reorder ${col.label}`}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => onSort(col.id)}
                        className="inline-flex items-center gap-1 hover:text-[#236383] transition-colors"
                      >
                        {col.label}
                        <SortIcon column={col.id} sortColumn={sortColumn} sortDirection={sortDirection} />
                      </button>
                    </div>
                    {/* Resize handle — thin strip on the right edge. Stops
                        propagation so it doesn't trigger the sort button or
                        the drag handler. */}
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${col.label} column`}
                      draggable={false}
                      onMouseDown={(e) => handleResizeStart(e, col)}
                      onClick={(e) => e.stopPropagation()}
                      className={`absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[#236383]/40 active:bg-[#236383]/60 transition-colors ${
                        resizingColumn?.id === col.id ? 'bg-[#236383]/60' : ''
                      }`}
                      title="Drag to resize column"
                    />
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {recipients.map((recipient) => {
              const isInactive = recipient.status === 'inactive';
              const isHighlighted = highlightedId === recipient.id;
              const isSaving = savingId === recipient.id;

              // Per-row background class for the sticky Name cell. Without an
              // opaque background here, columns scrolling beneath would show through.
              const rowBgClass = isHighlighted
                ? 'bg-[#FFF7E6]'
                : isInactive
                  ? 'bg-slate-50'
                  : 'bg-white';

              return (
                <TableRow
                  key={recipient.id}
                  ref={isHighlighted ? highlightRowRef : undefined}
                  onClick={() => onRowClick(recipient)}
                  className={`group cursor-pointer transition-colors ${
                    isInactive ? 'text-slate-500 hover:bg-slate-100/80' : 'hover:bg-[#236383]/5'
                  } ${
                    isHighlighted
                      ? 'bg-[#FBAD3F]/10 ring-1 ring-inset ring-[#FBAD3F]/40'
                      : ''
                  }`}
                >
                  {/* Body cells rendered from the same orderedColumns the
                      header uses — keeps header and body cells aligned when
                      the user reorders columns by dragging. */}
                  {orderedColumns.map((col) => (
                    <TableCell key={col.id} className={getCellClassName(col.id, rowBgClass)}>
                      {renderCellContent(col.id, recipient, isSaving)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
