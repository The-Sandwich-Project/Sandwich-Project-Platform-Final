/**
 * Status & Toolkit Section
 *
 * Handles event status selection.
 */
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VALID_STATUS_TRANSITIONS, STATUS_DEFINITIONS } from '../constants';
import type { EventStatus } from '@shared/event-status-workflow';
import type { EventFormData } from './types';

interface StatusToolkitSectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  eventRequest: any | null;
  onStatusChange: (newStatus: EventStatus) => void;
}

export const StatusToolkitSection: React.FC<StatusToolkitSectionProps> = ({
  formData,
  setFormData,
  eventRequest,
  onStatusChange,
}) => {
  const effectiveStatus = formData.status || eventRequest?.status || 'new';

  return (
    <>
      {/* Status */}
      <div>
        <Label htmlFor="status">Status</Label>
        <Select value={effectiveStatus} onValueChange={onStatusChange}>
          <SelectTrigger data-testid="select-status">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent className="z-[200]" position="popper" sideOffset={5}>
            <SelectItem value={effectiveStatus}>
              {STATUS_DEFINITIONS[effectiveStatus as EventStatus]?.label || effectiveStatus} (Current)
            </SelectItem>
            {(VALID_STATUS_TRANSITIONS[effectiveStatus as EventStatus] || [])
              .filter(s => s !== effectiveStatus)
              .map(status => (
                <SelectItem key={status} value={status}>
                  {STATUS_DEFINITIONS[status]?.label || status}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {effectiveStatus && STATUS_DEFINITIONS[effectiveStatus as EventStatus] && (
          <p className="text-xs text-gray-500 mt-1">
            {STATUS_DEFINITIONS[effectiveStatus as EventStatus].definition}
          </p>
        )}
      </div>

    </>
  );
};
