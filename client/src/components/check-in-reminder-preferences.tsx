/**
 * CheckInReminderPreferences
 *
 * Global "default reminder rules" configuration.  Users set this up once in
 * their profile → Alerts tab.  These defaults automatically apply to every
 * event they're the TSP contact for. Per-event customization was retired —
 * these defaults are the only reminder settings. Saving clears the user's
 * per-event copies so the hourly job re-applies the new defaults.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlarmClock, Loader2, Save, Info, Smartphone } from 'lucide-react';
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
type ReminderFrequency = DefaultReminderRule['frequency'];

// ---------------------------------------------------------------------------
// Rule type definitions (mirrors the server-side RULE_TYPE_CONFIG)
// ---------------------------------------------------------------------------

const RULE_TYPES = [
  {
    ruleType: 'no_contact',
    label: 'No Contact Logged',
    description: 'When no contact attempt has been logged for a while (In Process events)',
    defaultThreshold: 5,
    thresholdPrefix: 'After',
    thresholdLabel: 'days with no contact',
    category: 'in_process' as const,
  },
  {
    ruleType: 'stale_event',
    label: 'No Updates',
    description: "When an In Process event hasn't been updated for a while",
    defaultThreshold: 7,
    thresholdPrefix: 'After',
    thresholdLabel: 'days with no updates',
    category: 'in_process' as const,
  },
  {
    ruleType: 'date_approaching_inprocess',
    label: 'Requested Date Coming Up',
    description: 'When the requested date is getting close and the event is still In Process',
    defaultThreshold: 14,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of requested date',
    category: 'in_process' as const,
  },
  {
    ruleType: 'date_approaching_scheduled',
    label: 'Event Coming Up, Missing Info',
    description: "When a scheduled event is getting close and is missing its time, address, sandwich count or types, or isn't on the planning sheet yet",
    defaultThreshold: 7,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of event',
    category: 'scheduled' as const,
  },
] as const;

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'both', label: 'Email & SMS' },
] as const;

const usesSms = (channel: ReminderChannel) => channel === 'sms' || channel === 'both';

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'every_3_days', label: 'Every 3 days' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CheckInReminderPreferencesEditor({
  onSaved,
}: {
  /** Called after a successful save — e.g. so a popup can close itself. */
  onSaved?: () => void;
} = {}) {
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
          enabled: existing?.enabled ?? false,
          thresholdDays: existing?.thresholdDays ?? rt.defaultThreshold,
          frequency: existing?.frequency ?? 'weekly',
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
          'Your reminder settings now apply to all your events.',
      });
      onSaved?.();
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save reminder preferences.',
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
  const handleFrequency = (ruleType: string, frequency: ReminderFrequency) => {
    setRules((prev) =>
      prev.map((r) => (r.ruleType === ruleType ? { ...r, frequency } : r)),
    );
  };

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
          Event Check-In Reminders
        </CardTitle>
        <CardDescription>
          Set your default reminder rules here. They'll automatically apply to
          every event you're assigned to as TSP contact. Changes apply to all
          your events within the hour.
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
              You're using the standard reminders shown below, which already
              apply to all your events. Change anything and hit Save to make them your own.
            </AlertDescription>
          </Alert>
        )}

        {/* In-process event rules */}
        <RuleSection
          title="While events are in process"
          subtitle="These fire when an event is new or being coordinated"
          ruleTypes={inProcessRules}
          rules={rules}
          onToggle={handleToggle}
          onThreshold={handleThreshold}
          onFrequency={handleFrequency}
        />

        {/* Scheduled event rules */}
        <RuleSection
          title="Once events are scheduled"
          subtitle="These fire as a confirmed event date approaches"
          ruleTypes={scheduledRules}
          rules={rules}
          onToggle={handleToggle}
          onThreshold={handleThreshold}
          onFrequency={handleFrequency}
        />


        {/* Save */}
        <Button
          className="w-full bg-[#007E8C] hover:bg-[#006570] text-white"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save Default Reminder Rules
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
  onFrequency,
  accentColor = 'teal',
}: {
  title: string;
  subtitle: string;
  ruleTypes: readonly (typeof RULE_TYPES)[number][];
  rules: DefaultReminderRule[];
  onToggle: (ruleType: string, enabled: boolean) => void;
  onThreshold: (ruleType: string, days: number) => void;
  onFrequency: (ruleType: string, freq: ReminderFrequency) => void;
  accentColor?: 'teal' | 'purple';
}) {
  const enabledBorder = accentColor === 'purple' ? 'border-purple-300/30 bg-purple-50/50' : 'border-[#007E8C]/30 bg-[#007E8C]/5';

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
      {ruleTypes.map((rt) => {
        const rule = rules.find((r) => r.ruleType === rt.ruleType);
        if (!rule) return null;
        const isFreqBased = 'isFrequencyBased' in rt && rt.isFrequencyBased;

        return (
          <div
            key={rt.ruleType}
            className={`border rounded-lg p-3 space-y-2 transition-colors ${
              rule.enabled
                ? enabledBorder
                : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) => onToggle(rt.ruleType, checked)}
              />
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${
                    rule.enabled ? 'text-gray-900' : 'text-gray-400'
                  }`}
                >
                  {rt.label}
                </p>
                <p className="text-xs text-gray-500">{rt.description}</p>
              </div>
            </div>

            {rule.enabled && (
              <div className="flex flex-wrap items-center gap-2 pl-10">
                {isFreqBased ? (
                  <>
                    <span className="text-xs text-gray-500">Remind me</span>
                    <Select
                      value={rule.frequency}
                      onValueChange={(val) => onFrequency(rt.ruleType, val as ReminderFrequency)}
                    >
                      <SelectTrigger className="w-32 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FREQUENCY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-gray-500">
                      {'thresholdPrefix' in rt ? rt.thresholdPrefix : 'After'}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={rule.thresholdDays}
                      onChange={(e) =>
                        onThreshold(rt.ruleType, parseInt(e.target.value) || 1)
                      }
                      className="w-16 h-7 text-sm text-center"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {rt.thresholdLabel}
                    </span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">, then remind me</span>
                    <Select
                      value={rule.frequency}
                      onValueChange={(val) => onFrequency(rt.ruleType, val as ReminderFrequency)}
                    >
                      <SelectTrigger className="w-32 h-7 text-xs" aria-label={`How often to repeat: ${rt.label}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FREQUENCY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
