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
