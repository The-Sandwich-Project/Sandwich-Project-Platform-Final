import { normalizeSheetStatus } from '../../server/utils/sheet-status';

describe('normalizeSheetStatus', () => {
  it.each([
    ['new', 'new'],
    ['New Request', 'new'],
    ['In Process', 'in_process'],
    ['in-process', 'in_process'],
    ['In Progress', 'in_process'],
    ['  SCHEDULED ', 'scheduled'],
    ['Canceled', 'cancelled'],
    ['Cancelled', 'cancelled'],
    ['Non-Event', 'non_event'],
    ['Standby', 'standby'],
  ])('maps %p to %p', (raw, expected) => {
    expect(normalizeSheetStatus(raw)).toBe(expected);
  });

  it.each([[''], ['   '], [null], [undefined], ['Maybe?'], ['contact_completed']])(
    'returns null for unrecognized value %p',
    (raw) => {
      expect(normalizeSheetStatus(raw as string | null | undefined)).toBeNull();
    }
  );
});
