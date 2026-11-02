import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
} from '@/components/ui/dialog';
import { ProjectAssigneeSelector } from '@/components/project-assignee-selector';
import { TaskAssigneeSelector } from '@/components/task-assignee-selector';
import { ObjectUploader } from '@/components/ObjectUploader';
import { ProjectTasksView } from '../sections/ProjectTasksView';
import { AddProjectDialog } from '../dialogs/AddProjectDialog';
import { getCategoryIcon } from '../utils/categories';
import { formatStatusText, getStatusBadgeProps } from '../utils/status';
import { formatDateForDisplay } from '@/lib/date-utils';
import { formatSectionName } from '../utils/date';
import { useNotes, type CreateNoteData } from '../hooks/useNotes';
import {
  Plus,
  ExternalLink,
  CheckCircle2,
  Check,
  Download,
  RotateCcw,
  FileText,
  Target,
  X,
  AlertCircle,
  UserCog,
  UserPlus,
  Edit3,
  Trash2,
  Archive,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from 'lucide-react';
import type { UseMutationResult, QueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import type { ToastActionElement } from '@/components/ui/toast';

// Import types from hooks instead of re-declaring them
import type { Meeting } from '../hooks/useMeetings';
import type { Project, NewProjectData } from '../hooks/useProjects';
import type { AgendaItem } from '../hooks/useAgenda';
import { ProjectNotesHistory } from '../components/ProjectNotesHistory';
import { logger } from '@/lib/logger';

// Toast function type based on the useToast hook
type ToastFunction = (props: {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  action?: ToastActionElement;
}) => void;

interface AgendaPlanningTabProps {
  // State
  selectedMeeting: Meeting | null;
  meetings: Meeting[];
  selectedProjectIds: number[];
  setSelectedProjectIds: (ids: number[]) => void;
  projectAgendaStatus: Record<number, 'none' | 'agenda' | 'tabled'>;
  setProjectAgendaStatus: (status: Record<number, 'none' | 'agenda' | 'tabled'>) => void;
  minimizedProjects: Set<number>;
  setMinimizedProjects: (projects: Set<number>) => void;
  localProjectText: Record<number, { discussionPoints?: string; decisionItems?: string }>;
  setLocalProjectText: (text: Record<number, { discussionPoints?: string; decisionItems?: string }>) => void;
  showResetConfirmDialog: boolean;
  setShowResetConfirmDialog: (show: boolean) => void;
  showAddProjectDialog: boolean;
  setShowAddProjectDialog: (show: boolean) => void;
  newProjectData: NewProjectData;
  setNewProjectData: (data: NewProjectData) => void;
  offAgendaTitle: string;
  setOffAgendaTitle: (title: string) => void;
  offAgendaSection: string;
  setOffAgendaSection: (section: string) => void;
  isGeneratingPDF: boolean;
  isCompiling: boolean;
  setIsCompiling: (compiling: boolean) => void;
  showEditPeopleDialog: boolean;
  setShowEditPeopleDialog: (show: boolean) => void;
  showEditOwnerDialog: boolean;
  setShowEditOwnerDialog: (show: boolean) => void;
  showAddTaskDialog: boolean;
  setShowAddTaskDialog: (show: boolean) => void;
  editingProject: number | null;
  setEditingProject: (projectId: number | null) => void;
  editSupportPeople: string;
  setEditSupportPeople: (people: string) => void;
  editSupportPeopleIds: string[];
  setEditSupportPeopleIds: (ids: string[]) => void;
  editProjectOwner: string;
  setEditProjectOwner: (owner: string) => void;
  editProjectOwnerIds: string[];
  setEditProjectOwnerIds: (ids: string[]) => void;
  newTaskTitle: string;
  setNewTaskTitle: (title: string) => void;
  newTaskDescription: string;
  setNewTaskDescription: (description: string) => void;
  uploadedFiles: Record<number, { url: string; name: string }[]>;
  setUploadedFiles: (files: Record<number, { url: string; name: string }[]>) => void;
  
  // Data
  allProjects: Project[];
  agendaItems: AgendaItem[];
  agendaSummary: {
    agendaCount: number;
    tabledCount: number;
    undecidedCount: number;
  };
  
  // Handlers
  handleTextChange: (projectId: number, field: 'discussionPoints' | 'decisionItems', value: string) => void;
  getTextValue: (projectId: number, field: 'discussionPoints' | 'decisionItems', fallback: string) => string;
  handleSendToAgenda: (projectId: number) => void;
  handleTableProject: (projectId: number) => void;
  handleExpandProject: (projectId: number) => void;
  handleFinalizeAgenda: () => Promise<void>;
  handleAddOffAgendaItem: () => void;
  handleCreateProject: () => void;
  
  // Mutations - properly typed based on the hooks
  updateProjectDiscussionMutation: UseMutationResult<
    unknown,
    Error,
    {
      projectId: number;
      updates: {
        meetingDiscussionPoints?: string;
        meetingDecisionItems?: string;
        reviewInNextMeeting?: boolean;
        priority?: string;
        supportPeople?: string;
        supportPeopleIds?: string[];
        assigneeName?: string;
        assigneeIds?: string[];
      };
    },
    unknown
  >;
  updateProjectPriorityMutation: UseMutationResult<unknown, Error, { projectId: number; priority: string }, unknown>;
  createTasksFromNotesMutation: UseMutationResult<unknown, Error, void, unknown>;
  resetAgendaPlanningMutation: UseMutationResult<{ notesProcessed: number; notesCleared: number }, Error, void, unknown>;
  createOffAgendaItemMutation: UseMutationResult<unknown, Error, { title: string; section: string; meetingId: number }, unknown>;
  deleteAgendaItemMutation: UseMutationResult<unknown, Error, number, unknown>;
  createProjectMutation: UseMutationResult<unknown, Error, NewProjectData, unknown>;
  
  // Additional dependencies
  queryClient: QueryClient;
  apiRequest: <T = unknown>(method: string, url: string, body?: unknown) => Promise<T>;
  toast: ToastFunction;
}

export function AgendaPlanningTab({
  selectedMeeting,
  meetings,
  selectedProjectIds,
  setSelectedProjectIds,
  projectAgendaStatus,
  setProjectAgendaStatus,
  minimizedProjects,
  setMinimizedProjects,
  localProjectText,
  setLocalProjectText,
  showResetConfirmDialog,
  setShowResetConfirmDialog,
  showAddProjectDialog,
  setShowAddProjectDialog,
  newProjectData,
  setNewProjectData,
  offAgendaTitle,
  setOffAgendaTitle,
  offAgendaSection,
  setOffAgendaSection,
  isGeneratingPDF,
  isCompiling,
  setIsCompiling,
  showEditPeopleDialog,
  setShowEditPeopleDialog,
  showEditOwnerDialog,
  setShowEditOwnerDialog,
  showAddTaskDialog,
  setShowAddTaskDialog,
  editingProject,
  setEditingProject,
  editSupportPeople,
  setEditSupportPeople,
  editSupportPeopleIds,
  setEditSupportPeopleIds,
  editProjectOwner,
  setEditProjectOwner,
  editProjectOwnerIds,
  setEditProjectOwnerIds,
  newTaskTitle,
  setNewTaskTitle,
  newTaskDescription,
  setNewTaskDescription,
  uploadedFiles,
  setUploadedFiles,
  allProjects,
  agendaItems,
  agendaSummary,
  handleTextChange,
  getTextValue,
  handleSendToAgenda,
  handleTableProject,
  handleExpandProject,
  handleFinalizeAgenda,
  handleAddOffAgendaItem,
  handleCreateProject,
  updateProjectDiscussionMutation,
  updateProjectPriorityMutation,
  createTasksFromNotesMutation,
  resetAgendaPlanningMutation,
  createOffAgendaItemMutation,
  deleteAgendaItemMutation,
  createProjectMutation,
  queryClient,
  apiRequest,
  toast,
}: AgendaPlanningTabProps) {
  // Add notes functionality
  const { createNoteMutation } = useNotes();

  // Delete project mutation
  const deleteProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      toast({
        title: 'Project deleted successfully!',
        description: 'The project has been removed.',
      });
    },
    onError: (error: any) => {
      logger.error('Delete project error:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to delete project.',
        variant: 'destructive',
      });
    },
  });

  // Archive project mutation - uses proper /archive endpoint
  const archiveProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('POST', `/api/projects/${id}/archive`);
    },
    onSuccess: (response: any, archivedProjectId) => {
      // Get project title before removing from state (for better toast message)
      const archivedProject = allProjects.find(p => p.id === archivedProjectId);
      const projectTitle = archivedProject?.title || `Project #${archivedProjectId}`;
      
      // Remove from local state immediately
      setProjectAgendaStatus((prev) => {
        const updated = { ...prev };
        delete updated[archivedProjectId];
        return updated;
      });
      setMinimizedProjects((prev) => {
        const updated = new Set(prev);
        updated.delete(archivedProjectId);
        return updated;
      });
      setSelectedProjectIds((prev) => prev.filter(id => id !== archivedProjectId));
      // Clear local text for archived project
      setLocalProjectText((prev) => {
        const updated = { ...prev };
        delete updated[archivedProjectId];
        return updated;
      });
      
      // Invalidate both active and archived project queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects/archived'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects/for-review'] });
      
      // Force immediate refetch to update UI
      queryClient.refetchQueries({ queryKey: ['/api/projects'] });
      queryClient.refetchQueries({ queryKey: ['/api/projects/for-review'] });
      
      // Success toast with project details
      toast({
        title: '✅ Project archived successfully!',
        description: `"${projectTitle}" has been moved to the archive and removed from active projects. It should disappear from this list now.`,
        duration: 5000, // Show for 5 seconds
      });
      
      // Log to console for debugging
      logger.log(`[Archive] Successfully archived project ${archivedProjectId} "${projectTitle}"`);
    },
    onError: (error: any, archivedProjectId) => {
      const archivedProject = allProjects.find(p => p.id === archivedProjectId);
      const projectTitle = archivedProject?.title || `Project #${archivedProjectId}`;
      
      logger.error(`[Archive] Failed to archive project ${archivedProjectId} "${projectTitle}":`, error);
      
      // Detailed error toast
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error occurred';
      toast({
        title: '❌ Archive failed',
        description: `Failed to archive "${projectTitle}". Error: ${errorMessage}. Check server logs for details.`,
        variant: 'destructive',
        duration: 7000, // Show longer for errors
      });
    },
  });

  // Function to save all agenda content to organized notes
  const handleSaveToNotes = async () => {
    if (!selectedMeeting) {
      toast({
        title: 'No Meeting Selected',
        description: 'Please select a meeting before saving notes.',
        variant: 'destructive',
      });
      return;
    }

    let notesCreated = 0;
    const errors: string[] = [];

    try {
      // Process agenda projects
      const agendaProjects = allProjects.filter(p => projectAgendaStatus[p.id] === 'agenda');

      for (const project of agendaProjects) {
        const discussionPoints = getTextValue(project.id, 'discussionPoints', project.meetingDiscussionPoints || '');
        const decisionItems = getTextValue(project.id, 'decisionItems', project.meetingDecisionItems || '');

        // Create a comprehensive note for each project with structured content
        const noteContent = {
          projectTitle: project.title,
          category: project.category || 'general',
          priority: project.priority || 'medium',
          status: project.status,
          discussionPoints: discussionPoints?.trim() || null,
          decisionItems: decisionItems?.trim() || null,
          assignee: project.assigneeName || null,
          supportPeople: project.supportPeople || null,
          reviewInNextMeeting: project.reviewInNextMeeting || false,
        };

        // Only create note if there's meaningful content
        if (discussionPoints?.trim() || decisionItems?.trim()) {
          try {
            const noteData = {
              projectId: project.id,
              meetingId: selectedMeeting.id,
              type: 'meeting' as const,
              content: JSON.stringify(noteContent),
              status: 'active' as const,
            };
            logger.log('Creating note for project:', project.title, noteData);
            await createNoteMutation.mutateAsync(noteData);
            notesCreated++;
            logger.log('Successfully created note for:', project.title);
          } catch (error) {
            logger.error('Failed to save notes for', project.title, error);
            errors.push(`Failed to save notes for ${project.title}`);
          }
        }
      }

      // Process tabled projects
      const tabledProjects = allProjects.filter(p => projectAgendaStatus[p.id] === 'tabled');

      for (const project of tabledProjects) {
        const discussionPoints = getTextValue(project.id, 'discussionPoints', project.meetingDiscussionPoints || '');
        const decisionItems = getTextValue(project.id, 'decisionItems', project.meetingDecisionItems || '');

        // Only create note if there's actual text content in the boxes
        if (discussionPoints?.trim() || decisionItems?.trim()) {
          const noteContent = {
            projectTitle: project.title,
            category: project.category || 'general',
            priority: project.priority || 'medium',
            status: 'tabled',
            reason: 'Tabled for next meeting',
            discussionPoints: discussionPoints?.trim() || null,
            decisionItems: decisionItems?.trim() || null,
            assignee: project.assigneeName || null,
            supportPeople: project.supportPeople || null,
            reviewInNextMeeting: project.reviewInNextMeeting || false,
          };

          try {
            await createNoteMutation.mutateAsync({
              projectId: project.id,
              meetingId: selectedMeeting.id,
              type: 'meeting',
              content: JSON.stringify(noteContent),
              status: 'active',
            });
            notesCreated++;
          } catch (error) {
            errors.push(`Failed to save tabled status for ${project.title}`);
          }
        }
      }

      // Process off-agenda items - skip them if they don't have a valid projectId
      const offAgendaItems = agendaItems.filter(item => item.isOffAgendaItem && item.projectId && item.projectId > 0);

      for (const item of offAgendaItems) {
        const noteContent = {
          title: item.title,
          section: item.section,
          type: 'off-agenda',
          content: item.content || '',
        };

        try {
          // Only create note if we have a valid projectId
          if (item.projectId) {
            await createNoteMutation.mutateAsync({
              projectId: item.projectId,
              meetingId: selectedMeeting.id,
              type: 'meeting',
              content: JSON.stringify(noteContent),
              status: 'active',
            });
            notesCreated++;
          }
        } catch (error) {
          errors.push(`Failed to save off-agenda item: ${item.title}`);
        }
      }

      // Show success message
      if (notesCreated > 0) {
        // Clear the local text state first
        setLocalProjectText({});
        setSelectedProjectIds([]);
        setProjectAgendaStatus({});
        setMinimizedProjects(new Set());

        // Now clear the database fields for the projects
        const clearPromises = agendaProjects.map(async (project) => {
          try {
            await apiRequest('PATCH', `/api/projects/${project.id}`, {
              meetingDiscussionPoints: '',
              meetingDecisionItems: '',
            });
          } catch (error) {
            logger.warn(`Failed to clear text for project ${project.id}:`, error);
          }
        });

        // Also clear tabled projects
        const tabledClearPromises = tabledProjects.map(async (project) => {
          try {
            await apiRequest('PATCH', `/api/projects/${project.id}`, {
              meetingDiscussionPoints: '',
              meetingDecisionItems: '',
            });
          } catch (error) {
            logger.warn(`Failed to clear text for tabled project ${project.id}:`, error);
          }
        });

        // Wait for all clears to complete
        await Promise.all([...clearPromises, ...tabledClearPromises]);

        // Refresh the projects data
        queryClient.invalidateQueries({ queryKey: ['/api/projects'] });

        toast({
          title: 'Notes Saved Successfully',
          description: `Saved ${notesCreated} note(s) from this meeting. View them in the Notes tab.`,
        });
      } else {
        toast({
          title: 'No Notes to Save',
          description: 'Add discussion points or decision items before saving.',
          variant: 'destructive',
        });
      }

    } catch (error) {
      toast({
        title: 'Error Saving Notes',
        description: 'An unexpected error occurred while saving notes.',
        variant: 'destructive',
      });
    }

    if (errors.length > 0) {
      toast({
        title: 'Some Notes Failed',
        description: errors.slice(0, 3).join(', '),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Weekly Agenda Planning
          </h2>
          <p className="text-gray-600">
            Select projects and topics for this week's meeting
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddProjectDialog(true)}
            data-testid="button-add-project"
            className="border-teal-300 text-teal-700 hover:bg-teal-50"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add New Project
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                setIsCompiling(true);
                const response = await apiRequest<{ message?: string }>(
                  'POST',
                  '/api/google-sheets/projects/sync/from-sheets'
                );
                toast({
                  title: 'Sync Complete',
                  description:
                    response.message ||
                    'Successfully synced projects from Google Sheets',
                });
                // Refresh the projects data
                queryClient.invalidateQueries({
                  queryKey: ['/api/projects'],
                });
              } catch (error: any) {
                toast({
                  title: 'Sync Failed',
                  description:
                    error?.message || 'Failed to sync from Google Sheets',
                  variant: 'destructive',
                });
              } finally {
                setIsCompiling(false);
              }
            }}
            disabled={isCompiling}
            data-testid="button-sync-sheets"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {isCompiling ? 'Syncing...' : 'Sync Google Sheets'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveToNotes}
            disabled={createNoteMutation.isPending}
            data-testid="button-save-to-notes"
            style={{ borderColor: '#47B3CB', color: '#47B3CB' }}
            onMouseEnter={(e) => {
              const target = e.currentTarget as HTMLButtonElement;
              target.style.backgroundColor = '#e6f2f5';
            }}
            onMouseLeave={(e) => {
              const target = e.currentTarget as HTMLButtonElement;
              target.style.backgroundColor = 'transparent';
            }}
            className=""
          >
            <FileText className="w-4 h-4 mr-2" />
            Save to Notes
          </Button>

          {(agendaSummary.agendaCount > 0 ||
            agendaSummary.tabledCount > 0) && (
            <Button
              size="sm"
              onClick={handleFinalizeAgenda}
              disabled={isGeneratingPDF}
              data-testid="button-finalize-agenda"
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Download className="w-4 h-4 mr-2" />
              {isGeneratingPDF ? 'Generating...' : 'Finalize Agenda PDF'}
            </Button>
          )}
        </div>
      </div>

      {/* Agenda Summary */}
      {(agendaSummary.agendaCount > 0 || agendaSummary.tabledCount > 0) && (
        <Card className="bg-gradient-to-r from-teal-50 to-accent/10 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-primary">Agenda Status</h3>
                <div className="flex items-center gap-4 mt-1">
                  <span className="text-sm text-teal-700">
                    📅 {agendaSummary.agendaCount} for agenda
                  </span>
                  <span className="text-sm text-orange-700">
                    ⏳ {agendaSummary.tabledCount} tabled
                  </span>
                  {agendaSummary.undecidedCount > 0 && (
                    <span className="text-sm text-gray-600">
                      ❓ {agendaSummary.undecidedCount} undecided
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleFinalizeAgenda}
                disabled={
                  isGeneratingPDF || agendaSummary.agendaCount === 0
                }
                data-testid="button-download-agenda-pdf"
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Download className="w-4 h-4 mr-2" />
                {isGeneratingPDF ? 'Generating...' : 'Download Agenda PDF'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress Indicator */}
      {allProjects.length > 0 && (
        <div className="sticky top-0 bg-white z-10 p-3 border-b border-gray-200 rounded-lg shadow-sm">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium text-gray-700">
              Reviewing projects for meeting
            </span>
            <div className="flex items-center gap-4">
              <span className="text-teal-600 font-medium">
                {agendaSummary.agendaCount + agendaSummary.tabledCount} of{' '}
                {allProjects.filter((p) => p.status !== 'completed' && p.status !== 'archived').length}{' '}
                reviewed
              </span>
              <div className="w-32 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-teal-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      ((agendaSummary.agendaCount +
                        agendaSummary.tabledCount) /
                        allProjects.filter((p) => p.status !== 'completed' && p.status !== 'archived')
                          .length) *
                        100
                    )}%`,
                  }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Projects Selection Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-teal-600" />
            Google Sheets Projects (
            {
              allProjects.filter(
                (project: any) => project.status !== 'completed' && project.status !== 'archived'
              ).length
            }
            )
          </CardTitle>
          <p className="text-gray-600">
            Select projects to discuss and specify what about each project
            needs attention
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {allProjects.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p>
                  No projects found. Sync with Google Sheets to load
                  projects.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {allProjects
                  .filter((project: any) => project.status !== 'completed' && project.status !== 'archived')
                  .map((project: any, index: number) => {
                    // Add section headers to break up the list
                    let sectionHeader = null;
                    const filteredProjects = allProjects.filter(
                      (p: any) => p.status !== 'completed' && p.status !== 'archived'
                    );

                    if (index === 0) {
                      const needsDiscussionCount = filteredProjects.filter(
                        (p: any) =>
                          p.meetingDiscussionPoints ||
                          p.meetingDecisionItems
                      ).length;
                      if (needsDiscussionCount > 0) {
                        sectionHeader = (
                          <h4
                            key="needs-discussion"
                            className="text-xs font-semibold text-gray-500 my-4 uppercase tracking-wider"
                          >
                            NEEDS DISCUSSION ({needsDiscussionCount})
                          </h4>
                        );
                      }
                    } else if (
                      index === Math.floor(filteredProjects.length * 0.4)
                    ) {
                      sectionHeader = (
                        <h4
                          key="in-progress"
                          className="text-xs font-semibold text-gray-500 my-4 uppercase tracking-wider"
                        >
                          IN PROGRESS
                        </h4>
                      );
                    } else if (
                      index === Math.floor(filteredProjects.length * 0.7)
                    ) {
                      sectionHeader = (
                        <h4
                          key="other-projects"
                          className="text-xs font-semibold text-gray-500 my-4 uppercase tracking-wider"
                        >
                          OTHER PROJECTS
                        </h4>
                      );
                    }
                    // Use our date utility to avoid timezone conversion issues
                    const lastDiscussed = project.lastDiscussedDate
                      ? formatDateForDisplay(project.lastDiscussedDate)
                      : 'Never discussed';

                    const isMinimized = minimizedProjects.has(project.id);
                    const agendaStatus =
                      projectAgendaStatus[project.id] || 'none';
                    const needsDiscussion =
                      project.meetingDiscussionPoints ||
                      project.meetingDecisionItems;

                    // Minimized view
                    if (isMinimized) {
                      return (
                        <div key={`wrapper-${project.id}`}>
                          {sectionHeader}
                          <Card
                            data-testid={`card-project-${project.id}`}
                            className={`border-2 transition-all mb-2 shadow-sm hover:shadow-md ${
                              agendaStatus === 'agenda'
                                ? 'border-[#236383] bg-gradient-to-r from-[#47B3CB]/10 to-[#236383]/10'
                                : agendaStatus === 'tabled'
                                  ? 'border-[#FBAD3F] bg-gradient-to-r from-[#FBAD3F]/10 to-[#FBAD3F]/20'
                                  : needsDiscussion
                                    ? 'border-[#236383] bg-gradient-to-r from-[#236383]/10 to-[#47B3CB]/10'
                                    : index % 2 === 0
                                      ? 'border-[#D1D3D4] bg-gradient-to-r from-[#D1D3D4]/20 to-[#646464]/10'
                                      : 'border-[#A31C41] bg-gradient-to-r from-[#A31C41]/10 to-[#A31C41]/20'
                            }`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3">
                                    <h3 className="font-medium text-gray-900">
                                      {project.title}
                                    </h3>
                                    <Badge
                                      className={`text-xs font-medium shadow-sm ${
                                        agendaStatus === 'agenda'
                                          ? 'bg-gradient-to-r from-[#47B3CB]/20 to-[#236383]/20 text-[#236383] border-[#236383]/40 shadow-[#236383]/10'
                                          : agendaStatus === 'tabled'
                                            ? 'bg-gradient-to-r from-orange-100 to-amber-100 text-orange-800 border-orange-300 shadow-orange-200'
                                            : needsDiscussion
                                              ? 'bg-gradient-to-r from-teal-100 to-cyan-100 text-teal-800 border-teal-300 shadow-teal-200'
                                              : 'bg-gradient-to-r from-gray-100 to-slate-100 text-gray-700 border-gray-300 shadow-gray-200'
                                      }`}
                                    >
                                      {agendaStatus === 'agenda'
                                        ? '📅 On Agenda'
                                        : agendaStatus === 'tabled'
                                          ? '⏳ Tabled'
                                          : 'Not Scheduled'}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                                    <span>
                                      <strong>Owner:</strong>{' '}
                                      {project.assigneeName || 'Unassigned'}
                                    </span>
                                    {project.supportPeople && (
                                      <span>
                                        <strong>Support:</strong>{' '}
                                        {project.supportPeople}
                                      </span>
                                    )}
                                  </div>
                                  {(project.meetingDiscussionPoints ||
                                    project.meetingDecisionItems) && (
                                    <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                                      {project.meetingDiscussionPoints && (
                                        <div className="mb-1">
                                          <strong className="text-gray-700">
                                            Discussion:
                                          </strong>{' '}
                                          {project.meetingDiscussionPoints}
                                        </div>
                                      )}
                                      {project.meetingDecisionItems && (
                                        <div>
                                          <strong className="text-gray-700">
                                            Decisions:
                                          </strong>{' '}
                                          {project.meetingDecisionItems}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleExpandProject(project.id)}
                                  data-testid={`button-expand-${project.id}`}
                                  className="text-gray-600"
                                >
                                  <ChevronDown className="w-4 h-4" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      );
                    }

                    // Expanded view
                    return (
                      <div key={`wrapper-${project.id}`}>
                        {sectionHeader}
                        <Card
                          data-testid={`card-project-expanded-${project.id}`}
                          className={`border-2 transition-all shadow-lg hover:shadow-xl ${
                            agendaStatus === 'agenda'
                              ? 'border-[#236383] bg-gradient-to-br from-[#47B3CB]/10 via-[#236383]/10 to-[#47B3CB]/20 shadow-[#236383]/20'
                              : agendaStatus === 'tabled'
                                ? 'border-orange-400 bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100 shadow-orange-200'
                                : needsDiscussion
                                  ? 'border-teal-400 bg-gradient-to-br from-teal-50 via-cyan-50 to-teal-100 shadow-teal-200'
                                  : index % 2 === 0
                                    ? 'border-brand-primary-border-strong bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100 shadow-slate-200'
                                    : 'border-purple-300 bg-gradient-to-br from-purple-50 via-pink-50 to-purple-100 shadow-purple-200'
                          }`}
                        >
                          <CardHeader className="pb-4">
                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-0">
                              <div className="flex-1">
                                <div className="flex items-center gap-3">
                                  <h3 className="text-lg font-semibold text-gray-900">
                                    {project.title}
                                  </h3>
                                  {needsDiscussion && (
                                    <Badge
                                      variant="outline"
                                      className="bg-gradient-to-r from-teal-100 to-cyan-100 text-teal-800 border-teal-400 shadow-teal-200 shadow-sm"
                                    >
                                      📝 Has Notes
                                    </Badge>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
                                  <div className="flex items-center gap-2">
                                    <UserCog className="w-4 h-4 text-gray-500" />
                                    <span className="font-medium text-gray-700">
                                      Owner:
                                    </span>
                                    <span className="text-gray-600">
                                      {project.assigneeName || 'Unassigned'}
                                    </span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        console.log('📝 Editing project owner:', {
                                          id: project.id,
                                          title: project.title,
                                          currentOwner: project.assigneeName,
                                        });
                                        setEditingProject(project.id);
                                        setEditProjectOwner(
                                          project.assigneeName || ''
                                        );
                                        setEditProjectOwnerIds(
                                          Array.isArray(project.assigneeIds)
                                            ? project.assigneeIds.map((id: string | number) => id?.toString())
                                            : []
                                        );
                                        setShowEditOwnerDialog(true);
                                      }}
                                      data-testid={`button-edit-owner-${project.id}`}
                                      className="h-6 px-2 text-primary hover:text-primary/80"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                    </Button>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <UserPlus className="w-4 h-4 text-gray-500" />
                                    <span className="font-medium text-gray-700">
                                      Support:
                                    </span>
                                    <span className="text-gray-600">
                                      {project.supportPeople || 'None assigned'}
                                    </span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        setEditingProject(project.id);
                                        setEditSupportPeople(
                                          project.supportPeople || ''
                                        );
                                        setEditSupportPeopleIds(
                                          Array.isArray(project.supportPeopleIds)
                                            ? project.supportPeopleIds.map((id: string | number) => id?.toString())
                                            : []
                                        );
                                        setShowEditPeopleDialog(true);
                                      }}
                                      data-testid={`button-edit-support-${project.id}`}
                                      className="h-6 px-2 text-primary hover:text-primary/80"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                    </Button>
                                  </div>

                                  {project.priority && (
                                    <Select
                                      value={project.priority}
                                      onValueChange={(value) => {
                                        updateProjectPriorityMutation.mutate({
                                          projectId: project.id,
                                          priority: value,
                                        });
                                      }}
                                    >
                                      <SelectTrigger
                                        data-testid={`select-priority-${project.id}`}
                                        className="w-32 h-7 text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="low">Low</SelectItem>
                                        <SelectItem value="medium">
                                          Medium
                                        </SelectItem>
                                        <SelectItem value="high">High</SelectItem>
                                        <SelectItem value="critical">
                                          Critical
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  )}

                                  <Badge
                                    variant={
                                      project.status === 'waiting'
                                        ? 'secondary'
                                        : project.status === 'in_progress'
                                          ? 'default'
                                          : 'outline'
                                    }
                                  >
                                    {formatStatusText(project.status)}
                                  </Badge>

                                  <span className="text-xs text-gray-500">
                                    Last discussed: {lastDiscussed}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    if (window.confirm(`Are you sure you want to archive "${project.title}"? You can view archived projects later.`)) {
                                      logger.log(`[Archive] Starting archive for project ${project.id} "${project.title}"`);
                                      archiveProjectMutation.mutate(project.id);
                                    }
                                  }}
                                  disabled={archiveProjectMutation.isPending}
                                  data-testid={`button-archive-project-${project.id}`}
                                  className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                                  title={archiveProjectMutation.isPending ? "Archiving..." : "Archive project"}
                                >
                                  {archiveProjectMutation.isPending ? (
                                    <div className="w-4 h-4 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <Archive className="w-4 h-4" />
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    if (window.confirm(`Are you sure you want to delete "${project.title}"? This action cannot be undone.`)) {
                                      deleteProjectMutation.mutate(project.id);
                                    }
                                  }}
                                  disabled={deleteProjectMutation.isPending}
                                  data-testid={`button-delete-project-${project.id}`}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  title="Delete project permanently"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setMinimizedProjects(
                                      new Set([
                                        ...Array.from(minimizedProjects),
                                        project.id,
                                      ])
                                    );
                                  }}
                                  data-testid={`button-minimize-${project.id}`}
                                  className="text-gray-600"
                                >
                                  <ChevronUp className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </CardHeader>

                          <Separator />

                          <CardContent className="pt-4 space-y-4">
                            {/* Visual indicator for notes from previous meetings */}
                            {(project.meetingDiscussionPoints || project.meetingDecisionItems) && (
                              <div className="bg-gradient-to-r from-[#47B3CB]/10 to-[#236383]/10 border-l-4 border-[#236383] p-3 rounded-r-lg">
                                <div className="flex items-center gap-2">
                                  <MessageSquare className="w-4 h-4 text-[#236383] flex-shrink-0" />
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-[#236383]">
                                      📋 Notes from Previous Meeting
                                    </p>
                                    <p className="text-xs text-gray-600 mt-0.5">
                                      These discussion points were added from past meeting notes. You can edit them below.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Discussion Notes */}
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`discussion-${project.id}`}
                                  className="text-sm font-medium text-gray-700"
                                >
                                  Discussion Points & Questions
                                </Label>
                                <Textarea
                                  id={`discussion-${project.id}`}
                                  data-testid={`textarea-discussion-${project.id}`}
                                  placeholder="What aspects of this project need to be discussed in the meeting?"
                                  className="min-h-[80px] resize-none"
                                  value={getTextValue(
                                    project.id,
                                    'discussionPoints',
                                    project.meetingDiscussionPoints || ''
                                  )}
                                  onChange={(e) =>
                                    handleTextChange(
                                      project.id,
                                      'discussionPoints',
                                      e.target.value
                                    )
                                  }
                                />
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`decisions-${project.id}`}
                                  className="text-sm font-medium text-gray-700"
                                >
                                  Notes from Meeting
                                </Label>
                                <Textarea
                                  id={`decisions-${project.id}`}
                                  data-testid={`textarea-decisions-${project.id}`}
                                  placeholder="Notes and outcomes from the meeting discussion"
                                  className="min-h-[80px] resize-none"
                                  value={getTextValue(
                                    project.id,
                                    'decisionItems',
                                    project.meetingDecisionItems || ''
                                  )}
                                  onChange={(e) =>
                                    handleTextChange(
                                      project.id,
                                      'decisionItems',
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                            </div>

                            {/* Past Notes History for this Project */}
                            <ProjectNotesHistory 
                              projectId={project.id}
                              projectTitle={project.title}
                            />

                            {/* Agenda Actions */}
                            <div className="pt-4 space-y-4">
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant={
                                    agendaStatus === 'agenda'
                                      ? 'default'
                                      : 'outline'
                                  }
                                  onClick={() => handleSendToAgenda(project.id)}
                                  disabled={agendaStatus === 'agenda'}
                                  data-testid={`button-send-to-agenda-${project.id}`}
                                  className={
                                    agendaStatus === 'agenda'
                                      ? 'bg-gradient-to-r from-[#236383] to-[#236383] hover:from-[#1e5a75] hover:to-[#1A4F5E] text-white shadow-[#236383]/30 shadow-md'
                                      : 'border-[#236383] text-[#236383] hover:bg-gradient-to-r hover:from-[#47B3CB]/10 hover:to-[#236383]/10 shadow-[#236383]/20 shadow-sm'
                                  }
                                >
                                  {agendaStatus === 'agenda' ? (
                                    <>
                                      <Check className="w-4 h-4 mr-2" />
                                      On Agenda
                                    </>
                                  ) : (
                                    <>
                                      <Plus className="w-4 h-4 mr-2" />
                                      Add to Agenda
                                    </>
                                  )}
                                </Button>

                                <Button
                                  size="sm"
                                  variant={
                                    agendaStatus === 'tabled'
                                      ? 'default'
                                      : 'outline'
                                  }
                                  onClick={() => handleTableProject(project.id)}
                                  disabled={agendaStatus === 'tabled'}
                                  data-testid={`button-table-project-${project.id}`}
                                  className={
                                    agendaStatus === 'tabled'
                                      ? 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white shadow-orange-300 shadow-md'
                                      : 'border-orange-400 text-orange-700 hover:bg-gradient-to-r hover:from-orange-50 hover:to-amber-50 shadow-orange-200 shadow-sm'
                                  }
                                >
                                  {agendaStatus === 'tabled' ? (
                                    <>
                                      <Check className="w-4 h-4 mr-2" />
                                      Tabled
                                    </>
                                  ) : (
                                    <>
                                      <X className="w-4 h-4 mr-2" />
                                      Table for Later
                                    </>
                                  )}
                                </Button>

                                {(agendaStatus === 'agenda' ||
                                  agendaStatus === 'tabled') && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const newStatus = { ...projectAgendaStatus };
                                      delete newStatus[project.id];
                                      setProjectAgendaStatus(newStatus);
                                    }}
                                    data-testid={`button-remove-from-agenda-${project.id}`}
                                    className="text-gray-600 hover:text-gray-800"
                                  >
                                    Remove
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* File Attachments */}
                            <div className="border-t pt-4">
                              <div className="flex items-center justify-between mb-2">
                                <Label className="text-sm font-medium text-gray-700">
                                  Attachments
                                </Label>
                                <ObjectUploader
                                  onComplete={(files: { url: string; name: string }[]) => {
                                    const updatedFiles = {
                                      ...uploadedFiles,
                                      [project.id]: [
                                        ...(uploadedFiles[project.id] || []),
                                        ...files,
                                      ],
                                    };
                                    setUploadedFiles(updatedFiles);
                                  }}
                                  maxNumberOfFiles={5}
                                  maxFileSize={10 * 1024 * 1024}
                                >
                                  <Button size="sm" variant="outline">
                                    <Plus className="w-4 h-4 mr-1" />
                                    Add File
                                  </Button>
                                </ObjectUploader>
                              </div>
                              {uploadedFiles[project.id]?.length > 0 ? (
                                <div className="space-y-2">
                                  {uploadedFiles[project.id].map(
                                    (file, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between p-2 bg-gray-50 rounded-md"
                                      >
                                        <span className="text-sm text-gray-700">
                                          {file.name}
                                        </span>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 px-2 text-primary hover:text-primary/80"
                                          onClick={() =>
                                            window.open(file.url, '_blank')
                                          }
                                        >
                                          View
                                        </Button>
                                      </div>
                                    )
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500 italic">
                                  No files attached yet
                                </p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Add One-off Items */}
      <Card className="border-gray-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add One-off Agenda Item
          </CardTitle>
          <p className="text-sm text-gray-600">
            For items not related to existing projects
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              placeholder="Item title"
              className="md:col-span-2"
              value={offAgendaTitle}
              onChange={(e) => setOffAgendaTitle(e.target.value)}
              data-testid="input-off-agenda-title"
            />
            <Select
              value={offAgendaSection}
              onValueChange={setOffAgendaSection}
            >
              <SelectTrigger data-testid="select-off-agenda-section">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="old_business">Old Business</SelectItem>
                <SelectItem value="urgent_items">Urgent Items</SelectItem>
                <SelectItem value="housekeeping">Housekeeping</SelectItem>
                <SelectItem value="new_business">New Business</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleAddOffAgendaItem}
              disabled={createOffAgendaItemMutation.isPending}
              data-testid="button-add-off-agenda"
              style={{ backgroundColor: '#FBAD3F' }}
              onMouseEnter={(e) =>
                !createOffAgendaItemMutation.isPending &&
                ((e.target as HTMLElement).style.backgroundColor = '#e09d36')
              }
              onMouseLeave={(e) =>
                !createOffAgendaItemMutation.isPending &&
                ((e.target as HTMLElement).style.backgroundColor = '#FBAD3F')
              }
            >
              {createOffAgendaItemMutation.isPending
                ? 'Adding...'
                : 'Add Item'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Display One-off Agenda Items */}
      {agendaItems.length > 0 && (
        <Card className="border-gray-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="text-gray-700">One-off Agenda Items</span>
              <Badge variant="secondary" className="text-xs">
                {agendaItems.length}
              </Badge>
            </CardTitle>
            <p className="text-sm text-gray-600">
              Items added for this meeting
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {agendaItems.map((item) => (
                <div
                  key={item.id}
                  data-testid={`agenda-item-${item.id}`}
                  className="flex items-center justify-between p-3 border rounded-lg hover:shadow-sm transition-shadow"
                >
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">
                      {item.title}
                    </h4>
                    {item.description && (
                      <p className="text-sm text-gray-600 mt-1">
                        {item.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">
                        {formatSectionName(item.section)}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        Added {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString() : 'Unknown date'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to delete "${item.title}"?`)) {
                          deleteAgendaItemMutation.mutate(item.id);
                        }
                      }}
                      disabled={deleteAgendaItemMutation.isPending}
                      data-testid={`button-delete-agenda-item-${item.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      {selectedProjectIds.length > 0 && (
        <Card className="border-teal-200 bg-teal-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-teal-900">
                  {selectedProjectIds.length} project
                  {selectedProjectIds.length !== 1 ? 's' : ''} selected for
                  discussion
                </h3>
                <p className="text-sm text-teal-700">
                  These will be added to the next compiled agenda
                </p>
              </div>
              <Button>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Confirm Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Floating Action Bar */}
      {(agendaSummary.agendaCount > 0 || agendaSummary.tabledCount > 0) && (
        <div className="fixed bottom-[calc(1rem+var(--chat-dock-height,0px))] right-4 bg-white shadow-lg rounded-lg p-4 border border-gray-200 z-50">
          <div className="text-sm text-gray-600 mb-2 font-medium">
            {agendaSummary.agendaCount + agendaSummary.tabledCount} projects
            reviewed
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleFinalizeAgenda}
              disabled={isGeneratingPDF || agendaSummary.agendaCount === 0}
              data-testid="button-floating-generate-pdf"
              className="bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700 transition-all"
            >
              <Download className="w-4 h-4 mr-2" />
              Generate PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveToNotes}
              disabled={createNoteMutation.isPending}
              data-testid="button-floating-create-tasks"
              className="border border-gray-300 px-4 py-2 rounded hover:bg-gray-50 transition-all disabled:opacity-50"
              title="Finalize meeting notes - creates individual note items from discussion points and decision items"
            >
              {createNoteMutation.isPending ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                  Finalizing Notes...
                </div>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Finalize Meeting Notes
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Edit Support People Dialog */}
      <Dialog
        open={showEditPeopleDialog}
        onOpenChange={setShowEditPeopleDialog}
      >
        <DialogContent className="w-[95vw] max-w-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit Support People</DialogTitle>
            <DialogDescription>
              Add team members from the system or enter custom names and emails
            </DialogDescription>
          </DialogHeader>
          <ProjectAssigneeSelector
            value={editSupportPeople}
            onChange={(value, userIds) => {
              setEditSupportPeople(value);
              setEditSupportPeopleIds(
                userIds && userIds.length > 0
                  ? userIds
                      .map((id) => id?.toString())
                      .filter((id): id is string => Boolean(id))
                  : []
              );
            }}
            label="Support People"
            placeholder="Select or enter support people"
            multiple={true}
          />
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowEditPeopleDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (editingProject) {
                  try {
                    logger.log('=== SUPPORT PEOPLE UPDATE DEBUG ===');
                    logger.log('Project ID:', editingProject);
                    logger.log('Support People Value:', editSupportPeople);
                    logger.log(
                      'Support People Length:',
                      editSupportPeople?.length
                    );

                    const response = await apiRequest(
                      'PATCH',
                      `/api/projects/${editingProject}`,
                      {
                        supportPeople: editSupportPeople,
                        supportPeopleIds: editSupportPeopleIds,
                      }
                    );

                    logger.log('API Response:', response);
                    queryClient.invalidateQueries({
                      queryKey: ['/api/projects'],
                    });

                    toast({
                      title: 'Success',
                      description: 'Support people updated successfully',
                    });
                    setShowEditPeopleDialog(false);
                  } catch (error: any) {
                    logger.error('=== SUPPORT PEOPLE ERROR ===');
                    logger.error('Error details:', error);
                    logger.error('Error message:', error?.message);
                    logger.error('Error response:', error?.response);

                    toast({
                      title: 'Error',
                      description: `Failed to update support people: ${
                        error?.message || 'Unknown error'
                      }`,
                      variant: 'destructive',
                    });
                  }
                }
              }}
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Project Owner Dialog */}
      <Dialog open={showEditOwnerDialog} onOpenChange={setShowEditOwnerDialog}>
        <DialogContent className="w-[95vw] max-w-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit Project Owner</DialogTitle>
            <DialogDescription>
              Assign a single project owner from the system or enter a custom
              name
            </DialogDescription>
          </DialogHeader>
          <ProjectAssigneeSelector
            value={editProjectOwner}
            onChange={(value, userIds) => {
              setEditProjectOwner(value);
              setEditProjectOwnerIds(
                userIds && userIds.length > 0
                  ? userIds
                      .map((id) => id?.toString())
                      .filter((id): id is string => Boolean(id))
                  : []
              );
            }}
            label="Project Owner"
            placeholder="Select or enter project owner"
            multiple={false}
          />
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowEditOwnerDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (editingProject) {
                  try {
                    logger.log('=== PROJECT OWNER UPDATE DEBUG ===');
                    logger.log('Project ID:', editingProject);
                    logger.log('Project Owner Value:', editProjectOwner);

                    const response = await apiRequest(
                      'PATCH',
                      `/api/projects/${editingProject}`,
                      {
                        assigneeName: editProjectOwner,
                        assigneeIds: editProjectOwnerIds,
                      }
                    );

                    logger.log('API Response:', response);
                    queryClient.invalidateQueries({
                      queryKey: ['/api/projects'],
                    });

                    toast({
                      title: 'Success',
                      description: 'Project owner updated successfully',
                    });
                    setShowEditOwnerDialog(false);
                  } catch (error: any) {
                    logger.error('=== PROJECT OWNER ERROR ===');
                    logger.error('Error details:', error);
                    logger.error('Error message:', error?.message);
                    logger.error('Error response:', error?.response);

                    toast({
                      title: 'Error',
                      description: `Failed to update project owner: ${
                        error?.message || 'Unknown error'
                      }`,
                      variant: 'destructive',
                    });
                  }
                }
              }}
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Task Dialog */}
      <Dialog open={showAddTaskDialog} onOpenChange={setShowAddTaskDialog}>
        <DialogContent className="w-[95vw] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Add New Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="task-title">Task Title</Label>
              <Input
                id="task-title"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="Enter task title"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="task-description">Description (optional)</Label>
              <Textarea
                id="task-description"
                value={newTaskDescription}
                onChange={(e) => setNewTaskDescription(e.target.value)}
                placeholder="Enter task description"
                rows={3}
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddTaskDialog(false);
                  setNewTaskTitle('');
                  setNewTaskDescription('');
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!newTaskTitle.trim()}
                onClick={async () => {
                  if (editingProject && newTaskTitle.trim()) {
                    try {
                      await apiRequest(
                        'POST',
                        `/api/projects/${editingProject}/tasks`,
                        {
                          title: newTaskTitle.trim(),
                          description: newTaskDescription.trim() || null,
                          status: 'pending',
                          priority: 'medium',
                        }
                      );
                      queryClient.invalidateQueries({
                        queryKey: ['/api/projects', editingProject, 'tasks'],
                      });
                      toast({
                        title: 'Success',
                        description: 'Task added successfully',
                      });
                      setShowAddTaskDialog(false);
                      setNewTaskTitle('');
                      setNewTaskDescription('');
                    } catch (error) {
                      toast({
                        title: 'Error',
                        description: 'Failed to add task',
                        variant: 'destructive',
                      });
                    }
                  }
                }}
              >
                Add Task
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Confirmation Dialog */}
      <Dialog
        open={showResetConfirmDialog}
        onOpenChange={setShowResetConfirmDialog}
      >
        <DialogContent className="w-[95vw] max-w-lg p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <AlertCircle className="w-5 h-5" />
              Reset Agenda Planning for Next Week?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2">
                <p className="text-gray-700">
                  <strong>This action will permanently:</strong>
                </p>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-orange-800">
                      <strong>
                        Convert all discussion and decision notes to tasks
                      </strong>{' '}
                      (if they haven't been already)
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <X className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-orange-800">
                      <strong>Clear all text boxes</strong> in discussion points
                      and decision items
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <RotateCcw className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-orange-800">
                      <strong>Reset all project selections</strong>{' '}
                      (agenda/tabled status)
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ExternalLink className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-orange-800">
                      <strong>Refresh projects list</strong> from Google Sheets
                      with any updates made during the week
                    </span>
                  </div>
                </div>
                <p className="text-gray-600 text-sm">
                  This prepares the agenda planning interface for next week's
                  meeting.
                  <strong>
                    {' '}
                    Make sure you've finalized this week's agenda first!
                  </strong>
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setShowResetConfirmDialog(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => resetAgendaPlanningMutation.mutate()}
              disabled={resetAgendaPlanningMutation.isPending}
              style={{ backgroundColor: '#FBAD3F' }}
              onMouseEnter={(e) =>
                !resetAgendaPlanningMutation.isPending &&
                ((e.target as HTMLElement).style.backgroundColor = '#e09d36')
              }
              onMouseLeave={(e) =>
                !resetAgendaPlanningMutation.isPending &&
                ((e.target as HTMLElement).style.backgroundColor = '#FBAD3F')
              }
              className="flex-1 text-white"
            >
              {resetAgendaPlanningMutation.isPending ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Resetting...
                </div>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Yes, Reset for Next Week
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add New Project Dialog */}
      <AddProjectDialog
        open={showAddProjectDialog}
        onOpenChange={setShowAddProjectDialog}
        newProjectData={newProjectData}
        setNewProjectData={setNewProjectData}
        handleCreateProject={handleCreateProject}
        isCreating={createProjectMutation.isPending}
      />
    </div>
  );
}