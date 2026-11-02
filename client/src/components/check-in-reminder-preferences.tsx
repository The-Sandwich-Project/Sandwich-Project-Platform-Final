/**
 * CheckInReminderPreferences
 *
 * Global "default reminder rules" configuration.  Users set this up once in
 * their profile → Alerts tab.  These defaults automatically apply to every
 * event they're the TSP contact for, unless they override per-event.
 *
 * Pattern: toggle on the rules you care about, set thresholds, pick a
 * channel → Save.  Per-event cards then just show a bell icon (on/off) with
 * an optional "Customize" escape hatch.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlarmClock, Loader2, Save, Info, Building2 } from 'lucide-react';
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

type ReminderChannel = Prefs['defaultChannel'];
type ReminderFrequency = DefaultReminderRule['frequency'];

// ---------------------------------------------------------------------------
// Rule type definitions (mirrors the server-side RULE_TYPE_CONFIG)
// ---------------------------------------------------------------------------

const RULE_TYPES = [
  {
    ruleType: 'no_contact',
    label: 'No Contact Logged',
    description: 'Alert when no contact has been logged for a set number of days',
    defaultThreshold: 5,
    thresholdPrefix: 'After',
    thresholdLabel: 'days with no contact',
    category: 'in_process' as const,
  },
  {
    ruleType: 'stale_event',
    label: 'Stale / No Updates',
    description: 'Alert when no updates have been made for a set number of days',
    defaultThreshold: 7,
    thresholdPrefix: 'After',
    thresholdLabel: 'days with no updates',
    category: 'in_process' as const,
  },
  {
    ruleType: 'date_approaching_inprocess',
    label: 'Desired Date Approaching',
    description: 'Alert when the desired event date is coming up soon (while still in process)',
    defaultThreshold: 14,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of desired date',
    category: 'in_process' as const,
  },
  {
    ruleType: 'date_approaching_scheduled',
    label: 'Event Date Approaching',
    description: 'Alert when a scheduled event date is coming up soon',
    defaultThreshold: 7,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of event',
    category: 'scheduled' as const,
  },
  {
    ruleType: 'staffing_unmet',
    label: 'Staffing Needs Unmet',
    description: 'Alert if roles are still unfilled close to the event date',
    defaultThreshold: 7,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of event',
    category: 'scheduled' as const,
  },
  {
    ruleType: 'missing_details',
    label: 'Missing Key Details',
    description: 'Alert if sandwich count/type, location, or pickup time are still missing within your specified number of days before the event',
    defaultThreshold: 7,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of event',
    category: 'scheduled' as const,
  },
  {
    ruleType: 'general_checkin',
    label: 'General Check-In',
    description: 'Periodic reminder to check in on events',
    defaultThreshold: 7,
    thresholdLabel: '',
    category: 'all' as const,
    isFrequencyBased: true,
  },
] as const;

// Tighter default thresholds for corporate priority events
const CORPORATE_THRESHOLD_DEFAULTS: Record<string, number> = {
  no_contact: 3,
  stale_event: 3,
  date_approaching_inprocess: 21,
  date_approaching_scheduled: 14,
  staffing_unmet: 14,
  missing_details: 14,
  general_checkin: 7,
};

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'both', label: 'Email & SMS' },
] as const;

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'every_3_days', label: 'Every 3 days' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
] as const;

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
          enabled: existing?.enabled ?? false,
          thresholdDays: existing?.thresholdDays ?? rt.defaultThreshold,
          frequency: existing?.frequency ?? 'weekly',
        };
      }),
    [serverPrefs],
  );

  const defaultCorpRules: DefaultReminderRule[] = useMemo(
    () =>
      RULE_TYPES.map((rt) => {
        const existing = serverPrefs?.corporateRules?.find((r) => r.ruleType === rt.ruleType);
        return {
          ruleType: rt.ruleType,
          enabled: existing?.enabled ?? false,
          thresholdDays: existing?.thresholdDays ?? (CORPORATE_THRESHOLD_DEFAULTS[rt.ruleType] ?? rt.defaultThreshold),
          frequency: existing?.frequency ?? 'every_3_days',
        };
      }),
    [serverPrefs],
  );

  const [rules, setRules] = useState<DefaultReminderRule[]>(defaultRules);
  const [corpRules, setCorpRules] = useState<DefaultReminderRule[]>(defaultCorpRules);
  const [channel, setChannel] = useState<ReminderChannel>(
    serverPrefs?.defaultChannel ?? 'email'
  );

  // Reset local state when server data changes (e.g. after a reload or cache update).
  // `defaultRules` and `defaultCorpRules` are useMemo values derived solely from
  // `serverPrefs`, so they will always be in sync when `serverPrefs` changes.
  // Including them as effect dependencies would cause a double-run without benefit.
  useEffect(() => {
    setRules(defaultRules);
    setCorpRules(defaultCorpRules);
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
          'Your default reminder rules will apply to all events unless overridden.',
      });
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

  // Corporate rule handlers
  const handleCorpToggle = (ruleType: string, enabled: boolean) => {
    setCorpRules((prev) =>
      prev.map((r) => (r.ruleType === ruleType ? { ...r, enabled } : r)),
    );
  };
  const handleCorpThreshold = (ruleType: string, thresholdDays: number) => {
    setCorpRules((prev) =>
      prev.map((r) => (r.ruleType === ruleType ? { ...r, thresholdDays } : r)),
    );
  };
  const handleCorpFrequency = (ruleType: string, frequency: ReminderFrequency) => {
    setCorpRules((prev) =>
      prev.map((r) => (r.ruleType === ruleType ? { ...r, frequency } : r)),
    );
  };

  const handleSave = () => {
    saveMutation.mutate({
      configured: true,
      defaultChannel: channel,
      rules,
      corporateRules: corpRules,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-[#236383]" />
      </div>
    );
  }

  const inProcessRules = RULE_TYPES.filter((rt) => rt.category === 'in_process');
  const scheduledRules = RULE_TYPES.filter((rt) => rt.category === 'scheduled');
  const generalRules = RULE_TYPES.filter((rt) => rt.category === 'all');

  return (
    <Card data-tour="reminder-preferences">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlarmClock className="w-5 h-5 text-[#236383]" />
          Event Check-In Reminders
        </CardTitle>
        <CardDescription>
          Set your default reminder rules here. They'll automatically apply to
          every event you're assigned to as TSP contact. You can still customize
          or snooze reminders on individual events.
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
            onValueChange={(value) => setChannel(value as ReminderChannel)}
          >
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!serverPrefs?.configured && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              You haven't set up your default reminders yet. Toggle on the rules
              below and hit Save — they'll apply to all your events automatically.
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

        {/* General */}
        <RuleSection
          title="General"
          subtitle="Applies to events in any status"
          ruleTypes={generalRules}
          rules={rules}
          onToggle={handleToggle}
          onThreshold={handleThreshold}
          onFrequency={handleFrequency}
        />

        {/* Corporate priority overrides */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-purple-600" />
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Corporate Priority Events
              </h3>
              <p className="text-xs text-gray-500">
                Tighter thresholds for corporate events that need faster follow-up. Toggle individual rules on/off and customize their thresholds.
              </p>
            </div>
          </div>

          <div className="space-y-4 pl-1 border-l-2 border-purple-200 ml-2">
            <div className="pl-4">
              <RuleSection
                title="In-process corporate events"
                subtitle="Tighter cadence for high-priority corporate requests"
                ruleTypes={inProcessRules}
                rules={corpRules}
                onToggle={handleCorpToggle}
                onThreshold={handleCorpThreshold}
                onFrequency={handleCorpFrequency}
                accentColor="purple"
              />
            </div>
            <div className="pl-4">
              <RuleSection
                title="Scheduled corporate events"
                subtitle="Earlier warnings for corporate event dates"
                ruleTypes={scheduledRules}
                rules={corpRules}
                onToggle={handleCorpToggle}
                onThreshold={handleCorpThreshold}
                onFrequency={handleCorpFrequency}
                accentColor="purple"
              />
            </div>
            <div className="pl-4">
              <RuleSection
                title="General (corporate)"
                subtitle="Periodic check-in for corporate events"
                ruleTypes={generalRules}
                rules={corpRules}
                onToggle={handleCorpToggle}
                onThreshold={handleCorpThreshold}
                onFrequency={handleCorpFrequency}
                accentColor="purple"
              />
            </div>
          </div>
        </div>

        {/* Save */}
        <Button
          className="w-full bg-[#236383] hover:bg-[#006570] text-white"
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
  const enabledBorder = accentColor === 'purple' ? 'border-purple-300/30 bg-purple-50/50' : 'border-[#236383]/30 bg-[#236383]/5';

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
              <div className="flex items-center gap-2 pl-10">
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
