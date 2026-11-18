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

  const tourId = getDefaultWelcomeTourId();

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
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape / click-outside count as "skip" so it doesn't come back every load.
        if (!next) markWelcomeTourPromptShown(user.id);
        setOpen(next);
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-[#007e8c]" />
            Welcome to the platform
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left space-y-2 pt-1">
            <p>
              New here? Take a one-minute tour of the sidebar, where your tools
              live, and the help button, where step-by-step guides for each
              feature are.
            </p>
            <p className="text-xs text-muted-foreground">
              You can open tours anytime from the blue help button in the
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
              className="bg-[#236383] hover:bg-[#007e8c]"
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
