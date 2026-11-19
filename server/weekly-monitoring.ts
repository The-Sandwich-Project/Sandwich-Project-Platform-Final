import { MailService } from '@sendgrid/mail';
import { withUnsubscribeSettings } from './utils/sendgrid-unsubscribe';
import { db } from './db';
import { sandwichCollections, hosts, hostContacts } from '@shared/schema';
import { eq, sql, and, gte, lte, like, or, isNull } from 'drizzle-orm';
import { logger } from './utils/production-safe-logger';
import { batchSendEmails } from './utils/batch-operations';
import { FROM_EMAIL } from './config/organization';

if (!process.env.SENDGRID_API_KEY) {
  logger.error(
    'SENDGRID_API_KEY environment variable must be set for email notifications'
  );
}

const mailService = new MailService();
if (process.env.SENDGRID_API_KEY) {
  mailService.setApiKey(process.env.SENDGRID_API_KEY);
}

// Expected host locations that should submit weekly
const EXPECTED_HOST_LOCATIONS = [
  'East Cobb/Roswell',
  'Dunwoody/PTC',
  'Alpharetta',
  'Sandy Springs/Chastain',
  'Intown/Druid Hills/Oak Grove/Chamblee/Brookhaven/Buckhead',
  'Dacula',
  'Flowery Branch',
  'UGA',
  'Collective Learning',
];

// Fallback email mapping for specific locations (when database lookup fails or for spam prevention)
const LOCATION_CONTACT_EMAILS: Record<string, string> = {
  'Alpharetta': 'atlantamillers@comcast.net', // Nancy Miller
  'East Cobb/Roswell': 'vickib@aol.com', // Vicki Tropauer
  'Intown/Druid Hills': 'jordan@thesandwichproject.org', // Jordan
  'Intown/Druid Hills/Oak Grove/Chamblee/Brookhaven/Buckhead': 'jordan@thesandwichproject.org', // Jordan
  'Flowery Branch': 'kristinamday@yahoo.com', // Kristina McCarthney
  'Sandy Springs': 'jenmcohen@gmail.com', // Jen Cohen
  'Sandy Springs/Chastain': 'jenmcohen@gmail.com', // Jen Cohen
  'Dunwoody/PTC': 'mdlouza@gmail.com', // Marcy Louza (primary)
};

// Personal admin email to receive weekly monitoring notifications
// This is different from the organizational admin email in config/organization.ts
const WEEKLY_MONITORING_RECIPIENT = 'katielong2316@gmail.com';
// FROM_EMAIL imported from config/organization.ts

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

/**
 * Get the week's date range for a given offset (Wednesday to Tuesday)
 * Entries posted before Wednesday cannot count collections that happened Wednesday or after for that week's submission
 * @param weeksAgo - Number of weeks to go back (0 = current week, 1 = last week, etc.)
 */
export function getWeekRange(weeksAgo: number = 0): {
  startDate: Date;
  endDate: Date;
} {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 3 = Wednesday

  // Calculate Wednesday of current week cycle
  let daysToWednesday;
  if (dayOfWeek >= 3) {
    // If today is Wednesday or later
    daysToWednesday = dayOfWeek - 3; // Days since this Wednesday
  } else {
    // If today is Sunday, Monday, or Tuesday
    daysToWednesday = dayOfWeek + 4; // Days since last Wednesday (previous week)
  }

  const wednesday = new Date(now);
  wednesday.setDate(now.getDate() - daysToWednesday - weeksAgo * 7);
  wednesday.setHours(0, 0, 0, 0);

  // Calculate Tuesday of current week cycle (6 days after Wednesday)
  const tuesday = new Date(wednesday);
  tuesday.setDate(wednesday.getDate() + 6);
  tuesday.setHours(23, 59, 59, 999);

  return { startDate: wednesday, endDate: tuesday };
}

/**
 * Get the current week's date range (Wednesday to Tuesday) - backwards compatibility
 */
export function getCurrentWeekRange(): { startDate: Date; endDate: Date } {
  return getWeekRange(0);
}

