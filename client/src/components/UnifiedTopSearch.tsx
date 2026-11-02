/**
 * UnifiedTopSearch
 *
 * One search bar that lives in the dark top navigation header. Searches BOTH:
 *   - App features / pages   (via /api/smart-search/fuzzy — previously the
 *                             sidebar's SmartSearch component)
 *   - People + organizations (via /api/people/search    — previously the
 *                             dashboard's DashboardSearch component)
 *
 * Results are queried in parallel and merged into a single dropdown grouped
 * by type: "Pages & Actions" first (faster to land on a screen), then
 * "People & Organizations". A consolidated bar lets the user search for
 * "recipients" and see both the Recipients Management section AND any
 * recipient records matching the query without remembering which search to
 * use.
 *
 * Lives in the persistent dark top header so a single, predictable spot
 * works on every page — Dashboard, Calendars, Collection Log, etc.
 */
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Search,
  X,
  Loader2,
  Building2,
  Mail,
  Phone,
  User,
  Truck,
  Heart,
  Users,
  ChevronRight,
  Sparkles,
  Sandwich,
} from 'lucide-react';

// ── Result types ────────────────────────────────────────────────────────
// Matches the two upstream APIs verbatim so we can reuse their responses.

interface PageResult {
  kind: 'page';
  id: string;
  title: string;
  description?: string;
  route: string;
  action?: string;
  matchType: 'exact' | 'fuzzy' | 'semantic' | 'keyword';
}

interface PersonResult {
  kind: 'person';
  id: number | string;
  name: string;
  email: string | null;
  phone: string | null;
  sourceType: string;
  sourceLabel: string;
  organization?: string | null;
  link: string;
  /** Which field of the record matched the search term (e.g. "Email"). */
  matchedField?: string;
  /** The actual value from that field, for the snippet under the result. */
  matchedText?: string;
}

interface CollectionResult {
  kind: 'collection';
  id: number | string;
  title: string;
  description?: string;
  route: string;
}

type UnifiedResult = PageResult | PersonResult | CollectionResult;

// People-source iconography (mirrors DashboardSearch).
const PERSON_ICONS: Record<string, typeof User> = {
  user: User,
  driver: Truck,
  volunteer: Heart,
  host: Building2,
  hostContact: Building2,
  recipient: Users,
  recipientTspContact: Users,
  contact: Users,
};

const PERSON_BADGE_COLORS: Record<string, string> = {
  'Team Member': 'bg-blue-100 text-blue-700',
  Driver: 'bg-amber-100 text-amber-700',
  Volunteer: 'bg-green-100 text-green-700',
  Host: 'bg-purple-100 text-purple-700',
  'Host Contact': 'bg-purple-50 text-purple-600',
  Recipient: 'bg-rose-100 text-rose-700',
  'Recipient Contact': 'bg-rose-50 text-rose-600',
  'TSP Contact': 'bg-indigo-100 text-indigo-700',
  Contact: 'bg-gray-100 text-gray-700',
  'Event Request Org': 'bg-orange-100 text-orange-700',
  'Event Request Contact': 'bg-orange-50 text-orange-600',
  Organization: 'bg-teal-100 text-teal-700',
};

/**
 * Custom events the old SmartSearch used to dispatch when a "page result"
 * also carried an action like "open the add dialog." Preserved verbatim so
 * existing listeners (event-requests/index.tsx, etc.) keep working.
 */
/**
 * Render a matched-field snippet with the query term visually highlighted.
 * Case-insensitive substring highlight, first occurrence only — snippets
 * shown here are short (single field values), so anchoring one match is
 * enough. Falls back to plain text if the query isn't present in the
 * snippet (which shouldn't happen when the server correctly reports the
 * matched field, but guards against future edge cases).
 */
function renderHighlightedMatch(text: string, query: string): ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const idx = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (idx < 0) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + trimmed.length);
  const after = text.slice(idx + trimmed.length);
  return (
    <>
      {before}
      <mark className="bg-amber-100 text-amber-900 px-0.5 rounded-sm">
        {match}
      </mark>
      {after}
    </>
  );
}

function triggerFeatureAction(action: string | undefined, route: string) {
  if (!action || action !== 'openAddDialog') return;
  if (route.startsWith('/collections')) {
    window.dispatchEvent(new Event('openCollectionForm'));
  } else if (route.startsWith('/event-requests')) {
    window.dispatchEvent(new Event('openEventRequestCreateDialog'));
  } else if (route.startsWith('/projects')) {
    window.dispatchEvent(new Event('openProjectCreateDialog'));
  } else if (route.includes('section=hosts')) {
    window.dispatchEvent(new Event('openHostCreateDialog'));
  } else if (route.includes('section=volunteers')) {
    window.dispatchEvent(new Event('openVolunteerCreateDialog'));
  }
}

