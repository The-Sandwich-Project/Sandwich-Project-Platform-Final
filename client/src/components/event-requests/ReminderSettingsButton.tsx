/**
 * "Reminders" button for the Events page header. Opens the same reminder
 * settings as Profile → Alerts in a popup — one set of settings for all of
 * the user's events (there are no per-event reminder settings).
 */
import * as React from 'react';
import { Bell } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CheckInReminderPreferencesEditor from '@/components/check-in-reminder-preferences';

export function ReminderSettingsButton({ isMobile }: { isMobile: boolean }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="premium-btn-outline text-sm whitespace-nowrap shrink-0"
        title="Your reminder settings (apply to all your events)"
        data-testid="button-reminder-settings"
      >
        <Bell className="w-4 h-4" />
        {!isMobile && 'Reminders'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Your reminder settings</DialogTitle>
            <DialogDescription>
              These apply to every event you're the TSP contact for. They're the same
              settings as Profile → Alerts.
            </DialogDescription>
          </DialogHeader>
          <CheckInReminderPreferencesEditor />
        </DialogContent>
      </Dialog>
    </>
  );
}
