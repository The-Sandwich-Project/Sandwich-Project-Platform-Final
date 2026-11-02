import { useLocation } from 'wouter';
import {
  Home,
  ClipboardList,
  Calendar,
  Menu,
  Truck,
  MessageCircle,
} from 'lucide-react';
import { useStreamChatUnread } from '@/hooks/useStreamChatUnread';
import { cn } from '@/lib/utils';
import { MOBILE_NAV_ITEMS } from '../types';

// Icon mapping
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Home,
  ClipboardList,
  Calendar,
  Menu,
  Truck,
  MessageCircle,
};

/**
 * Mobile bottom navigation bar
 * Fixed to bottom with safe area support
 */
export function MobileBottomNav() {
  const [location, navigate] = useLocation();
  const { dmsUnread } = useStreamChatUnread();

  // wouter nest trims the base path (/m); normalize to work with either form
  const normalizedLocation = location.replace(/^\/m(\/|$)/, '/');

  const isActive = (href: string) => {
    if (href === '/') {
      return normalizedLocation === '/' || normalizedLocation === '';
    }
    return normalizedLocation.startsWith(href);
  };

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50",
        "bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700",
        "shadow-lg"
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-around h-16">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = iconMap[item.icon];
          if (item.id === 'chat') item = { ...item, badge: dmsUnread };
          const active = isActive(item.href);

          return (
            <button
              key={item.id}
              onClick={() => {
                console.log('[MobileNav] Clicked:', item.id, 'navigating to:', item.href);
                navigate(item.href);
              }}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full",
                "transition-colors duration-150",
                "active:bg-slate-100 dark:active:bg-slate-700",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-inset"
              )}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <div className="relative">
                {Icon && (
                  <Icon
                    className={cn(
                      "w-6 h-6 transition-colors",
                      active
                        ? "text-brand-primary"
                        : "text-slate-500 dark:text-slate-400"
                    )}
                  />
                )}
                {/* Badge for notifications */}
                {item.badge && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-xs font-medium rounded-full px-1">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-xs mt-1 font-medium transition-colors",
                  active
                    ? "text-brand-primary"
                    : "text-slate-500 dark:text-slate-400"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
