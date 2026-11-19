/**
 * PUT /api/me/check-in-reminder-preferences must refuse an SMS channel
 * ('sms' or 'both') unless the user has confirmed SMS, since the reminder
 * job would silently skip those texts.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const users: any[] = [];
const mockStorage = {
  getAllUsers: jest.fn(async () => users),
  updateUser: jest.fn(async () => ({})),
};

jest.mock('../../server/storage-wrapper', () => ({ storage: mockStorage }));
// The save path clears the user's old per-event snoozes: db.update().set().where()
jest.mock('../../server/db', () => ({
  db: { update: () => ({ set: () => ({ where: async () => undefined }) }) },
}));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import meRouter from '../../server/routes/me';

function appFor(userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/me', meRouter);
  return app;
}

const body = (defaultChannel: string) => ({ configured: true, defaultChannel, rules: [] });

describe('check-in reminder preferences: SMS channel gate', () => {
  beforeEach(() => {
    users.length = 0;
    users.push(
      { id: 'no-sms', metadata: {} },
      { id: 'opted-out', metadata: { smsConsent: { enabled: false, phoneNumber: null } } },
      { id: 'sms-on', metadata: { smsConsent: { enabled: true, status: 'confirmed', phoneNumber: '+14045550000' } } }
    );
    mockStorage.updateUser.mockClear();
  });

  it.each(['sms', 'both'])('rejects %s for a user without SMS', async (channel) => {
    for (const id of ['no-sms', 'opted-out']) {
      const res = await request(appFor(id))
        .put('/api/me/check-in-reminder-preferences')
        .send(body(channel));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SMS_NOT_ENABLED');
      expect(res.body.message).toMatch(/turn on text messages/i);
    }
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });

  it('allows email for a user without SMS', async () => {
    const res = await request(appFor('no-sms'))
      .put('/api/me/check-in-reminder-preferences')
      .send(body('email'));
    expect(res.status).toBe(200);
    expect(mockStorage.updateUser).toHaveBeenCalled();
  });

  it('allows sms for a user with confirmed SMS', async () => {
    const res = await request(appFor('sms-on'))
      .put('/api/me/check-in-reminder-preferences')
      .send(body('both'));
    expect(res.status).toBe(200);
    expect(mockStorage.updateUser).toHaveBeenCalled();
  });
});