export function UnifiedTopSearch() {
  const [query, setQuery] = useState('');
  const [pageResults, setPageResults] = useState<PageResult[]>([]);
  const [personResults, setPersonResults] = useState<PersonResult[]>([]);
  const [collectionResults, setCollectionResults] = useState<CollectionResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  // Position tracking for the portaled dropdown. The dropdown lives in
  // document.body (not next to the input) to escape clipping by ancestor
  // containers with overflow:hidden or stacking contexts in the top nav.
  // We track the input's bounding rect and use position:fixed on the
  // dropdown so it lands right below the input regardless of DOM location.
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileResultsEl, setMobileResultsEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [, setLocation] = useLocation();

  const flatResults: UnifiedResult[] = [
    ...pageResults,
    ...personResults,
    ...collectionResults,
  ];

  // ── Parallel search across both endpoints ─────────────────────────────
  const runSearch = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setPageResults([]);
      setPersonResults([]);
      setCollectionResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    setIsOpen(true);

    try {
      const [pagesRes, peopleRes, collectionsRes] = await Promise.allSettled([
        fetch('/api/smart-search/fuzzy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ query: trimmed, limit: 6 }),
        }),
        fetch(`/api/people/search?q=${encodeURIComponent(trimmed)}`, {
          credentials: 'include',
        }),
        fetch(`/api/search/collections?q=${encodeURIComponent(trimmed)}&limit=5`, {
          credentials: 'include',
        }),
      ]);

      // Pages.
      let nextPages: PageResult[] = [];
      if (pagesRes.status === 'fulfilled' && pagesRes.value.ok) {
        try {
          const data = await pagesRes.value.json();
          nextPages = (data.results || []).map((r: any): PageResult => ({
            kind: 'page',
            id: String(r.feature?.id || r.id),
            title: r.feature?.title || r.title || '',
            description: r.feature?.description,
            route: r.feature?.route || '',
            action: r.feature?.action,
            matchType: r.matchType || 'fuzzy',
          }));
        } catch {
          // ignore parse error
        }
      }

      // People.
      let nextPeople: PersonResult[] = [];
      if (peopleRes.status === 'fulfilled' && peopleRes.value.ok) {
        try {
          const data = await peopleRes.value.json();
          nextPeople = (data.results || []).map(
            (r: any): PersonResult => ({
              kind: 'person',
              id: r.id,
              name: r.name,
              email: r.email,
              phone: r.phone,
              sourceType: r.sourceType,
              sourceLabel: r.sourceLabel,
              organization: r.organization,
              link: r.link,
              matchedField: r.matchedField,
              matchedText: r.matchedText,
            }),
          );
        } catch {
          // ignore parse error
        }
      }

      // Collections.
      let nextCollections: CollectionResult[] = [];
      if (collectionsRes.status === 'fulfilled' && collectionsRes.value.ok) {
        try {
          const data = await collectionsRes.value.json();
          nextCollections = (data.results || []).map(
            (r: any): CollectionResult => ({
              kind: 'collection',
              id: r.id,
              title: r.title || 'Collection',
              description: r.description,
              route: '/dashboard?section=collections',
            }),
          );
        } catch {
          // ignore parse error
        }
      }

      setPageResults(nextPages);
      setPersonResults(nextPeople);
      setCollectionResults(nextCollections);
      setSelectedIndex(-1);
      setIsOpen(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced query handler.
  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 200);
  };

  // ── Result selection ──────────────────────────────────────────────────
  const closeMobileSearch = useCallback(() => {
    setMobileOpen(false);
    setIsOpen(false);
    setQuery('');
    setPageResults([]);
    setPersonResults([]);
    setCollectionResults([]);
  }, []);

  const navigateToResult = (result: UnifiedResult) => {
    setIsOpen(false);
    setMobileOpen(false);
    setQuery('');
    setPageResults([]);
    setPersonResults([]);
    setCollectionResults([]);
    if (result.kind === 'page') {
      setLocation(result.route);
      if (result.action) {
        // Defer so the route mounts before the dialog event fires.
        setTimeout(() => triggerFeatureAction(result.action, result.route), 200);
      }
    } else if (result.kind === 'collection') {
      setLocation(result.route);
    } else {
      setLocation(result.link);
    }
  };

  // ── Keyboard ──────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (mobileOpen) {
        closeMobileSearch();
        return;
      }
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!isOpen || flatResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((p) => Math.min(p + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((p) => Math.max(p - 1, -1));
    } else if (e.key === 'Enter') {
      // Enter behavior:
      //   - If the user arrowed to a specific row, take that.
      //   - Otherwise, jump to the FIRST result. Previously Enter did
      //     nothing when nothing was highlighted, which surprised users
      //     who just wanted to hit Enter to open the top match.
      e.preventDefault();
      const target =
        selectedIndex >= 0 ? flatResults[selectedIndex] : flatResults[0];
      if (target) navigateToResult(target);
    }
  };

  // ── Compact (phone) vs full search bar ────────────────────────────────
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 639px)');
    const onChange = () => {
      const compact = mql.matches;
      setIsCompact(compact);
      if (!compact) setMobileOpen(false);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  // ── Cmd/Ctrl+K focus shortcut ─────────────────────────────────────────
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isCompact) {
          setMobileOpen(true);
        } else {
          inputRef.current?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, [isCompact]);

  // ── Click outside closes ──────────────────────────────────────────────
  // The dropdown is portaled to document.body, so a naive check on
  // containerRef alone would treat clicks inside the dropdown as
  // "outside" and close it before navigation can run. We also allow
  // clicks whose target is inside the portaled dropdown element.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const insideContainer =
        containerRef.current && containerRef.current.contains(e.target as Node);
      const dropdownEl = document.getElementById('unified-top-search-results');
      const insideDropdown = dropdownEl && dropdownEl.contains(e.target as Node);
      if (mobileOpen) return;
      if (!insideContainer && !insideDropdown) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileOpen]);

  // ── Recompute dropdown position ───────────────────────────────────────
  // Whenever the dropdown is open, keep its position anchored to the
  // input as the user scrolls or resizes the window. We use position:
  // fixed on the portaled dropdown, so coordinates are in viewport
  // space (input's getBoundingClientRect already gives viewport coords).
  useEffect(() => {
    if (!isOpen) {
      setDropdownPos(null);
      return;
    }
    const update = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      if (mobileOpen) {
        setDropdownPos({
          top: rect.bottom + 8,
          left: 12,
          width: Math.max(window.innerWidth - 24, 0),
        });
        return;
      }
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [isOpen, mobileOpen]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  // Build the per-row index lookup so keyboard nav can highlight one row
  // across the two grouped sections.
  let rowIdx = -1;

  const searchField = (
    <div className="relative w-full">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60 pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search pages, people, events, collections…"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsOpen(true)}
        className="top-nav-search w-full h-9 pl-8 pr-16 rounded-md text-sm border border-white/15 focus:outline-none focus:border-white/30 transition-colors"
        aria-label="Universal search"
        aria-expanded={isOpen}
        aria-controls="unified-top-search-results"
        autoComplete="off"
        data-testid="unified-top-search"
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/60" />}
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setPageResults([]);
              setPersonResults([]);
              setCollectionResults([]);
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className="p-0.5 rounded hover:bg-white/15 text-white/60 hover:text-white/90"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="hidden md:inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-mono text-white/40 border border-white/15">
            ⌘K
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className={isCompact ? 'flex items-center' : 'relative w-full'}>
      {isCompact && !mobileOpen && (
        <button
          type="button"
          onClick={() => {
            setMobileOpen(true);
            setIsOpen(true);
          }}
          className="flex items-center justify-center w-9 h-9 rounded-md text-white/80 hover:bg-white/15 hover:text-white"
          aria-label="Search"
          data-testid="unified-top-search-mobile"
        >
          <Search className="w-5 h-5" />
        </button>
      )}
      {isCompact && (
        <Dialog
          open={mobileOpen}
          onOpenChange={(open) => {
            if (open) {
              setMobileOpen(true);
              setIsOpen(true);
            } else {
              closeMobileSearch();
            }
          }}
        >
          <DialogContent className="left-0 top-0 z-[10010] flex h-[100dvh] max-h-[100dvh] md:max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none [&>button.absolute]:hidden">
            <DialogTitle className="sr-only">Search</DialogTitle>
            <div
              className="relative bg-[#236383] px-3 pb-3"
              style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">{searchField}</div>
                <button
                  type="button"
                  onClick={closeMobileSearch}
                  className="shrink-0 text-white text-sm font-medium px-2 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
            <div
              ref={setMobileResultsEl}
              className="min-h-0 flex-1 overflow-y-auto bg-white"
            />
          </DialogContent>
        </Dialog>
      )}
      {!isCompact && searchField}

      {/* Results dropdown — portaled to document.body with position:fixed
          so it can never be clipped by ancestor containers with
          overflow:hidden or lower stacking contexts in the top nav. */}
      {isOpen && (mobileOpen ? mobileResultsEl : dropdownPos) && createPortal(
        <div
          id="unified-top-search-results"
          role="listbox"
          style={
            mobileOpen || !dropdownPos
              ? undefined
              : {
                  position: 'fixed',
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  width: dropdownPos.width,
                }
          }
          className={
            mobileOpen
              ? 'bg-white'
              : 'bg-white rounded-lg border border-slate-200 shadow-xl overflow-y-auto z-[10000] max-h-[420px]'
          }
        >
          {query.trim().length < 2 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              Type at least 2 characters to search pages, people, events, and collections
            </div>
          ) : isLoading && flatResults.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching…
            </div>
          ) : pageResults.length === 0 &&
            personResults.length === 0 &&
            collectionResults.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div className="py-1">
              {pageResults.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                    Pages & Actions
                  </div>
                  {pageResults.map((r) => {
                    rowIdx += 1;
                    const active = rowIdx === selectedIndex;
                    return (
                      <button
                        key={`page-${r.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => navigateToResult(r)}
                        onMouseEnter={() => setSelectedIndex(pageResults.indexOf(r))}
                        className={`w-full px-3 py-2 flex items-center gap-3 text-left transition-colors ${
                          active ? 'bg-[#236383]/10' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-7 h-7 rounded-md bg-[#236383]/10 flex items-center justify-center shrink-0">
                          {r.matchType === 'semantic' ? (
                            <Sparkles className="w-3.5 h-3.5 text-[#236383]" />
                          ) : (
                            <Search className="w-3.5 h-3.5 text-[#236383]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">
                            {r.title}
                          </div>
                          {r.description && (
                            <div className="text-xs text-slate-500 truncate">{r.description}</div>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </button>
                    );
                  })}
                </>
              )}

              {personResults.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                    People & Organizations
                  </div>
                  {personResults.map((r) => {
                    rowIdx += 1;
                    const active = rowIdx === selectedIndex;
                    const Icon = PERSON_ICONS[r.sourceType] || Users;
                    const badgeColor =
                      PERSON_BADGE_COLORS[r.sourceLabel] || 'bg-gray-100 text-gray-700';
                    return (
                      <button
                        key={`person-${r.sourceType}-${r.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => navigateToResult(r)}
                        onMouseEnter={() =>
                          setSelectedIndex(pageResults.length + personResults.indexOf(r))
                        }
                        className={`w-full px-3 py-2 flex items-start gap-3 text-left transition-colors ${
                          active ? 'bg-[#236383]/10' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="mt-0.5 w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5 text-slate-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium text-slate-800 truncate">
                              {r.name}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0 rounded font-medium ${badgeColor}`}
                            >
                              {r.sourceLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
                            {r.organization && (
                              <span className="flex items-center gap-1 truncate">
                                <Building2 className="w-3 h-3" />
                                {r.organization}
                              </span>
                            )}
                            {r.email && (
                              <span className="flex items-center gap-1 truncate">
                                <Mail className="w-3 h-3" />
                                {r.email}
                              </span>
                            )}
                            {r.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {r.phone}
                              </span>
                            )}
                          </div>
                          {/* "Matched: <field>" hint — tells the user
                              WHY this record showed up. Critical when the
                              query term appears in a field that isn't the
                              displayed name (e.g. an email or an
                              organization name). Query term inside the
                              snippet is highlighted so the eye lands on
                              exactly what matched. */}
                          {r.matchedField && r.matchedText && (
                            <div className="mt-1 text-[11px] text-slate-500 truncate">
                              <span className="font-semibold text-slate-600">
                                {r.matchedField}:
                              </span>{' '}
                              {renderHighlightedMatch(r.matchedText, query)}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              {collectionResults.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                    Collections
                  </div>
                  {collectionResults.map((r) => {
                    rowIdx += 1;
                    const active = rowIdx === selectedIndex;
                    return (
                      <button
                        key={`collection-${r.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => navigateToResult(r)}
                        onMouseEnter={() =>
                          setSelectedIndex(
                            pageResults.length + personResults.length + collectionResults.indexOf(r),
                          )
                        }
                        className={`w-full px-3 py-2 flex items-center gap-3 text-left transition-colors ${
                          active ? 'bg-[#236383]/10' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-7 h-7 rounded-md bg-amber-100 flex items-center justify-center shrink-0">
                          <Sandwich className="w-3.5 h-3.5 text-amber-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">
                            {r.title}
                          </div>
                          {r.description && (
                            <div className="text-xs text-slate-500 truncate">{r.description}</div>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>,
        mobileOpen && mobileResultsEl ? mobileResultsEl : document.body,
      )}
    </div>
  );
}
