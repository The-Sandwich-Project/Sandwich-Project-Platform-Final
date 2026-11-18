/**
 * SmsQuickSetupDialog
 *
 * A short, focused "turn on text messages" window. Opened from places that
 * offer SMS (e.g. the reminder channel picker) when the user hasn't finished
 * SMS sign-up yet, so they don't have to hunt for the full setup page.
 *
 * Steps: phone + consent → we text a 6-digit code → enter it (or reply YES)
 * → done. Uses the same endpoints as the full SMS setup in Profile → Alerts.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle, Loader2, MessageSquare, Smartphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { apiRequest, queryClient } from '@/lib/queryClient';

export const SMS_STATUS_QUERY_KEY = ['/api/users/sms-status'];

export interface SmsStatus {
  hasConfirmedOptIn: boolean;
  isPendingConfirmation: boolean;
  phoneNumber: string | null;
}

/** The user's SMS sign-up status (shared cache with the full setup page). */
export function useSmsStatus() {
  return useQuery<SmsStatus>({
    queryKey: SMS_STATUS_QUERY_KEY,
    queryFn: () => apiRequest('GET', '/api/users/sms-status'),
  });
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SmsQuickSetupDialog({
  open,
  onOpenChange,
  onEnabled,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the number is confirmed. */
  onEnabled?: () => void;
  /** One line explaining why we're asking, shown under the title. */
  reason?: string;
}) {
  const { data: status, isLoading } = useQuery<SmsStatus>({
    queryKey: SMS_STATUS_QUERY_KEY,
    queryFn: () => apiRequest('GET', '/api/users/sms-status'),
    enabled: open,
    // While we wait on a code, poll so replying "YES" by text also completes setup.
    refetchInterval: (query) =>
      open && query.state.data?.isPendingConfirmation ? 5000 : false,
  });

  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [justEnabled, setJustEnabled] = useState(false);

  // Fresh form each time the window opens.
  useEffect(() => {
    if (open) {
      setPhone('');
      setConsent(false);
      setCode('');
      setError(null);
      setJustEnabled(false);
    }
  }, [open]);

  // Finished — via the code here, or a "YES" reply picked up by polling.
  const confirmed = !!status?.hasConfirmedOptIn;
  useEffect(() => {
    if (open && confirmed && !justEnabled) {
      setJustEnabled(true);
      onEnabled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, confirmed]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: SMS_STATUS_QUERY_KEY });

  const sendCode = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/users/sms-opt-in', {
        phoneNumber: phone.trim(),
        consent: true,
        category: 'events',
      }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorText(e, "We couldn't text that number. Check it and try again.")),
  });

  const confirmCode = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/users/sms-confirm', { verificationCode: code }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorText(e, "That code didn't work. Check it and try again.")),
  });

  // "Use a different number" — clears the pending sign-up so they can start over.
  const startOver = useMutation({
    mutationFn: () => apiRequest('POST', '/api/users/sms-opt-out'),
    onSuccess: () => {
      setCode('');
      setError(null);
      refresh();
    },
  });

  const phoneDigits = phone.replace(/\D/g, '');
  const step = confirmed ? 'done' : status?.isPendingConfirmation ? 'code' : 'phone';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="sms-quick-setup-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-[#007E8C]" />
            Turn on text messages
          </DialogTitle>
          <DialogDescription>
            {reason ?? 'Get TSP alerts by text. It takes about a minute.'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-[#007E8C]" />
          </div>
        ) : step === 'done' ? (
          <div className="text-center space-y-3 py-4" data-testid="sms-setup-done">
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
            <p className="font-medium text-gray-900">Text messages are on</p>
            {status?.phoneNumber && (
              <p className="text-sm text-gray-600">We'll text {status.phoneNumber}.</p>
            )}
            <DialogFooter className="pt-2">
              <Button
                className="w-full bg-[#007E8C] hover:bg-[#006570] text-white"
                onClick={() => onOpenChange(false)}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : step === 'code' ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) confirmCode.mutate();
            }}
          >
            <StepLabel current={2} />
            <p className="text-sm text-gray-700">
              We texted a 6-digit code to <strong>{status?.phoneNumber}</strong>.
              Type it below, or just reply <strong>YES</strong> to that text.
            </p>
            <div>
              <Label htmlFor="sms-quick-code">Code</Label>
              <Input
                id="sms-quick-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="mt-1 text-lg text-center tracking-widest"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              type="submit"
              className="w-full bg-[#007E8C] hover:bg-[#006570] text-white"
              disabled={code.length !== 6 || confirmCode.isPending}
            >
              {confirmCode.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm
            </Button>
            <div className="flex justify-between text-sm">
              <button
                type="button"
                className="text-[#007E8C] hover:underline disabled:opacity-50"
                onClick={() => startOver.mutate()}
                disabled={startOver.isPending}
              >
                Use a different number
              </button>
              <span className="text-gray-500">Checking for your reply…</span>
            </div>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (phoneDigits.length === 10 && consent) sendCode.mutate();
            }}
          >
            <StepLabel current={1} />
            <div>
              <Label htmlFor="sms-quick-phone">Mobile number</Label>
              <Input
                id="sms-quick-phone"
                type="tel"
                autoComplete="tel-national"
                autoFocus
                placeholder="(404) 555-1234"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                className="mt-1 text-lg"
              />
              <p className="text-xs text-gray-500 mt-1">US numbers only.</p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={consent}
                onCheckedChange={(c) => setConsent(c === true)}
                className="mt-0.5"
                aria-label="I agree to get texts from The Sandwich Project"
              />
              <span className="text-sm text-gray-700">
                I agree to get texts from The Sandwich Project about my events.
                Alerts only, never marketing. Reply STOP anytime to opt out.
                Message and data rates may apply.
              </span>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              type="submit"
              className="w-full bg-[#007E8C] hover:bg-[#006570] text-white"
              disabled={phoneDigits.length !== 10 || !consent || sendCode.isPending}
            >
              {sendCode.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <MessageSquare className="w-4 h-4 mr-2" />
              )}
              Text me a code
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepLabel({ current }: { current: 1 | 2 }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
      Step {current} of 2 · {current === 1 ? 'Your number' : 'Confirm it'}
    </p>
  );
}
