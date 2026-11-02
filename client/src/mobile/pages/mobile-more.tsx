import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import {
  User,
  HelpCircle,
  LogOut,
  ChevronRight,
  FileText,
  Bell,
  Moon,
  Sun,
  ExternalLink,
  Monitor,
  FolderOpen,
  Wrench,
  Inbox,
  StickyNote,
  Truck,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/theme-provider';

const MOBILE_PREFERENCE_KEY = 'tsp-mobile-layout-preference';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  onClick?: () => void;
  external?: boolean;
  badge?: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

/**
 * Mobile "More" screen - additional navigation options
 */
export function MobileMore() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const { theme, setTheme } = useTheme();

  const handleSwitchToDesktop = () => {
    // Clear mobile preference
    localStorage.setItem(MOBILE_PREFERENCE_KEY, 'desktop');
    // Navigate to desktop view
    window.location.href = '/';
  };

  const menuSections: MenuSection[] = [
    {
      title: 'Events',
      items: [
        // Moved here from the bottom nav to make room for Chat
        { id: 'drivers', label: 'Driver Planning', icon: Truck, href: '/driver-planning' },
      ],
    },
    {
      title: 'Communication',
      items: [
        { id: 'holding-zone', label: 'Holding Zone', icon: StickyNote, href: '/holding-zone' },
        { id: 'inbox', label: 'Inbox', icon: Inbox, href: '/inbox' },
      ],
    },
    {
      title: 'Resources',
      items: [
        { id: 'resources', label: 'Resources', icon: FolderOpen, href: '/resources' },
        { id: 'quick-tools', label: 'Quick Tools', icon: Wrench, href: '/quick-tools' },
        { id: 'documents', label: 'Documents', icon: FileText, href: '/resources', external: true },
      ],
    },
    {
      title: 'Account',
      items: [
        { id: 'profile', label: 'My Profile', icon: User, href: '/profile' },
        { id: 'notifications', label: 'Notifications', icon: Bell, href: '/notifications' },
      ],
    },
    {
      title: 'Support',
      items: [
        { id: 'help', label: 'Help & FAQ', icon: HelpCircle, href: '/help', external: true },
      ],
    },
  ];

  const handleLogout = async () => {
    try {
      await logout();
      // If you need to call the server to invalidate the session, uncomment the next line:
      // await fetch('/api/logout', { method: 'POST' });
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <MobileShell title="More" showNav>
      <div className="p-4 space-y-6">
        {/* User profile card */}
        <button
          onClick={() => navigate('/profile')}
          className={cn(
            "w-full flex items-center gap-4 p-4",
            "bg-white dark:bg-slate-800 rounded-xl",
            "border border-slate-200 dark:border-slate-700 shadow-sm",
            "active:scale-[0.99] transition-transform text-left"
          )}
        >
          {/* Avatar */}
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-dark flex items-center justify-center text-white text-xl font-bold">
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {user?.name || 'User'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
              {user?.email || 'No email'}
            </p>
            <p className="text-xs text-brand-primary mt-0.5 capitalize">
              {user?.role || 'Volunteer'}
            </p>
          </div>

          <ChevronRight className="w-5 h-5 text-slate-400" />
        </button>

        {/* Theme toggle */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <button
            onClick={toggleTheme}
            className={cn(
              "w-full flex items-center justify-between p-4",
              "active:bg-slate-50 dark:active:bg-slate-700",
              "transition-colors"
            )}
          >
            <div className="flex items-center gap-3">
              {theme === 'dark' ? (
                <Moon className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              ) : (
                <Sun className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              )}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                Dark Mode
              </span>
            </div>
            <div
              className={cn(
                "w-12 h-7 rounded-full p-1 transition-colors",
                theme === 'dark' ? "bg-brand-primary" : "bg-slate-200"
              )}
            >
              <div
                className={cn(
                  "w-5 h-5 rounded-full bg-white shadow-sm transition-transform",
                  theme === 'dark' ? "translate-x-5" : "translate-x-0"
                )}
              />
            </div>
          </button>
        </div>

        {/* Switch to Desktop - Prominent placement */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border-2 border-blue-200 dark:border-blue-800 overflow-hidden">
          <button
            onClick={handleSwitchToDesktop}
            className={cn(
              "w-full flex items-center gap-3 p-4",
              "active:bg-blue-100 dark:active:bg-blue-900/30",
              "transition-colors text-left"
            )}
          >
            <div className="p-2 bg-blue-500 dark:bg-blue-600 rounded-lg">
              <Monitor className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Switch to Desktop View
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">
                Use the full desktop interface
              </div>
            </div>
            <ExternalLink className="w-5 h-5 text-blue-500 dark:text-blue-400" />
          </button>
        </div>

        {/* Menu sections */}
        {menuSections.map((section) => (
          <div key={section.title}>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 px-1">
              {section.title}
            </h3>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.onClick) {
                        item.onClick();
                      } else if (item.href) {
                        if (item.external) {
                          window.location.href = item.href;
                        } else {
                          navigate(item.href);
                        }
                      }
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 p-4",
                      "active:bg-slate-50 dark:active:bg-slate-700",
                      "transition-colors text-left"
                    )}
                  >
                    <Icon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                    <span className="flex-1 font-medium text-slate-900 dark:text-slate-100">
                      {item.label}
                    </span>
                    {item.badge && (
                      <span className="text-xs bg-brand-primary/10 text-brand-primary px-2 py-0.5 rounded-full">
                        {item.badge}
                      </span>
                    )}
                    {item.external ? (
                      <ExternalLink className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className={cn(
            "w-full flex items-center justify-center gap-2 p-4",
            "bg-red-50 dark:bg-red-900/20 rounded-xl",
            "text-red-600 dark:text-red-400 font-medium",
            "active:bg-red-100 dark:active:bg-red-900/30",
            "transition-colors"
          )}
        >
          <LogOut className="w-5 h-5" />
          <span>Log Out</span>
        </button>

        {/* App version */}
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Sandwich Project Mobile v1.0.0
        </p>
      </div>
    </MobileShell>
  );
}

export default MobileMore;