/**
 * Get the most recent Wednesday's date (for collection date reference)
 */
export function getPreviousWednesday(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 3 = Wednesday

  // Calculate days to go back to reach Wednesday
  let daysBack;
  if (dayOfWeek === 0) {
    // Sunday
    daysBack = 4; // Go back to previous Wednesday
  } else if (dayOfWeek === 1) {
    // Monday
    daysBack = 5; // Go back to previous Wednesday
  } else if (dayOfWeek === 2) {
    // Tuesday
    daysBack = 6; // Go back to previous Wednesday
  } else if (dayOfWeek === 3) {
    // Wednesday
    daysBack = 0; // Today is Wednesday
  } else if (dayOfWeek === 4) {
    // Thursday
    daysBack = 1; // Yesterday was Wednesday
  } else if (dayOfWeek === 5) {
    // Friday
    daysBack = 2; // Two days ago was Wednesday
  } else {
    // Saturday (dayOfWeek === 6)
    daysBack = 3; // Three days ago was Wednesday
  }

  const wednesday = new Date(now);
  wednesday.setDate(now.getDate() - daysBack);
  wednesday.setHours(0, 0, 0, 0);

  return wednesday;
}

/**
 * Check Dunwoody special requirements: need 2+ collection logs with individual sandwich counts
 * As long as there are two collection logs with individual sandwich counts for Dunwoody
 * during the week in question, then both Marcy and Lisa are accounted for.
 */
function checkDunwoodyStatus(submissions: any[], location: string): any {
  const dunwoodySubmissions = submissions.filter((sub) =>
    sub.hostName?.toLowerCase().includes('dunwoody')
  );

  if (dunwoodySubmissions.length === 0) {
    return {
      lisaHiles: false,
      stephanieOrMarcy: false,
      complete: false,
    };
  }

  // Count submissions with individual sandwich counts > 0
  // individualSandwiches is an integer, so we check for > 0
  const submissionsWithIndividualCounts = dunwoodySubmissions.filter(
    (sub) => {
      const count = sub.individualSandwiches;
      return count != null && typeof count === 'number' && count > 0;
    }
  );

  const hasTwoOrMore = submissionsWithIndividualCounts.length >= 2;

  const result = {
    lisaHiles: hasTwoOrMore, // Simplified: if we have 2+ submissions, both are accounted for
    stephanieOrMarcy: hasTwoOrMore, // Simplified: if we have 2+ submissions, both are accounted for
    complete: hasTwoOrMore,
  };

  // Enhanced debug logging
  logger.log(`Dunwoody status check for ${location}:`, {
    totalSubmissions: dunwoodySubmissions?.length || 0,
    submissionsWithIndividualCounts: submissionsWithIndividualCounts.length,
    hasTwoOrMore,
    complete: result.complete,
    allSubmissions: (dunwoodySubmissions || []).map(sub => ({
      hostName: sub?.hostName || 'unknown',
      submittedBy: sub?.submittedBy || 'unknown',
      createdBy: sub?.createdBy || 'unknown',
      individualSandwiches: sub?.individualSandwiches ?? 'null/undefined',
      individualSandwichesType: typeof sub?.individualSandwiches,
      collectionDate: sub?.collectionDate || 'unknown',
    })),
    validSubmissions: submissionsWithIndividualCounts.map(sub => ({
      submittedBy: sub?.submittedBy || 'unknown',
      individualSandwiches: sub?.individualSandwiches,
      collectionDate: sub?.collectionDate || 'unknown',
    })),
  });

  return result;
}

/**
 * Loosely match a curated expected-location name against a host record name.
 * Normalized equality first, then a guarded substring match (shorter side
 * must be >= 4 chars) so "Dacula" matches "Dacula" without tiny names like
 * "UGA" matching unrelated hosts.
 */
function locationMatchesHostName(location: string, hostName: string): boolean {
  const a = (location || '').toLowerCase().trim();
  const b = (hostName || '').toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = a.replace(/[\/\-\s]/g, '');
  const sb = b.replace(/[\/\-\s]/g, '');
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const [shorter, longer] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  return shorter.length >= 4 && longer.includes(shorter);
}

