import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  Truck,
  Plus,
  Edit3,
  Trash2,
  Calendar,
  MapPin,
  Building2,
  Package,
  Filter,
  Download,
  Search,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  isWithinInterval,
  parseISO,
} from 'date-fns';

import { usePageSession } from '@/hooks/usePageSession';
interface Distribution {
  id: number;
  distributionDate: string;
  weekEnding: string;
  hostId: number;
  hostName: string;
  recipientId: number;
  recipientName: string;
  sandwichCount: number;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

interface Host {
  id: number;
  name: string;
  address?: string;
  status: string;
}

interface Recipient {
  id: number;
  name: string;
  contactName?: string;
  phone: string;
  email?: string;
  address?: string;
  region?: string;
  status: string;
}

export default function DonationTracking() {
  // Track page session for activity logging
  usePageSession({
    section: 'Operations',
    page: 'Distribution Tracking',
  });

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State for filters and search
  const [selectedWeek, setSelectedWeek] = useState<string>('all');
  const [selectedHost, setSelectedHost] = useState<string>('all');
  const [selectedRecipient, setSelectedRecipient] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // State for the form dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingDistribution, setEditingDistribution] =
    useState<Distribution | null>(null);
  const [formData, setFormData] = useState({
    distributionDate: format(new Date(), 'yyyy-MM-dd'),
    hostId: '',
    recipientId: '',
    sandwichCount: '',
    notes: '',
  });

  // Fetch distributions
  const { data: distributions = [], isLoading: loadingDistributions } =
    useQuery<Distribution[]>({
      queryKey: ['/api/sandwich-distributions'],
      queryFn: () => apiRequest('GET', '/api/sandwich-distributions'),
    });

  // Fetch hosts
  const { data: hosts = [] } = useQuery<Host[]>({
    queryKey: ['/api/hosts'],
    queryFn: () => apiRequest('GET', '/api/hosts'),
  });

  // Fetch recipients
  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ['/api/recipients'],
    queryFn: () => apiRequest('GET', '/api/recipients'),
  });

  // Create distribution mutation
  const createDistributionMutation = useMutation({
    mutationFn: (distributionData: any) =>
      apiRequest('POST', '/api/sandwich-distributions', distributionData),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-distributions'],
      });
      toast({ description: 'Distribution logged successfully' });
      setShowAddDialog(false);
      setEditingDistribution(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        description: error.message || 'Failed to log distribution',
        variant: 'destructive',
      });
    },
  });

  // Update distribution mutation
  const updateDistributionMutation = useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiRequest('PUT', `/api/sandwich-distributions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-distributions'],
      });
      toast({ description: 'Distribution updated successfully' });
      setShowAddDialog(false);
      setEditingDistribution(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        description: error.message || 'Failed to update distribution',
        variant: 'destructive',
      });
    },
  });

  // Delete distribution mutation
  const deleteDistributionMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest('DELETE', `/api/sandwich-distributions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-distributions'],
      });
      toast({ description: 'Distribution deleted successfully' });
    },
    onError: (error: any) => {
      toast({
        description: error.message || 'Failed to delete distribution',
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setFormData({
      distributionDate: format(new Date(), 'yyyy-MM-dd'),
      hostId: '',
      recipientId: '',
      sandwichCount: '',
      notes: '',
    });
  };

  const handleSubmit = () => {
    if (!formData.hostId || !formData.recipientId || !formData.sandwichCount) {
      toast({
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    const host = hosts.find((h) => h.id === parseInt(formData.hostId));
    const recipient = recipients.find(
      (r) => r.id === parseInt(formData.recipientId)
    );

    if (!host || !recipient) {
      toast({
        description: 'Invalid host or recipient selection',
        variant: 'destructive',
      });
      return;
    }

    // Calculate week ending date (Sunday of the week containing the distribution date)
    const distDate = new Date(formData.distributionDate);
    const weekEnd = endOfWeek(distDate, { weekStartsOn: 1 }); // Week starts on Monday

    const distributionData = {
      distributionDate: formData.distributionDate,
      weekEnding: format(weekEnd, 'yyyy-MM-dd'),
      hostId: parseInt(formData.hostId),
      hostName: host.name,
      recipientId: parseInt(formData.recipientId),
      recipientName: recipient.name,
      sandwichCount: parseInt(formData.sandwichCount),
      notes: formData.notes || null,
      createdBy: user?.id || '',
      createdByName: user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
          user.email ||
          'Unknown User'
        : 'Unknown User',
    };

    if (editingDistribution) {
      updateDistributionMutation.mutate({
        id: editingDistribution.id,
        ...distributionData,
      });
    } else {
      createDistributionMutation.mutate(distributionData);
    }
  };

  const openEditDialog = (distribution: Distribution) => {
    setEditingDistribution(distribution);
    setFormData({
      distributionDate: distribution.distributionDate,
      hostId: distribution.hostId.toString(),
      recipientId: distribution.recipientId.toString(),
      sandwichCount: distribution.sandwichCount.toString(),
      notes: distribution.notes || '',
    });
    setShowAddDialog(true);
  };

  const openAddDialog = () => {
    setEditingDistribution(null);
    resetForm();
    setShowAddDialog(true);
  };

  // Filter distributions based on selected filters and search
  const filteredDistributions = distributions.filter((dist) => {
    const matchesWeek =
      !selectedWeek ||
      selectedWeek === 'all' ||
      dist.weekEnding === selectedWeek;
    const matchesHost =
      !selectedHost ||
      selectedHost === 'all' ||
      dist.hostId.toString() === selectedHost;
    const matchesRecipient =
      !selectedRecipient ||
      selectedRecipient === 'all' ||
      dist.recipientId.toString() === selectedRecipient;
    const matchesSearch =
      !searchTerm ||
      dist.hostName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dist.recipientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dist.notes?.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesWeek && matchesHost && matchesRecipient && matchesSearch;
  });

  // Get unique weeks from distributions for filter dropdown
  const availableWeeks = Array.from(
    new Set(distributions.map((d) => d.weekEnding))
  )
    .sort()
    .reverse(); // Most recent first

  // Calculate totals
  const totalSandwiches = filteredDistributions.reduce(
    (sum, dist) => sum + dist.sandwichCount,
    0
  );
  const uniqueHosts = new Set(filteredDistributions.map((d) => d.hostId)).size;
  const uniqueRecipients = new Set(
    filteredDistributions.map((d) => d.recipientId)
  ).size;

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="h-6 w-6 text-brand-primary" />
            Distribution Tracking
          </h1>
          <p className="text-gray-600 mt-1">
            Record sandwich distributions from host locations to recipient
            organizations
          </p>
        </div>

        <Button
          onClick={openAddDialog}
          className="bg-brand-primary hover:bg-brand-primary-dark"
        >
          <Plus className="h-4 w-4 mr-2" />
          Log New Distribution
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-brand-primary" />
              <div>
                <p className="text-sm text-gray-600">Total Sandwiches</p>
                <p className="text-2xl font-bold text-gray-900">
                  {totalSandwiches.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-brand-primary" />
              <div>
                <p className="text-sm text-gray-600">Host Locations</p>
                <p className="text-2xl font-bold text-gray-900">
                  {uniqueHosts}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-brand-primary" />
              <div>
                <p className="text-sm text-gray-600">Recipients</p>
                <p className="text-2xl font-bold text-gray-900">
                  {uniqueRecipients}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-brand-primary" />
              <div>
                <p className="text-sm text-gray-600">Total Records</p>
                <p className="text-2xl font-bold text-gray-900">
                  {filteredDistributions.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters & Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                <Input
                  placeholder="Search distributions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Week Ending</Label>
              <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                <SelectTrigger>
                  <SelectValue placeholder="All weeks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All weeks</SelectItem>
                  {availableWeeks.map((week) => (
                    <SelectItem key={week} value={week}>
                      Week ending {format(new Date(week), 'MMM d, yyyy')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Host Location</Label>
              <Select value={selectedHost} onValueChange={setSelectedHost}>
                <SelectTrigger>
                  <SelectValue placeholder="All hosts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All hosts</SelectItem>
                  {hosts
                    .filter((h) => h.status === 'active')
                    .map((host) => (
                      <SelectItem key={host.id} value={host.id.toString()}>
                        {host.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Recipient</Label>
              <Select
                value={selectedRecipient}
                onValueChange={setSelectedRecipient}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All recipients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All recipients</SelectItem>
                  {recipients
                    .filter((r) => r.status === 'active')
                    .map((recipient) => (
                      <SelectItem
                        key={recipient.id}
                        value={recipient.id.toString()}
                      >
                        {recipient.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(selectedWeek ||
            selectedHost ||
            selectedRecipient ||
            searchTerm) && (
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedWeek('all');
                  setSelectedHost('all');
                  setSelectedRecipient('all');
                  setSearchTerm('');
                }}
              >
                Clear All Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Distributions List */}
      <Card>
        <CardHeader>
          <CardTitle>Distribution Records</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingDistributions ? (
            <div className="text-center py-8">
              <div className="animate-spin h-8 w-8 border-b-2 border-brand-primary mx-auto"></div>
              <p className="text-gray-600 mt-2">Loading distributions...</p>
            </div>
          ) : filteredDistributions.length === 0 ? (
            <div className="text-center py-8">
              <Truck className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">
                No distributions found
              </p>
              <p className="text-gray-600 mb-4">
                {distributions.length === 0
                  ? 'Start by logging your first distribution'
                  : 'Try adjusting your filters to see more results'}
              </p>
              {distributions.length === 0 && (
                <Button
                  onClick={openAddDialog}
                  className="bg-brand-primary hover:bg-brand-primary-dark"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Log First Distribution
                </Button>
              )}
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {filteredDistributions.map((distribution) => (
                  <div
                    key={distribution.id}
                    className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-4">
                          <Badge
                            variant="outline"
                            className="bg-brand-primary-lighter text-brand-primary border-brand-primary-border"
                          >
                            {format(
                              new Date(distribution.distributionDate),
                              'MMM d, yyyy'
                            )}
                          </Badge>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <MapPin className="h-4 w-4" />
                            <span className="font-medium">
                              {distribution.hostName}
                            </span>
                            <span>→</span>
                            <Building2 className="h-4 w-4" />
                            <span className="font-medium">
                              {distribution.recipientName}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-brand-primary" />
                            <span className="font-bold text-lg text-brand-primary">
                              {distribution.sandwichCount.toLocaleString()}{' '}
                              sandwiches
                            </span>
                          </div>

                          {distribution.notes && (
                            <div className="text-sm text-gray-600 flex-1">
                              <span className="font-medium">Note:</span>{' '}
                              {distribution.notes}
                            </div>
                          )}
                        </div>

                        <div className="text-xs text-gray-500">
                          Logged by {distribution.createdByName} on{' '}
                          {format(
                            new Date(distribution.createdAt),
                            'MMM d, yyyy h:mm a'
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(distribution)}
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (
                              window.confirm(
                                'Are you sure you want to delete this distribution record?'
                              )
                            ) {
                              deleteDistributionMutation.mutate(
                                distribution.id
                              );
                            }
                          }}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Distribution Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="w-[95vw] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>
              {editingDistribution
                ? 'Edit Distribution'
                : 'Log New Distribution'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="date">Distribution Date *</Label>
              <Input
                id="date"
                type="date"
                value={formData.distributionDate}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    distributionDate: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="host">Host Location *</Label>
              <Select
                value={formData.hostId}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, hostId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select host location" />
                </SelectTrigger>
                <SelectContent>
                  {hosts
                    .filter((h) => h.status === 'active')
                    .map((host) => (
                      <SelectItem key={host.id} value={host.id.toString()}>
                        {host.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="recipient">Recipient Organization *</Label>
              <Select
                value={formData.recipientId}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, recipientId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select recipient organization" />
                </SelectTrigger>
                <SelectContent>
                  {recipients
                    .filter((r) => r.status === 'active')
                    .map((recipient) => (
                      <SelectItem
                        key={recipient.id}
                        value={recipient.id.toString()}
                      >
                        {recipient.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="count">Number of Sandwiches *</Label>
              <Input
                id="count"
                type="number"
                placeholder="Enter sandwich count"
                value={formData.sandwichCount}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    sandwichCount: e.target.value,
                  }))
                }
                min="1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any additional notes about this distribution..."
                value={formData.notes}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, notes: e.target.value }))
                }
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="ghost" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  createDistributionMutation.isPending ||
                  updateDistributionMutation.isPending
                }
                className="bg-brand-primary hover:bg-brand-primary-dark"
              >
                {createDistributionMutation.isPending ||
                updateDistributionMutation.isPending ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    {editingDistribution ? 'Updating...' : 'Logging...'}
                  </div>
                ) : editingDistribution ? (
                  'Update Distribution'
                ) : (
                  'Log Distribution'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
