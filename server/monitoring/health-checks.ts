/**
 * Enhanced Health Check System
 *
 * Provides detailed health status for all system components
 */

import type { Request, Response } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { systemHealth } from './metrics';
import { sql } from 'drizzle-orm';
import fs from 'fs';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  components: {
    database: ComponentHealth;
    memory: ComponentHealth;
    disk: ComponentHealth;
    websocket?: ComponentHealth;
    externalServices?: ComponentHealth;
  };
  metrics?: {
    totalRequests?: number;
    errorRate?: number;
    averageResponseTime?: number;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  latency?: number;
  details?: any;
}

/**
 * Check database health
 */
async function checkDatabaseHealth(): Promise<ComponentHealth> {
  const startTime = process.hrtime.bigint();
  try {
    // Simple query to check database connectivity
    await db.execute(sql`SELECT 1 as health`);

    const endTime = process.hrtime.bigint();
    const latency = Number(endTime - startTime) / 1e6; // Convert to milliseconds

    const status = latency < 100 ? 'healthy' : latency < 500 ? 'degraded' : 'unhealthy';

    systemHealth.set({ component: 'database' }, status === 'healthy' ? 1 : 0);

    return {
      status,
      message: status === 'healthy' ? 'Database connection is healthy' : 'Database is slow',
      latency,
      details: {
        type: process.env.NODE_ENV === 'production' ? 'PostgreSQL (Neon)' : 'SQLite',
      },
    };
  } catch (error: any) {
    systemHealth.set({ component: 'database' }, 0);
    logger.error('Database health check failed', { error: error.message });
    return {
      status: 'unhealthy',
      message: `Database connection failed: ${error.message}`,
    };
  }
}

/**
 * Check memory health
 */
function checkMemoryHealth(): ComponentHealth {
  const usage = process.memoryUsage();
  const totalMemory = usage.heapTotal;
  const usedMemory = usage.heapUsed;
  const memoryUsagePercent = (usedMemory / totalMemory) * 100;

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  let message = 'Memory usage is normal';

  if (memoryUsagePercent > 90) {
    status = 'unhealthy';
    message = 'Memory usage is critical';
  } else if (memoryUsagePercent > 75) {
    status = 'degraded';
    message = 'Memory usage is high';
  }

  systemHealth.set({ component: 'memory' }, status === 'healthy' ? 1 : 0);

  return {
    status,
    message,
    details: {
      heapUsed: `${(usedMemory / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(totalMemory / 1024 / 1024).toFixed(2)} MB`,
      usagePercent: `${memoryUsagePercent.toFixed(2)}%`,
      rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
      external: `${(usage.external / 1024 / 1024).toFixed(2)} MB`,
    },
  };
}

/**
 * Check disk health
 */
function checkDiskHealth(): ComponentHealth {
  // This is a simplified check
  // In production, you might want to check actual disk usage
  try {
    const tmpDir = '/tmp';

    // Try to write a test file
    fs.writeFileSync('/tmp/health-check.txt', 'health check');
    fs.unlinkSync('/tmp/health-check.txt');

    systemHealth.set({ component: 'disk' }, 1);

    return {
      status: 'healthy',
      message: 'Disk is writable',
    };
  } catch (error: any) {
    systemHealth.set({ component: 'disk' }, 0);
    return {
      status: 'unhealthy',
      message: `Disk write failed: ${error.message}`,
    };
  }
}

/**
 * Check WebSocket health
 */
function checkWebSocketHealth(io?: any, wss?: any): ComponentHealth {
  try {
    let socketIoClients = 0;
    let nativeWsClients = 0;

    if (io) {
      // Count Socket.IO clients
      io.of('/').sockets.forEach(() => socketIoClients++);
    }

    if (wss) {
      // Count native WebSocket clients
      wss.clients?.forEach(() => nativeWsClients++);
    }

    systemHealth.set({ component: 'websocket' }, 1);

    return {
      status: 'healthy',
      message: 'WebSocket servers are running',
      details: {
        socketIoConnections: socketIoClients,
        nativeWsConnections: nativeWsClients,
        totalConnections: socketIoClients + nativeWsClients,
      },
    };
  } catch (error: any) {
    systemHealth.set({ component: 'websocket' }, 0);
    return {
      status: 'degraded',
      message: `WebSocket health check failed: ${error.message}`,
    };
  }
}

/**
 * Check external services health
 */
async function checkExternalServicesHealth(): Promise<ComponentHealth> {
  const services = {
    email:
      !!process.env.TWILIO_EMAIL_API_KEY &&
      !!process.env.TWILIO_EMAIL_API_SECRET &&
      !!process.env.EMAIL_FROM_ADDRESS,
    sms: !!process.env.TWILIO_ACCOUNT_SID,
    googleSheets: !!process.env.GOOGLE_SHEETS_CREDENTIALS,
    googleCalendar: !!process.env.GOOGLE_CALENDAR_CREDENTIALS,
    slack: !!process.env.SLACK_BOT_TOKEN,
    sentry: !!process.env.SENTRY_DSN,
  };

  const configuredServices = Object.entries(services).filter(([_, configured]) => configured);
  const totalServices = configuredServices.length;

  systemHealth.set({ component: 'external_services' }, totalServices > 0 ? 1 : 0);

  return {
    status: totalServices > 0 ? 'healthy' : 'degraded',
    message: `${totalServices} external services configured`,
    details: services,
  };
}

/**
 * Perform comprehensive health check
 */
export async function performHealthCheck(io?: any, wss?: any): Promise<HealthCheckResult> {
  const startTime = Date.now();

  const [database, memory, disk, websocket, externalServices] = await Promise.all([
    checkDatabaseHealth(),
    Promise.resolve(checkMemoryHealth()),
    Promise.resolve(checkDiskHealth()),
    Promise.resolve(checkWebSocketHealth(io, wss)),
    checkExternalServicesHealth(),
  ]);

  const components = { database, memory, disk, websocket, externalServices };

  // Determine overall status
  const statuses = Object.values(components).map(c => c.status);
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (statuses.includes('unhealthy')) {
    overallStatus = 'unhealthy';
  } else if (statuses.includes('degraded')) {
    overallStatus = 'degraded';
  }

  const result: HealthCheckResult = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || 'unknown',
    components,
  };

  const duration = Date.now() - startTime;
  logger.debug('Health check completed', {
    status: overallStatus,
    duration: `${duration}ms`,
  });

  return result;
}

/**
 * Simple health check endpoint (for load balancers)
 */
export async function simpleHealthCheck(req: Request, res: Response): Promise<void> {
  try {
    // Quick database check
    await db.execute(sql`SELECT 1`);
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
}

/**
 * Detailed health check endpoint
 */
export async function detailedHealthCheck(req: Request, res: Response, io?: any, wss?: any): Promise<void> {
  try {
    const healthResult = await performHealthCheck(io, wss);
    const statusCode = healthResult.status === 'healthy' ? 200 : healthResult.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(healthResult);
  } catch (error: any) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Readiness check (for Kubernetes)
 */
export async function readinessCheck(req: Request, res: Response): Promise<void> {
  try {
    // Check if database is ready
    await db.execute(sql`SELECT 1`);
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not_ready' });
  }
}

/**
 * Liveness check (for Kubernetes)
 */
export function livenessCheck(req: Request, res: Response): void {
  // Server is alive if this endpoint responds
  res.status(200).json({ status: 'alive' });
}
