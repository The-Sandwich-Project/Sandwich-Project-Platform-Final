/**
 * POST /api/event-check-in-reminders/bulk used to throw a ReferenceError for
 * every enabled rule (isConditionBasedRule was never imported), so saving
 * reminder rules with any rule turned on returned 500 and saved nothing.
 */
import express from 'express';
import request from 'supertest';

// db.select() chains resolve to the next queued result; insert/update chains
// echo back what was written.
const mockSelectQueue: unknown[][] = [];
const mockInserted: any[] = [];
jest.mock('../../server/db', () => {
  const selectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(mockSelectQueue.shift() ?? []),
    };
    return chain;
  };
  return {
    db: {
      select: () => selectChain(),
      insert: () => ({
        values: (v: any) => ({
          returning: () => {
            mockInserted.push(v);
            return Promise.resolve([{ id: mockInserted.length, ...v }]);
          },
        }),
      }),
      update: () => ({
        set: (v: any) => ({ where: () => ({ returning: () => Promise.resolve([v]) }) }),
      }),
    },
  };
});
jest.mock('../../server/sms-service', () => ({}));
jest.mock('@sendgrid/mail', () => ({ __esModule: true, default: { send: jest.fn(), setApiKey: jest.fn() } }));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import router from '../../server/routes/event-check-in-reminders';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  });
  a.use('/api/event-check-in-reminders', router);
  return a;
}

describe('POST /api/event-check-in-reminders/bulk', () => {
  beforeEach(() => {
    mockSelectQueue.length = 0;
    mockInserted.length = 0;
  });

  it('saves enabled condition-based and frequency rules', async () => {
    // event lookup, then "existing rule?" lookup per rule (none exist)
    mockSelectQueue.push([{ id: 7 }], [], []);

    const res = await request(app())
      .post('/api/event-check-in-reminders/bulk')
      .send({
        eventRequestId: 7,
        rules: [
          { ruleType: 'no_contact', enabled: true, thresholdDays: 5, channel: 'email' },
          { ruleType: 'general_checkin', enabled: true, frequency: 'weekly', channel: 'email' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.reminders).toHaveLength(2);
    expect(mockInserted).toHaveLength(2);
    // Enabled rules get a next due date
    expect(mockInserted[0].nextDueAt).toBeTruthy();
    expect(mockInserted[1].nextDueAt).toBeTruthy();
  });
});
