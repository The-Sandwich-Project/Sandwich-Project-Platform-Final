import type { IStorage } from './storage';
import { GoogleSheetsSyncService } from './google-sheets-sync';
import { getEventRequestsGoogleSheetsService } from './google-sheets-event-requests-sync';
import { db } from './db.js';
import { sql, and, or, eq, lt, isNull, isNotNull } from 'drizzle-orm';
import { eventRequests } from '@shared/schema';
import { createServiceLogger } from './utils/logger.js';
import { logger } from './utils/production-safe-logger';
import { ADMIN_EMAIL } from './config/organization';
import { logApplicationError } from './services/application-error-logger';

const syncLogger = createServiceLogger('background-sync');

export class BackgroundSyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastSuccessfulSync: Date | null = null;
  private consecutiveFailures = 0;
  private consecutiveSkips = 0; // Track skipped syncs (e.g., stuck locks)
  private lastAlertSent: Date | null = null;
  private serviceStartTime: Date | null = null; // Track when service started
  private readonly ALERT_COOLDOWN_MINUTES = 60; // Don't spam emails - max one per hour
  private readonly FAILURE_THRESHOLD = 3; // Alert after 3 consecutive failures
  private readonly SKIP_THRESHOLD = 3; // Alert after 3 consecutive skips
  private readonly STALE_SYNC_THRESHOLD_MINUTES = 60; // Alert if no successful sync in 60 minutes (updated for 30-min sync interval)
  private readonly STARTUP_GRACE_PERIOD_MINUTES = 35; // Grace period before alerting on no initial sync (updated for 30-min sync interval)

  constructor(private storage: IStorage) {}

  /**
   * Start automatic background sync every 5 minutes
   * ✅ RE-ENABLED with permanent external_id blacklist protection
   */
  start() {
    if (this.isRunning) {
      logger.log('⚠ Background sync already running');
      return;
    }

    logger.log('🚀 Starting background Google Sheets sync service...');
    logger.log('🛡️ PROTECTED: Now using permanent external_id blacklist system');
    logger.log('🔒 GUARANTEE: External_ids will NEVER be imported twice, even after deletion');
    logger.log('🔄 CRITICAL: Sync will continue running even if individual syncs fail');
    this.isRunning = true;
    this.serviceStartTime = new Date();
    this.consecutiveSkips = 0;

    // Defer the initial sync by 45s after startup. This keeps the first
    // post-deploy minute focused on serving real user traffic — the heavy
    // sheet read + DB writes don't compete with cold-start request handling
    // or with Neon's serverless cold start. Recurring syncs (every 30 min)
    // are unaffected.
    const INITIAL_SYNC_DELAY_MS = 45 * 1000;
    logger.log(`⏳ Initial background sync deferred by ${INITIAL_SYNC_DELAY_MS / 1000}s to keep startup responsive`);
    setTimeout(() => {
      this.performSync()
        .then(() => {
          logger.log('✅ Initial background sync completed successfully');
          syncLogger.info('Initial background sync completed');
        })
        .catch((error) => {
          syncLogger.error('Initial background sync failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          logger.error('❌ Initial background sync failed:', error);
          logger.log('⚠️ Background sync service will continue running and retry on next interval');
          // CRITICAL: Don't stop the service - it will retry on the next interval
        });
    }, INITIAL_SYNC_DELAY_MS);

    // Set up recurring sync every 30 minutes (optimized for low-activity orgs)
    // CRITICAL: Use a wrapper that ensures sync continues even if errors occur
    this.syncInterval = setInterval(
      () => {
        this.performSync()
          .catch((error) => {
            syncLogger.error('Scheduled background sync failed', { error });
            logger.error('❌ Scheduled background sync failed:', error);
            // CRITICAL: Log but don't stop - sync will retry on next interval
            logger.log('⚠️ Background sync will retry on next interval (every 30 minutes)');
          })
          .finally(() => {
            // Ensure we always log that we're still running
            syncLogger.debug('Background sync cycle completed, will retry in 30 minutes');
            // Check for stale sync even if sync attempt failed
            this.checkStaleSync().catch(err => {
              logger.error('Error checking stale sync:', err);
            });
          });
      },
      30 * 60 * 1000
    ); // 30 minutes (reduced from 5 minutes for cost optimization)

    logger.log('✅ Background sync service started - syncing every 30 minutes with blacklist protection');
    logger.log('🔄 Sync will continue running even if individual syncs fail - errors are logged but service continues');
  }

  /**
   * Stop the background sync
   */
  async stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    const wasRunning = this.isRunning;
    this.isRunning = false;
    logger.log('🛑 Background sync service stopped');
    
    // Send alert if service was running and is being stopped
    if (wasRunning) {
      await this.sendServiceStoppedAlert();
    }
  }

  /**
   * Send email alert when sync service stops
   */
  private async sendServiceStoppedAlert() {
    try {
      const { sendEmail } = await import('./sendgrid');
      const adminEmail = ADMIN_EMAIL;
      
      const lastSuccessTime = this.lastSuccessfulSync 
        ? this.lastSuccessfulSync.toLocaleString()
        : 'Never';
      
      await sendEmail({
        emailStream: 'operational',
        to: adminEmail,
        from: process.env.SENDGRID_FROM_EMAIL || 'katie@thesandwichproject.org',
        subject: '🚨 CRITICAL: Event Requests Sync Service Stopped',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #d32f2f;">🚨 Event Requests Sync Service Stopped</h2>
            <p><strong>The background sync service has been stopped!</strong></p>
            <p>New event requests from Google Sheets will NOT be automatically imported until the service is restarted.</p>
            
            <div style="background-color: #ffebee; border-left: 4px solid #d32f2f; padding: 15px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #c62828;">Details:</h3>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li><strong>Service Status:</strong> Stopped</li>
                <li><strong>Last Successful Sync:</strong> ${lastSuccessTime}</li>
                <li><strong>Consecutive Failures:</strong> ${this.consecutiveFailures}</li>
                <li><strong>Stopped At:</strong> ${new Date().toLocaleString()}</li>
              </ul>
            </div>
            
            <p><strong>Action Required:</strong></p>
            <ol style="margin: 10px 0; padding-left: 20px;">
              <li>Restart the server to restart the sync service</li>
              <li>Or manually trigger syncs until service is restarted</li>
              <li>Check server logs to understand why service stopped</li>
              <li>Manually sync: <code>POST /api/event-requests/sync/from-sheets</code></li>
            </ol>
            
            <p style="color: #d32f2f; font-weight: bold; margin-top: 20px;">
              ⚠️ No new event requests will be imported automatically until the service is restarted!
            </p>
          </div>
        `,
        text: `
🚨 CRITICAL: Event Requests Sync Service Stopped

The background sync service has been stopped!

New event requests from Google Sheets will NOT be automatically imported until the service is restarted.

Details:
- Service Status: Stopped
- Last Successful Sync: ${lastSuccessTime}
- Consecutive Failures: ${this.consecutiveFailures}
- Stopped At: ${new Date().toLocaleString()}

Action Required:
1. Restart the server to restart the sync service
2. Or manually trigger syncs until service is restarted
3. Check server logs to understand why service stopped
4. Manually sync: POST /api/event-requests/sync/from-sheets

⚠️ No new event requests will be imported automatically until the service is restarted!
        `,
      });

      logger.error(`📧 Sent sync service stopped alert email to ${adminEmail}`);
      syncLogger.info('Sync service stopped alert sent');
    } catch (emailError) {
      logger.error('❌ Failed to send sync stopped alert email:', emailError);
      syncLogger.error('Failed to send stopped alert email', { error: emailError });
    }
  }

  /**
   * Perform sync for event requests only
   * Projects are no longer synced to Google Sheets - managed entirely in-app
   * NOTE: Advisory locks don't work well with Neon serverless connection pooling
   * Using in-memory locking for single-instance protection instead
   */
  private syncInProgress = false;
  
  private async performSync() {
    const startTime = Date.now();

    // Simple in-memory lock - works for single server instance
    if (this.syncInProgress) {
      syncLogger.debug('Background sync skipped - already in progress');
      return;
    }

    this.syncInProgress = true;
    
    try {
      syncLogger.info('Background sync starting');
      logger.log('📊 Starting automated background sync...');

      // Sync Event Requests from Google Sheets
      await this.syncEventRequests();

      // Auto-transition scheduled events to completed if their date has passed
      await this.autoTransitionPastEvents();

      const duration = Date.now() - startTime;
      syncLogger.info('Background sync completed successfully', {
        duration: `${duration}ms`
      });
      logger.log('✅ Background sync completed successfully');

    } catch (syncError) {
      const duration = Date.now() - startTime;
      syncLogger.error('Background sync failed during execution', {
        duration: `${duration}ms`,
        error: syncError instanceof Error ? syncError.message : String(syncError),
        stack: syncError instanceof Error ? syncError.stack : undefined
      });
      logger.error('❌ Background sync failed:', syncError);
      // CRITICAL: Don't rethrow - we want the service to keep running
      // The error is logged, and sync will retry on the next interval

    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Sync projects from Google Sheets (bidirectional sync with hash-based change detection)
   */
  private async syncProjects() {
    try {
      const projectSyncService = new GoogleSheetsSyncService(this.storage);
      const result = await projectSyncService.bidirectionalSync();

      if (result.success) {
        logger.log(
          `📋 Projects sync: ${result.updated || 0} updated, ${result.created || 0} created`
        );
      } else {
        logger.log('⚠ Projects sync skipped:', result.message);
      }
    } catch (error) {
      logger.error('❌ Projects sync error:', error);
    }
  }

  /**
   * Sync event requests from Google Sheets
   */
  private async syncEventRequests() {
    try {
      const eventRequestsSyncService = getEventRequestsGoogleSheetsService(
        this.storage
      );

      if (!eventRequestsSyncService) {
        logger.warn(
          '⚠ Event requests sync skipped: Google Sheets service not configured'
        );
        syncLogger.warn('Google Sheets service not available - check environment variables');
        return;
      }

      syncLogger.info('Starting event requests sync from Google Sheets');
      const result = await eventRequestsSyncService.syncFromGoogleSheets();

      if (result.success) {
        const created = result.created || 0;
        const updated = result.updated || 0;
        logger.log(
          `📝 Event requests sync: ${updated} skipped (existing), ${created} created`
        );
        syncLogger.info('Event requests sync completed', { created, updated });
        
        // Reset failure counter on success
        this.consecutiveFailures = 0;
        this.lastSuccessfulSync = new Date();
        
        if (created > 0) {
          logger.log(`✅ ${created} new event request(s) imported from Google Sheets`);
        }
      } else {
        this.consecutiveFailures++;
        logger.warn('⚠ Event requests sync returned failure:', result.message);
        syncLogger.warn('Event requests sync failed', { 
          message: result.message,
          consecutiveFailures: this.consecutiveFailures
        });
        
        // Check if we should send alert
        if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
          await this.sendFailureAlert(result.message || 'Unknown error');
        }
      }
    } catch (error) {
      // CRITICAL: Log error but don't throw - we want sync to continue on next interval
      this.consecutiveFailures++;
      logger.error('❌ Event requests sync error:', error);
      syncLogger.error('Event requests sync threw exception', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        consecutiveFailures: this.consecutiveFailures
      });
      
      // Check if we should send alert
      if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.sendFailureAlert(errorMessage);
      }
      
      // Don't rethrow - let the service continue running
    }
    
    // Check if sync is stale (no successful sync in threshold time)
    await this.checkStaleSync();
  }

  /**
   * Auto-transition scheduled events to completed if their date has passed
   * Events only transition the night after they end, not on the day of the event
   *
   * Uses direct database query to avoid storage layer mismatches
   */
  private async autoTransitionPastEvents() {
    try {
      syncLogger.info('Starting auto-transition of past events');

      // Calculate cutoff date: events should transition at start of day AFTER they occur
      // If event is Sept 30, it transitions Oct 1 at 00:00 (start of next day)
      // Use UTC to ensure timezone consistency with database
      const now = new Date();
      const cutoffDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      syncLogger.debug('Auto-transition cutoff calculation', {
        now: now.toISOString(),
        cutoffDate: cutoffDate.toISOString(),
        cutoffUTC: `${cutoffDate.getUTCFullYear()}-${String(cutoffDate.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getUTCDate()).padStart(2, '0')}`,
        explanation: 'Events with date < cutoffDate (strictly before today) will be transitioned to completed'
      });

      // Use direct database query to ensure we get authoritative data
      // WHERE logic:
      // 1. Must be in 'scheduled' status
      // 2. Event date must be in the past (Prefer scheduledEventDate, fallback to desiredEventDate)
      // Use strict lt (<) not lte (<=) to prevent same-day transitions
      const transitionedEvents = await db
        .update(eventRequests)
        .set({
          status: 'completed',
          updatedAt: now
        })
        .where(
          and(
            or(
              eq(eventRequests.status, 'scheduled'),
              eq(eventRequests.status, 'rescheduled')
            ),
            or(
              and(isNotNull(eventRequests.scheduledEventDate), lt(eventRequests.scheduledEventDate, cutoffDate)),
              and(isNull(eventRequests.scheduledEventDate), lt(eventRequests.desiredEventDate, cutoffDate))
            )
          )
        )
        .returning({
          id: eventRequests.id,
          organizationName: eventRequests.organizationName,
          scheduledEventDate: eventRequests.scheduledEventDate,
          desiredEventDate: eventRequests.desiredEventDate,
        });
      
      if (transitionedEvents.length > 0) {
        logger.log(`🗓️ Auto-transitioned ${transitionedEvents.length} past events from scheduled to completed`);
        syncLogger.info('Auto-transition completed', {
          transitionedCount: transitionedEvents.length,
          events: transitionedEvents.map(e => ({
            id: e.id,
            organizationName: e.organizationName,
            scheduledEventDate: e.scheduledEventDate,
            desiredEventDate: e.desiredEventDate
          }))
        });
      } else {
        syncLogger.debug('No past events found to transition');
      }
      
    } catch (error) {
      syncLogger.error('Auto-transition of past events failed', { error });
      logger.error('❌ Auto-transition of past events failed:', error);
    }
  }

  /**
   * Check if sync is stale and send alert if needed
   * Also checks if sync has NEVER completed after the startup grace period
   */
  private async checkStaleSync() {
    const shouldAlert = !this.lastAlertSent || 
      (Date.now() - this.lastAlertSent.getTime()) > (this.ALERT_COOLDOWN_MINUTES * 60 * 1000);
    
    if (!shouldAlert) {
      return; // Still in cooldown period
    }

    // Check if sync has NEVER completed after grace period
    if (!this.lastSuccessfulSync && this.serviceStartTime) {
      const minutesSinceStart = (Date.now() - this.serviceStartTime.getTime()) / (1000 * 60);
      
      if (minutesSinceStart > this.STARTUP_GRACE_PERIOD_MINUTES) {
        await this.sendNoSyncEverAlert(minutesSinceStart);
        return;
      }
    }

    // Check if last successful sync is stale
    if (this.lastSuccessfulSync) {
      const minutesSinceLastSuccess = (Date.now() - this.lastSuccessfulSync.getTime()) / (1000 * 60);
      
      if (minutesSinceLastSuccess > this.STALE_SYNC_THRESHOLD_MINUTES) {
        await this.sendStaleSyncAlert(minutesSinceLastSuccess);
      }
    }
  }

  /**
   * Send alert when sync has NEVER completed after startup
   * This catches stuck locks, configuration issues, etc.
   */
  private async sendNoSyncEverAlert(minutesSinceStart: number) {
    try {
      const { sendEmail } = await import('./sendgrid');
      const adminEmail = ADMIN_EMAIL;
      
      await sendEmail({
        emailStream: 'operational',
        to: adminEmail,
        from: process.env.SENDGRID_FROM_EMAIL || 'katie@thesandwichproject.org',
        subject: '🚨 CRITICAL: Event Requests Sync Has Never Completed',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #d32f2f;">🚨 Event Requests Sync Has Never Completed</h2>
            <p><strong>The background sync has been running for ${Math.round(minutesSinceStart)} minutes but has NEVER successfully synced!</strong></p>
            <p>This usually indicates a serious configuration issue or stuck process.</p>
            
            <div style="background-color: #ffebee; border-left: 4px solid #d32f2f; padding: 15px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #c62828;">Details:</h3>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li><strong>Service Started:</strong> ${this.serviceStartTime?.toLocaleString()}</li>
                <li><strong>Minutes Since Start:</strong> ${Math.round(minutesSinceStart)}</li>
                <li><strong>Consecutive Failures:</strong> ${this.consecutiveFailures}</li>
                <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
              </ul>
            </div>
            
            <p><strong>Possible Causes:</strong></p>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Google Sheets API credentials invalid or expired</li>
              <li>Database connection issues</li>
              <li>Stuck database locks (common with serverless databases)</li>
              <li>Google Sheet ID incorrect or sheet deleted</li>
            </ul>
            
            <p><strong>Action Required:</strong></p>
            <ol style="margin: 10px 0; padding-left: 20px;">
              <li>Check server logs for detailed error information</li>
              <li>Restart the server to clear any stuck processes</li>
              <li>Verify Google Sheets API credentials</li>
              <li>Check sync status via: <code>GET /api/event-requests/sync/status</code></li>
            </ol>
            
            <p style="color: #d32f2f; font-weight: bold; margin-top: 20px;">
              ⚠️ No new event requests are being imported until this is fixed!
            </p>
          </div>
        `,
        text: `
🚨 CRITICAL: Event Requests Sync Has Never Completed

The background sync has been running for ${Math.round(minutesSinceStart)} minutes but has NEVER successfully synced!

Details:
- Service Started: ${this.serviceStartTime?.toLocaleString()}
- Minutes Since Start: ${Math.round(minutesSinceStart)}
- Consecutive Failures: ${this.consecutiveFailures}

Possible Causes:
- Google Sheets API credentials invalid or expired
- Database connection issues
- Stuck database locks
- Google Sheet ID incorrect

Action Required:
1. Check server logs for detailed error information
2. Restart the server to clear any stuck processes
3. Verify Google Sheets API credentials

⚠️ No new event requests are being imported until this is fixed!
        `,
      });

      this.lastAlertSent = new Date();
      logger.error(`📧 Sent no-sync-ever alert email to ${adminEmail}`);
      logApplicationError({
        source: 'sync',
        severity: 'critical',
        category: 'google_sheets',
        message: `Event requests sync has never completed (${Math.round(minutesSinceStart)} min since startup)`,
        details: { consecutiveFailures: this.consecutiveFailures, minutesSinceStart },
        notifyAdmin: false,
      });
      syncLogger.info('No sync ever alert sent', { 
        minutesSinceStart,
        consecutiveFailures: this.consecutiveFailures
      });
    } catch (emailError) {
      logger.error('❌ Failed to send no-sync-ever alert email:', emailError);
      syncLogger.error('Failed to send no-sync-ever alert email', { error: emailError });
    }
  }

  /**
   * Send email alert when sync fails multiple times
   */
  private async sendFailureAlert(errorMessage: string) {
    const shouldAlert = !this.lastAlertSent || 
      (Date.now() - this.lastAlertSent.getTime()) > (this.ALERT_COOLDOWN_MINUTES * 60 * 1000);
    
    if (!shouldAlert) {
      return; // Still in cooldown period
    }

    try {
      const { sendEmail } = await import('./sendgrid');
      const adminEmail = ADMIN_EMAIL;
      
      const lastSuccessTime = this.lastSuccessfulSync 
        ? this.lastSuccessfulSync.toLocaleString()
        : 'Never';
      
      await sendEmail({
        emailStream: 'operational',
        to: adminEmail,
        from: process.env.SENDGRID_FROM_EMAIL || 'katie@thesandwichproject.org',
        subject: '🚨 CRITICAL: Event Requests Sync Failing',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #d32f2f;">🚨 Event Requests Sync Alert</h2>
            <p><strong>The background sync for event requests from Google Sheets is failing!</strong></p>
            
            <div style="background-color: #ffebee; border-left: 4px solid #d32f2f; padding: 15px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #c62828;">Details:</h3>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li><strong>Consecutive Failures:</strong> ${this.consecutiveFailures}</li>
                <li><strong>Last Successful Sync:</strong> ${lastSuccessTime}</li>
                <li><strong>Error:</strong> ${errorMessage}</li>
                <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
              </ul>
            </div>
            
            <p><strong>Action Required:</strong></p>
            <ol style="margin: 10px 0; padding-left: 20px;">
              <li>Check server logs for detailed error information</li>
              <li>Verify Google Sheets API credentials are valid</li>
              <li>Check if Google Sheet structure has changed</li>
              <li>Manually trigger sync via: <code>POST /api/event-requests/sync/from-sheets</code></li>
              <li>Check sync status via: <code>GET /api/event-requests/sync/status</code></li>
            </ol>
            
            <p style="color: #666; font-size: 0.9em; margin-top: 30px;">
              This alert will not be sent again for ${this.ALERT_COOLDOWN_MINUTES} minutes unless the issue persists.
            </p>
          </div>
        `,
        text: `
🚨 CRITICAL: Event Requests Sync Failing

The background sync for event requests from Google Sheets is failing!

Details:
- Consecutive Failures: ${this.consecutiveFailures}
- Last Successful Sync: ${lastSuccessTime}
- Error: ${errorMessage}
- Time: ${new Date().toLocaleString()}

Action Required:
1. Check server logs for detailed error information
2. Verify Google Sheets API credentials are valid
3. Check if Google Sheet structure has changed
4. Manually trigger sync via: POST /api/event-requests/sync/from-sheets
5. Check sync status via: GET /api/event-requests/sync/status

This alert will not be sent again for ${this.ALERT_COOLDOWN_MINUTES} minutes unless the issue persists.
        `,
      });

      this.lastAlertSent = new Date();
      logger.error(`📧 Sent sync failure alert email to ${adminEmail}`);
      logApplicationError({
        source: 'sync',
        severity: 'critical',
        category: 'google_sheets',
        message: `Event requests sync failing (${this.consecutiveFailures} consecutive failures)`,
        details: { errorMessage, consecutiveFailures: this.consecutiveFailures },
        notifyAdmin: false,
      });
      syncLogger.info('Sync failure alert sent', { 
        consecutiveFailures: this.consecutiveFailures,
        errorMessage 
      });
    } catch (emailError) {
      logger.error('❌ Failed to send sync failure alert email:', emailError);
      syncLogger.error('Failed to send alert email', { error: emailError });
    }
  }

  /**
   * Send email alert when sync hasn't run successfully in a while
   */
  private async sendStaleSyncAlert(minutesSinceLastSuccess: number) {
    try {
      const { sendEmail } = await import('./sendgrid');
      const adminEmail = ADMIN_EMAIL;
      
      const lastSuccessTime = this.lastSuccessfulSync 
        ? this.lastSuccessfulSync.toLocaleString()
        : 'Never';
      
      await sendEmail({
        emailStream: 'operational',
        to: adminEmail,
        from: process.env.SENDGRID_FROM_EMAIL || 'katie@thesandwichproject.org',
        subject: '⚠️ WARNING: Event Requests Sync Stale',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #f57c00;">⚠️ Event Requests Sync Stale</h2>
            <p><strong>The background sync hasn't completed successfully in ${Math.round(minutesSinceLastSuccess)} minutes.</strong></p>
            
            <div style="background-color: #fff3e0; border-left: 4px solid #f57c00; padding: 15px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #e65100;">Details:</h3>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li><strong>Last Successful Sync:</strong> ${lastSuccessTime}</li>
                <li><strong>Time Since Last Success:</strong> ${Math.round(minutesSinceLastSuccess)} minutes</li>
                <li><strong>Consecutive Failures:</strong> ${this.consecutiveFailures}</li>
                <li><strong>Sync Service Running:</strong> ${this.isRunning ? 'Yes' : 'No'}</li>
                <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
              </ul>
            </div>
            
            <p><strong>Action Required:</strong></p>
            <ol style="margin: 10px 0; padding-left: 20px;">
              <li>Check if sync service is still running</li>
              <li>Review recent server logs for errors</li>
              <li>Check sync status: <code>GET /api/event-requests/sync/status</code></li>
              <li>Manually trigger sync: <code>POST /api/event-requests/sync/from-sheets</code></li>
            </ol>
            
            <p style="color: #666; font-size: 0.9em; margin-top: 30px;">
              This alert will not be sent again for ${this.ALERT_COOLDOWN_MINUTES} minutes unless the issue persists.
            </p>
          </div>
        `,
        text: `
⚠️ WARNING: Event Requests Sync Stale

The background sync hasn't completed successfully in ${Math.round(minutesSinceLastSuccess)} minutes.

Details:
- Last Successful Sync: ${lastSuccessTime}
- Time Since Last Success: ${Math.round(minutesSinceLastSuccess)} minutes
- Consecutive Failures: ${this.consecutiveFailures}
- Sync Service Running: ${this.isRunning ? 'Yes' : 'No'}
- Time: ${new Date().toLocaleString()}

Action Required:
1. Check if sync service is still running
2. Review recent server logs for errors
3. Check sync status: GET /api/event-requests/sync/status
4. Manually trigger sync: POST /api/event-requests/sync/from-sheets

This alert will not be sent again for ${this.ALERT_COOLDOWN_MINUTES} minutes unless the issue persists.
        `,
      });

      this.lastAlertSent = new Date();
      logger.warn(`📧 Sent stale sync alert email to ${adminEmail}`);
      logApplicationError({
        source: 'sync',
        severity: 'error',
        category: 'google_sheets',
        message: `Event requests sync stale (${Math.round(minutesSinceLastSuccess)} min since last success)`,
        details: {
          minutesSinceLastSuccess,
          consecutiveFailures: this.consecutiveFailures,
        },
        notifyAdmin: false,
      });
      syncLogger.info('Stale sync alert sent', { 
        minutesSinceLastSuccess,
        consecutiveFailures: this.consecutiveFailures
      });
    } catch (emailError) {
      logger.error('❌ Failed to send stale sync alert email:', emailError);
      syncLogger.error('Failed to send stale alert email', { error: emailError });
    }
  }

  /**
   * Get sync status
   */
  getStatus() {
    const minutesSinceLastSuccess = this.lastSuccessfulSync
      ? Math.round((Date.now() - this.lastSuccessfulSync.getTime()) / (1000 * 60))
      : null;

    return {
      isRunning: this.isRunning,
      nextSyncIn: this.syncInterval ? '5 minutes' : 'Not scheduled',
      lastSuccessfulSync: this.lastSuccessfulSync?.toISOString() || null,
      minutesSinceLastSuccess,
      consecutiveFailures: this.consecutiveFailures,
      isHealthy: this.isRunning && 
        this.lastSuccessfulSync !== null && 
        minutesSinceLastSuccess !== null && 
        minutesSinceLastSuccess < this.STALE_SYNC_THRESHOLD_MINUTES,
    };
  }
}

// Global instance
let backgroundSyncService: BackgroundSyncService | null = null;

export function startBackgroundSync(storage: IStorage) {
  if (!backgroundSyncService) {
    backgroundSyncService = new BackgroundSyncService(storage);
  }
  backgroundSyncService.start();
  return backgroundSyncService;
}

export async function stopBackgroundSync() {
  if (backgroundSyncService) {
    await backgroundSyncService.stop();
  }
}

export function getBackgroundSyncService() {
  return backgroundSyncService;
}
