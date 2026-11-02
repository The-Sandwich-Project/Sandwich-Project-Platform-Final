import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  HelpCircle,
  X,
  ChevronRight,
  ChevronLeft,
  Search,
  FolderOpen,
  Calendar,
  Clock,
  BarChart3,
  ListTodo,
  Users,
  PlayCircle,
  CheckCircle,
  MessageSquareWarning,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  TOURS,
  TOUR_CATEGORIES,
  getToursByCategory,
  searchTours,
  getTourById,
  type Tour,
  type TourStep,
  type TourCategory,
} from '@/lib/tourDefinitions';
import { logger } from '@/lib/logger';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@shared/unified-auth-utils';
import { useIssueReport } from '@/contexts/issue-report-context';

const CATEGORY_ICONS: Record<string, any> = {
  FolderOpen,
  Calendar,
  BarChart3,
  ListTodo,
  Users,
};

interface GuidedTourProps {
  onClose?: () => void;
}

// Read an in-progress tour persisted before a full-page navigation. Returns null
// (rather than a partially-restored state) if the tour no longer exists or the
// saved step index is out of range — e.g. after a tour's steps changed — so we
// never restore an activeTour whose currentStep would be undefined and leave the
// overlay stuck with no way to continue or complete.
function readPersistedTour(): { tour: Tour; stepIndex: number } | null {
  try {
    const stored = localStorage.getItem('guided-tour-active');
    if (!stored) return null;
    const { tourId, stepIndex } = JSON.parse(stored);
    const tour = getTourById(tourId);
    if (!tour) return null;
    const idx = typeof stepIndex === 'number' ? stepIndex : 0;
    if (idx < 0 || idx >= tour.steps.length) return null;
    return { tour, stepIndex: idx };
  } catch {
    return null;
  }
}

