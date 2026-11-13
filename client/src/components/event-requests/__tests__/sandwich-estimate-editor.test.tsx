import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CardSandwichEstimateEdit } from '../SandwichEstimateEditor';
import { insertEventRequestSchema } from '@shared/schema';
import { resolveEstimatePatch } from '@shared/sandwich-estimate';

describe('CardSandwichEstimateEdit (quick edit on event cards)', () => {
  const event = {
    id: 7,
    estimatedSandwichCount: 300,
    sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }],
  };

  it('opens with the saved estimate and shows how it will be saved', () => {
    render(<CardSandwichEstimateEdit request={event} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect((screen.getByLabelText('Estimated sandwiches') as HTMLInputElement).value).toBe('300');
    expect(screen.getByText('300, Deli & PB&J (split TBD)')).toBeTruthy();
  });

  it('blocks saving unreadable text', () => {
    const onSave = jest.fn();
    render(<CardSandwichEstimateEdit request={event} onSave={onSave} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Estimated sandwiches'), { target: { value: 'lots' } });
    expect(screen.getByText(/isn't a number/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves a range with a partial split as one consistent estimate the request schema accepts', () => {
    const onSave = jest.fn();
    render(<CardSandwichEstimateEdit request={event} onSave={onSave} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Estimated sandwiches'), { target: { value: '300-400' } });
    fireEvent.change(screen.getByLabelText('Amount for sandwich type 1'), { target: { value: '150' } });
    expect(screen.getByText('300–400 (150 Deli, PB&J TBD)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const body = onSave.mock.calls[0][0];
    expect(body).toMatchObject({ estimatedSandwichCount: 350, estimatedSandwichCountMin: 300, estimatedSandwichCountMax: 400 });
    // What the PATCH route does, then the server rule: same estimate.
    const parsed = insertEventRequestSchema.partial().parse(body);
    expect(resolveEstimatePatch(event, parsed)).toMatchObject({
      estimatedSandwichCount: 350,
      estimatedSandwichCountMin: 300,
      estimatedSandwichCountMax: 400,
      sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 0 }],
    });
  });

  it('removing every type saves "type TBD"', () => {
    const onSave = jest.fn();
    render(<CardSandwichEstimateEdit request={event} onSave={onSave} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByLabelText('Remove sandwich type 2'));
    fireEvent.click(screen.getByLabelText('Remove sandwich type 1'));
    expect(screen.getByText('300, type TBD')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].sandwichTypes).toBeNull();
  });
});
