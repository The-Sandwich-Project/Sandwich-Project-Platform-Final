import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Hourglass,
  RefreshCw,
  Mail,
  Phone,
  Eye,
  Trash2,
  Calendar,
  Edit2,
  Save,
  X,
  MessageSquare,
  FileText,
  Clock,
  Copy,

} from 'lucide-react';
import { formatEventDate } from '@/components/event-requests/utils';
import { TrafficConflictBadge } from '@/components/event-requests/TrafficConflictBadge';
import { statusColors, statusIcons, statusOptions } from '@/components/event-requests/constants';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessageAboutEvent } from '@/components/chat/chat-dock-context';
import { useEventCollaboration } from '@/hooks/use-event-collaboration';
import { CommentThread, CompactPresenceBadge } from '@/components/collaboration';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { CardActionRow, ActionRowSpacer } from './card-ui';

interface StandbyCardProps {
  request: EventRequest;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onContact: () => void;
  onCall: () => void;
  onReactivate: () => void;
  onLogContact: () => void;
  onMoveToStalled: () => void;
  onDuplicate?: () => void;
  canDelete?: boolean;
  resolveUserName?: (id: string) => string;
}

// CardHeader component
interface CardHeaderProps {
  request: EventRequest;
  resolveUserName?: (id: string) => string;
  presentUsers?: Array<{ userId: string; userName: string; joinedAt: Date; lastHeartbeat: Date; socketId: string }>;
  currentUserId?: string;
}

