import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Ban, Eye, Edit2, Trash2, Calendar, Building, Copy } from 'lucide-react';
import { statusColors, statusBorderColors, statusBgColors } from '@/components/event-requests/constants';
import type { EventRequest } from '@shared/schema';

interface NonEventCardProps {
  request: EventRequest;
  resolveUserName: (userId: string | undefined) => string;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
}

export const NonEventCard: React.FC<NonEventCardProps> = ({
  request,
  resolveUserName,
  onView,
  onEdit,
  onDelete,
  onDuplicate,
}) => {
  const borderColor = statusBorderColors['non_event'] || '#78716C';
  const bgColor = statusBgColors['non_event'] || 'bg-[#F5F5F4]';

  return (
    <Card
      className={`relative overflow-hidden ${bgColor} hover:shadow-md transition-shadow`}
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge className={statusColors['non_event'] || ''}>
                <Ban className="w-3 h-3 mr-1" />
                Non-Event
              </Badge>
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-tsp-teal break-words min-w-0">
              {request.organizationName}
              {request.department && (
                <span className="text-base sm:text-lg font-normal text-gray-600 ml-2">
                  &bull; {request.department}
                </span>
              )}
            </h3>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={onView}
              className="h-8 w-8 p-0"
              title="View details"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="h-8 w-8 p-0"
              title="Edit event"
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            {onDuplicate && (
              <Button
                size="sm"
                variant="outline"
                onClick={onDuplicate}
                className="h-8 w-8 p-0"
                title="Duplicate event"
                aria-label="Duplicate event"
              >
                <Copy className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onDelete}
              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Contact info */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
          {(request.firstName || request.lastName) && (
            <span className="flex items-center gap-1">
              <Building className="w-3.5 h-3.5" />
              {[request.firstName, request.lastName].filter(Boolean).join(' ')}
            </span>
          )}
          {request.createdAt && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              Submitted: {new Date(request.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>

        {/* Non-event reason */}
        {(request as any).nonEventReason && (
          <div className="mt-3 p-3 bg-stone-100 border border-stone-200 rounded-lg">
            <p className="text-sm font-medium text-stone-700 mb-1">Reason</p>
            <p className="text-sm text-stone-600">{(request as any).nonEventReason}</p>
            {(request as any).nonEventNotes && (
              <p className="text-xs text-stone-500 mt-1">{(request as any).nonEventNotes}</p>
            )}
            {(request as any).nonEventBy && (
              <p className="text-xs text-stone-400 mt-1">
                Marked by {resolveUserName((request as any).nonEventBy)}
                {(request as any).nonEventAt && ` on ${new Date((request as any).nonEventAt).toLocaleDateString()}`}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
