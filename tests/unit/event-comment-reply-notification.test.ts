/**
 * Replies to event-request comments used to throw a ReferenceError (drizzle's
 * `and` was never imported), which was caught and swallowed, so TSP contacts
 * were never notified of replies. These tests drive the real
 * sendEventCommentNotification path with the db and SendGrid mocked.
 */

const mockSend = jest.fn().mockResolvedValue([{ statusCode: 202 }]);
jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: { send: (...args: unknown[]) => mockSend(...args), setApiKey: jest.fn() },
}));

// Each db.select() chain resolves to the next queued result, whether the query
// ends at .where() or .limit().
const mockQueue: unknown[][] = [];
function mockChain() {
  const result = () => Promise.resolve(mockQueue.shift() ?? []);
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => result(),
    then: (resolve: any, reject: any) => result().then(resolve, reject),
  };
  return chain;
}
jest.mock('../../server/db', () => ({ db: { select: () => mockChain() } }));

const mockCommentSMS = jest.fn();
jest.mock('../../server/sms-service', () => ({
  sendChatMentionSMS: jest.fn(),
  sendTSPContactAssignmentSMS: jest.fn(),
  sendTeamBoardAssignmentSMS: jest.fn(),
  sendEventCommentSMS: (...args: unknown[]) => mockCommentSMS(...args),
}));
jest.mock('../../server/services/notifications/preferences', () => ({
  getEffectivePrefs: jest.fn().mockResolvedValue({ emailEnabled: true }),
}));
const mockLoggerError = jest.fn();
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { EmailNotificationService } from '../../server/services/email-notification-service';

const event = {
  id: 7,
  organizationName: 'Test Org',
  tspContact: 'contact-1',
  tspContactAssigned: null,
  additionalContact1: null,
  additionalContact2: null,
  scheduledEventDate: null,
  desiredEventDate: null,
};
const contact = {
  id: 'contact-1',
  email: 'contact@example.org',
  preferredEmail: null,
  displayName: 'Casey',
  firstName: 'Casey',
  metadata: null,
};

describe('event comment notifications', () => {
  beforeEach(() => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    mockQueue.length = 0;
    mockSend.mockClear();
    mockCommentSMS.mockClear();
    mockLoggerError.mockClear();
  });

  it('notifies the TSP contact about a reply, quoting the original comment', async () => {
    mockQueue.push([event], [{ content: 'When is pickup?', userName: 'Dana' }], [contact]);

    const ok = await EmailNotificationService.sendEventCommentNotification(
      7,
      'Riley',
      'commenter-1',
      'Pickup is at 3pm.',
      new Date('2026-11-19T15:00:00Z'),
      99
    );

    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const sent = mockSend.mock.calls[0][0];
    expect(sent.to).toBe('contact@example.org');
    expect(sent.subject).toBe('Riley replied to a comment on Test Org - The Sandwich Project');
    expect(sent.html).toContain('When is pickup?');
    expect(sent.html).toContain('Pickup is at 3pm.');
  });

  it('still notifies about new top-level comments', async () => {
    mockQueue.push([event], [contact]);

    const ok = await EmailNotificationService.sendEventCommentNotification(
      7,
      'Riley',
      'commenter-1',
      'Looking forward to it!',
      new Date('2026-11-19T15:00:00Z')
    );

    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].subject).toBe(
      'New comment on Test Org event - The Sandwich Project'
    );
  });
});
