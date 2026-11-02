import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { applyEventRequestUpdateById } from '@/lib/queryClient';
import { FileSpreadsheet, Check, Loader2, ChevronDown, ChevronUp, AlertTriangle, AlertCircle, ArrowRight, RefreshCw, Equal } from 'lucide-react';

interface PushToSheetButtonProps {
  eventId: number;
  organizationName: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  /** When true, render an inline "Push to Sheet" text label next to the icon. Defaults to icon-only. */
  showLabel?: boolean;
  /**
   * The event is already on the planning sheet (addedToOfficialSheet). The
   * button then reads "Update Sheet" so people know it sends later changes to
   * the existing row, not just new events.
   */
  isOnSheet?: boolean;
}

type MergeDecision = 'use_app' | 'keep_sheet' | 'append';

interface ColumnConflict {
  columnIndex: number;
  columnLabel: string;
  appValue: string;
  sheetValue: string;
}

const COLUMN_LABELS: Record<number, string> = {
  0: 'Date',
  1: 'Day of Week',
  2: 'Group Name',
  3: 'Event Start Time',
  4: 'Event End Time',
  5: 'Pick Up Time',
  6: 'Pick Up Next Day?',
  7: 'All Details',
  8: 'Van Booked?',
  9: 'Van needed for?',
  10: 'Staffing',
  11: 'Estimate # Sandwiches',
  12: 'Deli or PBJ?',
  13: 'Final # Sandwiches',
  14: 'Total in App?',
  15: 'Social Post',
  16: 'Sent Toolkit?',
  17: 'Contact Name',
  18: 'Email',
  19: 'Phone',
  20: 'TSP Contact',
  21: 'Address',
  22: 'Recipient/Host',
  23: 'After Event Notes',
  24: 'Cancelled',
  25: 'Notes',
  26: "Add'l Notes",
  27: 'Waiting On',
};

// Keep ProposeToSheetButton as an alias for backward compatibility
export { PushToSheetButton as ProposeToSheetButton };

