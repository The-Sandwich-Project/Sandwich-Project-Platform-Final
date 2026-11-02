import React, { useState } from 'react';
import { ProjectTask } from '@shared/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, Calendar, User, Trash2, Edit } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface StandaloneTasksTabProps {
  tasks: ProjectTask[];
  emptyMessage?: string;
}

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'high':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'low':
      return 'bg-green-100 text-green-800 border-green-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'in_progress':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'pending':
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export const StandaloneTasksTab: React.FC<StandaloneTasksTabProps> = ({
  tasks,
  emptyMessage = 'No to-do tasks found'
}) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showCompleted, setShowCompleted] = useState(false);

  // Separate active and completed tasks
  const activeTasks = tasks.filter(t => t.status !== 'completed');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  const displayTasks = showCompleted ? tasks : activeTasks;

  const handleToggleComplete = async (task: ProjectTask) => {
    try {
      const newStatus = task.status === 'completed' ? 'pending' : 'completed';
      await apiRequest('PATCH', `/api/projects/standalone-tasks/${task.id}`, {
        status: newStatus,
        completedAt: newStatus === 'completed' ? new Date().toISOString() : null,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/projects/standalone-tasks'] });
      toast({
        title: newStatus === 'completed' ? 'Task Completed!' : 'Task Reopened',
        description: task.title,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update task',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteTask = async (task: ProjectTask) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;

    try {
      await apiRequest('DELETE', `/api/projects/standalone-tasks/${task.id}`);
      queryClient.invalidateQueries({ queryKey: ['/api/projects/standalone-tasks'] });
      toast({
        title: 'Task Deleted',
        description: task.title,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete task',
        variant: 'destructive',
      });
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <CheckCircle2 className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500 font-roboto">{emptyMessage}</p>
        <p className="text-sm text-gray-400 mt-2">
          Standalone tasks are to-do items not tied to any specific project
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toggle for showing completed tasks */}
      {completedTasks.length > 0 && (
        <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-3">
          <span className="text-sm text-gray-600 font-roboto">
            {activeTasks.length} active, {completedTasks.length} completed
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCompleted(!showCompleted)}
            className="text-[#236383] hover:text-[#236383]/80"
          >
            {showCompleted ? 'Hide Completed' : 'Show Completed'}
          </Button>
        </div>
      )}

      {/* Task List */}
      <div className="space-y-3" data-testid="standalone-tasks-list">
        {displayTasks.map((task) => (
          <div
            key={task.id}
            className={`bg-white rounded-lg border shadow-sm p-4 transition-all ${
              task.status === 'completed'
                ? 'border-gray-200 bg-gray-50'
                : 'border-gray-200 hover:shadow-md'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Completion Checkbox */}
              <div className="pt-1">
                <Checkbox
                  checked={task.status === 'completed'}
                  onCheckedChange={() => handleToggleComplete(task)}
                  className="h-5 w-5"
                />
              </div>

              {/* Task Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h4
                      className={`font-medium text-gray-900 font-roboto ${
                        task.status === 'completed' ? 'line-through text-gray-500' : ''
                      }`}
                    >
                      {task.status === 'completed' && (
                        <CheckCircle2 className="inline w-4 h-4 mr-2 text-green-600" />
                      )}
                      {task.title}
                    </h4>
                    {task.description && (
                      <p
                        className={`mt-1 text-sm text-gray-600 font-roboto ${
                          task.status === 'completed' ? 'line-through text-gray-400' : ''
                        }`}
                      >
                        {task.description}
                      </p>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteTask(task)}
                      className="text-gray-400 hover:text-red-600 p-1 h-auto"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Task Metadata */}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Badge className={`${getPriorityColor(task.priority)} font-roboto text-xs`}>
                    {task.priority}
                  </Badge>
                  <Badge className={`${getStatusColor(task.status)} font-roboto text-xs`}>
                    {task.status.replace('_', ' ')}
                  </Badge>

                  {task.dueDate && (
                    <span className="flex items-center text-xs text-gray-500 font-roboto">
                      <Calendar className="w-3 h-3 mr-1" />
                      {new Date(task.dueDate).toLocaleDateString()}
                    </span>
                  )}

                  {(task.assigneeName || (task.assigneeNames && task.assigneeNames.length > 0)) && (
                    <span className="flex items-center text-xs text-gray-500 font-roboto">
                      <User className="w-3 h-3 mr-1" />
                      {task.assigneeNames && task.assigneeNames.length > 0
                        ? task.assigneeNames.join(', ')
                        : task.assigneeName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
