/**
 * Delivery Section
 *
 * Handles event address, overnight holding, and delivery destination selection.
 */
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MultiRecipientSelector } from '@/components/ui/multi-recipient-selector';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { MapPin, RotateCw } from 'lucide-react';
import type { EventFormData } from './types';
import { NEXT_DAY_PICKUP_LABELS, NEXT_DAY_PICKUP_VALUES, effectiveNextDayPickup } from '@shared/next-day-pickup';

interface DeliverySectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  eventRequestId?: number;
  /** Delivery destinations only matter once an event is scheduled/completed. */
  showDestination?: boolean;
}

export const DeliverySection: React.FC<DeliverySectionProps> = ({
  formData,
  setFormData,
  eventRequestId,
  showDestination = true,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const geocodeMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest('POST', `/api/event-map/geocode/${id}`),
    onSuccess: (data: any) => {
      toast({
        title: 'Address geocoded',
        description: `Coordinates updated (${parseFloat(data.latitude).toFixed(4)}, ${parseFloat(data.longitude).toFixed(4)})`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/event-requests'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Geocoding failed',
        description: error?.message || 'Could not geocode this address',
        variant: 'destructive',
      });
    },
  });

  return (
    <>
      {/* Address */}
      <div>
        <Label htmlFor="eventAddress">Event Address</Label>
        <div className="flex gap-2">
          <Input
            id="eventAddress"
            value={formData.eventAddress}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, eventAddress: e.target.value }))}
            placeholder="Enter the event location address"
            className="flex-1"
          />
          {eventRequestId && formData.eventAddress && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-shrink-0 gap-1.5 text-xs"
              onClick={() => geocodeMutation.mutate(eventRequestId)}
              disabled={geocodeMutation.isPending}
              title="Re-geocode this address to update map pin location"
            >
              {geocodeMutation.isPending ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MapPin className="w-3.5 h-3.5" />
              )}
              Geocode
            </Button>
          )}
        </div>
      </div>

      {/* Delivery Destinations */}
      <div className="space-y-4">
        <div className="p-3 bg-brand-primary-lighter border border-brand-primary-border rounded-lg">
          <p className="text-sm text-brand-primary mb-2 font-medium">
            Delivery Options: You can specify either a direct delivery destination, or an overnight holding location with a final destination.
          </p>
        </div>

        {/* Next-day pickup: No / It's an option / Yes, planned */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2" data-testid="next-day-pickup">
          <Label className="text-sm font-medium text-blue-900">Next-day pickup</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Next-day pickup">
            {NEXT_DAY_PICKUP_VALUES.map((value) => {
              const selected = effectiveNextDayPickup(formData as any) === value;
              return (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={selected}
                  variant={selected ? 'default' : 'outline'}
                  className={selected ? 'bg-[#236383] hover:bg-[#1d5270]' : 'bg-white'}
                  onClick={() =>
                    setFormData((prev: any) => ({
                      ...prev,
                      nextDayPickup: value,
                      holdingOvernight: value === 'planned',
                      // Only a planned next-day pickup keeps the overnight details.
                      ...(value === 'planned'
                        ? {}
                        : { overnightHoldingLocation: '', overnightPickupTime: '', deliveryTimeWindow: '', deliveryParkingAccess: '' }),
                    }))
                  }
                  data-testid={`next-day-pickup-${value}`}
                >
                  {NEXT_DAY_PICKUP_LABELS[value]}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-blue-900/80">
            {effectiveNextDayPickup(formData as any) === 'option'
              ? 'The group can hold the sandwiches overnight if needed (handy when the van is busy that day).'
              : effectiveNextDayPickup(formData as any) === 'planned'
                ? 'The group holds the sandwiches overnight; they are picked up the next day.'
                : 'Sandwiches are picked up the same day.'}
          </p>
        </div>

        {/* Overnight Holding Location */}
        {effectiveNextDayPickup(formData as any) === 'planned' && (
          <div className="space-y-2">
            <Label htmlFor="overnightHoldingLocation">Overnight Holding Location</Label>
            <Input
              id="overnightHoldingLocation"
              value={formData.overnightHoldingLocation}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, overnightHoldingLocation: e.target.value }))}
              placeholder="Location where sandwiches will be stored overnight (e.g., church, community center)"
              data-testid="input-overnight-location"
            />
            {formData.overnightHoldingLocation && (
              <div className="ml-4 mt-2 space-y-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-medium text-green-900">Next-Day Delivery Details</h4>
                <div>
                  <Label htmlFor="overnightPickupTime">Pickup Time from Overnight Location</Label>
                  <Input
                    id="overnightPickupTime"
                    type="time"
                    value={formData.overnightPickupTime}
                    onChange={(e) => setFormData((prev: any) => ({ ...prev, overnightPickupTime: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="deliveryTimeWindow">Delivery Time Window</Label>
                  <Input
                    id="deliveryTimeWindow"
                    type="text"
                    value={formData.deliveryTimeWindow || ''}
                    onChange={(e) => setFormData((prev: any) => ({ ...prev, deliveryTimeWindow: e.target.value }))}
                    placeholder="e.g., 11:00 AM - 12:00 PM"
                  />
                </div>
                <div>
                  <Label htmlFor="deliveryParkingAccess">Parking/Access Details</Label>
                  <Textarea
                    id="deliveryParkingAccess"
                    value={formData.deliveryParkingAccess || ''}
                    onChange={(e) => setFormData((prev: any) => ({ ...prev, deliveryParkingAccess: e.target.value }))}
                    placeholder="e.g., Park in rear lot, use loading dock entrance"
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Final Delivery Destination - Multiple Recipients */}
        {showDestination && (
        <div>
          <Label htmlFor="deliveryDestination">
            {formData.overnightHoldingLocation ? 'Final Delivery Destinations' : 'Delivery Destinations'}
          </Label>
          <p className="text-sm text-gray-500 mb-2">
            Select one or more recipient organizations where the sandwiches will be delivered
          </p>
          <MultiRecipientSelector
            value={formData.assignedRecipientIds}
            onChange={(ids) => setFormData((prev: any) => ({ ...prev, assignedRecipientIds: ids }))}
            placeholder={formData.overnightHoldingLocation
              ? "Select recipient organizations for final delivery..."
              : "Select recipient organizations..."}
            data-testid="delivery-destination-multi-selector"
          />
        </div>
        )}
      </div>
    </>
  );
};
