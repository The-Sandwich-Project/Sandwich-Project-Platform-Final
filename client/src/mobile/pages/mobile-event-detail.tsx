import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  MapPin,
  Clock,
  Users,
  Phone,
  Mail,
  Sandwich,
  Navigation,
  Copy,
  Check,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useState } from 'react';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { copyToClipboard as copyText, openMaps as openAddressInMaps } from '../lib/native-actions';

/**
 * Parse a date string as a local date to avoid timezone shift issues.
 * Timestamps are stripped of their time component to avoid timezone shifts.
 */
function parseLocalDate(dateString: string): Date {
  if (!dateString) return new Date();

  // Extract just the date part (YYYY-MM-DD) from any format
  // This handles both YYYY-MM-DD and YYYY-MM-DDTHH:MM:SS formats
  const datePart = dateString.split('T')[0];
  const [yearStr, monthStr, dayStr] = datePart.split('-');

  // Create date at local midnight (not UTC midnight) to avoid timezone shifts
  return new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
}

/**
 * Mobile event detail screen - view event details
 */
export function MobileEventDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute('/events/:id');
  const eventId = params?.id;
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Fetch event details - use hierarchical queryKey for cache invalidation
  // with custom queryFn to fetch the correct single-event endpoint
  const { data: event, isLoading, error } = useQuery({
    queryKey: ['/api/event-requests', eventId],
    queryFn: async () => {
      const res = await fetch(`/api/event-requests/${eventId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch event');
      return res.json();
    },
    enabled: !!eventId,
    staleTime: 60000,
  });

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await copyText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const openMaps = (address: string) => openAddressInMaps(address);

  if (isLoading) {
    return (
      <MobileShell title="Event" showBack onBack={() => navigate('/events')}>
        <div className="p-4 space-y-4 animate-pulse">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
          <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded" />
        </div>
      </MobileShell>
    );
  }

  if (error || !event) {
    return (
      <MobileShell title="Event" showBack onBack={() => navigate('/events')}>
        <div className="p-4 text-center py-12">
          <p className="text-slate-500 dark:text-slate-400">Event not found</p>
          <button
            onClick={() => navigate('/events')}
            className="mt-4 px-6 py-2 bg-brand-primary text-white rounded-full font-medium"
          >
            Back to Events
          </button>
        </div>
      </MobileShell>
    );
  }

  const needsDrivers = (event.driversNeeded || 0) > (event.driversAssigned || 0);

  return (
    <MobileShell title="Event Details" showBack onBack={() => navigate('/events')}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            {event.organizationName || event.title || event.recipientName || 'Untitled Event'}
          </h1>

          {(getEffectiveEventDate(event)) && (
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <Calendar className="w-4 h-4" />
              <span>{format(parseLocalDate(getEffectiveEventDate(event)), 'EEEE, MMMM d, yyyy')}</span>
            </div>
          )}

          {event.eventStartTime && (
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mt-1">
              <Clock className="w-4 h-4" />
              <span>{event.eventStartTime}{event.eventEndTime ? ` - ${event.eventEndTime}` : ''}</span>
            </div>
          )}
        </div>

        {/* Driver Status */}
        <div className={cn(
          "rounded-xl p-4 border",
          needsDrivers
            ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700"
            : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className={cn(
                "w-5 h-5",
                needsDrivers
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-green-600 dark:text-green-400"
              )} />
              <span className={cn(
                "font-medium",
                needsDrivers
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-green-700 dark:text-green-300"
              )}>
                {event.driversAssigned || 0} / {event.driversNeeded || 0} Drivers
              </span>
            </div>
            {needsDrivers && (
              <span className="text-xs bg-amber-100 dark:bg-amber-800 text-amber-700 dark:text-amber-300 px-2 py-1 rounded-full">
                Needs drivers
              </span>
            )}
          </div>
        </div>

        {/* Location */}
        {(event.eventAddress || event.location) && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
              Location
            </h3>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 flex-1">
                <MapPin className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-900 dark:text-slate-100">{event.eventAddress || event.location}</span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => copyToClipboard(event.eventAddress || event.location, 'location')}
                  className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                >
                  {copiedField === 'location' ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => openMaps(event.eventAddress || event.location)}
                  className="p-2 rounded-lg bg-brand-primary text-white"
                >
                  <Navigation className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Contact Info */}
        {(event.firstName || event.phone || event.email) && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
              Contact
            </h3>
            <div className="space-y-2">
              {(event.firstName || event.lastName) && (
                <p className="text-slate-900 dark:text-slate-100 font-medium">
                  {event.firstName} {event.lastName}
                </p>
              )}
              {event.phone && (
                <a
                  href={`tel:${event.phone}`}
                  className="flex items-center gap-2 text-brand-primary"
                >
                  <Phone className="w-4 h-4" />
                  <span>{event.phone}</span>
                </a>
              )}
              {event.email && (
                <a
                  href={`mailto:${event.email}`}
                  className="flex items-center gap-2 text-brand-primary"
                >
                  <Mail className="w-4 h-4" />
                  <span>{event.email}</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Sandwiches */}
        {event.estimatedSandwichCount && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Sandwich className="w-5 h-5 text-brand-primary" />
              <span className="text-slate-900 dark:text-slate-100 font-medium">
                {event.estimatedSandwichCount} sandwiches estimated
              </span>
            </div>
          </div>
        )}

        {/* Message/Notes */}
        {event.message && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
              Message
            </h3>
            <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
              {event.message}
            </p>
          </div>
        )}
      </div>
    </MobileShell>
  );
}

export default MobileEventDetail;
