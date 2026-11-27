jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn(), queryClient: {}, applyEventRequestSaveToCache: jest.fn() }));

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VanDetailsPanel, formVanTime, formVanDay, vanReasonMissing, withEventDate } from '../form-sections/VanDetailsPanel';
import { buildEventDataForServer, dropUnchangedFields, intelligentMergeFormData } from '../form-utils';
import { VanNeededBadgeAndButton } from '../VanNeededBadgeAndButton';

function Harness({ initial, others = [] as any[], stored }: { initial: any; others?: any[]; stored?: any }) {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ otherEvents: others }) });
  const [formData, setFormData] = React.useState<any>(initial);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <VanDetailsPanel formData={formData} setFormData={setFormData} eventRequestId={7} storedEvent={stored} />
      <pre data-testid="state">{JSON.stringify(formData)}</pre>
    </QueryClientProvider>
  );
}
const state = () => JSON.parse(screen.getByTestId('state').textContent || '{}');
const base = { vanDriverNeeded: true, eventDate: '2026-12-05', eventStartTime: '10:00', eventEndTime: '12:00', totalSandwichCount: 900 };

describe('van details in the edit form', () => {
  it('shows the van time worked out from the event times', () => {
    render(<Harness initial={base} />);
    expect(screen.getByTestId('van-time').textContent).toMatch(/Van time: AM.*from the event times/);
  });

  it('asks for a reason under 800 (or with no estimate), not at 800+', () => {
    const { unmount } = render(<Harness initial={{ ...base, totalSandwichCount: 300 }} />);
    expect(screen.getByTestId('input-van-reason')).toBeTruthy();
    unmount();
    render(<Harness initial={base} />);
    expect(screen.queryByTestId('input-van-reason')).toBeNull();
    expect(vanReasonMissing({ ...base, totalSandwichCount: 0 })).toBe(true);
    expect(vanReasonMissing({ ...base, totalSandwichCount: 0, vanReason: 'no fridge' })).toBe(false);
    expect(vanReasonMissing(base)).toBe(false);
  });

  it("warns when another event that day has the van, and saves the team's OK", async () => {
    render(
      <Harness
        initial={base}
        others={[{ id: 2, organizationName: 'Lincoln Elementary', vanDriverNeeded: true, vanTeamOk: false, eventStartTime: '13:00', eventEndTime: '15:00', vanNeededFor: 'refrigeration' }]}
      />
    );
    await waitFor(() => expect(screen.getByTestId('van-conflict')).toBeTruthy());
    expect(screen.getByTestId('van-conflict').textContent).toMatch(/Lincoln Elementary \(PM, refrigeration\)/);
    expect(screen.getByText(/Van pending – discuss with team/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('checkbox-van-team-ok'));
    expect(state().vanTeamOk).toBe(true);
    expect(screen.queryByText(/Until this is ticked/)).toBeNull();
  });

  it('shows nothing for DHL-van or self-transport events', () => {
    render(<Harness initial={{ ...base, isDhlVan: true }} />);
    expect(screen.queryByTestId('van-details')).toBeNull();
  });

  it("uses the sheet's time only while the form's times match the saved ones", () => {
    const stored = { vanTimeOverride: 'PM', eventStartTime: '10:00', eventEndTime: '12:00' };
    expect(formVanTime(base, stored)).toEqual({ value: 'PM', fromSheet: true });
    expect(formVanTime({ ...base, eventStartTime: '09:00' }, stored)).toEqual({ value: 'AM', fromSheet: false });
  });
});

describe('saving the van fields', () => {
  const formBase: any = { eventDate: '2026-12-05', backupDates: [], sandwichTypes: [], totalSandwichCount: 300, estimatedSandwichCountMin: 0, estimatedSandwichCountMax: 0, status: 'in_process' };
  const build = (f: any) => buildEventDataForServer({ ...formBase, ...f }, { mode: 'edit', hasEventRequest: true, actualSandwichMode: 'total' });

  it('sends the reason and the OK while the van is needed', () => {
    expect(build({ vanDriverNeeded: true, vanReason: '  no fridge ', vanTeamOk: true })).toMatchObject({ vanReason: 'no fridge', vanTeamOk: true });
  });
  it('clears them when the van is not needed (or is the DHL van)', () => {
    expect(build({ vanDriverNeeded: false, vanReason: 'x', vanTeamOk: true })).toMatchObject({ vanReason: null, vanTeamOk: false });
    expect(build({ vanDriverNeeded: true, isDhlVan: true, vanReason: 'x', vanTeamOk: true })).toMatchObject({ vanReason: null, vanTeamOk: false });
  });
});

describe("a new event date resets the form's sharing OK", () => {
  const saved = { date: '2026-12-05', vanTeamOk: true };
  const form = { eventDate: '2026-12-05', vanTeamOk: true, other: 1 };

  it('unticks the OK on a different day', () => {
    expect(withEventDate(form, '2026-12-06', saved)).toEqual({ eventDate: '2026-12-06', vanDay: '2026-12-06', vanTeamOk: false, other: 1 });
  });
  it('restores the saved OK when the date goes back to the saved day', () => {
    const moved = withEventDate(form, '2026-12-06', saved);
    expect(withEventDate(moved, '2026-12-05', saved)).toMatchObject({ eventDate: '2026-12-05', vanTeamOk: true });
  });
  it('keeps the OK when the date is set to the same value', () => {
    expect(withEventDate({ ...form, vanTeamOk: true }, '2026-12-05', null)).toMatchObject({ vanTeamOk: true });
  });
  it('shows the new day as pending, not already approved', async () => {
    function DateHarness() {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ otherEvents: [{ id: 2, organizationName: 'Lincoln Elementary', vanDriverNeeded: true, vanTeamOk: false }] }),
      });
      const [formData, setFormData] = React.useState<any>({ ...base, vanTeamOk: true });
      return (
        <QueryClientProvider client={new QueryClient()}>
          <button onClick={() => setFormData((p: any) => withEventDate(p, '2026-12-06', saved))}>move</button>
          <VanDetailsPanel formData={formData} setFormData={setFormData} eventRequestId={7} />
        </QueryClientProvider>
      );
    }
    render(<DateHarness />);
    await waitFor(() => expect(screen.getByTestId('van-conflict')).toBeTruthy());
    expect((screen.getByTestId('checkbox-van-team-ok') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByText('move'));
    await waitFor(() => expect(screen.getByTestId('van-conflict')).toBeTruthy());
    expect((screen.getByTestId('checkbox-van-team-ok') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Until this is ticked/)).toBeTruthy();
  });
});

