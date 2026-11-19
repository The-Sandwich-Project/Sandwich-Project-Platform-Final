/**
 * SendGrid unsubscribe handling: scanner-safe preferences link, unsubscribe
 * groups from env vars, and the global-unsubscribe bypass for operational mail.
 */
import { Mail } from '@sendgrid/helpers/classes';

const mockSend = jest.fn().mockResolvedValue([{ statusCode: 202 }]);
jest.mock('@sendgrid/mail', () => ({
  MailService: jest.fn().mockImplementation(() => ({
    setApiKey: jest.fn(),
    send: mockSend,
  })),
}));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../server/config/organization', () => ({ ADMIN_EMAIL: 'admin@example.org' }));

import {
  withUnsubscribeSettings,
  resetUnsubscribeWarningsForTests,
  ASM_PREFERENCES_TAG,
  PREFERENCES_LINK_TEXT,
} from '../../server/utils/sendgrid-unsubscribe';

const OPERATIONAL_ENV = 'SENDGRID_ASM_GROUP_ID_OPERATIONAL';
const NEWSLETTER_ENV = 'SENDGRID_ASM_GROUP_ID_NEWSLETTER';

const baseMsg = {
  to: 'volunteer@example.org',
  from: 'sender@example.org',
  subject: 'New Event Assignment: Test Org',
  html: '<html><body><p>Hello</p></body></html>',
  text: 'Hello',
};

/** What @sendgrid/mail actually puts on the wire for a message. */
function wireJson(msg: any): any {
  return Mail.create(msg).toJSON();
}

