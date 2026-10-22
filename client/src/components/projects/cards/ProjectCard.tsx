import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Circle,
  Play,
  CheckCircle2,
  Archive,
  Settings,
  Edit,
  Trash2,
  User,
  Calendar,
  ArrowRight,
  Clock,
  AlertTriangle,
  Users,
  MoreVertical,
  FolderOpen,
  Package,
  Target,
  Megaphone,
  Code,
  Building,
  Heart,
  DollarSign,
} from 'lucide-react';
import { Project } from '@shared/schema';
import { useAuth } from '@/hooks/useAuth';
import {
  canEditProject as canEditProjectPermission,
  canDeleteProject as canDeleteProjectPermission,
} from '@shared/auth-utils';
import { useProjectQueries } from '../hooks/useProjectQueries';
import { useProjectMutations } from '../hooks/useProjectMutations';
import { useProjectContext } from '../context/ProjectContext';
import SendKudosButton from '@/components/send-kudos-button';

interface ProjectCardProps {
  project: Project;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  const { user } = useAuth();
  const { parseAssignees } = useProjectQueries();
  const {
    updateProjectStatusMutation,
    deleteProjectMutation,
    archiveProjectMutation,
    unarchiveProjectMutation,
  } = useProjectMutations();
  const { setEditingProject, setShowEditDialog } = useProjectContext();

  // Helper functions
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'tabled':
        return <Circle className="w-4 h-4" />;
      case 'in_progress':
        return <Play className="w-4 h-4" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'archived':
        return <Archive className="w-4 h-4" />;
      default:
        return <Circle className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'tabled':
        return 'text-gray-500 bg-gray-50 border-gray-200';
      case 'in_progress':
        return 'text-[#236383] bg-[#e6f2f5] border-[#236383]/30';
      case 'completed':
        return 'text-[#A31C41] bg-[#fdf2f8] border-[#A31C41]/30';
      case 'archived':
        return 'text-gray-400 bg-gray-50 border-gray-200';
      default:
        return 'text-gray-500 bg-gray-50 border-gray-200';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'low':
        return 'bg-gray-100 text-gray-700';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700';
      case 'high':
        return 'bg-[#FBAD3F] text-white';
      case 'urgent':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'technology':
        return <Code className="w-4 h-4" />;
      case 'marketing':
        return <Megaphone className="w-4 h-4" />;
      case 'operations':
        return <Building className="w-4 h-4" />;
      case 'community':
        return <Heart className="w-4 h-4" />;
      case 'fundraising':
        return <DollarSign className="w-4 h-4" />;
      case 'event':
        return <Calendar className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  const formatDate = (dateStr: string | Date | null) => {
    if (!dateStr) return 'No date set';
    try {
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return 'Invalid date';
    }
  };

  const userCanEditProject = React.useMemo(
    () => (user ? canEditProjectPermission(user, project) : false),
    [user, project]
  );

  const userCanDeleteProject = React.useMemo(
    () => (user ? canDeleteProjectPermission(user, project) : false),
    [user, project]
  );

  const primaryAssigneeId = React.useMemo(() => {
    if (Array.isArray(project.assigneeIds) && project.assigneeIds.length > 0) {
      const firstValid = project.assigneeIds.find(
        (id) => id !== null && id !== undefined && `${id}`.trim().length > 0
      );

      if (firstValid !== undefined && firstValid !== null) {
        return firstValid.toString();
      }
    }

    if (project.assigneeId !== null && project.assigneeId !== undefined) {
      return project.assigneeId.toString();
    }

    return '';
  }, [project.assigneeIds, project.assigneeId]);

