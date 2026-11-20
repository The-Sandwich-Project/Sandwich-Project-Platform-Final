// Clean error handling for Replit - let Replit handle restarts
// Replit already monitors and restarts crashed apps automatically

// Note: OpenAPI extension removed due to platform compatibility issues

import express, { type Request, Response, NextFunction } from 'express';
import type { Store } from 'express-session';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import compression from 'compression';
import helmet from 'helmet';
import { registerRoutes } from './routes';
import { setupVite, serveStatic, log } from './vite';
import { initializeDatabase } from './db-init';
import type { IStorage } from './storage';
import { setupSocketChat } from './socket-chat';
import { setupSocketCollaboration } from './socket-collaboration';
import { smartDeliveryService } from './services/notifications/smart-delivery';
import logger, { createServiceLogger, logRequest } from './utils/logger.js';
import {
  performanceMonitoringMiddleware,
  errorTrackingMiddleware,
  createMonitoringRoutes,
  monitorSocketIO,
  monitorWebSocket,
  startMetricsUpdates,
  sentryErrorHandler,
  initializeSentry,
} from './monitoring';
import { getAppBaseUrl } from './config/constants';

const app = express();
const serverLogger = createServiceLogger('server');

// Initialize Sentry error tracking (must be before any other middleware)
initializeSentry(app);
serverLogger.info('Sentry monitoring initialized');

// Track initialization state for health responses
let serverReady = false;

// CRITICAL: Health check routes BEFORE any middleware - for deployment health checks
// These respond instantly, but return 503 until the server has finished
// registering routes so Replit doesn't switch traffic to a half-initialized
// instance (which would otherwise produce 500s for the first ~30s after deploy).
app.get('/healthz', (_req: Request, res: Response) => {
  if (!serverReady) {
    return res.status(503).json({ status: 'starting' });
  }
  res.sendStatus(200);
});

// Security headers via Helmet.js
const isDevEnvironment = process.env.NODE_ENV === 'development';
app.use(
  helmet({
    contentSecurityPolicy: isDevEnvironment
      ? false // Disable CSP in dev — Vite HMR injects inline scripts
      : {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdnjs.cloudflare.com', 'https://unpkg.com', 'https://www.googletagmanager.com', 'https://the-sandwich-project.github.io'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://unpkg.com', 'https://fonts.googleapis.com'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
            connectSrc: ["'self'", 'wss:', 'ws:', 'https://api.openai.com', 'https://api.anthropic.com', 'https://*.sentry.io', 'https://*.stream-io-api.com', 'wss://*.stream-io-api.com', 'https://*.stream-io-cdn.com', 'https://*.getstream.io', 'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://storage.googleapis.com'],
            // CSP frame-src — origins allowed in <iframe>. When adding a new
            // embedded external page, check three things in order:
            //   1. Add the origin here (otherwise the browser blocks the frame).
            //   2. Check if the source sets X-Frame-Options. If yes, you need
            //      to route through /api/proxy/page (see toolkit, donor mgmt
            //      tabs in important-links.tsx for examples).
            //   3. If the embed also fetches API data from the same origin,
            //      add it to connectSrc below too.
            frameSrc: ["'self'", 'https://*.stream-io-api.com', 'https://*.getstream.io', 'https://docs.google.com', 'https://the-sandwich-project.github.io'],
            objectSrc: ["'self'"],
            baseUri: ["'self'", 'https://the-sandwich-project.github.io'],
            formAction: ["'self'"],
            upgradeInsecureRequests: [],
          },
        },
    crossOriginEmbedderPolicy: false, // Required for external image/font loading
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin resource loading
    frameguard: false, // Disabled — allows Replit preview iframes; clickjacking risk is minimal for this app
  })
);
serverLogger.info('Helmet security headers enabled', {
  csp: !isDevEnvironment,
});

// Performance monitoring middleware (should be early in the chain)
app.use(performanceMonitoringMiddleware);
serverLogger.info('Performance monitoring middleware enabled');

// Enable gzip/brotli compression for performance
app.use(
  compression({
    filter: (req: Request, res: Response) => {
      // Don't compress if the client doesn't support it
      if (req.headers['x-no-compression']) {
        return false;
      }

      // Compress all text-based content types and JSON
      const contentType = res.get('content-type');
      if (!contentType) return false;

      return (
        /text|javascript|json|css|html|xml|svg/.test(contentType) ||
        contentType.includes('application/json') ||
        contentType.includes('application/javascript') ||
        contentType.includes('text/')
      );
    },
    threshold: 1024, // Only compress files larger than 1KB
    level: 6, // Compression level (1-9, 6 is good balance)
    memLevel: 8, // Memory usage level (1-9, 8 is good balance)
  })
);

