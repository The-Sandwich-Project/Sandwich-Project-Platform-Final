import { Router } from 'express';
import { storage } from '../storage-wrapper';
import {
  sendTestSMS,
  sendSMSReminder,
  sendWeeklyReminderSMS,
  validateSMSConfig,
} from '../sms-service';
import { logger } from '../utils/production-safe-logger';
import {
  checkWeeklySubmissions,
  getWeekRange,
  getExpectedHostLocations,
} from '../weekly-monitoring';
import { db } from '../db';
import { sandwichCollections } from '@shared/schema';
import { and, gte, lte, isNull, asc } from 'drizzle-orm';

const router = Router();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The login link in reminder emails/texts comes from the dashboard
 * (window.location.origin). Only accept a plain http(s) origin so the link
 * can't be pointed anywhere odd; otherwise the sender uses its default.
 */
function safeAppUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Placeholder/categorization host names that are NOT real weekly locations and
 * should never appear in the submission grid. These are data-collection
 * artifacts (e.g. historical group collections logged under a "Groups"
 * pseudo-location). Compared lower-cased and trimmed.
 */
const NON_LOCATION_HOST_NAMES = new Set([
  'groups',
  'group',
  'unassigned',
  'unknown',
  'unnamed groups',
]);

/**
 * Loosely match a collection's free-text hostName against a host location name.
 * Uses normalized equality first, then a guarded substring match (shorter side
 * must be >= 4 chars) to tolerate variations like "East Cobb" vs
 * "East Cobb/Roswell" without producing false positives on tiny names.
 */
function hostNameMatches(collectionHostName: string, locationName: string): boolean {
  const a = (collectionHostName || '').toLowerCase().trim();
  const b = (locationName || '').toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = a.replace(/[\/\-\s]/g, '');
  const sb = b.replace(/[\/\-\s]/g, '');
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const [shorter, longer] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  return shorter.length >= 4 && longer.includes(shorter);
}

// Get SMS configuration status with enhanced health checks
router.get('/sms-config', async (req, res) => {
  try {
    const config = validateSMSConfig();
    const response = {
      isConfigured: config.isConfigured,
      provider: config.provider || 'unknown',
      phoneNumber: config.isConfigured ? (config.provider === 'twilio' ? process.env.TWILIO_PHONE_NUMBER : process.env.PHONE_GATEWAY_DEVICE_NUMBER) : null,
      missingItems: config.missingItems,
      providersStatus: config.providersStatus || {},
    };

    // Add health check for current provider if requested
    if (req.query.includeHealthCheck === 'true' && config.isConfigured) {
      try {
        const { SMSProviderFactory } = await import('../sms-providers/provider-factory');
        const factory = SMSProviderFactory.getInstance();
        const provider = factory.getProvider();
        
        if (provider.name === 'phone_gateway' && 'healthCheck' in provider) {
          const healthResult = await (provider as any).healthCheck();
          (response as any).healthCheck = healthResult;
        } else if (provider.name === 'twilio') {
          // For Twilio, we can check if credentials work by validating the client
          (response as any).healthCheck = {
            success: provider.isConfigured(),
            message: provider.isConfigured() ? 'Twilio credentials configured' : 'Twilio credentials missing'
          };
        }
      } catch (healthError) {
        (response as any).healthCheck = {
          success: false,
          message: `Health check failed: ${(healthError as Error).message}`
        };
      }
    }

    res.json(response);
  } catch (error) {
    logger.error('Error checking SMS config:', error);
    res.status(500).json({ error: 'Failed to check SMS configuration' });
  }
});

// Phone gateway specific health check endpoint
router.get('/phone-gateway/health', async (req, res) => {
  try {
    const { SMSProviderFactory } = await import('../sms-providers/provider-factory');
    const factory = SMSProviderFactory.getInstance();
    const provider = factory.getProvider();
    
    if (provider.name !== 'phone_gateway') {
      return res.status(400).json({ 
        error: 'Phone gateway health check not available',
        currentProvider: provider.name 
      });
    }

    if (!('healthCheck' in provider)) {
      return res.status(500).json({ 
        error: 'Phone gateway provider does not support health checks' 
      });
    }

    const healthResult = await (provider as any).healthCheck();
    res.json(healthResult);
  } catch (error) {
    logger.error('Error performing phone gateway health check:', error);
    res.status(500).json({ 
      error: 'Failed to perform health check',
      message: (error as Error).message 
    });
  }
});

