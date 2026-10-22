import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import {
  Lightbulb,
  Plus,
  MessageSquare,
  ThumbsUp,
  Eye,
  EyeOff,
  Star,
  Clock,
  CheckCircle,
  XCircle,
  Pause,
  Filter,
  Search,
  ArrowUpRight,
  User,
  Calendar,
  AlertTriangle,
  Trash2,
  Send,
  BarChart3,
} from 'lucide-react';
import { hasPermission } from '@shared/unified-auth-utils';
import { useMessaging } from '@/hooks/useMessaging';
import { useUserActivityTracking } from '@/hooks/useUserActivityTracking';
import { logger } from '@/lib/logger';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';

// Schema for suggestion form
const suggestionSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be under 200 characters'),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(2000, 'Description must be under 2000 characters'),
  category: z.string().default('general'),
  priority: z.string().default('medium'),
  isAnonymous: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

type SuggestionFormData = z.infer<typeof suggestionSchema>;

interface Suggestion {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  submittedBy: string;
  submitterEmail?: string;
  submitterName?: string;
  isAnonymous: boolean;
  upvotes: number;
  tags: string[];
  implementationNotes?: string;
  estimatedEffort?: string;
  assignedTo?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface SuggestionResponse {
  id: number;
  suggestionId: number;
  message: string;
  isAdminResponse: boolean;
  respondedBy: string;
  respondentName?: string;
  isInternal: boolean;
  createdAt: string;
}

export default function SuggestionsPortal() {
  const { trackView, trackClick, trackFormSubmit } = useActivityTracker();
  const [selectedSuggestion, setSelectedSuggestion] =
    useState<Suggestion | null>(null);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    trackView(
      'Suggestions',
      'Suggestions',
      'Suggestions Portal',
      'User accessed suggestions portal'
    );
  }, [trackView]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPriority, setSelectedPriority] = useState('all');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { trackSearch } = useUserActivityTracking();

  // Get current user
  const { data: currentUser } = useQuery({
    queryKey: ['/api/auth/user'],
    enabled: true,
  });

  // Updated permissions logic - everyone can submit suggestions
  const canSubmit = true; // Everyone can submit suggestions
  const canManage =
    hasPermission(currentUser, 'SUGGESTIONS_MANAGE') ||
    hasPermission(currentUser, 'SUGGESTIONS_EDIT_ALL');
  const canRespond = hasPermission(currentUser, 'SUGGESTIONS_MANAGE');
  const canViewAll =
    hasPermission(currentUser, 'SUGGESTIONS_VIEW') ||
    hasPermission(currentUser, 'SUGGESTIONS_MANAGE') ||
    hasPermission(currentUser, 'ADMIN_ACCESS');

  // Fetch suggestions - everyone can view at least their own
  const { data: suggestions = [], isLoading } = useQuery<Suggestion[]>({
    queryKey: ['/api/suggestions'],
    enabled: true, // Everyone can access suggestions (filtering happens server-side)
    // Use global defaults (5 min staleTime) - proper cache invalidation after mutations
  });

  // Update selected suggestion when suggestions data changes
  useEffect(() => {
    if (selectedSuggestion && suggestions.length > 0) {
      const updatedSuggestion = (suggestions || []).find(
        (s: Suggestion) => s.id === selectedSuggestion.id
      );
      if (updatedSuggestion) {
        setSelectedSuggestion(updatedSuggestion);
      }
    }
  }, [suggestions, selectedSuggestion]);

  // Submit suggestion mutation
  const submitSuggestionMutation = useMutation({
    mutationFn: (data: SuggestionFormData) => {
      return apiRequest('POST', '/api/suggestions', data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/suggestions'] });
      setShowSubmissionForm(false);
      suggestionForm.reset();
      toast({
        title: 'Success',
        description: 'Your suggestion has been submitted successfully!',
      });
      
      // Track the suggestion submission
      trackFormSubmit('user suggestion', 'Feedback & Suggestions', 'Suggestion Form', true);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to submit suggestion',
        variant: 'destructive',
      });
    },
  });

  // Upvote suggestion mutation
  const upvoteMutation = useMutation({
    mutationFn: (suggestionId: number) =>
      apiRequest('POST', `/api/suggestions/${suggestionId}/upvote`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/suggestions'] });
      toast({
        title: 'Success',
        description: 'Suggestion upvoted!',
      });
    },
  });

  // Update suggestion mutation (admin only)
  const updateSuggestionMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: number;
      updates: Partial<Suggestion>;
    }) => apiRequest('PATCH', `/api/suggestions/${id}`, updates),
    onSuccess: (updatedSuggestion) => {
      if (selectedSuggestion && updatedSuggestion) {
        setSelectedSuggestion({ ...selectedSuggestion, ...updatedSuggestion });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/suggestions'] });
      queryClient.refetchQueries({ queryKey: ['/api/suggestions'] });
      toast({
        title: 'Success',
        description: 'Suggestion updated successfully!',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to update suggestion',
        variant: 'destructive',
      });
    },
  });

  // Delete suggestion mutation (admin only)
  const deleteSuggestionMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/suggestions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/suggestions'] });
      setSelectedSuggestion(null);
      toast({
        title: 'Suggestion deleted',
        description: 'The suggestion has been permanently removed.',
      });
    },
    onError: (error) => {
      logger.error('Failed to delete suggestion:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete suggestion. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Forms
  const suggestionForm = useForm<SuggestionFormData>({
    resolver: zodResolver(suggestionSchema),
    defaultValues: {
      category: 'general',
      priority: 'medium',
      isAnonymous: false,
      tags: [],
    },
  });

  // Enhanced filtering logic
  const filteredSuggestions = (suggestions as Suggestion[]).filter(
    (suggestion: Suggestion) => {
      // Tab filter
      let tabMatch = true;
      switch (activeTab) {
        case 'pending':
          tabMatch =
            suggestion.status === 'submitted' ||
            suggestion.status === 'under_review' ||
            suggestion.status === 'needs_clarification';
          break;
        case 'in-progress':
          tabMatch = suggestion.status === 'in_progress';
          break;
        case 'completed':
          tabMatch = suggestion.status === 'completed';
          break;
        case 'mine':
          tabMatch = suggestion.submittedBy === (currentUser as any)?.id;
          break;
        default:
          tabMatch = true;
      }

      // Search filter
      const searchMatch =
        searchQuery === '' ||
        suggestion.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        suggestion.description
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        suggestion.category.toLowerCase().includes(searchQuery.toLowerCase());

      // Category filter
      const categoryMatch =
        selectedCategory === 'all' || suggestion.category === selectedCategory;

      // Priority filter
      const priorityMatch =
        selectedPriority === 'all' || suggestion.priority === selectedPriority;

      return tabMatch && searchMatch && categoryMatch && priorityMatch;
    }
  );

  const onSubmitSuggestion = (data: SuggestionFormData) => {
    submitSuggestionMutation.mutate(data);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'medium':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'low':
        return 'bg-green-50 text-green-700 border-green-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'completed':
        return {
          icon: <CheckCircle className="h-4 w-4" />,
          color: 'text-green-600',
          bg: 'bg-green-50',
          label: 'Completed',
        };
      case 'in_progress':
        return {
          icon: <Clock className="h-4 w-4" />,
          color: 'text-brand-primary',
          bg: 'bg-blue-50',
          label: 'In Progress',
        };
      case 'under_review':
        return {
          icon: <Eye className="h-4 w-4" />,
          color: 'text-purple-600',
          bg: 'bg-purple-50',
          label: 'Under Review',
        };
      case 'needs_clarification':
        return {
          icon: <MessageSquare className="h-4 w-4" />,
          color: 'text-orange-600',
          bg: 'bg-orange-50',
          label: 'Needs Clarification',
        };
      case 'on_hold':
        return {
          icon: <Pause className="h-4 w-4" />,
          color: 'text-yellow-600',
          bg: 'bg-yellow-50',
          label: 'On Hold',
        };
      case 'rejected':
        return {
          icon: <XCircle className="h-4 w-4" />,
          color: 'text-red-600',
          bg: 'bg-red-50',
          label: 'Rejected',
        };
      default:
        return {
          icon: <Star className="h-4 w-4" />,
          color: 'text-gray-600',
          bg: 'bg-gray-50',
          label: 'Submitted',
        };
    }
  };

  const getTabCounts = () => {
    const suggestionList = suggestions as Suggestion[];
    return {
      all: suggestionList.length,
      pending: suggestionList.filter((s) =>
        ['submitted', 'under_review', 'needs_clarification'].includes(s.status)
      ).length,
      inProgress: suggestionList.filter((s) => s.status === 'in_progress')
        .length,
      completed: suggestionList.filter((s) => s.status === 'completed').length,
      mine: suggestionList.filter(
        (s) => s.submittedBy === (currentUser as any)?.id
      ).length,
    };
  };

  // Remove access restrictions - everyone can access suggestions
  // (Server-side filtering will show users only their own suggestions if they don't have view-all permissions)

  const tabCounts = getTabCounts();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header Section with TSP Branding */}
      <div className="bg-gradient-to-br from-teal-600 to-teal-700 text-white">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <PageBreadcrumbs
            segments={[
              { label: 'Communication' },
              { label: 'Suggestions' }
            ]}
            className="mb-4"
          />

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl sm:text-4xl font-bold font-roboto flex items-center gap-3">
                <div className="bg-white/20 rounded-lg p-2">
                  <Lightbulb className="h-8 w-8 text-white" />
                </div>
                <span className="truncate">Suggestions Portal</span>
              </h1>
              <p className="text-teal-100 mt-2 text-lg font-roboto">
                Share ideas and feedback to improve our operations
              </p>
              <div className="bg-white/10 rounded-lg p-4 mt-4">
                <p className="text-white leading-relaxed">
                  If you need something to work differently, if something is
                  confusing to you, you have tips on how we could better arrange
                  this whole site, or if you run into a bug, please submit your
                  feedback here so we can get this where it serves your needs
                  the best it possibly can!
                </p>
              </div>
            </div>
            {canSubmit && (
              <Dialog
                open={showSubmissionForm}
                onOpenChange={setShowSubmissionForm}
              >
                <DialogTrigger asChild>
                  <Button
                    size="lg"
                    className="bg-orange-500 hover:bg-orange-600 text-white shadow-lg w-full sm:w-auto font-semibold"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    Submit New Suggestion
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Submit a New Suggestion</DialogTitle>
                    <DialogDescription>
                      Share your ideas for improving our operations, processes,
                      or services.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...suggestionForm}>
                    <form
                      onSubmit={suggestionForm.handleSubmit(onSubmitSuggestion)}
                      className="space-y-4"
                    >
                      <FormField
                        control={suggestionForm.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Title</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Brief summary of your suggestion"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={suggestionForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Detailed description of your suggestion, including benefits and implementation ideas"
                                rows={5}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField
                          control={suggestionForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Category</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select category" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="general">
                                    General
                                  </SelectItem>
                                  <SelectItem value="operations">
                                    Operations
                                  </SelectItem>
                                  <SelectItem value="technology">
                                    Technology
                                  </SelectItem>
                                  <SelectItem value="volunteer_experience">
                                    Volunteer Experience
                                  </SelectItem>
                                  <SelectItem value="communication">
                                    Communication
                                  </SelectItem>
                                  <SelectItem value="training">
                                    Training
                                  </SelectItem>
                                  <SelectItem value="logistics">
                                    Logistics
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={suggestionForm.control}
                          name="priority"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Priority</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select priority" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="low">Low</SelectItem>
                                  <SelectItem value="medium">Medium</SelectItem>
                                  <SelectItem value="high">High</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={suggestionForm.control}
                        name="isAnonymous"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Submit Anonymously
                              </FormLabel>
                              <FormDescription>
                                Your name will not be shown with this suggestion
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <div className="flex justify-end space-x-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setShowSubmissionForm(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={submitSuggestionMutation.isPending}
                        >
                          {submitSuggestionMutation.isPending
                            ? 'Submitting...'
                            : 'Submit Suggestion'}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 pb-8 space-y-6">
        {/* Search and Filter Section */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 rounded-t-xl px-6 py-4">
            <h2 className="text-lg font-bold text-gray-800 font-roboto flex items-center gap-2">
              <Search className="h-5 w-5 text-teal-600" />
              Search & Filter Suggestions
            </h2>
          </div>
          <div className="p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search suggestions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-11 border-gray-300 focus:border-teal-500 focus:ring-teal-500"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 h-11 border-gray-300 hover:border-teal-500 hover:text-teal-600"
              >
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">Filters</span>
                <span className="sm:hidden">Filter</span>
                {(selectedCategory !== 'all' || selectedPriority !== 'all') && (
                  <Badge className="ml-1 bg-orange-500 text-white">
                    {[
                      selectedCategory !== 'all' ? 1 : 0,
                      selectedPriority !== 'all' ? 1 : 0,
                    ].reduce((a, b) => a + b)}
                  </Badge>
                )}
              </Button>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-4 mt-4 pt-4 border-t border-gray-200">
                <div className="min-w-0 flex-1 sm:min-w-[200px]">
                  <Label className="text-sm font-semibold text-gray-700">
                    Category
                  </Label>
                  <Select
                    value={selectedCategory}
                    onValueChange={setSelectedCategory}
                  >
                    <SelectTrigger className="mt-1 border-gray-300 focus:border-teal-500 focus:ring-teal-500">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="operations">Operations</SelectItem>
                      <SelectItem value="technology">Technology</SelectItem>
                      <SelectItem value="volunteer_experience">
                        Volunteer Experience
                      </SelectItem>
                      <SelectItem value="communication">
                        Communication
                      </SelectItem>
                      <SelectItem value="training">Training</SelectItem>
                      <SelectItem value="logistics">Logistics</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 flex-1 sm:min-w-[150px]">
                  <Label className="text-sm font-semibold text-gray-700">
                    Priority
                  </Label>
                  <Select
                    value={selectedPriority}
                    onValueChange={setSelectedPriority}
                  >
                    <SelectTrigger className="mt-1 border-gray-300 focus:border-teal-500 focus:ring-teal-500">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Priorities</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(selectedCategory !== 'all' || selectedPriority !== 'all') && (
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedCategory('all');
                        setSelectedPriority('all');
                      }}
                      className="text-sm text-orange-600 hover:text-orange-700 hover:bg-orange-50 w-full sm:w-auto"
                    >
                      Clear Filters
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Status Tabs Section */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 rounded-t-xl px-6 py-4">
            <h2 className="text-lg font-bold text-gray-800 font-roboto flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-teal-600" />
              Browse Suggestions by Status
            </h2>
          </div>
          <div className="p-6">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList
                className={`grid w-full ${
                  canSubmit && hasPermission(currentUser, 'submit_suggestions')
                    ? 'grid-cols-3 sm:grid-cols-5'
                    : 'grid-cols-2 sm:grid-cols-4'
                } gap-2 bg-gray-100 p-1 rounded-lg`}
              >
                <TabsTrigger
                  value="all"
                  className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-gray-900"
                >
                  <span className="hidden sm:inline">All Suggestions</span>
                  <span className="sm:hidden">All</span>
                  <Badge className="bg-gray-600 text-white text-xs min-w-[20px] justify-center">
                    {tabCounts.all}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  value="pending"
                  className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-gray-900"
                >
                  <span className="hidden sm:inline">Pending Review</span>
                  <span className="sm:hidden">Pending</span>
                  <Badge className="bg-yellow-600 text-white text-xs min-w-[20px] justify-center">
                    {tabCounts.pending}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  value="in-progress"
                  className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-gray-900"
                >
                  <span className="hidden sm:inline">In Progress</span>
                  <span className="sm:hidden">Active</span>
                  <Badge className="bg-brand-primary text-white text-xs min-w-[20px] justify-center">
                    {tabCounts.inProgress}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  value="completed"
                  className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-gray-900"
                >
                  <span className="hidden sm:inline">Completed</span>
                  <span className="sm:hidden">Done</span>
                  <Badge className="bg-green-600 text-white text-xs min-w-[20px] justify-center">
                    {tabCounts.completed}
                  </Badge>
                </TabsTrigger>
                {canSubmit && (
                  <TabsTrigger
                    value="mine"
                    className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-gray-900"
                  >
                    <span className="hidden sm:inline">My Suggestions</span>
                    <span className="sm:hidden">Mine</span>
                    <Badge className="bg-teal-600 text-white text-xs min-w-[20px] justify-center">
                      {tabCounts.mine}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value={activeTab} className="mt-0">
                {/* Suggestions List Section */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 mt-6">
                  <div className="border-b border-gray-200 bg-gray-50 rounded-t-xl px-6 py-4">
                    <h2 className="text-lg font-bold text-gray-800 font-roboto flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-teal-600" />
                      {activeTab === 'all' && 'All Suggestions'}
                      {activeTab === 'pending' && 'Pending Review'}
                      {activeTab === 'in-progress' && 'In Progress'}
                      {activeTab === 'completed' && 'Completed'}
                      {activeTab === 'mine' && 'My Suggestions'}
                      <Badge className="bg-gray-600 text-white ml-2">
                        {filteredSuggestions.length}
                      </Badge>
                    </h2>
                  </div>
                  <div className="p-6">
                    {isLoading ? (
                      <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="animate-pulse border border-gray-200 rounded-lg p-6"
                          >
                            <div className="flex justify-between items-start mb-4">
                              <div className="space-y-2 flex-1">
                                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                                <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                              </div>
                              <div className="h-5 w-5 bg-gray-200 rounded"></div>
                            </div>
                            <div className="space-y-2">
                              <div className="h-4 bg-gray-200 rounded"></div>
                              <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : filteredSuggestions.length === 0 ? (
                      <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-lg">
                        <Lightbulb className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                          {searchQuery ||
                          selectedCategory !== 'all' ||
                          selectedPriority !== 'all'
                            ? 'No suggestions match your filters'
                            : 'No suggestions found'}
                        </h3>
                        <p className="text-gray-500 mb-6">
                          {activeTab === 'mine' && canSubmit
                            ? "You haven't submitted any suggestions yet."
                            : searchQuery ||
                                selectedCategory !== 'all' ||
                                selectedPriority !== 'all'
                              ? 'Try adjusting your search or filter criteria.'
                              : 'Be the first to share an idea for improvement.'}
                        </p>
                        {canSubmit &&
                          (activeTab === 'mine' ||
                            (!searchQuery &&
                              selectedCategory === 'all' &&
                              selectedPriority === 'all')) && (
                            <Button
                              onClick={() => setShowSubmissionForm(true)}
                              className="bg-orange-500 hover:bg-orange-600 text-white"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Submit Your First Suggestion
                            </Button>
                          )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {filteredSuggestions.map((suggestion: Suggestion) => {
                          const statusConfig = getStatusConfig(
                            suggestion.status
                          );
                          const getStatusBorderColor = (status: string) => {
                            switch (status) {
                              case 'completed':
                                return 'border-l-green-500';
                              case 'in_progress':
                                return 'border-l-blue-500';
                              case 'under_review':
                                return 'border-l-purple-500';
                              case 'needs_clarification':
                                return 'border-l-orange-500';
                              case 'on_hold':
                                return 'border-l-yellow-500';
                              case 'rejected':
                                return 'border-l-red-500';
                              default:
                                return 'border-l-gray-400';
                            }
                          };

                          return (
                            <div
                              key={suggestion.id}
                              className={`border border-gray-200 rounded-lg hover:shadow-md transition-all duration-200 border-l-4 ${getStatusBorderColor(
                                suggestion.status
                              )} group bg-white`}
                            >
                              <div className="p-6">
                                <div className="flex justify-between items-start gap-4">
                                  <div
                                    className="flex-1 min-w-0 cursor-pointer"
                                    onClick={() =>
                                      setSelectedSuggestion(suggestion)
                                    }
                                  >
                                    <div className="flex items-center gap-2 mb-3">
                                      <Badge
                                        variant="outline"
                                        className={`${statusConfig.bg} ${statusConfig.color} border-0 text-xs font-medium`}
                                      >
                                        {statusConfig.icon}
                                        <span className="ml-1">
                                          {statusConfig.label}
                                        </span>
                                      </Badge>
                                      <Badge
                                        variant="outline"
                                        className={`${getPriorityColor(
                                          suggestion.priority
                                        )} border text-xs`}
                                      >
                                        {suggestion.priority
                                          .charAt(0)
                                          .toUpperCase() +
                                          suggestion.priority.slice(1)}
                                      </Badge>
                                    </div>
                                    <h3 className="text-lg font-semibold group-hover:text-brand-primary transition-colors line-clamp-2 mb-2">
                                      {suggestion.title}
                                    </h3>
                                    <p className="text-gray-600 line-clamp-2 text-sm">
                                      {suggestion.description.length > 120
                                        ? `${suggestion.description.substring(
                                            0,
                                            120
                                          )}...`
                                        : suggestion.description}
                                    </p>
                                  </div>
                                  <ArrowUpRight className="h-5 w-5 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
                                </div>

                                <div className="mt-4 pt-4 border-t border-gray-100">
                                  <div className="flex justify-between items-center mb-3">
                                    <div className="flex items-center gap-4 text-sm text-gray-500">
                                      <div className="flex items-center gap-1">
                                        {suggestion.isAnonymous ? (
                                          <>
                                            <EyeOff className="h-4 w-4" />
                                            <span>Anonymous</span>
                                          </>
                                        ) : (
                                          <>
                                            <User className="h-4 w-4" />
                                            <span>
                                              {suggestion.submitterName ||
                                                'Unknown'}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {suggestion.category.replace('_', ' ')}
                                      </Badge>
                                      <div className="flex items-center gap-1">
                                        <Calendar className="h-4 w-4" />
                                        <span>
                                          {new Date(
                                            suggestion.createdAt
                                          ).toLocaleDateString()}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          upvoteMutation.mutate(suggestion.id);
                                        }}
                                        className="flex items-center gap-1 h-8 px-2 hover:bg-blue-50 hover:text-brand-primary"
                                      >
                                        <ThumbsUp className="h-4 w-4" />
                                        <span className="font-medium">
                                          {suggestion.upvotes || 0}
                                        </span>
                                      </Button>
                                    </div>
                                  </div>

                                  {/* Admin Actions - Mobile responsive */}
                                  {hasPermission(
                                    currentUser,
                                    'manage_suggestions'
                                  ) && (
                                    <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          updateSuggestionMutation.mutate({
                                            id: suggestion.id,
                                            updates: {
                                              status: 'under_review',
                                              assignedTo: (currentUser as any)
                                                ?.id,
                                            },
                                          });
                                        }}
                                        disabled={
                                          suggestion.status === 'under_review'
                                        }
                                        className="h-8 px-3 text-xs text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                                      >
                                        <Eye className="h-3 w-3 mr-1.5" />
                                        Review
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          updateSuggestionMutation.mutate({
                                            id: suggestion.id,
                                            updates: {
                                              status: 'in_progress',
                                              assignedTo: (currentUser as any)
                                                ?.id,
                                            },
                                          });
                                        }}
                                        disabled={
                                          suggestion.status === 'in_progress'
                                        }
                                        className="h-8 px-3 text-xs text-orange-700 hover:bg-orange-50 hover:text-orange-800"
                                      >
                                        <Clock className="h-3 w-3 mr-1.5" />
                                        In Progress
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          updateSuggestionMutation.mutate({
                                            id: suggestion.id,
                                            updates: {
                                              status: 'completed',
                                              assignedTo: (currentUser as any)
                                                ?.id,
                                            },
                                          });
                                        }}
                                        disabled={
                                          suggestion.status === 'completed'
                                        }
                                        className="h-8 px-3 text-xs text-green-700 hover:bg-green-50 hover:text-green-800"
                                      >
                                        <CheckCircle className="h-3 w-3 mr-1.5" />
                                        Complete
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (
                                            confirm(
                                              'Are you sure you want to delete this suggestion? This action cannot be undone.'
                                            )
                                          ) {
                                            deleteSuggestionMutation.mutate(
                                              suggestion.id
                                            );
                                          }
                                        }}
                                        className="h-8 px-3 text-xs text-red-700 hover:bg-red-50 hover:text-red-800"
                                      >
                                        <Trash2 className="h-3 w-3 mr-1.5" />
                                        Delete
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Suggestion Detail Dialog - Simple view only */}
      <Dialog
        open={!!selectedSuggestion}
        onOpenChange={() => setSelectedSuggestion(null)}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {selectedSuggestion && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">
                  {selectedSuggestion.title}
                </DialogTitle>
                <div className="flex items-center space-x-2 mt-2">
                  <Badge
                    className={getPriorityColor(selectedSuggestion.priority)}
                  >
                    {selectedSuggestion.priority} priority
                  </Badge>
                  <Badge variant="outline">{selectedSuggestion.category}</Badge>
                  <span className="text-sm text-gray-500">
                    {selectedSuggestion.isAnonymous
                      ? 'Anonymous'
                      : selectedSuggestion.submitterName || 'Unknown'}
                  </span>
                </div>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Description</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {selectedSuggestion.description}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                    <span>
                      Submitted:{' '}
                      {new Date(
                        selectedSuggestion.createdAt
                      ).toLocaleDateString()}
                    </span>
                    <span>
                      Status: {selectedSuggestion.status.replace('_', ' ')}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => upvoteMutation.mutate(selectedSuggestion.id)}
                    className="flex items-center space-x-1"
                  >
                    <ThumbsUp className="h-4 w-4" />
                    <span>{selectedSuggestion.upvotes || 0}</span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
