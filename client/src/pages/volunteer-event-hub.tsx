/**
 * Volunteer Event Hub
 *
 * A user-friendly interface for volunteers to browse and sign up
 * for events based on their calendar availability and location convenience.
 *
 * Features:
 * - Calendar view for date-based browsing
 * - Map view for location-based browsing
 * - Filter by role needed (volunteer, driver)
 * - Request to join events
 * - View own signups and status
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapContainer, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, isAfter, startOfDay } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { BaseMapTiles } from '@/components/maps/BaseMapTiles';
import {
  isEligibleForRole,
  getEligibleEventRoles,
  type UserRoleCapabilities,
} from '@shared/event-role-eligibility';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatTimeForDisplay, parseEventDate } from '@/lib/date-utils';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';

// UI Components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

// Icons
import {
  Calendar,
  MapPin,
  Clock,
  Users,
  Mic,
  Car,
  Truck,
  ChevronLeft,
  ChevronRight,
  Building2,
  Sandwich,
  Check,
  X,
  AlertCircle,
  Loader2,
  Eye,
  HandHeart,
  Filter,
  List,
  Map as MapIcon,
  CalendarDays,
  UserCheck,
  Search,
  Navigation,
  CheckCircle2,
  LocateFixed,
  Ban,
  PartyPopper,
  CalendarPlus,
  Download,
  ArrowRight,
  HelpCircle,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import {
  buildEventTimes,
  googleCalendarUrl,
  buildIcs,
  downloadIcs,
} from '@/lib/calendar-links';

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Render an event's time range, or "Time TBD" when start time is missing.
function formatEventTime(start: string | null | undefined, end?: string | null | undefined): string {
  if (!start) return 'Time TBD';
  const formatted = formatTimeForDisplay(start);
  return end ? `${formatted} – ${formatTimeForDisplay(end)}` : formatted;
}

function getAddressText(location: {
  eventAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): string {
  return [
    location.eventAddress,
    location.city,
    location.state,
    location.zipCode,
  ].filter(Boolean).join(', ');
}

function getGoogleMapsUrl(location: {
  eventAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(getAddressText(location))}`;
}

function AddressLink({
  location,
  className,
  iconClassName = 'w-4 h-4 shrink-0 mt-0.5 text-[#236383]',
}: {
  location: {
    eventAddress?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  };
  className?: string;
  iconClassName?: string;
}) {
  const addressText = getAddressText(location);
  if (!addressText) return null;

  return (
    <a
      href={getGoogleMapsUrl(location)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex items-start gap-2 text-sm text-muted-foreground hover:text-[#236383] hover:underline underline-offset-2',
        className,
      )}
      aria-label={`Open ${addressText} in Google Maps`}
    >
      <MapPin className={iconClassName} />
      <span className="min-w-0 break-words">{addressText}</span>
    </a>
  );
}

// Types
type HubView = 'list' | 'calendar' | 'map' | 'my_signups' | 'pending_approvals' | 'coverage';

function resolveVolunteerHubView(
  raw: string | null | undefined,
  canApprove: boolean,
): HubView | null {
  if (raw === 'list' || raw === 'calendar' || raw === 'map' || raw === 'my_signups') return raw;
  if ((raw === 'pending_approvals' || raw === 'coverage') && canApprove) return raw;
  return null;
}

interface AvailableEvent {
  id: number;
  organizationName: string;
  organizationCategory: string | null;
  department: string | null;
  eventAddress: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  latitude: string | null;
  longitude: string | null;
  scheduledEventDate: string | null;
  desiredEventDate: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  estimatedSandwichCount: number | null;
  status: string | null;
  speakersNeeded: number;
  speakersAssigned: number;
  speakersUnfilled: number;
  volunteersNeeded: number;
  volunteersAssigned: number;
  volunteersUnfilled: number;
  driversNeeded: number;
  driversAssigned: number;
  driversUnfilled: number;
  hasUnfilledNeeds: boolean;
  vanDriverNeeded: boolean;
  selfTransport: boolean | null;
  pickupTime: string | null;
  eventNotes: string | null;
  driverInstructions: string | null;
  volunteerInstructions: string | null;
  speakerInstructions: string | null;
}

function getEventDateLabel(
  event: Pick<AvailableEvent, 'scheduledEventDate' | 'desiredEventDate'>,
  pattern = 'MMM d',
): string {
  const eventDate = getEffectiveEventDate(event);
  if (!eventDate) return 'Date TBD';

  const parsedDate = parseEventDate(eventDate);
  return parsedDate ? format(parsedDate, pattern) : 'Date TBD';
}

/** Calendar bucket key — local YYYY-MM-DD, aligned with date-fns format(day). */
function getCalendarDateKey(
  event: Pick<AvailableEvent, 'scheduledEventDate' | 'desiredEventDate'>,
): string | null {
  const effective = getEffectiveEventDate(event);
  if (!effective) return null;
  const parsed = parseEventDate(effective);
  return parsed ? format(parsed, 'yyyy-MM-dd') : null;
}

function dedupeEventsById(events: AvailableEvent[]): AvailableEvent[] {
  const byId = new Map<number, AvailableEvent>();
  for (const event of events) {
    if (!byId.has(event.id)) {
      byId.set(event.id, event);
    }
  }
  return Array.from(byId.values());
}

/** Today or later — matches the calendar's actionable/upcoming definition. */
function isUpcomingHubEvent(
  event: Pick<AvailableEvent, 'scheduledEventDate' | 'desiredEventDate'>,
): boolean {
  const dateStr = getEffectiveEventDate(event);
  if (!dateStr) return true;
  const eventDate = parseEventDate(dateStr);
  if (!eventDate) return true;
  const today = startOfDay(new Date());
  return isAfter(eventDate, today) || isSameDay(eventDate, today);
}

interface MySignup {
  id: number;
  eventRequestId: number;
  role: string;
  status: string;
  notes: string | null;
  signedUpAt: string;
  event: {
    id: number;
    organizationName: string;
    scheduledEventDate: string | null;
    desiredEventDate: string | null;
    eventStartTime: string | null;
    eventEndTime: string | null;
    eventAddress: string;
    city: string | null;
    state: string | null;
    status: string;
    driverInstructions?: string | null;
    volunteerInstructions?: string | null;
    speakerInstructions?: string | null;
  };
}

interface MyUnavailable {
  id: number;
  eventRequestId: number;
  volunteerUserId: string;
  volunteerName: string | null;
  volunteerEmail: string | null;
  volunteerPhone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  event: {
    id: number;
    organizationName: string;
    scheduledEventDate: string | null;
    desiredEventDate: string | null;
    eventStartTime: string | null;
    eventEndTime: string | null;
    eventAddress: string;
    city: string | null;
    state: string | null;
    status: string;
  };
}

interface CoverageSummaryEvent {
  id: number;
  organizationName: string;
  department: string | null;
  scheduledEventDate: string | null;
  desiredEventDate: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  eventAddress: string;
  city: string | null;
  state: string | null;
  status: string | null;
  vanDriverNeeded: boolean;
  roles: Array<{
    role: string;
    label: string;
    needed: number;
    assigned: number;
    unfilled: number;
  }>;
  signups: Array<{
    id: number;
    volunteerUserId: string | null;
    volunteerName: string | null;
    volunteerEmail: string | null;
    volunteerPhone: string | null;
    role: string;
    status: string;
    notes: string | null;
    signedUpAt: string;
  }>;
  unavailable: Array<{
    id: number;
    volunteerUserId: string;
    volunteerName: string | null;
    volunteerEmail: string | null;
    volunteerPhone: string | null;
    notes: string | null;
    updatedAt: string;
  }>;
}

// Custom marker icons using brand colors
const createEventIcon = (needsVolunteer: boolean, needsDriver: boolean, isCompleted = false, needsVanDriver = false) => {
  // Two-state: needs help (teal) vs filled/completed (gray). Specific role detail lives in the popup.
  const needsHelp = !isCompleted && (needsVolunteer || needsDriver || needsVanDriver);
  const color = needsHelp ? '#236383' : '#9ca3af';

  const html = `
    <div style="position: relative; width: 30px; height: 42px;">
      <svg viewBox="0 0 25 41" width="30" height="42" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
        <circle cx="12.5" cy="12.5" r="5" fill="white"/>
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-event-marker',
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -35],
  });
};

// Map center setter component
function MapCenterSetter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 11);
  }, [center, map]);
  return null;
}

// Haversine formula for distance between two coordinates in miles
const calculateDistanceMiles = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Create a distinct icon for the user's location
const createUserLocationIcon = () => {
  const html = `
    <div style="position: relative; width: 24px; height: 24px;">
      <div style="width: 24px; height: 24px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
      <div style="position: absolute; top: -2px; left: -2px; width: 28px; height: 28px; border: 2px solid #3b82f6; border-radius: 50%; opacity: 0.3; animation: pulse 2s infinite;"></div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'user-location-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
};

// Brand colors: #236383 (dark teal), #47b3cb (light teal), #236383 (primary teal), #a31c41 (burgundy), #fbad3f (gold)

// Role badge component
function RoleBadge({ role }: { role: string }) {
  const config = {
    speaker: { label: 'Speaker', icon: Mic, className: 'bg-[#a31c41]/10 text-[#a31c41] border-[#a31c41]/30' },
    driver: { label: 'Driver', icon: Car, className: 'bg-[#236383]/10 text-[#236383] border-[#236383]/30' },
    general: { label: 'Volunteer', icon: UserCheck, className: 'bg-[#236383]/10 text-[#236383] border-[#236383]/30' },
  }[role] || { label: role, icon: Users, className: 'bg-gray-100 text-gray-800 border-gray-200' };

  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn('gap-1', config.className)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </Badge>
  );
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const config = {
    pending: { label: 'Pending Approval', className: 'bg-[#fbad3f]/20 text-[#d4910e] border-[#fbad3f]/40 font-medium' },
    confirmed: { label: 'Confirmed', className: 'bg-green-100 text-green-700 border-green-300 font-medium' },
    declined: { label: 'Declined', className: 'bg-[#a31c41]/15 text-[#a31c41] border-[#a31c41]/30' },
    assigned: { label: 'Assigned', className: 'bg-[#47b3cb]/20 text-[#236383] border-[#47b3cb]/40 font-medium' },
  }[status] || { label: status, className: 'bg-gray-100 text-gray-800 border-gray-200' };

  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

