import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageCircle, Users, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getWelcomeTourPromptState } from '@/lib/guided-tour-utils';
import { isMobileDevice } from '@/lib/device-detection';

export const WHATS_NEW_STORAGE_KEY = 'whats_new_2024_v3_instant_messaging';
const STORAGE_KEY = WHATS_NEW_STORAGE_KEY;

export function WhatsNewModal() {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    // Desktop only.
    if (isMobileDevice() || !user?.id) {
      return;
    }

    // One popup at a time: a brand-new user sees only the welcome/tour
    // prompt; this waits until a later visit.
    if (getWelcomeTourPromptState(user.id) !== 'shown') {
      return;
    }

    // Check if user has already seen this announcement
    const hasSeenAnnouncement = localStorage.getItem(STORAGE_KEY);

    if (!hasSeenAnnouncement) {
      // Show modal after a short delay so the page loads first
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [user?.id]);

  const handleDismiss = () => {
    // Mark as seen in localStorage
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsOpen(false);
  };

  // Handle any close action (clicking outside, escape key, or button)
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Always mark as seen when closing, regardless of how it was closed
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    setIsOpen(open);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-gradient-to-br from-brand-primary to-brand-primary-dark rounded-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <DialogTitle className="text-2xl font-bold text-gray-900">
              New Features!
            </DialogTitle>
          </div>
          <DialogDescription className="text-base text-gray-600">
            We've added new ways to connect and collaborate with your team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Online Users & Instant Messaging - Combined feature */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border-2 border-green-200">
            <h3 className="font-semibold text-lg text-gray-900 mb-3 flex items-center gap-2">
              <Users className="w-5 h-5 text-green-600" />
              See Who's Online & Send Instant Messages
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              See who's currently active and send them a direct message instantly!
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-3 bg-white rounded-md p-3 shadow-sm">
                <div className="p-2 bg-green-100 rounded-md">
                  <Users className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <span className="font-medium text-gray-900">Click the people icon</span>
                  <p className="text-xs text-gray-600">Find it in the top navigation bar to see who's online</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-white rounded-md p-3 shadow-sm">
                <div className="p-2 bg-blue-100 rounded-md">
                  <MessageCircle className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <span className="font-medium text-gray-900">Click any name to message</span>
                  <p className="text-xs text-gray-600">Select a person from the list to start a conversation</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick tip */}
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-700">
              <strong>💡 Tip:</strong> Look for the green dot next to names - it means they're online right now!
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            onClick={handleDismiss}
            className="bg-gradient-to-r from-brand-primary to-brand-primary-dark hover:from-brand-primary-dark hover:to-brand-primary text-white px-6"
          >
            Got it!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
