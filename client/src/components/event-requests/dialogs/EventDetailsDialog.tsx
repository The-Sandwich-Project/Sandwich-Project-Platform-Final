/**
 * Event Details Preview Dialog
 * Shows a read-only preview of event details when clicked from calendar
 * Includes an Edit button to open the full edit form
 */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  Clock,
  MapPin,
  Phone,
  Mail,
  Users,
  Car,
  UserCheck,
  Sandwich,
  Edit2,
  Building2,
  Package,
  Truck,
} from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { formatEventDate } from '../utils';
import { parseSandwichTypes, formatSandwichTypesDisplay, formatEventEstimate } from '@/lib/sandwich-utils';
import { RefrigerationWarningBadge } from '../RefrigerationWarningBadge';
import EventEmailLogDisplay from '@/components/event-email-log-display';

interface EventDetailsDialogProps {
  event: EventRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
  resolveUserName?: (id: string | undefined) => string;
  resolveRecipientName?: (id: number | undefined) => string;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'new':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'in_process':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'scheduled':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'completed':
      return 'bg-navy-100 text-navy-800 border-navy-300';
    case 'cancelled':
    case 'declined':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    new: 'New',
    in_process: 'In Process',
    scheduled: 'Scheduled',
    completed: 'Completed',
    cancelled: 'Cancelled',
    declined: 'Declined',
  };
  return labels[status] || status;
};

