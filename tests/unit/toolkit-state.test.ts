import { isToolkitSent, normalizeToolkitPatch } from '../../shared/toolkit-state';

describe('toolkit save consistency', () => {
  it.each([
    ['sent', true], ['received_confirmed', true], ['not_sent', false], ['not_needed', false],
  ])('uses explicit %s status over a stale checkbox', (toolkitStatus, expected) => {
    expect(normalizeToolkitPatch({ toolkitStatus: toolkitStatus as string, toolkitSent: !expected }))
      .toEqual({ toolkitStatus, toolkitSent: expected });
  });

  it.each([['sent', true], ['received_confirmed', true], ['not_sent', false], ['not_needed', false]])(
    'supports status-only %s patches', (toolkitStatus, expected) => {
      expect(normalizeToolkitPatch({ toolkitStatus: toolkitStatus as string }).toolkitSent).toBe(expected);
    });

  it('supports spreadsheet boolean-only toggles in both directions', () => {
    expect(normalizeToolkitPatch({ toolkitSent: true })).toEqual({ toolkitSent: true, toolkitStatus: 'sent' });
    expect(normalizeToolkitPatch({ toolkitSent: false }, { toolkitStatus: 'sent' }))
      .toEqual({ toolkitSent: false, toolkitStatus: 'not_sent' });
  });

  it('preserves confirmation and not-needed distinctions for matching boolean toggles', () => {
    expect(normalizeToolkitPatch({ toolkitSent: true }, { toolkitStatus: 'received_confirmed' }).toolkitStatus)
      .toBe('received_confirmed');
    expect(normalizeToolkitPatch({ toolkitSent: false }, { toolkitStatus: 'not_needed' }).toolkitStatus)
      .toBe('not_needed');
  });

  it('handles legacy null status with an explicit boolean', () => {
    expect(normalizeToolkitPatch({ toolkitStatus: null, toolkitSent: false }).toolkitStatus).toBe('not_sent');
  });

  it('does not silently reconcile an unrelated save', () => {
    const patch = { organizationName: 'Example', toolkitSent: undefined };
    expect(normalizeToolkitPatch(patch, { toolkitStatus: 'sent', toolkitSent: false })).toEqual(patch);
  });

  it('never manufactures or removes historical dates or senders', () => {
    const patch = { toolkitStatus: 'not_sent', toolkitSentDate: '2025-01-01', toolkitSentBy: 'user-1' };
    expect(normalizeToolkitPatch(patch)).toEqual({ ...patch, toolkitSent: false });
    expect(normalizeToolkitPatch({ toolkitStatus: 'sent' })).not.toHaveProperty('toolkitSentDate');
  });

  it('recognizes already-sent legacy conflicts without counting another contact attempt', () => {
    expect(isToolkitSent({ toolkitStatus: 'sent', toolkitSent: false })).toBe(true);
    expect(isToolkitSent({ toolkitStatus: 'received_confirmed', toolkitSent: false })).toBe(true);
    expect(isToolkitSent({ toolkitStatus: null, toolkitSent: true })).toBe(true);
    expect(isToolkitSent({ toolkitStatus: 'not_needed', toolkitSent: true })).toBe(false);
  });
});
