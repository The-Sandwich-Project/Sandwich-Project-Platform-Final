import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Mail,
  Smartphone,
  CheckCircle,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { USER_ROLES } from '@shared/auth-utils';
import { ALERT_TYPES } from '@shared/alert-catalog';
import { Button } from '@/components/ui/button';
import { SmsQuickSetupDialog } from '@/components/sms-quick-setup-dialog';

/**
 * Alert Preferences
 *
 * One flat list of alerts. Each row: on/off toggle, channel checkboxes,
 * saved inline. No tabs, no separate "customize" view, no big Save button.
 *
 * Alert catalog and channel semantics live in `shared/alert-catalog.ts` —
 * the backend reads the same catalog to honor these settings.
 */

interface AlertRow {
  type: string;
  name: string;
  description: string;
  category: 'event' | 'communication' | 'task' | 'collection' | 'admin';
  availableChannels: Array<'email' | 'sms' | 'in_app'>;
  implemented: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  hasSavedPreference: boolean;
}

interface AlertPreferencesResponse {
  alerts: AlertRow[];
}

interface UpdateArgs {
  type: string;
  emailEnabled?: boolean;
  smsEnabled?: boolean;
}

const CATEGORY_ORDER: Array<AlertRow['category']> = [
  'event',
  'task',
  'collection',
  'communication',
  'admin',
];

const CATEGORY_LABEL: Record<AlertRow['category'], string> = {
  event: 'Events',
  task: 'Tasks & Assignments',
  collection: 'Collection Reminders',
  communication: 'Mentions & Messages',
  admin: 'Admin Digests',
};

