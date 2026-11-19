import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, Shield, FileText, Trophy, Database, MessageSquare, HandHeart, AlertTriangle, Eye } from 'lucide-react';
import { EventRequestAuditLog } from '@/components/event-request-audit-log';
import { ComprehensiveAuditLog } from '@/components/comprehensive-audit-log';
import { ClientErrorLog } from '@/components/client-error-log';
import { ApplicationErrorLog } from '@/components/application-error-log';
import { UserIssueReportsLog } from '@/components/user-issue-reports-log';
import { SystemHealthPanel } from '@/components/system-health-panel';
import { DashboardDocumentSelector } from '@/components/dashboard-document-selector';
import AdminOnboardingKudos from '@/components/admin-onboarding-kudos';
import { TollFreeVerificationPanel } from '@/components/toll-free-verification-panel';
import { SMSTestPanel } from '@/components/sms-test-panel';
import { ChatSyncPanel } from '@/components/chat-sync-panel';
import VolunteerSignupAdmin from '@/components/volunteer-signup-admin';
import { adminDocuments } from '@/lib/admin-documents';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import type { UserForPermissions } from '@shared/types';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { useEffect } from 'react';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';
import { PermissionDenied } from '@/components/permission-denied';
import { AdminNavUserViewConfig } from '@/components/admin-nav-user-view-config';

