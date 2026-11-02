const mockReturning = jest.fn();
const mockWhere = jest.fn((condition: import('drizzle-orm').SQL) => ({ returning: mockReturning }));
const mockSet = jest.fn((values: Record<string, unknown>) => ({ where: mockWhere }));
const mockUpdate = jest.fn(() => ({ set: mockSet }));
const mockFrom = jest.fn();
const mockSelect = jest.fn(() => ({ from: mockFrom }));
jest.mock('../../server/db', () => ({ db: { update: mockUpdate, select: mockSelect } }));
jest.mock('../../server/utils/production-safe-logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { PgDialect } from 'drizzle-orm/pg-core';
import { DatabaseStorage } from '../../server/database-storage';
import type { EventRequest } from '@shared/schema';

const dialect = new PgDialect();
const previous = {
  id: 1, tspContact: 'a', tspContactAssigned: 'a',
  planningNotes: 'Original notes', customTspContact: 'Original custom',
} as EventRequest;
let storage: DatabaseStorage;
let read: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockReturning.mockReset();
  mockFrom.mockResolvedValue([{ id: 'a', firstName: 'Alex', lastName: 'One' }, { id: 'b', firstName: 'Blair', lastName: 'Two' }]);
  storage = new DatabaseStorage();
  read = jest.spyOn(storage, 'getEventRequest').mockResolvedValue(previous);
});
afterEach(() => jest.restoreAllMocks());

it('re-normalizes a contact update after a concurrent planning-note save', async () => {
  const concurrent = { ...previous, planningNotes: 'Other user saved these notes' };
  read.mockResolvedValueOnce(previous).mockResolvedValueOnce(concurrent);
  mockReturning.mockResolvedValueOnce([]).mockImplementationOnce(async () => [{ ...concurrent, ...mockSet.mock.calls[1][0] }]);
  const saved = await storage.updateEventRequest(1, { tspContact: 'Blair Two' });
  expect(saved?.planningNotes).toBe('Other user saved these notes\n[Imported TSP contact] Blair Two');
  expect(saved?.tspContact).toBe('b');
  expect(mockUpdate).toHaveBeenCalledTimes(2);
  const firstGuard = dialect.sqlToQuery(mockWhere.mock.calls[0][0]);
  expect(firstGuard.sql).toContain('"planning_notes" IS NOT DISTINCT FROM');
  expect(firstGuard.params).toContain('Original notes');
  expect(dialect.sqlToQuery(mockWhere.mock.calls[1][0]).params).toContain(concurrent.planningNotes);
});

it('guards both omitted notes fields for a new unresolved label', async () => {
  const concurrent = { ...previous, planningNotes: 'Concurrent notes', customTspContact: 'Concurrent custom' };
  read.mockResolvedValueOnce(previous).mockResolvedValueOnce(concurrent);
  mockReturning.mockResolvedValueOnce([]).mockImplementationOnce(async () => [{ ...concurrent, ...mockSet.mock.calls[1][0] }]);
  const saved = await storage.updateEventRequest(1, { tspContact: 'Alex/Blair' });
  expect(saved).toMatchObject({ tspContact: null, tspContactAssigned: null,
    planningNotes: 'Concurrent notes\n[Imported TSP contact] Alex/Blair', customTspContact: 'Concurrent custom\nAlex/Blair' });
  const guard = dialect.sqlToQuery(mockWhere.mock.calls[0][0]);
  expect(guard.sql).toContain('"planning_notes" IS NOT DISTINCT FROM');
  expect(guard.sql).toContain('"custom_tsp_contact" IS NOT DISTINCT FROM');
  expect(guard.params).toEqual(expect.arrayContaining(['Original notes', 'Original custom']));
});

it('uses a null-safe condition when previous notes are null', async () => {
  read.mockResolvedValue({ ...previous, planningNotes: null });
  mockReturning.mockResolvedValue([{ ...previous, tspContact: 'b' }]);
  await storage.updateEventRequest(1, { tspContact: 'Blair Two' });
  const guard = dialect.sqlToQuery(mockWhere.mock.calls[0][0]);
  expect(guard.sql).toContain('IS NOT DISTINCT FROM');
  expect(guard.params).toContain(null);
});

it('does not replace an explicit notes edit with a previous snapshot', async () => {
  mockReturning.mockResolvedValue([previous]);
  await storage.updateEventRequest(1, { tspContact: 'Blair Two', planningNotes: 'Explicit replacement' });
  expect(mockSet.mock.calls[0][0].planningNotes).toBe('Explicit replacement\n[Imported TSP contact] Blair Two');
  expect(dialect.sqlToQuery(mockWhere.mock.calls[0][0]).sql).not.toContain('planning_notes');
});

it('does not manufacture a successful save when all conditional writes conflict', async () => {
  mockReturning.mockResolvedValue([]);
  await expect(storage.updateEventRequest(1, { tspContact: 'Blair Two' })).rejects.toThrow('Conflict: Event notes changed');
  expect(mockUpdate).toHaveBeenCalledTimes(3);
  expect(read).toHaveBeenCalledTimes(3);
});

it('does not add note conditions to a plain user-ID reassignment', async () => {
  mockReturning.mockResolvedValue([previous]);
  await storage.updateEventRequest(1, { tspContact: 'b' });
  expect(mockSet.mock.calls[0][0]).not.toHaveProperty('planningNotes');
  expect(dialect.sqlToQuery(mockWhere.mock.calls[0][0]).sql).not.toContain('IS NOT DISTINCT FROM');
});
