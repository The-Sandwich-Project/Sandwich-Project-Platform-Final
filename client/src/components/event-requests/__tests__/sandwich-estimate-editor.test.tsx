import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CardSandwichEstimateEdit } from '../SandwichEstimateEditor';
import { insertEventRequestSchema } from '@shared/schema';
import { resolveEstimatePatch } from '@shared/sandwich-estimate';

describe('Sandwich estimate editor (Deli / PB&J rows)', () => {
  const event = {
    id: 7,
    estimatedSandwichCount: 300,
    sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }],
  };

  it('opens with both types ticked, the total box showing, and how it will be saved', () => {
    render(<CardSandwichEstimateEdit request={event} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect((screen.getByLabelText('Total, if known') as HTMLInputElement).value).toBe('300');
    expect(screen.getByText('300, Deli & PB&J (split TBD)')).toBeTruthy();
  });

  it('always says ranges are allowed, and uses a keyboard that has a dash', () => {
    render(<CardSandwichEstimateEdit request={event} onSave={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Deli amount'), { target: { value: '150' } });
    expect(screen.getByTestId('card-7-sandwich-range-hint').textContent).toMatch(/single number or a range/);
    for (const box of [screen.getByLabelText('Deli amount'), screen.getByLabelText('PB&J amount'), screen.getByLabelText('Total, if known')]) {
      expect(box.getAttribute('inputmode')).not.toBe('numeric');
    }
  });

  it('blocks saving unreadable text', () => {
    const onSave = jest.fn();
    render(<CardSandwichEstimateEdit request={event} onSave={onSave} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Total, if known'), { target: { value: 'lots' } });
    expect(screen.getByText(/isn't a number/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a range with a partial split saves one consistent estimate the request schema accepts', () => {
    const onSave = jest.fn();
    render(<CardSandwichEstimateEdit request={event} onSave={onSave} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Total, if known'), { target: { value: '300-400' } });
    fireEvent.change(screen.getByLabelText('Deli amount'), { target: { value: '150' } });
    expect(screen.getByText('300–400 (150 Deli, PB&J TBD)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const body = onSave.mock.calls[0][0];
    expect(body).toMatchObject({ estimatedSandwichCount: 350, estimatedSandwichCountMin: 300, estimatedSandwichCountMax: 400 });
    const parsed = insertEventRequestSchema.partial().parse(body);
    expect(resolveEstimatePatch(event, parsed)).toMatchObject({
      estimatedSandwichCount: 350,
      estimatedSandwichCountMin: 300,
      estimatedSandwichCountMax: 400,
      sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 0 }],
    });
  });

  it('once every ticked type has an amount, the total is worked out and the box goes away', () => {
    const onSave = jest.fn();
    render(<CardSandwichEstimateEdit request={event} onSave={onSave} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Deli amount'), { target: { value: '400-500' } });
    fireEvent.change(screen.getByLabelText('PB&J amount'), { target: { value: '100-150' } });
    expect(screen.queryByLabelText('Total, if known')).toBeNull();
    expect(screen.getByText('500–650 (400–500 Deli, 100–150 PB&J)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ estimatedSandwichCountMin: 500, estimatedSandwichCountMax: 650 });
  });

  it('unticking every type saves "type TBD"', () => {
    const onSave = jest.fn();
    render(<CardSandwichEstimateEdit request={event} onSave={onSave} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByLabelText('PB&J'));
    fireEvent.click(screen.getByLabelText('Deli'));
    expect(screen.getByText('300, type TBD')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].sandwichTypes).toBeNull();
  });

  it('shows an older Turkey event in the Deli row', () => {
    render(
      <CardSandwichEstimateEdit
        request={{ id: 8, estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli_turkey', quantity: 200 }] }}
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect((screen.getByLabelText('Deli amount') as HTMLInputElement).value).toBe('200');
    expect(screen.getByText('200 Deli')).toBeTruthy();
  });

  it('an older split with a type-TBD remainder can be finished, and the total is then worked out', () => {
    const onSave = jest.fn();
    render(
      <CardSandwichEstimateEdit
        request={{
          id: 9,
          estimatedSandwichCount: 300,
          sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'unknown', quantity: 150 }],
        }}
        onSave={onSave}
        onCancel={jest.fn()}
      />
    );
    if (!(screen.getByLabelText('PB&J') as HTMLInputElement).checked) fireEvent.click(screen.getByLabelText('PB&J'));
    fireEvent.change(screen.getByLabelText('PB&J amount'), { target: { value: '100' } });
    // Still part TBD, so the typed 300 stands until the user says the split is complete.
    expect(screen.getByText('Part of this total is still type TBD.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /split above is complete/ }));
    expect(screen.queryByText('Part of this total is still type TBD.')).toBeNull();
    expect(screen.queryByLabelText('Total, if known')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const body = onSave.mock.calls[0][0];
    expect(body.estimatedSandwichCount).toBe(250);
    expect(JSON.parse(body.sandwichTypes)).toEqual([{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 100 }]);
  });
});
