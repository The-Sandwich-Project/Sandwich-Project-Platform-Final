import { formatAttendance, normalizeAttendancePatch, parseAttendanceText } from '../../shared/attendance-estimate';
import { effectiveNextDayPickup } from '../../shared/next-day-pickup';
import { strictBooleanFieldError } from '../../server/utils/strict-boolean-fields';

describe('expected attendees', () => {
  it('reads a number or a range', () => {
    expect(parseAttendanceText('40').fields).toEqual({ estimatedAttendance: 40, estimatedAttendanceMin: null, estimatedAttendanceMax: null });
    expect(parseAttendanceText('40-60').fields).toEqual({ estimatedAttendance: 50, estimatedAttendanceMin: 40, estimatedAttendanceMax: 60 });
    expect(parseAttendanceText('40 to 61').fields.estimatedAttendance).toBe(51);
    expect(parseAttendanceText('60–40').fields).toMatchObject({ estimatedAttendanceMin: 40, estimatedAttendanceMax: 60 });
    expect(parseAttendanceText('1,200').fields.estimatedAttendance).toBe(1200);
    expect(parseAttendanceText('50-50').fields).toEqual({ estimatedAttendance: 50, estimatedAttendanceMin: null, estimatedAttendanceMax: null });
    expect(parseAttendanceText('').error).toBeNull();
    expect(parseAttendanceText('about 40').error).toMatch(/isn't a number or a range/);
  });

  it('shows a stored range, else the number', () => {
    expect(formatAttendance({ estimatedAttendance: 50, estimatedAttendanceMin: 40, estimatedAttendanceMax: 60 })).toBe('40–60');
    expect(formatAttendance({ estimatedAttendance: 40 })).toBe('40');
    expect(formatAttendance({})).toBe('');
    expect(formatAttendance({ estimatedAttendance: 5, estimatedAttendanceMin: 0, estimatedAttendanceMax: 10 })).toBe('0–10');
    expect(formatAttendance({ estimatedAttendance: 40, estimatedAttendanceMin: 0, estimatedAttendanceMax: 0 })).toBe('40');
    expect(parseAttendanceText('0-10').fields).toEqual({ estimatedAttendance: 5, estimatedAttendanceMin: 0, estimatedAttendanceMax: 10 });
  });

  it('a new plain number clears an old range on save', () => {
    expect(normalizeAttendancePatch({ estimatedAttendance: 100 })).toEqual({ estimatedAttendance: 100, estimatedAttendanceMin: null, estimatedAttendanceMax: null });
    expect(normalizeAttendancePatch({ estimatedAttendance: 50, estimatedAttendanceMin: 40, estimatedAttendanceMax: 60 })).toMatchObject({ estimatedAttendanceMin: 40 });
    expect(normalizeAttendancePatch({ notes: 'x' })).toEqual({ notes: 'x' });
  });
});

describe('next-day pickup', () => {
  it('uses the stored choice, else derives it for older events', () => {
    expect(effectiveNextDayPickup({ nextDayPickup: 'option' })).toBe('option');
    expect(effectiveNextDayPickup({ nextDayPickup: null, overnightHoldingLocation: 'Church hall' })).toBe('planned');
    expect(effectiveNextDayPickup({ nextDayPickup: null, overnightHoldingLocation: '  ' })).toBe('no');
    expect(effectiveNextDayPickup(null)).toBe('no');
  });
});

describe('constrained fields are refused with a clear message', () => {
  it('TSP shopping must be exactly true or false', () => {
    expect(strictBooleanFieldError({ isTspShopped: true })).toBeNull();
    expect(strictBooleanFieldError({ isTspShopped: false })).toBeNull();
    expect(strictBooleanFieldError({ isTspShopped: null })).toBe('isTspShopped must be true or false');
    expect(strictBooleanFieldError({ isTspShopped: 'yes' })).toBe('isTspShopped must be true or false');
    expect(strictBooleanFieldError({ notes: 'x' })).toBeNull();
  });
  it('next-day pickup must be one of the three choices', () => {
    expect(strictBooleanFieldError({ nextDayPickup: 'planned' })).toBeNull();
    expect(strictBooleanFieldError({ nextDayPickup: null })).toBeNull();
    expect(strictBooleanFieldError({ nextDayPickup: 'maybe' })).toMatch(/must be one of: no, option, planned/);
  });
});

describe('inline overnight saves keep next-day pickup in sync', () => {
  const { normalizeNextDayPickupPatch } = require('../../shared/next-day-pickup');
  it('saving a location without a choice marks it planned', () => {
    expect(normalizeNextDayPickupPatch({ overnightHoldingLocation: 'Church hall' })).toEqual({ overnightHoldingLocation: 'Church hall', nextDayPickup: 'planned' });
  });
  it('an explicit choice, a cleared location, or unrelated saves are left alone', () => {
    expect(normalizeNextDayPickupPatch({ overnightHoldingLocation: 'Church', nextDayPickup: 'option' })).toEqual({ overnightHoldingLocation: 'Church', nextDayPickup: 'option' });
    expect(normalizeNextDayPickupPatch({ overnightHoldingLocation: null })).toEqual({ overnightHoldingLocation: null });
    expect(normalizeNextDayPickupPatch({ notes: 'x' })).toEqual({ notes: 'x' });
  });
});
