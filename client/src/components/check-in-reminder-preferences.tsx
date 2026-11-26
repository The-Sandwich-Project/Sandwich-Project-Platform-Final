/**
 * Event alert settings (Profile → Alerts).
 *
 * One set of settings per person, applied to every event they're the TSP
 * contact for. Everything due on a given day arrives in ONE daily email (see
 * server/services/check-in-reminder-service.ts). Each alert's own days set its
 * timing; there's no separate repeat setting:
 *   No contact / No updates     after X days, then every X days
 *   Requested date coming up    once at each chosen number of days before
 *   Event coming up, missing    daily from X days before (pause one from the email)
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlarmClock, Loader2, Save, Info, Smartphone, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { DefaultReminderRule, CheckInReminderPreferences as Prefs } from '@shared/types';
import { SmsQuickSetupDialog, useSmsStatus } from '@/components/sms-quick-setup-dialog';

type ReminderChannel = Prefs['defaultChannel'];

// ---------------------------------------------------------------------------
// Rule type definitions (mirrors the server-side RULE_TYPE_CONFIG)
// ---------------------------------------------------------------------------

const RULE_TYPES = [
  {
    ruleType: 'no_contact',
    label: 'No contact logged',
    description: 'A New or In Process event with no contact attempt logged for a while.',
    defaultThreshold: 5,
    kind: 'repeat' as const,
    before: 'After',
    after: (n: number) => `days with no contact logged, then every ${n === 1 ? 'day' : `${n} days`} until one is logged`,
    category: 'in_process' as const,
  },
  {
    ruleType: 'stale_event',
    label: 'No updates',
    description: "A New or In Process event nobody has updated in the app for a while (the Google Sheet sync doesn't count).",
    defaultThreshold: 7,
    kind: 'repeat' as const,
    before: 'After',
    after: (n: number) => `days with no updates, then every ${n === 1 ? 'day' : `${n} days`} until someone updates it`,
    category: 'in_process' as const,
  },
  {
    ruleType: 'date_approaching_inprocess',
    label: 'Requested date coming up',
    description: "The requested date is getting close and the event still isn't scheduled. You get one alert at each point you pick.",
    defaultThreshold: 14,
    kind: 'checkpoints' as const,
    before: 'Alert me',
    after: 'days before the requested date',
    category: 'in_process' as const,
  },
  {
    ruleType: 'date_approaching_scheduled',
    label: 'Event coming up, missing info',
    description: "A scheduled event is getting close and is missing its time, address, sandwich count or types, or isn't on the planning sheet yet.",
    defaultThreshold: 7,
    kind: 'daily' as const,
    before: 'Starting',
    after: "days before the event, every day until it's filled in",
    category: 'scheduled' as const,
  },
] as const;

const DEFAULT_CHECKPOINTS = [14, 7, 2];
const MAX_DAYS = 90;

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'both', label: 'Email & SMS' },
] as const;

const usesSms = (channel: ReminderChannel) => channel === 'sms' || channel === 'both';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CheckInReminderPreferencesEditor() {
  const { toast } = useToast();

  // Fetch current preferences
  const { data: serverPrefs, isLoading } = useQuery<Prefs | null>({
    queryKey: ['/api/me/check-in-reminder-preferences'],
    queryFn: () => apiRequest('GET', '/api/me/check-in-reminder-preferences'),
  });

  // Build local state from server data (or sensible defaults)
  const defaultRules: DefaultReminderRule[] = useMemo(
    () =>
      RULE_TYPES.map((rt) => {
        const existing = serverPrefs?.rules?.find((r) => r.ruleType === rt.ruleType);
        return {
          ruleType: rt.ruleType,
          // Same rule as the server: a configured person missing an alert has it off.
          enabled: existing?.enabled ?? !serverPrefs?.configured,
          thresholdDays: existing?.thresholdDays ?? rt.defaultThreshold,
          ...(rt.kind === 'checkpoints'
            ? { checkpointDays: existing?.checkpointDays?.length ? existing.checkpointDays : DEFAULT_CHECKPOINTS }
            : {}),
        };
      }),
    [serverPrefs],
  );

  const [rules, setRules] = useState<DefaultReminderRule[]>(defaultRules);
  const [channel, setChannel] = useState<ReminderChannel>(
    serverPrefs?.defaultChannel ?? 'email'
  );

  // Text reminders only go out once the user has confirmed their number
  // (the reminder job skips SMS otherwise). Until then, picking an SMS
  // option shows a notice with a shortcut to the quick setup window.
  // If the status can't be loaded, don't block the choice.
  const { data: smsStatus, isError: smsStatusError } = useSmsStatus();
  const smsReady = smsStatusError || !smsStatus || smsStatus.hasConfirmedOptIn;
  const [blockedChannel, setBlockedChannel] = useState<ReminderChannel | null>(null);
  const [smsSetupOpen, setSmsSetupOpen] = useState(false);
  const [smsJustEnabled, setSmsJustEnabled] = useState(false);

  const handleChannelChange = (value: ReminderChannel) => {
    setSmsJustEnabled(false);
    if (usesSms(value) && !smsReady) {
      setBlockedChannel(value);
      return;
    }
    setBlockedChannel(null);
    setChannel(value);
  };

  const handleSmsEnabled = () => {
    if (blockedChannel) {
      setChannel(blockedChannel);
      setBlockedChannel(null);
      setSmsJustEnabled(true);
    }
  };

  // A saved SMS choice from before texts were set up: those texts aren't sending.
  const savedSmsNotSending =
    !smsReady && !blockedChannel && usesSms(channel);

  // Reset local state when server data changes (e.g. after a reload or cache update).
  // `defaultRules` is a useMemo value derived solely from
  // `serverPrefs`, so they will always be in sync when `serverPrefs` changes.
  // Including them as effect dependencies would cause a double-run without benefit.
  useEffect(() => {
    setRules(defaultRules);
    setChannel(serverPrefs?.defaultChannel ?? 'email');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPrefs]);

  const saveMutation = useMutation({
    mutationFn: (prefs: Prefs) =>
      apiRequest('PUT', '/api/me/check-in-reminder-preferences', prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/me/check-in-reminder-preferences'],
      });
      toast({
        title: 'Preferences saved',
        description:
          'Your alert settings now apply to all your events, starting with your next daily email.',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Couldn't save",
        description: error instanceof Error && error.message ? error.message : 'Failed to save alert settings.',
        variant: 'destructive',
      });
    },
  });

  // Standard rule handlers
  const handleToggle = (ruleType: string, enabled: boolean) => {
    setRules((prev) =>
      prev.map((r) => (r.ruleType === ruleType ? { ...r, enabled } : r)),
    );
  };
  const handleThreshold = (ruleType: string, thresholdDays: number) => {
    setRules((prev) =>
      prev.map((r) => (r.ruleType === ruleType ? { ...r, thresholdDays } : r)),
    );
  };
  const handleCheckpoints = (ruleType: string, checkpointDays: number[]) => {
    const clean = [...new Set(checkpointDays)].sort((a, b) => b - a);
    setRules((prev) =>
      prev.map((r) =>
        // thresholdDays mirrors the largest checkpoint but must stay >= 1: "day of" alone is [0].
        r.ruleType === ruleType ? { ...r, checkpointDays: clean, thresholdDays: Math.max(1, clean[0] ?? r.thresholdDays) } : r,
      ),
    );
  };
  const checkpointsMissing = rules.some(
    (r) => r.ruleType === 'date_approaching_inprocess' && r.enabled && !(r.checkpointDays?.length),
  );

  const handleSave = () => {
    saveMutation.mutate({
      configured: true,
      defaultChannel: channel,
      rules,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-[#007E8C]" />
      </div>
    );
  }

  const inProcessRules = RULE_TYPES.filter((rt) => rt.category === 'in_process');
  const scheduledRules = RULE_TYPES.filter((rt) => rt.category === 'scheduled');

  return (
    <Card data-tour="reminder-preferences">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlarmClock className="w-5 h-5 text-[#007E8C]" />
          Event Alerts
        </CardTitle>
        <CardDescription>
          Alerts about the events you're the TSP contact for. Everything that comes up on
          a given day arrives together in one email (never more than one a day, and none
          on days nothing comes up), with the group's contact info and links to act on
          each one. Changes apply starting with your next daily email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Channel preference */}
        <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
          <Label className="text-sm font-medium text-gray-700">
            Default notification channel
          </Label>
          <Select
            value={channel}
            onValueChange={(value) => handleChannelChange(value as ReminderChannel)}
          >
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                  {usesSms(opt.value) && !smsReady && (
                    <span className="text-xs text-gray-500"> (needs setup)</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(blockedChannel || savedSmsNotSending) && (
          <Alert className="border-amber-200 bg-amber-50" data-testid="sms-not-enabled-notice">
            <Smartphone className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-900">
              <p>
                {blockedChannel
                  ? "Text messages aren't turned on for your account yet, so we can't send reminders by text."
                  : "Your reminders are set to text you, but text messages aren't turned on for your account yet, so no texts are being sent."}
              </p>
              <Button
                size="sm"
                className="mt-2 bg-[#007E8C] hover:bg-[#006570] text-white"
                onClick={() => setSmsSetupOpen(true)}
                data-testid="button-open-sms-setup"
              >
                Set up text messages
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {smsJustEnabled && (
          <Alert className="border-green-200 bg-green-50">
            <Info className="h-4 w-4 text-green-700" />
            <AlertDescription className="text-green-900">
              Text messages are on. Hit Save below to start getting reminders by text.
            </AlertDescription>
          </Alert>
        )}

        <SmsQuickSetupDialog
          open={smsSetupOpen}
          onOpenChange={setSmsSetupOpen}
          onEnabled={handleSmsEnabled}
          reason="Confirm your mobile number so we can text you event reminders."
        />

        {!serverPrefs?.configured && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              You're using the standard alerts shown below, which already
              apply to all your events. Change anything and hit Save to make them your own.
            </AlertDescription>
          </Alert>
        )}

        {/* In-process event rules */}
        <RuleSection
          title="While events are in process"
          subtitle="New and In Process events"
          ruleTypes={inProcessRules}
          rules={rules}
          onToggle={handleToggle}
          onThreshold={handleThreshold}
          onCheckpoints={handleCheckpoints}
        />

        {/* Scheduled event rules */}
        <RuleSection
          title="Once events are scheduled"
          subtitle="Scheduled and Rescheduled events"
          ruleTypes={scheduledRules}
          rules={rules}
          onToggle={handleToggle}
          onThreshold={handleThreshold}
          onCheckpoints={handleCheckpoints}
        />


        {checkpointsMissing && (
          <p className="text-sm text-amber-700">
            Pick at least one day for "Requested date coming up", or turn it off.
          </p>
        )}

        {/* Save */}
        <Button
          className="w-full bg-[#007E8C] hover:bg-[#006570] text-white"
          onClick={handleSave}
          disabled={saveMutation.isPending || checkpointsMissing}
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save Alert Settings
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rule section sub-component
// ---------------------------------------------------------------------------

function RuleSection({
  title,
  subtitle,
  ruleTypes,
  rules,
  onToggle,
  onThreshold,
  onCheckpoints,
}: {
  title: string;
  subtitle: string;
  ruleTypes: readonly (typeof RULE_TYPES)[number][];
  rules: DefaultReminderRule[];
  onToggle: (ruleType: string, enabled: boolean) => void;
  onThreshold: (ruleType: string, days: number) => void;
  onCheckpoints: (ruleType: string, days: number[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
      {ruleTypes.map((rt) => {
        const rule = rules.find((r) => r.ruleType === rt.ruleType);
        if (!rule) return null;
        return (
          <div
            key={rt.ruleType}
            className={`border rounded-lg p-3 space-y-2 transition-colors ${
              rule.enabled ? 'border-[#007E8C]/30 bg-[#007E8C]/5' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) => onToggle(rt.ruleType, checked)}
                aria-label={rt.label}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${rule.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                  {rt.label}
                </p>
                <p className="text-xs text-gray-500">{rt.description}</p>
              </div>
            </div>

            {rule.enabled && (
              <div className="flex flex-wrap items-center gap-2 pl-10 text-xs text-gray-600">
                <span>{rt.before}</span>
                {rt.kind === 'checkpoints' ? (
                  <CheckpointEditor
                    days={rule.checkpointDays ?? []}
                    onChange={(d) => onCheckpoints(rt.ruleType, d)}
                  />
                ) : (
                  <Input
                    type="number"
                    min={1}
                    max={MAX_DAYS}
                    value={rule.thresholdDays}
                    onChange={(e) =>
                      onThreshold(rt.ruleType, Math.min(MAX_DAYS, Math.max(1, parseInt(e.target.value) || 1)))
                    }
                    className="w-16 h-7 text-sm text-center"
                    aria-label={`${rt.label}: days`}
                  />
                )}
                <span>{typeof rt.after === 'function' ? rt.after(rule.thresholdDays) : rt.after}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Requested date coming up": the days before the date to alert on
// ---------------------------------------------------------------------------

function CheckpointEditor({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const n = parseInt(draft, 10);
    if (Number.isInteger(n) && n >= 0 && n <= MAX_DAYS) onChange([...days, n]);
    setDraft('');
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {days.map((d) => (
        <span
          key={d}
          className="inline-flex items-center gap-1 rounded-full bg-white border border-[#007E8C]/40 px-2 py-0.5 text-xs text-gray-800"
        >
          {d === 0 ? 'day of' : d}
          <button
            type="button"
            onClick={() => onChange(days.filter((x) => x !== d))}
            className="text-gray-400 hover:text-gray-700"
            aria-label={`Remove ${d} days`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <Input
        type="number"
        min={0}
        max={MAX_DAYS}
        value={draft}
        placeholder="add"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        className="w-16 h-7 text-sm text-center"
        aria-label="Add a number of days before the requested date"
      />
      <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={add} disabled={draft === ''}>
        <Plus className="w-3 h-3" />
      </Button>
    </span>
  );
}