export function PushToSheetButton({
  eventId,
  organizationName,
  variant = 'ghost',
  size = 'sm',
  className = '',
  showLabel = false,
  isOnSheet = false,
}: PushToSheetButtonProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [mergeDecisions, setMergeDecisions] = useState<Record<number, MergeDecision>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch preview data when dialog opens
  const { data: previewData, isLoading: previewLoading, refetch: refetchPreview } = useQuery({
    queryKey: ['planning-sheet-preview', eventId],
    queryFn: async () => {
      const res = await fetch(`/api/planning-sheet-proposals/preview/${eventId}`);
      if (!res.ok) throw new Error('Failed to load preview');
      return res.json();
    },
    enabled: showDialog,
  });

  const hasExistingRow = previewData?.existingSheetRow;
  const hasExistingRawData = previewData?.existingRawData;
  const hasPotentialDuplicates = previewData?.potentialMatches?.length > 0;

  // Compute conflicts between app data and sheet data
  const conflicts = useMemo((): ColumnConflict[] => {
    if (!previewData?.rawData || !previewData?.existingRawData) return [];

    const result: ColumnConflict[] = [];
    // Sheet columns through AB/"Waiting On" (index 27).
    const columnCount = Object.keys(COLUMN_LABELS).length;
    for (let i = 0; i < columnCount; i++) {
      const appValue = (previewData.rawData[i] || '').trim();
      const sheetValue = (previewData.existingRawData[i] || '').trim();
      if (appValue !== sheetValue) {
        result.push({
          columnIndex: i,
          columnLabel: COLUMN_LABELS[i] || `Column ${i}`,
          appValue,
          sheetValue,
        });
      }
    }
    return result;
  }, [previewData?.rawData, previewData?.existingRawData]);

  // Initialize smart defaults when conflicts change
  useEffect(() => {
    if (conflicts.length === 0) return;

    const defaults: Record<number, MergeDecision> = {};
    for (const conflict of conflicts) {
      if (conflict.appValue && !conflict.sheetValue) {
        defaults[conflict.columnIndex] = 'use_app';
      } else if (conflict.sheetValue && !conflict.appValue) {
        defaults[conflict.columnIndex] = 'keep_sheet';
      } else {
        defaults[conflict.columnIndex] = 'use_app';
      }
    }
    setMergeDecisions(defaults);
  }, [conflicts]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!showDialog) {
      setMergeDecisions({});
      setShowUnchanged(false);
      setShowAllFields(false);
    }
  }, [showDialog]);

  // Build merge decisions for the API (convert number keys to string keys)
  const apiMergeDecisions = useMemo(() => {
    const result: Record<string, MergeDecision> = {};
    for (const [key, value] of Object.entries(mergeDecisions)) {
      result[String(key)] = value;
    }
    return result;
  }, [mergeDecisions]);

  // Direct push mutation
  const pushMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (hasExistingRow && hasExistingRawData && Object.keys(apiMergeDecisions).length > 0) {
        body.mergeDecisions = apiMergeDecisions;
      }
      const res = await fetch(`/api/planning-sheet-proposals/push-event/${eventId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to push to sheet');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Successfully pushed to Planning Sheet!',
        description: data.isUpdate
          ? `Updated row ${data.rowIndex} in the Planning Sheet.`
          : [`Added new row ${data.rowIndex} to the Planning Sheet.`, data.placementNote]
              .filter(Boolean)
              .join(' '),
      });
      queryClient.invalidateQueries({ queryKey: ['planning-sheet-preview', eventId] });
      // Server marks addedToOfficialSheet=true — fetch once and patch caches surgically.
      void applyEventRequestUpdateById(queryClient, eventId);
      setShowDialog(false);
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to push to sheet',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const getKeyFields = (rawData: string[]) => [
    { label: 'Date', value: rawData[0] },
    { label: 'Group', value: rawData[2] },
    { label: 'Staffing', value: rawData[10] },
    { label: 'Est. Sandwiches', value: rawData[11] },
    { label: 'Contact', value: rawData[17] },
  ].filter(f => f.value);

  const setDecision = (columnIndex: number, decision: MergeDecision) => {
    setMergeDecisions(prev => ({ ...prev, [columnIndex]: decision }));
  };

  const unchangedCount = hasExistingRawData ? Object.keys(COLUMN_LABELS).length - conflicts.length : 0;
  const allMatch = hasExistingRow && hasExistingRawData && conflicts.length === 0;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size={size}
            variant={variant}
            onClick={() => setShowDialog(true)}
            className={`text-blue-600 hover:text-blue-700 hover:bg-blue-50 ${className}`}
            data-testid="button-push-to-sheet"
          >
            <FileSpreadsheet className={`w-4 h-4 ${showLabel ? 'mr-1' : ''}`} />
            {showLabel && <span>{isOnSheet ? 'Update Sheet' : 'Push to Sheet'}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isOnSheet
            ? "Send this event's latest changes to its row on the Planning Sheet"
            : 'Add this event to the Planning Sheet'}
        </TooltipContent>
      </Tooltip>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              {hasExistingRow || isOnSheet ? 'Update Planning Sheet' : 'Push to Planning Sheet'}
            </DialogTitle>
            <DialogDescription>
              Review what will change on the Planning Sheet, then confirm. If the event is
              already on the sheet, this updates its existing row.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">{organizationName}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchPreview()}
                disabled={previewLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${previewLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading preview...</span>
              </div>
            ) : previewData?.rawData ? (
              <div className="space-y-4">
                {/* === UPDATE MODE with existingRawData: conflict resolution === */}
                {hasExistingRow && hasExistingRawData ? (
                  <>
                    {allMatch ? (
                      <Alert className="bg-green-50 border-green-300">
                        <Equal className="h-4 w-4 text-green-600" />
                        <AlertTitle className="text-green-800">All values match</AlertTitle>
                        <AlertDescription className="text-green-700">
                          Row {previewData.existingSheetRow.rowIndex} already has the same data as the app. Nothing to update.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        <Alert className="bg-amber-50 border-amber-300">
                          <RefreshCw className="h-4 w-4 text-amber-600" />
                          <AlertTitle className="text-amber-800">
                            Row {previewData.existingSheetRow.rowIndex} exists — review differences below
                          </AlertTitle>
                          <AlertDescription className="text-amber-700">
                            {conflicts.length} column{conflicts.length !== 1 ? 's' : ''} differ{conflicts.length === 1 ? 's' : ''} between the app and the sheet.
                            Choose how to handle each difference.
                          </AlertDescription>
                        </Alert>

                        {/* Summary bar */}
                        <div className="flex items-center justify-between text-sm text-gray-600">
                          <span>
                            <strong className="text-amber-700">{conflicts.length}</strong> column{conflicts.length !== 1 ? 's' : ''} changed
                            {unchangedCount > 0 && (
                              <>, <strong className="text-gray-500">{unchangedCount}</strong> unchanged</>
                            )}
                          </span>
                          {unchangedCount > 0 && (
                            <button
                              onClick={() => setShowUnchanged(!showUnchanged)}
                              className="text-blue-600 hover:text-blue-700 hover:underline text-xs"
                            >
                              {showUnchanged ? 'Hide unchanged' : 'Show unchanged'}
                            </button>
                          )}
                        </div>

                        {/* Bulk actions */}
                        <div className="flex gap-2 text-xs">
                          <button
                            onClick={() => {
                              const all: Record<number, MergeDecision> = {};
                              conflicts.forEach(c => { all[c.columnIndex] = 'use_app'; });
                              setMergeDecisions(all);
                            }}
                            className="px-2 py-1 rounded border border-gray-300 hover:bg-green-50 hover:border-green-300 text-gray-600 hover:text-green-700"
                          >
                            Use App for all
                          </button>
                          <button
                            onClick={() => {
                              const all: Record<number, MergeDecision> = {};
                              conflicts.forEach(c => { all[c.columnIndex] = 'keep_sheet'; });
                              setMergeDecisions(all);
                            }}
                            className="px-2 py-1 rounded border border-gray-300 hover:bg-blue-50 hover:border-blue-300 text-gray-600 hover:text-blue-700"
                          >
                            Keep Sheet for all
                          </button>
                        </div>

                        {/* Conflict resolution table */}
                        <div className="border rounded-lg overflow-hidden">
                          <div className="divide-y divide-gray-200 max-h-[40vh] overflow-y-auto">
                            {conflicts.map((conflict) => {
                              const decision = mergeDecisions[conflict.columnIndex] || 'use_app';
                              const bothHaveValues = !!conflict.appValue && !!conflict.sheetValue;

                              return (
                                <div key={conflict.columnIndex} className="p-3 bg-white hover:bg-gray-50">
                                  {/* Column name + badge */}
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="font-medium text-sm text-gray-800">
                                      {conflict.columnLabel}
                                    </span>
                                    <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">
                                      Changed
                                    </Badge>
                                  </div>

                                  {/* Side by side values */}
                                  <div className="grid grid-cols-2 gap-2 mb-2">
                                    <button
                                      onClick={() => setDecision(conflict.columnIndex, 'keep_sheet')}
                                      className={`text-left p-2 rounded border text-xs transition-colors ${
                                        decision === 'keep_sheet'
                                          ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300'
                                          : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/50'
                                      }`}
                                    >
                                      <div className="text-[10px] uppercase tracking-wide font-semibold text-blue-600 mb-1">
                                        Sheet value
                                      </div>
                                      <div className="text-gray-800 break-words">
                                        {conflict.sheetValue || <span className="text-gray-400 italic">(empty)</span>}
                                      </div>
                                    </button>
                                    <button
                                      onClick={() => setDecision(conflict.columnIndex, 'use_app')}
                                      className={`text-left p-2 rounded border text-xs transition-colors ${
                                        decision === 'use_app'
                                          ? 'bg-green-50 border-green-400 ring-1 ring-green-300'
                                          : 'border-gray-200 hover:border-green-200 hover:bg-green-50/50'
                                      }`}
                                    >
                                      <div className="text-[10px] uppercase tracking-wide font-semibold text-green-600 mb-1">
                                        App value
                                      </div>
                                      <div className="text-gray-800 break-words">
                                        {conflict.appValue || <span className="text-gray-400 italic">(empty)</span>}
                                      </div>
                                    </button>
                                  </div>

                                  {/* Action buttons */}
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => setDecision(conflict.columnIndex, 'keep_sheet')}
                                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                        decision === 'keep_sheet'
                                          ? 'bg-blue-600 text-white'
                                          : 'bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700'
                                      }`}
                                    >
                                      Keep Sheet
                                    </button>
                                    <button
                                      onClick={() => setDecision(conflict.columnIndex, 'use_app')}
                                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                        decision === 'use_app'
                                          ? 'bg-green-600 text-white'
                                          : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700'
                                      }`}
                                    >
                                      Use App
                                    </button>
                                    {bothHaveValues && (
                                      <button
                                        onClick={() => setDecision(conflict.columnIndex, 'append')}
                                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                          decision === 'append'
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-purple-100 hover:text-purple-700'
                                        }`}
                                      >
                                        Append
                                      </button>
                                    )}
                                  </div>

                                  {/* Append preview */}
                                  {decision === 'append' && bothHaveValues && (
                                    <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-800">
                                      <span className="font-medium">Result: </span>
                                      {conflict.sheetValue} | {conflict.appValue}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* Unchanged columns (collapsible) */}
                            {showUnchanged && previewData.existingRawData && (
                              <>
                                <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                                  Unchanged columns
                                </div>
                                {Array.from({ length: Object.keys(COLUMN_LABELS).length }, (_, i) => i)
                                  .filter(i => {
                                    const appVal = (previewData.rawData[i] || '').trim();
                                    const sheetVal = (previewData.existingRawData[i] || '').trim();
                                    return appVal === sheetVal && (appVal || sheetVal);
                                  })
                                  .map(i => (
                                    <div key={i} className="px-3 py-2 text-xs text-gray-500 flex items-center gap-2">
                                      <Equal className="w-3 h-3 text-gray-400" />
                                      <span className="font-medium w-36">{COLUMN_LABELS[i] || `Column ${i}`}</span>
                                      <span className="text-gray-600 truncate">
                                        {(previewData.rawData[i] || '').trim() || '(empty)'}
                                      </span>
                                    </div>
                                  ))}
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </>

                ) : hasExistingRow ? (
                  /* UPDATE MODE without existingRawData (fallback — old behavior) */
                  <>
                    <Alert className="bg-amber-50 border-amber-300">
                      <RefreshCw className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-amber-800">This will UPDATE an existing row</AlertTitle>
                      <AlertDescription className="text-amber-700">
                        Row {previewData.existingSheetRow.rowIndex} already exists for this event.
                        Pushing will overwrite the existing data with the values shown below.
                      </AlertDescription>
                    </Alert>

                    {/* Key fields summary */}
                    <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                      <div className="flex items-center gap-2 mb-3">
                        <ArrowRight className="w-4 h-4 text-blue-600" />
                        <span className="font-medium text-blue-800">New values to write:</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {getKeyFields(previewData.rawData).map((field, i) => (
                          <span key={i} className="text-sm bg-white px-3 py-1.5 rounded border border-blue-200 shadow-sm">
                            <strong className="text-blue-700">{field.label}:</strong>{' '}
                            <span className="text-gray-800">{field.value}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </>

                ) : hasPotentialDuplicates ? (
                  /* POTENTIAL DUPLICATE MODE */
                  <>
                    <Alert className="bg-yellow-50 border-yellow-300">
                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      <AlertTitle className="text-yellow-800">Possible duplicates detected</AlertTitle>
                      <AlertDescription className="text-yellow-700">
                        <p className="mb-2">Similar rows found in the sheet. This will add a NEW row:</p>
                        <div className="space-y-1 text-sm">
                          {previewData.potentialMatches.map((match: any, i: number) => (
                            <div key={i} className="bg-yellow-100 px-2 py-1 rounded">
                              Row {match.rowIndex}: <strong>{match.groupName}</strong> - {match.date}
                            </div>
                          ))}
                        </div>
                      </AlertDescription>
                    </Alert>

                    {/* Key fields summary */}
                    <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                      <div className="flex items-center gap-2 mb-3">
                        <ArrowRight className="w-4 h-4 text-blue-600" />
                        <span className="font-medium text-blue-800">Data to add:</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {getKeyFields(previewData.rawData).map((field, i) => (
                          <span key={i} className="text-sm bg-white px-3 py-1.5 rounded border border-blue-200 shadow-sm">
                            <strong className="text-blue-700">{field.label}:</strong>{' '}
                            <span className="text-gray-800">{field.value}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </>

                ) : (
                  /* NEW ROW MODE */
                  <>
                    <Alert className="bg-green-50 border-green-300">
                      <Check className="h-4 w-4 text-green-600" />
                      <AlertTitle className="text-green-800">Adding a new row</AlertTitle>
                      <AlertDescription className="text-green-700">
                        No existing row found for this event. A new row will be added to the Planning Sheet.
                      </AlertDescription>
                    </Alert>

                    {/* Key fields summary */}
                    <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                      <div className="flex items-center gap-2 mb-3">
                        <ArrowRight className="w-4 h-4 text-blue-600" />
                        <span className="font-medium text-blue-800">Data to add:</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {getKeyFields(previewData.rawData).map((field, i) => (
                          <span key={i} className="text-sm bg-white px-3 py-1.5 rounded border border-blue-200 shadow-sm">
                            <strong className="text-blue-700">{field.label}:</strong>{' '}
                            <span className="text-gray-800">{field.value}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Where the new row will land. The sheet is read as a
                    calendar, grouped into weeks, so a row landing outside its
                    week needs to be visible before the push rather than
                    discovered in the sheet afterwards. */}
                {previewData.placement && (() => {
                  const placement = previewData.placement;
                  const needsAttention =
                    placement.outOfOrderRows?.length > 0 ||
                    placement.reason === 'append_no_dated_rows';

                  const title = placement.insertBeforeRow
                    ? placement.weekBlock && placement.reason === 'insert_in_week_block'
                      ? `Goes in at row ${placement.insertBeforeRow}, under "Week of ${placement.weekBlock.label}"`
                      : `Goes in at row ${placement.insertBeforeRow}`
                    : placement.reason === 'append_no_dated_rows'
                      ? 'Goes at the bottom of the sheet, not in date order'
                      : 'Goes at the end of the sheet';

                  return (
                    <Alert
                      className={
                        needsAttention
                          ? 'bg-amber-50 border-amber-300'
                          : 'bg-blue-50 border-blue-200'
                      }
                    >
                      {needsAttention ? (
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                      ) : (
                        <ArrowRight className="h-4 w-4 text-blue-600" />
                      )}
                      <AlertTitle
                        className={needsAttention ? 'text-amber-800' : 'text-blue-800'}
                      >
                        {title}
                      </AlertTitle>
                      <AlertDescription
                        className={needsAttention ? 'text-amber-700' : 'text-blue-700'}
                      >
                        {placement.note}
                      </AlertDescription>
                    </Alert>
                  );
                })()}

                {/* Full field list (for non-conflict modes: new row, potential duplicates, fallback update) */}
                {!(hasExistingRow && hasExistingRawData) && (
                  <div className="border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setShowAllFields(!showAllFields)}
                      className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      <span className="font-medium text-gray-700">View all {previewData.rawData.filter(Boolean).length} fields</span>
                      {showAllFields ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {showAllFields && (
                      <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                        {previewData.rawData.map((value: string, idx: number) => {
                          if (!value) return null;
                          return (
                            <div key={idx} className="flex border-b border-gray-200 pb-2 text-sm">
                              <span className="font-medium text-gray-600 w-40 flex-shrink-0">
                                {COLUMN_LABELS[idx] || `Column ${idx}`}
                              </span>
                              <span className="text-gray-900">{value}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Unable to load preview</AlertTitle>
                <AlertDescription>
                  Could not fetch the event data. Please try again or contact support.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => pushMutation.mutate()}
              disabled={pushMutation.isPending || previewLoading || !previewData?.rawData || allMatch}
              className=""
            >
              {pushMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Pushing...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  {hasExistingRow ? 'Update Row' : 'Add to Sheet'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
