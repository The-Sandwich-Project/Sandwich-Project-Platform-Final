/**
 * Event Schedule Section
 *
 * Handles event date, time, pickup date/time, date flexibility,
 * backup dates, and conflict warnings.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, CheckCircle2 } from 'lucide-react';
import { EventConflictWarnings } from '../EventConflictWarnings';
import { useEventRequestContext } from '../context/EventRequestContext';
import type { EventFormData } from './types';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

interface EventScheduleSectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  isComplete: boolean;
  eventRequest: any | null;
  formatDateForInput: (date: any) => string;
  onVanConflictReset: () => void;
  /** Called when user finishes editing the date on a scheduled event, to trigger confirmation dialog */
  onScheduledDateChange?: (newDate: string) => void;
}

export const EventScheduleSection: React.FC<EventScheduleSectionProps> = ({
  formData,
  setFormData,
  isComplete,
  eventRequest,
  formatDateForInput,
  onVanConflictReset,
  onScheduledDateChange,
}) => {
  const { setViewMode } = useEventRequestContext();

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-white">
      <div className="flex items-center gap-3 pb-2 border-b">
        <Calendar className="w-5 h-5 text-[#236383]" />
        <span className="text-lg font-semibold text-[#236383]">Event Schedule</span>
        {isComplete && <CheckCircle2 className="w-4 h-4 text-tsp-teal" />}
      </div>

      {/* Conflict Warnings */}
      <EventConflictWarnings
        eventId={eventRequest?.id}
        scheduledEventDate={formData.eventDate || null}
        eventStartTime={formData.eventStartTime || null}
        eventEndTime={formData.eventEndTime || null}
        pickupTime={formData.pickupTime || null}
        vanDriverNeeded={formData.vanDriverNeeded}
        isDhlVan={formData.isDhlVan}
        selfTransport={formData.selfTransport}
        assignedVanDriverId={formData.assignedVanDriverId || null}
        assignedSpeakerIds={eventRequest?.assignedSpeakerIds || null}
        assignedRecipientIds={formData.assignedRecipientIds || null}
        organizationName={formData.organizationName || eventRequest?.organizationName || null}
        enabled={!!formData.eventDate}
        onViewCalendar={() => setViewMode('calendar')}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Event Date */}
        <div>
          <Label htmlFor="eventDate">Event Date</Label>
          <Input
            id="eventDate"
            type="date"
            value={formData.eventDate}
            onChange={(e) => {
              setFormData((prev: any) => ({ ...prev, eventDate: e.target.value }));
              onVanConflictReset();
            }}
            onBlur={(e) => {
              const newDate = e.target.value;
              // Trigger confirmation dialog when changing date on a scheduled event
              if (onScheduledDateChange &&
                  isScheduledOrRescheduled(eventRequest?.status) &&
                  formatDateForInput(eventRequest.desiredEventDate) !== newDate &&
                  formatDateForInput(eventRequest.desiredEventDate) !== '' &&
                  newDate !== formatDateForInput(eventRequest.desiredEventDate)) {
                onScheduledDateChange(newDate);
              }
            }}
            data-testid="input-event-date"
          />
          <div className="flex items-center gap-2 mt-2">
            <Label className="text-sm font-normal text-gray-600">Date flexibility:</Label>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={formData.dateFlexible === null ? "default" : "outline"}
                className={`h-7 px-2 text-xs ${formData.dateFlexible === null ? 'bg-gray-500 hover:bg-gray-600' : ''}`}
                onClick={() => setFormData((prev: any) => ({ ...prev, dateFlexible: null }))}
              >
                Unknown
              </Button>
              <Button
                type="button"
                size="sm"
                variant={formData.dateFlexible === true ? "default" : "outline"}
                className={`h-7 px-2 text-xs ${formData.dateFlexible === true ? 'bg-tsp-teal hover:bg-brand-primary-dark' : ''}`}
                onClick={() => setFormData((prev: any) => ({ ...prev, dateFlexible: true }))}
              >
                Flexible
              </Button>
              <Button
                type="button"
                size="sm"
                variant={formData.dateFlexible === false ? "default" : "outline"}
                className={`h-7 px-2 text-xs ${formData.dateFlexible === false ? 'bg-red-600 hover:bg-red-700' : ''}`}
                onClick={() => setFormData((prev: any) => ({ ...prev, dateFlexible: false }))}
              >
                Fixed
              </Button>
            </div>
          </div>
        </div>

        {/* Backup Dates */}
        <div className="md:col-span-2 lg:col-span-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Backup Dates (Optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFormData((prev: any) => ({
                    ...prev,
                    backupDates: [...prev.backupDates, '']
                  }));
                }}
                className="h-7 text-xs"
              >
                + Add Backup Date
              </Button>
            </div>
            {formData.backupDates && formData.backupDates.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {formData.backupDates.map((date, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={date}
                      onChange={(e) => {
                        const newBackupDates = [...(formData.backupDates || [])];
                        newBackupDates[index] = e.target.value;
                        setFormData((prev: any) => ({ ...prev, backupDates: newBackupDates }));
                      }}
                      placeholder="Select backup date"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFormData((prev: any) => ({
                          ...prev,
                          backupDates: (prev.backupDates || []).filter((_: any, i: number) => i !== index)
                        }));
                      }}
                      className="h-9 w-9 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {(!formData.backupDates || formData.backupDates.length === 0) && (
              <p className="text-xs text-gray-500">
                Add alternate dates if the primary event date is not available
              </p>
            )}
          </div>
        </div>

        {/* Start/End Times */}
        <div>
          <Label htmlFor="eventStartTime">Start Time</Label>
          <Input
            id="eventStartTime"
            type="time"
            value={formData.eventStartTime}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, eventStartTime: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="eventEndTime">End Time</Label>
          <Input
            id="eventEndTime"
            type="time"
            value={formData.eventEndTime}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, eventEndTime: e.target.value }))}
          />
        </div>

        {/* Pickup Date/Time */}
        <div>
          <Label htmlFor="pickupDate">Pickup Date</Label>
          <Input
            id="pickupDate"
            type="date"
            value={formData.pickupDate}
            onChange={(e) => {
              const newDate = e.target.value;
              setFormData((prev: any) => ({
                ...prev,
                pickupDate: newDate,
                pickupDateTime: newDate && prev.pickupTimeSeparate ? `${newDate}T${prev.pickupTimeSeparate}` : '',
                pickupTime: ''
              }));
            }}
            min={formData.eventDate || undefined}
            data-testid="pickup-date-input"
          />
        </div>
        <div>
          <Label htmlFor="pickupTimeSeparate">Pickup Time</Label>
          <Input
            id="pickupTimeSeparate"
            type="time"
            value={formData.pickupTimeSeparate}
            onChange={(e) => {
              const newTime = e.target.value;
              setFormData((prev: any) => ({
                ...prev,
                pickupTimeSeparate: newTime,
                pickupDateTime: prev.pickupDate && newTime ? `${prev.pickupDate}T${newTime}` : '',
                pickupTime: ''
              }));
            }}
            min={formData.pickupDate === formData.eventDate && formData.eventEndTime ? formData.eventEndTime : undefined}
            data-testid="pickup-time-input"
          />
          {formData.pickupDate === formData.eventDate &&
           formData.eventEndTime &&
           formData.pickupTimeSeparate &&
           formData.pickupTimeSeparate < formData.eventEndTime && (
            <p className="text-xs text-amber-600 mt-1">
              Note: Pickup time is before event ends ({formData.eventEndTime})
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