export function EventDetailsDialog({
  event,
  isOpen,
  onClose,
  onEdit,
  resolveUserName,
  resolveRecipientName,
}: EventDetailsDialogProps) {
  if (!event) return null;

  const sandwichTypes = parseSandwichTypes(event.sandwichTypes);
  const sandwichDisplay = formatEventEstimate(event);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <DialogTitle className="text-xl sm:text-2xl font-bold text-[#236383] flex-1 min-w-0 break-words">
              {event.organizationName}
            </DialogTitle>
            <Button
              onClick={onEdit}
              variant="outline"
              size="sm"
              className="flex items-center gap-2 w-full sm:w-auto"
            >
              <Edit2 className="h-4 w-4" />
              Edit
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={getStatusColor(event.status)}>
              {getStatusLabel(event.status)}
            </Badge>
            {event.isConfirmed && (
              <Badge className="bg-gradient-to-br from-[#007E8C] to-[#47B3CB] text-white">
                Date Confirmed
              </Badge>
            )}
            {event.addedToOfficialSheet && (
              <Badge className="bg-gradient-to-br from-[#236383] to-[#007E8C] text-white">
                On Calendar
              </Badge>
            )}
            <RefrigerationWarningBadge
              sandwichTypes={event.sandwichTypes}
              hasRefrigeration={event.hasRefrigeration}
            />
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Date & Time Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Event Date
              </h3>
              <p className="text-base pl-6">
                {event.scheduledEventDate
                  ? formatEventDate(event.scheduledEventDate).text
                  : event.desiredEventDate
                  ? formatEventDate(event.desiredEventDate).text + ' (Requested)'
                  : 'Not set'}
              </p>
            </div>

            {event.eventStartTime && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Event Time
                </h3>
                <p className="text-base pl-6">
                  {event.eventStartTime}
                  {event.eventEndTime && ` - ${event.eventEndTime}`}
                </p>
              </div>
            )}
          </div>

          {/* Location Section */}
          {event.eventAddress && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Location
              </h3>
              <p className="text-base pl-6">{event.eventAddress}</p>
            </div>
          )}

          {/* Contact Section */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-gray-700">Contact Information</h3>
            <div className="pl-6 space-y-1">
              {event.contactName && <p className="text-base">{event.contactName}</p>}
              {event.email && (
                <p className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-500" />
                  {event.email}
                </p>
              )}
              {event.phone && (
                <p className="text-base flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-500" />
                  {event.phone}
                </p>
              )}
            </div>
          </div>

          {/* Attendance Section */}
          {(event.estimatedAttendance || event.attendanceAdults || event.attendanceTeens || event.attendanceKids) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Attendance
              </h3>
              <div className="pl-6">
                {event.attendanceAdults || event.attendanceTeens || event.attendanceKids ? (
                  <p className="text-base">
                    {[
                      event.attendanceAdults && `${event.attendanceAdults} adults`,
                      event.attendanceTeens && `${event.attendanceTeens} teens`,
                      event.attendanceKids && `${event.attendanceKids} kids`,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                ) : (
                  <p className="text-base">{event.estimatedAttendance} estimated</p>
                )}
              </div>
            </div>
          )}

          {/* Sandwich Section */}
          {(event.estimatedSandwichCount || (sandwichTypes && sandwichTypes.length > 0)) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
                <Sandwich className="h-4 w-4" />
                Sandwiches
              </h3>
              <div className="pl-6">
                {sandwichTypes && sandwichTypes.length > 0 ? (
                  <p className="text-base">{sandwichDisplay}</p>
                ) : (
                  <p className="text-base">{event.estimatedSandwichCount} sandwiches</p>
                )}
              </div>
            </div>
          )}

          {/* Staffing Section */}
          {(event.driversNeeded || event.volunteersNeeded || event.selfTransport) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700">Staffing Needs</h3>
              <div className="pl-6 space-y-1">
                {event.selfTransport ? (
                  <p className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4 text-amber-600" />
                    Self-transport (group will pick up)
                  </p>
                ) : (
                  <>
                    {event.driversNeeded && event.driversNeeded > 0 && (
                      <p className="text-base flex items-center gap-2">
                        <Car className="h-4 w-4 text-blue-600" />
                        {event.driversNeeded} driver{event.driversNeeded > 1 ? 's' : ''} needed
                      </p>
                    )}
                    {event.assignedVanDriverId && (
                      <p className="text-base flex items-center gap-2">
                        🚐 Van driver assigned
                        {resolveUserName && `: ${resolveUserName(event.assignedVanDriverId)}`}
                      </p>
                    )}
                    {event.isDhlVan && (
                      <p className="text-base flex items-center gap-2">
                        <Truck className="h-4 w-4 text-amber-700" />
                        DHL van assigned
                      </p>
                    )}
                  </>
                )}
                {event.volunteersNeeded && event.volunteersNeeded > 0 && (
                  <p className="text-base flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-green-600" />
                    {event.volunteersNeeded} volunteer{event.volunteersNeeded > 1 ? 's' : ''} needed
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Partner Organizations */}
          {event.partnerOrganizations && Array.isArray(event.partnerOrganizations) && event.partnerOrganizations.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Partner Organizations
              </h3>
              <div className="pl-6">
                {event.partnerOrganizations.map((partner: any, idx: number) => (
                  <p key={idx} className="text-base">
                    {partner.name}
                    {partner.department && ` - ${partner.department}`}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {event.notes && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700">Notes</h3>
              <p className="text-base pl-6 whitespace-pre-wrap">{event.notes}</p>
            </div>
          )}

          {/* Delivery Information */}
          {(event.pickupTime || event.deliveryDestination || event.overnightHoldingLocation) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700">Delivery Information</h3>
              <div className="pl-6 space-y-1">
                {event.pickupTime && (
                  <p className="text-base">
                    <span className="font-medium">Pickup time:</span> {event.pickupTime}
                  </p>
                )}
                {event.deliveryDestination && (
                  <p className="text-base">
                    <span className="font-medium">Delivery to:</span> {event.deliveryDestination}
                  </p>
                )}
                {event.overnightHoldingLocation && (
                  <p className="text-base">
                    <span className="font-medium">Overnight holding:</span> {event.overnightHoldingLocation}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Assigned Recipients */}
          {event.assignedRecipientIds && Array.isArray(event.assignedRecipientIds) && event.assignedRecipientIds.length > 0 && resolveRecipientName && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700">Assigned Recipients</h3>
              <div className="pl-6 flex flex-wrap gap-2">
                {event.assignedRecipientIds.map((id: number) => (
                  <Badge key={id} variant="secondary">
                    {resolveRecipientName(id)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Email History */}
          {event.id && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700">Email History</h3>
              <div className="pl-6">
                <EventEmailLogDisplay eventId={event.id} />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
