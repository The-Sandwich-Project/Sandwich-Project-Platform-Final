import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { RecipientFormData, SectionState } from '@/hooks/useRecipientForm';
import { DELIVERY_CADENCE_OPTIONS } from './recipient-schedule-utils';

interface RecipientFormProps {
  formData: RecipientFormData;
  sections: SectionState;
  onFieldChange: <K extends keyof RecipientFormData>(field: K, value: RecipientFormData[K]) => void;
  onSectionChange: (section: string, open: boolean) => void;
  mode: 'add' | 'edit';
  idPrefix?: string;
}

// Predefined focus areas
const FOCUS_AREAS = ['Youth', 'Veterans', 'Seniors', 'Families', 'Unhoused', 'Refugees', 'Disabilities', 'Other'];

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const DAY_ABBREV: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

type ScheduleEntry = { day: string; time: string; notes?: string };

/** Reusable schedule entry list — supports multiple day/time combos with optional notes */
function ScheduleEntryList({
  entries,
  onChange,
  label,
  idPrefix = '',
}: {
  entries: ScheduleEntry[];
  onChange: (entries: ScheduleEntry[]) => void;
  label: string;
  idPrefix?: string;
}) {
  const addEntry = () => onChange([...entries, { day: '', time: '' }]);
  const removeEntry = (idx: number) => onChange(entries.filter((_, i) => i !== idx));
  const updateEntry = (idx: number, field: keyof ScheduleEntry, value: string) => {
    const updated = entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e));
    onChange(updated);
  };

  const toggleDay = (idx: number, dayName: string) => {
    const entry = entries[idx];
    // Day field stores comma-separated day names (e.g. "Monday, Wednesday")
    const currentDays = entry.day ? entry.day.split(',').map((d) => d.trim()).filter(Boolean) : [];
    const newDays = currentDays.includes(dayName)
      ? currentDays.filter((d) => d !== dayName)
      : [...currentDays, dayName];
    // Sort by day order
    newDays.sort((a, b) => DAYS_OF_WEEK.indexOf(a as any) - DAYS_OF_WEEK.indexOf(b as any));
    updateEntry(idx, 'day', newDays.join(', '));
  };

  return (
    <div className="space-y-3">
      {entries.map((entry, idx) => {
        const selectedDays = entry.day ? entry.day.split(',').map((d) => d.trim()).filter(Boolean) : [];
        return (
          <div key={idx} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                {label} {entries.length > 1 ? `#${idx + 1}` : 'time'}
              </span>
              <button
                type="button"
                onClick={() => removeEntry(idx)}
                className="text-slate-400 hover:text-red-500 p-0.5"
                title="Remove"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Day of week chips */}
            <div>
              <Label className="text-xs text-slate-600 mb-1.5 block">Days</Label>
              <div className="flex flex-wrap gap-1">
                {DAYS_OF_WEEK.map((day) => {
                  const isSelected = selectedDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(idx, day)}
                      className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                        isSelected
                          ? 'bg-blue-100 border-blue-300 text-blue-800 font-medium'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {DAY_ABBREV[day] || day}
                    </button>
                  );
                })}
              </div>
              {/* Also allow free text for non-standard day descriptions */}
              <Input
                type="text"
                value={entry.day}
                onChange={(e) => updateEntry(idx, 'day', e.target.value)}
                placeholder="Or type: e.g. Every other Monday, 1st & 3rd Tuesday"
                className="mt-1.5 text-xs h-8"
                id={`${idPrefix}${label}-day-${idx}`}
              />
            </div>
            {/* Time */}
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">Time</Label>
              <Input
                type="text"
                value={entry.time}
                onChange={(e) => updateEntry(idx, 'time', e.target.value)}
                placeholder="e.g. 9:00 AM, 11:30 AM - 1:00 PM"
                className="text-xs h-8"
                id={`${idPrefix}${label}-time-${idx}`}
              />
            </div>
            {/* Notes */}
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">
                Notes / frequency (optional)
              </Label>
              <Input
                type="text"
                value={entry.notes || ''}
                onChange={(e) => updateEntry(idx, 'notes', e.target.value)}
                placeholder="e.g. 3rd Monday of every month, biweekly, side entrance"
                className="text-xs h-8"
                id={`${idPrefix}${label}-notes-${idx}`}
              />
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addEntry}
        className="text-xs"
      >
        <Plus className="w-3 h-3 mr-1" />
        Add {label} time
      </Button>
    </div>
  );
}

type AddressEntry = { label: string; address: string };

/**
 * Reusable extra-address list — labeled addresses below the primary.
 *
 * The primary `address` field upstream stays authoritative for the map +
 * region detection. Entries here are reference-only ("warehouse",
 * "north site", "summer location").
 */
