import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Calendar,
  Clock,
  FileText,
  MessageCircle,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Mail,
  ChevronDown,
  ChevronUp,
  SquareCheck,
  MessageSquare
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { logger } from '@/lib/logger';

// Helper function to properly format status text
const formatStatusText = (status: string): string => {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

interface DashboardItem {
  id: number;
  title: string;
  status: string;
  linkPath: string;
  count?: number;
  priority?: string;
  dueDate?: string;
  createdAt?: string;
  assignmentType?: string[];
  organizationName?: string;
}

interface DashboardData {
  projects: DashboardItem[];
  tasks: DashboardItem[];
  events: DashboardItem[];
  messages: DashboardItem[];
  counts: {
    projects: number;
    tasks: number;
    events: number;
    messages: number;
  };
}

interface DashboardActionTrackerProps {
  onNavigate: (path: string) => void;
}

const DashboardActionTracker = ({ onNavigate }: DashboardActionTrackerProps) => {
  const [isCollapsed, setIsCollapsed] = React.useState(true);

  const { data: dashboardData, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['/api/me/dashboard'],
    staleTime: 2 * 60 * 1000, // 2 minutes - action items need reasonable freshness
    refetchOnWindowFocus: true, // Refetch when user returns to ensure fresh data for real-time updates
  });

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return isValid(date) ? format(date, 'MMM d') : '';
    } catch {
      return '';
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-200';
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
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-brand-primary-light text-brand-primary-dark';
      case 'pending':
      case 'waiting':
        return 'bg-yellow-100 text-yellow-800';
      case 'new':
        return 'bg-gray-100 text-gray-800';
      case 'unread':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleNavigation = (linkPath: string) => {
    logger.log('🔗 Action Tracker handleNavigation called with:', linkPath);
    
    // Honor full linkPath for deep-linking to detail views
    // Extract the path and query parameters
    if (linkPath.startsWith('/dashboard?')) {
      // Remove the '/dashboard?' prefix and pass the full query string to maintain all parameters
      const queryString = linkPath.substring('/dashboard?'.length);
      const urlParams = new URLSearchParams(queryString);
      
      logger.log('📋 Parsed query string:', queryString);
      logger.log('🔍 URL params:', Object.fromEntries(urlParams.entries()));
      
      // Check if this is a project detail view
      if (urlParams.get('section') === 'projects' && urlParams.get('view') === 'detail' && urlParams.get('id')) {
        const projectId = urlParams.get('id');
        logger.log('🎯 Navigating to project detail:', projectId);
        // Navigate to project detail using the project-{id} format
        onNavigate(`project-${projectId}`);
        return;
      }
      
      // Check if this is an event detail view
      if (urlParams.get('section') === 'event-requests' && urlParams.get('eventId')) {
        const eventId = urlParams.get('eventId');
        logger.log('🎯 Navigating to event detail:', eventId);
        // Navigate to event requests with the specific event
        onNavigate(`event-requests?tab=all&eventId=${eventId}`);
        return;
      }
      
      // If we have other specific item parameters, navigate with full context
      if (urlParams.get('id') || urlParams.get('eventId') || urlParams.get('view') || urlParams.get('tab')) {
        // Pass the full query string to enable deep-linking
        logger.log('🎯 Navigating with full query string:', queryString);
        onNavigate(queryString);
      } else {
        // Fallback to just section if no specific parameters
        const section = urlParams.get('section') || 'dashboard';
        logger.log('🎯 Navigating to section:', section);
        onNavigate(section);
      }
    } else {
      // For non-dashboard paths, extract section as before
      const urlParams = new URLSearchParams(linkPath.split('?')[1] || '');
      const section = urlParams.get('section') || 'dashboard';
      logger.log('🎯 Navigating to non-dashboard section:', section);
      onNavigate(section);
    }
  };

  const [quickViewEvent, setQuickViewEvent] = React.useState<DashboardItem | null>(null);

  // Loading skeleton component
  const LoadingSkeleton = () => (
    <div className="space-y-3">
      <Skeleton className="h-4 w-3/4" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );

  // Item component for displaying individual items
  const ItemComponent = ({ item, type }: { item: DashboardItem; type: 'project' | 'task' | 'event' | 'message' }) => {
    if (type === 'event') {
      return (
        <Dialog>
          <DialogTrigger asChild>
            <div 
              className="p-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
              onClick={() => setQuickViewEvent(item)}
              data-testid={`item-${type}-${item.id}`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate text-[16px]" title={item.organizationName || item.title}>
                  {item.organizationName || item.title}
                </p>
                {item.dueDate && (
                  <p className="text-xs text-gray-600 truncate mt-0.5">
                    {formatDate(item.dueDate)}
                  </p>
                )}
                {item.assignmentType && item.assignmentType.length > 0 && (
                  <p className="text-xs text-purple-700 truncate mt-0.5">
                    {item.assignmentType.join(', ')}
                  </p>
                )}
              </div>
            </div>
          </DialogTrigger>
          {quickViewEvent && quickViewEvent.id === item.id && (
            <DialogContent className="w-[95vw] max-w-md p-4 sm:p-6">
              <DialogHeader>
                <DialogTitle>Event Quick View</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <div>
                  <span className="font-semibold">Organization:</span> {quickViewEvent.organizationName || quickViewEvent.title}
                </div>
                {quickViewEvent.dueDate && (
                  <div>
                    <span className="font-semibold">Date:</span> {formatDate(quickViewEvent.dueDate)}
                  </div>
                )}
                {quickViewEvent.assignmentType && quickViewEvent.assignmentType.length > 0 && (
                  <div>
                    <span className="font-semibold">Your Role:</span> {quickViewEvent.assignmentType.join(', ')}
                  </div>
                )}
                {/* Add more fields as needed */}
                <div className="pt-2">
                  <a
                    href={`/dashboard?section=event-requests&tab=all&eventId=${quickViewEvent.id}`}
                    className="inline-block bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    View Full Event
                  </a>
                </div>
              </div>
              <DialogClose asChild>
                <button className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">✕</button>
              </DialogClose>
            </DialogContent>
          )}
        </Dialog>
      );
    }
    // Default for other types (project, task, message)
    return (
      <div 
        className="p-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
        onClick={() => handleNavigation(item.linkPath)}
        data-testid={`item-${type}-${item.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 truncate text-[16px]" title={item.title}>
              {item.title}
            </p>
            {item.organizationName && (
              <p className="text-xs text-gray-600 truncate" title={item.organizationName}>
                {item.organizationName}
              </p>
            )}
          </div>
        </div>
        {item.dueDate && (
          <div className="flex items-center gap-1 mt-1">
            <Clock className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">
              Due {formatDate(item.dueDate)}
            </span>
          </div>
        )}
      </div>
    );
  };

  // Zero state component
  const ZeroState = ({ type, icon: Icon, message }: { type: string; icon: any; message: string }) => (
    <div className="text-center py-6" data-testid={`zero-state-${type}`}>
      <Icon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );

  if (error) {
    return (
      <Card className="border-red-200" data-testid="dashboard-tracker-error">
        <CardContent className="flex items-center justify-center py-12 text-red-600">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4" />
            <p className="text-lg font-medium">Failed to load action items</p>
            <p className="text-sm">Please try refreshing the page</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="dashboard-action-tracker">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2">
          <h2 className="font-bold mb-2 text-[20px] text-[#236383]">My Action Tracker</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="mb-2"
            data-testid="collapse-action-tracker"
          >
            {isCollapsed ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
          </Button>
        </div>
        <p className="text-gray-600">Stay on top of your assigned work and communications</p>
        
        {/* Collapsed State Summary */}
        {isCollapsed && (
          <div className="mt-4 inline-flex items-center gap-3 bg-gray-50 px-6 py-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => setIsCollapsed(false)}>
            {isLoading ? (
              <span className="text-sm text-gray-600">Loading...</span>
            ) : (
              <>
                {dashboardData?.counts && (
                  <>
                    {dashboardData.counts.projects > 0 && (
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-[#236383]" />
                        <span className="text-sm font-semibold text-[#236383]">{dashboardData.counts.projects}</span>
                        <span className="text-sm text-gray-600">{dashboardData.counts.projects === 1 ? 'Project' : 'Projects'}</span>
                      </div>
                    )}
                    {dashboardData.counts.tasks > 0 && (
                      <div className="flex items-center gap-1.5">
                        <SquareCheck className="w-4 h-4 text-[#007E8C]" />
                        <span className="text-sm font-semibold text-[#007E8C]">{dashboardData.counts.tasks}</span>
                        <span className="text-sm text-gray-600">{dashboardData.counts.tasks === 1 ? 'Task' : 'Tasks'}</span>
                      </div>
                    )}
                    {dashboardData.counts.events > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-[#47B3CB]" />
                        <span className="text-sm font-semibold text-[#47B3CB]">{dashboardData.counts.events}</span>
                        <span className="text-sm text-gray-600">{dashboardData.counts.events === 1 ? 'Event' : 'Events'}</span>
                      </div>
                    )}
                    {dashboardData.counts.messages > 0 && (
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="w-4 h-4 text-[#FBAD3F]" />
                        <span className="text-sm font-semibold text-[#FBAD3F]">{dashboardData.counts.messages}</span>
                        <span className="text-sm text-gray-600">{dashboardData.counts.messages === 1 ? 'Message' : 'Messages'}</span>
                      </div>
                    )}
                    {dashboardData.counts.projects === 0 && dashboardData.counts.tasks === 0 && dashboardData.counts.events === 0 && dashboardData.counts.messages === 0 && (
                      <span className="text-sm text-gray-500">No pending items</span>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {!isCollapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Projects Card */}
        <Card className="hover:shadow-md transition-shadow" data-testid="projects-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-brand-primary-muted" />
              <span className="text-[#236383] text-[18px]">Projects</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <LoadingSkeleton />
            ) : !dashboardData?.projects || dashboardData.projects.length === 0 ? (
              <ZeroState 
                type="projects"
                icon={FileText} 
                message="No assigned projects found. Projects you're assigned to will appear here." 
              />
            ) : (
              <div className="space-y-1">
                {dashboardData.projects.map((project) => (
                  <ItemComponent key={project.id} item={project} type="project" />
                ))}
                {dashboardData.counts.projects > 3 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full mt-2 text-brand-primary-muted hover:text-brand-primary-dark" 
                    onClick={() => onNavigate('projects')}
                    data-testid="projects-view-all"
                  >
                    View all {dashboardData.counts.projects} projects <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Events Card */}
        <Card className="hover:shadow-md transition-shadow" data-testid="events-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-purple-600" />
              <span className="text-[18px] text-[#236383]">Events</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <LoadingSkeleton />
            ) : !dashboardData?.events || dashboardData.events.length === 0 ? (
              <ZeroState 
                type="events"
                icon={Calendar} 
                message="No assigned events found. Event requests assigned to you will appear here." 
              />
            ) : (
              <div className="space-y-1">
                {dashboardData.events.map((event) => (
                  <ItemComponent key={event.id} item={event} type="event" />
                ))}
                {dashboardData.counts.events > 3 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full mt-2 text-purple-600 hover:text-purple-800" 
                    onClick={() => onNavigate('event-requests')}
                    data-testid="events-view-all"
                  >
                    View all {dashboardData.counts.events} events <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tasks Card */}
        <Card className="hover:shadow-md transition-shadow" data-testid="tasks-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-[18px] text-[#236383]">Tasks</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <LoadingSkeleton />
            ) : !dashboardData?.tasks || dashboardData.tasks.length === 0 ? (
              <ZeroState 
                type="tasks"
                icon={CheckCircle} 
                message="No pending tasks found. Tasks assigned to you will appear here." 
              />
            ) : (
              <div className="space-y-1">
                {dashboardData.tasks.map((task) => (
                  <ItemComponent key={task.id} item={task} type="task" />
                ))}
                {dashboardData.counts.tasks > 3 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-2 text-green-600 hover:text-green-800"
                    onClick={() => onNavigate('team-board')}
                    data-testid="tasks-view-all"
                  >
                    View all {dashboardData.counts.tasks} tasks <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Messages Card */}
        <Card className="hover:shadow-md transition-shadow" data-testid="messages-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-orange-600" />
              <span className="text-[18px] text-[#236383]">Messages</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <LoadingSkeleton />
            ) : !dashboardData?.messages || dashboardData.messages.length === 0 ? (
              <ZeroState 
                type="messages"
                icon={Mail} 
                message="No unread messages found. New messages will appear here." 
              />
            ) : (
              <div className="space-y-1">
                {dashboardData.messages.map((message) => (
                  <ItemComponent key={message.id} item={message} type="message" />
                ))}
                {dashboardData.counts.messages > 3 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full mt-2 text-orange-600 hover:text-orange-800" 
                    onClick={() => onNavigate('messages')}
                    data-testid="messages-view-all"
                  >
                    View all {dashboardData.counts.messages} messages <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}
      {/* Quick Action Buttons */}
      {!isLoading && dashboardData && (
        <div className="flex flex-wrap justify-center gap-4 pt-4 border-t border-gray-200">
          <Button
            variant="outline"
            className="text-[16px]"
            onClick={() => onNavigate('projects')}
            data-testid="manage-projects"
          >
            Manage Projects
          </Button>
          <Button 
            variant="outline" 
            className="text-[16px]"
            onClick={() => onNavigate('messages')}
            data-testid="check-messages"
          >
            Check Messages
          </Button>
        </div>
      )}
    </div>
  );
};

export default DashboardActionTracker;