describe('withUnsubscribeSettings', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env[OPERATIONAL_ENV] = '101';
    process.env[NEWSLETTER_ENV] = '202';
    resetUnsubscribeWarningsForTests();
  });

  afterAll(() => {
    process.env = saved;
  });

  it('operational: group, both groups displayed, bypasses ONLY global unsubscribes, no subscription tracking', () => {
    const json = wireJson(withUnsubscribeSettings(baseMsg, 'operational'));

    expect(json.asm).toEqual({ group_id: 101, groups_to_display: [101, 202] });
    expect(json.mail_settings).toEqual({ bypass_unsubscribe_management: { enable: true } });
    expect(json.mail_settings.bypass_list_management).toBeUndefined();
    expect(json.mail_settings.bypass_bounce_management).toBeUndefined();
    expect(json.mail_settings.bypass_spam_management).toBeUndefined();
    expect(json.tracking_settings).toEqual({ subscription_tracking: { enable: false } });
  });

  it('newsletter: its own group and no unsubscribe bypass', () => {
    const json = wireJson(withUnsubscribeSettings(baseMsg, 'newsletter'));

    expect(json.asm).toEqual({ group_id: 202, groups_to_display: [101, 202] });
    expect(json.mail_settings).toBeUndefined();
    expect(json.tracking_settings).toEqual({ subscription_tracking: { enable: false } });
  });

  it('adds a visible preferences link (not an instant-unsubscribe tag) to HTML and text', () => {
    const out = withUnsubscribeSettings(baseMsg, 'operational');

    expect(out.html).toContain(`href="${ASM_PREFERENCES_TAG}"`);
    expect(out.html).toContain(PREFERENCES_LINK_TEXT);
    // Footer goes inside <body>
    expect(out.html.indexOf(PREFERENCES_LINK_TEXT)).toBeLessThan(out.html.indexOf('</body>'));
    expect(out.text).toBe(`Hello\n\n${PREFERENCES_LINK_TEXT}: ${ASM_PREFERENCES_TAG}`);

    const body = out.html + out.text;
    expect(body).not.toContain('asm_global_unsubscribe');
    expect(body).not.toContain('asm_group_unsubscribe');
  });

  it('appends to HTML fragments without a <body> tag', () => {
    const out = withUnsubscribeSettings({ ...baseMsg, html: '<div>Hi</div>' }, 'operational');
    expect(out.html.startsWith('<div>Hi</div>')).toBe(true);
    expect(out.html).toContain(PREFERENCES_LINK_TEXT);
  });

  it('leaves the original email content unchanged apart from the footer', () => {
    const out = withUnsubscribeSettings(baseMsg, 'operational');
    expect(out.subject).toBe(baseMsg.subject);
    expect(out.html.startsWith('<html><body><p>Hello</p>')).toBe(true);
    expect(out.text.startsWith('Hello')).toBe(true);
    // Input is not mutated
    expect(baseMsg.html).toBe('<html><body><p>Hello</p></body></html>');
  });

  it('is idempotent (no duplicate footer when applied twice)', () => {
    const once = withUnsubscribeSettings(baseMsg, 'operational');
    const twice = withUnsubscribeSettings(once, 'operational');
    expect(twice.html).toBe(once.html);
    expect(twice.text).toBe(once.text);
  });

  it('strips bypass_list_management and other suppression bypasses, keeping unrelated mail settings', () => {
    const msg = {
      ...baseMsg,
      mailSettings: {
        bypassListManagement: { enable: true },
        bypassBounceManagement: { enable: true },
        bypassSpamManagement: { enable: true },
        sandboxMode: { enable: true },
      },
    };
    const json = wireJson(withUnsubscribeSettings(msg, 'operational'));
    expect(json.mail_settings).toEqual({
      sandbox_mode: { enable: true },
      bypass_unsubscribe_management: { enable: true },
    });

    const newsletter = wireJson(
      withUnsubscribeSettings(
        { ...baseMsg, mailSettings: { bypassUnsubscribeManagement: { enable: true } } },
        'newsletter'
      )
    );
    expect(newsletter.mail_settings).toBeUndefined();
  });

  it('overrides a caller-supplied subscription tracking setting', () => {
    const msg = {
      ...baseMsg,
      trackingSettings: {
        subscriptionTracking: { enable: true },
        clickTracking: { enable: false, enableText: false },
      },
    };
    const json = wireJson(withUnsubscribeSettings(msg, 'operational'));
    expect(json.tracking_settings.subscription_tracking).toEqual({ enable: false });
    expect(json.tracking_settings.click_tracking).toEqual({ enable: false, enable_text: false });
  });

  it('without configured groups: no asm, mailto fallback link, still bypasses global unsubscribes for operational', () => {
    delete process.env[OPERATIONAL_ENV];
    delete process.env[NEWSLETTER_ENV];

    const out = withUnsubscribeSettings(baseMsg, 'operational');
    const json = wireJson(out);

    expect(json.asm).toBeUndefined();
    expect(out.html).not.toContain(ASM_PREFERENCES_TAG);
    expect(out.html).toContain('href="mailto:');
    expect(out.html).toContain(PREFERENCES_LINK_TEXT);
    expect(json.mail_settings).toEqual({ bypass_unsubscribe_management: { enable: true } });
    expect(json.tracking_settings).toEqual({ subscription_tracking: { enable: false } });
  });

  it('only displays the groups that are configured', () => {
    delete process.env[NEWSLETTER_ENV];
    const json = wireJson(withUnsubscribeSettings(baseMsg, 'operational'));
    expect(json.asm).toEqual({ group_id: 101, groups_to_display: [101] });
  });

  it('treats a non-numeric group id as unset', () => {
    process.env[OPERATIONAL_ENV] = 'event-assignments';
    const json = wireJson(withUnsubscribeSettings(baseMsg, 'operational'));
    expect(json.asm).toBeUndefined();
  });
});

describe('server/sendgrid.ts sendEmail wrapper', () => {
  beforeAll(() => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    process.env[OPERATIONAL_ENV] = '101';
    process.env[NEWSLETTER_ENV] = '202';
  });

  beforeEach(() => mockSend.mockClear());

  it('applies operational settings to what it hands SendGrid', async () => {
    const { sendEmail } = await import('../../server/sendgrid');
    const ok = await sendEmail({ ...baseMsg, emailStream: 'operational' });

    expect(ok).toBe(true);
    const sent = mockSend.mock.calls[0][0];
    expect(sent.emailStream).toBeUndefined();
    expect(sent.asm).toEqual({ groupId: 101, groupsToDisplay: [101, 202] });
    expect(sent.mailSettings).toEqual({ bypassUnsubscribeManagement: { enable: true } });
    expect(sent.trackingSettings).toEqual({ subscriptionTracking: { enable: false } });
    expect(sent.html).toContain(ASM_PREFERENCES_TAG);
  });

  it('applies newsletter settings without the bypass', async () => {
    const { sendEmail } = await import('../../server/sendgrid');
    await sendEmail({ ...baseMsg, emailStream: 'newsletter' });

    const sent = mockSend.mock.calls[0][0];
    expect(sent.asm).toEqual({ groupId: 202, groupsToDisplay: [101, 202] });
    expect(sent.mailSettings).toBeUndefined();
    expect(sent.trackingSettings).toEqual({ subscriptionTracking: { enable: false } });
  });
});
