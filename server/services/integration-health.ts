import OpenAI from 'openai';
import { missingEmailConfig } from './email';
import Twilio from 'twilio';
import { validateSMSConfig } from '../sms-service';
import { SMSProviderFactory } from '../sms-providers/provider-factory';
import { logApplicationError } from './application-error-logger';

export interface IntegrationCheckResult {
  name: string;
  configured: boolean;
  healthy: boolean | null; // null = not tested live or optional/not set up
  message: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
  /** If true, missing config does not affect overall health status */
  optional?: boolean;
}

export interface SystemHealthReport {
  checkedAt: string;
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  integrations: IntegrationCheckResult[];
}

async function pingOpenAI(
  name: string,
  apiKey: string | undefined,
  baseURL: string | undefined,
  liveCheck: boolean,
  notConfiguredMessage: string
): Promise<IntegrationCheckResult> {
  if (!apiKey) {
    return {
      name,
      configured: false,
      healthy: false,
      message: notConfiguredMessage,
    };
  }

  if (!liveCheck) {
    return {
      name,
      configured: true,
      healthy: null,
      message: 'API key present (run live check to verify)',
    };
  }

  try {
    const client = new OpenAI({ apiKey, baseURL });
    const start = Date.now();
    await client.chat.completions.create({
      model: 'gpt-5-mini',
      max_completion_tokens: 5,
      messages: [{ role: 'user', content: 'Reply with OK' }],
    });

    return {
      name,
      configured: true,
      healthy: true,
      message: 'API key valid and responding',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      configured: true,
      healthy: false,
      message: `API call failed: ${message}`,
    };
  }
}

async function checkOpenAIForSmsParser(
  liveCheck: boolean
): Promise<IntegrationCheckResult> {
  return pingOpenAI(
    'OpenAI (SMS collection parser)',
    process.env.OPENAI_API_KEY,
    undefined,
    liveCheck,
    'OPENAI_API_KEY is not set — complex SMS formats will fail to parse'
  );
}

/**
 * Twilio Email (email only; SMS has its own check). Configuration check only:
 * the restricted email key has Emails Read + Create but no List permission, so
 * there is no read-only endpoint to call safely. `npm run email:test` sends a
 * real test email.
 */