/**
 * The curated weekly host locations, with any location whose matching host
 * record is explicitly marked inactive/hidden in Host Management removed.
 * This lets coordinators retire a location (e.g. Dacula) simply by setting
 * its host status to "inactive" — it then drops out of weekly monitoring,
 * the multi-week report, and reminder emails automatically. A location is
 * only removed when a host is *positively* known to be inactive, so unknown
 * or unmatched locations are kept (fail-open).
 */
export async function getExpectedHostLocations(): Promise<string[]> {
  try {
    const hostRecords = await db
      .select({ name: hosts.name, status: hosts.status })
      .from(hosts);

    return EXPECTED_HOST_LOCATIONS.filter((location) => {
      const matchingHosts = hostRecords.filter((h) =>
        locationMatchesHostName(location, h.name)
      );
      // Fail-open: if no host record matches the curated name, keep it.
      if (matchingHosts.length === 0) return true;
      // Only drop the location when EVERY matching host is inactive/hidden.
      // Host names aren't unique, so a stray duplicate inactive record must
      // not hide a location that still has an active host.
      return matchingHosts.some(
        (h) => h.status !== 'inactive' && h.status !== 'hidden'
      );
    });
  } catch (error) {
    logger.error(
      'Failed to filter expected host locations by status; using full curated list',
      error
    );
    return [...EXPECTED_HOST_LOCATIONS];
  }
}

/**
 * Check which host locations have submitted for a specific week
 * @param weeksAgo - Number of weeks to go back (0 = current week, 1 = last week, etc.)
 * @param expectedLocationsArg - Optional precomputed expected-locations list.
 *   Callers that loop over many weeks should fetch it once (via
 *   getExpectedHostLocations) and pass it in to avoid a hosts query per week.
 */
export async function checkWeeklySubmissions(
  weeksAgo: number = 0,
  expectedLocationsArg?: string[]
): Promise<WeeklySubmissionStatus[]> {
  const { startDate, endDate } = getWeekRange(weeksAgo);

  logger.log(
    `Checking submissions for week: ${startDate.toDateString()} to ${endDate.toDateString()}`
  );
  logger.log(
    `Week range: ${startDate.toISOString().split('T')[0]} to ${
      endDate.toISOString().split('T')[0]
    }`
  );

  try {
    // Get all submissions for this week (excluding soft-deleted records)
    const weeklySubmissions = await db
      .select({
        hostName: sandwichCollections.hostName,
        collectionDate: sandwichCollections.collectionDate,
        submittedBy: sandwichCollections.createdByName,
        createdBy: sandwichCollections.createdBy,
        individualSandwiches: sandwichCollections.individualSandwiches,
      })
      .from(sandwichCollections)
      .where(
        and(
          gte(
            sandwichCollections.collectionDate,
            startDate.toISOString().split('T')[0]
          ),
          lte(
            sandwichCollections.collectionDate,
            endDate.toISOString().split('T')[0]
          ),
          isNull(sandwichCollections.deletedAt) // Exclude soft-deleted records
        )
      );

    logger.log(
      `Found ${weeklySubmissions.length} submissions for this week:`,
      weeklySubmissions
    );

    // Get the set of locations that have submitted this week
    const submittedLocations = new Set(
      weeklySubmissions.map((sub) => sub.hostName?.toLowerCase().trim())
    );

    // Check each expected location (inactive/hidden hosts are excluded).
    // Reuse the caller-provided list when present to avoid a redundant
    // hosts query on every week in a multi-week loop.
    const expectedLocations =
      expectedLocationsArg ?? (await getExpectedHostLocations());
    const statusResults: WeeklySubmissionStatus[] = [];

    for (const expectedLocation of expectedLocations) {
      const normalizedExpected = expectedLocation.toLowerCase().trim();

      // Get submissions for this location
      const locationSubmissions = weeklySubmissions.filter((sub) => {
        const hostName = sub.hostName?.toLowerCase().trim() || '';
        return (
          hostName &&
          (hostName.includes(normalizedExpected) ||
            normalizedExpected.includes(hostName) ||
            // Handle variations like "East Cobb" vs "East Cobb/Roswell"
            hostName
              .replace(/[\/\-\s]/g, '')
              .includes(normalizedExpected.replace(/[\/\-\s]/g, '')) ||
            normalizedExpected
              .replace(/[\/\-\s]/g, '')
              .includes(hostName.replace(/[\/\-\s]/g, '')))
        );
      });

      let hasSubmitted = locationSubmissions.length > 0;
      let dunwoodyStatus = undefined;

      // Special handling for Dunwoody
      if (expectedLocation === 'Dunwoody/PTC') {
        dunwoodyStatus = checkDunwoodyStatus(
          locationSubmissions,
          expectedLocation
        );
        hasSubmitted = dunwoodyStatus.complete; // Only mark as submitted if both requirements met
      }

      const submittedBy = locationSubmissions
        .map((sub) => sub.submittedBy)
        .filter((name): name is string => Boolean(name))
        .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates

      statusResults.push({
        location: expectedLocation,
        hasSubmitted,
        lastSubmissionDate:
          locationSubmissions.length > 0
            ? locationSubmissions[locationSubmissions.length - 1]
                ?.collectionDate
            : undefined,
        submittedBy,
        dunwoodyStatus,
      });
    }

    logger.log(`Status results:`, statusResults);
    return statusResults;
  } catch (error) {
    logger.error('Error checking weekly submissions:', error);
    throw error;
  }
}