  const handleEdit = () => {
    setEditingProject(project);
    setShowEditDialog(true);
  };

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete "${project.title}"?`)) {
      deleteProjectMutation.mutate(project.id);
    }
  };

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === 'archived') {
      archiveProjectMutation.mutate(project.id);
    } else {
      updateProjectStatusMutation.mutate({ id: project.id, status: newStatus });
    }
  };

  const handleUnarchive = () => {
    unarchiveProjectMutation.mutate({ id: project.id, status: 'tabled' });
  };

  // Parse support people
  const supportPeople = parseAssignees(project.supportPeople || '');

  // Check if project is overdue
  const isOverdue = project.dueDate &&
    new Date(project.dueDate) < new Date() &&
    project.status !== 'completed' &&
    project.status !== 'archived';

  return (
    <Card
      className={`group hover:shadow-lg transition-all duration-200 ${
        project.googleSheetRowId ? 'border-l-4 border-l-[#236383]' :
        'border-l-4 border-l-[#FBAD3F]'
      }`}
      data-testid="project-card"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              {/* Status Badge */}
              <Badge className={`${getStatusColor(project.status)} border`}>
                {getStatusIcon(project.status)}
                <span className="ml-1 capitalize">
                  {project.status.replace('_', ' ')}
                </span>
              </Badge>

              {/* Priority Badge */}
              <Badge className={getPriorityColor(project.priority || 'medium')}>
                {project.priority || 'medium'}
              </Badge>


              {/* Overdue Badge */}
              {isOverdue && (
                <Badge className="bg-red-100 text-red-700">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Overdue
                </Badge>
              )}
            </div>

            <h3 className="text-lg font-semibold mt-2 text-gray-900 truncate pr-8 font-roboto">
              {project.title}
            </h3>

            {project.description && (
              <p className="text-sm text-gray-600 mt-1 line-clamp-2 font-roboto">
                {project.description}
              </p>
            )}
          </div>

          {/* Actions Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {userCanEditProject && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleEdit}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Status Changes */}
              {userCanEditProject &&
                project.status !== 'completed' &&
                project.status !== 'archived' && (
                <>
                  {project.status === 'tabled' && (
                    <DropdownMenuItem onClick={() => handleStatusChange('in_progress')}>
                      <Play className="w-4 h-4 mr-2" />
                      Start Progress
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleStatusChange('completed')}>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Mark Complete
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleStatusChange('archived')}>
                    <Archive className="w-4 h-4 mr-2" />
                    Archive
                  </DropdownMenuItem>
                </>
              )}

              {/* Completed projects can be archived */}
              {userCanEditProject && project.status === 'completed' && (
                <DropdownMenuItem onClick={() => handleStatusChange('archived')}>
                  <Archive className="w-4 h-4 mr-2" />
                  Archive
                </DropdownMenuItem>
              )}

              {userCanEditProject && project.status === 'archived' && (
                <DropdownMenuItem onClick={handleUnarchive}>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Restore from Archive
                </DropdownMenuItem>
              )}

              {userCanDeleteProject && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDelete} className="text-red-600">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Category and Dates */}
          <div className="flex items-center gap-4 text-sm text-gray-600 font-roboto">
            <div className="flex items-center gap-1">
              {getCategoryIcon(project.category || 'technology')}
              <span className="capitalize text-[15px]">{project.category || 'technology'}</span>
            </div>

            {project.dueDate && (
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                <span className={`text-[15px] ${isOverdue ? 'text-[#236383]' : ''}`}>
                  {formatDate(project.dueDate)}
                </span>
              </div>
            )}

            {project.estimatedHours && project.estimatedHours > 0 && (
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span>{project.estimatedHours}h estimated</span>
              </div>
            )}
          </div>

          {/* Assignees */}
          <div className="flex flex-wrap gap-2">
            {/* Project Owner */}
            {project.assigneeName && (
              <div className="flex items-center gap-1">
                <Badge className="flex items-center gap-1 bg-[#FBAD3F] text-white">
                  <User className="w-3 h-3" />
                  <span className="text-[14px]">Owner:</span>
                  <span className="font-medium text-[14px]">{project.assigneeName}</span>
                </Badge>
                {primaryAssigneeId && (
                  <SendKudosButton
                    recipientId={primaryAssigneeId}
                    recipientName={project.assigneeName}
                    contextType="project"
                    contextId={project.id.toString()}
                    contextTitle={project.title}
                    size="sm"
                    variant="ghost"
                  />
                )}
              </div>
            )}

            {/* Support People */}
            {supportPeople.length > 0 && (
              <div className="bg-[#236383] text-white px-3 py-2 rounded-md">
                <div className="flex items-center gap-1 mb-1">
                  <Users className="w-3 h-3" />
                  <span className="text-[14px] font-bold">Support Team:</span>
                </div>
                <div className="text-[14px]">{supportPeople.join(', ')}</div>
              </div>
            )}
          </div>

          {/* Progress Bar (if in progress) */}
          {project.status === 'in_progress' && project.estimatedHours && project.actualHours && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-600">
                <span>Progress</span>
                <span>{Math.round((project.actualHours / project.estimatedHours) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-[#FBAD3F] h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (project.actualHours / project.estimatedHours) * 100)}%`
                  }}
                />
              </div>
            </div>
          )}

          {/* View Details Button */}
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between hover:bg-gray-50"
              onClick={() => window.location.href = `/projects/${project.id}`}
            >
              View Details
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};