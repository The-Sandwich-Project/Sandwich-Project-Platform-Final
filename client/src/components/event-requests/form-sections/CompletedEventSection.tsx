/**
 * CompletedEventSection - Post-Event Tracking Details
 *
 * Collapsible section for tracking completed event details including:
 * - Social media post tracking
 * - Actual sandwiches delivered (with type breakdown option)
 * - Follow-up completion tracking
 *
 * Only visible when event status is "completed".
 * Extracted from EventSchedulingForm.tsx for better organization.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { SANDWICH_TYPES } from '../constants';
import type { FormSectionProps } from './types';

interface CompletedEventSectionProps extends FormSectionProps {
  /** Whether section is expanded */
  isExpanded: boolean;
  /** Toggle section expansion */
  onToggle: () => void;
  /** Current mode for actual sandwich tracking: 'total' or 'types' */
  actualSandwichMode: 'total' | 'types';
  /** Setter for actual sandwich mode */
  setActualSandwichMode: React.Dispatch<React.SetStateAction<'total' | 'types'>>;
}

export const CompletedEventSection: React.FC<CompletedEventSectionProps> = ({
  formData,
  setFormData,
  isExpanded,
  onToggle,
  actualSandwichMode,
  setActualSandwichMode,
}) => {
  // Only render if status is completed
  if (formData.status !== 'completed') {
    return null;
  }

  // Handler functions for actual sandwich types
  const addActualSandwichType = () => {
    setFormData(prev => ({
      ...prev,
      actualSandwichTypes: [...(prev.actualSandwichTypes || []), { type: 'turkey', quantity: 0 }]
    }));
  };

  const updateActualSandwichType = (index: number, field: 'type' | 'quantity', value: string | number) => {
    setFormData(prev => ({
      ...prev,
      actualSandwichTypes: (prev.actualSandwichTypes || []).map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    }));
  };

  const removeActualSandwichType = (index: number) => {
    setFormData(prev => ({
      ...prev,
      actualSandwichTypes: (prev.actualSandwichTypes || []).filter((_, i) => i !== index)
    }));
  };

  return (
    <div className="border rounded-lg">
      <Button
        type="button"
        variant="ghost"
        className="w-full flex justify-between items-center p-4"
        onClick={onToggle}
        data-testid="toggle-completed-details"
      >
        <span className="font-semibold text-tsp-teal">
          Completed Event Details
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </Button>

      {isExpanded && (
        <div className="p-4 border-t bg-[#e6f2f5] space-y-6">

          {/* Social Media Tracking Section */}
          <div className="space-y-4">
            <h4 className="text-md font-semibold text-tsp-teal">Social Media Tracking</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="socialMediaPostRequested"
                    checked={formData.socialMediaPostRequested}
                    onChange={(e) => setFormData(prev => ({ ...prev, socialMediaPostRequested: e.target.checked }))}
                    className="w-4 h-4"
                    data-testid="checkbox-social-media-requested"
                  />
                  <Label htmlFor="socialMediaPostRequested">Social Media Post Requested</Label>
                </div>
                {formData.socialMediaPostRequested && (
                  <div className="ml-6">
                    <Label htmlFor="socialMediaPostRequestedDate">Requested Date</Label>
                    <Input
                      id="socialMediaPostRequestedDate"
                      type="date"
                      value={formData.socialMediaPostRequestedDate}
                      onChange={(e) => setFormData(prev => ({ ...prev, socialMediaPostRequestedDate: e.target.value }))}
                      data-testid="input-social-media-requested-date"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="socialMediaPostCompleted"
                    checked={formData.socialMediaPostCompleted}
                    onChange={(e) => setFormData(prev => ({ ...prev, socialMediaPostCompleted: e.target.checked }))}
                    className="w-4 h-4"
                    data-testid="checkbox-social-media-completed"
                  />
                  <Label htmlFor="socialMediaPostCompleted">Social Media Post Completed</Label>
                </div>
                {formData.socialMediaPostCompleted && (
                  <div className="ml-6">
                    <Label htmlFor="socialMediaPostCompletedDate">Completed Date</Label>
                    <Input
                      id="socialMediaPostCompletedDate"
                      type="date"
                      value={formData.socialMediaPostCompletedDate}
                      onChange={(e) => setFormData(prev => ({ ...prev, socialMediaPostCompletedDate: e.target.value }))}
                      data-testid="input-social-media-completed-date"
                    />
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="socialMediaPostNotes">Social Media Notes</Label>
              <Textarea
                id="socialMediaPostNotes"
                value={formData.socialMediaPostNotes}
                onChange={(e) => setFormData(prev => ({ ...prev, socialMediaPostNotes: e.target.value }))}
                placeholder="Notes about social media posts, links, or other details"
                className="min-h-[80px]"
                data-testid="textarea-social-media-notes"
              />
            </div>
          </div>

          {/* Actual Sandwiches Delivered Section */}
          <div className="space-y-4">
            <h4 className="text-md font-semibold text-tsp-teal">Actual Sandwiches Delivered</h4>

            {/* Mode Selector for Actual Sandwiches */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={actualSandwichMode === 'total' ? 'default' : 'outline'}
                onClick={() => setActualSandwichMode('total')}
                className="text-xs"
                data-testid="button-actual-sandwich-mode-total"
              >
                Total Count Only
              </Button>
              <Button
                type="button"
                size="sm"
                variant={actualSandwichMode === 'types' ? 'default' : 'outline'}
                onClick={() => setActualSandwichMode('types')}
                className="text-xs"
                data-testid="button-actual-sandwich-mode-types"
              >
                Specify Types
              </Button>
            </div>

            {/* Total Count Mode for Actual Sandwiches */}
            {actualSandwichMode === 'total' && (
              <div className="space-y-2">
                <Label htmlFor="actualSandwichCount">Total Number of Sandwiches Actually Delivered</Label>
                <Input
                  id="actualSandwichCount"
                  type="number"
                  value={formData.actualSandwichCount}
                  onChange={(e) => setFormData(prev => ({ ...prev, actualSandwichCount: parseInt(e.target.value) || 0 }))}
                  placeholder="Enter actual sandwich count"
                  min="0"
                  className="w-40"
                  data-testid="input-actual-sandwich-count"
                />
              </div>
            )}

            {/* Specific Types Mode for Actual Sandwiches */}
            {actualSandwichMode === 'types' && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label>Actual Sandwich Types & Quantities</Label>
                  <Button
                    type="button"
                    onClick={addActualSandwichType}
                    size="sm"
                    data-testid="button-add-actual-sandwich-type"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Type
                  </Button>
                </div>

                {formData.actualSandwichTypes.length === 0 ? (
                  <div className="text-center py-4 text-tsp-teal border-2 border-dashed border-tsp-teal/30 rounded">
                    <p>No actual sandwich types added yet. Click "Add Type" to get started.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formData.actualSandwichTypes.map((sandwich, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 border rounded bg-white">
                        <Select
                          value={sandwich.type}
                          onValueChange={(value) => updateActualSandwichType(index, 'type', value)}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                            {SANDWICH_TYPES.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          placeholder="Quantity"
                          value={sandwich.quantity}
                          onChange={(e) => updateActualSandwichType(index, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-24"
                          min="0"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeActualSandwichType(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="text-sm text-tsp-teal bg-white p-2 rounded border border-tsp-teal/30">
                      <strong>Total:</strong> {formData.actualSandwichTypes.reduce((sum, item) => sum + item.quantity, 0)} sandwiches
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="actualSandwichCountRecordedDate">Date Recorded</Label>
              <Input
                id="actualSandwichCountRecordedDate"
                type="date"
                value={formData.actualSandwichCountRecordedDate}
                onChange={(e) => setFormData(prev => ({ ...prev, actualSandwichCountRecordedDate: e.target.value }))}
                data-testid="input-actual-sandwich-recorded-date"
              />
            </div>

            <div>
              <Label htmlFor="actualSandwichCountRecordedBy">Recorded By</Label>
              <Input
                id="actualSandwichCountRecordedBy"
                value={formData.actualSandwichCountRecordedBy}
                onChange={(e) => setFormData(prev => ({ ...prev, actualSandwichCountRecordedBy: e.target.value }))}
                placeholder="Enter name of person who recorded the count"
                data-testid="input-actual-sandwich-recorded-by"
              />
            </div>
          </div>

          {/* Follow-up Completion Section */}
          <div className="space-y-4">
            <h4 className="text-md font-semibold text-tsp-teal">Follow-up Completion</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="followUpOneDayCompleted"
                    checked={formData.followUpOneDayCompleted}
                    onChange={(e) => setFormData(prev => ({ ...prev, followUpOneDayCompleted: e.target.checked }))}
                    className="w-4 h-4"
                    data-testid="checkbox-followup-oneday-completed"
                  />
                  <Label htmlFor="followUpOneDayCompleted">1-Day Follow-up Completed</Label>
                </div>
                {formData.followUpOneDayCompleted && (
                  <div className="ml-6">
                    <Label htmlFor="followUpOneDayDate">Follow-up Date</Label>
                    <Input
                      id="followUpOneDayDate"
                      type="date"
                      value={formData.followUpOneDayDate}
                      onChange={(e) => setFormData(prev => ({ ...prev, followUpOneDayDate: e.target.value }))}
                      data-testid="input-followup-oneday-date"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="followUpOneMonthCompleted"
                    checked={formData.followUpOneMonthCompleted}
                    onChange={(e) => setFormData(prev => ({ ...prev, followUpOneMonthCompleted: e.target.checked }))}
                    className="w-4 h-4"
                    data-testid="checkbox-followup-onemonth-completed"
                  />
                  <Label htmlFor="followUpOneMonthCompleted">1-Month Follow-up Completed</Label>
                </div>
                {formData.followUpOneMonthCompleted && (
                  <div className="ml-6">
                    <Label htmlFor="followUpOneMonthDate">Follow-up Date</Label>
                    <Input
                      id="followUpOneMonthDate"
                      type="date"
                      value={formData.followUpOneMonthDate}
                      onChange={(e) => setFormData(prev => ({ ...prev, followUpOneMonthDate: e.target.value }))}
                      data-testid="input-followup-onemonth-date"
                    />
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="followUpNotes">Follow-up Notes</Label>
              <Textarea
                id="followUpNotes"
                value={formData.followUpNotes}
                onChange={(e) => setFormData(prev => ({ ...prev, followUpNotes: e.target.value }))}
                placeholder="Notes from follow-up conversations or feedback received"
                className="min-h-[80px]"
                data-testid="textarea-followup-notes"
              />
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
