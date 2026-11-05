import React, { useState } from 'react';
import EventEmailLogDisplay from '@/components/event-email-log-display';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Calendar,
  Clock,
  Package,
  Phone,
  Mail,
  Edit,
  Trash2,
  AlertTriangle,
  CalendarCheck,
  CheckCircle,
  Plus,
  MessageSquare,
  Building,
  Edit2,
  Save,
  X,
  User,
  UserPlus,
  History,
  ChevronDown,
  ChevronUp,
  Sparkles,
  MapPin,
  FileText,
  MessageCircle,
  Lock,
  Unlock,
  Copy,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  formatTime12Hour,
  formatEventDate,
  formatToolkitDate,
} from '@/components/event-requests/utils';
import { useDatePopulation, type DatePopulationInfo } from '@/components/event-requests/hooks/useDatePopulation';
import { TrafficConflictBadge } from '@/components/event-requests/TrafficConflictBadge';
import { LastContactAgeBadge } from '@/components/event-requests/LastContactAgeBadge';
import { VanNeededBadgeAndButton } from '@/components/event-requests/VanNeededBadgeAndButton';
import { formatSandwichTypesDisplay, formatEventEstimate } from '@/lib/sandwich-utils';
import {
  statusColors,
  statusIcons,
  statusOptions,
  statusBorderColors,
  statusBgColors,
  statusTooltips,
  indicatorTooltips,
} from '@/components/event-requests/constants';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import type { EventRequest } from '@shared/schema';
import { EventRequestAuditLog } from '@/components/event-request-audit-log';
import { ReminderRulesManager } from '@/components/event-requests/ReminderRulesManager';
import { getMissingIntakeInfo } from '@/lib/event-request-validation';
import { getPrimaryContextualAction, getContextualTooltip } from '@/lib/contextual-actions';
import { useEventCollaboration } from '@/hooks/use-event-collaboration';
import { CommentThread, CompactPresenceBadge } from '@/components/collaboration';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { QuickScheduleButton } from '@/components/event-requests/QuickScheduleButton';
import { EVENT_REQUEST_FEATURES } from '@/components/event-requests/feature-flags';
import { useReturningOrganization } from '@/hooks/use-returning-organization';
import { RefreshCw } from 'lucide-react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { InfoBadge, CardActionRow, ActionRowSpacer } from './card-ui';

