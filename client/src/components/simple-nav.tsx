import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@shared/unified-auth-utils';
import type { UserForPermissions } from '@shared/types';
import { useMessaging } from '@/hooks/useMessaging';
import { useStreamChatUnread } from '@/hooks/useStreamChatUnread';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { NavItem } from '@/nav.types';
import { NAV_ITEMS } from '@/nav.config';
import { logger } from '@/lib/logger';
import { ChevronDown, ChevronRight, ExternalLink, ChevronsUp, ChevronsDown } from 'lucide-react';
import { OnboardingTooltip } from '@/components/ui/onboarding-tooltip';
import { useOnboarding, OnboardingStep } from '@/hooks/useOnboarding';
import { useNavViewModeOptional } from '@/contexts/nav-view-mode-context';
import { buildNavSectionGroups, NAV_GROUP_LABELS } from '@/lib/nav-sidebar-layout';
import {
  getNavHref,
  isExternalNavItem,
  isNavCatalogItemVisible,
  isNavHrefActive,
} from '@shared/nav-catalog';

export default function SimpleNav({
  navigationItems = NAV_ITEMS,
  onSectionChange,
  activeSection,
  isCollapsed = false,
}: {
  navigationItems?: NavItem[];
  /** Catalog href, including query strings (e.g. chat?tab=dms). Use getDashboardSectionUrl to navigate. */
  onSectionChange: (section: string) => void;
  activeSection?: string;
  isCollapsed?: boolean;
}) {
  try {
    const { user } = useAuth();
    const navViewMode = useNavViewModeOptional();
    const { unreadCounts } = useMessaging();
    const { dmsUnread, groupsUnread, roomsUnread } = useStreamChatUnread();

    const COLLAPSED_SECTIONS_KEY = 'sidebar.collapsedSections.v2';

    const loadPersistedSet = (key: string, fallback: string[]): Set<string> => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return new Set(fallback);
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set(fallback);
        return new Set(parsed.filter((v): v is string => typeof v === 'string'));
      } catch {
        return new Set(fallback);
      }
    };

    const persistSet = (key: string, value: Set<string>) => {
      try {
        localStorage.setItem(key, JSON.stringify(Array.from(value)));
      } catch {
        // localStorage may be disabled / over quota
      }
    };

    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
      () => loadPersistedSet(COLLAPSED_SECTIONS_KEY, []),
    );

    useEffect(() => {
      persistSet(COLLAPSED_SECTIONS_KEY, collapsedSections);
    }, [collapsedSections]);

    const { data: gmailUnreadCount = 0 } = useQuery({
      queryKey: ['/api/emails/unread-count', (user as { id?: string } | null)?.id || 'no-user'],
      queryFn: async () => {
        if (!(user as { id?: string } | null)?.id) return 0;
        try {
          const response = await apiRequest('GET', '/api/emails/unread-count');
          return typeof response?.count === 'number' ? response.count : 0;
        } catch (error) {
          logger.warn('Gmail unread count fetch failed:', error);
          return 0;
        }
      },
      enabled: !!(user as { id?: string } | null)?.id,
      refetchInterval: 2 * 60 * 1000,
      retry: false,
    });


    const userForPermissions: UserForPermissions | null | undefined = user
      ? {
          id: user.id,
          email: user.email,
          role: user.role,
          permissions: (user.permissions as string[] | number | null | undefined) ?? null,
          isActive: user.isActive,
        }
      : null;

    const permissionFilteredItems = navigationItems.filter((item) => {
      if (item.topNav) return false;
      return isNavCatalogItemVisible(item, {
        isAuthenticated: Boolean(user),
        hasPermission: hasPermission(userForPermissions, item.permissionKey),
      });
    });

    const displayNavigationItems =
      navViewMode?.applyUserViewFilter(permissionFilteredItems) ?? permissionFilteredItems;

    const sectionGroups = buildNavSectionGroups(displayNavigationItems);

    const allSectionsCollapsed =
      sectionGroups.length > 0 &&
      sectionGroups.every(({ group }) => collapsedSections.has(group));

    const collapseAllNav = () => {
      setCollapsedSections(new Set(sectionGroups.map(({ group }) => group)));
    };

    const expandAllNav = () => {
      setCollapsedSections(new Set());
    };

    const toggleSection = (group: string) => {
      const next = new Set(collapsedSections);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      setCollapsedSections(next);
    };

    const siblingHrefs = displayNavigationItems.map((item) => item.href);
    const isActive = (href: string | undefined) =>
      isNavHrefActive(href, {
        activeSection,
        urlSearch: typeof window === 'undefined' ? '' : window.location.search,
        siblingHrefs,
      });

    const getBadgeCount = (itemId: string) => {
      switch (itemId) {
        case 'gmail-inbox':
        case 'inbox-consolidated':
          return gmailUnreadCount;
        case 'chat':
          return roomsUnread || 0;
        case 'chat-dms':
          return dmsUnread || 0;
        case 'chat-groups':
          return groupsUnread || 0;
        case 'suggestions':
          return unreadCounts.suggestions || 0;
        case 'kudos':
          return unreadCounts.kudos || 0;
        default:
          return 0;
      }
    };

    const getOnboardingStep = (itemId: string): OnboardingStep | null => {
      switch (itemId) {
        case 'gmail-inbox':
          return 'gmail-badge';
        case 'chat':
          return 'team-chat-badge';
        case 'suggestions':
          return 'suggestions-badge';
        case 'inbox-consolidated':
          return 'project-threads-intro';
        case 'holding-zone':
          return 'holding-zone-intro';
        default:
          return null;
      }
    };

    const { shouldShowStep } = useOnboarding();
    const [hasShownFirstBadge, setHasShownFirstBadge] = useState(false);
    const firstItemWithBadge = displayNavigationItems.find((item) => getBadgeCount(item.id) > 0);
    const showNavBadgeIntro =
      firstItemWithBadge && shouldShowStep('nav-badge-intro') && !hasShownFirstBadge;

    const sectionContainsActive = (items: NavItem[]) => items.some((item) => isActive(item.href));

    const renderNavItem = (item: NavItem) => {
      const badgeCount = getBadgeCount(item.id);
      if (!item.href) {
        logger.warn('Navigation item missing href:', { id: item.id, label: item.label });
      }

      const active = isActive(item.href);
      const href = getNavHref(item);
      const external = isExternalNavItem(item);
      const IconComponent = item.icon;

      const liveSheet = Boolean(item.liveSheet);
      const className = `
        w-full flex items-center ${
          isCollapsed ? 'justify-center px-2 h-12' : 'justify-start px-3 sm:px-3.5 h-12'
        } text-left touch-manipulation relative text-base sm:text-[17px] font-bold rounded-lg transition-all duration-200
        ${
          liveSheet
            ? active
              ? 'bg-amber-800 text-white shadow-md border-l-4 border-amber-950'
              : 'text-amber-950 bg-amber-50 hover:bg-amber-100 border border-amber-200'
            : active
              ? 'bg-brand-primary text-white shadow-md border-l-4 border-brand-primary-dark'
              : 'text-slate-800 hover:bg-slate-100 hover:shadow-sm'
        }
      `;

      const content = (
        <>
          {IconComponent ? (
            <IconComponent
              className={`h-5 w-5 flex-shrink-0 ${isCollapsed ? '' : 'mr-2.5 sm:mr-3'}`}
              aria-hidden="true"
            />
          ) : null}
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left font-bold leading-snug">{item.label}</span>
              {liveSheet && (
                <span
                  className={`ml-1 shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    active ? 'bg-white/20 text-white' : 'bg-amber-200/80 text-amber-950'
                  }`}
                >
                  Sheet
                </span>
              )}
              {external && (
                <ExternalLink
                  className={`h-3 w-3 flex-shrink-0 ml-1 ${active ? 'text-white/70' : 'text-slate-400'}`}
                  aria-hidden="true"
                />
              )}
              {item.id === 'quick-tools' && shouldShowStep('toolkit-apps-intro') && (
                <OnboardingTooltip
                  step="toolkit-apps-intro"
                  position="right"
                  showWhen={true}
                  delay={2000}
                  completeOnChildClick={true}
                >
                  <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-light-blue text-white text-[9px] font-bold animate-bounce">
                    !
                  </span>
                </OnboardingTooltip>
              )}
              {badgeCount > 0 && (
                <>
                  {showNavBadgeIntro && item.id === firstItemWithBadge?.id ? (
                    <OnboardingTooltip
                      step="nav-badge-intro"
                      position="right"
                      showWhen={true}
                      delay={1500}
                      onComplete={() => setHasShownFirstBadge(true)}
                    >
                      <Badge variant="destructive" className="ml-auto h-5 min-w-[20px] text-xs animate-pulse">
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </Badge>
                    </OnboardingTooltip>
                  ) : (
                    (() => {
                      const featureStep = getOnboardingStep(item.id);
                      const showFeatureTooltip =
                        featureStep &&
                        !shouldShowStep('nav-badge-intro') &&
                        shouldShowStep(featureStep);

                      if (showFeatureTooltip && featureStep) {
                        return (
                          <OnboardingTooltip step={featureStep} position="right" showWhen={true} delay={2000}>
                            <Badge variant="destructive" className="ml-auto h-5 min-w-[20px] text-xs animate-pulse">
                              {badgeCount > 99 ? '99+' : badgeCount}
                            </Badge>
                          </OnboardingTooltip>
                        );
                      }

                      return (
                        <Badge variant="destructive" className="ml-auto h-5 min-w-[20px] text-xs">
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </Badge>
                      );
                    })()
                  )}
                </>
              )}
            </>
          )}
        </>
      );

      const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (external) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onSectionChange(item.href);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };

      return (
        <a
          key={item.id}
          href={href}
          className={className}
          title={
            isCollapsed
              ? liveSheet
                ? `${item.label} (live Google Sheet)`
                : item.label
              : liveSheet
                ? 'Live Google Sheet — not stored in this app'
                : undefined
          }
          data-nav-id={item.id}
          data-testid={`nav-${item.id}`}
          aria-current={active ? 'page' : undefined}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          onClick={handleClick}
        >
          {content}
        </a>
      );
    };

    return (
      <nav className="flex flex-col gap-2 p-3" data-tour="navigation" aria-label="Primary">
        {navViewMode?.isUserViewActive && !isCollapsed && (
          <div
            className="mx-1 mb-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900"
            data-testid="nav-user-view-banner"
          >
            <span className="font-semibold">User View preview</span>
            <span className="block text-amber-800/90 mt-0.5">
              Showing tabs configured for typical users. Toggle Admin View in the header to see your full nav.
            </span>
          </div>
        )}

        {!isCollapsed && sectionGroups.length > 0 && (
          <button
            type="button"
            onClick={allSectionsCollapsed ? expandAllNav : collapseAllNav}
            className="mx-1 mb-1 flex w-[calc(100%-0.5rem)] items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white/90 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            data-testid="nav-collapse-all"
          >
            {allSectionsCollapsed ? (
              <>
                <ChevronsDown className="h-3.5 w-3.5" />
                Expand all
              </>
            ) : (
              <>
                <ChevronsUp className="h-3.5 w-3.5" />
                Collapse all
              </>
            )}
          </button>
        )}

        {sectionGroups.map(({ group, items }) => {
          const sectionId = `nav-section-${group}`;
          const isSectionCollapsed = collapsedSections.has(group);
          const containsActive = sectionContainsActive(items);
          const headerActive = containsActive;

          return (
            <div key={`nav-section-${group}`}>
              {!isCollapsed && (
                <div className="mt-4 mb-3">
                  <button
                    type="button"
                    id={`nav-section-toggle-${group}`}
                    onClick={() => toggleSection(group)}
                    className={`w-full rounded-lg px-3 py-2.5 mb-2 shadow-sm transition-colors cursor-pointer flex items-center justify-between group ${
                      headerActive
                        ? 'bg-[#114154] hover:bg-[#0d3344]'
                        : 'bg-brand-primary hover:bg-brand-primary-dark'
                    }`}
                    aria-expanded={!isSectionCollapsed}
                    aria-controls={sectionId}
                  >
                    <div className="font-bold text-white tracking-wide text-base flex-1 text-left">
                      {(NAV_GROUP_LABELS[group] || group).toUpperCase()}
                    </div>
                    {isSectionCollapsed ? (
                      <ChevronRight className="w-5 h-5 text-white/80 group-hover:scale-110 transition-transform" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-white/80 group-hover:scale-110 transition-transform" />
                    )}
                  </button>
                </div>
              )}
              <div
                id={sectionId}
                role="group"
                aria-labelledby={`nav-section-toggle-${group}`}
                hidden={!isCollapsed && isSectionCollapsed}
                className={!isCollapsed && isSectionCollapsed ? 'hidden' : 'flex flex-col gap-1'}
              >
                {items.map((item) => renderNavItem(item))}
              </div>
            </div>
          );
        })}
      </nav>
    );
  } catch (error) {
    logger.error('SimpleNav rendering error:', error);
    return (
      <nav className="flex flex-col gap-1 p-2" aria-label="Primary">
        <div className="text-sm text-red-500">Navigation error</div>
      </nav>
    );
  }
}
