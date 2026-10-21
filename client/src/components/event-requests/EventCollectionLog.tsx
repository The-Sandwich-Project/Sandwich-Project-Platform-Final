import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Calendar, CheckCircle, Link2, Pencil, Unlink, X } from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { parseCollectionDate } from '@/lib/date-utils';
import { useToast } from '@/hooks/use-toast';
import { LINKED_COLLECTION_TOTALS_KEY } from './hooks/useLinkedCollectionTotals';

// Event Collection Log Component
//
// The collection-log groups linked to a single event request. One collection
// entry often lists several groups that each had their own event, so links are
// per group: admins tick which groups belong to this event (or the whole entry
// when the host is the organization). Suggested entries — dated the event day
// or the day after, with a similar group or host name — come pre-ticked with
// the closest match. Counts come from the collections log, the single source of
// truth for sandwich totals.
interface EventCollectionLogProps {
  eventRequest: EventRequest | null;
  isVisible: boolean;
  onClose: () => void;
}

/** One entry as returned by GET /api/event-requests/:id/collection-matches. */
interface EntryView {
  collectionId: number;
  collectionDate: string;
  hostName: string;
  individualSandwiches: number;
  entryTotal: number;
  groups: Array<{ index: number; name: string; department?: string; count: number; linkedEventId: number | null }>;
  wholeEntryLinkedEventId: number | null;
  linkedGroupIndexes: number[];
  legacyLink: boolean;
  score: number;
  suggestedGroupIndexes: number[];
  suggestWholeEntry: boolean;
  count: number;
  countedGroupNames: string[];
  wholeEntry: boolean;
  hasMissingGroup: boolean;
}

interface CollectionMatchesResponse {
  linked: EntryView[];
  suggestions: EntryView[];
  canLink: boolean;
  searchWindow: { start: string; end: string } | null;
}

interface Selection {
  groupIndexes: number[];
  wholeEntry: boolean;
}

function formatDate(dateString: string, long = false): string {
  const d = parseCollectionDate(dateString);
  if (!d) return dateString;
  return d.toLocaleDateString(
    'en-US',
    long
      ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
  );
}

function matchStrength(score: number): { label: string; className: string } {
  if (score >= 0.99) return { label: 'Exact name', className: 'bg-green-100 text-green-800' };
  if (score >= 0.85) return { label: 'Close name', className: 'bg-teal-100 text-teal-800' };
  return { label: 'Possible', className: 'bg-amber-100 text-amber-800' };
}

function selectionTotal(entry: EntryView, selection: Selection): number {
  if (selection.wholeEntry) return entry.entryTotal;
  return entry.groups
    .filter((g) => selection.groupIndexes.includes(g.index))
    .reduce((sum, g) => sum + g.count, 0);
}

/** Checkbox list for choosing which groups in an entry belong to the event. */
function GroupPicker({
  entry,
  eventId,
  selection,
  onChange,
}: {
  entry: EntryView;
  eventId: number;
  selection: Selection;
  onChange: (next: Selection) => void;
}) {
  const otherEventHasGroups = entry.groups.some(
    (g) => g.linkedEventId !== null && g.linkedEventId !== eventId
  );

  const toggleGroup = (index: number, checked: boolean) => {
    const groupIndexes = checked
      ? [...selection.groupIndexes, index]
      : selection.groupIndexes.filter((i) => i !== index);
    onChange({ groupIndexes, wholeEntry: false });
  };

  return (
    <div className="space-y-2">
      {entry.groups.map((g) => {
        const takenByOther = g.linkedEventId !== null && g.linkedEventId !== eventId;
        const id = `group-${entry.collectionId}-${g.index}`;
        return (
          <label
            key={g.index}
            htmlFor={id}
            className={`flex items-center gap-2 text-sm ${takenByOther ? 'text-gray-400' : 'cursor-pointer'}`}
          >
            <Checkbox
              id={id}
              checked={!selection.wholeEntry && selection.groupIndexes.includes(g.index)}
              disabled={takenByOther || selection.wholeEntry}
              onCheckedChange={(checked) => toggleGroup(g.index, checked === true)}
            />
            <span className="flex-1">
              {g.name || 'Unnamed group'}
              {g.department ? ` (${g.department})` : ''}
              {takenByOther && <span className="italic"> — linked to another event</span>}
            </span>
            <span className="font-medium tabular-nums">{g.count.toLocaleString()}</span>
          </label>
        );
      })}
      <label
        htmlFor={`whole-${entry.collectionId}`}
        className={`flex items-center gap-2 text-sm border-t pt-2 ${otherEventHasGroups ? 'text-gray-400' : 'cursor-pointer'}`}
      >
        <Checkbox
          id={`whole-${entry.collectionId}`}
          checked={selection.wholeEntry}
          disabled={otherEventHasGroups}
          onCheckedChange={(checked) =>
            onChange({ groupIndexes: [], wholeEntry: checked === true })
          }
        />
        <span className="flex-1">
          Whole entry{entry.individualSandwiches > 0 ? ', including individual sandwiches' : ''} — host is this
          organization
        </span>
        <span className="font-medium tabular-nums">{entry.entryTotal.toLocaleString()}</span>
      </label>
    </div>
  );
}

