import { renderDigest, eventLink, type DigestItem } from '../services/event-alerts/digest-email';

const BASE = 'https://app.example.org';

function item(patch: Partial<DigestItem['event']> = {}, extra: Partial<DigestItem> = {}): DigestItem {
  return {
    event: {
      id: 42,
      status: 'in_process',
      organizationName: 'Decatur Venom Softball',
      createdAt: new Date('2026-11-01T12:00:00Z'),
      desiredEventDate: new Date(Date.UTC(2026, 11, 12)),
      firstName: 'Pat',
      lastName: 'Lee',
      phone: '(404) 555-1234',
      email: 'pat@example.org',
      toolkitSent: false,
      ...patch,
    },
    lines: [{ line: 'No contact or updates in 8 days', ruleTypes: ['no_contact', 'stale_event'] }],
    maxSnoozeDays: null,
    ...extra,
  };
}

describe('digest email', () => {
  it('subject counts events', () => {
    expect(renderDigest('Brenda', [item()], BASE).subject).toBe('1 of your events could use a look');
    expect(renderDigest('Brenda', [item(), item({ id: 43 })], BASE).subject).toBe('2 of your events could use a look');
  });

  it('has tap-to-call, tap-to-email and the action deep links', () => {
    const { html } = renderDigest('Brenda', [item()], BASE);
    expect(html).toContain('href="tel:4045551234"');
    expect(html).toContain('href="mailto:pat@example.org"');
    expect(html).toContain(eventLink(BASE, 42, 'log-contact').replace(/&/g, '&amp;'));
    expect(html).toContain(eventLink(BASE, 42, 'toolkit').replace(/&/g, '&amp;'));
    expect(html).toContain(eventLink(BASE, 42, 'edit').replace(/&/g, '&amp;'));
    expect(html).toContain('Requested Sat, Dec 12');
  });

  it('snooze links carry both alerts of a merged line', () => {
    const { html } = renderDigest('Brenda', [item()], BASE);
    expect(html).toContain('rule=no_contact%2Cstale_event&amp;days=3');
  });

  it('only offers snoozes that end before the event', () => {
    const near = renderDigest('B', [item({}, { maxSnoozeDays: 3 })], BASE).html;
    expect(near).toContain('days=1');
    expect(near).toContain('days=3');
    expect(near).not.toContain('days=7');
    const tooClose = renderDigest('B', [item({}, { maxSnoozeDays: 0 })], BASE).html;
    expect(tooClose).not.toContain('Remind me again');
  });

  it('shows "Mark toolkit sent" only before scheduling and only if not sent yet', () => {
    const label = 'Mark toolkit sent';
    expect(renderDigest('B', [item({ toolkitSent: true })], BASE).html).not.toContain(label);
    expect(renderDigest('B', [item({ toolkitStatus: 'not_needed' })], BASE).html).not.toContain(label);
    expect(renderDigest('B', [item({ status: 'scheduled', scheduledEventDate: new Date(Date.UTC(2026, 11, 6)) })], BASE).html).not.toContain(label);
    expect(renderDigest('B', [item({ status: 'new' })], BASE).html).toContain(label);
  });

  it('says what is missing and links to add it', () => {
    const { html } = renderDigest('B', [item({ phone: null, email: '' })], BASE);
    expect(html).toMatch(/Phone: <span[^>]*>not on file<\/span>/);
    expect(html).toMatch(/Email: <span[^>]*>not on file<\/span>/);
    expect(html).toContain('add it');
  });

  it('shows scheduled date and time once scheduled', () => {
    const { html } = renderDigest('B', [item({ status: 'scheduled', scheduledEventDate: new Date(Date.UTC(2026, 11, 6)), eventStartTime: '14:30' })], BASE);
    expect(html).toContain('Scheduled Sun, Dec 6 at 2:30 PM');
  });

  it('escapes group-supplied text', () => {
    const { html } = renderDigest('B', [item({ organizationName: '<script>alert(1)</script>', firstName: 'A&B' })], BASE);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B');
  });

  it('bell and text versions are plain and short', () => {
    const r = renderDigest('B', [item()], BASE);
    expect(r.bellMessage).toBe('• Decatur Venom Softball: No contact or updates in 8 days');
    expect(r.sms.length).toBeLessThan(200);
  });
});
