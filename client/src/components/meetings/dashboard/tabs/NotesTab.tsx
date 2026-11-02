import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { TasksFromNotesTab } from './TasksFromNotesTab';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotes, type NotesFilters, type MeetingNote } from '../hooks/useNotes';
import { formatDateForDisplay } from '@/lib/date-utils';
import {
  Search,
  Plus,
  FileText,
  MessageSquare,
  Calendar,
  User,
  Filter,
  MoreVertical,
  Edit3,
  Archive,
  ArchiveRestore,
  Trash2,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowRight,
  Clock,
  Tag,
  Lightbulb,
  Users,
  AlertCircle,
  ListTodo,
  X,
} from 'lucide-react';
import type { UseMutationResult, QueryClient } from '@tanstack/react-query';
import type { ToastActionElement } from '@/components/ui/toast';

// Import types from hooks
import type { Meeting } from '../hooks/useMeetings';
import type { Project } from '../hooks/useProjects';
import { logger } from '@/lib/logger';

// Toast function type
type ToastFunction = (props: {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  action?: ToastActionElement;
}) => void;

interface NotesTabProps {
  // State
  selectedMeeting: Meeting | null;
  meetings: Meeting[];
  allProjects: Project[];
  
  // Handlers (for agenda integration)
  handleSendToAgenda?: (projectId: number, noteContent?: string) => void;
  
  // Dependencies
  queryClient: QueryClient;
  toast: ToastFunction;
}

