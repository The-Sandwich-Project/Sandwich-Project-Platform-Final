import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEventQueries } from '../hooks/useEventQueries';
import { useReturningOrganization } from '@/hooks/use-returning-organization';
import { getEventRequestSourceIndicator } from '@/lib/event-request-source';
import EventEmailLogDisplay from '@/components/event-email-log-display';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDistanceToNow } from 'date-fns';
import {
  Calendar,
  Clock,
  Package,
  Phone,
  Mail,
  Edit,
  Trash2,
  Users,
  MapPin,
  UserPlus,
  Building,
  AlertTriangle,
  CalendarCheck,
  Edit2,
  Save,
  X,
  User,
  History,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Sparkles,
  CheckCircle,
  RefreshCw,
  Lock,
  Unlock,
  Ban,
  Globe,
  FileText,
  Copy,
} from 'lucide-react';
import { statusIcons, statusOptions, statusBorderColors, indicatorTooltips } from '@/components/event-requests/constants';
import { formatEventDate } from '@/components/event-requests/utils';
import { TrafficConflictBadge } from '@/components/event-requests/TrafficConflictBadge';
import { useDatePopulation, type DatePopulationInfo } from '@/components/event-requests/hooks/useDatePopulation';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import { formatSandwichTypesDisplay } from '@/lib/sandwich-utils';
import { getPrimaryContextualAction, getContextualTooltip } from '@/lib/contextual-actions';
import { useEventRequestContext } from '../context/EventRequestContext';
import type { EventRequest } from '@shared/schema';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@shared/unified-auth-utils';
import { PERMISSIONS } from '@shared/auth-utils';
import { EventRequestAuditLog } from '@/components/event-request-audit-log';
import { ReminderRulesManager } from '@/components/event-requests/ReminderRulesManager';
import { MessageComposer } from '@/components/message-composer';
import { useToast } from '@/hooks/use-toast';
import { useEventCollaboration } from '@/hooks/use-event-collaboration';
import { CommentThread, CompactPresenceBadge } from '@/components/collaboration';
import { applyPatchResponseToCache } from '@/lib/queryClient';
import { patchEventRequestVerified } from '@/lib/event-save-verification';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { InfoBadge, CardActionRow, ActionRowSpacer } from './card-ui';

interface NewRequestCardProps {
  request: EventRequest;
  onEdit: () => void;
  onDelete: () => void;
  onCall?: () => void;
  onIntakeCall?: () => void;
  onContact: () => void;
  /** Opens the LOGGING dialog — record that the toolkit was already
   *  sent (date/time + optional call notes) and move event to In Process. */
  onToolkit: () => void;
  /** Opens the email composer directly to ACTUALLY send the toolkit
   *  right now. Send-time becomes the toolkit-sent timestamp and the
   *  event moves to In Process automatically. */
  onSendToolkit?: () => void;
  onScheduleCall: () => void;
  onAssignTspContact: () => void;
  onEditTspContact: () => void;
  onApprove: () => void;
  onDecline: () => void;
  onNonEvent?: () => void;
  onDuplicate?: () => void;
  onLogContact: () => void;
  onAiSuggest?: () => void;
  onAiIntakeAssist?: () => void;
  onAddNextAction?: () => void;
  onEditNextAction?: () => void;
  onCompleteNextAction?: () => void;
  onToggleCorporatePriority?: (isCorporatePriority: boolean) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  // Inline editing props
  startEditing?: (field: string, value: string) => void;
  saveEdit?: () => void;
  cancelEdit?: () => void;
  setEditingValue?: (value: string) => void;
  isEditingThisCard?: boolean;
  editingField?: string;
  editingValue?: string;
  tempIsConfirmed?: boolean;
}

interface User {
  id: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email: string;
  role?: string;
}

