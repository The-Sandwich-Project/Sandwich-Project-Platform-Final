/**
 * Holding Zone item mentions used to call an undefined `sendEmail`, so the
 * email always threw a ReferenceError (logged and swallowed) and nobody was
 * notified. These tests drive the real mention path with SendGrid mocked.
 */

const mockSend = jest.fn().mockResolvedValue([{ statusCode: 202 }]);
jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: { send: (...args: unknown[]) => mockSend(...args), setApiKey: jest.fn() },
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
  const savedKey = process.env.SENDGRID_API_KEY;

  beforeEach(() => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    process.env.SENDGRID_ASM_GROUP_ID_OPERATIONAL = '101';
    mockSend.mockClear();
    mockGetEffectivePrefs.mockReset().mockResolvedValue({ emailEnabled: true });
  });

  afterAll(() => {
    process.env.SENDGRID_API_KEY = savedKey;
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
    // Goes through the shared unsubscribe handling
    expect(first.asm).toEqual({ groupId: 101, groupsToDisplay: [101] });
    expect(first.mailSettings).toEqual({ bypassUnsubscribeManagement: { enable: true } });
    expect(first.trackingSettings).toEqual({ subscriptionTracking: { enable: false } });
  });

  it('respects users who turned off Holding Zone mention emails', async () => {
    jest
      .spyOn(EmailNotificationService, 'findMentionedUsers')
      .mockResolvedValue([mentioned('u1', 'ana@example.org', 'Ana')]);
    mockGetEffectivePrefs.mockResolvedValue({ emailEnabled: false });

    await EmailNotificationService.processTeamBoardItemMentions('@Ana', 'creator', 'Cy', 42);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('skips sending when SendGrid is not configured', async () => {
    delete process.env.SENDGRID_API_KEY;
    jest
      .spyOn(EmailNotificationService, 'findMentionedUsers')
      .mockResolvedValue([mentioned('u1', 'ana@example.org', 'Ana')]);

    await EmailNotificationService.processTeamBoardItemMentions('@Ana', 'creator', 'Cy', 42);

    expect(mockSend).not.toHaveBeenCalled();
  });
});
