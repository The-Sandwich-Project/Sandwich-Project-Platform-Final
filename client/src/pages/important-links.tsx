import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  ExternalLink,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Calculator,
  Link as LinkIcon,
  Heart,
  LayoutDashboard,
  BookOpen,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOnboardingTracker } from '@/hooks/useOnboardingTracker';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { logger } from '@/lib/logger';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';
import { FloatingAIChat } from '@/components/floating-ai-chat';

export default function ImportantLinks() {
  const [isLoading, setIsLoading] = useState(false);
  const [eventsZoomLevel, setEventsZoomLevel] = useState(85);
  const [userSheetZoomLevel, setUserSheetZoomLevel] = useState(85);
  const { track } = useOnboardingTracker();
  const { trackView, trackClick } = useActivityTracker();

  useEffect(() => {
    trackView(
      'Links',
      'Links',
      'Important Links',
      'User accessed important links page'
    );
  }, [trackView]);

  // URLs for all the important links (original URLs for "open in new tab" buttons)
  const inventoryCalculatorUrl =
    'https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html';
  const eventEstimatorUrl =
    'https://the-sandwich-project.github.io/sandwichinventory/eventestimator/sandwichprojecteventestimator.html';
  const eventToolkitUrl =
    'https://the-sandwich-project.github.io/sandwichinventory/toolkit.html';
  const donationReceiptUrl =
    'https://receipt-gen--katielong2316.replit.app/';
  const donorManagementUrl =
    'https://bread-and-butter-donors.lovable.app/';
  const internalHubUrl =
    'https://the-sandwich-project.github.io/tsp-internal/index.html';
  const volunteerHandbookUrl =
    'https://tsp-host-handbook-ylfb92u.gamma.site/';

  // Proxied URLs for iframe embedding (bypasses X-Frame-Options)
  const proxyUrl = (url: string) => `/api/proxy/page?url=${encodeURIComponent(url)}`;
  const inventoryCalculatorEmbed = proxyUrl(inventoryCalculatorUrl);
  const eventToolkitEmbed = proxyUrl(eventToolkitUrl);
  const donationReceiptEmbed = proxyUrl(donationReceiptUrl);
  const donorManagementEmbed = proxyUrl(donorManagementUrl);
  const internalHubEmbed = proxyUrl(internalHubUrl);

  // Events Google Sheet (published version)
  const eventsEmbedUrl =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2r5KMRKuKSrqn1yQxtw8T0e5Ooi_iBfd0HlgGVcIHtFat3o54FrqyTLB_uq-RxojjSFg1GTvpIZLZ/pubhtml?widget=true&headers=false';
  const eventsFullViewUrl =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2r5KMRKuKSrqn1yQxtw8T0e5Ooi_iBfd0HlgGVcIHtFat3o54FrqyTLB_uq-RxojjSFg1GTvpIZLZ/pubhtml';

  // User's specific Google Sheet
  const userSheetUrl =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vRAgug7UWU-j96KzlWYnff0oS61ezmshAvgDFugYvC-EHSeHcl5TlIKuE2dbyAJ9hz2DexSCJbf6Cpr/pubhtml';
  const userSheetEmbedUrl =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vRAgug7UWU-j96KzlWYnff0oS61ezmshAvgDFugYvC-EHSeHcl5TlIKuE2dbyAJ9hz2DexSCJbf6Cpr/pubhtml?widget=true&headers=false';

  // Track page visit for onboarding challenge
  useEffect(() => {
    track('view_quick_tools');
  }, []);

  // Load user's saved zoom preferences
  useEffect(() => {
    const savedEventsZoom = localStorage.getItem('important-links-events-zoom');
    const savedUserSheetZoom = localStorage.getItem(
      'important-links-user-sheet-zoom'
    );

    if (savedEventsZoom) {
      setEventsZoomLevel(parseInt(savedEventsZoom));
    }
    if (savedUserSheetZoom) {
      setUserSheetZoomLevel(parseInt(savedUserSheetZoom));
    }
  }, []);

  // Zoom control handlers for Events Sheet
  const handleEventsZoomChange = (newZoom: number[]) => {
    const zoom = (newZoom || [])[0] || 85;
    setEventsZoomLevel(zoom);
    localStorage.setItem('important-links-events-zoom', zoom.toString());
  };

  const handleEventsZoomIn = () => {
    const newZoom = Math.min(eventsZoomLevel + 10, 150);
    handleEventsZoomChange([newZoom]);
  };

  const handleEventsZoomOut = () => {
    const newZoom = Math.max(eventsZoomLevel - 10, 50);
    handleEventsZoomChange([newZoom]);
  };

  const handleEventsResetZoom = () => {
    handleEventsZoomChange([85]);
  };

  // Zoom control handlers for User Sheet
  const handleUserSheetZoomChange = (newZoom: number[]) => {
    const zoom = (newZoom || [])[0] || 85;
    setUserSheetZoomLevel(zoom);
    localStorage.setItem('important-links-user-sheet-zoom', zoom.toString());
  };

  const handleUserSheetZoomIn = () => {
    const newZoom = Math.min(userSheetZoomLevel + 10, 150);
    handleUserSheetZoomChange([newZoom]);
  };

  const handleUserSheetZoomOut = () => {
    const newZoom = Math.max(userSheetZoomLevel - 10, 50);
    handleUserSheetZoomChange([newZoom]);
  };

  const handleUserSheetResetZoom = () => {
    handleUserSheetZoomChange([85]);
  };

  const handleRefreshEvents = () => {
    setIsLoading(true);
    const iframe = document.getElementById(
      'events-spreadsheet'
    ) as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
    setTimeout(() => setIsLoading(false), 1000);
  };

  const handleRefreshUserSheet = () => {
    setIsLoading(true);
    const iframe = document.getElementById(
      'user-spreadsheet'
    ) as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
    setTimeout(() => setIsLoading(false), 1000);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 p-3 sm:p-6">
      <div className="hidden sm:block">
        <PageBreadcrumbs segments={[
          { label: 'Quick Links' },
          { label: 'Toolkit & Apps' }
        ]} />
      </div>

      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-3xl font-bold text-brand-primary mb-1 sm:mb-2">
          Toolkit & Apps
        </h1>
        <p className="text-xs sm:text-base text-gray-600">
          Event Toolkit, calculators, donation receipts, donor management, and more.
        </p>
      </div>

      <Tabs defaultValue="toolkit" className="flex-1 flex flex-col">
        {/* Mobile: Horizontal scrollable tabs, Desktop: Grid */}
        <TabsList className="flex overflow-x-auto sm:grid sm:grid-cols-8 w-full mb-2 sm:mb-0">
          <TabsTrigger value="handbook" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">
            <BookOpen className="h-3 w-3 sm:h-4 sm:w-4" />
            Handbook
          </TabsTrigger>
          <TabsTrigger value="toolkit" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">
            <span className="hidden sm:inline">📦</span> Toolkit
          </TabsTrigger>
          <TabsTrigger value="calculator" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">
            <Calculator className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Inventory</span> Calc
          </TabsTrigger>
          <TabsTrigger value="donation-receipt" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">
            <span className="hidden sm:inline">🧾</span> Receipt
          </TabsTrigger>
          <TabsTrigger value="donor-management" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">
            <Heart className="h-3 w-3 sm:h-4 sm:w-4" />
            Donors
          </TabsTrigger>
          <TabsTrigger value="internal-hub" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">
            <LayoutDashboard className="h-3 w-3 sm:h-4 sm:w-4" />
            Internal
          </TabsTrigger>
          <TabsTrigger value="events" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">
            <span className="hidden sm:inline">📅</span> Events
          </TabsTrigger>
          <TabsTrigger value="user-sheet" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">
            <LinkIcon className="h-3 w-3 sm:h-4 sm:w-4" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Volunteer Handbook Tab */}
        <TabsContent value="handbook" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <BookOpen className="h-5 w-5" />
                TSP Volunteer Handbook
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                The all-encompassing handbook for every volunteer role — policies, procedures, and reference material.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 sm:p-6 pt-0 sm:pt-0">
              <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button
                    size="lg"
                    onClick={() => {
                      trackClick('open_handbook', 'Links', 'Opened Volunteer Handbook');
                      window.open(volunteerHandbookUrl, '_blank');
                    }}
                    className="bg-brand-primary hover:bg-brand-primary-dark text-white font-semibold px-4 sm:px-8 py-3 text-sm sm:text-base flex-1 h-11"
                  >
                    <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    Open Volunteer Handbook
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(volunteerHandbookUrl);
                        alert('Link copied to clipboard!');
                      } catch (error) {
                        logger.error('Failed to copy:', error);
                      }
                    }}
                    className="border-brand-orange text-brand-orange hover:bg-orange-50 px-4 sm:px-6 py-3 font-medium h-11"
                  >
                    📋 Copy Link
                  </Button>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-blue-900 mb-2 text-sm sm:text-base">Shareable Link:</h3>
                  <code className="text-xs sm:text-sm bg-white px-2 sm:px-3 py-2 rounded border border-blue-200 block break-all">
                    {volunteerHandbookUrl}
                  </code>
                  <p className="text-xs sm:text-sm text-blue-700 mt-2">
                    Share this with any volunteer — bookmark it for quick reference.
                  </p>
                </div>

                {/* Embedded Handbook — desktop only. Gamma sites block direct
                    iframe embedding via X-Frame-Options, so we route through
                    the /api/proxy/page endpoint like the other external tools. */}
                <div className="border rounded-lg overflow-hidden flex-1 hidden sm:block">
                  <iframe
                    src={proxyUrl(volunteerHandbookUrl)}
                    className="w-full h-full border-0"
                    style={{
                      minHeight: '600px',
                      height: '100%',
                    }}
                    title="Volunteer Handbook"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Event Toolkit Tab */}
        <TabsContent value="toolkit" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                📦 Event Toolkit for Volunteers
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Everything volunteers need to plan and host a sandwich-making event - share this with anyone making sandwiches
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 sm:p-6 pt-0 sm:pt-0">
              <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button
                    size="lg"
                    onClick={() => window.open(eventToolkitUrl, '_blank')}
                    className="bg-brand-primary hover:bg-brand-primary-dark text-white font-semibold px-4 sm:px-8 py-3 text-sm sm:text-base flex-1 h-11"
                  >
                    <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    Open Event Toolkit
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(eventToolkitUrl);
                        alert('Link copied to clipboard!');
                      } catch (error) {
                        logger.error('Failed to copy:', error);
                      }
                    }}
                    className="border-brand-orange text-brand-orange hover:bg-orange-50 px-4 sm:px-6 py-3 font-medium h-11"
                  >
                    📋 Copy Link
                  </Button>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-blue-900 mb-2 text-sm sm:text-base">Shareable Link:</h3>
                  <code className="text-xs sm:text-sm bg-white px-2 sm:px-3 py-2 rounded border border-blue-200 block break-all">
                    {eventToolkitUrl}
                  </code>
                  <p className="text-xs sm:text-sm text-blue-700 mt-2">
                    Share this link with schools, churches, community groups, and individuals making sandwiches
                  </p>
                </div>

                {/* Embedded Toolkit - Hidden on mobile, show "Open" button instead */}
                <div className="border rounded-lg overflow-hidden flex-1 hidden sm:block">
                  <iframe
                    src={eventToolkitEmbed}
                    className="w-full h-full border-0"
                    style={{
                      minHeight: '600px',
                      height: '100%',
                    }}
                    title="Event Toolkit"
                    loading="eager"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="sm:hidden bg-gray-100 rounded-lg p-4 text-center">
                  <p className="text-sm text-gray-600 mb-3">For the best experience, open the toolkit in a new tab on mobile.</p>
                  <Button
                    onClick={() => window.open(eventToolkitUrl, '_blank')}
                    className="bg-brand-orange hover:bg-brand-orange-dark text-white h-11"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open Toolkit
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventory Calculator Tab */}
        <TabsContent value="calculator" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Calculator className="h-4 w-4 sm:h-5 sm:w-5 text-brand-primary" />
                Inventory Calculator
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Interactive tool for calculating sandwich inventory and planning
                quantities for collections
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 sm:p-6 pt-0 sm:pt-0">
              <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button
                    size="lg"
                    onClick={() => window.open(inventoryCalculatorUrl, '_blank')}
                    className="bg-brand-primary hover:bg-brand-primary-dark text-white font-semibold px-4 sm:px-8 py-3 text-sm sm:text-base flex-1 h-11"
                  >
                    <Calculator className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    Open Calculator
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => window.open(eventEstimatorUrl, '_blank')}
                    className="bg-brand-primary hover:bg-brand-primary-dark text-white font-semibold px-4 sm:px-8 py-3 text-sm sm:text-base flex-1 h-11"
                  >
                    <Calculator className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    Event Estimator
                  </Button>
                </div>

                {/* Embedded Calculator - Hidden on mobile */}
                <div className="border rounded-lg overflow-hidden flex-1 hidden sm:block">
                  <iframe
                    src={inventoryCalculatorEmbed}
                    className="w-full h-full border-0"
                    style={{
                      minHeight: '600px',
                      height: '100%',
                    }}
                    title="Inventory Calculator"
                    loading="eager"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="sm:hidden bg-gray-100 rounded-lg p-4 text-center">
                  <p className="text-sm text-gray-600 mb-3">For the best experience, open the calculator in a new tab on mobile.</p>
                  <Button
                    onClick={() => window.open(inventoryCalculatorUrl, '_blank')}
                    className="bg-brand-primary text-white h-11"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open Calculator
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Donation Receipt Tab */}
        <TabsContent value="donation-receipt" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                🧾 Donation Receipt Generator
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Generate donation receipts for in-kind donations to The Sandwich Project
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 sm:p-6 pt-0 sm:pt-0">
              <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button
                    size="lg"
                    onClick={() => window.open(donationReceiptUrl, '_blank')}
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 sm:px-8 py-3 text-sm sm:text-base flex-1 h-11"
                  >
                    <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    Open Receipt Generator
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(donationReceiptUrl);
                        alert('Link copied to clipboard!');
                      } catch (error) {
                        logger.error('Failed to copy:', error);
                      }
                    }}
                    className="border-green-600 text-green-600 hover:bg-green-50 px-4 sm:px-6 py-3 font-medium h-11"
                  >
                    📋 Copy Link
                  </Button>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-green-900 mb-2 text-sm sm:text-base">Shareable Link:</h3>
                  <code className="text-xs sm:text-sm bg-white px-2 sm:px-3 py-2 rounded border border-green-200 block break-all">
                    {donationReceiptUrl}
                  </code>
                  <p className="text-xs sm:text-sm text-green-700 mt-2">
                    Use this tool to generate tax-deductible donation receipts for in-kind donations
                  </p>
                </div>

                {/* Open in new tab — Replit SPAs cannot be embedded due to cross-origin restrictions */}
                <div className="bg-gray-50 rounded-lg p-6 text-center border border-gray-200">
                  <p className="text-sm text-gray-600 mb-3">This app opens in a new tab for the best experience.</p>
                  <Button
                    size="lg"
                    onClick={() => window.open(donationReceiptUrl, '_blank')}
                    className="bg-green-600 hover:bg-green-700 text-white h-12 px-8 text-base font-semibold"
                  >
                    <ExternalLink className="w-5 h-5 mr-2" />
                    Open Receipt Generator
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Donor Management Platform Tab */}
        <TabsContent value="donor-management" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Heart className="h-4 w-4 sm:h-5 sm:w-5 text-pink-500" />
                Donor Management Platform
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Track and manage donor relationships, donations, and engagement for The Sandwich Project
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 sm:p-6 pt-0 sm:pt-0">
              <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button
                    size="lg"
                    onClick={() => window.open(donorManagementUrl, '_blank')}
                    className="bg-pink-600 hover:bg-pink-700 text-white font-semibold px-4 sm:px-8 py-3 text-sm sm:text-base flex-1 h-11"
                  >
                    <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    Open Donor Platform
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(donorManagementUrl);
                        alert('Link copied to clipboard!');
                      } catch (error) {
                        logger.error('Failed to copy:', error);
                      }
                    }}
                    className="border-pink-600 text-pink-600 hover:bg-pink-50 px-4 sm:px-6 py-3 font-medium h-11"
                  >
                    📋 Copy Link
                  </Button>
                </div>

                <div className="bg-pink-50 border border-pink-200 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-pink-900 mb-2 text-sm sm:text-base">Platform Link:</h3>
                  <code className="text-xs sm:text-sm bg-white px-2 sm:px-3 py-2 rounded border border-pink-200 block break-all">
                    {donorManagementUrl}
                  </code>
                  <p className="text-xs sm:text-sm text-pink-700 mt-2">
                    Manage donor information, track donations, and build lasting relationships with supporters
                  </p>
                </div>

                {/* Feature highlights */}
                <div className="grid grid-cols-3 gap-2 sm:gap-4 p-3 sm:p-4 bg-gradient-to-br from-pink-50 to-purple-50 rounded-lg border">
                  <div className="text-center">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">👥 Profiles</p>
                    <p className="text-[10px] sm:text-xs text-gray-600">Donor info & history</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">💰 Tracking</p>
                    <p className="text-[10px] sm:text-xs text-gray-600">Log contributions</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">📊 Analytics</p>
                    <p className="text-[10px] sm:text-xs text-gray-600">Trends & insights</p>
                  </div>
                </div>

                {/* Open in new tab — Lovable SPAs cannot be embedded due to cross-origin restrictions */}
                <div className="bg-gray-50 rounded-lg p-6 text-center border border-gray-200">
                  <p className="text-sm text-gray-600 mb-3">This app opens in a new tab for the best experience.</p>
                  <Button
                    size="lg"
                    onClick={() => window.open(donorManagementUrl, '_blank')}
                    className="bg-pink-600 hover:bg-pink-700 text-white h-12 px-8 text-base font-semibold"
                  >
                    <ExternalLink className="w-5 h-5 mr-2" />
                    Open Donor Platform
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Internal Hub Tab */}
        <TabsContent value="internal-hub" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <LayoutDashboard className="h-4 w-4 sm:h-5 sm:w-5 text-[#236383]" />
                TSP Internal Hub
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Central resource portal with team tools, volunteer resources, and project tracking
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 sm:p-6 pt-0 sm:pt-0">
              <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button
                    size="lg"
                    onClick={() => window.open(internalHubUrl, '_blank')}
                    className="bg-[#236383] hover:bg-[#006670] text-white font-semibold px-4 sm:px-8 py-3 text-sm sm:text-base flex-1 h-11"
                  >
                    <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    Open Internal Hub
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(internalHubUrl);
                        alert('Link copied to clipboard!');
                      } catch (error) {
                        logger.error('Failed to copy:', error);
                      }
                    }}
                    className="border-[#236383] text-[#236383] hover:bg-[#236383]/10 px-4 sm:px-6 py-3 font-medium h-11"
                  >
                    📋 Copy Link
                  </Button>
                </div>

                {/* Feature highlights */}
                <div className="grid grid-cols-3 gap-2 sm:gap-4 p-3 sm:p-4 bg-gradient-to-br from-teal-50 to-cyan-50 rounded-lg border">
                  <div className="text-center">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">🛠️ Team Tools</p>
                    <p className="text-[10px] sm:text-xs text-gray-600">Ideas, projects & committees</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">📚 Volunteer</p>
                    <p className="text-[10px] sm:text-xs text-gray-600">Onboarding & handbooks</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">🍞 Food Safety</p>
                    <p className="text-[10px] sm:text-xs text-gray-600">Guidelines & training</p>
                  </div>
                </div>

                {/* Embedded Hub - Hidden on mobile */}
                <div className="border rounded-lg overflow-hidden flex-1 hidden sm:block">
                  <iframe
                    src={internalHubEmbed}
                    className="w-full h-full border-0"
                    style={{
                      minHeight: '600px',
                      height: '100%',
                    }}
                    title="TSP Internal Hub"
                    loading="eager"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="sm:hidden bg-gray-100 rounded-lg p-4 text-center">
                  <p className="text-sm text-gray-600 mb-3">For the best experience, open the internal hub in a new tab on mobile.</p>
                  <Button
                    onClick={() => window.open(internalHubUrl, '_blank')}
                    className="bg-[#236383] text-white h-11"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open Hub
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Events Google Sheet Tab */}
        <TabsContent value="events" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="pb-1 p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 mb-3">
                <CardTitle className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                  📅 Events Calendar Sheet
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshEvents}
                    disabled={isLoading}
                    className="flex items-center gap-1 sm:gap-2 h-9 text-xs sm:text-sm"
                  >
                    <RefreshCw
                      className={`h-3 w-3 sm:h-4 sm:w-4 ${isLoading ? 'animate-spin' : ''}`}
                    />
                    <span className="hidden sm:inline">Refresh</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(eventsFullViewUrl, '_blank')}
                    className="flex items-center gap-1 sm:gap-2 h-9 text-xs sm:text-sm"
                  >
                    <ExternalLink className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Open in New Tab</span>
                    <span className="sm:hidden">Open</span>
                  </Button>
                </div>
              </div>

              {/* Zoom Controls for Events - Hidden on mobile */}
              <div className="hidden sm:flex items-center gap-3 p-2 bg-gray-50 rounded-lg border">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEventsZoomOut}
                    disabled={eventsZoomLevel <= 50}
                    className="h-8 w-8 p-0"
                    title="Zoom Out"
                  >
                    <ZoomOut className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEventsZoomIn}
                    disabled={eventsZoomLevel >= 150}
                    className="h-8 w-8 p-0"
                    title="Zoom In"
                  >
                    <ZoomIn className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEventsResetZoom}
                    className="h-8 w-8 p-0"
                    title="Reset Zoom"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>

                <div className="flex items-center gap-3 flex-1">
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    Zoom:
                  </span>
                  <Slider
                    value={[eventsZoomLevel]}
                    onValueChange={handleEventsZoomChange}
                    max={150}
                    min={50}
                    step={5}
                    className="flex-1 max-w-32"
                  />
                  <span className="text-sm font-medium text-gray-900 min-w-[3rem]">
                    {eventsZoomLevel}%
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0 flex-1">
              {/* Desktop embedded view */}
              <div
                className="w-full relative overflow-hidden hidden sm:block"
                style={{ height: 'calc(100vh - 320px)', minHeight: '500px' }}
              >
                {isLoading && (
                  <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
                    <div className="flex items-center gap-2 text-gray-600">
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      Loading...
                    </div>
                  </div>
                )}

                <iframe
                  id="events-spreadsheet"
                  src={eventsEmbedUrl}
                  className="border-0 rounded-b-lg"
                  style={{
                    transform: `scale(${eventsZoomLevel / 100})`,
                    transformOrigin: 'top left',
                    width: `${100 / (eventsZoomLevel / 100)}%`,
                    height: `${100 / (eventsZoomLevel / 100)}%`,
                    minWidth: '1200px',
                    minHeight: '800px',
                  }}
                  title="Events Calendar"
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
              {/* Mobile: Show button to open in new tab */}
              <div className="sm:hidden p-4 bg-gray-100 rounded-lg mx-4 mb-4 text-center">
                <p className="text-sm text-gray-600 mb-3">Spreadsheets work best in full screen on mobile devices.</p>
                <Button
                  onClick={() => window.open(eventsFullViewUrl, '_blank')}
                  className="bg-brand-primary text-white h-11"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Events Sheet
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* User's Custom Google Sheet Tab */}
        <TabsContent value="user-sheet" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="pb-1 p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 mb-3">
                <div>
                  <CardTitle className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                    <LinkIcon className="h-4 w-4 sm:h-5 sm:w-5 text-brand-primary" />
                    Historical Collections
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Historical collections tracking spreadsheet
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshUserSheet}
                    disabled={isLoading}
                    className="flex items-center gap-1 sm:gap-2 h-9 text-xs sm:text-sm"
                  >
                    <RefreshCw
                      className={`h-3 w-3 sm:h-4 sm:w-4 ${isLoading ? 'animate-spin' : ''}`}
                    />
                    <span className="hidden sm:inline">Refresh</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(userSheetUrl, '_blank')}
                    className="flex items-center gap-1 sm:gap-2 h-9 text-xs sm:text-sm"
                  >
                    <ExternalLink className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Open in New Tab</span>
                    <span className="sm:hidden">Open</span>
                  </Button>
                </div>
              </div>

              {/* Direct Link Section */}
              <div className="mb-3 sm:mb-4 p-2 sm:p-3 bg-brand-primary-lighter rounded-lg border border-brand-primary-border">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-brand-primary-darker">
                      Direct Link Access
                    </p>
                    <p className="text-[10px] sm:text-xs text-brand-primary truncate">
                      {userSheetUrl}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => window.open(userSheetUrl, '_blank')}
                    className="bg-brand-primary hover:bg-brand-primary-dark text-white h-9 text-xs sm:text-sm"
                  >
                    <ExternalLink className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    Open Link
                  </Button>
                </div>
              </div>

              {/* Zoom Controls for User Sheet - Hidden on mobile */}
              <div className="hidden sm:flex items-center gap-3 p-2 bg-gray-50 rounded-lg border">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUserSheetZoomOut}
                    disabled={userSheetZoomLevel <= 50}
                    className="h-8 w-8 p-0"
                    title="Zoom Out"
                  >
                    <ZoomOut className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUserSheetZoomIn}
                    disabled={userSheetZoomLevel >= 150}
                    className="h-8 w-8 p-0"
                    title="Zoom In"
                  >
                    <ZoomIn className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUserSheetResetZoom}
                    className="h-8 w-8 p-0"
                    title="Reset Zoom"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>

                <div className="flex items-center gap-3 flex-1">
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    Zoom:
                  </span>
                  <Slider
                    value={[userSheetZoomLevel]}
                    onValueChange={handleUserSheetZoomChange}
                    max={150}
                    min={50}
                    step={5}
                    className="flex-1 max-w-32"
                  />
                  <span className="text-sm font-medium text-gray-900 min-w-[3rem]">
                    {userSheetZoomLevel}%
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0 flex-1">
              {/* Desktop embedded view */}
              <div
                className="w-full relative overflow-hidden hidden sm:block"
                style={{ height: 'calc(100vh - 280px)', minHeight: '500px' }}
              >
                {isLoading && (
                  <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
                    <div className="flex items-center gap-2 text-gray-600">
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      Loading...
                    </div>
                  </div>
                )}

                <iframe
                  id="user-spreadsheet"
                  src={userSheetEmbedUrl}
                  className="border-0 rounded-b-lg"
                  style={{
                    transform: `scale(${userSheetZoomLevel / 100})`,
                    transformOrigin: 'top left',
                    width: `${100 / (userSheetZoomLevel / 100)}%`,
                    height: `${100 / (userSheetZoomLevel / 100)}%`,
                    minWidth: '1200px',
                    minHeight: '800px',
                  }}
                  title="Historical Collections Record"
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
              {/* Mobile: Show button to open in new tab */}
              <div className="sm:hidden p-4 bg-gray-100 rounded-lg mx-4 mb-4 text-center">
                <p className="text-sm text-gray-600 mb-3">Spreadsheets work best in full screen on mobile devices.</p>
                <Button
                  onClick={() => window.open(userSheetUrl, '_blank')}
                  className="bg-brand-primary text-white h-11"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Collections Sheet
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* AI Assistant */}
      <FloatingAIChat
        contextType="links"
        title="Quick Tools Assistant"
        subtitle="Ask about spreadsheets and tools"
        contextData={{
          currentView: 'important-links',
          summaryStats: {
            totalTools: 6,
          },
        }}
        getFullContext={() => ({
          rawData: [
            { name: 'Volunteer Handbook', url: volunteerHandbookUrl, type: 'reference', description: "TSP's all-encompassing handbook for every volunteer role" },
            { name: 'Inventory Calculator', url: inventoryCalculatorUrl, type: 'tool' },
            { name: 'Event Estimator', url: eventEstimatorUrl, type: 'tool' },
            { name: 'Event Toolkit', url: eventToolkitUrl, type: 'tool' },
            { name: 'Donation Receipt Generator', url: donationReceiptUrl, type: 'tool', description: 'Generate tax-deductible donation receipts for in-kind donations' },
            { name: 'Donor Management Platform', url: donorManagementUrl, type: 'tool', description: 'Track and manage donor relationships, donations, and engagement' },
            { name: 'TSP Internal Hub', url: internalHubUrl, type: 'tool', description: 'Central resource portal with team tools, volunteer resources, and project tracking' },
          ],
        })}
        suggestedQuestions={[
          "What tools are available?",
          "How do I use the inventory calculator?",
          "How do I generate a donation receipt?",
          "What's in the event toolkit?",
          "How do I manage donors?",
        ]}
      />
    </div>
  );
}