// Helper to linkify addresses in text
// Matches patterns like "123 Main St" or "123 Main Street, City, ST 12345"
const LinkifyAddresses: React.FC<{ text: string | null | undefined }> = ({ text }) => {
  // Handle null/undefined text
  if (!text) {
    return null;
  }

  // Regex to match common US address patterns
  // Matches: number + street name (+ optional suite/apt) + optional city, state zip
  const addressRegex = /(\d+\s+[\w\s]+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Way|Pl(?:ace)?|Ct|Court|Cir(?:cle)?|Pkwy|Parkway|Hwy|Highway)\.?(?:\s*(?:#|Suite|Ste|Apt|Unit)\s*[\w-]+)?(?:\s*,?\s*[\w\s]+,?\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)?)/gi;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  // Reset regex state
  addressRegex.lastIndex = 0;

  while ((match = addressRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    // Add the address as a link
    const address = match[1];
    parts.push(
      <a
        key={match.index}
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#236383] hover:text-[#1a4a63] underline"
      >
        {address}
      </a>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If no addresses found, return original text
  if (parts.length === 0) {
    return <>{text}</>;
  }

  return <>{parts}</>;
};

// CardHeader component - copied from shared
interface CardHeaderProps {
  request: EventRequest;
  isInProcessStale?: boolean;
  canEdit?: boolean;
  isEditingThisCard?: boolean;
  editingField?: string;
  editingValue?: string;
  startEditing?: (field: string, value: string) => void;
  saveEdit?: () => void;
  cancelEdit?: () => void;
  setEditingValue?: (value: string) => void;
  handleConfirmToggleClick?: () => void;
  presentUsers?: Array<{ userId: string; userName: string; joinedAt: Date; lastHeartbeat: Date; socketId: string }>;
  currentUserId?: string;
  datePopulationInfo?: DatePopulationInfo;
  returningOrgData?: {
    isReturning: boolean;
    isReturningContact: boolean;
    pastEventCount: number;
    collectionCount: number;
    pastDepartments?: string[];
    mostRecentEvent?: {
      id: number;
      eventDate: string | null;
      status: string | null;
    };
    mostRecentCollection?: {
      id: number;
      dateCollected: string | null;
    };
    pastContactName?: string;
    contactPastOrgs?: string[];
    orgSimilarityScore?: number;
  };
}

const CardHeader: React.FC<CardHeaderProps> = ({
  request,
  isInProcessStale,
  canEdit = false,
  isEditingThisCard = false,
  editingField = '',
  editingValue = '',
  startEditing,
  saveEdit,
  cancelEdit,
  setEditingValue,
  handleConfirmToggleClick,
  presentUsers = [],
  currentUserId = '',
  datePopulationInfo,
  returningOrgData,
}) => {
  const { setViewMode } = useEventRequestContext();
  const StatusIcon = statusIcons[request.status as keyof typeof statusIcons] || statusIcons.new;
  
  // Get the proper status label from constants instead of just replacing underscores
  const getStatusLabel = (status: string) => {
    const statusOption = statusOptions.find(option => option.value === status);
    return statusOption ? statusOption.label : status.replace('_', ' ');
  };

  // Hide requested date once there's a scheduled date (keep requested date in database but don't display)
  const displayDate = getEffectiveEventDate(request);

  // Format the date for display
  const dateInfo = displayDate ? formatEventDate(displayDate.toString()) : null;

  // Calculate if date is past (compare dates in local timezone, not UTC)
  const isPast = (() => {
    if (!displayDate) return false;
    // Parse the event date as midnight local time (not UTC)
    const eventDate = new Date(displayDate + 'T00:00:00');
    // Get today's date at midnight local time
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Event is past if the event date is before today
    return eventDate < today;
  })();

  // Calculate relative time
  const getRelativeTime = (dateString: string) => {
    // Fix timezone issue by treating both dates as local
    const date = new Date(dateString + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day for fair comparison
    
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 0 && diffDays <= 7) return `In ${diffDays} days`;
    if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
    return '';
  };

  // Determine the date label and field to edit based on what date we're showing
  let dateLabel = 'Requested Date';
  let dateFieldToEdit = 'desiredEventDate';
  if (request.scheduledEventDate) {
    dateFieldToEdit = 'scheduledEventDate';
    if (request.status === 'completed') {
      dateLabel = 'Event Date';
    } else {
      dateLabel = 'Scheduled Date';
    }
  }

  // Parse date string safely without timezone issues
  const parseLocalDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  // Format date for input (YYYY-MM-DD)
  const formatDateForInput = (dateStr: string) => {
    if (!dateStr) return '';
    return dateStr.split('T')[0]; // Remove time part if present
  };

  // Check if we're editing this date field
  const isEditingDate = isEditingThisCard && editingField === dateFieldToEdit;

  return (
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-start space-x-3 min-w-0 flex-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Real-time Presence Indicator */}
            {presentUsers && presentUsers.length > 0 && currentUserId && (
              <CompactPresenceBadge 
                users={presentUsers} 
                currentUserId={currentUserId}
                className="mr-1"
              />
            )}
            <h3 className="text-lg sm:text-xl font-bold text-[#236383] break-words min-w-0">
              {request.organizationName}
              {request.department && (
                <span className="text-base sm:text-lg font-normal text-gray-600 ml-2">
                  &bull; {request.department}
                </span>
              )}
            </h3>
            {/* Returning Organization Indicator - two-tier: same contact vs new contact */}
            {returningOrgData?.isReturning && (() => {
              // Determine most recent activity date (event or collection, whichever is later)
              const eventDate = returningOrgData.mostRecentEvent?.eventDate ? new Date(returningOrgData.mostRecentEvent.eventDate) : null;
              const collectionDate = returningOrgData.mostRecentCollection?.dateCollected ? new Date(returningOrgData.mostRecentCollection.dateCollected) : null;
              const lastDate = eventDate && collectionDate
                ? (eventDate > collectionDate ? eventDate : collectionDate)
                : eventDate || collectionDate;
              const lastDateLabel = lastDate && !isNaN(lastDate.getTime())
                ? lastDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : null;
              return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={`whitespace-nowrap cursor-help ${
                      returningOrgData.isReturningContact
                        ? 'bg-purple-50 text-purple-700 border-purple-300'
                        : (request.email || request.firstName || request.lastName || request.phone)
                          ? 'bg-amber-50 text-amber-700 border-amber-300'
                          : 'bg-gray-50 text-gray-600 border-gray-300'
                    }`}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Returning Org
                    {lastDateLabel && (
                      <span className="ml-1 text-xs opacity-80">&middot; Last: {lastDateLabel}</span>
                    )}
                    {returningOrgData.isReturningContact
                      ? <span className="ml-1 text-xs opacity-80">&middot; Same Contact</span>
                      : (request.email || request.firstName || request.lastName || request.phone)
                        ? <span className="ml-1 text-xs opacity-80">&middot; New Contact</span>
                        : null
                    }
                    {returningOrgData.pastEventCount > 0 && (
                      <span className="ml-1 text-xs opacity-80">
                        ({returningOrgData.pastEventCount} past event{returningOrgData.pastEventCount !== 1 ? 's' : ''})
                      </span>
                    )}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-medium">This organization has worked with us before!</p>
                    {returningOrgData.pastEventCount > 0 && (
                      <p className="text-sm">
                        {returningOrgData.pastEventCount} previous event{returningOrgData.pastEventCount !== 1 ? 's' : ''} on file
                      </p>
                    )}
                    {returningOrgData.collectionCount > 0 && (
                      <p className="text-sm">
                        {returningOrgData.collectionCount} sandwich collection{returningOrgData.collectionCount !== 1 ? 's' : ''} recorded
                      </p>
                    )}
                    {returningOrgData.mostRecentEvent && (
                      <p className="text-xs text-muted-foreground">
                        Most recent: {returningOrgData.mostRecentEvent.eventDate
                          ? new Date(returningOrgData.mostRecentEvent.eventDate).toLocaleDateString()
                          : 'Date unknown'}
                        {returningOrgData.mostRecentEvent.status && ` (${returningOrgData.mostRecentEvent.status})`}
                      </p>
                    )}
                    {returningOrgData.pastDepartments && returningOrgData.pastDepartments.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Past department{returningOrgData.pastDepartments.length !== 1 ? 's' : ''}: {returningOrgData.pastDepartments.join(', ')}
                      </p>
                    )}
                    {returningOrgData.isReturningContact ? (
                      <p className="text-xs text-purple-600 font-medium mt-2">
                        Same contact as a previous event &mdash; personalize your outreach!
                      </p>
                    ) : (request.email || request.firstName || request.lastName || request.phone) ? (
                      <div className="mt-2">
                        {returningOrgData.pastContactName && (
                          <p className="text-xs text-muted-foreground">
                            Past contact: {returningOrgData.pastContactName}
                          </p>
                        )}
                        <p className="text-xs text-amber-600 font-medium">
                          New contact for this org &mdash; treat as a first-time outreach
                        </p>
                      </div>
                    ) : (
                      <div className="mt-2">
                        {returningOrgData.pastContactName && (
                          <p className="text-xs text-muted-foreground">
                            Past contact: {returningOrgData.pastContactName}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 font-medium">
                          No contact information provided for this request
                        </p>
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
              );
            })()}
            {/* Returning Contact badge - shows when the contact person has submitted before but org didn't match */}
            {!returningOrgData?.isReturning && returningOrgData?.isReturningContact && (() => {
              const likelySameOrg = returningOrgData.orgSimilarityScore && returningOrgData.orgSimilarityScore >= 0.7;
              return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={`whitespace-nowrap cursor-help ${
                      likelySameOrg
                        ? 'bg-orange-50 text-orange-700 border-orange-300'
                        : 'bg-purple-50 text-purple-700 border-purple-300'
                    }`}
                  >
                    <User className="w-3 h-3 mr-1" />
                    Returning Contact
                    {likelySameOrg
                      ? <span className="ml-1 text-xs opacity-80">&middot; Likely Same Org</span>
                      : <span className="ml-1 text-xs opacity-80">&middot; Different Org</span>
                    }
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-medium">This contact has submitted a request before!</p>
                    {returningOrgData.contactPastOrgs && returningOrgData.contactPastOrgs.length > 0 && (
                      <p className="text-sm">
                        Previously submitted under: {returningOrgData.contactPastOrgs.join(', ')}
                      </p>
                    )}
                    {likelySameOrg ? (
                      <p className="text-xs text-orange-600 font-medium mt-2">
                        The org name is similar to a past submission &mdash; likely the same organization with a slightly different name. Consider updating the org name on one to match.
                      </p>
                    ) : (
                      <p className="text-xs text-purple-600 font-medium mt-2">
                        Same person, different organization &mdash; personalize your outreach!
                      </p>
                    )}
                    {returningOrgData.pastContactName && (
                      <p className="text-xs text-muted-foreground">
                        Past name on file: {returningOrgData.pastContactName}
                      </p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
              );
            })()}
            {/* New Department Indicator - shows when returning org has a department not seen in past events */}
            {returningOrgData?.isReturning && request.department && returningOrgData.pastDepartments && returningOrgData.pastDepartments.length > 0 && !returningOrgData.pastDepartments.some(
              d => d === (request.department || '').trim().replace(/\s+/g, ' ').toLowerCase()
            ) && (
              <Badge
                variant="outline"
                className="whitespace-nowrap bg-blue-50 text-blue-700 border-blue-300"
              >
                New Department
              </Badge>
            )}
            {/* Partner Organizations */}
            {request.partnerOrganizations && Array.isArray(request.partnerOrganizations) && request.partnerOrganizations.length > 0 && (
              <div className="text-base sm:text-lg text-gray-600 mt-1">
                <span className="font-medium">Partner:</span>{' '}
                {request.partnerOrganizations.map((partner, index) => (
                  <span key={index}>
                    {partner.name}
                    {partner.department && ` • ${partner.department}`}
                    {index < request.partnerOrganizations.length - 1 && ', '}
                  </span>
                ))}
              </div>
            )}
            {isInProcessStale && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 whitespace-nowrap cursor-help">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Needs follow-up
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{indicatorTooltips.needsFollowUp}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Corporate Priority Badge - Display only (toggle via edit form) */}
            {(request as any).isCorporatePriority && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    className="px-2.5 py-1 text-sm font-medium shadow-sm inline-flex items-center whitespace-nowrap bg-gradient-to-br from-[#B8860B] to-[#DAA520] text-white"
                  >
                    <Building className="w-3 h-3 mr-1" />
                    Corporate
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-medium">This is a Corporate Event</p>
                    <p className="text-sm">Requires immediate contact and core team member attendance.</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Traffic conflict (e.g. World Cup matches). Prefer the scheduled
                date once set so a rescheduled event doesn't keep a stale badge
                from its original desiredEventDate. */}
            <TrafficConflictBadge
              dates={[getEffectiveEventDate(request)]}
            />
          </div>
          <div className="text-sm text-[#007E8C] mt-1 space-y-1">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {isEditingDate ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{dateLabel}:</span>
                  <Input
                    type="date"
                    value={formatDateForInput(editingValue)}
                    onChange={(e) => setEditingValue?.(e.target.value)}
                    className="h-8 w-40"
                    autoFocus
                    data-testid="input-date"
                  />
                  <Button size="sm" onClick={saveEdit} data-testid="button-save-date">
                    <Save className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} data-testid="button-cancel-date">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group flex-wrap">
                  <span data-testid="text-date-label" className="text-sm uppercase text-gray-600">
                    {dateLabel}: {' '}
                    <strong className="text-base font-bold text-[#236383]" data-testid="text-date-value">
                      {displayDate && dateInfo ? dateInfo.text : 'No date set'}
                    </strong>
                    {displayDate && getRelativeTime(displayDate.toString()) && (
                      <span className="text-[#007E8C] ml-1">({getRelativeTime(displayDate.toString())})</span>
                    )}
                  </span>
                  {/* Date Population Badges */}
                  {datePopulationInfo && datePopulationInfo.isOpen && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <InfoBadge tone="info" icon={CalendarCheck} className="text-xs cursor-help">
                          Open date
                        </InfoBadge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{indicatorTooltips.openDate}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {datePopulationInfo && datePopulationInfo.scheduledCount > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <InfoBadge
                          tone="attention"
                          icon={AlertTriangle}
                          className="text-xs cursor-pointer hover:opacity-80"
                          onClick={(e) => { e.stopPropagation(); setViewMode('calendar'); }}
                        >
                          {datePopulationInfo.scheduledCount} scheduled
                        </InfoBadge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{indicatorTooltips.scheduledConflict}</p>
                        <p className="text-xs text-muted-foreground mt-1">{datePopulationInfo.scheduledCount} event{datePopulationInfo.scheduledCount > 1 ? 's' : ''} on this date</p>
                        <p className="text-xs text-blue-500 mt-1 font-medium">Click to view calendar</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {datePopulationInfo && datePopulationInfo.inProcessCount > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <InfoBadge
                          tone="info"
                          icon={Calendar}
                          className="text-xs cursor-pointer hover:opacity-80"
                          onClick={(e) => { e.stopPropagation(); setViewMode('calendar'); }}
                        >
                          {datePopulationInfo.inProcessCount} in process
                        </InfoBadge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{indicatorTooltips.inProcessConflict}</p>
                        <p className="text-xs text-muted-foreground mt-1">{datePopulationInfo.inProcessCount} event{datePopulationInfo.inProcessCount > 1 ? 's' : ''} on this date</p>
                        <p className="text-xs text-blue-500 mt-1 font-medium">Click to view calendar</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {/* Date Flexibility Indicator - only show when explicitly set */}
                  {displayDate && request.dateFlexible !== null && request.dateFlexible !== undefined && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className={`flex items-center gap-1 text-xs px-2 py-0.5 cursor-help ${
                            request.dateFlexible === false
                              ? 'border-red-300 bg-red-50 text-red-700'
                              : 'border-green-300 bg-green-50 text-green-700'
                          }`}
                        >
                          {request.dateFlexible === false ? (
                            <>
                              <Lock className="w-3 h-3" />
                              Fixed date
                            </>
                          ) : (
                            <>
                              <Unlock className="w-3 h-3" />
                              Flexible
                            </>
                          )}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {request.dateFlexible === false
                          ? 'This organization has a pre-planned event and cannot change the date'
                          : 'This organization is flexible and can adjust their date if needed'}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {canEdit && startEditing && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEditing(dateFieldToEdit, formatDateForInput(displayDate?.toString() || ''))}
                      className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={`Edit ${dateLabel}`}
                      data-testid="button-edit-date"
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// CardContactInfo component - copied from shared
interface CardContactInfoProps {
  request: EventRequest;
  onCall?: () => void;
  onIntakeCall?: () => void;
  onContact?: () => void;
  /** "Mark as sent" — opens the LOGGING dialog for previously-sent toolkits. */
  onToolkit?: () => void;
  /** "Send now" — opens the email composer to actually send the toolkit. */
  onSendToolkit?: () => void;
}

const CardContactInfo: React.FC<CardContactInfoProps> = ({
  request,
  onCall,
  onIntakeCall,
  onContact,
  onToolkit,
  onSendToolkit,
}) => {
  const hasBackupContact = (request as any).backupContactFirstName || (request as any).backupContactLastName || (request as any).backupContactEmail || (request as any).backupContactPhone;

  return (
    <div className="bg-gray-50 rounded-lg p-3 space-y-3">
      {/* Primary Contact */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          {hasBackupContact && (
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Primary Contact</div>
          )}
          <div className="flex items-center gap-2 text-sm">
            <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <span className="font-medium text-base break-words min-w-0">
              {request.firstName} {request.lastName}
            </span>
          </div>
          {request.email && (
            <div className="flex items-center gap-2 text-sm text-gray-600 min-w-0">
              <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <a
                href={`mailto:${request.email}`}
                className="text-brand-primary-muted hover:text-brand-primary-dark text-base break-all min-w-0"
              >
                {request.email}
              </a>
            </div>
          )}
          {request.phone && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <a
                href={`tel:${request.phone}`}
                className="text-brand-primary-muted hover:text-brand-primary-dark text-base break-words"
              >
                {request.phone}
              </a>
            </div>
          )}
          {request.eventAddress && (
            <div className="flex items-center gap-2 text-sm text-gray-600 min-w-0">
              <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(request.eventAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#236383] hover:text-[#1a4a63] underline text-base break-words min-w-0"
              >
                {request.eventAddress}
              </a>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:flex-col sm:w-auto sm:flex-shrink-0">
          {request.phone && (
            <>
              {onIntakeCall && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={onIntakeCall}
                  className="text-sm h-10 sm:h-8 w-full sm:w-auto bg-[#007E8C] hover:bg-[#236383] text-white"
                >
                  <Phone className="w-4 h-4 mr-1" />
                  <span className="sm:hidden">Intake Call</span>
                  <span className="hidden sm:inline">Intake Call Notes Form</span>
                </Button>
              )}
              {onCall && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCall}
                  className="text-sm h-10 sm:h-8 w-full sm:w-auto"
                >
                  <Phone className="w-4 h-4 mr-1" />
                  Call
                </Button>
              )}
            </>
          )}
          {onContact && (
            <Button
              size="sm"
              variant="outline"
              onClick={onContact}
              className="text-sm h-10 sm:h-8 w-full sm:w-auto"
            >
              <Mail className="w-4 h-4 mr-1" />
              Email
            </Button>
          )}
          {/* Two distinct toolkit actions, intentionally separated:
                - "Send Toolkit": opens the email composer to actually
                   send the toolkit right now. Send-time auto-becomes
                   the toolkit-sent timestamp + status moves to In
                   Process when the email leaves the composer.
                - "Mark Toolkit Sent": opens the logging dialog for
                   cases where the toolkit was sent OUTSIDE the app
                   (forwarded from a personal inbox, hand-delivered,
                   etc.) and the user just needs to record the date.
              Bundling these behind one button forced users to discover
              a sub-action inside a dialog, which masked one path from
              the other. Two buttons = two clear intents. */}
          {onSendToolkit && (
            <Button
              size="sm"
              variant="default"
              onClick={onSendToolkit}
              className="text-sm h-10 sm:h-8 w-full sm:w-auto bg-[#FBAD3F] hover:bg-[#e89a2d] text-white"
              data-testid="button-send-toolkit"
            >
              <Mail className="w-4 h-4 mr-1" />
              Send Toolkit
            </Button>
          )}
          {onToolkit && (
            <Button
              size="sm"
              variant="outline"
              onClick={onToolkit}
              className="text-sm h-10 sm:h-8 w-full sm:w-auto border-[#FBAD3F]/40 text-[#92400E] hover:bg-[#FBAD3F]/10"
              data-testid="button-mark-toolkit-sent"
            >
              <Package className="w-4 h-4 mr-1" />
              Mark Toolkit Sent
            </Button>
          )}
        </div>
      </div>

      {/* Backup Contact */}
      {hasBackupContact && (
        <div className="border-t border-gray-200 pt-3">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Backup Contact</div>
            {((request as any).backupContactFirstName || (request as any).backupContactLastName) && (
              <div className="flex items-center gap-2 text-sm">
                <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <span className="font-medium text-base break-words min-w-0">
                  {(request as any).backupContactFirstName} {(request as any).backupContactLastName}
                  {(request as any).backupContactRole && (
                    <span className="text-gray-500 font-normal ml-2">({(request as any).backupContactRole})</span>
                  )}
                </span>
              </div>
            )}
            {(request as any).backupContactEmail && (
              <div className="flex items-center gap-2 text-sm text-gray-600 min-w-0">
                <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a
                  href={`mailto:${(request as any).backupContactEmail}`}
                  className="text-brand-primary-muted hover:text-brand-primary-dark text-base break-all min-w-0"
                >
                  {(request as any).backupContactEmail}
                </a>
              </div>
            )}
            {(request as any).backupContactPhone && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a
                  href={`tel:${(request as any).backupContactPhone}`}
                  className="text-brand-primary-muted hover:text-brand-primary-dark text-base break-words"
                >
                  {(request as any).backupContactPhone}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const NewRequestCard: React.FC<NewRequestCardProps> = ({
  request,
  onEdit,
  onDelete,
  onCall,
  onIntakeCall,
  onContact,
  onToolkit,
  onSendToolkit,
  onScheduleCall,
  onAssignTspContact,
  onEditTspContact,
  onApprove,
  onDecline,
  onNonEvent,
  onDuplicate,
  onLogContact,
  onAiSuggest,
  onAiIntakeAssist,
  onAddNextAction,
  onEditNextAction,
  onCompleteNextAction,
  onToggleCorporatePriority,
  canEdit = true,
  canDelete = true,
  // Inline editing props
  startEditing,
  saveEdit,
  cancelEdit,
  setEditingValue,
  isEditingThisCard = false,
  editingField = '',
  editingValue = '',
  tempIsConfirmed = false,
}) => {
  const { setViewMode } = useEventRequestContext();
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showMessageDialog, setShowMessageDialog] = useState(false);
  const [showConfirmToggle, setShowConfirmToggle] = useState(false);
  const [pendingConfirmValue, setPendingConfirmValue] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  // Collaboration hook for comments
  const collaboration = useEventCollaboration(request.id);

  // Check if this organization is returning (has past events) and if the contact is the same
  // Contact matching requires email OR (name + phone) to prevent false positives from same names
  const contactFullName = [request.firstName, request.lastName].filter(Boolean).join(' ') || null;
  const { data: returningOrgData } = useReturningOrganization(
    request.organizationName,
    request.id,
    request.email,        // contactEmail - primary way to identify returning contact
    contactFullName,      // contactName - used with phone for secondary matching
    request.phone,        // contactPhone - used with name for secondary matching
    request.department,   // department - used for umbrella org matching (churches, scouts)
    ['new', 'in_process', 'scheduled'].includes(request.status || '') // Check for new, in-process, and scheduled requests
  );

  // Date population hook - to show warnings for busy dates
  const { getDatePopulation } = useDatePopulation();
  const displayDate = getEffectiveEventDate(request);
  const datePopulationInfo = getDatePopulation(displayDate, request.id);

  // Mutation for toggling date confirmation
  const toggleConfirmMutation = useMutation({
    mutationFn: async (newValue: boolean) =>
      patchEventRequestVerified(request.id, { isConfirmed: newValue }),
    onSuccess: (updatedEvent) => {
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: request.status,
        touchedFields: ['isConfirmed'],
      });
      setShowConfirmToggle(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Save failed',
        description: error?.message || 'Could not update confirmation status.',
        variant: 'destructive',
        duration: Number.POSITIVE_INFINITY,
      });
    },
  });

  const handleConfirmToggleClick = () => {
    setPendingConfirmValue(!request.isConfirmed);
    setShowConfirmToggle(true);
  };

  // Use shared reference data from useEventQueries (eliminates duplicate API calls)
  const { users } = useEventQueries();

  // Helper function to get user display name from user ID
  const getUserDisplayName = (userId: string): string => {
    const user = users.find((u) => u.id === userId);
    if (!user) return userId;
    return (
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      user.displayName ||
      user.email ||
      'Unknown User'
    );
  };

  // Check if user can edit TSP contact assignments
  const canEditTspContact = hasPermission(
    user,
    PERMISSIONS.EVENT_REQUESTS_EDIT_TSP_CONTACT
  );
  return (
    <Card
      data-event-card
      className={`min-w-0 overflow-hidden transition-all duration-200 hover:shadow-[0_2px_6px_rgba(0,0,0,0.10)] border-l-[4px] bg-[#E2F5F6] shadow-[0_1px_4px_rgba(0,0,0,0.08)] border-[#D8DEE2] rounded-xl`}
      style={{ borderLeftColor: statusBorderColors.new }}
    >
      <CardContent className="p-3">
        <CardHeader
          request={request}
          canEdit={!!startEditing}
          isEditingThisCard={isEditingThisCard}
          editingField={editingField}
          editingValue={editingValue}
          startEditing={startEditing}
          saveEdit={saveEdit}
          cancelEdit={cancelEdit}
          setEditingValue={setEditingValue}
          handleConfirmToggleClick={handleConfirmToggleClick}
          presentUsers={collaboration.presentUsers}
          currentUserId={user?.id}
          datePopulationInfo={datePopulationInfo}
          returningOrgData={returningOrgData}
        />

        {/* Next Action - Prominent display for intake tracking */}
        {request.nextAction ? (
          <div className="mb-4 p-3 bg-amber-50 border-2 border-amber-300 rounded-lg min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-bold text-amber-800 uppercase tracking-wide">Next Action:</span>
                  <p className="mt-1 text-amber-900 font-medium break-words">{request.nextAction}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:justify-end">
                {onEditNextAction && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onEditNextAction}
                    className="h-auto min-h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-100 whitespace-normal break-words"
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                )}
                {onCompleteNextAction && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={onCompleteNextAction}
                    className="h-auto min-h-7 text-xs bg-green-600 hover:bg-green-700 text-white whitespace-normal break-words"
                  >
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Complete
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          onAddNextAction && (
            <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onAddNextAction}
                className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-100"
              >
                <AlertTriangle className="w-3 h-3 mr-1" />
                Add Action
              </Button>
            </div>
          )
        )}

        {/* Scheduled Call Info */}
        {request.scheduledCallDate && (
          <div className="mb-4 bg-brand-primary-lighter rounded-lg p-3">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-brand-primary-muted" />
              <span className="text-sm font-medium">Call scheduled:</span>
              <span className="text-sm">
                {(() => {
                  const date = new Date(request.scheduledCallDate);
                  const hours = date.getHours();
                  const minutes = date.getMinutes();
                  // If time is midnight (00:00), show date only
                  if (hours === 0 && minutes === 0) {
                    return date.toLocaleDateString();
                  }
                  return date.toLocaleString();
                })()}
              </span>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-4">
          {/* Left Column - Event Details */}
          <div className="space-y-3">
            {/* Submitted Info */}
            <div className="bg-brand-primary-lighter rounded-lg p-3">
              <p className="text-sm uppercase font-bold tracking-wide text-[#236383] mb-1">
                Submitted
              </p>
              <div className="space-y-1">
                <div className="font-medium flex items-center gap-2 text-base">
                  <Clock className="w-4 h-4" />
                  {request.createdAt
                    ? new Date(request.createdAt).toLocaleDateString() +
                      ' at ' +
                      new Date(request.createdAt).toLocaleTimeString()
                    : 'Unknown date'}
                  {request.createdAt && (
                    <Badge className="ml-1 bg-[#236383] text-white border-0 shadow-lg hover:bg-[#007E8C] transition-all duration-200 text-sm">
                      {formatDistanceToNow(new Date(request.createdAt), {
                        addSuffix: true,
                      })}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-2">
                  {(request.contactAttempts || request.lastContactAttempt) && (
                    <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
                      <Phone className="w-3 h-3 flex-shrink-0" />
                      {request.contactAttempts && request.contactAttempts > 0 && (
                        <span>Contact attempts: {request.contactAttempts}</span>
                      )}
                      {request.lastContactAttempt && (
                        <span className="text-xs">
                          (Last: {formatDistanceToNow(new Date(request.lastContactAttempt), { addSuffix: true })})
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onScheduleCall}
                      className="h-7 text-xs flex items-center gap-1 border-blue-300 hover:bg-blue-50 text-blue-700"
                    >
                      <Calendar className="w-3 h-3" />
                      {request.scheduledCallDate ? 'Reschedule' : 'Schedule Call'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onLogContact}
                      className="h-7 text-xs flex items-center gap-1"
                    >
                      <Phone className="w-3 h-3" />
                      Log Contact
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Sandwich Info */}
            {(request.estimatedSandwichCount !== undefined && request.estimatedSandwichCount !== null) || request.sandwichTypes ? (
              <div className="bg-amber-50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Package className="w-4 h-4 text-amber-600" />
                  <span className="font-medium">Sandwiches:</span>
                  <span>
                    {formatSandwichTypesDisplay(
                      request.sandwichTypes,
                      request.estimatedSandwichCount ?? undefined
                    )}
                  </span>
                </div>
              </div>
            ) : null}

            {/* Previous Host Status — derived from the real previouslyHosted
                column (the list used to send a computed hasHostedBefore, which
                went away when /list switched to full records). */}
            {request.previouslyHosted !== undefined && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-sm uppercase font-bold tracking-wide text-[#236383]">
                    Previously hosted:
                  </span>
                  <Badge
                    className={
                      request.previouslyHosted === 'yes'
                        ? 'inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-[#007E8C] text-white border-0 shadow-lg hover:bg-[#47B3CB] transition-all duration-200 text-sm'
                        : 'inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-[#236383] text-white border-0 shadow-lg hover:bg-[#007E8C] transition-all duration-200 text-sm'
                    }
                  >
                    {request.previouslyHosted === 'yes' ? 'Yes' : 'No - First Time'}
                  </Badge>
                </div>
              </div>
            )}

            {/* Message from Event Request */}
            {request.message && request.message.trim() && (
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm uppercase font-bold tracking-wide text-blue-700 mb-1">
                      Message from Request:
                    </p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                      <LinkifyAddresses text={request.message} />
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Contact Info */}
          <div className="space-y-3">
            <CardContactInfo
              request={request}
              onCall={onCall}
              onIntakeCall={onIntakeCall}
              onContact={onContact}
              onToolkit={onToolkit}
              onSendToolkit={onSendToolkit}
            />

            {/* TSP Contact Assignment Status */}
            {(request.tspContact || request.customTspContact) && (
              <div
                className="rounded-lg p-3 border border-[#FBAD3F] shadow-sm"
                style={{ backgroundColor: '#FFF4E6', borderColor: '#FBAD3F' }}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <UserPlus className="w-4 h-4 text-[#E5901A] flex-shrink-0" />
                    <span className="font-semibold text-[#D68319] whitespace-nowrap">
                      TSP Contact:
                    </span>
                    <span className="font-medium text-[#C7761A] break-words min-w-0">
                      {request.tspContact
                        ? getUserDisplayName(request.tspContact)
                        : request.customTspContact}
                    </span>
                  </div>
                  {canEditTspContact && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onEditTspContact}
                      className="h-7 px-2 text-[#D68319] hover:bg-[#FBAD3F]/20 flex-shrink-0"
                      data-testid="button-edit-tsp-contact"
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                {request.tspContactAssignedDate && (
                  <p className="text-sm text-[#D68319] mt-1">
                    Assigned on{' '}
                    {new Date(
                      request.tspContactAssignedDate
                    ).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Communication & Notes Section */}
        {request.id && (
          <div className="bg-white rounded-lg p-4 mb-4 border border-gray-200">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowComments(!showComments)}
              className="w-full justify-between text-gray-700 hover:text-gray-700 hover:bg-gray-50 font-medium p-2 h-auto mb-2"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-600" />
                <h3 className="text-sm font-semibold">Team Comments</h3>
                {collaboration.comments && collaboration.comments.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {collaboration.comments.length}
                  </Badge>
                )}
              </div>
              {showComments ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>

            {showComments && (
              <div className="mt-3 max-h-[500px]">
                <CommentThread
                  comments={collaboration.comments || []}
                  currentUserId={user?.id || ''}
                  currentUserName={user?.fullName || user?.email || ''}
                  eventId={request.id}
                  onAddComment={collaboration.addComment}
                  onEditComment={collaboration.updateComment}
                  onDeleteComment={collaboration.deleteComment}
                  isLoading={collaboration.commentsLoading || false}
                />
              </div>
            )}

          </div>
        )}

        {/* Action Buttons
            Tiered layout:
              - PRIMARY (left): the 1-2 most likely "next" actions — Assign TSP
                Contact (when missing) and Edit (always). These keep their full
                size and labels so they're impossible to miss.
              - SECONDARY (right of primaries): supporting intake actions.
                Visually lighter (ghost, muted) than the primaries but each
                carries a text label so the action is clear without hovering —
                the two AI buttons in particular share the same Sparkles icon
                and are indistinguishable icon-only. Tooltips keep the longer
                descriptions.
            Order matches the typical intake flow left → right. */}
        <TooltipProvider>
          <CardActionRow>
            {/* PRIMARY: Assign TSP Contact when missing — high-priority intake step */}
            {!(request.tspContact || request.customTspContact) && canEditTspContact && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onAssignTspContact}
                    className="border-yellow-500 text-yellow-700 hover:bg-yellow-50"
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    <span className="sm:hidden">Assign TSP</span>
                    <span className="hidden sm:inline">Assign TSP Contact</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Assign a TSP contact to this event request</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* SECONDARY actions — labeled, visually de-emphasized (ghost) */}
            <div className="contents sm:flex sm:flex-wrap sm:items-center sm:gap-1">
              {/* AI Date Suggestion */}
              {(request.desiredEventDate || request.backupDates?.length) && onAiSuggest && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onAiSuggest}
                      className="h-8 text-[#236383] hover:bg-[#236383]/10"
                      data-testid="button-ai-suggest-date"
                    >
                      <Sparkles className="w-4 h-4 mr-1.5" />
                      AI Dates
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>AI date suggestions</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* AI Intake Assistant */}
              {onAiIntakeAssist && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onAiIntakeAssist}
                      className="h-8 text-[#47B3CB] hover:bg-[#47B3CB]/10"
                      data-testid="button-ai-intake-assist"
                    >
                      <Sparkles className="w-4 h-4 mr-1.5" />
                      AI Intake
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>AI intake check</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Schedule Call */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onScheduleCall}
                    className="h-8 text-slate-600 hover:bg-slate-100"
                  >
                    <Phone className="w-4 h-4 mr-1.5" />
                    Schedule Call
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Schedule a call with the organizer</p>
                </TooltipContent>
              </Tooltip>

              {/* Log Contact */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onLogContact}
                    className="h-8 text-[#007E8C] hover:bg-[#007E8C]/10"
                  >
                    <MessageSquare className="w-4 h-4 mr-1.5" />
                    Log Contact
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Log a contact attempt or conversation</p>
                </TooltipContent>
              </Tooltip>

              {/* Reminders (component renders its own button) */}
              <ReminderRulesManager
                eventRequestId={request.id}
                tspContactUserId={request.tspContact || request.tspContactAssigned}
                eventStatus={request.status}
              />

              {/* Non-Event */}
              {onNonEvent && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onNonEvent}
                      className="h-8 text-stone-500 hover:bg-stone-100"
                      data-testid="button-non-event"
                    >
                      <Ban className="w-4 h-4 mr-1.5" />
                      Non-Event
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Mark as non-event (not a real event request)</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            <ActionRowSpacer />

            {/* PRIMARY: Edit Button — always-visible "next action" anchor */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onEdit}
                 
                  data-testid="button-edit-request"
                >
                  <Edit className="w-4 h-4 mr-1.5" />
                  <span className="hidden sm:inline">{getPrimaryContextualAction(request)?.label || 'Edit'}</span>
                  <span className="sm:hidden">Edit</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{getContextualTooltip(request)}</p>
              </TooltipContent>
            </Tooltip>
            {onDuplicate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onDuplicate}
                    data-testid="button-duplicate"
                    aria-label="Duplicate event"
                  >
                    <Copy className="w-4 h-4 mr-1.5" />
                    Duplicate
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Create another event from this one</p>
                </TooltipContent>
              </Tooltip>
            )}
            {canDelete && (
              <ConfirmationDialog
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 h-8"
                    data-testid="button-delete-request"
                    title="Delete this event request"
                  >
                    <Trash2 className="w-4 h-4 sm:mr-0 mr-1.5" />
                    <span className="sm:hidden">Delete</span>
                  </Button>
                }
                title="Delete Event Request"
                description={`Are you sure you want to delete the event request from ${request.organizationName}? This action cannot be undone.`}
                confirmText="Delete Request"
                cancelText="Cancel"
                onConfirm={onDelete}
                variant="destructive"
              />
            )}
          </CardActionRow>
        </TooltipProvider>

        {/* Audit Log Section */}
        <div className="mt-4 border-t border-gray-200 pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowAuditLog(!showAuditLog);
            }}
            className="w-full justify-between text-gray-600 hover:text-gray-800 p-2 h-8"
            data-testid="button-toggle-audit-log"
            type="button"
          >
            <div className="flex items-center gap-2">
              <History className="w-4 h-4" />
              <span className="text-sm">Activity History</span>
            </div>
            {showAuditLog ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
          
          {showAuditLog && (
            <div className="mt-3" data-testid="audit-log-section">
              <EventRequestAuditLog
                eventId={request.id?.toString()}
                showFilters={false}
                compact={true}
              />
            </div>
          )}
        </div>

        {/* Email Log - shows if any template emails have been sent */}
        <EventEmailLogDisplay eventId={request.id} compact />

        {/* Request-source indicator — mutually exclusive: website submission
            (Google Sheets sync) vs manual entry by an app user. */}
        {(() => {
          const source = getEventRequestSourceIndicator(request as any);
          if (!source) return null;

          if (source.kind === 'planning_sheet') {
            return (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500 italic">
                <Calendar className="w-3 h-3 text-gray-400" aria-hidden="true" />
                <span>Imported from planning sheet</span>
              </div>
            );
          }

          if (source.kind === 'website') {
            return (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500 italic">
                <Globe className="w-3 h-3 text-gray-400" aria-hidden="true" />
                <span>Submitted via website</span>
              </div>
            );
          }

          return (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500 italic">
              <FileText className="w-3 h-3 text-gray-400" aria-hidden="true" />
              <span>
                {source.channelLabel
                  ? `Manually entered (${source.channelLabel})`
                  : 'Manually entered in app'}
              </span>
            </div>
          );
        })()}

        {/* Confirmation Toggle Dialog */}
        <ConfirmationDialog
          isOpen={showConfirmToggle}
          onClose={() => setShowConfirmToggle(false)}
          onConfirm={() => toggleConfirmMutation.mutate(pendingConfirmValue)}
          title={pendingConfirmValue ? 'Confirm Date' : 'Mark Date as Pending'}
          message={
            pendingConfirmValue
              ? 'Are you sure you want to mark this date as confirmed?'
              : 'Are you sure you want to mark this date as pending?'
          }
          confirmText="Yes, Update"
          cancelText="Cancel"
        />
      </CardContent>

      {/* Message Composer Dialog */}
      <Dialog open={showMessageDialog} onOpenChange={setShowMessageDialog}>
        <DialogContent className="w-[95vw] max-w-2xl">
          <DialogHeader>
            <DialogTitle>Message About Event: {request.organizationName}</DialogTitle>
          </DialogHeader>
          <MessageComposer
            contextType="event"
            contextId={request.id.toString()}
            contextTitle={`${request.organizationName} event`}
            onSent={() => setShowMessageDialog(false)}
            onCancel={() => setShowMessageDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
};
