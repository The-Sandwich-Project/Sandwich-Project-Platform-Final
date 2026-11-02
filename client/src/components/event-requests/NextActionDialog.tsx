import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, applyPatchResponseToCache } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface NextActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequest: EventRequest | null;
  mode: 'add' | 'edit' | 'complete';
  onActionSaved?: () => void;
}

const NextActionDialog: React.FC<NextActionDialogProps> = ({
  isOpen,
  onClose,
  eventRequest,
  mode,
  onActionSaved,
}) => {
  const [nextAction, setNextAction] = useState('');
  const [actionResult, setActionResult] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Initialize form when dialog opens
  useEffect(() => {
    if (isOpen && eventRequest) {
      if (mode === 'edit' || mode === 'complete') {
        setNextAction(eventRequest.nextAction || '');
      } else {
        setNextAction('');
      }
      setActionResult('');
    }
  }, [isOpen, eventRequest, mode]);

  const updateNextActionMutation = useMutation({
    mutationFn: async (data: { nextAction?: string | null; actionResult?: string }) => {
      if (!eventRequest?.id) throw new Error('Event request ID required');
      
      const updateData: any = {};
      if (data.nextAction !== undefined) {
        updateData.nextAction = data.nextAction;
        updateData.nextActionUpdatedAt = new Date().toISOString();
      }
      
      // Store action result in planning notes
      if (data.actionResult) {
        const currentNotes = eventRequest.planningNotes || '';
        const timestamp = new Date().toLocaleString();
        const resultEntry = `\n\n[Action Completed ${timestamp}]\nPrevious Action: ${eventRequest.nextAction}\nResult: ${data.actionResult}`;
        updateData.planningNotes = currentNotes + resultEntry;
        updateData.nextAction = null; // Clear next action after completion
      }
      
      return apiRequest('PUT', `/api/event-requests/${eventRequest.id}`, updateData);
    },
    onSuccess: (updatedEvent, variables) => {
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: eventRequest.status,
        touchedFields: ['nextAction', 'nextActionUpdatedAt', 'planningNotes'],
      });
      toast({
        title: mode === 'complete' ? 'Action marked complete' : 'Next action saved',
        description: mode === 'complete' 
          ? 'The action has been marked complete and results recorded.'
          : 'The next action has been saved.',
      });
      onActionSaved?.();
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to save next action',
        variant: 'destructive',
      });
    },
  });

  const handleClose = () => {
    setNextAction('');
    setActionResult('');
    onClose();
  };

  const handleSubmit = () => {
    if (mode === 'complete') {
      if (!actionResult.trim()) {
        toast({
          title: 'Result required',
          description: 'Please record the results of this action.',
          variant: 'destructive',
        });
        return;
      }
      updateNextActionMutation.mutate({ actionResult: actionResult.trim() });
    } else {
      if (!nextAction.trim()) {
        toast({
          title: 'Action required',
          description: 'Please enter a next action.',
          variant: 'destructive',
        });
        return;
      }
      updateNextActionMutation.mutate({ nextAction: nextAction.trim() });
    }
  };

  if (!eventRequest) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'complete' ? (
              <>
                <CheckCircle className="w-5 h-5 text-tsp-teal" />
                Mark Action Complete
              </>
            ) : mode === 'edit' ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                Edit Next Action
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                Add Next Action
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {eventRequest.organizationName} • {eventRequest.firstName} {eventRequest.lastName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {mode === 'complete' ? (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-medium text-amber-800 mb-2">Action to Complete:</p>
                <p className="text-sm text-amber-900">{eventRequest.nextAction}</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="action-result" className="text-base font-semibold">
                  Record Results <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="action-result"
                  value={actionResult}
                  onChange={(e) => setActionResult(e.target.value)}
                  placeholder="What was the outcome of this action? Record any important details, decisions made, or next steps identified..."
                  className="min-h-[120px]"
                  autoFocus
                />
                <p className="text-xs text-gray-500">
                  This will be saved to the event's planning notes and the next action will be cleared.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="next-action" className="text-base font-semibold">
                Next Action <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="next-action"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="What needs to happen next for this event? (e.g., 'Call organizer to confirm date', 'Send toolkit email', 'Check with team about availability')"
                className="min-h-[100px]"
                autoFocus
              />
              <p className="text-xs text-gray-500">
                This will be displayed prominently on the event card to track intake progress.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleClose} disabled={updateNextActionMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={updateNextActionMutation.isPending}
            className={'bg-tsp-teal hover:bg-brand-primary-dark'}
          >
            {updateNextActionMutation.isPending
              ? 'Saving...'
              : mode === 'complete'
              ? 'Mark Complete'
              : mode === 'edit'
              ? 'Save Changes'
              : 'Add Action'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NextActionDialog;
