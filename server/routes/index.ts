import { Router } from 'express';
// Import organized feature routers from feature-first folders
import usersRouter from './users';
import createAuthRouter from './auth'; // New consolidated auth router
import createProjectRoutes from './projects';
import createAdminRoutes from './core/admin';
import createGroupsCatalogRoutes from './collections/groups-catalog';
import tasksRouter from './tasks';
import collectionsRouter from './collections';
import recipientsRouter from './recipients';
import createMeetingsRouter from './meetings/index';
import meetingNotesRouter from './meeting-notes';
import messagingRouter from './messaging';
import instantMessagesRouter from './instant-messages';
import eventRequestsRouter from './event-requests';
import { createMigrateContactAttemptsRoutes } from './migrate-contact-attempts';
import { createEventCollaborationRouter } from './event-collaboration';
import { createEventPostEventNotesRouter } from './event-post-event-notes';
import eventMapRouter from './event-map';
import directionsRouter from './directions';
import mapTilesRouter from './map-tiles';
import importCollectionsRouter from './import-collections';
import notificationsRouter from './notifications';
import mobileRouter from './mobile';
import reportsRouter from './reports';
import searchRouter from './search';
import { createSmartSearchRouter } from './smart-search';
import { SmartSearchService } from '../services/smart-search.service';
import storageRouter from './storage';
import documentsRouter from './documents';
import resourcesRouter from './resources';
import autoFormFillerRouter from './auto-form-filler';
import versioningRouter from './versioning';
import coreRouter from './core';
import meRouter from './me';
import availabilityRouter from './availability';
import createAgendaItemsRouter from '../routes/agenda-items';
import { createActivityLogRoutes } from './activity-log';
import { smsUserRoutes, smsWebhookRoutes } from './sms-users';
import { smsTestingRoutes } from './sms-testing';
import { smsAnnouncementRoutes } from './sms-announcement';
import quickSmsRouter from './quick-sms';
import monitoringRouter from './monitoring';
import enhancedActivityRouter from './enhanced-user-activity';
import { wishlistSuggestionsRouter, wishlistActivityRouter } from './wishlist';
import { streamRoutes } from './stream';
import { coolerTypesRouter, coolerInventoryRouter } from './coolers';
import teamBoardRouter from './team-board';
import yearlyCalendarRouter from './yearly-calendar';
import trackedCalendarRouter from './tracked-calendar';
import holdingZoneCategoriesRouter from './holding-zone-categories';
import { createHoldingZoneCollaborationRouter } from './holding-zone-collaboration';
import { promotionGraphicsRouter } from './promotion-graphics';
import migrationsRouter from './migrations';
import { createDashboardDocumentsRoutes } from './dashboard-documents';
import { createDriversRouter } from './drivers';
import { createVolunteersRouter } from './volunteers';
import { createHostsRouter } from './hosts';
import { createEventRemindersRouter } from './event-reminders';
import eventCheckInRemindersRouter from './event-check-in-reminders';
import { createEmailRouter } from './email-routes';
import { createEmailDraftsRouter } from './email-drafts';
import { createMobileDashboardRouter } from './mobile-dashboard';
import { createAdminMigrationsRouter } from './admin-migrations';
import { createAdminEventsRouter } from './admin-events';
import { createOnboardingRouter } from './onboarding';
import { createGoogleSheetsRouter } from './google-sheets';
import { createGoogleCalendarRouter } from './google-calendar';
import { createPlanningSheetProposalsRouter } from './planning-sheet-proposals';
import { createPlanningSheetImportRouter } from './planning-sheet-import';
import { createRouteOptimizationRouter } from './routes';
import { createRecipientTspContactsRouter } from './recipient-tsp-contacts';
import { createSandwichDistributionsRouter } from './sandwich-distributions';
import { createImportEventsRouter } from './import-events';
import { createDataManagementRouter } from './data-management';
import { createPasswordResetRouter } from './password-reset';
import { createMessageNotificationsRouter } from './message-notifications';
import { createAnnouncementsRouter } from './announcements';
import { createPerformanceRouter } from './performance';
import { createAuditLogsRouter } from './audit-logs';
import { createMeaningfulAnalyticsRouter } from './meaningful-analytics';
import { createApiDocsRouter } from './api-docs';
import featureFlagsRouter from './feature-flags';
import activitiesRouter from './activities';
import expensesRouter from './expenses';
import objectsRouter from './objects';
import serviceHoursRouter from './service-hours';
import { impactReportsRouter } from './impact-reports';
import { predictionsRouter } from './predictions';
import { aiChatRouter } from './ai-chat';
import { aiAnalystRouter } from './ai-analyst';
import { createAlertRequestsRouter, createAIAlertRouter } from './alert-requests';
import { createAppSettingsRouter } from './app-settings';
import { createNavUserViewRouter } from './nav-user-view';
import { createCollectionFavoritesRouter } from './collection-favorites';
import { createGroupEngagementRoutes } from './group-engagement';
import { createOrganizationsAdminRoutes } from './organizations-admin';
import peopleSearchRouter from './people-search';
import photoScannerRouter from './photo-scanner';
import { createEmailTemplatesRouter } from './email-templates';
import { createUserEmailTemplatesRouter, createEventEmailRouter } from './user-email-templates';
import volunteerEventHubRouter from './volunteer-event-hub';
import { createEventContactsRouter } from './event-contacts';
import { createPermissionRequestsRouter } from './permission-requests';
import hostResourcesRouter from './host-resources';
import { apiKeysRouter } from './api-keys';
import { apiKeyAuth, requireApiKeyOrSession, apiKeyReadOnly } from '../middleware/api-key-auth';
import externalEventRequestsRouter from './external-event-requests';

// Import centralized middleware
import {
  createStandardMiddleware,
  createErrorHandler,
  createPublicMiddleware,
} from '../middleware';
import { logger } from '../utils/production-safe-logger';
import { createErrorLogsRoutes } from './error-logs';
import { createUserIssueReportsRoutes } from './user-issue-reports';
import workLogsRouter from './work-logs';
import shoutoutsRouter from './shoutouts';
import { RouterDependencies } from '../types';
import { createPageProxyHandler } from './page-proxy';

