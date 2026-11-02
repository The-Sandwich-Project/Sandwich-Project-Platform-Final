/**
 * Inline editor for recipient sandwich allocations
 * Appears directly in the card for quick editing without opening a dialog
 */
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Building, Check, X, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, applyPatchResponseToCache } from '@/lib/queryClient';
import type { RecipientAllocation } from './RecipientAllocationEditor';

interface InlineRecipientAllocationEditorProps {
  eventId: number;
  assignedRecipientIds: string[];
  currentAllocations: RecipientAllocation[] | null | undefined;
  estimatedSandwichCount?: number | null;
  resolveRecipientName: (id: string) => { name: string; type: string };
  onCancel: () => void;
  onSave: () => void;
}

export function InlineRecipientAllocationEditor({
  eventId,
  assignedRecipientIds,
  currentAllocations,
  estimatedSandwichCount,
  resolveRecipientName,
  onCancel,
  onSave,
}: InlineRecipientAllocationEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Initialize allocations from current data or create new ones from assigned IDs
  const [allocations, setAllocations] = useState<RecipientAllocation[]>(() => {
    if (currentAllocations && currentAllocations.length > 0) {
      return currentAllocations;
    }
    // Create allocations for each assigned recipient
    return assignedRecipientIds.map(id => {
      const { name } = resolveRecipientName(id);
      return {
        recipientId: id,
        recipientName: name,
        sandwichCount: 0,
      };
    });
  });

  // Update allocations if assigned recipients change
  useEffect(() => {
    setAllocations(prev => {
      // Keep existing allocations, add new ones for any new recipients
      const existingIds = new Set(prev.map(a => a.recipientId));
      const newAllocations = assignedRecipientIds
        .filter(id => !existingIds.has(id))
        .map(id => {
          const { name } = resolveRecipientName(id);
          return {
            recipientId: id,
            recipientName: name,
            sandwichCount: 0,
          };
        });

      // Remove allocations for recipients that are no longer assigned
      const assignedSet = new Set(assignedRecipientIds);
      const filtered = prev.filter(a => assignedSet.has(a.recipientId));

      return [...filtered, ...newAllocations];
    });
  }, [assignedRecipientIds, resolveRecipientName]);

  // Calculate total allocated
  const totalAllocated = allocations.reduce((sum, a) => sum + (a.sandwichCount || 0), 0);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (allocations: RecipientAllocation[]) => {
      return apiRequest('PATCH', `/api/event-requests/${eventId}/recipients`, {
        assignedRecipientIds,
        recipientAllocations: allocations.filter(a => a.sandwichCount > 0),
      });
    },
    onSuccess: (updatedEvent) => {
      toast({
        title: 'Allocations saved',
        description: 'Recipient sandwich counts have been updated.',
      });
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        touchedFields: ['assignedRecipientIds', 'recipientAllocations'],
      });
      onSave();
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save recipient allocations.',
        variant: 'destructive',
      });
    },
  });

  // Update a single allocation
  const updateCount = (recipientId: string, count: number) => {
    setAllocations(prev =>
      prev.map(a =>
        a.recipientId === recipientId ? { ...a, sandwichCount: count } : a
      )
    );
  };

  // Handle save
  const handleSave = () => {
    saveMutation.mutate(allocations);
  };

  if (assignedRecipientIds.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-2 bg-muted rounded">
        No recipients assigned. Add recipients first to set allocations.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 bg-white border rounded-lg shadow-sm">
      {/* Header with total */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">
          Sandwich Allocations
        </span>
        <div className="flex items-center gap-2">
          <span className={`font-medium ${
            estimatedSandwichCount && totalAllocated !== estimatedSandwichCount
              ? 'text-amber-600'
              : 'text-tsp-teal'
          }`}>
            Total: {totalAllocated}
            {estimatedSandwichCount && ` / ${estimatedSandwichCount}`}
          </span>
        </div>
      </div>

      {/* Allocation inputs */}
      <div className="space-y-2">
        {allocations.map((allocation) => (
          <div
            key={allocation.recipientId}
            className="flex items-center gap-2 p-2 bg-gray-50 rounded"
          >
            <Building className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="flex-1 text-sm font-medium truncate min-w-0">
              {allocation.recipientName}
            </span>
            <Input
              type="number"
              min="0"
              value={allocation.sandwichCount || ''}
              onChange={(e) => updateCount(allocation.recipientId, parseInt(e.target.value) || 0)}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              placeholder="0"
              className="w-20 h-8 text-sm text-center"
            />
            <span className="text-xs text-gray-500 w-16">sandwiches</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={saveMutation.isPending}
          className="h-7"
        >
          <X className="w-3 h-3 mr-1" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="h-7 bg-tsp-teal hover:bg-[#1a4a63]"
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <Check className="w-3 h-3 mr-1" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}

export default InlineRecipientAllocationEditor;
