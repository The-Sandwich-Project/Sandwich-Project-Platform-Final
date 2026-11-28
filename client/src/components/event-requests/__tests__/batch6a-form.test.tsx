jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn(), queryClient: {}, applyEventRequestSaveToCache: jest.fn() }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TspShoppingBadge, TspShoppingCheckbox } from '../TspShopping';
import { ExpectedAttendeesField } from '../form-sections/ExpectedAttendeesField';
import { buildEventDataForServer, dropUnchangedFields, intelligentMergeFormData, normalizeDraftAttendance } from '../form-utils';

describe('TSP shopping checkbox', () => {
  it('asks before changing, and Cancel leaves it alone', () => {
    const onChange = jest.fn();
    render(<TspShoppingCheckbox checked={false} onChange={onChange} organizationName="Lincoln PTA" />);
    fireEvent.click(screen.getByTestId('checkbox-tsp-shopping'));
    expect(screen.getByText('Mark as TSP shopping?')).toBeTruthy();
    expect(screen.getByText(/TSP will buy the food for Lincoln PTA's event/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('changes only after confirming, in both directions', () => {
    const onChange = jest.fn();
    const { rerender } = render(<TspShoppingCheckbox checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('checkbox-tsp-shopping'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, TSP is shopping' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<TspShoppingCheckbox checked={true} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('checkbox-tsp-shopping'));
    expect(screen.getByText('Switch to the group shopping?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, the group is shopping' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

describe('TSP shopping badge on cards', () => {
  it('shows only once TSP shopping is ticked (no "Group shopping" badge)', () => {
    const qc = new QueryClient();
    const wrap = (v: boolean | null) => (
      <QueryClientProvider client={qc}>
        <TspShoppingBadge eventRequestId={1} isTspShopped={v} canEdit />
      </QueryClientProvider>
    );
    const { container, rerender } = render(wrap(false));
    expect(container.textContent).toBe('');
    rerender(wrap(null));
    expect(container.textContent).toBe('');
    rerender(wrap(true));
    expect(screen.getByTestId('badge-tsp-shopping').textContent).toMatch(/TSP shopping/);
  });
});

describe('expected attendees field', () => {
  function Harness({ initial }: { initial: any }) {
    const [formData, setFormData] = React.useState<any>(initial);
    return (
      <>
        <ExpectedAttendeesField formData={formData} setFormData={setFormData} />
        <pre data-testid="state">{JSON.stringify(formData)}</pre>
      </>
    );
  }
  const state = () => JSON.parse(screen.getByTestId('state').textContent || '{}');

  it('opens with a stored range and saves a new one', () => {
    render(<Harness initial={{ estimatedAttendance: 50, estimatedAttendanceMin: 40, estimatedAttendanceMax: 60 }} />);
    const box = screen.getByTestId('input-expected-attendees') as HTMLInputElement;
    expect(box.value).toBe('40–60');
    fireEvent.change(box, { target: { value: '30-70' } });
    expect(state()).toMatchObject({ estimatedAttendance: 50, estimatedAttendanceMin: 30, estimatedAttendanceMax: 70 });
  });

  it('Discard clears rejected text even when the stored number is unchanged', () => {
    function DiscardHarness() {
      const initial = { estimatedAttendance: 40, estimatedAttendanceMin: 0, estimatedAttendanceMax: 0 };
      const [formData, setFormData] = React.useState<any>(initial);
      return (
        <>
          <ExpectedAttendeesField formData={formData} setFormData={setFormData} />
          <button onClick={() => setFormData(initial)}>Discard</button>
        </>
      );
    }
    render(<DiscardHarness />);
    const box = screen.getByTestId('input-expected-attendees') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'about 40' } });
    expect(box.value).toBe('about 40');
    fireEvent.click(screen.getByText('Discard'));
    expect(box.value).toBe('40');
  });

  it('flags text it cannot read (which blocks saving)', () => {
    render(<Harness initial={{ estimatedAttendance: 0 }} />);
    fireEvent.change(screen.getByTestId('input-expected-attendees'), { target: { value: 'about 40' } });
    expect(state().attendanceError).toMatch(/isn't a number or a range/);
    fireEvent.change(screen.getByTestId('input-expected-attendees'), { target: { value: '40' } });
    expect(state().attendanceError).toBeUndefined();
    expect(state()).toMatchObject({ estimatedAttendance: 40, estimatedAttendanceMin: 0, estimatedAttendanceMax: 0 });
  });
});

describe('saving the new fields', () => {
  const base: any = {
    eventDate: '2026-06-15', backupDates: [], sandwichTypes: [], totalSandwichCount: 100,
    estimatedSandwichCountMin: 0, estimatedSandwichCountMax: 0, status: 'in_process',
    estimatedAttendance: 0, estimatedAttendanceMin: 0, estimatedAttendanceMax: 0,
  };
  const build = (f: any) => buildEventDataForServer({ ...base, ...f }, { mode: 'edit', hasEventRequest: true, actualSandwichMode: 'total' });

  it('sends TSP shopping as exactly true or false', () => {
    expect(build({ isTspShopped: true }).isTspShopped).toBe(true);
    expect(build({}).isTspShopped).toBe(false);
  });

  it('sends a range with its ends, and a single number without', () => {
    expect(build({ estimatedAttendance: 50, estimatedAttendanceMin: 40, estimatedAttendanceMax: 60 })).toMatchObject({
      estimatedAttendance: 50, estimatedAttendanceMin: 40, estimatedAttendanceMax: 60,
    });
    expect(build({ estimatedAttendance: 40 })).toMatchObject({ estimatedAttendance: 40, estimatedAttendanceMin: null, estimatedAttendanceMax: null });
  });

  it('a changed range sends the whole attendance group, even if the middle stayed the same', () => {
    const before = build({ estimatedAttendance: 50, estimatedAttendanceMin: 40, estimatedAttendanceMax: 60 });
    const after = build({ estimatedAttendance: 50, estimatedAttendanceMin: 45, estimatedAttendanceMax: 55 });
    dropUnchangedFields(after, before);
    expect(after).toMatchObject({ estimatedAttendance: 50, estimatedAttendanceMin: 45, estimatedAttendanceMax: 55 });
  });

  it('next-day pickup: only "planned" keeps the overnight details', () => {
    expect(build({ nextDayPickup: 'planned', overnightHoldingLocation: 'Church', overnightPickupTime: '09:00' })).toMatchObject({
      nextDayPickup: 'planned', overnightHoldingLocation: 'Church', overnightPickupTime: '09:00',
    });
    expect(build({ nextDayPickup: 'option', overnightHoldingLocation: 'Church' })).toMatchObject({ nextDayPickup: 'option', overnightHoldingLocation: null });
  });

  it('an older draft with an overnight location (no choice saved) stays planned', () => {
    expect(build({ overnightHoldingLocation: 'Church hall' })).toMatchObject({ nextDayPickup: 'planned', overnightHoldingLocation: 'Church hall' });
  });
});

describe('Greptile review fixes', () => {
  const base: any = {
    eventDate: '2026-06-15', backupDates: [], sandwichTypes: [], totalSandwichCount: 100,
    estimatedSandwichCountMin: 0, estimatedSandwichCountMax: 0, status: 'in_process',
  };
  const build = (f: any) => buildEventDataForServer({ ...base, ...f }, { mode: 'edit', hasEventRequest: true, actualSandwichMode: 'total' });

  it('a range starting at 0 keeps its ends', () => {
    expect(build({ estimatedAttendance: 5, estimatedAttendanceMin: 0, estimatedAttendanceMax: 10 })).toMatchObject({
      estimatedAttendance: 5, estimatedAttendanceMin: 0, estimatedAttendanceMax: 10,
    });
  });

  it("an older draft's attendance edit survives recovery (missing range fields aren't a server edit)", () => {
    // Saved before this PR: no range fields in either half of the draft.
    const original = { status: 'in_process', estimatedAttendance: 30 };
    const draft = { status: 'in_process', estimatedAttendance: 45 };
    // The form opens the same event today with the new defaults.
    const current = { status: 'in_process', estimatedAttendance: 30, estimatedAttendanceMin: 0, estimatedAttendanceMax: 0, nextDayPickup: 'no', isTspShopped: false };
    const { mergedData, conflicts } = intelligentMergeFormData(normalizeDraftAttendance(draft), normalizeDraftAttendance(original), current);
    expect(mergedData.estimatedAttendance).toBe(45);
    expect(conflicts).toEqual([]);
  });

  it("an older draft that added an overnight location recovers as planned, and saves it", () => {
    const original = { status: 'in_process', overnightHoldingLocation: '', overnightPickupTime: '' };
    const draft = { status: 'in_process', overnightHoldingLocation: 'Church hall', overnightPickupTime: '09:00' };
    const current = { status: 'in_process', overnightHoldingLocation: '', overnightPickupTime: '', nextDayPickup: 'no', holdingOvernight: false };
    const { mergedData } = intelligentMergeFormData(normalizeDraftAttendance(draft), normalizeDraftAttendance(original), current);
    expect(mergedData).toMatchObject({ nextDayPickup: 'planned', overnightHoldingLocation: 'Church hall', overnightPickupTime: '09:00' });
    expect(build(mergedData)).toMatchObject({ nextDayPickup: 'planned', overnightHoldingLocation: 'Church hall', overnightPickupTime: '09:00' });
  });

  it('next-day pickup and its overnight details merge as one unit', () => {
    // The user switched to "It's an option" (dropping the location); meanwhile
    // the server changed the location: the server's whole group wins.
    const original = { status: 'in_process', nextDayPickup: 'planned', holdingOvernight: true, overnightHoldingLocation: 'A', overnightPickupTime: '' };
    const draft = { ...original, nextDayPickup: 'option', holdingOvernight: false, overnightHoldingLocation: '' };
    const current = { ...original, overnightHoldingLocation: 'B' };
    const { mergedData } = intelligentMergeFormData(draft, original, current);
    expect(mergedData).toMatchObject({ nextDayPickup: 'planned', overnightHoldingLocation: 'B' });
  });

  it("the delivery window and parking details merge with the next-day choice", () => {
    // The draft switched to "It's an option" (clearing the delivery details);
    // meanwhile the server changed the pickup time: the server's whole plan wins,
    // delivery details included.
    const original = { status: 'in_process', nextDayPickup: 'planned', holdingOvernight: true, overnightHoldingLocation: 'A', overnightPickupTime: '09:00', deliveryTimeWindow: '11-12', deliveryParkingAccess: 'Rear lot' };
    const draft = { ...original, nextDayPickup: 'option', holdingOvernight: false, overnightHoldingLocation: '', overnightPickupTime: '', deliveryTimeWindow: '', deliveryParkingAccess: '' };
    const current = { ...original, overnightPickupTime: '10:00' };
    const { mergedData } = intelligentMergeFormData(draft, original, current);
    expect(mergedData).toMatchObject({ nextDayPickup: 'planned', overnightPickupTime: '10:00', deliveryTimeWindow: '11-12', deliveryParkingAccess: 'Rear lot' });
  });
});