export function createMainRoutes(deps: RouterDependencies) {
  const router = Router();

  // Initialize Smart Search Service
  const smartSearchService = new SmartSearchService(process.env.OPENAI_API_KEY);
  smartSearchService.loadIndex().catch(err => {
    console.error('Failed to load smart search index:', err);
  });

  // ========================================================================
  // CRITICAL: Twilio SMS webhooks - MUST be registered FIRST (before any auth)
  // These endpoints use Twilio signature validation instead of user authentication
  // ========================================================================
  // Add debug logging for ALL requests to /api/sms/* to catch Twilio webhooks
  // Use logger.info() so it appears in production Winston logs
  router.use('/api/sms', (req, res, next) => {
    logger.info(`🔍 DEBUG: Request to /api/sms${req.path} - Method: ${req.method}`);
    logger.info(`🔍 DEBUG: Full URL: ${req.originalUrl}`);
    logger.info(`🔍 DEBUG: Headers: ${JSON.stringify(req.headers)}`);
    next();
  });
  
  router.use(
    '/api',
    ...createPublicMiddleware(),
    smsWebhookRoutes
  );

  // ==============================================================================
  // CRITICAL: Google Sheets webhook - MUST be registered FIRST (before any auth)
  // This endpoint receives new event requests pushed from Google Apps Script
  // ==============================================================================
  router.post('/api/webhook/new-event-request', async (req, res) => {
    const WEBHOOK_SECRET = process.env.SHEETS_WEBHOOK_SECRET;

    // Verify the secret
    const providedSecret = req.headers['x-webhook-secret'] || req.body?.secret;

    if (!WEBHOOK_SECRET || providedSecret !== WEBHOOK_SECRET) {
      logger.warn('Google Sheets webhook called with invalid secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { rowIndex, rowData } = req.body;

      logger.info(`📥 Webhook received for new event request from row ${rowIndex}`);

      if (!rowData) {
        return res.status(400).json({ error: 'No rowData provided' });
      }

      // Get the sync service and process the new event request
      const { getEventRequestsGoogleSheetsService } = await import('../google-sheets-event-requests-sync');
      const { storage } = await import('../storage-wrapper');

      const syncService = getEventRequestsGoogleSheetsService(storage as any);

      if (!syncService) {
        logger.error('Google Sheets sync service not available');
        return res.status(500).json({ error: 'Sync service not configured' });
      }

      // Trigger a sync from Google Sheets to pick up the new row
      const result = await syncService.syncFromGoogleSheets();

      logger.info(`✅ Webhook sync complete: ${result.created || 0} created, ${result.updated || 0} updated`);

      res.json({
        success: true,
        message: 'Event request processed',
        created: result.created || 0,
        updated: result.updated || 0
      });
    } catch (error) {
      logger.error('Google Sheets webhook processing failed:', error);
      const { logFromException } = await import('../services/application-error-logger');
      logFromException(error, {
        source: 'sync',
        severity: 'error',
        category: 'google_sheets_webhook',
        context: 'Google Sheets webhook processing failed',
        requestPath: '/api/google-sheets/webhook',
        notifyAdmin: true,
      });
      res.status(500).json({
        error: 'Processing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ========================================================================
  // AUTHENTICATION - Single consolidated auth router
  // ========================================================================
  const authRouter = createAuthRouter();
  router.use('/api/auth', authRouter);

  // ========================================================================
  // PASSWORD RESET - MUST be registered early (before authenticated routes)
  // These are public endpoints that don't require authentication
  // ========================================================================
  const passwordResetRouter = createPasswordResetRouter(deps);
  router.use(
    '/api',
    ...createPublicMiddleware(),
    passwordResetRouter
  );

  // ========================================================================
  // API KEY AUTHENTICATION - Extract API key from Authorization header
  // ========================================================================
  router.use(apiKeyAuth);

  // API Keys management routes (admin only)
  router.use('/api/api-keys', apiKeysRouter);

  // ========================================================================
  // API KEY ACCESS TO EVENT REQUESTS - External apps can access via API key
  // Supports GET (view) and PATCH (update) based on API key permissions
  // Used by Intake Workflow App to pull assigned events and push intake data
  // ========================================================================
  router.use(
    '/api/external/event-requests',
    requireApiKeyOrSession,
    apiKeyReadOnly,
    ...createStandardMiddleware(),
    externalEventRequestsRouter
  );
  router.use('/api/external/event-requests', createErrorHandler('external-event-requests'));

  // Legacy routes - preserve existing functionality
  const adminRoutes = createAdminRoutes({
    isAuthenticated: deps.isAuthenticated,
    requirePermission: deps.requirePermission,
    sessionStore: deps.sessionStore,
  });
  router.use('/api', adminRoutes);

  const groupsCatalogRoutes = createGroupsCatalogRoutes({
    isAuthenticated: deps.isAuthenticated,
  });
  router.use('/api/groups-catalog', groupsCatalogRoutes);

  const organizationsAdminRoutes = createOrganizationsAdminRoutes({
    isAuthenticated: deps.isAuthenticated,
    requirePermission: deps.requirePermission,
  });
  router.use('/api/organizations-admin', organizationsAdminRoutes);

  // New organized feature routes with consistent middleware
  // Core application routes (health checks, session management)
  router.use('/api', coreRouter);

  // Feature-based routes with standardized middleware
  router.use(
    '/api/users',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    usersRouter
  );
  router.use('/api/users', createErrorHandler('users'));

  // Instantiate projects router with required dependencies
  const projectsRouter = createProjectRoutes({
    storage: deps.storage,
    isAuthenticated: deps.isAuthenticated,
    requirePermission: deps.requirePermission,
  });
  router.use(
    '/api/projects',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    projectsRouter
  );
  router.use('/api/projects', createErrorHandler('projects'));

  // Instantiate meetings router with required dependencies
  const meetingsRouter = createMeetingsRouter(deps);

  router.use(
    '/api/tasks',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    tasksRouter
  );
  router.use('/api/tasks', createErrorHandler('tasks'));

  router.use(
    '/api/sandwich-collections',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    collectionsRouter
  );
  router.use('/api/sandwich-collections', createErrorHandler('collections'));

  // Photo scanner for sign-in sheets (uses vision AI to extract collection data)
  router.use(
    '/api/photo-scanner',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    photoScannerRouter
  );
  router.use('/api/photo-scanner', createErrorHandler('photo-scanner'));

  router.use(
    '/api/recipients',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    recipientsRouter
  );
  router.use('/api/recipients', createErrorHandler('recipients'));

  router.use(
    '/api/availability',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    availabilityRouter
  );
  router.use('/api/availability', createErrorHandler('availability'));

  // Dashboard documents configuration
  const dashboardDocumentsRouter = createDashboardDocumentsRoutes(
    deps.isAuthenticated,
    deps.requirePermission,
    deps.storage
  );
  router.use(
    '/api/dashboard-documents',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    dashboardDocumentsRouter
  );
  router.use('/api/dashboard-documents', createErrorHandler('dashboard-documents'));

  router.use(
    '/api/import-collections',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    importCollectionsRouter
  );
  router.use(
    '/api/import-collections',
    createErrorHandler('import-collections')
  );

  // Mount meetings routes with multiple paths to match existing routes
  router.use(
    '/api/meeting-minutes',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    meetingsRouter
  );
  router.use('/api/meeting-minutes', createErrorHandler('meetings'));

  // Setup agenda items router
  const agendaItemsRouter = createAgendaItemsRouter(
    deps.isAuthenticated,
    deps.storage
  );

  router.use(
    '/api/agenda-items',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    agendaItemsRouter
  );
  router.use('/api/agenda-items', createErrorHandler('agenda-items'));

  router.use(
    '/api/current-meeting',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    meetingsRouter
  );
  router.use('/api/current-meeting', createErrorHandler('meetings'));

  router.use(
    '/api/meetings',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    meetingsRouter
  );
  router.use('/api/meetings', createErrorHandler('meetings'));

  router.use(
    '/api/meeting-notes',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    meetingNotesRouter
  );
  router.use('/api/meeting-notes', createErrorHandler('meeting-notes'));

  router.use(
    '/api/drive-links',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    meetingsRouter
  );
  router.use('/api/drive-links', createErrorHandler('meetings'));

  router.use(
    '/api/files',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    meetingsRouter
  );
  router.use('/api/files', createErrorHandler('meetings'));

  router.use(
    '/api/messaging',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    messagingRouter
  );
  router.use('/api/messaging', createErrorHandler('messaging'));

  router.use(
    '/api/instant-messages',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    instantMessagesRouter
  );
  router.use('/api/instant-messages', createErrorHandler('instant-messages'));

  router.use(
    '/api/notifications',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    notificationsRouter
  );
  router.use('/api/notifications', createErrorHandler('notifications'));

  router.use(
    '/api/mobile',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    mobileRouter
  );
  router.use('/api/mobile', createErrorHandler('mobile'));

  // Permission requests - allow users to request access to features
  const permissionRequestsRouter = createPermissionRequestsRouter(deps);
  router.use(
    '/api/permission-requests',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    permissionRequestsRouter
  );
  router.use('/api/permission-requests', createErrorHandler('permission-requests'));

  router.use(
    '/api/reports',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    reportsRouter
  );
  router.use('/api/reports', createErrorHandler('reports'));

  router.use(
    '/api/search',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    searchRouter
  );
  router.use('/api/search', createErrorHandler('search'));

  // People search - unified search across all contact databases
  router.use(
    '/api/people',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    peopleSearchRouter
  );
  router.use('/api/people', createErrorHandler('people-search'));

  // Smart Search - AI-powered app navigation
  const smartSearchRouter = createSmartSearchRouter(smartSearchService);
  router.use(
    '/api/smart-search',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    smartSearchRouter
  );
  router.use('/api/smart-search', createErrorHandler('smart-search'));

  router.use(
    '/api/storage',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    storageRouter
  );
  router.use('/api/storage', createErrorHandler('storage'));

  router.use(
    '/api/objects',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    objectsRouter
  );
  router.use('/api/objects', createErrorHandler('objects'));

  router.use(
    '/api/documents',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    documentsRouter
  );
  router.use('/api/documents', createErrorHandler('documents'));

  router.use(
    '/api/resources',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    resourcesRouter
  );
  router.use('/api/resources', createErrorHandler('resources'));

  // Host Resources - manageable reference materials for host resources page
  router.use(
    '/api/host-resources',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    hostResourcesRouter
  );
  router.use('/api/host-resources', createErrorHandler('host-resources'));

  router.get('/api/proxy/page', deps.isAuthenticated, createPageProxyHandler());

  router.use(
    '/api/auto-form-filler',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    autoFormFillerRouter
  );
  router.use('/api/auto-form-filler', createErrorHandler('auto-form-filler'));

  router.use(
    '/api/versioning',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    versioningRouter
  );
  router.use('/api/versioning', createErrorHandler('versioning'));

  // Activity log router
  const activityLogRouter = createActivityLogRoutes(deps.storage);
  router.use(
    '/api/activity-log',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    activityLogRouter
  );
  router.use('/api/activity-log', createErrorHandler('activity-log'));
  
  // Alias for plural form (used by some client components)
  router.use(
    '/api/activity-logs',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    activityLogRouter
  );
  router.use('/api/activity-logs', createErrorHandler('activity-logs'));

  // Audit logs router
  const auditLogsRouter = createAuditLogsRouter(deps);
  router.use(
    '/api/audit-logs',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    auditLogsRouter
  );
  router.use('/api/audit-logs', createErrorHandler('audit-logs'));

  // Impact analytics for User Management → Impact tab
  router.use(
    '/api/meaningful-analytics',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    createMeaningfulAnalyticsRouter()
  );
  router.use(
    '/api/meaningful-analytics',
    createErrorHandler('meaningful-analytics')
  );

  // Feature Flags router (for gradual rollout)
  router.use(
    '/api/feature-flags',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    featureFlagsRouter
  );
  router.use('/api/feature-flags', createErrorHandler('feature-flags'));

  // Activities router (unified task + communication system)
  router.use(
    '/api/activities',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    activitiesRouter
  );
  router.use('/api/activities', createErrorHandler('activities'));

  // Google Sheets Import route - MUST be before authenticated routes
  // This endpoint uses its own API key authentication (bypasses session auth)
  // Mount at /api/event-requests so the router's /import-from-sheets path matches
  router.use(
    '/api/event-requests',
    (req, res, next) => {
      // Only allow unauthenticated access to the import-from-sheets endpoint
      if (req.path === '/import-from-sheets' && req.method === 'POST') {
        return next();
      }
      // All other paths need authentication - skip to next middleware
      return next('route');
    },
    ...createStandardMiddleware(),
    eventRequestsRouter
  );

  // Event Requests routes (authenticated)
  router.use(
    '/api/event-requests',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    eventRequestsRouter
  );

  // Event Collaboration routes - real-time collaboration features
  const eventCollaborationRouter = createEventCollaborationRouter(deps);
  router.use(
    '/api/event-requests',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    eventCollaborationRouter
  );

  // Post-event notes — retrospective notes on completed events
  const eventPostEventNotesRouter = createEventPostEventNotesRouter();
  router.use(
    '/api/event-requests',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    eventPostEventNotesRouter
  );
  
  // Contact Attempts Migration routes - migrate legacy unresponsiveNotes to contactAttemptsLog
  const migrateContactAttemptsRouter = createMigrateContactAttemptsRoutes(deps.storage);
  router.use(
    '/api/migrate-contact-attempts',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    migrateContactAttemptsRouter
  );
  router.use('/api/migrate-contact-attempts', createErrorHandler('migrate-contact-attempts'));
  
  // Shared error handler for both event-requests and event-collaboration routes
  router.use('/api/event-requests', createErrorHandler('event-requests'));

  // Event map routes - map view of events with addresses
  router.use(
    '/api/event-map',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    eventMapRouter
  );
  router.use('/api/event-map', createErrorHandler('event-map'));

  // Event contacts directory - aggregated contacts from event requests
  const eventContactsRouter = createEventContactsRouter();
  router.use(
    '/api/event-contacts',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    eventContactsRouter
  );
  router.use('/api/event-contacts', createErrorHandler('event-contacts'));

  // Directions routes - Google Maps Directions API with traffic data
  router.use(
    '/api/directions',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    directionsRouter
  );
  router.use('/api/directions', createErrorHandler('directions'));

  // Map tiles stay on the server so GOOGLE_MAPS_API_KEY is never sent to the browser.
  // Skip the request logger here, and skip /api/maps/tiles in the activity logger,
  // because one map view requests dozens of tiles.
  router.use('/api/maps', deps.isAuthenticated, mapTilesRouter);
  router.use('/api/maps', createErrorHandler('map-tiles'));

  // Expenses routes - expense and receipt tracking
  router.use(
    '/api/expenses',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    expensesRouter
  );
  router.use('/api/expenses', createErrorHandler('expenses'));

  // Impact Reports routes - AI-generated impact reports
  router.use(
    '/api/impact-reports',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    impactReportsRouter
  );
  router.use('/api/impact-reports', createErrorHandler('impact-reports'));

  // Predictions routes - AI-powered predictive analytics
  router.use(
    '/api/predictions',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    predictionsRouter
  );
  router.use('/api/predictions', createErrorHandler('predictions'));

  // AI Chat routes - Universal AI assistant for various contexts
  router.use(
    '/api/ai-chat',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    aiChatRouter
  );
  router.use('/api/ai-chat', createErrorHandler('ai-chat'));

  // AI Analyst is intentionally separate from the floating assistant. Its
  // route enforces a dedicated permission and only builds fixed aggregates.
  router.use(
    '/api/ai-analyst',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    aiAnalystRouter
  );
  router.use('/api/ai-analyst', createErrorHandler('ai-analyst'));

  // Email Templates routes - customizable email template sections
  const emailTemplatesRouter = createEmailTemplatesRouter();
  router.use(
    '/api/email-templates',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    emailTemplatesRouter
  );
  router.use('/api/email-templates', createErrorHandler('email-templates'));

  // User Email Templates - per-user customizable templates for new org / returning contact
  const userEmailTemplatesRouter = createUserEmailTemplatesRouter();
  router.use(
    '/api/user/email-templates',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    userEmailTemplatesRouter
  );
  router.use('/api/user/email-templates', createErrorHandler('user-email-templates'));

  // Event email sending and log routes (mounted under /api/events)
  const eventEmailRouter = createEventEmailRouter();
  router.use(
    '/api/events',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    eventEmailRouter
  );
  router.use('/api/events', createErrorHandler('event-emails'));

  // Group Engagement routes - AI-powered organization engagement insights
  const groupEngagementRouter = createGroupEngagementRoutes({
    isAuthenticated: deps.isAuthenticated,
  });
  router.use(
    '/api/group-engagement',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    groupEngagementRouter
  );
  router.use('/api/group-engagement', createErrorHandler('group-engagement'));

  // Service hours PDF generation - use specific path to avoid intercepting other /api routes
  router.use(
    '/api/generate-service-hours-pdf',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    serviceHoursRouter
  );
  router.use('/api/generate-service-hours-pdf', createErrorHandler('service-hours'));

  // Me routes - user-specific endpoints
  router.use(
    '/api/me',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    meRouter
  );
  router.use('/api/me', createErrorHandler('me'));

  // SMS user routes - authenticated user-facing SMS settings
  // Note: Twilio webhooks are registered separately at the TOP of this file (smsWebhookRoutes)
  // Individual routes in smsUserRoutes have their own isAuthenticated middleware
  router.use(
    '/api',
    ...createStandardMiddleware(),
    smsUserRoutes
  );

  router.use(
    '/api/sms-testing',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    smsTestingRoutes
  );
  router.use('/api/sms-testing', createErrorHandler('sms-testing'));

  router.use(
    '/api/sms-announcement',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    smsAnnouncementRoutes
  );
  router.use('/api/sms-announcement', createErrorHandler('sms-announcement'));

  router.use(
    '/api/quick-sms',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    quickSmsRouter
  );
  router.use('/api/quick-sms', createErrorHandler('quick-sms'));

  router.use(
    '/api/monitoring',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    monitoringRouter
  );
  router.use('/api/monitoring', createErrorHandler('monitoring'));

  // Wishlist routes - mount directly to match frontend expectations
  router.use(
    '/api/wishlist-suggestions',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    wishlistSuggestionsRouter
  );
  router.use('/api/wishlist-suggestions', createErrorHandler('wishlist-suggestions'));

  router.use(
    '/api/wishlist-activity',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    wishlistActivityRouter
  );
  router.use('/api/wishlist-activity', createErrorHandler('wishlist-activity'));

  // Team board routes
  router.use(
    '/api/team-board',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    teamBoardRouter
  );
  router.use('/api/team-board', createErrorHandler('team-board'));

  // Yearly Calendar routes
  router.use(
    '/api/yearly-calendar',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    yearlyCalendarRouter
  );
  router.use('/api/yearly-calendar', createErrorHandler('yearly-calendar'));

  // Tracked Calendar routes (date-range based items like school breaks)
  router.use(
    '/api/tracked-calendar',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    trackedCalendarRouter
  );
  router.use('/api/tracked-calendar', createErrorHandler('tracked-calendar'));

  // Holding zone categories routes
  router.use(
    '/api/holding-zone/categories',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    holdingZoneCategoriesRouter
  );
  router.use('/api/holding-zone/categories', createErrorHandler('holding-zone-categories'));

  // Holding zone collaboration routes
  router.use(
    '/api/holding-zone',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    createHoldingZoneCollaborationRouter(deps)
  );
  router.use('/api/holding-zone', createErrorHandler('holding-zone-collaboration'));

  // Promotion graphics routes
  router.use(
    '/api/promotion-graphics',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    promotionGraphicsRouter
  );
  router.use('/api/promotion-graphics', createErrorHandler('promotion-graphics'));

  // Cooler tracking routes
  router.use(
    '/api/cooler-types',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    coolerTypesRouter
  );
  router.use('/api/cooler-types', createErrorHandler('cooler-types'));

  router.use(
    '/api/cooler-inventory',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    coolerInventoryRouter
  );
  router.use('/api/cooler-inventory', createErrorHandler('cooler-inventory'));

  // Enhanced user activity tracking (stub) - enabled to prevent 404 errors
  router.use('/api/enhanced-user-activity', enhancedActivityRouter);

  // Stream Chat routes - real-time messaging with Stream API
  router.use(
    '/api/stream',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    streamRoutes
  );
  router.use('/api/stream', createErrorHandler('stream'));

  // Client error logging endpoint (no auth required so we can capture pre-login issues)
  const errorLogsRouter = createErrorLogsRoutes(deps.storage);
  router.use(
    '/api/error-logs',
    ...createPublicMiddleware(),
    errorLogsRouter
  );
  router.use('/api/error-logs', createErrorHandler('error-logs'));

  const userIssueReportsRouter = createUserIssueReportsRoutes({
    isAuthenticated: deps.isAuthenticated,
    requirePermission: deps.requirePermission,
  });
  router.use(
    '/api/user-issue-reports',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    userIssueReportsRouter
  );
  router.use('/api/user-issue-reports', createErrorHandler('user-issue-reports'));

  // Work log time tracking endpoints
  router.use(
    '/api/work-logs',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    workLogsRouter
  );
  router.use('/api/work-logs', createErrorHandler('work-logs'));

  // Volunteer shoutouts and recognition tools
  router.use(
    '/api/shoutouts',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    shoutoutsRouter
  );
  router.use('/api/shoutouts', createErrorHandler('shoutouts'));

  // Database migrations (admin only)
  router.use(
    '/api/migrations',
    deps.isAuthenticated,
    migrationsRouter
  );
  router.use('/api/migrations', createErrorHandler('migrations'));

  // Drivers management
  const driversRouter = createDriversRouter(deps);
  router.use(
    '/api/drivers',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    driversRouter
  );
  router.use('/api/drivers', createErrorHandler('drivers'));

  // Volunteers management
  const volunteersRouter = createVolunteersRouter(deps);
  router.use(
    '/api/volunteers',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    volunteersRouter
  );
  router.use('/api/volunteers', createErrorHandler('volunteers'));

  // Volunteer Event Hub - self-service signup portal for volunteers
  router.use(
    '/api/volunteer-hub',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    volunteerEventHubRouter
  );
  router.use('/api/volunteer-hub', createErrorHandler('volunteer-hub'));

  // Hosts management
  const hostsRouter = createHostsRouter(deps);
  router.use(
    '/api',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    hostsRouter
  );
  router.use('/api/hosts*', createErrorHandler('hosts'));

  // Mobile home dashboard: /api/dashboard/stats + /api/activity/recent
  const mobileDashboardRouter = createMobileDashboardRouter(deps);
  router.use(
    '/api',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    mobileDashboardRouter
  );
  router.use('/api/dashboard*', createErrorHandler('dashboard'));
  router.use('/api/activity*', createErrorHandler('activity'));

  // Event reminders
  const eventRemindersRouter = createEventRemindersRouter(deps);
  router.use(
    '/api/event-reminders',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    eventRemindersRouter
  );
  router.use('/api/event-reminders', createErrorHandler('event-reminders'));

  // Event check-in reminders (per-event recurring notification toggle)
  router.use(
    '/api/event-check-in-reminders',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    eventCheckInRemindersRouter
  );
  router.use('/api/event-check-in-reminders', createErrorHandler('event-check-in-reminders'));

  // Alert requests - user-submitted requests for new notification types
  const alertRequestsRouter = createAlertRequestsRouter(deps);
  router.use(
    '/api/alert-requests',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    alertRequestsRouter
  );
  router.use('/api/alert-requests', createErrorHandler('alert-requests'));

  // App settings - key/value config (e.g. annual sandwich goal)
  const appSettingsRouter = createAppSettingsRouter(deps);
  router.use(
    '/api/app-settings',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    appSettingsRouter
  );
  router.use('/api/app-settings', createErrorHandler('app-settings'));

  const navUserViewRouter = createNavUserViewRouter(deps);
  router.use(
    '/api/nav-user-view-config',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    navUserViewRouter
  );
  router.use('/api/nav-user-view-config', createErrorHandler('nav-user-view-config'));

  // Per-user "notable" bookmarks on collection log entries. Distinct
  // from the kudos icon (which sends recognition to the submitter) —
  // these are private bookmarks the user controls.
  const collectionFavoritesRouter = createCollectionFavoritesRouter(deps);
  router.use(
    '/api/collection-favorites',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    collectionFavoritesRouter,
  );
  router.use('/api/collection-favorites', createErrorHandler('collection-favorites'));

  // AI alert generation
  const aiAlertRouter = createAIAlertRouter(deps);
  router.use(
    '/api/ai',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    aiAlertRouter
  );
  router.use('/api/ai', createErrorHandler('ai'));

  // Email/inbox system
  const emailRouter = createEmailRouter(deps);
  router.use(
    '/api/emails',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    emailRouter
  );
  router.use('/api/emails', createErrorHandler('emails'));

  // Email drafts (Project Threads compose auto-save)
  const emailDraftsRouter = createEmailDraftsRouter(deps);
  router.use(
    '/api/drafts',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    emailDraftsRouter
  );
  router.use('/api/drafts', createErrorHandler('email-drafts'));

  // Admin migrations (one-time data fixes)
  const adminMigrationsRouter = createAdminMigrationsRouter({ isAuthenticated: deps.isAuthenticated });
  router.use(
    '/api/admin/migrations',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    adminMigrationsRouter
  );
  router.use('/api/admin/migrations', createErrorHandler('admin-migrations'));

  // Admin events management (debugging/fixing notification issues)
  const adminEventsRouter = createAdminEventsRouter({ isAuthenticated: deps.isAuthenticated });
  router.use(
    '/api/admin/events',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    adminEventsRouter
  );
  router.use('/api/admin/events', createErrorHandler('admin-events'));

  // Onboarding challenges
  const onboardingRouter = createOnboardingRouter(deps);
  router.use(
    '/api/onboarding',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    onboardingRouter
  );
  router.use('/api/onboarding', createErrorHandler('onboarding'));

  // Google Sheets integration
  const googleSheetsRouter = createGoogleSheetsRouter(deps);
  router.use(
    '/api/google-sheets',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    googleSheetsRouter
  );
  router.use('/api/google-sheets', createErrorHandler('google-sheets'));

  // Planning Sheet Proposals - safety gate for app-to-sheet writes
  const planningSheetProposalsRouter = createPlanningSheetProposalsRouter(
    deps.isAuthenticated,
    deps.requirePermission
  );
  router.use(
    '/api/planning-sheet-proposals',
    ...createStandardMiddleware(),
    planningSheetProposalsRouter
  );
  router.use('/api/planning-sheet-proposals', createErrorHandler('planning-sheet-proposals'));

  // Review-first PULL from the planning sheet (read sheet → human approves → create events)
  const planningSheetImportRouter = createPlanningSheetImportRouter(
    deps.isAuthenticated,
    deps.requirePermission
  );
  router.use(
    '/api/planning-sheet-import',
    ...createStandardMiddleware(),
    planningSheetImportRouter
  );
  router.use('/api/planning-sheet-import', createErrorHandler('planning-sheet-import'));

  // Google Calendar integration
  const googleCalendarRouter = createGoogleCalendarRouter(deps);
  router.use(
    '/api/google-calendar',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    googleCalendarRouter
  );
  router.use('/api/google-calendar', createErrorHandler('google-calendar'));

  // Route optimization
  const routeOptimizationRouter = createRouteOptimizationRouter(deps);
  router.use(
    '/api/routes',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    routeOptimizationRouter
  );
  router.use('/api/routes', createErrorHandler('route-optimization'));

  // Recipient TSP contacts
  const recipientTspContactsRouter = createRecipientTspContactsRouter(deps);
  router.use(
    '/api/recipient-tsp-contacts',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    recipientTspContactsRouter
  );
  router.use('/api/recipient-tsp-contacts', createErrorHandler('recipient-tsp-contacts'));

  // Sandwich distributions
  const sandwichDistributionsRouter = createSandwichDistributionsRouter(deps);
  router.use(
    '/api/sandwich-distributions',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    sandwichDistributionsRouter
  );
  router.use('/api/sandwich-distributions', createErrorHandler('sandwich-distributions'));

  // Event imports
  const importEventsRouter = createImportEventsRouter(deps);
  router.use(
    '/api/import',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    importEventsRouter
  );
  router.use('/api/import', createErrorHandler('import-events'));

  // Data management (exports, bulk operations, integrity checks)
  const dataManagementRouter = createDataManagementRouter(deps);
  router.use(
    '/api/data-management',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    dataManagementRouter
  );
  router.use('/api/data-management', createErrorHandler('data-management'));

  // Message notifications
  const messageNotificationsRouter = createMessageNotificationsRouter(deps);
  router.use(
    '/api/message-notifications',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    messageNotificationsRouter
  );
  router.use('/api/message-notifications', createErrorHandler('message-notifications'));

  // Announcements
  const announcementsRouter = createAnnouncementsRouter(deps);
  router.use(
    '/api/announcements',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    announcementsRouter
  );
  router.use('/api/announcements', createErrorHandler('announcements'));

  // Performance monitoring
  const performanceRouter = createPerformanceRouter(deps);
  router.use(
    '/api/performance',
    ...createStandardMiddleware(),
    performanceRouter
  );
  router.use('/api/performance', createErrorHandler('performance'));

  // Feature Flags (Admin only)
  router.use(
    '/api/feature-flags',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    featureFlagsRouter
  );
  router.use('/api/feature-flags', createErrorHandler('feature-flags'));

  // API Documentation (OpenAPI/Swagger)
  // Public route - no authentication required to view API docs
  const apiDocsRouter = createApiDocsRouter();
  router.use(
    '/api/docs',
    ...createPublicMiddleware(),
    apiDocsRouter
  );

  // Object storage upload endpoint
  router.use(
    '/api/objects',
    deps.isAuthenticated,
    ...createStandardMiddleware(),
    objectsRouter
  );
  router.use('/api/objects', createErrorHandler('objects'));

  // Client-side error reporting — public, no auth required (but reads session if present)
  // Rate-limited to 5 reports per IP per hour to prevent flooding
  const clientErrorRateLimit = new Map<string, { count: number; resetAt: number }>();

  // HTML-escape a string to prevent injection in the email template
  const escapeHtml = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  router.post('/api/client-error', async (req, res) => {
    try {
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        'unknown';
      const now = Date.now();
      const limit = clientErrorRateLimit.get(ip);
      if (limit) {
        if (now < limit.resetAt && limit.count >= 5) {
          res.status(429).json({ ok: false, reason: 'rate limited' });
          return;
        }
        if (now >= limit.resetAt) {
          clientErrorRateLimit.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
        } else {
          limit.count++;
        }
      } else {
        clientErrorRateLimit.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
      }

      const {
        message,
        stack,
        componentStack,
        url,
        referrer,
        userAgent,
        viewportWidth,
        viewportHeight,
        timestamp,
      } = req.body || {};

      // Read authenticated user from session if available
      const sessionUser = (req as any).user || (req as any).session?.user;
      const userId: string | null = sessionUser?.id || null;
      const userEmail: string | null = sessionUser?.email || null;
      const userName: string | null = sessionUser
        ? [sessionUser.firstName, sessionUser.lastName].filter(Boolean).join(' ') ||
          sessionUser.displayName ||
          null
        : null;
      const userRole: string | null = sessionUser?.role || null;
      const sessionId: string | null = (req as any).sessionID || null;

      // Persist to DB — do this first so even if email fails we have a record
      let emailSent = false;
      let dbErrorId: number | null = null;
      try {
        const { db } = await import('../db');
        const { clientErrorLogs } = await import('@shared/schema');
        const [inserted] = await db
          .insert(clientErrorLogs)
          .values({
            userId,
            userEmail,
            userName,
            userRole,
            message: message || 'Unknown error',
            stack: stack || null,
            componentStack: componentStack || null,
            url: url || null,
            referrer: referrer || null,
            userAgent: userAgent || null,
            viewportWidth:
              typeof viewportWidth === 'number' ? viewportWidth : null,
            viewportHeight:
              typeof viewportHeight === 'number' ? viewportHeight : null,
            ipAddress: ip,
            sessionId,
            emailSent: false,
          })
          .returning({ id: clientErrorLogs.id });
        dbErrorId = inserted?.id ?? null;

        const { appendErrorLogToSheet } = await import('../services/error-log-sheet-sync');
        appendErrorLogToSheet({
          type: 'client_crash',
          timestamp: new Date(timestamp || Date.now()),
          userName,
          userEmail,
          page: url || null,
          summary: message || 'Unknown error',
          stack: stack || componentStack || null,
          details: componentStack ? 'React component stack captured' : null,
          sourceId: dbErrorId,
        });
      } catch (dbErr) {
        logger.error('Failed to persist client error to DB:', dbErr);
      }

      // Send admin email with full context
      try {
        const { sendEmail } = await import('../services/sendgrid');

        const userLine = userId
          ? `${escapeHtml(userName || userEmail || userId)}${userEmail ? ` &lt;${escapeHtml(userEmail)}&gt;` : ''}${userRole ? ` · ${escapeHtml(userRole)}` : ''}`
          : '<em>Not signed in</em>';

        const viewportStr =
          viewportWidth && viewportHeight
            ? `${escapeHtml(viewportWidth)}×${escapeHtml(viewportHeight)}`
            : 'unknown';

        const html = `
          <h2 style="color:#b91c1c;margin-bottom:4px;">App Error Boundary Triggered</h2>
          <p style="color:#6b7280;margin-top:0;font-size:13px;">A user's browser hit an unhandled error. Details below.</p>
          <table style="border-collapse:collapse;width:100%;font-family:monospace;font-size:13px;margin-top:12px;">
            <tr><td style="padding:6px 10px;font-weight:bold;width:140px;vertical-align:top;">Time</td><td style="padding:6px 10px;">${escapeHtml(timestamp || new Date().toISOString())}</td></tr>
            <tr style="background:#fef2f2;"><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">User</td><td style="padding:6px 10px;">${userLine}</td></tr>
            <tr><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">User ID</td><td style="padding:6px 10px;">${escapeHtml(userId || 'anonymous')}</td></tr>
            <tr style="background:#fef2f2;"><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">Page URL</td><td style="padding:6px 10px;word-break:break-all;">${escapeHtml(url || 'unknown')}</td></tr>
            <tr><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">Referrer</td><td style="padding:6px 10px;word-break:break-all;">${escapeHtml(referrer || 'none')}</td></tr>
            <tr style="background:#fef2f2;"><td style="padding:6px 10px;font-weight:bold;color:#b91c1c;vertical-align:top;">Error</td><td style="padding:6px 10px;color:#b91c1c;">${escapeHtml(message || 'No message')}</td></tr>
            <tr><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">Viewport</td><td style="padding:6px 10px;">${viewportStr}</td></tr>
            <tr style="background:#fef2f2;"><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">User Agent</td><td style="padding:6px 10px;">${escapeHtml(userAgent || 'unknown')}</td></tr>
            <tr><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">IP</td><td style="padding:6px 10px;">${escapeHtml(ip)}</td></tr>
            <tr style="background:#fef2f2;"><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">Session</td><td style="padding:6px 10px;">${escapeHtml(sessionId || 'none')}</td></tr>
            ${dbErrorId ? `<tr><td style="padding:6px 10px;font-weight:bold;vertical-align:top;">Log ID</td><td style="padding:6px 10px;">#${dbErrorId}</td></tr>` : ''}
          </table>
          ${componentStack ? `<h3 style="margin-top:20px;margin-bottom:6px;">React Component Stack</h3><pre style="background:#f3f4f6;color:#111827;padding:12px;border-radius:6px;overflow:auto;font-size:12px;white-space:pre-wrap;border:1px solid #e5e7eb;">${escapeHtml(componentStack)}</pre>` : ''}
          ${stack ? `<h3 style="margin-top:20px;margin-bottom:6px;">JavaScript Stack Trace</h3><pre style="background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;overflow:auto;font-size:12px;white-space:pre-wrap;">${escapeHtml(stack)}</pre>` : ''}
          <p style="margin-top:20px;color:#6b7280;font-size:12px;">View all errors in the admin panel under <strong>Error Logs</strong>.</p>
        `;

        const text = [
          `Error: ${message || 'Unknown'}`,
          `Time: ${timestamp || new Date().toISOString()}`,
          `User: ${userName || userEmail || 'Not signed in'}${userId ? ` (${userId})` : ''}`,
          `Role: ${userRole || 'n/a'}`,
          `Page: ${url || 'unknown'}`,
          `Referrer: ${referrer || 'none'}`,
          `Viewport: ${viewportStr}`,
          `User Agent: ${userAgent || 'unknown'}`,
          `IP: ${ip}`,
          `Session: ${sessionId || 'none'}`,
          dbErrorId ? `Log ID: #${dbErrorId}` : '',
          '',
          componentStack ? `Component Stack:\n${componentStack}\n` : '',
          stack ? `Stack:\n${stack}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        await sendEmail({
          to: 'katie@thesandwichproject.org',
          from: 'noreply@thesandwichproject.org',
          subject: `[TSP App Error] ${message || 'Unknown error'} — ${url || 'unknown page'}`,
          html,
          text,
        });
        emailSent = true;
      } catch (emailErr) {
        logger.error('Failed to send client error email:', emailErr);
      }

      // Update DB row with email_sent flag if we had one
      if (dbErrorId && emailSent) {
        try {
          const { db } = await import('../db');
          const { clientErrorLogs } = await import('@shared/schema');
          const { eq } = await import('drizzle-orm');
          await db
            .update(clientErrorLogs)
            .set({ emailSent: true })
            .where(eq(clientErrorLogs.id, dbErrorId));
        } catch {
          // non-fatal
        }
      }

      res.json({ ok: true, logId: dbErrorId });
    } catch (err) {
      logger.error('Failed to handle client error report:', err);
      res.status(500).json({ ok: false });
    }
  });

  // Admin-only: fetch client error logs for the admin panel
  router.get(
    '/api/admin/client-error-logs',
    deps.isAuthenticated,
    deps.requirePermission('ADMIN_PANEL_ACCESS'),
    async (req, res) => {
      try {
        const { db } = await import('../db');
        const { clientErrorLogs } = await import('@shared/schema');
        const { desc, gte, and, sql } = await import('drizzle-orm');

        const daysParam = parseInt((req.query.days as string) || '7', 10);
        const days = !isNaN(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 7;
        const limitParam = parseInt((req.query.limit as string) || '200', 10);
        const limit = !isNaN(limitParam) && limitParam > 0 && limitParam <= 1000 ? limitParam : 200;

        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);

        const logs = await db
          .select()
          .from(clientErrorLogs)
          .where(gte(clientErrorLogs.createdAt, sinceDate))
          .orderBy(desc(clientErrorLogs.createdAt))
          .limit(limit);

        res.json(logs);
      } catch (err) {
        logger.error('Failed to fetch client error logs:', err);
        res.status(500).json({ error: 'Failed to fetch client error logs' });
      }
    }
  );

  // Admin-only: fetch server-side application error logs
  router.get(
    '/api/admin/application-error-logs',
    deps.isAuthenticated,
    deps.requirePermission('ADMIN_PANEL_ACCESS'),
    async (req, res) => {
      try {
        const { db } = await import('../db');
        const { applicationErrorLogs } = await import('@shared/schema');
        const { desc, gte, eq, and } = await import('drizzle-orm');

        const daysParam = parseInt((req.query.days as string) || '7', 10);
        const days = !isNaN(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 7;
        const limitParam = parseInt((req.query.limit as string) || '200', 10);
        const limit = !isNaN(limitParam) && limitParam > 0 && limitParam <= 1000 ? limitParam : 200;
        const source = (req.query.source as string) || undefined;
        const severity = (req.query.severity as string) || undefined;

        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);

        const conditions = [gte(applicationErrorLogs.createdAt, sinceDate)];
        if (source) conditions.push(eq(applicationErrorLogs.source, source));
        if (severity) conditions.push(eq(applicationErrorLogs.severity, severity));

        const logs = await db
          .select()
          .from(applicationErrorLogs)
          .where(and(...conditions))
          .orderBy(desc(applicationErrorLogs.createdAt))
          .limit(limit);

        res.json(logs);
      } catch (err) {
        logger.error('Failed to fetch application error logs:', err);
        res.status(500).json({ error: 'Failed to fetch application error logs' });
      }
    }
  );

  // Admin-only: integration health check (OpenAI, Twilio, SendGrid, etc.)
  router.get(
    '/api/admin/system-health',
    deps.isAuthenticated,
    deps.requirePermission('ADMIN_PANEL_ACCESS'),
    async (req, res) => {
      try {
        const { runIntegrationHealthCheck } = await import('../services/integration-health');
        const liveCheck = req.query.liveCheck === 'true';
        const report = await runIntegrationHealthCheck({ liveCheck, logFailures: false });
        res.json(report);
      } catch (err) {
        logger.error('Failed to run system health check:', err);
        res.status(500).json({ error: 'Failed to run system health check' });
      }
    }
  );

  return router;
}

// Backwards compatibility exports
export { createMainRoutes as apiRoutes };
export default createMainRoutes;
