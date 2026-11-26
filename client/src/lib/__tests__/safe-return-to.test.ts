import { safeReturnTo } from '@/lib/safe-return-to';

const O = 'https://app.example.org';
const q = (v: string) => `?returnTo=${encodeURIComponent(v)}`;

describe('safeReturnTo', () => {
  it('returns same-site deep links unchanged', () => {
    const link = '/dashboard?section=event-requests&tab=all&eventId=3&action=log-contact';
    expect(safeReturnTo(q(link), O)).toBe(link);
  });

  it.each([
    ['protocol-relative', '//evil.example'],
    ['tab trick (browser strips it)', '/\t/evil.example'],
    ['newline trick', '/\n/evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['absolute URL', 'https://evil.example/x'],
    ['javascript URL', 'javascript:alert(1)'],
    ['login loop', '/login?returnTo=/x'],
  ])('rejects %s', (_label, value) => {
    expect(safeReturnTo(q(value), O)).toBe('/');
  });

  it('defaults to home without a returnTo', () => {
    expect(safeReturnTo('', O)).toBe('/');
  });
});
