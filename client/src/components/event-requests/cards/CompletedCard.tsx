import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CardActionRow, ActionRowSpacer } from './card-ui';
import {
  Calendar,
  Clock,
  Package,
  Mail,
  Eye,
  Trash2,
  CheckCircle,
  FileText,
  MessageCircle,
  RefreshCw,
  MapPin,
  Building,
  AlertTriangle,
  Edit2,
  Save,
  X,
  Car,
  Megaphone,
  Users,
  UserPlus,
  UserX,
  Check,
  History,
  ChevronDown,
  ChevronUp,
  Share2,
  Instagram,
  Home,
  MessageSquare,
  Copy,
  Plus,
} from 'lucide-react';
import { formatTime12Hour, formatEventDate } from '@/components/event-requests/utils';
import { useEventQueries } from '../hooks/useEventQueries';
import { formatSandwichTypesDisplay, parseSandwichTypes } from '@/lib/sandwich-utils';
import { hasActiveSandwichRange } from '@shared/sandwich-count-utils';
import { getDisplayName } from '@/lib/userHelpers';
import { extractNameFromCustomId } from '@/lib/utils';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { statusIcons, statusOptions, statusBorderColors, SANDWICH_TYPES, statusTooltips, indicatorTooltips } from '@/components/event-requests/constants';
import { PostEventNotes } from '@/components/event-requests/PostEventNotes';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EventRequest } from '@shared/schema';
import { EventRequestAuditLog } from '@/components/event-request-audit-log';
import { MessageComposer } from '@/components/message-composer';
import { useEventCollaboration } from '@/hooks/use-event-collaboration';
import { CommentThread, CompactPresenceBadge } from '@/components/collaboration';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest, applyPatchResponseToCache } from '@/lib/queryClient';
import { patchEventRequestVerified } from '@/lib/event-save-verification';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logger } from '@/lib/logger';
import { MultiRecipientSelector } from '@/components/ui/multi-recipient-selector';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import {
  RecipientAllocationEditor,
  RecipientAllocationDisplay,
  type RecipientAllocation,
} from '../RecipientAllocationEditor';
import SendKudosButton from '@/components/send-kudos-button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

/**
 * Only http(s) links are allowed for the social-media post link. Guards against
 * stored-XSS: the value is rendered into an <a href>, so a stored
 * `javascript:`/`data:` URL would execute on click. Returns a normalized URL
 * (prepending https:// when the scheme is missing) or null if it isn't a safe
 * web URL.
 */
