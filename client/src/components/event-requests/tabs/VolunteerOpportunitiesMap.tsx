import React, { useMemo } from 'react';
import { MapContainer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css';
import { MapPin, Calendar, Package, User, Phone, Mail, Mic, UserCheck, Truck } from 'lucide-react';
import { format } from 'date-fns';
import type { EventRequest } from '@shared/schema';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { BaseMapTiles } from '@/components/maps/BaseMapTiles';

// Marker color constants
const COLORS = {
  volunteer: '#10B981',  // Volunteer needed - green
  driver: '#8B5CF6',     // Regular driver needed - purple
  vanDriver: '#F59E0B',  // Van driver needed - amber/orange
} as const;

// Fix Leaflet default marker icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface VolunteerOpportunitiesMapProps {
  events: EventRequest[];
  onEventClick?: (event: EventRequest) => void;
}

// Helper function to parse date strings as local dates
const parseLocalDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('T')[0].split('-').map(Number);
  return new Date(year, month - 1, day);
};

// Map bounds component to auto-fit map to markers
function MapBounds({ events }: { events: EventRequest[] }) {
  const map = useMap();

  React.useEffect(() => {
    if (events.length === 0) return;

    const bounds = L.latLngBounds(
      events.map(event => [
        parseFloat(event.latitude || '0'),
        parseFloat(event.longitude || '0')
      ] as [number, number])
    );

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [events, map]);

  return null;
}

// Custom cluster icon
const createClusterCustomIcon = (cluster: any) => {
  const count = cluster.getChildCount();
  return L.divIcon({
    html: `<div style="background-color: #236383; color: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${count}</div>`,
    className: 'custom-cluster-icon',
    iconSize: L.point(40, 40, true),
  });
};

// Helper to compute unfilled needs for an event
function getEventNeeds(event: EventRequest) {
  const volunteersNeeded = (event.volunteersNeeded ?? 0) > 0;
  const volunteerNotAssigned = !event.volunteerId || event.volunteerId === null || event.volunteerId === '';
  const needsVolunteer = volunteersNeeded && volunteerNotAssigned;

  const driversNeededCount = event.driversNeeded ?? 0;
  const driversAssignedCount = (event.assignedDriverIds?.length || 0) + (event.assignedVanDriverId ? 1 : 0) + (event.isDhlVan ? 1 : 0);
  const needsDriver = driversNeededCount > driversAssignedCount;

  const needsVanDriver = !!(event.vanDriverNeeded && !event.assignedVanDriverId && !event.isDhlVan);

  return { needsVolunteer, needsDriver, needsVanDriver };
}

// Popup content for volunteer opportunities
const VolunteerOpportunityPopup = ({ event, onEventClick }: { event: EventRequest; onEventClick?: (event: EventRequest) => void }) => {
  const { needsVolunteer, needsDriver, needsVanDriver } = getEventNeeds(event);

  const getEventDate = (evt: EventRequest) => {
    const date = getEffectiveEventDate(evt);
    return date ? format(parseLocalDate(date), 'MMM dd, yyyy') : 'No date set';
  };

  return (
    <div className="p-3 min-w-[280px] max-w-[320px]">
      <h3 className="font-semibold text-lg mb-1 text-gray-900">
        {event.organizationName || 'Unknown Organization'}
      </h3>
      {event.department && (
        <p className="text-sm text-gray-600 mb-2">{event.department}</p>
      )}

      {/* Role badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        {needsVolunteer && (
          <Badge className="bg-green-600 text-white text-xs">Volunteer Needed</Badge>
        )}
        {needsVanDriver && (
          <Badge style={{ backgroundColor: COLORS.vanDriver }} className="text-white text-xs font-semibold">
            Van Driver Needed
          </Badge>
        )}
        {needsDriver && !needsVanDriver && (
          <Badge style={{ backgroundColor: COLORS.driver }} className="text-white text-xs">Driver Needed</Badge>
        )}
      </div>

      <div className="space-y-1.5 text-sm mb-3">
        {(event.firstName || event.lastName) && (
          <div className="flex items-center gap-2">
            <User className="w-3 h-3 text-gray-500 flex-shrink-0" />
            <span className="text-gray-700">
              {[event.firstName, event.lastName].filter(Boolean).join(' ')}
            </span>
          </div>
        )}

        {event.email && (
          <div className="flex items-center gap-2">
            <Mail className="w-3 h-3 text-gray-500 flex-shrink-0" />
            <span className="text-gray-700 text-xs truncate">{event.email}</span>
          </div>
        )}

        {event.phone && (
          <div className="flex items-center gap-2">
            <Phone className="w-3 h-3 text-gray-500 flex-shrink-0" />
            <span className="text-gray-700">{event.phone}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Calendar className="w-3 h-3 text-gray-500 flex-shrink-0" />
          <span className="text-base text-gray-800 font-medium">{getEventDate(event)}</span>
        </div>

        {event.estimatedSandwichCount && (
          <div className="flex items-center gap-2">
            <Package className="w-3 h-3 text-gray-500 flex-shrink-0" />
            <span className="text-base text-gray-800 font-medium">
              ~{event.estimatedSandwichCount} sandwiches
            </span>
          </div>
        )}

        {event.eventAddress && (
          <div className="flex items-center gap-2">
            <MapPin className="w-3 h-3 text-gray-500 flex-shrink-0" />
            <span className="text-xs text-gray-600 line-clamp-2">{event.eventAddress}</span>
          </div>
        )}
      </div>

      {onEventClick && (
        <button
          onClick={() => onEventClick(event)}
          className="w-full mt-2 px-3 py-2 bg-tsp-teal text-white rounded hover:bg-brand-primary-dark transition-colors text-sm font-medium"
        >
          View Details
        </button>
      )}
    </div>
  );
};

// Custom marker component
function EventMarker({
  event,
  onEventClick
}: {
  event: EventRequest;
  onEventClick?: (event: EventRequest) => void;
}) {
  const { needsVolunteer, needsDriver, needsVanDriver } = getEventNeeds(event);

  // Priority-based marker color: van driver (amber) > driver (purple) > volunteer (green)
  let markerColor: string;
  let markerLabel: string;

  if (needsVanDriver) {
    markerColor = COLORS.vanDriver;
    markerLabel = '🚐';
  } else if (needsDriver) {
    markerColor = COLORS.driver;
    markerLabel = 'D';
  } else {
    markerColor = COLORS.volunteer;
    markerLabel = 'V';
  }

  const customIcon = L.divIcon({
    html: `<div style="background-color: ${markerColor}; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
      <div style="transform: rotate(45deg); color: white; font-size: ${markerLabel.length > 2 ? '11' : '16'}px; line-height: 24px; text-align: center; font-weight: bold;">${markerLabel}</div>
    </div>`,
    className: 'custom-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });

  return (
    <Marker
      position={[parseFloat(event.latitude || '0'), parseFloat(event.longitude || '0')]}
      icon={customIcon}
    >
      <Popup>
        <VolunteerOpportunityPopup event={event} onEventClick={onEventClick} />
      </Popup>
    </Marker>
  );
}

export function VolunteerOpportunitiesMap({ events, onEventClick }: VolunteerOpportunitiesMapProps) {
  // Filter events to only those with coordinates
  const eventsWithCoordinates = useMemo(() => {
    return events.filter(
      (event) =>
        event.latitude &&
        event.longitude &&
        event.latitude !== '0' &&
        event.longitude !== '0' &&
        !isNaN(parseFloat(event.latitude)) &&
        !isNaN(parseFloat(event.longitude))
    );
  }, [events]);

  // Group events by exact coordinates
  const eventsByLocation = useMemo(() => {
    const grouped = new Map<string, EventRequest[]>();
    eventsWithCoordinates.forEach((event) => {
      const key = `${event.latitude},${event.longitude}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(event);
    });
    return grouped;
  }, [eventsWithCoordinates]);

  // Calculate map center
  const mapCenter: [number, number] = useMemo(() => {
    if (eventsWithCoordinates.length === 0) return [33.7490, -84.3880]; // Atlanta default

    const avgLat =
      eventsWithCoordinates.reduce((sum, e) => sum + parseFloat(e.latitude || '0'), 0) /
      eventsWithCoordinates.length;
    const avgLng =
      eventsWithCoordinates.reduce((sum, e) => sum + parseFloat(e.longitude || '0'), 0) /
      eventsWithCoordinates.length;

    return [avgLat, avgLng];
  }, [eventsWithCoordinates]);

  // Compute date range for display
  const dateRange = useMemo(() => {
    const dates = events
      .map(e => getEffectiveEventDate(e))
      .filter(Boolean)
      .map(d => parseLocalDate(d!))
      .sort((a, b) => a.getTime() - b.getTime());

    if (dates.length === 0) return null;
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    return {
      from: format(earliest, 'MMM d'),
      to: format(latest, 'MMM d, yyyy'),
      count: events.length,
    };
  }, [events]);

  if (eventsWithCoordinates.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <Card className="max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <MapPin className="w-16 h-16 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">
                No Events with Addresses
              </h3>
              <p className="text-gray-600 text-sm">
                {events.length === 0
                  ? 'No volunteer opportunities available'
                  : 'Events need addresses and coordinates to appear on the map'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Date range info bar */}
      {dateRange && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-md px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200">
          <Calendar className="w-4 h-4 inline mr-1.5 -mt-0.5" style={{ color: '#236383' }} />
          Showing <span className="font-bold" style={{ color: '#236383' }}>{dateRange.count}</span> scheduled events with unfilled roles &middot; {dateRange.from} – {dateRange.to}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-3 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-md px-3 py-2.5 text-xs border border-gray-200">
        <div className="font-semibold text-gray-700 mb-1.5">Map Legend</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.volunteer }} />
            <span>Volunteer Needed</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.driver }} />
            <span>Driver Needed</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: COLORS.vanDriver }} />
            <span className="font-semibold">Van Driver Needed</span>
          </div>
        </div>
      </div>

      <MapContainer
        center={mapCenter}
        zoom={10}
        style={{ height: '100%', width: '100%' }}
        className="z-0"
      >
        <BaseMapTiles />
        <MapBounds events={eventsWithCoordinates} />

        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          showCoverageOnHover={true}
          spiderfyDistanceMultiplier={1.5}
          maxClusterRadius={60}
        >
          {Array.from(eventsByLocation.entries()).map(([locationKey, eventsAtLocation]) => {
            // For multiple events at same location, show the first one (or could show a combined popup)
            const primaryEvent = eventsAtLocation[0];
            return (
              <EventMarker
                key={`${primaryEvent.id}-${locationKey}`}
                event={primaryEvent}
                onEventClick={onEventClick}
              />
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}