const CardHeader: React.FC<CardHeaderProps> = ({
  request,
  resolveUserName,
  presentUsers = [],
  currentUserId = '',
}) => {
  const StatusIcon = statusIcons[request.status as keyof typeof statusIcons] || Hourglass;

  const getStatusLabel = (status: string) => {
    const statusOption = statusOptions.find(option => option.value === status);
    return statusOption ? statusOption.label : status.replace('_', ' ');
  };

  const displayDate = getEffectiveEventDate(request);
  const dateInfo = displayDate ? formatEventDate(displayDate.toString()) : null;

  return (
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-start space-x-3 min-w-0 flex-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {presentUsers && presentUsers.length > 0 && currentUserId && (
              <CompactPresenceBadge
                users={presentUsers}
                currentUserId={currentUserId}
                className="mr-1"
              />
            )}
            <h3 className="font-semibold text-lg text-[#1A2332] break-words min-w-0">
              {request.organizationName}
              {request.department && (
                <span className="text-gray-600 ml-1">
                  &bull; {request.department}
                </span>
              )}
            </h3>
            <Badge className="inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold bg-gradient-to-br from-purple-100 to-purple-200 text-purple-800 border border-purple-400/50 text-sm whitespace-nowrap">
              <StatusIcon className="w-3 h-3 mr-1" />
              {getStatusLabel(request.status)}
            </Badge>
          </div>
          <div className="text-sm text-[#236383] mt-1 space-y-1">
            <div className="text-sm text-gray-700 mb-2">
              <strong>{request.firstName} {request.lastName}</strong>
              {request.email && (
                <span className="ml-2">• {request.email}</span>
              )}
              {request.phone && (
                <span className="ml-2">• {request.phone}</span>
              )}
            </div>
            {(request.tspContact || request.customTspContact) && (
              <div className="text-sm text-[#D68319] mb-2">
                <span className="font-medium">TSP Contact: </span>
                <span className="font-normal">
                  {request.tspContact ? (resolveUserName ? resolveUserName(request.tspContact) : request.tspContact) : request.customTspContact}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 flex-wrap">
              <Calendar className="w-3 h-3" />
              <span data-testid="text-date-label" className="text-[16px]">
                Requested Date: {' '}
                <strong className="text-[16px]" data-testid="text-date-value">
                  {displayDate && dateInfo ? dateInfo.text : 'No date set'}
                </strong>
              </span>
              <TrafficConflictBadge dates={[displayDate]} compact />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const StandbyCard: React.FC<StandbyCardProps> = ({
  request,
  onView,
  onEdit,
  onDelete,
  onContact,
  onCall,
  onReactivate,
  onLogContact,
  onMoveToStalled,
  onDuplicate,
  canDelete = true,
  resolveUserName,
}) => {
  const messageAboutEvent = useMessageAboutEvent(request);
  const [showComments, setShowComments] = React.useState(false);
  const { user } = useAuth();
  const collaboration = useEventCollaboration(request.id);
  const dateInfo = formatEventDate(request.desiredEventDate || '');
  const expectedDateInfo = request.standbyExpectedDate ? formatEventDate(request.standbyExpectedDate.toString()) : null;

  // Calculate if expected date has passed
  const isExpectedDatePast = request.standbyExpectedDate && new Date(request.standbyExpectedDate) < new Date();

  return (
    <Card
      className={`transition-all duration-200 hover:shadow-[0_2px_6px_rgba(0,0,0,0.10)] border-l-[4px] bg-purple-50 shadow-[0_1px_4px_rgba(0,0,0,0.08)] border-[#D8DEE2] rounded-xl`}
      style={{ borderLeftColor: '#9333EA' }}
      data-testid={`card-standby-${request.id}`}
    >
      <CardContent className="p-3">
        <CardHeader
          request={request}
          resolveUserName={resolveUserName}
          presentUsers={collaboration.presentUsers}
          currentUserId={user?.id}
        />

        {/* Standby Info - Prominent Display */}
        <div className="space-y-3 mb-4">
          <div className={`rounded-lg p-4 border-2 ${isExpectedDatePast ? 'bg-red-100 border-red-300' : 'bg-purple-100 border-purple-300'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Hourglass className={`w-5 h-5 ${isExpectedDatePast ? 'text-red-700' : 'text-purple-700'}`} />
              <span className={`text-base font-semibold ${isExpectedDatePast ? 'text-red-900' : 'text-purple-900'}`}>
                On Standby - Waiting for Organizer
              </span>
              {request.standbyMarkedAt && (
                <span className={`text-sm ${isExpectedDatePast ? 'text-red-700' : 'text-purple-700'}`}>
                  since {new Date(request.standbyMarkedAt).toLocaleDateString()}
                </span>
              )}
            </div>

            {request.standbyReason && (
              <div className="mt-3">
                <p className={`text-sm font-medium mb-1 ${isExpectedDatePast ? 'text-red-900' : 'text-purple-900'}`}>Reason:</p>
                <p className={`text-sm ${isExpectedDatePast ? 'text-red-800' : 'text-purple-800'}`}>{request.standbyReason}</p>
              </div>
            )}

            {request.standbyExpectedDate && (
              <div className={`mt-3 rounded p-2 ${isExpectedDatePast ? 'bg-red-50' : 'bg-white/50'}`}>
                <p className={`text-sm font-medium mb-1 ${isExpectedDatePast ? 'text-red-900' : 'text-purple-900'}`}>
                  {isExpectedDatePast ? 'Expected Response (OVERDUE):' : 'Expected Response By:'}
                </p>
                <p className={`text-base font-semibold flex items-center gap-1 ${isExpectedDatePast ? 'text-red-900' : 'text-purple-900'}`}>
                  <Clock className="w-4 h-4" />
                  {expectedDateInfo?.text}
                  {isExpectedDatePast && (
                    <Badge variant="destructive" className="ml-2 text-xs">
                      Overdue - Check In!
                    </Badge>
                  )}
                </p>
              </div>
            )}

            {request.standbyNotes && (
              <div className="mt-3">
                <p className={`text-sm font-medium mb-1 ${isExpectedDatePast ? 'text-red-900' : 'text-purple-900'}`}>Notes:</p>
                <p className={`text-sm whitespace-pre-wrap ${isExpectedDatePast ? 'text-red-800' : 'text-purple-800'}`}>{request.standbyNotes}</p>
              </div>
            )}
          </div>

          {/* Original Request Info */}
          <div className="bg-white/70 rounded-lg p-3 space-y-2">
            <div>
              <p className="text-sm text-gray-500">Originally Requested Date</p>
              <p className="font-medium flex items-center gap-1 flex-wrap">
                <Calendar className="w-4 h-4" />
                {dateInfo.text}
                <TrafficConflictBadge dates={[request.desiredEventDate]} compact />
              </p>
            </div>
            {request.estimatedSandwichCount && (
              <div>
                <p className="text-sm text-gray-500">Sandwich Count Requested</p>
                <p className="font-medium">{request.estimatedSandwichCount}</p>
              </div>
            )}
          </div>

          {/* Contact Info */}
          <div className="bg-white/70 rounded-lg p-3">
            <p className="text-sm font-medium mb-1">Contact:</p>
            <p className="text-sm">{request.firstName} {request.lastName}</p>
            <p className="text-sm text-gray-600">{request.email}</p>
            {request.phone && <p className="text-sm text-gray-600">{request.phone}</p>}
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

        {/* Action Buttons */}
        <TooltipProvider>
          <CardActionRow>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  onClick={onReactivate}
                  className="bg-[#9333EA] hover:bg-[#7e22ce] text-white h-8"
                  data-testid="button-reactivate"
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Reactivate
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Move back to In Process</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onMoveToStalled}
                  className="border-gray-400 text-gray-600 hover:bg-gray-100 h-8"
                  data-testid="button-move-to-stalled"
                >
                  Move to Stalled
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Mark as stalled (no response)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={onView} data-testid="button-view" className="h-8">
                  <Eye className="w-4 h-4 mr-1" />
                  View
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>View event details</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={onEdit} data-testid="button-edit" className="h-8">
                  <Edit2 className="w-4 h-4 mr-1" />
                  Edit
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Edit this event</p>
              </TooltipContent>
            </Tooltip>

            {onDuplicate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={onDuplicate} data-testid="button-duplicate" className="h-8">
                    <Copy className="w-4 h-4 mr-1" />
                    Duplicate
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Create another event from this one</p>
                </TooltipContent>
              </Tooltip>
            )}

            {request.phone && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={onCall} data-testid="button-call" className="h-8">
                    <Phone className="w-4 h-4 mr-1" />
                    Call
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Call the organizer</p>
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={onContact} data-testid="button-contact" className="h-8">
                  <Mail className="w-4 h-4 mr-1" />
                  Email
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Email the organizer</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onLogContact}
                  className="border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10 h-8"
                  data-testid="button-log-contact"
                >
                  <FileText className="w-4 h-4 mr-1" />
                  Log Contact
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Log a contact attempt</p>
              </TooltipContent>
            </Tooltip>

            <ActionRowSpacer />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={messageAboutEvent}
                  variant="ghost"
                  className="text-[#007E8C] hover:text-[#007E8C] hover:bg-[#007E8C]/10 h-8"
                  data-testid="button-message"
                >
                  <MessageSquare className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Message about this event</p>
              </TooltipContent>
            </Tooltip>

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
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      }
                      title="Delete Standby Event"
                      description={`Are you sure you want to delete the standby event request from ${request.organizationName}? This action cannot be undone.`}
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
      </CardContent>

    </Card>
  );
};
