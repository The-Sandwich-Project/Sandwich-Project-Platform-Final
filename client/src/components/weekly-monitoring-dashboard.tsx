import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAnalytics } from '@/hooks/useAnalytics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  RefreshCw,
  Calendar,
  MapPin,
  AlertTriangle,
  FileBarChart,
  Users,
  Info,
  MessageSquare,
  Smartphone,
  Settings,
  Send,
  Download,
  LayoutGrid,
  Minus,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FloatingAIChat } from '@/components/floating-ai-chat';

interface WeeklySubmissionStatus {
  location: string;
  hasSubmitted: boolean;
  lastSubmissionDate?: string;
  missingSince?: string;
  submittedBy?: string[];
  dunwoodyStatus?: {
    lisaHiles: boolean;
    stephanieOrMarcy: boolean;
    complete: boolean;
  };
}

interface MultiWeekReport {
  weekRange: { startDate: Date; endDate: Date };
  weekLabel: string;
  submissionStatus: WeeklySubmissionStatus[];
}

interface ComprehensiveReport {
  reportPeriod: string;
  weeks: MultiWeekReport[];
  summary: {
    totalWeeks: number;
    locationsTracked: string[];
    mostMissing: string[];
    mostReliable: string[];
    overallStats: {
      [location: string]: {
        submitted: number;
        missed: number;
        percentage: number;
      };
    };
  };
}

interface MonitoringStats {
  currentWeek: string;
  totalExpectedLocations: number;
  submittedLocations: number;
  missingLocations: number;
  lastCheckTime: string;
  nextScheduledCheck: string;
}

