import React, { useState, useEffect } from 'react';
import {
  Clock,
  ExternalLink,
  ArrowRight,
  FileText,
  Link2,
  Folder,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// localStorage key for the collapse state. Versioned so future default
// changes can reset everyone's saved preference safely. Bumped v1 → v2 when
// the default flipped to expanded — returning users get the new default once,
// then their own toggle choice sticks from then on.
const COLLAPSE_STATE_KEY = 'recentlyVisitedItems.expanded.v2';

interface Resource {
  resource: {
    id: number;
    title: string;
    description: string | null;
    type: 'file' | 'link' | 'google_drive';
    category: string;
    documentId: number | null;
    url: string | null;
    lastAccessedAt: string | null;
    accessCount: number;
  };
  lastAccessed: string;
  tags: Array<{ id: number; name: string; color: string | null }>;
}

export function RecentlyAccessedResources() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  // Section starts EXPANDED by default — for returning users this is one of
  // the most useful things on the dashboard ("continue where you left off"),
  // so it shouldn't be hidden behind a chevron. The expanded/collapsed choice
  // is persisted to localStorage so once the user toggles it, their choice
  // sticks. No stored value (first visit after the v2 bump) → expanded.
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_STATE_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STATE_KEY, String(next));
      } catch {
        // Storage disabled / over quota — fall back to in-session state.
      }
      return next;
    });
  };

  useEffect(() => {
    loadRecentResources();
  }, []);

  const loadRecentResources = async () => {
    try {
      const res = await fetch('/api/resources/user/recent?limit=5', {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setResources(data);
      }
    } catch (error) {
      console.error('Error loading recent resources:', error);
    } finally {
      setLoading(false);
    }
  };

  const openResource = async (resource: Resource) => {
    // Track access
    try {
      await fetch(`/api/resources/${resource.resource.id}/access`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Error tracking access:', error);
    }

    // Open resource
    if (resource.resource.type === 'file' && resource.resource.documentId) {
      window.open(`/api/documents/${resource.resource.documentId}`, '_blank');
    } else if (resource.resource.url) {
      window.open(resource.resource.url, '_blank');
    }
  };

  const getResourceIcon = (type: string) => {
    switch (type) {
      case 'file':
        return FileText;
      case 'google_drive':
        return Folder;
      case 'link':
        return Link2;
      default:
        return FileText;
    }
  };

  // Header is the same in every state and is a clickable toggle. The body
  // is conditionally rendered based on isExpanded, which defaults to false
  // (collapsed) so the section doesn't preempt the dashboard's primary
  // content until the user asks for it.
  const itemCount = resources.length;
  return (
    <div className="bg-white rounded-lg shadow-sm">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
        className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
          isExpanded ? 'border-b border-gray-200' : ''
        } rounded-lg`}
        data-testid="recently-visited-toggle"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-[#47B3CB]" />
          <h2 className="font-semibold text-gray-900">Recently Visited Items</h2>
          {!loading && itemCount > 0 && (
            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {itemCount}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" aria-hidden="true" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 pt-3">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 rounded animate-pulse"></div>
              ))}
            </div>
          ) : resources.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 mb-3">
                Nothing here yet — the files and links you open will show up here for quick access.
              </p>
              <a
                href="/dashboard?section=resources"
                className="inline-flex items-center gap-1 text-sm text-[#236383] hover:text-[#236383] font-medium"
              >
                Browse resources
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {resources.map((resource) => {
                  const Icon = getResourceIcon(resource.resource.type);

                  return (
                    <button
                      key={resource.resource.id}
                      onClick={() => openResource(resource)}
                      className="w-full text-left p-2 rounded hover:bg-[#236383]/5 transition-colors group"
                    >
                      <div className="flex items-start gap-2">
                        <Icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 truncate group-hover:text-[#236383] transition-colors">
                            {resource.resource.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-gray-500">
                              {new Date(resource.lastAccessed).toLocaleDateString()}
                            </p>
                            <span className="text-xs text-gray-400">•</span>
                            <p className="text-xs text-gray-500">
                              {resource.resource.accessCount} views
                            </p>
                          </div>
                        </div>
                        <ExternalLink className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-200">
                <a
                  href="/dashboard?section=resources"
                  className="text-sm text-[#236383] hover:text-[#236383] font-medium flex items-center justify-center gap-1"
                >
                  View all resources
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
