/**
 * Attendee Section
 *
 * Handles estimated attendance with total or adult/children breakdown modes.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { EventFormData } from './types';

interface AttendeeSectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  attendeeMode: 'total' | 'breakdown';
  setAttendeeMode: (mode: 'total' | 'breakdown') => void;
}

export const AttendeeSection: React.FC<AttendeeSectionProps> = ({
  formData,
  setFormData,
  attendeeMode,
  setAttendeeMode,
}) => {
  return (
    <div className="space-y-3">
      <Label># of Attendees (Optional)</Label>

      {/* Mode Selector */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={attendeeMode === 'total' ? 'default' : 'outline'}
          onClick={() => setAttendeeMode('total')}
          className="text-xs"
        >
          Total Count
        </Button>
        <Button
          type="button"
          size="sm"
          variant={attendeeMode === 'breakdown' ? 'default' : 'outline'}
          onClick={() => setAttendeeMode('breakdown')}
          className="text-xs"
        >
          Adults & Children
        </Button>
      </div>

      {/* Total Count Mode */}
      {attendeeMode === 'total' && (
        <div>
          <Label htmlFor="estimatedAttendance">Estimated Attendance</Label>
          <Input
            id="estimatedAttendance"
            type="number"
            value={formData.estimatedAttendance}
            onChange={(e) => setFormData((prev: any) => ({
              ...prev,
              estimatedAttendance: parseInt(e.target.value) || 0,
              adultCount: 0,
              childrenCount: 0,
            }))}
            placeholder="Enter estimated number of attendees"
            min="0"
            className="w-40"
            data-testid="input-estimated-attendance"
          />
        </div>
      )}

      {/* Breakdown Mode */}
      {attendeeMode === 'breakdown' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="adultCount">Adults</Label>
            <Input
              id="adultCount"
              type="number"
              value={formData.adultCount || 0}
              onChange={(e) => {
                const adults = parseInt(e.target.value) || 0;
                const children = formData.childrenCount || 0;
                setFormData((prev: any) => ({
                  ...prev,
                  adultCount: adults,
                  estimatedAttendance: adults + children,
                }));
              }}
              placeholder="# of adults"
              min="0"
              className="w-32"
              data-testid="input-adult-count"
            />
          </div>
          <div>
            <Label htmlFor="childrenCount">Children</Label>
            <Input
              id="childrenCount"
              type="number"
              value={formData.childrenCount || 0}
              onChange={(e) => {
                const children = parseInt(e.target.value) || 0;
                const adults = formData.adultCount || 0;
                setFormData((prev: any) => ({
                  ...prev,
                  childrenCount: children,
                  estimatedAttendance: adults + children,
                }));
              }}
              placeholder="# of children"
              min="0"
              className="w-32"
              data-testid="input-children-count"
            />
          </div>
        </div>
      )}

      {/* Kids Age Range */}
      {(formData.childrenCount > 0 || formData.kidsAgeRange) && (
        <div className="mt-3">
          <Label htmlFor="kidsAgeRange">Kids Age Range</Label>
          <Input
            id="kidsAgeRange"
            type="text"
            value={formData.kidsAgeRange || ''}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, kidsAgeRange: e.target.value }))}
            placeholder="e.g., 5-12, Elementary school, Middle school"
            className="w-64"
            data-testid="input-kids-age-range"
          />
          <p className="text-xs text-gray-500 mt-1">
            Optional: Age range of children participating (e.g., "5-12", "Elementary school")
          </p>
        </div>
      )}

      <p className="text-sm text-[#236383]">
        Optional: Estimate how many people will attend this event.
      </p>
    </div>
  );
};
