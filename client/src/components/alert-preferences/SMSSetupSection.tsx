import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Smartphone,
  CheckCircle,
  AlertTriangle,
  MessageSquare,
  Clock,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

type CampaignType = 'hosts' | 'events';

/**
 * SMS Opt-in / Setup UI.
 *
 * Not the same as Alert Preferences — this controls whether the user is
 * opted into SMS at all and which SMS campaigns (hosts/events) they're on.
 * Alert-level channel choices (email vs SMS per alert) live separately.
 *
 * Intentionally preserved from the old Alert Preferences component pending
 * a dedicated audit of the opt-in flow.
 */
export function SMSSetupSection({
  userSMSStatus,
  isLoading,
}: {
  userSMSStatus: any;
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [consent, setConsent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');

  const [campaignTypes, setCampaignTypes] = useState<CampaignType[]>(() => {
    if (userSMSStatus?.campaignTypes && Array.isArray(userSMSStatus.campaignTypes)) {
      return userSMSStatus.campaignTypes;
    }
    if (userSMSStatus?.campaignType) {
      return [userSMSStatus.campaignType];
    }
    return ['hosts'];
  });

  const isAlreadyOptedIn = userSMSStatus?.hasConfirmedOptIn;
  const isPendingConfirmation = userSMSStatus?.isPendingConfirmation;

  const toggleCampaignType = (type: CampaignType) => {
    setCampaignTypes((prev) => {
      if (prev.includes(type)) {
        if (prev.length === 1) return prev;
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  };

  const updateCampaignsMutation = useMutation({
    mutationFn: (types: CampaignType[]) =>
      apiRequest('PATCH', '/api/me/sms-campaigns', { campaignTypes: types }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/sms-status'] });
      toast({
        title: 'Preferences updated',
        description: 'Your SMS notification preferences have been saved.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update preferences.',
        variant: 'destructive',
      });
    },
  });

  const optInMutation = useMutation({
    mutationFn: (data: { phoneNumber: string; consent: boolean }) =>
      apiRequest('POST', '/api/users/sms-opt-in', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/sms-status'] });
      toast({
        title: 'Verification SMS sent',
        description: 'Check your phone for a verification code.',
      });
      setPhoneNumber('');
      setConsent(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send verification SMS.',
        variant: 'destructive',
      });
    },
  });

  const confirmSMSMutation = useMutation({
    mutationFn: (code: string) =>
      apiRequest('POST', '/api/users/sms-confirm', { verificationCode: code }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/sms-status'] });
      toast({
        title: 'SMS confirmed',
        description: "You'll now receive SMS alerts.",
      });
      setVerificationCode('');
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Invalid verification code.',
        variant: 'destructive',
      });
    },
  });

  const optOutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/users/sms-opt-out'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/sms-status'] });
      toast({
        title: 'Unsubscribed',
        description: "You've been removed from SMS alerts.",
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to unsubscribe.',
        variant: 'destructive',
      });
    },
  });

  const formatPhoneNumber = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length === 0) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhoneNumber(formatPhoneNumber(e.target.value));
  };

  const handleSMSSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim() || !consent) return;
    optInMutation.mutate({ phoneNumber: phoneNumber.trim(), consent: true });
  };

  const handleConfirmSMS = (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode.trim()) return;
    confirmSMSMutation.mutate(verificationCode.trim());
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading SMS status...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          SMS Notifications Setup
        </CardTitle>
        <CardDescription>
          Enable SMS to receive text alerts for event reminders and weekly
          collection submissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isAlreadyOptedIn ? (
          <div className="space-y-4">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                <strong>SMS notifications active!</strong>
                {userSMSStatus?.phoneNumber && (
                  <span className="block mt-1">Phone: {userSMSStatus.phoneNumber}</span>
                )}
                {userSMSStatus?.confirmedAt && (
                  <span className="block text-xs text-green-600 mt-1">
                    Confirmed: {new Date(userSMSStatus.confirmedAt).toLocaleDateString()}
                  </span>
                )}
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <Label className="text-sm font-medium">
                Which SMS campaigns do you want to be on?
              </Label>
              <div className="space-y-2">
                <div
                  className={`flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer ${campaignTypes.includes('hosts') ? 'border-blue-300 bg-blue-50' : ''}`}
                  onClick={() => toggleCampaignType('hosts')}
                >
                  <Checkbox
                    id="campaign-hosts"
                    checked={campaignTypes.includes('hosts')}
                    onCheckedChange={() => toggleCampaignType('hosts')}
                  />
                  <Label htmlFor="campaign-hosts" className="flex items-center gap-2 cursor-pointer flex-1">
                    <Clock className="h-4 w-4 text-blue-600" />
                    <div>
                      <p className="font-medium">Collection Reminders</p>
                      <p className="text-xs text-gray-500">Weekly reminders about sandwich collection submissions</p>
                    </div>
                  </Label>
                </div>
                <div
                  className={`flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer ${campaignTypes.includes('events') ? 'border-purple-300 bg-purple-50' : ''}`}
                  onClick={() => toggleCampaignType('events')}
                >
                  <Checkbox
                    id="campaign-events"
                    checked={campaignTypes.includes('events')}
                    onCheckedChange={() => toggleCampaignType('events')}
                  />
                  <Label htmlFor="campaign-events" className="flex items-center gap-2 cursor-pointer flex-1">
                    <Calendar className="h-4 w-4 text-purple-600" />
                    <div>
                      <p className="font-medium">Event Notifications</p>
                      <p className="text-xs text-gray-500">TSP contact assignments, event reminders & updates</p>
                    </div>
                  </Label>
                </div>
              </div>
              {campaignTypes.length === 0 && (
                <p className="text-xs text-red-500">Please select at least one campaign.</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => updateCampaignsMutation.mutate(campaignTypes)}
                disabled={updateCampaignsMutation.isPending || campaignTypes.length === 0}
                className="flex-1 btn-tsp-primary"
              >
                {updateCampaignsMutation.isPending ? 'Saving...' : 'Save Campaign Preferences'}
              </Button>
              <Button
                variant="outline"
                onClick={() => optOutMutation.mutate()}
                disabled={optOutMutation.isPending}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                {optOutMutation.isPending ? 'Unsubscribing...' : 'Unsubscribe'}
              </Button>
            </div>
          </div>
        ) : isPendingConfirmation ? (
          <div className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                <strong>Verification required.</strong>
                <br />
                We sent a code to {userSMSStatus?.phoneNumber}. Type the code from
                that text below.
              </AlertDescription>
            </Alert>

            <form onSubmit={handleConfirmSMS} className="space-y-4">
              <div>
                <Label htmlFor="verification-code">Verification code</Label>
                <Input
                  id="verification-code"
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  className="text-lg text-center tracking-widest mt-2"
                />
              </div>

              <Button
                type="submit"
                className="w-full btn-tsp-primary"
                disabled={confirmSMSMutation.isPending || verificationCode.length !== 6}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                {confirmSMSMutation.isPending ? 'Confirming...' : 'Confirm SMS'}
              </Button>
            </form>

            <div className="text-center">
              <Button
                variant="link"
                size="sm"
                onClick={() => optOutMutation.mutate()}
                disabled={optOutMutation.isPending}
              >
                {optOutMutation.isPending ? 'Resetting...' : 'Start over'}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSMSSubmit} className="space-y-6">
            <div className="bg-brand-primary-lighter p-4 rounded-lg">
              <h4 className="font-medium text-brand-primary-darker mb-2 flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                Why sign up for SMS?
              </h4>
              <ul className="text-sm text-brand-primary-dark space-y-1">
                <li>- Never miss an event you're volunteering at</li>
                <li>- Get reminders for weekly sandwich collection reporting</li>
                <li>- Instant notifications for important updates</li>
              </ul>
            </div>

            <div>
              <Label htmlFor="sms-phone">Phone number</Label>
              <Input
                id="sms-phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={phoneNumber}
                onChange={handlePhoneChange}
                className="text-lg mt-2"
              />
              <p className="text-sm text-muted-foreground mt-1">US numbers only</p>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="sms-consent"
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked as boolean)}
                className="mt-1"
              />
              <div>
                <Label htmlFor="sms-consent" className="text-sm cursor-pointer">
                  I consent to receive SMS from The Sandwich Project
                </Label>
                <ul className="text-xs text-muted-foreground mt-2 space-y-1 ml-4">
                  <li>- Messages are for alerts only, not marketing</li>
                  <li>- You can unsubscribe anytime</li>
                  <li>- Standard rates may apply</li>
                </ul>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full btn-tsp-primary"
              disabled={optInMutation.isPending || !consent || !phoneNumber.trim()}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              {optInMutation.isPending ? 'Sending...' : 'Sign up for SMS alerts'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