function toSafeHttpUrl(value: string | null | undefined): string | null {
  const v = (value || '').trim();
  if (!v) return null;
  try {
    const url = new URL(v.includes('://') ? v : `https://${v}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

interface CompletedCardProps {
  request: EventRequest;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onContact: () => void;
  onFollowUp1Day: () => void;
  onFollowUp1Month: () => void;
  onViewCollectionLog?: () => void;
  /** Count from linked collection log entries; null when none are linked, undefined while loading. */
  loggedSandwiches?: { count: number; entries: number } | null;
  onReschedule: () => void;
  onDuplicate?: () => void;
  onAssignTspContact: () => void;
  onEditTspContact: () => void;
  onLogContact: () => void;
  onAddNextAction?: () => void;
  onEditNextAction?: () => void;
  onCompleteNextAction?: () => void;
  resolveUserName: (id: string) => string;
  canDelete?: boolean;
  openAssignmentDialog?: (type: 'driver' | 'volunteer') => void;
  openEditAssignmentDialog?: (type: 'driver' | 'volunteer', personId: string) => void;
  handleRemoveAssignment?: (type: 'driver' | 'volunteer', personId: string) => void;
  handleSelfSignup?: (type: 'driver' | 'volunteer') => void;
  canSelfSignup?: (request: EventRequest, type: 'driver' | 'volunteer') => boolean;
  isUserSignedUp?: (request: EventRequest, type: 'driver' | 'volunteer') => boolean;
}

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
  resolveUserName?: (id: string) => string;
  canEditOrgDetails?: boolean;
  // TSP Contact editing
  isEditingTspContact?: boolean;
  editingTspContactId?: number | null;
  editingCustomTspContact?: string;
  tspContactInputMode?: 'dropdown' | 'text';
  startEditingTspContact?: () => void;
  saveTspContact?: () => void;
  cancelTspContactEdit?: () => void;
  setEditingTspContactId?: (id: number) => void;
  setEditingCustomTspContact?: (value: string) => void;
  setTspContactInputMode?: (mode: 'dropdown' | 'text') => void;
  users?: { id: number; name: string; email: string }[];
  updateTspContactMutation?: ReturnType<typeof useMutation>;
  tempIsConfirmed?: boolean;
  setTempIsConfirmed?: (value: boolean) => void;
  presentUsers?: Array<{ userId: string; userName: string; joinedAt: Date; lastHeartbeat: Date; socketId: string }>;
  currentUserId?: string;
  canEditTspContact?: boolean;
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
  resolveUserName,
  canEditOrgDetails = false,
  // TSP Contact editing
  isEditingTspContact = false,
  editingTspContactId = null,
  editingCustomTspContact = '',
  tspContactInputMode = 'dropdown',
  startEditingTspContact,
  saveTspContact,
  cancelTspContactEdit,
  setEditingTspContactId,
  setEditingCustomTspContact,
  setTspContactInputMode,
  users = [],
  updateTspContactMutation,
  tempIsConfirmed = false,
  setTempIsConfirmed,
  presentUsers = [],
  currentUserId = '',
  canEditTspContact = false,
}) => {
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
  // Completed events show "Event Date" regardless of whether the date comes from
  // scheduledEventDate or the original desiredEventDate — the event already happened on this date.
  if (request.status === 'completed') {
    dateLabel = 'Event Date';
    if (request.scheduledEventDate) {
      dateFieldToEdit = 'scheduledEventDate';
    }
  } else if (request.scheduledEventDate) {
    dateFieldToEdit = 'scheduledEventDate';
    dateLabel = 'Scheduled Date';
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

  return (
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-start space-x-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Real-time Presence Indicator */}
            {presentUsers && presentUsers.length > 0 && currentUserId && (
              <CompactPresenceBadge 
                users={presentUsers} 
                currentUserId={currentUserId}
                className="mr-1"
              />
            )}
            {/* Organization Name - with inline editing for admins */}
            {isEditingOrgName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editingValue}
                  onChange={(e) => setEditingValue?.(e.target.value)}
                  className="h-8 text-lg font-semibold"
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
                <h3 className="font-bold text-lg sm:text-xl text-[#236383] break-words">
                  {request.organizationName}
                </h3>
                {canEditOrgDetails && startEditing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEditing('organizationName', request.organizationName || '')}
                    className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Edit organization name"
                    data-testid="button-edit-org-name"
                  >
                    <Edit2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            )}

            {/* Department - with inline editing for admins */}
            {(request.department || isEditingDepartment || canEditOrgDetails) && (
              <>
                <span className="text-gray-600">&bull;</span>
                {isEditingDepartment ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editingValue}
                      onChange={(e) => setEditingValue?.(e.target.value)}
                      className="h-8"
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
                      <span className="text-gray-600">{request.department}</span>
                    ) : canEditOrgDetails ? (
                      <span className="text-gray-400 italic text-sm">No department</span>
                    ) : null}
                    {canEditOrgDetails && startEditing && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing('department', request.department || '')}
                        className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
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

            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className="inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-primary/80 bg-gradient-to-br from-[#e6f2f5] to-[#d1e9ed] text-[#236383] border border-[#236383]/30 text-[16px] cursor-help">
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {getStatusLabel(request.status)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{statusTooltips[request.status] || 'Event status'}</p>
              </TooltipContent>
            </Tooltip>
            {/* Confirmation Status Badge — hidden for completed events (obviously already confirmed) */}
            {request.status !== 'completed' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    onClick={() => startEditing?.('isConfirmed', (!request.isConfirmed).toString())}
                    className={`px-3 py-1 text-sm font-medium shadow-sm inline-flex items-center cursor-pointer hover:opacity-80 transition-opacity ${
                      request.isConfirmed ? 'bg-green-600 text-white' : 'bg-gray-400 text-white'
                    }`}
                  >
                    {request.isConfirmed ? '✓ Date Confirmed' : 'Date Pending'}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{request.isConfirmed ? indicatorTooltips.dateConfirmed : indicatorTooltips.datePending}</p>
                  <p className="text-xs text-muted-foreground mt-1">Click to toggle</p>
                </TooltipContent>
              </Tooltip>
            )}
            {isInProcessStale && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 cursor-help">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Needs follow-up
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{indicatorTooltips.needsFollowUp}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Rescheduled indicator - shows original date when event was rescheduled */}
            {request.originalScheduledDate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 cursor-help">
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Rescheduled from {new Date(request.originalScheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-medium">This event was rescheduled</p>
                    <p className="text-sm">Originally scheduled: {new Date(request.originalScheduledDate).toLocaleDateString()}</p>
                    {request.postponementReason && (
                      <p className="text-sm">Reason: {request.postponementReason}</p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Was Postponed indicator - shows when event went through postponement */}
            {request.wasPostponed && !request.originalScheduledDate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 cursor-help">
                    <History className="w-3 h-3 mr-1" />
                    Previously Rescheduled
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>This event was rescheduled before completion</p>
                  {request.postponementReason && (
                    <p className="text-sm mt-1">Reason: {request.postponementReason}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {/* Corporate Priority Badge */}
            {(request as any).isCorporatePriority && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="px-2.5 py-1 text-sm font-medium shadow-sm inline-flex items-center whitespace-nowrap bg-gradient-to-br from-[#B8860B] to-[#DAA520] text-white cursor-help">
                    <Building className="w-3 h-3 mr-1" />
                    Corporate
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-medium">This was a Corporate Event</p>
                    <p className="text-sm">Required immediate contact and core team member attendance.</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {request.selfTransport && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="bg-amber-50 text-amber-800 border border-amber-400 text-xs sm:text-sm font-medium inline-flex items-center gap-1 cursor-help">
                    <Car className="w-3 h-3" />
                    <span className="hidden sm:inline">Self-Transport</span>
                    <span className="sm:hidden">Self</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{indicatorTooltips.selfTransport}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="text-sm text-[#236383] mt-1 space-y-1">
            {/* Contact Information */}
            <div className="text-sm text-gray-700 mb-2">
              <strong>{request.firstName} {request.lastName}</strong>
              {request.email && (
                <span className="ml-2">• {request.email}</span>
              )}
              {request.phone && (
                <span className="ml-2">• {request.phone}</span>
              )}
            </div>
            {/* Backup Contact */}
            {((request as any).backupContactFirstName || (request as any).backupContactLastName || (request as any).backupContactEmail || (request as any).backupContactPhone) && (
              <div className="text-sm text-gray-600 mb-2 pl-2 border-l-2 border-gray-300">
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Backup Contact</div>
                <div>
                  {((request as any).backupContactFirstName || (request as any).backupContactLastName) && (
                    <strong>
                      {(request as any).backupContactFirstName} {(request as any).backupContactLastName}
                      {(request as any).backupContactRole && (
                        <span className="text-gray-500 font-normal ml-1">({(request as any).backupContactRole})</span>
                      )}
                    </strong>
                  )}
                  {(request as any).backupContactEmail && (
                    <span className="ml-2">• {(request as any).backupContactEmail}</span>
                  )}
                  {(request as any).backupContactPhone && (
                    <span className="ml-2">• {(request as any).backupContactPhone}</span>
                  )}
                </div>
              </div>
            )}
            {/* TSP Contact */}
            <div className="text-sm text-[#D68319] mb-2 group relative">
              <span className="font-medium">TSP Contact: </span>
              {isEditingTspContact ? (
                <div className="inline-flex items-center gap-2 ml-2 flex-wrap">
                  {tspContactInputMode === 'dropdown' ? (
                    <>
                      <Select
                        value={editingTspContactId?.toString() || ''}
                        onValueChange={(value) => setEditingTspContactId?.(parseInt(value))}
                      >
                        <SelectTrigger className="h-8 w-48">
                          <SelectValue placeholder="Select user..." />
                        </SelectTrigger>
                        <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                          {users.filter((user) => user.id).map((user) => (
                            <SelectItem key={user.id} value={user.id.toString()}>
                              {user.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => setTspContactInputMode?.('text')}
                        className="h-7 px-2 text-xs"
                        title="Switch to custom name"
                      >
                        or enter name
                      </Button>
                    </>
                  ) : (
                    <>
                      <Input
                        value={editingCustomTspContact}
                        onChange={(e) => setEditingCustomTspContact?.(e.target.value)}
                        placeholder="Enter TSP contact name..."
                        className="h-8 w-48"
                        autoFocus
                      />
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => setTspContactInputMode?.('dropdown')}
                        className="h-7 px-2 text-xs"
                        title="Switch to user dropdown"
                      >
                        or select user
                      </Button>
                    </>
                  )}
                  <Button size="sm" onClick={saveTspContact} disabled={updateTspContactMutation?.isPending} className="h-7 px-2">
                    <Save className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelTspContactEdit} className="h-7 px-2">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <>
                  {(request.tspContact || request.customTspContact) ? (
                    <>
                      <span className="font-normal">
                        {request.tspContact ? (resolveUserName ? resolveUserName(request.tspContact) : request.tspContact) : request.customTspContact}
                      </span>
                      {request.tspContactAssignedDate && (
                        <span className="ml-2 text-xs text-gray-500">
                          (assigned {new Date(request.tspContactAssignedDate).toLocaleDateString()})
                        </span>
                      )}
                      {canEditTspContact && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={startEditingTspContact}
                          className="ml-2 h-6 w-6 p-0 text-[#236383] hover:bg-[#236383]/10 transition-opacity opacity-0 group-hover:opacity-100"
                          title="Edit TSP contact"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      )}
                    </>
                  ) : canEditTspContact ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={startEditingTspContact}
                      className="ml-2 h-7 px-3 text-xs"
                    >
                      Assign TSP Contact
                    </Button>
                  ) : (
                    <span className="text-gray-400">Not assigned</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {isEditingDate ? (
                <div className="flex flex-col gap-2">
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
                  {/* Don't show confirmation checkbox for completed events - they're always confirmed */}
                  {request.status !== 'completed' && (
                    <div className="flex items-center gap-2 ml-2">
                      <Checkbox
                        id="confirm-date-checkbox"
                        checked={tempIsConfirmed}
                        onCheckedChange={(checked) => setTempIsConfirmed?.(!!checked)}
                      />
                      <label
                        htmlFor="confirm-date-checkbox"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        Mark as confirmed by our team
                      </label>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <span data-testid="text-date-label" className="text-sm sm:text-base md:text-lg">
                    {dateLabel}: {' '}
                    <strong className="text-sm sm:text-base md:text-lg break-words" data-testid="text-date-value">
                      {displayDate && dateInfo ? dateInfo.text : 'No date set'}
                    </strong>
                    {request.eventStartTime && (
                      <span className="text-gray-600 ml-1.5" data-testid="text-event-time">
                        · {formatTime12Hour(request.eventStartTime)}
                        {request.eventEndTime && ` - ${formatTime12Hour(request.eventEndTime)}`}
                      </span>
                    )}
                    {displayDate && getRelativeTime(displayDate.toString()) && (
                      <span className="text-[#236383] ml-1">({getRelativeTime(displayDate.toString())})</span>
                    )}
                  </span>
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
            {/* Event Address — always a Google Maps link */}
            {(request.eventAddress || (isEditingThisCard && editingField === 'eventAddress') || canEditOrgDetails) && (
              <div className="flex items-start gap-1 group mt-1">
                <MapPin className="w-3.5 h-3.5 mt-1 shrink-0 text-[#236383]" />
                {isEditingThisCard && editingField === 'eventAddress' ? (
                  <div className="flex flex-col gap-2 flex-1">
                    <Textarea
                      value={editingValue}
                      onChange={(e) => setEditingValue?.(e.target.value)}
                      className="min-h-[60px]"
                      placeholder="Enter event address"
                      autoFocus
                      data-testid="input-event-address"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit} data-testid="button-save-event-address">
                        <Save className="w-3 h-3 mr-1" />
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit} data-testid="button-cancel-event-address">
                        <X className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {request.eventAddress ? (
                      <a
                        href={`https://maps.google.com/maps?q=${encodeURIComponent(request.eventAddress)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm sm:text-base text-[#236383] hover:text-[#007e8c] hover:underline break-words flex-1"
                        data-testid="link-event-address"
                      >
                        {request.eventAddress}
                      </a>
                    ) : (
                      <span className="text-sm text-gray-400 italic flex-1">No address provided</span>
                    )}
                    {canEditOrgDetails && startEditing && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing('eventAddress', request.eventAddress || '')}
                        className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title={request.eventAddress ? 'Edit address' : 'Add address'}
                        data-testid="button-edit-event-address-header"
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// CardAssignments component - copied from shared
interface CardAssignmentsProps {
  request: EventRequest;
  resolveUserName: (id: string) => string;
  canEdit?: boolean;
  canSelfSignup?: (request: EventRequest, type: 'driver' | 'volunteer') => boolean;
  isUserSignedUp?: (request: EventRequest, type: 'driver' | 'volunteer') => boolean;
  onAssign?: (type: 'driver' | 'volunteer') => void;
  onEditAssignment?: (type: 'driver' | 'volunteer', personId: string) => void;
  onRemoveAssignment?: (type: 'driver' | 'volunteer', personId: string) => void;
  onSelfSignup?: (type: 'driver' | 'volunteer') => void;
}

const CardAssignments: React.FC<CardAssignmentsProps> = ({
  request,
  resolveUserName,
  canEdit = false,
  canSelfSignup,
  isUserSignedUp,
  onAssign,
  onEditAssignment,
  onRemoveAssignment,
  onSelfSignup,
}) => {
  const parsePostgresArray = (arr: unknown): string[] => {
    if (!arr) return [];
    if (Array.isArray(arr)) return arr.map(String).filter((item) => item && item.trim());
    if (typeof arr === 'string') {
      if (arr === '{}' || arr === '') return [];
      const cleaned = arr.replace(/^{|}$/g, '');
      if (!cleaned) return [];
      if (cleaned.includes('"')) {
        const matches = cleaned.match(/"[^"]*"|[^",]+/g);
        return matches ? matches.map(item => item.replace(/"/g, '').trim()).filter(item => item) : [];
      }
      return cleaned.split(',').map(item => item.trim()).filter(item => item);
    }
    return [];
  };

  // Get all team members with names
  const getDrivers = () => {
    const regularDrivers = parsePostgresArray(request.assignedDriverIds);
    const drivers: { id: string; name: string }[] = regularDrivers.map(id => {
      const detailName = (request.driverDetails as Record<string, { name?: string }>)?.[id]?.name;
      const isCustom = id.startsWith('custom-');
      // Check if ID itself looks like a human name (not a system ID)
      const idLooksLikeName = id &&
        !id.startsWith('user_') &&
        !id.startsWith('driver_') &&
        !id.startsWith('driver-') &&
        !id.startsWith('custom-') &&
        !id.startsWith('host-contact-') &&
        !/^\d+$/.test(id) &&
        id.includes(' ');
      const resolvedName = resolveUserName(id);
      let name = (detailName && !/^\d+$/.test(detailName))
        ? detailName
        : isCustom
          ? extractNameFromCustomId(id)
          : (resolvedName !== id ? resolvedName : (idLooksLikeName ? id : resolvedName));
      return { id, name };
    });

    // Add van driver if assigned AND not already in regular drivers (avoid double-counting)
    // Convert vanDriverId to string for consistent comparison
    const vanDriverIdStr = request.assignedVanDriverId ? String(request.assignedVanDriverId) : null;
    if (vanDriverIdStr && !regularDrivers.includes(vanDriverIdStr)) {
      let vanDriverName = request.customVanDriverName || resolveUserName(vanDriverIdStr);
      if (vanDriverName.startsWith('custom-')) {
        vanDriverName = extractNameFromCustomId(vanDriverName);
      }
      drivers.push({ id: vanDriverIdStr, name: vanDriverName });
    }

    return drivers;
  };

  const getSpeakers = () => {
    const speakerIds = Object.keys(request.speakerDetails || {});
    return speakerIds.map(id => {
      const detailName = (request.speakerDetails as Record<string, { name?: string }>)?.[id]?.name;
      const isCustom = id.startsWith('custom-');
      // Check if ID itself looks like a human name (not a system ID)
      const idLooksLikeName = id &&
        !id.startsWith('user_') &&
        !id.startsWith('driver_') &&
        !id.startsWith('custom-') &&
        !id.startsWith('host-contact-') &&
        !/^\d+$/.test(id) &&
        id.includes(' ');
      const resolvedName = resolveUserName(id);
      let name = (detailName && !/^\d+$/.test(detailName))
        ? detailName
        : isCustom
          ? extractNameFromCustomId(id)
          : (resolvedName !== id ? resolvedName : (idLooksLikeName ? id : resolvedName));
      return { id, name };
    });
  };

  const getVolunteers = () => {
    const volunteerIds = parsePostgresArray(request.assignedVolunteerIds);
    return volunteerIds.map(id => {
      const isCustom = id.startsWith('custom-');
      // Check if ID itself looks like a human name (not a system ID)
      const idLooksLikeName = id &&
        !id.startsWith('user_') &&
        !id.startsWith('driver_') &&
        !id.startsWith('volunteer_') &&
        !id.startsWith('volunteer-') &&
        !id.startsWith('custom-') &&
        !id.startsWith('host-contact-') &&
        !/^\d+$/.test(id) &&
        id.includes(' ');
      const resolvedName = resolveUserName(id);
      let name = isCustom
        ? extractNameFromCustomId(id)
        : (resolvedName !== id ? resolvedName : (idLooksLikeName ? id : resolvedName));
      return { id, name };
    });
  };

  const drivers = getDrivers();
  const speakers = getSpeakers();
  const volunteers = getVolunteers();

  // Calculate staffing gaps - use drivers.length which is already deduplicated
  const staffingGaps: string[] = [];
  const driversNeeded = request.driversNeeded || 0;
  const speakersNeeded = request.speakersNeeded || 0;
  const volunteersNeeded = request.volunteersNeeded || 0;

  // Only check driver staffing gap if not self-transport
  if (!request.selfTransport && driversNeeded > drivers.length) {
    staffingGaps.push(`Needed ${driversNeeded} driver${driversNeeded > 1 ? 's' : ''} (had ${drivers.length})`);
  }
  if (speakersNeeded > speakers.length) {
    staffingGaps.push(`Needed ${speakersNeeded} speaker${speakersNeeded > 1 ? 's' : ''} (had ${speakers.length})`);
  }
  if (volunteersNeeded > volunteers.length) {
    staffingGaps.push(`Needed ${volunteersNeeded} volunteer${volunteersNeeded > 1 ? 's' : ''} (had ${volunteers.length})`);
  }

  return (
    <div className="space-y-3">
      {/* Unmet Needs Alert - only show if there were staffing gaps */}
      {staffingGaps.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            <span className="font-semibold">Staffing Gap: </span>
            {staffingGaps.join(', ')}
          </div>
        </div>
      )}

      {/* Compact Team Display */}
      <div className="bg-white/50 rounded-lg px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Drivers or Self-Transport */}
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-[#236383]" />
            {request.selfTransport ? (
              // Organization transported sandwiches themselves - clickable to switch to driver
              <div className="flex items-center gap-1">
                <Badge
                  variant="outline"
                  className="bg-[#FBAD3F]/20 text-[#D68319] border-[#FBAD3F] font-medium text-xs px-2 py-0.5 cursor-pointer hover:bg-[#FBAD3F]/30 transition-colors"
                  title="Click to change to driver assignment"
                  onClick={() => {
                    if (canEdit && startEditing && saveEdit) {
                      startEditing('selfTransport', 'false');
                      setTimeout(() => saveEdit(), 0);
                    }
                  }}
                >
                  <Car className="w-3 h-3 mr-1" />
                  Self-Transport
                  {canEdit && startEditing && (
                    <Edit2 className="w-2.5 h-2.5 ml-1 opacity-60" />
                  )}
                </Badge>
              </div>
            ) : (
              <>
                <span className="font-medium text-[#236383]">Drivers:</span>
                {drivers.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {drivers.map((driver, index) => (
                      <React.Fragment key={driver.id}>
                        <Badge
                          variant="secondary"
                          className="bg-[#236383]/10 text-[#236383] text-xs px-2 py-0.5 group relative"
                          data-testid={`badge-driver-${driver.id}`}
                        >
                          <span className="flex items-center gap-1">
                            {driver.name}
                            <SendKudosButton
                              recipientId={driver.id}
                              recipientName={driver.name}
                              contextType="project"
                              contextId={request.id.toString()}
                              contextTitle={`${request.organizationName} event`}
                              size="sm"
                              variant="outline"
                              iconOnly
                              className="h-3 w-3 p-0"
                            />
                            {canEdit && onRemoveAssignment && (
                              <button
                                onClick={() => onRemoveAssignment('driver', driver.id)}
                                className="inline-flex items-center justify-center w-3 h-3 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-100 focus:text-red-600 focus:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 transition-all"
                                title="Remove driver"
                                data-testid={`button-remove-driver-${driver.id}`}
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </span>
                        </Badge>
                        {index < drivers.length - 1 && <span className="text-gray-400">•</span>}
                      </React.Fragment>
                    ))}
                  </div>
                ) : (
                  <Badge
                    variant="outline"
                    className={`text-gray-400 border-gray-300 text-xs px-2 py-0.5 ${canEdit && onAssign ? 'cursor-pointer hover:bg-gray-100 hover:text-gray-600 hover:border-gray-400 transition-colors' : ''}`}
                    title={canEdit && onAssign ? "Click to assign a driver" : "No driver was assigned"}
                    onClick={() => { if (canEdit && onAssign) onAssign('driver'); }}
                  >
                    <UserX className="w-3 h-3 mr-1" />
                    None
                  </Badge>
                )}
              </>
            )}
          </div>

          {/* Speakers (retired role — read-only historical display, only shown
              for completed events that actually had speakers assigned) */}
          {speakers.length > 0 && (
            <>
              <span className="text-gray-300">|</span>
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-[#236383]" />
                <span className="font-medium text-[#236383]">Speakers:</span>
                <div className="flex flex-wrap gap-1">
                  {speakers.map((speaker, index) => (
                    <React.Fragment key={speaker.id}>
                      <Badge
                        variant="secondary"
                        className="bg-[#236383]/10 text-[#236383] text-xs px-2 py-0.5 group relative"
                        data-testid={`badge-speaker-${speaker.id}`}
                      >
                        <span className="flex items-center gap-1">
                          {speaker.name}
                          <SendKudosButton
                            recipientId={speaker.id}
                            recipientName={speaker.name}
                            contextType="project"
                            contextId={request.id.toString()}
                            contextTitle={`${request.organizationName} event`}
                            size="sm"
                            variant="outline"
                            iconOnly
                            className="h-3 w-3 p-0"
                          />
                        </span>
                      </Badge>
                      {index < speakers.length - 1 && <span className="text-gray-400">•</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </>
          )}

          <span className="text-gray-300">|</span>

          {/* Volunteers */}
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#236383]" />
            <span className="font-medium text-[#236383]">Volunteers:</span>
            {volunteers.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {volunteers.map((volunteer, index) => (
                  <React.Fragment key={volunteer.id}>
                    <Badge
                      variant="secondary"
                      className="bg-[#236383]/10 text-[#236383] text-xs px-2 py-0.5 group relative"
                      data-testid={`badge-volunteer-${volunteer.id}`}
                    >
                      <span className="flex items-center gap-1">
                        {volunteer.name}
                        <SendKudosButton
                          recipientId={volunteer.id}
                          recipientName={volunteer.name}
                          contextType="project"
                          contextId={request.id.toString()}
                          contextTitle={`${request.organizationName} event`}
                          size="sm"
                          variant="outline"
                          iconOnly
                          className="h-3 w-3 p-0"
                        />
                        {canEdit && onRemoveAssignment && (
                          <button
                            onClick={() => onRemoveAssignment('volunteer', volunteer.id)}
                            className="inline-flex items-center justify-center w-3 h-3 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-100 focus:text-red-600 focus:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 transition-all"
                            title="Remove volunteer"
                            data-testid={`button-remove-volunteer-${volunteer.id}`}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </span>
                    </Badge>
                    {index < volunteers.length - 1 && <span className="text-gray-400">•</span>}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <Badge
                variant="outline"
                className={`text-gray-400 border-gray-300 text-xs px-2 py-0.5 ${canEdit && onAssign ? 'cursor-pointer hover:bg-gray-100 hover:text-gray-600 hover:border-gray-400 transition-colors' : ''}`}
                title={canEdit && onAssign ? "Click to assign a volunteer" : "No volunteer was assigned"}
                onClick={() => { if (canEdit && onAssign) onAssign('volunteer'); }}
              >
                <UserX className="w-3 h-3 mr-1" />
                None
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Simplified Social Media Tracking Component
interface SocialMediaTrackingProps {
  request: EventRequest;
}

const SocialMediaTracking: React.FC<SocialMediaTrackingProps> = ({ request }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State for inline editing
  const [showRequestedDate, setShowRequestedDate] = useState(false);
  const [showPostedDate, setShowPostedDate] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(request.socialMediaPostNotes || '');
  
  // State for post link editing
  const [editingPostLink, setEditingPostLink] = useState(false);
  const [postLink, setPostLink] = useState(request.socialMediaPostLink || '');
  
  // State for Instagram link
  const [showInstagramDialog, setShowInstagramDialog] = useState(false);
  const [instagramLink, setInstagramLink] = useState('');
  const [editingInstagramLink, setEditingInstagramLink] = useState(false);
  const [tempInstagramLink, setTempInstagramLink] = useState('');

  const updateSocialMediaMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest('PATCH', `/api/event-requests/${request.id}/social-media`, data),
    onSuccess: (updatedEvent, variables) => {
      toast({
        title: 'Social media tracking updated',
        description: 'Social media tracking information has been successfully updated.',
      });
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: request.status,
        touchedFields: Object.keys(variables),
      });
      // Reset states
      setShowRequestedDate(false);
      setShowPostedDate(false);
      setEditingNotes(false);
      setShowInstagramDialog(false);
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update social media tracking.',
        variant: 'destructive',
      });
    },
  });

  // Helper to format date for input
  const formatDateForInput = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    return new Date(dateString).toISOString().split('T')[0];
  };

  // Helper to format date for display
  const formatDateForDisplay = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Handle marking as requested (simplified - just use today's date)
  const handleMarkRequested = () => {
    const todayDate = new Date().toISOString();
    updateSocialMediaMutation.mutate({
      socialMediaPostRequested: true,
      socialMediaPostRequestedDate: todayDate,
    });
  };

  // Handle marking as posted (with optional Instagram link)
  const handleMarkPostedWithLink = () => {
    const todayDate = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      socialMediaPostCompleted: true,
      socialMediaPostCompletedDate: todayDate,
    };
    
    // Append Instagram link to existing notes if provided
    if (instagramLink.trim()) {
      const existingNotes = request.socialMediaPostNotes || '';
      const instagramLinkText = `Instagram: ${instagramLink.trim()}`;
      
      // Check if there's already an Instagram link and remove it
      const notesWithoutInstagram = existingNotes.replace(/Instagram:\s*https?:\/\/[^\s\n]+(\n)?/g, '').trim();
      
      // Append the new Instagram link
      if (notesWithoutInstagram) {
        updateData.socialMediaPostNotes = `${notesWithoutInstagram}\n${instagramLinkText}`;
      } else {
        updateData.socialMediaPostNotes = instagramLinkText;
      }
    }
    
    updateSocialMediaMutation.mutate(updateData);
    setInstagramLink('');
  };

  // Update requested date
  const handleUpdateRequestedDate = (newDate: string) => {
    updateSocialMediaMutation.mutate({
      socialMediaPostRequestedDate: newDate ? new Date(newDate).toISOString() : null,
    });
  };

  // Update posted date
  const handleUpdatePostedDate = (newDate: string) => {
    updateSocialMediaMutation.mutate({
      socialMediaPostCompletedDate: newDate ? new Date(newDate).toISOString() : null,
    });
  };

  // Update notes
  const handleUpdateNotes = () => {
    updateSocialMediaMutation.mutate({
      socialMediaPostNotes: notes,
    });
    setEditingNotes(false);
  };

  // Update post link
  const handleUpdatePostLink = () => {
    const trimmed = postLink.trim();
    const normalized = toSafeHttpUrl(trimmed);
    // Reject anything that isn't a valid web (http/https) URL — prevents storing
    // javascript:/data: links that would be unsafe when rendered as an <a href>.
    if (trimmed && !normalized) {
      toast({
        title: 'Invalid link',
        description: 'Please enter a valid web link (http:// or https://).',
        variant: 'destructive',
      });
      return;
    }
    updateSocialMediaMutation.mutate({
      socialMediaPostLink: normalized,
    });
    setEditingPostLink(false);
  };

  // Extract Instagram link from notes if it exists
  const getInstagramLinkFromNotes = () => {
    if (!request.socialMediaPostNotes) return null;
    const match = request.socialMediaPostNotes.match(/Instagram:\s*(https?:\/\/[^\s\n]+)/);
    return match ? match[1] : null;
  };
  
  // Get notes without Instagram link for display
  const getNotesWithoutInstagramLink = () => {
    if (!request.socialMediaPostNotes) return '';
    return request.socialMediaPostNotes.replace(/Instagram:\s*https?:\/\/[^\s\n]+(\n)?/g, '').trim();
  };
  
  // Update Instagram link separately
  const handleUpdateInstagramLink = (newLink: string) => {
    const existingNotes = getNotesWithoutInstagramLink();
    let updatedNotes = existingNotes;
    
    if (newLink.trim()) {
      const instagramLinkText = `Instagram: ${newLink.trim()}`;
      updatedNotes = existingNotes ? `${existingNotes}\n${instagramLinkText}` : instagramLinkText;
    }
    
    updateSocialMediaMutation.mutate({
      socialMediaPostNotes: updatedNotes || null,
    });
    setEditingInstagramLink(false);
    setTempInstagramLink('');
  };
  
  // Remove Instagram link
  const handleRemoveInstagramLink = () => {
    const notesWithoutInstagram = getNotesWithoutInstagramLink();
    updateSocialMediaMutation.mutate({
      socialMediaPostNotes: notesWithoutInstagram || null,
    });
  };

  return (
    <>
      {/* Compact Social Media Tracking Section - positioned in the corner */}
      <div className="inline-block bg-[#47b3cb]/5 rounded-lg p-3 border border-[#47b3cb]/30 max-w-xs" data-testid="social-media-tracking">
        {/* Compact Header */}
        <div className="flex items-center gap-2 mb-2">
          <Share2 className="w-4 h-4 text-[#236383]" />
          <span className="font-semibold text-sm text-[#236383]">Social Media</span>
          {updateSocialMediaMutation.isPending && (
            <span className="text-xs text-[#007e8c] ml-auto">Saving...</span>
          )}
        </div>

        <div className="space-y-2">
          {/* Not requested yet - show compact button */}
          {!request.socialMediaPostRequested && !request.socialMediaPostCompleted && (
            <Button
              onClick={handleMarkRequested}
              className="bg-[#007e8c] hover:bg-[#236383] text-white text-xs px-3 py-1 h-8 w-full"
              disabled={updateSocialMediaMutation.isPending}
            >
              📱 Mark Social Media Requested
            </Button>
          )}

          {/* Requested but not posted - compact display */}
          {request.socialMediaPostRequested && !request.socialMediaPostCompleted && (
            <>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-[#236383] font-medium">✓ Requested</span>
                  {showRequestedDate ? (
                    <Input
                      type="date"
                      value={formatDateForInput(request.socialMediaPostRequestedDate?.toString())}
                      onChange={(e) => {
                        handleUpdateRequestedDate(e.target.value);
                        setShowRequestedDate(false);
                      }}
                      className="h-6 text-xs border-[#47b3cb]"
                      disabled={updateSocialMediaMutation.isPending}
                      onBlur={() => setShowRequestedDate(false)}
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setShowRequestedDate(true)}
                      className="text-[#007e8c] underline hover:text-[#236383] text-xs"
                    >
                      {formatDateForDisplay(request.socialMediaPostRequestedDate?.toString())}
                    </button>
                  )}
                </div>
                
                <Button
                  onClick={() => setShowInstagramDialog(true)}
                  className="bg-[#fbad3f] hover:bg-[#a31c41] text-white text-xs px-3 py-1 h-7 w-full"
                  disabled={updateSocialMediaMutation.isPending}
                >
                  Mark as Posted
                </Button>
              </div>
            </>
          )}

          {/* Posted - compact display */}
          {request.socialMediaPostCompleted && (
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-xs">
                <span className="text-[#236383] font-medium">✓ Posted</span>
                {showPostedDate ? (
                  <Input
                    type="date"
                    value={formatDateForInput(request.socialMediaPostCompletedDate?.toString())}
                    onChange={(e) => {
                      handleUpdatePostedDate(e.target.value);
                      setShowPostedDate(false);
                    }}
                    className="h-6 text-xs border-[#47b3cb]"
                    disabled={updateSocialMediaMutation.isPending}
                    onBlur={() => setShowPostedDate(false)}
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => setShowPostedDate(true)}
                    className="text-[#007e8c] underline hover:text-[#236383] text-xs"
                  >
                    {formatDateForDisplay(request.socialMediaPostCompletedDate?.toString())}
                  </button>
                )}
              </div>
              
              {/* Display notes (without Instagram link) */}
              {getNotesWithoutInstagramLink() && (
                <div className="text-xs text-gray-600 bg-gray-50 rounded p-2 mb-2">
                  <div className="flex items-start gap-1">
                    <MessageCircle className="w-3 h-3 text-gray-500 mt-0.5" />
                    <span>{getNotesWithoutInstagramLink()}</span>
                  </div>
                </div>
              )}
              
              {/* Display/Edit Instagram link */}
              {editingInstagramLink ? (
                <div className="flex flex-col gap-1 mb-2">
                  <div className="flex items-center gap-1">
                    <Instagram className="w-3 h-3 text-[#E4405F]" />
                    <Input
                      type="url"
                      value={tempInstagramLink}
                      onChange={(e) => setTempInstagramLink(e.target.value)}
                      placeholder="https://instagram.com/..."
                      className="h-6 text-xs border-[#E4405F]/30 flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateInstagramLink(tempInstagramLink);
                        }
                        if (e.key === 'Escape') {
                          setEditingInstagramLink(false);
                          setTempInstagramLink('');
                        }
                      }}
                    />
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => handleUpdateInstagramLink(tempInstagramLink)}
                      className="bg-[#E4405F] hover:bg-[#C13584] text-white text-xs px-2 py-0.5 h-5"
                      disabled={updateSocialMediaMutation.isPending}
                    >
                      <Save className="w-3 h-3 mr-1" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingInstagramLink(false);
                        setTempInstagramLink('');
                      }}
                      className="text-xs px-2 py-0.5 h-5"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : getInstagramLinkFromNotes() ? (
                <div className="flex items-center gap-1 text-xs group">
                  <Instagram className="w-3 h-3 text-[#E4405F]" />
                  <a 
                    href={getInstagramLinkFromNotes()!} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[#E4405F] underline hover:text-[#C13584] text-xs flex-1"
                  >
                    View on Instagram
                  </a>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setTempInstagramLink(getInstagramLinkFromNotes() || '');
                        setEditingInstagramLink(true);
                      }}
                      className="text-[#E4405F] hover:text-[#C13584] p-0.5"
                      title="Edit Instagram link"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={handleRemoveInstagramLink}
                      className="text-red-500 hover:text-red-700 p-0.5"
                      title="Remove Instagram link"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => {
                    setTempInstagramLink('');
                    setEditingInstagramLink(true);
                  }}
                  className="bg-[#E4405F]/10 hover:bg-[#E4405F]/20 text-[#E4405F] text-xs px-2 py-1 h-6 w-full"
                >
                  <Instagram className="w-3 h-3 mr-1" />
                  Add Instagram Link
                </Button>
              )}

              {/* Compact Post Link */}
              {(request.socialMediaPostLink || editingPostLink) && (
                <div className="text-xs">
                  {editingPostLink ? (
                    <div className="flex flex-col gap-1">
                      <Input
                        type="url"
                        value={postLink}
                        onChange={(e) => setPostLink(e.target.value)}
                        placeholder="Post link..."
                        className="h-6 text-xs border-[#47b3cb]"
                        disabled={updateSocialMediaMutation.isPending}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdatePostLink();
                          if (e.key === 'Escape') {
                            setPostLink(request.socialMediaPostLink || '');
                            setEditingPostLink(false);
                          }
                        }}
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={handleUpdatePostLink}
                          className="bg-[#007e8c] hover:bg-[#236383] text-white text-xs px-2 py-1 h-6"
                          disabled={updateSocialMediaMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPostLink(request.socialMediaPostLink || '');
                            setEditingPostLink(false);
                          }}
                          className="text-xs px-2 py-1 h-6"
                          disabled={updateSocialMediaMutation.isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => {
                        setPostLink(request.socialMediaPostLink || '');
                        setEditingPostLink(true);
                      }}
                      className="p-1 rounded border border-[#47b3cb]/30 bg-white/50 cursor-pointer hover:bg-white/70 transition-colors truncate"
                    >
                      {request.socialMediaPostLink ? (
                        toSafeHttpUrl(request.socialMediaPostLink) ? (
                          <a href={toSafeHttpUrl(request.socialMediaPostLink)!} target="_blank" rel="noopener noreferrer" className="text-[#007e8c] underline text-xs">
                            View post
                          </a>
                        ) : (
                          // Stored value isn't a safe web URL — show inert text, never a clickable href.
                          <span className="text-gray-500 text-xs" title={request.socialMediaPostLink}>Invalid link</span>
                        )
                      ) : (
                        <span className="text-gray-500">Add link</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              {/* Add link button if no link exists */}
              {!request.socialMediaPostLink && !editingPostLink && (
                <Button
                  onClick={() => setEditingPostLink(true)}
                  className="bg-[#47b3cb]/20 hover:bg-[#47b3cb]/30 text-[#236383] text-xs px-2 py-1 h-6 w-full"
                >
                  + Add link
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Confirmation Dialog */}
      <Dialog open={showInstagramDialog} onOpenChange={setShowInstagramDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Social Media as Posted</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Confirm that the social media post has been completed.
            </p>
            {request.socialMediaPostNotes && getNotesWithoutInstagramLink() && (
              <div className="bg-gray-50 rounded p-2">
                <p className="text-xs text-gray-600">
                  <strong>Existing notes:</strong> {getNotesWithoutInstagramLink()}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Instagram Link (Optional)
              </label>
              <div className="flex items-center gap-2">
                <Instagram className="w-4 h-4 text-[#E4405F]" />
                <Input
                  type="url"
                  placeholder="https://instagram.com/..."
                  value={instagramLink}
                  onChange={(e) => setInstagramLink(e.target.value)}
                  className="w-full border-[#47b3cb] focus:border-[#007e8c]"
                />
              </div>
              <p className="text-xs text-gray-500">
                {getNotesWithoutInstagramLink() 
                  ? 'The Instagram link will be added to the existing notes'
                  : 'Add the Instagram post link if available'}
              </p>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowInstagramDialog(false);
                setInstagramLink('');
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                handleMarkPostedWithLink();
                setShowInstagramDialog(false);
              }}
              className="flex-1 bg-[#47b3cb] hover:bg-[#236383] text-white"
              disabled={updateSocialMediaMutation.isPending}
            >
              Mark as Posted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const CompletedCard: React.FC<CompletedCardProps> = ({
  request,
  onView,
  onEdit,
  onDelete,
  onContact,
  onFollowUp1Day,
  onFollowUp1Month,
  onViewCollectionLog,
  loggedSandwiches,
  onReschedule,
  onDuplicate,
  onAssignTspContact,
  onEditTspContact,
  onLogContact,
  onAddNextAction,
  onEditNextAction,
  onCompleteNextAction,
  resolveUserName,
  canDelete = true,
  openAssignmentDialog,
  openEditAssignmentDialog,
  handleRemoveAssignment,
  handleSelfSignup,
  canSelfSignup,
  isUserSignedUp,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showMessageDialog, setShowMessageDialog] = useState(false);
  const [showInstagramDialog, setShowInstagramDialog] = useState(false);
  const [instagramLink, setInstagramLink] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [showRecipientAllocationDialog, setShowRecipientAllocationDialog] = useState(false);

  // Collaboration hook for comments
  const collaboration = useEventCollaboration(request.id);

  // Confirmation checkbox state for date editing
  const [tempIsConfirmed, setTempIsConfirmed] = useState(request.isConfirmed || false);

  // Inline editing state for organization and department
  const [isEditingField, setIsEditingField] = useState(false);
  const [editingField, setEditingField] = useState('');
  const [editingValue, setEditingValue] = useState('');

  // Inline editing state for sandwich count
  const [isEditingSandwichCount, setIsEditingSandwichCount] = useState(false);
  const [editingSandwichCount, setEditingSandwichCount] = useState('');
  const [editingMode, setEditingMode] = useState<'simple' | 'detailed'>('simple');
  const [editingTypes, setEditingTypes] = useState<Record<string, number>>({});

  // Inline editing state for TSP contact
  const [isEditingTspContact, setIsEditingTspContact] = useState(false);
  const [editingTspContactId, setEditingTspContactId] = useState<number | null>(null);
  const [editingCustomTspContact, setEditingCustomTspContact] = useState('');
  const [tspContactInputMode, setTspContactInputMode] = useState<'dropdown' | 'text'>('dropdown');

  // Check if user has permission to edit organization details
  const canEditOrgDetails =
    (user?.permissions as string[] | undefined)?.includes('EVENT_REQUESTS_INLINE_EDIT_ORG_DETAILS') ||
    user?.role === 'super_admin' ||
    user?.role === 'admin';

  // Check if user can edit TSP contact assignments
  const canEditTspContact = hasPermission(user, PERMISSIONS.EVENT_REQUESTS_EDIT_TSP_CONTACT);

  // Debug: log permission check
  logger.log('CompletedCard org details edit permission:', {
    userId: user?.id,
    userRole: user?.role,
    hasPermission: (user?.permissions as string[] | undefined)?.includes('EVENT_REQUESTS_INLINE_EDIT_ORG_DETAILS'),
    canEditOrgDetails,
    requestId: request.id,
    orgName: request.organizationName
  });

  // Social media mutation
  const updateSocialMediaMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest('PATCH', `/api/event-requests/${request.id}/social-media`, data),
    onSuccess: (updatedEvent, variables) => {
      toast({
        title: 'Social media tracking updated',
        description: 'Social media tracking information has been successfully updated.',
      });
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: request.status,
        touchedFields: Object.keys(variables),
      });
      setShowInstagramDialog(false);
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update social media tracking.',
        variant: 'destructive',
      });
    },
  });

  // Organization details mutation
  const updateOrgDetailsMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      patchEventRequestVerified(request.id, data),
    onSuccess: (updatedEvent, variables) => {
      toast({
        title: 'Event details updated',
        description: 'Event information has been successfully updated.',
      });
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: request.status,
        touchedFields: Object.keys(variables),
      });
      setIsEditingField(false);
      setEditingField('');
      setEditingValue('');
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to update organization details.',
        variant: 'destructive',
        duration: Number.POSITIVE_INFINITY,
      });
    },
  });

  // Sandwich count mutation
  const updateSandwichCountMutation = useMutation({
    mutationFn: (data: { actualSandwichCount: number; actualSandwichTypes?: unknown }) =>
      patchEventRequestVerified(request.id, data),
    onSuccess: (updatedEvent, variables) => {
      toast({
        title: 'Sandwich count updated',
        description: 'The actual sandwich count has been successfully updated.',
      });
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: request.status,
        touchedFields: Object.keys(variables),
      });
      setIsEditingSandwichCount(false);
      setEditingSandwichCount('');
      setEditingTypes({});
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to update sandwich count.',
        variant: 'destructive',
        duration: Number.POSITIVE_INFINITY,
      });
    },
  });

  // TSP contact mutation
  const updateTspContactMutation = useMutation({
    mutationFn: (data: { tspContact?: number | null; customTspContact?: string | null; tspContactAssignedDate: string }) =>
      patchEventRequestVerified(request.id, data),
    onSuccess: (updatedEvent, variables) => {
      toast({
        title: 'TSP Contact updated',
        description: 'The TSP contact has been successfully updated.',
      });
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: request.status,
        touchedFields: Object.keys(variables),
      });
      setIsEditingTspContact(false);
      setEditingTspContactId(null);
      setEditingCustomTspContact('');
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to update TSP contact.',
        variant: 'destructive',
        duration: Number.POSITIVE_INFINITY,
      });
    },
  });

  // Handlers for inline editing
  const startEditing = (field: string, value: string) => {
    setIsEditingField(true);
    setEditingField(field);
    setEditingValue(value);

    // When starting to edit a date, also load the current confirmation status
    if (field === 'desiredEventDate' || field === 'scheduledEventDate') {
      setTempIsConfirmed(request.isConfirmed || false);
    }
  };

  const saveEdit = () => {
    if (editingField === 'organizationName') {
      updateOrgDetailsMutation.mutate({ organizationName: editingValue });
    } else if (editingField === 'department') {
      updateOrgDetailsMutation.mutate({ department: editingValue });
    } else if (editingField === 'eventAddress') {
      updateOrgDetailsMutation.mutate({ eventAddress: editingValue });
    } else if (editingField === 'assignedRecipientIds') {
      updateOrgDetailsMutation.mutate({ assignedRecipientIds: JSON.parse(editingValue) });
    } else if (editingField === 'desiredEventDate' || editingField === 'scheduledEventDate') {
      // When saving a date, also save the confirmation status
      // Completed events are always confirmed
      updateOrgDetailsMutation.mutate({
        [editingField]: editingValue,
        isConfirmed: request.status === 'completed' ? true : tempIsConfirmed
      });
    }
  };

  const cancelEdit = () => {
    setIsEditingField(false);
    setEditingField('');
    setEditingValue('');
  };

  // Handlers for sandwich count editing
  const startEditingSandwichCount = () => {
    // IMPORTANT: Only use ACTUAL values, not estimated/planned values
    // For completed events, we're recording what was actually delivered, not what was planned
    const currentCount = request.actualSandwichCount || 0;
    const currentTypes = request.actualSandwichTypes;

    // Check if we have ACTUAL type data (not planned types)
    if (currentTypes && Array.isArray(currentTypes) && currentTypes.length > 0) {
      // Parse existing actual types into editing state, normalizing to SANDWICH_TYPES format
      const typeMap: Record<string, number> = {};
      currentTypes.forEach((item: { type?: string; quantity?: number }) => {
        if (item.type && item.quantity) {
          // Normalize type values to match SANDWICH_TYPES format (all lowercase)
          let normalizedType = item.type.toLowerCase().trim();

          // Map common variations to SANDWICH_TYPES values
          // Handle "Ham", "ham", "deli_ham" all as "deli_ham"
          if (normalizedType === 'ham' || normalizedType === 'deli_ham') {
            normalizedType = 'deli_ham';
          }
          // Handle "Turkey", "turkey", "deli_turkey" all as "deli_turkey"
          else if (normalizedType === 'turkey' || normalizedType === 'deli_turkey') {
            normalizedType = 'deli_turkey';
          }
          // Handle PBJ variations
          else if (normalizedType === 'pbj' || normalizedType === 'pb&j' || normalizedType === 'peanut butter and jelly') {
            normalizedType = 'pbj';
          }
          // Handle "Deli", "deli" as "deli"
          else if (normalizedType === 'deli') {
            normalizedType = 'deli';
          }
          // Handle "Unknown", "unknown" as "unknown"
          else if (normalizedType === 'unknown') {
            normalizedType = 'unknown';
          }
          // Any unrecognized type goes to "unknown" to preserve the count
          else {
            // Check if the type is a valid SANDWICH_TYPES value
            const validTypes = SANDWICH_TYPES.map(t => t.value);
            if (!validTypes.includes(normalizedType)) {
              normalizedType = 'unknown';
            }
          }

          // Accumulate quantities if the same normalized type appears multiple times
          // This handles cases where old and new formats might both exist
          if (typeMap[normalizedType]) {
            typeMap[normalizedType] += item.quantity;
          } else {
            typeMap[normalizedType] = item.quantity;
          }
        }
      });
      setEditingTypes(typeMap);
      setEditingMode('detailed');
    } else {
      // No actual types recorded yet - start in simple mode with current actual count (or 0)
      setEditingSandwichCount(currentCount.toString());
      setEditingMode('simple');
    }

    setIsEditingSandwichCount(true);
  };

  const saveSandwichCount = () => {
    if (editingMode === 'simple') {
      // Simple mode - just save the total
      const count = parseInt(editingSandwichCount, 10);
      if (isNaN(count) || count < 0) {
        toast({
          title: 'Invalid count',
          description: 'Please enter a valid positive number.',
          variant: 'destructive',
        });
        return;
      }

      // IMPORTANT: Only preserve ACTUAL types, not planned types
      // We don't want to accidentally copy planned types to actual types
      const existingActualTypes = request.actualSandwichTypes;
      updateSandwichCountMutation.mutate({
        actualSandwichCount: count,
        actualSandwichTypes: existingActualTypes || null
      });
    } else {
      // Detailed mode - save types and calculate total
      const types: Array<{ type: string; quantity: number }> = [];
      let total = 0;

      Object.entries(editingTypes).forEach(([type, count]) => {
        if (count && count > 0) {
          types.push({
            type: type, // Keep the original type value as stored
            quantity: count
          });
          total += count;
        }
      });

      if (total === 0) {
        toast({
          title: 'Invalid count',
          description: 'Please enter at least one sandwich type with a count.',
          variant: 'destructive',
        });
        return;
      }

      updateSandwichCountMutation.mutate({
        actualSandwichCount: total,
        actualSandwichTypes: types
      });
    }
  };

  const cancelSandwichCountEdit = () => {
    setIsEditingSandwichCount(false);
    setEditingSandwichCount('');
    setEditingTypes({});
  };

  const toggleEditingMode = () => {
    if (editingMode === 'simple') {
      // Switch to detailed - start with empty types so user can enter fresh breakdown
      // Don't pre-populate "unknown" as this causes doubling when user enters specific types
      setEditingTypes({});
      setEditingMode('detailed');
    } else {
      // Switch to simple - calculate total from types
      const total = Object.values(editingTypes).reduce((sum, count) => sum + (count || 0), 0);
      setEditingSandwichCount(total.toString());
      setEditingMode('simple');
      setEditingTypes({}); // Clear types when switching to simple
    }
  };

  // Handlers for TSP contact editing
  const startEditingTspContact = () => {
    // Initialize based on existing data
    if (request.customTspContact) {
      setTspContactInputMode('text');
      setEditingCustomTspContact(request.customTspContact);
    } else {
      setTspContactInputMode('dropdown');
      setEditingTspContactId(request.tspContact ? parseInt(request.tspContact) : null);
    }
    setIsEditingTspContact(true);
  };

  const saveTspContact = () => {
    const todayDate = new Date().toISOString();
    
    if (tspContactInputMode === 'dropdown') {
      if (!editingTspContactId) {
        toast({
          title: 'Invalid selection',
          description: 'Please select a TSP contact.',
          variant: 'destructive',
        });
        return;
      }
      updateTspContactMutation.mutate({
        tspContact: editingTspContactId,
        customTspContact: null, // Clear custom text when using dropdown
        tspContactAssignedDate: todayDate
      });
    } else {
      if (!editingCustomTspContact.trim()) {
        toast({
          title: 'Invalid input',
          description: 'Please enter a TSP contact name.',
          variant: 'destructive',
        });
        return;
      }
      updateTspContactMutation.mutate({
        tspContact: null, // Clear user ID when using custom text
        customTspContact: editingCustomTspContact.trim(),
        tspContactAssignedDate: todayDate
      });
    }
  };

  const cancelTspContactEdit = () => {
    setIsEditingTspContact(false);
    setEditingTspContactId(null);
    setEditingCustomTspContact('');
  };

  // Helper functions for Instagram link
  const getInstagramLinkFromNotes = () => {
    const notes = request.socialMediaPostNotes || '';
    const match = notes.match(/Instagram:\s*(https?:\/\/[^\s\n]+)/);
    return match ? match[1] : '';
  };

  const getNotesWithoutInstagramLink = () => {
    const notes = request.socialMediaPostNotes || '';
    return notes.replace(/Instagram:\s*https?:\/\/[^\s\n]+\n?/, '').trim();
  };

  const handleMarkPostedWithLink = () => {
    const todayDate = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      socialMediaPostCompleted: true,
      socialMediaPostCompletedDate: todayDate,
    };
    
    // Append Instagram link to existing notes if provided
    if (instagramLink.trim()) {
      const existingNotes = getNotesWithoutInstagramLink();
      const instagramLinkText = `Instagram: ${instagramLink.trim()}`;
      
      if (existingNotes) {
        updateData.socialMediaPostNotes = `${existingNotes}\n${instagramLinkText}`;
      } else {
        updateData.socialMediaPostNotes = instagramLinkText;
      }
    }
    
    updateSocialMediaMutation.mutate(updateData);
    setInstagramLink('');
  };
  
  // Allow assignment editing when assignment functions are provided
  const canEditAssignments = !!(openAssignmentDialog && handleRemoveAssignment);

  // Helper to parse PostgreSQL arrays
  const parsePostgresArray = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter((item) => item && item.trim());
    if (typeof value === 'string') {
      const cleaned = value.replace(/[{}]/g, '');
      if (!cleaned) return [];
      return cleaned.split(',').map(item => item.trim()).filter(item => item);
    }
    return [];
  };

  // Get all team members with names
  const getDrivers = () => {
    const regularDrivers = parsePostgresArray(request.assignedDriverIds);
    const driversList: { id: string; name: string }[] = regularDrivers.map(id => {
      const detailName = (request.driverDetails as Record<string, { name?: string }>)?.[id]?.name;
      const isCustom = id.startsWith('custom-');
      // Check if ID itself looks like a human name (not a system ID)
      const idLooksLikeName = id &&
        !id.startsWith('user_') &&
        !id.startsWith('driver_') &&
        !id.startsWith('driver-') &&
        !id.startsWith('custom-') &&
        !id.startsWith('host-contact-') &&
        !/^\d+$/.test(id) &&
        id.includes(' ');
      const resolvedName = resolveUserName(id);
      let name = (detailName && !/^\d+$/.test(detailName))
        ? detailName
        : isCustom
          ? extractNameFromCustomId(id)
          : (resolvedName !== id ? resolvedName : (idLooksLikeName ? id : resolvedName));
      return { id, name };
    });

    // Add van driver if assigned AND not already in regular drivers (avoid double-counting)
    // Convert vanDriverId to string for consistent comparison
    const vanDriverIdStr = request.assignedVanDriverId ? String(request.assignedVanDriverId) : null;
    if (vanDriverIdStr && !regularDrivers.includes(vanDriverIdStr)) {
      let vanDriverName = request.customVanDriverName || resolveUserName(vanDriverIdStr);
      if (vanDriverName.startsWith('custom-')) {
        vanDriverName = extractNameFromCustomId(vanDriverName);
      }
      driversList.push({ id: vanDriverIdStr, name: vanDriverName });
    }

    if (request.isDhlVan) {
      driversList.push({ id: 'dhl-van', name: 'DHL Van' });
    }

    return driversList;
  };

  const getSpeakers = () => {
    const speakerIds = Object.keys(request.speakerDetails || {});
    return speakerIds.map(id => {
      const detailName = (request.speakerDetails as Record<string, { name?: string }>)?.[id]?.name;
      const isCustom = id.startsWith('custom-');
      // Check if ID itself looks like a human name (not a system ID)
      const idLooksLikeName = id &&
        !id.startsWith('user_') &&
        !id.startsWith('driver_') &&
        !id.startsWith('custom-') &&
        !id.startsWith('host-contact-') &&
        !/^\d+$/.test(id) &&
        id.includes(' ');
      const resolvedName = resolveUserName(id);
      let name = (detailName && !/^\d+$/.test(detailName))
        ? detailName
        : isCustom
          ? extractNameFromCustomId(id)
          : (resolvedName !== id ? resolvedName : (idLooksLikeName ? id : resolvedName));
      return { id, name };
    });
  };

  const getVolunteers = () => {
    const volunteerIds = parsePostgresArray(request.assignedVolunteerIds);
    return volunteerIds.map(id => {
      const isCustom = id.startsWith('custom-');
      // Check if ID itself looks like a human name (not a system ID)
      const idLooksLikeName = id &&
        !id.startsWith('user_') &&
        !id.startsWith('driver_') &&
        !id.startsWith('volunteer_') &&
        !id.startsWith('volunteer-') &&
        !id.startsWith('custom-') &&
        !id.startsWith('host-contact-') &&
        !/^\d+$/.test(id) &&
        id.includes(' ');
      const resolvedName = resolveUserName(id);
      let name = isCustom
        ? extractNameFromCustomId(id)
        : (resolvedName !== id ? resolvedName : (idLooksLikeName ? id : resolvedName));
      return { id, name };
    });
  };

  const drivers = getDrivers();
  const speakers = getSpeakers();
  const volunteers = getVolunteers();

  // Calculate staffing gaps
  const staffingGaps: string[] = [];
  const driversNeeded = request.driversNeeded || 0;
  const speakersNeeded = request.speakersNeeded || 0;
  const volunteersNeeded = request.volunteersNeeded || 0;

  // Use drivers.length for consistency with the displayed count and other checks
  if (!request.selfTransport && driversNeeded > drivers.length) {
    staffingGaps.push(`Needed ${driversNeeded} driver${driversNeeded > 1 ? 's' : ''} (had ${drivers.length})`);
  }
  if (speakersNeeded > speakers.length) {
    staffingGaps.push(`Needed ${speakersNeeded} speaker${speakersNeeded > 1 ? 's' : ''} (had ${speakers.length})`);
  }
  if (volunteersNeeded > volunteers.length) {
    staffingGaps.push(`Needed ${volunteersNeeded} volunteer${volunteersNeeded > 1 ? 's' : ''} (had ${volunteers.length})`);
  }

  // Use shared reference data from useEventQueries (eliminates duplicate API calls)
  const {
    recipients,
    hosts,
    hostContacts,
    users,
  } = useEventQueries();

  // Helper to get display information from IDs (supports new prefixed format)
  const getRecipientDisplayInfo = (recipientIds: unknown): Array<{ name: string; type: string; icon: React.ReactNode }> => {
    if (!recipientIds) return [];
    
    // Parse the array (could be string or array)
    let ids: string[] = [];
    if (Array.isArray(recipientIds)) {
      ids = recipientIds.map(id => String(id));
    } else if (typeof recipientIds === 'string') {
      try {
        // Handle PostgreSQL array format: {1,2,3} or {"host:5","recipient:10","custom:Hall, Room 2"}
        if (recipientIds.startsWith('{') && recipientIds.endsWith('}')) {
          const arrayContent = recipientIds.slice(1, -1); // Remove { and }
          
          // Parse PostgreSQL array format respecting quoted strings
          // PostgreSQL escapes quotes as "" (doubled) or \" (backslash)
          // Handles: {value1,value2} and {"value 1","value 2"} and {"value,with,commas"} and {"value with ""quotes"""}
          const parsed: string[] = [];
          let current = '';
          let inQuotes = false;
          
          for (let i = 0; i < arrayContent.length; i++) {
            const char = arrayContent[i];
            const nextChar = i < arrayContent.length - 1 ? arrayContent[i + 1] : null;
            const prevChar = i > 0 ? arrayContent[i - 1] : null;
            
            if (char === '"') {
              if (inQuotes && nextChar === '"') {
                // Doubled quote ("") inside quoted string = escaped quote, add one quote
                current += '"';
                i++; // Skip the next quote
              } else if (inQuotes && prevChar === '\\') {
                // Backslash-escaped quote (\") = actual quote (backslash was already added)
                current = current.slice(0, -1) + '"'; // Replace the backslash with quote
              } else {
                // Regular quote - toggle quote state
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              // Comma outside quotes = separator
              if (current.trim()) {
                parsed.push(current.trim());
              }
              current = '';
            } else {
              current += char;
            }
          }
          
          // Don't forget the last value
          if (current.trim()) {
            parsed.push(current.trim());
          }
          
          ids = parsed;
        }
      } catch {
        return [];
      }
    }
    
    // Map IDs to display info
    return ids.map(id => {
      const idStr = String(id);
      
      // Check for prefixed format
      if (idStr.startsWith('host:')) {
        const hostId = parseInt(idStr.replace('host:', ''));
        // Check host_contacts first (individual people), then hosts table (locations)
        const hostContact = hostContacts.find(hc => hc.id === hostId);
        if (hostContact) {
          return {
            name: `${hostContact.name} (${hostContact.hostLocationName})`,
            type: 'host',
            icon: <Home className="w-3 h-3 mr-1" />
          };
        }
        const host = hosts.find(h => h.id === hostId);
        if (host) {
          return {
            name: host.name,
            type: 'host',
            icon: <Home className="w-3 h-3 mr-1" />
          };
        }
        // FALLBACK: Check recipients in case the data was mislabeled
        const fallbackRecipient = recipients.find(r => r.id === hostId);
        if (fallbackRecipient) {
          return {
            name: fallbackRecipient.name || `Recipient (${hostId})`,
            type: 'recipient',
            icon: <Building className="w-3 h-3 mr-1" />
          };
        }
        return {
          name: `Unknown Host (${hostId})`,
          type: 'host',
          icon: <Home className="w-3 h-3 mr-1" />
        };
      } else if (idStr.startsWith('recipient:')) {
        const recipientId = parseInt(idStr.replace('recipient:', ''));
        const recipient = recipients.find(r => r.id === recipientId);
        if (recipient) {
          return {
            name: recipient.name,
            type: 'recipient',
            icon: <Building className="w-3 h-3 mr-1" />
          };
        }
        // FALLBACK: Check hosts in case the data was mislabeled
        const fallbackHost = hosts.find(h => h.id === recipientId);
        if (fallbackHost) {
          return {
            name: fallbackHost.name || `Host (${recipientId})`,
            type: 'host',
            icon: <Home className="w-3 h-3 mr-1" />
          };
        }
        const fallbackHostContact = hostContacts.find(hc => hc.id === recipientId);
        if (fallbackHostContact) {
          return {
            name: `${fallbackHostContact.name} (${fallbackHostContact.hostLocationName})`,
            type: 'host',
            icon: <Home className="w-3 h-3 mr-1" />
          };
        }
        return {
          name: `Unknown Recipient (${recipientId})`,
          type: 'recipient',
          icon: <Building className="w-3 h-3 mr-1" />
        };
      } else if (idStr.startsWith('custom:')) {
        return {
          name: idStr.replace('custom:', ''),
          type: 'custom',
          icon: null
        };
      }
      
      // Legacy numeric ID - assume it's a recipient
      const numId = parseInt(idStr, 10);
      if (!isNaN(numId)) {
        const recipient = recipients.find(r => r.id === numId);
        return {
          name: recipient?.name || `Unknown (${numId})`,
          type: 'recipient',
          icon: <Building className="w-3 h-3 mr-1" />
        };
      }
      
      return {
        name: idStr,
        type: 'unknown',
        icon: null
      };
    });
  };

  const assignedRecipientInfo = getRecipientDisplayInfo((request as EventRequest & { assignedRecipientIds?: unknown }).assignedRecipientIds);

  // Get event date and time for display
  const eventDate = getEffectiveEventDate(request);
  const eventDateDisplay = eventDate ? formatEventDate(eventDate.toString()).text : 'No date set';
  const eventTimeDisplay = request.eventStartTime
    ? `${formatTime12Hour(request.eventStartTime)}${request.eventEndTime ? ` - ${formatTime12Hour(request.eventEndTime)}` : ''}`
    : 'No time set';

  return (
    <Card 
      className={`transition-all duration-200 hover:shadow-[0_2px_6px_rgba(0,0,0,0.10)] border-l-[4px] bg-[#E8F7FB] shadow-[0_1px_4px_rgba(0,0,0,0.08)] border-[#D8DEE2] rounded-xl`}
      style={{ borderLeftColor: statusBorderColors.completed }}
    >
      <CardContent className="p-3">
        <CardHeader
          request={request}
          resolveUserName={resolveUserName}
          canEditOrgDetails={canEditOrgDetails}
          isEditingThisCard={isEditingField}
          editingField={editingField}
          editingValue={editingValue}
          startEditing={startEditing}
          saveEdit={saveEdit}
          cancelEdit={cancelEdit}
          setEditingValue={setEditingValue}
          isEditingTspContact={isEditingTspContact}
          editingTspContactId={editingTspContactId}
          editingCustomTspContact={editingCustomTspContact}
          tspContactInputMode={tspContactInputMode}
          startEditingTspContact={startEditingTspContact}
          saveTspContact={saveTspContact}
          cancelTspContactEdit={cancelTspContactEdit}
          setEditingTspContactId={setEditingTspContactId}
          setEditingCustomTspContact={setEditingCustomTspContact}
          setTspContactInputMode={setTspContactInputMode}
          users={users}
          updateTspContactMutation={updateTspContactMutation}
          tempIsConfirmed={tempIsConfirmed}
          setTempIsConfirmed={setTempIsConfirmed}
          presentUsers={collaboration.presentUsers}
          currentUserId={user?.id}
          canEditTspContact={canEditTspContact}
        />

        {/* Next Action - shown when one exists; otherwise an "Add Action" affordance
            is offered below. Mirrors the InProcessCard pattern so behavior is
            consistent across statuses. */}
        {request.nextAction ? (
          <div className="mb-4 p-3 bg-amber-50 border-2 border-amber-300 rounded-lg">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-bold text-amber-800 uppercase tracking-wide">Next Action:</span>
                  <p className="mt-1 text-amber-900 font-medium break-words whitespace-pre-wrap">{request.nextAction}</p>
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
                    <Edit2 className="w-3 h-3 mr-1" />
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
        ) : onAddNextAction ? (
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={onAddNextAction}
              className="h-7 text-xs border-slate-300 text-slate-600 hover:bg-slate-100"
              data-testid="button-add-action-completed"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Action
            </Button>
          </div>
        ) : null}

        {/* Main content split into two columns on lg+ so the card isn't a
            tall vertical stack. Column 1: at-a-glance + post-event notes.
            Column 2: event summary (date history, recipients/team, follow-ups,
            completion notes). Mirrors the InProcessCard / ScheduledCardEnhanced
            two-column layout. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-4 lg:items-start">
          {/* Column 1 */}
          <div className="space-y-3 min-w-0">
        {/* At-a-glance: sandwiches + social — minimal, expand only when needed */}
        <div className="bg-white rounded-lg p-3 border border-gray-200 space-y-2">
          {/* Sandwiches row */}
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <Package className="w-4 h-4 text-[#FBAD3F] shrink-0" />
            <span className="text-gray-600 font-medium">Sandwiches:</span>
            {isEditingSandwichCount ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  type="number"
                  value={editingSandwichCount}
                  onChange={(e) => setEditingSandwichCount(e.target.value)}
                  className="h-8 w-28 text-center"
                  placeholder="Delivered"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveSandwichCount();
                    if (e.key === 'Escape') cancelSandwichCountEdit();
                  }}
                />
                <Button size="sm" onClick={saveSandwichCount} disabled={updateSandwichCountMutation.isPending} className="h-7">
                  <Save className="w-3 h-3 mr-1" />
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelSandwichCountEdit} className="h-7">
                  <X className="w-3 h-3 mr-1" />
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <span className="text-gray-700">
                  Planned <strong className="font-semibold">
                    {(() => {
                      const hasRange = hasActiveSandwichRange(
                        request.estimatedSandwichCountMin,
                        request.estimatedSandwichCountMax,
                        request.estimatedSandwichCount,
                      );
                      if (hasRange) {
                        const rangeType = (request as any).estimatedSandwichRangeType;
                        const typeLabel = rangeType ? SANDWICH_TYPES.find(t => t.value === rangeType)?.label : null;
                        return `${request.estimatedSandwichCountMin}-${request.estimatedSandwichCountMax}${typeLabel ? ` ${typeLabel}` : ''}`;
                      }
                      if (request.estimatedSandwichCount) {
                        return formatSandwichTypesDisplay(request.sandwichTypes, request.estimatedSandwichCount ?? undefined);
                      }
                      const parsedTypes = parseSandwichTypes(request.sandwichTypes);
                      const totalFromTypes = parsedTypes?.reduce((sum, t) => sum + (typeof t.quantity === 'number' ? t.quantity : 0), 0) ?? 0;
                      if (totalFromTypes > 0) {
                        return formatSandwichTypesDisplay(request.sandwichTypes, undefined);
                      }
                      return <span className="text-gray-400 italic">not set</span>;
                    })()}
                  </strong>
                </span>
                <span className="text-gray-400">·</span>
                {/* Logged = linked collection log entries, the source of truth for counts */}
                <span className="text-gray-700">
                  Logged{' '}
                  {loggedSandwiches === undefined ? (
                    <span className="text-gray-400">—</span>
                  ) : loggedSandwiches ? (
                    <button
                      type="button"
                      onClick={onViewCollectionLog}
                      disabled={!onViewCollectionLog}
                      className="font-semibold text-[#236383] hover:underline disabled:no-underline"
                      title="From the collection log"
                    >
                      {loggedSandwiches.count.toLocaleString()}
                    </button>
                  ) : onViewCollectionLog ? (
                    <button
                      type="button"
                      onClick={onViewCollectionLog}
                      className="italic text-gray-400 hover:text-[#236383] hover:underline"
                      title="Find this event's collection log entry"
                    >
                      not linked
                    </button>
                  ) : (
                    <span className="italic text-gray-400">not linked</span>
                  )}
                </span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-700">
                  Delivered <strong className="font-semibold text-[#FBAD3F]">
                    {(() => {
                      const count = request.actualSandwichCount;
                      const typesRaw = request.actualSandwichTypes;
                      const typesParsed = parseSandwichTypes(typesRaw);
                      const hasCount = count != null && count > 0;
                      const hasTypes = typesParsed && typesParsed.length > 0;
                      if (!hasCount && !hasTypes) {
                        return <span className="text-gray-400 italic font-normal">not recorded</span>;
                      }
                      return formatSandwichTypesDisplay(typesRaw, count ?? undefined);
                    })()}
                  </strong>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={startEditingSandwichCount}
                  className="h-6 px-1.5 text-xs text-gray-500 hover:text-gray-800"
                  title="Edit delivered count"
                >
                  <Edit2 className="w-3 h-3 mr-1" />
                  Edit
                </Button>
              </>
            )}
          </div>

          {/* Social media row */}
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <Share2 className="w-4 h-4 text-[#47b3cb] shrink-0" />
            <span className="text-gray-600 font-medium">Social:</span>
            <span className="text-gray-700">
              {request.socialMediaPostCompleted
                ? '✓ Posted'
                : request.socialMediaPostRequested
                  ? '✓ Requested'
                  : <span className="text-gray-400 italic">not tracked</span>}
            </span>
            {request.socialMediaPostCompleted && (() => {
              const instagramLink = getInstagramLinkFromNotes();
              return instagramLink ? (
                <a
                  href={instagramLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#236383] hover:underline"
                >
                  <Instagram className="w-3 h-3" />
                  View
                </a>
              ) : null;
            })()}
            {/* Inline one-click status buttons (no Manage step).
                - Nothing tracked:  [Mark Requested] [Mark Posted]
                - Requested:        [Mark Posted]    [Edit ▾]
                - Posted:           [Edit ▾]    (+ Add Instagram Link if missing) */}
            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
              {!request.socialMediaPostCompleted && !request.socialMediaPostRequested && (
                <Button
                  size="sm"
                  onClick={() => {
                    const todayDate = new Date().toISOString();
                    updateSocialMediaMutation.mutate({
                      socialMediaPostRequested: true,
                      socialMediaPostRequestedDate: todayDate,
                    });
                  }}
                  className="bg-[#007e8c] hover:bg-[#236383] text-white text-xs h-7 px-2"
                  disabled={updateSocialMediaMutation.isPending}
                >
                  Mark Requested
                </Button>
              )}
              {!request.socialMediaPostCompleted && (
                <Button
                  size="sm"
                  onClick={() => setShowInstagramDialog(true)}
                  className="bg-[#fbad3f] hover:bg-[#a31c41] text-white text-xs h-7 px-2"
                  disabled={updateSocialMediaMutation.isPending}
                >
                  Mark Posted
                </Button>
              )}
              {request.socialMediaPostCompleted && !getInstagramLinkFromNotes() && (
                <Button
                  size="sm"
                  onClick={() => setShowInstagramDialog(true)}
                  className="bg-[#fbad3f] hover:bg-[#a31c41] text-white text-xs h-7 px-2"
                  disabled={updateSocialMediaMutation.isPending}
                >
                  <Instagram className="w-3 h-3 mr-1" />
                  Add Instagram Link
                </Button>
              )}
              {(request.socialMediaPostCompleted || request.socialMediaPostRequested) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-gray-500 hover:text-gray-800"
                      disabled={updateSocialMediaMutation.isPending}
                      title="Edit social status"
                    >
                      <Edit2 className="w-3 h-3 mr-1" />
                      Edit
                      <ChevronDown className="w-3 h-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="text-xs">
                    {request.socialMediaPostCompleted && (
                      <DropdownMenuItem
                        onClick={() =>
                          updateSocialMediaMutation.mutate({
                            socialMediaPostCompleted: false,
                            socialMediaPostCompletedDate: null,
                          })
                        }
                      >
                        Revert to Requested
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() =>
                        updateSocialMediaMutation.mutate({
                          socialMediaPostCompleted: false,
                          socialMediaPostCompletedDate: null,
                          socialMediaPostRequested: false,
                          socialMediaPostRequestedDate: null,
                        })
                      }
                      className="text-red-600 focus:text-red-700"
                    >
                      Clear status
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>

        {/* Post-event Notes */}
        <PostEventNotes eventId={request.id} />
          </div>

          {/* Column 2 */}
          <div className="space-y-3 min-w-0">
        {/* Event Summary */}
        <div className="space-y-2">
          <div className="bg-white rounded-lg p-2 space-y-2">
            {/* Date history — original request + backup dates (kept for reference, not prominent) */}
            {(() => {
              const eventDate = request.scheduledEventDate?.toString();
              const requestedDate = request.desiredEventDate?.toString();
              const backupDates = Array.isArray(request.backupDates) ? request.backupDates : [];
              const requestedDiffers = requestedDate && requestedDate !== eventDate;
              if (!requestedDiffers && backupDates.length === 0) return null;
              return (
                <div className="bg-gray-50 rounded-md px-3 py-2 text-xs text-gray-600 space-y-1">
                  <div className="font-medium text-gray-700">Date history</div>
                  {requestedDiffers && (
                    <div>
                      <span className="text-gray-500">Originally requested:</span>{' '}
                      <span className="text-gray-800">{formatEventDate(requestedDate!).text}</span>
                    </div>
                  )}
                  {backupDates.length > 0 && (
                    <div>
                      <span className="text-gray-500">Backup dates offered:</span>{' '}
                      <span className="text-gray-800">
                        {backupDates.map((d) => formatEventDate(String(d)).text).join('; ')}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Staffing Gap Alert */}
            {staffingGaps.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-800">
                  <span className="font-semibold">Staffing Gap: </span>
                  {staffingGaps.join(', ')}
                </div>
              </div>
            )}

            {/* Combined Recipients & Team Section */}
            <div className="bg-[#e6f2f5] rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {/* Recipients with Allocations */}
                <div className="flex items-center gap-2 group">
                  <Building className="w-4 h-4 text-[#236383]" />
                  <span className="font-medium text-[#236383]">Recipients:</span>
                  {/* Show allocations if available with actual sandwich counts, otherwise show recipient badges */}
                  {(request as any).recipientAllocations && ((request as any).recipientAllocations as RecipientAllocation[]).some(a => a.sandwichCount > 0) ? (
                    <RecipientAllocationDisplay
                      allocations={(request as any).recipientAllocations as RecipientAllocation[]}
                      className="text-xs"
                    />
                  ) : assignedRecipientInfo.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {assignedRecipientInfo.map((item, index) => (
                        <Badge
                          key={index}
                          variant="secondary"
                          className="bg-white text-[#236383] border border-[#236383]/30 text-xs flex items-center gap-1"
                          data-testid={`badge-${item.type}-${index}`}
                        >
                          {item.icon}
                          {item.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-500 italic text-xs">(none)</span>
                  )}
                  {canEditOrgDetails && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowRecipientAllocationDialog(true)}
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={assignedRecipientInfo.length > 0 ? "Edit recipients" : "Add recipients"}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>

                <span className="text-gray-300">|</span>

                {/* Drivers or Self-Transport */}
                <div className="flex items-center gap-1">
                  <Car className="w-4 h-4 text-[#236383]" />
                  {request.selfTransport ? (
                    <Badge
                      variant="outline"
                      className="bg-[#FBAD3F]/20 text-[#D68319] border-[#FBAD3F] font-medium text-xs px-2 py-0.5"
                      title={indicatorTooltips.selfTransport}
                    >
                      <Car className="w-3 h-3 mr-1" />
                      Self-Transport
                    </Badge>
                  ) : (
                    <>
                      <span className="font-medium text-[#236383]">Drivers:</span>
                      {canEditAssignments && openAssignmentDialog && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openAssignmentDialog('driver')}
                          className="h-5 w-5 p-0 hover:bg-[#236383]/10"
                          title="Add driver"
                        >
                          <UserPlus className="w-3 h-3 text-[#236383]" />
                        </Button>
                      )}
                      {drivers.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {drivers.map((driver) => (
                            <Badge
                              key={driver.id}
                              variant="secondary"
                              className="bg-[#236383]/10 text-[#236383] text-xs px-2 py-0.5"
                            >
                              {driver.name}
                              {canEditAssignments && handleRemoveAssignment && (
                                <button
                                  onClick={() => handleRemoveAssignment('driver', driver.id)}
                                  className="ml-1 text-gray-400 hover:text-red-600"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-500 italic text-xs">(none)</span>
                      )}
                    </>
                  )}
                </div>

                <span className="text-gray-300">|</span>

                {/* Speakers (retired role — read-only historical display) */}
                {speakers.length > 0 && (
                  <>
                    <div className="flex items-center gap-1">
                      <Megaphone className="w-4 h-4 text-[#236383]" />
                      <span className="font-medium text-[#236383]">Speakers:</span>
                      <div className="flex flex-wrap gap-1">
                        {speakers.map((speaker) => (
                          <Badge
                            key={speaker.id}
                            variant="secondary"
                            className="bg-[#236383]/10 text-[#236383] text-xs px-2 py-0.5"
                          >
                            {speaker.name}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <span className="text-gray-300">|</span>
                  </>
                )}

                {/* Volunteers */}
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4 text-[#236383]" />
                  <span className="font-medium text-[#236383]">Volunteers:</span>
                  {canEditAssignments && openAssignmentDialog && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openAssignmentDialog('volunteer')}
                      className="h-5 w-5 p-0 hover:bg-[#236383]/10"
                      title="Add volunteer"
                    >
                      <UserPlus className="w-3 h-3 text-[#236383]" />
                    </Button>
                  )}
                  {volunteers.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {volunteers.map((volunteer) => (
                        <Badge
                          key={volunteer.id}
                          variant="secondary"
                          className="bg-[#236383]/10 text-[#236383] text-xs px-2 py-0.5"
                        >
                          {volunteer.name}
                          {canEditAssignments && handleRemoveAssignment && (
                            <button
                              onClick={() => handleRemoveAssignment('volunteer', volunteer.id)}
                              className="ml-1 text-gray-400 hover:text-red-600"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-500 italic text-xs">(none)</span>
                  )}
                </div>
              </div>
            </div>

            {/* Follow-up Status */}
            <div className="flex gap-2">
              {request.followUpOneDayCompleted && (
                <Badge variant="default" className="bg-teal-100 text-teal-700 border-teal-300">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  1-Day Follow-up Done
                </Badge>
              )}
              {request.followUpOneMonthCompleted && (
                <Badge variant="default" className="bg-teal-100 text-teal-700 border-teal-300">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  1-Month Follow-up Done
                </Badge>
              )}
            </div>

            {/* Completion Notes */}
            {request.followUpNotes && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-medium mb-1">Completion Notes:</p>
                <p className="text-sm text-gray-600">{request.followUpNotes}</p>
              </div>
            )}
          </div>
        </div>

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
                  currentUserName={
                    user?.displayName ||
                    getDisplayName(user?.firstName ?? undefined, user?.lastName ?? undefined, user?.email ?? undefined)
                  }
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
                <Button size="sm" variant="outline" onClick={onView}>
                  <Eye className="w-4 h-4 mr-1" />
                  View Details
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>View event details</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={onEdit}>
                  <Edit2 className="w-4 h-4 mr-1" />
                  Edit Event
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Edit this event</p>
              </TooltipContent>
            </Tooltip>

            {!request.followUpOneDayCompleted && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onFollowUp1Day}
                    className="bg-brand-primary-lighter hover:bg-brand-primary-light"
                  >
                    <MessageCircle className="w-4 h-4 mr-1" />
                    1-Day Follow-up
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Send 1-day follow-up message</p>
                </TooltipContent>
              </Tooltip>
            )}

            {!request.followUpOneMonthCompleted && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onFollowUp1Month}
                    className="bg-purple-50 hover:bg-purple-100"
                  >
                    <MessageCircle className="w-4 h-4 mr-1" />
                    1-Month Follow-up
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Send 1-month follow-up message</p>
                </TooltipContent>
              </Tooltip>
            )}

            {onViewCollectionLog && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={onViewCollectionLog}>
                    <FileText className="w-4 h-4 mr-1" />
                    Collection Log
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View collection log for this event</p>
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={onContact}>
                  <Mail className="w-4 h-4 mr-1" />
                  Contact
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Contact the organizer</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onLogContact}
                  className="text-base border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10"
                >
                  <FileText className="w-4 h-4 mr-1" />
                  Log Contact
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Log a contact attempt or conversation</p>
              </TooltipContent>
            </Tooltip>

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
                    Assign TSP Contact
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Assign a TSP contact to this event</p>
                </TooltipContent>
              </Tooltip>
            )}

            <ActionRowSpacer />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={() => setShowMessageDialog(true)}
                  variant="ghost"
                  className="text-[#007E8C] hover:text-[#007E8C] hover:bg-[#007E8C]/10"
                  aria-label="Message about this event"
                >
                  <MessageSquare className="w-4 h-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Message about this event</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onReschedule}
                  title="Reopen this event (data entry corrections)"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Reopen this event (data entry corrections)</p>
              </TooltipContent>
            </Tooltip>

            {onDuplicate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onDuplicate}
                    title="Create a new event for this group"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Create a new event for this group</p>
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
                          className="text-red-600 hover:text-red-700"
                          data-testid="button-delete-request"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      }
                      title="Delete Completed Event"
                      description={`Are you sure you want to delete the completed event from ${request.organizationName}? This will remove all event data and cannot be undone.`}
                      confirmText="Delete Event"
                      cancelText="Cancel"
                      onConfirm={onDelete}
                      variant="destructive"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Delete this event</p>
                </TooltipContent>
              </Tooltip>
            )}
          </CardActionRow>
        </TooltipProvider>

        {/* Audit Log Section */}
        <div className="mt-3 border-t border-gray-200 pt-2">
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
      </CardContent>

      {/* Dialog for marking as posted with Instagram link */}
      <Dialog open={showInstagramDialog} onOpenChange={setShowInstagramDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Social Media as Posted</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Confirm that the social media post has been completed.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Instagram Link (optional)
              </label>
              <Input
                type="url"
                placeholder="https://instagram.com/p/..."
                value={instagramLink}
                onChange={(e) => setInstagramLink(e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                Add a link to the Instagram post if available
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowInstagramDialog(false);
                setInstagramLink('');
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                handleMarkPostedWithLink();
                setShowInstagramDialog(false);
              }}
              className="flex-1 bg-[#47b3cb] hover:bg-[#236383] text-white"
              disabled={updateSocialMediaMutation.isPending}
            >
              Mark as Posted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Recipient Allocation Editor Dialog */}
      <RecipientAllocationEditor
        open={showRecipientAllocationDialog}
        onOpenChange={setShowRecipientAllocationDialog}
        eventId={request.id}
        eventName={request.organizationName || 'Event'}
        estimatedSandwichCount={request.estimatedSandwichCount}
        currentAllocations={(request as any).recipientAllocations as RecipientAllocation[] | null}
      />
    </Card>
  );
};
