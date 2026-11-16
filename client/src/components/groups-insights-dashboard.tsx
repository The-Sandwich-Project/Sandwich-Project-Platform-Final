import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Building2,
  Calendar,
  Target,
  Award,
  AlertCircle,
  Clock,
  Sparkles,
  Download,
  RefreshCw,
  Search,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Info,
  Lightbulb,
  Phone,
  Mail,
  Star,
  CheckCircle2,
  XCircle,
  MessageSquare,
  CalendarClock,
  Filter,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

import { usePageSession } from '@/hooks/usePageSession';
// Types matching backend
interface EngagementScores {
  overall: number;
  frequency: number;
  recency: number;
  volume: number;
  completion: number;
  consistency: number;
}

interface EngagementMetrics {
  totalEvents: number;
  completedEvents: number;
  totalSandwiches: number;
  daysSinceLastEvent: number | null;
  daysSinceFirstEvent: number | null;
  lastEventDate: string | null;
  firstEventDate: string | null;
  averageEventInterval: number | null;
  typicalEventInterval: number | null;
  frequencyPattern: 'monthly' | 'quarterly' | 'semi-annual' | 'annual' | 'irregular' | 'one-time' | 'none';
  daysOverdue: number | null;
  overduePercent: number | null;
}

interface EngagementInsight {
  type: 'warning' | 'opportunity' | 'positive' | 'info';
  title: string;
  description: string;
  priority: number;
}

interface RecommendedAction {
  action: string;
  reason: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
}

interface ProgramSuitability {
  program: string;
  score: number;
  reason: string;
}

interface OrganizationEngagement {
  organizationName: string;
  canonicalName: string;
  category: string | null;
  scores: EngagementScores;
  metrics: EngagementMetrics;
  engagementLevel: 'active' | 'at_risk' | 'dormant' | 'new';
  engagementTrend: 'increasing' | 'decreasing' | 'stable' | 'new';
  trendPercentChange: number;
  outreachPriority: 'urgent' | 'high' | 'normal' | 'low';
  insights: EngagementInsight[];
  recommendedActions: RecommendedAction[];
  programSuitability: ProgramSuitability[];
  lastCalculatedAt: string;
}

interface GroupInsightsSummary {
  totalOrganizations: number;
  engagementDistribution: {
    active: number;
    atRisk: number;
    dormant: number;
    new: number;
  };
  outreachPriorities: {
    urgent: number;
    high: number;
    normal: number;
    low: number;
  };
  categoryBreakdown: Record<string, {
    count: number;
    avgEngagementScore: number;
  }>;
  averageEngagementScore: number;
  topPerformers: OrganizationEngagement[];
  needsAttention: OrganizationEngagement[];
  newOpportunities: OrganizationEngagement[];
}

// Ambassador candidate types
interface AmbassadorCandidate {
  id: number;
  organizationName: string;
  canonicalName: string;
  category: string | null;
  status: 'identified' | 'contacted' | 'in_discussion' | 'confirmed' | 'declined' | 'on_hold';
  priority: 'high' | 'normal' | 'low';
  addedBy: number | null;
  addedAt: string;
  addedReason: string | null;
  lastContactedAt: string | null;
  lastContactedBy: number | null;
  contactMethod: string | null;
  nextFollowUpDate: string | null;
  notes: string | null;
  contactInfo: any;
  engagementScoreAtAdd: string | null;
  totalEventsAtAdd: number | null;
  totalSandwichesAtAdd: number | null;
  outcomeNotes: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  updatedAt: string;
}

// Event history types
interface EventHistoryItem {
  date: string;
  source: 'event_request' | 'collection';
  eventName: string | null;
  sandwichCount: number;
  status: string | null;
  eventType: string | null;
  address: string | null;
  notes: string | null;
  id: number | null;
}

interface OrganizationEventHistory {
  canonicalName: string;
  organizationName: string;
  events: EventHistoryItem[];
  totalEvents: number;
  totalSandwiches: number;
}

// Helper functions
const getEngagementLevelColor = (level: string): string => {
  switch (level) {
    case 'active': return 'bg-green-500';
    case 'at_risk': return 'bg-orange-500';
    case 'dormant': return 'bg-gray-500';
    case 'new': return 'bg-blue-500';
    default: return 'bg-gray-400';
  }
};

const getEngagementLevelBadge = (level: string) => {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    'active': 'default',
    'at_risk': 'destructive',
    'dormant': 'outline',
    'new': 'default',
  };

  const labels: Record<string, string> = {
    'active': 'Active',
    'at_risk': 'At Risk',
    'dormant': 'Dormant',
    'new': 'New',
  };

  return (
    <Badge variant={variants[level] || 'secondary'} className={cn(
      level === 'active' && 'bg-green-500',
      level === 'new' && 'bg-blue-500',
      level === 'at_risk' && 'bg-orange-500',
    )}>
      {labels[level] || level}
    </Badge>
  );
};

const getPriorityBadge = (priority: string) => {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    'urgent': 'destructive',
    'high': 'destructive',
    'normal': 'secondary',
    'low': 'outline',
  };

  return (
    <Badge variant={variants[priority] || 'secondary'} className={cn(
      priority === 'high' && 'bg-orange-500'
    )}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
};

const getTrendIcon = (trend: string) => {
  if (trend === 'increasing') {
    return <ArrowUpRight className="h-4 w-4 text-green-500" />;
  }
  if (trend === 'decreasing') {
    return <ArrowDownRight className="h-4 w-4 text-red-500" />;
  }
  return <Minus className="h-4 w-4 text-gray-400" />;
};

