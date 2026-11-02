import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation } from 'wouter';
import { User, Lock, Save, Bell, Smartphone, Monitor, Mail, Car, HandHeart, CheckCircle2 } from 'lucide-react';
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { PERMISSIONS } from '@shared/auth-utils';
import { TollFreeVerificationPanel } from './toll-free-verification-panel';
import AlertPreferences from './alert-preferences';
import CheckInReminderPreferences from './check-in-reminder-preferences';
import UserEmailTemplatesSettings from './user-email-templates-settings';
import { SMSSetupSection } from './alert-preferences/SMSSetupSection';
import { useMobilePreference } from '@/mobile/components/mobile-layout-prompt';

const profileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  displayName: z.string().min(1, 'Display name is required'),
  email: z.string().email('Invalid email address'),
  preferredEmail: z.string().email('Invalid email address').optional().or(z.literal('')),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  // Self-declared event-role willingness. Approval (speaker/driver/van) is set
  // by coordinators and shown read-only below.
  willingToVolunteer: z.boolean(),
  willingToSpeak: z.boolean(),
  willingToDrive: z.boolean(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

const smsSchema = z.object({
  phoneNumber: z.string().min(1, 'Phone number is required'),
  consent: z.boolean(),
});

interface SMSOptInData {
  phoneNumber: string;
  consent: boolean;
}

type ProfileFormData = z.infer<typeof profileSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;
type SMSFormData = z.infer<typeof smsSchema>;

// Read-only indicator of coordinator approval for a gated role (speaker/driver).
// Only meaningful once the user is willing — but harmless to show regardless.
function ApprovalBadge({ approved }: { approved?: boolean | null }) {
  if (approved) {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#236383]">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Coordinator approved
      </span>
    );
  }
  return (
    <span className="mt-1 inline-block text-xs text-muted-foreground">
      Pending coordinator approval
    </span>
  );
}

