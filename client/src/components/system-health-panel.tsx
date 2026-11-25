import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';

interface IntegrationCheckResult {
  name: string;
  configured: boolean;
  healthy: boolean | null;
  message: string;
  latencyMs?: number;
  optional?: boolean;
}

interface SystemHealthReport {
  checkedAt: string;
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  integrations: IntegrationCheckResult[];
}

function StatusIcon({
  healthy,
  configured,
  optional,
}: {
  healthy: boolean | null;
  configured: boolean;
  optional?: boolean;
}) {
  if (healthy === true) {
    return <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />;
  }
  if (healthy === false && !optional) {
    return <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />;
  }
  if (!configured && optional) {
    return <HelpCircle className="w-5 h-5 text-gray-400 flex-shrink-0" />;
  }
  if (!configured) {
    return <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />;
  }
  return <HelpCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />;
}

function overallBadge(status: SystemHealthReport['overallStatus']) {
  if (status === 'healthy') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        All systems operational
      </Badge>
    );
  }
  if (status === 'degraded') {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200">
        Degraded
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200">
      Issues detected
    </Badge>
  );
}

export function SystemHealthPanel() {
  const [liveCheck, setLiveCheck] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<SystemHealthReport>({
    queryKey: ['/api/admin/system-health', liveCheck],
    queryFn: async () => {
      const response = await fetch(
        `/api/admin/system-health?liveCheck=${liveCheck}`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Failed to load system health');
      return response.json();
    },
  });

  const runLiveCheck = () => {
    setLiveCheck(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-brand-primary" />
              System Health
            </CardTitle>
            <CardDescription className="mt-1">
              Integration status for SMS parsing, email, and other external services.
              Run a live check to ping each API and confirm keys actually work.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={runLiveCheck} disabled={isFetching}>
              Run live check
            </Button>
          </div>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
            {overallBadge(data.overallStatus)}
            <span className="text-gray-500">
              Checked{' '}
              {formatDistanceToNow(parseISO(data.checkedAt), { addSuffix: true })}
              {liveCheck ? ' (live API test)' : ' (config only)'}
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-6 text-gray-500">Checking integrations...</div>
        ) : !data ? (
          <div className="text-center py-6 text-gray-500">Unable to load health status.</div>
        ) : (
          <div className="space-y-3">
            {data.integrations.map((integration) => (
              <div
                key={integration.name}
                className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg"
              >
                <StatusIcon
                  healthy={integration.healthy}
                  configured={integration.configured}
                  optional={integration.optional}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{integration.name}</div>
                  <div className="text-sm text-gray-600 mt-0.5">{integration.message}</div>
                  {integration.latencyMs != null && (
                    <div className="text-xs text-gray-400 mt-1">
                      Response time: {integration.latencyMs}ms
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {!integration.configured && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        integration.optional ? 'text-gray-500' : 'text-red-600'
                      }`}
                    >
                      {integration.optional ? 'Optional' : 'Not configured'}
                    </Badge>
                  )}
                  {integration.healthy === true && (
                    <Badge variant="outline" className="text-[10px] text-green-700">
                      Healthy
                    </Badge>
                  )}
                  {integration.healthy === false && (
                    <Badge variant="outline" className="text-[10px] text-red-700">
                      Failed
                    </Badge>
                  )}
                  {integration.healthy === null && integration.configured && (
                    <Badge variant="outline" className="text-[10px] text-amber-700">
                      Not tested
                    </Badge>
                  )}
                </div>
              </div>
            ))}
            {data.overallStatus !== 'healthy' && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  One or more critical integrations need attention. Failures are logged
                  automatically and emailed to admin (deduped every 6 hours).
                </p>
              </div>
            )}
            {data.overallStatus === 'healthy' && liveCheck && (
              <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-900">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  Live checks passed for OpenAI, Twilio Email, SMS, and Replit AI.
                  Sentry is optional and only checks whether a DSN is configured.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
