import { describe, it, expect } from '@jest/globals';
import { PERMISSIONS } from '../../shared/auth-utils';
import {
  NAV_CATALOG,
  NAV_SECTION_ORDER,
  getNavigationTabEntries,
  getNavigationTabPermissionKeys,
  isKnownPermissionKey,
  isExternalNavItem,
  getNavHref,
  getDashboardSectionUrl,
  isNavHrefActive,
} from '../../shared/nav-catalog';
import { PERMISSION_GROUPS } from '../../shared/permission-config';

describe('nav catalog', () => {
  it('requires a permissionKey on every nav item', () => {
    const missing = NAV_CATALOG.filter((item) => !item.permissionKey);
    expect(missing).toEqual([]);
  });

  it('requires every permissionKey to exist on PERMISSIONS', () => {
    const unknown = NAV_CATALOG.filter((item) => !isKnownPermissionKey(item.permissionKey));
    expect(unknown.map((item) => `${item.id}:${item.permissionKey}`)).toEqual([]);
  });

  it('does not allow class names or colors in the catalog', () => {
    const forbiddenStyle = /^(bg-|text-|from-|to-)|#[0-9A-Fa-f]{3,8}(?:\b|$)/;
    expect('bg-red-500').toMatch(/^(bg-|text-|from-|to-)/);
    expect('#007E8C').toMatch(/#[0-9A-Fa-f]{3,8}/);

    for (const item of NAV_CATALOG) {
      const values = Object.values(item);
      for (const value of values) {
        if (typeof value !== 'string') continue;
        expect(value).not.toMatch(forbiddenStyle);
      }
    }
  });

  it('marks true external destinations with externalUrl', () => {
    const handbook = NAV_CATALOG.find((item) => item.id === 'volunteer-handbook');
    const signup = NAV_CATALOG.find((item) => item.id === 'signup-genius');
    const sheet = NAV_CATALOG.find((item) => item.id === 'events');
    expect(handbook && isExternalNavItem(handbook)).toBe(true);
    expect(signup && isExternalNavItem(signup)).toBe(true);
    expect(sheet && isExternalNavItem(sheet)).toBe(false);
    expect(handbook && getNavHref(handbook).startsWith('http')).toBe(true);
  });

  it('generates Navigation Tabs from the catalog, not a hand-written list', () => {
    const keys = getNavigationTabPermissionKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain(PERMISSIONS.NAV_COLLECTIONS_LOG);
    expect(keys).toContain(PERMISSIONS.NAV_VOLUNTEER_HANDBOOK);
    expect(keys).toContain(PERMISSIONS.NAV_FLYERS);
    expect(keys).toContain(PERMISSIONS.NAV_AUTO_FORM_FILLER);
    expect(keys).toContain(PERMISSIONS.NAV_MY_ACTIONS);
    expect(new Set(keys).size).toBe(keys.length);

    const labels = getNavigationTabEntries().map((entry) => entry.label);
    expect(labels).toContain('Volunteers Directory');
    expect(labels).toContain('Event Planning');
    expect(labels).not.toContain('Event Admin Overview');
    expect(PERMISSION_GROUPS.NAVIGATION.permissions).toEqual(keys);
  });

  it('places Home, Events, then Communication, and drops in-component event views from the sidebar', () => {
    expect(NAV_SECTION_ORDER.slice(0, 3)).toEqual(['home', 'events', 'communication']);

    const byId = Object.fromEntries(NAV_CATALOG.map((item) => [item.id, item]));
    expect(byId['event-requests']?.group).toBe('events');
    expect(NAV_CATALOG.filter((item) => item.group === 'events')[0]?.id).toBe('event-requests');
    expect(byId['event-ops-dashboard']?.label).toBe('Events Operations Dashboard');
    expect(byId['event-contacts-directory']?.group).toBe('directory');
    expect(byId['event-impact-reports']?.group).toBe('data');
    expect(byId['events']?.liveSheet).toBe(true);
    expect(byId['event-planning']).toBeUndefined();
    expect(byId['admin-overview']).toBeUndefined();
    expect(byId['sandwich-destinations']).toBeUndefined();
  });

  it('is a two-level catalog (no parent/child nesting fields)', () => {
    for (const item of NAV_CATALOG) {
      expect(item).not.toHaveProperty('parentId');
      expect(item).not.toHaveProperty('isSubItem');
    }
  });

  it('has unique ids', () => {
    const ids = NAV_CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('normalizes catalog hrefs into dashboard URLs', () => {
    expect(getDashboardSectionUrl('dashboard')).toBe('/dashboard');
    expect(getDashboardSectionUrl('collections')).toBe('/dashboard?section=collections');
    expect(getDashboardSectionUrl('event-requests?tab=planning')).toBe(
      '/dashboard?section=event-requests&tab=planning',
    );
  });

  it('highlights only the focused destination when activeSection is set', () => {
    const siblings = [
      'event-requests',
      'event-requests?tab=planning',
      'event-requests?tab=admin_overview',
      'chat',
    ];
    const opts = {
      activeSection: 'chat',
      urlSearch: '?section=event-requests&tab=planning',
      siblingHrefs: siblings,
    };
    expect(isNavHrefActive('chat', opts)).toBe(true);
    expect(isNavHrefActive('event-requests', opts)).toBe(false);
    expect(isNavHrefActive('event-requests?tab=planning', opts)).toBe(false);

    const planning = {
      activeSection: 'event-requests?tab=planning',
      urlSearch: '?section=event-requests&tab=admin_overview',
      siblingHrefs: siblings,
    };
    expect(isNavHrefActive('event-requests?tab=planning', planning)).toBe(true);
    expect(isNavHrefActive('event-requests?tab=admin_overview', planning)).toBe(false);
    expect(isNavHrefActive('event-requests', planning)).toBe(false);
  });
});
