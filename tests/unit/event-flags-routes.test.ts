/**
 * Earlier comments (event past New) are read-only on EVERY write route, not
 * just create: an author with a stale New card open can't edit or delete a
 * flag after someone else moves the event forward.
 */
import express from 'express';
import request from 'supertest';

const mockLoadCommentEvent = jest.fn();
jest.mock('../../server/services/event-flags', () => {
  const actual = jest.requireActual('../../server/services/event-flags');
  return { ...actual, loadCommentEvent: (...a: any[]) => mockLoadCommentEvent(...a) };
});
jest.mock('../../server/services/email-notification-service', () => ({
  EmailNotificationService: { sendEventCommentNotification: jest.fn().mockResolvedValue(true) },
}));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { createEventCollaborationRouter } from '../../server/routes/event-collaboration';

const storage = {
  getEventRequestById: jest.fn(),
  createEventCollaborationComment: jest.fn(),
  updateEventCollaborationComment: jest.fn(),
  deleteEventCollaborationComment: jest.fn(),
};

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.user = { id: 'user-1', firstName: 'Christine', email: 'c@example.org' };
    next();
  });
  const pass = () => (_req: any, _res: any, next: any) => next();
  a.use('/api/event-requests', createEventCollaborationRouter({ storage, requirePermission: pass } as any));
  return a;
}

describe('comment write routes follow the New-only rule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.updateEventCollaborationComment.mockResolvedValue({ id: 9, content: 'edited' });
    storage.deleteEventCollaborationComment.mockResolvedValue(true);
    storage.createEventCollaborationComment.mockResolvedValue({ id: 10 });
  });

  it('edit and delete work while the event is New', async () => {
    mockLoadCommentEvent.mockResolvedValue({ eventRequestId: 1, status: 'new' });
    expect((await request(app()).patch('/api/event-requests/1/collaboration/comments/9').send({ content: 'edited' })).status).toBe(200);
    expect((await request(app()).delete('/api/event-requests/1/collaboration/comments/9')).status).toBe(200);
  });

  it('edit and delete are refused once the event has moved past New', async () => {
    mockLoadCommentEvent.mockResolvedValue({ eventRequestId: 1, status: 'in_process' });
    const patch = await request(app()).patch('/api/event-requests/1/collaboration/comments/9').send({ content: 'edited' });
    const del = await request(app()).delete('/api/event-requests/1/collaboration/comments/9');
    expect(patch.status).toBe(409);
    expect(del.status).toBe(409);
    expect(storage.updateEventCollaborationComment).not.toHaveBeenCalled();
    expect(storage.deleteEventCollaborationComment).not.toHaveBeenCalled();
  });

  it("uses the comment's real event, not the id in the URL", async () => {
    // Comment 9 belongs to event 2 (scheduled); the URL claims New event 1.
    mockLoadCommentEvent.mockResolvedValue({ eventRequestId: 2, status: 'scheduled' });
    expect((await request(app()).patch('/api/event-requests/1/collaboration/comments/9').send({ content: 'x' })).status).toBe(404);
    expect((await request(app()).delete('/api/event-requests/1/collaboration/comments/9')).status).toBe(404);
    expect(storage.updateEventCollaborationComment).not.toHaveBeenCalled();
    expect(storage.deleteEventCollaborationComment).not.toHaveBeenCalled();
  });

  it('a reply to a comment on another event is refused', async () => {
    storage.getEventRequestById.mockResolvedValue({ id: 1, status: 'new' });
    mockLoadCommentEvent.mockResolvedValue({ eventRequestId: 2, status: 'new' });
    const res = await request(app()).post('/api/event-requests/1/collaboration/comments').send({ content: 'hi', parentCommentId: 9 });
    expect(res.status).toBe(400);
    expect(storage.createEventCollaborationComment).not.toHaveBeenCalled();
    mockLoadCommentEvent.mockResolvedValue({ eventRequestId: 1, status: 'new' });
    expect((await request(app()).post('/api/event-requests/1/collaboration/comments').send({ content: 'hi', parentCommentId: 9 })).status).toBe(201);
  });

  it('create is refused past New', async () => {
    storage.getEventRequestById.mockResolvedValue({ id: 1, status: 'scheduled' });
    expect((await request(app()).post('/api/event-requests/1/collaboration/comments').send({ content: 'hi' })).status).toBe(409);
    expect(storage.createEventCollaborationComment).not.toHaveBeenCalled();
  });
});
