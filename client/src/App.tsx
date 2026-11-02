import { Switch, Route } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazy-with-retry';

import { queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { initGA } from '@/lib/analytics';
import { usePageAnalytics } from '@/hooks/usePageAnalytics';

import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LoadingState } from '@/components/ui/loading';
import { ErrorBoundary } from '@/components/error-boundary';
import { ScrollToTop } from '@/components/ScrollToTop';
import { BackToTopButton } from '@/components/back-to-top-button';
import { ChatDockProvider } from '@/components/chat/chat-dock-context';
import { ChatDock } from '@/components/chat/chat-dock';
import { MobileChatBanner } from '@/components/chat/mobile-chat-banner';
import { ReviewerProvider } from '@/contexts/reviewer-context';
import { ReviewerBlockedModal } from '@/components/reviewer-blocked-modal';
import { FloatingViewsProvider } from '@/contexts/floating-views-context';
import { IssueReportProvider } from '@/contexts/issue-report-context';

import Dashboard from '@/pages/dashboard';
import Landing from '@/pages/landing';
import SignupPage from '@/pages/signup';
import LoginPage from '@/pages/login';
import ForgotPassword from '@/pages/forgot-password';
import ResetPassword from '@/pages/reset-password';
import SetPassword from '@/pages/set-password';
import NotFound from '@/pages/not-found';
import Help from '@/pages/Help';
import PendingApproval from '@/pages/pending-approval';
import HoldingZone from '@/pages/HoldingZone';
import YearlyCalendar from '@/pages/yearly-calendar';
import { logger } from '@/lib/logger';

// Mobile app lazy-loaded components
const MobileHome = lazyWithRetry(() => import('@/mobile/pages/mobile-home'));
const MobileCollections = lazyWithRetry(() => import('@/mobile/pages/mobile-collections'));
const MobileCollectionEntry = lazyWithRetry(() => import('@/mobile/pages/mobile-collection-entry'));
const MobileChat = lazyWithRetry(() => import('@/mobile/pages/mobile-chat'));
const MobileChatConversation = lazyWithRetry(() => import('@/mobile/pages/mobile-chat-conversation'));
const MobileChatNew = lazyWithRetry(() => import('@/mobile/pages/mobile-chat-new'));
const MobileEvents = lazyWithRetry(() => import('@/mobile/pages/mobile-events'));
const MobileMore = lazyWithRetry(() => import('@/mobile/pages/mobile-more'));
const MobileHoldingZone = lazyWithRetry(() => import('@/mobile/pages/mobile-holding-zone'));
const MobileHoldingZoneAdd = lazyWithRetry(() => import('@/mobile/pages/mobile-holding-zone-add'));
import { MobileDriverPlanning } from '@/mobile/pages/mobile-driver-planning';
const MobileResources = lazyWithRetry(() => import('@/mobile/pages/mobile-resources'));
const MobileQuickTools = lazyWithRetry(() => import('@/mobile/pages/mobile-quick-tools'));
const MobileEventDetail = lazyWithRetry(() => import('@/mobile/pages/mobile-event-detail'));
const MobileCollectionDetail = lazyWithRetry(() => import('@/mobile/pages/mobile-collection-detail'));
const MobileInbox = lazyWithRetry(() => import('@/mobile/pages/mobile-inbox'));
const MobileProfile = lazyWithRetry(() => import('@/mobile/pages/mobile-profile'));
const MobileNotifications = lazyWithRetry(() => import('@/mobile/pages/mobile-notifications'));

// Mobile layout prompt (shows for mobile users on desktop routes)
const MobileLayoutPrompt = lazyWithRetry(() => import('@/mobile/components/mobile-layout-prompt'));

// Mobile loading component
const MobileLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
    <div className="text-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-primary mx-auto mb-3"></div>
      <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
    </div>
  </div>
);