export default function WeeklyMonitoringDashboard() {
  const queryClient = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState(0); // 0 = current week, 1 = last week, etc.
  const [reportWeeks, setReportWeeks] = useState(4); // Number of weeks for multi-week report
  const [gridWeeks, setGridWeeks] = useState(12); // Number of weeks for the submission grid
  const [showSMSTest, setShowSMSTest] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [showAnnouncementPanel, setShowAnnouncementPanel] = useState(false);
  const [emailingSingleLocation, setEmailingSingleLocation] = useState<
    string | null
  >(null);
  const [smsingLocation, setSmsingLocation] = useState<string | null>(null);
  // Email preview modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTargetLocation, setEmailTargetLocation] = useState<string | null>(
    null
  );
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  // Per-location missed-weeks export dialog
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportLocation, setExportLocation] = useState<string>('');
  const [exportWeeks, setExportWeeks] = useState(27); // ~6 months of completed weeks + current
  const [exportCopied, setExportCopied] = useState(false);
  const { trackReportGeneration, trackCommunication, trackButtonClick} = useAnalytics();

  // Calculate the week date based on selectedWeek
  const getWeekDateString = (weeksAgo: number): string => {
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - (weeksAgo * 7));

    // Get the start of the week (Sunday)
    const dayOfWeek = targetDate.getDay();
    const startOfWeek = new Date(targetDate);
    startOfWeek.setDate(targetDate.getDate() - dayOfWeek);

    // Get the end of the week (Saturday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    return `${formatDate(startOfWeek)} - ${formatDate(endOfWeek)}`;
  };

  // Get monitoring status for selected week
  const {
    data: submissionStatus = [],
    isLoading: statusLoading,
    error: statusError,
  } = useQuery({
    queryKey: ['/api/monitoring/weekly-status', selectedWeek],
    queryFn: () =>
      apiRequest('GET', `/api/monitoring/weekly-status/${selectedWeek}`),
    refetchInterval: selectedWeek === 0 ? 5 * 60 * 1000 : undefined, // Only auto-refresh for current week
  });

  // Get multi-week report
  const { data: multiWeekReport, isLoading: reportLoading } = useQuery({
    queryKey: ['/api/monitoring/multi-week-report', reportWeeks],
    queryFn: () =>
      apiRequest('GET', `/api/monitoring/multi-week-report/${reportWeeks}`),
    enabled: reportWeeks > 0,
  });

  // Get submission grid data for ALL host locations (locations x weeks matrix)
  const { data: gridReport, isLoading: gridLoading } = useQuery({
    queryKey: ['/api/monitoring/grid-report', gridWeeks],
    queryFn: () =>
      apiRequest('GET', `/api/monitoring/grid-report/${gridWeeks}`),
    enabled: gridWeeks > 0,
  });

  // Get monitoring statistics
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/monitoring/stats'],
    queryFn: () => apiRequest('GET', '/api/monitoring/stats'),
    refetchInterval: 5 * 60 * 1000,
  });

  // Manual check mutation for current week
  const manualCheckMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/monitoring/check-now'),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/monitoring/weekly-status'],
      });
      queryClient.invalidateQueries({ queryKey: ['/api/monitoring/stats'] });
    },
  });

  // Check specific week mutation
  const checkWeekMutation = useMutation({
    mutationFn: (weeksAgo: number) =>
      apiRequest('POST', `/api/monitoring/check-week/${weeksAgo}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/monitoring/weekly-status'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/monitoring/multi-week-report'],
      });
    },
  });

  // SMS mutations
  const sendSMSRemindersMutation = useMutation({
    mutationFn: (data: { missingLocations: string[]; appUrl?: string }) =>
      apiRequest('POST', '/api/monitoring/send-sms-reminders', data),
    onSuccess: (data, variables) => {
      trackCommunication('sms', `bulk - ${variables.missingLocations.length} locations`);
    },
  });

  const sendSingleSMSMutation = useMutation({
    mutationFn: (data: { location: string; appUrl?: string }) =>
      apiRequest(
        'POST',
        `/api/monitoring/send-sms-reminder?location=${encodeURIComponent(
          data.location
        )}`,
        { appUrl: data.appUrl }
      ),
    onMutate: (data) => {
      setSmsingLocation(data.location);
    },
    onSuccess: (data, variables) => {
      trackCommunication('sms', variables.location);
    },
    onSettled: () => {
      setSmsingLocation(null);
    },
  });

  const testSMSMutation = useMutation({
    mutationFn: (data: { phoneNumber: string; appUrl?: string }) =>
      apiRequest('POST', '/api/monitoring/test-sms', data),
  });

  // ---- Per-location missed-weeks export ----
  // Fetch the grid data for the chosen lookback only while the export dialog
  // is open. The grid endpoint already skips weeks before a host existed and
  // applies the Dunwoody 2-log rule, so "missing" here matches the grid.
  const { data: exportGrid, isLoading: exportGridLoading } = useQuery({
    queryKey: ['/api/monitoring/grid-report', exportWeeks],
    queryFn: () =>
      apiRequest('GET', `/api/monitoring/grid-report/${exportWeeks}`),
    enabled: showExportDialog,
  });

  // Week start dates come back as ISO strings for a Wednesday at local
  // midnight on the server. Use the date portion so the browser's timezone
  // can't shift it back to Tuesday.
  const weekStartDate = (w: MultiWeekReport): Date => {
    const iso = String(w.weekRange.startDate).slice(0, 10);
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const formatLongDate = (d: Date) =>
    d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const exportLocations: string[] = React.useMemo(() => {
    const weeks: MultiWeekReport[] = exportGrid?.weeks ?? [];
    const set = new Set<string>();
    weeks.forEach((w) =>
      (w.submissionStatus ?? []).forEach((s) => set.add(s.location))
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [exportGrid]);

  // Completed weeks only — the current week (index 0) is still in progress,
  // so it would be unfair to list it as missed.
  const exportSummary = React.useMemo(() => {
    if (!exportLocation || !exportGrid?.weeks) return null;
    const weeks: MultiWeekReport[] = exportGrid.weeks;
    const missed: { start: Date; end: Date }[] = [];
    let applicable = 0;
    let lastSubmission: string | undefined;
    weeks.forEach((w, i) => {
      const status = (w.submissionStatus ?? []).find(
        (s) => s.location === exportLocation
      );
      if (status?.lastSubmissionDate && !lastSubmission) {
        lastSubmission = status.lastSubmissionDate; // weeks are newest-first
      }
      if (i === 0 || !status) return; // in-progress week, or host didn't exist yet
      applicable++;
      if (!status.hasSubmitted) {
        const start = weekStartDate(w);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        missed.push({ start, end });
      }
    });
    missed.reverse(); // oldest first reads better in a list
    return { missed, applicable, lastSubmission };
  }, [exportLocation, exportGrid]);

  const exportPeriodLabel =
    exportWeeks === 14 ? '3 months' : exportWeeks === 27 ? '6 months' : '12 months';

  const buildMissedWeeksText = () => {
    if (!exportSummary || !exportLocation) return '';
    const { missed, applicable } = exportSummary;
    if (missed.length === 0) {
      return `Great news — we have a collection log from ${exportLocation} for every week in the last ${exportPeriodLabel} (${applicable} weeks). Thank you!`;
    }
    const lines = missed
      .map((m) => `• Week of ${formatLongDate(m.start)}`)
      .join('\n');
    return `Hi ${exportLocation} team,\n\nWe're catching up on our records and are missing sandwich counts from your location for the following ${missed.length === 1 ? 'week' : `${missed.length} weeks`} in the last ${exportPeriodLabel}:\n\n${lines}\n\nEach "week" runs Wednesday through the following Tuesday. If you collected those weeks, could you send us the counts (or log them in the app)? If you didn't collect, just let us know so we can mark it.\n\nThank you!\nThe Sandwich Project`;
  };

  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const downloadMissedWeeksReport = () => {
    if (!exportSummary || !exportLocation) return;
    const { missed, applicable, lastSubmission } = exportSummary;
    const loc = escapeHtml(exportLocation);
    const generated = new Date();
    const submitted = applicable - missed.length;

    trackReportGeneration('location_missed_weeks_report', 'html');

    const rows = missed
      .map(
        (m, idx) => `
          <tr>
            <td class="num">${idx + 1}</td>
            <td>Week of <strong>${formatLongDate(m.start)}</strong></td>
            <td class="muted">${m.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${m.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          </tr>`
      )
      .join('');

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Missing Weeks – ${loc}</title>
  <style>
    body { font-family: 'Roboto','Segoe UI',Tahoma,sans-serif; max-width: 760px; margin: 0 auto; padding: 40px 20px; background: #f9fafb; color: #1f2937; }
    .header { padding: 28px 30px; background: linear-gradient(135deg,#236383 0%,#007E8C 100%); color: #fff; border-radius: 12px; margin-bottom: 28px; }
    .header h1 { margin: 0 0 6px; font-size: 1.9em; }
    .header p { margin: 0; opacity: .9; }
    .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 28px; }
    .stat { background: #fff; border-radius: 10px; padding: 18px; text-align: center; border-left: 4px solid #236383; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
    .stat.bad { border-left-color: #dc2626; } .stat.good { border-left-color: #16a34a; }
    .stat .n { font-size: 2em; font-weight: 800; line-height: 1; }
    .stat .l { color: #6b7280; margin-top: 6px; font-size: .9em; }
    .section { background: #fff; border-radius: 12px; padding: 26px; box-shadow: 0 1px 3px rgba(0,0,0,.05); margin-bottom: 24px; }
    .section h2 { margin: 0 0 14px; color: #236383; font-size: 1.3em; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 10px 8px; border-bottom: 1px solid #f3f4f6; }
    td.num { width: 32px; color: #9ca3af; }
    .muted { color: #6b7280; font-size: .9em; }
    .good-box { text-align: center; padding: 30px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; color: #166534; font-size: 1.1em; }
    .note { color: #4b5563; font-size: .95em; line-height: 1.5; }
    .footer { text-align: center; color: #6b7280; margin-top: 30px; font-size: .9em; }
    @media print { body { background: #fff; padding: 0; } .header { background: #236383; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${loc}</h1>
    <p>Missing collection logs • Last ${exportPeriodLabel} • Generated ${generated.toLocaleDateString()}</p>
  </div>
  <div class="stats">
    <div class="stat"><div class="n">${applicable}</div><div class="l">Weeks checked</div></div>
    <div class="stat good"><div class="n">${submitted}</div><div class="l">Weeks logged</div></div>
    <div class="stat bad"><div class="n">${missed.length}</div><div class="l">Weeks missing</div></div>
  </div>
  <div class="section">
    <h2>Weeks we don't have counts for</h2>
    ${
      missed.length === 0
        ? '<div class="good-box">🎉 Every week in this period has a collection log. Thank you!</div>'
        : `<table>${rows}</table>`
    }
  </div>
  <div class="section note">
    <strong>How weeks are counted:</strong> each week runs Wednesday through the following Tuesday.
    The current (in-progress) week isn't included.${
      lastSubmission
        ? ` Most recent log on file: <strong>${formatLongDate(new Date(lastSubmission + 'T12:00:00'))}</strong>.`
        : ''
    }
    <br><br>If you collected during any of these weeks, please send us your counts or log them in the app. If you didn't collect, just let us know so we can mark it.
  </div>
  <div class="footer"><strong>The Sandwich Project</strong></div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = exportLocation.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    link.download = `Missing-Weeks-${safeName}-${generated.toISOString().split('T')[0]}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyMissedWeeksText = async () => {
    try {
      await navigator.clipboard.writeText(buildMissedWeeksText());
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); nothing else to do.
    }
  };

  // SMS announcement mutation
  const sendAnnouncementMutation = useMutation({
    mutationFn: (data: { testMode?: boolean; testEmail?: string }) =>
      apiRequest('POST', '/api/sms-announcement/send-sms-announcement', data),
  });

  // Get SMS configuration status
  const { data: smsConfig } = useQuery({
    queryKey: ['/api/monitoring/sms-config'],
    queryFn: () => apiRequest('GET', '/api/monitoring/sms-config'),
  });

  // Send test email mutation
  const testEmailMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/monitoring/test-email'),
  });

  // Email reminder mutations
  const sendSingleEmailMutation = useMutation({
    mutationFn: (data: { location: string; appUrl?: string; subject?: string; body?: string }) =>
      apiRequest(
        'POST',
        `/api/monitoring/send-email-reminder?location=${encodeURIComponent(
          data.location
        )}`,
        { appUrl: data.appUrl, subject: data.subject, body: data.body }
      ),
    onMutate: (data) => {
      setEmailingSingleLocation(data.location);
    },
    onSuccess: (data, variables) => {
      trackCommunication('email', variables.location);
    },
    onSettled: () => {
      setEmailingSingleLocation(null);
    },
  });

  const getStatusColor = (hasSubmitted: boolean) => {
    return hasSubmitted
      ? 'bg-green-100 text-green-800 border-green-200'
      : 'bg-red-100 text-red-800 border-red-200';
  };

  const getStatusIcon = (hasSubmitted: boolean) => {
    return hasSubmitted ? (
      <CheckCircle className="h-4 w-4" />
    ) : (
      <XCircle className="h-4 w-4" />
    );
  };

  const getWeekLabel = (weeksAgo: number) => {
    if (weeksAgo === 0) return 'This Week';
    if (weeksAgo === 1) return 'Last Week';
    return `${weeksAgo} Weeks Ago`;
  };

  const getDunwoodyBadge = (status: WeeklySubmissionStatus) => {
    if (status.location !== 'Dunwoody/PTC' || !status.dunwoodyStatus)
      return null;

    const { complete } = status.dunwoodyStatus;

    if (complete) {
      return (
        <Badge className="bg-green-100 text-green-800 text-xs ml-2">
          Both Required ✓
        </Badge>
      );
    }

    // If not complete, show that we need 2+ collection logs with individual counts
    return (
      <Badge className="bg-orange-100 text-orange-800 text-xs ml-2">
        Need 2+ collection logs with individual counts
      </Badge>
    );
  };

  if (statusError) {
    return (
      <div className="max-w-6xl mx-auto p-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Failed to load monitoring data. Please check your connection and try
            again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-2 sm:p-4 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-brand-primary flex-shrink-0" />
            <span className="truncate">Weekly Submission Monitoring</span>
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            Track which host locations submit their sandwich counts each week
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-2">
          <Button
            onClick={() => setShowExportDialog(true)}
            variant="outline"
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 h-8 sm:h-9 text-purple-700 border-purple-200 hover:bg-purple-50"
          >
            <Download className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden lg:inline">Location Export</span>
            <span className="lg:hidden">Export</span>
          </Button>

          <Button
            onClick={() => testEmailMutation.mutate()}
            variant="outline"
            disabled={testEmailMutation.isPending}
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 h-8 sm:h-9"
          >
            <Mail className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">
              {testEmailMutation.isPending ? 'Sending...' : 'Test Email'}
            </span>
            <span className="sm:hidden">
              {testEmailMutation.isPending ? 'Send...' : 'Email'}
            </span>
          </Button>

          {smsConfig?.isConfigured && (
            <Button
              onClick={() => {
                const missingLocations = submissionStatus
                  .filter((s: WeeklySubmissionStatus) => !s.hasSubmitted)
                  .map((s: WeeklySubmissionStatus) => s.location);
                if (missingLocations.length > 0) {
                  sendSMSRemindersMutation.mutate({
                    missingLocations,
                    appUrl: window.location.origin,
                  });
                }
              }}
              variant="outline"
              disabled={
                sendSMSRemindersMutation.isPending ||
                !submissionStatus.some((s: WeeklySubmissionStatus) => !s.hasSubmitted)
              }
              className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm text-green-700 border-green-200 hover:bg-green-50 px-2 sm:px-3 py-1 sm:py-2 h-8 sm:h-9"
            >
              <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden lg:inline">
                {sendSMSRemindersMutation.isPending
                  ? 'Sending SMS...'
                  : 'Send SMS Reminders'}
              </span>
              <span className="lg:hidden">
                {sendSMSRemindersMutation.isPending ? 'SMS...' : 'SMS All'}
              </span>
            </Button>
          )}

          <Button
            onClick={() => setShowSMSTest(!showSMSTest)}
            variant="outline"
            disabled={!smsConfig?.isConfigured}
            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 h-8 sm:h-9"
          >
            <Smartphone className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Test SMS</span>
            <span className="sm:hidden">Test</span>
          </Button>

          <Button
            onClick={() => setShowAnnouncementPanel(!showAnnouncementPanel)}
            variant="outline"
            className="hidden sm:flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 h-8 sm:h-9"
          >
            <Send className="h-3 w-3 sm:h-4 sm:w-4" />
            <span>SMS Announcement</span>
          </Button>

          <Button
            onClick={() =>
              selectedWeek === 0
                ? manualCheckMutation.mutate()
                : checkWeekMutation.mutate(selectedWeek)
            }
            disabled={
              manualCheckMutation.isPending || checkWeekMutation.isPending
            }
            className="flex items-center gap-1 sm:gap-2 bg-brand-primary hover:bg-brand-primary-dark text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 h-8 sm:h-9"
          >
            <RefreshCw
              className={`h-3 w-3 sm:h-4 sm:w-4 ${
                manualCheckMutation.isPending || checkWeekMutation.isPending
                  ? 'animate-spin'
                  : ''
              }`}
            />
            <span className="hidden lg:inline">
              {manualCheckMutation.isPending || checkWeekMutation.isPending
                ? 'Checking...'
                : `Check ${getWeekLabel(selectedWeek)}`}
            </span>
            <span className="lg:hidden">
              {manualCheckMutation.isPending || checkWeekMutation.isPending
                ? 'Check...'
                : 'Check'}
            </span>
          </Button>
        </div>
      </div>

      {/* Week Selection */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Select Week to Monitor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Week:</label>
              <Select
                value={selectedWeek.toString()}
                onValueChange={(value) => setSelectedWeek(parseInt(value))}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">This Week (Current)</SelectItem>
                  <SelectItem value="1">Last Week</SelectItem>
                  <SelectItem value="2">2 Weeks Ago</SelectItem>
                  <SelectItem value="3">3 Weeks Ago</SelectItem>
                  <SelectItem value="4">4 Weeks Ago</SelectItem>
                  <SelectItem value="5">5 Weeks Ago</SelectItem>
                  <SelectItem value="6">6 Weeks Ago</SelectItem>
                  <SelectItem value="7">7 Weeks Ago</SelectItem>
                  <SelectItem value="8">8 Weeks Ago</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-gray-600">
              Currently viewing: <strong>{getWeekLabel(selectedWeek)}</strong>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-teal-600" />
                <div>
                  <p className="text-sm text-gray-600">
                    {selectedWeek === 0 ? 'Current Week' : `${selectedWeek} Week${selectedWeek > 1 ? 's' : ''} Ago`}
                  </p>
                  <p className="text-lg font-semibold">{getWeekDateString(selectedWeek)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm text-gray-600">Submitted</p>
                  <p className="text-lg font-semibold">
                    {stats.submittedLocations}/{stats.totalExpectedLocations}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-600" />
                <div>
                  <p className="text-sm text-gray-600">Missing</p>
                  <p className="text-lg font-semibold">
                    {stats.missingLocations}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-teal-600" />
                <div>
                  <p className="text-sm text-gray-600">Next Check</p>
                  <p className="text-sm font-semibold">
                    {stats.nextScheduledCheck}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Monitoring Schedule Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Automated Monitoring Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium text-gray-900">Email Alerts Sent:</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Thursday evenings at 7:00 PM</li>
                <li>• Friday mornings at 8:00 AM</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-gray-900">Alert Details:</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Shows missing locations</li>
                <li>• Lists locations that have submitted</li>
                <li>• Sent to: katielong2316@gmail.com</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SMS Test Panel */}
      {showSMSTest && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Test SMS Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {smsConfig?.isConfigured ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm">
                      SMS service is configured and ready
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      placeholder="Phone number (e.g., +1234567890)"
                      value={testPhoneNumber}
                      onChange={(e) => setTestPhoneNumber(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <Button
                      onClick={() =>
                        testSMSMutation.mutate({
                          phoneNumber: testPhoneNumber,
                          appUrl: window.location.origin,
                        })
                      }
                      disabled={testSMSMutation.isPending || !testPhoneNumber}
                      className="flex items-center gap-2"
                    >
                      <MessageSquare className="h-4 w-4" />
                      {testSMSMutation.isPending
                        ? 'Sending...'
                        : 'Send Test SMS'}
                    </Button>
                  </div>
                  {testSMSMutation.isSuccess && (
                    <Alert>
                      <CheckCircle className="h-4 w-4" />
                      <AlertDescription>
                        Test SMS sent successfully!
                      </AlertDescription>
                    </Alert>
                  )}
                  {testSMSMutation.isError && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Failed to send test SMS. Check your phone number format
                        and Twilio configuration.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-orange-700">
                    <Settings className="h-4 w-4" />
                    <span className="text-sm">
                      SMS service requires configuration
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>Missing environment variables:</p>
                    <ul className="list-disc list-inside mt-1">
                      {smsConfig?.missingItems?.map((item: string) => (
                        <li key={item} className="font-mono text-xs">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* SMS Announcement Panel */}
      {showAnnouncementPanel && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Send SMS Capability Announcement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-teal-50 p-4 rounded-lg">
                <h4 className="font-medium text-teal-900 mb-2">
                  What this announcement does:
                </h4>
                <ul className="text-sm text-teal-800 space-y-1">
                  <li>• Sends an email to all registered app users</li>
                  <li>• Explains the new SMS reminder feature</li>
                  <li>
                    • Includes a link for users to opt-in to SMS notifications
                  </li>
                  <li>• Emphasizes that SMS is completely voluntary</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() =>
                    sendAnnouncementMutation.mutate({ testMode: true })
                  }
                  variant="outline"
                  disabled={sendAnnouncementMutation.isPending}
                  className="flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" />
                  {sendAnnouncementMutation.isPending
                    ? 'Sending...'
                    : 'Send Test (to yourself)'}
                </Button>

                <Button
                  onClick={() => {
                    if (
                      confirm(
                        'Send SMS announcement to ALL registered users? This cannot be undone.'
                      )
                    ) {
                      sendAnnouncementMutation.mutate({ testMode: false });
                    }
                  }}
                  disabled={sendAnnouncementMutation.isPending}
                  className="flex items-center gap-2 bg-brand-primary hover:bg-brand-primary-dark"
                >
                  <Send className="h-4 w-4" />
                  {sendAnnouncementMutation.isPending
                    ? 'Sending...'
                    : 'Send to All Users'}
                </Button>
              </div>

              {sendAnnouncementMutation.isSuccess && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    {sendAnnouncementMutation.data?.message}
                    {sendAnnouncementMutation.data?.smsOptInUrl && (
                      <div className="mt-2">
                        <span className="font-medium">Opt-in URL: </span>
                        <a
                          href={sendAnnouncementMutation.data.smsOptInUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal-600 hover:underline"
                        >
                          {sendAnnouncementMutation.data.smsOptInUrl}
                        </a>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {sendAnnouncementMutation.isError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Failed to send announcement. Please try again.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content - Tabs for different views */}
      <Tabs defaultValue="weekly" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="weekly" className="flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            <span className="hidden sm:inline">Weekly Status</span>
            <span className="sm:hidden">Weekly</span>
          </TabsTrigger>
          <TabsTrigger value="grid" className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4" />
            <span className="hidden sm:inline">Submission Grid</span>
            <span className="sm:hidden">Grid</span>
          </TabsTrigger>
          <TabsTrigger value="report" className="flex items-center gap-2">
            <FileBarChart className="w-4 h-4" />
            <span className="hidden sm:inline">Multi-Week Report</span>
            <span className="sm:hidden">Report</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="mt-6">
          {/* Current Week Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Host Location Status - {getWeekLabel(selectedWeek)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statusLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">
                    Loading submission status...
                  </span>
                </div>
              ) : statusError ? (
                <div className="text-center py-8 text-red-500">
                  Error loading submission data: {(statusError as Error)?.message || String(statusError)}
                </div>
              ) : Array.isArray(submissionStatus) &&
                submissionStatus.length > 0 ? (
                <div className="grid gap-3">
                  {submissionStatus.map((status: WeeklySubmissionStatus) => (
                    <div
                      key={status.location}
                      className="flex flex-col p-3 sm:p-4 rounded-lg border bg-white hover:shadow-sm transition-shadow gap-2"
                    >
                      {/* Top row: Status icon + Location name */}
                      <div className="flex items-start gap-2 min-w-0">
                        <div
                          className={`flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full flex-shrink-0 ${
                            status.hasSubmitted ? 'bg-green-100' : 'bg-red-100'
                          }`}
                        >
                          {getStatusIcon(status.hasSubmitted)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <h4 className="font-medium text-gray-900 text-sm sm:text-base break-words">
                              {status.location}
                            </h4>
                            {getDunwoodyBadge(status)}
                          </div>
                          {status.lastSubmissionDate && (
                            <p className="text-xs sm:text-sm text-gray-600">
                              Last: {(() => {
                                const dateStr = status.lastSubmissionDate;
                                if (dateStr.includes('-')) {
                                  const [year, month, day] = dateStr
                                    .split('-')
                                    .map(Number);
                                  const date = new Date(year, month - 1, day);
                                  return date.toLocaleDateString();
                                }
                                return new Date(dateStr).toLocaleDateString();
                              })()}
                            </p>
                          )}
                          {status.submittedBy &&
                            status.submittedBy.length > 0 && (
                              <p className="text-xs text-gray-500 break-words">
                                By: {status.submittedBy.join(', ')}
                              </p>
                            )}
                        </div>
                      </div>

                      {/* Bottom row: Badge + Action buttons */}
                      <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-10">
                        <Badge
                          className={`${getStatusColor(
                            status.hasSubmitted
                          )} flex items-center gap-1 text-xs`}
                        >
                          {getStatusIcon(status.hasSubmitted)}
                          {status.hasSubmitted ? 'Submitted' : 'Missing'}
                        </Badge>

                        {!status.hasSubmitted && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                sendSingleEmailMutation.mutate({
                                  location: status.location,
                                  appUrl: window.location.origin,
                                })
                              }
                              disabled={
                                emailingSingleLocation === status.location
                              }
                              className="flex items-center gap-1 text-xs px-2 py-1 h-7 text-teal-600 border-teal-200 hover:bg-teal-50"
                            >
                              <Mail className="h-3 w-3" />
                              {emailingSingleLocation === status.location
                                ? '...'
                                : 'Email'}
                            </Button>

                            {smsConfig?.isConfigured && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  sendSingleSMSMutation.mutate({
                                    location: status.location,
                                    appUrl: window.location.origin,
                                  })
                                }
                                disabled={smsingLocation === status.location}
                                className="flex items-center gap-1 text-xs px-2 py-1 h-7"
                              >
                                <MessageSquare className="h-3 w-3" />
                                {smsingLocation === status.location
                                  ? '...'
                                  : 'SMS'}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No submission data available for this week. (Data:{' '}
                  {JSON.stringify(submissionStatus)})
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="grid" className="mt-6">
          {/* Submission Grid: all locations (rows) x weeks (columns) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LayoutGrid className="h-5 w-5" />
                Submission Grid — All Locations × Weeks
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Each row is a host location; each column is a week (most recent
                on the left). A green check means a collection log was submitted
                for that week.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <label className="text-sm font-medium">Weeks to show:</label>
                <Select
                  value={gridWeeks.toString()}
                  onValueChange={(value) => setGridWeeks(parseInt(value))}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 weeks</SelectItem>
                    <SelectItem value="8">8 weeks</SelectItem>
                    <SelectItem value="12">12 weeks</SelectItem>
                    <SelectItem value="26">26 weeks</SelectItem>
                    <SelectItem value="52">52 weeks</SelectItem>
                  </SelectContent>
                </Select>
                <div className="hidden sm:flex items-center gap-4 ml-auto text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-600" /> Submitted
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-red-400" /> Missing
                  </span>
                </div>
              </div>

              {gridLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">
                    Loading submission grid...
                  </span>
                </div>
              ) : gridReport &&
                Array.isArray(gridReport.weeks) &&
                gridReport.weeks.length > 0 ? (
                (() => {
                  // weeks come back most-recent-first (index 0 = this week)
                  const weeks: MultiWeekReport[] = gridReport.weeks;
                  const locations: string[] =
                    weeks[0]?.submissionStatus?.map((s) => s.location) ?? [];

                  const formatWeek = (w: MultiWeekReport) => {
                    const d = new Date(w.weekRange.startDate);
                    return d.toLocaleDateString('en-US', {
                      month: 'numeric',
                      day: 'numeric',
                    });
                  };
                  // Index each week's statuses by location once, so cell
                  // lookups are O(1) instead of a linear find per cell.
                  const weekMaps = weeks.map((w) => {
                    const m = new Map<string, WeeklySubmissionStatus>();
                    (w.submissionStatus ?? []).forEach((s) =>
                      m.set(s.location, s)
                    );
                    return m;
                  });
                  const statusAt = (loc: string, i: number) =>
                    weekMaps[i].get(loc);

                  return (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="sticky left-0 z-10 bg-gray-50 text-left font-medium text-gray-700 px-3 py-2 border-b border-r min-w-[150px]">
                              Location
                            </th>
                            {weeks.map((w, i) => (
                              <th
                                key={i}
                                className="px-2 py-2 border-b text-center font-medium text-gray-600 whitespace-nowrap"
                                title={w.weekLabel}
                              >
                                <div>{formatWeek(w)}</div>
                                <div className="text-[10px] font-normal text-gray-400">
                                  {i === 0
                                    ? 'This wk'
                                    : i === 1
                                    ? 'Last wk'
                                    : `${i}w ago`}
                                </div>
                              </th>
                            ))}
                            <th className="px-3 py-2 border-b border-l text-center font-medium text-gray-700 whitespace-nowrap">
                              Rate
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {locations.map((loc) => {
                            // Only count weeks where this host has data (i.e.
                            // weeks on/after it existed); weeks with no status
                            // row are excluded from the rate denominator.
                            const applicableCount = weeks.filter((_, i) =>
                              weekMaps[i].has(loc)
                            ).length;
                            const submittedCount = weeks.filter(
                              (_, i) => statusAt(loc, i)?.hasSubmitted
                            ).length;
                            const pct =
                              applicableCount > 0
                                ? Math.round(
                                    (submittedCount / applicableCount) * 100
                                  )
                                : 0;
                            return (
                              <tr key={loc} className="hover:bg-gray-50">
                                <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-r font-medium text-gray-800 min-w-[150px]">
                                  {loc}
                                </td>
                                {weeks.map((w, i) => {
                                  const s = statusAt(loc, i);
                                  return (
                                    <td
                                      key={i}
                                      className="px-2 py-2 border-b text-center"
                                    >
                                      {s ? (
                                        s.hasSubmitted ? (
                                          <CheckCircle className="h-4 w-4 text-green-600 inline" />
                                        ) : (
                                          <XCircle className="h-4 w-4 text-red-400 inline" />
                                        )
                                      ) : (
                                        <Minus className="h-4 w-4 text-gray-300 inline" />
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-2 border-b border-l text-center">
                                  <Badge
                                    className={
                                      pct >= 75
                                        ? 'bg-green-100 text-green-800'
                                        : pct >= 40
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-red-100 text-red-800'
                                    }
                                  >
                                    {submittedCount}/{applicableCount}
                                  </Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No submission grid data available.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="report" className="mt-6">
          {/* Multi-Week Report */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileBarChart className="h-5 w-5" />
                  Multi-Week Report Configuration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">
                      Number of weeks to analyze:
                    </label>
                    <Select
                      value={reportWeeks.toString()}
                      onValueChange={(value) => setReportWeeks(parseInt(value))}
                    >
                      <SelectTrigger className="w-[150px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2">2 weeks</SelectItem>
                        <SelectItem value="3">3 weeks</SelectItem>
                        <SelectItem value="4">4 weeks</SelectItem>
                        <SelectItem value="6">6 weeks</SelectItem>
                        <SelectItem value="8">8 weeks</SelectItem>
                        <SelectItem value="12">12 weeks</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {reportLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">
                  Loading multi-week report...
                </span>
              </div>
            ) : multiWeekReport &&
              multiWeekReport.weeks &&
              multiWeekReport.summary ? (
              <>
                {/* Summary Statistics */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Summary Statistics ({multiWeekReport.reportPeriod})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <h4 className="font-medium text-green-700">
                          Most Reliable (≥75%)
                        </h4>
                        <div className="space-y-1">
                          {multiWeekReport.summary.mostReliable &&
                          multiWeekReport.summary.mostReliable.map ? (
                            multiWeekReport.summary.mostReliable.map(
                              (location: string) => (
                                <div
                                  key={location}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                  <span>{location}</span>
                                  <Badge className="bg-green-100 text-green-800 text-xs">
                                    {
                                      multiWeekReport.summary.overallStats[
                                        location
                                      ]?.percentage
                                    }
                                    %
                                  </Badge>
                                </div>
                              )
                            )
                          ) : (
                            <div className="text-sm text-gray-500">
                              No data available
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-medium text-red-700">
                          Most Missing
                        </h4>
                        <div className="space-y-1">
                          {multiWeekReport.summary.mostMissing &&
                          multiWeekReport.summary.mostMissing.map ? (
                            multiWeekReport.summary.mostMissing.map(
                              (location: string) => (
                                <div
                                  key={location}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <XCircle className="h-4 w-4 text-red-600" />
                                  <span>{location}</span>
                                  <Badge className="bg-red-100 text-red-800 text-xs">
                                    {
                                      multiWeekReport.summary.overallStats[
                                        location
                                      ]?.missed
                                    }{' '}
                                    missed
                                  </Badge>
                                </div>
                              )
                            )
                          ) : (
                            <div className="text-sm text-gray-500">
                              No data available
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-medium text-gray-700">
                          Overall Stats
                        </h4>
                        <div className="text-sm space-y-1">
                          <p>
                            Total weeks analyzed:{' '}
                            {multiWeekReport.summary.totalWeeks || 0}
                          </p>
                          <p>
                            Locations tracked:{' '}
                            {multiWeekReport.summary.locationsTracked?.length ||
                              0}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Week-by-Week Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Week-by-Week Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {multiWeekReport.weeks && multiWeekReport.weeks.map ? (
                        multiWeekReport.weeks.map(
                          (week: MultiWeekReport, index: number) => (
                            <div key={index} className="border rounded-lg p-4">
                              <h4 className="font-medium mb-3">
                                {week.weekLabel}
                              </h4>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {week.submissionStatus &&
                                week.submissionStatus.map ? (
                                  week.submissionStatus.map((status: WeeklySubmissionStatus) => (
                                    <div
                                      key={status.location}
                                      className={`p-2 rounded text-sm flex items-center gap-2 ${
                                        status.hasSubmitted
                                          ? 'bg-green-50 text-green-800 border border-green-200'
                                          : 'bg-red-50 text-red-800 border border-red-200'
                                      }`}
                                    >
                                      {getStatusIcon(status.hasSubmitted)}
                                      <span className="truncate">
                                        {status.location}
                                      </span>
                                      {status.location === 'Dunwoody/PTC' &&
                                        status.dunwoodyStatus && (
                                          <div className="text-xs">
                                            {status.dunwoodyStatus.complete
                                              ? '✓✓'
                                              : '✗'}
                                          </div>
                                        )}
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-sm text-gray-500">
                                    No submission data for this week
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        )
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          No weekly data available
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No multi-week report data available.
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Expected Locations */}
      <Card>
        <CardHeader>
          <CardTitle>Expected Weekly Locations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              These are the active host locations tracked for weekly
              submissions. A location is removed automatically when its host is
              marked inactive in Host Management.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(Array.isArray(submissionStatus)
                ? submissionStatus.map(
                    (s: WeeklySubmissionStatus) => s.location
                  )
                : []
              ).map((location: string) => (
                <div
                  key={location}
                  className={`p-2 rounded-lg text-sm text-center ${
                    location === 'Dunwoody/PTC'
                      ? 'bg-teal-50 border border-teal-200 text-teal-800'
                      : 'bg-teal-50/50 border border-teal-100 text-teal-600'
                  }`}
                >
                  {location}
                  {location === 'Dunwoody/PTC' && (
                    <Info className="h-3 w-3 inline ml-1" />
                  )}
                </div>
              ))}
            </div>
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
              <h4 className="font-medium text-teal-800 flex items-center gap-2">
                <Info className="h-4 w-4" />
                Dunwoody/PTC Submission Process
              </h4>
              <p className="text-sm text-teal-700 mt-1">
                Dunwoody operates with two separate data sources:
              </p>
              <ul className="text-sm text-teal-700 mt-2 space-y-1">
                <li>
                  • <strong>Lisa Hiles</strong> entry
                </li>
                <li>
                  • <strong>Stephanie OR Marcy</strong> entry
                </li>
              </ul>
              <p className="text-xs text-teal-600 mt-2">
                Both entries are needed for complete weekly data from this
                location.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Success/Error Messages */}
      {manualCheckMutation.isSuccess && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            Manual check completed successfully! Status updated.
          </AlertDescription>
        </Alert>
      )}

      {testEmailMutation.isSuccess && (
        <Alert>
          <Mail className="h-4 w-4" />
          <AlertDescription>
            Test email sent successfully to katielong2316@gmail.com
          </AlertDescription>
        </Alert>
      )}

      {(manualCheckMutation.isError ||
        testEmailMutation.isError ||
        checkWeekMutation.isError ||
        sendSMSRemindersMutation.isError ||
        sendSingleSMSMutation.isError) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Operation failed. Please try again or check system logs.
          </AlertDescription>
        </Alert>
      )}

      {checkWeekMutation.isSuccess && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            Week check completed! {checkWeekMutation.data?.missingCount || 0}{' '}
            locations missing.
          </AlertDescription>
        </Alert>
      )}

      {sendSMSRemindersMutation.isSuccess && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            {sendSMSRemindersMutation.data?.message}
          </AlertDescription>
        </Alert>
      )}

      {sendSingleSMSMutation.isSuccess && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>SMS reminder sent successfully!</AlertDescription>
        </Alert>
      )}
      <Dialog open={showEmailModal} onOpenChange={setShowEmailModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Send email reminder
              {emailTargetLocation ? ` — ${emailTargetLocation}` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-body">Body</Label>
              <Textarea
                id="email-body"
                rows={10}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowEmailModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!emailTargetLocation) return;
                sendSingleEmailMutation.mutate({
                  location: emailTargetLocation,
                  appUrl: window.location.origin,
                  subject: emailSubject,
                  body: emailBody,
                });
                setShowEmailModal(false);
              }}
              disabled={sendSingleEmailMutation.isPending}
              className="bg-brand-primary hover:bg-brand-primary-dark"
            >
              {sendSingleEmailMutation.isPending ? 'Sending...' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-location missed-weeks export */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Export missing weeks for a location</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Location</Label>
                <Select
                  value={exportLocation}
                  onValueChange={setExportLocation}
                  disabled={exportGridLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        exportGridLoading ? 'Loading…' : 'Choose a location'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {exportLocations.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Look back</Label>
                <Select
                  value={String(exportWeeks)}
                  onValueChange={(v) => setExportWeeks(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="14">Last 3 months</SelectItem>
                    <SelectItem value="27">Last 6 months</SelectItem>
                    <SelectItem value="52">Last 12 months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {exportGridLoading && exportLocation ? (
              <div className="flex items-center text-sm text-gray-600">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading…
              </div>
            ) : exportSummary ? (
              <div className="rounded-lg border bg-gray-50 p-3 text-sm">
                {exportSummary.missed.length === 0 ? (
                  <p className="text-green-700 font-medium">
                    No missing weeks — logged all {exportSummary.applicable}{' '}
                    completed weeks.
                  </p>
                ) : (
                  <>
                    <p className="font-medium text-red-700 mb-2">
                      Missing {exportSummary.missed.length} of{' '}
                      {exportSummary.applicable} completed weeks
                    </p>
                    <ul className="max-h-48 overflow-y-auto space-y-1 text-gray-700">
                      {exportSummary.missed.map((m) => (
                        <li key={m.start.toISOString()}>
                          Week of {formatLongDate(m.start)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Weeks run Wed–Tue. The current week isn&apos;t counted yet.
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={copyMissedWeeksText}
              disabled={!exportSummary}
            >
              {exportCopied ? 'Copied!' : 'Copy as email text'}
            </Button>
            <Button
              onClick={downloadMissedWeeksReport}
              disabled={!exportSummary}
              className="bg-brand-primary hover:bg-brand-primary-dark"
            >
              <Download className="h-4 w-4 mr-2" />
              Download report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Assistant */}
      <FloatingAIChat
        contextType="collections"
        title="Monitoring Assistant"
        subtitle="Ask about weekly submissions"
        contextData={{
          currentView: 'weekly-monitoring',
          filters: {
            selectedWeek,
          },
          summaryStats: {
            totalLocations: stats?.totalExpectedLocations || 0,
            submittedLocations: stats?.submittedLocations || 0,
            missingLocations: stats?.missingLocations || 0,
            currentWeek: stats?.currentWeek || '',
            submissionRate: stats?.totalExpectedLocations
              ? Math.round((stats.submittedLocations / stats.totalExpectedLocations) * 100)
              : 0,
          },
        }}
        getFullContext={() => ({
          rawData: Array.isArray(submissionStatus) ? submissionStatus.map((s: WeeklySubmissionStatus) => ({
            location: s.location,
            hasSubmitted: s.hasSubmitted,
            lastSubmissionDate: s.lastSubmissionDate,
            missingSince: s.missingSince,
            submittedBy: s.submittedBy,
          })) : [],
        })}
        suggestedQuestions={[
          "Which locations haven't submitted yet?",
          "Show me this week's progress",
          "How do we compare to last week?",
          "Which locations need follow-up?",
          "What's our submission rate?",
          "Show me trends over time",
        ]}
      />
    </div>
  );
}