/**
 * Generate a comprehensive multi-week report
 */
export async function generateMultiWeekReport(
  numberOfWeeks: number = 4
): Promise<ComprehensiveReport> {
  const weeks: MultiWeekReport[] = [];

  // Fetch the status-filtered expected locations once and reuse it for every
  // week (and the summary) to avoid a hosts query per week.
  const locationsTracked = await getExpectedHostLocations();

  // Generate reports for each week
  for (let i = 0; i < numberOfWeeks; i++) {
    const { startDate, endDate } = getWeekRange(i);
    const submissionStatus = await checkWeeklySubmissions(i, locationsTracked);

    weeks.push({
      weekRange: { startDate, endDate },
      weekLabel: `Week of ${startDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })}`,
      submissionStatus,
    });
  }

  // Calculate summary statistics (excluding inactive/hidden hosts)
  const overallStats: {
    [location: string]: {
      submitted: number;
      missed: number;
      percentage: number;
    };
  } = {};

  // Initialize stats for each location
  locationsTracked.forEach((location) => {
    overallStats[location] = { submitted: 0, missed: 0, percentage: 0 };
  });

  // Calculate statistics across all weeks
  weeks.forEach((week) => {
    week.submissionStatus.forEach((status) => {
      if (status.hasSubmitted) {
        overallStats[status.location].submitted++;
      } else {
        overallStats[status.location].missed++;
      }
    });
  });

  // Calculate percentages
  Object.keys(overallStats).forEach((location) => {
    const stats = overallStats[location];
    const total = stats.submitted + stats.missed;
    stats.percentage =
      total > 0 ? Math.round((stats.submitted / total) * 100) : 0;
  });

  // Find most missing and most reliable
  const mostMissing = Object.entries(overallStats)
    .filter(([location, stats]) => stats.missed > 0)
    .sort(([, a], [, b]) => b.missed - a.missed)
    .slice(0, 3)
    .map(([location]) => location);

  const mostReliable = Object.entries(overallStats)
    .filter(([location, stats]) => stats.percentage >= 75)
    .sort(([, a], [, b]) => b.percentage - a.percentage)
    .slice(0, 3)
    .map(([location]) => location);

  const startDate = weeks[weeks.length - 1]?.weekRange.startDate;
  const endDate = weeks[0]?.weekRange.endDate;
  const reportPeriod = `${startDate?.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })} - ${endDate?.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })}`;

  return {
    reportPeriod,
    weeks: weeks.reverse(), // Most recent first
    summary: {
      totalWeeks: numberOfWeeks,
      locationsTracked,
      mostMissing,
      mostReliable,
      overallStats,
    },
  };
}