interface InProcessCardProps {
  request: EventRequest;
  resolveUserName?: (id: string) => string;
  isStale?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSchedule: () => void;
  onCall: () => void;
  onIntakeCall?: () => void;
  onDuplicate?: () => void;
  onContact: () => void;
  onScheduleCall: () => void;
  onResendToolkit?: () => void;
  onAssignTspContact: () => void;
  onEditTspContact: () => void;
  onLogContact: () => void;
  onEditContactAttempt?: (attemptNumber: number) => void;
  onDeleteContactAttempt?: (attemptNumber: number) => Promise<void>;
  onAiSuggest?: () => void;
  onAiIntakeAssist?: () => void;
  onAddNextAction?: () => void;
  onEditNextAction?: () => void;
  onCompleteNextAction?: () => void;
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

// CardHeader component - copied from shared
interface CardHeaderProps {
  request: EventRequest;
  resolveUserName?: (id: string) => string;
  isInProcessStale?: boolean;
  canEdit?: boolean;
  canEditOrgDetails?: boolean;
  isEditingThisCard?: boolean;
  editingField?: string;
  editingValue?: string;
  startEditing?: (field: string, value: string) => void;
  saveEdit?: () => void;
  cancelEdit?: () => void;
  setEditingValue?: (value: string) => void;
  presentUsers?: Array<{ userId: string; userName: string; joinedAt: Date; lastHeartbeat: Date; socketId: string }>;
  currentUserId?: string;
  datePopulationInfo?: DatePopulationInfo;
  returningOrgData?: {
    isReturning: boolean;
    isReturningContact: boolean;
    pastEventCount: number;
    collectionCount: number;
    pastDepartments?: string[];
    mostRecentEvent?: { id: number; eventDate: string | null; status: string | null };
    mostRecentCollection?: { id: number; dateCollected: string | null };
    pastContactName?: string;
    contactPastOrgs?: string[];
    orgSimilarityScore?: number;
  };
  onAddNextAction?: () => void;
}

const CardHeader: React.FC<CardHeaderProps> = ({
  request,
  resolveUserName,
  isInProcessStale,
  canEdit = false,
  canEditOrgDetails = false,
  isEditingThisCard = false,
  editingField = '',
  editingValue = '',
  startEditing,
  saveEdit,
  cancelEdit,
  setEditingValue,
  presentUsers = [],
  currentUserId = '',
  datePopulationInfo,
  returningOrgData,
  onAddNextAction,
}) => {
  const { setViewMode } = useEventRequestContext();
  const isMobile = useIsMobile();
  const StatusIcon =
    statusIcons[request.status as keyof typeof statusIcons] || statusIcons.new;

  // Get the proper status label from constants instead of just replacing underscores
  const getStatusLabel = (status: string) => {
    const statusOption = statusOptions.find(
      (option) => option.value === status
    );
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

  // Check if we're editing organization or department fields
  const isEditingOrgName = isEditingThisCard && editingField === 'organizationName';
  const isEditingDepartment = isEditingThisCard && editingField === 'department';

  return {
    header: (
      <div className="mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Real-time Presence Indicator */}
          {presentUsers && presentUsers.length > 0 && currentUserId && (
            <CompactPresenceBadge 
              users={presentUsers} 
              currentUserId={currentUserId}
              className="mr-1"
            />
          )}
          {/* Organization Name - with inline editing */}
          {isEditingOrgName ? (
            <div className="flex items-center gap-2">
              <Input
                value={editingValue}
                onChange={(e) => setEditingValue?.(e.target.value)}
                className="h-8 text-lg font-bold text-[#236383]"
                autoFocus
                data-testid="input-organization-name"
              />
              <Button size="sm" onClick={saveEdit} data-testid="button-save-org-name">
                <Save className="w-3 h-3" />
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit} data-testid="button-cancel-org-name">
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h3 className="text-lg sm:text-xl font-bold text-[#236383] flex items-center gap-2 break-words min-w-0">
                {request.organizationName}
              </h3>
              {canEditOrgDetails && startEditing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => startEditing('organizationName', request.organizationName || '')}
                  className="h-6 px-2 hidden group-hover:inline-flex"
                  title="Edit organization name"
                  data-testid="button-edit-org-name"
                >
                  <Edit2 className="w-3 h-3" />
                </Button>
              )}
            </div>
          )}

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

          {/* Department - with inline editing */}
          {(request.department || isEditingDepartment || canEditOrgDetails) && (
            <>
              <span className="text-gray-500 text-lg">&bull;</span>
              {isEditingDepartment ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editingValue}
                    onChange={(e) => setEditingValue?.(e.target.value)}
                    className="h-8 text-base sm:text-lg font-medium text-[#236383]"
                    placeholder="Department"
                    autoFocus
                    data-testid="input-department"
                  />
                  <Button size="sm" onClick={saveEdit} data-testid="button-save-department">
                    <Save className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} data-testid="button-cancel-department">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  {request.department ? (
                    <span className="text-base sm:text-lg font-medium text-[#236383] break-words">{request.department}</span>
                  ) : canEditOrgDetails ? (
                    <span className="text-base sm:text-lg font-normal text-gray-400 italic">No department</span>
                  ) : null}
                  {canEditOrgDetails && startEditing && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEditing('department', request.department || '')}
                      className="h-6 px-2 hidden group-hover:inline-flex"
                      title={request.department ? "Edit department" : "Add department"}
                      data-testid="button-edit-department"
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Returning Organization Indicator — placed after org + department so the
              org name sits adjacent to its department without a badge wedged between. */}
          {returningOrgData?.isReturning && (() => {
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

          {/* Partner Organizations */}
          {request.partnerOrganizations && Array.isArray(request.partnerOrganizations) && request.partnerOrganizations.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-gray-600 text-base">&bull;</span>
              <span className="text-base sm:text-lg text-gray-600">
                <span className="font-medium">Partner:</span>{' '}
                {request.partnerOrganizations.map((partner, index) => (
                  <span key={index}>
                    {partner.name}
                    {partner.department && ` • ${partner.department}`}
                    {index < request.partnerOrganizations.length - 1 && ', '}
                  </span>
                ))}
              </span>
            </div>
          )}
          {isInProcessStale && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="bg-[#FBAD3F]/15 text-[#236383] border-[#FBAD3F] whitespace-nowrap cursor-help"
                >
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Needs follow-up
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{indicatorTooltips.needsFollowUp}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Past Date Warning Badge */}
          {isPast && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  className="bg-[#A31C41] text-white px-2.5 py-0.5 text-sm font-medium shadow-sm inline-flex items-center whitespace-nowrap cursor-help"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  Date Passed
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{indicatorTooltips.datePassed}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Corporate Priority Badge — outlined; lower visual weight than alert pills */}
          {(request as any).isCorporatePriority && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="px-2.5 py-0.5 text-sm font-medium inline-flex items-center whitespace-nowrap bg-amber-50 text-amber-700 border-amber-300"
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

          {/* Validation badges for missing intake info */}
          {(() => {
            const missingInfo = getMissingIntakeInfo(request);
            if (missingInfo.length === 0) return null;

            // Always show individual badges listing each missing item
            return missingInfo.map((item) => (
              <Badge
                key={item}
                className="bg-[#A31C41] text-white px-2.5 py-0.5 text-sm font-medium shadow-sm inline-flex items-center"
                data-testid={`badge-missing-${item.toLowerCase().replace(' ', '-')}`}
              >
                <AlertTriangle className="w-3 h-3 mr-1" />
                Missing: {item}
              </Badge>
            ));
          })()}
          {/* Date Confirmed badge — only renders when isConfirmed is true.
              "Pending" is the default state on in-process events and showing a
              "Date Pending" pill on every card was just noise. Confirming a date
              is now done via the edit form only (an inline confirm button on
              the card was too easy to misinterpret/misuse). Clicking the badge
              still un-marks confirmation as a quick undo. */}
          {request.isConfirmed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  onClick={() => {
                    startEditing?.('isConfirmed', 'false');
                    setTimeout(() => saveEdit?.(), 0);
                  }}
                  className="px-2.5 py-1 text-sm font-medium inline-flex items-center cursor-pointer hover:opacity-80 transition-opacity whitespace-nowrap bg-gradient-to-br from-[#007E8C] to-[#47B3CB] text-white border-transparent shadow-sm"
                >
                  ✓ Date Confirmed
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{indicatorTooltips.dateConfirmed}</p>
                <p className="text-xs text-muted-foreground mt-1">Click to unmark</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Traffic conflict (e.g. World Cup matches). Prefer the scheduled
              date once set so a rescheduled event doesn't keep a stale badge
              from its original desiredEventDate. */}
          <TrafficConflictBadge
            dates={[getEffectiveEventDate(request)]}
          />
          {/* Last-contact-age — escalates by week since last contact attempt; skipped when a future call is scheduled */}
          <LastContactAgeBadge request={request} />
          {/* Van needed — badges only here. The "Needs Van?" call-to-action button
              lives in the bottom action row alongside other workflow buttons. */}
          <VanNeededBadgeAndButton
            eventRequestId={request.id}
            vanDriverNeeded={request.vanDriverNeeded}
            vanNeededLikely={(request as any).vanNeededLikely}
            eventDate={displayDate}
            canEdit={!!canEdit}
            mode="badge"
          />
          {/* Add Action — freeform escape hatch; only when no nextAction exists */}
          {onAddNextAction && !request.nextAction && (
            <Button
              size="sm"
              variant="outline"
              onClick={onAddNextAction}
              className="h-7 text-xs border-slate-300 text-slate-600 hover:bg-slate-100 ml-auto"
              data-testid="button-add-action"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Action
            </Button>
          )}
        </div>
      </div>
    ),
    eventDate: (
      <div className="bg-[#236383] text-white rounded-lg p-3 shadow-md">
        <div className="flex items-center gap-1.5 mb-1">
          <Calendar className="w-4 h-4 opacity-80" />
          <span className="text-xs font-semibold opacity-80">Event Date</span>
        </div>
        {isEditingDate ? (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={formatDateForInput(editingValue)}
              onChange={(e) => setEditingValue?.(e.target.value)}
              className="h-8 w-full bg-white text-gray-900"
              autoFocus
              data-testid="input-date"
            />
            <Button
              size="sm"
              onClick={saveEdit}
              className="bg-[#FBAD3F] hover:bg-[#e89a2d]"
              data-testid="button-save-date"
            >
              <Save className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelEdit}
              className="text-white hover:bg-white/20"
              data-testid="button-cancel-date"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group flex-wrap">
            <span className="text-base font-bold break-words" data-testid="text-date-value">
              {displayDate && dateInfo ? dateInfo.text : 'No date set'}
            </span>
            {displayDate && getRelativeTime(displayDate.toString()) && (
              <span className="text-sm opacity-80">
                ({getRelativeTime(displayDate.toString())})
              </span>
            )}
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
                        ? 'border-red-300 bg-red-500/20 text-white'
                        : 'border-green-300 bg-green-500/20 text-white'
                    }`}
                  >
                    {request.dateFlexible === false ? (
                      <>
                        <Lock className="w-3 h-3" />
                        Fixed
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
                onClick={() =>
                  startEditing(
                    dateFieldToEdit,
                    formatDateForInput(displayDate?.toString() || '')
                  )
                }
                className="h-6 px-2 text-white hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100"
                title={`Edit ${dateLabel}`}
                data-testid="button-edit-date"
              >
                <Edit2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        )}
        {request.eventAddress && (
          <div className="mt-2 pt-2 border-t border-white/20">
            <div className="flex items-center gap-1.5 mb-0.5">
              <MapPin className="w-4 h-4 opacity-80" />
              <span className="text-xs font-semibold opacity-80">Event Location</span>
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(request.eventAddress)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-bold break-words hover:underline"
            >
              {request.eventAddress}
            </a>
          </div>
        )}
      </div>
    )
  };
};

// CardContactInfo component - copied from shared
interface CardContactInfoProps {
  request: EventRequest;
  onCall?: () => void;
  onIntakeCall?: () => void;
  onContact?: () => void;
}

const CardContactInfo: React.FC<CardContactInfoProps> = ({
  request,
  onCall,
  onIntakeCall,
  onContact,
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
          <div className="flex items-center gap-2 text-sm text-gray-600 min-w-0">
            <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="text-base break-all min-w-0">{request.email}</span>
          </div>
          {request.phone && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-base break-words">{request.phone}</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:flex-col sm:w-auto sm:flex-shrink-0">
          {request.phone && onIntakeCall && (
            <Button
              size="sm"
              variant="default"
              onClick={onIntakeCall}
              className="text-sm h-10 sm:h-8 w-full sm:w-auto bg-[#007E8C] hover:bg-[#236383] text-white"
            >
              <Phone className="w-4 h-4 mr-1" />
              Intake Call
            </Button>
          )}
          {request.phone && onCall && (
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

export const InProcessCard: React.FC<InProcessCardProps> = ({
  request,
  resolveUserName,
  isStale = false,
  onEdit,
  onDelete,
  onSchedule,
  onCall,
  onIntakeCall,
  onDuplicate,
  onContact,
  onScheduleCall,
  onResendToolkit,
  onAssignTspContact,
  onEditTspContact,
  onLogContact,
  onEditContactAttempt,
  onDeleteContactAttempt,
  onAiSuggest,
  onAiIntakeAssist,
  onAddNextAction,
  onEditNextAction,
  onCompleteNextAction,
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
  const [showComments, setShowComments] = useState(false);
  const [showContactAttempts, setShowContactAttempts] = useState(false);
  // Whether to expand the condensed contact-log list past the most-recent entry
  const [showAllAttempts, setShowAllAttempts] = useState(false);
  const { user } = useAuth();
  const canEditTspContact = user && hasPermission(user, PERMISSIONS.EVENT_REQUESTS_EDIT_TSP_CONTACT);

  // Collaboration hook for comments
  const collaboration = useEventCollaboration(request.id);

  // Check if this organization is returning (has past events) and if the contact is the same
  // Contact matching requires email OR (name + phone) to prevent false positives from same names
  const contactFullName = [request.firstName, request.lastName].filter(Boolean).join(' ') || null;
  const { data: returningOrgData } = useReturningOrganization(
    request.organizationName,
    request.id,
    request.email,
    contactFullName,
    request.phone,        // contactPhone - used with name for secondary matching
    request.department,   // department - used for umbrella org matching (churches, scouts)
    ['in_process', 'scheduled'].includes(request.status || '')
  );

  // Date population hook - to show warnings for busy dates
  const { getDatePopulation } = useDatePopulation();
  const datePopulationInfo = getDatePopulation(
    getEffectiveEventDate(request),
    request.id
  );

  // Check if user has permission to edit organization details
  const canEditOrgDetails =
    (user?.permissions as string[] | undefined)?.includes('EVENT_REQUESTS_INLINE_EDIT_ORG_DETAILS') ||
    user?.role === 'super_admin' ||
    user?.role === 'admin';

  const headerContent = CardHeader({
    request,
    resolveUserName,
    isInProcessStale: isStale,
    canEdit: !!startEditing, // Enable editing if editing functions are provided
    canEditOrgDetails,
    isEditingThisCard,
    editingField,
    editingValue,
    startEditing,
    saveEdit,
    cancelEdit,
    setEditingValue,
    presentUsers: collaboration.presentUsers,
    currentUserId: user?.id,
    datePopulationInfo,
    returningOrgData,
    onAddNextAction,
  });

  return (
    <Card
      id={`event-card-${request.id}`}
      data-event-card
      className={`min-w-0 overflow-hidden transition-all duration-200 hover:shadow-[0_2px_6px_rgba(0,0,0,0.10)] border-l-[4px] bg-[#FFF4E5] shadow-[0_1px_4px_rgba(0,0,0,0.08)] border-[#D8DEE2] rounded-xl ${
        isStale ? 'border-l-[#A31C41]' : ''
      }`}
      style={!isStale ? { borderLeftColor: statusBorderColors.in_process } : {}}
    >
      <CardContent className="p-3">
        {headerContent.header}

        {/* Toolkit Sent Status - Professional and brand-aligned */}
        {request.toolkitSentDate && (() => {
          const formattedDate = formatToolkitDate(request.toolkitSentDate);
          if (!formattedDate) return null;

          return (
            <div className="mb-4">
              <div className="inline-flex items-center gap-2 rounded-md border border-[#007E8C]/25 bg-[#00CED1]/10 text-[#007E8C] px-3 py-2 text-sm font-medium">
                <Package className="w-4 h-4" />
                <span>Toolkit sent {formattedDate}</span>
                {request.toolkitSentBy && (
                  <span className="text-xs text-[#007E8C]">
                    by {resolveUserName ? resolveUserName(request.toolkitSentBy) : request.toolkitSentBy}
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Next Action - Prominent display when one exists.
            (When no next action, the "Add Action" affordance lives in the header pills row.) */}
        {request.nextAction && (
          <div className="mb-4 p-3 bg-amber-50 border-2 border-amber-300 rounded-lg">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-bold text-amber-800 uppercase tracking-wide">Next Action:</span>
                  <p className="mt-1 text-amber-900 font-medium break-words">{request.nextAction}</p>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0 self-end sm:self-auto">
                {onEditNextAction && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onEditNextAction}
                    className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-100"
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
                    className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Complete
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-4">
          {/* Left Column - Event Details */}
          <div className="space-y-3">
            {/* Event Date + Location (location lives inside the teal date box) */}
            {headerContent.eventDate}
            {/* Contact Attempts Info */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                {(request.contactAttempts || request.lastContactAttempt) && (
                  <div className="flex flex-wrap items-center gap-2 text-amber-800">
                    <Phone className="w-4 h-4 flex-shrink-0" />
                    {request.contactAttempts && request.contactAttempts > 0 && (
                      <span className="text-sm font-medium">
                        Contact attempts: {request.contactAttempts}
                      </span>
                    )}
                    {request.lastContactAttempt && (
                      <span className="text-xs">
                        (Last: {new Date(request.lastContactAttempt).toLocaleDateString()})
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {Array.isArray(request.contactAttemptsLog) && request.contactAttemptsLog.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowContactAttempts(!showContactAttempts)}
                      className="h-7 text-xs flex items-center gap-1 text-amber-800 hover:bg-amber-100"
                    >
                      {showContactAttempts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showContactAttempts ? 'Hide Full' : 'Show Full'} Details
                    </Button>
                  )}
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
                    className="h-7 text-xs flex items-center gap-1 border-amber-300 hover:bg-amber-100"
                  >
                    <Phone className="w-3 h-3" />
                    Log Contact
                  </Button>
                </div>
              </div>

              {/* Contact Attempts Details — two mutually-exclusive views:
                  - Compact (default): single-line rows, most-recent only by default with a
                    "Show all N attempts" toggle.
                  - Full details (when showContactAttempts is true): labeled cards with Outcome,
                    timestamp, logged-by attribution.
                  Only one is rendered at a time so toggling Show/Hide Full Details actually
                  swaps the views instead of stacking them. */}
              {Array.isArray(request.contactAttemptsLog) && request.contactAttemptsLog.length > 0 && !showContactAttempts && (
                <div className="mt-3 border-t border-amber-300 pt-3">
                  <div className="space-y-1.5">
                    {request.contactAttemptsLog
                      .slice()
                      .sort((a, b) => {
                        // Sort by attemptNumber descending (most recent first)
                        return (b.attemptNumber || 0) - (a.attemptNumber || 0);
                      })
                      .slice(0, showAllAttempts ? undefined : 1)
                      .map((attempt: any) => {
                        if (!attempt || typeof attempt !== 'object') return null;

                        const methodIcons = {
                          phone: <Phone className="w-3 h-3" />,
                          email: <Mail className="w-3 h-3" />,
                          text: <MessageCircle className="w-3 h-3" />,
                          both: <MessageSquare className="w-3 h-3" />,
                          phone_and_toolkit: <MessageSquare className="w-3 h-3" />,
                          email_and_toolkit: <Mail className="w-3 h-3" />,
                        };

                        const methodLabels = {
                          phone: 'Phone',
                          email: 'Email',
                          text: 'Text',
                          both: 'Phone & Email',
                          phone_and_toolkit: 'Phone + Toolkit',
                          email_and_toolkit: 'Email + Toolkit',
                        };

                        const outcomeLabels: { [key: string]: string } = {
                          successful: 'Success',
                          toolkit_sent: 'Toolkit Sent',
                          toolkit_sent_left_message: 'Toolkit + Voicemail',
                          no_answer: 'No answer',
                          left_message: 'Left message',
                          wrong_number: 'Wrong number',
                          email_bounced: 'Bounced',
                          requested_callback: 'Callback requested',
                          other: 'Other',
                        };

                        let parsedDate: Date | undefined;
                        if (attempt.timestamp) {
                          try {
                            parsedDate = new Date(attempt.timestamp);
                            if (isNaN(parsedDate.getTime())) {
                              parsedDate = undefined;
                            }
                          } catch (e) {
                            parsedDate = undefined;
                          }
                        }

                        const userName = attempt.createdByName || attempt.createdBy || 'Unknown';
                        const hasNotes = attempt.notes && attempt.notes.trim().length > 0;

                        // Condensed view - single line with key info
                        return (
                          <div
                            key={attempt.attemptNumber || attempt.timestamp}
                            className="group bg-white rounded px-2.5 py-1.5 border border-amber-200 text-xs hover:bg-amber-50 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 flex-1 min-w-0">
                                <span className="font-semibold text-amber-900 flex-shrink-0">
                                  #{attempt.attemptNumber || '?'}
                                </span>
                                {attempt.method && (
                                  <div className="flex items-center gap-1 text-amber-700 flex-shrink-0">
                                    {methodIcons[attempt.method as keyof typeof methodIcons] || <Phone className="w-3 h-3" />}
                                    <span className="text-xs">{methodLabels[attempt.method as keyof typeof methodLabels] || attempt.method}</span>
                                  </div>
                                )}
                                {attempt.outcome && (
                                  <span className="text-gray-700 flex-shrink-0">
                                    • {outcomeLabels[attempt.outcome] || attempt.outcome}
                                  </span>
                                )}
                                {parsedDate && (
                                  <span className="text-gray-500 flex-shrink-0">
                                    • {parsedDate.toLocaleDateString()} {parsedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </div>
                              {/* Edit/Delete buttons - show on hover */}
                              <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                {onEditContactAttempt && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-5 w-5 p-0 text-amber-700 hover:text-amber-900 hover:bg-amber-100 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditContactAttempt(attempt.attemptNumber);
                                    }}
                                    title="Edit contact attempt"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                )}
                                {onDeleteContactAttempt && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-5 w-5 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteContactAttempt(attempt.attemptNumber);
                                    }}
                                    title="Delete contact attempt"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            {hasNotes && (
                              <div className="mt-1 text-gray-600 italic">
                                {attempt.notes}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>

                  {/* Show all condensed entries (collapsed to most recent by default) */}
                  {request.contactAttemptsLog.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setShowAllAttempts((v) => !v)}
                      className="mt-2 text-xs text-amber-800 hover:text-amber-900 hover:underline flex items-center gap-1"
                      data-testid="button-toggle-all-attempts"
                    >
                      {showAllAttempts ? (
                        <>
                          <ChevronUp className="w-3 h-3" />
                          Show only most recent
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" />
                          Show all {request.contactAttemptsLog.length} attempts
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Full-details view — replaces the compact list when "Show Full Details" is on */}
              {Array.isArray(request.contactAttemptsLog) && request.contactAttemptsLog.length > 0 && showContactAttempts && (
                <div className="mt-3 space-y-2 border-t border-amber-300 pt-3">
                      {request.contactAttemptsLog
                        .slice()
                        .sort((a, b) => {
                          return (b.attemptNumber || 0) - (a.attemptNumber || 0);
                        })
                        .map((attempt: any) => {
                          if (!attempt || typeof attempt !== 'object') return null;

                          const methodIcons = {
                            phone: <Phone className="w-3 h-3" />,
                            email: <Mail className="w-3 h-3" />,
                            text: <MessageCircle className="w-3 h-3" />,
                            both: <MessageSquare className="w-3 h-3" />,
                            phone_and_toolkit: <MessageSquare className="w-3 h-3" />,
                            email_and_toolkit: <Mail className="w-3 h-3" />,
                          };

                          const methodLabels = {
                            phone: 'Phone',
                            email: 'Email',
                            text: 'Text',
                            both: 'Phone & Email',
                            phone_and_toolkit: 'Phone + Toolkit Email',
                            email_and_toolkit: 'Email + Toolkit',
                          };

                          const outcomeLabels: { [key: string]: string } = {
                            successful: 'Successfully contacted - Got response',
                            toolkit_sent: 'Toolkit sent',
                            toolkit_sent_left_message: 'Toolkit sent + Left voicemail',
                            no_answer: 'No answer - No response',
                            left_message: 'Left voicemail/message',
                            wrong_number: 'Wrong/disconnected number',
                            email_bounced: 'Email bounced/failed',
                            requested_callback: 'Requested callback/follow-up',
                            other: 'Other',
                          };

                          let parsedDate: Date | undefined;
                          if (attempt.timestamp) {
                            try {
                              parsedDate = new Date(attempt.timestamp);
                              if (isNaN(parsedDate.getTime())) {
                                parsedDate = undefined;
                              }
                            } catch (e) {
                              parsedDate = undefined;
                            }
                          }

                          const userName = attempt.createdByName || attempt.createdBy || 'Unknown';
                          const loggedByName = attempt.loggedByName;
                          const showLoggedBy = loggedByName && loggedByName !== userName && loggedByName !== 'Unknown';

                          return (
                            <div
                              key={`expanded-${attempt.attemptNumber || attempt.timestamp}`}
                              className="bg-white rounded p-2 border border-amber-200 text-sm group"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-amber-900">
                                      Attempt #{attempt.attemptNumber || '?'}
                                    </span>
                                    {attempt.method && (
                                      <div className="flex items-center gap-1 text-amber-700">
                                        {methodIcons[attempt.method as keyof typeof methodIcons] || <Phone className="w-3 h-3" />}
                                        <span className="text-xs">{methodLabels[attempt.method as keyof typeof methodLabels] || attempt.method}</span>
                                      </div>
                                    )}
                                  </div>
                                  {attempt.outcome && (
                                    <div className="text-xs text-gray-700 mb-1">
                                      <span className="font-medium">Outcome:</span>{' '}
                                      {outcomeLabels[attempt.outcome] || attempt.outcome}
                                    </div>
                                  )}
                                  {attempt.notes && (
                                    <div className="text-xs text-gray-600 mb-1 whitespace-pre-wrap">
                                      {attempt.notes}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 text-xs text-gray-500">
                                    {parsedDate && (
                                      <span>{parsedDate.toLocaleString()}</span>
                                    )}
                                    {userName && userName !== 'unknown' && userName !== 'system' && (
                                      <span>• by {userName}</span>
                                    )}
                                    {showLoggedBy && (
                                      <span className="text-gray-400 italic">
                                        (logged by {loggedByName})
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {/* Edit/Delete buttons for contact attempts */}
                                <div className="flex gap-1 flex-shrink-0">
                                  {onEditContactAttempt && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0 text-amber-700 hover:text-amber-900 hover:bg-amber-100 opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={() => onEditContactAttempt(attempt.attemptNumber)}
                                      title="Edit contact attempt"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                  )}
                                  {onDeleteContactAttempt && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                      onClick={() => onDeleteContactAttempt(attempt.attemptNumber)}
                                      title="Delete contact attempt"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                </div>
              )}
            </div>

            {/* Scheduled Call Info */}
            {request.scheduledCallDate && (
              <div className="bg-brand-primary-lighter rounded-lg p-3">
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

            {/* Event Times + Sandwich Info — side-by-side to avoid wasted vertical space */}
            {(() => {
              const hasEventTimes =
                request.eventStartTime ||
                request.eventEndTime ||
                request.pickupTime ||
                request.pickupDateTime;
              const hasSandwichInfo =
                request.actualSandwichCount ||
                request.actualSandwichTypes ||
                request.estimatedSandwichCount ||
                request.sandwichTypes;

              if (!hasEventTimes && !hasSandwichInfo) return null;

              return (
                <div
                  className={`grid gap-3 ${
                    hasEventTimes && hasSandwichInfo ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {hasEventTimes && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-sm uppercase font-bold tracking-wide text-[#236383] mb-2">
                        Event Times
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {request.eventStartTime && (
                          <div className="flex items-center gap-1.5 text-sm">
                            <Clock className="w-4 h-4 text-[#007E8C] shrink-0" />
                            <span className="font-medium text-gray-700">Start:</span>
                            <span className="text-gray-900">{formatTime12Hour(request.eventStartTime)}</span>
                          </div>
                        )}
                        {request.eventEndTime && (
                          <div className="flex items-center gap-1.5 text-sm">
                            <Clock className="w-4 h-4 text-[#007E8C] shrink-0" />
                            <span className="font-medium text-gray-700">End:</span>
                            <span className="text-gray-900">{formatTime12Hour(request.eventEndTime)}</span>
                          </div>
                        )}
                        {(request.pickupTime || request.pickupDateTime) && (
                          <div className="flex items-center gap-1.5 text-sm">
                            <Package className="w-4 h-4 text-[#007E8C] shrink-0" />
                            <span className="font-medium text-gray-700">Pickup:</span>
                            <span className="text-gray-900">
                              {request.pickupDateTime
                                ? formatTime12Hour(
                                    new Date(request.pickupDateTime).toTimeString().slice(0, 5)
                                  )
                                : request.pickupTime
                                  ? formatTime12Hour(request.pickupTime)
                                  : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {hasSandwichInfo && (
                    <div className="bg-amber-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Package className="w-4 h-4 text-amber-600 shrink-0" />
                        <span className="text-sm font-semibold text-amber-800 uppercase tracking-wide">
                          {request.actualSandwichCount || request.actualSandwichTypes
                            ? 'Actual Sandwiches'
                            : 'Estimated Sandwiches'}
                        </span>
                      </div>
                      <div className="text-sm">
                        {request.actualSandwichCount || request.actualSandwichTypes ? (
                          <div>
                            {request.actualSandwichTypes &&
                            Array.isArray(request.actualSandwichTypes) &&
                            request.actualSandwichTypes.length > 0 ? (
                              <div className="space-y-1">
                                <div className="font-medium text-amber-900">
                                  {formatSandwichTypesDisplay(
                                    request.actualSandwichTypes,
                                    request.actualSandwichCount ?? undefined,
                                    { unknownAmounts: false }
                                  )}
                                </div>
                                {request.actualSandwichCount && (
                                  <div className="text-xs text-amber-700">
                                    Total: {request.actualSandwichCount} sandwiches
                                  </div>
                                )}
                              </div>
                            ) : request.actualSandwichCount ? (
                              <div className="font-medium text-amber-900">
                                {request.actualSandwichCount} sandwiches
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="font-medium text-amber-900">
                            {formatEventEstimate(request)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Right Column - Contact Info & TSP Contact */}
          <div className="space-y-3">
            {/* Contact Info */}
            <CardContactInfo
              request={request}
              onCall={onCall}
              onIntakeCall={onIntakeCall}
              onContact={onContact}
            />

            {/* TSP Contact Section - Prominent display */}
            {(request.tspContact || request.customTspContact) && (
              <div className="p-4 bg-gradient-to-r from-[#FBAD3F]/10 to-[#D68319]/10 border-2 border-[#FBAD3F]/30 rounded-lg">
                <div className="flex items-center gap-3 group">
                  <div className="bg-[#FBAD3F] p-2 rounded-full">
                    <Building className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm uppercase font-bold tracking-wide text-[#236383] mb-1">
                      TSP Contact
                    </div>
                    <div className="text-base font-semibold text-[#007E8C] break-words">
                      {request.tspContact ? (resolveUserName ? resolveUserName(request.tspContact) : request.tspContact) : request.customTspContact}
                    </div>
                    {request.tspContactAssignedDate && (
                      <div className="text-sm text-gray-600 mt-1">
                        Assigned {new Date(request.tspContactAssignedDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  {canEditTspContact && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={onEditTspContact}
                          className="h-8 w-8 p-0 text-[#D68319] hover:bg-[#FBAD3F]/20 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Edit TSP contact assignment</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Notes & Requirements Section */}
        {(request.message || request.schedulingNotes || request.planningNotes || request.additionalRequirements) && (
          <div className="bg-white rounded-lg p-4 mb-4 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Notes & Requirements
            </h3>
            <div className="space-y-3">
              {request.message && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    Initial Request Notes
                    {request.createdAt && (
                      <span className="text-gray-500 font-normal ml-2">
                        (Submitted {new Date(request.createdAt).toLocaleDateString()})
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded border-l-4 border-blue-400 whitespace-pre-wrap">
                    {request.message}
                  </p>
                </div>
              )}
              {request.schedulingNotes && (
                <div>
                  <p className="text-sm font-medium mb-1">Scheduling Notes:</p>
                  <p className="text-sm text-gray-700 bg-green-50 p-3 rounded border-l-4 border-green-400 whitespace-pre-wrap">
                    {request.schedulingNotes}
                  </p>
                </div>
              )}
              {request.planningNotes && (
                <div>
                  <p className="text-sm font-medium mb-1">Planning Notes:</p>
                  <p className="text-sm text-gray-700 bg-yellow-50 p-3 rounded border-l-4 border-yellow-400 whitespace-pre-wrap">
                    {request.planningNotes}
                  </p>
                </div>
              )}
              {request.additionalRequirements && (
                <div>
                  <p className="text-sm font-medium mb-1">Additional Requirements:</p>
                  <p className="text-sm text-gray-700 bg-purple-50 p-3 rounded border-l-4 border-purple-400 whitespace-pre-wrap">
                    {request.additionalRequirements}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Communication & Notes Section */}
        {request.id && (
          <div className="bg-white rounded-lg p-4 mb-4 border border-gray-200">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowComments(!showComments)}
                className="flex-1 justify-between text-gray-700 hover:text-gray-700 hover:bg-gray-50 font-medium p-2 h-auto min-w-0"
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowComments(true)}
                className="sm:ml-2 w-full sm:w-auto border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10"
              >
                <MessageSquare className="w-4 h-4 mr-1" />
                Add Comment
              </Button>
            </div>

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

        {/* Action Buttons */}
        <TooltipProvider>
          <CardActionRow>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  onClick={onSchedule}
                  className="bg-[#FBAD3F] hover:bg-[#e89a2d] text-white"
                >
                  <Calendar className="w-4 h-4 mr-1" />
                  <span className="sm:hidden">Schedule</span>
                  <span className="hidden sm:inline">Mark Scheduled</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Mark this event as scheduled</p>
              </TooltipContent>
            </Tooltip>

            {/* Legacy quick-schedule workaround — hidden behind a default-off flag
                now that the full scheduling form is trusted. See feature-flags.ts. */}
            {EVENT_REQUEST_FEATURES.quickScheduleButton && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <QuickScheduleButton
                      eventId={request.id}
                      eventName={request.organizationName || 'Event'}
                      currentStatus={request.status}
                      scheduledDate={request.desiredEventDate}
                      hasRefrigeration={request.hasRefrigeration}
                      sandwichTypes={request.sandwichTypes as Array<{ type: string; quantity: number }> | null}
                      size="sm"
                      variant="outline"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Quick schedule (bypass form)</p>
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onScheduleCall}
                 
                >
                  <Phone className="w-4 h-4 mr-1" />
                  {request.scheduledCallDate ? (
                    <>
                      <span className="sm:hidden">Reschedule</span>
                      <span className="hidden sm:inline">Reschedule Call</span>
                    </>
                  ) : (
                    <>
                      <span className="sm:hidden">Call</span>
                      <span className="hidden sm:inline">Schedule Call</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{request.scheduledCallDate ? 'Reschedule the call with organizer' : 'Schedule a call with organizer'}</p>
              </TooltipContent>
            </Tooltip>

            <Button
              size="sm"
              variant="outline"
              onClick={onLogContact}
              className="border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10"
              title="Log a contact attempt or conversation"
            >
              <MessageSquare className="w-4 h-4 mr-1" />
              Log Contact
            </Button>

            <ReminderRulesManager
              eventRequestId={request.id}
              tspContactUserId={request.tspContact || request.tspContactAssigned}
              eventStatus={request.status}
            />

            {onResendToolkit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={onResendToolkit}>
                    <Package className="w-4 h-4 mr-1" />
                    Resend Toolkit
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Resend toolkit email to organizer</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* TSP Contact Assignment - only show if not already assigned and user has permission */}
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

            {/* Van needed — button slot. Only renders when neither vanDriverNeeded
                nor vanNeededLikely is set. Sits with the workflow actions, not the
                pills, so the call-to-action lives where the user is already looking
                for actions to take. */}
            <VanNeededBadgeAndButton
              eventRequestId={request.id}
              vanDriverNeeded={request.vanDriverNeeded}
              vanNeededLikely={(request as any).vanNeededLikely}
              canEdit={!!canEdit}
              mode="button"
            />

            {/* AI Tools group — visually separated from manual workflow actions above */}
            {(((request.desiredEventDate || request.backupDates?.length) && onAiSuggest) || onAiIntakeAssist) && (
              <div
                className="self-stretch border-l border-slate-200 mx-1"
                aria-hidden="true"
              />
            )}

            {/* AI Date Suggestion - show if there are dates to analyze */}
            {(request.desiredEventDate || request.backupDates?.length) && onAiSuggest && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onAiSuggest}
                    className="border-[#236383] text-[#236383] hover:bg-[#236383]/10"
                    data-testid="button-ai-suggest-date"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    <span className="sm:hidden">AI Dates</span>
                    <span className="hidden sm:inline">AI Date Suggest</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Get AI suggestions for the best event date</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* AI Intake Assistant - always available */}
            {onAiIntakeAssist && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onAiIntakeAssist}
                    className="border-[#47B3CB] text-[#47B3CB] hover:bg-[#47B3CB]/10"
                    data-testid="button-ai-intake-assist"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    <span className="sm:hidden">AI Intake</span>
                    <span className="hidden sm:inline">AI Intake Check</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Use AI to check intake information</p>
                </TooltipContent>
              </Tooltip>
            )}

            <ActionRowSpacer />

            {/* Card management cluster — visually separated from workflow actions */}
            <div
              className="self-stretch border-l border-slate-200 mx-1"
              aria-hidden="true"
            />

            {/* Edit/Schedule Button - Always show */}
            {(() => {
              const contextualAction = getPrimaryContextualAction(request);
              const tooltip = getContextualTooltip(request);

              // Determine which action to call
              const handleClick = () => {
                if (contextualAction?.action === 'schedule') {
                  onSchedule();
                } else {
                  onEdit();
                }
              };

              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={contextualAction?.action === 'schedule' ? 'default' : 'outline'}
                      onClick={handleClick}
                      className={contextualAction?.action === 'schedule' ? 'bg-[#007E8C] hover:bg-[#005f6b]' : ''}
                      data-testid="button-edit-request"
                    >
                      {contextualAction?.action === 'schedule' ? (
                        <CalendarCheck className="w-4 h-4 mr-1.5" />
                      ) : (
                        <Edit className="w-4 h-4 mr-1.5" />
                      )}
                      <span className="hidden sm:inline">{contextualAction?.label || 'Edit'}</span>
                      <span className="sm:hidden">{contextualAction?.action === 'schedule' ? 'Schedule' : 'Edit'}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{tooltip}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })()}
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <ConfirmationDialog
                      trigger={
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 h-8"
                          data-testid="button-delete-request"
                        >
                          <Trash2 className="w-4 h-4 mr-1.5 sm:mr-0" />
                          <span className="sm:hidden">Delete</span>
                        </Button>
                      }
                      title="Delete In-Process Event"
                      description={`Are you sure you want to delete the in-process event from ${request.organizationName}? This will remove all progress and cannot be undone.`}
                      confirmText="Delete Request"
                      cancelText="Cancel"
                      onConfirm={onDelete}
                      variant="destructive"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Delete this event request</p>
                </TooltipContent>
              </Tooltip>
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
            className="w-full justify-between text-gray-600 hover:text-gray-800 p-2"
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
      </CardContent>

    </Card>
  );
};
