/**
 * "Reminders" button for the Events page header. Opens the same reminder
 * settings as Profile → Alerts in a popup — one set of settings for all of
 * the user's events (there are no per-event reminder settings).
 */
import * as React from 'react';
import { Bell } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { CheckInReminderPreferences } from '@shared/types';
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
  const { data: prefs } = useQuery<CheckInReminderPreferences | null>({
    queryKey: ['/api/me/check-in-reminder-preferences'],
    queryFn: () => apiRequest('GET', '/api/me/check-in-reminder-preferences'),
    staleTime: 5 * 60 * 1000,
  });
  // Gentle nudge: a small dot until the user has saved their own settings.
  // (Defaults already work without it; this just makes the option visible.)
  const showDot = prefs != null && !prefs.configured;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="premium-btn-outline text-sm whitespace-nowrap shrink-0 relative"
        title={showDot
          ? "You're using the standard reminders. Click to see or adjust them."
          : 'Your reminder settings (apply to all your events)'}
        data-testid="button-reminder-settings"
        data-tour="reminder-settings-button"
      >
        <Bell className="w-4 h-4" />
        {showDot && (
          <span
            className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#FBAD3F]"
            aria-label="Reminder settings not personalized yet"
            data-testid="reminder-settings-dot"
          />
        )}
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
          <CheckInReminderPreferencesEditor onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
