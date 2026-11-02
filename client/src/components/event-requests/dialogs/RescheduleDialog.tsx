import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CalendarIcon, RefreshCw } from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { logger } from '@/lib/logger';
import { TrafficConflictBadge } from '@/components/event-requests/TrafficConflictBadge';

const rescheduleFormSchema = z.object({
  newScheduledDate: z.date({ required_error: 'A new date is required' }),
  rescheduleNotes: z.string().optional(),
});

type RescheduleFormData = z.infer<typeof rescheduleFormSchema>;

interface RescheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  request: EventRequest | null;
  onConfirm: (eventId: number, data: {
    status: string;
    scheduledEventDate: string;
    originalScheduledDate?: string | Date | null;
    postponementNotes?: string;
  }) => Promise<void>;
}

export const RescheduleDialog: React.FC<RescheduleDialogProps> = ({
  isOpen,
  onClose,
  request,
  onConfirm,
}) => {
  const form = useForm<RescheduleFormData>({
    resolver: zodResolver(rescheduleFormSchema),
    defaultValues: {
      rescheduleNotes: '',
    },
  });

  React.useEffect(() => {
    if (isOpen) {
      form.reset({ newScheduledDate: undefined as any, rescheduleNotes: '' });
    }
  }, [isOpen, request, form]);

  const onSubmit = async (data: RescheduleFormData) => {
    if (!request) return;

    try {
      const formattedDate = format(data.newScheduledDate, 'yyyy-MM-dd');
      await onConfirm(request.id, {
        status: 'rescheduled',
        scheduledEventDate: formattedDate,
        originalScheduledDate: request.scheduledEventDate || request.originalScheduledDate || null,
        postponementNotes: data.rescheduleNotes || undefined,
      });
      form.reset();
      onClose();
    } catch (error) {
      logger.error('Failed to reschedule event:', error);
    }
  };

  if (!request) return null;

  const currentDate = request.scheduledEventDate
    ? new Date(request.scheduledEventDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : request.originalScheduledDate
    ? new Date(request.originalScheduledDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        form.reset();
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-tsp-teal" />
            Reschedule Event
          </DialogTitle>
          <DialogDescription>
            Event: <strong>{request.organizationName}</strong>
            {request.department && ` - ${request.department}`}
          </DialogDescription>
        </DialogHeader>

        {currentDate && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            Previously scheduled for: <strong>{currentDate}</strong>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newScheduledDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel className="text-base font-semibold">
                    New Event Date <span className="text-red-500">*</span>
                  </FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            'w-full pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {field.value
                            ? format(field.value, 'MMMM d, yyyy')
                            : 'Select the new event date'}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  {field.value && (
                    <TrafficConflictBadge dates={[field.value]} className="mt-1" />
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rescheduleNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">
                    Notes (Optional)
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Any notes about the reschedule..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  form.reset();
                  onClose();
                }}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="bg-tsp-teal hover:bg-[#1e5a75] text-white"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {form.formState.isSubmitting ? 'Processing...' : 'Reschedule Event'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
