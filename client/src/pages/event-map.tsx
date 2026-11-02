import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { MapContainer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import {
  MapPin, Search, Calendar, Users, Package, Phone, Mail, AlertCircle,
  ChevronRight, Filter, RefreshCw, Navigation, Pencil, Save, X, User, ExternalLink,
  Clock
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { BaseMapTiles } from '@/components/maps/BaseMapTiles';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css';

// Custom CSS for cluster tooltips and animations
const clusterTooltipStyles = `
  .cluster-tooltip {
    background: white !important;
    border: 1px solid #e5e7eb !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
    padding: 0 !important;
    max-height: 280px !important;
    overflow-y: auto !important;
  }
  .cluster-tooltip .leaflet-tooltip-tip {
    display: none;
  }
  .cluster-tooltip::before {
    display: none !important;
  }

  /* Cluster marker animations */
  .custom-marker-cluster > div {
    animation: clusterAppear 0.3s ease-out forwards;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  .custom-marker-cluster > div:hover {
    transform: scale(1.1);
  }

  @keyframes clusterAppear {
    0% {
      opacity: 0;
      transform: scale(0.5);
    }
    70% {
      transform: scale(1.1);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* Marker cluster group transition */
  .leaflet-marker-icon {
    transition: opacity 0.25s ease-out;
  }

  /* Stacked location marker animation */
  .stacked-marker > div {
    animation: stackedAppear 0.35s ease-out forwards;
  }

  @keyframes stackedAppear {
    0% {
      opacity: 0;
      transform: scale(0.3) translateY(10px);
    }
    100% {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* Custom label marker animation */
  .custom-label-marker > div {
    animation: labelSlideIn 0.3s ease-out forwards;
  }

  @keyframes labelSlideIn {
    0% {
      opacity: 0;
      transform: translateY(-10px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Cluster spiderfy animation */
  .leaflet-cluster-anim .leaflet-marker-icon {
    transition: transform 0.3s ease-out, opacity 0.3s ease-out;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleId = 'cluster-tooltip-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = clusterTooltipStyles;
    document.head.appendChild(style);
  }
}
import { format } from 'date-fns';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';
import { formatTime12Hour } from '@/components/event-requests/utils';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient, applyPatchResponseToCache } from '@/lib/queryClient';
import { patchEventRequestVerified } from '@/lib/event-save-verification';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

// Fix Leaflet default marker icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Helper function to parse date strings as local dates to avoid timezone issues
const parseLocalDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('T')[0].split('-').map(Number);
  return new Date(year, month - 1, day);
};

interface EventMapData {
  id: number;
  organizationName: string | null;
  organizationCategory: string | null;
  department: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  eventAddress: string;
  latitude: string | null;
  longitude: string | null;
  desiredEventDate: string | null;
  scheduledEventDate: string | null;
  status: string;
  estimatedSandwichCount: number | null;
  tspContact: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  googleSheetRowId: number | null;
  externalId: string | null;
}

type UpcomingFilterOption =
  | 'all'
  | 'this_week'
  | 'next_week'
  | 'week_after'
  | 'two_weeks'
  | 'this_month'
  | 'upcoming';

const UPCOMING_FILTER_LABELS: Record<UpcomingFilterOption, string> = {
  all: 'All Time',
  this_week: 'This Week (Next 7 Days)',
  next_week: 'Next Week (Days 8-14)',
  week_after: 'Week After Next (Days 15-21)',
  two_weeks: 'Next 2 Weeks (14 Days)',
  this_month: 'This Month (Next 30 Days)',
  upcoming: 'All Upcoming Events'
};

const isEventWithinUpcomingFilter = (
  event: EventMapData,
  filter: UpcomingFilterOption
) => {
  if (filter === 'all') {
    return true;
  }

  const dateStr = getEffectiveEventDate(event);
  if (!dateStr) {
    return false;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const eventDate = parseLocalDate(dateStr);

  if (eventDate < now) {
    return false;
  }

  const daysFromNow = (days: number) => {
    const target = new Date(now);
    target.setDate(now.getDate() + days);
    return target;
  };

  switch (filter) {
    case 'this_week': {
      const weekFromNow = daysFromNow(7);
      return eventDate >= now && eventDate <= weekFromNow;
    }
    case 'next_week': {
      const nextWeekStart = daysFromNow(8);
      const nextWeekEnd = daysFromNow(14);
      return eventDate >= nextWeekStart && eventDate <= nextWeekEnd;
    }
    case 'week_after': {
      const weekAfterStart = daysFromNow(15);
      const weekAfterEnd = daysFromNow(21);
      return eventDate >= weekAfterStart && eventDate <= weekAfterEnd;
    }
    case 'two_weeks': {
      const twoWeeksFromNow = daysFromNow(14);
      return eventDate >= now && eventDate <= twoWeeksFromNow;
    }
    case 'this_month': {
      const monthFromNow = daysFromNow(30);
      return eventDate >= now && eventDate <= monthFromNow;
    }
    case 'upcoming':
      return true;
    default:
      return true;
  }
};

// Custom marker icons for different statuses
const createColorIcon = (color: string) => {
  return new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });
};

const statusIcons = {
  new: createColorIcon('gold'),
  in_process: createColorIcon('yellow'),
  scheduled: createColorIcon('blue'),
  completed: createColorIcon('green'),
  declined: createColorIcon('grey'),
  cancelled: createColorIcon('red'),
};

const statusColors = {
  new: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  in_process: 'bg-blue-100 text-blue-800 border-blue-300',
  scheduled: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  completed: 'bg-green-100 text-green-800 border-green-300',
  declined: 'bg-gray-100 text-gray-800 border-gray-300',
  cancelled: 'bg-red-100 text-red-800 border-red-300',
};

// Custom cluster icon - density-based sizing and color gradients
const createClusterCustomIcon = (cluster: any) => {
  const count = cluster.getChildCount();

  // Determine size tier based on count
  let sizePx: number;
  let fontSize: string;
  let borderWidth: number;

  if (count < 5) {
    sizePx = 36;
    fontSize = '12px';
    borderWidth = 3;
  } else if (count < 10) {
    sizePx = 42;
    fontSize = '13px';
    borderWidth = 3;
  } else if (count < 20) {
    sizePx = 50;
    fontSize = '14px';
    borderWidth = 4;
  } else if (count < 50) {
    sizePx = 58;
    fontSize = '16px';
    borderWidth = 4;
  } else if (count < 100) {
    sizePx = 68;
    fontSize = '18px';
    borderWidth = 5;
  } else {
    sizePx = 80;
    fontSize = '20px';
    borderWidth = 5;
  }

  // Determine color intensity based on count (darker = more events)
  // Low density: lighter teal, High density: deep navy/dark teal
  let bgGradient: string;
  let glowIntensity: string;

  if (count < 5) {
    // Very light - soft teal
    bgGradient = 'linear-gradient(135deg, #47B3CB 0%, #236383 100%)';
    glowIntensity = '0 2px 8px rgba(71, 179, 203, 0.4)';
  } else if (count < 10) {
    // Light - medium teal
    bgGradient = 'linear-gradient(135deg, #236383 0%, #236383 100%)';
    glowIntensity = '0 3px 10px rgba(0, 126, 140, 0.5)';
  } else if (count < 20) {
    // Medium - teal to navy
    bgGradient = 'linear-gradient(135deg, #236383 0%, #1a4a5e 100%)';
    glowIntensity = '0 4px 12px rgba(35, 99, 131, 0.6)';
  } else if (count < 50) {
    // Medium-high - navy with amber accent
    bgGradient = 'linear-gradient(135deg, #1a4a5e 0%, #0f3040 100%)';
    glowIntensity = '0 5px 15px rgba(26, 74, 94, 0.7)';
  } else if (count < 100) {
    // High - deep navy with orange glow
    bgGradient = 'linear-gradient(135deg, #0f3040 0%, #FBAD3F 100%)';
    glowIntensity = '0 6px 20px rgba(251, 173, 63, 0.6)';
  } else {
    // Very high - hot gradient (orange to red)
    bgGradient = 'linear-gradient(135deg, #FBAD3F 0%, #f59e0b 50%, #dc2626 100%)';
    glowIntensity = '0 8px 25px rgba(220, 38, 38, 0.5)';
  }

  // Add pulsing animation for very high density clusters
  const pulseAnimation = count >= 50 ? 'animation: pulse 2s infinite;' : '';

  return L.divIcon({
    html: `
      <style>
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      </style>
      <div style="
        width: ${sizePx}px;
        height: ${sizePx}px;
        border-radius: 50%;
        background: ${bgGradient};
        color: white;
        font-weight: bold;
        font-size: ${fontSize};
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: ${glowIntensity};
        border: ${borderWidth}px solid rgba(255, 255, 255, 0.9);
        ${pulseAnimation}
      ">
        ${count}
      </div>`,
    className: 'custom-marker-cluster',
    iconSize: L.point(sizePx, sizePx, true),
    iconAnchor: L.point(sizePx / 2, sizePx / 2, true),
  });
};

// Helper function to generate cluster tooltip content
const generateClusterTooltip = (cluster: any): string => {
  const markers = cluster.getAllChildMarkers();
  const events: EventMapData[] = markers
    .map((marker: any) => marker.options?.eventData)
    .filter(Boolean);

  if (events.length === 0) {
    return `<div class="p-2 text-sm">${cluster.getChildCount()} events</div>`;
  }

  // Calculate status breakdown
  const statusCounts: Record<string, number> = {};
  let totalSandwiches = 0;
  const orgNames: string[] = [];

  events.forEach((event: EventMapData) => {
    // Count statuses
    const status = event.status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    // Sum sandwiches
    if (event.estimatedSandwichCount) {
      totalSandwiches += event.estimatedSandwichCount;
    }

    // Collect org names (top 5)
    if (event.organizationName && orgNames.length < 5) {
      orgNames.push(event.organizationName);
    }
  });

  // Build status breakdown HTML
  const statusLabels: Record<string, string> = {
    new: '🟡 New',
    in_process: '🟠 In Process',
    scheduled: '🔵 Scheduled',
    completed: '🟢 Completed',
    declined: '⚪ Declined',
    cancelled: '🔴 Cancelled',
  };

  const statusBreakdown = Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `<div class="flex justify-between gap-4"><span>${statusLabels[status] || status}</span><span class="font-semibold">${count}</span></div>`)
    .join('');

  // Build organizations list
  const orgList = orgNames.length > 0
    ? `<div class="border-t border-gray-200 pt-2 mt-2">
        <div class="text-xs font-semibold text-gray-500 mb-1">TOP ORGANIZATIONS</div>
        ${orgNames.map(name => `<div class="text-xs truncate">${name}</div>`).join('')}
        ${events.length > 5 ? `<div class="text-xs text-gray-400 italic">+${events.length - 5} more...</div>` : ''}
      </div>`
    : '';

  return `
    <div class="p-3 min-w-[200px] max-w-[calc(100vw-3rem)]">
      <div class="font-bold text-base mb-2">${events.length} Events</div>
      <div class="text-sm space-y-1 mb-2">
        ${statusBreakdown}
      </div>
      ${totalSandwiches > 0 ? `<div class="text-sm font-medium text-amber-700 border-t border-gray-200 pt-2 mt-2">🥪 ~${totalSandwiches.toLocaleString()} sandwiches</div>` : ''}
      ${orgList}
      <div class="text-xs text-gray-400 mt-2 italic">Click to zoom in</div>
    </div>
  `;
};

// Helper to calculate best tooltip direction based on cluster position
const calculateTooltipDirection = (
  map: L.Map,
  clusterLatLng: L.LatLng
): { direction: 'top' | 'bottom' | 'left' | 'right'; offset: L.Point } => {
  const containerPoint = map.latLngToContainerPoint(clusterLatLng);
  const mapSize = map.getSize();

  // Tooltip dimensions (matches CSS max-height constraint)
  const tooltipWidth = 280;
  const tooltipHeight = 280; // Matches max-height in CSS
  const clusterRadius = 40; // Account for cluster icon size
  const margin = 20; // Margin from edge
  
  // Check available space in each direction
  const spaceTop = containerPoint.y;
  const spaceBottom = mapSize.y - containerPoint.y;
  const spaceLeft = containerPoint.x;
  const spaceRight = mapSize.x - containerPoint.x;
  
  // Prioritize: bottom if near top, top if near bottom, then left/right
  if (spaceTop < tooltipHeight + clusterRadius + margin) {
    // Near top edge - show tooltip below
    return { direction: 'bottom', offset: L.point(0, 20) };
  } else if (spaceBottom < tooltipHeight + clusterRadius + margin) {
    // Near bottom edge - show tooltip above
    return { direction: 'top', offset: L.point(0, -20) };
  } else if (spaceRight < tooltipWidth / 2 + margin) {
    // Near right edge - show tooltip to the left
    return { direction: 'left', offset: L.point(-20, 0) };
  } else if (spaceLeft < tooltipWidth / 2 + margin) {
    // Near left edge - show tooltip to the right
    return { direction: 'right', offset: L.point(20, 0) };
  }
  
  // Default to top (most common case)
  return { direction: 'top', offset: L.point(0, -20) };
};

// Component to handle cluster tooltips
function ClusterTooltipHandler({ clusterRef }: { clusterRef: React.RefObject<any> }) {
  const map = useMap();

  useEffect(() => {
    if (!clusterRef.current) return;

    const clusterGroup = clusterRef.current;

    const handleClusterMouseover = (e: any) => {
      const cluster = e.propagatedFrom || e.layer;
      if (cluster && cluster.getChildCount) {
        const tooltipContent = generateClusterTooltip(cluster);
        
        // Calculate best direction based on cluster position
        const clusterLatLng = cluster.getLatLng();
        const { direction, offset } = calculateTooltipDirection(map, clusterLatLng);
        
        cluster.bindTooltip(tooltipContent, {
          direction,
          offset,
          opacity: 0.95,
          className: 'cluster-tooltip',
          sticky: false,
        }).openTooltip();
      }
    };

    const handleClusterMouseout = (e: any) => {
      const cluster = e.propagatedFrom || e.layer;
      if (cluster && cluster.closeTooltip) {
        cluster.closeTooltip();
        cluster.unbindTooltip();
      }
    };

    clusterGroup.on('clustermouseover', handleClusterMouseover);
    clusterGroup.on('clustermouseout', handleClusterMouseout);

    return () => {
      clusterGroup.off('clustermouseover', handleClusterMouseover);
      clusterGroup.off('clustermouseout', handleClusterMouseout);
    };
  }, [clusterRef, map]);

  return null;
}

// Custom icon for multiple events at the EXACT same location (stacked)
const createStackedLocationIcon = (count: number) => {
  return new L.DivIcon({
    html: `<div class="relative">
      <div class="w-8 h-8 rounded-full bg-[#FBAD3F] text-white font-bold flex items-center justify-center shadow-lg border-3 border-white absolute" style="top: -2px; left: -2px; z-index: 1;">
        ${count}
      </div>
      <div class="w-8 h-8 rounded-full bg-[#FBAD3F] opacity-50 absolute" style="top: 2px; left: 2px; z-index: 0;"></div>
    </div>`,
    className: 'stacked-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
};

// Enhanced popup content component (needs to be defined before LocationMarker uses it)
const EnhancedPopupContent = ({ event, navigate }: { event: EventMapData; navigate: any }) => {
  const contactName = [event.firstName, event.lastName].filter(Boolean).join(' ');
  const getEventDate = (evt: EventMapData) => {
    const date = getEffectiveEventDate(evt);
    return date ? format(parseLocalDate(date), 'MMM dd, yyyy') : 'No date set';
  };

  return (
    <div className="p-2 w-full sm:w-[280px] max-w-[calc(100vw-3rem)]">
      <h3 className="font-semibold text-base sm:text-lg mb-1 text-gray-900 truncate">
        {event.organizationName || 'Unknown Organization'}
      </h3>
      {event.department && (
        <p className="text-sm text-gray-600 mb-2">{event.department}</p>
      )}

      <div className="space-y-1.5 text-sm mb-3">
        {contactName && (
          <div className="flex items-center gap-2">
            <User className="w-3 h-3 text-gray-500 flex-shrink-0" />
            <span className="text-gray-700">{contactName}</span>
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

        {(event.eventStartTime || event.eventEndTime) && (
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-gray-500 flex-shrink-0" />
            <span className="text-base text-gray-800 font-medium">
              {event.eventStartTime && formatTime12Hour(event.eventStartTime)}
              {event.eventStartTime && event.eventEndTime && ' - '}
              {event.eventEndTime && formatTime12Hour(event.eventEndTime)}
            </span>
          </div>
        )}

        {event.estimatedSandwichCount && (
          <div className="flex items-center gap-2">
            <Package className="w-3 h-3 text-gray-500 flex-shrink-0" />
            <span className="text-base text-gray-800 font-medium">
              ~{event.estimatedSandwichCount} sandwiches
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <MapPin className="w-3 h-3 text-gray-500 flex-shrink-0" />
          <span className="text-xs text-gray-600 line-clamp-2">{event.eventAddress}</span>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-gray-200">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Event #{event.id}</span>
          {event.googleSheetRowId && (
            <span>Sheet Row: {event.googleSheetRowId}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Badge className={`${statusColors[event.status as keyof typeof statusColors]} text-xs`}>
            {event.status.replace('_', ' ').toUpperCase()}
          </Badge>
          <a
            href="/event-requests"
            className="ml-auto text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 hover:underline cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              navigate('/event-requests');
            }}
            data-testid="link-view-edit-event"
          >
            View/Edit
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};

// Custom marker component for events at the same location
function LocationMarker({
  events,
  latitude,
  longitude,
  onEventSelect,
  navigate
}: {
  events: EventMapData[];
  latitude: string;
  longitude: string;
  onEventSelect: (event: EventMapData) => void;
  navigate: any;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const handleZoom = () => setZoom(map.getZoom());
    map.on('zoom', handleZoom);
    return () => { map.off('zoom', handleZoom); };
  }, [map]);

  // Collapse when zooming out
  useEffect(() => {
    if (zoom < 12 && expanded) {
      setExpanded(false);
    }
  }, [zoom, expanded]);

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  // Single event - show detailed label when zoomed in
  if (events.length === 1) {
    const event = events[0];
    const showLabel = zoom >= 12;

    if (showLabel) {
      const borderColor = event.status === 'scheduled' ? '#236383' : '#FBAD3F';
      return (
        <Marker
          position={[lat, lng]}
          icon={new L.DivIcon({
            html: `<div class="flex flex-col items-center">
              <div class="bg-white rounded-lg shadow-lg border-2 px-3 py-2 min-w-[180px]" style="border-color: ${borderColor}">
                <div class="font-semibold text-base text-gray-900 truncate">${event.organizationName || 'Unknown'}</div>
                <div class="text-sm text-gray-700 font-medium">${event.desiredEventDate || event.scheduledEventDate ? format(parseLocalDate(event.desiredEventDate || event.scheduledEventDate!), 'MMM d') : 'No date'}</div>
                ${event.estimatedSandwichCount ? `<div class="text-sm text-gray-600 font-medium">${event.estimatedSandwichCount} sandwiches</div>` : ''}
              </div>
              <div style="width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 12px solid ${borderColor}; margin-top: -1px;"></div>
              <div style="width: 8px; height: 8px; border-radius: 50%; background: ${borderColor}; margin-top: 2px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>
            </div>`,
            className: 'custom-label-marker',
            iconSize: [180, 90],
            iconAnchor: [90, 90]
          })}
          // @ts-ignore - custom property for cluster tooltip
          eventData={event}
          eventHandlers={{
            click: () => onEventSelect(event)
          }}
        >
          <Popup>
            <EnhancedPopupContent event={event} navigate={navigate} />
          </Popup>
        </Marker>
      );
    }

    return (
      <Marker
        position={[lat, lng]}
        icon={statusIcons[event.status as keyof typeof statusIcons] || statusIcons.new}
        // @ts-ignore - custom property for cluster tooltip
        eventData={event}
        eventHandlers={{
          click: () => onEventSelect(event)
        }}
      >
        <Popup>
          <EnhancedPopupContent event={event} navigate={navigate} />
        </Popup>
      </Marker>
    );
  }

  // Multiple events at same location - pass first event data for clustering
  if (!expanded) {
    return (
      <Marker
        position={[lat, lng]}
        icon={createStackedLocationIcon(events.length)}
        // @ts-ignore - custom property for cluster tooltip (use first event as representative)
        eventData={events[0]}
        eventHandlers={{
          click: () => setExpanded(true)
        }}
      >
        <Popup>
          <div className="p-2">
            <h3 className="font-semibold mb-2">{events.length} Events at this Location</h3>
            <p className="text-sm text-gray-600 mb-2">Click marker to expand</p>
            {events.map((event, idx) => (
              <div key={event.id} className="text-xs mb-1">
                {idx + 1}. {event.organizationName}
              </div>
            ))}
          </div>
        </Popup>
      </Marker>
    );
  }

  // Expanded - show individual markers in a circle
  const radius = 0.0003; // ~30 meters
  return (
    <>
      {events.map((event, idx) => {
        const angle = (idx / events.length) * 2 * Math.PI;
        const offsetLat = lat + radius * Math.cos(angle);
        const offsetLng = lng + radius * Math.sin(angle);

        return (
          <Marker
            key={event.id}
            position={[offsetLat, offsetLng]}
            icon={statusIcons[event.status as keyof typeof statusIcons] || statusIcons.new}
            // @ts-ignore - custom property for cluster tooltip
            eventData={event}
            eventHandlers={{
              click: () => onEventSelect(event)
            }}
          >
            <Popup>
              <EnhancedPopupContent event={event} navigate={navigate} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// Component to auto-fit map bounds (excludes geographic outliers)
function MapBounds({ events }: { events: EventMapData[] }) {
  const map = useMap();

  useEffect(() => {
    if (events.length === 0) return;

    // If only 1-2 events, just fit them all
    if (events.length <= 2) {
      const bounds = L.latLngBounds(
        events.map(e => [parseFloat(e.latitude!), parseFloat(e.longitude!)])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
      return;
    }

    // Calculate median lat/lng to find the geographic center
    const lats = events.map(e => parseFloat(e.latitude!)).sort((a, b) => a - b);
    const lngs = events.map(e => parseFloat(e.longitude!)).sort((a, b) => a - b);
    const medianLat = lats[Math.floor(lats.length / 2)];
    const medianLng = lngs[Math.floor(lngs.length / 2)];

    // Calculate distance from median for each event
    const eventsWithDistance = events.map(e => {
      const lat = parseFloat(e.latitude!);
      const lng = parseFloat(e.longitude!);
      // Simple Euclidean distance (good enough for filtering outliers)
      const distance = Math.sqrt(
        Math.pow(lat - medianLat, 2) + Math.pow(lng - medianLng, 2)
      );
      return { event: e, distance, lat, lng };
    });

    // Calculate threshold: 3x the median distance (excludes far outliers like LA)
    const distances = eventsWithDistance.map(e => e.distance).sort((a, b) => a - b);
    const medianDistance = distances[Math.floor(distances.length / 2)];
    const threshold = medianDistance * 3;

    // Filter out outliers
    const filteredEvents = eventsWithDistance.filter(e => e.distance <= threshold);

    // If filtering removed all events, use all events
    if (filteredEvents.length === 0) {
      const bounds = L.latLngBounds(
        events.map(e => [parseFloat(e.latitude!), parseFloat(e.longitude!)])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
      return;
    }

    // Fit bounds to non-outlier events
    const bounds = L.latLngBounds(
      filteredEvents.map(e => [e.lat, e.lng])
    );
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [events, map]);

  return null;
}

export default function EventMapView() {
  const { user } = useAuth();
  const { trackView, trackSearch } = useActivityTracker();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set(['new', 'in_process', 'scheduled']));
  const [yearFilter, setYearFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [upcomingFilter, setUpcomingFilter] = useState<UpcomingFilterOption>('two_weeks');
  const [selectedEvent, setSelectedEvent] = useState<EventMapData | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventMapData | null>(null);
  const [editedAddress, setEditedAddress] = useState('');
  const [clusteringEnabled, setClusteringEnabled] = useState(true);
  const clusterGroupRef = useRef<any>(null);

  useEffect(() => {
    trackView(
      'Event Requests',
      'Event Planning',
      'Event Map',
      'User accessed event map view'
    );
  }, [trackView]);

  // Fetch events with coordinates
  const { data: events = [], isLoading, error, refetch } = useQuery<EventMapData[]>({
    queryKey: ['/api/event-map'],
    queryFn: async () => {
      const response = await fetch(`/api/event-map`);
      if (!response.ok) throw new Error('Failed to fetch event map data');
      return response.json();
    },
    staleTime: 30 * 1000, // Consider data stale after 30 seconds
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  // Update address mutation
  const updateAddressMutation = useMutation({
    mutationFn: async ({ eventId, address }: { eventId: number; address: string }) => {
      return await patchEventRequestVerified(eventId, {
        eventAddress: address,
      });
    },
    onSuccess: async (updated) => {
      toast({
        title: 'Address Updated',
        description: 'Event address has been updated successfully',
      });
      // Refresh event-request list/cards too (not just the map): eventAddress is
      // a tracked field, so this also invalidates the map + volunteer hub.
      await applyPatchResponseToCache(queryClient, updated as any, {
        touchedFields: ['eventAddress'],
      });
      setEditingEvent(null);
      setEditedAddress('');
    },
    onError: (error: any) => {
      toast({
        title: 'Update Failed',
        description: error?.message || 'Failed to update event address',
        variant: 'destructive',
      });
    },
  });

  // Geocode mutation (server-side rate limited to 1 req/sec)
  const geocodeMutation = useMutation({
    mutationFn: async (eventId: number) => {
      return await apiRequest('POST', `/api/event-map/geocode/${eventId}`);
    },
    onSuccess: () => {
      toast({
        title: 'Address Geocoded',
        description: 'Event location has been added to the map (rate limited: 1 per second)',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/event-map'] });
    },
    onError: (error: any) => {
      const errorDetails = error?.message || error?.details || 'Unable to find coordinates for this address';
      toast({
        title: 'Geocoding Failed',
        description: errorDetails,
        variant: 'destructive',
      });
    },
  });

  // Filter events with coordinates and group by exact location
  const eventsWithCoordinates = useMemo(() => {
    return events.filter(e => e.latitude && e.longitude);
  }, [events]);

  // Group events by exact coordinates (will be recalculated after filtering)
  const groupEventsByLocation = (events: EventMapData[]) => {
    const grouped = new Map<string, EventMapData[]>();

    events.forEach(event => {
      const key = `${event.latitude},${event.longitude}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(event);
    });

    return grouped;
  };

  // Filter events without coordinates
  const eventsNeedingGeocode = useMemo(() => {
    return events.filter(e => !e.latitude || !e.longitude);
  }, [events]);

  // Extract unique years from events
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    events.forEach(event => {
      const date = getEffectiveEventDate(event);
      if (date) {
        const year = parseLocalDate(date).getFullYear();
        if (!isNaN(year)) {
          years.add(year);
        }
      }
    });
    return Array.from(years).sort((a, b) => b - a); // Most recent first
  }, [events]);

  // All available organization categories (from schema)
  const ALL_ORGANIZATION_CATEGORIES = [
    { value: 'small_medium_corp', label: 'Small/Medium Corporation' },
    { value: 'large_corp', label: 'Large Corporation' },
    { value: 'church_faith', label: 'Church/Faith Group' },
    { value: 'school', label: 'School' },
    { value: 'neighborhood', label: 'Neighborhood' },
    { value: 'club', label: 'Club' },
    { value: 'other', label: 'Other' },
  ];

  // Count events per category for display
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ALL_ORGANIZATION_CATEGORIES.forEach(cat => {
      counts[cat.value] = 0;
    });
    events.forEach(event => {
      if (event.organizationCategory && counts[event.organizationCategory] !== undefined) {
        counts[event.organizationCategory]++;
      }
    });
    return counts;
  }, [events]);

  // Search and filtering
  const filteredEvents = useMemo(() => {
    let filtered = eventsWithCoordinates;

    // Status filter
    if (statusFilters.size > 0 && statusFilters.size < 4) { // Not all statuses selected
      filtered = filtered.filter(event => statusFilters.has(event.status));
    }

    // Upcoming events filter
    if (upcomingFilter !== 'all') {
      filtered = filtered.filter(event =>
        isEventWithinUpcomingFilter(event, upcomingFilter)
      );
    }

    // Year filter
    if (yearFilter !== 'all') {
      const targetYear = parseInt(yearFilter);
      filtered = filtered.filter(event => {
        const date = getEffectiveEventDate(event);
        if (!date) return false;
        const year = parseLocalDate(date).getFullYear();
        return year === targetYear;
      });
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(event => event.organizationCategory === categoryFilter);
    }

    // Search filter
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(event =>
        event.organizationName?.toLowerCase().includes(search) ||
        event.department?.toLowerCase().includes(search) ||
        event.eventAddress?.toLowerCase().includes(search) ||
        `${event.firstName} ${event.lastName}`.toLowerCase().includes(search)
      );
    }

    return filtered;
  }, [eventsWithCoordinates, searchTerm, yearFilter, categoryFilter, upcomingFilter, statusFilters]);

  // Group filtered events by location for map display
  const filteredEventsByLocation = useMemo(() => {
    return groupEventsByLocation(filteredEvents);
  }, [filteredEvents]);

  const eventsInSelectedPeriod = useMemo(() => {
    return events.filter(event =>
      isEventWithinUpcomingFilter(event, upcomingFilter)
    );
  }, [events, upcomingFilter]);

  const selectedPeriodCount = eventsInSelectedPeriod.length;

  // Calculate map center
  const mapCenter: [number, number] = useMemo(() => {
    if (filteredEvents.length === 0) return [33.7490, -84.3880]; // Atlanta default
    
    const avgLat = filteredEvents.reduce((sum, e) => sum + parseFloat(e.latitude!), 0) / filteredEvents.length;
    const avgLng = filteredEvents.reduce((sum, e) => sum + parseFloat(e.longitude!), 0) / filteredEvents.length;
    
    return [avgLat, avgLng];
  }, [filteredEvents]);

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <Skeleton className="h-12 w-12 rounded-full" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Error Loading Map
                </h2>
                <p className="text-gray-600">
                  {error instanceof Error ? error.message : 'Failed to load event map'}
                </p>
              </div>
              <Button onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="flex-shrink-0 p-4 bg-white border-b border-gray-200">
        <PageBreadcrumbs
          segments={[
            { label: 'Directory' },
            { label: 'Event Requests Map' }
          ]}
        />
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#236383] to-[#005f6b] flex items-center justify-center">
              <Navigation className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Event Requests Map</h1>
              <p className="text-sm text-gray-600">
                {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''} displayed
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => setClusteringEnabled(!clusteringEnabled)} 
              variant={clusteringEnabled ? "default" : "outline"}
              size="sm"
              data-testid="button-toggle-clustering"
            >
              <MapPin className="w-4 h-4 mr-2" />
              {clusteringEnabled ? 'Show All Pins' : 'Show Clusters'}
            </Button>
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by organization, name, or address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={upcomingFilter} onValueChange={(value) => setUpcomingFilter(value as UpcomingFilterOption)}>
            <SelectTrigger className="w-full md:w-48">
              <Clock className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="this_week">This Week (Next 7 Days)</SelectItem>
              <SelectItem value="next_week">Next Week (Days 8-14)</SelectItem>
              <SelectItem value="week_after">Week After Next (Days 15-21)</SelectItem>
              <SelectItem value="two_weeks">Next 2 Weeks (14 Days)</SelectItem>
              <SelectItem value="this_month">This Month (Next 30 Days)</SelectItem>
              <SelectItem value="upcoming">All Upcoming Events</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full md:w-48">
              <Users className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {ALL_ORGANIZATION_CATEGORIES.map(category => (
                <SelectItem key={category.value} value={category.value}>
                  {category.label} ({categoryCounts[category.value] || 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-full md:w-40">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {availableYears.map(year => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="border rounded-md p-3 bg-white">
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Status Filters
            </div>
            <div className="space-y-2">
              {[
                { value: 'new', label: 'New' },
                { value: 'in_process', label: 'In Process' },
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'completed', label: 'Completed' }
              ].map((status) => (
                <div key={status.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`status-${status.value}`}
                    checked={statusFilters.has(status.value)}
                    onCheckedChange={(checked) => {
                      const newFilters = new Set(statusFilters);
                      if (checked) {
                        newFilters.add(status.value);
                      } else {
                        newFilters.delete(status.value);
                      }
                      setStatusFilters(newFilters);
                    }}
                  />
                  <Label
                    htmlFor={`status-${status.value}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {status.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mt-3 gap-2 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">
              {UPCOMING_FILTER_LABELS[upcomingFilter]}:
            </span>
            <span className="font-semibold text-gray-900">
              {selectedPeriodCount} event{selectedPeriodCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Map and Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          {filteredEvents.length > 0 ? (
            <MapContainer
              center={mapCenter}
              zoom={10}
              style={{ height: '100%', width: '100%' }}
              className="z-0"
            >
              <BaseMapTiles />
              <MapBounds events={filteredEvents} />
              
              {clusteringEnabled ? (
                <MarkerClusterGroup
                  ref={clusterGroupRef}
                  chunkedLoading
                  iconCreateFunction={createClusterCustomIcon}
                  showCoverageOnHover={true}
                  spiderfyDistanceMultiplier={1.5}
                  maxClusterRadius={60}
                  animate={true}
                  animateAddingMarkers={true}
                  spiderfyOnMaxZoom={true}
                  zoomToBoundsOnClick={true}
                >
                  <ClusterTooltipHandler clusterRef={clusterGroupRef} />
                  {Array.from(filteredEventsByLocation.entries()).map(([locationKey, eventsAtLocation]) => {
                    const [lat, lng] = locationKey.split(',');
                    return (
                      <LocationMarker
                        key={locationKey}
                        events={eventsAtLocation}
                        latitude={lat}
                        longitude={lng}
                        onEventSelect={setSelectedEvent}
                        navigate={setLocation}
                      />
                    );
                  })}
                </MarkerClusterGroup>
              ) : (
                <>
                  {Array.from(filteredEventsByLocation.entries()).map(([locationKey, eventsAtLocation]) => {
                    const [lat, lng] = locationKey.split(',');
                    return (
                      <LocationMarker
                        key={locationKey}
                        events={eventsAtLocation}
                        latitude={lat}
                        longitude={lng}
                        onEventSelect={setSelectedEvent}
                        navigate={setLocation}
                      />
                    );
                  })}
                </>
              )}
            </MapContainer>
          ) : (
            <div className="h-full flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <MapPin className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No Events to Display
                </h3>
                <p className="text-gray-600">
                  {eventsNeedingGeocode.length > 0
                    ? 'Geocode event addresses to see them on the map'
                    : 'No events with addresses found'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar - Currently Viewing */}
        <div className="w-80 border-l border-gray-200 bg-gray-50 flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-white">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-brand-primary" />
              Currently Viewing ({filteredEvents.length})
            </h2>
            <p className="text-xs text-gray-600 mt-1">
              Events displayed on map
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {filteredEvents.map((event) => (
                <Card
                  key={event.id}
                  className="p-3 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => {
                    setSelectedEvent(event);
                    // Zoom to event location if it has coordinates
                    if (event.latitude && event.longitude) {
                      // Map will auto-center on popup open
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm truncate">
                        {event.organizationName || 'Unknown'}
                      </h3>

                      {/* Event Date */}
                      {(getEffectiveEventDate(event)) && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-700 mt-1.5">
                          <Calendar className="w-3 h-3 flex-shrink-0" />
                          <span>
                            {format(parseLocalDate(getEffectiveEventDate(event)!), 'MMM d, yyyy')}
                          </span>
                        </div>
                      )}

                      {/* Contact Person */}
                      {(event.firstName || event.lastName) && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-600 mt-1">
                          <User className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">
                            {[event.firstName, event.lastName].filter(Boolean).join(' ')}
                          </span>
                        </div>
                      )}

                      <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">
                        {event.eventAddress}
                      </p>

                      {/* Status Badge */}
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge className={`${statusColors[event.status as keyof typeof statusColors]} text-xs`}>
                          {event.status.replace('_', ' ')}
                        </Badge>
                        {event.estimatedSandwichCount && (
                          <span className="text-xs text-gray-500">
                            {event.estimatedSandwichCount} sandwiches
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
              {filteredEvents.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <MapPin className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No events match your filters</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Edit Address Dialog */}
      <Dialog open={!!editingEvent} onOpenChange={(open) => {
        if (!open) {
          setEditingEvent(null);
          setEditedAddress('');
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Event Address</DialogTitle>
            <DialogDescription>
              Update the address for <strong>{editingEvent?.organizationName || 'this event'}</strong>. 
              Make sure the address is accurate for geocoding.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Event Address
              </label>
              <Textarea
                value={editedAddress}
                onChange={(e) => setEditedAddress(e.target.value)}
                placeholder="Enter full address (street, city, state, zip)"
                className="min-h-[100px]"
                data-testid="input-edit-address"
              />
              <p className="text-xs text-gray-500">
                Include street address, city, state, and ZIP code for best results
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingEvent(null);
                setEditedAddress('');
              }}
              data-testid="button-cancel-edit"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingEvent && editedAddress.trim()) {
                  updateAddressMutation.mutate({
                    eventId: editingEvent.id,
                    address: editedAddress.trim(),
                  });
                }
              }}
              disabled={!editedAddress.trim() || updateAddressMutation.isPending}
              data-testid="button-save-address"
            >
              {updateAddressMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Address
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