export default function AlertPreferences() {
  const { toast } = useToast();
  const client = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === USER_ROLES.SUPER_ADMIN;
  const isAdminRole = user?.role === USER_ROLES.ADMIN || isSuperAdmin;

  const { data, isLoading } = useQuery<AlertPreferencesResponse>({
    queryKey: ['/api/notifications/alert-preferences'],
    queryFn: () => apiRequest('GET', '/api/notifications/alert-preferences'),
  });

  const { data: smsStatus, isLoading: smsStatusLoading } = useQuery<any>({
    queryKey: ['/api/users/sms-status'],
    queryFn: () => apiRequest('GET', '/api/users/sms-status'),
  });

  const hasSmsOptIn = !!smsStatus?.hasConfirmedOptIn;
  const [smsSetupOpen, setSmsSetupOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (args: UpdateArgs) =>
      apiRequest('PUT', '/api/notifications/alert-preferences', args),
    onMutate: async (args) => {
      // Optimistic update so the toggle feels instant
      await client.cancelQueries({ queryKey: ['/api/notifications/alert-preferences'] });
      const previous = client.getQueryData<AlertPreferencesResponse>([
        '/api/notifications/alert-preferences',
      ]);
      if (previous) {
        client.setQueryData<AlertPreferencesResponse>(
          ['/api/notifications/alert-preferences'],
          {
            alerts: previous.alerts.map((a) =>
              a.type === args.type
                ? {
                    ...a,
                    emailEnabled: args.emailEnabled ?? a.emailEnabled,
                    smsEnabled: args.smsEnabled ?? a.smsEnabled,
                    hasSavedPreference: true,
                  }
                : a
            ),
          }
        );
      }
      return { previous };
    },
    onError: (err, _args, ctx) => {
      if (ctx?.previous) {
        client.setQueryData(['/api/notifications/alert-preferences'], ctx.previous);
      }
      toast({
        title: 'Failed to save',
        description: (err as any)?.message ?? 'Please try again.',
        variant: 'destructive',
      });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['/api/notifications/alert-preferences'] });
    },
  });

  const alertsByCategory = useMemo(() => {
    const grouped: Record<AlertRow['category'], AlertRow[]> = {
      event: [],
      task: [],
      collection: [],
      communication: [],
      admin: [],
    };
    for (const alert of data?.alerts ?? []) {
      // Admin-category alerts are only relevant to admin/super_admin users.
      // Hide them from everyone else so the UI doesn't show toggles that
      // would have no effect (the cron only sends to those two roles).
      if (alert.category === 'admin' && !isAdminRole) {
        continue;
      }
      grouped[alert.category].push(alert);
    }
    return grouped;
  }, [data, isAdminRole]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-primary" />
            Alert Preferences
          </CardTitle>
          <CardDescription>
            Choose which alerts you receive and how. Changes save automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasSmsOptIn && !smsStatusLoading && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <span className="font-medium">Text messages aren't turned on yet.</span>{' '}
              Turn them on to choose SMS for any alert below.
              <div>
                <Button
                  size="sm"
                  className="mt-2 bg-[#007E8C] hover:bg-[#006570] text-white"
                  onClick={() => setSmsSetupOpen(true)}
                  data-testid="button-open-sms-setup-alerts"
                >
                  Set up text messages
                </Button>
              </div>
            </div>
          )}
          <SmsQuickSetupDialog open={smsSetupOpen} onOpenChange={setSmsSetupOpen} />

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading your preferences…</p>
          ) : (
            <div className="space-y-6">
              {CATEGORY_ORDER.map((category) => {
                const items = alertsByCategory[category];
                if (items.length === 0) return null;
                return (
                  <div key={category} className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                      {CATEGORY_LABEL[category]}
                    </h3>
                    <div className="space-y-2">
                      {items.map((alert) => {
                        const superAdminForcedOn =
                          isSuperAdmin &&
                          alert.type === ALERT_TYPES.ADMIN_WEEKLY_PULSE;
                        return (
                          <AlertRow
                            key={alert.type}
                            alert={alert}
                            hasSmsOptIn={hasSmsOptIn}
                            lockedOnReason={
                              superAdminForcedOn
                                ? 'You receive this automatically as a super admin. This setting cannot be turned off here.'
                                : undefined
                            }
                            onChange={(updates) =>
                              updateMutation.mutate({ type: alert.type, ...updates })
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SMS setup lives in its own tab now so users don't have to scroll
          past the entire alert list to find it. Show a one-line pointer here
          for anyone who lands on the Alerts tab looking for the SMS flow. */}
      <p className="text-xs text-muted-foreground">
        Need to {hasSmsOptIn ? 'update or unsubscribe from' : 'set up'} text alerts?{' '}
        <a
          href="?tab=sms"
          className="text-primary hover:underline font-medium"
          data-testid="link-go-to-sms-tab"
        >
          Open the SMS tab
        </a>
        .
      </p>
    </div>
  );
}

interface AlertRowProps {
  alert: AlertRow;
  hasSmsOptIn: boolean;
  /**
   * When set, the row is shown as "always on" and the user cannot toggle
   * it off. Used for super admins viewing the Admin Weekly Pulse row, where
   * delivery is guaranteed by role regardless of saved preferences.
   */
  lockedOnReason?: string;
  onChange: (updates: { emailEnabled?: boolean; smsEnabled?: boolean }) => void;
}

function AlertRow({ alert, hasSmsOptIn, lockedOnReason, onChange }: AlertRowProps) {
  const isLocked = Boolean(lockedOnReason);
  const isOn = isLocked ? true : alert.emailEnabled || alert.smsEnabled;

  const toggleAll = (enabled: boolean) => {
    if (isLocked) return;
    if (enabled) {
      // Turn back on: restore email by default (safe — everyone has email)
      onChange({ emailEnabled: true });
    } else {
      // Turn off: disable both channels
      onChange({ emailEnabled: false, smsEnabled: false });
    }
  };

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        alert.implemented ? 'bg-white' : 'bg-slate-50 border-dashed'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-900">{alert.name}</span>
            {!alert.implemented && (
              <Badge variant="outline" className="text-xs">
                Coming soon
              </Badge>
            )}
            {isLocked && (
              <Badge
                variant="outline"
                className="text-xs text-brand-primary border-brand-primary/40"
              >
                <ShieldCheck className="h-3 w-3 mr-1" />
                Always on
              </Badge>
            )}
            {!isLocked && alert.implemented && alert.hasSavedPreference && isOn && (
              <Badge variant="outline" className="text-xs text-green-700 border-green-300">
                <CheckCircle className="h-3 w-3 mr-1" />
                On
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1">{alert.description}</p>
          {isLocked && (
            <p className="text-xs text-slate-500 italic mt-1">{lockedOnReason}</p>
          )}
        </div>
        <Switch
          checked={isOn}
          onCheckedChange={toggleAll}
          disabled={!alert.implemented || isLocked}
          aria-label={`Enable ${alert.name}`}
        />
      </div>

      {alert.implemented && !isLocked && isOn && (
        <div className="flex flex-wrap gap-4 pl-1">
          {alert.availableChannels.includes('email') && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={alert.emailEnabled}
                onCheckedChange={(c) => onChange({ emailEnabled: c === true })}
              />
              <Mail className="h-4 w-4 text-slate-500" />
              Email
            </label>
          )}
          {alert.availableChannels.includes('sms') && (
            <label
              className={`flex items-center gap-2 text-sm ${hasSmsOptIn ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
              title={hasSmsOptIn ? undefined : 'Turn on text messages above to use this channel'}
            >
              <Checkbox
                checked={alert.smsEnabled}
                onCheckedChange={(c) => onChange({ smsEnabled: c === true })}
                disabled={!hasSmsOptIn}
              />
              <Smartphone className="h-4 w-4 text-slate-500" />
              SMS
              {!hasSmsOptIn && (
                <span className="text-xs text-slate-500">(not set up)</span>
              )}
            </label>
          )}
        </div>
      )}

      {!alert.implemented && (
        <p className="text-xs text-slate-500 italic flex items-center gap-1">
          <Clock className="h-3 w-3" />
          This alert isn't wired up yet — we'll turn it on in a future release.
        </p>
      )}
    </div>
  );
}
