/**
 * DELETE /api/sandwich-collections/:id and POST /:id/restore called an
 * undefined `logActivity` AFTER the change was saved, so users saw "Failed to
 * delete collection" (500) even though the delete had gone through, and nothing
 * reached the audit log. They now record to the audit log and return success.
 */
import express from 'express';
import request from 'supertest';

const mockStorage = {
  getSandwichCollectionById: jest.fn(),
  deleteSandwichCollection: jest.fn(),
  restoreSandwichCollection: jest.fn(),
};
jest.mock('../../server/storage-wrapper', () => ({ storage: mockStorage }));
jest.mock('../../server/middleware/auth', () => {
  const pass = () => (_req: any, _res: any, next: any) => next();
  return { requirePermission: pass, requireOwnershipPermission: pass };
});
jest.mock('../../server/middleware/uploads', () => ({
  upload: { single: () => (_req: any, _res: any, next: any) => next() },
}));
jest.mock('../../server/performance/query-optimizer', () => ({
  QueryOptimizer: { invalidateCache: jest.fn() },
}));
jest.mock('../../server/routes/collections/historical-import', () => {
  const { Router } = require('express');
  return { __esModule: true, default: Router() };
});
jest.mock('../../server/services/onboarding-service', () => ({ onboardingService: {} }));
jest.mock('../../server/socket-chat', () => ({ getSocketInstance: () => null }));
const mockAudit = { logDelete: jest.fn(), logUpdate: jest.fn() };
jest.mock('../../server/audit-logger', () => ({ AuditLogger: mockAudit }));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import collectionsRouter from '../../server/routes/collections/index';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  });
  a.use('/api/sandwich-collections', collectionsRouter);
  return a;
}

describe('sandwich collection delete / restore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.getSandwichCollectionById.mockResolvedValue({ id: 5, deletedAt: null });
  });

  it('deletes, returns 204 and records the delete in the audit log', async () => {
    mockStorage.deleteSandwichCollection.mockResolvedValue(true);

    const res = await request(app()).delete('/api/sandwich-collections/5');

    expect(res.status).toBe(204);
    expect(mockStorage.deleteSandwichCollection).toHaveBeenCalledWith(5, 'user-1');
    expect(mockAudit.logDelete).toHaveBeenCalledWith(
      'sandwich_collections',
      '5',
      expect.any(Object),
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('returns 404 for a collection that does not exist, without logging', async () => {
    mockStorage.deleteSandwichCollection.mockResolvedValue(false);

    const res = await request(app()).delete('/api/sandwich-collections/999');

    expect(res.status).toBe(404);
    expect(mockAudit.logDelete).not.toHaveBeenCalled();
  });

  it('restores, returns the collection and records the restore', async () => {
    mockStorage.restoreSandwichCollection.mockResolvedValue(true);

    const res = await request(app()).post('/api/sandwich-collections/5/restore');

    expect(res.status).toBe(200);
    expect(res.body.collection).toEqual({ id: 5, deletedAt: null });
    expect(mockAudit.logUpdate).toHaveBeenCalledWith(
      'sandwich_collections',
      '5',
      { id: 5, deleted: true },
      { id: 5, deleted: false },
      expect.objectContaining({ userId: 'user-1' })
    );
  });
});
