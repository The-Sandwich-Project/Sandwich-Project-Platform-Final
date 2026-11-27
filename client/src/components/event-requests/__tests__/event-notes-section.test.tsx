import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventNotesSection } from '../cards/EventNotesSection';

const comment = (id: number, content: string) =>
  ({ id, eventRequestId: 1, userId: 'u1', userName: 'Christine', content, parentCommentId: null, editedAt: null, createdAt: new Date(), updatedAt: new Date() }) as any;

function setup(mode: 'flags' | 'earlier', comments: any[]) {
  const collaboration = { comments, commentsLoading: false, addComment: jest.fn(), updateComment: jest.fn(), deleteComment: jest.fn() };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EventNotesSection eventId={1} mode={mode} collaboration={collaboration} currentUserId="u1" currentUserName="Christine" />
    </QueryClientProvider>
  );
  return collaboration;
}

describe('Event card notes section', () => {
  it('New cards: "New Event Flags", open when there are flags, with an Add Flag box', () => {
    setup('flags', [comment(1, 'Budget is tight')]);
    expect(screen.getByText('New Event Flags')).toBeTruthy();
    expect(screen.getByText('Budget is tight')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Flag' })).toBeTruthy();
    expect(screen.queryByText('Team Comments')).toBeNull();
  });

  it('New cards with no flags still offer to add one', () => {
    setup('flags', []);
    fireEvent.click(screen.getByRole('button', { name: /New Event Flags/ }));
    expect(screen.getByRole('button', { name: 'Add Flag' })).toBeTruthy();
  });

  it('other cards: earlier comments are collapsed and read-only', () => {
    setup('earlier', [comment(1, 'Called them Tuesday')]);
    expect(screen.getByText('Earlier comments')).toBeTruthy();
    expect(screen.queryByText('Called them Tuesday')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Earlier comments/ }));
    expect(screen.getByText('Called them Tuesday')).toBeTruthy();
    expect(screen.queryByTestId('new-comment-textarea')).toBeNull();
    expect(screen.queryByRole('button', { name: /Reply|Edit|Delete|Add/ })).toBeNull();
  });

  it('opening flags by default makes no network requests (no per-comment likes)', () => {
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    setup('flags', [comment(1, 'Budget is tight'), comment(2, 'Prefers mornings'), { ...comment(3, 'Agreed'), parentCommentId: 1 }]);
    expect(screen.getByText('Prefers mornings')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('like-button-1')).toBeNull();
  });

  it("Reply focuses that card's own box when several cards' flags are open", () => {
    const one = { comments: [comment(1, 'Flag on event one')], commentsLoading: false, addComment: jest.fn(), updateComment: jest.fn(), deleteComment: jest.fn() };
    const two = { comments: [comment(2, 'Flag on event two')], commentsLoading: false, addComment: jest.fn(), updateComment: jest.fn(), deleteComment: jest.fn() };
    render(
      <>
        <EventNotesSection eventId={1} mode="flags" collaboration={one} currentUserId="u1" currentUserName="C" />
        <EventNotesSection eventId={2} mode="flags" collaboration={two} currentUserId="u1" currentUserName="C" />
      </>
    );
    const boxes = screen.getAllByTestId('new-comment-textarea');
    fireEvent.click(screen.getByTestId('reply-button-2'));
    expect(document.activeElement).toBe(boxes[1]);
    fireEvent.change(boxes[1], { target: { value: 'reply' } });
    fireEvent.keyDown(boxes[1], { key: 'Enter', ctrlKey: true });
    expect(two.addComment).toHaveBeenCalledWith('reply', 2);
    expect(one.addComment).not.toHaveBeenCalled();
  });

  it('other cards with no comments show nothing', () => {
    setup('earlier', []);
    expect(screen.queryByTestId('earlier-comments')).toBeNull();
  });
});
