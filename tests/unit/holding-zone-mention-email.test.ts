/**
 * Holding Zone item mentions used to call an undefined `sendEmail`, so the
 * email always threw a ReferenceError (logged and swallowed) and nobody was
 * notified. These tests drive the real mention path with the email helper mocked.
 */

const mockSend = jest.fn().mockResolvedValue({ success: true, operationIds: ['op_test'] });
jest.mock('../../server/services/email', () => ({
  ...jest.requireActual('../../server/services/email'),
  sendEmailOrThrow: (...args: unknown[]) => mockSend(...args),
}));
jest.mock('../../server/db', () => ({ db: {} }));
jest.mock('../../server/sms-service', () => ({
  sendChatMentionSMS: jest.fn(),
  sendTSPContactAssignmentSMS: jest.fn(),
  sendTeamBoardAssignmentSMS: jest.fn(),
  sendEventCommentSMS: jest.fn(),
}));
const mockGetEffectivePrefs = jest.fn();
jest.mock('../../server/services/notifications/preferences', () => ({
  getEffectivePrefs: (...args: unknown[]) => mockGetEffectivePrefs(...args),
}));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { EmailNotificationService } from '../../server/services/email-notification-service';

const mentioned = (id: string, email: string, firstName: string) => ({
  id,
  email,
  displayName: null,
  firstName,
  lastName: null,
});

describe('Holding Zone item mention email', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.TWILIO_EMAIL_API_KEY = 'SKtest';
    process.env.TWILIO_EMAIL_API_SECRET = 'test-secret';
    process.env.EMAIL_FROM_ADDRESS = 'katie@thesandwichproject.org';
    mockSend.mockClear();
    mockGetEffectivePrefs.mockReset().mockResolvedValue({ emailEnabled: true });
  });

  afterAll(() => {
    process.env = saved;
  });

  it('emails each mentioned user (not the creator) as an operational message', async () => {
    jest
      .spyOn(EmailNotificationService, 'findMentionedUsers')
      .mockResolvedValue([
        mentioned('u1', 'ana@example.org', 'Ana'),
        mentioned('creator', 'creator@example.org', 'Cy'),
        mentioned('u2', 'ben@example.org', 'Ben'),
      ]);

    await EmailNotificationService.processTeamBoardItemMentions(
      'Can @Ana and @Ben pick this up? @Cy',
      'creator',
      'Cy',
      42
    );

    expect(mockSend).toHaveBeenCalledTimes(2);
    const [first, second] = mockSend.mock.calls.map((c) => c[0]);
    expect(first.to).toBe('ana@example.org');
    expect(second.to).toBe('ben@example.org');

    expect(first.from).toBeTruthy();
    expect(first.subject).toBe('Cy mentioned you in a Holding Zone item');
    expect(first.html).toContain('Hi Ana');
    expect(first.text).toContain('Cy mentioned you in a Holding Zone item');
    // Sent as operational mail (newsletter unsubscribes don't apply)
    expect(first.emailStream).toBe('operational');
  });

  it('respects users who turned off Holding Zone mention emails', async () => {
    jest
      .spyOn(EmailNotificationService, 'findMentionedUsers')
      .mockResolvedValue([mentioned('u1', 'ana@example.org', 'Ana')]);
    mockGetEffectivePrefs.mockResolvedValue({ emailEnabled: false });

    await EmailNotificationService.processTeamBoardItemMentions('@Ana', 'creator', 'Cy', 42);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('skips sending when Twilio Email is not configured', async () => {
    delete process.env.TWILIO_EMAIL_API_KEY;
    jest
      .spyOn(EmailNotificationService, 'findMentionedUsers')
      .mockResolvedValue([mentioned('u1', 'ana@example.org', 'Ana')]);

    await EmailNotificationService.processTeamBoardItemMentions('@Ana', 'creator', 'Cy', 42);

    expect(mockSend).not.toHaveBeenCalled();
  });
});
