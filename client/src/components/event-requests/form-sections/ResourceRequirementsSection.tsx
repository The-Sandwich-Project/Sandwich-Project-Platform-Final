/**
 * ResourceRequirementsSection - Driver and Volunteer Requirements
 *
 * Section for specifying resource needs including:
 * - Self-transport option
 * - Drivers needed (with van driver selection)
 * - Volunteers needed
 * (The speaker role has been retired.)
 *
 * Extracted from EventSchedulingForm.tsx for better organization.
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
import { Car, CheckCircle2 } from 'lucide-react';
import type { FormSectionProps } from './types';

interface VanDriver {
  id: number | string;
  name: string;
}

interface ResourceRequirementsSectionProps extends FormSectionProps {
  /** List of van-approved drivers for selection */
  vanDrivers: VanDriver[];
  /** Whether section is complete (shows checkmark) */
  isComplete?: boolean;
}

export const ResourceRequirementsSection: React.FC<ResourceRequirementsSectionProps> = ({
  formData,
  setFormData,
  vanDrivers,
  isComplete,
}) => {
  return (
    <div className="space-y-4 border rounded-lg p-4 bg-white">
      <div className="flex items-center gap-3 pb-2 border-b">
        <Car className="w-5 h-5 text-[#236383]" />
        <span className="text-lg font-semibold text-[#236383]">Resource Requirements</span>
        {isComplete && <CheckCircle2 className="w-4 h-4 text-tsp-teal" />}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Drivers */}
        <div className="space-y-3">
          <Label>Driver Requirements</Label>
          <div className="space-y-2">
            {/* Self-Transport Option */}
            <div className="flex items-center space-x-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <input
                type="checkbox"
                id="selfTransport"
                checked={formData.selfTransport}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  selfTransport: e.target.checked,
                  // Clear driver fields when self-transport is enabled
                  driversNeeded: e.target.checked ? 0 : prev.driversNeeded,
                  vanDriverNeeded: e.target.checked ? false : prev.vanDriverNeeded,
                  vanNeededFor: e.target.checked ? '' : prev.vanNeededFor,
                  isDhlVan: e.target.checked ? false : prev.isDhlVan,
                }))}
              />
              <Label htmlFor="selfTransport" className="text-amber-800 font-medium">
                Organization Self-Transport
              </Label>
            </div>
            {formData.selfTransport && (
              <p className="text-sm text-amber-700 ml-6">
                The organization will transport sandwiches themselves (no TSP driver needed).
                Use the Delivery Destination field above to note where they're delivering.
              </p>
            )}

            {/* Driver fields - only show when NOT self-transport */}
            {!formData.selfTransport && (
              <>
                <div>
                  <Label htmlFor="driversNeeded">How many drivers needed?</Label>
                  <Input
                    id="driversNeeded"
                    type="number"
                    value={formData.driversNeeded}
                    onChange={(e) => setFormData(prev => ({ ...prev, driversNeeded: parseInt(e.target.value) || 0 }))}
                    min="0"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="vanDriverNeeded"
                    checked={formData.vanDriverNeeded}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      vanDriverNeeded: e.target.checked,
                      vanNeededFor: e.target.checked ? prev.vanNeededFor : '',
                      isDhlVan: e.target.checked ? prev.isDhlVan : false,
                      // Default to no additional regular drivers when van driver is checked
                      driversNeeded: e.target.checked ? 0 : prev.driversNeeded
                    }))}
                  />
                  <Label htmlFor="vanDriverNeeded">Van driver needed?</Label>
                </div>
                {formData.vanDriverNeeded && (
                  <div>
                    <Label htmlFor="vanNeededFor">Van needed for?</Label>
                    <Select
                      value={formData.vanNeededFor || undefined}
                      onValueChange={(value) => setFormData(prev => ({
                        ...prev,
                        vanNeededFor: value as 'transport' | 'refrigeration' | '',
                      }))}
                    >
                      <SelectTrigger id="vanNeededFor">
                        <SelectValue placeholder="Transport or refrigeration…" />
                      </SelectTrigger>
                      <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                        <SelectItem value="transport">Transport</SelectItem>
                        <SelectItem value="refrigeration">Refrigeration during event</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            {/* Van Driver Selection - Only show when van driver is needed and NOT self-transport */}
            {formData.vanDriverNeeded && !formData.selfTransport && (
              <div className="mt-3 p-3 bg-tsp-cream border border-tsp-gold rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <input
                    type="checkbox"
                    id="isDhlVan"
                    checked={formData.isDhlVan}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      isDhlVan: e.target.checked,
                      assignedVanDriverId: e.target.checked ? '' : prev.assignedVanDriverId,
                      vanDriverNeeded: e.target.checked ? true : prev.vanDriverNeeded,
                      // Default to no additional regular drivers when DHL van is checked
                      driversNeeded: e.target.checked ? 0 : prev.driversNeeded,
                    }))}
                  />
                  <Label htmlFor="isDhlVan">Use DHL van (external driver)</Label>
                </div>
                {formData.isDhlVan && (
                  <p className="text-xs text-amber-700 mb-2">
                    We will not assign an internal van driver. This still counts as the van being covered.
                  </p>
                )}
                <Label htmlFor="assignedVanDriver">Select Van Driver (Optional)</Label>
                <Select
                  value={formData.assignedVanDriverId || ''}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, assignedVanDriverId: value }))}
                  disabled={formData.isDhlVan}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a van-approved driver..." />
                  </SelectTrigger>
                  <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                    <SelectItem value="none">No driver assigned yet</SelectItem>
                    {vanDrivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.id.toString()}>
                        {driver.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-tsp-navy mt-1">
                  If no driver is selected, the event card will show "Van Driver Needed"
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Volunteers (speaker role retired) */}
        <div className="space-y-3">
          <Label>Additional Resources</Label>
          <div className="space-y-2">
            <div>
              <Label htmlFor="volunteersNeeded">How many volunteers needed?</Label>
              <Input
                id="volunteersNeeded"
                type="number"
                value={formData.volunteersNeeded}
                onChange={(e) => setFormData(prev => ({ ...prev, volunteersNeeded: parseInt(e.target.value) || 0 }))}
                min="0"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
