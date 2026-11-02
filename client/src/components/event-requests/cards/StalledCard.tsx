import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  RefreshCw,
  Mail,
  Phone,
  Eye,
  Trash2,
  Calendar,
  MessageSquare,
  FileText,
  Clock,
  XCircle,
  Edit2,
  Copy,
} from 'lucide-react';
import { formatEventDate } from '@/components/event-requests/utils';
import { TrafficConflictBadge } from '@/components/event-requests/TrafficConflictBadge';
import { statusColors, statusIcons, statusOptions } from '@/components/event-requests/constants';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
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
import { ReminderRulesManager } from '@/components/event-requests/ReminderRulesManager';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CardActionRow, ActionRowSpacer } from './card-ui';

interface StalledCardProps {
  request: EventRequest;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onContact: () => void;
  onCall: () => void;
  onReactivate: () => void;
  onLogContact: () => void;
  onDecline: () => void;
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
  const StatusIcon = statusIcons[request.status as keyof typeof statusIcons] || AlertCircle;

  const getStatusLabel = (status: string) => {
    const statusOption = statusOptions.find(option => option.value === status);
    return statusOption ? statusOption.label : status.replace('_', ' ');
  };

  // For stalled events, use the original event date if stored, otherwise the desired date
  const displayDate = request.stalledOriginalEventDate || request.desiredEventDate;
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
            <h3 className="font-bold text-lg sm:text-xl text-tsp-teal break-words min-w-0">
              {request.organizationName}
              {request.department && (
                <span className="text-tsp-teal/70 font-medium ml-1">
                  &bull; {request.department}
                </span>
              )}
            </h3>
            <Badge className="inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold bg-gradient-to-br from-gray-100 to-gray-200 text-gray-700 border border-gray-400/50 text-sm whitespace-nowrap">
              <StatusIcon className="w-3 h-3 mr-1" />
              {getStatusLabel(request.status)}
            </Badge>
          </div>
          <div className="text-sm text-tsp-teal mt-1 space-y-1">
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
              <div className="text-sm text-tsp-navy mb-2 flex items-center gap-2 flex-wrap">
                <div>
                  <span className="font-medium">TSP Contact: </span>
                  <span className="font-normal">
                    {request.tspContact ? (resolveUserName ? resolveUserName(request.tspContact) : request.tspContact) : request.customTspContact}
                  </span>
                </div>
              </div>
            )}
            {displayDate && (
              <div className="flex items-center gap-1 flex-wrap">
                <Calendar className="w-3 h-3" />
                <span data-testid="text-date-label" className="text-[16px]">
                  Original Date: {' '}
                  <strong className="text-[16px]" data-testid="text-date-value">
                    {dateInfo ? dateInfo.text : 'No date set'}
                  </strong>
                </span>
                <TrafficConflictBadge dates={[displayDate]} compact />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const StalledCard: React.FC<StalledCardProps> = ({
  request,
  onView,
  onEdit,
  onDelete,
  onContact,
  onCall,
  onReactivate,
  onLogContact,
  onDecline,
  onDuplicate,
  canDelete = true,
  resolveUserName,
}) => {
  const messageAboutEvent = useMessageAboutEvent(request);
  const [showComments, setShowComments] = React.useState(false);
  const { user } = useAuth();
  const collaboration = useEventCollaboration(request.id);
  const lastOutreachInfo = request.stalledLastOutreachDate ? formatEventDate(request.stalledLastOutreachDate.toString()) : null;
  const nextOutreachInfo = request.stalledNextOutreachDate ? formatEventDate(request.stalledNextOutreachDate.toString()) : null;

  // Calculate if next outreach date has passed
  const isNextOutreachDue = request.stalledNextOutreachDate && new Date(request.stalledNextOutreachDate) < new Date();

  // Calculate days since marked stalled
  const daysSinceStalled = request.stalledMarkedAt
    ? Math.floor((new Date().getTime() - new Date(request.stalledMarkedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <Card
      className={`min-w-0 overflow-hidden transition-all duration-200 hover:shadow-[0_2px_6px_rgba(0,0,0,0.10)] border-l-[4px] bg-gray-50 shadow-[0_1px_4px_rgba(0,0,0,0.08)] border-[#D8DEE2] rounded-xl`}
      style={{ borderLeftColor: '#6B7280' }}
      data-testid={`card-stalled-${request.id}`}
    >
      <CardContent className="p-3">
        <CardHeader
          request={request}
          resolveUserName={resolveUserName}
          presentUsers={collaboration.presentUsers}
          currentUserId={user?.id}
        />

        {/* Stalled Info - Prominent Display */}
        <div className="space-y-3 mb-4">
          <div className={`rounded-lg p-4 border-2 ${isNextOutreachDue ? 'bg-amber-100 border-amber-300' : 'bg-gray-100 border-gray-300'}`}>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className={`w-5 h-5 ${isNextOutreachDue ? 'text-amber-700' : 'text-gray-700'}`} />
              <span className={`text-base font-semibold ${isNextOutreachDue ? 'text-amber-900' : 'text-gray-900'}`}>
                Stalled - No Response
              </span>
              {daysSinceStalled !== null && (
                <Badge variant="outline" className="ml-2 text-xs">
                  {daysSinceStalled} days
                </Badge>
              )}
            </div>

            {request.stalledReason && (
              <div className="mt-3">
                <p className={`text-sm font-medium mb-1 ${isNextOutreachDue ? 'text-amber-900' : 'text-gray-900'}`}>Reason:</p>
                <p className={`text-sm ${isNextOutreachDue ? 'text-amber-800' : 'text-gray-700'}`}>{request.stalledReason}</p>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              {request.stalledOutreachCount !== undefined && request.stalledOutreachCount > 0 && (
                <div className="bg-white/50 rounded p-2">
                  <p className="text-xs text-gray-500">Outreach Attempts</p>
                  <p className="text-lg font-semibold text-gray-800">{request.stalledOutreachCount}</p>
                </div>
              )}

              {lastOutreachInfo && (
                <div className="bg-white/50 rounded p-2">
                  <p className="text-xs text-gray-500">Last Outreach</p>
                  <p className="text-sm font-medium text-gray-800">{lastOutreachInfo.text}</p>
                </div>
              )}
            </div>

            {request.stalledNextOutreachDate && (
              <div className={`mt-3 rounded p-2 ${isNextOutreachDue ? 'bg-amber-50' : 'bg-white/50'}`}>
                <p className={`text-sm font-medium mb-1 ${isNextOutreachDue ? 'text-amber-900' : 'text-gray-700'}`}>
                  {isNextOutreachDue ? 'Next Outreach (OVERDUE):' : 'Next Scheduled Outreach:'}
                </p>
                <p className={`text-base font-semibold flex items-center gap-1 ${isNextOutreachDue ? 'text-amber-900' : 'text-gray-800'}`}>
                  <Clock className="w-4 h-4" />
                  {nextOutreachInfo?.text}
                  {isNextOutreachDue && (
                    <Badge variant="default" className="ml-2 text-xs bg-amber-600">
                      Time to Reach Out!
                    </Badge>
                  )}
                </p>
              </div>
            )}

            {request.stalledNotes && (
              <div className="mt-3">
                <p className={`text-sm font-medium mb-1 ${isNextOutreachDue ? 'text-amber-900' : 'text-gray-900'}`}>Notes:</p>
                <p className={`text-sm whitespace-pre-wrap ${isNextOutreachDue ? 'text-amber-800' : 'text-gray-700'}`}>{request.stalledNotes}</p>
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

          {/* Event Notes if any */}
          {request.message && (
            <div className="bg-gray-100 rounded-lg p-3">
              <p className="text-sm font-medium mb-1">Original Request Notes:</p>
              <p className="text-sm text-gray-600">{request.message}</p>
            </div>
          )}
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
                  className="bg-[#6B7280] hover:bg-[#4B5563] text-white h-8"
                  data-testid="button-reactivate"
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Reactivate
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>They responded! Move back to In Process</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onDecline}
                  className="border-red-400 text-red-600 hover:bg-red-50 h-8"
                  data-testid="button-decline"
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Mark Declined
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>They officially declined - close this request</p>
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
                  <p>Try calling again</p>
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
                <p>Send follow-up email</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onLogContact}
                  className="border-tsp-teal text-tsp-teal hover:bg-tsp-teal/10 h-8"
                  data-testid="button-log-contact"
                >
                  <FileText className="w-4 h-4 mr-1" />
                  Log Outreach
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Log an outreach attempt</p>
              </TooltipContent>
            </Tooltip>

            <ReminderRulesManager
              eventRequestId={request.id}
              tspContactUserId={request.tspContact || request.tspContactAssigned}
              eventStatus={request.status}
            />

            <ActionRowSpacer />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={messageAboutEvent}
                  variant="ghost"
                  className="text-tsp-teal hover:text-tsp-teal hover:bg-tsp-teal/10 h-8"
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
                      title="Delete Stalled Event"
                      description={`Are you sure you want to delete the stalled event request from ${request.organizationName}? This action cannot be undone.`}
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
