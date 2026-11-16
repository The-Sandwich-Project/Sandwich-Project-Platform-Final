import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Clock,
  Plus,
  Calendar,
  User,
  AlertCircle,
  CheckCircle,
  Filter,
  Search,
  ChevronDown,
} from 'lucide-react';
import { format, isToday, isTomorrow, isThisWeek, isPast } from 'date-fns';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/loading';
import { useToast } from '@/hooks/use-toast';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { queryClient, apiRequest } from '@/lib/queryClient';

import { usePageSession } from '@/hooks/usePageSession';
// Event Reminder types
type EventReminder = {
  id: number;
  eventRequestId: number | null;
  title: string;
  description: string | null;
  reminderType: 'follow_up' | 'deadline' | 'check_in' | 'custom';
  dueDate: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  completedAt: string | null;
  completedBy: string | null;
  completionNotes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

// Form schemas
const createReminderSchema = z.object({
  eventRequestId: z.number().optional(),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(100, 'Title must be under 100 characters'),
  description: z.string().optional(),
  reminderType: z.enum([
    'follow_up',
    'deadline',
    'check_in',
    'custom',
  ]),
  dueDate: z.string().min(1, 'Due date is required'),
  assignedToUserId: z.string().optional(),
  assignedToName: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

type CreateReminderInput = z.infer<typeof createReminderSchema>;

const completeReminderSchema = z.object({
  completionNotes: z.string().optional(),
});

type CompleteReminderInput = z.infer<typeof completeReminderSchema>;

export default function EventRemindersManagement() {
  // Track page session for activity logging
  usePageSession({
    section: 'Event Requests',
    page: 'Event Reminders',
  });

  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedReminder, setSelectedReminder] =
    useState<EventReminder | null>(null);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);

  const { toast } = useToast();

  // Fetch reminders
  const {
    data: reminders = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['/api/event-reminders'],
    queryFn: async () => {
      const response = await fetch('/api/event-reminders');
      if (!response.ok) throw new Error('Failed to fetch reminders');
      return response.json() as Promise<EventReminder[]>;
    },
  });

  // Create reminder mutation
  const createReminderMutation = useMutation({
    mutationFn: async (data: CreateReminderInput) => {
      return apiRequest('POST', '/api/event-reminders', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/event-reminders'] });
      queryClient.invalidateQueries({
        queryKey: ['/api/event-reminders/count'],
      });
      toast({ title: 'Reminder created successfully' });
      setIsCreateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to create reminder',
        description: error.message || 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  // Complete reminder mutation
  const completeReminderMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: CompleteReminderInput;
    }) => {
      return apiRequest('PUT', `/api/event-reminders/${id}`, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        completionNotes: data.completionNotes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/event-reminders'] });
      queryClient.invalidateQueries({
        queryKey: ['/api/event-reminders/count'],
      });
      toast({ title: 'Reminder marked as completed' });
      setIsCompleteDialogOpen(false);
      setSelectedReminder(null);
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to complete reminder',
        description: error.message || 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  // Create form
  const createForm = useForm<CreateReminderInput>({
    resolver: zodResolver(createReminderSchema),
    defaultValues: {
      title: '',
      description: '',
      reminderType: 'follow_up',
      dueDate: '',
      assignedToUserId: '',
      assignedToName: '',
      priority: 'medium',
    },
  });

  // Complete form
  const completeForm = useForm<CompleteReminderInput>({
    resolver: zodResolver(completeReminderSchema),
    defaultValues: {
      completionNotes: '',
    },
  });

  // Filter reminders
  const filteredReminders = reminders.filter((reminder) => {
    const matchesSearch =
      reminder.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (reminder.description &&
        reminder.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus =
      selectedStatus === 'all' || reminder.status === selectedStatus;
    const matchesPriority =
      selectedPriority === 'all' || reminder.priority === selectedPriority;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  // Group reminders by status
  const pendingReminders = filteredReminders.filter(
    (r) => r.status === 'pending'
  );
  const completedReminders = filteredReminders.filter(
    (r) => r.status === 'completed'
  );

  // Get priority color
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

  // Get reminder type label
  const getReminderTypeLabel = (type: string) => {
    switch (type) {
      case 'follow_up':
        return 'Follow Up';
      case 'deadline':
        return 'Deadline';
      case 'check_in':
        return 'Check In';
      case 'custom':
        return 'Custom';
      default:
        return type;
    }
  };

  // Get due date status
  const getDueDateStatus = (dueDate: string) => {
    const date = new Date(dueDate);
    if (isPast(date)) return 'overdue';
    if (isToday(date)) return 'today';
    if (isTomorrow(date)) return 'tomorrow';
    if (isThisWeek(date)) return 'this-week';
    return 'upcoming';
  };

  const getDueDateBadge = (dueDate: string) => {
    const status = getDueDateStatus(dueDate);
    const date = new Date(dueDate);

    switch (status) {
      case 'overdue':
        return (
          <Badge variant="destructive">Overdue ({format(date, 'MMM d')})</Badge>
        );
      case 'today':
        return (
          <Badge className="bg-orange-100 text-orange-800 border-orange-200">
            Today
          </Badge>
        );
      case 'tomorrow':
        return (
          <Badge className="bg-brand-primary-light text-brand-primary-dark border-brand-primary-border">
            Tomorrow
          </Badge>
        );
      case 'this-week':
        return <Badge variant="secondary">{format(date, 'EEE, MMM d')}</Badge>;
      default:
        return <Badge variant="outline">{format(date, 'MMM d, yyyy')}</Badge>;
    }
  };

  const onCreateSubmit = (data: CreateReminderInput) => {
    createReminderMutation.mutate(data);
  };

  const onCompleteSubmit = (data: CompleteReminderInput) => {
    if (selectedReminder) {
      completeReminderMutation.mutate({ id: selectedReminder.id, data });
    }
  };

  const openCompleteDialog = (reminder: EventReminder) => {
    setSelectedReminder(reminder);
    setIsCompleteDialogOpen(true);
  };

  if (isLoading) {
    return <LoadingState text="Loading event reminders..." size="lg" />;
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Error Loading Reminders
            </CardTitle>
            <CardDescription>
              Failed to load event reminders. Please try refreshing the page.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="h-6 w-6 text-brand-primary" />
            Event Reminders
          </h1>
          <p className="text-gray-600 mt-1">
            Track follow-ups, deadlines, and to-dos for event planning
          </p>
        </div>

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-brand-primary hover:bg-brand-primary-dark min-h-[44px] px-4 text-sm font-medium" data-testid="create-reminder-btn">
              <Plus className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Create Reminder</span>
              <span className="sm:hidden">Create</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Reminder</DialogTitle>
              <DialogDescription>
                Add a new follow-up, deadline, or to-do for event planning.
              </DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form
                onSubmit={createForm.handleSubmit(onCreateSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={createForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Follow up with AT&T about December event"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={createForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Additional details about this reminder..."
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={createForm.control}
                    name="reminderType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="follow_up">Follow Up</SelectItem>
                            <SelectItem value="deadline">Deadline</SelectItem>
                            <SelectItem value="check_in">Check In</SelectItem>
                            <SelectItem value="custom">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={createForm.control}
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
                  control={createForm.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={createForm.control}
                  name="assignedToName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assigned To (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Person responsible for this reminder"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                    className="min-h-[44px] px-6 text-sm font-medium order-2 sm:order-1"
                    data-testid="cancel-create-reminder"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createReminderMutation.isPending}
                    className="bg-brand-primary hover:bg-brand-primary-dark min-h-[44px] px-6 text-sm font-medium order-1 sm:order-2"
                    data-testid="submit-create-reminder"
                  >
                    {createReminderMutation.isPending
                      ? 'Creating...'
                      : 'Create Reminder'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search reminders..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-full sm:w-[180px] min-h-[44px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={selectedPriority}
              onValueChange={setSelectedPriority}
            >
              <SelectTrigger className="w-full sm:w-[180px] min-h-[44px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {pendingReminders.length}
                </p>
                <p className="text-sm text-gray-600">Pending Reminders</p>
              </div>
              <Clock className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {
                    pendingReminders.filter(
                      (r) => getDueDateStatus(r.dueDate) === 'overdue'
                    ).length
                  }
                </p>
                <p className="text-sm text-gray-600">Overdue</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {completedReminders.length}
                </p>
                <p className="text-sm text-gray-600">Completed</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reminders Tabs */}
      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList className="w-full h-auto p-1 grid grid-cols-2 gap-1">
          <TabsTrigger 
            value="pending" 
            className="flex-1 px-3 py-3 text-sm sm:text-base min-h-[44px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            data-testid="tab-pending"
          >
            <span className="hidden sm:inline">Pending ({pendingReminders.length})</span>
            <span className="sm:hidden">Pending ({pendingReminders.length})</span>
          </TabsTrigger>
          <TabsTrigger 
            value="completed" 
            className="flex-1 px-3 py-3 text-sm sm:text-base min-h-[44px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            data-testid="tab-completed"
          >
            <span className="hidden sm:inline">Completed ({completedReminders.length})</span>
            <span className="sm:hidden">Done ({completedReminders.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          {pendingReminders.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    No pending reminders
                  </h3>
                  <p className="text-gray-600 mb-4">
                    You're all caught up! Create a new reminder to track
                    follow-ups and deadlines.
                  </p>
                  <Button
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="bg-brand-primary hover:bg-brand-primary-dark min-h-[44px] px-6 text-sm font-medium"
                    data-testid="create-first-reminder"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Reminder
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {pendingReminders.map((reminder) => (
                <Card
                  key={reminder.id}
                  className="hover:shadow-md transition-shadow"
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900">
                            {reminder.title}
                          </h3>
                          <Badge variant="outline">
                            {getReminderTypeLabel(reminder.reminderType)}
                          </Badge>
                          <Badge
                            className={getPriorityColor(reminder.priority)}
                          >
                            {reminder.priority.charAt(0).toUpperCase() +
                              reminder.priority.slice(1)}
                          </Badge>
                        </div>

                        {reminder.description && (
                          <p className="text-gray-600 text-sm mb-3">
                            {reminder.description}
                          </p>
                        )}

                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {getDueDateBadge(reminder.dueDate)}
                          </div>

                          {reminder.assignedToName && (
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              <span>{reminder.assignedToName}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => openCompleteDialog(reminder)}
                          className="bg-green-600 hover:bg-green-700 min-h-[44px] px-4 text-sm font-medium"
                          data-testid={`complete-reminder-${reminder.id}`}
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          <span className="hidden sm:inline">Complete</span>
                          <span className="sm:hidden">Done</span>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          {completedReminders.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <CheckCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    No completed reminders
                  </h3>
                  <p className="text-gray-600">
                    Completed reminders will appear here for reference.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {completedReminders.map((reminder) => (
                <Card key={reminder.id} className="opacity-75">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900 line-through">
                            {reminder.title}
                          </h3>
                          <Badge variant="outline">
                            {getReminderTypeLabel(reminder.reminderType)}
                          </Badge>
                          <Badge className="bg-green-100 text-green-800 border-green-200">
                            Completed
                          </Badge>
                        </div>

                        {reminder.description && (
                          <p className="text-gray-600 text-sm mb-3">
                            {reminder.description}
                          </p>
                        )}

                        {reminder.completionNotes && (
                          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
                            <p className="text-sm text-green-800">
                              <strong>Completion Notes:</strong>{' '}
                              {reminder.completionNotes}
                            </p>
                          </div>
                        )}

                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>
                              Due:{' '}
                              {format(
                                new Date(reminder.dueDate),
                                'MMM d, yyyy'
                              )}
                            </span>
                          </div>

                          {reminder.completedAt && (
                            <div className="flex items-center gap-1">
                              <CheckCircle className="h-4 w-4" />
                              <span>
                                Completed:{' '}
                                {format(
                                  new Date(reminder.completedAt),
                                  'MMM d, yyyy'
                                )}
                              </span>
                            </div>
                          )}

                          {reminder.assignedToName && (
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              <span>{reminder.assignedToName}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Complete Reminder Dialog */}
      <Dialog
        open={isCompleteDialogOpen}
        onOpenChange={setIsCompleteDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Reminder</DialogTitle>
            <DialogDescription>
              Mark this reminder as completed. Add any notes about the
              completion.
            </DialogDescription>
          </DialogHeader>

          {selectedReminder && (
            <div className="bg-gray-50 border rounded-lg p-4 mb-4">
              <h4 className="font-medium text-gray-900">
                {selectedReminder.title}
              </h4>
              {selectedReminder.description && (
                <p className="text-sm text-gray-600 mt-1">
                  {selectedReminder.description}
                </p>
              )}
            </div>
          )}

          <Form {...completeForm}>
            <form
              onSubmit={completeForm.handleSubmit(onCompleteSubmit)}
              className="space-y-4"
            >
              <FormField
                control={completeForm.control}
                name="completionNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Completion Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add any notes about how this was completed..."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCompleteDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={completeReminderMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {completeReminderMutation.isPending
                    ? 'Completing...'
                    : 'Mark Complete'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