app.use(express.json({ limit: '20mb' })); // Increased for base64 image uploads (sign-in sheet scanner)
app.use(express.urlencoded({ extended: false, limit: '20mb' }));

// Security middleware - must come after body parsers
import { prototypePollutionGuard } from './middleware/prototype-pollution-guard';
app.use(prototypePollutionGuard); // Detect prototype pollution attempts

// Add CDN caching headers for static assets
app.use((req: Request, res: Response, next: NextFunction) => {
  const path = req.path;

  // Set cache headers based on content type and path
  if (
    path.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|pdf)$/i)
  ) {
    // Static assets - cache for 1 year (immutable if using content hashing)
    if (path.includes('.') && path.match(/\.[a-f0-9]{8,}\./)) {
      // Content-hashed assets (e.g., main.abc123def.js) - cache immutably
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      // Non-hashed assets - cache for 1 day with revalidation
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
    res.setHeader('Vary', 'Accept-Encoding');
  } else if (path.startsWith('/api/')) {
    // API routes - no caching
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private'
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (path === '/' || path.endsWith('.html')) {
    // HTML pages - never cache to avoid stale SPA shells after deploys
    res.setHeader('Cache-Control', 'no-store');
  } else if (!path.startsWith('/api/')) {
    // SPA routes (e.g. /dashboard) should also avoid caching HTML
    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }

  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (path.startsWith('/api')) {
      logRequest(req.method, path, undefined, duration);

      // Also use the old log format for compatibility
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + '…';
      }

      log(logLine);
    }
  });

  next();
});

// Debug process exit
process.on('exit', (code) => logger.warn(`Process exiting with code: ${code}`));
process.on('uncaughtException', (e) => {
  logger.error('Uncaught exception:', e);
  void import('./services/application-error-logger').then(({ logFromException }) => {
    logFromException(e, {
      source: 'process',
      severity: 'critical',
      category: 'uncaught_exception',
      notifyAdmin: true,
    });
  });
});
process.on('unhandledRejection', (e) => {
  logger.error('Unhandled rejection:', e);
  void import('./services/application-error-logger').then(({ logFromException }) => {
    logFromException(e, {
      source: 'process',
      severity: 'critical',
      category: 'unhandled_rejection',
      notifyAdmin: true,
    });
  });
});