// Event card component — volunteer-facing, clean and simple
function EventCard({
  event,
  onSignup,
  onAssign,
  onUnavailable,
  onClearUnavailable,
  canSelfSignup,
  canAssignOthers,
  existingSignup,
  existingUnavailable,
}: {
  event: AvailableEvent;
  onSignup: (eventId: number, preselectedRole?: 'general' | 'driver') => void;
  onAssign?: (eventId: number) => void;
  onUnavailable: (eventId: number) => void;
  onClearUnavailable: (eventId: number) => void;
  canSelfSignup: boolean;
  canAssignOthers?: boolean;
  existingSignup?: MySignup;
  existingUnavailable?: MyUnavailable;
}) {
  const eventDate = getEffectiveEventDate(event);
  const formattedDate = eventDate
    ? format(parseEventDate(eventDate)!, 'EEEE, MMMM d, yyyy')
    : 'Date TBD';

  // Build a simple list of roles needed
  const rolesNeeded: string[] = [];
  if (event.volunteersUnfilled > 0) rolesNeeded.push(`Volunteer${event.volunteersUnfilled > 1 ? 's' : ''}`);
  if (event.driversUnfilled > 0) rolesNeeded.push(`Driver${event.driversUnfilled > 1 ? 's' : ''}`);
  if (event.vanDriverNeeded) rolesNeeded.push('Van Driver');

  return (
    <Card className="hover:shadow-lg transition-all hover:border-[#47b3cb] border-l-4 border-l-[#47b3cb]">
      <CardContent className="p-4 space-y-3">
        {/* Organization name and date */}
        <div>
          <h3 className="font-semibold text-base text-[#236383]">{event.organizationName}</h3>
          {event.department && (
            <p className="text-sm text-muted-foreground">{event.department}</p>
          )}
        </div>

        {/* Date & Time — single line when possible */}
        <div className="flex items-start gap-2 text-sm min-w-0">
          <Calendar className="w-4 h-4 shrink-0 text-[#236383] mt-0.5" />
          <span className="font-medium min-w-0 break-words">
            {formattedDate}
            <span className="font-normal text-muted-foreground">
              {' · '}{formatEventTime(event.eventStartTime, event.eventEndTime)}
            </span>
          </span>
        </div>

        {/* Driver pickup time */}
        {event.pickupTime && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Truck className="w-4 h-4 shrink-0 text-[#236383]" />
            <span>Pickup: {formatTimeForDisplay(event.pickupTime)}</span>
          </div>
        )}

        {/* Location */}
        {event.eventAddress && (
          <AddressLink location={event} />
        )}

        {/* Roles needed — simple badges */}
        {rolesNeeded.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Needed:</span>
            {event.volunteersUnfilled > 0 && (
              <Badge variant="outline" className="bg-[#236383]/10 text-[#236383] border-[#236383]/30 gap-1">
                <UserCheck className="w-3 h-3" />
                Volunteer{event.volunteersUnfilled > 1 ? ` (${event.volunteersUnfilled})` : ''}
              </Badge>
            )}
            {event.driversUnfilled > 0 && (
              <Badge variant="outline" className="bg-[#236383]/10 text-[#236383] border-[#236383]/30 gap-1">
                <Car className="w-3 h-3" />
                Driver{event.driversUnfilled > 1 ? ` (${event.driversUnfilled})` : ''}
              </Badge>
            )}
            {event.vanDriverNeeded && (
              <Badge variant="outline" className="bg-[#fbad3f]/10 text-[#fbad3f] border-[#fbad3f]/30 gap-1">
                <Car className="w-3 h-3" />
                Van Driver
              </Badge>
            )}
          </div>
        )}
        {rolesNeeded.length === 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300 gap-1">
              <Check className="w-3 h-3" />
              Fully Staffed — extra help still welcome!
            </Badge>
          </div>
        )}

        {/* Action button */}
        <div className="pt-2">
          {existingSignup ? (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-gradient-to-r from-[#47b3cb]/15 to-[#236383]/10 border border-[#47b3cb]/30">
              <div className="flex items-center gap-2">
                <div className="bg-[#236383] rounded-full p-0.5">
                  <Check className="w-3 h-3 text-white" />
                </div>
                <span className="text-sm font-medium text-[#236383]">
                  Signed up as {existingSignup.role === 'general' ? 'Volunteer' : signupRoleLabel(existingSignup.role)}
                </span>
              </div>
              <StatusBadge status={existingSignup.status} />
            </div>
          ) : existingUnavailable ? (
            <div className="space-y-2 rounded-lg border border-[#A31C41]/25 bg-[#A31C41]/5 p-3">
              <div className="flex items-start gap-2">
                <div className="bg-[#A31C41] rounded-full p-0.5 mt-0.5">
                  <Ban className="w-3 h-3 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#A31C41]">Marked not available</p>
                  {existingUnavailable.notes && (
                    <p className="mt-1 text-xs text-gray-600 whitespace-pre-line">{existingUnavailable.notes}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 border-[#A31C41]/30 text-[#A31C41] hover:bg-[#A31C41]/10"
                  onClick={() => onUnavailable(event.id)}
                >
                  Update Note
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 border-[#236383]/30 text-[#236383] hover:bg-[#236383]/10"
                  onClick={() => onClearUnavailable(event.id)}
                >
                  Available Again
                </Button>
              </div>
              {canAssignOthers && onAssign && (
                <Button
                  variant="outline"
                  className="w-full h-9 border-[#236383]/30 text-[#236383] hover:bg-[#236383]/5"
                  onClick={() => onAssign(event.id)}
                >
                  <Users className="w-4 h-4 mr-2" />
                  Assign Someone Else
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {canSelfSignup ? (
                (() => {
                  // Show one button per role this event actually needs. Falls back to a
                  // generic Volunteer button if no specific roles are unfilled (extra help
                  // is still welcome). Each button pre-selects its role in the dialog.
                  const signupButtons: Array<{
                    role: 'general' | 'driver';
                    label: string;
                    icon: typeof Mic;
                    className: string;
                  }> = [];

                  if (event.volunteersUnfilled > 0) {
                    signupButtons.push({
                      role: 'general',
                      label: `Sign Up to Volunteer${event.volunteersUnfilled > 1 ? ` (${event.volunteersUnfilled} needed)` : ''}`,
                      icon: HandHeart,
                      className: 'bg-gradient-to-r from-[#236383] to-[#47b3cb] hover:from-[#236383] hover:to-[#236383] text-white',
                    });
                  }
                  if (!event.vanDriverNeeded && event.driversUnfilled > 0) {
                    signupButtons.push({
                      role: 'driver',
                      label: `Sign Up to Drive${event.driversUnfilled > 1 ? ` (${event.driversUnfilled} needed)` : ''}`,
                      icon: Car,
                      className: 'bg-[#236383] hover:bg-[#1a4b62] text-white',
                    });
                  }

                  // Fallback: no specific unfilled roles — still let people volunteer.
                  if (signupButtons.length === 0) {
                    signupButtons.push({
                      role: 'general',
                      label: 'Sign Up to Volunteer',
                      icon: HandHeart,
                      className: 'bg-gradient-to-r from-[#236383] to-[#47b3cb] hover:from-[#236383] hover:to-[#236383] text-white',
                    });
                  }

                  return (
                    <div className="space-y-2">
                      {signupButtons.map(({ role, label, icon: Icon, className }) => (
                        <Button
                          key={role}
                          className={`w-full h-10 shadow-sm ${className}`}
                          onClick={() => onSignup(event.id, role)}
                        >
                          <Icon className="w-4 h-4 mr-2" />
                          {label}
                        </Button>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 text-center">
                  Ask a coordinator to sign you up.
                </div>
              )}
              <Button
                variant="outline"
                className="w-full h-9 border-[#A31C41]/30 text-[#A31C41] hover:bg-[#A31C41]/10"
                onClick={() => onUnavailable(event.id)}
              >
                <Ban className="w-4 h-4 mr-2" />
                I'm Not Available
              </Button>
              {canAssignOthers && onAssign && (
                <Button
                  variant="outline"
                  className="w-full h-9 border-[#236383]/30 text-[#236383] hover:bg-[#236383]/5"
                  onClick={() => onAssign(event.id)}
                >
                  <Users className="w-4 h-4 mr-2" />
                  Assign Someone Else
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Wrapper used inside Leaflet Popup so we can close the popup
// before opening the signup/assign modal (otherwise the popup hovers
// behind the modal). Must be rendered inside MapContainer.
function MapEventPopupContent({
  event,
  onSignupClick,
  onUnavailableClick,
  onClearUnavailable,
  canSelfSignup,
  canAssignOthers,
  onAssignClick,
  userLocation,
  existingSignup,
  existingUnavailable,
}: {
  event: AvailableEvent;
  onSignupClick: (eventId: number, preselectedRole?: 'general' | 'driver') => void;
  onUnavailableClick: (eventId: number) => void;
  onClearUnavailable: (eventId: number) => void;
  canSelfSignup: boolean;
  canAssignOthers: boolean;
  onAssignClick: (eventId: number) => void;
  userLocation: { lat: number; lng: number } | null;
  existingSignup?: MySignup;
  existingUnavailable?: MyUnavailable;
}) {
  const map = useMap();
  const distanceMiles = userLocation && event.latitude && event.longitude
    ? calculateDistanceMiles(
        userLocation.lat,
        userLocation.lng,
        parseFloat(event.latitude),
        parseFloat(event.longitude),
      )
    : undefined;
  return (
    <div className="w-full max-w-[calc(100vw-3rem)] space-y-3">
      {distanceMiles !== undefined && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
          <Navigation className="w-4 h-4 shrink-0" />
          <span>{distanceMiles.toFixed(1)} miles from you</span>
        </div>
      )}
      <EventCard
        event={event}
        onSignup={(id, role) => { map.closePopup(); onSignupClick(id, role); }}
        onUnavailable={(id) => { map.closePopup(); onUnavailableClick(id); }}
        onClearUnavailable={(id) => { map.closePopup(); onClearUnavailable(id); }}
        onAssign={(id) => { map.closePopup(); onAssignClick(id); }}
        canSelfSignup={canSelfSignup}
        canAssignOthers={canAssignOthers}
        existingSignup={existingSignup}
        existingUnavailable={existingUnavailable}
      />
    </div>
  );
}

// Signup dialog component
function SignupDialog({
  event,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  preselectedRole,
  userCapabilities,
}: {
  event: AvailableEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (roles: string[], notes: string) => void;
  isSubmitting: boolean;
  preselectedRole?: 'general' | 'driver';
  userCapabilities?: UserRoleCapabilities | null;
}) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const availableRoles = useMemo(() => {
    if (!event) return [];

    const roles: Array<{
      value: 'general' | 'driver';
      label: string;
      icon: typeof Mic;
      colorClass: string;
      borderClass: string;
      bgClass: string;
      instructions: string | null;
    }> = [];

    const spotsLabel = (count: number) => (count === 1 ? '1 spot open' : `${count} spots open`);

    // Always show volunteer role
    roles.push({
      value: 'general',
      label: event.volunteersUnfilled > 0
        ? `General Volunteer — ${spotsLabel(event.volunteersUnfilled)}`
        : event.volunteersNeeded > 0
          ? 'General Volunteer — filled, extra help welcome'
          : 'General Volunteer — extra help always welcome',
      icon: UserCheck,
      colorClass: 'text-[#236383]',
      borderClass: 'border-[#236383]/30',
      bgClass: 'bg-[#236383]/5',
      instructions: event.volunteerInstructions,
    });

    // Show driver role if event needs drivers AND it's NOT a van-required event.
    // Van-needed events use a separate van-driver signup flow (handled elsewhere).
    if (!event.vanDriverNeeded && (event.driversNeeded > 0 || event.driversAssigned > 0)) {
      roles.push({
        value: 'driver',
        label: event.driversUnfilled > 0
          ? `Driver — ${spotsLabel(event.driversUnfilled)}`
          : 'Driver — filled, extra help welcome',
        icon: Car,
        colorClass: 'text-[#236383]',
        borderClass: 'border-[#236383]/30',
        bgClass: 'bg-[#236383]/5',
        instructions: event.driverInstructions,
      });
    }

    // Tailor to what THIS volunteer is willing/approved to do. Driver roles
    // require coordinator approval; general is the baseline. Roles the event
    // offers but the user isn't eligible for are dropped here (single source of
    // truth in shared/event-role-eligibility.ts). The server enforces the same
    // rule on submit, so this is purely to keep the UI honest.
    return roles.filter((r) => isEligibleForRole(userCapabilities, r.value));
  }, [event, userCapabilities]);

  useEffect(() => {
    if (open && event) {
      // Honor preselected role if it's actually available for this event; otherwise
      // fall back to the first available role (original behavior).
      const preselectMatches =
        preselectedRole && availableRoles.some((r) => r.value === preselectedRole);
      const defaultRole = preselectMatches ? preselectedRole : availableRoles[0]?.value;
      setSelectedRoles(defaultRole ? [defaultRole] : []);
      setNotes('');
    }
  }, [open, event, availableRoles, preselectedRole]);

  if (!event) return null;

  const eventDate = getEffectiveEventDate(event);
  const formattedDate = eventDate
    ? format(parseEventDate(eventDate)!, 'EEEE, MMMM d, yyyy')
    : 'Date TBD';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Volunteer for Event</DialogTitle>
          <DialogDescription>
            Sign up to volunteer at {event.organizationName} on {formattedDate}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Role selection */}
          <div className="space-y-2">
            <Label>
              Select your role <span className="text-muted-foreground font-normal">(required)</span>
            </Label>
            {availableRoles.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                None of this event's roles match what you're set up for. Update the
                roles you're willing to do in your profile — driver roles
                also need coordinator approval before they show up here.
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Tip: you can choose more than one role.
                </p>
                {availableRoles.map((role) => {
                  const Icon = role.icon;
                  const isSelected = selectedRoles.includes(role.value);
                  return (
                    <Label
                      key={role.value}
                      htmlFor={`role-${role.value}`}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors',
                        role.borderClass,
                        isSelected ? role.bgClass : 'bg-white'
                      )}
                    >
                      <Checkbox
                        id={`role-${role.value}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setSelectedRoles((prev) => {
                            if (checked === true) {
                              return Array.from(new Set([...prev, role.value]));
                            }
                            return prev.filter((value) => value !== role.value);
                          });
                        }}
                        className="mt-0.5"
                      />
                      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', role.colorClass)} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-700">{role.label}</span>
                        {role.instructions && role.instructions.trim() && (
                          <p className="mt-1 text-xs text-gray-600 whitespace-pre-line">
                            <span className="font-medium text-gray-700">What to expect:</span>{' '}
                            {role.instructions}
                          </p>
                        )}
                      </div>
                    </Label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Anything we should know?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Reassurance callout */}
          <div className="bg-[#236383]/10 border-l-4 border-[#236383] rounded-md p-4 text-sm text-[#236383]">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-[#236383]" />
              <div>
                <p className="text-base font-semibold">What happens next?</p>
                <p className="text-[#236383]/90 mt-1.5 leading-relaxed">
                  A coordinator will review your signup and confirm your participation.
                  You'll receive an email once your signup is approved.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(selectedRoles, notes)}
            disabled={selectedRoles.length === 0 || isSubmitting}
            className="bg-gradient-to-r from-[#236383] to-[#47b3cb] hover:from-[#236383] hover:to-[#236383] text-white shadow-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <HandHeart className="w-4 h-4 mr-2" />
                Submit Signup Request
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Friendly labels for the roles a volunteer signed up for.
// 'speaker' is retired for new signups but kept here so legacy/historical
// speaker signups still render a friendly label instead of the raw string.
const SIGNUP_ROLE_LABELS: Record<string, string> = {
  general: 'General Volunteer',
  driver: 'Driver',
  speaker: 'Speaker',
};

function signupRoleLabel(role: string): string {
  return SIGNUP_ROLE_LABELS[role] || role;
}

/**
 * The "You're in!" moment. Shown immediately after a successful signup so the
 * volunteer gets a clear, enthusiastic confirmation (this is the SignUpGenius
 * replacement — it needs to feel reassuring, especially for non-tech users) plus
 * a one-tap way to add the event to their calendar.
 */
function SignupSuccessDialog({
  event,
  roles,
  open,
  onOpenChange,
}: {
  event: AvailableEvent | null;
  roles: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!event) return null;

  const eventDate = getEffectiveEventDate(event);
  const parsedDate = eventDate ? parseEventDate(eventDate) : null;
  const formattedDate = parsedDate ? format(parsedDate, 'EEEE, MMMM d') : 'a date to be confirmed';
  const shortDate = parsedDate ? format(parsedDate, 'MMMM d') : 'TBD';
  const timeText = formatEventTime(event.eventStartTime, event.eventEndTime);
  const addressText = getAddressText(event);

  const times = buildEventTimes(eventDate, event.eventStartTime, event.eventEndTime);
  const calTitle = `Sandwich Project — ${event.organizationName}`;
  const roleLabels = roles.map(signupRoleLabel);
  const calDetails = [
    roleLabels.length ? `Role${roleLabels.length > 1 ? 's' : ''}: ${roleLabels.join(', ')}` : null,
    'Thanks for volunteering with The Sandwich Project!',
  ]
    .filter(Boolean)
    .join('\n');

  const handleGoogle = () => {
    if (!times) return;
    const url = googleCalendarUrl(calTitle, times, addressText || null, calDetails);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleIcs = () => {
    if (!times) return;
    const ics = buildIcs(
      `tsp-volunteer-${event.id}@thesandwichproject.org`,
      calTitle,
      times,
      addressText || null,
      calDetails,
    );
    downloadIcs(`sandwich-project-${event.id}.ics`, ics);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#236383] to-[#47b3cb] text-white shadow-sm">
            <PartyPopper className="h-7 w-7" />
          </div>
          <DialogTitle className="text-xl">You're in! 🎉</DialogTitle>
          <DialogDescription className="text-base text-[#236383]">
            Thanks for signing up to volunteer at{' '}
            <span className="font-semibold">{event.organizationName}</span> on{' '}
            <span className="font-semibold">{shortDate}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Event recap */}
          <div className="rounded-lg border border-[#236383]/20 bg-[#236383]/5 p-4 space-y-2.5 text-sm">
            <div className="flex items-center gap-2 text-gray-700">
              <Building2 className="h-4 w-4 shrink-0 text-[#236383]" />
              <span className="font-medium">{event.organizationName}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-700">
              <CalendarDays className="h-4 w-4 shrink-0 text-[#236383]" />
              <span>{formattedDate}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-700">
              <Clock className="h-4 w-4 shrink-0 text-[#236383]" />
              <span>{timeText}</span>
            </div>
            {addressText && (
              <div className="flex items-start gap-2 text-gray-700">
                <MapPin className="h-4 w-4 shrink-0 text-[#236383] mt-0.5" />
                <span>{addressText}</span>
              </div>
            )}
            {roleLabels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {roleLabels.map((label) => (
                  <Badge
                    key={label}
                    variant="secondary"
                    className="bg-[#236383]/10 text-[#236383] hover:bg-[#236383]/10"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Add to calendar */}
          {times && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Add it to your calendar so you don't forget:
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={handleGoogle}
                  className="flex-1 border-[#236383]/30 text-[#236383] hover:bg-[#236383]/5"
                >
                  <CalendarPlus className="h-4 w-4 mr-2" />
                  Google Calendar
                </Button>
                <Button
                  variant="outline"
                  onClick={handleIcs}
                  className="flex-1 border-[#236383]/30 text-[#236383] hover:bg-[#236383]/5"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Apple / Outlook
                </Button>
              </div>
            </div>
          )}

          {/* What happens next */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#236383] mt-0.5" />
            <span>
              A coordinator will confirm your spot, and we've emailed you the details. See you on{' '}
              {shortDate}!
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            className="w-full bg-gradient-to-r from-[#236383] to-[#47b3cb] hover:from-[#236383] hover:to-[#236383] text-white"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnavailableDialog({
  event,
  existingUnavailable,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: {
  event: AvailableEvent | null;
  existingUnavailable?: MyUnavailable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (notes: string) => void;
  isSubmitting: boolean;
}) {
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setNotes(existingUnavailable?.notes || '');
    }
  }, [open, existingUnavailable]);

  if (!event) return null;

  const eventDate = getEffectiveEventDate(event);
  const formattedDate = eventDate
    ? format(parseEventDate(eventDate)!, 'EEEE, MMMM d, yyyy')
    : 'Date TBD';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Not Available</DialogTitle>
          <DialogDescription>
            Let coordinators know not to ask you about {event.organizationName} on {formattedDate}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-md border border-[#A31C41]/25 bg-[#A31C41]/5 px-3 py-2 text-sm text-[#A31C41]">
            Marking this means you will not be able to sign up for any role on this event unless you clear it later.
          </div>
          <div className="space-y-2">
            <Label htmlFor="unavailable-notes">Notes (optional)</Label>
            <Textarea
              id="unavailable-notes"
              placeholder="Optional: out of town, already booked, too far away..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(notes)}
            disabled={isSubmitting}
            className="bg-[#A31C41] hover:bg-[#8e1738] text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Ban className="w-4 h-4 mr-2" />
                Mark Not Available
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Assign-Others dialog: for users with EVENT_REQUESTS_ASSIGN_OTHERS who want
// to staff an event with someone other than themselves. Mirrors SignupDialog
// but adds a user picker and skips the self-signup pending-review flow.
function AssignOthersDialog({
  event,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: {
  event: AvailableEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (targetUserId: string, roles: string[], notes: string) => void;
  isSubmitting: boolean;
}) {
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [userSearch, setUserSearch] = useState('');

  const { data: assignableUsers = [] } = useQuery<Array<{
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    email?: string | null;
  }>>({
    queryKey: ['/api/users/for-assignments'],
    enabled: open,
  });

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return assignableUsers;
    const q = userSearch.toLowerCase();
    return assignableUsers.filter((u) => {
      const name = (u.displayName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()).toLowerCase();
      const email = (u.email ?? '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [assignableUsers, userSearch]);

  const availableRoles = useMemo(() => {
    if (!event) return [] as Array<{ value: 'general' | 'driver'; label: string; icon: typeof Mic; colorClass: string; borderClass: string; bgClass: string }>;
    const roles: Array<{ value: 'general' | 'driver'; label: string; icon: typeof Mic; colorClass: string; borderClass: string; bgClass: string }> = [];
    roles.push({
      value: 'general',
      label: event.volunteersUnfilled > 0
        ? `General Volunteer (${event.volunteersUnfilled} needed)`
        : `General Volunteer`,
      icon: UserCheck,
      colorClass: 'text-[#236383]',
      borderClass: 'border-[#236383]/30',
      bgClass: 'bg-[#236383]/5',
    });
    if (!event.vanDriverNeeded && (event.driversNeeded > 0 || event.driversAssigned > 0)) {
      roles.push({
        value: 'driver',
        label: event.driversUnfilled > 0
          ? `Driver (${event.driversUnfilled} needed)`
          : `Driver (${event.driversAssigned}/${event.driversNeeded} filled)`,
        icon: Car,
        colorClass: 'text-[#236383]',
        borderClass: 'border-[#236383]/30',
        bgClass: 'bg-[#236383]/5',
      });
    }
    return roles;
  }, [event]);

  useEffect(() => {
    if (open && event) {
      setTargetUserId('');
      setSelectedRoles([availableRoles[0]?.value].filter(Boolean) as string[]);
      setNotes('');
      setUserSearch('');
    }
  }, [open, event, availableRoles]);

  if (!event) return null;

  const eventDate = getEffectiveEventDate(event);
  const formattedDate = eventDate
    ? format(parseEventDate(eventDate)!, 'EEEE, MMMM d, yyyy')
    : 'Date TBD';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign Someone to Event</DialogTitle>
          <DialogDescription>
            Pre-approved assignment to {event.organizationName} on {formattedDate}. The person you assign will be notified immediately — no review step.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* User picker */}
          <div className="space-y-2">
            <Label htmlFor="assignee-search">
              Who are you assigning? <span className="text-muted-foreground font-normal">(required)</span>
            </Label>
            <Input
              id="assignee-search"
              placeholder="Search by name or email..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
            <ScrollArea className="h-40 rounded-md border">
              <div className="p-1 space-y-1">
                {filteredUsers.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No users match that search.
                  </div>
                ) : (
                  filteredUsers.slice(0, 50).map((u) => {
                    const label = u.displayName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || u.id;
                    const isSelected = targetUserId === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setTargetUserId(u.id)}
                        className={cn(
                          'w-full text-left px-2 py-1.5 rounded text-sm transition-colors',
                          isSelected ? 'bg-[#236383] text-white' : 'hover:bg-slate-100'
                        )}
                      >
                        <div className="font-medium truncate">{label}</div>
                        {u.email && (
                          <div className={cn('text-xs truncate', isSelected ? 'text-white/80' : 'text-muted-foreground')}>
                            {u.email}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Role selection */}
          <div className="space-y-2">
            <Label>
              Role(s) <span className="text-muted-foreground font-normal">(required)</span>
            </Label>
            {availableRoles.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No roles are currently available for this event.
              </div>
            ) : (
              <div className="space-y-2">
                {availableRoles.map((role) => {
                  const Icon = role.icon;
                  const isSelected = selectedRoles.includes(role.value);
                  return (
                    <Label
                      key={role.value}
                      htmlFor={`assign-role-${role.value}`}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors',
                        role.borderClass,
                        isSelected ? role.bgClass : 'bg-white'
                      )}
                    >
                      <Checkbox
                        id={`assign-role-${role.value}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setSelectedRoles((prev) => {
                            if (checked === true) {
                              return Array.from(new Set([...prev, role.value]));
                            }
                            return prev.filter((v) => v !== role.value);
                          });
                        }}
                      />
                      <Icon className={cn('w-4 h-4', role.colorClass)} />
                      <span className="text-sm text-gray-700">{role.label}</span>
                    </Label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="assign-notes">Notes (optional)</Label>
            <Textarea
              id="assign-notes"
              placeholder="Anything the assignee should know..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(targetUserId, selectedRoles, notes)}
            disabled={!targetUserId || selectedRoles.length === 0 || isSubmitting}
            className="bg-gradient-to-r from-[#236383] to-[#47b3cb] hover:from-[#236383] hover:to-[#236383] text-white shadow-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Assigning...
              </>
            ) : (
              'Confirm Assignment'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Coordinator dialog for changing a volunteer's role OR removing them
 * from an event. The same dialog handles both flows so we don't nest dialogs.
 * Mode is set when the dialog is opened.
 */
function ManageSignupDialog({
  signup,
  mode,
  open,
  onOpenChange,
  onChangeRole,
  onRemove,
  isSubmitting,
}: {
  signup: any | null;
  mode: 'change_role' | 'remove' | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeRole: (signupId: number, role: string, reason?: string) => void;
  onRemove: (signupId: number, reason?: string) => void;
  isSubmitting: boolean;
}) {
  const [newRole, setNewRole] = useState<string>('general');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && signup) {
      // Default to the first role that's actually selectable — i.e. not the
      // current role, and not the Driver option when it's hidden because the
      // event needs a van driver (those go through the van-driver flow). This
      // prevents the Select from showing an unavailable value that Save would
      // still submit. Empty string when there's no valid alternative, which
      // keeps the Save button disabled.
      const vanDriverNeeded = !!signup.event?.vanDriverNeeded;
      const available: string[] = [];
      if (signup.role !== 'general') available.push('general');
      if (signup.role !== 'driver' && !vanDriverNeeded) available.push('driver');
      setNewRole(available[0] ?? '');
      setReason('');
    }
  }, [open, signup?.id, signup?.role, signup]);

  if (!signup || !mode) return null;

  const orgName = signup.event?.organizationName || 'this event';
  const vanNeeded = !!signup.event?.vanDriverNeeded;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'change_role' ? 'Change Volunteer Role' : 'Remove Volunteer'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'change_role'
              ? `Update ${signup.volunteerName || 'this volunteer'}'s role on ${orgName}.`
              : `Remove ${signup.volunteerName || 'this volunteer'} from ${orgName}. They'll be notified by email.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {mode === 'change_role' && (
            <div className="space-y-2">
              <Label>New role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose role" />
                </SelectTrigger>
                <SelectContent>
                  {signup.role !== 'general' && (
                    <SelectItem value="general">General Volunteer</SelectItem>
                  )}
                  {signup.role !== 'driver' && !vanNeeded && (
                    <SelectItem value="driver">Driver</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {vanNeeded && signup.role !== 'driver' && (
                <p className="text-xs text-[#A31C41]">
                  Driver role is hidden because this event needs a van driver. Use the van driver flow instead.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">
              {mode === 'change_role' ? 'Reason (optional)' : 'Explanation (optional)'}
            </Label>
            <Textarea
              id="reason"
              placeholder={
                mode === 'change_role'
                  ? "What's prompting this change? (will be included in the email)"
                  : "Why are you removing them? (will be included in the email)"
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          {mode === 'change_role' ? (
            <Button
              onClick={() => onChangeRole(signup.id, newRole, reason.trim() || undefined)}
              disabled={isSubmitting || !newRole || newRole === signup.role}
              className="bg-[#FBAD3F] hover:bg-[#FBAD3F]/90 text-[#1a1a1a]"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Change
            </Button>
          ) : (
            <Button
              onClick={() => onRemove(signup.id, reason.trim() || undefined)}
              disabled={isSubmitting}
              className="bg-[#A31C41] hover:bg-[#A31C41]/90 text-white"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Remove Volunteer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Main component
export default function VolunteerEventHub({
  initialView = null,
}: {
  initialView?: string | null;
} = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canAssignOthers =
    user?.role === 'super_admin' ||
    (Array.isArray(user?.permissions) &&
      (user.permissions as string[]).includes('EVENT_REQUESTS_ASSIGN_OTHERS'));

  const canApproveSignups =
    !!user && hasPermission(user, PERMISSIONS.VOLUNTEER_SIGNUP_APPROVE);

  const canSelfSignup = !!user && hasPermission(user, PERMISSIONS.EVENT_REQUESTS_SELF_SIGNUP);

  const [view, setViewState] = useState<HubView>(
    () => resolveVolunteerHubView(initialView, canApproveSignups) ?? 'calendar',
  );

  const setView = (next: HubView) => {
    setViewState(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'volunteer-hub');
      url.searchParams.set('view', next);
      window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
    } catch {
      // ignore unavailable history
    }
  };

  useEffect(() => {
    const next = resolveVolunteerHubView(initialView, canApproveSignups) ?? 'calendar';
    setViewState(next);
    if (initialView && initialView !== next) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('section', 'volunteer-hub');
        url.searchParams.set('view', next);
        window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
      } catch {
        // ignore unavailable history
      }
    }
  }, [initialView, canApproveSignups]);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AvailableEvent | null>(null);
  const [signupDialogOpen, setSignupDialogOpen] = useState(false);
  // "You're in!" confirmation shown after a successful self-signup.
  const [signupConfirmation, setSignupConfirmation] = useState<{
    event: AvailableEvent;
    roles: string[];
  } | null>(null);
  const [unavailableDialogOpen, setUnavailableDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [manageSignup, setManageSignup] = useState<any | null>(null);
  const [manageMode, setManageMode] = useState<'change_role' | 'remove' | null>(null);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  // Filters
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [mySignupsRoleFilter, setMySignupsRoleFilter] = useState<string>('all');
  const [showOnlyNeeds, setShowOnlyNeeds] = useState(true);
  // Soft filter (off by default): narrow the list to events with an opening for a
  // role this volunteer is actually eligible for. Discovery stays open otherwise.
  const [showOnlyMyRoles, setShowOnlyMyRoles] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const needsOnlyForEventQuery = view === 'calendar' ? false : showOnlyNeeds;

  // Roles this user is willing + (where required) approved for. Drives the
  // "only opportunities I can do" toggle below. Same helper the signup dialog
  // and the server use.
  const myEligibleRoles = useMemo(
    () => getEligibleEventRoles(user as UserRoleCapabilities | null),
    [user]
  );

  // User location for distance calculation on map
  const [userAddress, setUserAddress] = useState('');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [browserLocationLoading, setBrowserLocationLoading] = useState(false);

  // For the calendar view, also fetch completed events for the displayed
  // month (only when the month is in the past — current/future months
  // already get their data via the upcoming-events branch). Other views
  // (list, map) don't pass a pastMonth so they keep their old behavior.
  //
  // Format: YYYY-MM, e.g. "2026-05". The server validates the format and
  // ignores anything malformed, so a stale render between state changes
  // can't break the request.
  const pastMonthParam = useMemo(() => {
    if (view !== 'calendar') return null;
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const viewedMonthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    if (viewedMonthStart >= currentMonthStart) return null; // not a past month
    const yyyy = viewedMonthStart.getFullYear();
    const mm = String(viewedMonthStart.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  }, [view, currentMonth]);

  // Fetch available events
  const { data: events = [], isLoading: eventsLoading } = useQuery<AvailableEvent[]>({
    queryKey: ['/api/volunteer-hub/available-events', needsOnlyForEventQuery, pastMonthParam],
    queryFn: async () => {
      const params = new URLSearchParams({ needsOnly: String(needsOnlyForEventQuery) });
      if (pastMonthParam) params.set('pastMonth', pastMonthParam);
      const response = await fetch(
        `/api/volunteer-hub/available-events?${params.toString()}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Failed to fetch events');
      return response.json();
    },
  });

  // Fetch user's signups
  const { data: mySignups = [], isLoading: signupsLoading } = useQuery<MySignup[]>({
    queryKey: ['/api/volunteer-hub/my-signups'],
    queryFn: async () => {
      const response = await fetch('/api/volunteer-hub/my-signups', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch signups');
      return response.json();
    },
  });

  const { data: myUnavailable = [], isLoading: unavailableLoading } = useQuery<MyUnavailable[]>({
    queryKey: ['/api/volunteer-hub/my-unavailable'],
    queryFn: async () => {
      const response = await fetch('/api/volunteer-hub/my-unavailable', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch unavailable events');
      return response.json();
    },
  });

  // Fetch pending signups (for coordinators)
  const { data: pendingSignups = [] } = useQuery<any[]>({
    queryKey: ['/api/volunteer-hub/pending-signups'],
    queryFn: async () => {
      const response = await fetch('/api/volunteer-hub/pending-signups', { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: canApproveSignups,
    refetchInterval: 30000,
  });

  // Approve/decline mutation
  const updateSignupStatusMutation = useMutation({
    mutationFn: async ({ signupId, status }: { signupId: number; status: string }) => {
      const response = await fetch(`/api/volunteer-hub/signup/${signupId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to update signup status');
      return response.json();
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/pending-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/all-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/available-events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/coverage-summary'] });
      toast({ title: status === 'assigned' ? 'Signup approved' : 'Signup declined' });
    },
    onError: () => {
      toast({ title: 'Failed to update signup', variant: 'destructive' });
    },
  });

  // Fetch all signups (approved + declined) for management list
  const { data: allSignups = [] } = useQuery<any[]>({
    queryKey: ['/api/volunteer-hub/all-signups'],
    queryFn: async () => {
      const response = await fetch('/api/volunteer-hub/pending-signups?all=true', { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: canApproveSignups,
    refetchInterval: 30000,
  });

  const { data: coverageSummary = [], isLoading: coverageLoading } = useQuery<CoverageSummaryEvent[]>({
    queryKey: ['/api/volunteer-hub/coverage-summary'],
    queryFn: async () => {
      const response = await fetch('/api/volunteer-hub/coverage-summary', { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: canApproveSignups,
    refetchInterval: 30000,
  });

  // Change role mutation
  const changeRoleMutation = useMutation({
    mutationFn: async ({ signupId, role, reason }: { signupId: number; role: string; reason?: string }) => {
      const response = await fetch(`/api/volunteer-hub/signup/${signupId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, reason }),
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to change role');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/all-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/pending-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/available-events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/coverage-summary'] });
      toast({ title: 'Role updated', description: 'Volunteer has been notified by email.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to change role', description: err.message, variant: 'destructive' });
    },
  });

  // Remove from event mutation
  const removeSignupMutation = useMutation({
    mutationFn: async ({ signupId, reason }: { signupId: number; reason?: string }) => {
      const response = await fetch(`/api/volunteer-hub/signup/${signupId}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to remove signup');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/all-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/pending-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/available-events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/coverage-summary'] });
      toast({ title: 'Volunteer removed', description: 'They have been notified by email.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to remove', description: err.message, variant: 'destructive' });
    },
  });

  // Signup mutation
  const signupMutation = useMutation({
    mutationFn: async ({ eventId, roles, notes }: { eventId: number; event: AvailableEvent; roles: string[]; notes: string }) => {
      const response = await fetch(`/api/volunteer-hub/signup/${eventId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles, notes }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to sign up');
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      // Hand off to the celebratory "You're in!" dialog. Use the event captured
      // in the mutation variables — not selectedEvent, which may have changed if
      // the user clicked a different event while this request was in flight.
      setSignupDialogOpen(false);
      setSelectedEvent(null);
      setSignupConfirmation({ event: variables.event, roles: variables.roles });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/my-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/available-events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/coverage-summary'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Signup Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const unavailableMutation = useMutation({
    mutationFn: async ({ eventId, notes }: { eventId: number; notes: string }) => {
      const response = await fetch(`/api/volunteer-hub/availability/${eventId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isUnavailable: true, notes }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save availability');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Marked Not Available',
        description: data.message || 'Coordinators will see that you cannot help with this event.',
      });
      setUnavailableDialogOpen(false);
      setSelectedEvent(null);
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/my-unavailable'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/coverage-summary'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could Not Save',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const clearUnavailableMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const response = await fetch(`/api/volunteer-hub/availability/${eventId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isUnavailable: false }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to clear availability');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Availability Updated',
        description: 'You can sign up for this event again.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/my-unavailable'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/coverage-summary'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could Not Update',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Assign-others mutation: coordinator assigning another user to an event.
  // Hits the same /signup/:eventId endpoint with targetUserId set; the backend
  // routes it through the pre-approved path and mirrors into event arrays.
  const assignOthersMutation = useMutation({
    mutationFn: async ({
      eventId,
      targetUserId,
      roles,
      notes,
    }: {
      eventId: number;
      targetUserId: string;
      roles: string[];
      notes: string;
    }) => {
      const response = await fetch(`/api/volunteer-hub/signup/${eventId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId, roles, notes }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to assign');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Assignment complete',
        description: data.message || 'User assigned to this event.',
      });
      setAssignDialogOpen(false);
      setSelectedEvent(null);
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/available-events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/all-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/coverage-summary'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Assignment failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Cancel signup mutation
  const cancelSignupMutation = useMutation({
    mutationFn: async (signupId: number) => {
      const response = await fetch(`/api/volunteer-hub/signup/${signupId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cancel signup');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Signup Cancelled',
        description: 'Your volunteer signup has been cancelled.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/my-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/coverage-summary'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Cancel Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Filter events
  const filteredEvents = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return dedupeEventsById(events)
      .filter(event => {
        if (normalizedSearch) {
          const searchableText = [
            event.organizationName,
            event.organizationCategory || '',
            event.department || '',
            event.eventAddress || '',
            event.city || '',
            event.state || '',
            event.eventNotes || '',
          ].join(' ').toLowerCase();

          if (!searchableText.includes(normalizedSearch)) return false;
        }

        if (roleFilter === 'volunteer' && event.volunteersUnfilled === 0) return false;
        if (roleFilter === 'driver') {
          if (event.driversUnfilled === 0) return false;
          // Group is providing their own transport — no driver opportunity here.
          if (event.selfTransport) return false;
        }

        // "Only opportunities I can do": keep events that have an opening for a
        // role this volunteer is eligible for. Mirrors getEligibleEventRoles.
        if (showOnlyMyRoles) {
          const matchesMyRole =
            (myEligibleRoles.includes('general') && event.volunteersUnfilled > 0) ||
            (myEligibleRoles.includes('driver') &&
              event.driversUnfilled > 0 &&
              !event.selfTransport &&
              !event.vanDriverNeeded) ||
            // Van is its own opening (vanDriverNeeded), separate from regular
            // driver slots — a van-approved volunteer should still see these.
            (myEligibleRoles.includes('van') && event.vanDriverNeeded);
          if (!matchesMyRole) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.hasUnfilledNeeds !== b.hasUnfilledNeeds) {
          return a.hasUnfilledNeeds ? -1 : 1;
        }

        const dateA = getEffectiveEventDate(a);
        const dateB = getEffectiveEventDate(b);
        if (dateA && dateB) return new Date(dateA).getTime() - new Date(dateB).getTime();
        if (dateA) return -1;
        if (dateB) return 1;
        return a.organizationName.localeCompare(b.organizationName);
      });
  }, [events, roleFilter, searchTerm, showOnlyMyRoles, myEligibleRoles]);

  // Calculate summary metrics for dashboard cards
  const summaryMetrics = useMemo(() => {
    const upcomingEvents = events.filter(isUpcomingHubEvent);
    const totalEvents = upcomingEvents.length;
    const eventsNeedingHelp = upcomingEvents.filter((e) => e.hasUnfilledNeeds).length;
    const totalVolunteerOpenings = upcomingEvents.reduce((sum, e) => sum + e.volunteersUnfilled, 0);
    const totalDriverOpenings = upcomingEvents.reduce((sum, e) => sum + e.driversUnfilled, 0);
    const totalOpenings = totalVolunteerOpenings + totalDriverOpenings;

    return {
      totalEvents,
      eventsNeedingHelp,
      totalVolunteerOpenings,
      totalDriverOpenings,
      totalOpenings,
    };
  }, [events]);

  // Group events by date for calendar view
  const eventsByDate = useMemo(() => {
    const grouped: Record<string, AvailableEvent[]> = {};
    filteredEvents.forEach(event => {
      const key = getCalendarDateKey(event);
      if (key) {
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(event);
      }
    });
    return grouped;
  }, [filteredEvents]);

  const getRoleOpenings = (event: AvailableEvent) => {
    const roles: Array<{ singular: string; plural: string; count: number; color: string; bg: string; Icon: typeof Mic }> = [];

    if (event.volunteersUnfilled > 0) {
      roles.push({ singular: 'volunteer', plural: 'volunteers', count: event.volunteersUnfilled, color: '#236383', bg: '#23638314', Icon: UserCheck });
    }
    if (event.driversUnfilled > 0) {
      roles.push({ singular: 'driver', plural: 'drivers', count: event.driversUnfilled, color: '#236383', bg: '#23638314', Icon: Car });
    }
    if (event.vanDriverNeeded) {
      roles.push({ singular: 'van driver', plural: 'van drivers', count: 1, color: '#B45309', bg: '#FBAD3F22', Icon: Truck });
    }

    return roles;
  };

  const formatNeededRole = (role: ReturnType<typeof getRoleOpenings>[number]) => {
    const label = role.count === 1 ? role.singular : role.plural;
    return `${role.count} ${label} needed`;
  };

  const getTotalOpeningsForEvents = (dayEvents: AvailableEvent[]) => (
    dayEvents.reduce((sum, event) => (
      sum +
      Math.max(0, event.volunteersUnfilled) +
      Math.max(0, event.driversUnfilled) +
      (event.vanDriverNeeded ? 1 : 0)
    ), 0)
  );

  const monthCalendarSummary = useMemo(() => {
    const monthEvents = filteredEvents.filter((event) => {
      const dateStr = getEffectiveEventDate(event);
      if (!dateStr) return false;
      const date = parseEventDate(dateStr);
      return !!date && date.getMonth() === currentMonth.getMonth() && date.getFullYear() === currentMonth.getFullYear();
    });

    return {
      events: monthEvents.length,
      openings: getTotalOpeningsForEvents(monthEvents),
      days: new Set(
        monthEvents.map((event) => getCalendarDateKey(event)).filter(Boolean),
      ).size,
    };
  }, [filteredEvents, currentMonth]);

  const selectedDateEvents = selectedCalendarDate ? eventsByDate[selectedCalendarDate] || [] : [];
  const selectedDateLabel = selectedCalendarDate
    ? format(parseEventDate(selectedCalendarDate)!, 'EEEE, MMMM d')
    : 'Choose a day';

  // Get existing signup for an event
  const getExistingSignup = (eventId: number) => {
    return mySignups.find(s => s.eventRequestId === eventId);
  };

  const getExistingUnavailable = (eventId: number) => {
    return myUnavailable.find((unavailable) => unavailable.eventRequestId === eventId);
  };

  // Handle signup click
  // Geocode user address for distance calculation
  const handleGeocodeAddress = async () => {
    if (!userAddress.trim()) return;
    setGeocodingLoading(true);
    try {
      const res = await fetch('/api/event-map/geocode-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ address: userAddress.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast({
          title: 'Address not found',
          description: data.details || 'Could not find that address. Try a more specific address.',
          variant: 'destructive',
        });
        return;
      }
      const data = await res.json();
      setUserLocation({ lat: parseFloat(data.latitude), lng: parseFloat(data.longitude) });
      toast({ title: 'Location set', description: 'Showing distances from your address.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to look up address.', variant: 'destructive' });
    } finally {
      setGeocodingLoading(false);
    }
  };

  const handleUseBrowserLocation = () => {
    if (!navigator.geolocation) {
      toast({
        title: 'Location not available',
        description: "Your browser doesn't support location lookup. Type an address instead.",
        variant: 'destructive',
      });
      return;
    }
    setBrowserLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setUserAddress('Current location');
        setBrowserLocationLoading(false);
        toast({ title: 'Location set', description: 'Showing distances from where you are.' });
      },
      (error) => {
        setBrowserLocationLoading(false);
        const description = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Type an address instead.'
          : 'Could not get your location. Type an address instead.';
        toast({ title: 'Location unavailable', description, variant: 'destructive' });
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const [preselectedSignupRole, setPreselectedSignupRole] = useState<'general' | 'driver' | undefined>(undefined);

  const handleSignupClick = (eventId: number, preselectedRole?: 'general' | 'driver') => {
    const event = events.find(e => e.id === eventId);
    if (event) {
      setSelectedEvent(event);
      setPreselectedSignupRole(preselectedRole);
      setSignupDialogOpen(true);
    }
  };

  const handleUnavailableClick = (eventId: number) => {
    const unavailableEvent = myUnavailable.find((unavailable) => unavailable.eventRequestId === eventId)?.event;
    const event = events.find(e => e.id === eventId) || (unavailableEvent ? {
      id: unavailableEvent.id,
      organizationName: unavailableEvent.organizationName,
      organizationCategory: null,
      department: null,
      eventAddress: unavailableEvent.eventAddress,
      city: unavailableEvent.city,
      state: unavailableEvent.state,
      zipCode: null,
      latitude: null,
      longitude: null,
      scheduledEventDate: unavailableEvent.scheduledEventDate,
      desiredEventDate: unavailableEvent.desiredEventDate,
      eventStartTime: unavailableEvent.eventStartTime,
      eventEndTime: unavailableEvent.eventEndTime,
      estimatedSandwichCount: null,
      status: unavailableEvent.status,
      speakersNeeded: 0,
      speakersAssigned: 0,
      speakersUnfilled: 0,
      volunteersNeeded: 0,
      volunteersAssigned: 0,
      volunteersUnfilled: 0,
      driversNeeded: 0,
      driversAssigned: 0,
      driversUnfilled: 0,
      hasUnfilledNeeds: false,
      vanDriverNeeded: false,
      selfTransport: null,
      pickupTime: null,
      eventNotes: null,
      driverInstructions: null,
      volunteerInstructions: null,
      speakerInstructions: null,
    } satisfies AvailableEvent : null);
    if (event) {
      setSelectedEvent(event);
      setUnavailableDialogOpen(true);
    }
  };

  const handleClearUnavailable = (eventId: number) => {
    clearUnavailableMutation.mutate(eventId);
  };

  const handleAssignClick = (eventId: number) => {
    const event = events.find(e => e.id === eventId);
    if (event) {
      setSelectedEvent(event);
      setAssignDialogOpen(true);
    }
  };

  // Handle signup submit
  const handleSignupSubmit = (roles: string[], notes: string) => {
    if (selectedEvent) {
      signupMutation.mutate({ eventId: selectedEvent.id, event: selectedEvent, roles, notes });
    }
  };

  const handleUnavailableSubmit = (notes: string) => {
    if (selectedEvent) {
      unavailableMutation.mutate({ eventId: selectedEvent.id, notes });
    }
  };

  // Handle assign-others submit
  const handleAssignSubmit = (targetUserId: string, roles: string[], notes: string) => {
    if (selectedEvent) {
      assignOthersMutation.mutate({ eventId: selectedEvent.id, targetUserId, roles, notes });
    }
  };

  // Calendar navigation
  const prevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
    setSelectedCalendarDate(null);
  };
  const nextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
    setSelectedCalendarDate(null);
  };
  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedCalendarDate(format(today, 'yyyy-MM-dd'));
  };

  // Calendar days
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Add padding days for calendar grid
  const startPadding = monthStart.getDay();
  const endPadding = (7 - ((startPadding + calendarDays.length) % 7)) % 7;
  const paddedDays = [
    ...Array(startPadding).fill(null),
    ...calendarDays,
    ...Array(endPadding).fill(null),
  ];

  // Map center (default to NYC area)
  const mapCenter: [number, number] = useMemo(() => {
    const eventsWithCoords = filteredEvents.filter(e => e.latitude && e.longitude);
    if (eventsWithCoords.length > 0) {
      const avgLat = eventsWithCoords.reduce((sum, e) => sum + parseFloat(e.latitude!), 0) / eventsWithCoords.length;
      const avgLng = eventsWithCoords.reduce((sum, e) => sum + parseFloat(e.longitude!), 0) / eventsWithCoords.length;
      return [avgLat, avgLng];
    }
    return [40.7128, -74.006]; // Default to NYC
  }, [filteredEvents]);

  const coverageMetrics = useMemo(() => {
    const eventsNeedingHelp = coverageSummary.filter((event) => (
      event.roles.some((role) => role.unfilled > 0)
    )).length;
    const openRoles = coverageSummary.reduce((sum, event) => (
      sum + event.roles.reduce((roleSum, role) => roleSum + Math.max(0, role.unfilled), 0)
    ), 0);
    const unavailableResponses = coverageSummary.reduce((sum, event) => sum + event.unavailable.length, 0);

    return {
      events: coverageSummary.length,
      eventsNeedingHelp,
      openRoles,
      unavailableResponses,
    };
  }, [coverageSummary]);

  if (eventsLoading || signupsLoading || unavailableLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
        {/* Header with gradient banner */}
        <div className="bg-gradient-to-r from-[#236383] to-[#47b3cb] rounded-xl p-6 text-white">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
                <div className="bg-white/20 p-2 rounded-lg">
                  <HandHeart className="w-7 h-7" />
                </div>
                Volunteer Event Hub
              </h1>
              <p className="text-white/80 mt-2 text-base">
                Find an event, pick a role, and sign up — it's that simple.
              </p>
            </div>
            {mySignups.length > 0 && (
              <button
                onClick={() => setView('my_signups')}
                className="bg-white/20 hover:bg-white/30 transition-colors rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2"
              >
                <UserCheck className="w-4 h-4" />
                {mySignups.length} Active Signup{mySignups.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* Hero metric — the answer to "where do you need me?". Leads
              with the total open roles as one big number, then breaks down
              by role type so a volunteer can immediately see which slots
              fit them. We frame this as an invitation ("opportunities
              available") rather than a status readout ("needed"). */}
          <div className="mt-6">
            {summaryMetrics.totalOpenings === 0 ? (
              <div className="bg-white/15 rounded-xl px-5 py-6 border border-white/20 text-center">
                <div className="text-base sm:text-lg text-white/90">
                  All roles are currently filled. Thank you, volunteers! Check back soon for new opportunities.
                </div>
              </div>
            ) : (
              <>
                <div className="bg-white/15 rounded-xl px-5 py-5 border border-white/20">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span aria-hidden="true" className="text-3xl sm:text-4xl">🟧</span>
                    <span className="text-3xl sm:text-5xl font-extrabold leading-none">
                      {summaryMetrics.totalOpenings}
                    </span>
                    <span className="text-lg sm:text-xl font-semibold text-white">
                      volunteer opportunit{summaryMetrics.totalOpenings === 1 ? 'y' : 'ies'} available
                    </span>
                  </div>
                  <p className="mt-2 text-sm sm:text-base text-white/90">
                    {summaryMetrics.eventsNeedingHelp > 0 ? (
                      <>
                        We need help at{' '}
                        <span className="font-semibold">
                          {summaryMetrics.eventsNeedingHelp} upcoming event{summaryMetrics.eventsNeedingHelp === 1 ? '' : 's'}
                        </span>
                        . Pick a role below — every spot you fill makes a real difference.
                      </>
                    ) : (
                      <>
                        Browse the events below to pick a role that fits you — every spot you fill makes a real difference.
                      </>
                    )}
                  </p>
                </div>

                {/* Role-type breakdown — two supporting tiles so volunteers
                    can immediately see which slot type matches them. The
                    "General Volunteer" bucket is now surfaced (it was
                    previously hidden inside Total Openings). */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div className="bg-white/20 rounded-lg p-3 border border-white/20 flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{summaryMetrics.totalDriverOpenings}</span>
                    <span className="text-sm sm:text-base font-semibold text-white">
                      Driver opening{summaryMetrics.totalDriverOpenings === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="bg-white/20 rounded-lg p-3 border border-white/20 flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{summaryMetrics.totalVolunteerOpenings}</span>
                    <span className="text-sm sm:text-base font-semibold text-white">
                      General volunteer opening{summaryMetrics.totalVolunteerOpenings === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Filters & View Toggle */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {['calendar', 'list', 'map'].includes(view) && (
            <>
              <div className="relative w-full sm:max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by organization, city, or address..."
                  className="pl-9"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-full sm:w-[160px]">
                    <SelectValue placeholder="Filter by role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="volunteer">Volunteers Needed</SelectItem>
                    <SelectItem value="driver">Drivers Needed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {view !== 'calendar' && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="showOnlyNeeds"
                    checked={showOnlyNeeds}
                    onCheckedChange={(checked) => setShowOnlyNeeds(checked === true)}
                  />
                  <Label htmlFor="showOnlyNeeds" className="text-sm cursor-pointer">
                    Only show events that need help
                  </Label>
                </div>
              )}

              {view !== 'calendar' && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="showOnlyMyRoles"
                    checked={showOnlyMyRoles}
                    onCheckedChange={(checked) => setShowOnlyMyRoles(checked === true)}
                  />
                  <Label htmlFor="showOnlyMyRoles" className="text-sm cursor-pointer">
                    Only opportunities I can do
                  </Label>
                </div>
              )}
            </>
          )}

          <div className="flex-1" />

          <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
          {/* View toggle — icons sized up and active state given a small
              shadow lift so switching views feels intentional, not
              accidental. The label stays so the icon's meaning is
              never ambiguous. */}
          <div className="flex w-full flex-wrap gap-1 rounded-lg border border-[#236383]/20 bg-[#236383]/5 p-1 sm:w-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('calendar')}
              className={`flex-1 gap-1.5 font-semibold sm:flex-none ${view === 'calendar' ? 'bg-[#236383] text-white shadow-sm hover:bg-[#236383]/90 hover:text-white' : 'text-[#236383] hover:text-[#236383] hover:bg-[#236383]/10'}`}
            >
              <CalendarDays className="w-[18px] h-[18px]" />
              Calendar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('list')}
              className={`flex-1 gap-1.5 font-semibold sm:flex-none ${view === 'list' ? 'bg-[#236383] text-white shadow-sm hover:bg-[#236383]/90 hover:text-white' : 'text-[#236383] hover:text-[#236383] hover:bg-[#236383]/10'}`}
            >
              <List className="w-[18px] h-[18px]" />
              List
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('map')}
              className={`flex-1 gap-1.5 font-semibold sm:flex-none ${view === 'map' ? 'bg-[#236383] text-white shadow-sm hover:bg-[#236383]/90 hover:text-white' : 'text-[#236383] hover:text-[#236383] hover:bg-[#236383]/10'}`}
            >
              <MapIcon className="w-[18px] h-[18px]" />
              Map
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('my_signups')}
              className={`flex-1 gap-1.5 sm:flex-none ${view === 'my_signups' ? 'bg-[#236383] text-white hover:bg-[#236383]/90 hover:text-white' : 'text-[#236383] hover:text-[#236383] hover:bg-[#236383]/10'}`}
            >
              <UserCheck className="w-4 h-4" />
              My Signups
              {mySignups.length > 0 && (
                <span className={`ml-1 text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center ${
                  view === 'my_signups' ? 'bg-white text-[#236383]' : 'bg-[#236383] text-white'
                }`}>
                  {mySignups.length}
                </span>
              )}
            </Button>
            {canApproveSignups && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView('pending_approvals')}
                  className={`flex-1 gap-1.5 sm:flex-none ${view === 'pending_approvals' ? 'bg-[#236383] text-white hover:bg-[#236383]/90 hover:text-white' : 'text-amber-700 hover:text-[#236383] hover:bg-[#236383]/10'}`}
                >
                  <Clock className="w-4 h-4" />
                  Pending
                  {pendingSignups.length > 0 && (
                    <span className={`ml-1 text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center ${
                      view === 'pending_approvals' ? 'bg-white text-[#236383]' : 'bg-amber-500 text-white'
                    }`}>
                      {pendingSignups.length}
                    </span>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView('coverage')}
                  className={`flex-1 gap-1.5 sm:flex-none ${view === 'coverage' ? 'bg-[#236383] text-white hover:bg-[#236383]/90 hover:text-white' : 'text-[#236383] hover:text-[#236383] hover:bg-[#236383]/10'}`}
                >
                  <Eye className="w-4 h-4" />
                  Coverage
                </Button>
              </>
            )}
          </div>
          {view === 'calendar' && (
            <p className="text-xs text-[#236383]/75 leading-snug px-1 text-center sm:text-right max-w-md">
              Calendar shows all upcoming events. Open spots are highlighted first.
            </p>
          )}
          </div>
        </div>

        {/* Guidance note: shown above the active view so volunteers see it
            before scanning the calendar / list for events to sign up for. */}
        <div className="rounded-lg border border-[#FBAD3F]/40 bg-[#FFF7E6] px-4 py-3 text-sm text-[#236383] leading-relaxed">
          Extra help is usually welcome at events, but subject to approval. Please
          prioritize signing up for unfilled needs whenever possible. Thank you so
          much for being part of this team!
        </div>

        {/* Main Content */}
        <Tabs value={view} className="space-y-4">
          {/* Calendar View */}
          <TabsContent value="calendar" className="mt-0">
            <Card className="overflow-hidden border-[#FBAD3F]/30 shadow-sm">
              <div className="bg-[#FAF8F4] border-b border-[#FBAD3F]/30 px-4 sm:px-6 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-xl bg-[#FBAD3F] text-[#1A2332] flex items-center justify-center shadow-sm">
                      <CalendarDays className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={prevMonth} className="h-8 w-8 border-[#236383]/30 text-[#236383] hover:bg-[#236383]/10" aria-label="Previous month">
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <CardTitle className="min-w-[180px] text-center text-xl sm:text-2xl text-[#236383]">
                          {format(currentMonth, 'MMMM yyyy')}
                        </CardTitle>
                        <Button variant="outline" size="icon" onClick={nextMonth} className="h-8 w-8 border-[#236383]/30 text-[#236383] hover:bg-[#236383]/10" aria-label="Next month">
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                      <CardDescription className="mt-1 text-sm text-gray-700">
                        Pick a day to see the full event details and sign up.
                      </CardDescription>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="hidden sm:flex items-center gap-2 rounded-lg bg-white border border-[#236383]/20 px-3 py-2 text-sm text-[#236383]">
                      <HandHeart className="w-4 h-4 text-[#236383]" />
                      <span className="font-semibold">{monthCalendarSummary.openings}</span>
                      <span>open spots</span>
                    </div>
                    {/* Today button — used constantly on calendar interfaces,
                        so styled like Google Calendar's: prominent, full
                        outline, slightly oversized so it never reads as a
                        utility button. */}
                    <Button
                      variant="outline"
                      onClick={goToToday}
                      className="h-10 px-5 border-2 border-[#236383] text-[#236383] font-bold hover:bg-[#236383] hover:text-white hover:border-[#236383] transition-colors shadow-sm"
                    >
                      <CalendarDays className="w-4 h-4 mr-1.5" aria-hidden="true" />
                      Today
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4">
                  <div className="rounded-lg bg-white border border-[#236383]/15 p-3">
                    <div className="text-2xl font-bold text-[#236383]">{monthCalendarSummary.events}</div>
                    <div className="text-xs font-medium text-gray-600">events shown</div>
                  </div>
                  <div className="rounded-lg bg-white border border-[#236383]/15 p-3">
                    <div className="text-2xl font-bold text-[#236383]">{monthCalendarSummary.days}</div>
                    <div className="text-xs font-medium text-gray-600">days with events</div>
                  </div>
                  <div className="rounded-lg bg-white border border-[#FBAD3F]/30 p-3">
                    <div className="text-2xl font-bold text-[#B45309]">{monthCalendarSummary.openings}</div>
                    <div className="text-xs font-medium text-gray-600">spots open</div>
                  </div>
                </div>
              </div>

              <CardContent className="p-4 sm:p-5 lg:p-6">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5">
                  <div className="space-y-3">
                    {/* Intro copy + legend — past events stay on the calendar
                        as faded context so volunteers can see the full month
                        at a glance, but only upcoming events read as
                        actionable. The legend names each visual state up
                        front so there's nothing to decode. */}
                    <div className="rounded-lg border border-[#236383]/15 bg-white px-3 py-3 space-y-2">
                      <p className="text-xs sm:text-sm text-gray-700 leading-snug">
                        This calendar shows both completed and upcoming events so you can see the full month at a glance. Teal-tinted days have open volunteer spots.
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] sm:text-xs">
                        {/* Cell-tint key. Each swatch is a tiny stand-in
                            for the calendar cell so the legend visually
                            mirrors the grid. The event-count badge was
                            removed (its number could be mistaken for the
                            date), so the legend now references only the
                            cell background. */}
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-3.5 h-3.5 rounded-sm bg-[#e6f4f5] border border-[#47B3CB]" aria-hidden="true" />
                          <span className="text-gray-700"><span className="font-semibold">Open spots</span> — sign up here</span>
                        </span>
                        <span className="text-gray-300" aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-3.5 h-3.5 rounded-sm bg-white border border-gray-300" aria-hidden="true" />
                          <span className="text-gray-700"><span className="font-semibold">Fully staffed</span></span>
                        </span>
                        <span className="text-gray-300" aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-3.5 h-3.5 rounded-sm bg-gray-50 border border-gray-200" aria-hidden="true" />
                          <span className="text-gray-700"><span className="font-semibold">Completed</span> — past event</span>
                        </span>
                        <span className="text-gray-300" aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-3.5 h-3.5 rounded-sm bg-white border-2 border-[#236383]" aria-hidden="true" />
                          <span className="text-gray-700"><span className="font-semibold">Today</span></span>
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1 sm:gap-2">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <div key={day} className="text-center text-[11px] md:text-xs lg:text-sm font-bold text-[#236383] py-2">
                          {day}
                        </div>
                      ))}

                      {paddedDays.map((day, idx) => {
                        if (!day) {
                          return <div key={`empty-${idx}`} className="min-h-[60px] sm:min-h-[76px] lg:min-h-[120px]" />;
                        }

                        const dateKey = format(day, 'yyyy-MM-dd');
                        const dayEvents = eventsByDate[dateKey] || [];
                        const roleOpenings = getTotalOpeningsForEvents(dayEvents);
                        const isToday = isSameDay(day, new Date());
                        const isPast = !isAfter(day, startOfDay(new Date())) && !isToday;
                        const isSelected = selectedCalendarDate === dateKey;
                        const hasEvents = dayEvents.length > 0;
                        const topRoles = dayEvents.flatMap(getRoleOpenings).slice(0, 3);

                        // Past days with events stay on the calendar as
                        // muted, read-only context. They're still clickable
                        // (opens the right panel for details) but their
                        // styling is intentionally lower-emphasis: gray bg,
                        // gray date number, no orange count badge, and a
                        // "Completed ✓" pill instead of "X spots open."
                        const isPastWithEvents = isPast && hasEvents;
                        // Days with at least one open volunteer slot get
                        // the at-a-glance "available" treatment: tinted
                        // cell background + stronger badge color. Fully-
                        // staffed days still show the badge but in gray
                        // so the visual signal is reserved for cells
                        // where help is actually needed.
                        const hasOpenSpots =
                          hasEvents && !isPastWithEvents && roleOpenings > 0;
                        // Hover preview — native title shows the event
                        // org names when you hover any day with events, so
                        // you don't have to click just to see what's there.
                        const hoverPreview = hasEvents
                          ? dayEvents
                              .slice(0, 4)
                              .map((e) => e.organizationName)
                              .join('\n') +
                            (dayEvents.length > 4
                              ? `\n+ ${dayEvents.length - 4} more`
                              : '')
                          : undefined;
                        return (
                          <button
                            key={dateKey}
                            type="button"
                            onClick={() => hasEvents && setSelectedCalendarDate(dateKey)}
                            disabled={!hasEvents}
                            title={hoverPreview}
                            aria-label={
                              hasEvents
                                ? isPastWithEvents
                                  ? `${format(day, 'MMM d')} — ${dayEvents.length} completed event${dayEvents.length === 1 ? '' : 's'}`
                                  : `${format(day, 'MMM d')} — ${dayEvents.length} upcoming event${dayEvents.length === 1 ? '' : 's'}`
                                : `${format(day, 'MMM d')} — no events`
                            }
                            className={cn(
                              'relative min-h-[60px] sm:min-h-[76px] lg:min-h-[120px] rounded-xl border p-2 text-left transition-all',
                              !hasEvents && 'bg-gray-50 border-gray-100 cursor-default',
                              hasEvents && !isPastWithEvents && !hasOpenSpots &&
                                // Upcoming + fully-staffed: white cell,
                                // neutral border. There's an event, but no
                                // volunteer action required.
                                'bg-white border-[#47B3CB]/35 hover:border-[#236383] hover:shadow-md cursor-pointer',
                              hasOpenSpots &&
                                // Upcoming + has open spots: tint the
                                // entire cell soft teal so available days
                                // visually pop out of the white grid.
                                'bg-[#e6f4f5] border-[#47B3CB] hover:border-[#236383] hover:shadow-md cursor-pointer',
                              isPastWithEvents &&
                                'bg-gray-50 border-gray-200 hover:border-gray-300 hover:shadow-sm cursor-pointer',
                              isSelected && 'ring-2 ring-[#FBAD3F] border-[#236383] shadow-md bg-[#FAF8F4]',
                              // Today gets a stronger emphasis: bold colored
                              // ring, brand-accent background tint, so the
                              // "what's happening right now" anchor is
                              // immediately findable in the grid.
                              isToday && !isSelected && 'ring-2 ring-[#236383] bg-gradient-to-b from-[#47B3CB]/10 to-white shadow-sm',
                            )}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span
                                className={cn(
                                  'inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold',
                                  isToday
                                    ? 'bg-[#236383] text-white'
                                    : isPastWithEvents
                                      ? 'text-gray-500'
                                      : hasEvents
                                        ? 'text-[#236383]'
                                        : 'text-gray-400',
                                )}
                              >
                                {format(day, 'd')}
                              </span>
                              {/* Event-count badge removed — having a
                                  second number in the cell (next to the
                                  date number) was read as part of the
                                  date. The body text below ("1 event" /
                                  "2 events") already carries the count
                                  unambiguously. */}
                            </div>

                            {hasEvents ? (
                              <div className="mt-2 space-y-1">
                                <div
                                  className={cn(
                                    'text-[11px] sm:text-sm font-bold leading-tight',
                                    isPastWithEvents ? 'text-gray-500' : 'text-[#236383]',
                                  )}
                                >
                                  {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
                                </div>
                                {isPastWithEvents ? (
                                  <div className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-gray-500">
                                    <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                    Completed
                                  </div>
                                ) : roleOpenings > 0 ? (
                                  // Staffing-status urgency indicator. When
                                  // roles are unfilled, the row reads as a
                                  // call to action with a warning icon and
                                  // amber tint — not a passive count.
                                  <div className="inline-flex items-center gap-1 rounded-full bg-[#FBAD3F]/15 px-2 py-0.5 text-[10px] sm:text-xs font-bold text-[#92400E]">
                                    <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                                    {roleOpenings} {roleOpenings === 1 ? 'role' : 'roles'} open
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-green-700 font-semibold">
                                    <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                    Fully staffed
                                  </div>
                                )}
                                {!isPastWithEvents && (
                                  <div className="hidden sm:flex flex-wrap gap-1 pt-1">
                                    {topRoles.map((role, roleIdx) => (
                                      <span
                                        key={`${role.singular}-${roleIdx}`}
                                        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
                                        style={{ backgroundColor: role.bg, color: role.color }}
                                        title={formatNeededRole(role)}
                                      >
                                        <role.Icon className="w-3 h-3" />
                                        {role.count > 1 && <span className="ml-0.5">{role.count}</span>}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="mt-2 text-[10px] sm:text-xs text-gray-400">No events</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {(() => {
                    // Right-panel context: is the selected day in the past?
                    // We short-circuit signup actions on past days and show a
                    // read-only "Event completed" treatment instead.
                    const selectedDateObj = selectedCalendarDate
                      ? parseEventDate(selectedCalendarDate)
                      : null;
                    const isSelectedPast =
                      !!selectedDateObj &&
                      !isAfter(selectedDateObj, startOfDay(new Date())) &&
                      !isSameDay(selectedDateObj, new Date());
                    return (
                  <div className="rounded-2xl border border-[#236383]/20 bg-[#FAF8F4] p-4 sm:p-5 lg:min-h-[360px]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-[#236383]">{selectedDateLabel}</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {selectedCalendarDate
                            ? selectedDateEvents.length > 0
                              ? isSelectedPast
                                ? `${selectedDateEvents.length} completed ${selectedDateEvents.length === 1 ? 'event' : 'events'}`
                                : `${selectedDateEvents.length} ${selectedDateEvents.length === 1 ? 'event' : 'events'} available`
                              : 'No events on this day'
                            : 'Select a day with a gold number.'}
                        </p>
                      </div>
                      {selectedDateEvents.length > 0 && (
                        isSelectedPast ? (
                          <Badge className="bg-gray-200 text-gray-700 border-transparent">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                            Completed
                          </Badge>
                        ) : (
                          <Badge className="bg-[#236383] text-white border-transparent">
                            {getTotalOpeningsForEvents(selectedDateEvents)} open
                          </Badge>
                        )
                      )}
                    </div>

                    <div className="mt-4 space-y-3">
                      {selectedDateEvents.length === 0 ? (
                        // Educational empty state. Rather than telling the
                        // user there's nothing here, use the space to walk
                        // them through how signing up actually works.
                        <div className="space-y-3">
                          <div className="rounded-xl bg-white border border-[#47B3CB]/30 p-5 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                              <Sparkles className="w-5 h-5 text-[#FBAD3F]" aria-hidden="true" />
                              <h4 className="font-bold text-[#236383]">How volunteering works</h4>
                            </div>
                            <ol className="space-y-2.5">
                              {[
                                { n: 1, title: 'Select a day', body: 'Click any day with a number on it to see what\'s happening.' },
                                { n: 2, title: 'Review event details', body: 'Check the location, time, and which roles are still open.' },
                                { n: 3, title: 'Choose a role', body: 'Driver or general volunteer — pick what fits you.' },
                                { n: 4, title: 'Submit your signup', body: 'Confirm and you\'re done. We\'ll send a reminder before the event.' },
                              ].map((step) => (
                                <li key={step.n} className="flex items-start gap-3">
                                  <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#236383] text-white text-xs font-bold">
                                    {step.n}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-[#236383] leading-tight">{step.title}</p>
                                    <p className="text-xs text-gray-600 mt-0.5 leading-snug">{step.body}</p>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </div>

                          <div className="rounded-xl bg-[#FAF8F4] border border-[#FBAD3F]/30 p-4">
                            <div className="flex items-start gap-2.5">
                              <HelpCircle className="w-5 h-5 text-[#B45309] mt-0.5 flex-shrink-0" aria-hidden="true" />
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-[#236383]">Need help?</p>
                                <p className="text-xs text-gray-700 mt-0.5 leading-snug">
                                  Reach out to the volunteer coordinator and we'll point you in the right direction.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        selectedDateEvents.map((event) => {
                          const roles = getRoleOpenings(event);
                          const existingSignup = getExistingSignup(event.id);
                          const existingUnavailable = getExistingUnavailable(event.id);

                          return (
                            <div key={event.id} className="rounded-xl bg-white border border-[#47B3CB]/25 shadow-sm overflow-hidden">
                              <div className="h-1 bg-gradient-to-r from-[#FBAD3F] via-[#47B3CB] to-[#236383]" />
                              <div className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h4 className="font-bold text-[#236383] leading-tight">{event.organizationName}</h4>
                                    {event.department && (
                                      <p className="text-sm text-gray-500 mt-0.5">{event.department}</p>
                                    )}
                                  </div>
                                </div>

                                <div className="grid gap-2 text-sm text-gray-700">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-[#236383] shrink-0" />
                                    <span>{formatEventTime(event.eventStartTime, event.eventEndTime)}</span>
                                  </div>
                                  {event.eventAddress && (
                                    <AddressLink
                                      location={event}
                                      className="text-gray-700"
                                      iconClassName="w-4 h-4 text-[#236383] shrink-0 mt-0.5"
                                    />
                                  )}
                                  {event.estimatedSandwichCount && (
                                    <div className="flex items-center gap-2">
                                      <Sandwich className="w-4 h-4 text-[#B45309] shrink-0" />
                                      <span>{event.estimatedSandwichCount.toLocaleString()} sandwiches</span>
                                    </div>
                                  )}
                                </div>

                                {isSelectedPast ? (
                                  <div className="flex flex-wrap gap-2">
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-600 px-3 py-1.5 text-xs font-bold">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      Completed
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {roles.length > 0 ? roles.map((role) => (
                                      <span
                                        key={role.singular}
                                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
                                        style={{ backgroundColor: role.bg, color: role.color }}
                                      >
                                        <role.Icon className="w-3.5 h-3.5" />
                                        {formatNeededRole(role)}
                                      </span>
                                    )) : (
                                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 text-green-700 px-3 py-1.5 text-xs font-bold">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        Extra help welcome
                                      </span>
                                    )}
                                  </div>
                                )}

                                {isSelectedPast ? (
                                  <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-3 text-sm text-gray-700">
                                    <p className="font-semibold text-gray-800">Event completed</p>
                                    <p className="text-xs text-gray-600 mt-0.5">
                                      This event has already taken place.
                                    </p>
                                  </div>
                                ) : existingSignup ? (
                                  <div className="rounded-lg bg-[#47B3CB]/10 border border-[#47B3CB]/30 px-3 py-2 text-sm font-semibold text-[#236383] flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-2">
                                      <Check className="w-4 h-4" />
                                      You signed up
                                    </span>
                                    <StatusBadge status={existingSignup.status} />
                                  </div>
                                ) : existingUnavailable ? (
                                  <div className="space-y-2 rounded-lg border border-[#A31C41]/25 bg-[#A31C41]/5 px-3 py-2">
                                    <div className="flex items-start gap-2 text-sm text-[#A31C41]">
                                      <Ban className="w-4 h-4 mt-0.5 shrink-0" />
                                      <div className="min-w-0">
                                        <p className="font-semibold">You marked this event not available</p>
                                        {existingUnavailable.notes && (
                                          <p className="mt-1 text-xs text-gray-600 whitespace-pre-line">{existingUnavailable.notes}</p>
                                        )}
                                      </div>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <Button
                                        variant="outline"
                                        className="border-[#A31C41]/30 text-[#A31C41] hover:bg-[#A31C41]/10"
                                        onClick={() => handleUnavailableClick(event.id)}
                                      >
                                        Update Note
                                      </Button>
                                      <Button
                                        variant="outline"
                                        className="border-[#236383]/30 text-[#236383] hover:bg-[#236383]/10"
                                        onClick={() => handleClearUnavailable(event.id)}
                                      >
                                        Available Again
                                      </Button>
                                      {canAssignOthers && (
                                        <Button
                                          variant="outline"
                                          className="border-[#236383]/30 text-[#236383] hover:bg-[#236383]/5 sm:col-span-2"
                                          onClick={() => handleAssignClick(event.id)}
                                        >
                                          <Users className="w-4 h-4 mr-2" />
                                          Assign Someone
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    {canSelfSignup ? (
                                      <Button
                                        className="bg-[#236383] hover:bg-[#236383] text-white"
                                        onClick={() => handleSignupClick(event.id)}
                                      >
                                        <HandHeart className="w-4 h-4 mr-2" />
                                        Sign Up
                                      </Button>
                                    ) : (
                                      <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 text-center">
                                        Ask a coordinator to sign you up.
                                      </div>
                                    )}
                                    <Button
                                      variant="outline"
                                      className="border-[#A31C41]/30 text-[#A31C41] hover:bg-[#A31C41]/10"
                                      onClick={() => handleUnavailableClick(event.id)}
                                    >
                                      <Ban className="w-4 h-4 mr-2" />
                                      I'm Not Available
                                    </Button>
                                    {canAssignOthers && (
                                      <Button
                                        variant="outline"
                                        className="border-[#236383]/30 text-[#236383] hover:bg-[#236383]/5 sm:col-span-2"
                                        onClick={() => handleAssignClick(event.id)}
                                      >
                                        <Users className="w-4 h-4 mr-2" />
                                        Assign Someone
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  );
                  })()}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Map View */}
          <TabsContent value="map" className="mt-0">
            <Card>
              <CardContent className="p-0">
                {/* Address search for distance */}
                <div className="p-4 border-b space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2">
                      <Navigation className="w-4 h-4 text-[#236383] shrink-0" />
                      <span className="text-sm font-medium text-gray-700">Your location:</span>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Input
                        placeholder="Enter your address to see distances..."
                        value={userAddress}
                        onChange={(e) => setUserAddress(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleGeocodeAddress()}
                        className="min-w-0 flex-1 text-sm sm:min-w-[180px]"
                      />
                      <Button
                        size="sm"
                        onClick={handleGeocodeAddress}
                        disabled={geocodingLoading || !userAddress.trim()}
                        className="shrink-0 bg-[#236383] hover:bg-[#236383]"
                      >
                        {geocodingLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleUseBrowserLocation}
                        disabled={browserLocationLoading}
                        className="shrink-0 gap-1.5 border-[#236383]/30 text-xs text-[#236383] hover:bg-[#236383]/10"
                      >
                        {browserLocationLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <LocateFixed className="w-3.5 h-3.5" />
                        )}
                        Use my current location
                      </Button>
                      {userLocation && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setUserLocation(null); setUserAddress(''); }}
                          className="shrink-0 text-xs"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground sm:ml-6">
                    Your browser will ask for permission before sharing your location.
                  </p>
                  {userLocation && (
                    <p className="text-xs text-green-600 sm:ml-6">
                      <Check className="w-3 h-3 inline mr-1" />
                      Location set — distances shown in event popups
                    </p>
                  )}
                </div>

                {/* Date range info */}
                <div className="px-4 py-2 border-b bg-gray-50 text-sm text-gray-600">
                  <Calendar className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5 text-[#236383]" />
                  Showing <span className="font-semibold text-[#236383]">{filteredEvents.length}</span> scheduled events from today onward that need volunteers or drivers
                </div>

                <div className="h-[520px] overflow-hidden rounded-lg sm:h-[600px]">
                  <MapContainer
                    center={userLocation ? [userLocation.lat, userLocation.lng] : mapCenter}
                    zoom={11}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <BaseMapTiles />
                    <MapCenterSetter center={userLocation ? [userLocation.lat, userLocation.lng] : mapCenter} />

                    {/* User location marker */}
                    {userLocation && (
                      <Marker
                        position={[userLocation.lat, userLocation.lng]}
                        icon={createUserLocationIcon()}
                      >
                        <Popup>
                          <div className="text-sm font-medium">Your Location</div>
                          <div className="text-xs text-muted-foreground">{userAddress}</div>
                        </Popup>
                      </Marker>
                    )}

                    {filteredEvents
                      .filter(e => e.latitude && e.longitude)
                      .map(event => (
                        <Marker
                          key={event.id}
                          position={[parseFloat(event.latitude!), parseFloat(event.longitude!)]}
                          icon={createEventIcon(
                            event.volunteersUnfilled > 0,
                            event.driversUnfilled > 0,
                            event.status === 'completed',
                            event.vanDriverNeeded
                          )}
                        >
                          <Tooltip
                            permanent
                            direction="top"
                            offset={[0, -44]}
                            opacity={1}
                            className="volunteer-map-event-label"
                          >
                            <div className="max-w-[150px]">
                              <div className="truncate font-semibold">{event.organizationName}</div>
                              <div className="text-[11px] font-medium text-[#236383]">
                                {getEventDateLabel(event)}
                              </div>
                            </div>
                          </Tooltip>
                          <Popup minWidth={260} maxWidth={360} className="volunteer-map-event-popup">
                            <MapEventPopupContent
                              event={event}
                              onSignupClick={handleSignupClick}
                              onUnavailableClick={handleUnavailableClick}
                              onClearUnavailable={handleClearUnavailable}
                              canSelfSignup={canSelfSignup}
                              canAssignOthers={canAssignOthers}
                              onAssignClick={handleAssignClick}
                              userLocation={userLocation}
                              existingSignup={getExistingSignup(event.id)}
                              existingUnavailable={getExistingUnavailable(event.id)}
                            />
                          </Popup>
                        </Marker>
                      ))}
                  </MapContainer>
                </div>

                {/* Map Legend */}
                <div className="p-4 border-t flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full bg-[#236383]" />
                    <span>Needs help</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full bg-gray-400" />
                    <span>Filled or completed</span>
                  </div>
                  {userLocation && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow" />
                      <span>Your location</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* List View */}
          <TabsContent value="list" className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredEvents.length === 0 ? (
                <Card className="col-span-full">
                  <CardContent className="py-12 text-center">
                    <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium">No Events Found</h3>
                    <p className="text-muted-foreground mt-1">
                      {showOnlyNeeds
                        ? 'All current events are fully staffed!'
                        : 'No upcoming events match your filters.'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                filteredEvents.map(event => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onSignup={handleSignupClick}
                    onUnavailable={handleUnavailableClick}
                    onClearUnavailable={handleClearUnavailable}
                    onAssign={canAssignOthers ? handleAssignClick : undefined}
                    canSelfSignup={canSelfSignup}
                    canAssignOthers={canAssignOthers}
                    existingSignup={getExistingSignup(event.id)}
                    existingUnavailable={getExistingUnavailable(event.id)}
                  />
                ))
              )}
            </div>
          </TabsContent>

          {/* My Signups View */}
          <TabsContent value="my_signups" className="mt-0">
            {mySignups.length === 0 && myUnavailable.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <HandHeart className="w-12 h-12 mx-auto text-[#236383] mb-4" />
                  <h3 className="text-lg font-medium">You haven't signed up yet — that's okay!</h3>
                  <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                    Every sandwich helps. Browse upcoming events to find one that fits your schedule.
                  </p>
                  <Button
                    className="mt-4 bg-[#236383] hover:bg-[#236383]"
                    onClick={() => setView('list')}
                  >
                    Browse Events
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {mySignups.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      No active signups right now.
                    </CardContent>
                  </Card>
                ) : (() => {
              const filteredSignups = mySignupsRoleFilter === 'all'
                ? mySignups
                : mySignups.filter(s => s.role === mySignupsRoleFilter);
              return (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <Select value={mySignupsRoleFilter} onValueChange={setMySignupsRoleFilter}>
                    <SelectTrigger className="w-full sm:w-[160px]">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="general">General Volunteer</SelectItem>
                      <SelectItem value="driver">Driver</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {filteredSignups.length} of {mySignups.length}
                  </span>
                </div>
                {filteredSignups.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      No signups in this role.
                    </CardContent>
                  </Card>
                ) : (
                filteredSignups.map(signup => {
                  const signupDate = getEffectiveEventDate(signup.event);
                  const formattedSignupDate = signupDate
                    ? format(parseEventDate(signupDate)!, 'EEEE, MMMM d, yyyy')
                    : 'Date TBD';

                  return (
                    <Card key={signup.id} className="border-l-4 border-l-[#47b3cb] hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex-1 min-w-0 space-y-2">
                            <div>
                              <h3 className="font-semibold text-base">{signup.event.organizationName}</h3>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                <Calendar className="w-4 h-4 shrink-0 text-[#236383]" />
                                <span>
                                  {formattedSignupDate}
                                  {' · '}{formatEventTime(signup.event.eventStartTime)}
                                </span>
                              </div>
                              {signup.event.eventAddress && (
                                <AddressLink
                                  location={signup.event}
                                  className="mt-1"
                                  iconClassName="w-4 h-4 shrink-0 mt-0.5 text-[#236383]"
                                />
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>Signed up {format(parseISO(signup.signedUpAt), 'MMM d, yyyy')}</span>
                              {signup.notes && <span>— {signup.notes}</span>}
                            </div>
                            {(() => {
                              const roleInstructions = signup.role === 'driver'
                                ? signup.event.driverInstructions
                                : signup.role === 'speaker'
                                  ? signup.event.speakerInstructions
                                  : signup.event.volunteerInstructions;
                              if (!roleInstructions || !roleInstructions.trim()) return null;
                              return (
                                <div className="rounded-md border border-[#FBAD3F]/30 bg-[#FFF7E6] px-3 py-2 text-xs text-[#236383] whitespace-pre-line">
                                  <span className="font-semibold">What to expect:</span> {roleInstructions}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end sm:shrink-0">
                            <RoleBadge role={signup.role} />
                            <StatusBadge status={signup.status} />
                            {signup.status === 'pending' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => cancelSignupMutation.mutate(signup.id)}
                                disabled={cancelSignupMutation.isPending}
                              >
                                <X className="w-3 h-3 mr-1" />
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
                )}
              </div>
              );
                })()}

                {myUnavailable.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-[#236383]">Events You Marked Not Available</h3>
                      <p className="text-xs text-gray-500">{myUnavailable.length} event{myUnavailable.length !== 1 ? 's' : ''}</p>
                    </div>
                    {myUnavailable.map((unavailable) => {
                      const unavailableDate = getEffectiveEventDate(unavailable.event);
                      const formattedUnavailableDate = unavailableDate
                        ? format(parseEventDate(unavailableDate)!, 'EEEE, MMMM d, yyyy')
                        : 'Date TBD';

                      return (
                        <Card key={unavailable.id} className="border-l-4 border-l-[#A31C41] hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex-1 min-w-0 space-y-2">
                                <div>
                                  <h3 className="font-semibold text-base">{unavailable.event.organizationName}</h3>
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                    <Calendar className="w-4 h-4 shrink-0 text-[#A31C41]" />
                                    <span>
                                      {formattedUnavailableDate}
                                      {' · '}{formatEventTime(unavailable.event.eventStartTime, unavailable.event.eventEndTime)}
                                    </span>
                                  </div>
                                  {unavailable.event.eventAddress && (
                                    <AddressLink
                                      location={unavailable.event}
                                      className="mt-1"
                                      iconClassName="w-4 h-4 shrink-0 mt-0.5 text-[#A31C41]"
                                    />
                                  )}
                                </div>
                                {unavailable.notes && (
                                  <p className="text-sm text-gray-600 italic bg-[#A31C41]/5 px-3 py-1.5 rounded-md">"{unavailable.notes}"</p>
                                )}
                                <div className="text-xs text-gray-400">
                                  Updated {format(parseISO(unavailable.updatedAt), 'MMM d, yyyy')}
                                </div>
                              </div>
                              <div className="grid gap-2 sm:flex sm:flex-col sm:items-end sm:shrink-0">
                                <Badge variant="outline" className="bg-[#A31C41]/10 text-[#A31C41] border-[#A31C41]/30 gap-1">
                                  <Ban className="w-3 h-3" />
                                  Not Available
                                </Badge>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-[#A31C41] border-[#A31C41]/30 hover:bg-[#A31C41]/10"
                                  onClick={() => handleUnavailableClick(unavailable.eventRequestId)}
                                >
                                  Update Note
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-[#236383] border-[#236383]/30 hover:bg-[#236383]/10"
                                  onClick={() => handleClearUnavailable(unavailable.eventRequestId)}
                                  disabled={clearUnavailableMutation.isPending}
                                >
                                  Available Again
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* Pending Approvals View */}
          <TabsContent value="pending_approvals" className="mt-0">
            {pendingSignups.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Check className="w-12 h-12 text-green-400 mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">All caught up!</h3>
                  <p className="text-sm text-gray-500">No signups waiting for approval.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">{pendingSignups.length} signup{pendingSignups.length !== 1 ? 's' : ''} awaiting approval</p>
                {pendingSignups.map((signup: any) => {
                  const eventDate = getEffectiveEventDate(signup.event);
                  return (
                    <Card key={signup.id} className="border border-gray-200 hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{signup.volunteerName || 'Unknown'}</span>
                              <RoleBadge role={signup.role} />
                              <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                                <Clock className="w-3 h-3 mr-1" />Pending
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                              {signup.volunteerEmail && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5" />
                                  {signup.volunteerEmail}
                                </span>
                              )}
                              {signup.volunteerPhone && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" />
                                  {signup.volunteerPhone}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 px-3 py-1.5 rounded-md">
                              <Building2 className="w-3.5 h-3.5 text-[#236383] shrink-0" />
                              <span className="font-medium">{signup.event?.organizationName || 'Unknown Event'}</span>
                              {eventDate && (
                                <>
                                  <span className="text-gray-400">|</span>
                                  <Calendar className="w-3.5 h-3.5 text-[#236383]" />
                                  <span>{format(parseEventDate(eventDate)!, 'MMM d, yyyy')}</span>
                                  <span>· {formatEventTime(signup.event?.eventStartTime)}</span>
                                </>
                              )}
                            </div>
                            {signup.notes && (
                              <p className="text-sm text-gray-600 italic bg-amber-50 px-3 py-1.5 rounded-md">"{signup.notes}"</p>
                            )}
                            <div className="text-xs text-gray-400">
                              Signed up {format(parseISO(signup.signedUpAt), 'MMM d, yyyy h:mm a')}
                            </div>
                          </div>
                          <div className="grid gap-2 sm:flex sm:flex-col sm:shrink-0">
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => updateSignupStatusMutation.mutate({ signupId: signup.id, status: 'assigned' })}
                              disabled={updateSignupStatusMutation.isPending}
                            >
                              <Check className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-300 text-red-600 hover:bg-red-50"
                              onClick={() => updateSignupStatusMutation.mutate({ signupId: signup.id, status: 'declined' })}
                              disabled={updateSignupStatusMutation.isPending}
                            >
                              <X className="w-4 h-4 mr-1" />
                              Decline
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Approved / Declined signups management list */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-[#236383]">Approved &amp; Declined Signups</h3>
                <p className="text-xs text-gray-500">{allSignups.filter((s: any) => s.status !== 'pending').length} total</p>
              </div>
              {(() => {
                const managed = allSignups.filter((s: any) => s.status !== 'pending');
                if (managed.length === 0) {
                  return (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                        <p className="text-sm text-gray-500">No approved or declined signups yet.</p>
                      </CardContent>
                    </Card>
                  );
                }
                return (
                  <div className="space-y-2">
                    {managed.map((signup: any) => {
                      const eventDate = getEffectiveEventDate(signup.event);
                      const isApproved = signup.status === 'confirmed' || signup.status === 'assigned';
                      const isDeclined = signup.status === 'declined';
                      const vanNeeded = !!signup.event?.vanDriverNeeded;
                      const driverConflict = isApproved && signup.role === 'driver' && vanNeeded;
                      return (
                        <Card
                          key={signup.id}
                          className={cn(
                            'border transition-shadow hover:shadow-sm',
                            isApproved ? 'border-[#47B3CB]/40' : 'border-gray-200',
                            driverConflict && 'border-[#A31C41]/60 bg-[#A31C41]/5'
                          )}
                        >
                          <CardContent className="p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-gray-900 truncate">{signup.volunteerName || 'Unknown'}</span>
                                  <RoleBadge role={signup.role} />
                                  {isApproved && (
                                    <Badge className="bg-[#47B3CB] text-white border-transparent">
                                      <Check className="w-3 h-3 mr-1" />Approved
                                    </Badge>
                                  )}
                                  {isDeclined && (
                                    <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-300">
                                      Declined
                                    </Badge>
                                  )}
                                  {driverConflict && (
                                    <Badge className="bg-[#A31C41] text-white border-transparent">
                                      <AlertCircle className="w-3 h-3 mr-1" />Van Needed — Driver Conflict
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 rounded bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
                                  <Building2 className="w-3.5 h-3.5 text-[#236383] shrink-0" />
                                  <span className="font-medium truncate">{signup.event?.organizationName || 'Unknown Event'}</span>
                                  {eventDate && (
                                    <>
                                      <span className="text-gray-400">|</span>
                                      <Calendar className="w-3.5 h-3.5 text-[#236383]" />
                                      <span>{format(parseEventDate(eventDate)!, 'MMM d, yyyy')}</span>
                                      {signup.event?.eventStartTime && (
                                        <span className="text-gray-500">· {formatEventTime(signup.event.eventStartTime)}</span>
                                      )}
                                    </>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                                  {signup.volunteerEmail && <span>{signup.volunteerEmail}</span>}
                                  {signup.volunteerPhone && <span>{signup.volunteerPhone}</span>}
                                </div>
                              </div>
                              {isApproved && (
                                <div className="grid gap-1.5 sm:flex sm:flex-col sm:shrink-0">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-[#FBAD3F] text-[#a07227] hover:bg-[#FBAD3F]/10 h-7 px-2 text-xs"
                                    onClick={() => {
                                      setManageSignup(signup);
                                      setManageMode('change_role');
                                      setManageDialogOpen(true);
                                    }}
                                  >
                                    Change Role
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-[#A31C41] text-[#A31C41] hover:bg-[#A31C41]/10 h-7 px-2 text-xs"
                                    onClick={() => {
                                      setManageSignup(signup);
                                      setManageMode('remove');
                                      setManageDialogOpen(true);
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              )}
                              {isDeclined && (
                                <div className="grid gap-1.5 sm:flex sm:flex-col sm:shrink-0">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-green-500 text-green-700 hover:bg-green-50 h-7 px-2 text-xs"
                                    onClick={() => updateSignupStatusMutation.mutate({ signupId: signup.id, status: 'assigned' })}
                                    disabled={updateSignupStatusMutation.isPending}
                                  >
                                    Re-approve
                                  </Button>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </TabsContent>

          {/* Event Coverage View */}
          <TabsContent value="coverage" className="mt-0">
            {coverageLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-[#236383]/20 bg-[#236383]/5 p-3">
                    <p className="text-2xl font-bold text-[#236383]">{coverageMetrics.events}</p>
                    <p className="text-sm font-medium text-[#236383]">Upcoming Events</p>
                  </div>
                  <div className="rounded-lg border border-[#FBAD3F]/30 bg-[#FFF7E6] p-3">
                    <p className="text-2xl font-bold text-[#B45309]">{coverageMetrics.eventsNeedingHelp}</p>
                    <p className="text-sm font-medium text-[#B45309]">Need Help</p>
                  </div>
                  <div className="rounded-lg border border-[#A31C41]/20 bg-[#A31C41]/5 p-3">
                    <p className="text-2xl font-bold text-[#A31C41]">{coverageMetrics.openRoles}</p>
                    <p className="text-sm font-medium text-[#A31C41]">Open Slots</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-2xl font-bold text-gray-700">{coverageMetrics.unavailableResponses}</p>
                    <p className="text-sm font-medium text-gray-700">No Responses</p>
                  </div>
                </div>

                {coverageSummary.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                      <Eye className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium">No upcoming hub events</h3>
                      <p className="text-muted-foreground mt-1">Coverage will appear here once events are visible in the Volunteer Hub.</p>
                    </CardContent>
                  </Card>
                ) : (
                  coverageSummary.map((event) => {
                    const eventDate = getEffectiveEventDate(event);
                    const formattedEventDate = eventDate
                      ? format(parseEventDate(eventDate)!, 'EEEE, MMMM d, yyyy')
                      : 'Date TBD';
                    const activeSignups = event.signups.filter((signup) => signup.status === 'pending' || signup.status === 'confirmed' || signup.status === 'assigned');
                    const declinedSignups = event.signups.filter((signup) => signup.status === 'declined');

                    return (
                      <Card key={event.id} className="border border-gray-200 shadow-sm">
                        <CardContent className="p-4 space-y-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 space-y-1">
                              <h3 className="text-lg font-semibold text-[#236383]">{event.organizationName}</h3>
                              {event.department && <p className="text-sm text-gray-500">{event.department}</p>}
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                                <span className="inline-flex items-center gap-1.5">
                                  <Calendar className="w-4 h-4 text-[#236383]" />
                                  {formattedEventDate}
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                  <Clock className="w-4 h-4 text-[#236383]" />
                                  {formatEventTime(event.eventStartTime, event.eventEndTime)}
                                </span>
                              </div>
                              {event.eventAddress && (
                                <AddressLink
                                  location={event}
                                  className="mt-1"
                                  iconClassName="w-4 h-4 shrink-0 mt-0.5 text-[#236383]"
                                />
                              )}
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                'w-fit',
                                event.roles.some((role) => role.unfilled > 0)
                                  ? 'bg-[#FFF7E6] text-[#B45309] border-[#FBAD3F]/40'
                                  : 'bg-green-50 text-green-700 border-green-200'
                              )}
                            >
                              {event.roles.some((role) => role.unfilled > 0) ? 'Needs Help' : 'Covered'}
                            </Badge>
                          </div>

                          <div className="grid gap-2 md:grid-cols-4">
                            {event.roles.filter((role) => role.needed > 0 || role.assigned > 0 || role.unfilled > 0).map((role) => (
                              <div key={role.role} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-gray-800">{role.label}</p>
                                  <Badge
                                    variant="outline"
                                    className={role.unfilled > 0 ? 'bg-[#A31C41]/10 text-[#A31C41] border-[#A31C41]/25' : 'bg-green-50 text-green-700 border-green-200'}
                                  >
                                    {role.unfilled > 0 ? `${role.unfilled} open` : 'Filled'}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                  {role.assigned} filled of {role.needed}
                                </p>
                              </div>
                            ))}
                          </div>

                          <div className="grid gap-4 lg:grid-cols-3">
                            <div className="space-y-2">
                              <h4 className="text-sm font-semibold text-[#236383]">Signed Up or Assigned</h4>
                              {activeSignups.length === 0 ? (
                                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-500">No active signups yet.</p>
                              ) : (
                                <div className="space-y-2">
                                  {activeSignups.map((signup) => (
                                    <div key={signup.id} className="rounded-md border border-[#47B3CB]/25 bg-[#47B3CB]/5 px-3 py-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold text-gray-900">{signup.volunteerName || 'Unknown'}</span>
                                        <RoleBadge role={signup.role} />
                                        <StatusBadge status={signup.status} />
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-500">
                                        {signup.volunteerEmail && <span>{signup.volunteerEmail}</span>}
                                        {signup.volunteerPhone && <span>{signup.volunteerPhone}</span>}
                                      </div>
                                      {signup.notes && <p className="mt-1 text-xs text-gray-600 italic">"{signup.notes}"</p>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="space-y-2">
                              <h4 className="text-sm font-semibold text-gray-700">Declined Signups</h4>
                              {declinedSignups.length === 0 ? (
                                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-500">No declined signup records.</p>
                              ) : (
                                <div className="space-y-2">
                                  {declinedSignups.map((signup) => (
                                    <div key={signup.id} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold text-gray-900">{signup.volunteerName || 'Unknown'}</span>
                                        <RoleBadge role={signup.role} />
                                        <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-300">Declined</Badge>
                                      </div>
                                      {signup.notes && <p className="mt-1 text-xs text-gray-600 italic">"{signup.notes}"</p>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="space-y-2">
                              <h4 className="text-sm font-semibold text-[#A31C41]">Marked Not Available</h4>
                              {event.unavailable.length === 0 ? (
                                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-500">No one has said no yet.</p>
                              ) : (
                                <div className="space-y-2">
                                  {event.unavailable.map((unavailable) => (
                                    <div key={unavailable.id} className="rounded-md border border-[#A31C41]/20 bg-[#A31C41]/5 px-3 py-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Ban className="w-4 h-4 text-[#A31C41]" />
                                        <span className="text-sm font-semibold text-gray-900">{unavailable.volunteerName || 'Unknown'}</span>
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-500">
                                        {unavailable.volunteerEmail && <span>{unavailable.volunteerEmail}</span>}
                                        {unavailable.volunteerPhone && <span>{unavailable.volunteerPhone}</span>}
                                      </div>
                                      {unavailable.notes && <p className="mt-1 text-xs text-gray-600 italic">"{unavailable.notes}"</p>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Signup Dialog */}
        <SignupDialog
          event={selectedEvent}
          open={signupDialogOpen}
          onOpenChange={setSignupDialogOpen}
          onSubmit={handleSignupSubmit}
          isSubmitting={signupMutation.isPending}
          preselectedRole={preselectedSignupRole}
          userCapabilities={user as UserRoleCapabilities | null}
        />

        {/* "You're in!" confirmation shown right after a successful signup */}
        <SignupSuccessDialog
          event={signupConfirmation?.event ?? null}
          roles={signupConfirmation?.roles ?? []}
          open={signupConfirmation !== null}
          onOpenChange={(isOpen) => {
            if (!isOpen) setSignupConfirmation(null);
          }}
        />

        <UnavailableDialog
          event={selectedEvent}
          existingUnavailable={selectedEvent ? getExistingUnavailable(selectedEvent.id) : undefined}
          open={unavailableDialogOpen}
          onOpenChange={setUnavailableDialogOpen}
          onSubmit={handleUnavailableSubmit}
          isSubmitting={unavailableMutation.isPending}
        />

        {/* Manage signup dialog (change role / remove) */}
        <ManageSignupDialog
          signup={manageSignup}
          mode={manageMode}
          open={manageDialogOpen}
          onOpenChange={(open) => {
            setManageDialogOpen(open);
            if (!open) {
              setManageSignup(null);
              setManageMode(null);
            }
          }}
          onChangeRole={(signupId, role, reason) => {
            changeRoleMutation.mutate(
              { signupId, role, reason },
              {
                onSuccess: () => {
                  setManageDialogOpen(false);
                  setManageSignup(null);
                  setManageMode(null);
                },
              }
            );
          }}
          onRemove={(signupId, reason) => {
            removeSignupMutation.mutate(
              { signupId, reason },
              {
                onSuccess: () => {
                  setManageDialogOpen(false);
                  setManageSignup(null);
                  setManageMode(null);
                },
              }
            );
          }}
          isSubmitting={changeRoleMutation.isPending || removeSignupMutation.isPending}
        />

        {/* Assign Others Dialog - only opened when a coordinator clicks "Assign Someone" */}
        {canAssignOthers && (
          <AssignOthersDialog
            event={selectedEvent}
            open={assignDialogOpen}
            onOpenChange={setAssignDialogOpen}
            onSubmit={handleAssignSubmit}
            isSubmitting={assignOthersMutation.isPending}
          />
        )}

    </div>
  );
}
