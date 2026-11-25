/**
 * The shared email helper (server/services/email): Twilio Email request
 * shape, auth, error handling, copies instead of CC/BCC, the Reply-To
 * fallback line, suppressions and the email-preferences page.
 */
import express from 'express';
import request from 'supertest';

const mockGetScopes = jest.fn();
const mockAddSuppression = jest.fn();
const mockRemoveUnsubscribes = jest.fn();
jest.mock('../../server/services/email/suppressions', () => {
  const actual = jest.requireActual('../../server/services/email/suppressions');
  return {
    normalizeEmail: actual.normalizeEmail,
    isSuppressedFor: actual.isSuppressedFor,
    getSuppressionScopes: (...a: unknown[]) => mockGetScopes(...a),
    addSuppression: (...a: unknown[]) => mockAddSuppression(...a),
    removeUnsubscribes: (...a: unknown[]) => mockRemoveUnsubscribes(...a),
  };
});
jest.mock('../../server/db', () => ({ db: {} }));
const mockLoggerError = jest.fn();
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: (...a: unknown[]) => mockLoggerError(...a), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../server/services/application-error-logger', () => ({ logApplicationError: jest.fn() }));

import {
  sendEmailWithResult,
  sendEmailOrThrow,
  TWILIO_EMAIL_ENDPOINT,
  EmailSendError,
} from '../../server/services/email';
import {
  createEmailPreferencesRouter,
  createPreferencesToken,
  verifyPreferencesToken,
} from '../../server/services/email/preferences';

const ADMIN = 'katie@thesandwichproject.org';
const KEY = 'SKtestkey123';
const SECRET = 'super-secret-value';

let fetchMock: jest.Mock;
const savedEnv = { ...process.env };

function accepted(id = 'op_1') {
  return { ok: true, status: 202, text: async () => JSON.stringify({ operationId: id, operationLocation: `/v1/Operations/${id}` }) };
}
function bodies(): any[] {
  return fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
}
function recipients(): string[] {
  return bodies().map((b) => b.to[0].address);
}

beforeEach(() => {
  process.env.TWILIO_EMAIL_API_KEY = KEY;
  process.env.TWILIO_EMAIL_API_SECRET = SECRET;
  process.env.EMAIL_FROM_ADDRESS = ADMIN;
  process.env.SESSION_SECRET = 'session-secret-for-tests';
  process.env.CLIENT_URL = 'https://app.test';
  fetchMock = jest.fn().mockResolvedValue(accepted());
  (global as any).fetch = fetchMock;
  mockGetScopes.mockReset().mockResolvedValue(new Map());
  mockAddSuppression.mockReset().mockResolvedValue(undefined);
  mockRemoveUnsubscribes.mockReset().mockResolvedValue(1);
  mockLoggerError.mockClear();
});

afterAll(() => {
  process.env = savedEnv;
});