async function bootstrap() {
  try {
    serverLogger.info('🚀 Starting The Sandwich Project server...');

    // Use PORT from environment (Replit Autoscale sets PORT=80), fallback to 80 for production, 3000 for dev
    // Note: dev default is 3000 (not 5000) to avoid conflicting with PORT=5000 production workflow
    const port =
      process.env.PORT || (process.env.NODE_ENV === 'production' ? 80 : 3000);
    const host = '0.0.0.0';

    serverLogger.info(
      `Starting server on ${host}:${port} in ${process.env.NODE_ENV || 'development'} mode`
    );

    // Basic error handler - available immediately for early errors
    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || 'Internal Server Error';
      serverLogger.error('Unhandled error:', err);

      if (status >= 500) {
        void import('./services/application-error-logger').then(({ logHttpError }) => {
          logHttpError(err, req, { moduleId: 'bootstrap', notifyAdmin: true });
        });
      }

      // Ensure API routes always return JSON
      if (req.originalUrl.startsWith('/api')) {
        return res.status(status).json({ message, error: true });
      }

      res.status(status).json({ message });
    });

    // Set up basic routes BEFORE starting server
    app.use('/attached_assets', express.static('attached_assets'));
    app.use(
      '/host-resource-files',
      express.static('uploads/host-resources', {
        index: false,
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        },
      })
    );

    // Health check route - available before full initialization
    app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
      });
    });

    // Health check route for deployment - API endpoint
    app.get('/api/health', (_req: Request, res: Response) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
      });
    });

    // Dynamic PWA manifest with correct production URL
    app.get('/manifest.json', (req: Request, res: Response) => {
      // Use centralized URL function for consistent URL generation
      const baseUrl = getAppBaseUrl(req);

      res.setHeader('Content-Type', 'application/manifest+json');
      res.json({
        name: 'The Sandwich Project',
        short_name: 'TSP',
        description:
          'Comprehensive operations platform for The Sandwich Project nonprofit managing sandwich collections, volunteer coordination, and event planning',
        start_url: baseUrl + '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#F7931E',
        orientation: 'portrait-primary',
        scope: '/',
        icons: [
          {
            src: '/attached_assets/LOGOS/TSP_transparent.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/attached_assets/LOGOS/TSP_transparent.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        categories: ['productivity', 'business'],
        shortcuts: [
          {
            name: 'Collection Log',
            short_name: 'Collections',
            description: 'View and manage sandwich collections',
            url: baseUrl + '/?section=collection-log',
            icons: [
              {
                src: '/attached_assets/LOGOS/sandwich logo.png',
                sizes: '96x96',
              },
            ],
          },
          {
            name: 'Event Requests',
            short_name: 'Events',
            description: 'Manage event requests and planning',
            url: baseUrl + '/?section=event-requests',
            icons: [
              {
                src: '/attached_assets/LOGOS/TSP_transparent.png',
                sizes: '96x96',
              },
            ],
          },
          {
            name: 'Messages',
            short_name: 'Messages',
            description: 'View team messages and notifications',
            url: baseUrl + '/?section=gmail-inbox',
            icons: [
              {
                src: '/attached_assets/LOGOS/TSP_transparent.png',
                sizes: '96x96',
              },
            ],
          },
        ],
        screenshots: [
          {
            src: '/attached_assets/LOGOS/TSP_transparent.png',
            sizes: '540x720',
            type: 'image/png',
            form_factor: 'narrow',
          },
        ],
      });
    });

    const httpServer = createServer(app);

    // CRITICAL: Start listening IMMEDIATELY to open port for health checks
    // All heavy initialization will happen in background after port is open
    httpServer.listen(Number(port), host, () => {
      serverLogger.info(`✅ Server listening on http://${host}:${port}`);
      serverLogger.info(`✅ Port ${port} is now open for health checks`);
      serverLogger.info(
        `Environment: ${process.env.NODE_ENV || 'development'}`
      );

      // Log authentication mode for clarity
      const appEnv = process.env.APP_ENV || 'production';
      const nodeEnv = process.env.NODE_ENV;
      const isDeployment = process.env.REPLIT_DEPLOYMENT === '1';
      // Dev mode requires: APP_ENV=development AND NOT production NODE_ENV AND NOT in deployment
      const authBypass =
        appEnv === 'development' && nodeEnv !== 'production' && !isDeployment;
      serverLogger.info(
        `🔐 Auth Mode: APP_ENV=${appEnv}, NODE_ENV=${nodeEnv}, Deployment=${isDeployment ? 'YES' : 'NO'}`
      );
      if (authBypass) {
        serverLogger.info(
          `🔧 DEV MODE ACTIVE: Authentication bypass enabled (auto-login as dev admin)`
        );
      } else {
        serverLogger.info(`🔒 PRODUCTION MODE: Full authentication required`);
      }

      // ================================================================
      // PHASE 1: Critical initialization — routes, static files, WebSocket
      // Must complete quickly so the app can serve requests
      // ================================================================
      setImmediate(async () => {
        try {
          serverLogger.info(
            '⚡ Phase 1: Registering routes and static files...'
          );

          // Set up Socket.io for chat system
          const io = setupSocketChat(httpServer);
          monitorSocketIO(io);
          serverLogger.info('✅ Socket.IO monitoring enabled');

          // Set up Socket.io collaboration namespace for event editing
          setupSocketCollaboration(httpServer, io);
          serverLogger.info('✅ Socket.IO collaboration namespace enabled');

          // Configure smart delivery service with Socket.IO for real-time notifications
          smartDeliveryService.setSocketIO(io);

          // Set up WebSocket server for real-time notifications
          const wss = new WebSocketServer({
            server: httpServer,
            path: '/notifications',
          });

          // Monitor native WebSocket performance
          monitorWebSocket(wss);
          serverLogger.info('✅ WebSocket monitoring enabled');

          // Simple API request logging (without interfering with responses)
          app.use('/api', (req: Request, res: Response, next: NextFunction) => {
            serverLogger.debug(`API Request: ${req.method} ${req.originalUrl}`);
            next();
          });

          // Register monitoring routes (metrics, health checks, dashboard)
          const monitoringRouter = createMonitoringRoutes();
          app.use('/monitoring', monitoringRouter);
          serverLogger.info('✅ Monitoring routes registered at /monitoring');

          // Register all API routes
          let sessionStore: Store | undefined;
          try {
            sessionStore = await registerRoutes(app);
            serverLogger.info('✅ API routes registered');
          } catch (error) {
            serverLogger.error('Route registration failed:', error);
          }

          // Error tracking middleware (before final error handler)
          app.use(errorTrackingMiddleware);

          // JSON error handler - catches malformed JSON from express.json()
          const { jsonErrorHandler } = await import(
            './middleware/json-validator'
          );
          app.use(jsonErrorHandler);

          // JSON 404 catch-all for unmatched API routes
          app.all('/api/*', (req: Request, res: Response) => {
            serverLogger.warn(`🚨 API route not found: ${req.originalUrl}`);
            res.status(404).json({
              error: `API route not found: ${req.originalUrl}`,
              method: req.method,
              path: req.originalUrl,
            });
          });

          // Sentry error handler (must be after all routes)
          if (process.env.SENTRY_DSN) {
            app.use(sentryErrorHandler());
            serverLogger.info('✅ Sentry error handler registered');
          }

          // Static files and SPA fallback MUST come AFTER API routes
          if (process.env.NODE_ENV === 'production') {
            app.use(express.static('dist/public'));

            app.get(
              '*',
              async (req: Request, res: Response, next: NextFunction) => {
                if (req.originalUrl === '/' || req.originalUrl === '/healthz') {
                  return next();
                }
                if (req.originalUrl.startsWith('/api/')) {
                  return next();
                }
                const path = await import('path');
                res.sendFile(
                  path.join(process.cwd(), 'dist/public/index.html')
                );
              }
            );

            serverLogger.info(
              '✅ Static file serving and SPA routing configured'
            );
          }

          // Set up Vite middleware AFTER API routes
          if (process.env.NODE_ENV === 'development') {
            try {
              const { setupVite } = await import('./vite');
              await setupVite(app, httpServer);
              serverLogger.info('Vite development server setup complete');
            } catch (error) {
              serverLogger.error('Vite setup failed:', error);
            }
          }

          const clients = new Map<string, any>();

          wss.on('connection', (ws, request) => {
            serverLogger.info('WebSocket client connected', {
              remoteAddress: request.socket.remoteAddress,
            });

            ws.on('message', (data) => {
              try {
                const message = JSON.parse(data.toString());
                if (message.type === 'identify' && message.userId) {
                  clients.set(message.userId, ws);
                }
              } catch (error) {
                serverLogger.error('WebSocket message parse error:', error);
              }
            });

            ws.on('close', () => {
              for (const [userId, client] of Array.from(clients.entries())) {
                if (client === ws) {
                  clients.delete(userId);
                  break;
                }
              }
            });

            ws.on('error', (error) => {
              serverLogger.error('WebSocket error:', error);
            });
          });

          // Global broadcast function for messaging system
          (global as any).broadcastNewMessage = async (data: any) => {
            for (const [userId, ws] of Array.from(clients.entries())) {
              if (ws.readyState === 1) {
                try {
                  ws.send(JSON.stringify(data));
                } catch (error) {
                  clients.delete(userId);
                }
              } else {
                clients.delete(userId);
              }
            }
          };

          serverLogger.info('✅ Phase 1 complete — server can handle requests');
          serverReady = true;

          // ================================================================
          // PHASE 2: Background services — database, sync, cron, SMS
          // These run after routes are live so they don't block health checks
          // Each is wrapped in its own try/catch so one failure doesn't stop others
          // ================================================================
          serverLogger.info('🔄 Phase 2: Starting background services...');

          // Database initialization (migrations, schema checks, session table)
          try {
            await initializeDatabase();
            logger.log({
              message: '✓ Database initialization complete',
              level: 'info',
            });
          } catch (error) {
            serverLogger.error('Database initialization failed:', error);
          }

          // Development only: keep the dev database's migrations current while
          // the server keeps running (e.g. after a git pull), so Replit's publish
          // step never sees production tables "missing" from dev and offers to
          // drop them. No-op in production.
          try {
            const { watchForNewMigrationsInDev } = await import('./dev-migration-watcher');
            const { runMigrationsAutomatically } = await import('./migrate');
            if (watchForNewMigrationsInDev({ run: runMigrationsAutomatically })) {
              serverLogger.info('👀 Watching migrations/ for new files (development only)');
            }
          } catch (error) {
            serverLogger.error('Failed to start dev migration watcher:', error);
          }

          // SMS provider
          try {
            const { SMSProviderFactory } = await import(
              './sms-providers/provider-factory'
            );
            await SMSProviderFactory.getInstance().ensureInitialized();
            serverLogger.info('✅ SMS provider initialized');
          } catch (error) {
            serverLogger.error('SMS provider initialization failed:', error);
          }

          // Startup verification of Google Sheets credentials — raises an
          // admin-notified application error if credentials are rotated or
          // malformed, so the projects sheet sync can't silently break.
          try {
            const { verifyGoogleSheetsAuthAtStartup } = await import(
              './services/integration-health'
            );
            void verifyGoogleSheetsAuthAtStartup()
              .then(() =>
                serverLogger.info('✅ Google Sheets startup auth check completed')
              )
              .catch((error) =>
                serverLogger.error(
                  'Google Sheets startup auth check failed to run:',
                  error
                )
              );
          } catch (error) {
            serverLogger.error(
              'Failed to start Google Sheets startup auth check:',
              error
            );
          }

          // Background Google Sheets sync
          try {
            const { storage } = (await import('./storage-wrapper')) as {
              storage: IStorage;
            };
            const { startBackgroundSync } = await import(
              './background-sync-service'
            );
            startBackgroundSync(storage);
            logger.log({
              message: '✓ Background Google Sheets sync service started',
              level: 'info',
            });

            // Cron jobs
            try {
              const { initializeCronJobs } = await import(
                './services/cron-jobs'
              );
              initializeCronJobs();
              logger.info('✅ Cron jobs initialized');
            } catch (error) {
              serverLogger.error('Cron jobs initialization failed:', error);
            }

            // Metrics updates
            if (sessionStore) {
              try {
                startMetricsUpdates(storage, sessionStore);
                logger.info('✅ Periodic metrics updates started');
              } catch (error) {
                serverLogger.error(
                  'Metrics updates initialization failed:',
                  error
                );
              }
            }
          } catch (error) {
            serverLogger.error('Storage/sync initialization failed:', error);
          }

          logger.info('SERVER INITIALIZATION COMPLETE');
          logger.info(
            `Health Check: http://${host}:${port}/monitoring/health/detailed`
          );
        } catch (initError) {
          serverLogger.error('✗ Initialization failed:', initError);
          serverLogger.error(
            'Server will continue running — health checks still responding'
          );
        }
      });
    });

    // Save the REAL process.exit BEFORE any override so shutdown always works
    const realExit = process.exit.bind(process);

    // Graceful shutdown handler - works in both dev and production
    const shutdown = async (signal: string) => {
      serverLogger.info(`Received ${signal}, starting graceful shutdown...`);

      // Close server gracefully
      httpServer.close(() => {
        serverLogger.info('HTTP server closed gracefully');
        realExit(0);
      });

      // Force shutdown after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        serverLogger.warn('Forcing shutdown after timeout');
        realExit(1);
      }, 10000);
    };

    // Handle shutdown signals properly
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // PRODUCTION MODE: Aggressive exit prevention
    if (process.env.NODE_ENV === 'production') {
      logger.log({
        message: '✅ Production exit prevention installed',
        level: 'info',
      });

      // Strategy 1: Keep stdin open
      process.stdin.resume();

      // Strategy 2: Prevent beforeExit
      process.on('beforeExit', (code) => {
        logger.log({
          message: `⚠ Prevented process exit with code ${code} - keeping alive`,
          level: 'warn',
        });
        setTimeout(() => {}, 1000);
      });

      // Strategy 3: Override process.exit to prevent accidental exits from libraries,
      // but SIGTERM/SIGINT use realExit (saved above) so they always work.
      process.exit = ((code?: number) => {
        logger.log({
          message: `⚠ Prevented process.exit(${code}) in production mode`,
          level: 'warn',
        });
        return undefined as never;
      }) as typeof process.exit;

      // Production heartbeat
      setInterval(() => {
        logger.log({
          message: `✅ Production heartbeat - uptime: ${Math.floor(process.uptime())}s`,
          level: 'info',
        });
      }, 60000);

      logger.log({
        message: '✅ Production infinite keep-alive loop started',
        level: 'info',
      });

    }

    logger.log({
      message: '✅ Health endpoint ready: /healthz',
      level: 'info',
    });
    logger.log({
      message: '✅ Server startup complete - ready for traffic',
      level: 'info',
    });
  } catch (error) {
    console.error('SERVER STARTUP FAILED:');
    console.error(error);
    serverLogger.error('✗ Server startup failed:');
    if (error instanceof Error) {
      serverLogger.error('Error message:', error.message);
      serverLogger.error('Error stack:', error.stack);
    } else {
      serverLogger.error('Error details:', String(error));
    }
    process.exit(1);
  }
}

// Start server - MUST NOT await, just call it
bootstrap();
