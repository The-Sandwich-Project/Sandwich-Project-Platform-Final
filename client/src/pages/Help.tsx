import { useState, useMemo, useEffect } from 'react';
import {
  HelpCircle,
  Search,
  ChevronDown,
  ChevronRight,
  PlayCircle,
  FolderOpen,
  Calendar,
  BarChart3,
  ListTodo,
  Users,
  FileImage,
  ClipboardList,
  TrendingUp,
  LayoutDashboard,
  Clock,
  MessageCircle,
  StickyNote,
  Inbox,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { TOURS, TOUR_CATEGORIES, type TourCategory, type Tour } from '@/lib/tourDefinitions';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@shared/unified-auth-utils';
import { PERMISSIONS } from '@shared/auth-utils';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';

interface HelpTopic {
  id: string;
  title: string;
  description: string;
  category: TourCategory;
  icon: any;
  content: {
    summary: string;
    steps: string[];
    tips?: string[];
  };
  tourId?: string;
  requiredPermissions?: string[];
}

const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'finding-logos',
    title: 'Finding TSP Logos',
    description: 'Learn where to find all TSP brand logos and marketing assets',
    category: 'files-resources',
    icon: FileImage,
    tourId: 'find-logos',
    requiredPermissions: [PERMISSIONS.NAV_IMPORTANT_DOCUMENTS],
    content: {
      summary: 'The Sandwich Project logos are available in the Logos & Branding tab of Important Documents.',
      steps: [
        'Navigate to "Important Documents" from the main menu',
        'Click on the "Logos & Branding" tab at the top',
        'Browse and download logos in various formats (PNG, JPG, transparent backgrounds)',
      ],
      tips: [
        'Use the transparent background logos for overlaying on different backgrounds',
        'CMYK versions are best for print materials',
        'RGB versions are optimized for digital/web use',
      ],
    },
  },
  {
    id: 'sandwich-signin-forms',
    title: 'Sandwich Sign-In Forms',
    description: 'Access forms used at sandwich collection events',
    category: 'files-resources',
    icon: ClipboardList,
    tourId: 'sandwich-signin-forms',
    requiredPermissions: [PERMISSIONS.NAV_TOOLKIT],
    content: {
      summary: 'Sign-in forms are used to track participants at sandwich collection events and are stored in the Toolkit.',
      steps: [
        'Go to "Important Documents" in the navigation',
        'Select the "Toolkit" tab',
        'Look for "SandwichSigninNoEmail.pdf" or similar sign-in form files',
        'Download and print the forms for your event',
      ],
      tips: [
        'Print enough forms for expected participants',
        'Forms help track volunteer hours and participation',
        'Submit completed forms to the admin team after events',
      ],
    },
  },
  {
    id: 'analytics-tabs',
    title: 'Analytics Dashboard Overview',
    description: 'Understanding the different analytics tabs and what they show',
    category: 'analytics-reports',
    icon: TrendingUp,
    tourId: 'analytics-overview',
    requiredPermissions: [PERMISSIONS.NAV_ANALYTICS],
    content: {
      summary: 'The Analytics dashboard provides comprehensive insights into TSP\'s impact and performance across multiple views.',
      steps: [
        'Navigate to "Analytics" from the main menu',
        'Impact Dashboard: View overall community impact, collection trends, and key metrics',
        'Host Analytics: See detailed performance metrics for individual hosts',
        'Breakdown Analytics: Analyze data by location, time period, and other dimensions',
        'Use filters and date ranges to customize your view',
      ],
      tips: [
        'Export data as CSV or PDF for reports and presentations',
        'Compare different time periods to identify trends',
        'Use the visual charts to communicate impact to stakeholders',
      ],
    },
  },
  {
    id: 'action-hub',
    title: 'Using My Actions Hub',
    description: 'Your central hub for all assigned tasks and responsibilities',
    category: 'my-work',
    icon: ListTodo,
    tourId: 'action-hub-guide',
    requiredPermissions: [PERMISSIONS.NAV_MY_ACTIONS],
    content: {
      summary: 'My Actions is your personal dashboard where all tasks assigned to you are collected in one place.',
      steps: [
        'Click on "My Actions" in the navigation menu',
        'View all tasks across different categories (events, projects, etc.)',
        'Use filters to see: All, Pending, Completed, or Overdue tasks',
        'Click on any task to view details and take action',
        'Mark tasks as complete when finished',
      ],
      tips: [
        'Check My Actions daily to stay on top of your responsibilities',
        'Overdue tasks are highlighted in red - prioritize these first',
        'Completed tasks remain visible for your records',
      ],
    },
  },
  {
    id: 'my-assignments-events',
    title: 'My Assignments in Event Requests',
    description: 'Find and manage events specifically assigned to you',
    category: 'my-work',
    icon: Calendar,
    tourId: 'event-requests-assignments',
    requiredPermissions: [PERMISSIONS.EVENT_REQUESTS_VIEW],
    content: {
      summary: 'The My Assignments tab in Event Requests shows only events where you have specific responsibilities.',
      steps: [
        'Navigate to "Event Requests" from the menu',
        'Click on the "My Assignments" tab',
        'View all events where you are assigned',
        'Click on an event card to see your specific tasks',
        'Update status and complete required actions',
      ],
      tips: [
        'This view filters out all events not assigned to you',
        'Assignment types can include coordination, setup, or follow-up tasks',
        'Communicate with the event organizer if you have questions',
      ],
    },
  },
  {
    id: 'dashboard-assignments',
    title: 'Dashboard Assignments Widget',
    description: 'Quick overview of your assignments on the main dashboard',
    category: 'my-work',
    icon: LayoutDashboard,
    tourId: 'dashboard-assignments',
    requiredPermissions: [PERMISSIONS.NAV_DASHBOARD],
    content: {
      summary: 'The dashboard provides a quick snapshot of your current assignments without navigating to different sections.',
      steps: [
        'Go to the main "Dashboard"',
        'Locate the "My Assignments" widget',
        'See at-a-glance what needs your attention',
        'Click on any assignment to jump directly to that task',
      ],
      tips: [
        'The dashboard shows your most urgent assignments first',
        'Badges indicate the number of pending items',
        'Use this as your daily starting point',
      ],
    },
  },
  {
    id: 'calendar-view',
    title: 'Calendar View & Status Symbols',
    description: 'Understanding the event calendar and status indicators',
    category: 'events-calendar',
    icon: Calendar,
    tourId: 'calendar-symbols',
    requiredPermissions: [PERMISSIONS.EVENT_REQUESTS_VIEW],
    content: {
      summary: 'The calendar view provides a visual timeline of events with color-coded status indicators.',
      steps: [
        'Navigate to "Event Requests"',
        'Click on the "Calendar" tab',
        'View events organized by date',
        'Understanding status symbols:',
        '  🟢 Green = Confirmed event',
        '  🟡 Yellow = Pending approval',
        '  🔵 Blue = In progress',
        '  ✅ Checkmark = Completed',
        'Click on any event for full details',
      ],
      tips: [
        'Use navigation arrows to view different months',
        'Hover over events for quick details',
        'Filter by status to focus on specific event types',
      ],
    },
  },
  {
    id: 'team-chat',
    title: 'Using Team Chat',
    description: 'Communicate with your team using chat rooms',
    category: 'team-management',
    icon: MessageCircle,
    tourId: 'team-chat-guide',
    requiredPermissions: [PERMISSIONS.MESSAGES_VIEW],
    content: {
      summary: 'Team Chat is your communication hub for messaging teammates, joining conversations, and staying connected.',
      steps: [
        'Navigate to "Team Chat" from the main menu',
        'Browse your chat rooms on the left sidebar',
        'Click on a room to view conversations',
        'Type your message in the input box at the bottom',
        'Use @name to mention someone and notify them',
        'Send messages to communicate with your team',
      ],
      tips: [
        'General chat is for team-wide announcements',
        'Mention people with @ to get their attention',
        'Different rooms are available for different committees or topics',
        'Messages are real-time - no need to refresh',
      ],
    },
  },
  {
    id: 'team-board',
    title: 'Using Team Board',
    description: 'Post and manage shared tasks, ideas, and notes',
    category: 'team-management',
    icon: StickyNote,
    tourId: 'team-board-guide',
    requiredPermissions: [PERMISSIONS.BOARD_VIEW],
    content: {
      summary: 'Team Board is a collaborative space where team members can post tasks, ideas, notes, and reminders.',
      steps: [
        'Navigate to "Team Board" from the main menu',
        'Click "Create New Item" to post something',
        'Choose the type: Task, Idea, Note, or Reminder',
        'Fill in the details and post to the board',
        'View items organized by status: Open, In Progress, Done',
        'Claim tasks or assign them to teammates',
        'Add comments to items to collaborate',
      ],
      tips: [
        'Claim a task to show you\'re working on it',
        'Move tasks between columns as you progress',
        'Use comments for discussions about specific items',
        'Great for organizing ad-hoc work that doesn\'t fit in projects',
      ],
    },
  },
  {
    id: 'collections-log',
    title: 'Logging Sandwich Collections',
    description: 'Record and track sandwich collections from events',
    category: 'events-calendar',
    icon: ClipboardList,
    tourId: 'collections-log-guide',
    requiredPermissions: [PERMISSIONS.NAV_COLLECTIONS_LOG],
    content: {
      summary: 'The Collections Log is where you record sandwiches collected at events to track community impact.',
      steps: [
        'Navigate to "Collections Log" from the main menu',
        'Click "Add New Collection" button',
        'Enter the collection date',
        'Select the host organization',
        'Enter the number of sandwiches collected',
        'Add any notes about the event',
        'Submit to log the collection',
        'View history of all past collections',
      ],
      tips: [
        'Log collections promptly after events',
        'Include notes about weather, volunteer count, or special circumstances',
        'Use filters to view collections by date or host',
        'This data feeds into Analytics and Grant Metrics',
      ],
    },
  },
  {
    id: 'inbox',
    title: 'Using Your Inbox',
    description: 'Send messages and kudos to team members',
    category: 'team-management',
    icon: Inbox,
    tourId: 'inbox-messages-guide',
    requiredPermissions: [PERMISSIONS.MESSAGES_VIEW],
    content: {
      summary: 'The Inbox is your personal message center for important communications and kudos.',
      steps: [
        'Navigate to "Inbox" from the main menu',
        'View messages organized in folders (Inbox, Sent, Starred, Kudos)',
        'Click "Compose" to send a new message',
        'Select recipient and write your message',
        'Toggle "Send as Kudos" to publicly recognize great work',
        'Kudos messages appear on the recipient\'s profile',
      ],
      tips: [
        'Use the Kudos folder to see all appreciation messages',
        'Star important messages for quick access',
        'Kudos are a great way to celebrate team wins',
        'Messages are private unless sent as kudos',
      ],
    },
  },
  {
    id: 'projects',
    title: 'Projects Management',
    description: 'Create and manage team projects',
    category: 'my-work',
    icon: ListTodo,
    tourId: 'projects-guide',
    requiredPermissions: [PERMISSIONS.NAV_PROJECTS],
    content: {
      summary: 'Projects help organize major initiatives and ongoing work with tasks, milestones, and team collaboration.',
      steps: [
        'Navigate to "Projects" from the main menu',
        'Click "Create New Project" to start a project',
        'Set project title, description, timeline, and assign team members',
        'Add tasks and milestones to track progress',
        'Click on any project to view details and updates',
        'Collaborate with team members through project comments',
      ],
      tips: [
        'Filter projects by status: Active, Completed, or Archived',
        'Use milestones to track major project checkpoints',
        'Assign tasks to specific team members',
        'Keep project descriptions updated for clarity',
      ],
    },
  },
  {
    id: 'hosts',
    title: 'Managing Host Organizations',
    description: 'Manage host organization contacts for sandwich collections',
    category: 'events-calendar',
    icon: Building2,
    tourId: 'hosts-management-guide',
    requiredPermissions: [PERMISSIONS.NAV_HOSTS],
    content: {
      summary: 'Host organizations are groups that collect sandwiches for The Sandwich Project.',
      steps: [
        'Navigate to "Hosts" from the main menu',
        'Use the search bar to find specific host organizations or contacts',
        'Browse all host contacts by name, location, or role',
        'View contact details including phone numbers and roles',
        'Check availability status for coordinating collection events',
      ],
      tips: [
        'Keep contact information up-to-date for effective communication',
        'Review host profiles before scheduling events',
        'Use search to quickly find specific hosts or contacts',
        'Check availability indicators to find active hosts',
      ],
    },
  },
  {
    id: 'event-reminders',
    title: 'Setting Up Event Reminders',
    description: 'Create automated reminders for upcoming events',
    category: 'events-calendar',
    icon: Clock,
    tourId: 'event-reminders-guide',
    requiredPermissions: [PERMISSIONS.NAV_EVENT_REMINDERS],
    content: {
      summary: 'Event Reminders help ensure no events are forgotten with automated notifications.',
      steps: [
        'Navigate to "Event Reminders" from the main menu',
        'Click "Create Event Reminder" to set up a new reminder',
        'Select the event you want to create a reminder for',
        'Choose when to send the reminder (1 day, 1 week, custom)',
        'Select who should receive the reminder',
        'View pending and completed reminders in separate tabs',
      ],
      tips: [
        'Set multiple reminders for important events',
        'Use custom intervals for specific timing needs',
        'Switch between Pending and Completed tabs to track reminder history',
        'Complete reminders after following up',
      ],
    },
  },
  {
    id: 'my-availability',
    title: 'Setting Your Availability',
    description: 'Manage when you\'re available for volunteer activities',
    category: 'my-work',
    icon: Calendar,
    tourId: 'my-availability-guide',
    requiredPermissions: [PERMISSIONS.NAV_MY_AVAILABILITY],
    content: {
      summary: 'Your availability helps coordinators know when you can volunteer.',
      steps: [
        'Navigate to "My Availability" from the main menu',
        'Use the form to indicate when you\'re available for volunteer work',
        'Specify dates, times, or recurring patterns',
        'Save your availability preferences',
        'Update as needed when your schedule changes',
      ],
      tips: [
        'Update availability regularly to help with scheduling',
        'Be specific about times and dates when possible',
        'Mark yourself unavailable for vacations or busy periods',
        'Coordinators can view your availability when planning events',
      ],
    },
  },
  {
    id: 'volunteers',
    title: 'Managing Volunteers',
    description: 'Add and manage volunteer information',
    category: 'team-management',
    icon: Users,
    tourId: 'volunteers-management-guide',
    requiredPermissions: [PERMISSIONS.NAV_VOLUNTEERS],
    content: {
      summary: 'The volunteer management system helps track and coordinate all volunteers supporting TSP.',
      steps: [
        'Navigate to "Volunteers" from the main menu',
        'Click "Add New Volunteer" to register someone',
        'Enter contact info, skills, availability, and preferences',
        'Browse the volunteer directory',
        'Search by name or filter by skills and availability',
        'Click on a volunteer to view their full profile and history',
      ],
      tips: [
        'Keep volunteer information current for effective coordination',
        'Use skills filters to find volunteers for specific tasks',
        'Review participation history to recognize active volunteers',
        'Respect volunteer preferences when scheduling',
      ],
    },
  },
];

