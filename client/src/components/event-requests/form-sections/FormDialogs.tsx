/**
 * Form Dialogs
 *
 * All confirmation/warning dialogs used by EventSchedulingForm,
 * extracted to reduce the main component's size.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Calendar, Trash2 } from 'lucide-react';

/** Date Change Confirmation Dialog */
export const DateChangeDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, onOpenChange, onConfirm, onCancel }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Confirm Date Change</AlertDialogTitle>
        <AlertDialogDescription>
          This event is already scheduled. Changing the date may affect logistics, notifications, and volunteer assignments.
          Are you sure you want to change the event date?
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm} className="bg-tsp-teal hover:bg-[#1a4e68]">
          Yes, Change Date
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** Van Conflict Warning Dialog */
export const VanConflictDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflictDetails: { conflictingEvents: Array<{ id: number; name: string; time?: string }> } | null;
  onGoBack: () => void;
  onAcknowledge: () => void;
}> = ({ open, onOpenChange, conflictDetails, onGoBack, onAcknowledge }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          Van Availability Notice
        </AlertDialogTitle>
        <AlertDialogDescription className="space-y-3">
          <p>
            Your changes have been saved. As a heads-up, the van may already be assigned to another event on this date:
          </p>
          {conflictDetails && (
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {conflictDetails.conflictingEvents.map((event, i) => (
                <li key={event.id || i}>
                  <strong>{event.name}</strong>
                  {event.time && <span className="text-muted-foreground"> at {event.time}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-sm">
            Please verify van availability when coordinating logistics.
          </p>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onGoBack}>Go Back & Check</AlertDialogCancel>
        <AlertDialogAction onClick={onAcknowledge} className="bg-amber-600 hover:bg-amber-700">
          OK, Got It
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** Standby Follow-Up Date Dialog */
export const StandbyFollowUpDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUpDate: string;
  setFollowUpDate: (date: string) => void;
  followUpMode: 'specific' | 'one_week' | 'none';
  setFollowUpMode: (mode: 'specific' | 'one_week' | 'none') => void;
  onSave: () => void;
}> = ({ open, onOpenChange, followUpDate, setFollowUpDate, followUpMode, setFollowUpMode, onSave }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-amber-600" />
          Set Follow-Up Reminder
        </AlertDialogTitle>
        <AlertDialogDescription className="space-y-4">
          <p>
            You're moving this event to <span className="font-semibold text-amber-600">Standby</span>.
          </p>
          <p>
            Want an email reminder to check back in with them? Setting a reminder is optional.
          </p>

          <div className="space-y-3 mt-4">
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="standbyFollowUpMode"
                value="one_week"
                checked={followUpMode === 'one_week'}
                onChange={() => {
                  setFollowUpMode('one_week');
                  const oneWeekFromNow = new Date();
                  oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
                  setFollowUpDate(oneWeekFromNow.toISOString().split('T')[0]);
                }}
                className="h-4 w-4 text-amber-600"
              />
              <div>
                <span className="font-medium">Reminder in one week</span>
                <p className="text-sm text-gray-500">Default follow-up timing</p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="standbyFollowUpMode"
                value="specific"
                checked={followUpMode === 'specific'}
                onChange={() => setFollowUpMode('specific')}
                className="h-4 w-4 text-amber-600 mt-1"
              />
              <div className="flex-1">
                <span className="font-medium">Contact requested a specific date</span>
                <Input
                  type="date"
                  value={followUpMode === 'specific' ? followUpDate : ''}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  disabled={followUpMode !== 'specific'}
                  className="mt-2"
                  onClick={() => setFollowUpMode('specific')}
                />
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="standbyFollowUpMode"
                value="none"
                checked={followUpMode === 'none'}
                onChange={() => setFollowUpMode('none')}
                className="h-4 w-4 text-amber-600"
              />
              <div>
                <span className="font-medium">No reminder</span>
                <p className="text-sm text-gray-500">I'll check back with them on my own</p>
              </div>
            </label>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={onSave}
          className="bg-amber-600 hover:bg-amber-700"
          disabled={followUpMode !== 'none' && !followUpDate}
        >
          {followUpMode === 'none' ? 'Save Without Reminder' : 'Set Reminder & Save'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** Delete Confirmation Dialog */
export const DeleteConfirmDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventRequest: any | null;
  onDelete: () => void;
  isPending: boolean;
}> = ({ open, onOpenChange, eventRequest, onDelete, isPending }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete Event Request</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete this event request for{' '}
          <span className="font-semibold">{eventRequest?.organizationName}</span>?
          {eventRequest?.scheduledEventDate && (
            <> This event is scheduled for {new Date(eventRequest.scheduledEventDate).toLocaleDateString()}.</>
          )}
          <br /><br />
          <span className="text-red-600 font-medium">This action cannot be undone.</span>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={() => onOpenChange(false)}>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onDelete} className="bg-tsp-red hover:bg-[#8a1837]">
          Delete Event
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
