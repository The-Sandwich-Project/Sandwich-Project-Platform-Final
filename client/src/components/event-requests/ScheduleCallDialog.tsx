import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Mail, Phone } from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { useIsMobile } from '@/hooks/use-mobile';

interface ScheduleCallDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequest: EventRequest | null;
  onCallScheduled: () => void;
  isLoading: boolean;
  scheduleCallDate: string;
  setScheduleCallDate: (date: string) => void;
  scheduleCallTime: string;
  setScheduleCallTime: (time: string) => void;
}

export const ScheduleCallDialog: React.FC<ScheduleCallDialogProps> = ({
  isOpen,
  onClose,
  eventRequest,
  onCallScheduled,
  isLoading,
  scheduleCallDate,
  setScheduleCallDate,
  scheduleCallTime,
  setScheduleCallTime,
}) => {
  const isMobile = useIsMobile();

  // Initialize date/time when dialog opens
  useEffect(() => {
    if (isOpen && eventRequest) {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD format
      const timeStr = now.toTimeString().slice(0, 5); // HH:MM format
      setScheduleCallDate(dateStr);
      setScheduleCallTime(timeStr);
    }
  }, [isOpen, eventRequest, setScheduleCallDate, setScheduleCallTime]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleCallDate) return; // Only date is required, time is optional
    onCallScheduled();
  };

  if (!eventRequest) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Phone className="w-5 h-5 text-tsp-teal" />
            <span>Schedule Follow-up Call</span>
          </DialogTitle>
          <DialogDescription>
            Schedule a follow-up call with{' '}
            <strong>
              {eventRequest.firstName} {eventRequest.lastName}
            </strong>{' '}
            at <strong>{eventRequest.organizationName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Contact Information */}
          <div className="bg-[#e6f2f5] border border-tsp-teal/30 rounded-lg p-3">
            <h4 className="font-medium text-[#1A2332] mb-2">Contact Details</h4>
            <div className="space-y-1 text-sm">
              <div className="flex items-center space-x-2">
                <Mail className="w-4 h-4 text-tsp-teal" />
                <span>{eventRequest.email}</span>
              </div>
              {eventRequest.phone && (
                <div className="flex items-center space-x-2">
                  <Phone className="w-4 h-4 text-tsp-teal" />
                  <span>{eventRequest.phone}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const phoneNumber = eventRequest.phone;

                      if (isMobile) {
                        window.location.href = `tel:${phoneNumber}`;
                      } else {
                        navigator.clipboard.writeText(phoneNumber || '');
                      }
                    }}
                    className="ml-auto text-xs"
                  >
                    {isMobile ? 'Call' : 'Copy'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Date and Time Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="schedule-call-date">Call Date</Label>
              <Input
                id="schedule-call-date"
                type="date"
                value={scheduleCallDate}
                onChange={(e) => setScheduleCallDate(e.target.value)}
                required
                data-testid="input-schedule-call-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-call-time">Call Time <span className="text-gray-400 text-xs font-normal">(optional)</span></Label>
              <Input
                id="schedule-call-time"
                type="time"
                value={scheduleCallTime}
                onChange={(e) => setScheduleCallTime(e.target.value)}
                data-testid="input-schedule-call-time"
              />
            </div>
          </div>

          {/* Information */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <h4 className="font-medium text-amber-900 mb-2">What happens when you schedule a call:</h4>
            <ul className="text-sm text-amber-800 space-y-1">
              <li>• A reminder will be set for the scheduled time</li>
              <li>• The event will remain in "In Process" status</li>
              <li>• You can update the call time later if needed</li>
            </ul>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!scheduleCallDate || isLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-confirm-schedule-call"
            >
              {isLoading ? 'Scheduling...' : 'Schedule Call'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleCallDialog;