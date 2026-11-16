import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Send,
  ChevronRight,
  Sandwich,
  Users,
  TrendingUp,
  Clock,
  StickyNote,
  Truck,
  Route,
  Monitor,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { QUICK_ACTIONS } from '../types';

import { usePageSession } from '@/hooks/usePageSession';
const MOBILE_PREFERENCE_KEY = 'tsp-mobile-layout-preference';

// Icon mapping for quick actions
const actionIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Plus,
  Send,
  StickyNote,
  Truck,
};

/**
 * Mobile home screen - quick access dashboard
 */
export function MobileHome() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Home',
  });

  const { user } = useAuth();
  const [, navigate] = useLocation();

  // Fetch today's stats
  const { data: stats } = useQuery({
    queryKey: ['/api/dashboard/stats'],
    staleTime: 60000,
  });

  // Fetch recent activity
  const { data: recentActivity } = useQuery({
    queryKey: ['/api/activity/recent'],
    staleTime: 30000,
  });

  const greeting = getGreeting();

  const handleSwitchToDesktop = () => {
    // Clear mobile preference entirely (mobile layout is deprecated)
    localStorage.removeItem(MOBILE_PREFERENCE_KEY);
    // Navigate to desktop dashboard
    window.location.href = '/dashboard';
  };

  return (
    <MobileShell title="Sandwich Project" showNav>
      <div className="p-4 space-y-6">
        {/* Desktop View Banner */}
        <button
          onClick={handleSwitchToDesktop}
          className={cn(
            "w-full flex items-center gap-3 p-3 rounded-xl",
            "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800",
            "active:bg-blue-100 dark:active:bg-blue-900/30 transition-colors"
          )}
        >
          <Monitor className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Prefer the desktop view?
            </div>
            <div className="text-xs text-blue-700 dark:text-blue-300">
              Tap here to switch
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-blue-500" />
        </button>

        {/* Welcome section */}
        <section className="bg-gradient-to-br from-brand-primary to-brand-primary-dark rounded-2xl p-5 text-white shadow-lg">
          <p className="text-white/80 text-sm">{greeting}</p>
          <h2 className="text-xl font-bold mt-1">
            {user?.displayName || user?.firstName || 'Volunteer'}
          </h2>
          <p className="text-white/70 text-sm mt-2">
            Ready to make a difference today?
          </p>
        </section>

        {/* Quick Stats */}
        <section>
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            This Week
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              icon={Sandwich}
              label="Sandwiches"
              value={stats?.weeklyTotal || 0}
              color="bg-amber-500"
            />
            <StatCard
              icon={Users}
              label="Recipients"
              value={stats?.recipientsServed || 0}
              color="bg-blue-500"
            />
            <StatCard
              icon={Route}
              label="Deliveries"
              value={stats?.deliveries || 0}
              color="bg-green-500"
            />
            <StatCard
              icon={TrendingUp}
              label="Events"
              value={stats?.eventsThisWeek || 0}
              color="bg-purple-500"
            />
          </div>
        </section>

        {/* Quick Actions */}
        <section>
          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_ACTIONS.map((action) => {
              const Icon = actionIconMap[action.icon];
              return (
                <button
                  key={action.id}
                  onClick={() => navigate(action.href)}
                  className={cn(
                    "flex flex-col items-start p-4 rounded-xl",
                    "bg-white dark:bg-slate-800 shadow-sm",
                    "border border-slate-200 dark:border-slate-700",
                    "active:scale-[0.98] transition-transform",
                    "text-left"
                  )}
                >
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mb-3", action.color)}>
                    {Icon && <Icon className="w-5 h-5 text-white" />}
                  </div>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {action.label}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {action.description}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Recent Activity */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Recent Activity
            </h3>
            <button
              onClick={() => navigate('/activity')}
              className="text-sm text-brand-primary font-medium flex items-center"
            >
              See all
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {recentActivity?.slice(0, 3).map((activity: any, i: number) => (
              <ActivityItem key={i} activity={activity} />
            )) || (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recent activity</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </MobileShell>
  );
}

// Helper components
function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", color)}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

function ActivityItem({ activity }: { activity: any }) {
  return (
    <div className="p-3 flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 dark:text-slate-100 truncate">
          {activity.description || 'Activity logged'}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {activity.timestamp || 'Just now'}
        </p>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

export default MobileHome;