function Router() {
  const { isAuthenticated, isLoading, error, user } = useAuth();

  // Track page views when routes change
  usePageAnalytics();

  if (isLoading) {
    return (
      <LoadingState
        text="Authenticating..."
        size="lg"
        className="min-h-screen"
      />
    );
  }

  // Enhanced error handling for authentication issues
  if (error && error.message && !error.message.includes('401')) {
    logger.error('[App] Authentication error:', error);
    // For non-401 errors, show error state
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="max-w-md p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 text-center backdrop-blur-sm">
          <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">
            Authentication Error
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
            There was a problem verifying your account. Please try logging in
            again.
          </p>
          <button
            onClick={() => (window.location.href = '/login')}
            className="w-full px-6 py-3 bg-brand-primary hover:bg-brand-primary-dark active:bg-brand-primary-dark text-white font-medium rounded-xl transition-all duration-200 transform hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-brand-primary/20"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Lazy-loaded components
  const SMSOptIn = lazyWithRetry(() => import('./pages/sms-opt-in'));
  const SMSSignup = lazyWithRetry(() => import('./pages/sms-signup'));
  const SMSEvents = lazyWithRetry(() => import('./pages/sms-events'));
  const SMSVerificationDocs = lazyWithRetry(() => import('./pages/sms-verification-docs'));
  const GenerateServiceHours = lazyWithRetry(() => import('./pages/generate-service-hours'));
  const EventImpactReports = lazyWithRetry(() => import('./pages/event-impact-reports'));
  const PhotoScanner = lazyWithRetry(() => import('./pages/photo-scanner'));
  const EmailTemplatesAdmin = lazyWithRetry(() => import('./pages/admin/email-templates'));
  const NotificationsPage = lazyWithRetry(() => import('./pages/notifications'));
  const VolunteerEventHub = lazyWithRetry(() => import('./pages/volunteer-event-hub'));
  const HostResources = lazyWithRetry(() => import('./pages/host-resources'));

  // If not authenticated, show public routes with login option
  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/signup" component={SignupPage} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/set-password" component={SetPassword} />
        <Route path="/sms-opt-in">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSOptIn />
          </Suspense>
        </Route>
        <Route path="/sms-verification-docs">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSVerificationDocs />
          </Suspense>
        </Route>
        <Route path="/sms-verification-doc">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSVerificationDocs />
          </Suspense>
        </Route>
        <Route path="/sms-signup">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSSignup />
          </Suspense>
        </Route>
        <Route path="/sms-events">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSEvents />
          </Suspense>
        </Route>
        <Route path="/login" component={LoginPage} />
        <Route path="/">
          {() => {
            // Redirect unauthenticated users directly to login page
            window.location.href = '/login';
            return (
              <LoadingState
                text="Redirecting to login..."
                size="lg"
                className="min-h-screen"
              />
            );
          }}
        </Route>
        <Route>
          {() => {
            // Default fallback - redirect to login page
            window.location.href = '/login';
            return (
              <LoadingState
                text="Redirecting to login..."
                size="lg"
                className="min-h-screen"
              />
            );
          }}
        </Route>
      </Switch>
    );
  }

  // Check if user is authenticated but account is inactive (pending approval)
  if (isAuthenticated && user && !user.isActive) {
    return (
      <Switch>
        <Route path="/pending-approval">
          <PendingApproval />
        </Route>
        <Route>
          {() => {
            // Redirect all other routes to pending approval page
            window.location.href = '/pending-approval';
            return (
              <LoadingState
                text="Redirecting..."
                size="lg"
                className="min-h-screen"
              />
            );
          }}
        </Route>
      </Switch>
    );
  }

  return (
    <>
      <ScrollToTop />
      {/* Mobile layout prompt - shows for mobile users on desktop routes */}
      <Suspense fallback={null}>
        <MobileLayoutPrompt />
      </Suspense>
      <Switch>
        {/* Mobile App Routes - /m/* */}
        <Route path="/m" nest>
          <Switch>
            <Route path="/collections">
              <Suspense fallback={<MobileLoader />}>
                <MobileCollections />
              </Suspense>
            </Route>
            <Route path="/collections/new">
              <Suspense fallback={<MobileLoader />}>
                <MobileCollectionEntry />
              </Suspense>
            </Route>
            <Route path="/photo-scanner">
              <Suspense fallback={<MobileLoader />}>
                <PhotoScanner />
              </Suspense>
            </Route>
            <Route path="/collections/:id">
              <Suspense fallback={<MobileLoader />}>
                <MobileCollectionDetail />
              </Suspense>
            </Route>
            <Route path="/holding-zone">
              <Suspense fallback={<MobileLoader />}>
                <MobileHoldingZone />
              </Suspense>
            </Route>
            <Route path="/holding-zone/new">
              <Suspense fallback={<MobileLoader />}>
                <MobileHoldingZoneAdd />
              </Suspense>
            </Route>
            <Route path="/holding-zone/:id/edit">
              <Suspense fallback={<MobileLoader />}>
                <MobileHoldingZoneAdd />
              </Suspense>
            </Route>
            <Route path="/driver-planning">
              <MobileDriverPlanning />
            </Route>
            <Route path="/resources">
              <Suspense fallback={<MobileLoader />}>
                <MobileResources />
              </Suspense>
            </Route>
            <Route path="/quick-tools">
              <Suspense fallback={<MobileLoader />}>
                <MobileQuickTools />
              </Suspense>
            </Route>
            <Route path="/chat">
              <Suspense fallback={<MobileLoader />}>
                <MobileChat />
              </Suspense>
            </Route>
            <Route path="/chat/new">
              <Suspense fallback={<MobileLoader />}>
                <MobileChatNew />
              </Suspense>
            </Route>
            <Route path="/chat/dm/:channelId">
              <Suspense fallback={<MobileLoader />}>
                <MobileChatConversation />
              </Suspense>
            </Route>
            <Route path="/chat/:channel">
              <Suspense fallback={<MobileLoader />}>
                <MobileChat />
              </Suspense>
            </Route>
            <Route path="/events">
              <Suspense fallback={<MobileLoader />}>
                <MobileEvents />
              </Suspense>
            </Route>
            <Route path="/events/:id">
              <Suspense fallback={<MobileLoader />}>
                <MobileEventDetail />
              </Suspense>
            </Route>
            <Route path="/more">
              <Suspense fallback={<MobileLoader />}>
                <MobileMore />
              </Suspense>
            </Route>
            <Route path="/inbox">
              <Suspense fallback={<MobileLoader />}>
                <MobileInbox />
              </Suspense>
            </Route>
            <Route path="/profile">
              <Suspense fallback={<MobileLoader />}>
                <MobileProfile />
              </Suspense>
            </Route>
            <Route path="/notifications">
              <Suspense fallback={<MobileLoader />}>
                <MobileNotifications />
              </Suspense>
            </Route>
            {/* Mobile home should be evaluated after specific routes */}
            <Route path="/">
              <Suspense fallback={<MobileLoader />}>
                <MobileHome />
              </Suspense>
            </Route>
            {/* Fallback to mobile home for unmatched mobile routes */}
            <Route>
              <Suspense fallback={<MobileLoader />}>
                <MobileHome />
              </Suspense>
            </Route>
          </Switch>
        </Route>

        {/* Desktop App Routes */}
        <Route path="/messages">
          {() => <Dashboard initialSection="messages" />}
        </Route>
        <Route path="/inbox">{() => <Dashboard initialSection="inbox" />}</Route>
        <Route path="/notifications">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <NotificationsPage />
          </Suspense>
        </Route>
        <Route path="/suggestions">
          {() => <Dashboard initialSection="suggestions" />}
        </Route>
        <Route path="/collections">
          {() => <Dashboard initialSection="collections" />}
        </Route>
        <Route path="/photo-scanner">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <PhotoScanner />
          </Suspense>
        </Route>
        <Route path="/google-sheets">
          {() => <Dashboard initialSection="google-sheets" />}
        </Route>
        <Route path="/planning-sheet-proposals">
          {() => <Dashboard initialSection="planning-sheet-proposals" />}
        </Route>
        <Route path="/meetings">
          {() => <Dashboard initialSection="meetings" />}
        </Route>
        <Route path="/projects">
          {() => <Dashboard initialSection="projects" />}
        </Route>
        <Route path="/projects/:id">
          {(params) => <Dashboard initialSection={`project-${params.id}`} />}
        </Route>
        <Route path="/weekly-monitoring">
          {() => <Dashboard initialSection="weekly-monitoring" />}
        </Route>
        <Route path="/wishlist">
          {() => <Dashboard initialSection="wishlist" />}
        </Route>
        <Route path="/team-board">
          <HoldingZone />
        </Route>
        <Route path="/yearly-calendar">
          <YearlyCalendar />
        </Route>
        <Route path="/quick-sms-links">
          {() => <Dashboard initialSection="quick-sms-links" />}
        </Route>
        <Route path="/directory">
          {() => <Dashboard initialSection="directory" />}
        </Route>
        <Route path="/event-contacts-directory">
          {() => <Dashboard initialSection="event-contacts-directory" />}
        </Route>
        <Route path="/event-contact/:id">
          {() => <Dashboard initialSection="event-contact-detail" />}
        </Route>
        <Route path="/cooler-tracking">
          {() => <Dashboard initialSection="cooler-tracking" />}
        </Route>
        <Route path="/important-links">
          {() => <Dashboard initialSection="important-links" />}
        </Route>
        <Route path="/event-requests">
          {() => <Dashboard initialSection="event-requests" />}
        </Route>
        <Route path="/event-map">
          {() => <Dashboard initialSection="event-map" />}
        </Route>
        <Route path="/recipient-map">
          {() => <Dashboard initialSection="route-map" />}
        </Route>
        <Route path="/driver-planning">
          {() => <Dashboard initialSection="driver-planning" />}
        </Route>
        <Route path="/volunteer-hub">
          {() => <Dashboard initialSection="volunteer-hub" />}
        </Route>
        <Route path="/host-resources">
          {() => <Dashboard initialSection="host-resources" />}
        </Route>
        <Route path="/event-reminders">
          {() => <Dashboard initialSection="event-reminders" />}
        </Route>
        <Route path="/event-impact-reports">
          {() => <Dashboard initialSection="event-impact-reports" />}
        </Route>
        <Route path="/expenses">
          {() => <Dashboard initialSection="expenses" />}
        </Route>
        <Route path="/generate-service-hours">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <GenerateServiceHours />
          </Suspense>
        </Route>
        <Route path="/admin/email-templates">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <EmailTemplatesAdmin />
          </Suspense>
        </Route>
        <Route path="/historical-import">
          {() => <Dashboard initialSection="historical-import" />}
        </Route>
        <Route path="/route-map">
          {() => <Dashboard initialSection="route-map" />}
        </Route>
        <Route path="/sms-opt-in">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSOptIn />
          </Suspense>
        </Route>
        <Route path="/sms-verification-docs">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSVerificationDocs />
          </Suspense>
        </Route>
        <Route path="/sms-verification-doc">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSVerificationDocs />
          </Suspense>
        </Route>
        <Route path="/sms-signup">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSSignup />
          </Suspense>
        </Route>
        <Route path="/sms-events">
          <Suspense fallback={<LoadingState text="Loading..." size="lg" className="min-h-screen" />}>
            <SMSEvents />
          </Suspense>
        </Route>
        <Route path="/login">
          {() => {
            // Authenticated users at /login should go to home
            window.location.href = '/';
            return <LoadingState text="Redirecting..." size="lg" className="min-h-screen" />;
          }}
        </Route>
        <Route path="/profile">
          {() => <Dashboard initialSection="profile" />}
        </Route>
        <Route path="/help">
          {() => <Dashboard initialSection="help" />}
        </Route>
        <Route path="/dashboard">{() => <Dashboard />}</Route>
        <Route path="/dashboard/:section">
          {(params) => <Dashboard initialSection={params.section} />}
        </Route>
        <Route path="/">{() => <Dashboard />}</Route>
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  // Initialize Google Analytics when app loads
  useEffect(() => {
    // Verify required environment variable is present
    if (!import.meta.env.VITE_GA_MEASUREMENT_ID) {
      logger.warn(
        'Missing required Google Analytics key: VITE_GA_MEASUREMENT_ID'
      );
    } else {
      initGA();
    }
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ReviewerProvider>
          <IssueReportProvider>
          <ChatDockProvider>
            <FloatingViewsProvider>
                <TooltipProvider>
                <Toaster />
                <Router />
                <ChatDock />
                <MobileChatBanner />
                <ReviewerBlockedModal />
                <BackToTopButton />
              </TooltipProvider>
            </FloatingViewsProvider>
          </ChatDockProvider>
          </IssueReportProvider>
        </ReviewerProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