const formatDaysAgo = (days: number | null): string => {
  if (days === null) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
};

const getFrequencyPatternLabel = (pattern: string): string => {
  const labels: Record<string, string> = {
    'monthly': 'Monthly',
    'quarterly': 'Quarterly',
    'semi-annual': 'Semi-Annual',
    'annual': 'Annual',
    'irregular': 'Irregular',
    'one-time': 'One-Time',
    'none': 'No Events'
  };
  return labels[pattern] || pattern;
};

const getFrequencyPatternColor = (pattern: string): string => {
  switch (pattern) {
    case 'monthly': return 'bg-green-100 text-green-700 border-green-200';
    case 'quarterly': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'semi-annual': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'annual': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'irregular': return 'bg-gray-100 text-gray-700 border-gray-200';
    case 'one-time': return 'bg-gray-100 text-gray-600 border-gray-200';
    default: return 'bg-gray-100 text-gray-500 border-gray-200';
  }
};

const formatInterval = (days: number | null): string => {
  if (days === null) return 'N/A';
  if (days < 7) return `${days} days`;
  if (days < 30) return `~${Math.round(days / 7)} weeks`;
  if (days < 90) return `~${Math.round(days / 30)} month${Math.round(days / 30) > 1 ? 's' : ''}`;
  if (days < 365) return `~${Math.round(days / 30)} months`;
  return `~${(days / 365).toFixed(1)} years`;
};

const getDaysSinceLastEvent = (metrics: EngagementMetrics): number | null => {
  if (metrics.daysSinceLastEvent !== null && metrics.daysSinceLastEvent !== undefined) {
    return metrics.daysSinceLastEvent;
  }
  if (metrics.lastEventDate) {
    const last = new Date(metrics.lastEventDate);
    const now = new Date();
    const diff = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff : 0;
  }
  return null;
};

const getCategoryLabel = (category: string): string => {
  const labels: Record<string, string> = {
    'corp': 'Corporate',
    'small_medium_corp': 'Small/Medium Business',
    'large_corp': 'Large Corporation',
    'school': 'School',
    'church_faith': 'Church/Faith',
    'religious': 'Religious',
    'nonprofit': 'Nonprofit',
    'government': 'Government',
    'hospital': 'Hospital',
    'neighborhood': 'Neighborhood',
    'club': 'Club',
    'greek_life': 'Greek Life',
    'cultural': 'Cultural',
    'other': 'Other',
    'uncategorized': 'Uncategorized',
  };
  return labels[category] || category;
};

// Score display component
function ScoreDisplay({ label, score, color }: { label: string; score: number; color?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Progress value={score} className="w-20 h-2" />
        <span className="w-8 text-right font-medium">{Math.round(score)}</span>
      </div>
    </div>
  );
}