// Phone gateway device info endpoint
router.get('/phone-gateway/device-info', async (req, res) => {
  try {
    const { SMSProviderFactory } = await import('../sms-providers/provider-factory');
    const factory = SMSProviderFactory.getInstance();
    const provider = factory.getProvider();
    
    if (provider.name !== 'phone_gateway') {
      return res.status(400).json({ 
        error: 'Phone gateway device info not available',
        currentProvider: provider.name 
      });
    }

    if (!('getDeviceInfo' in provider)) {
      return res.status(500).json({ 
        error: 'Phone gateway provider does not support device info' 
      });
    }

    const deviceResult = await (provider as any).getDeviceInfo();
    res.json(deviceResult);
  } catch (error) {
    logger.error('Error getting phone gateway device info:', error);
    res.status(500).json({ 
      error: 'Failed to get device info',
      message: (error as Error).message 
    });
  }
});

// Get weekly monitoring status
router.get('/weekly-status/:weeksAgo', async (req, res) => {
  try {
    const weeksAgo = parseInt(req.params.weeksAgo, 10);

    // Calculate date range for the week
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() - weeksAgo * 7);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    // Get all collections
    const allCollections = await storage.getSandwichCollections(1000, 0);

    // Filter collections for the specified week
    const collections = allCollections.filter((c: any) => {
      const collDate = new Date(c.collectionDate);
      return collDate >= startOfWeek && collDate <= endOfWeek;
    });

    // Group by location and check for missing weeks
    const locationStatus = new Map<string, any>();

    for (const collection of collections) {
      if (!locationStatus.has(collection.hostName)) {
        locationStatus.set(collection.hostName, {
          location: collection.hostName,
          hasData: true,
          lastCollection: collection.collectionDate,
          sandwichesCollected: collection.individualSandwiches || 0,
        });
      }
    }

    // Get all expected locations
    const allLocations = await storage.getAllRecipients();

    // Check for missing locations
    const missingLocations = allLocations
      .filter((loc: any) => !locationStatus.has(loc.name))
      .map((loc: any) => loc.name);

    res.json({
      week: weeksAgo,
      locationsReporting: Array.from(locationStatus.values()),
      missingLocations,
      totalLocations: allLocations.length,
      reportingCount: locationStatus.size,
    });
  } catch (error) {
    logger.error('Error getting weekly status:', error);
    res.status(500).json({ error: 'Failed to get weekly status' });
  }
});

// Get multi-week report
router.get('/multi-week-report/:weeks', async (req, res) => {
  try {
    const numWeeks = parseInt(req.params.weeks, 10);
    const weekReports = [];
    const locationStats: { [location: string]: { submitted: number; missed: number } } = {};

    // Get all expected locations (inactive/hidden hosts are excluded)
    const expectedLocations = await getExpectedHostLocations();

    // Initialize stats for all locations
    expectedLocations.forEach((location) => {
      locationStats[location] = { submitted: 0, missed: 0 };
    });

    // Generate report for each week
    for (let i = 0; i < numWeeks; i++) {
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() - i * 7);
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Get submission status for this week (reuse expected locations to
      // avoid a redundant hosts query per week)
      const submissionStatus = await checkWeeklySubmissions(i, expectedLocations);

      // Update location stats
      submissionStatus.forEach((status: any) => {
        if (locationStats[status.location]) {
          if (status.hasSubmitted) {
            locationStats[status.location].submitted++;
          } else {
            locationStats[status.location].missed++;
          }
        }
      });

      const weekLabel = i === 0 ? 'This Week' : i === 1 ? 'Last Week' : `${i} Weeks Ago`;

      weekReports.push({
        weekRange: {
          startDate: startOfWeek,
          endDate: endOfWeek,
        },
        weekLabel,
        submissionStatus,
      });
    }

    // Calculate summary statistics
    const overallStats: { [location: string]: { submitted: number; missed: number; percentage: number } } = {};
    Object.keys(locationStats).forEach((location) => {
      const stats = locationStats[location];
      const total = stats.submitted + stats.missed;
      const percentage = total > 0 ? Math.round((stats.submitted / total) * 100) : 0;
      overallStats[location] = {
        submitted: stats.submitted,
        missed: stats.missed,
        percentage,
      };
    });

    // Find most reliable (>=75% submission rate)
    const mostReliable = Object.keys(overallStats)
      .filter((location) => overallStats[location].percentage >= 75)
      .sort((a, b) => overallStats[b].percentage - overallStats[a].percentage);

    // Find most missing (sorted by number of missed weeks)
    const mostMissing = Object.keys(overallStats)
      .filter((location) => overallStats[location].missed > 0)
      .sort((a, b) => overallStats[b].missed - overallStats[a].missed)
      .slice(0, 5);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - startDate.getDay() - (numWeeks - 1) * 7);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - endDate.getDay() + 6);

    res.json({
      reportPeriod: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
      weeks: weekReports,
      summary: {
        totalWeeks: numWeeks,
        locationsTracked: expectedLocations,
        mostMissing,
        mostReliable,
        overallStats,
      },
    });
  } catch (error) {
    logger.error('Error getting multi-week report:', error);
    res.status(500).json({ error: 'Failed to get multi-week report' });
  }
});

