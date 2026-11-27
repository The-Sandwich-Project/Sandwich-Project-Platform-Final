import React, { useState } from 'react';
import { AlertTriangle, Flag, Info, Clock, CheckCircle, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { usePreEventFlagMutations } from '@/components/event-requests/hooks/usePreEventFlagMutations';

interface PreEventFlag {
  id: string;
  type: 'critical' | 'important' | 'attention';
  message: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  dueDate: string | null;
}

interface PreEventFlagsProps {
  flags: PreEventFlag[];
  eventId: number;
  eventName: string;
  compact?: boolean; // Compact mode for small cards
  /** Show the "Add New Flag" form in the dialog. Defaults to true. */
  allowAdd?: boolean;
  /**
   * @deprecated No longer needed - mutations now automatically invalidate queries.
   * Kept for backwards compatibility but can be safely removed.
   */
  onUpdate?: () => void;
}

const flagTypeConfig = {
  critical: {
    icon: AlertTriangle,
    color: 'bg-red-100 text-red-700 border-red-300',
    badgeColor: 'bg-red-500 text-white',
    label: 'Critical',
  },
  important: {
    icon: Flag,
    color: 'bg-orange-100 text-orange-700 border-orange-300',
    badgeColor: 'bg-orange-500 text-white',
    label: 'Important',
  },
  attention: {
    icon: Info,
    color: 'bg-yellow-100 text-yellow-700 border-yellow-300',
    badgeColor: 'bg-yellow-500 text-white',
    label: 'Attention',
  },
};

export function PreEventFlagsBanner({ flags, eventId, eventName, compact = false, allowAdd = true }: PreEventFlagsProps) {
  const [showDialog, setShowDialog] = useState(false);
  const { resolveFlagMutation } = usePreEventFlagMutations();

  // Get active (unresolved) flags
  const activeFlags = flags.filter(f => !f.resolvedAt);

  if (activeFlags.length === 0) return null;

  // Get highest priority flag for compact display
  const priorityFlag = activeFlags.find(f => f.type === 'critical')
    || activeFlags.find(f => f.type === 'important')
    || activeFlags[0];

  const config = flagTypeConfig[priorityFlag.type];
  const Icon = config.icon;

  const handleResolveFlag = (flagId: string) => {
    resolveFlagMutation.mutate({ eventId, flagId });
  };

  if (compact) {
    // Compact banner - shows on small event cards
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1.5 border-b ${config.color} cursor-pointer hover:opacity-80`}
        onClick={() => setShowDialog(true)}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-xs font-medium flex-1 truncate">
          {priorityFlag.message}
        </span>
        {activeFlags.length > 1 && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
            +{activeFlags.length - 1}
          </Badge>
        )}
      </div>
    );
  }

  // Full banner - shows on detailed views
  return (
    <>
      <div className={`border-l-4 ${config.color.replace('border-', 'border-l-')} bg-white p-3 mb-2`}>
        <div className="flex items-start gap-3">
          <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`${config.badgeColor} text-xs`}>
                {config.label}
              </Badge>
              {priorityFlag.dueDate && (
                <div className="flex items-center gap-1 text-xs text-gray-600">
                  <Clock className="w-3 h-3" />
                  Due: {format(new Date(priorityFlag.dueDate), 'MMM d')}
                </div>
              )}
            </div>
            <p className="text-sm font-medium">{priorityFlag.message}</p>
            <p className="text-xs text-gray-500 mt-1">
              Added by {priorityFlag.createdByName} on {format(new Date(priorityFlag.createdAt), 'MMM d, yyyy')}
            </p>
            {activeFlags.length > 1 && (
              <button
                onClick={() => setShowDialog(true)}
                className="text-xs text-blue-600 hover:text-blue-800 mt-2 font-medium"
              >
                View all {activeFlags.length} flags →
              </button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleResolveFlag(priorityFlag.id)}
            disabled={resolveFlagMutation.isPending}
            className="h-7 w-7 p-0"
            title="Mark as resolved"
          >
            <CheckCircle className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* All Flags Dialog */}
      <PreEventFlagsDialog
        flags={flags}
        eventId={eventId}
        eventName={eventName}
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        allowAdd={allowAdd}
      />
    </>
  );
}

interface PreEventFlagsDialogProps {
  flags: PreEventFlag[];
  eventId: number;
  eventName: string;
  isOpen: boolean;
  onClose: () => void;
  /** Show the "Add New Flag" form. Defaults to true. */
  allowAdd?: boolean;
  /**
   * @deprecated No longer needed - mutations now automatically invalidate queries.
   * Kept for backwards compatibility but can be safely removed.
   */
  onUpdate?: () => void;
}

export function PreEventFlagsDialog({ flags, eventId, eventName, isOpen, onClose, allowAdd = true }: PreEventFlagsDialogProps) {
  const [newFlagMessage, setNewFlagMessage] = useState('');
  const [newFlagType, setNewFlagType] = useState<'critical' | 'important' | 'attention'>('important');

  const { addFlagMutation, resolveFlagMutation } = usePreEventFlagMutations();

  const activeFlags = flags.filter(f => !f.resolvedAt);
  const resolvedFlags = flags.filter(f => f.resolvedAt);

  const handleAddFlag = () => {
    if (!newFlagMessage.trim()) return;

    addFlagMutation.mutate(
      { eventId, type: newFlagType, message: newFlagMessage.trim() },
      {
        onSuccess: () => {
          setNewFlagMessage('');
          setNewFlagType('important');
        },
      }
    );
  };

  const handleResolveFlag = (flagId: string) => {
    resolveFlagMutation.mutate({ eventId, flagId });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pre-Event Flags</DialogTitle>
          <DialogDescription>
            Critical items that need attention before: {eventName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Add New Flag */}
          {allowAdd && (
          <div className="border rounded-lg p-4 bg-gray-50">
            <h3 className="font-semibold text-sm mb-3">Add New Flag</h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="flag-type" className="text-xs">Priority</Label>
                <Select value={newFlagType} onValueChange={(v: any) => setNewFlagType(v)}>
                  <SelectTrigger id="flag-type" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">🔴 Critical - Urgent attention needed</SelectItem>
                    <SelectItem value="important">🟠 Important - Should be handled soon</SelectItem>
                    <SelectItem value="attention">🟡 Attention - Note for awareness</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="flag-message" className="text-xs">Message</Label>
                <Textarea
                  id="flag-message"
                  value={newFlagMessage}
                  onChange={(e) => setNewFlagMessage(e.target.value)}
                  placeholder="Describe what needs attention..."
                  className="h-20"
                />
              </div>
              <Button
                onClick={handleAddFlag}
                disabled={addFlagMutation.isPending || !newFlagMessage.trim()}
                size="sm"
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                {addFlagMutation.isPending ? 'Adding...' : 'Add Flag'}
              </Button>
            </div>
          </div>
          )}

          {/* Active Flags */}
          {activeFlags.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm mb-2">Active Flags ({activeFlags.length})</h3>
              <div className="space-y-2">
                {activeFlags.map((flag) => {
                  const config = flagTypeConfig[flag.type];
                  const Icon = config.icon;
                  return (
                    <div key={flag.id} className={`border rounded-lg p-3 ${config.color}`}>
                      <div className="flex items-start gap-3">
                        <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={`${config.badgeColor} text-xs`}>
                              {config.label}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium">{flag.message}</p>
                          <p className="text-xs text-gray-600 mt-1">
                            Added by {flag.createdByName} on {format(new Date(flag.createdAt), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResolveFlag(flag.id)}
                          disabled={resolveFlagMutation.isPending}
                          className="h-7 px-2 text-xs"
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {resolveFlagMutation.isPending ? '...' : 'Resolve'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resolved Flags */}
          {resolvedFlags.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-gray-500 mb-2">Resolved ({resolvedFlags.length})</h3>
              <div className="space-y-2">
                {resolvedFlags.map((flag) => (
                  <div key={flag.id} className="border rounded-lg p-3 bg-gray-50 opacity-60">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm line-through">{flag.message}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Resolved by {flag.resolvedByName} on {flag.resolvedAt && format(new Date(flag.resolvedAt), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {flags.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Flag className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No flags yet</p>
              {allowAdd && (
                <p className="text-xs mt-1">Add flags for critical items that need attention before this event</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
