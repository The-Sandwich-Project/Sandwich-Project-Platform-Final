import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Users,
  Plus,
  Edit3,
  Search,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  AlertCircle,
  Trash2,
  Building2,
  ArrowRight,
  Download,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { apiRequest } from '@/lib/queryClient';
import { ButtonTooltip } from '@/components/ui/button-tooltip';
import { useResourcePermissions } from '@/hooks/useResourcePermissions';
import { PermissionDenied } from '@/components/permission-denied';

export default function VolunteerManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State for filters and search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // State for form dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingVolunteer, setEditingVolunteer] = useState<any>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
    availability: 'available',
    isActive: true,
    isDriver: false,
    experienceLevel: 'new',
    trainingCompleted: false,
  });

  useEffect(() => {
    const handleOpenCreate = () => {
      setEditingVolunteer(null);
      setFormData({
        name: '',
        email: '',
        phone: '',
        address: '',
        notes: '',
        availability: 'available',
        isActive: true,
        isDriver: false,
        experienceLevel: 'new',
        trainingCompleted: false,
      });
      setShowAddDialog(true);
    };

    window.addEventListener('openVolunteerCreateDialog', handleOpenCreate);
    return () => {
      window.removeEventListener('openVolunteerCreateDialog', handleOpenCreate);
    };
  }, []);

  // Host designation state
  const [showHostDesignation, setShowHostDesignation] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [hostRole, setHostRole] = useState('host');
  const [hostNotes, setHostNotes] = useState('');

  // Check permissions
  const { canView, canAdd, canEdit } = useResourcePermissions('VOLUNTEERS');
  const canManage = canEdit;

  const canViewVolunteerNotes =
    !!user &&
    (user.role === 'super_admin' ||
      user.role === 'admin' ||
      user.role === 'admin_coordinator' ||
      user.role === 'admin_viewer');

  if (!canView) {
    return (
      <div className="p-6">
        <PermissionDenied
          action="view volunteer information"
          requiredPermission="VOLUNTEERS_VIEW"
          variant="card"
        />
      </div>
    );
  }

  // Fetch volunteers from the dedicated volunteers table
  const { data: volunteers = [], isLoading } = useQuery({
    queryKey: ['/api/volunteers'],
    queryFn: () => apiRequest('GET', '/api/volunteers'),
  });

  // Fetch hosts for designation dropdown
  const { data: hosts = [] } = useQuery({
    queryKey: ['/api/hosts'],
    queryFn: () => apiRequest('GET', '/api/hosts'),
  });

  // Create/Update volunteer mutation
  const { mutate: saveVolunteer, isPending: isSaving } = useMutation({
    mutationFn: async (volunteerData: any) => {
      if (editingVolunteer) {
        return apiRequest(
          'PATCH',
          `/api/volunteers/${editingVolunteer.id}`,
          volunteerData
        );
      } else {
        return apiRequest('POST', '/api/volunteers', volunteerData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/volunteers'] });
      toast({
        title: 'Success',
        description: `Volunteer ${
          editingVolunteer ? 'updated' : 'added'
        } successfully`,
      });
      resetForm();
      setShowAddDialog(false);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to ${
          editingVolunteer ? 'update' : 'add'
        } volunteer`,
        variant: 'destructive',
      });
    },
  });

  // Designate as host mutation: creates a host contact linked to this exact
  // volunteer record. They stay a volunteer (the contact is marked "Also a
  // Volunteer"), so they keep showing up in volunteer dropdowns.
  const { mutate: designateAsHost, isPending: isDesignating } = useMutation({
    mutationFn: async (hostContactData: any) => {
      return await apiRequest('POST', '/api/host-contacts', hostContactData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/volunteers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/host-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });
      toast({
        title: 'Success',
        description: `${editingVolunteer?.name || 'This volunteer'} is now a host contact and is still listed as a volunteer`,
      });
      resetForm();
      setShowAddDialog(false);
      setShowHostDesignation(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: `Failed to designate as host: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  // Delete volunteer mutation
  const { mutate: deleteVolunteer } = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/volunteers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/volunteers'] });
      toast({
        title: 'Success',
        description: 'Volunteer deleted successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to delete volunteer',
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      address: '',
      notes: '',
      availability: 'available',
      isActive: true,
      isDriver: false,
      experienceLevel: 'new',
      trainingCompleted: false,
    });
    setEditingVolunteer(null);
    setShowHostDesignation(false);
    setSelectedHostId(null);
    setHostRole('host');
    setHostNotes('');
  };

  const handleEdit = (volunteer: any) => {
    if (!canEdit) {
      toast({
        title: 'Access Denied',
        description: "You don't have permission to edit volunteers",
        variant: 'destructive',
      });
      return;
    }

    setFormData({
      name: volunteer.name || '',
      email: volunteer.email || '',
      phone: volunteer.phone || '',
      address: volunteer.address || '',
      notes: volunteer.notes || '',
      availability: volunteer.availability || 'available',
      isActive: volunteer.isActive !== undefined ? volunteer.isActive : true,
      isDriver: volunteer.isDriver || false,
      experienceLevel: volunteer.experienceLevel || 'new',
      trainingCompleted: volunteer.trainingCompleted || false,
    });
    setEditingVolunteer(volunteer);
    setShowAddDialog(true);
  };

  const handleAdd = () => {
    if (!canAdd) {
      toast({
        title: 'Access Denied',
        description: "You don't have permission to add volunteers",
        variant: 'destructive',
      });
      return;
    }

    resetForm();
    setShowAddDialog(true);
  };

  const handleDelete = (volunteer: any) => {
    if (!canManage) {
      toast({
        title: 'Access Denied',
        description: "You don't have permission to delete volunteers",
        variant: 'destructive',
      });
      return;
    }

    if (window.confirm(`Are you sure you want to delete ${volunteer.name}?`)) {
      deleteVolunteer(volunteer.id);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const volunteerData: Record<string, unknown> = {
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
      availability: formData.availability,
      isActive: formData.isActive,
      isDriver: formData.isDriver,
      experienceLevel: formData.experienceLevel,
      trainingCompleted: formData.trainingCompleted,
    };
    if (canViewVolunteerNotes) {
      volunteerData.notes = formData.notes;
    }

    saveVolunteer(volunteerData);
  };

  const handleHostDesignation = () => {
    if (!selectedHostId || !editingVolunteer) {
      toast({
        title: 'Error',
        description: 'Please select a host location',
        variant: 'destructive',
      });
      return;
    }
    if (!formData.phone?.trim()) {
      toast({
        title: 'Phone number needed',
        description: 'Host contacts need a phone number. Add one above first.',
        variant: 'destructive',
      });
      return;
    }

    designateAsHost({
      linkVolunteerId: editingVolunteer.id,
      hostId: selectedHostId,
      name: formData.name.trim(),
      role: hostRole,
      phone: formData.phone.trim(),
      email: formData.email?.trim() || '',
      address: formData.address?.trim() || '',
      notes: hostNotes,
      isPrimary: hostRole === 'primary',
      isVolunteer: true,
    });
  };

  // Filter volunteers
  const filteredVolunteers = volunteers.filter((volunteer: any) => {
    const matchesSearch =
      !searchTerm ||
      volunteer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      volunteer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      volunteer.phone?.includes(searchTerm);

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && volunteer.isActive) ||
      (statusFilter === 'inactive' && !volunteer.isActive);

    return matchesSearch && matchesStatus;
  });

  const handleExport = async () => {
    try {
      const response = await fetch('/api/volunteers/export', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `volunteers-export-${
        new Date().toISOString().split('T')[0]
      }.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: 'Export completed successfully',
        description: `Exported ${filteredVolunteers.length} volunteers to CSV`,
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: 'Failed to export volunteers data',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-brand-primary-light">
          <Users className="w-6 h-6 text-brand-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            Volunteer Management
          </h1>
          <p className="text-gray-600">
            Manage volunteer information and coordination
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          {canAdd && (
            <ButtonTooltip explanation="Add a new volunteer to your database. You can track their contact information, skills, and availability for scheduling.">
              <Button
                onClick={handleAdd}
                className="flex items-center gap-2"
                data-testid="add-volunteer"
              >
                <Plus className="w-4 h-4" />
                Add Volunteer
              </Button>
            </ButtonTooltip>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search volunteers by name, email, or phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Volunteers List */}
      <div className="grid gap-4" data-testid="volunteers-list">
        {isLoading ? (
          <div className="text-center py-8">
            <div className="text-gray-500">Loading volunteers...</div>
          </div>
        ) : filteredVolunteers.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Users className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">
                  No volunteers found
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {searchTerm || statusFilter !== 'all'
                    ? 'Try adjusting your search criteria'
                    : 'Get started by adding a volunteer'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          filteredVolunteers.map((volunteer: any) => (
            <Card
              key={volunteer.id}
              className="hover:shadow-md transition-shadow"
              data-testid="volunteer-card"
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {volunteer.name}
                      </h3>
                      <Badge
                        variant={volunteer.isActive ? 'default' : 'secondary'}
                      >
                        {volunteer.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      {volunteer.experienceLevel === 'experienced' ? (
                        <Badge variant="outline" className="border-green-600 text-green-700">
                          Experienced
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500 text-amber-600">
                          New — needs a buddy
                        </Badge>
                      )}
                      {volunteer.trainingCompleted && (
                        <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                          Trained
                        </Badge>
                      )}
                      {volunteer.isDriver && (
                        <Badge variant="outline" className="border-blue-500 text-blue-600">
                          Driver
                        </Badge>
                      )}
                      {volunteer.hostContactId != null && (
                        <Badge
                          variant="outline"
                          className="border-violet-500 text-violet-600"
                          title="Linked to a host contact. Name, phone, email and host location update from the Hosts page."
                        >
                          Host{volunteer.hostLocation ? ` · ${volunteer.hostLocation}` : ''}
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      {volunteer.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-gray-400" />
                          <a
                            href={`mailto:${volunteer.email}`}
                            className="text-brand-primary hover:underline"
                          >
                            {volunteer.email}
                          </a>
                        </div>
                      )}

                      {volunteer.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-gray-400" />
                          <a
                            href={`tel:${volunteer.phone}`}
                            className="text-brand-primary hover:underline"
                          >
                            {volunteer.phone}
                          </a>
                        </div>
                      )}

                      {volunteer.address && (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-600">
                            {volunteer.address}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">
                          Added{' '}
                          {format(new Date(volunteer.createdAt), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>

                    {volunteer.skills && (
                      <div className="mt-3">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">
                            Skills
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 pl-6">
                          {volunteer.skills}
                        </p>
                      </div>
                    )}

                    {canViewVolunteerNotes && volunteer.notes && (
                      <div className="mt-3">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">
                            Notes
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 pl-6">
                          {volunteer.notes}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 ml-4">
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(volunteer)}
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(volunteer)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add/Edit Volunteer Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editingVolunteer ? 'Edit Volunteer' : 'Add New Volunteer'}
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                  placeholder="Enter volunteer's full name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) =>
                    setFormData({ ...formData, address: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="availability">Availability</Label>
                <Select
                  value={formData.availability}
                  onValueChange={(value) =>
                    setFormData({ ...formData, availability: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="busy">Busy</SelectItem>
                    <SelectItem value="off-duty">Off Duty</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-medium">Event Roles</Label>
                <div className="flex items-center space-x-2">
                  <input
                    id="isDriver"
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={formData.isDriver}
                    onChange={(e) =>
                      setFormData({ ...formData, isDriver: e.target.checked })
                    }
                  />
                  <Label htmlFor="isDriver" className="text-sm font-normal">
                    Can serve as driver at events
                  </Label>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-medium">Volunteer Readiness</Label>
                <div className="space-y-2">
                  <Label htmlFor="experienceLevel" className="text-sm font-normal">
                    Experience level
                  </Label>
                  <Select
                    value={formData.experienceLevel}
                    onValueChange={(value) =>
                      setFormData({ ...formData, experienceLevel: value })
                    }
                  >
                    <SelectTrigger id="experienceLevel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">
                        New — needs an experienced volunteer at events
                      </SelectItem>
                      <SelectItem value="experienced">
                        Experienced — can attend events solo
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    New volunteers must be paired with an experienced volunteer when
                    assigned to an event.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    id="trainingCompleted"
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={formData.trainingCompleted}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        trainingCompleted: e.target.checked,
                      })
                    }
                  />
                  <Label htmlFor="trainingCompleted" className="text-sm font-normal">
                    Completed volunteer training
                  </Label>
                </div>
              </div>

              {canViewVolunteerNotes && (
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    placeholder="Any additional notes about this volunteer..."
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="isActive">Status</Label>
                <Select
                  value={formData.isActive ? 'active' : 'inactive'}
                  onValueChange={(value) =>
                    setFormData({ ...formData, isActive: value === 'active' })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Host Designation Section */}
              {editingVolunteer && canManage && (
                <div className="border-t pt-4 mt-4">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-brand-primary" />
                      <h3 className="text-lg font-medium text-gray-900">
                        Designate as Host
                      </h3>
                    </div>

                    {editingVolunteer.hostContactId != null ? (
                      <div className="bg-violet-50 rounded-lg p-4">
                        <p className="text-sm text-violet-800">
                          Already a host contact
                          {editingVolunteer.hostLocation
                            ? ` at ${editingVolunteer.hostLocation}`
                            : ''}
                          . Their name, phone, email and location are managed
                          on the Hosts page.
                        </p>
                      </div>
                    ) : !showHostDesignation ? (
                      <div className="bg-brand-primary-lighter rounded-lg p-4">
                        <p className="text-sm text-brand-primary-dark mb-3">
                          Add this volunteer as a host contact at a specific
                          location. They'll appear on the Hosts page and stay
                          in the volunteer list.
                        </p>
                        <ButtonTooltip explanation="Adds them to the hosts directory at the location you pick so they can collect sandwiches there. They remain a volunteer and keep appearing in volunteer dropdowns.">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowHostDesignation(true)}
                            className="text-brand-primary border-brand-primary-border hover:bg-brand-primary-light"
                          >
                            <Building2 className="w-4 h-4 mr-2" />
                            Designate as Host
                          </Button>
                        </ButtonTooltip>
                      </div>
                    ) : (
                      <div className="bg-amber-50 rounded-lg p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="hostLocation">Host Location</Label>
                            <Select
                              value={selectedHostId?.toString() || ''}
                              onValueChange={(value) =>
                                setSelectedHostId(parseInt(value))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a location" />
                              </SelectTrigger>
                              <SelectContent>
                                {hosts
                                  .filter((host: any) => host.status !== 'hidden')
                                  .map((host: any) => (
                                  <SelectItem
                                    key={host.id}
                                    value={host.id.toString()}
                                  >
                                    {host.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="hostRole">Role at Location</Label>
                            <Select
                              value={hostRole}
                              onValueChange={setHostRole}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {/* Same roles as the Hosts page */}
                                <SelectItem value="host">Host</SelectItem>
                                <SelectItem value="lead">Lead</SelectItem>
                                <SelectItem value="primary">
                                  Primary Contact
                                </SelectItem>
                                <SelectItem value="alternate">
                                  Alternate Contact
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="hostNotes">
                            Host Assignment Notes
                          </Label>
                          <Textarea
                            id="hostNotes"
                            value={hostNotes}
                            onChange={(e) => setHostNotes(e.target.value)}
                            placeholder="Any notes about their role at this location..."
                            rows={2}
                          />
                        </div>

                        {!formData.phone?.trim() && (
                          <p className="text-sm text-amber-800">
                            Host contacts need a phone number. Add one above
                            first.
                          </p>
                        )}

                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowHostDesignation(false)}
                            size="sm"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            onClick={handleHostDesignation}
                            disabled={isDesignating || !selectedHostId || !formData.phone?.trim()}
                            size="sm"
                            className="bg-amber-600 hover:bg-amber-700"
                          >
                            {isDesignating ? (
                              'Designating...'
                            ) : (
                              <>
                                <ArrowRight className="w-4 h-4 mr-2" />
                                Designate as Host
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving
                  ? 'Saving...'
                  : editingVolunteer
                    ? 'Save Changes'
                    : 'Add Volunteer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
