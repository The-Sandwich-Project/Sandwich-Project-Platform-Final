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
        <AlertDialogAction onClick={onConfirm} className="bg-[#236383] hover:bg-[#1a4e68]">
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
        <AlertDialogAction onClick={onDelete} className="bg-[#A31C41] hover:bg-[#8a1837]">
          Delete Event
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