describe('the van is checked on the scheduled day, not the requested one', () => {
  it('uses the van day (scheduled date) until the date box changes', () => {
    expect(formVanDay({ eventDate: '2026-12-01', vanDay: '2026-12-05' })).toBe('2026-12-05');
    const moved = withEventDate({ eventDate: '2026-12-01', vanDay: '2026-12-05', vanTeamOk: true }, '2026-12-09', {
      date: '2026-12-01', vanDay: '2026-12-05', vanTeamOk: true,
    });
    expect(moved).toMatchObject({ eventDate: '2026-12-09', vanDay: '2026-12-09', vanTeamOk: false });
    expect(withEventDate(moved, '2026-12-01', { date: '2026-12-01', vanDay: '2026-12-05', vanTeamOk: true })).toMatchObject({
      eventDate: '2026-12-01', vanDay: '2026-12-05', vanTeamOk: true,
    });
  });

  it("asks for the scheduled day's van events", async () => {
    render(<Harness initial={{ ...base, eventDate: '2026-12-01', vanDay: '2026-12-05' }} />);
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
    expect(String((global as any).fetch.mock.calls[0][0])).toContain('date=2026-12-05');
  });
});

describe('a new date and its sharing OK are saved together', () => {
  it('keeps an unchanged vanTeamOk when the date changed', () => {
    const payload: Record<string, any> = { desiredEventDate: '2026-12-09T12:00:00.000Z', vanTeamOk: true, planningNotes: 'same' };
    const baseline = { desiredEventDate: '2026-12-05T12:00:00.000Z', vanTeamOk: true, planningNotes: 'same' };
    dropUnchangedFields(payload, baseline);
    expect(payload).toEqual({ desiredEventDate: '2026-12-09T12:00:00.000Z', vanTeamOk: true });
  });
  it('still drops it when nothing date-related changed', () => {
    const payload: Record<string, any> = { vanTeamOk: true, planningNotes: 'new' };
    dropUnchangedFields(payload, { vanTeamOk: true, planningNotes: 'old' });
    expect(payload).toEqual({ planningNotes: 'new' });
  });
});

