import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Database,
  DollarSign,
  Play,
  Pause,
  Square,
  Search,
  TrendingUp,
  Download,
  Plus,
  Pencil,
  Trash2,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { usePageSession } from '@/hooks/usePageSession';
interface SearchableFeature {
  id: string;
  title: string;
  description: string;
  category: string;
  route: string;
  keywords: string[];
  embedding?: number[];
  requiredPermissions?: string[];
}

interface EmbeddingStatus {
  total: number;
  withEmbeddings: number;
  percentage: number;
}

interface RegenerationProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: boolean;
  currentFeature?: string;
  errors: Array<{
    featureId: string;
    featureTitle: string;
    error: string;
    timestamp: Date;
  }>;
  startTime?: Date;
  estimatedTimeRemaining?: number;
  isPaused?: boolean;
}

interface CostEstimate {
  totalFeatures: number;
  estimatedTokens: number;
  estimatedCost: number;
  model: string;
}

interface AnalyticsSummary {
  totalSearches: number;
  topSearches: Array<{ query: string; count: number }>;
  featureAnalytics: Array<{
    featureId: string;
    searchCount: number;
    clickCount: number;
    lastSearched?: Date;
  }>;
  deadFeatures: string[];
}

interface QualityMetric {
  featureId: string;
  featureTitle: string;
  hasEmbedding: boolean;
  embeddingDimension?: number;
  qualityScore?: number;
}