export default function AdminSettings() {
  const { user, isLoading } = useAuth();
  const { trackView, trackClick } = useActivityTracker();

  useEffect(() => {
    if (user && hasPermission(user as UserForPermissions, PERMISSIONS.ADMIN_PANEL_ACCESS)) {
      trackView(
        'Admin',
        'Admin',
        'Admin Settings',
        'User accessed admin settings page'
      );
    }
  }, [user, trackView]);

  // Check for admin panel access permission
  if (!isLoading && (!user || !hasPermission(user as UserForPermissions, PERMISSIONS.ADMIN_PANEL_ACCESS))) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white p-8">
        <div className="w-full max-w-md">
          <PermissionDenied
            action="access admin settings"
            requiredPermission="ADMIN_PANEL_ACCESS"
            variant="card"
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading admin settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-7xl mx-auto">
        <PageBreadcrumbs segments={[
          { label: 'Administration' },
          { label: 'Admin Panel' }
        ]} />

        <div className="mb-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-gradient-to-br from-brand-primary to-brand-primary-dark rounded-xl shadow-[0_4px_12px_rgba(35,99,131,0.15),0_2px_4px_rgba(35,99,131,0.1)] hover:shadow-[0_8px_24px_rgba(35,99,131,0.2),0_4px_8px_rgba(35,99,131,0.15)] transition-all duration-300 ease-in-out">
              <Settings className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                Admin Settings
              </h1>
              <p className="text-lg text-gray-600">
                Manage system configuration and audit logs
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="entity-audit-log" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 h-auto p-1 mb-8 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.08)] rounded-lg bg-white">
            <TabsTrigger
              value="entity-audit-log"
              className="flex items-center gap-2 py-4 px-6 rounded-lg font-medium text-brand-primary hover:bg-brand-primary/5 transition-all duration-200 ease-in-out data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-primary data-[state=active]:to-brand-primary-dark data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(35,99,131,0.25)]"
              data-testid="tab-entity-audit-log"
              onClick={() => trackClick('Entity Audit Log Tab', 'Admin', 'Tab Navigation', 'Switched to entity audit log tab')}
            >
              <Database className="h-4 w-4" />
              Entity Audit Log
            </TabsTrigger>
            <TabsTrigger
              value="audit-log"
              className="flex items-center gap-2 py-4 px-6 rounded-lg font-medium text-brand-primary hover:bg-brand-primary/5 transition-all duration-200 ease-in-out data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-primary data-[state=active]:to-brand-primary-dark data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(35,99,131,0.25)]"
              data-testid="tab-audit-log"
              onClick={() => trackClick('Event Request Audit Log Tab', 'Admin', 'Tab Navigation', 'Switched to event request audit log tab')}
            >
              <Shield className="h-4 w-4" />
              Event Requests
            </TabsTrigger>
            <TabsTrigger
              value="error-logs"
              className="flex items-center gap-2 py-4 px-6 rounded-lg font-medium text-brand-primary hover:bg-brand-primary/5 transition-all duration-200 ease-in-out data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-primary data-[state=active]:to-brand-primary-dark data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(35,99,131,0.25)]"
              data-testid="tab-error-logs"
              onClick={() => trackClick('Error Logs Tab', 'Admin', 'Tab Navigation', 'Switched to error logs tab')}
            >
              <AlertTriangle className="h-4 w-4" />
              Error Logs
            </TabsTrigger>
            <TabsTrigger
              value="dashboard-config"
              className="flex items-center gap-2 py-4 px-6 rounded-lg font-medium text-brand-primary hover:bg-brand-primary/5 transition-all duration-200 ease-in-out data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-primary data-[state=active]:to-brand-primary-dark data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(35,99,131,0.25)]"
              data-testid="tab-dashboard-config"
              onClick={() => trackClick('Dashboard Config Tab', 'Admin', 'Tab Navigation', 'Switched to dashboard config tab')}
            >
              <FileText className="h-4 w-4" />
              Dashboard Config
            </TabsTrigger>
            <TabsTrigger
              value="onboarding-kudos"
              className="flex items-center gap-2 py-4 px-6 rounded-lg font-medium text-brand-primary hover:bg-brand-primary/5 transition-all duration-200 ease-in-out data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-primary data-[state=active]:to-brand-primary-dark data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(35,99,131,0.25)]"
              data-testid="tab-onboarding-kudos"
              onClick={() => trackClick('Onboarding Kudos Tab', 'Admin', 'Tab Navigation', 'Switched to onboarding kudos tab')}
            >
              <Trophy className="h-4 w-4" />
              Onboarding Kudos
            </TabsTrigger>
            <TabsTrigger
              value="communications"
              className="flex items-center gap-2 py-4 px-6 rounded-lg font-medium text-brand-primary hover:bg-brand-primary/5 transition-all duration-200 ease-in-out data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-primary data-[state=active]:to-brand-primary-dark data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(35,99,131,0.25)]"
              data-testid="tab-communications"
              onClick={() => trackClick('Communications Tab', 'Admin', 'Tab Navigation', 'Switched to communications tab')}
            >
              <MessageSquare className="h-4 w-4" />
              Communications
            </TabsTrigger>
            <TabsTrigger
              value="volunteer-signups"
              className="flex items-center gap-2 py-4 px-6 rounded-lg font-medium text-brand-primary hover:bg-brand-primary/5 transition-all duration-200 ease-in-out data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-primary data-[state=active]:to-brand-primary-dark data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(35,99,131,0.25)]"
              data-testid="tab-volunteer-signups"
              onClick={() => trackClick('Volunteer Signups Tab', 'Admin', 'Tab Navigation', 'Switched to volunteer signups tab')}
            >
              <HandHeart className="h-4 w-4" />
              Volunteer Signups
            </TabsTrigger>
            <TabsTrigger
              value="nav-user-view"
              className="flex items-center gap-2 py-4 px-6 rounded-lg font-medium text-brand-primary hover:bg-brand-primary/5 transition-all duration-200 ease-in-out data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-primary data-[state=active]:to-brand-primary-dark data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(35,99,131,0.25)]"
              data-testid="tab-nav-user-view"
              onClick={() => trackClick('Nav User View Tab', 'Admin', 'Tab Navigation', 'Switched to nav user view tab')}
            >
              <Eye className="h-4 w-4" />
              Nav User View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="entity-audit-log" className="space-y-6">
            <ComprehensiveAuditLog />
          </TabsContent>

          <TabsContent value="audit-log" className="space-y-6">
            <EventRequestAuditLog showFilters data-testid="audit-log" />
          </TabsContent>

          <TabsContent value="error-logs" className="space-y-6">
            <SystemHealthPanel />
            <UserIssueReportsLog />
            <ApplicationErrorLog />
            <ClientErrorLog />
          </TabsContent>

          <TabsContent value="dashboard-config" className="space-y-8">
            <DashboardDocumentSelector adminDocuments={adminDocuments} />
          </TabsContent>

          <TabsContent value="onboarding-kudos" className="space-y-8">
            <AdminOnboardingKudos />
          </TabsContent>

          <TabsContent value="communications" className="space-y-8">
            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-4">SMS Settings</h2>
                <div className="grid gap-8 lg:grid-cols-2">
                  <SMSTestPanel />
                  <TollFreeVerificationPanel />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-4">Team Chat</h2>
                <div className="grid gap-8 lg:grid-cols-2">
                  <ChatSyncPanel />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="volunteer-signups" className="space-y-8">
            <VolunteerSignupAdmin />
          </TabsContent>

          <TabsContent value="nav-user-view" className="space-y-8">
            <AdminNavUserViewConfig />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