// Get submission grid covering ALL host locations (rows) x weeks (columns)
router.get('/grid-report/:weeks', async (req, res) => {
  try {
    const numWeeks = Math.min(
      Math.max(parseInt(req.params.weeks, 10) || 12, 1),
      // 53 = 52 completed weeks + the in-progress one (location export's
      // 12-month lookback drops the current week)
      53
    );

    // All host locations from the hosts table (active only by default)
    const includeInactive = req.query.includeInactive === 'true';
    const allHosts = await storage.getAllHosts();
    const hostsToShow = allHosts
      .filter((h: any) =>
        includeInactive ? true : (h.status ?? 'active') === 'active'
      )
      // Exclude placeholder/categorization hosts that aren't real weekly
      // locations (e.g. "Groups", "Unassigned", "Unknown") — these are data
      // artifacts, not locations expected to submit a weekly log.
      .filter((h: any) => !NON_LOCATION_HOST_NAMES.has(
        String(h.name).toLowerCase().trim()
      ))
      .sort((a: any, b: any) =>
        String(a.name).localeCompare(String(b.name))
      );

    // Wednesday-Tuesday week windows, matching the rest of monitoring.
    // Index 0 = this week (most recent), so the last window is the oldest.
    const weekWindows = Array.from({ length: numWeeks }, (_, i) => {
      const { startDate, endDate } = getWeekRange(i);
      return {
        i,
        startDate,
        endDate,
        startStr: startDate.toISOString().split('T')[0],
        endStr: endDate.toISOString().split('T')[0],
      };
    });

    // Fetch the whole span in a single query (ordered by date so the last
    // match per host is the most recent), then bucket by week in memory —
    // avoids one DB round-trip per week (up to 52).
    const rangeStartStr = weekWindows[weekWindows.length - 1].startStr;
    const rangeEndStr = weekWindows[0].endStr;
    const allSubmissions = await db
      .select({
        hostName: sandwichCollections.hostName,
        collectionDate: sandwichCollections.collectionDate,
        individualSandwiches: sandwichCollections.individualSandwiches,
      })
      .from(sandwichCollections)
      .where(
        and(
          gte(sandwichCollections.collectionDate, rangeStartStr),
          lte(sandwichCollections.collectionDate, rangeEndStr),
          isNull(sandwichCollections.deletedAt)
        )
      )
      .orderBy(asc(sandwichCollections.collectionDate));

    const weeks = weekWindows.map(({ i, startDate, endDate, startStr, endStr }) => {
      // collectionDate is a YYYY-MM-DD string, so lexical comparison is safe
      const submissions = allSubmissions.filter(
        (s) => s.collectionDate >= startStr && s.collectionDate <= endStr
      );

      const submissionStatus = hostsToShow
        // Skip weeks before a host existed so new locations don't get
        // false "missing" marks (and depressed rates) for weeks that
        // predate them. The grid renders an omitted host/week as no-data.
        .filter((host: any) => {
          if (!host.createdAt) return true;
          return new Date(host.createdAt) <= endDate;
        })
        .map((host: any) => {
          const matches = submissions.filter((s) =>
            hostNameMatches(s.hostName, host.name)
          );

          // Dunwoody/PTC mirrors the weekly-monitoring rule: the week is
          // only complete with 2+ logs that have individual sandwich counts.
          const isDunwoody = String(host.name)
            .toLowerCase()
            .includes('dunwoody');
          let hasSubmitted: boolean;
          if (isDunwoody) {
            const logsWithCounts = matches.filter(
              (m) =>
                typeof m.individualSandwiches === 'number' &&
                m.individualSandwiches > 0
            );
            hasSubmitted = logsWithCounts.length >= 2;
          } else {
            hasSubmitted = matches.length > 0;
          }

          return {
            location: host.name,
            hasSubmitted,
            lastSubmissionDate:
              matches.length > 0
                ? matches[matches.length - 1].collectionDate
                : undefined,
          };
        });

      const weekLabel =
        i === 0 ? 'This Week' : i === 1 ? 'Last Week' : `${i} Weeks Ago`;

      return {
        weekRange: { startDate, endDate },
        weekLabel,
        submissionStatus,
      };
    });

    res.json({
      weeks,
      totalHosts: hostsToShow.length,
      totalWeeks: numWeeks,
    });
  } catch (error) {
    logger.error('Error getting grid report:', error);
    res.status(500).json({ error: 'Failed to get submission grid report' });
  }
});

