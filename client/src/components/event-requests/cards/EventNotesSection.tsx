/**
 * The notes section on event request cards.
 *
 * "Team Comments" was retired (planning team decision). In its place:
 *  - New request cards: **New Event Flags**, where intake leaves notes the TSP
 *    contact should see before reaching out. They go into the "you've been
 *    assigned" alert, and one added after assignment emails the contact.
 *  - Every other card: the comments already left on the event, shown
 *    collapsed and read-only as **Earlier comments** so nothing disappears.
 *    Nothing new can be added there, and the section is hidden when empty.
 *
 * Flags and earlier comments are the same rows (event_collaboration_comments);
 * only where they can be added changed.
 */
import * as React from 'react';
import { ChevronDown, ChevronUp, Flag, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CommentThread } from '@/components/collaboration';
import type { EventCollaborationComment } from '@shared/schema';

export const NEW_EVENT_FLAG_LABELS = {
  title: 'New Event Flags',
  empty: 'No flags yet',
  emptyHint: 'Add anything the TSP contact should know before they reach out.',
  placeholder: 'Add a flag for the TSP contact, e.g. "Asked about a weekday; budget is tight"',
  submit: 'Add Flag',
};

export const EARLIER_COMMENT_LABELS = {
  title: 'Earlier comments',
  empty: 'No earlier comments',
};

interface CollaborationLike {
  comments?: EventCollaborationComment[];
  commentsLoading?: boolean;
  addComment: (content: string, parentId?: number) => Promise<void>;
  updateComment: (commentId: number, content: string) => Promise<void>;
  deleteComment: (commentId: number) => Promise<void>;
}

interface EventNotesSectionProps {
  eventId: number | null | undefined;
  /** 'flags' on New request cards; 'earlier' (read-only) everywhere else. */
  mode: 'flags' | 'earlier';
  collaboration: CollaborationLike;
  currentUserId: string;
  currentUserName: string;
  /** Tighter padding, for cards that keep this section small (Scheduled). */
  dense?: boolean;
}

export function EventNotesSection({
  eventId,
  mode,
  collaboration,
  currentUserId,
  currentUserName,
  dense = false,
}: EventNotesSectionProps) {
  const comments = collaboration.comments || [];
  const isFlags = mode === 'flags';
  // Flags start open when there are some, so the TSP contact sees them.
  const [open, setOpen] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const isOpen = touched ? open : isFlags && comments.length > 0;

  if (!eventId) return null;
  // Earlier comments: nothing to show, nothing to add, so no section at all.
  if (!isFlags && comments.length === 0) return null;

  const Icon = isFlags ? Flag : MessageSquare;
  const title = isFlags ? NEW_EVENT_FLAG_LABELS.title : EARLIER_COMMENT_LABELS.title;

  return (
    <div
      className={`rounded-lg border ${dense ? 'px-2 py-1 mb-2' : 'p-4 mb-4'} ${isFlags ? 'bg-[#FEF3E2] border-[#FBAD3F]' : 'bg-white border-gray-200'}`}
      data-testid={isFlags ? 'new-event-flags' : 'earlier-comments'}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setTouched(true);
          setOpen(!isOpen);
        }}
        aria-expanded={isOpen}
        className={`w-full justify-between text-gray-700 hover:text-gray-700 hover:bg-black/5 font-medium ${dense ? 'px-2 py-1 h-8' : 'p-2 h-auto'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-4 h-4 ${isFlags ? 'text-[#D68319]' : 'text-gray-600'}`} />
          <h3 className="text-sm font-semibold">{title}</h3>
          {comments.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {comments.length}
            </Badge>
          )}
          {!isFlags && <span className="text-xs text-gray-500 font-normal">(read-only)</span>}
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </Button>

      {isFlags && (
        <p className="text-xs text-[#114145]/80 px-2">
          Notes for the TSP contact before they reach out. They're included in the assignment email.
        </p>
      )}

      {isOpen && (
        <div className={`${dense ? 'mt-2' : 'mt-3'} max-h-[500px]`}>
          <CommentThread
            comments={comments}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            eventId={eventId}
            onAddComment={collaboration.addComment}
            onEditComment={collaboration.updateComment}
            onDeleteComment={collaboration.deleteComment}
            isLoading={collaboration.commentsLoading || false}
            readOnly={!isFlags}
            labels={isFlags ? NEW_EVENT_FLAG_LABELS : EARLIER_COMMENT_LABELS}
            compact
          />
        </div>
      )}
    </div>
  );
}