function ExtraAddressesList({
  entries,
  onChange,
  idPrefix,
}: {
  entries: AddressEntry[];
  onChange: (entries: AddressEntry[]) => void;
  idPrefix: string;
}) {
  const addEntry = () => onChange([...entries, { label: '', address: '' }]);
  const removeEntry = (idx: number) => onChange(entries.filter((_, i) => i !== idx));
  const updateEntry = (idx: number, field: keyof AddressEntry, value: string) => {
    onChange(entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
  };

  return (
    <div className="space-y-2">
      {entries.length === 0 && (
        <p className="text-xs text-slate-500 italic">
          No additional addresses. The primary above is used for the map.
        </p>
      )}
      {entries.map((entry, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[120px_1fr_auto] gap-2 items-start p-2 rounded border border-slate-200 bg-slate-50/40"
        >
          <div>
            <Label className="text-xs text-slate-600 mb-1 block">Label</Label>
            <Input
              type="text"
              value={entry.label}
              onChange={(e) => updateEntry(idx, 'label', e.target.value)}
              placeholder="e.g. Warehouse"
              className="text-xs h-8"
              id={`${idPrefix}address-label-${idx}`}
            />
          </div>
          <div>
            <Label className="text-xs text-slate-600 mb-1 block">Address</Label>
            <Input
              type="text"
              value={entry.address}
              onChange={(e) => updateEntry(idx, 'address', e.target.value)}
              placeholder="123 Main St, City, State 12345"
              className="text-xs h-8"
              id={`${idPrefix}address-value-${idx}`}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => removeEntry(idx)}
            className="text-xs text-slate-500 hover:text-red-600 mt-5"
            aria-label="Remove address"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addEntry}
        className="text-xs"
      >
        <Plus className="w-3 h-3 mr-1" />
        Add another address
      </Button>
    </div>
  );
}

type BreakdownRow = { type: string; min: number; max: number };

/**
 * Per-type sandwich breakdown with min/max range support.
 *
 * Each row captures planned distribution: a sandwich type + a min and max.
 * Single number = type same min/max. Range = different min/max (150-200).
 * The summed total range is computed live and shown beneath the rows.
 */
function PlannedBreakdownList({
  entries,
  onChange,
  idPrefix,
}: {
  entries: BreakdownRow[];
  onChange: (entries: BreakdownRow[]) => void;
  idPrefix: string;
}) {
  const addEntry = () => onChange([...entries, { type: '', min: 0, max: 0 }]);
  const removeEntry = (idx: number) => onChange(entries.filter((_, i) => i !== idx));
  const updateEntry = (idx: number, field: keyof BreakdownRow, value: string) => {
    onChange(
      entries.map((e, i) => {
        if (i !== idx) return e;
        if (field === 'type') return { ...e, type: value };
        const n = value === '' ? 0 : Math.max(0, parseInt(value, 10) || 0);
        return { ...e, [field]: n };
      })
    );
  };

  // Live total range.
  const totalMin = entries.reduce((s, r) => s + (Number(r.min) || 0), 0);
  const totalMax = entries.reduce((s, r) => s + (Number(r.max) || 0), 0);
  const totalLabel =
    totalMin === totalMax
      ? totalMin.toLocaleString()
      : `${totalMin.toLocaleString()}-${totalMax.toLocaleString()}`;

  return (
    <div className="space-y-2">
      {entries.length === 0 && (
        <p className="text-xs text-slate-500 italic">
          No type breakdown yet. Add rows to capture planned distribution by sandwich type.
        </p>
      )}
      {entries.map((entry, idx) => {
        const minGtMax = entry.min > entry.max && entry.max > 0;
        return (
          <div
            key={idx}
            className="grid grid-cols-[1fr_80px_80px_auto] gap-2 items-end p-2 rounded border border-slate-200 bg-slate-50/40"
          >
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">Sandwich type</Label>
              <Input
                type="text"
                value={entry.type}
                onChange={(e) => updateEntry(idx, 'type', e.target.value)}
                placeholder="e.g. Deli, PB&J, Veggie"
                className="text-xs h-8"
                id={`${idPrefix}breakdown-type-${idx}`}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">Min</Label>
              <Input
                type="number"
                min={0}
                value={entry.min === 0 ? '' : entry.min}
                onChange={(e) => updateEntry(idx, 'min', e.target.value)}
                placeholder="0"
                className="text-xs h-8"
                id={`${idPrefix}breakdown-min-${idx}`}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">Max</Label>
              <Input
                type="number"
                min={0}
                value={entry.max === 0 ? '' : entry.max}
                onChange={(e) => updateEntry(idx, 'max', e.target.value)}
                placeholder="0"
                className={`text-xs h-8 ${minGtMax ? 'border-red-400' : ''}`}
                id={`${idPrefix}breakdown-max-${idx}`}
                title={minGtMax ? 'Max should be at least the min' : undefined}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeEntry(idx)}
              className="text-xs text-slate-500 hover:text-red-600"
              aria-label="Remove breakdown row"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addEntry}
          className="text-xs"
        >
          <Plus className="w-3 h-3 mr-1" />
          Add type
        </Button>
        {entries.length > 0 && (
          <div className="text-xs text-slate-600">
            Total planned: <span className="font-semibold text-slate-800">{totalLabel}</span>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Use the same value for min and max for a single number; differ them for a range
        (e.g., min 150, max 200 = "150-200").
      </p>
    </div>
  );
}

// Contact methods
const CONTACT_METHODS = [
  { id: 'text', label: 'Text' },
  { id: 'email', label: 'Email' },
  { id: 'call', label: 'Call' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'facebook', label: 'Facebook' },
];

export function RecipientForm({
  formData,
  sections,
  onFieldChange,
  onSectionChange,
  mode,
  idPrefix = '',
}: RecipientFormProps) {
  const [customFocusArea, setCustomFocusArea] = useState('');

  // Section keys depend on mode
  const sectionKey = (name: string) => mode === 'edit' ? `edit${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;
  const inputId = (name: string) => idPrefix ? `${idPrefix}-${name}` : name;

  const toggleFocusArea = (area: string) => {
    const updated = formData.focusAreas.includes(area)
      ? formData.focusAreas.filter(a => a !== area)
      : [...formData.focusAreas, area];
    onFieldChange('focusAreas', updated);
  };

  const addCustomFocusArea = () => {
    const trimmed = customFocusArea.trim();
    if (trimmed && !formData.focusAreas.includes(trimmed)) {
      onFieldChange('focusAreas', [...formData.focusAreas, trimmed]);
      setCustomFocusArea('');
    }
  };

  const toggleContactMethod = (
    field: 'preferredContactMethods' | 'allowedContactMethods',
    method: string,
    checked: boolean
  ) => {
    const methods = checked
      ? [...formData[field], method]
      : formData[field].filter(m => m !== method);
    onFieldChange(field, methods);
  };

  const updateImpactStory = (index: number, updates: Partial<{ story: string; date: string; source: string }>) => {
    const updated = [...formData.impactStories];
    updated[index] = { ...updated[index], ...updates };
    onFieldChange('impactStories', updated);
  };

  const removeImpactStory = (index: number) => {
    const updated = formData.impactStories.filter((_, i) => i !== index);
    onFieldChange('impactStories', updated);
  };

  const addImpactStory = () => {
    onFieldChange('impactStories', [
      ...formData.impactStories,
      { story: '', date: '', source: '' }
    ]);
  };

  return (
    <div className="space-y-4">
      {/* Basic Information Section */}
      <Collapsible
        open={sections[sectionKey('basicInfo')]}
        onOpenChange={(open) => onSectionChange(sectionKey('basicInfo'), open)}
      >
        <div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Basic Information</h4>
              {sections[sectionKey('basicInfo')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="space-y-4">
              <div>
                <Label htmlFor={inputId('name')}>Name *</Label>
                <Input
                  id={inputId('name')}
                  value={formData.name}
                  onChange={(e) => onFieldChange('name', e.target.value)}
                  placeholder="Enter recipient name"
                />
              </div>
              <div>
                <Label className="text-sm">Status</Label>
                <p className="text-xs text-slate-500 mb-1.5">
                  Inactive orgs are hidden from default filters but kept for history.
                </p>
                <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => onFieldChange('status', 'active')}
                    aria-pressed={formData.status === 'active'}
                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      formData.status === 'active'
                        ? 'bg-[#47B3CB]/20 text-[#236383] border border-[#47B3CB]/40'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => onFieldChange('status', 'inactive')}
                    aria-pressed={formData.status === 'inactive'}
                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      formData.status === 'inactive'
                        ? 'bg-slate-200 text-slate-800 border border-slate-300'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Inactive
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor={inputId('phone')}>Phone Number *</Label>
                <Input
                  id={inputId('phone')}
                  value={formData.phone}
                  onChange={(e) => onFieldChange('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <Label htmlFor={inputId('email')}>Email</Label>
                <Input
                  id={inputId('email')}
                  type="email"
                  value={formData.email}
                  onChange={(e) => onFieldChange('email', e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <Label htmlFor={inputId('website')}>Website</Label>
                <Input
                  id={inputId('website')}
                  type="text"
                  value={formData.website}
                  onChange={(e) => onFieldChange('website', e.target.value)}
                  placeholder="www.organization.org or https://organization.org"
                />
              </div>
              <div>
                <Label htmlFor={inputId('instagramHandle')}>Instagram Handle</Label>
                <Input
                  id={inputId('instagramHandle')}
                  type="text"
                  value={formData.instagramHandle}
                  onChange={(e) => onFieldChange('instagramHandle', e.target.value)}
                  placeholder="@organizationhandle"
                />
              </div>
              <div>
                <Label htmlFor={inputId('ein')}>EIN (Tax ID)</Label>
                <Input
                  id={inputId('ein')}
                  type="text"
                  value={formData.ein}
                  onChange={(e) => onFieldChange('ein', e.target.value)}
                  placeholder="XX-XXXXXXX"
                />
              </div>
              <div className="sm:col-span-2 space-y-3">
                <div>
                  <Label htmlFor={inputId('address')}>Primary street address</Label>
                  <p className="text-xs text-slate-500 mb-1">
                    Used for the map and region detection.
                  </p>
                  <Input
                    id={inputId('address')}
                    value={formData.address}
                    onChange={(e) => onFieldChange('address', e.target.value)}
                    placeholder="123 Main St, City, State 12345"
                  />
                </div>
                <div>
                  <Label className="text-sm">Additional addresses (optional)</Label>
                  <p className="text-xs text-slate-500 mb-1.5">
                    Use these for secondary sites — warehouse, north location, summer site, etc.
                  </p>
                  <ExtraAddressesList
                    entries={formData.addresses || []}
                    onChange={(addresses) => onFieldChange('addresses', addresses)}
                    idPrefix={idPrefix}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor={inputId('region')}>Region/Area</Label>
                <Input
                  id={inputId('region')}
                  value={formData.region}
                  onChange={(e) => onFieldChange('region', e.target.value)}
                  placeholder="Downtown, Sandy Springs, Buckhead, etc."
                />
              </div>
              <div>
                <Label htmlFor={inputId('preferences')}>Preferences</Label>
                <Input
                  id={inputId('preferences')}
                  value={formData.preferences}
                  onChange={(e) => onFieldChange('preferences', e.target.value)}
                  placeholder="Dietary restrictions or preferences"
                />
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Contact Person Section */}
      <Collapsible
        open={sections[sectionKey('contact')]}
        onOpenChange={(open) => onSectionChange(sectionKey('contact'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Contact Person Information</h4>
              {sections[sectionKey('contact')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={inputId('contactPersonName')}>Contact Name</Label>
                <Input
                  id={inputId('contactPersonName')}
                  value={formData.contactPersonName}
                  onChange={(e) => onFieldChange('contactPersonName', e.target.value)}
                  placeholder="John Smith"
                />
              </div>
              <div>
                <Label htmlFor={inputId('contactPersonRole')}>Role/Title</Label>
                <Input
                  id={inputId('contactPersonRole')}
                  value={formData.contactPersonRole}
                  onChange={(e) => onFieldChange('contactPersonRole', e.target.value)}
                  placeholder="Manager, Director, etc."
                />
              </div>
              <div>
                <Label htmlFor={inputId('contactPersonPhone')}>Contact Phone</Label>
                <Input
                  id={inputId('contactPersonPhone')}
                  value={formData.contactPersonPhone}
                  onChange={(e) => onFieldChange('contactPersonPhone', e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <Label htmlFor={inputId('contactPersonEmail')}>Contact Email</Label>
                <Input
                  id={inputId('contactPersonEmail')}
                  type="email"
                  value={formData.contactPersonEmail}
                  onChange={(e) => onFieldChange('contactPersonEmail', e.target.value)}
                  placeholder="john@organization.org"
                />
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Second Contact Person Section */}
      <Collapsible
        open={sections[sectionKey('secondContact')]}
        onOpenChange={(open) => onSectionChange(sectionKey('secondContact'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Second Contact Person (Optional)</h4>
              {sections[sectionKey('secondContact')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={inputId('secondContactPersonName')}>Contact Name</Label>
                <Input
                  id={inputId('secondContactPersonName')}
                  value={formData.secondContactPersonName}
                  onChange={(e) => onFieldChange('secondContactPersonName', e.target.value)}
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <Label htmlFor={inputId('secondContactPersonRole')}>Role/Title</Label>
                <Input
                  id={inputId('secondContactPersonRole')}
                  value={formData.secondContactPersonRole}
                  onChange={(e) => onFieldChange('secondContactPersonRole', e.target.value)}
                  placeholder="Assistant Manager, Volunteer Coordinator, etc."
                />
              </div>
              <div>
                <Label htmlFor={inputId('secondContactPersonPhone')}>Contact Phone</Label>
                <Input
                  id={inputId('secondContactPersonPhone')}
                  value={formData.secondContactPersonPhone}
                  onChange={(e) => onFieldChange('secondContactPersonPhone', e.target.value)}
                  placeholder="(555) 987-6543"
                />
              </div>
              <div>
                <Label htmlFor={inputId('secondContactPersonEmail')}>Contact Email</Label>
                <Input
                  id={inputId('secondContactPersonEmail')}
                  type="email"
                  value={formData.secondContactPersonEmail}
                  onChange={(e) => onFieldChange('secondContactPersonEmail', e.target.value)}
                  placeholder="jane@organization.org"
                />
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Enhanced Operational Fields */}
      <Collapsible
        open={sections[sectionKey('operational')]}
        onOpenChange={(open) => onSectionChange(sectionKey('operational'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Operational Details</h4>
              {sections[sectionKey('operational')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={inputId('reportingGroup')}>Reporting Group</Label>
                <Input
                  id={inputId('reportingGroup')}
                  value={formData.reportingGroup}
                  onChange={(e) => onFieldChange('reportingGroup', e.target.value)}
                  placeholder="Corresponds to host locations"
                />
              </div>
              <div>
                <Label htmlFor={inputId('estimatedSandwiches')}>Estimated Sandwiches</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={inputId('estimatedSandwiches')}
                    type="number"
                    min={0}
                    value={formData.estimatedSandwiches}
                    onChange={(e) => onFieldChange('estimatedSandwiches', e.target.value)}
                    placeholder="Min"
                    className="w-24"
                  />
                  <span className="text-slate-400 text-sm">to</span>
                  <Input
                    id={inputId('estimatedSandwichesMax')}
                    type="number"
                    min={0}
                    value={formData.estimatedSandwichesMax}
                    onChange={(e) => onFieldChange('estimatedSandwichesMax', e.target.value)}
                    placeholder="Max (optional)"
                    className="w-32"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Leave the max blank for a single number; fill both for a range (e.g., 200 to 250).
                </p>
              </div>
              <div className="sm:col-span-2 space-y-2 p-3 rounded border border-slate-200 bg-white">
                <div>
                  <Label className="text-sm">Planned breakdown by sandwich type</Label>
                  <p className="text-xs text-slate-500">
                    Capture per-type planned counts with optional ranges (e.g., 150 deli + 50-100 PB&J).
                  </p>
                </div>
                <PlannedBreakdownList
                  entries={formData.plannedSandwichBreakdown || []}
                  onChange={(rows) => onFieldChange('plannedSandwichBreakdown', rows)}
                  idPrefix={idPrefix}
                />
              </div>
              <div className="sm:col-span-2 space-y-2 p-3 rounded border border-slate-200 bg-slate-50/40">
                <div>
                  <Label className="text-sm">Delivery cadence</Label>
                  <p className="text-xs text-slate-500">
                    How often we serve this org — separate from the sandwich count.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {DELIVERY_CADENCE_OPTIONS.map((opt) => {
                    const active = formData.deliveryCadence === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          onFieldChange(
                            'deliveryCadence',
                            active ? '' : opt.value
                          )
                        }
                        title={opt.description}
                        className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                          active
                            ? opt.badgeClass + ' ring-2 ring-offset-1 ring-[#236383]/40'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  {formData.deliveryCadence && (
                    <button
                      type="button"
                      onClick={() => onFieldChange('deliveryCadence', '')}
                      className="px-2 py-1.5 rounded text-xs text-slate-500 hover:text-red-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div>
                  <Label
                    htmlFor={inputId('deliveryCadenceNote')}
                    className="text-xs text-slate-600"
                  >
                    Note (optional)
                  </Label>
                  <Input
                    id={inputId('deliveryCadenceNote')}
                    type="text"
                    value={formData.deliveryCadenceNote}
                    onChange={(e) => onFieldChange('deliveryCadenceNote', e.target.value)}
                    placeholder="e.g. Only during school year, every other Friday when staffed"
                    className="text-xs h-8"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor={inputId('sandwichType')}>Sandwich Type</Label>
                <Input
                  id={inputId('sandwichType')}
                  value={formData.sandwichType}
                  onChange={(e) => onFieldChange('sandwichType', e.target.value)}
                  placeholder="Type preferred (e.g., PB&J, Deli, Mixed)"
                />
              </div>
              <div>
                <Label htmlFor={inputId('focusAreas')}>Focus Areas</Label>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {FOCUS_AREAS.map((area) => (
                      <Badge
                        key={area}
                        variant={formData.focusAreas.includes(area) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleFocusArea(area)}
                      >
                        {area}
                      </Badge>
                    ))}
                    {formData.focusAreas
                      .filter((area) => !FOCUS_AREAS.includes(area))
                      .map((area) => (
                        <Badge
                          key={area}
                          variant="default"
                          className="cursor-pointer"
                          onClick={() => toggleFocusArea(area)}
                        >
                          {area} ×
                        </Badge>
                      ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add custom focus area..."
                      value={customFocusArea}
                      onChange={(e) => setCustomFocusArea(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomFocusArea();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        addCustomFocusArea();
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </div>
              <div>
                <Label htmlFor={inputId('tspContact')}>TSP Contact</Label>
                <Input
                  id={inputId('tspContact')}
                  value={formData.tspContact}
                  onChange={(e) => onFieldChange('tspContact', e.target.value)}
                  placeholder="TSP team member name"
                />
              </div>
              <div className="col-span-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id={inputId('contractSigned')}
                    checked={formData.contractSigned}
                    onChange={(e) => onFieldChange('contractSigned', e.target.checked)}
                    className="h-4 w-4 text-brand-primary focus:ring-brand-primary border-gray-300 rounded"
                  />
                  <Label htmlFor={inputId('contractSigned')} className="text-sm">
                    Contract Signed
                  </Label>
                </div>
              </div>
              {formData.contractSigned && (
                <div>
                  <Label htmlFor={inputId('contractSignedDate')}>Contract Signed Date</Label>
                  <Input
                    id={inputId('contractSignedDate')}
                    type="date"
                    value={formData.contractSignedDate}
                    onChange={(e) => onFieldChange('contractSignedDate', e.target.value)}
                  />
                </div>
              )}

              {/* Collection Schedule */}
              <div className="col-span-2 border-t pt-3 mt-3">
                <h5 className="font-medium text-sm text-slate-700 mb-3">
                  Collection Schedule
                </h5>
                <ScheduleEntryList
                  entries={formData.collectionSchedules.length > 0
                    ? formData.collectionSchedules
                    : (formData.collectionDay || formData.collectionTime)
                      ? [{ day: formData.collectionDay, time: formData.collectionTime }]
                      : []
                  }
                  onChange={(entries) => {
                    onFieldChange('collectionSchedules', entries);
                    // Sync legacy fields with first entry for backward compat
                    const first = entries[0];
                    onFieldChange('collectionDay', first?.day || '');
                    onFieldChange('collectionTime', first?.time || '');
                  }}
                  label="collection"
                  idPrefix={idPrefix}
                />
              </div>

              {/* Feeding Schedule */}
              <div className="col-span-2 border-t pt-3 mt-1">
                <h5 className="font-medium text-sm text-slate-700 mb-3">
                  Feeding Schedule
                </h5>
                <ScheduleEntryList
                  entries={formData.feedingSchedules.length > 0
                    ? formData.feedingSchedules
                    : (formData.feedingDay || formData.feedingTime)
                      ? [{ day: formData.feedingDay, time: formData.feedingTime }]
                      : []
                  }
                  onChange={(entries) => {
                    onFieldChange('feedingSchedules', entries);
                    // Sync legacy fields with first entry for backward compat
                    const first = entries[0];
                    onFieldChange('feedingDay', first?.day || '');
                    onFieldChange('feedingTime', first?.time || '');
                  }}
                  label="feeding"
                  idPrefix={idPrefix}
                />
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Social Media Tracking */}
      <Collapsible
        open={sections[sectionKey('socialMedia')]}
        onOpenChange={(open) => onSectionChange(sectionKey('socialMedia'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Social Media Tracking</h4>
              {sections[sectionKey('socialMedia')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={inputId('hasSharedPost')}
                  checked={formData.hasSharedPost}
                  onCheckedChange={(checked) => onFieldChange('hasSharedPost', !!checked)}
                  data-testid="checkbox-shared-post"
                />
                <Label
                  htmlFor={inputId('hasSharedPost')}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Has shared a post about us on social media
                </Label>
              </div>
              {formData.hasSharedPost && (
                <div>
                  <Label htmlFor={inputId('sharedPostDate')}>Date post was shared</Label>
                  <Input
                    id={inputId('sharedPostDate')}
                    type="date"
                    value={formData.sharedPostDate}
                    onChange={(e) => onFieldChange('sharedPostDate', e.target.value)}
                    data-testid="input-shared-post-date"
                  />
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Recipient Survey */}
      <Collapsible
        open={sections[sectionKey('recipientSurvey')]}
        onOpenChange={(open) => onSectionChange(sectionKey('recipientSurvey'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Recipient Survey</h4>
              {sections[sectionKey('recipientSurvey')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={inputId('surveySubmitted')}
                  checked={formData.surveySubmitted}
                  onCheckedChange={(checked) => onFieldChange('surveySubmitted', !!checked)}
                  data-testid="checkbox-survey-submitted"
                />
                <Label
                  htmlFor={inputId('surveySubmitted')}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Recipient survey submitted
                </Label>
              </div>
              {formData.surveySubmitted && (
                <div>
                  <Label htmlFor={inputId('surveySubmittedDate')}>Date submitted (optional)</Label>
                  <Input
                    id={inputId('surveySubmittedDate')}
                    type="date"
                    value={formData.surveySubmittedDate}
                    onChange={(e) => onFieldChange('surveySubmittedDate', e.target.value)}
                    data-testid="input-survey-submitted-date"
                  />
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* People Served Section */}
      <Collapsible
        open={sections[sectionKey('peopleServed')]}
        onOpenChange={(open) => onSectionChange(sectionKey('peopleServed'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">People Served</h4>
              {sections[sectionKey('peopleServed')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={inputId('averagePeopleServed')}>Average # of people served</Label>
                <Input
                  id={inputId('averagePeopleServed')}
                  type="number"
                  value={formData.averagePeopleServed}
                  onChange={(e) => onFieldChange('averagePeopleServed', e.target.value)}
                  placeholder="Enter number"
                  data-testid="input-average-people-served"
                />
              </div>
              <div>
                <Label htmlFor={inputId('peopleServedFrequency')}>How often</Label>
                <Select
                  value={formData.peopleServedFrequency}
                  onValueChange={(value) => onFieldChange('peopleServedFrequency', value)}
                >
                  <SelectTrigger data-testid="select-people-served-frequency">
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Partnership Section */}
      <Collapsible
        open={sections[sectionKey('partnership')]}
        onOpenChange={(open) => onSectionChange(sectionKey('partnership'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Partnership</h4>
              {sections[sectionKey('partnership')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={inputId('partnershipStartDate')}>Partnership start date</Label>
                <Input
                  id={inputId('partnershipStartDate')}
                  type="date"
                  value={formData.partnershipStartDate}
                  onChange={(e) => onFieldChange('partnershipStartDate', e.target.value)}
                  data-testid="input-partnership-start-date"
                />
              </div>
              <div>
                <Label htmlFor={inputId('partnershipYears')}>Years partnered</Label>
                <Input
                  id={inputId('partnershipYears')}
                  type="number"
                  value={formData.partnershipYears}
                  onChange={(e) => onFieldChange('partnershipYears', e.target.value)}
                  placeholder="Number of years"
                  data-testid="input-partnership-years"
                />
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Fruit/Snacks Program Section */}
      <Collapsible
        open={sections[sectionKey('fruitSnacks')]}
        onOpenChange={(open) => onSectionChange(sectionKey('fruitSnacks'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Fruit/Snacks Program</h4>
              {sections[sectionKey('fruitSnacks')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={inputId('receivingFruit')}
                    checked={formData.receivingFruit}
                    onCheckedChange={(checked) => onFieldChange('receivingFruit', !!checked)}
                    data-testid="checkbox-receiving-fruit"
                  />
                  <Label htmlFor={inputId('receivingFruit')} className="text-sm">
                    Currently receiving fruit
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={inputId('receivingSnacks')}
                    checked={formData.receivingSnacks}
                    onCheckedChange={(checked) => onFieldChange('receivingSnacks', !!checked)}
                    data-testid="checkbox-receiving-snacks"
                  />
                  <Label htmlFor={inputId('receivingSnacks')} className="text-sm">
                    Currently receiving snacks
                  </Label>
                </div>
              </div>
              {!formData.receivingFruit && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={inputId('wantsFruit')}
                    checked={formData.wantsFruit}
                    onCheckedChange={(checked) => onFieldChange('wantsFruit', !!checked)}
                    data-testid="checkbox-wants-fruit"
                  />
                  <Label htmlFor={inputId('wantsFruit')} className="text-sm">
                    Interested in receiving fruit
                  </Label>
                </div>
              )}
              {!formData.receivingSnacks && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={inputId('wantsSnacks')}
                    checked={formData.wantsSnacks}
                    onCheckedChange={(checked) => onFieldChange('wantsSnacks', !!checked)}
                    data-testid="checkbox-wants-snacks"
                  />
                  <Label htmlFor={inputId('wantsSnacks')} className="text-sm">
                    Interested in receiving snacks
                  </Label>
                </div>
              )}
              <div>
                <Label htmlFor={inputId('fruitSnacksNotes')}>Fruit/snacks notes</Label>
                <Textarea
                  id={inputId('fruitSnacksNotes')}
                  value={formData.fruitSnacksNotes}
                  onChange={(e) => onFieldChange('fruitSnacksNotes', e.target.value)}
                  placeholder="Additional notes about fruit/snacks preferences..."
                  rows={2}
                  data-testid="textarea-fruit-snacks-notes"
                />
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Seasonal Changes Section */}
      <Collapsible
        open={sections[sectionKey('seasonalChanges')]}
        onOpenChange={(open) => onSectionChange(sectionKey('seasonalChanges'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Seasonal Changes</h4>
              {sections[sectionKey('seasonalChanges')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={inputId('hasSeasonalChanges')}
                  checked={formData.hasSeasonalChanges}
                  onCheckedChange={(checked) => onFieldChange('hasSeasonalChanges', !!checked)}
                  data-testid="checkbox-has-seasonal-changes"
                />
                <Label htmlFor={inputId('hasSeasonalChanges')} className="text-sm">
                  Has seasonal changes
                </Label>
              </div>
              {formData.hasSeasonalChanges && (
                <>
                  <div>
                    <Label htmlFor={inputId('seasonalChangesDescription')}>Describe seasonal changes</Label>
                    <Textarea
                      id={inputId('seasonalChangesDescription')}
                      value={formData.seasonalChangesDescription}
                      onChange={(e) => onFieldChange('seasonalChangesDescription', e.target.value)}
                      placeholder="Describe how needs change seasonally..."
                      rows={2}
                      data-testid="textarea-seasonal-changes-description"
                    />
                  </div>
                  <div>
                    <Label htmlFor={inputId('summerNeeds')}>Summer needs</Label>
                    <Textarea
                      id={inputId('summerNeeds')}
                      value={formData.summerNeeds}
                      onChange={(e) => onFieldChange('summerNeeds', e.target.value)}
                      placeholder="Specific needs during summer months..."
                      rows={2}
                      data-testid="textarea-summer-needs"
                    />
                  </div>
                  <div>
                    <Label htmlFor={inputId('winterNeeds')}>Winter needs</Label>
                    <Textarea
                      id={inputId('winterNeeds')}
                      value={formData.winterNeeds}
                      onChange={(e) => onFieldChange('winterNeeds', e.target.value)}
                      placeholder="Specific needs during winter months..."
                      rows={2}
                      data-testid="textarea-winter-needs"
                    />
                  </div>
                </>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Communication Preferences Section */}
      <Collapsible
        open={sections[sectionKey('communicationPreferences')]}
        onOpenChange={(open) => onSectionChange(sectionKey('communicationPreferences'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Communication Preferences</h4>
              {sections[sectionKey('communicationPreferences')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium mb-2 block">Preferred contact methods</Label>
                <div className="flex flex-wrap gap-4">
                  {CONTACT_METHODS.map(({ id, label }) => (
                    <div key={id} className="flex items-center space-x-2">
                      <Checkbox
                        id={inputId(`prefer-${id}`)}
                        checked={formData.preferredContactMethods.includes(id)}
                        onCheckedChange={(checked) =>
                          toggleContactMethod('preferredContactMethods', id, !!checked)
                        }
                        data-testid={`checkbox-prefer-${id}`}
                      />
                      <Label htmlFor={inputId(`prefer-${id}`)} className="text-sm">{label}</Label>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">Allowed contact methods</Label>
                <div className="flex flex-wrap gap-4">
                  {CONTACT_METHODS.map(({ id, label }) => (
                    <div key={id} className="flex items-center space-x-2">
                      <Checkbox
                        id={inputId(`allow-${id}`)}
                        checked={formData.allowedContactMethods.includes(id)}
                        onCheckedChange={(checked) =>
                          toggleContactMethod('allowedContactMethods', id, !!checked)
                        }
                        data-testid={`checkbox-allow-${id}`}
                      />
                      <Label htmlFor={inputId(`allow-${id}`)} className="text-sm">{label}</Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={inputId('doNotContact')}
                  checked={formData.doNotContact}
                  onCheckedChange={(checked) => onFieldChange('doNotContact', !!checked)}
                  data-testid="checkbox-do-not-contact"
                />
                <Label htmlFor={inputId('doNotContact')} className="text-sm text-red-600">
                  Do not contact
                </Label>
              </div>
              <div>
                <Label htmlFor={inputId('contactMethodNotes')}>Contact notes</Label>
                <Textarea
                  id={inputId('contactMethodNotes')}
                  value={formData.contactMethodNotes}
                  onChange={(e) => onFieldChange('contactMethodNotes', e.target.value)}
                  placeholder="E.g., Only call before 2pm, Best reached on Tuesdays..."
                  rows={2}
                  data-testid="textarea-contact-method-notes"
                />
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Impact Stories Section */}
      <Collapsible
        open={sections[sectionKey('impactStories')]}
        onOpenChange={(open) => onSectionChange(sectionKey('impactStories'), open)}
      >
        <div className="border-t pt-4 mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto">
              <h4 className="font-medium text-sm text-slate-700">Impact Stories</h4>
              {sections[sectionKey('impactStories')] ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="space-y-4">
              {formData.impactStories.map((story, index) => (
                <div key={index} className="border rounded-lg p-3 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-slate-600">Story {index + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeImpactStory(index)}
                      className="text-red-500 hover:text-red-700 h-6 w-6 p-0"
                      data-testid={`button-remove-story-${index}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div>
                    <Label htmlFor={inputId(`story-${index}`)}>Story</Label>
                    <Textarea
                      id={inputId(`story-${index}`)}
                      value={story.story}
                      onChange={(e) => updateImpactStory(index, { story: e.target.value })}
                      placeholder="Share an impact story..."
                      rows={3}
                      data-testid={`textarea-story-${index}`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={inputId(`story-date-${index}`)}>Date collected</Label>
                      <Input
                        id={inputId(`story-date-${index}`)}
                        type="date"
                        value={story.date}
                        onChange={(e) => updateImpactStory(index, { date: e.target.value })}
                        data-testid={`input-story-date-${index}`}
                      />
                    </div>
                    <div>
                      <Label htmlFor={inputId(`story-source-${index}`)}>Source</Label>
                      <Input
                        id={inputId(`story-source-${index}`)}
                        value={story.source}
                        onChange={(e) => updateImpactStory(index, { source: e.target.value })}
                        placeholder="Who provided this story"
                        data-testid={`input-story-source-${index}`}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addImpactStory}
                className="w-full"
                data-testid="button-add-impact-story"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Impact Story
              </Button>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