const CATEGORY_ICONS: Record<string, any> = {
  FolderOpen,
  Calendar,
  BarChart3,
  ListTodo,
  Users,
};

interface HelpProps {
  onLaunchTour?: (tourId: string) => void;
}

export default function Help({ onLaunchTour }: HelpProps) {
  const { trackView, trackSearch, trackClick } = useActivityTracker();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TourCategory | null>(null);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  useEffect(() => {
    trackView(
      'Help',
      'Help',
      'Help Center',
      'User accessed help center'
    );
  }, [trackView]);

  const filteredTopics = useMemo(() => {
    let topics = HELP_TOPICS;

    // Filter by permissions - only show topics the user has access to
    topics = topics.filter((topic) => {
      // If no permissions required, show to everyone
      if (!topic.requiredPermissions || topic.requiredPermissions.length === 0) {
        return true;
      }
      // Check if user has at least one of the required permissions
      return topic.requiredPermissions.some((permission) =>
        hasPermission(user, permission)
      );
    });

    if (selectedCategory) {
      topics = topics.filter((topic) => topic.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      topics = topics.filter(
        (topic) =>
          topic.title.toLowerCase().includes(query) ||
          topic.description.toLowerCase().includes(query) ||
          topic.content.summary.toLowerCase().includes(query) ||
          topic.content.steps.some((step) => step.toLowerCase().includes(query))
      );
    }

    return topics;
  }, [searchQuery, selectedCategory, user]);

  const toggleTopic = (topicId: string) => {
    const newExpanded = new Set(expandedTopics);
    if (newExpanded.has(topicId)) {
      newExpanded.delete(topicId);
    } else {
      newExpanded.add(topicId);
      trackClick(
        `help_topic_${topicId}`,
        'Help',
        'Help Center',
        `Expanded help topic: ${topicId}`
      );
    }
    setExpandedTopics(newExpanded);
  };

  const handleLaunchTour = (tourId: string) => {
    trackClick(
      `launch_tour_${tourId}`,
      'Help',
      'Help Center',
      `Launched interactive tour: ${tourId}`
    );
    if (onLaunchTour) {
      onLaunchTour(tourId);
    } else {
      const tourButton = document.querySelector('[data-testid="tour-help-button"]');
      if (tourButton instanceof HTMLElement) {
        tourButton.click();
        setTimeout(() => {
          const tourItem = document.querySelector(`[data-testid="tour-${tourId}"]`);
          if (tourItem instanceof HTMLElement) {
            tourItem.click();
          }
        }, 300);
      }
    }
  };

  const topicsByCategory = useMemo(() => {
    const grouped: Record<TourCategory, HelpTopic[]> = {
      'files-resources': [],
      'events-calendar': [],
      'analytics-reports': [],
      'my-work': [],
      'team-management': [],
    };

    filteredTopics.forEach((topic) => {
      grouped[topic.category].push(topic);
    });

    return grouped;
  }, [filteredTopics]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container max-w-7xl mx-auto px-4 py-4 sm:py-8">
        {/* Header */}
        <div className="mb-4 sm:mb-8">
          <div className="hidden sm:block">
            <PageBreadcrumbs
              segments={[
                { label: 'Help Center' }
              ]}
            />
          </div>
          <div className="flex items-center gap-3 sm:gap-4 mb-4">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#236383] to-[#236383] flex items-center justify-center shadow-lg flex-shrink-0">
              <HelpCircle className="w-6 h-6 sm:w-9 sm:h-9 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-4xl font-bold text-slate-900 dark:text-slate-100" data-testid="help-title">
                Help Center
              </h1>
              <p className="text-sm sm:text-lg text-slate-600 dark:text-slate-400 mt-1">
                Find answers and learn how to use The Sandwich Project platform
              </p>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <Card className="mb-4 sm:mb-8 border-2 border-[#fbad3f]/20">
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-3 sm:space-y-4">
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                <Input
                  placeholder="Search help topics..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 sm:pl-12 h-11 sm:h-12 text-sm sm:text-base border-2 focus:border-[#236383]"
                  data-testid="help-search"
                />
              </div>

              {/* Category Filters */}
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                <Button
                  variant={selectedCategory === null ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory(null)}
                  size="sm"
                  className={cn(
                    'transition-all text-xs sm:text-sm',
                    selectedCategory === null &&
                      'bg-gradient-to-r from-[#236383] to-[#236383] hover:from-[#1a4d66] hover:to-[#006270]'
                  )}
                  data-testid="filter-all"
                >
                  All Topics
                </Button>
                {Object.entries(TOUR_CATEGORIES).map(([key, category]) => {
                  const IconComponent = CATEGORY_ICONS[category.icon];
                  return (
                    <Button
                      key={key}
                      variant={selectedCategory === key ? 'default' : 'outline'}
                      onClick={() => setSelectedCategory(key as TourCategory)}
                      size="sm"
                      className={cn(
                        'transition-all text-xs sm:text-sm',
                        selectedCategory === key &&
                          'bg-gradient-to-r from-[#236383] to-[#236383] hover:from-[#1a4d66] hover:to-[#006270]'
                      )}
                      data-testid={`filter-${key}`}
                    >
                      {IconComponent && <IconComponent className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 flex-shrink-0" />}
                      <span className="truncate">{category.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Help Topics */}
        {filteredTopics.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
                No results found
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Try adjusting your search or browse all topics
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(topicsByCategory).map(([categoryKey, topics]) => {
              if (topics.length === 0) return null;

              const category = TOUR_CATEGORIES[categoryKey as TourCategory];
              const CategoryIcon = CATEGORY_ICONS[category.icon];

              return (
                <div key={categoryKey} data-testid={`category-${categoryKey}`}>
                  <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                    {CategoryIcon && (
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-[#236383]/10 flex items-center justify-center flex-shrink-0">
                        <CategoryIcon className="w-4 h-4 sm:w-5 sm:h-5 text-[#236383]" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h2 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                        {category.label}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 truncate">
                        {category.description}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {topics.map((topic) => {
                      const isExpanded = expandedTopics.has(topic.id);
                      const TopicIcon = topic.icon;

                      return (
                        <Collapsible
                          key={topic.id}
                          open={isExpanded}
                          onOpenChange={() => toggleTopic(topic.id)}
                        >
                          <Card
                            className={cn(
                              'transition-all hover:shadow-md border-2',
                              isExpanded ? 'border-[#fbad3f] shadow-lg' : 'border-transparent'
                            )}
                            data-testid={`topic-${topic.id}`}
                          >
                            <CollapsibleTrigger asChild>
                              <CardHeader className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors p-3 sm:p-6">
                                <div className="flex items-start justify-between gap-2 sm:gap-4">
                                  <div className="flex items-start gap-2 sm:gap-4 flex-1 min-w-0">
                                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-gradient-to-br from-[#236383]/10 to-[#236383]/10 flex items-center justify-center flex-shrink-0">
                                      <TopicIcon className="w-5 h-5 sm:w-6 sm:h-6 text-[#236383]" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <CardTitle className="text-base sm:text-xl mb-1 sm:mb-2 text-slate-900 dark:text-slate-100">
                                        {topic.title}
                                      </CardTitle>
                                      <CardDescription className="text-xs sm:text-base line-clamp-2">
                                        {topic.description}
                                      </CardDescription>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                                    {topic.tourId && (
                                      <Badge
                                        variant="secondary"
                                        className="bg-[#fbad3f]/10 text-[#fbad3f] border-[#fbad3f]/20 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5"
                                      >
                                        <PlayCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 sm:mr-1" />
                                        <span className="hidden sm:inline">Tour Available</span>
                                        <span className="sm:hidden">Tour</span>
                                      </Badge>
                                    )}
                                    <div
                                      className={cn(
                                        'w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center transition-transform',
                                        isExpanded && 'rotate-180'
                                      )}
                                    >
                                      <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600 dark:text-slate-400" />
                                    </div>
                                  </div>
                                </div>
                              </CardHeader>
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <CardContent className="pt-0 pb-4 sm:pb-6 px-3 sm:px-6">
                                <div className="space-y-4 sm:space-y-6">
                                  {/* Summary */}
                                  <div className="bg-[#236383]/5 border-l-4 border-[#236383] p-3 sm:p-4 rounded-r-lg">
                                    <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 leading-relaxed">
                                      {topic.content.summary}
                                    </p>
                                  </div>

                                  {/* Steps */}
                                  <div>
                                    <h4 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-100 mb-2 sm:mb-3 flex items-center gap-2">
                                      <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-md bg-[#236383] text-white flex items-center justify-center text-xs sm:text-sm">
                                        1
                                      </div>
                                      Step-by-Step Guide
                                    </h4>
                                    <ol className="space-y-2">
                                      {topic.content.steps.map((step, index) => (
                                        <li key={index} className="flex gap-2 sm:gap-3 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                                          <span className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#fbad3f]/20 text-[#fbad3f] flex items-center justify-center text-xs sm:text-sm font-semibold">
                                            {index + 1}
                                          </span>
                                          <span className="flex-1 pt-0.5">{step}</span>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>

                                  {/* Tips */}
                                  {topic.content.tips && topic.content.tips.length > 0 && (
                                    <div className="bg-[#fbad3f]/5 border border-[#fbad3f]/20 rounded-lg p-3 sm:p-4">
                                      <h4 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-100 mb-2 sm:mb-3 flex items-center gap-2">
                                        <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#fbad3f]" />
                                        Pro Tips
                                      </h4>
                                      <ul className="space-y-2">
                                        {topic.content.tips.map((tip, index) => (
                                          <li key={index} className="flex gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                                            <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 text-[#fbad3f] flex-shrink-0 mt-0.5" />
                                            <span>{tip}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {/* Launch Tour Button */}
                                  {topic.tourId && (
                                    <div className="pt-3 sm:pt-4 border-t border-slate-200 dark:border-slate-700">
                                      <Button
                                        onClick={() => handleLaunchTour(topic.tourId!)}
                                        className="w-full bg-gradient-to-r from-[#236383] to-[#236383] hover:from-[#1a4d66] hover:to-[#006270] text-white shadow-md hover:shadow-lg transition-all h-11"
                                        size="lg"
                                        data-testid={`launch-tour-${topic.id}`}
                                      >
                                        <PlayCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                                        <span className="text-sm sm:text-base">Launch Interactive Tour</span>
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </CardContent>
                            </CollapsibleContent>
                          </Card>
                        </Collapsible>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer Note */}
        <Card className="mt-4 sm:mt-8 bg-gradient-to-r from-[#236383]/5 to-[#236383]/5 border-2 border-[#236383]/20">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-[#236383]/10 flex items-center justify-center flex-shrink-0">
                <HelpCircle className="w-5 h-5 sm:w-6 sm:h-6 text-[#236383]" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-100 mb-1 sm:mb-2">
                  Need More Help?
                </h3>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mb-2 sm:mb-3">
                  Can't find what you're looking for? Our interactive tours provide step-by-step guidance
                  for each feature. Click the floating help button (
                  <HelpCircle className="w-3 h-3 sm:w-4 sm:h-4 inline mx-0.5 sm:mx-1" />) in the bottom-right corner to browse
                  all available tours.
                </p>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                  For additional assistance, contact your team administrator or reach out through the Team Chat.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
