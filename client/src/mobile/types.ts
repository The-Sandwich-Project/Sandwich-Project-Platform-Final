// Mobile app types and configuration

export interface MobileNavItem {
  id: string;
  label: string;
  icon: string; // Lucide icon name
  href: string;
  badge?: number;
}

export interface MobileRoute {
  path: string;
  component: React.ComponentType;
  title: string;
  showBack?: boolean;
  showNav?: boolean;
}

// Bottom navigation items - keep to 4-5 max for thumb reach
export const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { id: 'home', label: 'Home', icon: 'Home', href: '/' },
  { id: 'events', label: 'Events', icon: 'Calendar', href: '/events' },
  // Chat took this slot from Drivers (driver planning now lives under More)
  { id: 'chat', label: 'Chat', icon: 'MessageCircle', href: '/chat' },
  { id: 'collections', label: 'Log', icon: 'ClipboardList', href: '/collections' },
  { id: 'more', label: 'More', icon: 'Menu', href: '/more' },
];

// Quick actions for the home screen
export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  href: string;
  color: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'log-collection',
    label: 'Log Collection',
    description: 'Record a sandwich pickup',
    icon: 'Plus',
    href: '/collections/new',
    color: 'bg-green-500',
  },
  {
    id: 'add-task',
    label: 'Add Task',
    description: 'Quick task to holding zone',
    icon: 'StickyNote',
    href: '/holding-zone/new',
    color: 'bg-amber-500',
  },
  {
    id: 'send-message',
    label: 'Send Message',
    description: 'Quick team message',
    icon: 'Send',
    href: '/chat/new',
    color: 'bg-purple-500',
  },
  {
    id: 'driver-planning',
    label: 'Driver Planning',
    description: 'Assign drivers to events',
    icon: 'Truck',
    href: '/driver-planning',
    color: 'bg-blue-500',
  },
];