// Get monitoring statistics
router.get('/stats', async (req, res) => {
  try {
    // Use checkWeeklySubmissions to get accurate counts (handles Dunwoody special logic)
    const currentWeekStatus = await checkWeeklySubmissions(0);
    const lastWeekStatus = await checkWeeklySubmissions(1);

    // Count submitted locations
    const currentWeekSubmitted = currentWeekStatus.filter(s => s.hasSubmitted).length;
    const lastWeekSubmitted = lastWeekStatus.filter(s => s.hasSubmitted).length;
    const totalLocations = currentWeekStatus.length;

    // Get sandwich counts from collections
    const now = new Date();
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - now.getDay());
    currentWeekStart.setHours(0, 0, 0, 0);

    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
    currentWeekEnd.setHours(23, 59, 59, 999);

    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const lastWeekEnd = new Date(currentWeekEnd);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 7);

    const allCollections = await storage.getSandwichCollections(1000, 0);

    const currentWeekCollections = allCollections.filter((c: any) => {
      const collDate = new Date(c.collectionDate);
      return collDate >= currentWeekStart && collDate <= currentWeekEnd;
    });

    const lastWeekCollections = allCollections.filter((c: any) => {
      const collDate = new Date(c.collectionDate);
      return collDate >= lastWeekStart && collDate <= lastWeekEnd;
    });

    const stats = {
      currentWeek: `Week of ${currentWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      totalExpectedLocations: totalLocations,
      submittedLocations: currentWeekSubmitted,
      missingLocations: totalLocations - currentWeekSubmitted,
      lastCheckTime: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      nextScheduledCheck: 'Manual',
      currentWeekStats: {
        reporting: currentWeekSubmitted,
        total: totalLocations,
        percentage:
          totalLocations > 0
            ? Math.round((currentWeekSubmitted / totalLocations) * 100)
            : 0,
      },
      lastWeekStats: {
        reporting: lastWeekSubmitted,
        total: totalLocations,
        percentage:
          totalLocations > 0
            ? Math.round((lastWeekSubmitted / totalLocations) * 100)
            : 0,
      },
      totalSandwichesThisWeek: currentWeekCollections.reduce(
        (sum: number, c: any) => sum + (c.individualSandwiches || 0),
        0
      ),
      totalSandwichesLastWeek: lastWeekCollections.reduce(
        (sum: number, c: any) => sum + (c.individualSandwiches || 0),
        0
      ),
    };

    res.json(stats);
  } catch (error) {
    logger.error('Error getting monitoring stats:', error);
    res.status(500).json({ error: 'Failed to get monitoring statistics' });
  }
});

// Manual check for current week
router.post('/check-now', async (req, res) => {
  try {
    // This would trigger any automated checks or notifications
    // For now, just return success
    res.json({ success: true, message: 'Manual check completed' });
  } catch (error) {
    logger.error('Error running manual check:', error);
    res.status(500).json({ error: 'Failed to run manual check' });
  }
});

// Check specific week
router.post('/check-week/:weeksAgo', async (req, res) => {
  try {
    const weeksAgo = parseInt(req.params.weeksAgo, 10);
    // This would trigger checks for a specific week
    res.json({
      success: true,
      message: `Check completed for week ${weeksAgo}`,
    });
  } catch (error) {
    logger.error('Error checking week:', error);
    res.status(500).json({ error: 'Failed to check week' });
  }
});

// Send SMS reminders to multiple locations
router.post('/send-sms-reminders', async (req, res) => {
  try {
    const { missingLocations, appUrl } = req.body;

    if (!missingLocations || !Array.isArray(missingLocations)) {
      return res
        .status(400)
        .json({ error: 'Missing locations array required' });
    }

    const results = await sendWeeklyReminderSMS(missingLocations, appUrl);

    const successCount = Object.values(results).filter((r) => r.success).length;
    const failureCount = Object.values(results).filter(
      (r) => !r.success
    ).length;

    res.json({
      success: true,
      results,
      totalSent: successCount,
      totalFailed: failureCount,
    });
  } catch (error) {
    logger.error('Error sending SMS reminders:', error);
    res.status(500).json({ error: 'Failed to send SMS reminders' });
  }
});

async function respondWithSmsReminder(location: string, rawAppUrl: unknown, res: any) {
  try {
    const result = await sendSMSReminder(location, safeAppUrl(rawAppUrl));

    if (result.success) {
      res.json({
        success: true,
        location,
        message: 'SMS reminder sent successfully',
        details: result,
      });
    } else {
      res.status(400).json({
        success: false,
        location,
        error: result.message || 'SMS reminder failed',
      });
    }
  } catch (error) {
    logger.error('Error sending SMS reminder:', error);
    res.status(500).json({ error: 'Failed to send SMS reminder' });
  }
}

// Send SMS reminder to single location (query parameter version, used by the
// dashboard). Before this existed the dashboard's per-location SMS button hit
// a route that didn't exist and always failed. Query string rather than path
// because location names can contain "/" (e.g. "Dunwoody/PTC").
router.post('/send-sms-reminder', async (req, res) => {
  const location = req.query.location as string;
  if (!location) {
    return res.status(400).json({ error: 'Location parameter is required' });
  }
  await respondWithSmsReminder(location, req.body?.appUrl, res);
});

// Send SMS reminder to single location (path parameter version - legacy)
router.post('/send-sms-reminder/:location', async (req, res) => {
  await respondWithSmsReminder(decodeURIComponent(req.params.location), req.body?.appUrl, res);
});

// Test SMS
router.post('/test-sms', async (req, res) => {
  try {
    const { phoneNumber, appUrl } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const result = await sendTestSMS(phoneNumber, appUrl);

    if (result.success) {
      res.json({
        success: true,
        message: 'Test SMS sent successfully',
        phone: phoneNumber,
        details: result,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.message || 'Test SMS failed',
        phone: phoneNumber,
      });
    }
  } catch (error) {
    logger.error('Error sending test SMS:', error);
    res.status(500).json({ error: 'Failed to send test SMS' });
  }
});

// Test email - sends a sample weekly monitoring email
router.post('/test-email', async (req, res) => {
  try {
    const { emailAddress } = req.body;
    
    if (!emailAddress) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Import required modules
    const mailService = (await import('@sendgrid/mail')).default;
    const { EMAIL_FOOTER_TEXT, EMAIL_FOOTER_HTML } = await import('../utils/email-footer');
    
    const previousWednesday = new Date();
    previousWednesday.setDate(previousWednesday.getDate() - ((previousWednesday.getDay() + 4) % 7));
    const weekLabel = previousWednesday.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const loginUrl = 'https://sandwich-project-platform-final-katielong2316.replit.app/';
    const emailSubject = `🥪 Friendly Reminder: Weekly Sandwich Collection Numbers`;
    const contactName = 'Katie';
    const location = 'Test Location';

    const emailText = `Hi ${contactName}!

Hope you're having a great week! This is a friendly reminder that we haven't received your sandwich collection numbers for ${weekLabel} yet.

When you have a moment, could you please log in to our app and submit your numbers? It only takes a minute and really helps us track our community impact.

Login here: ${loginUrl}

Thanks so much for all you do for The Sandwich Project! Your location makes such a difference in our community.

Best regards,
The Sandwich Project Team

P.S. If you've already submitted or have any questions, feel free to reach out to us!`;

    const emailHtml = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
        <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #236383; margin: 0; font-size: 24px;">🥪 The Sandwich Project</h1>
            <p style="color: #6c757d; margin: 10px 0 0 0; font-size: 16px;">Friendly Weekly Reminder</p>
          </div>
          
          <div style="margin-bottom: 25px;">
            <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.5;">Hi ${contactName}!</p>
            
            <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.5;">Hope you're having a great week! This is a friendly reminder that we haven't received your sandwich collection numbers for this week yet.</p>
            
            <div style="background: #e3f2fd; border-left: 4px solid #236383; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-weight: 600; color: #236383;">Collection Date: ${weekLabel}</p>
              <p style="margin: 5px 0 0 0; color: #6c757d; font-size: 14px;">Location: ${location}</p>
            </div>
            
            <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.5;">When you have a moment, could you please log in to our app and submit your numbers? It only takes a minute and really helps us track our community impact.</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="background: #236383; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 16px;">Login to Submit Numbers</a>
          </div>
          
          <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #e9ecef;">
            <p style="margin: 0 0 10px 0; font-size: 16px; line-height: 1.5;">Thanks so much for all you do for The Sandwich Project! Your location makes such a difference in our community.</p>
            
            <p style="margin: 0 0 10px 0; font-size: 16px; line-height: 1.5; font-weight: 600;">Best regards,<br>The Sandwich Project Team</p>
            
            <p style="margin: 0; font-size: 14px; color: #6c757d; font-style: italic;">P.S. If you've already submitted or have any questions, feel free to reach out to us!</p>
          </div>
        </div>
      </div>
    `;

    await mailService.send({
      to: emailAddress,
      from: 'katie@thesandwichproject.org',
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    });

    res.json({
      success: true,
      message: `Test email sent successfully to ${emailAddress}`,
    });
  } catch (error) {
    logger.error('Error sending test email:', error);
    res.status(500).json({ error: 'Failed to send test email', details: errorMessage(error) });
  }
});

/**
 * Send one location's weekly email reminder and report what actually happened.
 * sendEmailReminder never throws; it returns success: false with a reason
 * (no contact on file, no email address, SendGrid not configured, send
 * failed). Those used to come back as HTTP 200, so the dashboard treated a
 * reminder that never went out as sent. Now they're a 422 with the reason.
 */
async function respondWithEmailReminder(location: string, rawAppUrl: unknown, res: any) {
  try {
    const { sendEmailReminder } = await import('../weekly-monitoring');
    const result = await sendEmailReminder(location, safeAppUrl(rawAppUrl));

    if (!result.success) {
      return res.status(422).json({
        success: false,
        location,
        error: result.message,
        message: result.message,
      });
    }

    res.json({ success: true, location, message: result.message });
  } catch (error) {
    logger.error('Error sending email reminder:', error);
    res.status(500).json({ error: 'Failed to send email reminder', details: errorMessage(error) });
  }
}

// Send email reminder to single location (query parameter version, used by the dashboard)
router.post('/send-email-reminder', async (req, res) => {
  const location = req.query.location as string;
  if (!location) {
    return res.status(400).json({ error: 'Location parameter is required' });
  }
  await respondWithEmailReminder(location, req.body?.appUrl, res);
});

// Send email reminder to single location (path parameter version - legacy)
router.post('/send-email-reminder/:location', async (req, res) => {
  await respondWithEmailReminder(decodeURIComponent(req.params.location), req.body?.appUrl, res);
});

export default router;
