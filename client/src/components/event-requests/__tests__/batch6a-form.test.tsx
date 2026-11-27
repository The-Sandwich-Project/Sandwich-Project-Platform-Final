jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn(), queryClient: {}, applyEventRequestSaveToCache: jest.fn() }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TspShoppingCheckbox } from '../TspShopping';
import { ExpectedAttendeesField } from '../form-sections/ExpectedAttendeesField';
import { buildEventDataForServer, dropUnchangedFields } from '../form-utils';

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