/**
 * Send email notification for missing submissions
 */
export async function sendMissingSubmissionsEmail(
  missingSubmissions: WeeklySubmissionStatus[],
  isTest = false,
  weekLabel?: string
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) {
    logger.log(
      'SendGrid not configured - would send email about missing submissions:',
      missingSubmissions.map((s) => s.location)
    );
    return false;
  }

  const { startDate } = getCurrentWeekRange();
  const weekOf =
    weekLabel ||
    startDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

  const missingLocations = missingSubmissions
    .filter((s) => !s.hasSubmitted)
    .map((s) => s.location);

  // For test emails, always send even if no missing locations
  if (missingLocations.length === 0 && !isTest) {
    logger.log('All locations have submitted - no email needed');
    return true;
  }

  const emailContent = {
    to: WEEKLY_MONITORING_RECIPIENT,
    from: FROM_EMAIL,
    subject: isTest
      ? `🧪 TEST EMAIL - Missing Sandwich Collection Numbers - Week of ${weekOf}`
      : `⚠️ Missing Sandwich Collection Numbers - Week of ${weekOf}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${
          isTest
            ? `
          <div style="background: #e3f2fd; border: 2px solid #1976d2; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
            <h3 style="color: #1976d2; margin: 0;">🧪 TEST EMAIL</h3>
            <p style="color: #1976d2; margin: 5px 0 0 0; font-weight: bold;">This is a test of the weekly monitoring email system with sample data</p>
          </div>
        `
            : ''
        }
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #236383; margin: 0; display: flex; align-items: center;">
            🥪 The Sandwich Project - Weekly Numbers Alert
          </h2>
          <p style="color: #666; margin: 10px 0 0 0;">Week of ${weekOf}</p>
        </div>

        <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
          <h3 style="color: #856404; margin: 0 0 10px 0;">⚠️ Missing Submissions</h3>
          <p style="color: #856404; margin: 0;">
            The following host locations haven't submitted their numbers yet:
          </p>
        </div>

        <ul style="background: white; border: 1px solid #ddd; border-radius: 6px; padding: 20px; margin: 20px 0;">
          ${missingLocations
            .map((location) => {
              const status = missingSubmissions.find(
                (s) => s.location === location
              );
              let specialNote = '';

              if (status?.dunwoodyStatus && location === 'Dunwoody/PTC') {
                const { complete } = status.dunwoodyStatus;
                if (!complete) {
                  specialNote =
                    ' (Need 2+ collection logs with individual sandwich counts)';
                }
              }

              return `<li style="margin: 8px 0; padding: 8px; background: #f8f9fa; border-radius: 4px;">
              <strong>${location}</strong>${specialNote}
            </li>`;
            })
            .join('')}
        </ul>

        <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 6px; padding: 15px; margin: 20px 0;">
          <h4 style="color: #155724; margin: 0 0 10px 0;">✅ Locations That Have Submitted</h4>
          ${
            missingSubmissions.filter((s) => s.hasSubmitted).length > 0
              ? `<ul style="margin: 0; padding-left: 20px;">
              ${missingSubmissions
                .filter((s) => s.hasSubmitted)
                .map((s) => {
                  let submitterInfo = '';
                  if (s.submittedBy && s.submittedBy.length > 0) {
                    submitterInfo = ` (by: ${s.submittedBy.join(', ')})`;
                  }

                  let specialNote = '';
                  if (s.dunwoodyStatus && s.location === 'Dunwoody/PTC') {
                    specialNote = ' ✓ Both required entries received';
                  }

                  return `<li style="color: #155724;">${s.location}${submitterInfo}${specialNote}</li>`;
                })
                .join('')}
            </ul>`
              : '<p style="color: #155724; margin: 0;">None yet this week</p>'
          }
        </div>

        <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin-top: 20px;">
          <p style="color: #666; margin: 0; font-size: 14px;">
            This automated alert is sent Thursday evenings and Friday mornings.<br>
            Check the Collections Log in the platform for real-time updates.
          </p>
        </div>
      </div>
    `,
    text: `${
      isTest
        ? '🧪 TEST EMAIL - This is a test of the weekly monitoring email system with sample data\n\n'
        : ''
    }The Sandwich Project - Weekly Numbers Alert
Week of ${weekOf}

MISSING SUBMISSIONS:
${missingLocations.map((location) => `- ${location}`).join('\n')}

SUBMITTED THIS WEEK:
${missingSubmissions
  .filter((s) => s.hasSubmitted)
  .map((s) => `- ${s.location}`)
  .join('\n')}

This automated alert is sent Thursday evenings and Friday mornings.
Check the Collections Log in the platform for real-time updates.
    `,
  };

  try {
    await mailService.send(withUnsubscribeSettings(emailContent, 'operational'));
    logger.log(
      `Missing submissions email sent successfully to ${WEEKLY_MONITORING_RECIPIENT}`
    );
    return true;
  } catch (error) {
    logger.error('Failed to send missing submissions email:', error);
    return false;
  }
}

