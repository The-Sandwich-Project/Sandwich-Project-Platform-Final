import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Users,
  Calendar,
  MessageSquare,
  TrendingUp,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { DocumentsBrowser } from '@/components/documents-browser';
import tspLogo from '@assets/CMYK_PRINT_TSP-01_1749585167435.png';
import tspTransparent from '@assets/LOGOS/Copy of TSP_transparent.png';
import { logger } from '@/lib/logger';
import { socket } from '@/lib/socket';
import { queryClient } from '@/lib/queryClient';

export default function Landing() {
  const [showToolkit, setShowToolkit] = useState(false);

  const handleLogin = () => {
    // Redirect to login page
    window.location.href = '/login';
  };

  // Fetch real statistics for public display
  const { data: statsData } = useQuery({
    queryKey: ['/api/sandwich-collections/stats'],
    queryFn: async () => {
      const response = await fetch('/api/sandwich-collections/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
    retry: false,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // Polling fallback every 5 minutes
    refetchOnWindowFocus: true,
  });

  const { data: collectionsResponse } = useQuery({
    queryKey: ['/api/sandwich-collections'],
    queryFn: async () => {
      const response = await fetch('/api/sandwich-collections?page=1&limit=1000');
      if (!response.ok) throw new Error('Failed to fetch collections');
      return response.json();
    },
    retry: false,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // Polling fallback every 5 minutes
    refetchOnWindowFocus: true,
  });

  // Listen for real-time collection updates via Socket.IO
  useEffect(() => {
    const handleCollectionUpdate = (data: any) => {
      logger.log('[Landing] Collection updated via Socket.IO:', data);
      // Invalidate queries to refetch latest stats
      queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections'] });
    };

    socket.on('collections:updated', handleCollectionUpdate);

    return () => {
      socket.off('collections:updated', handleCollectionUpdate);
    };
  }, []);

  const collections = collectionsResponse?.collections || [];
  const totalSandwiches = statsData?.completeTotalSandwiches || 0;
  // Use calculated overall weekly average from actual operational data
  // Based on 2023-2025 performance: 8,983/week (2023), 8,851/week (2024), 7,861/week (2025)
  const weeklyAverage = 8700;
  // Use the verified record week from official records (38,828 on Nov 15, 2023 - Week 190)
  const recordWeek = 38828;

  return (
    <div className="min-h-screen premium-gradient-mesh p-4">
      <div className="premium-container space-y-12 py-8">
        {/* Hero Section */}
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <img
              src={tspLogo}
              alt="The Sandwich Project"
              className="h-24 w-auto"
            />
          </div>
          <p className="premium-text-body-lg text-gray-600 max-w-3xl mx-auto">
            A 501(c)(3) nonprofit organization serving Georgia communities by
            collecting and distributing sandwiches to fight food insecurity.
            Connecting volunteers, hosts, and nonprofit partners to make a
            lasting impact one sandwich at a time.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={handleLogin}
              className="premium-btn-primary premium-btn-lg group"
            >
              Enter Platform
              <svg
                className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-200"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </button>
            <button
              onClick={() => {
                logger.log(
                  'Toolkit button clicked, current state:',
                  showToolkit
                );
                setShowToolkit(!showToolkit);
              }}
              className="premium-btn-outline premium-btn-lg"
            >
              {showToolkit ? 'Hide' : 'View'} Group Toolkit
            </button>
          </div>
        </div>

        {/* Real-time Statistics - Hidden when toolkit is shown */}
        {!showToolkit && (
          <div className="premium-grid md:grid-cols-2 lg:grid-cols-3 max-w-4xl mx-auto">
            <div className="premium-card premium-interactive text-center p-6">
              <img
                src={tspTransparent}
                alt="TSP Logo"
                className="h-12 w-12 mx-auto mb-4 object-contain"
              />
              <div className="premium-text-h2 mb-2">
                {totalSandwiches.toLocaleString()}
              </div>
              <div className="premium-text-body font-semibold mb-3" style={{ color: '#236383' }}>
                Sandwiches Delivered
              </div>
              <p className="premium-text-body-sm text-gray-600">
                shared with community members
              </p>
            </div>

            <div className="premium-card premium-interactive text-center p-6">
              <Calendar className="h-12 w-12 mx-auto mb-4" style={{ color: '#236383' }} />
              <div className="premium-text-h2 mb-2">
                {weeklyAverage.toLocaleString()}
              </div>
              <div className="premium-text-body font-semibold mb-3" style={{ color: '#236383' }}>
                Weekly Average
              </div>
              <p className="premium-text-body-sm text-gray-600">collected each week</p>
            </div>

            <div className="premium-card premium-interactive text-center p-6">
              <TrendingUp className="h-12 w-12 mx-auto mb-4" style={{ color: '#FBAD3F' }} />
              <div className="premium-text-h2 mb-2">
                {recordWeek.toLocaleString()}
              </div>
              <div className="premium-text-body font-semibold mb-3" style={{ color: '#FBAD3F' }}>
                Record Week
              </div>
              <p className="premium-text-body-sm text-gray-600">
                weekly sandwich collection
              </p>
            </div>
          </div>
        )}

        {/* Volunteer Toolkit Section */}
        {showToolkit && (
          <Card className="bg-brand-primary-lighter border-2 border-blue-500">
            <CardHeader className="text-center">
              <CardTitle className="text-3xl text-brand-primary">
                🛠️ Group Toolkit
              </CardTitle>
              <CardDescription className="text-lg">
                Essential documents and training materials for The Sandwich
                Project volunteers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 text-center">
                <button
                  onClick={handleLogin}
                  className="premium-btn-outline mb-4"
                >
                  ← Access Full Platform
                </button>
              </div>
              <DocumentsBrowser />
            </CardContent>
          </Card>
        )}

        {/* Efficiency Metrics Section */}
        <div className="premium-card-featured p-8">
          <div className="text-center mb-6">
            <h2 className="premium-text-h2 mb-2" style={{ color: '#236383' }}>
              Proven Impact Efficiency
            </h2>
            <p className="premium-text-body text-gray-600">
              Data-backed claims with measurable results
            </p>
          </div>
          <div className="premium-grid md:grid-cols-3">
            <div className="text-center p-6 bg-white rounded-xl elevation-1">
              <div className="premium-text-h2 mb-1" style={{ color: '#A31C41' }}>449K</div>
              <div className="premium-text-body-sm font-semibold text-gray-700 mb-1">
                Year Output
              </div>
              <div className="premium-text-caption text-gray-600">
                2024 verified weekly totals
              </div>
            </div>
            <div className="text-center p-6 bg-white rounded-xl elevation-1">
              <div className="premium-text-h2 mb-1" style={{ color: '#FBAD3F' }}>47+</div>
              <div className="premium-text-body-sm font-semibold text-gray-700 mb-1">
                Mile Radius
              </div>
              <div className="premium-text-caption text-gray-600">
                verified geographic coverage
              </div>
            </div>
            <div className="text-center p-6 bg-white rounded-xl elevation-1">
              <div className="premium-text-h2 mb-1" style={{ color: '#236383' }}>1,800+</div>
              <div className="premium-text-body-sm font-semibold text-gray-700 mb-1">
                Weekly Data Points
              </div>
              <div className="premium-text-caption text-gray-600">
                weekly data points tracked
              </div>
            </div>
          </div>
          <div className="mt-6 text-center">
            <div className="inline-flex items-center gap-2 premium-badge-success px-4 py-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">
                Crisis Response: +100% surge capacity proven during Hurricane week
              </span>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="premium-grid md:grid-cols-3">
          <div className="premium-card premium-interactive text-center p-6 group">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all duration-300" style={{ backgroundColor: 'rgba(35, 99, 131, 0.1)' }}>
              <Users className="h-8 w-8" style={{ color: '#236383' }} />
            </div>
            <h3 className="premium-text-h4 mb-3 transition-colors duration-300" style={{ color: '#236383' }}>
              Team Management
            </h3>
            <p className="premium-text-body-sm text-gray-600">
              Manage hosts, volunteers, and drivers with comprehensive contact
              and role management
            </p>
          </div>

          <div className="premium-card premium-interactive text-center p-6 group">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all duration-300" style={{ backgroundColor: 'rgba(0, 126, 140, 0.1)' }}>
              <Calendar className="h-8 w-8" style={{ color: '#236383' }} />
            </div>
            <h3 className="premium-text-h4 mb-3 transition-colors duration-300" style={{ color: '#236383' }}>
              Project Coordination
            </h3>
            <p className="premium-text-body-sm text-gray-600">
              Track sandwich collections, coordinate meetings, and manage
              project workflows
            </p>
          </div>

          <div className="premium-card premium-interactive text-center p-6 group">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all duration-300" style={{ backgroundColor: 'rgba(163, 28, 65, 0.1)' }}>
              <MessageSquare className="h-8 w-8" style={{ color: '#A31C41' }} />
            </div>
            <h3 className="premium-text-h4 mb-3 transition-colors duration-300" style={{ color: '#A31C41' }}>
              Communication Hub
            </h3>
            <p className="premium-text-body-sm text-gray-600">
              Real-time messaging, committee discussions, and comprehensive
              reporting tools
            </p>
          </div>
        </div>

        {/* Contact Information */}
        <div className="premium-card max-w-md mx-auto text-center p-8">
          <h3 className="premium-text-h3 mb-2" style={{ color: '#236383' }}>Get Involved</h3>
          <p className="premium-text-body text-gray-600 mb-4">
            Ready to make a difference in your community?
          </p>
          <div className="space-y-2">
            <p className="premium-text-body-sm text-gray-600">
              Contact us to learn about volunteer opportunities
            </p>
            <p className="premium-text-body font-medium">
              Visit:{' '}
              <span style={{ color: '#236383' }}>thesandwichproject.org</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
