jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn(), queryClient: {}, applyEventRequestSaveToCache: jest.fn() }));

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VanDetailsPanel, formVanTime, vanReasonMissing, withEventDate } from '../form-sections/VanDetailsPanel';
import { buildEventDataForServer } from '../form-utils';

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
    expect(withEventDate(form, '2026-12-06', saved)).toEqual({ eventDate: '2026-12-06', vanTeamOk: false, other: 1 });
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
