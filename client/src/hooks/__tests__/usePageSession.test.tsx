import React, { StrictMode, useState } from 'react';
import { render, act } from '@testing-library/react';
import { usePageSession } from '../usePageSession';

jest.mock('@/lib/logger', () => ({
  logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const fetchMock = jest.fn(() => Promise.resolve({ ok: true } as Response));
global.fetch = fetchMock as unknown as typeof fetch;

function openedEntries(): string[] {
  return fetchMock.mock.calls
    .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    .filter((p) => p.action === 'View')
    .map((p) => p.details);
}

// Screens wired the way the app wires them: each component calls the hook itself.
function EventRequestsScreen() {
  usePageSession({ section: 'Event Requests', page: 'Event Requests' });
  return <div>event requests</div>;
}
function TeamChatScreen() {
  usePageSession({ section: 'Communication', page: 'Team Chat' });
  return <div>chat</div>;
}
// Same pattern as SectionPageSession in pages/dashboard.tsx for inline sections.
function SectionPageSession({ section, page }: { section: string; page: string }) {
  usePageSession({ section, page });
  return null;
}

let setSection: (s: string) => void = () => {};
let forceRerender: () => void = () => {};

// Minimal stand-in for the dashboard's renderContent switch.
function FakeDashboard() {
  const [section, _setSection] = useState('event-requests');
  const [, setTick] = useState(0);
  setSection = _setSection;
  forceRerender = () => setTick((t) => t + 1);

  let content: React.ReactNode;
  switch (section) {
    case 'event-requests':
      content = <EventRequestsScreen />;
      break;
    case 'chat':
      content = <TeamChatScreen />;
      break;
    case 'kudos':
      content = (
        <div className="space-y-6 p-6">
          <SectionPageSession key="kudos" section="Communication" page="Kudos" />
          <h1>Kudos</h1>
        </div>
      );
      break;
    case 'weekly-monitoring':
      content = (
        <div className="space-y-6 p-6">
          <SectionPageSession key="weekly-monitoring" section="Analytics" page="Weekly Monitoring" />
          <h1>Weekly Monitoring</h1>
        </div>
      );
      break;
  }
  return <div className="wrapper">{content}</div>;
}

describe('usePageSession: one "Opened" entry per visit', () => {
  beforeEach(() => fetchMock.mockClear());

  it.each([
    ['normal', false],
    ['StrictMode', true],
  ])('logs once per visit (%s)', (_label, strict) => {
    const tree = strict ? (
      <StrictMode>
        <FakeDashboard />
      </StrictMode>
    ) : (
      <FakeDashboard />
    );
    render(tree);
    expect(openedEntries()).toEqual(['Opened Event Requests']);

    // Re-renders don't log again
    act(() => {
      for (let i = 0; i < 5; i++) forceRerender();
    });
    // Tab refocus / visibility change doesn't log again
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(openedEntries()).toEqual(['Opened Event Requests']);

    // Switching sections logs each new visit once
    act(() => setSection('chat'));
    act(() => setSection('kudos'));
    act(() => setSection('weekly-monitoring')); // same wrapper markup as kudos
    act(() => setSection('event-requests')); // returning is a new visit
    act(() => forceRerender());

    expect(openedEntries()).toEqual([
      'Opened Event Requests',
      'Opened Team Chat',
      'Opened Kudos',
      'Opened Weekly Monitoring',
      'Opened Event Requests',
    ]);
  });
});
