import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { formatTimeForDisplay } from '@/lib/date-utils';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import {
  CheckCircle,
  XCircle,
  Clock,
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Car,
  HandHeart,
  Loader2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

type SignupWithEvent = {
  id: number;
  eventRequestId: number;
  volunteerUserId: string | null;
  volunteerName: string | null;
  volunteerEmail: string | null;
  volunteerPhone: string | null;
  role: string;
  status: string;
  notes: string | null;
  signedUpAt: string;
  confirmedAt: string | null;
  event: {
    id: number;
    organizationName: string | null;
    scheduledEventDate: string | null;
    desiredEventDate: string | null;
    eventStartTime: string | null;
    status: string | null;
  };
};

function getRoleIcon(role: string) {
  switch (role) {
    case 'driver': return <Car className="w-3.5 h-3.5" />;
    default: return <HandHeart className="w-3.5 h-3.5" />;
  }
}

function getRoleColor(role: string) {
  switch (role) {
    case 'driver': return 'bg-[#236383] text-white';
    default: return 'bg-[#236383] text-white';
  }
}

function getRoleLabel(role: string) {
  switch (role) {
    case 'driver': return 'Driver';
    case 'general': return 'Volunteer';
    // Speaker role is retired for new signups, but legacy signups may still
    // carry role 'speaker' — keep a friendly label so historical records read
    // cleanly instead of showing the raw string.
    case 'speaker': return 'Speaker';
    default: return role;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    case 'confirmed':
      return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle className="w-3 h-3 mr-1" />Confirmed</Badge>;
    case 'assigned':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200"><CheckCircle className="w-3 h-3 mr-1" />Assigned</Badge>;
    case 'declined':
      return <Badge className="bg-red-100 text-red-800 border-red-200"><XCircle className="w-3 h-3 mr-1" />Declined</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function SignupCard({ signup, onUpdateStatus }: {
  signup: SignupWithEvent;
  onUpdateStatus: (id: number, status: string) => void;
}) {
  const eventDate = getEffectiveEventDate(signup.event);

  return (
    <Card className="border border-gray-200 hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Volunteer info */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">
                {signup.volunteerName || 'Unknown'}
              </span>
              <Badge className={`${getRoleColor(signup.role)} text-xs`}>
                {getRoleIcon(signup.role)}
                <span className="ml-1">{getRoleLabel(signup.role)}</span>
              </Badge>
              {getStatusBadge(signup.status)}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
              {signup.volunteerEmail && (
                <span className="flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" />
                  {signup.volunteerEmail}
                </span>
              )}
              {signup.volunteerPhone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" />
                  {signup.volunteerPhone}
                </span>
              )}
            </div>

            {/* Event info */}
            <div className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 px-3 py-1.5 rounded-md">
              <MapPin className="w-3.5 h-3.5 text-[#236383] shrink-0" />
              <span className="font-medium">{signup.event.organizationName || 'Unknown Event'}</span>
              {eventDate && (
                <>
                  <span className="text-gray-400">|</span>
                  <Calendar className="w-3.5 h-3.5 text-[#236383]" />
                  <span>{format(parseISO(eventDate), 'MMM d, yyyy')}</span>
                  {signup.event.eventStartTime && (
                    <span>at {formatTimeForDisplay(signup.event.eventStartTime)}</span>
                  )}
                </>
              )}
            </div>

            {signup.notes && (
              <p className="text-sm text-gray-600 italic bg-amber-50 px-3 py-1.5 rounded-md">
                "{signup.notes}"
              </p>
            )}

            <div className="text-xs text-gray-400">
              Signed up {format(parseISO(signup.signedUpAt), 'MMM d, yyyy h:mm a')}
              {signup.confirmedAt && (
                <> · Confirmed {format(parseISO(signup.confirmedAt), 'MMM d, yyyy h:mm a')}</>
              )}
            </div>
          </div>

          {/* Right: Action buttons */}
          {signup.status === 'pending' && (
            <div className="flex flex-col gap-2 shrink-0">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => onUpdateStatus(signup.id, 'assigned')}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                Approve & Assign
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50"
                onClick={() => onUpdateStatus(signup.id, 'declined')}
              >
                <XCircle className="w-4 h-4 mr-1" />
                Decline
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function VolunteerSignupAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('pending');

  // Fetch pending signups
  const { data: pendingSignups = [], isLoading: loadingPending } = useQuery<SignupWithEvent[]>({
    queryKey: ['/api/volunteer-hub/pending-signups'],
    queryFn: async () => {
      const res = await fetch('/api/volunteer-hub/pending-signups', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch pending signups');
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Fetch all signups (for the "all" tab)
  const { data: allSignups = [], isLoading: loadingAll } = useQuery<SignupWithEvent[]>({
    queryKey: ['/api/volunteer-hub/all-signups'],
    queryFn: async () => {
      const res = await fetch('/api/volunteer-hub/pending-signups?all=true', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch all signups');
      return res.json();
    },
    enabled: activeTab === 'all',
  });

  // Update signup status mutation
  const updateStatus = useMutation({
    mutationFn: async ({ signupId, status }: { signupId: number; status: string }) => {
      const res = await fetch(`/api/volunteer-hub/signup/${signupId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update signup status');
      return res.json();
    },
    onSuccess: (_, { status }) => {
      toast({
        title: status === 'assigned' ? 'Signup approved' : 'Signup declined',
        description: status === 'assigned'
          ? 'The volunteer has been assigned to this event.'
          : 'The signup has been declined.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/pending-signups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/all-signups'] });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update signup',
        variant: 'destructive',
      });
    },
  });

  const handleUpdateStatus = (signupId: number, status: string) => {
    updateStatus.mutate({ signupId, status });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/pending-signups'] });
    queryClient.invalidateQueries({ queryKey: ['/api/volunteer-hub/all-signups'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Volunteer Signups</h2>
          <p className="text-sm text-gray-500">
            Review and approve volunteer signup requests from the Volunteer Hub.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pendingSignups.length > 0 && (
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-sm px-3 py-1">
              <AlertCircle className="w-4 h-4 mr-1" />
              {pendingSignups.length} pending
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending" className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            Pending
            {pendingSignups.length > 0 && (
              <Badge className="bg-amber-500 text-white text-xs ml-1 px-1.5 py-0">
                {pendingSignups.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" className="flex items-center gap-1.5">
            <User className="w-4 h-4" />
            All Signups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {loadingPending ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">Loading pending signups...</span>
            </div>
          ) : pendingSignups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <h3 className="font-medium text-gray-900 mb-1">All caught up!</h3>
                <p className="text-sm text-gray-500">No pending volunteer signups to review.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingSignups.map(signup => (
                <SignupCard
                  key={signup.id}
                  signup={signup}
                  onUpdateStatus={handleUpdateStatus}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          {loadingAll ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">Loading all signups...</span>
            </div>
          ) : allSignups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <User className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <h3 className="font-medium text-gray-900 mb-1">No signups yet</h3>
                <p className="text-sm text-gray-500">Volunteer signups will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {allSignups.map(signup => (
                <SignupCard
                  key={signup.id}
                  signup={signup}
                  onUpdateStatus={handleUpdateStatus}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