const EventCollectionLog: React.FC<EventCollectionLogProps> = ({
  eventRequest,
  isVisible,
  onClose,
}) => {
  const eventId = eventRequest?.id ?? 0;
  const matchesKey = `/api/event-requests/${eventId}/collection-matches`;
  const { data: matches, isLoading } = useQuery<CollectionMatchesResponse>({
    queryKey: [matchesKey],
    enabled: isVisible && !!eventRequest?.id,
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Per-entry picks the admin is editing, keyed by collection id.
  const [selections, setSelections] = useState<Record<number, Selection>>({});
  const [editingLinked, setEditingLinked] = useState<number | null>(null);

  const refreshAfterLinkChange = () => {
    queryClient.invalidateQueries({ queryKey: [matchesKey] });
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === LINKED_COLLECTION_TOTALS_KEY,
    });
  };

  const linkMutation = useMutation({
    mutationFn: ({ collectionId, selection }: { collectionId: number; selection: Selection }) =>
      apiRequest('PUT', `/api/event-requests/${eventId}/collections/${collectionId}/link`, selection),
    onSuccess: (_data, { collectionId }) => {
      refreshAfterLinkChange();
      setSelections((prev) => {
        const next = { ...prev };
        delete next[collectionId];
        return next;
      });
      setEditingLinked(null);
      toast({ title: 'Saved', description: 'Collection log link saved.' });
    },
    onError: (error: any) => {
      toast({
        title: 'Could not link',
        description: error?.message || 'Failed to link collection entry.',
        variant: 'destructive',
      });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (collectionId: number) =>
      apiRequest('DELETE', `/api/event-requests/${eventId}/collections/${collectionId}/link`),
    onSuccess: () => {
      refreshAfterLinkChange();
      setEditingLinked(null);
      toast({ title: 'Unlinked', description: 'Collection entry is no longer linked to this event.' });
    },
    onError: (error: any) => {
      toast({
        title: 'Could not unlink',
        description: error?.message || 'Failed to unlink collection entry.',
        variant: 'destructive',
      });
    },
  });

  if (!isVisible || !eventRequest) return null;

  const linked = matches?.linked ?? [];
  const suggestions = matches?.suggestions ?? [];
  const canLink = !!matches?.canLink;
  const busy = linkMutation.isPending || unlinkMutation.isPending;
  const totalSandwiches = linked.reduce((sum, e) => sum + e.count, 0);

  const selectionFor = (entry: EntryView, fromLinked: boolean): Selection =>
    selections[entry.collectionId] ??
    (fromLinked
      ? { groupIndexes: entry.linkedGroupIndexes, wholeEntry: entry.wholeEntry }
      : { groupIndexes: entry.suggestedGroupIndexes, wholeEntry: entry.suggestWholeEntry });

  const setSelection = (collectionId: number, selection: Selection) =>
    setSelections((prev) => ({ ...prev, [collectionId]: selection }));

  const saveButton = (entry: EntryView, selection: Selection, label: string) => {
    const empty = !selection.wholeEntry && selection.groupIndexes.length === 0;
    return (
      <Button
        size="sm"
        className="bg-[#007e8c] hover:bg-[#236383] text-white"
        disabled={busy || empty}
        onClick={() => linkMutation.mutate({ collectionId: entry.collectionId, selection })}
      >
        <Link2 className="w-4 h-4 mr-1" />
        {label} ({selectionTotal(entry, selection).toLocaleString()})
      </Button>
    );
  };

  return (
    <div
      className="fixed inset-0 bg-[#236383] bg-opacity-50 z-50 flex items-center justify-center p-4"
      style={{
        left: window.innerWidth > 768 ? 240 : 0, // 240px nav bar width on desktop
        width: window.innerWidth > 768 ? `calc(100vw - 240px)` : '100vw',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">
                Collection Log for {eventRequest.organizationName}
              </h2>
              <p className="text-[#236383]">
                {eventRequest.firstName} {eventRequest.lastName}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              data-testid="button-close-collection-log"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <span className="text-2xl">🥪</span>
                  <div>
                    <p className="text-sm text-[#236383]">Sandwiches Logged</p>
                    <p className="text-2xl font-bold text-brand-primary">
                      {totalSandwiches.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="text-sm text-[#236383]">Linked Entries</p>
                    <p className="text-2xl font-bold text-brand-teal">{linked.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Linked entries */}
          {isLoading ? (
            <p className="text-center py-8 text-gray-500">Loading…</p>
          ) : linked.length > 0 ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Linked collection entries</h3>
              {linked.map((entry) => {
                const editing = canLink && editingLinked === entry.collectionId;
                const selection = selectionFor(entry, true);
                return (
                  <Card key={entry.collectionId} className="p-4">
                    <div className="space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                        <div className="flex items-center space-x-2">
                          <Calendar className="w-5 h-5 text-brand-primary flex-shrink-0" />
                          <span className="font-medium text-sm sm:text-base">
                            {formatDate(entry.collectionDate, true)}
                          </span>
                        </div>
                        <Badge
                          variant="secondary"
                          className="bg-brand-primary text-white self-start sm:self-auto"
                        >
                          {entry.count.toLocaleString()} sandwiches
                        </Badge>
                        {canLink && !editing && (
                          <div className="flex gap-1 sm:ml-auto">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-gray-500"
                              disabled={busy}
                              onClick={() => setEditingLinked(entry.collectionId)}
                            >
                              <Pencil className="w-3 h-3 mr-1" />
                              Change groups
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-gray-500 hover:text-red-600"
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm('Unlink this collection entry from the event?')) {
                                  unlinkMutation.mutate(entry.collectionId);
                                }
                              }}
                            >
                              <Unlink className="w-3 h-3 mr-1" />
                              Unlink
                            </Button>
                          </div>
                        )}
                      </div>

                      <p className="text-sm text-[#236383] pl-7">
                        <strong>Host:</strong> {entry.hostName}
                      </p>

                      {!editing && (
                        <p className="text-xs text-gray-500 pl-7">
                          {entry.wholeEntry
                            ? 'Counting the whole entry.'
                            : `Counting: ${entry.countedGroupNames.join(', ') || 'nothing'}.`}
                          {!entry.wholeEntry && entry.count !== entry.entryTotal
                            ? ` Whole entry: ${entry.entryTotal.toLocaleString()} sandwiches.`
                            : ''}
                        </p>
                      )}

                      {entry.hasMissingGroup && (
                        <p className="text-xs text-amber-700 pl-7 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          A linked group isn't in this entry anymore (it was edited). Re-pick the groups.
                        </p>
                      )}

                      {editing && (
                        <div className="pl-7 space-y-3">
                          <GroupPicker
                            entry={entry}
                            eventId={eventId}
                            selection={selection}
                            onChange={(next) => setSelection(entry.collectionId, next)}
                          />
                          <div className="flex gap-2">
                            {saveButton(entry, selection, 'Save')}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setEditingLinked(null);
                                setSelections((prev) => {
                                  const next = { ...prev };
                                  delete next[entry.collectionId];
                                  return next;
                                });
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-[#236383] mb-2">
                No collection log entry is linked to this event yet.
              </p>
              {matches && !canLink && (
                <p className="text-sm text-gray-500">An admin can link the matching entry.</p>
              )}
            </div>
          )}

          {/* Suggested entries (admins only) */}
          {canLink && (
            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-semibold">Suggested matches</h3>
              {matches?.searchWindow ? (
                <p className="text-xs text-gray-500">
                  Entries from {formatDate(matches.searchWindow.start)} to{' '}
                  {formatDate(matches.searchWindow.end)} with a group or host name similar to{' '}
                  <strong>{eventRequest.organizationName}</strong>. The closest match is ticked —
                  check which groups belong to this event before linking.
                </p>
              ) : (
                <p className="text-xs text-gray-500">
                  This event has no date, so there's nothing to match against.
                </p>
              )}
              {suggestions.length === 0 && matches?.searchWindow && (
                <p className="text-sm text-gray-500 italic">No likely matches found.</p>
              )}
              {suggestions.map((entry) => {
                const strength = matchStrength(entry.score);
                const selection = selectionFor(entry, false);
                return (
                  <Card key={entry.collectionId} className="p-4 border-dashed">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{formatDate(entry.collectionDate)}</span>
                        <Badge variant="secondary" className={strength.className}>
                          {strength.label}
                        </Badge>
                        <span className="text-sm text-[#236383]">
                          <strong>Host:</strong> {entry.hostName}
                        </span>
                      </div>
                      <GroupPicker
                        entry={entry}
                        eventId={eventId}
                        selection={selection}
                        onChange={(next) => setSelection(entry.collectionId, next)}
                      />
                      {saveButton(entry, selection, 'Link')}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventCollectionLog;
