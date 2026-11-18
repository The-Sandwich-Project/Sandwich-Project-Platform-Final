/**
 * Reminder channel picker must not let users choose SMS until their number
 * is confirmed; instead it shows a notice that opens the quick SMS setup.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Shared test state for the mocked API
const api: { smsStatus: any; prefs: any; calls: Array<[string, string, any]> } = {
  smsStatus: null,
  prefs: null,
  calls: [],
};

const mockQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

jest.mock('@/lib/queryClient', () => ({
  queryClient: mockQueryClient,
  apiRequest: jest.fn(async (method: string, url: string, body?: any) => {
    api.calls.push([method, url, body]);
    if (url === '/api/users/sms-status') return api.smsStatus;
    if (url === '/api/me/check-in-reminder-preferences' && method === 'GET') return api.prefs;
    if (url === '/api/users/sms-opt-in') {
      api.smsStatus = { hasConfirmedOptIn: false, isPendingConfirmation: true, phoneNumber: '+14045551234' };
      return { ok: true };
    }
    if (url === '/api/users/sms-confirm') {
      api.smsStatus = { hasConfirmedOptIn: true, isPendingConfirmation: false, phoneNumber: '+14045551234' };
      return { ok: true };
    }
    return {};
  }),
}));

jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

// Radix Select doesn't run in jsdom; swap in a native <select> with the same API.
jest.mock('@/components/ui/select', () => {
  const React = require('react');
  const Ctx = React.createContext(null);
  return {
    Select: ({ value, onValueChange, children }: any) =>
      React.createElement(Ctx.Provider, { value: { value, onValueChange } }, children),
    SelectTrigger: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: any) => {
      const ctx: any = React.useContext(Ctx);
      return React.createElement(
        'select',
        {
          'data-testid': 'select',
          value: ctx.value,
          onChange: (e: any) => ctx.onValueChange(e.target.value),
        },
        children
      );
    },
    SelectItem: ({ value, children }: any) =>
      React.createElement('option', { value }, children),
  };
});

import CheckInReminderPreferencesEditor from '../check-in-reminder-preferences';

function renderEditor() {
  return render(
    <QueryClientProvider client={mockQueryClient}>
      <CheckInReminderPreferencesEditor />
    </QueryClientProvider>
  );
}

const channelSelect = () => screen.getAllByTestId('select')[0] as HTMLSelectElement;

describe('Reminder channel SMS gating', () => {
  beforeEach(() => {
    mockQueryClient.clear();
    api.calls = [];
    api.prefs = { configured: true, defaultChannel: 'email', rules: [] };
    api.smsStatus = { hasConfirmedOptIn: false, isPendingConfirmation: false, phoneNumber: null };
  });

  it('blocks SMS and shows the setup notice when texts are not set up', async () => {
    renderEditor();
    await screen.findByText('Default notification channel');
    await waitFor(() => expect(screen.getAllByText('(needs setup)').length).toBe(2));

    fireEvent.change(channelSelect(), { target: { value: 'sms' } });

    expect(await screen.findByTestId('sms-not-enabled-notice')).toBeInTheDocument();
    expect(channelSelect().value).toBe('email');
  });

  it('lets confirmed users pick SMS with no notice', async () => {
    api.smsStatus = { hasConfirmedOptIn: true, isPendingConfirmation: false, phoneNumber: '+1' };
    renderEditor();
    await screen.findByText('Default notification channel');
    await waitFor(() => expect(screen.queryByText('(needs setup)')).toBeNull());

    fireEvent.change(channelSelect(), { target: { value: 'both' } });

    expect(channelSelect().value).toBe('both');
    expect(screen.queryByTestId('sms-not-enabled-notice')).toBeNull();
  });

  it('warns when a saved SMS choice is not sending', async () => {
    api.prefs = { configured: true, defaultChannel: 'sms', rules: [] };
    renderEditor();
    expect(await screen.findByText(/no texts are being sent/)).toBeInTheDocument();
  });

  it('setup window: number + consent, code, then applies the SMS choice', async () => {
    renderEditor();
    await screen.findByText('Default notification channel');
    await waitFor(() => expect(screen.getAllByText('(needs setup)').length).toBe(2));
    fireEvent.change(channelSelect(), { target: { value: 'both' } });
    fireEvent.click(await screen.findByTestId('button-open-sms-setup'));

    // Step 1
    const send = await screen.findByRole('button', { name: /text me a code/i });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '4045551234' } });
    expect(send).toBeDisabled(); // consent still required
    fireEvent.click(screen.getByRole('checkbox', { name: /agree to get texts/i }));
    expect(send).toBeEnabled();
    fireEvent.click(send);

    // Step 2
    const codeInput = await screen.findByLabelText('Code');
    expect(api.calls).toContainEqual([
      'POST',
      '/api/users/sms-opt-in',
      { phoneNumber: '(404) 555-1234', consent: true, category: 'events' },
    ]);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    // Done → the blocked choice is applied
    expect(await screen.findByTestId('sms-setup-done')).toBeInTheDocument();
    await waitFor(() => expect(channelSelect().value).toBe('both'));
    expect(screen.getByText(/Hit Save below/)).toBeInTheDocument();
    expect(screen.queryByTestId('sms-not-enabled-notice')).toBeNull();
  });
});
