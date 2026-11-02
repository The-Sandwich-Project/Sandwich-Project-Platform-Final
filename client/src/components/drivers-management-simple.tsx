import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { useToast } from '@/hooks/use-toast';
import {
  Car,
  Plus,
  Phone,
  Mail,
  Edit2,
  CheckCircle,
  XCircle,
  Download,
  Truck,
  FileCheck,
  AlertTriangle,
  Trash2,
  Search,
  Filter,
  X,
  Clock,
  MapPin,
  Loader2,
  ExternalLink,
  Copy,
  Calendar,
  MessageSquare,
  Smartphone,
  PauseCircle,
  Package,
  Database,
  ChevronDown,
  ChevronUp,
  UserX,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { useResourcePermissions } from '@/hooks/useResourcePermissions';
import { usePageSession } from '@/hooks/usePageSession';
import type { Driver, Host, DriverVehicle } from '@shared/schema';
import { Textarea } from '@/components/ui/textarea';
import { logger } from '@/lib/logger';

function getDriverLocationValue(driver: Driver): string {
  // Prefer the most specific address fields if present.
  // (Some datasets may still use legacy `homeAddress`)
  const anyDriver = driver as any;
  return (
    driver.hostLocation ||
    driver.area ||
    anyDriver.homeAddress ||
    driver.address ||
    ''
  ).trim();
}

function abbreviateLocation(value: string): { short: string; isFullAddress: boolean } {
  const s = (value || '').trim();
  if (!s) return { short: '', isFullAddress: false };

  // Most common shape: "street..., City, ST 12345"
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const city = parts[parts.length - 2];
    const stateZip = parts[parts.length - 1];
    return { short: `${city}, ${stateZip}`, isFullAddress: parts.length >= 3 };
  }

  // Fallback: attempt to extract "City, ST ZIP" from tail
  const m = s.match(/([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
  if (m) {
    const city = m[1].trim();
    const state = m[2].trim();
    const zip = m[3]?.trim();
    return { short: `${city}, ${state}${zip ? ` ${zip}` : ''}`, isFullAddress: s !== m[0] };
  }

  // If we can't confidently abbreviate, return as-is
  return { short: s, isFullAddress: false };
}

function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function getCoolerStatusDisplay(status: string | null | undefined): { label: string; color: string } | null {
  if (!status) return null;
  const statusMap: Record<string, { label: string; color: string }> = {
    'has_tsp_coolers': { label: 'Has TSP Coolers', color: 'bg-green-100 text-green-800 border-green-200' },
    'would_hold_tsp_coolers': { label: 'Would Hold TSP Coolers', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    'would_buy_coolers': { label: 'Would Buy Coolers', color: 'bg-purple-100 text-purple-800 border-purple-200' },
    'has_own_coolers': { label: 'Has Own Coolers', color: 'bg-teal-100 text-teal-800 border-teal-200' },
    'cannot_hold_coolers': { label: 'Cannot Hold Coolers', color: 'bg-gray-100 text-gray-700 border-gray-200' },
  };
  return statusMap[status] || null;
}

function getInactiveReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '';
  const reasonMap: Record<string, string> = {
    'moved_away': 'Moved Away',
    'no_longer_available': 'No Longer Available',
    'health_issues': 'Health Issues',
    'vehicle_issues': 'Vehicle Issues',
    'unresponsive': 'Unresponsive',
    'retired': 'Retired',
    'other': 'Other',
  };
  return reasonMap[reason] || reason;
}

export default function DriversManagement() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { canEdit } = useResourcePermissions('DRIVERS');
  const isAdmin = hasPermission(user, PERMISSIONS.ADMIN_PANEL_ACCESS);
  const canExport = hasPermission(user, PERMISSIONS.DATA_EXPORT);
  const queryClient = useQueryClient();

  // Track page session for activity logging
  usePageSession({
    section: 'Directory',
    page: 'Drivers Management',
    context: { userRole: user?.role },
  });

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [addressDialogDriver, setAddressDialogDriver] = useState<Driver | null>(null);

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [agreementFilter, setAgreementFilter] = useState<string>('all');
  const [vanFilter, setVanFilter] = useState<string>('all');
  const [driverTypeFilter, setDriverTypeFilter] = useState<string>('all');
  const [surveyFilter, setSurveyFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const [newDriver, setNewDriver] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    licenseNumber: '',
    hostLocation: '',
    availability: '',
    emailAgreementSent: false,
    vanApproved: false,
    isWeeklyDriver: false,
    willingToSpeak: false,
    isActive: true,
    inactiveReason: '',
    // New fields
    isEventDriver: false,
    wantsAppWalkthrough: false,
    wantsTextAlerts: false,
    temporarilyUnavailable: false,
    unavailableNote: '',
    unavailableUntil: '',
    unavailableFollowUp: '',
    // Enhanced availability fields
    availabilityStatus: 'available',
    unavailableStartDate: '',
    checkInDate: '',
    unavailableReason: '',
    coolerStatus: '',
    agreementInDatabase: false,
    surveySubmitted: false,
    neverFullyOnboarded: false,
    wantsToRestart: false,
    interestedInVanDriving: false,
    notes: '',
  });

  // State for vehicle management in new driver form
  const [newDriverVehicles, setNewDriverVehicles] = useState<Array<{ make: string; model: string; coolerCapacity: string }>>([]);
  const [newDriverVehicleInput, setNewDriverVehicleInput] = useState({ make: '', model: '', coolerCapacity: '' });

  // State for vehicle management in edit mode
  const [editingDriverVehicles, setEditingDriverVehicles] = useState<DriverVehicle[]>([]);
  const [newVehicle, setNewVehicle] = useState({ make: '', model: '', coolerCapacity: '' });

  // Fetch drivers
  const { data: drivers = [], isLoading } = useQuery<Driver[]>({
    queryKey: ['/api/drivers'],
  });

  // Fetch all vehicles for card display
  const { data: allVehicles = [] } = useQuery<DriverVehicle[]>({
    queryKey: ['/api/drivers/all-vehicles'],
  });

  // Group vehicles by driver ID for quick lookup
  const vehiclesByDriver = useMemo(() => {
    const map = new Map<number, DriverVehicle[]>();
    for (const v of allVehicles) {
      const list = map.get(v.driverId) || [];
      list.push(v);
      map.set(v.driverId, list);
    }
    return map;
  }, [allVehicles]);

  // Fetch hosts for route assignments
  const { data: hosts = [] } = useQuery<Host[]>({
    queryKey: ['/api/hosts'],
  });

  // Filtered and searched drivers
  const filteredDrivers = useMemo(() => {
    let filtered = drivers;

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (driver) =>
          driver.name?.toLowerCase().includes(term) ||
          driver.email?.toLowerCase().includes(term) ||
          driver.phone?.toLowerCase().includes(term) ||
          driver.hostLocation?.toLowerCase().includes(term) ||
          driver.availability?.toLowerCase().includes(term)
      );
    }

    // Apply status filter (active, inactive, temporarily unavailable, or needs check-in)
    if (statusFilter === 'active') {
      filtered = filtered.filter((driver) => driver.isActive === true && !driver.temporarilyUnavailable && (driver as any).availabilityStatus !== 'pending_checkin');
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter((driver) => driver.isActive === false || (driver as any).availabilityStatus === 'inactive');
    } else if (statusFilter === 'temp_unavailable') {
      filtered = filtered.filter((driver) => driver.temporarilyUnavailable === true || (driver as any).availabilityStatus === 'unavailable');
    } else if (statusFilter === 'needs_checkin') {
      // Show drivers who need check-in: either availabilityStatus is pending_checkin, or checkInDate has passed
      const now = new Date();
      filtered = filtered.filter((driver) => {
        const driverAny = driver as any;
        if (driverAny.availabilityStatus === 'pending_checkin') return true;
        if (driverAny.checkInDate && new Date(driverAny.checkInDate) <= now) return true;
        return false;
      });
    }

    // Apply agreement filter (signed, signed + located, no agreement,
    // or "missing requirements" — drivers who fail any compliance check
    // among: agreement signed, agreement in DB, DL# on file. Limited
    // to active drivers since inactive drivers don't need pre-event
    // compliance.
    if (agreementFilter === 'signed') {
      filtered = filtered.filter((driver) => driver.emailAgreementSent === true);
    } else if (agreementFilter === 'signed_and_located') {
      filtered = filtered.filter((driver) => driver.emailAgreementSent === true && driver.agreementInDatabase === true);
    } else if (agreementFilter === 'no_agreement') {
      filtered = filtered.filter((driver) => !driver.emailAgreementSent);
    } else if (agreementFilter === 'missing_requirements') {
      filtered = filtered.filter((driver) => {
        if (!driver.isActive) return false;
        const noAgreement = !driver.emailAgreementSent;
        const agreementNotInDb = driver.emailAgreementSent && !driver.agreementInDatabase;
        const noDl = !driver.licenseNumber || driver.licenseNumber.trim().length === 0;
        return noAgreement || agreementNotInDb || noDl;
      });
    }

    // Apply van filter (approved, approved + willing, interested)
    if (vanFilter === 'approved') {
      filtered = filtered.filter((driver) => driver.vanApproved === true);
    } else if (vanFilter === 'approved_and_willing') {
      filtered = filtered.filter((driver) => driver.vanApproved === true && driver.interestedInVanDriving === true);
    } else if (vanFilter === 'interested') {
      filtered = filtered.filter((driver) => driver.interestedInVanDriving === true);
    }

    // Apply driver type filter (weekly or event)
    if (driverTypeFilter === 'weekly') {
      filtered = filtered.filter((driver) => driver.isWeeklyDriver === true);
    } else if (driverTypeFilter === 'event') {
      filtered = filtered.filter((driver) => driver.isEventDriver === true);
    }

    // Apply survey filter
    if (surveyFilter === 'submitted') {
      filtered = filtered.filter((driver) => driver.surveySubmitted === true);
    } else if (surveyFilter === 'not_submitted') {
      filtered = filtered.filter((driver) => !driver.surveySubmitted);
    }

    return filtered;
  }, [drivers, searchTerm, statusFilter, agreementFilter, vanFilter, driverTypeFilter, surveyFilter]);

  // Add driver mutation
  const addDriverMutation = useMutation({
    mutationFn: async (driverData: any) => {
      const createdDriver = await apiRequest('POST', '/api/drivers', driverData);
      return createdDriver;
    },
    onSuccess: async (createdDriver: Driver) => {
      // If there are vehicles to add, create them for the new driver
      if (newDriverVehicles.length > 0) {
        try {
          for (const vehicle of newDriverVehicles) {
            await apiRequest('POST', `/api/drivers/${createdDriver.id}/vehicles`, {
              make: vehicle.make,
              model: vehicle.model,
              coolerCapacity: vehicle.coolerCapacity ? parseInt(vehicle.coolerCapacity) : null,
            });
          }
        } catch (error) {
          logger.error('Failed to add vehicles to new driver', error);
          toast({ title: 'Driver added but failed to add some vehicles', variant: 'destructive' });
        }
      }
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
      setIsAddModalOpen(false);
      resetNewDriver();
      toast({ title: 'Driver added successfully' });
    },
    onError: (error) => {
      logger.error('Driver addition error:', error);
      toast({ title: 'Error adding driver', variant: 'destructive' });
    },
  });

  // Update driver mutation
  const updateDriverMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => {
      // Clean the data to remove timestamp fields that cause issues
      const cleanData = {
        ...data,
        createdAt: undefined,
        updatedAt: undefined,
      };
      return apiRequest('PUT', `/api/drivers/${id}`, cleanData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
      setEditingDriver(null);
      toast({ title: 'Driver updated successfully' });
    },
    onError: (error) => {
      logger.error('Driver update error:', error);
      toast({ title: 'Error updating driver', variant: 'destructive' });
    },
  });

  // Delete driver mutation
  const deleteDriverMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/drivers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
      toast({ title: 'Driver deleted successfully' });
    },
    onError: (error) => {
      logger.error('Driver delete error:', error);
      toast({ title: 'Error deleting driver', variant: 'destructive' });
    },
  });

  const resetNewDriver = () => {
    setNewDriver({
      name: '',
      phone: '',
      email: '',
      address: '',
      licenseNumber: '',
      hostLocation: '',
      availability: '',
      emailAgreementSent: false,
      vanApproved: false,
      isWeeklyDriver: false,
      willingToSpeak: false,
      isActive: true,
      inactiveReason: '',
      isEventDriver: false,
      wantsAppWalkthrough: false,
      wantsTextAlerts: false,
      temporarilyUnavailable: false,
      unavailableNote: '',
      unavailableUntil: '',
      unavailableFollowUp: '',
      // Enhanced availability fields
      availabilityStatus: 'available',
      unavailableStartDate: '',
      checkInDate: '',
      unavailableReason: '',
      coolerStatus: '',
      agreementInDatabase: false,
      surveySubmitted: false,
      neverFullyOnboarded: false,
      wantsToRestart: false,
      interestedInVanDriving: false,
      notes: '',
    });
    // Reset vehicle state for new driver form
    setNewDriverVehicles([]);
    setNewDriverVehicleInput({ make: '', model: '', coolerCapacity: '' });
  };

  // Fetch vehicles when editing a driver
  const fetchDriverVehicles = async (driverId: number) => {
    try {
      const vehicles = await apiRequest('GET', `/api/drivers/${driverId}/vehicles`);
      setEditingDriverVehicles(Array.isArray(vehicles) ? vehicles : []);
    } catch (error) {
      logger.error('Failed to fetch driver vehicles', error);
      setEditingDriverVehicles([]);
    }
  };

  // Handle opening edit dialog - also fetch vehicles
  const handleEditDriver = (driver: Driver) => {
    setEditingDriver(driver);
    fetchDriverVehicles(driver.id);
    setNewVehicle({ make: '', model: '', coolerCapacity: '' });
  };

  // Add vehicle mutation
  const addVehicleMutation = useMutation({
    mutationFn: async ({ driverId, vehicle }: { driverId: number; vehicle: { make: string; model: string; coolerCapacity: number | null } }) => {
      const newVehicle = await apiRequest('POST', `/api/drivers/${driverId}/vehicles`, vehicle);
      return newVehicle;
    },
    onSuccess: (newVehicle) => {
      setEditingDriverVehicles(prev => [...prev, newVehicle]);
      setNewVehicle({ make: '', model: '', coolerCapacity: '' });
      toast({ title: 'Vehicle added successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to add vehicle', variant: 'destructive' });
    },
  });

  // Delete vehicle mutation
  const deleteVehicleMutation = useMutation({
    mutationFn: async (vehicleId: number) => {
      await apiRequest('DELETE', `/api/drivers/vehicles/${vehicleId}`);
      return vehicleId;
    },
    onSuccess: (vehicleId) => {
      setEditingDriverVehicles(prev => prev.filter(v => v.id !== vehicleId));
      toast({ title: 'Vehicle removed' });
    },
    onError: () => {
      toast({ title: 'Failed to remove vehicle', variant: 'destructive' });
    },
  });

  const handleAddVehicle = () => {
    if (!editingDriver || !newVehicle.make || !newVehicle.model) {
      toast({ title: 'Please enter make and model', variant: 'destructive' });
      return;
    }
    addVehicleMutation.mutate({
      driverId: editingDriver.id,
      vehicle: {
        make: newVehicle.make,
        model: newVehicle.model,
        coolerCapacity: newVehicle.coolerCapacity ? parseInt(newVehicle.coolerCapacity) : null,
      },
    });
  };

  const handleAddDriver = async () => {
    if (!newDriver.name || !newDriver.phone) {
      toast({
        title: 'Please fill in required fields',
        variant: 'destructive',
      });
      return;
    }

    addDriverMutation.mutate(newDriver);
  };

  const handleUpdateDriver = () => {
    if (!editingDriver) return;
    updateDriverMutation.mutate({
      id: editingDriver.id,
      data: editingDriver,
    });
  };

  const handleDeleteDriver = (driver: Driver) => {
    if (
      window.confirm(
        `Are you sure you want to delete ${driver.name}? This action cannot be undone.`
      )
    ) {
      deleteDriverMutation.mutate(driver.id);
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch('/api/drivers/export', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drivers-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: 'Export completed successfully' });
    } catch (error) {
      toast({ title: 'Export failed', variant: 'destructive' });
    }
  };

  const handleBatchGeocode = async () => {
    setIsGeocoding(true);
    try {
      const response = await fetch('/api/drivers/batch-geocode', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Geocoding failed');

      const data = await response.json();

      // Show appropriate message based on results
      if (data.message === 'No drivers need geocoding') {
        toast({
          title: 'Geocoding complete',
          description: `No drivers need geocoding. ${data.withAddress || 0} have addresses, ${data.alreadyGeocoded || 0} already geocoded, ${data.withoutAddress || 0} missing addresses.`,
        });
      } else {
        const failureList = data.failures?.slice(0, 3).map((f: any) => f.name).join(', ');
        const moreCount = data.failures?.length > 3 ? ` +${data.failures.length - 3} more` : '';
        toast({
          title: 'Geocoding complete',
          description: data.failed > 0
            ? `${data.success} updated, ${data.failed} failed (need manual review: ${failureList}${moreCount})`
            : `${data.success} drivers updated successfully`,
          duration: data.failed > 0 ? 10000 : 5000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
    } catch (error) {
      logger.error('Batch geocode failed', error);
      toast({
        title: 'Geocoding failed',
        description: 'Check your connection or try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGeocoding(false);
    }
  };

  // Reset all coordinates and re-geocode from home addresses only
  const handleResetAndGeocode = async () => {
    if (!confirm('This will clear ALL existing driver coordinates and re-geocode only from home addresses. Drivers without a home address will no longer appear on the map. Continue?')) {
      return;
    }

    setIsGeocoding(true);
    try {
      const response = await fetch('/api/drivers/reset-and-geocode', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Reset and geocode failed');

      const data = await response.json();
      toast({
        title: 'Reset & Geocode complete',
        description: `Cleared ${data.cleared} old coordinates. Geocoded ${data.success} from addresses, ${data.failed} failed.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/drivers/driver-candidates'] });
    } catch (error) {
      logger.error('Reset and geocode failed', error);
      toast({
        title: 'Reset & Geocode failed',
        description: 'Check your connection or try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGeocoding(false);
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading drivers...</div>;
  }

  // Sort drivers: active first, then inactive
  const sortedDrivers = [...filteredDrivers].sort((a, b) => {
    if (a.isActive === b.isActive) return 0;
    return a.isActive ? -1 : 1;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center">
              <Car className="text-blue-500 mr-2 sm:mr-3 w-5 h-5 sm:w-6 sm:h-6" />
              <span className="hidden sm:inline">Drivers Management</span>
              <span className="sm:hidden">Drivers</span>
            </h1>
            <div className="flex flex-col sm:flex-row gap-2">
              {isAdmin && (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleBatchGeocode}
                    disabled={isGeocoding}
                    className="text-xs sm:text-sm"
                  >
                    {isGeocoding ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <MapPin className="w-4 h-4 mr-2" />
                    )}
                    <span className="hidden sm:inline">
                      {isGeocoding ? 'Geocoding...' : 'Geocode Missing'}
                    </span>
                    <span className="sm:hidden">
                      {isGeocoding ? '...' : 'Geocode'}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleResetAndGeocode}
                    disabled={isGeocoding}
                    className="text-xs sm:text-sm border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    {isGeocoding ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <MapPin className="w-4 h-4 mr-2" />
                    )}
                    <span className="hidden sm:inline">
                      Reset & Re-geocode All
                    </span>
                    <span className="sm:hidden">
                      Reset
                    </span>
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={!canExport || !drivers || drivers.length === 0}
                className="text-xs sm:text-sm"
              >
                <Download className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Export CSV</span>
                <span className="sm:hidden">Export</span>
              </Button>
              <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!canEdit} className="text-xs sm:text-sm">
                    <Plus className="w-4 h-4 mr-2" />
                    <span className="hidden sm:inline">Add Driver</span>
                    <span className="sm:hidden">Add</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[95vw] max-w-md max-h-[85vh] overflow-y-auto p-4 sm:p-6">
                  <DialogHeader>
                    <DialogTitle>Add New Driver</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name">Name *</Label>
                      <Input
                        id="name"
                        value={newDriver.name}
                        onChange={(e) =>
                          setNewDriver({ ...newDriver, name: e.target.value })
                        }
                        placeholder="Enter driver name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone *</Label>
                      <Input
                        id="phone"
                        value={newDriver.phone}
                        onChange={(e) =>
                          setNewDriver({ ...newDriver, phone: e.target.value })
                        }
                        placeholder="Enter phone number"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={newDriver.email}
                        onChange={(e) =>
                          setNewDriver({ ...newDriver, email: e.target.value })
                        }
                        placeholder="Enter email address"
                      />
                    </div>
                    <div>
                      <Label htmlFor="address">Home Address</Label>
                      <Input
                        id="address"
                        value={newDriver.address}
                        onChange={(e) =>
                          setNewDriver({ ...newDriver, address: e.target.value })
                        }
                        placeholder="Street address, city, state, zip"
                        data-testid="input-driver-address"
                      />
                    </div>
                    <div>
                      <Label htmlFor="licenseNumber">
                        Driver's License Number
                      </Label>
                      <Input
                        id="licenseNumber"
                        value={newDriver.licenseNumber}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            licenseNumber: e.target.value,
                          })
                        }
                        placeholder="Enter license number (optional)"
                      />
                    </div>
                    <div>
                      <Label htmlFor="hostLocation">Driver Location</Label>
                      <Input
                        id="hostLocation"
                        value={newDriver.hostLocation}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            hostLocation: e.target.value,
                          })
                        }
                        placeholder="Enter driver location (e.g., Alpharetta, Roswell, North Atlanta)"
                        list="host-locations"
                      />
                      <datalist id="host-locations">
                        {hosts.map((host) => (
                          <option key={host.id} value={host.name} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <Label htmlFor="availability">Availability Notes</Label>
                      <Input
                        id="availability"
                        value={newDriver.availability}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            availability: e.target.value,
                          })
                        }
                        placeholder="Enter availability notes (e.g., weekends only, mornings, etc.)"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="emailAgreementSent"
                        checked={newDriver.emailAgreementSent}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            emailAgreementSent: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="emailAgreementSent">
                        Agreement Signed
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="isWeeklyDriver"
                        checked={newDriver.isWeeklyDriver}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            isWeeklyDriver: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="isWeeklyDriver">
                        Weekly Driver
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="willingToSpeak"
                        checked={newDriver.willingToSpeak}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            willingToSpeak: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="willingToSpeak">
                        Willing to Speak at Events
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="vanApproved"
                        checked={newDriver.vanApproved}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            vanApproved: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="vanApproved">Van Approved</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="isEventDriver"
                        checked={newDriver.isEventDriver}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            isEventDriver: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="isEventDriver">Event Driver</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="wantsAppWalkthrough"
                        checked={newDriver.wantsAppWalkthrough}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            wantsAppWalkthrough: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="wantsAppWalkthrough">Wants App Walkthrough</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="wantsTextAlerts"
                        checked={newDriver.wantsTextAlerts}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            wantsTextAlerts: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="wantsTextAlerts">Wants Text Alerts</Label>
                    </div>
                    <div>
                      <Label htmlFor="coolerStatus">Cooler Status</Label>
                      <Select
                        value={newDriver.coolerStatus}
                        onValueChange={(value) =>
                          setNewDriver({ ...newDriver, coolerStatus: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select cooler status..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="has_tsp_coolers">Has TSP Coolers</SelectItem>
                          <SelectItem value="would_hold_tsp_coolers">Would Hold TSP Coolers at Home</SelectItem>
                          <SelectItem value="would_buy_coolers">Would Buy Coolers (Tax Receipt)</SelectItem>
                          <SelectItem value="has_own_coolers">Has Own Coolers for Review</SelectItem>
                          <SelectItem value="cannot_hold_coolers">Cannot Hold Coolers at Home</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="agreementInDatabase"
                        checked={newDriver.agreementInDatabase}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            agreementInDatabase: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="agreementInDatabase">Agreement Located in Database</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="surveySubmitted"
                        checked={newDriver.surveySubmitted}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            surveySubmitted: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="surveySubmitted">Driver Survey Submitted</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="neverFullyOnboarded"
                        checked={newDriver.neverFullyOnboarded}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            neverFullyOnboarded: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="neverFullyOnboarded">Never Fully Onboarded</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="wantsToRestart"
                        checked={newDriver.wantsToRestart}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            wantsToRestart: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="wantsToRestart">Wants to Restart Active Driving</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="interestedInVanDriving"
                        checked={newDriver.interestedInVanDriving}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            interestedInVanDriving: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="interestedInVanDriving">Interested in Driving the Van</Label>
                    </div>
                    {/* Enhanced Availability Status System */}
                    <div className="space-y-3 p-3 bg-gray-50 rounded-lg border">
                      <div>
                        <Label htmlFor="availabilityStatus">Availability Status</Label>
                        <Select
                          value={newDriver.availabilityStatus || 'available'}
                          onValueChange={(value) =>
                            setNewDriver({
                              ...newDriver,
                              availabilityStatus: value,
                              // Auto-set temporarilyUnavailable for backwards compatibility
                              temporarilyUnavailable: value === 'unavailable' || value === 'pending_checkin',
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="available">
                              <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-500" />
                                Available
                              </span>
                            </SelectItem>
                            <SelectItem value="unavailable">
                              <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-red-500" />
                                Unavailable
                              </span>
                            </SelectItem>
                            <SelectItem value="pending_checkin">
                              <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-amber-500" />
                                Needs Check-in
                              </span>
                            </SelectItem>
                            <SelectItem value="inactive">
                              <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-gray-400" />
                                Inactive (Retired)
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {newDriver.availabilityStatus === 'available' && 'Driver can be scheduled for events'}
                          {newDriver.availabilityStatus === 'unavailable' && 'Driver won\'t appear in assignment lists'}
                          {newDriver.availabilityStatus === 'pending_checkin' && 'Driver needs to be contacted to confirm availability'}
                          {newDriver.availabilityStatus === 'inactive' && 'Driver is no longer volunteering'}
                        </p>
                      </div>

                      {(newDriver.availabilityStatus === 'unavailable' || newDriver.availabilityStatus === 'pending_checkin') && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label htmlFor="unavailableStartDate">Becomes Unavailable On</Label>
                              <Input
                                id="unavailableStartDate"
                                type="date"
                                value={newDriver.unavailableStartDate}
                                onChange={(e) =>
                                  setNewDriver({ ...newDriver, unavailableStartDate: e.target.value })
                                }
                              />
                              <p className="text-xs text-muted-foreground mt-1">Leave blank if already unavailable</p>
                            </div>
                            <div>
                              <Label htmlFor="checkInDate">Check-in Date</Label>
                              <Input
                                id="checkInDate"
                                type="date"
                                value={newDriver.checkInDate}
                                onChange={(e) =>
                                  setNewDriver({ ...newDriver, checkInDate: e.target.value })
                                }
                              />
                              <p className="text-xs text-muted-foreground mt-1">When to reach out</p>
                            </div>
                          </div>

                          <div>
                            <Label htmlFor="unavailableReason">Reason for Unavailability</Label>
                            <Select
                              value={newDriver.unavailableReason || ''}
                              onValueChange={(value) =>
                                setNewDriver({ ...newDriver, unavailableReason: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select reason..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="medical">Medical / Health</SelectItem>
                                <SelectItem value="travel">Travel / Out of Town</SelectItem>
                                <SelectItem value="work">Work Conflict</SelectItem>
                                <SelectItem value="family">Family Obligations</SelectItem>
                                <SelectItem value="personal">Personal / Other</SelectItem>
                                <SelectItem value="seasonal">Seasonal Break</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label htmlFor="unavailableNote">Additional Notes</Label>
                            <Textarea
                              id="unavailableNote"
                              value={newDriver.unavailableNote}
                              onChange={(e) =>
                                setNewDriver({ ...newDriver, unavailableNote: e.target.value })
                              }
                              placeholder="Any additional details..."
                              rows={2}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="notes">Notes</Label>
                      <Textarea
                        id="notes"
                        value={newDriver.notes}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            notes: e.target.value,
                          })
                        }
                        placeholder="General notes about this driver"
                        rows={3}
                      />
                    </div>

                    {/* Vehicles Section for New Driver */}
                    <div className="border-t pt-4 mt-4">
                      <Label className="text-base font-semibold">Vehicles</Label>
                      <p className="text-sm text-muted-foreground mb-3">Add vehicle make, model, and cooler capacity (optional)</p>

                      {/* Staged vehicles to be added */}
                      {newDriverVehicles.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {newDriverVehicles.map((vehicle, index) => (
                            <div key={index} className="flex items-center justify-between bg-muted p-2 rounded">
                              <div className="flex items-center gap-2">
                                <Car className="w-4 h-4" />
                                <span className="font-medium">{vehicle.make} {vehicle.model}</span>
                                {vehicle.coolerCapacity && (
                                  <Badge variant="outline">{vehicle.coolerCapacity} coolers</Badge>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setNewDriverVehicles(prev => prev.filter((_, i) => i !== index))}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add new vehicle form */}
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          placeholder="Make"
                          value={newDriverVehicleInput.make}
                          onChange={(e) => setNewDriverVehicleInput({ ...newDriverVehicleInput, make: e.target.value })}
                        />
                        <Input
                          placeholder="Model"
                          value={newDriverVehicleInput.model}
                          onChange={(e) => setNewDriverVehicleInput({ ...newDriverVehicleInput, model: e.target.value })}
                        />
                        <Input
                          type="number"
                          placeholder="Coolers"
                          value={newDriverVehicleInput.coolerCapacity}
                          onChange={(e) => setNewDriverVehicleInput({ ...newDriverVehicleInput, coolerCapacity: e.target.value })}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => {
                          if (newDriverVehicleInput.make && newDriverVehicleInput.model) {
                            setNewDriverVehicles(prev => [...prev, { ...newDriverVehicleInput }]);
                            setNewDriverVehicleInput({ make: '', model: '', coolerCapacity: '' });
                          } else {
                            toast({ title: 'Please enter make and model', variant: 'destructive' });
                          }
                        }}
                        disabled={!newDriverVehicleInput.make || !newDriverVehicleInput.model}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add Vehicle
                      </Button>
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="isActive"
                        checked={newDriver.isActive}
                        onChange={(e) =>
                          setNewDriver({
                            ...newDriver,
                            isActive: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="isActive">Active Driver</Label>
                    </div>
                    {/* Show Inactive Reason when driver is marked inactive */}
                    {!newDriver.isActive && (
                      <div>
                        <Label htmlFor="new-inactiveReason">Reason for Marking Inactive</Label>
                        <Select
                          value={(newDriver as any).inactiveReason || ''}
                          onValueChange={(value) =>
                            setNewDriver({ ...newDriver, inactiveReason: value } as any)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select reason..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="moved_away">Moved Away</SelectItem>
                            <SelectItem value="no_longer_available">No Longer Available</SelectItem>
                            <SelectItem value="health_issues">Health Issues</SelectItem>
                            <SelectItem value="vehicle_issues">Vehicle Issues</SelectItem>
                            <SelectItem value="unresponsive">Unresponsive</SelectItem>
                            <SelectItem value="retired">Retired from Driving</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="flex justify-end gap-2 pt-4">
                      <Button
                        variant="outline"
                        onClick={() => setIsAddModalOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleAddDriver}
                        disabled={addDriverMutation.isPending}
                      >
                        {addDriverMutation.isPending
                          ? 'Adding...'
                          : 'Add Driver'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Search and Filter Controls */}
        <div className="space-y-3 p-4 bg-slate-50 rounded-lg border-t border-slate-200">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Search Bar */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Search drivers by name, email, phone, location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filter Toggle Button */}
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <Filter className="w-4 h-4" />
              Filters
              {(statusFilter !== 'all' ||
                agreementFilter !== 'all' ||
                vanFilter !== 'all' ||
                driverTypeFilter !== 'all' ||
                surveyFilter !== 'all') && (
                <Badge variant="secondary" className="ml-1">
                  {
                    [
                      statusFilter !== 'all' && 'Status',
                      agreementFilter !== 'all' && 'Agreement',
                      vanFilter !== 'all' && 'Van',
                      driverTypeFilter !== 'all' && 'Type',
                      surveyFilter !== 'all' && 'Survey',
                    ].filter(Boolean).length
                  }
                </Badge>
              )}
            </Button>
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="flex flex-col md:flex-row gap-3 pt-3 border-t border-slate-200">
              <div className="flex flex-col space-y-2">
                <Label className="text-xs font-medium text-slate-600">
                  Status
                </Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="temp_unavailable">Temporarily Unavailable</SelectItem>
                    <SelectItem value="needs_checkin">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        Needs Check-in
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col space-y-2">
                <Label className="text-xs font-medium text-slate-600">
                  Agreement
                </Label>
                <Select
                  value={agreementFilter}
                  onValueChange={setAgreementFilter}
                >
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Agreements</SelectItem>
                    <SelectItem value="signed">Agreement Signed</SelectItem>
                    <SelectItem value="signed_and_located">Signed + Located</SelectItem>
                    <SelectItem value="no_agreement">No Agreement Signed</SelectItem>
                    {/* Pre-event audit shortcut: surfaces every active
                        driver who fails any compliance check (missing
                        agreement / agreement not in DB / missing DL#). */}
                    <SelectItem value="missing_requirements">Missing requirements</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col space-y-2">
                <Label className="text-xs font-medium text-slate-600">
                  Van Status
                </Label>
                <Select value={vanFilter} onValueChange={setVanFilter}>
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Van Status</SelectItem>
                    <SelectItem value="approved">Van Approved</SelectItem>
                    <SelectItem value="approved_and_willing">Approved + Willing to Drive</SelectItem>
                    <SelectItem value="interested">Interested in Driving Van</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col space-y-2">
                <Label className="text-xs font-medium text-slate-600">
                  Driver Type
                </Label>
                <Select value={driverTypeFilter} onValueChange={setDriverTypeFilter}>
                  <SelectTrigger className="w-full sm:w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="weekly">Weekly Driver</SelectItem>
                    <SelectItem value="event">Event Driver</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col space-y-2">
                <Label className="text-xs font-medium text-slate-600">
                  Driver Survey
                </Label>
                <Select value={surveyFilter} onValueChange={setSurveyFilter}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Survey Status</SelectItem>
                    <SelectItem value="submitted">Survey Submitted</SelectItem>
                    <SelectItem value="not_submitted">Not Submitted</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                    setAgreementFilter('all');
                    setVanFilter('all');
                    setDriverTypeFilter('all');
                    setSurveyFilter('all');
                  }}
                  className="text-slate-500 hover:text-slate-700"
                >
                  <X className="w-4 h-4 mr-1" />
                  Clear All
                </Button>
              </div>
            </div>
          )}

          {/* Results Summary */}
          <div className="text-sm text-slate-600">
            Showing {filteredDrivers.length} of {drivers.length} drivers
            {searchTerm && <span> • Search: "{searchTerm}"</span>}
            {statusFilter !== 'all' && <span> • {statusFilter === 'temp_unavailable' ? 'Temporarily Unavailable' : statusFilter === 'active' ? 'Active' : statusFilter === 'needs_checkin' ? 'Needs Check-in' : 'Inactive'}</span>}
            {agreementFilter !== 'all' && <span> • {agreementFilter === 'signed' ? 'Agreement Signed' : agreementFilter === 'signed_and_located' ? 'Signed + Located' : agreementFilter === 'missing_requirements' ? 'Missing requirements' : 'No Agreement'}</span>}
            {vanFilter !== 'all' && <span> • {vanFilter === 'approved' ? 'Van Approved' : vanFilter === 'approved_and_willing' ? 'Approved + Willing' : 'Van Interest'}</span>}
            {driverTypeFilter !== 'all' && <span> • {driverTypeFilter === 'weekly' ? 'Weekly Driver' : 'Event Driver'}</span>}
            {surveyFilter !== 'all' && <span> • {surveyFilter === 'submitted' ? 'Survey Submitted' : 'Survey Not Submitted'}</span>}
          </div>
        </div>
      </div>

      {/* Edit Driver Dialog */}
      <Dialog
        open={!!editingDriver}
        onOpenChange={() => setEditingDriver(null)}
      >
        <DialogContent className="w-[95vw] max-w-md max-h-[85vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit Driver</DialogTitle>
          </DialogHeader>
          {editingDriver && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-name">Name *</Label>
                <Input
                  id="edit-name"
                  value={editingDriver.name}
                  onChange={(e) =>
                    setEditingDriver({ ...editingDriver, name: e.target.value })
                  }
                  placeholder="Enter driver name"
                />
              </div>
              <div>
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  value={editingDriver.phone || ''}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      phone: e.target.value,
                    })
                  }
                  placeholder="Enter phone number"
                />
              </div>
              <div>
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editingDriver.email || ''}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      email: e.target.value,
                    })
                  }
                  placeholder="Enter email address"
                />
              </div>
              <div>
                <Label htmlFor="edit-address">Home Address</Label>
                <Input
                  id="edit-address"
                  value={editingDriver.address || ''}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      address: e.target.value,
                    })
                  }
                  placeholder="Street address, city, state, zip"
                  data-testid="input-edit-driver-address"
                />
              </div>
              <div>
                <Label htmlFor="edit-licenseNumber">
                  Driver's License Number
                </Label>
                <Input
                  id="edit-licenseNumber"
                  value={editingDriver.licenseNumber || ''}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      licenseNumber: e.target.value,
                    })
                  }
                  placeholder="Enter license number (optional)"
                />
              </div>
              <div>
                <Label htmlFor="edit-hostLocation">Driver Location</Label>
                <Input
                  id="edit-hostLocation"
                  value={editingDriver.hostLocation || ''}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      hostLocation: e.target.value,
                    })
                  }
                  placeholder="Enter driver location (e.g., Alpharetta, Roswell, North Atlanta)"
                  list="edit-host-locations"
                />
                <datalist id="edit-host-locations">
                  {hosts.map((host) => (
                    <option key={host.id} value={host.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="edit-availability">Availability Notes</Label>
                <Input
                  id="edit-availability"
                  value={editingDriver.availability || ''}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      availability: e.target.value,
                    })
                  }
                  placeholder="Enter availability notes (e.g., weekends only, mornings, etc.)"
                />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-emailAgreementSent"
                  checked={editingDriver.emailAgreementSent || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      emailAgreementSent: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-emailAgreementSent">
                  Agreement Signed
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-isWeeklyDriver"
                  checked={editingDriver.isWeeklyDriver || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      isWeeklyDriver: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-isWeeklyDriver">Weekly Driver</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-willingToSpeak"
                  checked={editingDriver.willingToSpeak || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      willingToSpeak: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-willingToSpeak">Willing to Speak at Events</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-vanApproved"
                  checked={editingDriver.vanApproved || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      vanApproved: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-vanApproved">Van Approved</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-isEventDriver"
                  checked={editingDriver.isEventDriver || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      isEventDriver: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-isEventDriver">Event Driver</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-wantsAppWalkthrough"
                  checked={editingDriver.wantsAppWalkthrough || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      wantsAppWalkthrough: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-wantsAppWalkthrough">Wants App Walkthrough</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-wantsTextAlerts"
                  checked={editingDriver.wantsTextAlerts || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      wantsTextAlerts: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-wantsTextAlerts">Wants Text Alerts</Label>
              </div>
              <div>
                <Label htmlFor="edit-coolerStatus">Cooler Status</Label>
                <Select
                  value={editingDriver.coolerStatus || ''}
                  onValueChange={(value) =>
                    setEditingDriver({ ...editingDriver, coolerStatus: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cooler status..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="has_tsp_coolers">Has TSP Coolers</SelectItem>
                    <SelectItem value="would_hold_tsp_coolers">Would Hold TSP Coolers at Home</SelectItem>
                    <SelectItem value="would_buy_coolers">Would Buy Coolers (Tax Receipt)</SelectItem>
                    <SelectItem value="has_own_coolers">Has Own Coolers for Review</SelectItem>
                    <SelectItem value="cannot_hold_coolers">Cannot Hold Coolers at Home</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-agreementInDatabase"
                  checked={editingDriver.agreementInDatabase || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      agreementInDatabase: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-agreementInDatabase">Agreement Located in Database</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-surveySubmitted"
                  checked={editingDriver.surveySubmitted || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      surveySubmitted: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-surveySubmitted">Driver Survey Submitted</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-neverFullyOnboarded"
                  checked={editingDriver.neverFullyOnboarded || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      neverFullyOnboarded: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-neverFullyOnboarded">Never Fully Onboarded</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-wantsToRestart"
                  checked={editingDriver.wantsToRestart || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      wantsToRestart: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-wantsToRestart">Wants to Restart Active Driving</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-interestedInVanDriving"
                  checked={editingDriver.interestedInVanDriving || false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      interestedInVanDriving: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-interestedInVanDriving">Interested in Driving the Van</Label>
              </div>
              {/* Enhanced Availability Status System */}
              <div className="space-y-3 p-3 bg-gray-50 rounded-lg border">
                <div>
                  <Label htmlFor="edit-availabilityStatus">Availability Status</Label>
                  <Select
                    value={(editingDriver as any).availabilityStatus || 'available'}
                    onValueChange={(value) =>
                      setEditingDriver({
                        ...editingDriver,
                        availabilityStatus: value,
                        // Auto-set temporarilyUnavailable for backwards compatibility
                        temporarilyUnavailable: value === 'unavailable' || value === 'pending_checkin',
                      } as any)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          Available
                        </span>
                      </SelectItem>
                      <SelectItem value="unavailable">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-500" />
                          Unavailable
                        </span>
                      </SelectItem>
                      <SelectItem value="pending_checkin">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500" />
                          Needs Check-in
                        </span>
                      </SelectItem>
                      <SelectItem value="inactive">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-gray-400" />
                          Inactive (Retired)
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(editingDriver as any).availabilityStatus === 'available' && 'Driver can be scheduled for events'}
                    {(editingDriver as any).availabilityStatus === 'unavailable' && 'Driver won\'t appear in assignment lists'}
                    {(editingDriver as any).availabilityStatus === 'pending_checkin' && 'Driver needs to be contacted to confirm availability'}
                    {(editingDriver as any).availabilityStatus === 'inactive' && 'Driver is no longer volunteering'}
                    {!(editingDriver as any).availabilityStatus && 'Driver can be scheduled for events'}
                  </p>
                </div>

                {((editingDriver as any).availabilityStatus === 'unavailable' || (editingDriver as any).availabilityStatus === 'pending_checkin') && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="edit-unavailableStartDate">Becomes Unavailable On</Label>
                        <Input
                          id="edit-unavailableStartDate"
                          type="date"
                          value={(editingDriver as any).unavailableStartDate ? new Date((editingDriver as any).unavailableStartDate).toISOString().split('T')[0] : ''}
                          onChange={(e) =>
                            setEditingDriver({
                              ...editingDriver,
                              unavailableStartDate: e.target.value ? new Date(e.target.value) : null,
                            } as any)
                          }
                        />
                        <p className="text-xs text-muted-foreground mt-1">Leave blank if already unavailable</p>
                      </div>
                      <div>
                        <Label htmlFor="edit-checkInDate">Check-in Date</Label>
                        <Input
                          id="edit-checkInDate"
                          type="date"
                          value={(editingDriver as any).checkInDate ? new Date((editingDriver as any).checkInDate).toISOString().split('T')[0] : ''}
                          onChange={(e) =>
                            setEditingDriver({
                              ...editingDriver,
                              checkInDate: e.target.value ? new Date(e.target.value) : null,
                            } as any)
                          }
                        />
                        <p className="text-xs text-muted-foreground mt-1">When to reach out</p>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="edit-unavailableReason">Reason for Unavailability</Label>
                      <Select
                        value={(editingDriver as any).unavailableReason || ''}
                        onValueChange={(value) =>
                          setEditingDriver({ ...editingDriver, unavailableReason: value } as any)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select reason..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="medical">Medical / Health</SelectItem>
                          <SelectItem value="travel">Travel / Out of Town</SelectItem>
                          <SelectItem value="work">Work Conflict</SelectItem>
                          <SelectItem value="family">Family Obligations</SelectItem>
                          <SelectItem value="personal">Personal / Other</SelectItem>
                          <SelectItem value="seasonal">Seasonal Break</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="edit-unavailableNote">Additional Notes</Label>
                      <Textarea
                        id="edit-unavailableNote"
                        value={editingDriver.unavailableNote || ''}
                        onChange={(e) =>
                          setEditingDriver({
                            ...editingDriver,
                            unavailableNote: e.target.value,
                          })
                        }
                        placeholder="Any additional details..."
                        rows={2}
                      />
                    </div>
                  </>
                )}
              </div>
              <div>
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={editingDriver.notes || ''}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      notes: e.target.value,
                    })
                  }
                  placeholder="General notes about this driver"
                  rows={3}
                />
              </div>

              {/* Vehicles Section */}
              <div className="border-t pt-4 mt-4">
                <Label className="text-base font-semibold">Vehicles</Label>
                <p className="text-sm text-muted-foreground mb-3">Add vehicles with cooler capacity</p>

                {/* Existing vehicles */}
                {editingDriverVehicles.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {editingDriverVehicles.map((vehicle) => (
                      <div key={vehicle.id} className="flex items-center justify-between bg-muted p-2 rounded">
                        <div className="flex items-center gap-2">
                          <Car className="w-4 h-4" />
                          <span className="font-medium">{vehicle.make} {vehicle.model}</span>
                          {vehicle.coolerCapacity && (
                            <Badge variant="outline">{vehicle.coolerCapacity} coolers</Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteVehicleMutation.mutate(vehicle.id)}
                          disabled={deleteVehicleMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new vehicle form */}
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="Make"
                    value={newVehicle.make}
                    onChange={(e) => setNewVehicle({ ...newVehicle, make: e.target.value })}
                  />
                  <Input
                    placeholder="Model"
                    value={newVehicle.model}
                    onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Coolers"
                    value={newVehicle.coolerCapacity}
                    onChange={(e) => setNewVehicle({ ...newVehicle, coolerCapacity: e.target.value })}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={handleAddVehicle}
                  disabled={addVehicleMutation.isPending || !newVehicle.make || !newVehicle.model}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Vehicle
                </Button>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-isActive"
                  checked={editingDriver.isActive}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      isActive: e.target.checked,
                    })
                  }
                  className="rounded border-gray-300"
                />
                <Label htmlFor="edit-isActive">Active Driver</Label>
              </div>
              {/* Show Inactive Reason when driver is marked inactive */}
              {!editingDriver.isActive && (
                <div>
                  <Label htmlFor="edit-inactiveReason">Reason for Marking Inactive</Label>
                  <Select
                    value={(editingDriver as any).inactiveReason || ''}
                    onValueChange={(value) =>
                      setEditingDriver({ ...editingDriver, inactiveReason: value } as any)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="moved_away">Moved Away</SelectItem>
                      <SelectItem value="no_longer_available">No Longer Available</SelectItem>
                      <SelectItem value="health_issues">Health Issues</SelectItem>
                      <SelectItem value="vehicle_issues">Vehicle Issues</SelectItem>
                      <SelectItem value="unresponsive">Unresponsive</SelectItem>
                      <SelectItem value="retired">Retired from Driving</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    This helps track why drivers become inactive
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setEditingDriver(null)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdateDriver}
                  disabled={updateDriverMutation.isPending}
                >
                  {updateDriverMutation.isPending
                    ? 'Updating...'
                    : 'Update Driver'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Address viewer dialog */}
      <Dialog
        open={!!addressDialogDriver}
        onOpenChange={(open) => {
          if (!open) setAddressDialogDriver(null);
        }}
      >
        <DialogContent className="w-[95vw] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Driver Address</DialogTitle>
          </DialogHeader>
          {addressDialogDriver && (() => {
            const fullLocation = getDriverLocationValue(addressDialogDriver);
            const mapsUrl = googleMapsSearchUrl(fullLocation);

            return (
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-gray-900">{addressDialogDriver.name}</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                    {fullLocation || 'No address on file.'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(fullLocation);
                        toast({ title: 'Address copied' });
                      } catch (e) {
                        toast({ title: 'Failed to copy address', variant: 'destructive' });
                      }
                    }}
                    disabled={!fullLocation}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </Button>

                  <Button type="button" variant="default" size="sm" asChild disabled={!fullLocation}>
                    <a href={mapsUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Open in Google Maps
                    </a>
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Drivers List */}
      <div className="space-y-4">
        {sortedDrivers.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <Car className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No drivers found
              </h3>
              <p className="text-gray-500">
                {searchTerm || statusFilter !== 'all' || agreementFilter !== 'all' || vanFilter !== 'all' || driverTypeFilter !== 'all' || surveyFilter !== 'all'
                  ? 'Try adjusting your search or filters.'
                  : 'Add your first driver to get started.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {sortedDrivers.map((driver) => (
              <Card key={driver.id} className={`overflow-hidden ${!driver.isActive ? 'opacity-75' : ''}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      {/* Vehicle Icon */}
                      <div className={`flex-shrink-0 rounded-lg p-3 ${driver.isActive ? 'bg-[#47B3CB]/20' : 'bg-slate-200'}`}>
                        {driver.vehicleType?.toLowerCase().includes('van') ? (
                          <Truck className={`w-8 h-8 ${driver.isActive ? 'text-[#236383]' : 'text-slate-500'}`} />
                        ) : (
                          <Car className={`w-8 h-8 ${driver.isActive ? 'text-[#236383]' : 'text-slate-500'}`} />
                        )}
                      </div>

                      {/* Main Content */}
                      <div className="flex-1 min-w-0 space-y-3">
                        {/* Name and Status Badges */}
                        <div className="space-y-2">
                          <h3 className={`text-xl font-bold ${driver.isActive ? 'text-gray-900' : 'text-gray-500'}`}>
                            {driver.name}
                          </h3>
                          <div className="flex items-center gap-2 flex-wrap">
                            {driver.isActive ? (
                              <Badge variant="secondary" className="text-xs">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs" title={(driver as any).inactiveReason ? `Reason: ${getInactiveReasonLabel((driver as any).inactiveReason)}` : undefined}>
                                <XCircle className="w-3 h-3 mr-1" />
                                Inactive{(driver as any).inactiveReason && ` - ${getInactiveReasonLabel((driver as any).inactiveReason)}`}
                              </Badge>
                            )}
                            {driver.temporarilyUnavailable && (
                              <Badge className={`text-xs ${driver.isActive ? 'bg-red-100 text-red-800 border-red-200' : 'border-red-200 text-red-600 bg-red-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <PauseCircle className="w-3 h-3 mr-1" />
                                Temporarily Unavailable
                              </Badge>
                            )}
                            {driver.isWeeklyDriver && (
                              <Badge className={`text-xs ${driver.isActive ? 'bg-purple-100 text-purple-800 border-purple-200' : 'border-purple-200 text-purple-600 bg-purple-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <Calendar className="w-3 h-3 mr-1" />
                                Weekly Driver
                              </Badge>
                            )}
                            {driver.isEventDriver && (
                              <Badge className={`text-xs ${driver.isActive ? 'bg-indigo-100 text-indigo-800 border-indigo-200' : 'border-indigo-200 text-indigo-600 bg-indigo-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <Truck className="w-3 h-3 mr-1" />
                                Event Driver
                              </Badge>
                            )}
                            {driver.emailAgreementSent ? (
                              <Badge className={`text-xs ${driver.isActive ? 'bg-green-100 text-green-800 border-green-200' : 'border-green-200 text-green-600 bg-green-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <FileCheck className="w-3 h-3 mr-1" />
                                Agreement Signed
                              </Badge>
                            ) : (
                              <Badge variant="outline" className={`text-xs ${driver.isActive ? 'border-orange-300 text-orange-700 bg-orange-50' : 'border-orange-200 text-orange-600 bg-orange-50'}`}>
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Missing Agreement
                              </Badge>
                            )}
                            {/* Compliance state for "agreement saved in
                                DB" — render both states so a driver who
                                hasn't had theirs filed is visibly flagged
                                in red instead of just missing a green
                                badge. Skip the missing-state pill when
                                the driver hasn't signed at all (the
                                Missing Agreement badge above already
                                covers that case). */}
                            {driver.agreementInDatabase ? (
                              <Badge className={`text-xs ${driver.isActive ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'border-emerald-200 text-emerald-600 bg-emerald-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <Database className="w-3 h-3 mr-1" />
                                Agreement in DB
                              </Badge>
                            ) : driver.emailAgreementSent ? (
                              <Badge
                                variant="outline"
                                className={`text-xs ${driver.isActive ? 'border-red-300 text-red-700 bg-red-50' : 'border-red-200 text-red-600 bg-red-50'}`}
                                data-testid={`badge-agreement-not-in-db-${driver.id}`}
                              >
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Agreement not in DB
                              </Badge>
                            ) : null}
                            {driver.vanApproved && driver.isActive && (
                              <Badge className="bg-brand-primary-light text-brand-primary-dark border-brand-primary text-xs">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Van Approved
                              </Badge>
                            )}
                            {/* Driver's-license-on-file compliance state
                                — render both. Active drivers without a
                                DL# get an amber warning so they show up
                                during pre-event audits instead of being
                                silently absent from the row of green
                                pills. */}
                            {driver.licenseNumber && driver.licenseNumber.trim().length > 0 ? (
                              <Badge variant={driver.isActive ? 'secondary' : 'outline'} className={`text-xs ${driver.isActive ? 'bg-slate-100 text-slate-700' : 'border-slate-200 text-slate-600 bg-slate-50'}`} data-testid={`badge-dl-on-file-${driver.id}`}>
                                <FileCheck className="w-3 h-3 mr-1" />
                                DL# on file
                              </Badge>
                            ) : driver.isActive ? (
                              <Badge
                                variant="outline"
                                className="text-xs border-amber-300 text-amber-700 bg-amber-50"
                                data-testid={`badge-dl-missing-${driver.id}`}
                              >
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                DL# missing
                              </Badge>
                            ) : null}
                            {driver.wantsTextAlerts && (
                              <Badge variant="outline" className={`text-xs ${driver.isActive ? 'border-cyan-300 text-cyan-700 bg-cyan-50' : 'border-cyan-200 text-cyan-600 bg-cyan-50'}`}>
                                <Smartphone className="w-3 h-3 mr-1" />
                                Text Alerts
                              </Badge>
                            )}
                            {driver.wantsAppWalkthrough && (
                              <Badge variant="outline" className={`text-xs ${driver.isActive ? 'border-amber-300 text-amber-700 bg-amber-50' : 'border-amber-200 text-amber-600 bg-amber-50'}`}>
                                <MessageSquare className="w-3 h-3 mr-1" />
                                Needs Walkthrough
                              </Badge>
                            )}
                            {getCoolerStatusDisplay(driver.coolerStatus) && (
                              <Badge className={`text-xs ${driver.isActive ? getCoolerStatusDisplay(driver.coolerStatus)!.color : 'border-gray-200 text-gray-600 bg-gray-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <Package className="w-3 h-3 mr-1" />
                                {getCoolerStatusDisplay(driver.coolerStatus)!.label}
                              </Badge>
                            )}
                            {driver.neverFullyOnboarded && (
                              <Badge className={`text-xs ${driver.isActive ? 'bg-rose-100 text-rose-800 border-rose-200' : 'border-rose-200 text-rose-600 bg-rose-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <UserX className="w-3 h-3 mr-1" />
                                Never Onboarded
                              </Badge>
                            )}
                            {driver.wantsToRestart && (
                              <Badge className={`text-xs ${driver.isActive ? 'bg-sky-100 text-sky-800 border-sky-200' : 'border-sky-200 text-sky-600 bg-sky-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <RefreshCw className="w-3 h-3 mr-1" />
                                Wants to Restart Driving
                              </Badge>
                            )}
                            {driver.interestedInVanDriving && (
                              <Badge className={`text-xs ${driver.isActive ? 'bg-orange-100 text-orange-800 border-orange-200' : 'border-orange-200 text-orange-600 bg-orange-50'}`} variant={driver.isActive ? 'default' : 'outline'}>
                                <Truck className="w-3 h-3 mr-1" />
                                Van Interest
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Location (abbreviated by default) */}
                        {(driver.hostLocation || driver.area || driver.homeAddress || driver.address) && (() => {
                          const fullLocation = getDriverLocationValue(driver);
                          const { short, isFullAddress } = abbreviateLocation(fullLocation);
                          const mapsUrl = googleMapsSearchUrl(fullLocation);

                          return (
                            <div className={`border-l-4 rounded-md px-4 py-3 ${driver.isActive ? 'bg-gradient-to-r from-brand-primary-lighter to-brand-primary-lighter/50 border-brand-primary shadow-sm' : 'bg-gray-100 border-gray-400'}`}>
                              <div className="flex items-start gap-2">
                                <MapPin className={`w-5 h-5 mt-0.5 flex-shrink-0 ${driver.isActive ? 'text-brand-primary' : 'text-gray-600'}`} />
                                <div className="min-w-0">
                                  <div className={`text-xs font-medium uppercase tracking-wide ${driver.isActive ? 'text-brand-primary-dark' : 'text-gray-600'}`}>
                                    Location
                                  </div>
                                  <div className={`text-sm font-normal break-words ${driver.isActive ? 'text-gray-900' : 'text-gray-700'}`}>
                                    {short}
                                  </div>
                                  <div className="flex items-center gap-3 mt-1.5">
                                    <a
                                      href={mapsUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={`text-xs font-medium hover:underline inline-flex items-center gap-1 ${driver.isActive ? 'text-brand-primary-dark' : 'text-gray-700'}`}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      Maps
                                    </a>
                                    {isFullAddress && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => setAddressDialogDriver(driver)}
                                      >
                                        View full address
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Contact Info - Styled Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {driver.phone && (
                            <div className={`rounded-lg px-3 py-2.5 border ${driver.isActive ? 'bg-[#47B3CB]/10 border-[#47B3CB]/30' : 'bg-slate-100 border-slate-300'}`}>
                              <div className="flex items-center gap-2">
                                <Phone className={`w-4 h-4 flex-shrink-0 ${driver.isActive ? 'text-[#236383]' : 'text-slate-600'}`} />
                                <div className="min-w-0">
                                  <div className={`text-xs font-medium ${driver.isActive ? 'text-[#236383]' : 'text-slate-600'}`}>Phone</div>
                                  <a href={`tel:${driver.phone}`} className={`text-sm font-semibold ${driver.isActive ? 'text-gray-900 hover:text-[#236383]' : 'text-slate-700 hover:text-gray-900'}`}>
                                    {driver.phone}
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}
                          {driver.email && (
                            <div className={`rounded-lg px-3 py-2.5 border ${driver.isActive ? 'bg-[#47B3CB]/10 border-[#47B3CB]/30' : 'bg-slate-100 border-slate-300'}`}>
                              <div className="flex items-center gap-2">
                                <Mail className={`w-4 h-4 flex-shrink-0 ${driver.isActive ? 'text-[#236383]' : 'text-slate-600'}`} />
                                <div className="min-w-0 overflow-hidden">
                                  <div className={`text-xs font-medium ${driver.isActive ? 'text-[#236383]' : 'text-slate-600'}`}>Email</div>
                                  <a href={`mailto:${driver.email}`} className={`text-sm font-semibold truncate block ${driver.isActive ? 'text-gray-900 hover:text-[#236383]' : 'text-slate-700 hover:text-gray-900'}`}>
                                    {driver.email}
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Vehicles */}
                        {vehiclesByDriver.get(driver.id)?.length ? (
                          <div className={`border rounded-lg px-3 py-2 ${driver.isActive ? 'bg-slate-50 border-slate-200' : 'bg-slate-100 border-slate-300'}`}>
                            <div className="flex items-start gap-2">
                              <Car className={`w-4 h-4 mt-0.5 flex-shrink-0 ${driver.isActive ? 'text-slate-600' : 'text-slate-500'}`} />
                              <div className="min-w-0 flex-1">
                                <div className={`text-xs font-medium ${driver.isActive ? 'text-slate-600' : 'text-slate-500'}`}>Vehicle{(vehiclesByDriver.get(driver.id)?.length ?? 0) > 1 ? 's' : ''}</div>
                                <div className="space-y-1 mt-0.5">
                                  {vehiclesByDriver.get(driver.id)!.map((v) => (
                                    <div key={v.id} className="text-sm text-gray-900 flex items-center gap-2 flex-wrap">
                                      <span className="font-medium">
                                        {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                                      </span>
                                      {v.color && <span className="text-gray-500">({v.color})</span>}
                                      {v.coolerCapacity != null && v.coolerCapacity > 0 && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                          <Package className="w-2.5 h-2.5 mr-0.5" />
                                          {v.coolerCapacity} cooler{v.coolerCapacity > 1 ? 's' : ''}
                                        </Badge>
                                      )}
                                      {v.isPrimary && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700">Primary</Badge>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {/* Availability */}
                        {driver.availability && (
                          <div className={`border rounded-lg px-3 py-2 ${driver.isActive ? 'bg-amber-50 border-amber-200' : 'bg-[#A31C41]/10 border-[#A31C41]/30'}`}>
                            <div className="flex items-start gap-2">
                              <Clock className={`w-4 h-4 mt-0.5 flex-shrink-0 ${driver.isActive ? 'text-amber-600' : 'text-[#A31C41]'}`} />
                              <div>
                                <div className={`text-xs font-medium ${driver.isActive ? 'text-amber-800' : 'text-[#A31C41]'}`}>Availability</div>
                                <div className={`text-sm ${driver.isActive ? 'text-amber-900' : 'text-gray-900'}`}>{driver.availability}</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Temporarily Unavailable Details */}
                        {driver.temporarilyUnavailable && (driver.unavailableUntil || driver.unavailableNote || driver.unavailableFollowUp) && (
                          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            <div className="flex items-start gap-2">
                              <PauseCircle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${driver.isActive ? 'text-red-600' : 'text-red-500'}`} />
                              <div>
                                <div className={`text-xs font-medium ${driver.isActive ? 'text-red-800' : 'text-red-700'}`}>Temporarily Unavailable</div>
                                {driver.unavailableFollowUp && (
                                  <div className={`text-sm font-medium ${driver.isActive ? 'text-red-900' : 'text-red-800'}`}>
                                    {driver.unavailableFollowUp === 'will_reach_out'
                                      ? "Will reach out when ready"
                                      : "Check back in a few months"}
                                  </div>
                                )}
                                {driver.unavailableUntil && (
                                  <div className={`text-sm ${driver.isActive ? 'text-red-900' : 'text-red-800'}`}>
                                    Available again: {new Date(driver.unavailableUntil).toLocaleDateString()}
                                  </div>
                                )}
                                {driver.unavailableNote && (
                                  <div className={`text-sm mt-1 ${driver.isActive ? 'text-red-800' : 'text-red-700'}`}>{driver.unavailableNote}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditDriver(driver)}
                        disabled={!canEdit}
                        className="h-8 w-8 p-0"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteDriver(driver)}
                        disabled={!canEdit || deleteDriverMutation.isPending}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
