import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingTracker } from '@/hooks/useOnboardingTracker';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { formatDistanceToNow } from 'date-fns';
import {
  Inbox as InboxIcon,
  Send,
  Edit3,
  Trash2,
  Star,
  Archive,
  Reply,
  ReplyAll,
  Forward,
  MoreVertical,
  Menu,
  X,
  CheckCircle2,
  Circle,
  Search,
  Plus,
  Users,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Trophy,
  Heart,
  Paperclip,
  FileText,
  Image,
  File,
  Loader2,
  Video,
  MessageSquare,
  Eye,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ButtonTooltip } from '@/components/ui/button-tooltip';
import { KudosInbox } from '@/components/kudos-inbox';
import { MessageContextBadge } from '@/components/message-context-badge';
import { InboxReadIndicator } from '@/components/read-receipts';
import { logger } from '@/lib/logger';

import { usePageSession } from '@/hooks/usePageSession';
interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
}

interface Message {
  id: number;
  content: string;
  userId: string;
  sender: string;
  senderName: string;
  conversationId: number;
  createdAt: string;
  // Email fields for Gmail-style inbox
  senderId?: string;
  senderEmail?: string;
  recipientId?: string;
  recipientName?: string;
  recipientEmail?: string;
  subject?: string;
  isRead?: boolean;
  isStarred?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  isDraft?: boolean;
  // Threading - reference to parent message for replies
  parentMessageId?: number | null;
  parentMessage?: {
    id: number;
    senderName: string;
    content: string;
    createdAt: Date | null;
  } | null;
  readAt?: string;
  contextType?: string;
  contextId?: string;
  contextTitle?: string;
  // Attachments
  attachments?: MessageAttachment[];
}

interface Draft {
  id?: number;
  recipientId: string;
  recipientName: string;
  subject: string;
  content: string;
  lastSaved: string;
}

interface MessageAttachment {
  name: string;
  url: string;
  type: string;
  size: number;
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
  if (type.startsWith('video/')) return Video;
  if (type === 'application/pdf') return FileText;
  return File;
}