async function checkTwilioEmail(_liveCheck: boolean): Promise<IntegrationCheckResult> {
  const missing = missingEmailConfig();
  if (missing.length > 0) {
    return {
      name: 'Twilio Email',
      configured: false,
      healthy: false,
      message: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`,
    };
  }
  return {
    name: 'Twilio Email',
    configured: true,
    healthy: null,
    message: `Configured; sending from ${process.env.EMAIL_FROM_ADDRESS}. Run "npm run email:test -- you@example.com" to send a real test.`,
  };
}

async function checkTwilio(liveCheck: boolean): Promise<IntegrationCheckResult> {
  const config = validateSMSConfig();

  if (!config.isConfigured) {
    return {
      name: 'SMS (Twilio / gateway)',
      configured: false,
      healthy: false,
      message: `Missing: ${config.missingItems.join(', ') || 'credentials'}`,
      details: config.providersStatus,
    };
  }

  if (!liveCheck) {
    return {
      name: 'SMS (Twilio / gateway)',
      configured: true,
      healthy: null,
      message: `${config.provider || 'Provider'} credentials present (run live check to verify)`,
      details: config.providersStatus,
    };
  }

  try {
    const start = Date.now();
    const factory = SMSProviderFactory.getInstance();
    await factory.ensureInitialized();
    const provider = await factory.getProviderAsync();

    if (provider.name === 'phone_gateway' && 'healthCheck' in provider) {
      const result = await (provider as { healthCheck: () => Promise<{ success: boolean; message: string; responseTime?: number }> }).healthCheck();
      return {
        name: 'SMS (Twilio / gateway)',
        configured: true,
        healthy: result.success,
        message: result.message,
        latencyMs: result.responseTime ?? Date.now() - start,
        details: { provider: 'phone_gateway', ...config.providersStatus },
      };
    }

    if (provider.name === 'twilio') {
      let client: ReturnType<typeof Twilio> | null = null;
      let accountSid = process.env.TWILIO_ACCOUNT_SID;

      if (accountSid && process.env.TWILIO_AUTH_TOKEN) {
        client = Twilio(accountSid, process.env.TWILIO_AUTH_TOKEN);
      } else {
        const { getTwilioClient } = await import('../sms-providers/replit-twilio-connector');
        client = await getTwilioClient();
        accountSid = accountSid || (client as { accountSid?: string }).accountSid;
      }

      if (!client || !accountSid) {
        return {
          name: 'SMS (Twilio / gateway)',
          configured: true,
          healthy: false,
          message: 'Could not initialize Twilio client for live check',
          details: config.providersStatus,
        };
      }

      const account = await client.api.v2010.accounts(accountSid).fetch();

      return {
        name: 'SMS (Twilio / gateway)',
        configured: true,
        healthy: true,
        message: `Twilio account verified (${account.friendlyName || accountSid.slice(0, 8)}…)`,
        latencyMs: Date.now() - start,
        details: { provider: 'twilio', status: account.status, ...config.providersStatus },
      };
    }

    return {
      name: 'SMS (Twilio / gateway)',
      configured: true,
      healthy: false,
      message: `Unknown SMS provider: ${provider.name}`,
      details: config.providersStatus,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'SMS (Twilio / gateway)',
      configured: true,
      healthy: false,
      message: `Live check failed: ${message}`,
      details: config.providersStatus,
    };
  }
}

function checkSentry(): IntegrationCheckResult {
  const configured = !!process.env.SENTRY_DSN;
  return {
    name: 'Sentry (error tracking)',
    configured,
    optional: true,
    healthy: configured ? null : null,
    message: configured
      ? 'DSN configured (no live ping — optional service)'
      : 'SENTRY_DSN not set — optional; app uses built-in error logs instead',
  };
}

async function checkAnthropicIntegrations(
  liveCheck: boolean
): Promise<IntegrationCheckResult> {
  return pingOpenAI(
    'AI Integrations (Replit)',
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    liveCheck,
    'AI_INTEGRATIONS_OPENAI_API_KEY not set — in-app AI features may fail'
  );
}

async function checkGoogleSheetsProjectsSync(
  liveCheck: boolean
): Promise<IntegrationCheckResult> {
  const name = 'Google Sheets (projects sync)';
  const missing: string[] = [];
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!process.env.GOOGLE_PRIVATE_KEY) missing.push('GOOGLE_PRIVATE_KEY');
  if (!process.env.GOOGLE_PROJECT_ID) missing.push('GOOGLE_PROJECT_ID');
  if (!process.env.PROJECTS_SHEET_ID) missing.push('PROJECTS_SHEET_ID');

  if (missing.length > 0) {
    return {
      name,
      configured: false,
      healthy: false,
      message: `Missing credentials/config: ${missing.join(', ')} — projects sheet sync will fail`,
    };
  }

  if (!liveCheck) {
    return {
      name,
      configured: true,
      healthy: null,
      message: 'Credentials present (run live check to verify sheet access)',
    };
  }

  try {
    const { getProjectsGoogleSheetsService } = await import('../google-sheets-service');
    const service = getProjectsGoogleSheetsService();
    if (!service) {
      return {
        name,
        configured: false,
        healthy: false,
        message: 'Projects sheets service could not be constructed (missing configuration)',
      };
    }

    const result = await service.verifyAuth();
    return {
      name,
      configured: true,
      healthy: result.ok,
      message: result.message,
      latencyMs: result.latencyMs,
      details: result.spreadsheetTitle
        ? { spreadsheetTitle: result.spreadsheetTitle }
        : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      configured: true,
      healthy: false,
      message: `Live check failed: ${message}`,
    };
  }
}

/**
 * Startup verification for Google Sheets credentials. Runs a real
 * authenticated call against the projects spreadsheet and raises an
 * admin-notified application error if credentials are rotated/malformed,
 * so the projects sync can't silently break at request time.
 */
export async function verifyGoogleSheetsAuthAtStartup(): Promise<void> {
  const result = await checkGoogleSheetsProjectsSync(true);

  if (result.healthy === true) {
    return;
  }

  logApplicationError({
    source: 'health_check',
    severity: 'error',
    category: 'google_sheets_projects_sync',
    message: `Startup check — ${result.name}: ${result.message}`,
    details: result.details,
    notifyAdmin: true,
  });
}

export async function runIntegrationHealthCheck(options?: {
  liveCheck?: boolean;
  logFailures?: boolean;
}): Promise<SystemHealthReport> {
  const liveCheck = options?.liveCheck ?? false;
  const logFailures = options?.logFailures ?? false;

  const integrations = await Promise.all([
    checkOpenAIForSmsParser(liveCheck),
    checkTwilioEmail(liveCheck),
    checkTwilio(liveCheck),
    Promise.resolve(checkSentry()),
    checkAnthropicIntegrations(liveCheck),
    checkGoogleSheetsProjectsSync(liveCheck),
  ]);

  const unhealthy = integrations.filter(
    (i) => i.healthy === false && !i.optional
  );
  const degraded = integrations.filter(
    (i) => !i.configured && !i.optional && i.healthy !== true
  );

  let overallStatus: SystemHealthReport['overallStatus'] = 'healthy';
  if (unhealthy.length > 0) {
    overallStatus = 'unhealthy';
  } else if (degraded.length > 0) {
    overallStatus = 'degraded';
  }

  if (logFailures) {
    for (const integration of integrations) {
      if (integration.healthy === false && !integration.optional) {
        logApplicationError({
          source: 'health_check',
          severity: 'error',
          category: integration.name.toLowerCase().replace(/\s+/g, '_'),
          message: `${integration.name}: ${integration.message}`,
          details: integration.details,
          notifyAdmin: true,
        });
      }
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    overallStatus,
    integrations,
  };
}
