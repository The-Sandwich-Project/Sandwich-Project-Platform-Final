import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  ArrowLeft,
  Phone,
  Mail,
  Building,
  Calendar,
  MapPin,
  Sandwich,
  Pencil,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { usePageSession } from '@/hooks/usePageSession';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import type { EventContactDetail } from '@shared/schema';

export default function EventContactDetailPage() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canViewEventRequests =
    !!user && hasPermission(user, PERMISSIONS.NAV_EVENT_PLANNING);

  // Edit dialog state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });

  // Extract ID from URL path since useParams may not work through Dashboard wrapper
  // URL format: /event-contact/{id}
  const contactId = (() => {
    const match = location.match(/\/event-contact\/([^/]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
    return '';
  })();

  const { data: contact, isLoading, error } = useQuery<EventContactDetail>({
    queryKey: [`/api/event-contacts/${encodeURIComponent(contactId)}`],
    enabled: !!contactId,
  });

  // Track page session with meaningful context
  const { trackAction } = usePageSession({
    section: 'Event Contacts',
    page: 'Contact Detail',
    itemDescription: contact ? `${contact.fullName} (${contact.totalEvents} events)` : undefined,
    itemId: contactId,
    context: contact ? {
      totalEvents: contact.totalEvents,
      completedEvents: contact.completedEvents,
      roles: contact.contactRoles,
      organizations: contact.organizations.slice(0, 3),
    } : undefined,
  });

  // Update contact mutation
  const updateContactMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email: string; phone: string }) => {
      const response = await fetch(`/api/event-contacts/${encodeURIComponent(contactId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update contact');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Contact Updated',
        description: `Updated contact info in ${data.updatedCount} event${data.updatedCount !== 1 ? 's' : ''}.`,
      });
      setIsEditDialogOpen(false);
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/event-contacts'] });
      queryClient.invalidateQueries({ queryKey: [`/api/event-contacts/${encodeURIComponent(contactId)}`] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Open edit dialog with current values
  const handleEditClick = () => {
    if (contact) {
      setEditForm({
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        email: contact.email || '',
        phone: contact.phone || '',
      });
      setIsEditDialogOpen(true);
      trackAction('Edit', `Opened edit dialog for ${contact.fullName}`);
    }
  };

  // Handle form submission
  const handleSaveEdit = () => {
    updateContactMutation.mutate(editForm);
  };

  const roleColors: Record<string, string> = {
    primary: 'bg-blue-100 text-blue-800 border-blue-200',
    backup: 'bg-purple-100 text-purple-800 border-purple-200',
    tsp: 'bg-green-100 text-green-800 border-green-200',
  };

  const statusColors: Record<string, string> = {
    new: 'bg-slate-100 text-slate-700',
    rescheduled: 'bg-indigo-100 text-indigo-700',
    non_event: 'bg-stone-100 text-stone-700',
    in_process: 'bg-yellow-100 text-yellow-700',
    scheduled: 'bg-indigo-100 text-indigo-700',
    completed: 'bg-green-100 text-green-700',
    declined: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-700',
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '—';
    }
  };

  const formatStatus = (status: string) => {
    return status
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-slate-500">Loading contact details...</div>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="p-6">
        <Button
          variant="ghost"
          onClick={() => setLocation('/event-contacts-directory')}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Directory
        </Button>
        <Card>
          <CardContent className="p-6 text-center text-slate-500">
            Contact not found. They may have been removed from the system.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button
        variant="ghost"
        onClick={() => setLocation('/event-contacts-directory')}
        className="mb-2"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Directory
      </Button>

      {/* Contact Header Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <CardTitle className="text-2xl">{contact.fullName}</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditClick}
                  className="gap-1.5"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {contact.contactRoles.map((role) => (
                  <Badge
                    key={role}
                    variant="outline"
                    className={`capitalize ${roleColors[role] || ''}`}
                  >
                    {role === 'tsp' ? 'TSP Coordinator' : role}
                  </Badge>
                ))}
                {contact.hasOnlyIncompleteEvents && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                    No Completed Events
                  </Badge>
                )}
              </div>
            </div>

            {/* Stats Summary */}
            <div className="flex gap-6 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-900">{contact.totalEvents}</div>
                <div className="text-slate-500">Total Events</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{contact.completedEvents}</div>
                <div className="text-slate-500">Completed</div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Contact Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {contact.phone && (
              <div className="flex items-center gap-3 text-slate-700">
                <Phone className="w-5 h-5 text-slate-400" />
                <a href={`tel:${contact.phone}`} className="hover:text-blue-600">
                  {contact.phone}
                </a>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-3 text-slate-700">
                <Mail className="w-5 h-5 text-slate-400" />
                <a href={`mailto:${contact.email}`} className="hover:text-blue-600">
                  {contact.email}
                </a>
              </div>
            )}
          </div>

          {/* Organizations */}
          {contact.organizations.length > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-start gap-3">
                <Building className="w-5 h-5 text-slate-400 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-slate-600 mb-1">Organizations</div>
                  <div className="flex flex-wrap gap-2">
                    {contact.organizations.map((org) => (
                      <Badge key={org} variant="secondary" className="text-sm">
                        {org}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Events Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-400" />
            Event History ({contact.events.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {contact.events.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-center">Sandwiches</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contact.events.map((event) => (
                    <TableRow
                      key={`${event.eventId}-${event.contactRole}`}
                      className={canViewEventRequests ? 'cursor-pointer hover:bg-slate-50' : ''}
                      onClick={() => {
                        if (!canViewEventRequests) return;
                        setLocation(`/dashboard?section=event-requests&tab=all&eventId=${event.eventId}`);
                      }}
                    >
                      <TableCell className="font-medium">
                        {event.organizationName}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          {formatDate(event.scheduledEventDate)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {event.eventAddress ? (
                          <div className="flex items-center gap-2 max-w-[200px]">
                            <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{event.eventAddress}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Sandwich className="w-4 h-4 text-slate-400" />
                          {event.sandwichCount > 0 ? (
                            <span className="font-medium">{event.sandwichCount.toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={statusColors[event.status] || 'bg-slate-100'}
                        >
                          {formatStatus(event.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`capitalize ${roleColors[event.contactRole] || ''}`}
                        >
                          {event.contactRole === 'tsp' ? 'TSP' : event.contactRole}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              No events found for this contact.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Contact Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
            <DialogDescription>
              Update this contact's information. Changes will apply to all {contact?.totalEvents || 0} event{(contact?.totalEvents || 0) !== 1 ? 's' : ''} where they appear.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={editForm.firstName}
                  onChange={(e) => setEditForm(prev => ({ ...prev, firstName: e.target.value }))}
                  placeholder="First name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={editForm.lastName}
                  onChange={(e) => setEditForm(prev => ({ ...prev, lastName: e.target.value }))}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="email@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={editForm.phone}
                onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              disabled={updateContactMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateContactMutation.isPending}
            >
              {updateContactMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
