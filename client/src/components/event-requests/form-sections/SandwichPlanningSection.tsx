/**
 * SandwichPlanningSection - Sandwich Count and Type Planning
 *
 * Section for specifying sandwich counts with three modes:
 * - Total: Exact count only
 * - Range: Min/max range with optional type
 * - Types: Specific breakdown by sandwich type
 *
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
import { Sandwich, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { SANDWICH_TYPES } from '../constants';
import type { FormSectionProps } from './types';
import { sumSandwichTypeQuantities } from '../form-utils';

interface SandwichPlanningSectionProps extends FormSectionProps {
  /** Current sandwich planning mode */
  sandwichMode: 'total' | 'range' | 'types';
  /** Setter for sandwich mode */
  setSandwichMode: React.Dispatch<React.SetStateAction<'total' | 'range' | 'types'>>;
  /** Whether section is complete (shows checkmark) */
  isComplete?: boolean;
}

export const SandwichPlanningSection: React.FC<SandwichPlanningSectionProps> = ({
  formData,
  setFormData,
  sandwichMode,
  setSandwichMode,
  isComplete,
}) => {
  // Handler functions for sandwich types
  const addSandwichType = () => {
    setFormData(prev => ({
      ...prev,
      sandwichTypes: [...(prev.sandwichTypes || []), { type: 'turkey', quantity: 0 }]
    }));
  };

  const updateSandwichType = (index: number, field: 'type' | 'quantity', value: string | number) => {
    setFormData(prev => ({
      ...prev,
      sandwichTypes: (prev.sandwichTypes || []).map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    }));
  };

  const removeSandwichType = (index: number) => {
    setFormData(prev => ({
      ...prev,
      sandwichTypes: (prev.sandwichTypes || []).filter((_, i) => i !== index)
    }));
  };

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-white">
      <div className="flex items-center gap-3 pb-2 border-b">
        <Sandwich className="w-5 h-5 text-tsp-teal" />
        <span className="text-lg font-semibold text-tsp-teal">Sandwich Planning</span>
        {isComplete && <CheckCircle2 className="w-4 h-4 text-tsp-teal" />}
      </div>

      {/* Mode Selector */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={sandwichMode === 'total' ? 'default' : 'outline'}
          onClick={() => {
            setSandwichMode('total');
            setFormData((prev) => ({
              ...prev,
              totalSandwichCount:
                prev.totalSandwichCount ||
                sumSandwichTypeQuantities(prev.sandwichTypes) ||
                0,
              sandwichTypes: [],
              // Clear the range fields too — otherwise a leftover range from a
              // previous "Range" entry stays in form state and its midpoint is
              // preferred over the exact count on display (the "500 shows as
              // 498" bug).
              estimatedSandwichCountMin: 0,
              estimatedSandwichCountMax: 0,
              rangeSandwichType: '',
            }));
          }}
          className="text-xs"
        >
          Exact Count
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sandwichMode === 'range' ? 'default' : 'outline'}
          onClick={() => {
            setSandwichMode('range');
            setFormData((prev) => ({
              ...prev,
              sandwichTypes: [],
            }));
          }}
          className="text-xs"
        >
          Range
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sandwichMode === 'types' ? 'default' : 'outline'}
          onClick={() => setSandwichMode('types')}
          className="text-xs"
        >
          Specify Types
        </Button>
      </div>

      {/* Total Count Mode */}
      {sandwichMode === 'total' && (
        <div className="space-y-2">
          <Label htmlFor="totalSandwichCount">Total Number of Sandwiches</Label>
          <Input
            id="totalSandwichCount"
            type="number"
            value={formData.totalSandwichCount}
            onChange={(e) => setFormData(prev => ({ ...prev, totalSandwichCount: parseInt(e.target.value) || 0 }))}
            placeholder="Enter exact count (e.g., 550)"
            min="0"
            className="w-40"
          />
          <p className="text-sm text-tsp-teal">
            Use this when you know the exact count.
          </p>
        </div>
      )}

      {/* Range Mode */}
      {sandwichMode === 'range' && (
        <div className="space-y-3">
          <div>
            <Label>Estimated Sandwich Range</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input
                id="sandwichCountMin"
                type="number"
                value={formData.estimatedSandwichCountMin || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, estimatedSandwichCountMin: parseInt(e.target.value) || 0 }))}
                placeholder="Min (e.g., 500)"
                min="0"
                className="w-32"
              />
              <span className="text-gray-500">to</span>
              <Input
                id="sandwichCountMax"
                type="number"
                value={formData.estimatedSandwichCountMax || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, estimatedSandwichCountMax: parseInt(e.target.value) || 0 }))}
                placeholder="Max (e.g., 700)"
                min="0"
                className="w-32"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="rangeSandwichType">Type (Optional)</Label>
            <Select
              value={formData.rangeSandwichType || undefined}
              onValueChange={(value) => setFormData(prev => ({ ...prev, rangeSandwichType: value === 'none' ? '' : value }))}
            >
              <SelectTrigger id="rangeSandwichType" className="w-48">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                <SelectItem value="none">No specific type</SelectItem>
                {SANDWICH_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-tsp-teal">
            Use this when the final count isn't confirmed yet (e.g., 500-700 turkey sandwiches).
          </p>
        </div>
      )}

      {/* Specific Types Mode */}
      {sandwichMode === 'types' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <Label>Sandwich Types & Quantities</Label>
            <Button type="button" onClick={addSandwichType} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Type
            </Button>
          </div>

          {(!formData.sandwichTypes || formData.sandwichTypes.length === 0) ? (
            <div className="text-center py-4 text-tsp-teal border-2 border-dashed border-tsp-teal/30 rounded">
              <p>No sandwich types added yet. Click "Add Type" to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {formData.sandwichTypes.map((sandwich, index) => (
                <div key={index} className="flex items-center gap-3 p-3 border rounded">
                  <Select
                    value={sandwich.type}
                    onValueChange={(value) => updateSandwichType(index, 'type', value)}
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
                    onChange={(e) => updateSandwichType(index, 'quantity', parseInt(e.target.value) || 0)}
                    className="w-24"
                    min="0"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeSandwichType(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <div className="text-sm text-tsp-teal bg-[#e6f2f5] p-2 rounded">
                <strong>Total:</strong> {formData.sandwichTypes.reduce((sum, item) => sum + item.quantity, 0)} sandwiches
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