/**
 * Main function to check submissions and send alerts if needed
 */
export async function runWeeklyMonitoring(): Promise<void> {
  logger.log('Running weekly sandwich submission monitoring...');

  try {
    const submissionStatus = await checkWeeklySubmissions();

    logger.log('Weekly submission status:');
    submissionStatus.forEach((status) => {
      logger.log(
        `- ${status.location}: ${
          status.hasSubmitted ? '✅ Submitted' : '❌ Missing'
        }`
      );
    });

    const missingSubmissions = submissionStatus.filter((s) => !s.hasSubmitted);

    if (missingSubmissions.length > 0) {
      await sendMissingSubmissionsEmail(submissionStatus);
    } else {
      logger.log('🎉 All host locations have submitted their numbers!');
    }
  } catch (error) {
    logger.error('Error in weekly monitoring:', error);

    // Send error notification email
    if (process.env.SENDGRID_API_KEY) {
      try {
        await mailService.send(withUnsubscribeSettings({
          to: WEEKLY_MONITORING_RECIPIENT,
          from: FROM_EMAIL,
          subject: '🚨 Sandwich Monitoring System Error',
          text: `The weekly sandwich submission monitoring system encountered an error:\n\n${error}\n\nPlease check the system logs.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 6px; padding: 15px;">
                <h3 style="color: #721c24;">🚨 Monitoring System Error</h3>
                <p>The weekly sandwich submission monitoring system encountered an error:</p>
                <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto;">${error}</pre>
                <p>Please check the system logs and ensure the monitoring system is functioning properly.</p>
              </div>
            </div>
          `,
        }, 'operational'));
      } catch (emailError) {
        logger.error('Failed to send error notification email:', emailError);
      }
    }
  }
}

/**
 * Schedule the monitoring to run at specific times
 * Call this function to set up the weekly monitoring schedule
 */
export function scheduleWeeklyMonitoring(): NodeJS.Timeout[] {
  const intervals: NodeJS.Timeout[] = [];

  // Function to check if it's the right time to run monitoring
  const checkAndRun = () => {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 4 = Thursday, 5 = Friday
    const hour = now.getHours();

    // Thursday evening (7 PM) or Friday morning (8 AM)
    const shouldRun = (day === 4 && hour === 19) || (day === 5 && hour === 8);

    if (shouldRun) {
      runWeeklyMonitoring();
    }
  };

  // Check every hour
  const hourlyCheck = setInterval(checkAndRun, 60 * 60 * 1000);
  intervals.push(hourlyCheck);

  logger.log('Weekly monitoring scheduled for Thursday 7 PM and Friday 8 AM');

  return intervals;
}

/**
 * Send friendly email reminder to a specific host location
 */
