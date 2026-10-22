/**
 * ContactInfoSection - Primary Contact Information
 *
 * Collapsible section for managing primary contact details in the event scheduling form.
 * Extracted from EventSchedulingForm.tsx for better organization.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronDown, User, CheckCircle2 } from 'lucide-react';
import type { FormSectionProps } from './types';

interface ContactInfoSectionProps extends FormSectionProps {
  /** Whether section is expanded */
  isExpanded: boolean;
  /** Toggle section expansion */
  onToggle: () => void;
  /** Whether section is complete (shows checkmark) */
  isComplete?: boolean;
  /** Whether the form is in create mode (manual entry) */
  isCreateMode?: boolean;
  /** Show "How did this request come in?". Defaults to create mode only. */
  showRequestSourcePicker?: boolean;
}

export const ContactInfoSection: React.FC<ContactInfoSectionProps> = ({
  formData,
  setFormData,
  isExpanded,
  onToggle,
  isComplete,
  isCreateMode,
  showRequestSourcePicker,
}) => {
  return (
    <div className="border rounded-lg overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        className="w-full flex justify-between items-center p-4 bg-[#e6f2f5] hover:bg-[#d4e8ed]"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <User className="w-5 h-5 text-[#236383]" />
          <span className="font-semibold text-[#236383]">Primary Contact Information</span>
          {isComplete && <CheckCircle2 className="w-4 h-4 text-green-600" />}
        </div>
        <ChevronDown className={`w-4 h-4 text-[#236383] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </Button>

      {isExpanded && (
        <div className="p-4 border-t bg-[#e6f2f5] grid grid-cols-1 md:grid-cols-2 gap-4">
          {(showRequestSourcePicker ?? isCreateMode) && (
            <div className="md:col-span-2">
              <Label htmlFor="manualEntrySource" className="text-sm font-semibold">
                How did this request come in? <span className="text-slate-500 font-normal">(recommended)</span>
              </Label>
              <Select
                value={formData.manualEntrySource || ''}
                onValueChange={(value) => setFormData(prev => ({ ...prev, manualEntrySource: value }))}
              >
                <SelectTrigger id="manualEntrySource">
                  <SelectValue placeholder="Select request source (optional)" />
                </SelectTrigger>
                <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                  <SelectItem value="phone_call">Phone Call</SelectItem>
                  <SelectItem value="text_message">Text Message</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="social_media">Social Media DM</SelectItem>
                  <SelectItem value="in_person">In Person</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1">
                Optional — you can save with just an org name or event date and fill contact details later.
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="contactFirstName">First Name</Label>
            <Input
              id="contactFirstName"
              value={formData.firstName || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
              placeholder="Enter first name"
            />
          </div>
          <div>
            <Label htmlFor="contactLastName">Last Name</Label>
            <Input
              id="contactLastName"
              value={formData.lastName || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
              placeholder="Enter last name"
            />
          </div>
          <div>
            <Label htmlFor="contactEmail">Email</Label>
            <Input
              id="contactEmail"
              type="text"
              inputMode="email"
              autoComplete="email"
              value={formData.email || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              placeholder="Enter email address (optional)"
            />
          </div>
          <div>
            <Label htmlFor="contactPhone">Phone</Label>
            <Input
              id="contactPhone"
              type="tel"
              autoComplete="tel"
              value={formData.phone || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="Enter phone number (optional)"
            />
          </div>
          <div>
            <Label htmlFor="contactOrganization">Organization</Label>
            <Input
              id="contactOrganization"
              value={formData.organizationName || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, organizationName: e.target.value }))}
              placeholder="Enter organization name"
            />
          </div>
          <div>
            <Label htmlFor="contactDepartment">Department</Label>
            <Input
              id="contactDepartment"
              value={formData.department || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
              placeholder="Enter department"
            />
          </div>
          <div>
            <Label htmlFor="previouslyHosted">Previously Hosted?</Label>
            <Select
              value={formData.previouslyHosted || 'i_dont_know'}
              onValueChange={(value) => setFormData(prev => ({ ...prev, previouslyHosted: value }))}
            >
              <SelectTrigger id="previouslyHosted">
                <SelectValue placeholder="Select hosting history" />
              </SelectTrigger>
              <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                <SelectItem value="yes">Yes - Hosted Before</SelectItem>
                <SelectItem value="no">No - First Time</SelectItem>
                <SelectItem value="i_dont_know">I Don't Know</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="organizationCategory">Organization Category</Label>
            <Select
              value={formData.organizationCategory || ''}
              onValueChange={(value) => setFormData(prev => ({
                ...prev,
                organizationCategory: value,
                // Clear school classification if category changes to non-school
                schoolClassification: value === 'school' ? prev.schoolClassification : ''
              }))}
            >
              <SelectTrigger id="organizationCategory">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                <SelectItem value="school">School</SelectItem>
                <SelectItem value="church_faith">Church/Faith Group</SelectItem>
                <SelectItem value="religious">Religious Organization</SelectItem>
                <SelectItem value="nonprofit">Nonprofit</SelectItem>
                <SelectItem value="government">Government</SelectItem>
                <SelectItem value="hospital">Hospital</SelectItem>
                <SelectItem value="political">Political Organization</SelectItem>
                <SelectItem value="club">Club</SelectItem>
                <SelectItem value="neighborhood">Neighborhood</SelectItem>
                <SelectItem value="greek_life">Fraternity/Sorority</SelectItem>
                <SelectItem value="cultural">Cultural Organization</SelectItem>
                <SelectItem value="corp">Company</SelectItem>
                <SelectItem value="large_corp">Large Corporation</SelectItem>
                <SelectItem value="small_medium_corp">Small/Medium Business</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {formData.organizationCategory === 'school' && (
            <div>
              <Label htmlFor="schoolClassification">School Classification</Label>
              <Select
                value={formData.schoolClassification || ''}
                onValueChange={(value) => setFormData(prev => ({ ...prev, schoolClassification: value }))}
              >
                <SelectTrigger id="schoolClassification">
                  <SelectValue placeholder="Select school type" />
                </SelectTrigger>
                <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="charter">Charter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
