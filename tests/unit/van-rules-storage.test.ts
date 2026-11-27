const mockReturning = jest.fn();
const mockWhere = jest.fn(() => ({ returning: mockReturning }));
const mockSet = jest.fn((values: Record<string, unknown>) => ({ where: mockWhere }));
const mockUpdate = jest.fn(() => ({ set: mockSet }));
jest.mock('../../server/db', () => ({ db: { update: mockUpdate, select: jest.fn() } }));
jest.mock('../../server/utils/production-safe-logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { DatabaseStorage } from '../../server/database-storage';
import type { EventRequest } from '@shared/schema';

/**
 * The van cleanup also runs in storage.updateEventRequest, so writers that
 * skip the PATCH/PUT routes (the planning-sheet "apply update", the Sheets
 * sync, scripts) can't leave a stale "team OK'd" or van-time override behind.
 */
const stored = {
  id: 1,
  vanDriverNeeded: true,
  vanTeamOk: true,
  vanReason: 'no fridge',
  vanTimeOverride: 'PM',
  eventStartTime: '09:00',
  eventEndTime: '11:00',
  desiredEventDate: new Date('2026-12-01T12:00:00Z'),
  scheduledEventDate: new Date('2026-12-05T12:00:00Z'),
} as unknown as EventRequest;

let storage: DatabaseStorage;
const written = () => mockSet.mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  mockReturning.mockResolvedValue([stored]);
  storage = new DatabaseStorage();
  jest.spyOn(storage, 'getEventRequest').mockResolvedValue(stored);
});
afterEach(() => jest.restoreAllMocks());

it('a sheet move to a new day clears the old sharing OK', async () => {
  await storage.updateEventRequest(1, { scheduledEventDate: new Date('2026-12-08T12:00:00Z') } as any);
  expect(written()).toMatchObject({ vanTeamOk: false });
});

it('new times clear the van-time override', async () => {
  await storage.updateEventRequest(1, { eventStartTime: '13:00' } as any);
  expect(written()).toMatchObject({ vanTimeOverride: null });
});

it('a new requested date does not clear the OK while the scheduled date stands', async () => {
  await storage.updateEventRequest(1, { desiredEventDate: new Date('2026-12-02T12:00:00Z') } as any);
  expect(written()).not.toHaveProperty('vanTeamOk');
});

it('leaving TSP\'s van clears the OK and reason', async () => {
  await storage.updateEventRequest(1, { isDhlVan: true } as any);
  expect(written()).toMatchObject({ vanTeamOk: false, vanReason: null });
});

it('an update that touches nothing van-related reads nothing extra and changes nothing', async () => {
  await storage.updateEventRequest(1, { planningNotes: 'hello' } as any);
  expect(storage.getEventRequest).not.toHaveBeenCalled();
  expect(written()).not.toHaveProperty('vanTeamOk');
});