// Organization detail dialog with event history and ambassador functionality
function OrganizationDetailDialog({
  organization,
  open,
  onOpenChange
}: {
  organization: OrganizationEngagement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'events'>('overview');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch event history when the dialog is open
  const { data: eventHistory, isLoading: eventsLoading } = useQuery<OrganizationEventHistory>({
    queryKey: ['/api/group-engagement/organization', organization?.canonicalName, 'events'],
    queryFn: async () => {
      const response = await fetch(`/api/group-engagement/organization/${organization?.canonicalName}/events`);
      if (!response.ok) throw new Error('Failed to fetch event history');
      return response.json();
    },
    enabled: open && !!organization?.canonicalName,
  });

  // Check if already an ambassador candidate
  const { data: ambassadorCandidates = [] } = useQuery<AmbassadorCandidate[]>({
    queryKey: ['/api/group-engagement/ambassadors'],
    enabled: open,
  });

  const isAmbassadorCandidate = ambassadorCandidates.some(
    c => c.canonicalName === organization?.canonicalName
  );

  const existingCandidate = ambassadorCandidates.find(
    c => c.canonicalName === organization?.canonicalName
  );

  // Add to ambassador list mutation
  const addAmbassadorMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/group-engagement/ambassadors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName: organization?.organizationName,
          canonicalName: organization?.canonicalName,
          category: organization?.category,
          addedReason: `High engagement score (${Math.round(organization?.scores.overall || 0)}), recommended as ambassador candidate`,
          priority: 'normal',
          engagementScoreAtAdd: organization?.scores.overall,
          totalEventsAtAdd: organization?.metrics.totalEvents,
          totalSandwichesAtAdd: organization?.metrics.totalSandwiches,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to add ambassador');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Added to Ambassador List',
        description: `${organization?.organizationName} has been added as an ambassador candidate.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/group-engagement/ambassadors'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add to ambassador list',
        variant: 'destructive',
      });
    },
  });

  if (!organization) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[85vh] p-4 sm:p-6 overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {organization.organizationName}
            </div>
            {/* Ambassador button */}
            {organization.engagementLevel === 'active' && organization.scores.overall >= 70 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isAmbassadorCandidate ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => !isAmbassadorCandidate && addAmbassadorMutation.mutate()}
                    disabled={isAmbassadorCandidate || addAmbassadorMutation.isPending}
                  >
                    <Star className={cn("h-4 w-4 mr-1", isAmbassadorCandidate && "fill-amber-400 text-amber-400")} />
                    {isAmbassadorCandidate ? 'Ambassador Candidate' : 'Add to Ambassador List'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isAmbassadorCandidate
                    ? `Status: ${existingCandidate?.status}`
                    : 'Add this organization to your ambassador outreach list'}
                </TooltipContent>
              </Tooltip>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap">
            {organization.category && (
              <Badge variant="outline">{getCategoryLabel(organization.category)}</Badge>
            )}
            {getEngagementLevelBadge(organization.engagementLevel)}
            {getPriorityBadge(organization.outreachPriority)}
            <Badge variant="outline" className={cn("text-xs", getFrequencyPatternColor(organization.metrics.frequencyPattern))}>
              {getFrequencyPatternLabel(organization.metrics.frequencyPattern)}
            </Badge>
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex gap-2 border-b">
          <Button
            variant={activeTab === 'overview' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </Button>
          <Button
            variant={activeTab === 'events' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('events')}
          >
            <Calendar className="h-4 w-4 mr-1" />
            Event History ({organization.metrics.totalEvents})
          </Button>
        </div>

        <ScrollArea className="flex-1 pr-4">
          {activeTab === 'overview' ? (
            <div className="space-y-6 py-4">
              {/* Engagement Score */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Engagement Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="text-4xl font-bold">
                      {Math.round(organization.scores.overall)}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      {getTrendIcon(organization.engagementTrend)}
                      <span>{organization.engagementTrend}</span>
                      {organization.trendPercentChange !== 0 && (
                        <span>({organization.trendPercentChange > 0 ? '+' : ''}{organization.trendPercentChange}%)</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <ScoreDisplay label="Recency" score={organization.scores.recency} />
                    <ScoreDisplay label="Frequency" score={organization.scores.frequency} />
                    <ScoreDisplay label="Completion" score={organization.scores.completion} />
                    <ScoreDisplay label="Volume" score={organization.scores.volume} />
                    <ScoreDisplay label="Consistency" score={organization.scores.consistency} />
                  </div>
                </CardContent>
              </Card>

              {/* Metrics */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Activity Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Total Events</div>
                      <div className="text-xl font-semibold">{organization.metrics.totalEvents}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Completed Events</div>
                      <div className="text-xl font-semibold">{organization.metrics.completedEvents}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Total Sandwiches</div>
                      <div className="text-xl font-semibold">{organization.metrics.totalSandwiches.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Last Event</div>
                      <div className="text-xl font-semibold">{formatDaysAgo(getDaysSinceLastEvent(organization.metrics))}</div>
                    </div>
                    {organization.metrics.typicalEventInterval && (
                      <div>
                        <div className="text-sm text-muted-foreground">Typical Interval</div>
                        <div className="text-xl font-semibold">{formatInterval(organization.metrics.typicalEventInterval)}</div>
                      </div>
                    )}
                    {organization.metrics.daysOverdue !== null && organization.metrics.daysOverdue > 0 && (
                      <div>
                        <div className="text-sm text-muted-foreground">Days Overdue</div>
                        <div className="text-xl font-semibold text-red-600">{organization.metrics.daysOverdue}</div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Insights */}
              {organization.insights.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Lightbulb className="h-4 w-4" />
                      Insights
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {organization.insights.map((insight, idx) => (
                        <div key={idx} className={cn(
                          "p-3 rounded-lg border",
                          insight.type === 'warning' && 'border-red-200 bg-red-50',
                          insight.type === 'opportunity' && 'border-yellow-200 bg-yellow-50',
                          insight.type === 'positive' && 'border-green-200 bg-green-50',
                          insight.type === 'info' && 'border-blue-200 bg-blue-50',
                        )}>
                          <div className="font-medium">{insight.title}</div>
                          <div className="text-sm text-muted-foreground">{insight.description}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recommended Actions */}
              {organization.recommendedActions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Recommended Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {organization.recommendedActions.map((action, idx) => (
                        <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border">
                          {getPriorityBadge(action.priority)}
                          <div>
                            <div className="font-medium">{action.action}</div>
                            <div className="text-sm text-muted-foreground">{action.reason}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Program Suitability */}
              {organization.programSuitability.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Star className="h-4 w-4" />
                      Program Suitability
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {organization.programSuitability.map((program, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg border">
                          <div>
                            <div className="font-medium">{program.program}</div>
                            <div className="text-sm text-muted-foreground">{program.reason}</div>
                          </div>
                          <Badge variant="outline">{program.score}% match</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            /* Event History Tab */
            <div className="py-4">
              {eventsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : eventHistory?.events.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No event history found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Summary */}
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg mb-4">
                    <span className="text-sm font-medium">
                      {eventHistory?.totalEvents} events • {eventHistory?.totalSandwiches.toLocaleString()} total sandwiches
                    </span>
                  </div>

                  {/* Event list */}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Sandwiches</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventHistory?.events.map((event, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {new Date(event.date).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {event.sandwichCount.toLocaleString()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {event.status && (
                              <Badge variant="outline" className={cn(
                                event.status === 'completed' && 'bg-green-50 text-green-700',
                                event.status === 'scheduled' && 'bg-blue-50 text-blue-700',
                                event.status === 'cancelled' && 'bg-red-50 text-red-700',
                              )}>
                                {event.status}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">
                              {event.source === 'event_request' ? 'Event Request' : 'Collection Log'}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// Get overdue status indicator
const getOverdueIndicator = (metrics: EngagementMetrics) => {
  const pattern = metrics.frequencyPattern;
  const overduePercent = metrics.overduePercent;

  // No indicator for groups without established patterns
  if (pattern === 'none' || pattern === 'one-time' || pattern === 'irregular') {
    return null;
  }

  if (overduePercent === null || overduePercent < 20) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <div className="flex items-center gap-1 text-green-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
        </TooltipTrigger>
        <TooltipContent>On track</TooltipContent>
      </Tooltip>
    );
  }

  if (overduePercent < 50) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <div className="flex items-center gap-1 text-amber-500">
            <Clock className="h-4 w-4" />
          </div>
        </TooltipTrigger>
        <TooltipContent>{metrics.daysOverdue} days overdue - check in soon</TooltipContent>
      </Tooltip>
    );
  }

  if (overduePercent < 100) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <div className="flex items-center gap-1 text-orange-500">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </TooltipTrigger>
        <TooltipContent>{metrics.daysOverdue} days overdue - needs outreach</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        <div className="flex items-center gap-1 text-red-600">
          <AlertCircle className="h-4 w-4" />
        </div>
      </TooltipTrigger>
      <TooltipContent>{metrics.daysOverdue} days overdue - urgent outreach needed</TooltipContent>
    </Tooltip>
  );
};

// Get the most important insight for inline display
const getTopInsight = (insights: EngagementInsight[]): EngagementInsight | null => {
  if (!insights || insights.length === 0) return null;
  // Return highest priority (lowest number) warning or opportunity
  const actionable = insights.filter(i => i.type === 'warning' || i.type === 'opportunity');
  if (actionable.length > 0) {
    return actionable.sort((a, b) => a.priority - b.priority)[0];
  }
  return insights[0];
};

// Organization row component
function OrganizationRow({
  organization,
  onClick,
  showInsight = false
}: {
  organization: OrganizationEngagement;
  onClick: () => void;
  showInsight?: boolean;
}) {
  const metrics = organization.metrics;
  const pattern = metrics.frequencyPattern || 'none';
  const overdueIndicator = getOverdueIndicator(metrics);
  const topInsight = showInsight ? getTopInsight(organization.insights) : null;

  return (
    <TableRow
      className={cn(
        "cursor-pointer hover:bg-muted/50",
        organization.outreachPriority === 'urgent' && "bg-red-50/50",
        organization.outreachPriority === 'high' && "bg-orange-50/30"
      )}
      onClick={onClick}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full shrink-0", getEngagementLevelColor(organization.engagementLevel))} />
          <div className="min-w-0">
            <div className="font-medium truncate">{organization.organizationName}</div>
            {organization.category && (
              <div className="text-xs text-muted-foreground">{getCategoryLabel(organization.category)}</div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-semibold">{Math.round(organization.scores.overall)}</span>
          {getTrendIcon(organization.engagementTrend)}
        </div>
      </TableCell>
      <TableCell>
        {getEngagementLevelBadge(organization.engagementLevel)}
      </TableCell>
      <TableCell>
        {getPriorityBadge(organization.outreachPriority)}
      </TableCell>
      <TableCell className="text-right">
        {organization.metrics.totalEvents}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-xs", getFrequencyPatternColor(pattern))}>
              {getFrequencyPatternLabel(pattern)}
            </Badge>
            {overdueIndicator}
          </div>
          {metrics.typicalEventInterval && (
            <span className="text-xs text-muted-foreground">
              every {formatInterval(metrics.typicalEventInterval)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        {organization.metrics.totalSandwiches.toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        {formatDaysAgo(getDaysSinceLastEvent(organization.metrics))}
      </TableCell>
      {showInsight && (
        <TableCell className="max-w-[200px]">
          {topInsight && (
            <div className={cn(
              "text-xs px-2 py-1 rounded truncate",
              topInsight.type === 'warning' && 'bg-red-100 text-red-700',
              topInsight.type === 'opportunity' && 'bg-amber-100 text-amber-700',
              topInsight.type === 'positive' && 'bg-green-100 text-green-700',
              topInsight.type === 'info' && 'bg-blue-100 text-blue-700',
            )}>
              {topInsight.title}
            </div>
          )}
        </TableCell>
      )}
      <TableCell>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </TableCell>
    </TableRow>
  );
}

// Ambassador status helpers
const ambassadorStatusLabels: Record<string, string> = {
  identified: 'Identified',
  contacted: 'Contacted',
  in_discussion: 'In Discussion',
  confirmed: 'Confirmed',
  declined: 'Declined',
  on_hold: 'On Hold',
};

const ambassadorStatusColors: Record<string, string> = {
  identified: 'bg-gray-100 text-gray-700 border-gray-200',
  contacted: 'bg-blue-100 text-blue-700 border-blue-200',
  in_discussion: 'bg-amber-100 text-amber-700 border-amber-200',
  confirmed: 'bg-green-100 text-green-700 border-green-200',
  declined: 'bg-red-100 text-red-700 border-red-200',
  on_hold: 'bg-purple-100 text-purple-700 border-purple-200',
};

// Ambassador Candidates Tab Component
function AmbassadorCandidatesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingCandidate, setEditingCandidate] = useState<AmbassadorCandidate | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Fetch ambassador candidates
  const { data: candidates = [], isLoading } = useQuery<AmbassadorCandidate[]>({
    queryKey: ['/api/group-engagement/ambassadors'],
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<AmbassadorCandidate> }) => {
      const response = await fetch(`/api/group-engagement/ambassadors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error('Failed to update');
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Updated', description: 'Ambassador candidate updated successfully.' });
      queryClient.invalidateQueries({ queryKey: ['/api/group-engagement/ambassadors'] });
      setEditDialogOpen(false);
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update candidate', variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/group-engagement/ambassadors/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete');
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Removed', description: 'Ambassador candidate removed from list.' });
      queryClient.invalidateQueries({ queryKey: ['/api/group-engagement/ambassadors'] });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to remove candidate', variant: 'destructive' });
    },
  });

  // Filter candidates
  const filteredCandidates = statusFilter === 'all'
    ? candidates
    : candidates.filter(c => c.status === statusFilter);

  // Group by status for summary
  const statusCounts = candidates.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:border-primary" onClick={() => setStatusFilter('all')}>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{candidates.length}</div>
            <div className="text-sm text-muted-foreground">Total Candidates</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary" onClick={() => setStatusFilter('identified')}>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-gray-600">{statusCounts.identified || 0}</div>
            <div className="text-sm text-muted-foreground">To Contact</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary" onClick={() => setStatusFilter('in_discussion')}>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-600">{statusCounts.in_discussion || 0}</div>
            <div className="text-sm text-muted-foreground">In Discussion</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary" onClick={() => setStatusFilter('confirmed')}>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">{statusCounts.confirmed || 0}</div>
            <div className="text-sm text-muted-foreground">Confirmed</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="identified">Identified</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="in_discussion">In Discussion</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
          </SelectContent>
        </Select>
        {statusFilter !== 'all' && (
          <Button variant="ghost" size="sm" onClick={() => setStatusFilter('all')}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Clear Filter
          </Button>
        )}
      </div>

      {/* Candidates List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500" />
            Ambassador Candidates
          </CardTitle>
          <CardDescription>
            Track and manage your ambassador outreach process
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredCandidates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Star className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="font-medium">No ambassador candidates yet</p>
              <p className="text-sm">Add top-performing organizations from the Top Performers tab</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score (When Added)</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Last Contact</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCandidates.map((candidate) => (
                  <TableRow key={candidate.id}>
                    <TableCell>
                      <div className="font-medium">{candidate.organizationName}</div>
                      {candidate.category && (
                        <div className="text-xs text-muted-foreground">{getCategoryLabel(candidate.category)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ambassadorStatusColors[candidate.status]}>
                        {ambassadorStatusLabels[candidate.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {candidate.engagementScoreAtAdd ? Math.round(parseFloat(candidate.engagementScoreAtAdd)) : '-'}
                    </TableCell>
                    <TableCell>
                      {candidate.totalEventsAtAdd || '-'}
                    </TableCell>
                    <TableCell>
                      {new Date(candidate.addedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {candidate.lastContactedAt
                        ? new Date(candidate.lastContactedAt).toLocaleDateString()
                        : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingCandidate(candidate);
                                setEditDialogOpen(true);
                              }}
                            >
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Update Status / Log Contact</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm('Remove this organization from the ambassador list?')) {
                                  deleteMutation.mutate(candidate.id);
                                }
                              }}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove from List</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Ambassador Candidate</DialogTitle>
            <DialogDescription>
              {editingCandidate?.organizationName}
            </DialogDescription>
          </DialogHeader>
          {editingCandidate && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={editingCandidate.status}
                  onValueChange={(value) => setEditingCandidate({ ...editingCandidate, status: value as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="identified">Identified</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="in_discussion">In Discussion</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Notes</label>
                <Input
                  value={editingCandidate.notes || ''}
                  onChange={(e) => setEditingCandidate({ ...editingCandidate, notes: e.target.value })}
                  placeholder="Add notes about outreach..."
                />
              </div>

              <div>
                <label className="text-sm font-medium">Next Follow-up Date</label>
                <Input
                  type="date"
                  value={editingCandidate.nextFollowUpDate?.split('T')[0] || ''}
                  onChange={(e) => setEditingCandidate({
                    ...editingCandidate,
                    nextFollowUpDate: e.target.value ? new Date(e.target.value).toISOString() : null
                  })}
                />
              </div>

              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    updateMutation.mutate({
                      id: editingCandidate.id,
                      updates: {
                        status: editingCandidate.status,
                        notes: editingCandidate.notes,
                        nextFollowUpDate: editingCandidate.nextFollowUpDate,
                        recordContact: true, // This will update lastContactedAt
                      } as any,
                    });
                  }}
                  disabled={updateMutation.isPending}
                >
                  <Phone className="h-4 w-4 mr-1" />
                  Log Contact & Save
                </Button>
                <Button
                  onClick={() => {
                    updateMutation.mutate({
                      id: editingCandidate.id,
                      updates: {
                        status: editingCandidate.status,
                        notes: editingCandidate.notes,
                        nextFollowUpDate: editingCandidate.nextFollowUpDate,
                      },
                    });
                  }}
                  disabled={updateMutation.isPending}
                >
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Main component
export default function GroupsInsightsDashboard() {
  // Track page session for activity logging
  usePageSession({
    section: 'Directory',
    page: 'Groups Engagement Insights',
  });

  const { user, isLoading: authLoading } = useAuth();
  const [selectedOrg, setSelectedOrg] = useState<OrganizationEngagement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [engagementFilter, setEngagementFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [frequencyFilter, setFrequencyFilter] = useState<string>('all');
  const [overdueFilter, setOverdueFilter] = useState<string>('all');
  // Column sorting: null means default/no sort, then cycles through asc -> desc -> null
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);

  // Reset all filters
  const resetFilters = () => {
    setSearchQuery('');
    setEngagementFilter('all');
    setPriorityFilter('all');
    setCategoryFilter('all');
    setFrequencyFilter('all');
    setOverdueFilter('all');
    setSortColumn(null);
    setSortOrder(null);
  };

  // Check if any filters are active
  const hasActiveFilters = searchQuery || engagementFilter !== 'all' || priorityFilter !== 'all' ||
    categoryFilter !== 'all' || frequencyFilter !== 'all' || overdueFilter !== 'all';

  // Handle column header click for sorting
  const handleColumnSort = (column: string) => {
    if (sortColumn !== column) {
      // New column: start with ascending
      setSortColumn(column);
      setSortOrder('asc');
    } else if (sortOrder === 'asc') {
      // Same column, was ascending: switch to descending
      setSortOrder('desc');
    } else if (sortOrder === 'desc') {
      // Same column, was descending: clear sort (back to default)
      setSortColumn(null);
      setSortOrder(null);
    } else {
      // Was null, start ascending
      setSortOrder('asc');
    }
  };

  // Get sort icon for column header
  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-4 w-4 ml-1 text-muted-foreground/50" />;
    }
    if (sortOrder === 'asc') {
      return <ArrowUp className="h-4 w-4 ml-1 text-primary" />;
    }
    if (sortOrder === 'desc') {
      return <ArrowDown className="h-4 w-4 ml-1 text-primary" />;
    }
    return <ArrowUpDown className="h-4 w-4 ml-1 text-muted-foreground/50" />;
  };

  // Fetch insights summary
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<GroupInsightsSummary>({
    queryKey: ['/api/group-engagement/insights'],
    queryFn: async () => {
      const response = await fetch('/api/group-engagement/insights', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch group engagement insights');
      return response.json();
    },
    enabled: !!user && !authLoading,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch all scores with filters (sorting is done client-side for column header clicks)
  const { data: scoresData, isLoading: scoresLoading, refetch: refetchScores } = useQuery<{
    total: number;
    organizations: OrganizationEngagement[];
  }>({
    queryKey: ['/api/group-engagement/scores', engagementFilter, priorityFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (engagementFilter !== 'all') params.set('engagementLevel', engagementFilter);
      if (priorityFilter !== 'all') params.set('outreachPriority', priorityFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);

      const response = await fetch(`/api/group-engagement/scores?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch organization scores');
      return response.json();
    },
    enabled: !!user && !authLoading,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = authLoading || summaryLoading || scoresLoading;

  // Filter and sort organizations
  const filteredOrganizations = useMemo(() => {
    if (!scoresData?.organizations) return [];

    let result = scoresData.organizations;

    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(org =>
        org.organizationName.toLowerCase().includes(query) ||
        (org.category && org.category.toLowerCase().includes(query))
      );
    }

    // Filter by frequency pattern
    if (frequencyFilter !== 'all') {
      result = result.filter(org => org.metrics.frequencyPattern === frequencyFilter);
    }

    // Filter by overdue status
    if (overdueFilter !== 'all') {
      result = result.filter(org => {
        const overduePercent = org.metrics.overduePercent;
        const pattern = org.metrics.frequencyPattern;
        // Skip groups with no established pattern
        if (pattern === 'none' || pattern === 'one-time' || pattern === 'irregular') {
          return overdueFilter === 'not_applicable';
        }
        if (overdueFilter === 'not_applicable') return false;
        if (overdueFilter === 'on_track') return overduePercent === null || overduePercent < 20;
        if (overdueFilter === 'slightly_overdue') return overduePercent !== null && overduePercent >= 20 && overduePercent < 50;
        if (overdueFilter === 'overdue') return overduePercent !== null && overduePercent >= 50 && overduePercent < 100;
        if (overdueFilter === 'very_overdue') return overduePercent !== null && overduePercent >= 100;
        return true;
      });
    }

    // Then sort if a column is selected
    if (sortColumn && sortOrder) {
      result = [...result].sort((a, b) => {
        let aVal: string | number | null = null;
        let bVal: string | number | null = null;

        switch (sortColumn) {
          case 'organization':
            aVal = a.organizationName.toLowerCase();
            bVal = b.organizationName.toLowerCase();
            break;
          case 'score':
            aVal = a.scores.overall;
            bVal = b.scores.overall;
            break;
          case 'level':
            // Sort by engagement level order
            const levelOrder = ['active', 'at_risk', 'dormant', 'new'];
            aVal = levelOrder.indexOf(a.engagementLevel);
            bVal = levelOrder.indexOf(b.engagementLevel);
            break;
          case 'priority':
            // Sort by priority order
            const priorityOrder = ['urgent', 'high', 'normal', 'low'];
            aVal = priorityOrder.indexOf(a.outreachPriority);
            bVal = priorityOrder.indexOf(b.outreachPriority);
            break;
          case 'events':
            aVal = a.metrics.totalEvents;
            bVal = b.metrics.totalEvents;
            break;
          case 'frequency':
            // Sort by typical interval (lower = more frequent)
            // Put null/irregular at the end
            const patternOrder = ['monthly', 'quarterly', 'semi-annual', 'annual', 'irregular', 'one-time', 'none'];
            aVal = patternOrder.indexOf(a.metrics.frequencyPattern || 'none');
            bVal = patternOrder.indexOf(b.metrics.frequencyPattern || 'none');
            break;
          case 'sandwiches':
            aVal = a.metrics.totalSandwiches;
            bVal = b.metrics.totalSandwiches;
            break;
          case 'lastEvent':
            // Sort by days since last event (null = never = highest number)
            aVal = getDaysSinceLastEvent(a.metrics) ?? 99999;
            bVal = getDaysSinceLastEvent(b.metrics) ?? 99999;
            break;
          case 'overdue':
            // Sort by overdue percentage (null = 0, higher = more overdue)
            aVal = a.metrics.overduePercent ?? -1;
            bVal = b.metrics.overduePercent ?? -1;
            break;
          default:
            return 0;
        }

        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          const comparison = aVal.localeCompare(bVal);
          return sortOrder === 'asc' ? comparison : -comparison;
        }

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        }

        return 0;
      });
    }

    return result;
  }, [scoresData, searchQuery, sortColumn, sortOrder]);

  // Chart data for engagement distribution
  const engagementChartData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: 'Active', value: summary.engagementDistribution.active, color: '#22c55e' },
      { name: 'At Risk', value: summary.engagementDistribution.atRisk, color: '#f97316' },
      { name: 'Dormant', value: summary.engagementDistribution.dormant, color: '#6b7280' },
      { name: 'New', value: summary.engagementDistribution.new, color: '#3b82f6' },
    ].filter(item => item.value > 0);
  }, [summary]);

  // Chart data for outreach priorities
  const priorityChartData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: 'Urgent', value: summary.outreachPriorities.urgent, color: '#ef4444' },
      { name: 'High', value: summary.outreachPriorities.high, color: '#f97316' },
      { name: 'Normal', value: summary.outreachPriorities.normal, color: '#6b7280' },
      { name: 'Low', value: summary.outreachPriorities.low, color: '#22c55e' },
    ].filter(item => item.value > 0);
  }, [summary]);

  // Categories for filter
  const categories = useMemo(() => {
    if (!summary?.categoryBreakdown) return [];
    return Object.keys(summary.categoryBreakdown).sort();
  }, [summary]);

  const handleExport = async () => {
    try {
      const response = await fetch('/api/group-engagement/export', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'group-engagement-scores.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleRefresh = async () => {
    try {
      await fetch('/api/group-engagement/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      refetchSummary();
      refetchScores();
    } catch (error) {
      console.error('Refresh failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-yellow-500" />
              Groups Engagement Insights
            </h2>
            <p className="text-muted-foreground">
              AI-powered analysis of organization engagement to prioritize outreach
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Organizations</CardTitle>
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalOrganizations}</div>
                <p className="text-xs text-muted-foreground">
                  Unique groups in catalog
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Engagement Score</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{Math.round(summary.averageEngagementScore)}</div>
                <Progress value={summary.averageEngagementScore} className="mt-2" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Needs Attention</CardTitle>
                <AlertTriangle className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-500">
                  {summary.outreachPriorities.urgent + summary.outreachPriorities.high}
                </div>
                <p className="text-xs text-muted-foreground">
                  {summary.outreachPriorities.urgent} urgent, {summary.outreachPriorities.high} high priority
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">New Opportunities</CardTitle>
                <Sparkles className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-500">
                  {summary.newOpportunities.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  New orgs with completed events
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Engagement Distribution</CardTitle>
              <CardDescription>
                Organizations by engagement level
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={engagementChartData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {engagementChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend />
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Outreach Priorities</CardTitle>
              <CardDescription>
                Organizations by outreach priority level
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={priorityChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RechartsTooltip />
                    <Bar dataKey="value">
                      {priorityChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for different views */}
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList>
            <TabsTrigger value="all">All Organizations</TabsTrigger>
            <TabsTrigger value="attention" className="text-orange-600">
              Needs Attention
            </TabsTrigger>
            <TabsTrigger value="top" className="text-green-600">
              Top Performers
            </TabsTrigger>
            <TabsTrigger value="new" className="text-blue-600">
              New Opportunities
            </TabsTrigger>
            <TabsTrigger value="ambassadors" className="text-amber-600">
              <Star className="h-4 w-4 mr-1" />
              Ambassadors
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            {/* Filters */}
            <Card className="mb-4">
              <CardContent className="pt-4">
                <div className="flex flex-wrap gap-3">
                  {/* Search */}
                  <div className="flex-1 min-w-[200px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search organizations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>

                  {/* Engagement Level */}
                  <Select value={engagementFilter} onValueChange={setEngagementFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Levels</SelectItem>
                      <SelectItem value="active">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          Active
                        </div>
                      </SelectItem>
                      <SelectItem value="at_risk">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-orange-500" />
                          At Risk
                        </div>
                      </SelectItem>
                      <SelectItem value="dormant">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-gray-500" />
                          Dormant
                        </div>
                      </SelectItem>
                      <SelectItem value="new">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          New
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Priority */}
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Priorities</SelectItem>
                      <SelectItem value="urgent">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-3 w-3 text-red-500" />
                          Urgent
                        </div>
                      </SelectItem>
                      <SelectItem value="high">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 text-orange-500" />
                          High
                        </div>
                      </SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Frequency Pattern - NEW */}
                  <Select value={frequencyFilter} onValueChange={setFrequencyFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Patterns</SelectItem>
                      <SelectItem value="monthly">
                        <Badge variant="outline" className="text-xs bg-green-100 text-green-700">Monthly</Badge>
                      </SelectItem>
                      <SelectItem value="quarterly">
                        <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700">Quarterly</Badge>
                      </SelectItem>
                      <SelectItem value="semi-annual">
                        <Badge variant="outline" className="text-xs bg-purple-100 text-purple-700">Semi-Annual</Badge>
                      </SelectItem>
                      <SelectItem value="annual">
                        <Badge variant="outline" className="text-xs bg-amber-100 text-amber-700">Annual</Badge>
                      </SelectItem>
                      <SelectItem value="irregular">Irregular</SelectItem>
                      <SelectItem value="one-time">One-Time</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Overdue Status - NEW */}
                  <Select value={overdueFilter} onValueChange={setOverdueFilter}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Overdue Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="on_track">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                          On Track
                        </div>
                      </SelectItem>
                      <SelectItem value="slightly_overdue">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-amber-500" />
                          Slightly Overdue
                        </div>
                      </SelectItem>
                      <SelectItem value="overdue">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 text-orange-500" />
                          Overdue
                        </div>
                      </SelectItem>
                      <SelectItem value="very_overdue">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-3 w-3 text-red-500" />
                          Very Overdue
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Category */}
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map(cat => (
                        <SelectItem key={cat} value={cat}>{getCategoryLabel(cat)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Reset Filters Button */}
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={resetFilters} className="h-10">
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Reset
                    </Button>
                  )}
                </div>

                {/* Active filters summary */}
                {hasActiveFilters && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Filter className="h-4 w-4" />
                    <span>Showing {filteredOrganizations.length} of {scoresData?.organizations?.length || 0} organizations</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* All organizations table */}
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleColumnSort('organization')}
                      >
                        <div className="flex items-center">
                          Organization
                          {getSortIcon('organization')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleColumnSort('score')}
                      >
                        <div className="flex items-center">
                          Score
                          {getSortIcon('score')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleColumnSort('level')}
                      >
                        <div className="flex items-center">
                          Level
                          {getSortIcon('level')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleColumnSort('priority')}
                      >
                        <div className="flex items-center">
                          Priority
                          {getSortIcon('priority')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleColumnSort('events')}
                      >
                        <div className="flex items-center justify-end">
                          # Events
                          {getSortIcon('events')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleColumnSort('frequency')}
                      >
                        <div className="flex items-center">
                          Frequency
                          {getSortIcon('frequency')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleColumnSort('sandwiches')}
                      >
                        <div className="flex items-center justify-end">
                          Sandwiches
                          {getSortIcon('sandwiches')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleColumnSort('lastEvent')}
                      >
                        <div className="flex items-center justify-end">
                          Last Event
                          {getSortIcon('lastEvent')}
                        </div>
                      </TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrganizations.map(org => (
                      <OrganizationRow
                        key={org.canonicalName}
                        organization={org}
                        onClick={() => {
                          setSelectedOrg(org);
                          setDialogOpen(true);
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
                {filteredOrganizations.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No organizations found matching your filters
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="attention">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                  Organizations Needing Attention
                </CardTitle>
                <CardDescription>
                  These organizations have urgent or high priority for outreach based on their engagement patterns
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Quick stats for attention tab */}
                {summary && (summary.outreachPriorities.urgent > 0 || summary.outreachPriorities.high > 0) && (
                  <div className="flex gap-4 mb-4 p-3 bg-muted/50 rounded-lg">
                    {summary.outreachPriorities.urgent > 0 && (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-red-500" />
                        <span className="font-semibold text-red-600">{summary.outreachPriorities.urgent} urgent</span>
                        <span className="text-sm text-muted-foreground">- need immediate outreach</span>
                      </div>
                    )}
                    {summary.outreachPriorities.high > 0 && (
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-orange-500" />
                        <span className="font-semibold text-orange-600">{summary.outreachPriorities.high} high priority</span>
                        <span className="text-sm text-muted-foreground">- schedule follow-up</span>
                      </div>
                    )}
                  </div>
                )}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="text-right"># Events</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead className="text-right">Sandwiches</TableHead>
                      <TableHead className="text-right">Last Event</TableHead>
                      <TableHead>Key Insight</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary?.needsAttention.map(org => (
                      <OrganizationRow
                        key={org.canonicalName}
                        organization={org}
                        onClick={() => {
                          setSelectedOrg(org);
                          setDialogOpen(true);
                        }}
                        showInsight={true}
                      />
                    ))}
                  </TableBody>
                </Table>
                {(!summary?.needsAttention || summary.needsAttention.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500 opacity-50" />
                    <p className="font-medium">All caught up!</p>
                    <p className="text-sm">No organizations currently need urgent attention</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="top">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-green-500" />
                  Top Performing Partners
                </CardTitle>
                <CardDescription>
                  These organizations are highly engaged and could be great ambassadors
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="text-right"># Events</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead className="text-right">Sandwiches</TableHead>
                      <TableHead className="text-right">Last Event</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary?.topPerformers.map(org => (
                      <OrganizationRow
                        key={org.canonicalName}
                        organization={org}
                        onClick={() => {
                          setSelectedOrg(org);
                          setDialogOpen(true);
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
                {(!summary?.topPerformers || summary.topPerformers.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    No top performers found
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="new">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-500" />
                  New Opportunities
                </CardTitle>
                <CardDescription>
                  New organizations with completed events - nurture these relationships
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="text-right"># Events</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead className="text-right">Sandwiches</TableHead>
                      <TableHead className="text-right">Last Event</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary?.newOpportunities.map(org => (
                      <OrganizationRow
                        key={org.canonicalName}
                        organization={org}
                        onClick={() => {
                          setSelectedOrg(org);
                          setDialogOpen(true);
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
                {(!summary?.newOpportunities || summary.newOpportunities.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    No new opportunities found
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ambassadors">
            <AmbassadorCandidatesTab />
          </TabsContent>
        </Tabs>

        {/* Organization Detail Dialog */}
        <OrganizationDetailDialog
          organization={selectedOrg}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </div>
    </TooltipProvider>
  );
}