export default function GmailStyleInbox() {
  // Track page session for activity logging
  usePageSession({
    section: 'Communication',
    page: 'Project Threads',
  });

  logger.log('🔍 GmailStyleInbox component is rendering');
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const { track } = useOnboardingTracker();

  // Add early return for loading state
  if (authLoading) {
    logger.log('🔄 Auth is loading, showing loading state');
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading messages...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    logger.log('❌ No user found, showing error');
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-gray-600">Please log in to view messages</p>
        </div>
      </div>
    );
  }

  logger.log(
    '✅ User authenticated, rendering inbox for:',
    (user as any)?.email
  );

  // UI State
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(
    new Set()
  );
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMessageListCollapsed, setIsMessageListCollapsed] = useState(false);
  const [screenSize, setScreenSize] = useState('desktop');

  // Responsive behavior with comprehensive breakpoint strategy
  useEffect(() => {
    const checkScreenSize = () => {
      const width = window.innerWidth;

      if (width < 768) {
        // Mobile (< 768px): Keep sidebar visible by default, allow manual collapse
        setScreenSize('mobile');
        // Don't auto-collapse sidebar on mobile - let users see it exists
        setIsMessageListCollapsed(true);
      } else if (width < 900) {
        // Small tablet (768-899px): Show message list + body, collapse sidebar
        setScreenSize('small-tablet');
        setIsSidebarCollapsed(true);
        setIsMessageListCollapsed(false);
      } else if (width < 1200) {
        // Large tablet/small laptop (900-1199px): Show compact sidebar + message list + body
        setScreenSize('large-tablet');
        setIsSidebarCollapsed(false);
        setIsMessageListCollapsed(false);
      } else {
        // Desktop (≥ 1200px): Show full sidebar + message list + body
        setScreenSize('desktop');
        setIsSidebarCollapsed(false);
        setIsMessageListCollapsed(false);
      }
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Compose State
  const [composeRecipient, setComposeRecipient] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeContent, setComposeContent] = useState('');

  // Reply State
  const [replyContent, setReplyContent] = useState('');

  // Draft State
  const [currentDraft, setCurrentDraft] = useState<Draft | null>(null);
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(
    null
  );

  // Attachment State
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch users for compose - use for-assignments endpoint (no special permissions required)
  const { data: users = [], isLoading: isLoadingUsers, error: usersError } = useQuery<User[]>({
    queryKey: ['/api/users/for-assignments'],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', '/api/users/for-assignments');
        logger.log(`[Compose] Fetched ${Array.isArray(response) ? response.length : 0} users from for-assignments endpoint`);
        return Array.isArray(response) ? response : [];
      } catch (error) {
        logger.error('[Compose] Error fetching users:', error);
        return [];
      }
    },
  });
  
  logger.log(`[Compose] Users loaded: ${users.length}, Loading: ${isLoadingUsers}, Error: ${usersError}`);

  // Use email system for Gmail inbox
  const apiBase = '/api/emails';

  // Fetch both regular messages and kudos for unified inbox
  const { data: messages = [], refetch: refetchMessages, isLoading: isLoadingMessages } = useQuery<any[]>({
    queryKey: [apiBase, activeFolder],
    queryFn: async () => {
      if (activeFolder === 'kudos') {
        // If in kudos folder, only show kudos
        const kudosResponse = await apiRequest('GET', '/api/emails/kudos');
        const kudos = Array.isArray(kudosResponse) ? kudosResponse : [];
        
        // Mark kudos with special type for styling
        const formattedKudos = kudos.map((kudo: any) => ({
          ...kudo,
          messageType: 'kudos',
          subject: `Kudos from ${kudo.senderName || 'a teammate'}`,
          senderName: kudo.senderName,
          isRead: kudo.isRead || false,
        }));
        
        logger.log(`Fetched ${formattedKudos.length} kudos`);
        return formattedKudos;
      } else {
        // For other folders, only fetch regular emails
        logger.log(`[${activeFolder}] Fetching messages for folder: ${activeFolder}`);
        const response = await apiRequest('GET', `/api/emails?folder=${activeFolder}`);
        logger.log(`[${activeFolder}] Raw response:`, response);
        const messages = Array.isArray(response) ? response : response.messages || [];
        
        logger.log(`[${activeFolder}] Parsed ${messages.length} messages`);
        
        const formattedMessages = messages.map((msg: any) => ({
          ...msg,
          messageType: 'email',
        }));
        
        logger.log(`[${activeFolder}] Fetched ${formattedMessages.length} emails from ${activeFolder} folder`);
        if (formattedMessages.length > 0) {
          logger.log(`[${activeFolder}] Sample message:`, formattedMessages[0]);
        }
        return formattedMessages;
      }
    },
  });

  // Fetch drafts
  const { data: drafts = [] } = useQuery<Draft[]>({
    queryKey: ['/api/drafts'],
    enabled: activeFolder === 'drafts',
  });

  // Fetch full thread when a message is selected
  const { data: threadMessages = [] } = useQuery<Message[]>({
    queryKey: ['/api/emails', selectedMessage?.id, 'thread'],
    queryFn: async () => {
      if (!selectedMessage?.id) return [];
      // Only fetch thread for emails with parentMessageId (replies)
      // or regular emails to get any replies they have
      const response = await apiRequest('GET', `/api/emails/${selectedMessage.id}/thread`);
      return Array.isArray(response) ? response : [];
    },
    enabled: !!selectedMessage?.id && (selectedMessage as any)?.messageType !== 'kudos',
  });

  // Helper to invalidate email-related queries efficiently
  // Consolidates multiple invalidateQueries calls into fewer operations
  const invalidateEmailQueries = (options?: { includeUnreadCount?: boolean; includeFolders?: boolean }) => {
    const { includeUnreadCount = true, includeFolders = false } = options || {};

    // Invalidate main email query for current folder
    // This prefix match invalidates all queries starting with [apiBase], including:
    // - ['/api/emails', activeFolder] (main messages query)
    // - ['/api/emails', 'inbox'], ['/api/emails', 'sent'], etc. (specific folders)
    // - ['/api/emails', 'inbox', 'count'] (inbox count query)
    queryClient.invalidateQueries({ queryKey: [apiBase] });

    // Invalidate unread count for navigation badge
    if (includeUnreadCount) {
      queryClient.invalidateQueries({ queryKey: ['/api/emails/unread-count'] });
    }

    // Note: includeFolders parameter is preserved for API compatibility but no longer needed
    // since the prefix match above handles all folder invalidations
  };

  // Auto-save draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async (draft: Partial<Draft>) => {
      if (draft.id) {
        return await apiRequest('PUT', `/api/drafts/${draft.id}`, draft);
      } else {
        return await apiRequest('POST', '/api/drafts', draft);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drafts'] });
    },
  });

  // Send message mutation - use email endpoint for Gmail
  const sendMessageMutation = useMutation({
    mutationFn: async (messageData: any) => {
      // Use proper email format for emailMessages table
      const emailData: any = {
        recipientId: messageData.recipientId,
        recipientName: messageData.recipientName,
        recipientEmail: messageData.recipientEmail,
        subject: messageData.subject || 'Project Discussion',
        content: messageData.content,
        isDraft: messageData.isDraft || false,
      };
      // Include attachments if present
      if (messageData.attachments && messageData.attachments.length > 0) {
        emailData.attachments = messageData.attachments;
      }
      logger.log('Sending email with data:', emailData);
      return await apiRequest('POST', '/api/emails', emailData);
    },
    onSuccess: () => {
      // Invalidate email queries - include all folders since we're sending new message
      invalidateEmailQueries({ includeFolders: true });
      // Track challenge completion
      track('inbox_send_email');
      setShowCompose(false);
      resetCompose();
      toast({ description: 'Message sent successfully' });
      logger.log('[Send] Message sent, invalidated email queries');
    },
    onError: (error) => {
      logger.error('Send email error:', error);
      toast({
        description: 'Failed to send message',
        variant: 'destructive',
      });
    },
  });

  // Reply mutation - email reply with threading support
  const replyMutation = useMutation({
    mutationFn: async (replyData: any) => {
      if (!selectedMessage) {
        throw new Error('No message selected for reply');
      }

      // Create reply email with reference to parent message for threading
      const replyEmailData = {
        recipientId: selectedMessage.senderId,
        recipientName: selectedMessage.senderName,
        recipientEmail: selectedMessage.senderEmail,
        subject: selectedMessage.subject?.startsWith('Re: ')
          ? selectedMessage.subject
          : `Re: ${selectedMessage.subject || 'No Subject'}`,
        content: replyData.content,
        isDraft: false,
        parentMessageId: selectedMessage.id, // Reference to the message being replied to
      };

      logger.log('Sending reply with parentMessageId:', replyEmailData);
      return await apiRequest('POST', '/api/emails', replyEmailData);
    },
    onSuccess: () => {
      invalidateEmailQueries({ includeFolders: true });
      setShowReply(false);
      setReplyContent('');
      toast({ description: 'Reply sent successfully' });
    },
    onError: (error) => {
      logger.error('Reply error:', error);
      toast({
        description: 'Failed to send reply',
        variant: 'destructive',
      });
    },
  });

  // Mark as read mutation - use email PATCH endpoint
  const markAsReadMutation = useMutation({
    mutationFn: async (messageIds: number[]) => {
      // Mark each message as read using the email PATCH endpoint
      const promises = messageIds.map((id) =>
        apiRequest('PATCH', `/api/emails/${id}`, { isRead: true })
      );
      return await Promise.all(promises);
    },
    onSuccess: () => {
      invalidateEmailQueries();
      toast({ description: 'Marked as read' });
    },
    onError: (error) => {
      logger.error('Mark as read error:', error);
      toast({
        description: 'Failed to mark as read',
        variant: 'destructive',
      });
    },
  });

  // Star/unstar mutation - disabled for conversation messages
  const toggleStarMutation = useMutation({
    mutationFn: async ({
      messageId,
      isStarred,
    }: {
      messageId: number;
      isStarred: boolean;
    }) => {
      logger.log(
        'Star not implemented for conversation messages:',
        messageId,
        isStarred
      );
      return Promise.resolve();
    },
    onSuccess: () => {
      invalidateEmailQueries({ includeUnreadCount: false });
    },
  });

  // Archive mutation - mark messages as archived
  const archiveMutation = useMutation({
    mutationFn: async (messageIds: number[]) => {
      // Mark each message as archived using the email PATCH endpoint
      const promises = messageIds.map((id) =>
        apiRequest('PATCH', `/api/emails/${id}`, { isArchived: true })
      );
      return await Promise.all(promises);
    },
    onSuccess: () => {
      invalidateEmailQueries();
      setSelectedMessages(new Set());
      toast({ description: 'Messages archived successfully' });
    },
    onError: (error) => {
      logger.error('Archive error:', error);
      toast({
        description: 'Failed to archive messages',
        variant: 'destructive',
      });
    },
  });

  // Trash mutation - mark messages as trashed
  const trashMutation = useMutation({
    mutationFn: async (messageIds: number[]) => {
      // Mark each message as trashed using the email PATCH endpoint
      const promises = messageIds.map((id) =>
        apiRequest('PATCH', `/api/emails/${id}`, { isTrashed: true })
      );
      return await Promise.all(promises);
    },
    onSuccess: () => {
      invalidateEmailQueries();
      setSelectedMessages(new Set());
      toast({ description: 'Messages moved to trash' });
    },
    onError: (error) => {
      logger.error('Trash error:', error);
      toast({
        description: 'Failed to move messages to trash',
        variant: 'destructive',
      });
    },
  });

  // Delete permanently mutation - delete the underlying email rows
  const deleteMutation = useMutation({
    mutationFn: async (messageIds: number[]) => {
      // Delete emails one by one (this inbox is backed by /api/emails)
      const deletePromises = messageIds.map((id) =>
        apiRequest('DELETE', `/api/emails/${id}`)
      );
      return Promise.all(deletePromises);
    },
    onSuccess: () => {
      invalidateEmailQueries();
      setSelectedMessages(new Set());
      toast({ description: 'Messages deleted permanently' });
    },
  });

  // Handle file upload for attachments
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
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
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
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

  // Helper functions
  const resetCompose = () => {
    setComposeRecipient('');
    setComposeSubject('');
    setComposeContent('');
    setCurrentDraft(null);
    setAttachments([]); // Clear attachments when resetting
  };

  const handleSelectMessage = (message: Message) => {
    setSelectedMessage(message);

    // Mark as read if not already read
    if (!message.isRead) {
      // Check if this is a kudos message - use kudos-specific endpoint
      if ((message as any).messageType === 'kudos') {
        markKudosAsRead(message.id);
      } else {
        // For regular emails, use the email mark-as-read endpoint
        markAsReadMutation.mutate([message.id]);
      }
    }
  };

  const handleSelectAll = () => {
    if (selectedMessages && messages && selectedMessages.size === messages.length) {
      setSelectedMessages(new Set());
    } else if (messages) {
      setSelectedMessages(new Set(messages.map((m: any) => m.id)));
    }
  };

  const handleToggleSelect = (messageId: number) => {
    const newSelected = new Set(selectedMessages);
    if (newSelected.has(messageId)) {
      newSelected.delete(messageId);
    } else {
      newSelected.add(messageId);
    }
    setSelectedMessages(newSelected);
  };

  const handleSendMessage = () => {
    if (!composeRecipient) {
      toast({
        description: 'Please select a recipient',
        variant: 'destructive',
      });
      return;
    }

    // Allow sending if there's content OR attachments
    if (!composeContent && attachments.length === 0) {
      toast({
        description: 'Please enter a message or attach a file',
        variant: 'destructive',
      });
      return;
    }

    const recipient = users.find((u) => u.id === composeRecipient);

    // Always use conversation format now
    sendMessageMutation.mutate({
      recipientId: composeRecipient,
      recipientName: recipient
        ? `${recipient.firstName} ${recipient.lastName}`.trim()
        : '',
      recipientEmail: recipient?.email || '',
      subject: composeSubject || 'Project Discussion',
      content: composeContent,
      isDraft: false,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  };

  const handleReply = () => {
    if (!selectedMessage || !replyContent.trim()) {
      toast({
        description: 'Please enter a reply message',
        variant: 'destructive',
      });
      return;
    }

    logger.log('Sending reply with data:', {
      content: replyContent,
      sender: null, // Let backend use authenticated user info
      recipientId: selectedMessage.userId,
      conversationName: null, // Reply to existing conversation
      conversationId: selectedMessage.conversationId,
    });

    const replyData = {
      content: replyContent,
      sender: null, // Let backend use authenticated user info
      recipientId: selectedMessage.userId,
      conversationName: null, // Reply to existing conversation
      conversationId: selectedMessage.conversationId,
    };

    replyMutation.mutate(replyData);

    // Clear the reply content after sending
    setReplyContent('');
  };

  // Filter messages based on search
  const filteredMessages = messages.filter((message) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      (message.content?.toLowerCase().includes(query)) ||
      (message.senderName?.toLowerCase().includes(query)) ||
      (message.subject?.toLowerCase().includes(query))
    );
  });
  
  // Debug logging for filtered messages
  if (activeFolder === 'inbox') {
    logger.log(`[Inbox] Total messages: ${messages.length}, Filtered: ${filteredMessages.length}, Search: "${searchQuery}"`);
    if (messages.length > 0 && filteredMessages.length === 0 && searchQuery) {
      logger.log(`[Inbox] Messages filtered out by search query`);
    }
    if (filteredMessages.length > 0) {
      logger.log(`[Inbox] First filtered message:`, {
        id: filteredMessages[0].id,
        senderName: filteredMessages[0].senderName,
        hasContent: !!filteredMessages[0].content,
        messageType: filteredMessages[0].messageType
      });
    }
  }

  // Fetch inbox messages separately for count (to avoid counting from wrong folder)
  const { data: inboxMessagesForCount = [] } = useQuery<any[]>({
    queryKey: [apiBase, 'inbox', 'count'],
    queryFn: async () => {
      if (activeFolder === 'inbox') {
        // If already viewing inbox, use the main messages query
        return messages;
      }
      // Otherwise, fetch inbox messages separately for count
      const [emailsResponse, kudosResponse] = await Promise.all([
        apiRequest('GET', '/api/emails?folder=inbox'),
        apiRequest('GET', '/api/emails/kudos')
      ]);
      const emails = Array.isArray(emailsResponse) ? emailsResponse : emailsResponse.messages || [];
      const kudos = Array.isArray(kudosResponse) ? kudosResponse : [];
      return [...emails, ...kudos];
    },
    enabled: activeFolder !== 'inbox', // Only fetch if not already viewing inbox
  });

  // Get folder counts
  const getUnreadCount = (folder: string) => {
    // For inbox, use the separate count query if available, otherwise use current messages
    const messagesToCount = folder === 'inbox' && activeFolder !== 'inbox' 
      ? inboxMessagesForCount 
      : folder === activeFolder 
        ? messages 
        : [];
    
    return messagesToCount.filter((m) => {
      switch (folder) {
        case 'inbox':
          return !m.isRead; // Count unread messages in inbox
        case 'starred':
          return m.isStarred && !m.isRead;
        case 'archived':
          return false; // No archived functionality yet
        case 'trash':
          return false; // No trash functionality yet
        case 'kudos':
          return false; // Kudos uses separate count system
        default:
          return false;
      }
    }).length;
  };

  const folders = [
    {
      id: 'inbox',
      label: 'Inbox',
      icon: InboxIcon,
      count: getUnreadCount('inbox'),
    },
    {
      id: 'starred',
      label: 'Starred',
      icon: Star,
      count: getUnreadCount('starred'),
    },
    { id: 'sent', label: 'Sent', icon: Send, count: 0 },
    { id: 'drafts', label: 'Drafts', icon: Edit3, count: drafts.length },
    { id: 'kudos', label: 'Kudos', icon: Heart, count: getUnreadCount('kudos') },
    {
      id: 'archived',
      label: 'Archived',
      icon: Archive,
      count: getUnreadCount('archived'),
    },
    {
      id: 'trash',
      label: 'Trash',
      icon: Trash2,
      count: getUnreadCount('trash'),
    },
  ];

  logger.log('🎨 About to render GmailStyleInbox main UI');
  logger.log('📊 Component state:', {
    activeFolder,
    selectedMessage: !!selectedMessage,
    messageCount: messages.length,
    messages: messages.slice(0, 3), // Log first 3 messages for debugging
  });

  // Mark a kudos as read via the messaging service endpoint
  const markKudosAsRead = async (kudoId: number) => {
    try {
      logger.log(`[markKudosAsRead] Marking kudos ${kudoId} as read`);
      // Use the POST /:messageId/read route which properly handles kudos via messagingService
      const response = await apiRequest('POST', `/api/emails/${kudoId}/read`);
      logger.log(`[markKudosAsRead] Server response:`, response);

      // Invalidate all kudos-related queries and wait for them to complete
      logger.log(`[markKudosAsRead] Invalidating queries...`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/emails/kudos'] }),
        queryClient.invalidateQueries({ queryKey: [apiBase, activeFolder] }),
        queryClient.invalidateQueries({ queryKey: [apiBase, 'inbox'] }),
      ]);
      logger.log(`[markKudosAsRead] Queries invalidated`);
    } catch (error) {
      logger.error('[markKudosAsRead] Failed to mark kudos as read', error);
    }
  };

  return (
    <div className="flex h-full bg-white relative min-w-0 max-w-full overflow-hidden">
      {/* Mobile/Tablet Overlay for Sidebar - when sidebar is open as overlay */}
      {!isSidebarCollapsed &&
        (screenSize === 'mobile' || screenSize === 'small-tablet') && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setIsSidebarCollapsed(true)}
          />
        )}

      {/* Sidebar - Folders (Inbox, Drafts, etc.) - Only show if not collapsed OR if we're not on mobile */}
      <div
        className={`
        ${
          isSidebarCollapsed &&
          (screenSize === 'mobile' || screenSize === 'small-tablet')
            ? 'hidden'
            : 'flex'
        } 
        ${
          screenSize === 'large-tablet'
            ? 'w-48'
            : screenSize === 'desktop'
              ? 'w-56'
              : 'w-64'
        } 
        border-r bg-white flex-col flex-shrink-0
        transition-all duration-300 ease-in-out
        ${
          (screenSize === 'mobile' || screenSize === 'small-tablet') &&
          !isSidebarCollapsed
            ? 'fixed left-0 top-0 h-full w-64 z-50'
            : 'relative'
        }
      `}
      >
        <div className="p-4">
          <div
            className={`flex items-center justify-between mb-4 ${
              screenSize === 'desktop' ? 'hidden' : 'flex'
            }`}
          >
            <span className="text-sm font-medium text-gray-700">
              Navigation
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSidebarCollapsed(true)}
              className="h-6 w-6 p-1"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ButtonTooltip explanation="Write a new message to send to team members. You can choose who to send it to and what it's about.">
            <Button
              data-tour="compose-button"
              onClick={() => setShowCompose(true)}
              className="w-full gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-['Roboto'] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
            >
              <Plus className="h-4 w-4" />
              Compose
            </Button>
          </ButtonTooltip>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-2" data-tour="inbox-folders">
            {folders.map((folder) => (
              <button
                key={folder.id}
                data-tour={folder.id === 'kudos' ? 'folder-kudos' : undefined}
                onClick={() => {
                  setActiveFolder(folder.id);
                  // On mobile, collapse sidebar when selecting a folder to show content
                  if (screenSize === 'mobile') {
                    setIsSidebarCollapsed(true);
                  }
                }}
                className={`
                  w-full flex items-center justify-between px-3 py-2 mb-1 rounded-lg text-left transition-colors font-['Roboto']
                  ${
                    activeFolder === folder.id
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-md'
                      : 'hover:bg-amber-50 hover:border-amber-200 text-gray-700'
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  <folder.icon className="h-4 w-4" />
                  <span className="font-medium">{folder.label}</span>
                </div>
                {folder.count > 0 && (
                  <Badge
                    variant="secondary"
                    className={`
                      h-5 px-2 text-xs
                      ${
                        activeFolder === folder.id
                          ? 'bg-white/20 text-white'
                          : 'bg-gray-200 text-gray-800'
                      }
                    `}
                  >
                    {folder.count}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Content Area - Message List + Details + Kudos */}
      <div className="flex-1 flex bg-white min-w-0 overflow-hidden">
        {/* Message List Panel - Simplified for mobile */}
        <div
          className="flex-1 flex-col bg-white min-w-0 overflow-hidden border-r"
          style={{ display: 'flex' }}
        >
          {/* "What's this?" explainer — Project Threads vs Team Chat is
              the #1 source of confusion for new users. Pinning a one-line
              clarifier above the toolbar so it's visible on every folder
              eliminates that confusion before it starts. */}
          <div className="border-b bg-blue-50/60 px-4 py-2 text-xs sm:text-sm text-slate-700 flex items-start gap-2">
            <InboxIcon className="w-4 h-4 mt-0.5 text-blue-700 flex-shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold text-blue-900">
                Project Threads
              </span>{' '}
              are for longer email-style conversations — use this when a topic
              needs a thread history.{' '}
              <a
                href="/dashboard?section=chat"
                className="text-blue-700 font-medium hover:underline whitespace-nowrap"
              >
                💬 Chat instead
              </a>
            </span>
          </div>
          {/* Toolbar */}
          <div className="border-b p-4 space-y-3 bg-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* Sidebar toggle button - visible when sidebar is collapsed */}
                {isSidebarCollapsed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsSidebarCollapsed(false)}
                    title="Show folders"
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                )}
                {/* Close message list button - only on mobile when message is selected */}
                {screenSize === 'mobile' && selectedMessage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMessageListCollapsed(true)}
                    title="Hide message list"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <h2 className="text-lg font-semibold capitalize">
                  {activeFolder}
                </h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchMessages()}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white border-gray-300 text-gray-900 placeholder-gray-500"
              />
            </div>

            {/* Bulk Actions */}
            {selectedMessages.size > 0 && (
              <div className="flex flex-wrap items-center gap-1 lg:gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAll}
                  className="text-xs lg:text-sm px-2 lg:px-3"
                >
                  {selectedMessages.size === messages.length
                    ? 'Deselect'
                    : 'Select All'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    logger.log(
                      'Mark Read not implemented for conversation messages'
                    )
                  }
                  className="text-xs lg:text-sm px-2 lg:px-3"
                >
                  Mark Read
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedMessages.size > 0) {
                      archiveMutation.mutate(Array.from(selectedMessages));
                    }
                  }}
                  disabled={
                    selectedMessages.size === 0 || archiveMutation.isPending
                  }
                  className="text-xs lg:text-sm px-2 lg:px-3"
                >
                  Archive
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedMessages.size > 0) {
                      trashMutation.mutate(Array.from(selectedMessages));
                    }
                  }}
                  disabled={
                    selectedMessages.size === 0 || trashMutation.isPending
                  }
                  className="text-xs lg:text-sm px-2 lg:px-3"
                >
                  Trash
                </Button>
              </div>
            )}
          </div>

          {/* Message List - Show KudosInbox for kudos folder */}
          {activeFolder === 'kudos' ? (
            <div className="flex-1 p-4">
              <KudosInbox />
            </div>
          ) : (
            <ScrollArea className="flex-1 h-full">
              {isLoadingMessages ? (
                <div className="flex items-center justify-center p-8">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading messages...</p>
                  </div>
                </div>
              ) : (
              <div className="divide-y">
                {filteredMessages.length > 0 && logger.log(`[Render] Rendering ${filteredMessages.length} messages`)}
                {filteredMessages.map((message, index) => {
                  if (index === 0) {
                    logger.log(`[Render] First message details:`, {
                      id: message.id,
                      hasId: !!message.id,
                      senderName: message.senderName,
                      content: message.content?.substring(0, 30),
                      messageType: message.messageType
                    });
                  }
                  const isKudos = message.messageType === 'kudos';
                  
                  if (!message.id) {
                    logger.warn(`[Render] Message missing id:`, message);
                  }
                  
                  return (
                    <div
                      key={message.id || `msg-${Math.random()}`}
                      onClick={() => handleSelectMessage(message)}
                      className={`
                        p-3 lg:p-5 cursor-pointer transition-all duration-200 font-['Roboto'] border-b
                        ${
                          isKudos
                            ? 'bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200 hover:from-yellow-100 hover:to-orange-100 hover:border-yellow-300 shadow-md border-l-4 border-l-yellow-400'
                            : selectedMessage?.id === message.id
                            ? 'bg-amber-100 border-r-4 border-amber-500 shadow-sm'
                            : !message.isRead
                            ? 'bg-brand-primary-lighter font-bold border-l-4 border-blue-500'
                            : 'bg-white font-normal border-gray-200'
                        } hover:bg-amber-50
                        ${isKudos && !message.isRead ? 'animate-pulse' : ''}
                      `}
                      style={{ 
                        minHeight: '80px',
                        display: 'block',
                        visibility: 'visible'
                      }}
                    >
                      <div className="flex items-start gap-2 lg:gap-3">
                        <input
                          type="checkbox"
                          checked={selectedMessages.has(message.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleSelect(message.id);
                          }}
                          className="mt-1 h-4 w-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary-muted"
                        />
                        
                        {/* Kudos trophy icon or regular star */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            logger.log('Star clicked for message', message.id);
                          }}
                          className="mt-1"
                        >
                          {isKudos ? (
                            <div className={`p-1 rounded-full ${
                              !message.isRead ? 'bg-yellow-100' : 'bg-yellow-50'
                            }`}>
                              <Trophy className={`h-4 w-4 ${
                                !message.isRead ? 'text-yellow-600' : 'text-yellow-500'
                              }`} />
                            </div>
                          ) : (
                            <Star className="h-4 w-4 text-gray-300" />
                          )}
                        </button>
                        
                        <Avatar className={`h-7 w-7 lg:h-8 lg:w-8 flex-shrink-0 ${
                          isKudos ? 'ring-2 ring-yellow-200' : ''
                        }`}>
                          <AvatarFallback className={`text-xs ${
                            isKudos ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-200 text-gray-800'
                          }`}>
                            {activeFolder === 'sent'
                              ? (message.recipientName || 'U')
                                  ?.split(' ')
                                  .map((n: string) => n[0])
                                  .join('')
                                  .toUpperCase() || 'U'
                              : (message.senderName || 'U')
                                  ?.split(' ')
                                  .map((n: string) => n[0])
                                  .join('')
                                  .toUpperCase() || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="flex items-start justify-between mb-2 gap-2">
                            <div className="flex items-center gap-2 flex-1">
                              <p
                                className={`text-sm break-words ${
                                  isKudos
                                    ? 'font-bold text-yellow-800'
                                    : !message.isRead
                                    ? 'font-bold text-gray-900'
                                    : 'font-medium text-gray-700'
                                }`}
                              >
                                {isKudos && '🏆 '}
                                {activeFolder === 'sent'
                                  ? message.recipientName || 'Unknown'
                                  : message.senderName || 'Unknown'}
                              </p>
                              {isKudos && (
                                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs px-2 py-0.5 ml-2">
                                  Kudos
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {/* Read indicator for sent messages */}
                              {activeFolder === 'sent' && (
                                <InboxReadIndicator
                                  isRead={message.isRead || false}
                                  readAt={message.readAt}
                                  readerName={message.recipientName}
                                />
                              )}
                              <span className={`text-xs whitespace-nowrap ${
                                isKudos ? 'text-yellow-600 font-medium' : 'text-gray-500'
                              }`}>
                                {(() => {
                                  try {
                                    return message.createdAt
                                      ? formatDistanceToNow(
                                          new Date(message.createdAt),
                                          { addSuffix: true }
                                        )
                                      : 'No date';
                                  } catch (error) {
                                    return 'Invalid date';
                                  }
                                })()}
                              </span>
                            </div>
                          </div>
                          
                          {/* Subject — primary inbox navigation affordance */}
                          {isKudos && message.subject && (
                            <p className="text-sm font-semibold text-yellow-700 mb-1 truncate">
                              🎉 {message.subject}
                            </p>
                          )}
                          {!isKudos && (
                            <p
                              className={`text-sm truncate mb-1 ${
                                !message.isRead
                                  ? 'font-semibold text-gray-900'
                                  : 'font-medium text-gray-800'
                              }`}
                            >
                              {message.subject?.trim() || '(No subject)'}
                            </p>
                          )}
                          
                          <p
                            className={`text-sm leading-relaxed truncate ${
                              isKudos
                                ? 'font-medium text-gray-700'
                                : !message.isRead
                                ? 'font-bold text-gray-900'
                                : 'font-normal text-gray-600'
                            }`}
                          >
                            {message.content?.trim() || '(No preview)'}
                          </p>

                          {/* Show attachment indicator */}
                          {message.attachments && message.attachments.length > 0 && (
                            <div className="flex items-center gap-1 mt-1">
                              <Paperclip className="h-3 w-3 text-gray-400" />
                              <span className="text-xs text-gray-500">
                                {message.attachments.length} attachment{message.attachments.length > 1 ? 's' : ''}
                              </span>
                            </div>
                          )}

                          {/* Show context for kudos */}
                          {isKudos && message.entityName && (
                            <div className="mt-2">
                              <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300">
                                {message.contextType === 'task' ? '📋 Task' : '📁 Project'}: {message.entityName}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredMessages.length === 0 && !isLoadingMessages && (
                  <div className="p-8 text-center text-gray-500">
                    {searchQuery
                      ? 'No messages found matching your search'
                      : `No ${activeFolder} messages`}
                    {activeFolder === 'inbox' && messages.length > 0 && (
                      <p className="text-xs text-gray-400 mt-2">
                        (Note: Inbox shows messages sent TO you, not messages you sent)
                      </p>
                    )}
                    {activeFolder === 'inbox' && messages.length === 0 && (
                      <p className="text-xs text-gray-400 mt-2">
                        Your inbox is empty. Messages sent to you will appear here.
                      </p>
                    )}
                  </div>
                )}
              </div>
              )}
            </ScrollArea>
          )}
        </div>

        {/* Message Detail Panel */}
        <div
          className={`
          ${selectedMessage ? 'flex-1 min-w-0 max-w-none' : ''} 
          ${!selectedMessage && screenSize === 'desktop' ? 'flex flex-1' : ''}
          ${!selectedMessage && screenSize !== 'desktop' ? 'hidden' : ''}
          ${selectedMessage ? 'flex' : ''}
          flex-col bg-white overflow-hidden
        `}
        >
          {selectedMessage ? (
            <>
              {/* Message Header */}
              <div className="border-b p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {/* Show message list toggle button when collapsed */}
                    {isMessageListCollapsed && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsMessageListCollapsed(false)}
                        title="Show message list"
                      >
                        <Menu className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="md:hidden"
                      onClick={() => setSelectedMessage(null)}
                    >
                      ← Back
                    </Button>
                    <h3 className="text-lg font-semibold">
                      {(selectedMessage as any).isKudos ? (
                        <span className="flex items-center gap-2">
                          <Trophy className="h-5 w-5 text-yellow-600" />
                          {selectedMessage.subject || 'Kudos Message'}
                        </span>
                      ) : selectedMessage.content.length > 40 ? (
                        `${selectedMessage.content.substring(0, 40)}...`
                      ) : (
                        selectedMessage.content
                      )}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Quick scroll to reply for non-Kudos messages */}
                    {!(selectedMessage as any).isKudos && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const replySection =
                            document.querySelector('.reply-section');
                          replySection?.scrollIntoView({ behavior: 'smooth' });
                          // Focus the textarea after a short delay to allow for scrolling
                          setTimeout(() => {
                            const textarea = document.querySelector(
                              '.reply-section textarea'
                            ) as HTMLTextAreaElement;
                            textarea?.focus();
                          }, 300);
                        }}
                        className="bg-brand-primary-lighter border-brand-primary-border text-brand-primary hover:bg-brand-primary-light hover:border-brand-primary-border-strong px-3 py-2 font-medium"
                      >
                        <Reply className="h-4 w-4 mr-2" />
                        Reply to Message
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        logger.log(
                          'Star clicked for message',
                          selectedMessage.id
                        )
                      }
                    >
                      <Star className="h-4 w-4 text-gray-300" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (selectedMessage) {
                          archiveMutation.mutate([selectedMessage.id]);
                          setSelectedMessage(null);
                        }
                      }}
                      disabled={archiveMutation.isPending}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (selectedMessage) {
                          trashMutation.mutate([selectedMessage.id]);
                          setSelectedMessage(null);
                        }
                      }}
                      disabled={trashMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-gray-200 text-gray-800">
                      {selectedMessage.senderName
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">
                      From: {selectedMessage.senderName}
                    </p>
                    <p className="text-sm text-gray-600">
                      {selectedMessage.senderEmail}
                    </p>
                  </div>
                  <div className="ml-auto text-sm text-gray-500">
                    {(() => {
                      try {
                        return selectedMessage.createdAt
                          ? new Date(selectedMessage.createdAt).toLocaleString()
                          : 'No date';
                      } catch (error) {
                        return 'Invalid date';
                      }
                    })()}
                  </div>
                </div>
              </div>

              {/* Message Content - Scrollable area for all messages */}
              <ScrollArea className="flex-1">
                <div className="p-4">
                  <div className="prose max-w-none">
                    {/* Special formatting for Kudos messages */}
                    {(selectedMessage as any).isKudos ? (
                      <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-6 mb-4">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="bg-yellow-100 p-2 rounded-full">
                            <Trophy className="h-6 w-6 text-yellow-600" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-yellow-800">
                              Kudos Received!
                            </h3>
                            <p className="text-sm text-yellow-700">
                              From {selectedMessage.senderName}
                              {(selectedMessage as any).projectTitle && (
                                <span className="ml-1">
                                  for "{(selectedMessage as any).projectTitle}"
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="bg-white border border-yellow-300 rounded-lg p-4">
                          <div className="text-lg text-gray-800 font-medium leading-relaxed">
                            {selectedMessage.content}
                          </div>
                        </div>
                        {(selectedMessage as any).contextType && (
                          <div className="mt-4">
                            <MessageContextBadge
                              contextType={(selectedMessage as any).contextType}
                              contextId={(selectedMessage as any).contextId}
                              contextTitle={
                                (selectedMessage as any).contextTitle ||
                                (selectedMessage as any).entityName ||
                                (selectedMessage as any).projectTitle
                              }
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Full Thread View - Show all messages in conversation */}
                        {threadMessages.length > 1 ? (
                          <div className="space-y-4">
                            {/* Thread header */}
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 pb-2 border-b border-gray-200">
                              <MessageSquare className="h-4 w-4" />
                              <span>Conversation Thread ({threadMessages.length} messages)</span>
                            </div>

                            {/* All messages in thread */}
                            {threadMessages.map((threadMsg, index) => {
                              const isCurrentMessage = threadMsg.id === selectedMessage.id;
                              const isLatestMessage = index === threadMessages.length - 1;

                              return (
                                <div
                                  key={threadMsg.id}
                                  className={`p-4 rounded-lg border ${
                                    isCurrentMessage
                                      ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200'
                                      : 'bg-gray-50 border-gray-200'
                                  }`}
                                >
                                  <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <Avatar className="h-7 w-7">
                                        <AvatarFallback className={`text-xs ${isCurrentMessage ? 'bg-amber-200 text-amber-800' : 'bg-gray-200 text-gray-600'}`}>
                                          {threadMsg.senderName
                                            ?.split(' ')
                                            .map((n: string) => n[0])
                                            .join('')
                                            .toUpperCase() || 'U'}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div>
                                        <span className={`text-sm font-semibold ${isCurrentMessage ? 'text-amber-900' : 'text-gray-800'}`}>
                                          {threadMsg.senderName}
                                        </span>
                                        {isCurrentMessage && (
                                          <Badge className="ml-2 text-xs bg-amber-100 text-amber-700 border-amber-300">
                                            Current
                                          </Badge>
                                        )}
                                        {index === 0 && (
                                          <Badge variant="outline" className="ml-2 text-xs text-gray-500">
                                            Original
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    <span className="text-xs text-gray-500">
                                      {(() => {
                                        try {
                                          return threadMsg.createdAt
                                            ? formatDistanceToNow(new Date(threadMsg.createdAt), { addSuffix: true })
                                            : '';
                                        } catch {
                                          return '';
                                        }
                                      })()}
                                    </span>
                                  </div>
                                  <div className={`text-sm whitespace-pre-wrap ${isCurrentMessage ? 'text-gray-900' : 'text-gray-700'}`}>
                                    {threadMsg.content}
                                  </div>

                                  {/* Show attachments for each message */}
                                  {threadMsg.attachments && threadMsg.attachments.length > 0 && (
                                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                                      <Paperclip className="h-3 w-3" />
                                      <span>{threadMsg.attachments.length} attachment{threadMsg.attachments.length > 1 ? 's' : ''}</span>
                                    </div>
                                  )}

                                  {/* Show read status */}
                                  {(threadMsg as any).isRead && (threadMsg as any).readAt && (
                                    <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
                                      <Eye className="h-3 w-3" />
                                      <span>
                                        Read {(() => {
                                          try {
                                            return formatDistanceToNow(new Date((threadMsg as any).readAt), { addSuffix: true });
                                          } catch {
                                            return '';
                                          }
                                        })()}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          /* Single message view (no thread or only one message) */
                          <div className="whitespace-pre-wrap">
                            {selectedMessage.content}
                          </div>
                        )}

                        {/* Display attachments for current message if present */}
                        {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="flex items-center gap-2 mb-3">
                              <Paperclip className="h-4 w-4 text-gray-500" />
                              <span className="text-sm font-medium text-gray-700">
                                Attachments ({selectedMessage.attachments.length})
                              </span>
                            </div>
                            <div className="space-y-2">
                              {selectedMessage.attachments.map((attachment, index) => {
                                const FileIcon = getFileIcon(attachment.type);
                                return (
                                  <a
                                    key={index}
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-colors"
                                  >
                                    <FileIcon className="h-5 w-5 text-gray-500 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-gray-800 truncate">{attachment.name}</p>
                                      <p className="text-xs text-gray-500">{formatFileSize(attachment.size)}</p>
                                    </div>
                                    <span className="text-xs text-amber-600 font-medium">Download</span>
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {selectedMessage.contextType && selectedMessage.contextId && (
                          <MessageContextBadge
                            contextType={selectedMessage.contextType}
                            contextId={selectedMessage.contextId}
                            contextTitle={
                              selectedMessage.contextTitle ||
                              (selectedMessage as any).entityName
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>

              {/* Gmail-Style Reply Section - Always visible for non-Kudos messages */}
              {!(selectedMessage as any).isKudos && (
                <div className="reply-section border-t p-6 flex-shrink-0 bg-gray-50">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Reply className="h-4 w-4" />
                      <span>Reply to {selectedMessage.senderName}</span>
                    </div>
                    <Textarea
                      placeholder="Type your reply here..."
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          e.preventDefault();
                          if (replyContent.trim()) {
                            handleReply();
                          }
                        }
                      }}
                      rows={6}
                      className="w-full bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary-muted focus:border-blue-500 text-gray-900 resize-none"
                      style={{
                        minHeight: '150px',
                        fontSize: '14px',
                        lineHeight: '1.5',
                      }}
                    />
                    <div className="flex justify-between items-center">
                      <div className="text-xs text-gray-500">
                        Press Ctrl+Enter to send quickly
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReplyContent('')}
                          disabled={!replyContent.trim()}
                        >
                          Clear
                        </Button>
                        <Button
                          onClick={handleReply}
                          disabled={
                            replyMutation.isPending || !replyContent.trim()
                          }
                          className="bg-brand-primary hover:bg-brand-primary-dark text-white px-6"
                        >
                          {replyMutation.isPending ? (
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                              Sending...
                            </div>
                          ) : (
                            <>
                              <Send className="h-4 w-4 mr-2" />
                              Send Reply
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center space-y-4">
                <InboxIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-lg">Select a message to read</p>

                {/* Show toggle buttons for collapsed panels */}
                <div className="flex justify-center gap-3 mt-6">
                  {isSidebarCollapsed && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsSidebarCollapsed(false)}
                      className="flex items-center gap-2"
                    >
                      <Menu className="h-4 w-4" />
                      Show Folders
                    </Button>
                  )}
                  {isMessageListCollapsed && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsMessageListCollapsed(false)}
                      className="flex items-center gap-2"
                    >
                      <Menu className="h-4 w-4" />
                      Show Messages
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compose Dialog - Subtle TSP Branding */}
      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <DialogContent className="w-[95vw] max-w-2xl p-4 sm:p-6 bg-white border border-gray-200 rounded-xl shadow-xl">
          <DialogHeader className="pb-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-1 h-8 bg-gradient-to-b from-amber-400 to-amber-500 rounded-full"></div>
              <div>
                <DialogTitle className="text-xl font-bold text-gray-800 font-['Roboto']">
                  New Message
                </DialogTitle>
                <DialogDescription className="text-gray-600 font-['Roboto']">
                  Send a message to your team member
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 py-6">
            <div className="space-y-2">
              <Label
                htmlFor="recipient"
                className="text-sm font-semibold text-gray-700 font-['Roboto']"
              >
                To
              </Label>
              <Select
                value={composeRecipient}
                onValueChange={setComposeRecipient}
              >
                <SelectTrigger 
                  className="rounded-lg border border-gray-300 bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200 h-11 transition-colors cursor-pointer"
                >
                  <SelectValue placeholder={isLoadingUsers ? "Loading users..." : "Choose team member..."} />
                </SelectTrigger>
                <SelectContent 
                  className="rounded-lg border border-gray-200 bg-white shadow-lg"
                  style={{ zIndex: 100000 }}
                  position="popper"
                  sideOffset={8}
                >
                  {isLoadingUsers ? (
                    <SelectItem value="loading" disabled>
                      Loading users...
                    </SelectItem>
                  ) : usersError ? (
                    <SelectItem value="error" disabled>
                      Error loading users
                    </SelectItem>
                  ) : users.length === 0 ? (
                    <SelectItem value="no-users" disabled>
                      No users available
                    </SelectItem>
                  ) : (
                    users
                      .filter((u) => u.id !== (user as any)?.id)
                      .sort((a, b) => {
                        const nameA = `${a.firstName || ''} ${a.lastName || ''}`
                          .trim()
                          .toLowerCase() || a.email?.toLowerCase() || '';
                        const nameB = `${b.firstName || ''} ${b.lastName || ''}`
                          .trim()
                          .toLowerCase() || b.email?.toLowerCase() || '';
                        return nameA.localeCompare(nameB);
                      })
                      .map((teamUser) => (
                      <SelectItem
                        key={teamUser.id}
                        value={teamUser.id}
                        className="py-2 px-3 hover:bg-amber-50 focus:bg-amber-50 data-[highlighted]:bg-amber-50"
                        style={{
                          color: '#1f2937',
                          fontWeight: '500',
                          fontSize: '14px',
                        }}
                      >
                        <div
                          className="flex items-center gap-2"
                          style={{ color: '#1f2937' }}
                        >
                          <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
                          <span style={{ color: '#1f2937', fontWeight: '600' }}>
                            {teamUser.firstName} {teamUser.lastName}
                          </span>
                          <span style={{ color: '#6b7280', fontSize: '12px' }}>
                            ({teamUser.email})
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="subject"
                className="text-sm font-semibold text-gray-700 font-['Roboto'] flex items-center gap-2"
              >
                <span className="w-2 h-2 bg-amber-400 rounded-full"></span>
                Project/Task name (optional)
              </Label>
              <Input
                id="subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                placeholder="Budget Review, Website Updates, Event Requests..."
                className="rounded-lg border border-gray-300 bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200 h-11 font-['Roboto'] placeholder:text-gray-500 transition-colors text-gray-900"
                style={{ color: '#1f2937' }}
              />
              <p className="text-xs text-gray-500 font-['Roboto'] italic">
                Leave blank for general conversation
              </p>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="content"
                className="text-sm font-semibold text-gray-700 font-['Roboto']"
              >
                Message
              </Label>
              <Textarea
                id="content"
                value={composeContent}
                onChange={(e) => setComposeContent(e.target.value)}
                placeholder="Type your message here..."
                rows={6}
                className="rounded-lg border border-gray-300 bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200 font-['Roboto'] placeholder:text-gray-500 resize-none transition-colors text-gray-900"
                style={{ color: '#1f2937' }}
              />
            </div>

            {/* Attachments Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-gray-700 font-['Roboto'] flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-gray-500" />
                  Attachments
                  <Badge variant="outline" className="text-xs ml-1">
                    {attachments.length}/5
                  </Badge>
                </Label>
                <div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    multiple
                    accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.mp4,.mov,.avi,.webm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || attachments.length >= 5}
                    className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
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
                </div>
              </div>

              {/* Attached files list */}
              {attachments.length > 0 && (
                <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  {attachments.map((attachment, index) => {
                    const FileIcon = getFileIcon(attachment.type);
                    return (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200"
                      >
                        <FileIcon className="h-4 w-4 text-gray-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{attachment.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(attachment.size)}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAttachment(index)}
                          className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-gray-500 font-['Roboto']">
                Max 100MB per file. Images, videos, PDFs, and documents allowed.
              </p>
            </div>

          </div>

          <DialogFooter className="pt-4 border-t border-gray-100 gap-3">
            <Button
              variant="ghost"
              onClick={() => setShowCompose(false)}
              className="rounded-lg px-6 py-2 text-gray-600 hover:bg-gray-100 font-['Roboto'] font-medium transition-colors"
            >
              Cancel
            </Button>
            <ButtonTooltip explanation="Send your message to the selected recipients. Make sure you've filled in all the required fields.">
              <Button
                onClick={handleSendMessage}
                disabled={sendMessageMutation.isPending}
                className="rounded-lg px-8 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-['Roboto'] font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50"
              >
                {sendMessageMutation.isPending ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Sending...
                  </div>
                ) : (
                  'Send Message'
                )}
              </Button>
            </ButtonTooltip>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
