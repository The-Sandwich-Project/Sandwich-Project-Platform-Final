/**
 * Authentication Integration Tests
 *
 * Tests that all routes properly enforce authentication requirements
 */

import request from 'supertest';
import { createTestServer } from '../../setup/test-server';
import type { Express } from 'express';

describe('Authentication Tests', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createTestServer();
  });

  describe('Protected Routes Reject Unauthenticated Requests', () => {
    const protectedRoutes = [
      { method: 'get', path: '/api/drivers' },
      { method: 'get', path: '/api/volunteers' },
      { method: 'get', path: '/api/hosts' },
      { method: 'get', path: '/api/emails' },
      { method: 'get', path: '/api/onboarding/challenges' },
      { method: 'get', path: '/api/google-sheets' },
      { method: 'get', path: '/api/google-calendar/events' },
      { method: 'get', path: '/api/recipient-tsp-contacts/1' },
      { method: 'get', path: '/api/sandwich-distributions' },
      { method: 'get', path: '/api/message-notifications/unread-counts' },
      { method: 'get', path: '/api/announcements' },
    ];

    test.each(protectedRoutes)(
      '$method $path should return 401 without authentication',
      async ({ method, path }) => {
        const response = await (request(app) as any)[method](path);

        expect([401, 403]).toContain(response.status);
      }
    );
  });

  describe('Public Routes Allow Unauthenticated Access', () => {
    const publicRoutes = [
      { method: 'post', path: '/api/forgot-password', body: { email: 'test@example.com' } },
      { method: 'get', path: '/api/verify-reset-token/test-token' },
    ];

    test.each(publicRoutes)(
      '$method $path should not require authentication',
      async ({ method, path, body }) => {
        const response = await (request(app) as any)[method](path).send(body || {});

        // Should not be 401/403 (may be 404, 400, or 200 depending on data)
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      }
    );
  });
});
