import { useState, useCallback } from 'react';
import { Building2, Car, Users, Search, X, Mail, Phone, ChevronRight, Loader2 } from 'lucide-react';
import { useDashboardNavigation } from '@/contexts/dashboard-navigation-context';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { useDebounce } from '@/hooks/use-debounce';
import { useQuery } from '@tanstack/react-query';

import { usePageSession } from '@/hooks/usePageSession';
interface PersonSearchResult {
  id: number | string;
  name: string;
  email: string | null;
  phone: string | null;
  sourceType: string;
  sourceLabel: string;
  organization?: string | null;
  role?: string | null;
  link: string;
}

export default function TSPNetwork() {
  // Track page session for activity logging
  usePageSession({
    section: 'Directory',
    page: 'TSP Network',
  });

  const { setActiveSection } = useDashboardNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  // People search query
  const { data: searchResults, isLoading: isSearching } = useQuery<{ results: PersonSearchResult[] }>({
    queryKey: ['/api/people/search', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 2) {
        return { results: [] };
      }
      const response = await fetch(`/api/people/search?q=${encodeURIComponent(debouncedSearch)}`);
      if (!response.ok) throw new Error('Search failed');
      return response.json();
    },
    enabled: debouncedSearch.length >= 2,
  });

  const handleResultClick = useCallback((result: PersonSearchResult) => {
    // Navigate to the appropriate section
    const sectionMatch = result.link.match(/section=(\w+)/);
    if (sectionMatch) {
      setActiveSection(sectionMatch[1]);
      window.history.pushState({}, '', result.link);
    }
    setSearchQuery('');
  }, [setActiveSection]);

  const getSourceColor = (sourceType: string) => {
    switch (sourceType) {
      case 'user': return 'bg-indigo-100 text-indigo-700';
      case 'driver': return 'bg-green-100 text-green-700';
      case 'volunteer': return 'bg-purple-100 text-purple-700';
      case 'host': return 'bg-blue-100 text-blue-700';
      case 'hostContact': return 'bg-blue-50 text-blue-600';
      case 'recipient': return 'bg-orange-100 text-orange-700';
      case 'recipientTspContact': return 'bg-orange-50 text-orange-600';
      case 'contact': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const networkCards = [
    {
      id: 'hosts',
      title: 'Hosts',
      description: 'Manage host locations and schedules',
      icon: Building2,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      borderColor: 'border-blue-200',
      hoverBg: 'hover:bg-blue-50',
    },
    {
      id: 'drivers',
      title: 'Drivers',
      description: 'Manage delivery drivers and routes',
      icon: Car,
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
      borderColor: 'border-green-200',
      hoverBg: 'hover:bg-green-50',
    },
    {
      id: 'volunteers',
      title: 'Volunteers',
      description: 'Manage volunteer team members',
      icon: Users,
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
      borderColor: 'border-purple-200',
      hoverBg: 'hover:bg-purple-50',
    },
    {
      id: 'recipients',
      title: 'Recipients',
      description: 'Manage recipient organizations',
      icon: Users,
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
      borderColor: 'border-orange-200',
      hoverBg: 'hover:bg-orange-50',
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-brand-primary">
          <Users className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">TSP Network</h1>
          <p className="text-gray-600">
            Manage all the people and organizations in The Sandwich Project network
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for anyone in our network by name, email, or phone..."
            className="w-full pl-12 pr-12 py-3 rounded-xl border-2 border-gray-200 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all text-gray-900 placeholder:text-gray-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {searchQuery.length >= 2 && (
          <div className="absolute z-50 w-full mt-2 bg-white rounded-xl border-2 border-gray-200 shadow-xl max-h-96 overflow-y-auto">
            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
                <span className="ml-2 text-gray-600">Searching...</span>
              </div>
            ) : searchResults?.results && searchResults.results.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {searchResults.results.map((result) => (
                  <button
                    key={`${result.sourceType}-${result.id}`}
                    onClick={() => handleResultClick(result)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900 truncate">{result.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getSourceColor(result.sourceType)}`}>
                          {result.sourceLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        {result.email && (
                          <span className="flex items-center gap-1 truncate">
                            <Mail className="w-3.5 h-3.5" />
                            {result.email}
                          </span>
                        )}
                        {result.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5" />
                            {result.phone}
                          </span>
                        )}
                      </div>
                      {(result.organization || result.role) && (
                        <div className="text-xs text-gray-400 mt-1">
                          {result.role && <span>{result.role}</span>}
                          {result.role && result.organization && <span> at </span>}
                          {result.organization && <span>{result.organization}</span>}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-500">
                <Search className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p>No results found for "{searchQuery}"</p>
                <p className="text-sm">Try a different name, email, or phone number</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Network Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {networkCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              onClick={() => {
                setActiveSection(card.id);
                window.history.pushState({}, '', `/dashboard?section=${card.id}`);
              }}
              className={`group relative bg-white rounded-xl border-2 ${card.borderColor} ${card.hoverBg} p-6 text-left transition-all duration-200 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]`}
            >
              {/* Icon */}
              <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl ${card.iconBg} mb-4 group-hover:scale-110 transition-transform duration-200`}>
                <Icon className={`w-7 h-7 ${card.iconColor}`} />
              </div>

              {/* Content */}
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {card.title}
              </h3>
              <p className="text-gray-600 text-sm">
                {card.description}
              </p>

              {/* Arrow indicator */}
              <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <svg
                  className="w-6 h-6 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </button>
          );
        })}
      </div>

      {/* Quick Stats or Additional Info */}
      <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-xl border-2 border-teal-200 p-6 mt-8">
        <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <Users className="w-5 h-5 text-brand-primary" />
          About TSP Network
        </h3>
        <p className="text-sm text-gray-700">
          The TSP Network includes all the people and organizations that make our mission possible.
          Each group plays a vital role in collecting and distributing sandwiches to those in need.
        </p>
      </div>

      {/* AI Assistant - This is a navigation page, so rawData comes from backend */}
      <FloatingAIChat
        contextType="network"
        title="Network Assistant"
        subtitle="Ask about hosts, drivers, and volunteers"
        contextData={{
          currentView: 'tsp-network-overview',
          // Note: This is a navigation page - actual data is loaded by backend
        }}
        suggestedQuestions={[
          "How many active hosts do we have?",
          "How many drivers are in the network?",
          "How many volunteers do we have?",
          "What recipients are we serving?",
          "Show me network overview",
        ]}
      />
    </div>
  );
}
