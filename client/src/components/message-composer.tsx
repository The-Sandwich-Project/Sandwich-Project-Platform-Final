import { useState, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useMessaging } from '@/hooks/useMessaging';
import { Send, X, User, Plus, Paperclip, FileText, Image, File, Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { apiRequest } from '@/lib/queryClient';
import { logger } from '@/lib/logger';

interface MessageAttachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

interface MessageComposerProps {
  contextType?: 'suggestion' | 'project' | 'task' | 'event' | 'graphic' | 'expense' | 'collection' | 'direct';
  contextId?: string;
  contextTitle?: string;
  defaultRecipients?: Array<{ id: string; name: string; email?: string }>;
  onSent?: () => void;
  onCancel?: () => void;
  compact?: boolean;
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper to get icon for file type
function getFileIcon(type: string) {
  if (type.startsWith('image/')) return Image;
  if (type === 'application/pdf') return FileText;
  return File;
}

export function MessageComposer({
  contextType = 'direct',
  contextId,
  contextTitle,
  onSent,
  onCancel,
}: MessageComposerProps) {
  const [content, setContent] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { sendMessage, isSending } = useMessaging();
  const queryClient = useQueryClient();

  // Handle file selection
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Check total attachments limit
    if (attachments.length + files.length > 5) {
      toast({
        title: 'Too many attachments',
        description: 'Maximum 5 attachments allowed per message',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append('files', file);
      }

      const response = await fetch('/api/messaging/attachments/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to upload files');
      }

      const result = await response.json();
      if (!result.attachments || !Array.isArray(result.attachments)) {
        throw new Error('Invalid response from server');
      }
      setAttachments(prev => [...prev, ...result.attachments]);

      toast({
        description: `${result.attachments.length} file(s) uploaded`,
      });
    } catch (error) {
      logger.error('Failed to upload attachments:', error);
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [attachments.length, toast]);

  // Remove an attachment
  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Fetch all users for recipient selection (uses for-assignments endpoint - no special permissions needed)
  const { data: users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['/api/users/for-assignments'],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', '/api/users/for-assignments');
        return Array.isArray(response) ? response : [];
      } catch (error) {
        logger.error('Error fetching users:', error);
        return [];
      }
    },
  });

  const handleSend = async () => {
    if (!content.trim() && attachments.length === 0) {
      toast({
        title: 'Message required',
        description: 'Please enter a message or attach a file',
        variant: 'destructive',
      });
      return;
    }

    if (selectedRecipients.length === 0) {
      toast({
        title: 'Recipients required',
        description: 'Please select at least one recipient',
        variant: 'destructive',
      });
      return;
    }

    logger.log('Sending message:', {
      recipientIds: selectedRecipients,
      content: content.trim(),
      contextType,
      contextId,
      recipientCount: selectedRecipients.length,
      attachmentCount: attachments.length,
    });

    try {
      // Event messages go to each recipient's Team Chat DM, where people
      // actually look. Other contexts still use the legacy messaging inbox.
      const sendsToTeamChat = contextType === 'event';
      const response = sendsToTeamChat
        ? await fetch('/api/stream/context-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              recipientIds: selectedRecipients,
              content: content.trim(),
              contextTitle,
              linkPath: contextId
                ? `/dashboard?section=event-requests&eventId=${contextId}`
                : undefined,
              attachments: attachments.length > 0 ? attachments : undefined,
            }),
          })
        : await fetch('/api/messaging/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              recipientIds: selectedRecipients,
              content: content.trim(),
              contextType,
              contextId,
              contextTitle,
              attachments: attachments.length > 0 ? attachments : undefined,
            }),
          });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Failed to send message');
      }

      const result = await response.json().catch(() => ({}));
      const failedCount: number = Array.isArray(result?.failed) ? result.failed.length : 0;

      setContent('');
      setSelectedRecipients([]);
      setAttachments([]);
      onSent?.();

      toast({
        description: sendsToTeamChat
          ? failedCount > 0
            ? `Sent to Team Chat DMs, but ${failedCount} recipient(s) couldn't be reached`
            : 'Sent to Team Chat direct messages'
          : 'Message sent successfully',
        variant: failedCount > 0 ? 'destructive' : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/messages'] }); // Refresh messages
    } catch (error) {
      logger.error('Failed to send message:', error);
      toast({
        title: 'Failed to send message',
        description:
          error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            Compose Message
            {contextType !== 'direct' && contextTitle && (
              <span className="text-sm font-normal text-gray-500 ml-2">
                to {contextTitle}
              </span>
            )}
          </CardTitle>
          {onCancel && (
            <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Close message composer">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {contextType !== 'direct' && (
          <Badge variant="secondary" className="w-fit">
            {contextType.charAt(0).toUpperCase() + contextType.slice(1)} Message
          </Badge>
        )}
        {contextType === 'event' && (
          <p className="text-xs text-gray-500">
            Each person gets this in their Team Chat direct messages with you.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium">Recipients</label>
            {isLoadingUsers ? (
              <div className="text-sm text-gray-500 mt-1">Loading users...</div>
            ) : (
              <div className="mt-2 space-y-2 max-h-40 overflow-y-auto border rounded-lg p-3 bg-white">
                {users.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    No users available
                  </div>
                ) : (
                  users.map((user: any) => (
                    <div
                      key={user.id}
                      className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-md transition-colors"
                    >
                      <Checkbox
                        id={user.id}
                        checked={selectedRecipients.includes(user.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedRecipients([
                              ...selectedRecipients,
                              user.id,
                            ]);
                          } else {
                            setSelectedRecipients(
                              selectedRecipients.filter((id) => id !== user.id)
                            );
                          }
                        }}
                      />
                      <label
                        htmlFor={user.id}
                        className="text-sm cursor-pointer text-gray-900 font-medium flex-1"
                      >
                        <span className="text-gray-900">
                          {user.firstName && user.lastName
                            ? `${user.firstName} ${user.lastName}`
                            : user.email}
                        </span>
                        {user.email && user.firstName && (
                          <span className="text-gray-600 ml-1 font-normal">
                            ({user.email})
                          </span>
                        )}
                      </label>
                    </div>
                  ))
                )}
              </div>
            )}
            {selectedRecipients.length > 0 && (
              <div className="mt-2">
                <div className="text-sm font-medium">Selected:</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedRecipients.map((recipientId) => {
                    const user = users.find((u: any) => u.id === recipientId);
                    return user ? (
                      <Badge
                        key={recipientId}
                        variant="outline"
                        className="text-xs"
                      >
                        {user.firstName && user.lastName
                          ? `${user.firstName} ${user.lastName}`
                          : user.email}
                      </Badge>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>

        <div>
          <label className="text-sm font-medium">Message</label>
          <Textarea
            placeholder="Type your message..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="mt-1"
          />
        </div>

        {/* Attachments section */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm font-medium">Attachments</label>
            <Badge variant="outline" className="text-xs">
              {attachments.length}/5
            </Badge>
          </div>

          {/* Attached files list */}
          {attachments.length > 0 && (
            <div className="space-y-2 mb-3">
              {attachments.map((attachment, index) => {
                const FileIcon = getFileIcon(attachment.type);
                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border"
                  >
                    <FileIcon className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{attachment.name}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(attachment.size)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAttachment(index)}
                      className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
                      aria-label={`Remove attachment ${attachment.name}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add attachment button */}
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || attachments.length >= 5}
              className="flex items-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Paperclip className="h-4 w-4" />
                  Attach Files
                </>
              )}
            </Button>
            <span className="text-xs text-gray-500">
              Max 10MB per file. Images, PDFs, documents allowed.
            </span>
          </div>
        </div>

        <div className="flex justify-end space-x-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            onClick={handleSend}
            disabled={
              (!content.trim() && attachments.length === 0) ||
              isSending ||
              isUploading ||
              selectedRecipients.length === 0
            }
            className="flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            {isSending ? 'Sending...' : 'Send Message'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
