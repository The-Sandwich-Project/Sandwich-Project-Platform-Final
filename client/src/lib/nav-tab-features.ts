import { getNavigationTabEntries } from '@shared/nav-catalog';
import { NAV_ITEMS } from '@/nav.config';
import { PERMISSIONS } from '@shared/auth-utils';
import type { LucideIcon } from 'lucide-react';
import { FileInput, LayoutDashboard } from 'lucide-react';

const GHOST_ICONS: Record<string, LucideIcon> = {
  [PERMISSIONS.NAV_AUTO_FORM_FILLER]: FileInput,
  [PERMISSIONS.NAV_MY_ACTIONS]: LayoutDashboard,
};

export function getNavigationTabFeatures(): Array<{
  permission: string;
  label: string;
  icon: LucideIcon;
}> {
  const iconByPermission = new Map<string, LucideIcon>();
  for (const item of NAV_ITEMS) {
    if (item.icon && !iconByPermission.has(item.permissionKey)) {
      iconByPermission.set(item.permissionKey, item.icon);
    }
  }
  for (const [permission, icon] of Object.entries(GHOST_ICONS)) {
    if (!iconByPermission.has(permission)) {
      iconByPermission.set(permission, icon);
    }
  }

  return getNavigationTabEntries().map((entry) => ({
    permission: entry.permissionKey,
    label: entry.label,
    icon: iconByPermission.get(entry.permissionKey) as LucideIcon,
  }));
}
