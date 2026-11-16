/**
 * Status & Toolkit Section
 *
 * Handles event status selection, corporate priority flag, and toolkit status tracking.
 */
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { VALID_STATUS_TRANSITIONS, STATUS_DEFINITIONS } from '../constants';
import type { EventStatus } from '@shared/event-status-workflow';
import type { EventFormData } from './types';

interface StatusToolkitSectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  eventRequest: any | null;
  canRemoveCorporatePriority: boolean;
  onStatusChange: (newStatus: EventStatus) => void;
}

export const StatusToolkitSection: React.FC<StatusToolkitSectionProps> = ({
  formData,
  setFormData,
  eventRequest,
  canRemoveCorporatePriority,
  onStatusChange,
}) => {
  const [showCorporatePriorityConfirmDialog, setShowCorporatePriorityConfirmDialog] = React.useState(false);

  const effectiveStatus = formData.status || eventRequest?.status || 'new';

  return (
    <>
      {/* Status */}
      <div>
        <Label htmlFor="status">Status</Label>
        <Select value={effectiveStatus} onValueChange={onStatusChange}>
          <SelectTrigger data-testid="select-status">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent className="z-[200]" position="popper" sideOffset={5}>
            <SelectItem value={effectiveStatus}>
              {STATUS_DEFINITIONS[effectiveStatus as EventStatus]?.label || effectiveStatus} (Current)
            </SelectItem>
            {(VALID_STATUS_TRANSITIONS[effectiveStatus as EventStatus] || [])
              .filter(s => s !== effectiveStatus)
              .map(status => (
                <SelectItem key={status} value={status}>
                  {STATUS_DEFINITIONS[status]?.label || status}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {effectiveStatus && STATUS_DEFINITIONS[effectiveStatus as EventStatus] && (
          <p className="text-xs text-gray-500 mt-1">
            {STATUS_DEFINITIONS[effectiveStatus as EventStatus].definition}
          </p>
        )}
      </div>

      {/* Corporate Priority */}
      <div className={`flex items-center space-x-3 p-3 rounded-lg border ${
        eventRequest?.isCorporatePriority && !canRemoveCorporatePriority
          ? 'bg-amber-100/70 border-amber-300'
          : 'bg-amber-50/50'
      }`}>
        <input
          type="checkbox"
          id="isCorporatePriority"
          checked={formData.isCorporatePriority}
          onChange={(e) => {
            if (e.target.checked && !formData.isCorporatePriority) {
              setShowCorporatePriorityConfirmDialog(true);
            } else {
              setFormData((prev: any) => ({ ...prev, isCorporatePriority: e.target.checked }));
            }
          }}
          disabled={eventRequest?.isCorporatePriority && !canRemoveCorporatePriority}
          className={`h-5 w-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500 ${
            eventRequest?.isCorporatePriority && !canRemoveCorporatePriority
              ? 'opacity-60 cursor-not-allowed'
              : ''
          }`}
        />
        <div>
          <Label htmlFor="isCorporatePriority" className={`text-amber-900 font-medium ${
            eventRequest?.isCorporatePriority && !canRemoveCorporatePriority
              ? 'cursor-not-allowed'
              : 'cursor-pointer'
          }`}>
            Corporate Priority Event
          </Label>
          <p className="text-xs text-amber-700">
            {eventRequest?.isCorporatePriority && !canRemoveCorporatePriority
              ? 'Only Christine and Katie can remove the corporate priority flag.'
              : 'Mark this as a corporate priority event requiring immediate attention and core team member attendance.'}
          </p>
        </div>
      </div>

      {/* Corporate Priority Confirmation Dialog */}
      <AlertDialog open={showCorporatePriorityConfirmDialog} onOpenChange={setShowCorporatePriorityConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-amber-800">Mark as Corporate Priority?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will flag <strong>{eventRequest?.organizationName}</strong> as a Corporate Priority event.
              </p>
              <p>Corporate priority events:</p>
              <ul className="list-disc list-inside ml-2 text-sm">
                <li>Trigger strict follow-up protocols</li>
                <li>Send notifications to Katie and Christine</li>
                <li>Require a core team member to attend</li>
                <li>Can only be unmarked by Katie or Christine</li>
              </ul>
              <p className="font-medium pt-2">Are you sure this event should be marked as Corporate Priority?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowCorporatePriorityConfirmDialog(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setFormData((prev: any) => ({ ...prev, isCorporatePriority: true }));
                setShowCorporatePriorityConfirmDialog(false);
              }}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Yes, Mark as Corporate Priority
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
};