describe("a recovered draft's sharing OK stays with its day", () => {
  const original = { eventDate: '2026-12-05', vanDay: '2026-12-05', vanDriverNeeded: true, vanTeamOk: false };

  it('drops a draft OK when another coordinator moved the event', () => {
    const draft = { ...original, vanTeamOk: true };
    const server = { ...original, eventDate: '2026-12-09', vanDay: '2026-12-09' };
    const { mergedData, conflicts } = intelligentMergeFormData(draft, original, server);
    expect(mergedData).toMatchObject({ eventDate: '2026-12-09', vanTeamOk: false });
    expect(conflicts).toContain('vanTeamOk');
  });
  it('drops a server OK for the old day when the draft moved the event', () => {
    const draft = { ...original, eventDate: '2026-12-09', vanDay: '2026-12-09', vanTeamOk: false, vanReason: 'x' };
    const server = { ...original, vanTeamOk: true, vanReason: 'y' };
    const { mergedData } = intelligentMergeFormData(draft, original, server);
    expect(mergedData).toMatchObject({ eventDate: '2026-12-09', vanTeamOk: false });
  });
  it("catches a reschedule that only changed the scheduled date (the van day)", () => {
    const draft = { ...original, vanTeamOk: true };
    const server = { ...original, vanDay: '2026-12-09' };
    expect(intelligentMergeFormData(draft, original, server).mergedData.vanTeamOk).toBe(false);
  });
  describe('drafts saved before vanDay existed', () => {
    const oldOriginal = { eventDate: '2026-12-05', vanDriverNeeded: true, vanTeamOk: false };
    const server = { ...oldOriginal, vanDay: '2026-12-05' };

    it("keep the drafted date (the server's first vanDay isn't a change)", () => {
      const oldDraft = { ...oldOriginal, eventDate: '2026-12-09' };
      const { mergedData, conflicts } = intelligentMergeFormData(oldDraft, oldOriginal, server);
      expect(mergedData).toMatchObject({ eventDate: '2026-12-09', vanDay: '2026-12-09' });
      expect(conflicts).not.toContain('eventDate');
    });
    it("take the server's day when the draft didn't touch the date", () => {
      const oldDraft = { ...oldOriginal, planningNotes: 'x' };
      expect(intelligentMergeFormData(oldDraft, oldOriginal, { ...server, vanDay: '2026-12-07' }).mergedData).toMatchObject({
        eventDate: '2026-12-05', vanDay: '2026-12-07',
      });
    });
    it('still let the server win when both changed the date', () => {
      const oldDraft = { ...oldOriginal, eventDate: '2026-12-09' };
      const moved = { ...server, eventDate: '2026-12-11', vanDay: '2026-12-11' };
      const { mergedData, conflicts } = intelligentMergeFormData(oldDraft, oldOriginal, moved);
      expect(mergedData).toMatchObject({ eventDate: '2026-12-11', vanDay: '2026-12-11' });
      expect(conflicts).toContain('eventDate');
    });
  });

  it('keeps a draft OK when the day is unchanged', () => {
    const draft = { ...original, vanTeamOk: true };
    expect(intelligentMergeFormData(draft, original, original).mergedData.vanTeamOk).toBe(true);
  });
});

describe('pending-only van badge (fully staffed cards with a driver)', () => {
  function renderPending(others: any[], event: any = { vanTeamOk: false }) {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ otherEvents: others }) });
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <VanNeededBadgeAndButton eventRequestId={7} vanDriverNeeded vanNeededLikely={false} eventDate="2026-12-05" event={event} mode="pending" />
      </QueryClientProvider>,
    );
  }
  const other = { id: 2, organizationName: 'Lincoln Elementary', vanDriverNeeded: true, vanTeamOk: false };

  it('shows "Van pending" while sharing is unsettled', async () => {
    renderPending([other]);
    await waitFor(() => expect(screen.getByTestId('badge-van-pending').textContent).toMatch(/Van pending – discuss with team/));
  });
  it('shows nothing once either event is OK\'d, or with no other van event', async () => {
    const { container, unmount } = renderPending([{ ...other, vanTeamOk: true }]);
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    unmount();
    const r2 = renderPending([]);
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
    expect(r2.container.textContent).toBe('');
  });
});
