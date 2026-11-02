import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquareText, Lightbulb, Phone, CheckCircle } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useLocation } from 'wouter';
import { isMobileDevice } from '@/lib/device-detection';

const ANNOUNCEMENT_ID = 'text_idea_feature_2024';

export function TextIdeaAnnouncementModal() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  // Check if user has dismissed this announcement
  const { data: dismissStatus, isLoading } = useQuery({
    queryKey: ['/api/announcements/dismissed', ANNOUNCEMENT_ID],
    queryFn: () =>
      apiRequest('GET', `/api/announcements/dismissed/${ANNOUNCEMENT_ID}`),
  });

  // Mutation to dismiss the announcement
  const dismissMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/announcements/dismiss', {
        announcementId: ANNOUNCEMENT_ID,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/announcements/dismissed', ANNOUNCEMENT_ID],
      });
      setIsOpen(false);
    },
  });

  // Show modal if user hasn't dismissed it
  useEffect(() => {
    // Don't show on mobile devices
    if (isMobileDevice()) {
      return;
    }

    if (!isLoading && dismissStatus && !dismissStatus.dismissed) {
      // Small delay so it doesn't appear at the same time as other modals
      const timer = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [dismissStatus, isLoading]);

  const handleGoToSettings = () => {
    dismissMutation.mutate();
    setLocation('/profile?tab=notifications');
  };

  const handleDismiss = () => {
    dismissMutation.mutate();
  };

  if (isLoading) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-[#FBAD3F]/20 p-3 rounded-full">
              <Lightbulb className="w-6 h-6 text-[#FBAD3F]" />
            </div>
            <div>
              <DialogTitle className="text-xl flex items-center gap-2">
                Text Us Your Ideas!
                <Badge variant="outline" className="bg-[#FBAD3F]/10 text-[#FBAD3F] border-[#FBAD3F]/30">
                  New Feature
                </Badge>
              </DialogTitle>
            </div>
          </div>
          <DialogDescription className="text-base space-y-3 pt-2">
            <p className="font-medium text-gray-700">
              Got a great idea for TSP? Now you can text it directly to us!
            </p>

            <div className="bg-[#236383]/5 border-l-4 border-[#236383] p-4 rounded">
              <p className="text-sm text-[#236383] font-medium mb-3">
                Here's how it works:
              </p>
              <ol className="text-sm text-gray-700 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="bg-[#236383] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">1</span>
                  <span><strong>Enable SMS alerts</strong> in your profile settings</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-[#236383] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">2</span>
                  <span><strong>Save our number</strong> to your phone contacts</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-[#236383] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">3</span>
                  <span><strong>Text "IDEA"</strong> followed by your note</span>
                </li>
              </ol>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg border">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Example message:</p>
              <div className="bg-white border rounded-lg p-3 font-mono text-sm text-gray-700">
                <MessageSquareText className="w-4 h-4 inline mr-2 text-[#236383]" />
                IDEA What if we partnered with the local food bank for distribution?
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-2 rounded">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>Your idea is automatically saved to the TSP Holding Zone!</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleDismiss}
            disabled={dismissMutation.isPending}
            className="flex-1"
            data-testid="button-dismiss-text-idea"
          >
            Got It!
          </Button>
          <Button
            onClick={handleGoToSettings}
            disabled={dismissMutation.isPending}
            className="flex-1 bg-[#FBAD3F] hover:bg-[#E99E30] text-white"
            data-testid="button-setup-text-idea"
          >
            <Phone className="w-4 h-4 mr-2" />
            Set Up SMS Alerts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
