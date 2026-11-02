/**
 * ReminderRulesManager — Per-event reminder control
 *
 * The primary interface for managing reminders on individual event cards.
 *
 * Architecture (two-layer system):
 *   Layer 1: Global defaults — configured once in Profile → Alerts tab
 *   Layer 2: This component — per-event toggle, snooze, and optional overrides
 *
 * Most users just use the toggle (on/off) and snooze buttons. The "Customize"
 * option is an escape hatch for events that need different thresholds than
 * the user's global defaults.
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import {
  Bell,
  BellOff,
  Loader2,
  Plus,
  Trash2,
  Save,
  AlertTriangle,
  PauseCircle,
  PlayCircle,
  Settings2,
  CalendarClock,
  MessageSquareMore,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface ReminderRulesManagerProps {
  eventRequestId: number;
  tspContactUserId?: string | null;
  eventStatus?: string | null;
}

const RULE_TYPE_CONFIG = {
  no_contact: {
    label: 'No Contact Logged',
    description: 'Alert when no contact for a set number of days',
    defaultThreshold: 5,
    thresholdPrefix: 'After',
    thresholdLabel: 'days with no contact',
    applicableStatuses: ['new', 'in_process'],
    isConditionBased: true,
  },
  stale_event: {
    label: 'Stale / No Updates',
    description: 'Alert when no updates for a set number of days',
    defaultThreshold: 7,
    thresholdPrefix: 'After',
    thresholdLabel: 'days with no updates',
    applicableStatuses: ['new', 'in_process'],
    isConditionBased: true,
  },
  date_approaching_inprocess: {
    label: 'Desired Date Approaching',
    description: 'Alert when desired date is coming up soon',
    defaultThreshold: 14,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of desired date',
    applicableStatuses: ['new', 'in_process'],
    isConditionBased: true,
  },
  date_approaching_scheduled: {
    label: 'Event Date Approaching',
    description: 'Alert when scheduled date is coming up soon',
    defaultThreshold: 7,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of event',
    applicableStatuses: ['scheduled'],
    isConditionBased: true,
  },
  staffing_unmet: {
    label: 'Staffing Needs Unmet',
    description: 'Alert if roles are still unfilled close to event',
    defaultThreshold: 7,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of event',
    applicableStatuses: ['scheduled'],
    isConditionBased: true,
  },
  missing_details: {
    label: 'Missing Key Details',
    description: 'Alert if sandwich count/type, location, or pickup time are still missing within your specified number of days before the event',
    defaultThreshold: 7,
    thresholdPrefix: 'Within',
    thresholdLabel: 'days of event',
    applicableStatuses: ['scheduled'],
    isConditionBased: true,
  },
  general_checkin: {
    label: 'General Check-In',
    description: 'Periodic reminder to check in on this event',
    defaultThreshold: 7,
    thresholdLabel: '',
    applicableStatuses: ['new', 'in_process', 'scheduled', 'stalled'],
    isConditionBased: false,
  },
} as const;

type RuleType = keyof typeof RULE_TYPE_CONFIG;

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'every_3_days', label: 'Every 3 days' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
] as const;

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'both', label: 'Email & SMS' },
] as const;

interface ReminderRule {
  id?: number;
  ruleType: string;
  enabled: boolean;
  thresholdDays: number;
  frequency: string;
  channel: string;
  lastSentAt?: string | null;
}

interface Snooze {
  id: number;
  snoozeType: string;
  snoozedUntil: string | null;
  reason: string | null;
  active: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeRules(rules: ReminderRule[]): string {
  return JSON.stringify(
    rules
      .map(r => ({
        ruleType: r.ruleType,
        enabled: r.enabled,
        thresholdDays: r.thresholdDays,
        frequency: r.frequency,
        channel: r.channel,
      }))
      .sort((a, b) => a.ruleType.localeCompare(b.ruleType)),
  );
}

function normalizeForSave(rules: ReminderRule[]): ReminderRule[] {
  return rules.map(r => {
    const config = RULE_TYPE_CONFIG[r.ruleType as RuleType];
    return config?.isConditionBased ? { ...r, frequency: 'daily' } : r;
  });
}

function formatSnoozeLabel(snooze: Snooze): string {
  if (snooze.snoozeType === 'until_contact') return 'Paused until contact';
  if (snooze.snoozedUntil) {
    const d = new Date(snooze.snoozedUntil);
    return `Paused until ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  return 'Paused';
}

// ---------------------------------------------------------------------------
// Main component — compact popover on event cards
// ---------------------------------------------------------------------------

export function ReminderRulesManager({
  eventRequestId,
  tspContactUserId,
  eventStatus,
}: ReminderRulesManagerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const editorDirtyRef = useRef(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  // Show for the assigned TSP contact or any admin/super_admin
  const isAssignedContact = user?.id && tspContactUserId && user.id === tspContactUserId;
  const isAdminUser = user?.role === 'super_admin' || user?.role === 'admin';
  if (!isAssignedContact && !isAdminUser) return null;

  // Fetch per-event rules — only when the popover is opened to avoid N+1 on event lists
  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ['check-in-reminder', eventRequestId],
    queryFn: async () => {
      const res = await fetch(`/api/event-check-in-reminders/${eventRequestId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch reminders');
      return res.json();
    },
    enabled: popoverOpen,
  });

  // Fetch global defaults (shared/cached, safe to always enable)
  const { data: globalPrefs } = useQuery({
    queryKey: ['/api/me/check-in-reminder-preferences'],
    queryFn: async () => {
      const res = await fetch('/api/me/check-in-reminder-preferences', {
        credentials: 'include',
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Fetch snooze status — only when the popover is opened to avoid N+1 on event lists
  const { data: snoozeData } = useQuery({
    queryKey: ['check-in-snooze', eventRequestId],
    queryFn: async () => {
      const res = await fetch(`/api/event-check-in-reminders/${eventRequestId}/snooze`, {
        credentials: 'include',
      });
      if (!res.ok) return { snooze: null };
      return res.json();
    },
    enabled: popoverOpen,
  });

  const existingRules: ReminderRule[] = rulesData?.reminders || [];
  const activeRuleCount = existingRules.filter((r: ReminderRule) => r.enabled).length;
  const hasPerEventRules = existingRules.length > 0;
  const hasGlobalDefaults = globalPrefs?.configured === true;
  const activeSnooze: Snooze | null = snoozeData?.snooze || null;

  // Determine the effective state for the bell icon
  const isEffectivelyActive = activeSnooze
    ? false
    : hasPerEventRules
      ? activeRuleCount > 0
      : hasGlobalDefaults;

  // --- Snooze mutations ---

  const snoozeMutation = useMutation({
    mutationFn: async (body: { snoozeType: string; snoozedUntil?: string | number; reason?: string }) => {
      const res = await fetch(`/api/event-check-in-reminders/${eventRequestId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to snooze');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-in-snooze', eventRequestId] });
      setSnoozeMenuOpen(false);
      setPopoverOpen(false);
      toast({ title: 'Reminders paused', description: 'You can resume anytime from this menu.' });
    },
    onError: () => toast({ title: 'Error', description: 'Failed to pause reminders.', variant: 'destructive' }),
  });

  const unsnoozeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/event-check-in-reminders/${eventRequestId}/snooze`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to unsnooze');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-in-snooze', eventRequestId] });
      setPopoverOpen(false);
      toast({ title: 'Reminders resumed' });
    },
    onError: () => toast({ title: 'Error', description: 'Failed to resume reminders.', variant: 'destructive' }),
  });

  const handleCustomizeClose = useCallback((open: boolean) => {
    if (!open && editorDirtyRef.current) {
      setShowUnsavedWarning(true);
      return;
    }
    setCustomizeOpen(open);
  }, []);

  const handleDiscardAndClose = useCallback(() => {
    setShowUnsavedWarning(false);
    editorDirtyRef.current = false;
    setCustomizeOpen(false);
  }, []);

  if (rulesLoading) {
    return (
      <div className="flex items-center gap-1 text-gray-400">
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-tour="reminder-button"
            className={`h-8 relative ${
              activeSnooze
                ? 'border-amber-400 text-amber-600 hover:bg-amber-50'
                : isEffectivelyActive
                  ? 'border-tsp-teal text-tsp-teal hover:bg-tsp-teal/10'
                  : 'text-gray-400 hover:bg-gray-100'
            }`}
            title={
              activeSnooze
                ? formatSnoozeLabel(activeSnooze)
                : isEffectivelyActive
                  ? `Reminders active${hasPerEventRules ? ` (${activeRuleCount} custom)` : ' (using defaults)'}`
                  : 'Set up reminders'
            }
          >
            {activeSnooze ? (
              <PauseCircle className="w-4 h-4 mr-1" />
            ) : isEffectivelyActive ? (
              <Bell className="w-4 h-4 mr-1" />
            ) : (
              <BellOff className="w-4 h-4 mr-1" />
            )}
            {activeSnooze ? (
              <span className="text-xs">Paused</span>
            ) : isEffectivelyActive ? (
              <>
                <span className="text-xs">Reminders</span>
                {hasPerEventRules && activeRuleCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px] bg-tsp-teal text-white hover:bg-tsp-teal">
                    {activeRuleCount}
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-xs">Reminders</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="end" data-tour="reminder-popover">
          {/* Status summary */}
          <div className="p-3 space-y-2">
            {activeSnooze ? (
              <div className="flex items-start gap-2 text-amber-700 bg-amber-50 rounded-lg p-2">
                <PauseCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="text-xs">
                  <p className="font-medium">{formatSnoozeLabel(activeSnooze)}</p>
                  {activeSnooze.reason && (
                    <p className="text-amber-600 mt-0.5">{activeSnooze.reason}</p>
                  )}
                </div>
              </div>
            ) : isEffectivelyActive ? (
              <div className="flex items-center gap-2 text-tsp-teal">
                <Bell className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {hasPerEventRules
                    ? `${activeRuleCount} custom rule${activeRuleCount !== 1 ? 's' : ''} active`
                    : 'Using your default rules'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-400">
                <BellOff className="w-4 h-4" />
                <span className="text-sm">
                  {hasGlobalDefaults
                    ? 'No reminders for this event'
                    : 'No default reminders configured'}
                </span>
              </div>
            )}

            {!hasGlobalDefaults && !hasPerEventRules && (
              <p className="text-xs text-gray-500">
                Set up your default reminders in{' '}
                <a href="/profile?tab=notifications" className="text-tsp-teal underline">
                  Profile → Alerts
                </a>{' '}
                to apply them to all events.
              </p>
            )}
          </div>

          <Separator />

          {/* Actions */}
          <div className="p-2 space-y-1">
            {activeSnooze ? (
              <button
                onClick={() => unsnoozeMutation.mutate()}
                disabled={unsnoozeMutation.isPending}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md hover:bg-gray-100 transition-colors text-tsp-teal"
              >
                <PlayCircle className="w-4 h-4" />
                Resume reminders
                {unsnoozeMutation.isPending && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
              </button>
            ) : (
              <SnoozeMenu
                open={snoozeMenuOpen}
                onOpenChange={setSnoozeMenuOpen}
                onSnooze={(body) => snoozeMutation.mutate(body)}
                isPending={snoozeMutation.isPending}
              />
            )}

            <button
              onClick={() => {
                setPopoverOpen(false);
                setCustomizeOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md hover:bg-gray-100 transition-colors text-gray-700"
            >
              <Settings2 className="w-4 h-4" />
              Customize rules for this event
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Customize dialog */}
      <Dialog open={customizeOpen} onOpenChange={handleCustomizeClose}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Settings2 className="w-5 h-5 text-tsp-teal" />
              Custom Rules for This Event
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Override your default reminder rules for this specific event.
            </DialogDescription>
          </DialogHeader>
          <RulesEditor
            key={rulesData ? JSON.stringify(rulesData.reminders) : 'empty'}
            eventRequestId={eventRequestId}
            serverRules={existingRules}
            eventStatus={eventStatus || 'new'}
            onDirtyChange={(dirty) => { editorDirtyRef.current = dirty; }}
            onSaved={() => {
              editorDirtyRef.current = false;
              queryClient.invalidateQueries({ queryKey: ['check-in-reminder', eventRequestId] });
              toast({ title: 'Custom rules saved' });
            }}
            onError={() => toast({ title: 'Error', description: 'Failed to save.', variant: 'destructive' })}
          />
        </DialogContent>
      </Dialog>

      {/* Unsaved changes confirmation */}
      <Dialog open={showUnsavedWarning} onOpenChange={setShowUnsavedWarning}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Unsaved Changes
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes. Closing will discard them.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" size="sm" onClick={() => setShowUnsavedWarning(false)}>
              Keep Editing
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDiscardAndClose}>
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Snooze sub-menu
// ---------------------------------------------------------------------------

function SnoozeMenu({
  open,
  onOpenChange,
  onSnooze,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (body: { snoozeType: string; snoozedUntil?: string | number; reason?: string }) => void;
  isPending: boolean;
}) {
  const [snoozeDate, setSnoozeDate] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md hover:bg-gray-100 transition-colors text-gray-700"
      >
        <PauseCircle className="w-4 h-4" />
        Pause reminders...
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <p className="px-3 py-1 text-xs text-gray-500 font-medium uppercase tracking-wide">
        Pause reminders
      </p>
      {[
        { label: 'For 3 days', type: 'timed', value: 3 },
        { label: 'For 1 week', type: 'timed', value: 7 },
        { label: 'For 2 weeks', type: 'timed', value: 14 },
      ].map(opt => (
        <button
          key={opt.value}
          disabled={isPending}
          onClick={() => onSnooze({ snoozeType: opt.type, snoozedUntil: opt.value })}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left rounded-md hover:bg-gray-100 transition-colors text-gray-700"
        >
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          {opt.label}
        </button>
      ))}

      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <CalendarClock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        <Input
          type="date"
          value={snoozeDate}
          onChange={(e) => setSnoozeDate(e.target.value)}
          className="h-7 text-xs flex-1"
          min={new Date().toISOString().split('T')[0]}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-2"
          disabled={!snoozeDate || isPending}
          onClick={() => onSnooze({ snoozeType: 'until_date', snoozedUntil: snoozeDate })}
        >
          Set
        </Button>
      </div>

      <button
        disabled={isPending}
        onClick={() => onSnooze({ snoozeType: 'until_contact', reason: 'Waiting on contact response' })}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left rounded-md hover:bg-gray-100 transition-colors text-gray-700"
      >
        <MessageSquareMore className="w-3.5 h-3.5 text-gray-400" />
        Until next contact is logged
      </button>

      <Separator />
      <button
        onClick={() => onOpenChange(false)}
        className="w-full px-3 py-1.5 text-xs text-gray-400 text-left hover:text-gray-600"
      >
        Cancel
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules editor (inner form, used by customize dialog)
// ---------------------------------------------------------------------------

function RulesEditor({
  eventRequestId,
  serverRules,
  eventStatus,
  onDirtyChange,
  onSaved,
  onError,
}: {
  eventRequestId: number;
  serverRules: ReminderRule[];
  eventStatus: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onError: () => void;
}) {
  const [rules, setRules] = useState<ReminderRule[]>(() =>
    serverRules.map(r => ({ ...r })),
  );
  const [defaultChannel, setDefaultChannel] = useState(
    () => serverRules[0]?.channel || 'email',
  );

  const serverSnapshot = useRef(serializeRules(serverRules));

  const updateDirtyState = useCallback(
    (nextRules: ReminderRule[]) => {
      onDirtyChange(serializeRules(nextRules) !== serverSnapshot.current);
    },
    [onDirtyChange],
  );

  const isDirty = serializeRules(rules) !== serverSnapshot.current;

  const availableRuleTypes = useMemo(() => {
    return (Object.entries(RULE_TYPE_CONFIG) as [RuleType, (typeof RULE_TYPE_CONFIG)[RuleType]][])
      .filter(([, config]) => (config.applicableStatuses as readonly string[]).includes(eventStatus))
      .map(([type, config]) => ({ type, ...config }));
  }, [eventStatus]);

  const addableRuleTypes = useMemo(() => {
    const existingTypes = new Set(rules.map(r => r.ruleType));
    return availableRuleTypes.filter(rt => !existingTypes.has(rt.type));
  }, [availableRuleTypes, rules]);

  const bulkSaveMutation = useMutation({
    mutationFn: async (rulesToSave: ReminderRule[]) => {
      const res = await fetch('/api/event-check-in-reminders/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eventRequestId,
          rules: normalizeForSave(rulesToSave).map(r => ({
            ruleType: r.ruleType,
            enabled: r.enabled,
            thresholdDays: r.thresholdDays,
            frequency: r.frequency,
            channel: r.channel,
          })),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
    onSuccess: onSaved,
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleType: string) => {
      const res = await fetch(
        `/api/event-check-in-reminders/${eventRequestId}/${ruleType}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to delete');
      return res.json();
    },
    onSuccess: onSaved,
    onError,
  });

  const addRule = (ruleType: RuleType) => {
    const config = RULE_TYPE_CONFIG[ruleType];
    setRules(prev => {
      const next = [
        ...prev,
        {
          ruleType,
          enabled: true,
          thresholdDays: config.defaultThreshold,
          frequency: config.isConditionBased ? 'daily' : 'weekly',
          channel: defaultChannel,
        },
      ];
      updateDirtyState(next);
      return next;
    });
  };

  const updateRule = (index: number, updates: Partial<ReminderRule>) => {
    setRules(prev => {
      const next = prev.map((r, i) => (i === index ? { ...r, ...updates } : r));
      updateDirtyState(next);
      return next;
    });
  };

  const removeRule = (index: number) => {
    const rule = rules[index];
    if (rule.id) deleteMutation.mutate(rule.ruleType);
    setRules(prev => {
      const next = prev.filter((_, i) => i !== index);
      updateDirtyState(next);
      return next;
    });
  };

  const isSaving = bulkSaveMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-4 mt-2">
      <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
        <Label className="text-sm font-medium text-gray-700">Notify via</Label>
        <Select
          value={defaultChannel}
          onValueChange={(val) => {
            setDefaultChannel(val);
            setRules(prev => {
              const next = prev.map(r => ({ ...r, channel: val }));
              updateDirtyState(next);
              return next;
            });
          }}
        >
          <SelectTrigger className="w-40 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNEL_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rules.length === 0 ? (
        <div className="text-center py-4 text-gray-400 text-sm">
          No custom rules. This event uses your default rules.
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => {
            const config = RULE_TYPE_CONFIG[rule.ruleType as RuleType];
            if (!config) return null;
            return (
              <div
                key={rule.ruleType}
                className={`border rounded-lg p-3 space-y-3 transition-colors ${
                  rule.enabled ? 'border-tsp-teal/30 bg-tsp-teal/5' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) => updateRule(index, { enabled: checked })}
                      className="flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${rule.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                        {config.label}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{config.description}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-400 hover:text-red-500 flex-shrink-0"
                    onClick={() => removeRule(index)}
                    title="Remove rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {rule.enabled && (
                  <div className="flex items-center gap-3 flex-wrap">
                    {config.isConditionBased ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">{config.thresholdPrefix}</span>
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          value={rule.thresholdDays}
                          onChange={(e) => updateRule(index, { thresholdDays: parseInt(e.target.value) || 1 })}
                          className="w-16 h-7 text-sm text-center"
                        />
                        <span className="text-xs text-gray-500 whitespace-nowrap">{config.thresholdLabel}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">Remind me</span>
                        <Select
                          value={rule.frequency}
                          onValueChange={(val) => updateRule(index, { frequency: val })}
                        >
                          <SelectTrigger className="w-32 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FREQUENCY_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addableRuleTypes.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-500 uppercase tracking-wide">Add rule</Label>
          <div className="grid gap-2">
            {addableRuleTypes.map((rt) => (
              <button
                key={rt.type}
                onClick={() => addRule(rt.type)}
                className="flex items-center gap-2 text-left px-3 py-2 rounded-lg border border-dashed border-gray-300 hover:border-tsp-teal hover:bg-tsp-teal/5 transition-colors text-sm text-gray-600 hover:text-tsp-teal"
              >
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="font-medium">{rt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <Button
          className={`w-full text-white ${isDirty ? 'bg-tsp-teal hover:bg-[#006570]' : 'bg-gray-400 cursor-default'}`}
          onClick={() => bulkSaveMutation.mutate(rules)}
          disabled={isSaving || !isDirty}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          {isDirty ? 'Save Custom Rules' : 'Saved'}
        </Button>
      )}
    </div>
  );
}
