import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Link } from 'wouter';
import { AlertCircle, Clock, LogIn, Eye, EyeOff } from 'lucide-react';
import tspLogo from '@assets/CMYK_PRINT_TSP-01_1749585167435.png';
import { AuthPageLayout } from '@/components/layout/responsive-page-layout';

/**
 * Where to go after signing in: the ?returnTo= page the person was trying to
 * reach (set by App.tsx when a signed-out visitor opens a deep link), or home.
 * Only same-site paths are allowed, so the parameter can't send anyone to
 * another website.
 */
export function safeReturnTo(search: string): string {
  const raw = new URLSearchParams(search).get('returnTo');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login')) return '/';
  return raw;
}

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string(), // Allow empty - server will redirect to set-password if needed
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setErrorMessage(null);
    setPendingApproval(false);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include',
      });

      if (response.ok || response.redirected) {
        window.location.href = safeReturnTo(window.location.search);
        return;
      }

      const result = await response.json();

      if (result.code === 'PENDING_APPROVAL') {
        setPendingApproval(true);
      } else if (result.code === 'PASSWORD_SETUP_REQUIRED') {
        // User was created without a password - request token and show message
        // The user will receive an email with a secure token link
        try {
          await apiRequest('POST', '/api/auth/request-initial-password', {
            email: result.email,
          });
          setErrorMessage('Your account requires password setup. Please check your email for a password setup link.');
          toast({
            title: 'Password Setup Required',
            description: 'Please check your email for a password setup link.',
            duration: 10000,
          });
        } catch (error) {
          setErrorMessage('Your account requires password setup. Please contact support to request a password setup link.');
        }
        return;
      } else {
        setErrorMessage(result.message || 'Login failed. Please try again.');
        toast({
          title: 'Login Failed',
          description: result.message || 'Invalid email or password',
          variant: 'destructive',
        });
      }
    } catch (error) {
      setErrorMessage('An error occurred. Please try again.');
      toast({
        title: 'Error',
        description: 'Failed to connect to the server. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (pendingApproval) {
    return (
      <AuthPageLayout title="Pending Approval" showBack={false}>
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #FBAD3F 0%, #F5A623 50%, #E89A2F 100%)' }}>
          <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm border-0 shadow-2xl">
            <CardContent className="p-6 sm:p-8 text-center">
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
                <Clock className="w-10 h-10 sm:w-12 sm:h-12 text-amber-600" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">
                Account Pending Approval
              </h2>
              <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6 leading-relaxed">
                Thank you for signing up! Your account is currently being reviewed by our team.
                You'll receive an email notification once your account has been approved.
              </p>
              <p className="text-xs sm:text-sm text-gray-500 mb-6 sm:mb-8">
                This usually takes 1-2 business days.
              </p>
              <div className="space-y-3">
                <Button
                  variant="outline"
                  asChild
                  className="w-full border-2 border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white py-3 rounded-xl transition-all duration-300"
                >
                  <Link href="/">Return to Home</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout title="Login" showBack={false}>
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #FBAD3F 0%, #F5A623 50%, #E89A2F 100%)' }}>
        <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm border-0 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <img
                src={tspLogo}
                alt="The Sandwich Project"
                className="h-16 sm:h-20 w-auto"
              />
            </div>
            <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
              Team Login
            </CardTitle>
            <CardDescription className="text-sm sm:text-base text-gray-600">
              Sign in to access the platform
            </CardDescription>
          </CardHeader>

          <CardContent className="px-4 sm:px-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-5">
                {errorMessage && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Email Address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="your.email@example.com"
                          data-testid="input-email"
                          className="border-gray-300 focus:border-amber-500 focus:ring-amber-500 h-11 text-base"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            placeholder="Enter your password"
                            data-testid="input-password"
                            className="border-gray-300 focus:border-amber-500 focus:ring-amber-500 h-11 text-base pr-10"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                            tabIndex={-1}
                          >
                            {showPassword ? (
                              <EyeOff className="w-5 h-5" />
                            ) : (
                              <Eye className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={isLoading}
                  data-testid="button-login"
                  className="w-full text-white font-semibold py-3 h-12 rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-amber-500/30"
                  style={{ background: 'linear-gradient(135deg, #FBAD3F 0%, #E89A2F 100%)' }}
                >
                  {isLoading ? (
                    'Signing in...'
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <LogIn className="w-4 h-4" />
                      Sign In
                    </span>
                  )}
                </Button>

                <div className="text-center space-y-2 pt-2">
                  <Link
                    href="/forgot-password"
                    className="text-sm text-gray-600 hover:text-amber-600 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                  <div className="text-sm text-gray-600">
                    Don't have an account?{' '}
                    <Link
                      href="/signup"
                      className="text-amber-600 hover:text-amber-700 hover:underline font-medium"
                    >
                      Sign up
                    </Link>
                  </div>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AuthPageLayout>
  );
}
