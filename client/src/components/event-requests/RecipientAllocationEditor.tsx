import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Building, Search, Loader2, Check, Star } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, applyPatchResponseToCache } from '@/lib/queryClient';
import { SANDWICH_TYPES } from './constants';

// Type for recipient allocation
export interface RecipientAllocation {
  recipientId: string;
  recipientName: string;
  sandwichCount: number;
  sandwichType?: string;
  notes?: string;
}

interface RecipientAllocationEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  eventName: string;
  estimatedSandwichCount?: number | null;
  currentAllocations?: RecipientAllocation[] | null;
}

export function RecipientAllocationEditor({
  open,
  onOpenChange,
  eventId,
  eventName,
  estimatedSandwichCount,
  currentAllocations,
}: RecipientAllocationEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [allocations, setAllocations] = useState<RecipientAllocation[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAllRecipients, setShowAllRecipients] = useState(false);

  // Fetch recipients
  const { data: recipients = [], isLoading: recipientsLoading, error: recipientsError } = useQuery<any[]>({
    queryKey: ['/api/recipients'],
    staleTime: 5 * 60 * 1000, // 5 minutes - reduce unnecessary refetches
  });

  // Initialize allocations from current data
  useEffect(() => {
    if (open) {
      if (currentAllocations && currentAllocations.length > 0) {
        setAllocations(currentAllocations);
      } else {
        setAllocations([]);
      }
      setSearchTerm('');
      setShowAllRecipients(false);
    }
  }, [open, currentAllocations]);

  // Get IDs of already-assigned recipients
  const assignedIds = useMemo(() =>
    new Set(allocations.map(a => a.recipientId)),
    [allocations]
  );

  // Filter and sort recipients - show unassigned first, then filter by search
  const { filteredRecipients, availableRecipients } = useMemo(() => {
    // Sort: active recipients first, then alphabetically
    const sorted = [...recipients].sort((a, b) => {
      // Active status first
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      // Then alphabetically
      return (a.name || '').localeCompare(b.name || '');
    });

    // Available = not already assigned
    const available = sorted.filter(r => !assignedIds.has(r.id.toString()));

    // Apply search filter if searching
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const filtered = available.filter(recipient =>
        recipient.name?.toLowerCase().includes(searchLower) ||
        recipient.contactName?.toLowerCase().includes(searchLower) ||
        recipient.address?.toLowerCase().includes(searchLower)
      );
      return { filteredRecipients: filtered, availableRecipients: available };
    }

    return { filteredRecipients: available, availableRecipients: available };
  }, [recipients, assignedIds, searchTerm]);

  // Calculate total allocated
  const totalAllocated = allocations.reduce((sum, a) => sum + (a.sandwichCount || 0), 0);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (allocations: RecipientAllocation[]) => {
      // Also update assignedRecipientIds to keep them in sync
      const assignedRecipientIds = allocations.map(a => a.recipientId);
      return apiRequest('PATCH', `/api/event-requests/${eventId}/recipients`, {
        assignedRecipientIds,
        recipientAllocations: allocations,
      });
    },
    onSuccess: (updatedEvent) => {
      toast({
        title: 'Allocations saved',
        description: 'Recipient allocations have been updated.',
      });
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        touchedFields: ['assignedRecipientIds', 'recipientAllocations'],
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save recipient allocations.',
        variant: 'destructive',
      });
    },
  });

  // Add a recipient to allocations
  const addRecipient = (recipient: any) => {
    // Check if already added
    if (allocations.some(a => a.recipientId === recipient.id.toString())) {
      toast({
        title: 'Already added',
        description: `${recipient.name} is already in the list.`,
        variant: 'destructive',
      });
      return;
    }

    setAllocations([
      ...allocations,
      {
        recipientId: recipient.id.toString(),
        recipientName: recipient.name,
        sandwichCount: 0,
        sandwichType: undefined,
        notes: undefined,
      },
    ]);
    setSearchTerm('');
  };

  // Remove a recipient from allocations
  const removeRecipient = (recipientId: string) => {
    setAllocations(allocations.filter(a => a.recipientId !== recipientId));
  };

  // Update allocation details
  const updateAllocation = (recipientId: string, updates: Partial<RecipientAllocation>) => {
    setAllocations(allocations.map(a =>
      a.recipientId === recipientId ? { ...a, ...updates } : a
    ));
  };

  // Handle save
  const handleSave = () => {
    // Filter out any allocations with 0 sandwiches
    const validAllocations = allocations.filter(a => a.sandwichCount > 0);
    saveMutation.mutate(validAllocations);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-y-auto flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Edit Recipient Allocations</DialogTitle>
          <DialogDescription>
            Assign sandwiches to recipients for: {eventName}
            {estimatedSandwichCount && (
              <span className="ml-2 font-medium">
                (Total estimated: {estimatedSandwichCount})
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Summary bar */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">
              Total allocated: <span className="text-lg">{totalAllocated}</span>
              {estimatedSandwichCount && (
                <span className={totalAllocated !== estimatedSandwichCount ? 'text-amber-600 ml-2' : 'text-tsp-teal ml-2'}>
                  / {estimatedSandwichCount}
                </span>
              )}
            </span>
            {allocations.length > 0 && (
              <Badge variant="outline">
                {allocations.length} recipient{allocations.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {/* Add recipient search */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Add Recipient</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Type to search recipients..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            {/* Show status/error messages */}
            {recipientsError && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
                Failed to load recipients. You may not have permission to view recipients.
              </div>
            )}
            {!recipientsError && !recipientsLoading && recipients.length === 0 && (
              <div className="p-3 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md">
                No recipients found in the system. Please add recipients first.
              </div>
            )}
            {/* Show search results when typing */}
            {searchTerm && (
              <ScrollArea className="h-32 border rounded-md">
                {recipientsLoading ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : filteredRecipients.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    No recipients match "{searchTerm}"
                  </div>
                ) : (
                  <div className="p-1">
                    {filteredRecipients.map((recipient) => (
                      <Button
                        key={recipient.id}
                        variant="ghost"
                        className="w-full justify-start text-left h-auto py-2"
                        onClick={() => addRecipient(recipient)}
                      >
                        <Building className="h-4 w-4 mr-2 shrink-0" />
                        <div className="truncate">
                          <span className="font-medium">{recipient.name}</span>
                          {recipient.contactName && (
                            <span className="text-muted-foreground ml-2">
                              ({recipient.contactName})
                            </span>
                          )}
                        </div>
                      </Button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            )}
            {/* Show hint when not searching and recipients exist */}
            {!searchTerm && !recipientsLoading && !recipientsError && recipients.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {recipients.length} recipient{recipients.length !== 1 ? 's' : ''} available. Start typing to search.
              </div>
            )}
          </div>

          {/* Current allocations */}
          <div className="flex-1 overflow-hidden">
            <label className="text-sm font-medium mb-2 block">Current Allocations</label>
            {allocations.length === 0 ? (
              <div className="border rounded-lg p-8 text-center text-muted-foreground">
                <Building className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No recipients assigned yet.</p>
                <p className="text-sm">Search above to add recipients.</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[40vh] border rounded-lg">
                <div className="p-2 space-y-2">
                  {allocations.map((allocation) => (
                    <div
                      key={allocation.recipientId}
                      className="border rounded-lg p-3 bg-card"
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <Building className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{allocation.recipientName}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => removeRecipient(allocation.recipientId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {/* Sandwich count */}
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Sandwich Count</label>
                          <Input
                            type="number"
                            min="0"
                            value={allocation.sandwichCount || ''}
                            onChange={(e) => updateAllocation(allocation.recipientId, {
                              sandwichCount: parseInt(e.target.value) || 0,
                            })}
                            onWheel={(e) => (e.target as HTMLInputElement).blur()}
                            placeholder="0"
                            className="h-9"
                          />
                        </div>

                        {/* Sandwich type (optional) */}
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Type (optional)</label>
                          <Select
                            value={allocation.sandwichType || 'none'}
                            onValueChange={(value) => updateAllocation(allocation.recipientId, {
                              sandwichType: value === 'none' ? undefined : value,
                            })}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Any type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Any type</SelectItem>
                              {SANDWICH_TYPES.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                  {type.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Notes (optional, collapsible) */}
                      <div className="mt-2">
                        <Input
                          placeholder="Add notes (optional)"
                          value={allocation.notes || ''}
                          onChange={(e) => updateAllocation(allocation.recipientId, {
                            notes: e.target.value || undefined,
                          })}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Allocations'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper function to format recipient allocations for display
export function formatRecipientAllocations(
  allocations: RecipientAllocation[] | null | undefined
): string {
  if (!allocations || allocations.length === 0) return '';

  return allocations
    .filter(a => a.sandwichCount > 0)
    .map(a => {
      const typeLabel = a.sandwichType
        ? SANDWICH_TYPES.find(t => t.value === a.sandwichType)?.label
        : null;

      let display = `${a.recipientName}: ${a.sandwichCount}`;
      if (typeLabel) {
        display += ` (${typeLabel})`;
      }
      return display;
    })
    .join(', ');
}

// Compact display component for cards/tables
export function RecipientAllocationDisplay({
  allocations,
  className = '',
}: {
  allocations: RecipientAllocation[] | null | undefined;
  className?: string;
}) {
  if (!allocations || allocations.length === 0) {
    return <span className={`text-muted-foreground ${className}`}>No recipients assigned</span>;
  }

  const validAllocations = allocations.filter(a => a.sandwichCount > 0);

  if (validAllocations.length === 0) {
    return <span className={`text-muted-foreground ${className}`}>No sandwiches allocated</span>;
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {validAllocations.map((allocation) => {
        const typeLabel = allocation.sandwichType
          ? SANDWICH_TYPES.find(t => t.value === allocation.sandwichType)?.label
          : null;

        return (
          <div key={allocation.recipientId} className="flex items-center gap-2 text-sm">
            <Building className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="font-medium truncate">{allocation.recipientName}</span>
            <Badge variant="secondary" className="shrink-0">
              {allocation.sandwichCount}
              {typeLabel && <span className="ml-1 opacity-70">{typeLabel}</span>}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

export default RecipientAllocationEditor;