export default function UserProfile() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const { preference: mobilePreference, setPreference: setMobilePreference } = useMobilePreference();
  
  // Parse URL query parameters to get the tab
  const getTabFromURL = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const tabParam = searchParams.get('tab');
    if (
      tabParam === 'password' ||
      tabParam === 'notifications' ||
      tabParam === 'profile' ||
      tabParam === 'email-templates' ||
      tabParam === 'sms'
    ) {
      return tabParam;
    }
    return 'profile'; // default
  };

  const [activeTab, setActiveTab] = useState<
    'profile' | 'password' | 'notifications' | 'email-templates' | 'sms'
  >(getTabFromURL());
  const [phoneNumber, setPhoneNumber] = useState('');
  const [consent, setConsent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  
  // Update active tab when URL changes
  useEffect(() => {
    const newTab = getTabFromURL();
    setActiveTab(newTab);
  }, [location]);

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      displayName: '',
      email: '',
      preferredEmail: '',
      phoneNumber: '',
      address: '',
      willingToVolunteer: true,
      willingToSpeak: false,
      willingToDrive: false,
    },
  });

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  // Load user profile data
  const { data: userProfile, isLoading } = useQuery({
    queryKey: ['/api/auth/profile'],
    enabled: !!user,
  });

  // Check if user already has SMS consent
  const { data: userSMSStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['/api/users/sms-status'],
    queryFn: () => apiRequest('GET', '/api/users/sms-status'),
    enabled: !!user?.id,
  });

  // Update form when profile data loads
  useEffect(() => {
    if (userProfile && typeof userProfile === 'object') {
      const profile = userProfile as any;
      profileForm.reset({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        displayName: profile.displayName || '',
        email: profile.email || '',
        preferredEmail: profile.preferredEmail || '',
        phoneNumber: profile.phoneNumber || '',
        address: profile.address || '',
        willingToVolunteer: profile.willingToVolunteer ?? true,
        willingToSpeak: profile.willingToSpeak ?? false,
        willingToDrive: profile.willingToDrive ?? false,
      });
    }
  }, [userProfile, profileForm]);

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      return await apiRequest('PUT', '/api/auth/profile', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/profile'] });
      toast({
        title: 'Profile updated',
        description: 'Your profile has been successfully updated.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update profile',
        variant: 'destructive',
      });
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (data: PasswordFormData) => {
      return await apiRequest('PUT', '/api/auth/change-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
    },
    onSuccess: () => {
      passwordForm.reset();
      toast({
        title: 'Password changed',
        description: 'Your password has been successfully updated.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to change password',
        variant: 'destructive',
      });
    },
  });

  const onSubmitProfile = (data: ProfileFormData) => {
    updateProfileMutation.mutate(data);
  };

  const onSubmitPassword = (data: PasswordFormData) => {
    changePasswordMutation.mutate(data);
  };

  // SMS opt-in mutation
  const optInMutation = useMutation({
    mutationFn: (data: SMSOptInData) =>
      apiRequest('POST', '/api/users/sms-opt-in', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/sms-status'] });
      toast({
        title: 'Confirmation SMS Sent!',
        description: "Please check your phone and reply with your verification code or 'YES' to complete signup.",
      });
      setPhoneNumber('');
      setConsent(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send confirmation SMS.',
        variant: 'destructive',
      });
    },
  });

  // SMS confirmation mutation
  const confirmSMSMutation = useMutation({
    mutationFn: (verificationCode: string) =>
      apiRequest('POST', '/api/users/sms-confirm', { verificationCode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/sms-status'] });
      toast({
        title: 'SMS Confirmed!',
        description: "You'll now receive weekly sandwich collection reminders.",
      });
      setVerificationCode('');
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to confirm SMS signup.',
        variant: 'destructive',
      });
    },
  });

  // SMS opt-out mutation
  const optOutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/users/sms-opt-out'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/sms-status'] });
      toast({
        title: 'Unsubscribed',
        description: "You've been removed from SMS reminders.",
      });
      setPhoneNumber('');
      setConsent(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description:
          error.message || 'Failed to unsubscribe from SMS reminders.',
        variant: 'destructive',
      });
    },
  });

  // SMS form handling - improved phone number formatting
  const formatPhoneNumber = (value: string) => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');
    
    // Limit to 10 digits maximum
    const limitedDigits = digits.slice(0, 10);

    // Format progressively as user types
    if (limitedDigits.length === 0) return '';
    if (limitedDigits.length <= 3) return limitedDigits;
    if (limitedDigits.length <= 6) {
      return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
    }
    // Format full number
    return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    
    // Allow backspacing and deletion
    if (input.length < phoneNumber.length) {
      const digits = input.replace(/\D/g, '');
      setPhoneNumber(formatPhoneNumber(digits));
      return;
    }
    
    // Format normally for new input
    const formatted = formatPhoneNumber(input);
    setPhoneNumber(formatted);
  };

  const handleSMSSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!phoneNumber.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter your phone number.',
        variant: 'destructive',
      });
      return;
    }

    if (!consent) {
      toast({
        title: 'Error',
        description: 'Please check the consent box to proceed.',
        variant: 'destructive',
      });
      return;
    }

    optInMutation.mutate({
      phoneNumber: phoneNumber.trim(),
      consent: true,
    });
  };

  // Check user SMS status
  const isAlreadyOptedIn = userSMSStatus?.hasConfirmedOptIn;
  const isPendingConfirmation = userSMSStatus?.isPendingConfirmation;
  const smsStatus = userSMSStatus?.status;

  // SMS confirmation form handler
  const handleConfirmSMS = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!verificationCode.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter your verification code.',
        variant: 'destructive',
      });
      return;
    }

    confirmSMSMutation.mutate(verificationCode.trim());
  };

  if (isLoading || statusLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <User className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-main-heading text-primary">
          Account Settings
        </h1>
        <p className="font-body text-muted-foreground">
          Manage your profile information and account security
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 border-b">
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'profile'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <User className="w-4 h-4 inline mr-2" />
          Profile
        </button>
        <button
          onClick={() => setActiveTab('password')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'password'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Lock className="w-4 h-4 inline mr-2" />
          Password
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'notifications'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          data-testid="button-notifications-tab"
          data-tour="alerts-tab"
        >
          <Bell className="w-4 h-4 inline mr-2" />
          Alerts
        </button>
        <button
          onClick={() => setActiveTab('sms')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'sms'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          data-testid="button-sms-tab"
        >
          <Smartphone className="w-4 h-4 inline mr-2" />
          SMS
        </button>
        <button
          onClick={() => setActiveTab('email-templates')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'email-templates'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Mail className="w-4 h-4 inline mr-2" />
          Email Templates
        </button>
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Profile Information
            </CardTitle>
            <CardDescription>
              Update your personal information and display preferences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...profileForm}>
              <form
                onSubmit={profileForm.handleSubmit(onSubmitProfile)}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={profileForm.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={profileForm.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Doe" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={profileForm.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="How you want to appear in messages and activities"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="john@example.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Contact Information</h4>
                  
                  <FormField
                    control={profileForm.control}
                    name="preferredEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Preferred Email (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="my-preferred@email.com"
                            {...field}
                            data-testid="input-preferred-email"
                          />
                        </FormControl>
                        <p className="text-sm text-muted-foreground">
                          This email will be used as the Reply-To address in toolkit emails. If left blank, your main email will be used.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={profileForm.control}
                    name="phoneNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cell Phone Number (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="tel"
                            placeholder="(555) 123-4567"
                            {...field}
                            data-testid="input-phone-number"
                          />
                        </FormControl>
                        <p className="text-sm text-muted-foreground">
                          Your contact phone number. This will be included in email signatures and is separate from SMS notifications.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={profileForm.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Home Address (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="text"
                            placeholder="123 Main St, Atlanta, GA 30309"
                            {...field}
                            data-testid="input-address"
                          />
                        </FormControl>
                        <p className="text-sm text-muted-foreground">
                          Your home address is used to show your location on the driver planning map so the team can coordinate logistics.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                {/* Volunteer roles: what this person is willing to do. Driver
                    also requires coordinator approval (shown read-only). */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Volunteer Roles</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Tell us what you're up for. You'll see signup opportunities on the
                      Volunteer Hub for the roles you choose. The driver role also
                      needs coordinator approval before it appears.
                    </p>
                  </div>

                  <FormField
                    control={profileForm.control}
                    name="willingToVolunteer"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-[#236383]/10">
                            <HandHeart className="w-5 h-5 text-[#236383]" />
                          </div>
                          <div>
                            <FormLabel className="text-base font-medium">General Volunteer</FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Help out at events — setup, assembly, distribution, and more.
                            </p>
                          </div>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={profileForm.control}
                    name="willingToDrive"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-[#236383]/10">
                            <Car className="w-5 h-5 text-[#236383]" />
                          </div>
                          <div>
                            <FormLabel className="text-base font-medium">Driver</FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Drive to pick up and deliver sandwiches for events.
                            </p>
                            <ApprovalBadge approved={(userProfile as any)?.driverApproved} />
                          </div>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Display Preferences</h4>
                  
                  <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        {mobilePreference === 'mobile' ? (
                          <Smartphone className="w-5 h-5 text-primary" />
                        ) : (
                          <Monitor className="w-5 h-5 text-primary" />
                        )}
                      </div>
                      <div>
                        <Label htmlFor="mobile-view-toggle" className="text-base font-medium cursor-pointer">
                          Use Mobile View
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          {mobilePreference === 'mobile' 
                            ? 'Currently using mobile-optimized layout' 
                            : 'Switch to mobile-optimized layout for touch devices'}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="mobile-view-toggle"
                      checked={mobilePreference === 'mobile'}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setMobilePreference('mobile');
                          toast({
                            title: 'Mobile view enabled',
                            description: 'Redirecting to mobile layout...',
                          });
                          // Redirect to mobile view after a brief delay
                          setTimeout(() => {
                            setLocation('/m');
                          }, 500);
                        } else {
                          setMobilePreference('desktop');
                          toast({
                            title: 'Desktop view enabled',
                            description: 'You will stay on the desktop layout',
                          });
                        }
                      }}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={updateProfileMutation.isPending}
                  className="btn-tsp-primary"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateProfileMutation.isPending
                    ? 'Saving...'
                    : 'Save Changes'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      {/* Password Tab */}
      {activeTab === 'password' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Change Password
            </CardTitle>
            <CardDescription>
              Update your account password for security
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...passwordForm}>
              <form
                onSubmit={passwordForm.handleSubmit(onSubmitPassword)}
                className="space-y-6"
              >
                <FormField
                  control={passwordForm.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Enter your current password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <FormField
                  control={passwordForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Enter your new password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={passwordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm New Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Confirm your new password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={changePasswordMutation.isPending}
                  className="btn-tsp-primary"
                >
                  <Lock className="w-4 h-4 mr-2" />
                  {changePasswordMutation.isPending
                    ? 'Changing...'
                    : 'Change Password'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      {/* Notifications Tab - Alert Preferences first, then intake-only
          Check-In Reminders below (gated by EVENT_CHECK_IN_ALERTS). */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <AlertPreferences />
          {(user?.role === 'super_admin' ||
            (Array.isArray(user?.permissions) &&
              (user.permissions as string[]).includes(PERMISSIONS.EVENT_CHECK_IN_ALERTS))) && (
            <CheckInReminderPreferences />
          )}
        </div>
      )}

      {/* Toll-Free Verification Panel - Admin Only */}
      {activeTab === 'notifications' && user && typeof user.permissions === 'number' && user.permissions >= 80 && (
        <div className="space-y-6">
          <Separator />
          <TollFreeVerificationPanel />
        </div>
      )}

      {/* SMS Tab — promoted out of Alert Preferences so users can find the
          opt-in/setup flow without scrolling past every alert toggle. */}
      {activeTab === 'sms' && (
        <div className="space-y-6">
          <SMSSetupSection userSMSStatus={userSMSStatus} isLoading={statusLoading} />
        </div>
      )}

      {/* Email Templates Tab */}
      {activeTab === 'email-templates' && (
        <UserEmailTemplatesSettings />
      )}
    </div>
  );
}
