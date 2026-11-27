import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Edit2, Trash2, Reply, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { EventCollaborationComment } from "@shared/schema";

interface CommentThreadProps {
  comments: EventCollaborationComment[];
  currentUserId: string;
  currentUserName: string;
  eventId: number;
  onAddComment: (content: string, parentId?: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  typingUsers?: string[];
  isLoading?: boolean;
  className?: string;
  compact?: boolean;
  /** Show the comments only: no composer, reply, edit, delete or like. */
  readOnly?: boolean;
  /** Wording, for threads that aren't called "comments" (e.g. New Event Flags). */
  labels?: Partial<CommentThreadLabels>;
}

export interface CommentThreadLabels {
  title: string;
  empty: string;
  emptyHint: string;
  placeholder: string;
  submit: string;
}

const DEFAULT_LABELS: CommentThreadLabels = {
  title: 'Comments',
  empty: 'No comments yet',
  emptyHint: 'Be the first to comment!',
  placeholder: 'Add a comment...',
  submit: 'Add Comment',
};

interface CommentItemProps {
  comment: EventCollaborationComment;
  currentUserId: string;
  currentUserName: string;
  eventId: number;
  onEdit: (commentId: number, content: string) => Promise<void>;
  onDelete: (commentId: number) => Promise<void>;
  onReply: (parentId: number) => void;
  getReplies: (parentId: number) => EventCollaborationComment[];
  depth?: number;
  readOnly?: boolean;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(userId: string): string {
  const colors = [
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-indigo-500",
    "bg-orange-500",
    "bg-teal-500",
    "bg-cyan-500",
  ];
  
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function CommentItem({
  comment,
  currentUserId,
  currentUserName,
  eventId,
  onEdit,
  onDelete,
  onReply,
  getReplies,
  depth = 0,
  readOnly = false,
}: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isOwner = comment.userId === currentUserId;
  const maxDepth = 3;
  const replies = getReplies(comment.id);

  // Likes were never built on the server (GET always returned an empty list,
  // POST saved nothing), so there's no like button and no per-comment
  // request: with flags open by default, that was one useless request each.

  const handleSaveEdit = async () => {
    if (!editContent.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onEdit(comment.id, editContent);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to edit comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (isSubmitting) return;
    
    if (window.confirm('Are you sure you want to delete this comment?')) {
      setIsSubmitting(true);
      try {
        await onDelete(comment.id);
      } catch (error) {
        console.error('Failed to delete comment:', error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div 
      className={cn("group", depth > 0 && "ml-8 mt-3")}
      data-testid={`comment-${comment.id}`}
    >
      <div className="flex gap-3">
        <Avatar className={cn("h-8 w-8 flex-shrink-0", getAvatarColor(comment.userId))}>
          <AvatarFallback className="text-white text-xs font-medium">
            {getInitials(comment.userName)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-foreground">
              {comment.userName}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
            </span>
            {comment.editedAt && (
              <span className="text-xs text-muted-foreground italic">
                (edited)
              </span>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[80px] text-sm"
                disabled={isSubmitting}
                data-testid={`edit-comment-textarea-${comment.id}`}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={!editContent.trim() || isSubmitting}
                  data-testid={`save-edit-button-${comment.id}`}
                >
                  {isSubmitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setEditContent(comment.content);
                  }}
                  disabled={isSubmitting}
                  data-testid={`cancel-edit-button-${comment.id}`}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {comment.content}
              </p>

              {!readOnly && (
              <div className="flex items-center gap-2 mt-2">
                {/* Other actions - shown on hover */}
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {depth < maxDepth && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => onReply(comment.id)}
                      data-testid={`reply-button-${comment.id}`}
                    >
                      <Reply className="h-3 w-3 mr-1" />
                      Reply
                    </Button>
                  )}
                  {isOwner && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setIsEditing(true)}
                        data-testid={`edit-button-${comment.id}`}
                      >
                        <Edit2 className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={handleDelete}
                        disabled={isSubmitting}
                        data-testid={`delete-button-${comment.id}`}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
              )}
            </>
          )}
        </div>
      </div>

      {replies.length > 0 && (
        <div className="mt-3" data-testid={`replies-${comment.id}`}>
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              eventId={eventId}
              onEdit={onEdit}
              onDelete={onDelete}
              onReply={onReply}
              getReplies={getReplies}
              depth={depth + 1}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CommentThread({
  comments,
  currentUserId,
  currentUserName,
  eventId,
  onAddComment,
  onEditComment,
  onDeleteComment,
  typingUsers = [],
  isLoading = false,
  className,
  compact = false,
  readOnly = false,
  labels: labelOverrides,
}: CommentThreadProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [newComment, setNewComment] = useState("");
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const topLevelComments = comments.filter(c => !c.parentCommentId);
  
  const getReplies = (parentId: number) => {
    return comments.filter(c => c.parentCommentId === parentId);
  };

  const handleSubmit = async () => {
    if (!newComment.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onAddComment(newComment, replyToId || undefined);
      setNewComment("");
      setReplyToId(null);
    } catch (error) {
      console.error('Failed to add comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = (parentId: number) => {
    setReplyToId(parentId);
    const textarea = document.querySelector('[data-testid="new-comment-textarea"]') as HTMLTextAreaElement;
    textarea?.focus();
  };

  return (
    <div className={cn("flex flex-col h-full", className)} data-testid="comment-thread">
      {!compact && (
        <div className="flex items-center gap-2 mb-4 pb-3 border-b">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">
            {labels.title}
          </h3>
          <span className="text-sm text-muted-foreground">
            ({comments.length})
          </span>
        </div>
      )}

      <ScrollArea className={cn("flex-1", compact ? "pr-2" : "pr-4")}>
        {isLoading ? (
          <div className={cn("flex items-center justify-center", compact ? "py-4" : "py-8")}>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <div className={cn("text-center text-muted-foreground", compact ? "py-2" : "py-8")}>
            {!compact && (
              <>
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{labels.empty}</p>
                {!readOnly && <p className="text-xs mt-1">{labels.emptyHint}</p>}
              </>
            )}
            {compact && (
              <p className="text-xs opacity-60">{labels.empty}</p>
            )}
          </div>
        ) : (
          <div className={cn("pb-4", compact ? "space-y-2" : "space-y-4")}>
            {topLevelComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                eventId={eventId}
                onEdit={onEditComment}
                onDelete={onDeleteComment}
                onReply={handleReply}
                getReplies={getReplies}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}

        {typingUsers.length > 0 && (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground italic">
            <Loader2 className="h-3 w-3 animate-spin" />
            {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing...
          </div>
        )}
      </ScrollArea>

      {!readOnly && (
      <div className={cn("border-t", compact ? "pt-2 mt-2" : "pt-4 mt-4")}>
        {replyToId && (
          <div className="flex items-center justify-between mb-2 px-3 py-2 bg-muted rounded-md">
            <span className="text-xs text-muted-foreground">
              Replying to comment
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => setReplyToId(null)}
            >
              Cancel
            </Button>
          </div>
        )}

        <div className={cn(compact ? "space-y-1" : "space-y-2")}>
          <Textarea
                        placeholder={labels.placeholder}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className={cn("resize-none", compact ? "min-h-[60px] text-sm" : "min-h-[100px]")}
            disabled={isSubmitting}
            data-testid="new-comment-textarea"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSubmit();
              }
            }}
          />
          <div className="flex justify-between items-center">
            {!compact && (
              <span className="text-xs text-muted-foreground">
                Tip: Press {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'} + Enter to submit
              </span>
            )}
            {compact && <span></span>}
            <Button
              onClick={handleSubmit}
              disabled={!newComment.trim() || isSubmitting}
              data-testid="submit-comment-button"
              size={compact ? "sm" : "default"}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {labels.submit}
            </Button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
