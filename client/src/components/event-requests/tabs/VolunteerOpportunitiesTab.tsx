import React, { useState, useMemo } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Phone,
  Mail,
  User,
  Info,
  Sandwich,
  LayoutGrid,
  Map as MapIcon,
  Truck,
  Mic,
  HandHeart,
  Check,
  CheckCircle2,
  CalendarDays,
} from 'lucide-react';
import { format } from 'date-fns';
import type { EventRequest } from '@shared/schema';
import { parseSandwichTypes } from '@/lib/sandwich-utils';
import { EventCalendarView } from '@/components/event-calendar-view';
import { VolunteerOpportunitiesMap } from './VolunteerOpportunitiesMap';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

// Brand palette (tokens from tailwind.config.ts → brand.*)
const BRAND = {
  primary: '#236383',       // deep navy-teal
  primaryDark: '#1A2332',   // near-black ink
  teal: '#236383',          // mid teal
  tealLight: '#47B3CB',     // bright accent
  burgundy: '#A31C41',      // speaker accent
  amber: '#F59E0B',         // van driver accent
  surface: '#FAF8F4',       // paper tone
};

type RoleFilter = 'all' | 'volunteer' | 'driver';
type ViewMode = 'card' | 'calendar' | 'map';

export const VolunteerOpportunitiesTab: React.FC = () => {
  const { user } = useAuth();
  const { eventRequests } = useEventRequestContext();
  const { handleSelfSignup, canSelfSignup, resolveUserName } = useEventAssignments();

  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  // Helper to calculate unfilled needs for an event
  const getUnfilledNeeds = (request: EventRequest) => {
    const volunteersNeededCount = request.volunteersNeeded ?? 0;
    const volunteersAssignedCount = request.assignedVolunteerIds?.length || 0;
    const needsVolunteer = volunteersNeededCount > volunteersAssignedCount;

    const driversNeededCount = request.driversNeeded ?? 0;
    const driversAssignedCount =
      (request.assignedDriverIds?.length || 0) +
      (request.assignedVanDriverId ? 1 : 0) +
      (request.isDhlVan ? 1 : 0);
    const needsDriver = driversNeededCount > driversAssignedCount;

    const needsVanDriver = !!(
      request.vanDriverNeeded &&
      !request.assignedVanDriverId &&
      !request.isDhlVan
    );

    return {
      needsVolunteer,
      needsDriver,
      needsVanDriver,
      volunteersNeededCount,
      volunteersAssignedCount,
      driversNeededCount,
      driversAssignedCount,
    };
  };

  // Filter events that need volunteers or drivers
  const opportunities = useMemo(() => {
    return eventRequests
      .filter((request: EventRequest) => isScheduledOrRescheduled(request.status))
      .filter((request: EventRequest) => {
        const { needsVolunteer, needsDriver, needsVanDriver } =
          getUnfilledNeeds(request);

        if (roleFilter === 'volunteer' && !needsVolunteer) return false;
        if (roleFilter === 'driver' && !needsDriver && !needsVanDriver) return false;

        return needsVolunteer || needsDriver || needsVanDriver;
      })
      .sort((a: EventRequest, b: EventRequest) => {
        const dateA = getEffectiveEventDate(a);
        const dateB = getEffectiveEventDate(b);
        const timeA = dateA ? new Date(dateA).getTime() : 0;
        const timeB = dateB ? new Date(dateB).getTime() : 0;
        return timeA - timeB;
      });
  }, [eventRequests, roleFilter]);

  // Counts for filter chips
  const counts = useMemo(() => {
    const scheduled = eventRequests.filter(
      (r: EventRequest) => isScheduledOrRescheduled(r.status),
    );
    let volunteer = 0;
    let driver = 0;
    scheduled.forEach((r: EventRequest) => {
      const n = getUnfilledNeeds(r);
      if (n.needsVolunteer) volunteer++;
      if (n.needsDriver || n.needsVanDriver) driver++;
    });
    const all = scheduled.filter((r) => {
      const n = getUnfilledNeeds(r);
      return n.needsVolunteer || n.needsDriver || n.needsVanDriver;
    }).length;
    return { all, volunteer, driver };
  }, [eventRequests]);

  const formatEventDate = (request: EventRequest) => {
    const date = getEffectiveEventDate(request);
    if (!date) return null;
    try {
      const dateStr = typeof date === 'string' ? date : String(date);
      const datePart = dateStr.split('T')[0];
      const [year, month, day] = datePart.split('-').map(Number);
      const localDate =
        year && month && day ? new Date(year, month - 1, day) : new Date(date);
      return {
        weekday: format(localDate, 'EEEE'),
        long: format(localDate, 'MMMM d, yyyy'),
        month: format(localDate, 'MMM').toUpperCase(),
        day: format(localDate, 'd'),
      };
    } catch {
      return null;
    }
  };

  const getSandwichSummary = (request: EventRequest) => {
    if (!request.sandwichTypes) return null;
    const types = parseSandwichTypes(request.sandwichTypes);
    if (!types.length) return null;
    const total = types.reduce((sum, type) => sum + type.quantity, 0);
    if (types.length === 1) return `${types[0].quantity} ${types[0].type}`;
    return `${total.toLocaleString()} sandwiches`;
  };

  // -------- Reusable bits --------
  const FilterChip = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all',
        active
          ? 'text-white border-transparent shadow-sm'
          : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50',
      )}
      style={active ? { backgroundColor: BRAND.primary } : undefined}
    >
      {children}
    </button>
  );

  const ViewToggleButton = ({
    active,
    onClick,
    icon: Icon,
    label,
  }: {
    active: boolean;
    onClick: () => void;
    icon: typeof LayoutGrid;
    label: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all',
        active ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900',
      )}
      style={active ? { color: BRAND.primary } : undefined}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  return (
    <div className="space-y-5 max-w-full">
      {/* Header + Filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Title + count */}
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${BRAND.teal}15` }}
            >
              <HandHeart className="w-5 h-5" style={{ color: BRAND.teal }} />
            </div>
            <div>
              <h2 className="text-lg font-bold leading-tight" style={{ color: BRAND.primaryDark }}>
                Volunteer Opportunities
              </h2>
              <p className="text-sm text-gray-500 leading-tight mt-0.5">
                {counts.all === 0
                  ? 'No open spots right now'
                  : `${counts.all} ${counts.all === 1 ? 'event needs' : 'events need'} your help`}
              </p>
            </div>
          </div>

          {/* View toggle */}
          <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-lg self-start lg:self-auto">
            <ViewToggleButton
              active={viewMode === 'card'}
              onClick={() => setViewMode('card')}
              icon={LayoutGrid}
              label="Cards"
            />
            <ViewToggleButton
              active={viewMode === 'calendar'}
              onClick={() => setViewMode('calendar')}
              icon={CalendarDays}
              label="Calendar"
            />
            <ViewToggleButton
              active={viewMode === 'map'}
              onClick={() => setViewMode('map')}
              icon={MapIcon}
              label="Map"
            />
          </div>
        </div>

        {/* Role chips */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 mr-1">
            Show
          </span>
          <FilterChip active={roleFilter === 'all'} onClick={() => setRoleFilter('all')}>
            All openings
            <span
              className={cn(
                'ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold',
                roleFilter === 'all' ? 'bg-white/25' : 'bg-gray-100 text-gray-600',
              )}
            >
              {counts.all}
            </span>
          </FilterChip>
          <FilterChip
            active={roleFilter === 'volunteer'}
            onClick={() => setRoleFilter('volunteer')}
          >
            <Users className="w-3.5 h-3.5" />
            Volunteers
            <span
              className={cn(
                'ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold',
                roleFilter === 'volunteer' ? 'bg-white/25' : 'bg-gray-100 text-gray-600',
              )}
            >
              {counts.volunteer}
            </span>
          </FilterChip>
          <FilterChip
            active={roleFilter === 'driver'}
            onClick={() => setRoleFilter('driver')}
          >
            <Truck className="w-3.5 h-3.5" />
            Drivers
            <span
              className={cn(
                'ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold',
                roleFilter === 'driver' ? 'bg-white/25' : 'bg-gray-100 text-gray-600',
              )}
            >
              {counts.driver}
            </span>
          </FilterChip>
        </div>
      </div>

      {/* Body */}
      {viewMode === 'calendar' ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <EventCalendarView
            events={opportunities}
            filterByNeeds={true}
            hideSelfTransport={false}
            onEventClick={(event) => {
              setViewMode('card');
              setTimeout(() => {
                const cardElement = document.querySelector(
                  `[data-event-id="${event.id}"]`,
                );
                if (cardElement) {
                  cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 100);
            }}
          />
        </div>
      ) : viewMode === 'map' ? (
        <div
          className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
          style={{ height: 'calc(100vh - 300px)', minHeight: '500px' }}
        >
          <VolunteerOpportunitiesMap
            events={opportunities}
            onEventClick={(event) => {
              setViewMode('card');
              setTimeout(() => {
                const cardElement = document.querySelector(
                  `[data-event-id="${event.id}"]`,
                );
                if (cardElement) {
                  cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 100);
            }}
          />
        </div>
      ) : opportunities.length === 0 ? (
        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="py-16 text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: `${BRAND.teal}10` }}
            >
              <CheckCircle2 className="w-8 h-8" style={{ color: BRAND.teal }} />
            </div>
            <p className="text-base font-semibold" style={{ color: BRAND.primaryDark }}>
              {roleFilter === 'all'
                ? 'All set — no open spots right now'
                : `No ${roleFilter} openings right now`}
            </p>
            <p className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto">
              Every scheduled event has its roles filled. Check back soon — new
              opportunities post regularly.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {opportunities.map((request: EventRequest) => {
            const needs = getUnfilledNeeds(request);
            const { needsVolunteer, needsDriver, needsVanDriver } = needs;

            const speakerDetails = request.speakerDetails || {};
            const isVolunteerSignedUp = user?.id
              ? (request.assignedVolunteerIds || []).includes(user.id)
              : false;
            const isDriverSignedUp = user?.id
              ? (request.assignedDriverIds || []).includes(user.id) ||
                request.assignedVanDriverId === user.id
              : false;

            const dateInfo = formatEventDate(request);
            const sandwichSummary = getSandwichSummary(request);
            const sandwichCount =
              request.estimatedSandwichCount || sandwichSummary;

            const hasAssigned =
              Object.keys(speakerDetails).length > 0 ||
              (request.assignedVolunteerIds?.length || 0) > 0 ||
              (request.assignedDriverIds?.length || 0) > 0 ||
              !!request.assignedVanDriverId ||
              request.isDhlVan;

            return (
              <Card
                key={request.id}
                data-event-id={request.id}
                className="bg-white border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all overflow-hidden rounded-xl shadow-sm"
              >
                {/* Top accent bar */}
                <div className="h-1" style={{ backgroundColor: BRAND.teal }} />

                <CardContent className="p-0">
                  {/* Header: date stamp + org */}
                  <div className="flex gap-4 p-5 pb-4">
                    {/* Date stamp */}
                    {dateInfo && (
                      <div
                        className="shrink-0 w-14 rounded-lg border overflow-hidden text-center"
                        style={{ borderColor: `${BRAND.teal}30` }}
                      >
                        <div
                          className="text-[10px] font-bold tracking-wider text-white py-1"
                          style={{ backgroundColor: BRAND.teal }}
                        >
                          {dateInfo.month}
                        </div>
                        <div
                          className="text-2xl font-bold py-1.5 leading-none"
                          style={{ color: BRAND.primaryDark }}
                        >
                          {dateInfo.day}
                        </div>
                      </div>
                    )}

                    {/* Title + meta */}
                    <div className="flex-1 min-w-0">
                      <h3
                        className="text-base sm:text-lg font-bold leading-snug break-words"
                        style={{ color: BRAND.primaryDark }}
                      >
                        {request.organizationName}
                      </h3>
                      {request.department && (
                        <p className="text-sm text-gray-500 mt-0.5 truncate">
                          {request.department}
                        </p>
                      )}

                      {dateInfo && (
                        <div className="flex items-center gap-1.5 text-sm text-gray-600 mt-2">
                          <Calendar className="w-3.5 h-3.5 shrink-0" style={{ color: BRAND.teal }} />
                          <span className="font-medium">{dateInfo.weekday}</span>
                          {request.eventTime && (
                            <>
                              <span className="text-gray-300">·</span>
                              <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: BRAND.teal }} />
                              <span>{request.eventTime}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {request.isConfirmed && (
                      <div className="shrink-0">
                        <Badge
                          className="text-white border-transparent text-[11px] font-semibold px-2 py-1"
                          style={{ backgroundColor: BRAND.teal }}
                        >
                          <Check className="w-3 h-3 mr-0.5" />
                          Confirmed
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Meta row: location + sandwiches */}
                  {(request.location || sandwichCount) && (
                    <div className="px-5 pb-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600">
                      {request.location && (
                        <div className="flex items-start gap-1.5 min-w-0 flex-1">
                          <MapPin
                            className="w-3.5 h-3.5 mt-0.5 shrink-0"
                            style={{ color: BRAND.teal }}
                          />
                          <span className="break-words">{request.location}</span>
                        </div>
                      )}
                      {sandwichCount && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Sandwich className="w-3.5 h-3.5" style={{ color: BRAND.teal }} />
                          <span className="font-medium">
                            {typeof sandwichCount === 'number'
                              ? `${sandwichCount.toLocaleString()} sandwiches`
                              : sandwichCount}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Open roles section */}
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2.5">
                      Roles still open
                    </div>
                    <div className="space-y-2">
                      {needsVolunteer && (
                        <RoleRow
                          icon={Users}
                          color={BRAND.teal}
                          label="Volunteer"
                          ctaLabel="Sign up as Volunteer"
                          signedUpLabel="Signed up as Volunteer"
                          assigned={needs.volunteersAssignedCount}
                          needed={needs.volunteersNeededCount}
                          signedUp={isVolunteerSignedUp}
                          disabled={!canSelfSignup(request, 'volunteer')}
                          onSignup={() => handleSelfSignup(request.id, 'volunteer')}
                        />
                      )}
                      {needsVanDriver && (
                        <RoleRow
                          icon={Truck}
                          color={BRAND.amber}
                          label="Van Driver"
                          ctaLabel="Sign up as Van Driver"
                          signedUpLabel="Signed up as Van Driver"
                          assigned={0}
                          needed={1}
                          signedUp={isDriverSignedUp}
                          disabled={!canSelfSignup(request, 'driver')}
                          onSignup={() => handleSelfSignup(request.id, 'driver')}
                          highlight
                        />
                      )}
                      {needsDriver && !needsVanDriver && (
                        <RoleRow
                          icon={Truck}
                          color={BRAND.primary}
                          label="Driver"
                          ctaLabel="Sign up as Driver"
                          signedUpLabel="Signed up as Driver"
                          assigned={needs.driversAssignedCount}
                          needed={needs.driversNeededCount}
                          signedUp={isDriverSignedUp}
                          disabled={!canSelfSignup(request, 'driver')}
                          onSignup={() => handleSelfSignup(request.id, 'driver')}
                        />
                      )}
                    </div>
                  </div>

                  {/* Planning notes — collapsed-look soft block */}
                  {request.planningNotes && (
                    <div className="px-5 py-3 border-t border-gray-100">
                      <div className="flex items-start gap-2">
                        <Info
                          className="w-4 h-4 mt-0.5 shrink-0"
                          style={{ color: BRAND.tealLight }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                            Notes from the host
                          </div>
                          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                            {request.planningNotes}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Footer: contact + assigned people */}
                  {(request.name || request.email || request.phone || hasAssigned) && (
                    <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-600">
                      {request.name && (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-gray-400" />
                          <span className="font-medium text-gray-700">{request.name}</span>
                        </div>
                      )}
                      {request.email && (
                        <a
                          href={`mailto:${request.email}`}
                          className="flex items-center gap-1.5 hover:underline"
                          style={{ color: BRAND.primary }}
                        >
                          <Mail className="w-3.5 h-3.5" />
                          <span className="break-all">{request.email}</span>
                        </a>
                      )}
                      {request.phone && (
                        <a
                          href={`tel:${request.phone}`}
                          className="flex items-center gap-1.5 hover:underline"
                          style={{ color: BRAND.primary }}
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>{request.phone}</span>
                        </a>
                      )}
                      {hasAssigned && (
                        <div className="w-full flex flex-wrap gap-x-4 gap-y-1 pt-2 mt-1 border-t border-gray-200/70">
                          {Object.keys(speakerDetails).length > 0 && (
                            <span>
                              <span className="font-semibold text-gray-700">Speakers:</span>{' '}
                              {Object.keys(speakerDetails)
                                .map((id) => resolveUserName(id))
                                .join(', ')}
                            </span>
                          )}
                          {(request.assignedVolunteerIds?.length || 0) > 0 && (
                            <span>
                              <span className="font-semibold text-gray-700">Volunteers:</span>{' '}
                              {request.assignedVolunteerIds
                                ?.map((id) => resolveUserName(id))
                                .join(', ')}
                            </span>
                          )}
                          {((request.assignedDriverIds?.length || 0) > 0 ||
                            request.assignedVanDriverId ||
                            request.isDhlVan) && (
                            <span>
                              <span className="font-semibold text-gray-700">Drivers:</span>{' '}
                              {[
                                ...(request.assignedDriverIds || []).map((id) =>
                                  resolveUserName(id),
                                ),
                                ...(request.assignedVanDriverId
                                  ? [resolveUserName(request.assignedVanDriverId) + ' (Van)']
                                  : []),
                                ...(request.isDhlVan ? ['DHL Van'] : []),
                              ].join(', ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

// -------- Role row sub-component --------
interface RoleRowProps {
  icon: typeof Mic;
  color: string;
  label: string;
  assigned: number;
  needed: number;
  signedUp: boolean;
  disabled: boolean;
  onSignup: () => void;
  highlight?: boolean;
}

const RoleRow: React.FC<RoleRowProps> = ({
  icon: Icon,
  color,
  label,
  assigned,
  needed,
  signedUp,
  disabled,
  onSignup,
  highlight = false,
}) => {
  const remaining = Math.max(0, needed - assigned);
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-2.5 rounded-lg border bg-white',
        highlight && 'ring-1',
      )}
      style={{
        borderColor: `${color}30`,
        ...(highlight ? { boxShadow: `0 0 0 1px ${color}25` } : {}),
      }}
    >
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15`, color }}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold leading-tight" style={{ color: '#1A2332' }}>
          {label}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {needed > 0
            ? `${assigned} of ${needed} signed up · ${remaining} ${
                remaining === 1 ? 'spot' : 'spots'
              } open`
            : 'Open'}
        </div>
      </div>
      <Button
        size="sm"
        onClick={onSignup}
        disabled={signedUp || disabled}
        className={cn(
          'shrink-0 h-8 px-3 text-xs font-semibold rounded-md',
          signedUp && 'cursor-default',
        )}
        style={
          signedUp
            ? { backgroundColor: '#E5E7EB', color: '#4B5563' }
            : { backgroundColor: color, color: 'white' }
        }
      >
        {signedUp ? (
          <>
            <Check className="w-3.5 h-3.5 mr-1" />
            Signed up
          </>
        ) : (
          <>Sign up</>
        )}
      </Button>
    </div>
  );
};
