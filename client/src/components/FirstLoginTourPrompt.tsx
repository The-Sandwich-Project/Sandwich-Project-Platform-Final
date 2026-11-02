import { useEffect, useState } from 'react';
import { Compass, PlayCircle, X } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@shared/unified-auth-utils';
import { PERMISSIONS } from '@shared/auth-utils';
import {
  getDefaultWelcomeTourId,
  getWelcomeTourPromptState,
  markWelcomeTourPromptShown,
  startGuidedTour,
} from '@/lib/guided-tour-utils';

/**
 * Optional one-time welcome dialog offering a guided tour on first dashboard visit.
 * Dismissal is stored per user in localStorage.
 */
export function FirstLoginTourPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    if (getWelcomeTourPromptState(user.id) === 'shown') return;

    const timer = window.setTimeout(() => setOpen(true), 2500);
    return () => window.clearTimeout(timer);
  }, [user?.id]);

  if (!user?.id) return null;

  const userForPermissions = {
    ...user,
    permissions: (user.permissions as string[] | null) ?? null,
  };
  const hasEventPlanningAccess = hasPermission(
    userForPermissions,
    PERMISSIONS.NAV_EVENT_PLANNING
  );
  const tourId = getDefaultWelcomeTourId(hasEventPlanningAccess);

  const handleDismiss = () => {
    markWelcomeTourPromptShown(user.id);
    setOpen(false);
  };

  const handleStartTour = () => {
    markWelcomeTourPromptShown(user.id);
    setOpen(false);
    window.setTimeout(() => startGuidedTour(tourId), 300);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-[#236383]" />
            Welcome to the platform
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left space-y-2 pt-1">
            <p>
              New here? Take a short guided tour to learn where key tools live —
              event planning, help guides, and your dashboard.
            </p>
            <p className="text-xs text-muted-foreground">
              You can always reopen tours from the blue help button in the
              bottom-right corner.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel asChild>
            <Button variant="ghost" onClick={handleDismiss} className="sm:mr-auto">
              <X className="w-4 h-4 mr-1.5" />
              Skip for now
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              onClick={handleStartTour}
              className="bg-[#236383] hover:bg-[#236383]"
            >
              <PlayCircle className="w-4 h-4 mr-1.5" />
              Start quick tour
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
