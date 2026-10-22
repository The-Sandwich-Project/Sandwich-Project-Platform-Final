import { describe, it, expect } from '@jest/globals';
import { compareEventsByDateThenTime } from '../event-sort';

const ev = (
  id: string,
  date: string,
  times: { start?: string | null; pickup?: string | null; pickupDateTime?: string | null } = {}
) => ({
  id,
  scheduledEventDate: date as any,
  desiredEventDate: null,
  eventStartTime: times.start ?? null,
  pickupTime: times.pickup ?? null,
  pickupDateTime: times.pickupDateTime ?? null,
});

const order = (events: ReturnType<typeof ev>[], dir: 'asc' | 'desc') =>
  [...events].sort((a, b) => compareEventsByDateThenTime(a, b, dir)).map((e) => e.id);

describe('compareEventsByDateThenTime', () => {
  const day1 = '2026-11-03T00:00:00.000Z';
  const day2 = '2026-11-04T00:00:00.000Z';

  it('orders by start time within a date, earliest first', () => {
    const events = [ev('late', day1, { start: '14:00:00' }), ev('early', day1, { start: '9:30 AM' })];
    expect(order(events, 'asc')).toEqual(['early', 'late']);
  });

  it('falls back to pickup time when there is no start time', () => {
    const events = [
      ev('start-noon', day1, { start: '12:00' }),
      ev('pickup-10', day1, { pickup: '10:00 AM' }),
      ev('pickupdt-1pm', day1, { pickupDateTime: '2026-11-03T13:00:00' }),
    ];
    expect(order(events, 'asc')).toEqual(['pickup-10', 'start-noon', 'pickupdt-1pm']);
  });

  it('puts events with no times at the bottom of their date', () => {
    const events = [ev('none', day1), ev('timed', day1, { start: '16:00' }), ev('next-day', day2, { start: '08:00' })];
    expect(order(events, 'asc')).toEqual(['timed', 'none', 'next-day']);
  });

  it('keeps earliest-first within a date even when dates sort newest first', () => {
    const events = [
      ev('d1-late', day1, { start: '15:00' }),
      ev('d2-none', day2),
      ev('d1-early', day1, { start: '08:00' }),
      ev('d2-early', day2, { start: '09:00' }),
    ];
    expect(order(events, 'desc')).toEqual(['d2-early', 'd2-none', 'd1-early', 'd1-late']);
  });

  it('treats different stored times on the same calendar day as the same date', () => {
    const events = [
      ev('stored-later', '2026-11-03T12:00:00.000Z', { start: '08:00' }),
      ev('stored-midnight', day1, { start: '17:00' }),
    ];
    expect(order(events, 'asc')).toEqual(['stored-later', 'stored-midnight']);
  });
});
