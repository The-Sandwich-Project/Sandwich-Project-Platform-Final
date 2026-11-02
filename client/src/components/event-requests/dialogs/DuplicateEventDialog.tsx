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
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CalendarIcon, Copy } from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { logger } from '@/lib/logger';

const duplicateFormSchema = z.object({
  scheduledEventDate: z.date({ required_error: 'A new event date is required' }),
  eventStartTime: z.string().optional(),
  eventEndTime: z.string().optional(),
  department: z.string().optional(),
});

type DuplicateFormData = z.infer<typeof duplicateFormSchema>;

interface DuplicateEventDialogProps {
  isOpen: boolean;
  onClose: () => void;
  request: EventRequest | null;
  onConfirm: (newEventData: Partial<EventRequest>) => Promise<void>;
}

export const DuplicateEventDialog: React.FC<DuplicateEventDialogProps> = ({
  isOpen,
  onClose,
  request,
  onConfirm,
}) => {
  const form = useForm<DuplicateFormData>({
    resolver: zodResolver(duplicateFormSchema),
    defaultValues: {
      eventStartTime: '',
      eventEndTime: '',
      department: '',
    },
  });

  React.useEffect(() => {
    if (isOpen && request) {
      form.reset({
        scheduledEventDate: undefined as any,
        eventStartTime: '',
        eventEndTime: '',
        department: request.department || '',
      });
    }
  }, [isOpen, request, form]);

  const onSubmit = async (data: DuplicateFormData) => {
    if (!request) return;

    try {
      const formattedDate = format(data.scheduledEventDate, 'yyyy-MM-dd');

      // A "non-event" was explicitly determined NOT to be a real event request.
      // Duplicating one must not mint a confirmed, scheduled calendar event —
      // that would bypass intake review. Send it to In Process (unconfirmed, no
      // confirmed scheduled date) so the team vets it before it's put on the
      // calendar. Every other source status is a real, already-vetted event, so
      // it duplicates straight to a confirmed Scheduled event as before.
      const isNonEvent = request.status === 'non_event';

      // Build new event payload — carry over core info, reset event-specific fields
      const newEventData: Partial<EventRequest> = {
        // Group / organization info
        organizationName: request.organizationName,
        organizationCategory: request.organizationCategory,
        department: data.department?.trim() || null,

        // Contact info
        firstName: request.firstName,
        lastName: request.lastName,
        email: request.email,
        phone: request.phone,

        // Location
        eventAddress: request.eventAddress,

        // New date / time. For a non-event duplicate, the date is the requested
        // date only — no confirmed scheduled date until it's vetted.
        scheduledEventDate: isNonEvent ? null : (formattedDate as any),
        desiredEventDate: formattedDate as any,
        eventStartTime: data.eventStartTime?.trim() || null,
        eventEndTime: data.eventEndTime?.trim() || null,

        // Status: real events go straight to a confirmed Scheduled event since
        // this is a returning, already-vetted org; non-events go to In Process
        // unconfirmed so intake reviews them first.
        status: isNonEvent ? 'in_process' : 'scheduled',
        isConfirmed: isNonEvent ? false : true,

        // Only mark previously-hosted for real prior events (not non-events).
        previouslyHosted: isNonEvent ? undefined : 'yes',
      };

      await onConfirm(newEventData);
      form.reset();
      onClose();
    } catch (error) {
      logger.error('Failed to duplicate event:', error);
    }
  };

  if (!request) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          form.reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-tsp-teal" />
            Create Another Event
          </DialogTitle>
          <DialogDescription>
            Duplicate <strong>{request.organizationName}</strong> with a new date. The contact
            info, location, and organization details will be carried over.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 space-y-1">
          <div>
            <span className="font-semibold">Contact:</span>{' '}
            {[request.firstName, request.lastName].filter(Boolean).join(' ') || '—'}
            {request.email && ` · ${request.email}`}
          </div>
          {request.eventAddress && (
            <div>
              <span className="font-semibold">Location:</span> {request.eventAddress}
            </div>
          )}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="scheduledEventDate"
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
                    <PopoverContent className="w-auto p-0 z-[10000]" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="eventStartTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold">Start Time (optional)</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="eventEndTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold">End Time (optional)</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="department"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Department (optional)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={request.department || 'e.g., 4th & 5th Graders'}
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
                <Copy className="w-4 h-4 mr-2" />
                {form.formState.isSubmitting ? 'Creating...' : 'Create Event'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