export function GuidedTour({ onClose }: GuidedTourProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Restore an in-progress tour after a full-page navigation. Some tours jump to
  // a route that isn't a sidebar item (e.g. Event Reminders), which requires a
  // real page load — without this, the active tour would be lost on the way there.
  // Persisted to localStorage by the "Save tour progress" effect below.
  const [activeTour, setActiveTour] = useState<Tour | null>(() => readPersistedTour()?.tour ?? null);
  const [currentStepIndex, setCurrentStepIndex] = useState(() => readPersistedTour()?.stepIndex ?? 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TourCategory | null>(null);
  const [completedTours, setCompletedTours] = useState<string[]>([]);
  const [isVisible, setIsVisible] = useState(true);
  const overlayRef = useRef<HTMLDivElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get user for permission checking
  const { user } = useAuth();
  const { openReportDialog } = useIssueReport();

  // Auto-hide on scroll down, show on scroll up or after scroll stops
  useEffect(() => {
    // Don't auto-hide when menu is open or tour is active
    if (showMenu || activeTour) {
      setIsVisible(true);
      return;
    }

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Hide when scrolling down, show when scrolling up
      if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
        setIsVisible(false);
      } else if (currentScrollY < lastScrollY.current) {
        setIsVisible(true);
      }
      
      lastScrollY.current = currentScrollY;
      
      // Show buttons after scrolling stops
      scrollTimeoutRef.current = setTimeout(() => {
        setIsVisible(true);
      }, 1500);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [showMenu, activeTour]);
  
  // Filter tours based on user permissions
  const availableTours = useMemo(() => {
    // If no user, show tours without permission or email requirements
    if (!user) {
      return TOURS.filter(tour => !tour.requiredPermission && !tour.allowedEmails);
    }
    
    // Spread the full user object to preserve all fields (role, permissions, legacyRole, etc.)
    // hasPermission uses getRolePermissions which needs the complete user shape
    const userForPermissions = {
      ...user,
      permissions: (user.permissions as string[] | null) ?? null,
    };
    
    return TOURS.filter(tour => {
      // If email-restricted, check email first
      if (tour.allowedEmails && tour.allowedEmails.length > 0) {
        if (!user.email || !tour.allowedEmails.includes(user.email.toLowerCase())) return false;
      }
      // If no permission required, tour is available to everyone
      if (!tour.requiredPermission) return true;
      // Check if user has the required permission
      return hasPermission(userForPermissions, tour.requiredPermission);
    });
  }, [user]);

  // Load completed tours from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('guided-tour-completed');
    if (stored) {
      try {
        setCompletedTours(JSON.parse(stored));
      } catch (e) {
        logger.error('Failed to load completed tours:', e);
      }
    }
  }, []);

  // Save completed tours to localStorage
  const markTourCompleted = useCallback((tourId: string) => {
    setCompletedTours(prev => {
      const updated = [...prev, tourId];
      localStorage.setItem('guided-tour-completed', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Save tour progress
  useEffect(() => {
    if (activeTour) {
      localStorage.setItem('guided-tour-active', JSON.stringify({
        tourId: activeTour.id,
        stepIndex: currentStepIndex,
      }));
    } else {
      localStorage.removeItem('guided-tour-active');
    }
  }, [activeTour, currentStepIndex]);

  const currentStep = activeTour?.steps[currentStepIndex];

  // Highlight target element
  useEffect(() => {
    if (!currentStep || !activeTour) return;

    const highlightElement = () => {
      const target = document.querySelector(currentStep.targetSelector);
      if (target && spotlightRef.current) {
        const rect = target.getBoundingClientRect();
        const padding = currentStep.highlightPadding || 8;
        
        spotlightRef.current.style.top = `${rect.top - padding}px`;
        spotlightRef.current.style.left = `${rect.left - padding}px`;
        spotlightRef.current.style.width = `${rect.width + padding * 2}px`;
        spotlightRef.current.style.height = `${rect.height + padding * 2}px`;
        spotlightRef.current.style.opacity = '1';
      }
    };

    const scrollToElement = () => {
      const target = document.querySelector(currentStep.targetSelector);
      if (target) {
        // Scroll element into view - use 'center' vertically to ensure visibility
        // but 'nearest' horizontally to prevent unwanted horizontal scrolling
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'center',    // Center vertically for visibility on long pages
          inline: 'nearest'   // Minimize horizontal scroll jumps
        });
        
        // Highlight after scroll completes
        setTimeout(highlightElement, 400);
      } else {
        // Element not found, try again after a delay
        setTimeout(scrollToElement, 200);
      }
    };

    // Execute beforeShow action if exists
    if (currentStep.beforeShow) {
      currentStep.beforeShow();
    }

    // Scroll to element first, then highlight
    // Wait longer if this step needs to wait for element to load (e.g., after filtering)
    const initialDelay = currentStep.waitForElement ? 800 : 300;
    setTimeout(scrollToElement, initialDelay);
    
    // Re-highlight on scroll/resize
    window.addEventListener('scroll', highlightElement, true);
    window.addEventListener('resize', highlightElement);
    
    return () => {
      window.removeEventListener('scroll', highlightElement, true);
      window.removeEventListener('resize', highlightElement);
    };
  }, [currentStep, activeTour]);

  // Keyboard navigation
  useEffect(() => {
    if (!activeTour) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeTour();
      } else if (e.key === 'ArrowRight' && currentStepIndex < activeTour.steps.length - 1) {
        nextStep();
      } else if (e.key === 'ArrowLeft' && currentStepIndex > 0) {
        previousStep();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTour, currentStepIndex]);

  const startTour = useCallback((tour: Tour) => {
    setActiveTour(tour);
    setCurrentStepIndex(0);
    setShowMenu(false);
    
    // Navigate if needed
    const firstStep = tour.steps[0];
    if (firstStep.navigationAction) {
      const { section } = firstStep.navigationAction;
      const navButton = document.querySelector(`[data-nav-id="${section}"]`);
      if (navButton instanceof HTMLElement) {
        navButton.click();
      }
    }
  }, []);

  // Allow other components (e.g. FirstLoginTourPrompt) to start a tour programmatically.
  useEffect(() => {
    const handleExternalStart = (event: Event) => {
      const tourId = (event as CustomEvent<{ tourId: string }>).detail?.tourId;
      if (!tourId) return;
      const tour = getTourById(tourId);
      if (!tour) return;
      if (!availableTours.some((t) => t.id === tour.id)) return;
      startTour(tour);
    };

    window.addEventListener('guided-tour:start', handleExternalStart);
    return () => window.removeEventListener('guided-tour:start', handleExternalStart);
  }, [availableTours, startTour]);

  const nextStep = useCallback(() => {
    if (!activeTour) return;
    
    if (currentStepIndex < activeTour.steps.length - 1) {
      const nextIndex = currentStepIndex + 1;
      const nextStepData = activeTour.steps[nextIndex];
      
      // Navigate if needed
      if (nextStepData.navigationAction) {
        const { section } = nextStepData.navigationAction;
        const navButton = document.querySelector(`[data-nav-id="${section}"]`);
        if (navButton instanceof HTMLElement) {
          navButton.click();
        }
      }
      
      setCurrentStepIndex(nextIndex);
    } else {
      // Tour completed
      markTourCompleted(activeTour.id);
      
      // Call afterComplete callback if defined
      if (activeTour.afterComplete) {
        activeTour.afterComplete();
      }
      
      closeTour();
    }
  }, [activeTour, currentStepIndex, markTourCompleted]);

  const previousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  }, [currentStepIndex]);

  const closeTour = useCallback(() => {
    setActiveTour(null);
    setCurrentStepIndex(0);
    if (spotlightRef.current) {
      spotlightRef.current.style.opacity = '0';
    }
  }, []);

  const toggleMenu = useCallback(() => {
    setShowMenu(prev => !prev);
    setIsOpen(prev => !prev);
  }, []);

  // Filter tours by search query and category, but only from available tours (permission-filtered)
  const filteredTours = useMemo(() => {
    let tours = availableTours;
    
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase().trim();
      tours = tours.filter(tour => 
        tour.title.toLowerCase().includes(lowerQuery) ||
        tour.description.toLowerCase().includes(lowerQuery) ||
        tour.steps.some(step => 
          step.title.toLowerCase().includes(lowerQuery) ||
          step.description.toLowerCase().includes(lowerQuery)
        )
      );
    } else if (selectedCategory) {
      tours = tours.filter(tour => tour.category === selectedCategory);
    }
    
    return tours;
  }, [availableTours, searchQuery, selectedCategory]);

  const isTourCompleted = (tourId: string) => completedTours.includes(tourId);

  return (
    <>
      {/* Floating Help Button */}
      <Button
        onClick={toggleMenu}
        className={cn(
          "fixed bottom-[calc(1rem+var(--chat-dock-height,0px))] right-4 w-11 h-11 rounded-full shadow-2xl z-50",
          "bg-gradient-to-br from-[#236383] to-[#007e8c] hover:from-[#1a4d66] hover:to-[#006270]",
          "text-white transition-all duration-300 hover:scale-110 hover:h-14 hover:w-14 active:scale-95",
          "border-2 border-white/20 hover:shadow-xl",
          isVisible || showMenu || activeTour ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}
        aria-label="Open guided tour"
        data-testid="tour-help-button"
      >
        <HelpCircle className="w-5 h-5 transition-transform duration-300 hover:scale-110" />
      </Button>

      {/* Tour Menu */}
      {showMenu && (
        <div
          className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity"
          onClick={toggleMenu}
        >
          <Card
            className="fixed bottom-[calc(5rem+var(--chat-dock-height,0px))] right-4 w-[calc(100vw-3rem)] sm:w-96 md:w-[440px] max-w-[calc(100vw-3rem)] shadow-2xl z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="pb-4 bg-gradient-to-r from-[#236383] to-[#007e8c] text-white rounded-t-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <HelpCircle className="w-6 h-6" />
                  <CardTitle className="text-xl">What are you looking for?</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleMenu}
                  className="text-white hover:bg-white/20"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
              
              {/* Search */}
              <div className="mt-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
                <Input
                  placeholder="Search tours..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-white/60"
                  data-testid="tour-search"
                />
              </div>
            </CardHeader>

            <CardContent className="p-4">
              {/* Categories - only show categories that have at least one available tour */}
              {!searchQuery && (
                <div className="mb-4 flex flex-wrap gap-2">
                  <Button
                    variant={selectedCategory === null ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCategory(null)}
                    className="text-xs"
                  >
                    All Tours
                  </Button>
                  {Object.entries(TOUR_CATEGORIES).map(([key, category]) => {
                    // Only show category if user has access to at least one tour in it
                    const hasToursInCategory = availableTours.some(tour => tour.category === key);
                    if (!hasToursInCategory) return null;
                    
                    const IconComponent = CATEGORY_ICONS[category.icon];
                    return (
                      <Button
                        key={key}
                        variant={selectedCategory === key ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedCategory(key as TourCategory)}
                        className="text-xs"
                      >
                        {IconComponent && <IconComponent className="w-3 h-3 mr-1" />}
                        {category.label}
                      </Button>
                    );
                  })}
                </div>
              )}

              {/* Tour List */}
              <ScrollArea className="h-[320px] pr-4">
                <div className="space-y-2">
                  {availableTours.length === 0 ? (
                    <div className="text-center py-8">
                      <HelpCircle className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No guided tours are currently available for your account.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Tours are based on the features you have access to.
                      </p>
                    </div>
                  ) : filteredTours.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No tours found matching your search. Try a different term.
                    </p>
                  ) : (
                    filteredTours.map((tour) => {
                      const isCompleted = isTourCompleted(tour.id);
                      return (
                        <button
                          key={tour.id}
                          onClick={() => startTour(tour)}
                          className={cn(
                            "w-full text-left p-3 rounded-lg border transition-all",
                            "hover:border-[#236383] hover:bg-[#236383]/5",
                            "focus:outline-none focus:ring-2 focus:ring-[#236383]/50",
                            isCompleted && "bg-green-50 border-green-200"
                          )}
                          data-testid={`tour-${tour.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-sm truncate">
                                  {tour.title}
                                </h3>
                                {isCompleted && (
                                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {tour.description}
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                <Badge
                                  variant="secondary"
                                  className="text-xs bg-[#007e8c]/10 text-[#007e8c] hover:bg-[#007e8c]/20"
                                >
                                  {TOUR_CATEGORIES[tour.category].label}
                                </Badge>
                                {tour.estimatedTime && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {tour.estimatedTime}
                                  </span>
                                )}
                              </div>
                            </div>
                            <PlayCircle className="w-5 h-5 text-[#236383] flex-shrink-0 mt-1" />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>

              <div className="mt-4 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start gap-2 text-amber-800 border-amber-200 hover:bg-amber-50"
                  onClick={() => {
                    setShowMenu(false);
                    openReportDialog();
                  }}
                  data-testid="report-problem-button"
                >
                  <MessageSquareWarning className="h-4 w-4" />
                  Report a problem
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Tour Overlay */}
      {activeTour && currentStep && (
        <>
          {/* Dark Overlay */}
          <div
            ref={overlayRef}
            className="fixed inset-0 bg-black/30 z-[60] transition-opacity pointer-events-none"
            aria-hidden="true"
          />

          {/* Spotlight */}
          <div
            ref={spotlightRef}
            className="fixed z-[61] pointer-events-none transition-all duration-300 rounded-lg"
            style={{
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.3)',
              opacity: 0,
            }}
            aria-hidden="true"
          />

          {/* Tour Step Card */}
          <div className="fixed inset-0 z-[62] flex items-center justify-center p-4 pointer-events-none">
            <Card
              className={cn(
                "w-full max-w-lg shadow-2xl pointer-events-auto",
                "bg-white border-2 border-[#fbad3f]",
                currentStep.position === 'top' && "mb-auto mt-20",
                currentStep.position === 'bottom' && "mt-auto mb-20",
                currentStep.position === 'left' && "mr-auto ml-20",
                currentStep.position === 'right' && "ml-auto mr-20"
              )}
              role="dialog"
              aria-labelledby="tour-step-title"
              aria-describedby="tour-step-description"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="bg-[#236383] text-white">
                        Step {currentStepIndex + 1} of {activeTour.steps.length}
                      </Badge>
                      <Badge variant="outline" className="text-[#007e8c] border-[#007e8c]">
                        {activeTour.title}
                      </Badge>
                    </div>
                    <CardTitle id="tour-step-title" className="text-xl text-[#236383]">
                      {currentStep.title}
                    </CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={closeTour}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close tour"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              </CardHeader>

              <CardContent>
                <p id="tour-step-description" className="text-sm text-muted-foreground mb-6">
                  {currentStep.description}
                </p>

                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#236383] to-[#007e8c] transition-all duration-300"
                      style={{
                        width: `${((currentStepIndex + 1) / activeTour.steps.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Navigation Buttons */}
                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    onClick={closeTour}
                    className="flex-1"
                    data-testid="tour-skip"
                  >
                    Skip Tour
                  </Button>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={previousStep}
                      disabled={currentStepIndex === 0}
                      className="px-3"
                      aria-label="Previous step"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    
                    <Button
                      onClick={nextStep}
                      className="bg-gradient-to-r from-[#236383] to-[#007e8c] hover:from-[#1a4d66] hover:to-[#006270] text-white px-6"
                      data-testid="tour-next"
                    >
                      {currentStepIndex === activeTour.steps.length - 1 ? (
                        <>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Complete
                        </>
                      ) : (
                        <>
                          Next
                          <ChevronRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Keyboard Hints */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-xs text-muted-foreground text-center">
                    Use <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs">←</kbd> <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs">→</kbd> to navigate, <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs">ESC</kbd> to close
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