export default function SmartSearchAdmin() {
  // Track page session for activity logging
  usePageSession({
    section: 'Administration',
    page: 'SmartSearch AI',
  });

  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [regenerationMode, setRegenerationMode] = useState<
    'all' | 'missing' | 'failed' | 'selected'
  >('missing');
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [searchTestQuery, setSearchTestQuery] = useState('');
  const [searchTestResults, setSearchTestResults] = useState<any>(null);
  const [editingFeature, setEditingFeature] =
    useState<SearchableFeature | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  // Fetch all features
  const {
    data: featuresData,
    isLoading: featuresLoading,
    refetch: refetchFeatures,
  } = useQuery({
    queryKey: ['/api/smart-search/features'],
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes (reduced from 5 seconds)
  });

  // Fetch regeneration progress
  const { data: progressData } = useQuery<RegenerationProgress | null>({
    queryKey: ['/api/smart-search/regeneration-progress'],
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes (reduced from 2 seconds)
  });

  // Fetch analytics summary
  const { data: analyticsData, refetch: refetchAnalytics } =
    useQuery<AnalyticsSummary>({
      queryKey: ['/api/smart-search/analytics-summary'],
      enabled: activeTab === 'analytics',
    });

  // Fetch quality metrics
  const { data: qualityMetrics, refetch: refetchQuality } = useQuery<
    QualityMetric[]
  >({
    queryKey: ['/api/smart-search/quality-metrics'],
    enabled: activeTab === 'quality',
  });

  // Calculate embedding status
  const embeddingStatus: EmbeddingStatus | null = featuresData?.features
    ? {
        total: featuresData.features.length,
        withEmbeddings: featuresData.features.filter(
          (f: SearchableFeature) => f.embedding
        ).length,
        percentage:
          featuresData.features.length > 0
            ? Math.round(
                (featuresData.features.filter(
                  (f: SearchableFeature) => f.embedding
                ).length /
                  featuresData.features.length) *
                  100
              )
            : 0,
      }
    : null;

  // Get cost estimate
  const getCostEstimate = useCallback(async () => {
    try {
      const options: any = { mode: regenerationMode };
      if (regenerationMode === 'selected' && selectedFeatures.length > 0) {
        options.featureIds = selectedFeatures;
      }

      const estimate = await apiRequest(
        'POST',
        '/api/smart-search/cost-estimate',
        options
      );
      setCostEstimate(estimate);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to get cost estimate',
        variant: 'destructive',
      });
    }
  }, [regenerationMode, selectedFeatures, toast]);

  // Regenerate embeddings
  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const options: any = { mode: regenerationMode };
      if (regenerationMode === 'selected' && selectedFeatures.length > 0) {
        options.featureIds = selectedFeatures;
      }
      return apiRequest(
        'POST',
        '/api/smart-search/regenerate-embeddings-advanced',
        options
      );
    },
    onSuccess: () => {
      toast({
        title: 'Started',
        description: 'Embedding regeneration started',
      });
      refetchFeatures();
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to start regeneration',
        variant: 'destructive',
      });
    },
  });

  // Pause regeneration
  const pauseMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/smart-search/pause-regeneration'),
    onSuccess: () =>
      toast({ title: 'Paused', description: 'Regeneration paused' }),
  });

  // Resume regeneration
  const resumeMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/smart-search/resume-regeneration'),
    onSuccess: () =>
      toast({ title: 'Resumed', description: 'Regeneration resumed' }),
  });

  // Stop regeneration
  const stopMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/smart-search/stop-regeneration'),
    onSuccess: () =>
      toast({ title: 'Stopped', description: 'Regeneration stopped' }),
  });

  // Test search
  const testSearch = async () => {
    if (!searchTestQuery.trim()) return;

    try {
      const result = await apiRequest('POST', '/api/smart-search/test-search', {
        query: searchTestQuery,
        userRole: user?.role,
      });
      setSearchTestResults(result);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to test search',
        variant: 'destructive',
      });
    }
  };

  // Export features
  const exportFeatures = async () => {
    try {
      const features = await apiRequest('GET', '/api/smart-search/export');
      const blob = new Blob([JSON.stringify(features, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'smart-search-features.json';
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Success', description: 'Features exported' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to export features',
        variant: 'destructive',
      });
    }
  };

  // Delete feature
  const deleteFeatureMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest('DELETE', `/api/smart-search/feature/${id}`),
    onSuccess: () => {
      toast({ title: 'Success', description: 'Feature deleted' });
      refetchFeatures();
    },
  });

  // Update cost estimate when mode changes
  useEffect(() => {
    getCostEstimate();
  }, [regenerationMode, selectedFeatures, getCostEstimate]);

  // Check admin access
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            You must be an administrator to access this page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const formatTimeRemaining = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-100">
          <Sparkles className="w-6 h-6 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            SmartSearch AI Admin
          </h1>
          <p className="text-sm text-gray-600">
            Comprehensive AI embeddings and search management
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="test">Test Search</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Status Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Embedding Status
              </CardTitle>
              <CardDescription>
                AI embeddings enable semantic search for better results
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {featuresLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : embeddingStatus ? (
                <>
                  {/* Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">
                        Total Features
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {embeddingStatus.total}
                      </div>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">
                        With Embeddings
                      </div>
                      <div className="text-2xl font-bold text-green-600">
                        {embeddingStatus.withEmbeddings}
                      </div>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Coverage</div>
                      <div className="flex items-center gap-2">
                        <div className="text-2xl font-bold text-purple-600">
                          {embeddingStatus.percentage}%
                        </div>
                        <Badge
                          variant={
                            embeddingStatus.percentage === 100
                              ? 'default'
                              : 'secondary'
                          }
                          className={
                            embeddingStatus.percentage === 100
                              ? 'bg-green-500'
                              : ''
                          }
                        >
                          {embeddingStatus.percentage === 100
                            ? 'Complete'
                            : 'Incomplete'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Embedding Coverage</span>
                      <span className="font-medium">
                        {embeddingStatus.withEmbeddings} /{' '}
                        {embeddingStatus.total}
                      </span>
                    </div>
                    <Progress
                      value={embeddingStatus.percentage}
                      className="h-2"
                    />
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* Regeneration Control */}
          <Card>
            <CardHeader>
              <CardTitle>Generate AI Embeddings</CardTitle>
              <CardDescription>
                Pre-generate embeddings for features to improve search
                performance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode Selection */}
              <div className="space-y-3">
                <Label>Regeneration Mode</Label>
                <RadioGroup
                  value={regenerationMode}
                  onValueChange={(v: any) => setRegenerationMode(v)}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="missing" id="missing" />
                    <Label htmlFor="missing" className="font-normal">
                      Missing Only - Generate only for features without
                      embeddings (Recommended)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="all" id="all" />
                    <Label htmlFor="all" className="font-normal">
                      All Features - Regenerate all embeddings
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="failed" id="failed" />
                    <Label htmlFor="failed" className="font-normal">
                      Failed Only - Retry previously failed embeddings
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="selected" id="selected" />
                    <Label htmlFor="selected" className="font-normal">
                      Selected Features - Choose specific features (Go to
                      Features tab)
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Cost Estimate */}
              {costEstimate && (
                <Alert>
                  <DollarSign className="h-4 w-4" />
                  <AlertTitle>Cost Estimate</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1 mt-2">
                      <p>
                        <strong>Features to process:</strong>{' '}
                        {costEstimate.totalFeatures}
                      </p>
                      <p>
                        <strong>Estimated tokens:</strong>{' '}
                        {costEstimate.estimatedTokens.toLocaleString()}
                      </p>
                      <p>
                        <strong>Estimated cost:</strong> $
                        {costEstimate.estimatedCost.toFixed(4)} USD
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Model: {costEstimate.model}
                      </p>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* Progress Display */}
              {progressData?.inProgress && (
                <div className="space-y-3 p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {progressData.isPaused ? (
                        <>
                          <Pause className="w-4 h-4" />
                          <span>Paused</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Generating embeddings...</span>
                        </>
                      )}
                    </div>
                    <div className="text-sm">
                      {progressData.completed} / {progressData.total}
                    </div>
                  </div>
                  <Progress
                    value={(progressData.completed / progressData.total) * 100}
                    className="h-2"
                  />
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>{progressData.currentFeature}</span>
                    {progressData.estimatedTimeRemaining && (
                      <span>
                        ~
                        {formatTimeRemaining(
                          progressData.estimatedTimeRemaining
                        )}{' '}
                        remaining
                      </span>
                    )}
                  </div>
                  {progressData.failed > 0 && (
                    <p className="text-xs text-red-600">
                      {progressData.failed} failed
                    </p>
                  )}
                </div>
              )}

              {/* Error Display */}
              {progressData?.errors && progressData.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Errors ({progressData.errors.length})</AlertTitle>
                  <AlertDescription>
                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                      {progressData.errors.slice(0, 5).map((error, i) => (
                        <div key={i} className="text-xs">
                          <strong>{error.featureTitle}:</strong> {error.error}
                        </div>
                      ))}
                      {progressData.errors.length > 5 && (
                        <p className="text-xs italic">
                          And {progressData.errors.length - 5} more...
                        </p>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* Controls */}
              <div className="flex gap-3 flex-wrap">
                {progressData?.inProgress ? (
                  <>
                    {progressData.isPaused ? (
                      <Button
                        onClick={() => resumeMutation.mutate()}
                        className="gap-2"
                      >
                        <Play className="w-4 h-4" />
                        Resume
                      </Button>
                    ) : (
                      <Button
                        onClick={() => pauseMutation.mutate()}
                        variant="outline"
                        className="gap-2"
                      >
                        <Pause className="w-4 h-4" />
                        Pause
                      </Button>
                    )}
                    <Button
                      onClick={() => stopMutation.mutate()}
                      variant="destructive"
                      className="gap-2"
                    >
                      <Square className="w-4 h-4" />
                      Stop
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => regenerateMutation.mutate()}
                    disabled={
                      regenerateMutation.isPending ||
                      (regenerationMode === 'selected' &&
                        selectedFeatures.length === 0)
                    }
                    className="gap-2"
                    data-testid="button-regenerate-embeddings"
                  >
                    <Sparkles className="w-4 h-4" />
                    Start Regeneration
                  </Button>
                )}

                <Button
                  variant="outline"
                  onClick={() => refetchFeatures()}
                  className="gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Feature Management</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={exportFeatures}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Export
              </Button>
              <Button
                onClick={() => setIsAddDialogOpen(true)}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Feature
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {regenerationMode === 'selected' && (
                        <TableHead className="w-12"></TableHead>
                      )}
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Embedding</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {featuresData?.features.map(
                      (feature: SearchableFeature) => (
                        <TableRow key={feature.id}>
                          {regenerationMode === 'selected' && (
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedFeatures.includes(feature.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedFeatures([
                                      ...selectedFeatures,
                                      feature.id,
                                    ]);
                                  } else {
                                    setSelectedFeatures(
                                      selectedFeatures.filter(
                                        (id) => id !== feature.id
                                      )
                                    );
                                  }
                                }}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-medium">
                            {feature.title}
                          </TableCell>
                          <TableCell>{feature.category}</TableCell>
                          <TableCell>
                            {feature.embedding ? (
                              <Badge className="bg-green-500">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Yes
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                <AlertCircle className="w-3 h-3 mr-1" />
                                No
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingFeature(feature);
                                  setIsEditDialogOpen(true);
                                }}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    <Trash2 className="w-4 h-4 text-red-500" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Delete Feature
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete "
                                      {feature.title}"? This action cannot be
                                      undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() =>
                                        deleteFeatureMutation.mutate(feature.id)
                                      }
                                      className="bg-red-600 hover:bg-red-700"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Search Analytics</h2>
            <Button
              variant="outline"
              onClick={() => refetchAnalytics()}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>

          {analyticsData && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      Top Searches
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {analyticsData.topSearches
                        .slice(0, 10)
                        .map((search, i) => (
                          <div
                            key={i}
                            className="flex justify-between items-center"
                          >
                            <span className="text-sm">{search.query}</span>
                            <Badge>{search.count}</Badge>
                          </div>
                        ))}
                      {analyticsData.topSearches.length === 0 && (
                        <p className="text-sm text-gray-500">
                          No search data yet
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5" />
                      Overview
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <div className="text-sm text-gray-600">
                        Total Searches
                      </div>
                      <div className="text-2xl font-bold">
                        {analyticsData.totalSearches}
                      </div>
                    </div>
                    <div className="p-3 bg-orange-50 rounded-lg">
                      <div className="text-sm text-gray-600">
                        Unused Features
                      </div>
                      <div className="text-2xl font-bold">
                        {analyticsData.deadFeatures.length}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* Quality Tab */}
        <TabsContent value="quality" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Embedding Quality Metrics</h2>
            <Button
              variant="outline"
              onClick={() => refetchQuality()}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feature</TableHead>
                      <TableHead>Embedding</TableHead>
                      <TableHead>Dimension</TableHead>
                      <TableHead>Quality Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qualityMetrics?.map((metric) => (
                      <TableRow key={metric.featureId}>
                        <TableCell className="font-medium">
                          {metric.featureTitle}
                        </TableCell>
                        <TableCell>
                          {metric.hasEmbedding ? (
                            <Badge className="bg-green-500">Yes</Badge>
                          ) : (
                            <Badge variant="secondary">No</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {metric.embeddingDimension || '-'}
                        </TableCell>
                        <TableCell>
                          {metric.qualityScore !== undefined ? (
                            <div className="flex items-center gap-2">
                              <Progress
                                value={metric.qualityScore * 100}
                                className="w-24 h-2"
                              />
                              <span className="text-sm">
                                {Math.round(metric.qualityScore * 100)}%
                              </span>
                            </div>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Test Search Tab */}
        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                Test Search Functionality
              </CardTitle>
              <CardDescription>
                Test the search functionality and see how results are ranked
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter search query..."
                  value={searchTestQuery}
                  onChange={(e) => setSearchTestQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && testSearch()}
                />
                <Button onClick={testSearch} className="gap-2">
                  <Search className="w-4 h-4" />
                  Search
                </Button>
              </div>

              {searchTestResults && (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>
                      Found {searchTestResults.results.length} results in{' '}
                      {searchTestResults.queryTime}ms
                    </span>
                    <Badge
                      variant={
                        searchTestResults.usedAI ? 'default' : 'secondary'
                      }
                    >
                      {searchTestResults.usedAI ? 'AI Search' : 'Fuzzy Search'}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {searchTestResults.results.map((result: any, i: number) => (
                      <div key={i} className="p-3 border rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-medium">
                            {result.feature.title}
                          </h3>
                          <div className="flex gap-2 items-center">
                            <Badge variant="outline">{result.matchType}</Badge>
                            <span className="text-sm text-gray-600">
                              {Math.round(result.score * 100)}%
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">
                          {result.feature.description}
                        </p>
                        <div className="flex gap-1 mt-2">
                          {result.feature.keywords
                            .slice(0, 5)
                            .map((kw: string, ki: number) => (
                              <Badge
                                key={ki}
                                variant="secondary"
                                className="text-xs"
                              >
                                {kw}
                              </Badge>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Feature Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Feature</DialogTitle>
            <DialogDescription>
              Add a new searchable feature to the index. Embedding will be
              generated on next regeneration.
            </DialogDescription>
          </DialogHeader>
          <AddFeatureForm
            onSuccess={() => {
              setIsAddDialogOpen(false);
              refetchFeatures();
              toast({ title: 'Success', description: 'Feature added' });
            }}
            onCancel={() => setIsAddDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Feature Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Feature</DialogTitle>
            <DialogDescription>
              Modify feature details. Embedding will be regenerated if content
              changes.
            </DialogDescription>
          </DialogHeader>
          {editingFeature && (
            <EditFeatureForm
              feature={editingFeature}
              onSuccess={() => {
                setIsEditDialogOpen(false);
                setEditingFeature(null);
                refetchFeatures();
                toast({ title: 'Success', description: 'Feature updated' });
              }}
              onCancel={() => {
                setIsEditDialogOpen(false);
                setEditingFeature(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Add Feature Form Component
function AddFeatureForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: '',
    route: '',
    keywords: '',
  });

  const addMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest('POST', '/api/smart-search/feature', data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({
      ...formData,
      keywords: formData.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="e.g., User Management"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description *</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          placeholder="Describe what this feature does..."
          rows={3}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="category">Category *</Label>
        <Input
          id="category"
          value={formData.category}
          onChange={(e) =>
            setFormData({ ...formData, category: e.target.value })
          }
          placeholder="e.g., Admin, Users, Settings"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="route">Route *</Label>
        <Input
          id="route"
          value={formData.route}
          onChange={(e) => setFormData({ ...formData, route: e.target.value })}
          placeholder="e.g., /users or users"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="keywords">Keywords (comma-separated)</Label>
        <Input
          id="keywords"
          value={formData.keywords}
          onChange={(e) =>
            setFormData({ ...formData, keywords: e.target.value })
          }
          placeholder="e.g., user, manage, admin, people"
        />
        <p className="text-xs text-muted-foreground">
          Enter keywords separated by commas
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={addMutation.isPending}>
          {addMutation.isPending ? 'Adding...' : 'Add Feature'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Edit Feature Form Component
function EditFeatureForm({
  feature,
  onSuccess,
  onCancel,
}: {
  feature: SearchableFeature;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    title: feature.title,
    description: feature.description,
    category: feature.category,
    route: feature.route,
    keywords: feature.keywords.join(', '),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest('PUT', `/api/smart-search/feature/${feature.id}`, data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      ...formData,
      keywords: formData.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="edit-title">Title *</Label>
        <Input
          id="edit-title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="edit-description">Description *</Label>
        <Textarea
          id="edit-description"
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          rows={3}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="edit-category">Category *</Label>
        <Input
          id="edit-category"
          value={formData.category}
          onChange={(e) =>
            setFormData({ ...formData, category: e.target.value })
          }
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="edit-route">Route *</Label>
        <Input
          id="edit-route"
          value={formData.route}
          onChange={(e) => setFormData({ ...formData, route: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="edit-keywords">Keywords (comma-separated)</Label>
        <Input
          id="edit-keywords"
          value={formData.keywords}
          onChange={(e) =>
            setFormData({ ...formData, keywords: e.target.value })
          }
        />
      </div>

      {feature.embedding && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Modifying this feature will invalidate its embedding. You'll need to
            regenerate it.
          </AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? 'Updating...' : 'Update Feature'}
        </Button>
      </DialogFooter>
    </form>
  );
}