export function NotesTab({
  selectedMeeting,
  meetings,
  allProjects,
  handleSendToAgenda,
  queryClient,
  toast,
}: NotesTabProps) {
  // Local state for filters and UI
  const [filters, setFilters] = useState<NotesFilters>({
    type: 'all',
    status: 'active',
  });
  const [viewMode, setViewMode] = useState<'notes' | 'tasks'>('notes'); // Toggle between notes and tasks view
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteIds, setSelectedNoteIds] = useState<number[]>([]);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showConvertToTaskDialog, setShowConvertToTaskDialog] = useState(false);
  const [noteToEdit, setNoteToEdit] = useState<MeetingNote | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<MeetingNote | null>(null);
  const [noteToConvert, setNoteToConvert] = useState<MeetingNote | null>(null);
  
  // Form states
  const [createFormData, setCreateFormData] = useState({
    projectId: '',
    meetingId: selectedMeeting?.id?.toString() || '',
    type: 'discussion' as 'discussion' | 'meeting',
    content: '',
    status: 'active' as 'active' | 'archived',
  });
  const [editFormData, setEditFormData] = useState({
    content: '',
    type: 'discussion' as 'discussion' | 'meeting',
    status: 'active' as 'active' | 'archived',
  });
  const [taskFormData, setTaskFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    dueDate: '',
    deleteNoteAfterConvert: false,
    createMultipleTasks: false,
  });
  const [detectedTaskLines, setDetectedTaskLines] = useState<string[]>([]);
  const [individualTaskSettings, setIndividualTaskSettings] = useState<Array<{
    priority: 'low' | 'medium' | 'high';
    dueDate: string;
  }>>([]);

  // Use the notes hook with current filters
  const {
    notes,
    notesLoading,
    createNoteMutation,
    updateNoteMutation,
    deleteNoteMutation,
    bulkUpdateStatusMutation,
    bulkDeleteMutation,
  } = useNotes({
    ...filters,
    search: searchQuery,
  });

  // Debug logging for notes
  React.useEffect(() => {
    logger.log('[NotesTab] Current filters:', filters);
    logger.log('[NotesTab] Notes received from hook:', notes.length, 'notes');
    if (notes.length > 0) {
      logger.log('[NotesTab] Sample notes (first 3):');
      notes.slice(0, 3).forEach(note => {
        logger.log({
          id: note.id,
          projectId: note.projectId,
          meetingId: note.meetingId,
          type: note.type,
          status: note.status,
          createdAt: note.createdAt
        });
      });
    }
  }, [notes, filters]);

  // Memoized data for performance
  const notesWithProjectInfo = useMemo(() => {
    return notes.map(note => {
      const project = allProjects.find(p => p.id === note.projectId);
      const meeting = meetings.find(m => m.id === note.meetingId);
      return {
        ...note,
        projectTitle: project?.title || 'Unknown Project',
        meetingTitle: meeting?.title || null,
      };
    });
  }, [notes, allProjects, meetings]);

  const filteredNotes = useMemo(() => {
    return notesWithProjectInfo.filter(note => {
      if (!searchQuery) return true;
      const searchLower = searchQuery.toLowerCase();
      return (
        note.content.toLowerCase().includes(searchLower) ||
        note.projectTitle.toLowerCase().includes(searchLower) ||
        note.meetingTitle?.toLowerCase().includes(searchLower) ||
        note.createdByName?.toLowerCase().includes(searchLower)
      );
    });
  }, [notesWithProjectInfo, searchQuery]);

  // Handler functions
  const handleFilterChange = (key: keyof NotesFilters, value: string | number | undefined) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleCreateNote = () => {
    if (!createFormData.projectId || !createFormData.content.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please select a project and enter note content.',
        variant: 'destructive',
      });
      return;
    }

    createNoteMutation.mutate({
      projectId: parseInt(createFormData.projectId),
      meetingId: createFormData.meetingId ? parseInt(createFormData.meetingId) : undefined,
      type: createFormData.type,
      content: createFormData.content.trim(),
      status: createFormData.status,
    }, {
      onSuccess: () => {
        setShowCreateDialog(false);
        setCreateFormData({
          projectId: '',
          meetingId: selectedMeeting?.id?.toString() || '',
          type: 'discussion',
          content: '',
          status: 'active',
        });
      }
    });
  };

  // Extract readable content from structured JSON notes
  const extractReadableContent = (content: string, noteType: 'discussion' | 'meeting'): string => {
    try {
      // Try to parse as JSON for structured notes
      const parsed = JSON.parse(content);
      
      // For structured notes from agenda planning
      if (parsed.projectTitle || parsed.title) {
        // Return the relevant content based on note type
        if (noteType === 'discussion' && parsed.discussionPoints) {
          return parsed.discussionPoints;
        } else if (noteType === 'meeting' && parsed.decisionItems) {
          return parsed.decisionItems;
        }
        
        // Fallback: format key content fields in a readable way
        const parts: string[] = [];
        if (parsed.discussionPoints) {
          parts.push(`Discussion Points:\n${parsed.discussionPoints}`);
        }
        if (parsed.decisionItems) {
          parts.push(`Decision Items:\n${parsed.decisionItems}`);
        }
        if (parsed.content) {
          parts.push(parsed.content);
        }
        
        if (parts.length > 0) {
          return parts.join('\n\n');
        }
      }
      
      // If it's JSON but not our structured format, return as-is
      return content;
    } catch (error) {
      // If it's not JSON, return as plain text
      return content;
    }
  };

  const handleEditNote = (note: MeetingNote) => {
    setNoteToEdit(note);
    // Extract readable content from JSON if applicable
    const readableContent = extractReadableContent(note.content, note.type);
    setEditFormData({
      content: readableContent,
      type: note.type,
      status: note.status,
    });
    setShowEditDialog(true);
  };

  const handleUpdateNote = () => {
    if (!noteToEdit || !editFormData.content.trim()) return;

    // Check if the original note was JSON-structured
    let updatedContent = editFormData.content.trim();
    try {
      const originalParsed = JSON.parse(noteToEdit.content);
      // If original was JSON-structured, reconstruct it with updated content
      if (originalParsed.projectTitle || originalParsed.title) {
        const updatedParsed = { ...originalParsed };
        
        // Update the relevant field based on note type
        if (editFormData.type === 'discussion') {
          updatedParsed.discussionPoints = editFormData.content.trim();
        } else if (editFormData.type === 'meeting') {
          updatedParsed.decisionItems = editFormData.content.trim();
        }
        
        // Reconstruct JSON string
        updatedContent = JSON.stringify(updatedParsed);
      }
    } catch (error) {
      // Original wasn't JSON, use content as-is
      updatedContent = editFormData.content.trim();
    }

    updateNoteMutation.mutate({
      id: noteToEdit.id,
      updates: {
        content: updatedContent,
        type: editFormData.type,
        status: editFormData.status,
      },
    }, {
      onSuccess: () => {
        setShowEditDialog(false);
        setNoteToEdit(null);
      }
    });
  };

  const handleDeleteNote = (note: MeetingNote) => {
    setNoteToDelete(note);
    setShowDeleteDialog(true);
  };

  const confirmDeleteNote = () => {
    if (!noteToDelete) return;

    deleteNoteMutation.mutate(noteToDelete.id, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        setNoteToDelete(null);
        setSelectedNoteIds(prev => prev.filter(id => id !== noteToDelete.id));
      }
    });
  };

  const handleConvertToTask = (note: MeetingNote) => {
    setNoteToConvert(note);

    // Pre-populate form with note content
    const readableContent = extractReadableContent(note.content, note.type);
    const project = allProjects.find(p => p.id === note.projectId);

    // Detect if content has multiple actionable lines (bullet points, numbered lists, or separate lines)
    const lines = readableContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        // Remove bullet points, numbers, checkboxes, etc.
        const cleaned = line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').replace(/^\[[ x]\]\s*/i, '').trim();
        // Keep lines that have substantial content (more than just a few characters)
        return cleaned.length > 3;
      });

    const hasMultipleLines = lines.length > 1;

    setDetectedTaskLines(lines);

    // Initialize individual settings for each task line
    if (hasMultipleLines) {
      setIndividualTaskSettings(lines.map(() => ({
        priority: 'medium' as const,
        dueDate: '',
      })));
    }

    setTaskFormData({
      title: hasMultipleLines ? `Tasks from: ${project?.title || 'Note'}` : `Follow-up: ${project?.title || 'Task from Note'}`,
      description: readableContent,
      priority: 'medium',
      dueDate: '',
      deleteNoteAfterConvert: false,
      createMultipleTasks: hasMultipleLines,
    });

    setShowConvertToTaskDialog(true);
  };

  const confirmConvertToTask = async () => {
    if (!noteToConvert) {
      toast({
        title: 'Missing Information',
        description: 'Note information is missing.',
        variant: 'destructive',
      });
      return;
    }

    // Validate based on mode
    if (taskFormData.createMultipleTasks) {
      if (detectedTaskLines.length === 0) {
        toast({
          title: 'No Tasks Detected',
          description: 'Could not detect any task lines from the note content.',
          variant: 'destructive',
        });
        return;
      }
    } else {
      if (!taskFormData.title.trim()) {
        toast({
          title: 'Missing Information',
          description: 'Please provide a task title.',
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      let createdCount = 0;

      if (taskFormData.createMultipleTasks) {
        // Create multiple tasks - one for each line with individual settings
        const createPromises = detectedTaskLines.map(async (line, index) => {
          const cleanedLine = line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').replace(/^\[[ x]\]\s*/i, '').trim();
          const settings = individualTaskSettings[index] || { priority: 'medium', dueDate: '' };

          const response = await fetch(`/api/projects/${noteToConvert.projectId}/tasks`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: cleanedLine,
              description: `Created from meeting note (line ${index + 1})`,
              priority: settings.priority,
              status: 'pending',
              dueDate: settings.dueDate || undefined,
            }),
            credentials: 'include',
          });

          if (!response.ok) {
            throw new Error(`Failed to create task for line ${index + 1}`);
          }

          return response.json();
        });

        await Promise.all(createPromises);
        createdCount = detectedTaskLines.length;
      } else {
        // Create single task
        const response = await fetch(`/api/projects/${noteToConvert.projectId}/tasks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: taskFormData.title,
            description: taskFormData.description,
            priority: taskFormData.priority,
            status: 'pending',
            dueDate: taskFormData.dueDate || undefined,
          }),
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to create task');
        }

        createdCount = 1;
      }

      // Auto-archive the note after converting to tasks
      // Update note status to 'archived' instead of deleting
      await updateNoteMutation.mutateAsync({
        id: noteToConvert.id,
        updates: {
          status: 'archived',
        },
      });

      toast({
        title: createdCount > 1 ? 'Tasks Created & Note Archived' : 'Task Created & Note Archived',
        description: `Successfully created ${createdCount} task${createdCount > 1 ? 's' : ''} from meeting note. The note has been archived.`,
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/from-meeting-notes'] });

      // Close dialog and reset
      setShowConvertToTaskDialog(false);
      setNoteToConvert(null);
      setDetectedTaskLines([]);
      setIndividualTaskSettings([]);
      setTaskFormData({
        title: '',
        description: '',
        priority: 'medium',
        dueDate: '',
        deleteNoteAfterConvert: false,
        createMultipleTasks: false,
      });
    } catch (error) {
      logger.error('Failed to convert note to task:', error);
      toast({
        title: 'Conversion Failed',
        description: error instanceof Error ? error.message : 'Failed to convert note to task',
        variant: 'destructive',
      });
    }
  };

  const handleBulkStatusChange = (status: 'active' | 'archived') => {
    if (selectedNoteIds.length === 0) return;

    bulkUpdateStatusMutation.mutate({
      noteIds: selectedNoteIds,
      status,
    }, {
      onSuccess: () => {
        setSelectedNoteIds([]);
      }
    });
  };

  const handleBulkDelete = () => {
    if (selectedNoteIds.length === 0) return;

    bulkDeleteMutation.mutate(selectedNoteIds, {
      onSuccess: () => {
        setSelectedNoteIds([]);
      }
    });
  };

  const handleSelectNote = (noteId: number, checked: boolean) => {
    setSelectedNoteIds(prev => {
      if (checked) {
        return [...prev, noteId];
      } else {
        return prev.filter(id => id !== noteId);
      }
    });
  };

  const handleSelectAllNotes = (checked: boolean) => {
    if (checked) {
      setSelectedNoteIds(filteredNotes.map(note => note.id));
    } else {
      setSelectedNoteIds([]);
    }
  };

  const toggleNoteExpanded = (noteId: number) => {
    setExpandedNotes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(noteId)) {
        newSet.delete(noteId);
      } else {
        newSet.add(noteId);
      }
      return newSet;
    });
  };

  const handleUseInAgenda = (note: MeetingNote) => {
    if (!handleSendToAgenda) return;
    
    // Check if the project still exists (hasn't been archived or deleted)
    const projectExists = allProjects.some(p => p.id === note.projectId);
    
    if (!projectExists) {
      toast({
        title: 'Project Not Found',
        description: `The project "${note.projectTitle || 'Unknown'}" has been archived or deleted and cannot be added to the agenda.`,
        variant: 'destructive',
      });
      return;
    }
    
    // Pass both projectId and note content so the discussion/decision points
    // from past meetings are copied into the project's agenda fields
    handleSendToAgenda(note.projectId, note.content);
    toast({
      title: 'Added to Agenda',
      description: `Note for "${note.projectTitle}" has been added to agenda planning with past discussion content.`,
    });
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'discussion':
        return 'bg-brand-primary-light text-brand-primary-dark border-brand-primary-border-strong';
      case 'meeting':
        return 'bg-[#47B3CB]/20 text-[#236383] border-[#236383]/40';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusColor = (status: string) => {
    return status === 'active' 
      ? 'bg-[#47B3CB]/10 text-[#236383] border-[#236383]/30'
      : 'bg-gray-50 text-gray-600 border-gray-200';
  };

  const truncateText = (text: string, maxLength: number = 200) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  // Parse and render structured note content
  const renderNoteContent = (note: MeetingNote) => {
    try {
      // Try to parse as JSON for structured notes
      const parsed = JSON.parse(note.content);

      // Check if it's a structured note from agenda planning
      if (parsed.projectTitle || parsed.title) {
        return (
          <div className="space-y-3">
            {/* Tabled Project - Show reason */}
            {parsed.status === 'tabled' && parsed.reason && (
              <div className="bg-orange-50 border-l-4 border-orange-400 p-4 rounded-r-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-600 mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-orange-800 mb-1">Project Tabled</p>
                    <p className="text-gray-900 leading-relaxed">{parsed.reason}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Main Content - Discussion Points and Decision Items */}
            {parsed.discussionPoints && (
              <div className="bg-[#47B3CB]/10 border-l-4 border-[#47B3CB] p-4 rounded-r-lg">
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-4 h-4 text-[#47B3CB] mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#236383] mb-1">📝 Pre-Meeting Discussion Points</p>
                    <p className="text-gray-700 whitespace-pre-wrap leading-relaxed italic">{parsed.discussionPoints}</p>
                  </div>
                </div>
              </div>
            )}
            
            {parsed.decisionItems && (
              <div className="bg-[#A31C41]/10 border-l-4 border-[#A31C41] p-4 rounded-r-lg">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#A31C41] mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#A31C41] mb-1">✅ Post-Meeting Outcome</p>
                    <p className="text-gray-900 whitespace-pre-wrap leading-relaxed font-medium">{parsed.decisionItems}</p>
                  </div>
                </div>
              </div>
            )}
            
            {/* Project metadata - smaller, less prominent */}
            {(parsed.priority || parsed.assignee || (parsed.status === 'tabled' && !parsed.reason)) && (
              <div className="text-xs text-gray-500 flex flex-wrap gap-3 pt-2 border-t border-gray-200">
                {parsed.priority && (
                  <span className="bg-gray-100 px-2 py-1 rounded">
                    Priority: {parsed.priority}
                  </span>
                )}
                {parsed.assignee && (
                  <span className="bg-gray-100 px-2 py-1 rounded">
                    Assigned: {parsed.assignee}
                  </span>
                )}
                {parsed.status === 'tabled' && !parsed.reason && (
                  <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded">
                    Tabled
                  </span>
                )}
              </div>
            )}

            {/* Off-Agenda Content */}
            {parsed.type === 'off-agenda' && parsed.content && (
              <div className="bg-purple-50 border-l-4 border-purple-400 p-4 rounded-r-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-purple-600 mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-purple-800 mb-1">Off-Agenda Content</p>
                    <p className="text-gray-900 whitespace-pre-wrap leading-relaxed">{parsed.content}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }

      // If it's not our structured format, return the parsed content as-is
      return <p className="text-gray-900 whitespace-pre-wrap">{note.content}</p>;
    } catch (error) {
      // If it's not JSON, render as plain text
      logger.warn('[NotesTab] Failed to parse note content as JSON:', {
        noteId: note.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        contentPreview: note.content.substring(0, 100),
      });
      return (
        <div className="text-gray-900 leading-relaxed whitespace-pre-wrap">
          {expandedNotes.has(note.id)
            ? note.content
            : truncateText(note.content)
          }
        </div>
      );
    }
  };

  if (notesLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-4">
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        {[...Array(5)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-20" />
                </div>
                <Skeleton className="h-16 w-full" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-24" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Search and Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-notes-search"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle between Notes and Tasks view */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <Button
              variant={viewMode === 'notes' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('notes')}
              className={viewMode === 'notes' ? 'bg-white shadow-sm' : ''}
            >
              <FileText className="w-4 h-4 mr-1" />
              Notes
            </Button>
            <Button
              variant={viewMode === 'tasks' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('tasks')}
              className={viewMode === 'tasks' ? 'bg-white shadow-sm' : ''}
            >
              <ListTodo className="w-4 h-4 mr-1" />
              Tasks
            </Button>
          </div>

          <Button
            onClick={() => setShowCreateDialog(true)}
            className="bg-teal-600 hover:bg-teal-700 text-white"
            data-testid="button-create-note"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Note
          </Button>
        </div>
      </div>

      {/* Conditional rendering based on view mode */}
      {viewMode === 'tasks' ? (
        <TasksFromNotesTab
          allProjects={allProjects}
          handleSendToAgenda={handleSendToAgenda}
          queryClient={queryClient}
          toast={toast}
        />
      ) : (
        <>
          {/* Filters Row */}
          <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="project-filter" className="text-sm font-medium">
            Project:
          </Label>
          <Select
            value={filters.projectId ? filters.projectId.toString() : 'all'}
            onValueChange={(value) => handleFilterChange('projectId', value === 'all' ? undefined : parseInt(value))}
          >
            <SelectTrigger className="w-48" data-testid="select-project-filter">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {allProjects.map(project => (
                <SelectItem key={project.id} value={project.id.toString()}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="type-filter" className="text-sm font-medium">
            Type:
          </Label>
          <Select
            value={filters.type || 'all'}
            onValueChange={(value) => handleFilterChange('type', value)}
          >
            <SelectTrigger className="w-32" data-testid="select-type-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="discussion">Discussion Points</SelectItem>
              <SelectItem value="meeting">Decision Items</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="status-filter" className="text-sm font-medium">
            Status:
          </Label>
          <Select
            value={filters.status || 'all'}
            onValueChange={(value) => handleFilterChange('status', value)}
          >
            <SelectTrigger className="w-32" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="meeting-filter" className="text-sm font-medium">
            Meeting:
          </Label>
          <Select
            value={filters.meetingId ? filters.meetingId.toString() : 'all'}
            onValueChange={(value) => handleFilterChange('meetingId', value === 'all' ? undefined : parseInt(value))}
          >
            <SelectTrigger className="w-48" data-testid="select-meeting-filter">
              <SelectValue placeholder="All Meetings" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Meetings</SelectItem>
              {meetings.map(meeting => (
                <SelectItem key={meeting.id} value={meeting.id.toString()}>
                  {meeting.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedNoteIds.length > 0 && (
        <div className="flex items-center gap-2 p-4 bg-brand-primary-lighter border border-brand-primary-border rounded-lg">
          <span className="text-sm font-medium text-brand-primary-dark">
            {selectedNoteIds.length} note(s) selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkStatusChange('active')}
            data-testid="button-bulk-activate"
          >
            <ArchiveRestore className="w-4 h-4 mr-1" />
            Activate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkStatusChange('archived')}
            data-testid="button-bulk-archive"
          >
            <Archive className="w-4 h-4 mr-1" />
            Archive
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            data-testid="button-bulk-delete"
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
      )}

      {/* Notes List */}
      <div className="space-y-4">
        {filteredNotes.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p className="text-gray-600 mb-4">
                {searchQuery ? 'No notes match your search' : 'No notes found'}
              </p>
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-teal-600 hover:bg-teal-700 text-white"
                data-testid="button-create-first-note"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Note
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Select All Checkbox */}
            <div className="flex items-center gap-2 px-2">
              <Checkbox
                checked={selectedNoteIds.length === filteredNotes.length}
                onCheckedChange={handleSelectAllNotes}
                data-testid="checkbox-select-all-notes"
              />
              <Label className="text-sm text-gray-600">
                Select all visible notes
              </Label>
            </div>

            {/* Notes */}
            {filteredNotes.map((note) => (
              <Card key={note.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <Checkbox
                        checked={selectedNoteIds.includes(note.id)}
                        onCheckedChange={(checked) => handleSelectNote(note.id, checked as boolean)}
                        data-testid={`checkbox-note-${note.id}`}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={getTypeColor(note.type)}>
                            {note.type === 'discussion' ? (
                              <>
                                <MessageSquare className="w-3 h-3 mr-1" />
                                Discussion Points/Questions
                              </>
                            ) : (
                              <>
                                <FileText className="w-3 h-3 mr-1" />
                                Meeting Notes
                              </>
                            )}
                          </Badge>
                          {note.createdAt && (
                            <Badge className="bg-gray-100 text-gray-700 border-gray-200">
                              <Calendar className="w-3 h-3 mr-1" />
                              {formatDateForDisplay(note.createdAt)}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm font-medium text-gray-600 mb-1">
                          Project: {note.projectTitle}
                        </div>
                        {note.meetingTitle && (
                          <div className="text-sm text-gray-600 mb-2">
                            Meeting: {note.meetingTitle}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConvertToTask(note)}
                        className="text-teal-600 border-teal-200 hover:bg-teal-50"
                        data-testid={`button-convert-to-task-${note.id}`}
                        title="Convert to Task"
                      >
                        <ListTodo className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditNote(note)}
                        data-testid={`button-edit-note-${note.id}`}
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteNote(note)}
                        data-testid={`button-delete-note-${note.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="mb-4">
                    <div data-testid={`text-note-content-${note.id}`}>
                      {renderNoteContent(note)}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      {note.createdByName && (
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {note.createdByName}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateForDisplay(note.createdAt)}
                      </div>
                    </div>
                    
                    {handleSendToAgenda && (() => {
                      const projectExists = allProjects.some(p => p.id === note.projectId);
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUseInAgenda(note)}
                          disabled={!projectExists}
                          className="text-teal-600 border-teal-200 hover:bg-teal-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm whitespace-nowrap"
                          data-testid={`button-use-in-agenda-${note.id}`}
                          title={!projectExists ? 'Project has been archived or deleted' : undefined}
                        >
                          <ArrowRight className="w-4 h-4 sm:mr-1" />
                          <span className="hidden xs:inline">Use in Next Agenda</span>
                          <span className="xs:hidden">Next Agenda</span>
                        </Button>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
        </>
      )}

      {/* Create Note Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-create-note">
          <DialogHeader>
            <DialogTitle>Create New Note</DialogTitle>
            <DialogDescription>
              Add a new meeting note for project discussion or decisions.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="project-select">Project *</Label>
              <Select
                value={createFormData.projectId}
                onValueChange={(value) => setCreateFormData(prev => ({ ...prev, projectId: value }))}
              >
                <SelectTrigger data-testid="select-create-note-project">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {allProjects.map(project => (
                    <SelectItem key={project.id} value={project.id.toString()}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="meeting-select">Meeting (Optional)</Label>
              <Select
                value={createFormData.meetingId}
                onValueChange={(value) => setCreateFormData(prev => ({ ...prev, meetingId: value }))}
              >
                <SelectTrigger data-testid="select-create-note-meeting">
                  <SelectValue placeholder="No specific meeting" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No specific meeting</SelectItem>
                  {meetings.map(meeting => (
                    <SelectItem key={meeting.id} value={meeting.id.toString()}>
                      {meeting.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="type-select">Note Type</Label>
              <Select
                value={createFormData.type}
                onValueChange={(value: 'discussion' | 'meeting') => setCreateFormData(prev => ({ ...prev, type: value }))}
              >
                <SelectTrigger data-testid="select-create-note-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="discussion">Discussion Points</SelectItem>
                  <SelectItem value="meeting">Decision Items</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="note-content">Note Content *</Label>
              <Textarea
                id="note-content"
                placeholder="Enter your note content..."
                value={createFormData.content}
                onChange={(e) => setCreateFormData(prev => ({ ...prev, content: e.target.value }))}
                rows={6}
                className="resize-none"
                data-testid="textarea-create-note-content"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              data-testid="button-cancel-create-note"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateNote}
              disabled={createNoteMutation.isPending}
              className="bg-teal-600 hover:bg-teal-700 text-white"
              data-testid="button-save-create-note"
            >
              {createNoteMutation.isPending ? 'Creating...' : 'Create Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Note Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-edit-note">
          <DialogHeader>
            <DialogTitle>Edit Note</DialogTitle>
            <DialogDescription>
              Update the note content, type, or status.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-type-select">Note Type</Label>
              <Select
                value={editFormData.type}
                onValueChange={(value: 'discussion' | 'meeting') => setEditFormData(prev => ({ ...prev, type: value }))}
              >
                <SelectTrigger data-testid="select-edit-note-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="discussion">Discussion Points</SelectItem>
                  <SelectItem value="meeting">Decision Items</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="edit-status-select">Status</Label>
              <Select
                value={editFormData.status}
                onValueChange={(value: 'active' | 'archived') => setEditFormData(prev => ({ ...prev, status: value }))}
              >
                <SelectTrigger data-testid="select-edit-note-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="edit-note-content">Note Content *</Label>
              <Textarea
                id="edit-note-content"
                placeholder="Enter your note content..."
                value={editFormData.content}
                onChange={(e) => setEditFormData(prev => ({ ...prev, content: e.target.value }))}
                rows={6}
                className="resize-none"
                data-testid="textarea-edit-note-content"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              data-testid="button-cancel-edit-note"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateNote}
              disabled={updateNoteMutation.isPending}
              className="bg-teal-600 hover:bg-teal-700 text-white"
              data-testid="button-save-edit-note"
            >
              {updateNoteMutation.isPending ? 'Updating...' : 'Update Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent data-testid="dialog-delete-note-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this note? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-note">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteNote}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="button-confirm-delete-note"
            >
              {deleteNoteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Convert to Task Dialog */}
      <Dialog open={showConvertToTaskDialog} onOpenChange={setShowConvertToTaskDialog}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-convert-to-task">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListTodo className="w-5 h-5 text-teal-600" />
              Convert Note to Task
            </DialogTitle>
            <DialogDescription>
              Create a task from this meeting note. The note content will be used as the task description.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Multi-task detection */}
            {detectedTaskLines.length > 1 && (
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Checkbox
                    id="create-multiple"
                    checked={taskFormData.createMultipleTasks}
                    onCheckedChange={(checked) =>
                      setTaskFormData(prev => ({ ...prev, createMultipleTasks: checked as boolean }))
                    }
                    data-testid="checkbox-create-multiple-tasks"
                  />
                  <Label htmlFor="create-multiple" className="text-sm font-medium cursor-pointer">
                    Create {detectedTaskLines.length} separate tasks (one per line)
                  </Label>
                </div>
                {taskFormData.createMultipleTasks && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-gray-600 mb-2">
                      Configure each task individually (click X to remove tasks you don't want):
                    </p>
                    <div className="max-h-96 overflow-y-auto space-y-3">
                      {detectedTaskLines.map((line, index) => {
                        const cleanedLine = line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').replace(/^\[[ x]\]\s*/i, '').trim();
                        const settings = individualTaskSettings[index] || { priority: 'medium', dueDate: '' };
                        return (
                          <div key={index} className="bg-white rounded-lg p-3 border border-teal-100 space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="text-teal-600 font-bold text-sm mt-0.5">{index + 1}.</span>
                              <p className="text-sm text-gray-700 flex-1">{cleanedLine}</p>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                onClick={() => {
                                  // Remove this task from the arrays
                                  const newLines = detectedTaskLines.filter((_, i) => i !== index);
                                  const newSettings = individualTaskSettings.filter((_, i) => i !== index);
                                  setDetectedTaskLines(newLines);
                                  setIndividualTaskSettings(newSettings);

                                  // If no tasks left, switch back to single task mode
                                  if (newLines.length === 0) {
                                    setTaskFormData(prev => ({ ...prev, createMultipleTasks: false }));
                                  } else if (newLines.length === 1) {
                                    // If only one task left, offer to switch to single task mode
                                    setTaskFormData(prev => ({ ...prev, createMultipleTasks: false, title: newLines[0], description: '' }));
                                  }
                                }}
                                data-testid={`button-remove-task-${index}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 ml-5">
                              <div>
                                <Label htmlFor={`task-${index}-priority`} className="text-xs">Priority</Label>
                                <Select
                                  value={settings.priority}
                                  onValueChange={(value: 'low' | 'medium' | 'high') => {
                                    const newSettings = [...individualTaskSettings];
                                    newSettings[index] = { ...settings, priority: value };
                                    setIndividualTaskSettings(newSettings);
                                  }}
                                >
                                  <SelectTrigger id={`task-${index}-priority`} className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="low">Low</SelectItem>
                                    <SelectItem value="medium">Medium</SelectItem>
                                    <SelectItem value="high">High</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label htmlFor={`task-${index}-due-date`} className="text-xs">Due Date</Label>
                                <Input
                                  id={`task-${index}-due-date`}
                                  type="date"
                                  className="h-8 text-xs"
                                  value={settings.dueDate}
                                  onChange={(e) => {
                                    const newSettings = [...individualTaskSettings];
                                    newSettings[index] = { ...settings, dueDate: e.target.value };
                                    setIndividualTaskSettings(newSettings);
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!taskFormData.createMultipleTasks && (
              <>
                <div>
                  <Label htmlFor="task-title">Task Title *</Label>
                  <Input
                    id="task-title"
                    value={taskFormData.title}
                    onChange={(e) => setTaskFormData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter task title..."
                    data-testid="input-task-title"
                  />
                </div>

                <div>
                  <Label htmlFor="task-description">Task Description</Label>
                  <Textarea
                    id="task-description"
                    value={taskFormData.description}
                    onChange={(e) => setTaskFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Task description from note..."
                    rows={6}
                    data-testid="input-task-description"
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="task-priority">Priority</Label>
                <Select
                  value={taskFormData.priority}
                  onValueChange={(value: 'low' | 'medium' | 'high') =>
                    setTaskFormData(prev => ({ ...prev, priority: value }))
                  }
                >
                  <SelectTrigger id="task-priority" data-testid="select-task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="task-due-date">Due Date</Label>
                <Input
                  id="task-due-date"
                  type="date"
                  value={taskFormData.dueDate}
                  onChange={(e) => setTaskFormData(prev => ({ ...prev, dueDate: e.target.value }))}
                  data-testid="input-task-due-date"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="delete-note"
                checked={taskFormData.deleteNoteAfterConvert}
                onCheckedChange={(checked) =>
                  setTaskFormData(prev => ({ ...prev, deleteNoteAfterConvert: checked as boolean }))
                }
                data-testid="checkbox-delete-note-after-convert"
              />
              <Label htmlFor="delete-note" className="text-sm font-normal cursor-pointer">
                Delete note after creating task
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConvertToTaskDialog(false)}
              data-testid="button-cancel-convert-to-task"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmConvertToTask}
              className="bg-teal-600 hover:bg-teal-700 text-white"
              data-testid="button-confirm-convert-to-task"
            >
              <ListTodo className="w-4 h-4 mr-2" />
              Create Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}