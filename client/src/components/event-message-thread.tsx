import React, { useMemo, useState } from 'react';
import { useEventMessages } from '@/hooks/useEventMessages';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MessageSquare, Loader2, Phone, Mail, Video, Calendar, FileText, ClipboardList, AlertCircle, Users, User, Truck, Car, Bell, Package, Copy, PhoneOff, Share2, Edit2, Trash2, MessageCircle } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import type { EventRequest } from '@shared/schema';

interface Message {
  id: number;
  senderId: string;
  content: string;
  senderName?: string;
  senderEmail?: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
}

interface EventMessageThreadProps {
  eventId: string;
  eventRequest?: EventRequest;
  eventTitle?: string;
  maxHeight?: string;
  showHeader?: boolean;
  onDeleteContactAttempt?: (attemptNumber: number) => Promise<void>;
  onEditContactAttempt?: (attemptNumber: number, updatedData: {
    method: string;
    outcome: string;
    notes?: string;
    timestamp: string;
  }) => Promise<void>;
}

export const EventMessageThread: React.FC<EventMessageThreadProps> = ({
  eventId,
  eventRequest,
  eventTitle,
  maxHeight = '400px',
  showHeader = true,
  onDeleteContactAttempt,
  onEditContactAttempt,
}) => {
  const { user } = useAuth();
  // Use lightweight hook that doesn't create WebSocket connections
  const { data: rawMessages, isLoading, isError } = useEventMessages(eventId);

  // Filter out deleted messages and sort by creation date
  const messages = useMemo(() => {
    if (!rawMessages || !Array.isArray(rawMessages)) {
      return [];
    }

    return rawMessages
      .filter((msg: Message) => !msg.deletedAt)
      .sort((a: Message, b: Message) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [rawMessages]);

  // Build combined activity items from contact attempts and notes
  const activityItems = useMemo(() => {
    try {
      const items: Array<{
        type: 'contact' | 'note' | 'message' | 'initial';
        icon: React.ReactNode;
        title: string;
        content: string;
        date?: Date;
        badge?: string;
        attemptNumber?: number;
        createdBy?: string;
        canEdit?: boolean;
        canDelete?: boolean;
      }> = [];

      if (!eventRequest) return items;

    // Note: Initial request message is displayed in the "Notes & Requirements" section
    // of the card, so we don't duplicate it here

    // Note: Contact attempts are now displayed in the card itself (above the event date),
    // so we don't duplicate them here in the Communication & Notes section

    // Legacy: Parse old unresponsiveNotes if present (for backwards compatibility)
    if (eventRequest.unresponsiveNotes && !eventRequest.contactAttemptsLog) {
      // Try to parse individual attempts from legacy format
      // Format examples:
      // - "Attempt #1 - Email: Successfully contacted - Got response..."
      // - "[Nov 7, 2025, 4:21 PM] Attempt #2 - Phone: Successfully contacted..."
      // - Multiple attempts separated by double newlines
      const legacyText = eventRequest.unresponsiveNotes.trim();
      
      // First, try to split by double newlines to get separate attempts
      const attemptBlocks = legacyText.split(/\n\n+/).filter(block => block.trim().length > 0);
      
      // If we have multiple blocks or can find "Attempt #" patterns, parse individually
      if (attemptBlocks.length > 1 || legacyText.includes('Attempt #')) {
        attemptBlocks.forEach((block) => {
          const blockTrimmed = block.trim();
          
          // Match pattern: [optional date] Attempt #number - Method: content
          const attemptMatch = blockTrimmed.match(/(?:\[([^\]]+)\]\s*)?Attempt\s*#(\d+)\s*-\s*([^:]+):\s*(.+)/is);
          
          if (attemptMatch) {
            const dateStr = attemptMatch[1]; // Date from [Nov 7, 2025, 4:21 PM]
            const attemptNumber = parseInt(attemptMatch[2]);
            const method = attemptMatch[3].trim(); // "Email", "Phone", etc.
            const content = attemptMatch[4].trim();
            
            // Parse outcome and notes (content may have " - " separator)
            let outcome = content;
            let notes: string | undefined;
            
            // Try to split by " - " but be careful not to split dates or other content
            const dashIndex = content.indexOf(' - ');
            if (dashIndex > 0 && dashIndex < content.length - 3) {
              outcome = content.substring(0, dashIndex).trim();
              notes = content.substring(dashIndex + 3).trim();
            }
            
            // Parse date
            let parsedDate: Date | undefined;
            if (dateStr) {
              try {
                parsedDate = new Date(dateStr);
                if (isNaN(parsedDate.getTime())) {
                  parsedDate = undefined;
                }
              } catch (e) {
                // Date parsing failed
              }
            }
            
            // Determine method icon
            const methodLower = method.toLowerCase();
            let methodIcon: React.ReactNode;
            if (methodLower.includes('phone')) {
              methodIcon = <Phone className="h-4 w-4" />;
            } else if (methodLower.includes('email')) {
              methodIcon = <Mail className="h-4 w-4" />;
            } else {
              methodIcon = <MessageSquare className="h-4 w-4" />;
            }
            
            items.push({
              type: 'contact',
              icon: methodIcon,
              title: `Contact Attempt #${attemptNumber}`,
              content: notes || outcome,
              date: parsedDate,
              badge: 'Legacy Entry',
              attemptNumber,
              canEdit: false,
              canDelete: false,
            });
          } else {
            // If this block doesn't match the pattern, try to extract date if present
            const dateMatch = blockTrimmed.match(/\[([^\]]+)\]/);
            let parsedDate: Date | undefined;
            let contentWithoutDate = blockTrimmed;

            if (dateMatch) {
              try {
                parsedDate = new Date(dateMatch[1]);
                if (!isNaN(parsedDate.getTime())) {
                  contentWithoutDate = blockTrimmed.replace(/\[.*?\]\s*/, '').trim();
                }
              } catch (e) {
                // Date parsing failed
              }
            }

            // Only add if there's meaningful content
            if (contentWithoutDate.length > 0) {
              items.push({
                type: 'note',
                icon: <PhoneOff className="h-4 w-4" />,
                title: 'Contact Note (Legacy)',
                content: contentWithoutDate,
                date: parsedDate,
              });
            }
          }
        });
      } else {
        // If we can't parse individual attempts, show as a single legacy entry
        const dateMatch = eventRequest.unresponsiveNotes.match(/\[([^\]]+)\]/);
        let parsedDate: Date | undefined;
        let contentWithoutDate = eventRequest.unresponsiveNotes;

        if (dateMatch) {
          try {
            parsedDate = new Date(dateMatch[1]);
            if (!isNaN(parsedDate.getTime())) {
              contentWithoutDate = eventRequest.unresponsiveNotes.replace(/\[.*?\]\s*/, '').trim();
            }
          } catch (e) {
            // Date parsing failed, keep original content
          }
        }

        items.push({
          type: 'note',
          icon: <PhoneOff className="h-4 w-4" />,
          title: 'Contact Attempts Logged (Legacy)',
          content: contentWithoutDate,
          date: parsedDate,
        });
      }
    }

    // Note: Planning notes, scheduling notes, and other notes are displayed in the 
    // "Notes & Requirements" section of the card, so we don't duplicate them here

    // Add follow-up notes
    if (eventRequest.followUpNotes) {
      items.push({
        type: 'note',
        icon: <Bell className="h-4 w-4" />,
        title: 'Follow-up Notes',
        content: eventRequest.followUpNotes,
      });
    }

    // Add distribution notes
    if (eventRequest.distributionNotes) {
      items.push({
        type: 'note',
        icon: <Package className="h-4 w-4" />,
        title: 'Distribution Notes',
        content: eventRequest.distributionNotes,
      });
    }

    // Duplicate check notes are processed in the background for internal use only
    // and not displayed to users to avoid confusion

    // Add social media notes
    if (eventRequest.socialMediaPostNotes) {
      items.push({
        type: 'note',
        icon: <Share2 className="h-4 w-4" />,
        title: 'Social Media Notes',
        content: eventRequest.socialMediaPostNotes,
      });
    }

    // Add messages
    messages.forEach((message) => {
      items.push({
        type: 'message',
        icon: <MessageSquare className="h-4 w-4" />,
        title: message.senderName || message.senderEmail || 'Unknown User',
        content: message.content,
        date: new Date(message.createdAt),
      });
    });

      // Sort by date (most recent first), putting items without dates at the top
      return items.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return -1;
        if (!b.date) return 1;
        return b.date.getTime() - a.date.getTime();
      });
    } catch (error) {
      console.error('Error building activity items:', error);
      // Return empty array on error to prevent crashes
      return [];
    }
  }, [eventRequest, messages, user]);

  // Ensure activityItems is always an array
  const safeActivityItems = Array.isArray(activityItems) ? activityItems : [];
  const totalCount = safeActivityItems.length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading activity...</span>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <span>No communication or notes yet</span>
        </div>
        <span className="text-xs text-slate-400">
          Log your first contact attempt or note to see updates here.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Comments & Messages
              <Badge variant="secondary" className="text-xs">
                {totalCount}
              </Badge>
            </h3>
            {eventTitle && (
              <p className="text-xs text-gray-500 mt-1">{eventTitle}</p>
            )}
          </div>
        </div>
      )}

      <div style={{ maxHeight }} className="overflow-y-auto pr-4">
        <div className="space-y-3 pb-4">
          {safeActivityItems.map((item, index) => (
            <Card key={index} className="p-3 bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700">
              <div className="space-y-2">
                {/* Activity Header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-[#236383] dark:text-[#47B3CB]">
                    {item.icon}
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {item.title}
                  </p>
                </div>

                {/* User Attribution - Prominent display for contact attempts */}
                {item.type === 'contact' && item.badge && (
                  <div className="ml-6 flex items-center gap-2 px-3 py-2 bg-[#236383]/10 dark:bg-[#47B3CB]/10 border-l-3 border-l-[#236383] dark:border-l-[#47B3CB] rounded-r-md">
                    <User className="h-4 w-4 text-[#236383] dark:text-[#47B3CB] flex-shrink-0" />
                    <span className="text-sm font-medium text-[#236383] dark:text-[#47B3CB]">
                      {item.badge}
                    </span>
                  </div>
                )}

                {/* Activity Content */}
                <div className="ml-6">
                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                    {item.content}
                  </div>
                  {/* Badges next to content */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {item.date && (
                      <Badge variant="secondary" className="text-xs">
                        {formatDistanceToNow(item.date, { addSuffix: true })}
                        {' • '}
                        {format(item.date, 'MMM d, yyyy h:mm a')}
                      </Badge>
                    )}
                    {/* Only show badge here if it's not a contact attempt (contact attempts show badge in header) */}
                    {item.badge && item.type !== 'contact' && (
                      <Badge variant="outline" className="text-xs">
                        {item.badge}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Edit/Delete buttons for contact attempts */}
                {item.type === 'contact' && (item.canEdit || item.canDelete) && (
                  <div className="flex gap-2 ml-6 mt-2">
                    {item.canEdit && onEditContactAttempt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[#236383] hover:text-[#1e5a75] hover:bg-[#236383]/10"
                        onClick={() => item.attemptNumber && onEditContactAttempt(item.attemptNumber)}
                      >
                        <Edit2 className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    )}
                    {item.canDelete && onDeleteContactAttempt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => item.attemptNumber && onDeleteContactAttempt(item.attemptNumber)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};