describe('request to Twilio', () => {
  it('posts the Twilio Email shape with Basic auth', async () => {
    const result = await sendEmailWithResult({
      emailStream: 'operational',
      adminCopy: false,
      to: { email: 'pat@example.org', name: 'Pat' },
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(result).toEqual({ success: true, operationIds: ['op_1'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TWILIO_EMAIL_ENDPOINT);
    expect(url).toBe('https://comms.twilio.com/v1/Emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`);
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.from).toEqual({ address: ADMIN, name: 'The Sandwich Project' });
    expect(body.to).toEqual([{ address: 'pat@example.org', name: 'Pat' }]);
    expect(body.content.subject).toBe('Hello');
    expect(body.content.html).toContain('<p>Hi</p>');
    expect(body.content.text).toMatch(/^Hi/);
    expect(body.tags).toEqual({ stream: 'operational' });
    // No SendGrid-only fields
    expect(body).not.toHaveProperty('personalizations');
    expect(body).not.toHaveProperty('asm');
  });

  it('parses "Name <address>" and builds HTML from a text-only body', async () => {
    await sendEmailWithResult({
      emailStream: 'operational',
      adminCopy: false,
      from: 'Pat Lee <pat@thesandwichproject.org>',
      to: 'a@example.org',
      subject: 's',
      text: 'line 1\n<b>not html</b>',
    });
    const body = bodies()[0];
    expect(body.from).toEqual({ address: 'pat@thesandwichproject.org', name: 'Pat Lee' });
    expect(body.content.html).toContain('line 1\n&lt;b&gt;not html&lt;/b&gt;');
  });

  it('treats a non-2xx response as an error and never logs the credentials', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify({ message: 'from address is not verified' }) });

    const result = await sendEmailWithResult({ emailStream: 'operational', adminCopy: false, to: 'a@example.org', subject: 's', html: 'x' });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('from address is not verified');
    const logged = JSON.stringify(mockLoggerError.mock.calls);
    expect(logged).toContain('400');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(Buffer.from(`${KEY}:${SECRET}`).toString('base64'));
  });

  it('sendEmailOrThrow throws on failure, like @sendgrid/mail did', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(
      sendEmailOrThrow({ emailStream: 'operational', to: 'a@example.org', subject: 's', html: 'x' })
    ).rejects.toBeInstanceOf(EmailSendError);
  });

  it('does not call Twilio when the env vars are missing', async () => {
    delete process.env.TWILIO_EMAIL_API_SECRET;
    const result = await sendEmailWithResult({ emailStream: 'operational', to: 'a@example.org', subject: 's', html: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('TWILIO_EMAIL_API_SECRET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a From address with Unicode', async () => {
    const result = await sendEmailWithResult({
      emailStream: 'operational',
      from: 'josé@thesandwichproject.org',
      to: 'a@example.org',
      subject: 's',
      html: 'x',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ASCII/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses requests over 10 MB', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024).toString('base64'); // ~10.7 MB of base64
    const result = await sendEmailWithResult({
      emailStream: 'operational',
      adminCopy: false,
      to: 'a@example.org',
      subject: 's',
      html: 'x',
      attachments: [{ filename: 'big.pdf', content: big, type: 'application/pdf', disposition: 'attachment' }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/10 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps SendGrid-style attachments to Twilio fields', async () => {
    await sendEmailWithResult({
      emailStream: 'operational',
      adminCopy: false,
      to: 'a@example.org',
      subject: 's',
      html: 'x',
      attachments: [{ filename: 'flyer.pdf', content: 'QUJD', type: 'application/pdf', disposition: 'attachment' }],
    });
    expect(bodies()[0].content.attachments).toEqual([{ filename: 'flyer.pdf', contentType: 'application/pdf', content: 'QUJD' }]);
  });
});

describe('copies instead of CC/BCC', () => {
  it('sends the admin copy, CC and BCC as separate requests, de-duplicated', async () => {
    const result = await sendEmailWithResult({
      emailStream: 'operational',
      to: 'pat@example.org',
      cc: 'lead@example.org',
      bcc: ['sender@example.org', 'PAT@example.org', ADMIN],
      subject: 's',
      html: 'x',
    });
    expect(result.success).toBe(true);
    expect(recipients()).toEqual(['pat@example.org', 'lead@example.org', 'sender@example.org', ADMIN]);
    for (const b of bodies()) expect(b.to).toHaveLength(1);
  });

  it('sendEmailOrThrow adds no admin copy unless asked', async () => {
    await sendEmailOrThrow({ emailStream: 'operational', to: 'pat@example.org', subject: 's', html: 'x' });
    expect(recipients()).toEqual(['pat@example.org']);
  });

  it('a failed copy does not fail the send', async () => {
    fetchMock.mockResolvedValueOnce(accepted()).mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'x' });
    const result = await sendEmailWithResult({ emailStream: 'operational', to: 'pat@example.org', subject: 's', html: 'x' });
    expect(result.success).toBe(true);
  });
});

describe('Reply-To fallback line', () => {
  it('adds "To reply, email ..." when replyTo differs from From', async () => {
    await sendEmailWithResult({
      emailStream: 'operational',
      adminCopy: false,
      from: { email: ADMIN, name: 'Pat Lee via The Sandwich Project' },
      replyTo: { email: 'pat.lee@gmail.com', name: 'Pat Lee' },
      to: 'contact@example.org',
      subject: 's',
      html: '<html><body><p>Hi</p></body></html>',
      text: 'Hi',
    });
    const { content } = bodies()[0];
    expect(content.html).toMatch(/<body><p[^>]*>To reply, email Pat Lee at <a href="mailto:pat.lee@gmail.com">/);
    expect(content.text).toMatch(/^To reply, email Pat Lee at pat.lee@gmail.com\./);
  });

  it('adds nothing when replyTo is the From address', async () => {
    await sendEmailWithResult({
      emailStream: 'operational',
      adminCopy: false,
      from: { email: 'pat@thesandwichproject.org', name: 'Pat Lee' },
      replyTo: 'Pat@TheSandwichProject.org',
      to: 'contact@example.org',
      subject: 's',
      html: '<p>Hi</p>',
    });
    expect(bodies()[0].content.html).not.toContain('To reply');
  });
});

describe('suppressions', () => {
  it('skips a recipient unsubscribed from this stream, without throwing', async () => {
    mockGetScopes.mockResolvedValue(new Map([['pat@example.org', new Set(['newsletter'])]]));
    const result = await sendEmailOrThrow({ emailStream: 'newsletter', to: 'Pat@Example.org', subject: 's', html: 'x' });
    expect(result.success).toBe(false);
    expect(result.suppressed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a newsletter unsubscribe does not block operational mail', async () => {
    mockGetScopes.mockResolvedValue(new Map([['pat@example.org', new Set(['newsletter'])]]));
    const result = await sendEmailWithResult({ emailStream: 'operational', adminCopy: false, to: 'pat@example.org', subject: 's', html: 'x' });
    expect(result.success).toBe(true);
  });

  it('"all" blocks operational mail; the admin copy is never suppressed', async () => {
    mockGetScopes.mockResolvedValue(
      new Map([
        ['pat@example.org', new Set(['all'])],
        [ADMIN, new Set(['all'])],
      ])
    );
    const result = await sendEmailWithResult({ emailStream: 'operational', to: ['pat@example.org', 'sam@example.org'], subject: 's', html: 'x' });
    expect(result.success).toBe(true);
    expect(recipients()).toEqual(['sam@example.org', ADMIN]);
  });

  it('if the lookup fails, newsletter mail is not sent but operational mail is', async () => {
    mockGetScopes.mockRejectedValue(new Error('db down'));
    const nl = await sendEmailWithResult({ emailStream: 'newsletter', adminCopy: false, to: 'a@example.org', subject: 's', html: 'x' });
    expect(nl.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    const op = await sendEmailWithResult({ emailStream: 'operational', adminCopy: false, to: 'a@example.org', subject: 's', html: 'x' });
    expect(op.success).toBe(true);
  });
});

describe('preferences link and headers', () => {
  it('gives each copy its own preferences link', async () => {
    await sendEmailWithResult({ emailStream: 'operational', to: 'pat@example.org', subject: 's', html: '<p>x</p>', text: 'x' });
    const [main, admin] = bodies();
    const link = (html: string) => decodeURIComponent(html.match(/email-preferences\?t=([^"&]+)/)![1]);
    expect(verifyPreferencesToken(link(main.content.html))).toBe('pat@example.org');
    expect(verifyPreferencesToken(link(admin.content.html))).toBe(ADMIN);
    expect(main.content.html).toContain('https://app.test/api/email-preferences?t=');
    expect(main.content.text).toContain('Manage email preferences / unsubscribe: https://app.test/api/email-preferences?t=');
  });

  it('newsletter mail gets one-click List-Unsubscribe headers; operational does not', async () => {
    await sendEmailWithResult({ emailStream: 'newsletter', adminCopy: false, to: 'pat@example.org', subject: 's', html: 'x' });
    await sendEmailWithResult({ emailStream: 'operational', adminCopy: false, to: 'pat@example.org', subject: 's', html: 'x' });
    const [nl, op] = bodies();
    expect(nl.content.headers['List-Unsubscribe']).toMatch(/^<https:\/\/app\.test\/api\/email-preferences\/one-click\?t=.+&scope=newsletter>, <mailto:/);
    expect(nl.content.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(op.content.headers).toBeUndefined();
  });

  it('passes caller headers through', async () => {
    await sendEmailWithResult({ emailStream: 'operational', adminCopy: false, to: 'a@example.org', subject: 's', html: 'x', headers: { 'List-Unsubscribe': '<mailto:x@y.org>' } });
    expect(bodies()[0].content.headers).toEqual({ 'List-Unsubscribe': '<mailto:x@y.org>' });
  });

  it('rejects tampered tokens', () => {
    const token = createPreferencesToken('pat@example.org')!;
    expect(verifyPreferencesToken(token)).toBe('pat@example.org');
    const forged = Buffer.from('other@example.org').toString('base64url') + '.' + token.split('.')[1];
    expect(verifyPreferencesToken(forged)).toBeNull();
    expect(verifyPreferencesToken('garbage')).toBeNull();
  });
});

describe('email preferences page', () => {
  const app = () => {
    const a = express();
    a.use(express.urlencoded({ extended: false }));
    a.use('/api', createEmailPreferencesRouter());
    return a;
  };

  it('GET only shows the page (link scanners change nothing)', async () => {
    const token = createPreferencesToken('pat@example.org')!;
    const res = await request(app()).get(`/api/email-preferences?t=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('pat@example.org');
    expect(res.text).toContain('method="post"');
    expect(mockAddSuppression).not.toHaveBeenCalled();
    expect(mockRemoveUnsubscribes).not.toHaveBeenCalled();
  });

  it('POST records the choice', async () => {
    const token = createPreferencesToken('pat@example.org')!;
    const res = await request(app()).post('/api/email-preferences').type('form').send({ t: token, action: 'newsletter' });
    expect(res.status).toBe(200);
    expect(mockAddSuppression).toHaveBeenCalledWith({ email: 'pat@example.org', scope: 'newsletter', reason: 'unsubscribe', source: 'unsubscribe_link' });

    await request(app()).post('/api/email-preferences').type('form').send({ t: token, action: 'all' });
    expect(mockAddSuppression).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'all' }));

    await request(app()).post('/api/email-preferences').type('form').send({ t: token, action: 'resubscribe' });
    expect(mockRemoveUnsubscribes).toHaveBeenCalledWith('pat@example.org');
  });

  it('rejects a bad token', async () => {
    const res = await request(app()).post('/api/email-preferences').type('form').send({ t: 'bad.token', action: 'all' });
    expect(res.status).toBe(400);
    expect(mockAddSuppression).not.toHaveBeenCalled();
  });

  it('one-click POST unsubscribes from newsletters', async () => {
    const token = createPreferencesToken('pat@example.org')!;
    const res = await request(app())
      .post(`/api/email-preferences/one-click?t=${encodeURIComponent(token)}&scope=newsletter`)
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect(mockAddSuppression).toHaveBeenCalledWith({ email: 'pat@example.org', scope: 'newsletter', reason: 'unsubscribe', source: 'one_click' });
  });
});