export async function sendEmailReminder(
  location: string,
  appUrl?: string
): Promise<{ success: boolean; message: string }> {
  if (!process.env.SENDGRID_API_KEY) {
    return {
      success: false,
      message: 'Email service not configured (SENDGRID_API_KEY missing)',
    };
  }

  try {
    // Special handling for Dunwoody - check if we have 2+ submissions with individual counts
    if (location === 'Dunwoody/PTC') {
      const currentStatus = await checkWeeklySubmissions(0);
      const dunwoodyStatus = currentStatus.find(
        (s) => s.location === 'Dunwoody/PTC'
      )?.dunwoodyStatus;

      if (dunwoodyStatus) {
        // If we have 2+ submissions with individual counts, no reminder needed
        if (dunwoodyStatus.complete) {
          return {
            success: true,
            message:
              'Dunwoody has 2+ collection logs with individual sandwich counts - no reminder needed',
          };
        }
        // Otherwise, send reminder to all Dunwoody contacts
        else {
          return await sendDunwoodyTargetedEmail(
            ['lisa', 'stephanie', 'marcy'],
            appUrl
          );
        }
      }
    }

    // Standard logic for other locations
    // Try to get email from fallback mapping first (more reliable)
    let contactEmail = LOCATION_CONTACT_EMAILS[location];
    let contactName = location; // Default to location name
    
    // If no fallback mapping, try database lookup
    if (!contactEmail) {
      // Get host contact information for this location
      // First find the host by name
      const hostRecord = await db
        .select()
        .from(hosts)
        .where(eq(hosts.name, location))
        .limit(1);

      if (hostRecord.length === 0) {
        return {
          success: false,
          message: `No host found for location: ${location} and no fallback email configured`,
        };
      }

      // Then get the primary contact for this host
      const contacts = await db
        .select()
        .from(hostContacts)
        .where(
          and(
            eq(hostContacts.hostId, hostRecord[0].id),
            eq(hostContacts.isPrimary, true)
          )
        )
        .limit(1);

      // If no primary contact, get any contact with an email
      let contact = contacts[0];
      if (!contact) {
        const allContacts = await db
          .select()
          .from(hostContacts)
          .where(eq(hostContacts.hostId, hostRecord[0].id));

        contact = allContacts.find((c) => c.email) || allContacts[0];
      }

      if (!contact) {
        return {
          success: false,
          message: `No contact person found for location: ${location}`,
        };
      }

      contactEmail = contact.email;
      contactName = contact.name || location;
      
      if (!contactEmail) {
        return {
          success: false,
          message: `No email address found for ${location} contact: ${contactName}`,
        };
      }
    }

    const loginUrl =
      appUrl ||
      'https://sandwich-project-platform-final-katielong2316.replit.app/';
    const previousWednesday = getPreviousWednesday();
    const weekLabel = previousWednesday.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const emailSubject = `🥪 Friendly Reminder: Weekly Sandwich Collection Numbers`;

    const emailText = `Hi ${contactName || 'there'}!

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
            <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.5;">Hi ${
              contactName || 'there'
            }!</p>
            
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

    await mailService.send(withUnsubscribeSettings({
      to: contactEmail,
      from: FROM_EMAIL,
      bcc: WEEKLY_MONITORING_RECIPIENT, // BCC admin on all host reminder emails
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    }, 'operational'));

    logger.log(
      `✅ Email reminder sent successfully to ${location} (${contactEmail})`
    );

    return {
      success: true,
      message: `Email reminder sent successfully to ${
        contactName || location
      } at ${contactEmail}`,
    };
  } catch (error) {
    logger.error(`❌ Failed to send email reminder to ${location}:`, error);
    return {
      success: false,
      message: `Failed to send email reminder: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}

/**
 * Send targeted email to specific Dunwoody submitters based on who's missing
 */
async function sendDunwoodyTargetedEmail(
  targetGroups: string[],
  appUrl?: string
): Promise<{ success: boolean; message: string }> {
  if (!process.env.SENDGRID_API_KEY) {
    return {
      success: false,
      message: 'Email service not configured (SENDGRID_API_KEY missing)',
    };
  }

  try {
    // Get all Dunwoody contacts
    const hostRecord = await db
      .select()
      .from(hosts)
      .where(eq(hosts.name, 'Dunwoody/PTC'))
      .limit(1);

    if (hostRecord.length === 0) {
      return {
        success: false,
        message: 'No Dunwoody/PTC host found',
      };
    }

    const allContacts = await db
      .select()
      .from(hostContacts)
      .where(eq(hostContacts.hostId, hostRecord[0].id));

    // Find contacts based on target groups
    const targetContacts = [];

    for (const group of targetGroups) {
      if (group === 'lisa') {
        const lisaContact = allContacts.find(
          (c) =>
            c.name?.toLowerCase().includes('lisa') &&
            c.name?.toLowerCase().includes('hiles') &&
            c.email
        );
        if (lisaContact) targetContacts.push(lisaContact);
      } else if (group === 'stephanie') {
        const stephanieContact = allContacts.find(
          (c) => c.name?.toLowerCase().includes('stephanie') && c.email
        );
        if (stephanieContact) targetContacts.push(stephanieContact);
      } else if (group === 'marcy') {
        const marcyContact = allContacts.find(
          (c) => c.name?.toLowerCase().includes('marcy') && c.email
        );
        if (marcyContact) targetContacts.push(marcyContact);
      }
    }

    // If no specific contacts found, fall back to primary contact
    if (targetContacts.length === 0) {
      const primaryContact =
        allContacts.find((c) => c.isPrimary && c.email) ||
        allContacts.find((c) => c.email);
      if (primaryContact) targetContacts.push(primaryContact);
    }

    if (targetContacts.length === 0) {
      return {
        success: false,
        message: 'No email contacts found for targeted Dunwoody reminder',
      };
    }

    const loginUrl =
      appUrl ||
      'https://sandwich-project-platform-final-katielong2316.replit.app/';
    const previousWednesday = getPreviousWednesday();
    const weekLabel = previousWednesday.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    // Send email to each target contact
    const emailPromises = targetContacts.map(async (contact) => {
      const emailSubject = `🥪 Friendly Reminder: Weekly Sandwich Collection Numbers`;

      const emailText = `Hi ${contact.name || 'there'}!

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
              <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.5;">Hi ${
                contact.name || 'there'
              }!</p>
              
              <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.5;">Hope you're having a great week! This is a friendly reminder that we haven't received your sandwich collection numbers for this week yet.</p>
              
              <div style="background: #e3f2fd; border-left: 4px solid #236383; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; font-weight: 600; color: #236383;">Collection Date: ${weekLabel}</p>
                <p style="margin: 5px 0 0 0; color: #6c757d; font-size: 14px;">Location: Dunwoody/PTC</p>
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

      return await mailService.send(withUnsubscribeSettings({
        to: contact.email!,
        from: FROM_EMAIL,
        bcc: WEEKLY_MONITORING_RECIPIENT, // BCC admin on all Dunwoody reminder emails
        subject: emailSubject,
        text: emailText,
        html: emailHtml,
      }, 'operational'));
    });

    // Send emails in batch (continues even if some fail)
    const emailResult = await batchSendEmails(
      emailPromises,
      'Targeted Dunwoody emails'
    );

    const contactNames = targetContacts.map((c) => c.name).join(', ');
    logger.log(
      `✅ Targeted Dunwoody emails processed: ${emailResult.successCount}/${emailResult.total} sent successfully`
    );

    // Log warning if some emails failed
    if (emailResult.failureCount > 0) {
      logger.warn(`${emailResult.failureCount} emails failed to send`, {
        failedIndices: emailResult.failed.map(f => f.index),
        failedContacts: emailResult.failed.map(f => {
          const contact = targetContacts[f.index];
          return contact
            ? { name: contact.name, email: contact.email }
            : { name: 'unknown', email: 'unknown' };
        }),
      });
    }

    return {
      success: true,
      message: `Targeted email sent successfully to: ${contactNames}`,
    };
  } catch (error) {
    logger.log(`❌ Failed to send targeted Dunwoody email:`, error);

    return {
      success: false,
      message: `Failed to send targeted email: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}
