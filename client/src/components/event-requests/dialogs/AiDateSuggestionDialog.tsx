import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Calendar, CheckCircle2, AlertCircle, TrendingUp } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import type { EventRequest } from '@shared/schema';

interface NearbyEvent {
  organizationName: string;
  date: string;
  estimatedSandwichCount: number;
}

interface DateAnalysis {
  date: string;
  dayOfWeek: string;
  weekStarting: string;
  totalScheduledSandwiches: number;
  eventCount: number;
  isOptimal: boolean;
  nearbyEvents: NearbyEvent[];
}

interface AiSuggestion {
  recommendedDate: string;
  reasoning: string;
  dateAnalysis: DateAnalysis[];
  confidence: 'high' | 'medium' | 'low';
  originallyRequestedDate: string | null;
}

interface AiDateSuggestionDialogProps {
  open: boolean;
  onClose: () => void;
  eventRequest: EventRequest;
  onSelectDate?: (date: string) => void;
}

interface FlexibilityOptions {
  canChangeDayOfWeek: boolean;
  canChangeWeek: boolean;
  canChangeMonth: boolean;
}

export function AiDateSuggestionDialog({ 
  open, 
  onClose, 
  eventRequest,
  onSelectDate 
}: AiDateSuggestionDialogProps) {
  const { toast } = useToast();
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [showFlexibilityOptions, setShowFlexibilityOptions] = useState(false);
  const [flexibility, setFlexibility] = useState<FlexibilityOptions>({
    canChangeDayOfWeek: false,
    canChangeWeek: false,
    canChangeMonth: false,
  });

  const generateSuggestionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<AiSuggestion>(
        'POST',
        `/api/event-requests/${eventRequest.id}/ai-suggest-dates`,
        flexibility
      );
    },
    onSuccess: (data) => {
      setSuggestion(data);
    },
    onError: (error: Error) => {
      toast({
        title: 'AI Analysis Failed',
        description: error.message || 'Failed to generate date suggestions',
        variant: 'destructive',
      });
    },
  });

  const handleClose = () => {
    setSuggestion(null);
    onClose();
  };

  const handleSelectDate = (date: string) => {
    if (onSelectDate) {
      onSelectDate(date);
    }
    handleClose();
  };

  const formatDate = (dateStr: string) => {
    // Parse date at noon to avoid timezone edge cases
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
  };

  const formatWeek = (dateStr: string) => {
    // Parse date at noon to avoid timezone edge cases
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
  };

  const getConfidenceBadge = (confidence: 'high' | 'medium' | 'low') => {
    const colors = {
      high: 'bg-tsp-sky/15 text-tsp-teal dark:bg-tsp-navy dark:text-tsp-sky',
      medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      low: 'bg-[#FBAD3F]/20 text-[#FBAD3F] dark:bg-[#FBAD3F]/30 dark:text-[#FBAD3F]',
    };

    const icons = {
      high: '✓',
      medium: '○',
      low: '!',
    };

    const labels = {
      high: 'High Confidence',
      medium: 'Medium Confidence',
      low: 'Low Confidence',
    };

    return (
      <Badge className={`${colors[confidence]} text-sm font-semibold px-3 py-1`}>
        <span className="mr-1">{icons[confidence]}</span>
        {labels[confidence]}
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-[#236383]" />
            <DialogTitle className="text-lg sm:text-xl">AI Scheduling Assistant</DialogTitle>
          </div>
          <DialogDescription className="text-sm sm:text-base">
            Let AI analyze available dates and suggest the optimal time based on your current schedule
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6 mt-4">
          {/* Event Info */}
          <div className="bg-gray-50 dark:bg-gray-900 p-3 sm:p-4 rounded-lg border border-gray-200 dark:border-gray-800">
            <h3 className="font-semibold text-xs sm:text-sm mb-2 text-gray-700 dark:text-gray-300">Event Details</h3>
            <p className="text-sm sm:text-base">
              <span className="font-medium">{eventRequest.organizationName}</span>
              {eventRequest.estimatedSandwichCount && eventRequest.estimatedSandwichCount > 0 && (
                <span className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm">
                  {' '}• ~{eventRequest.estimatedSandwichCount.toLocaleString()} sandwiches
                </span>
              )}
            </p>
          </div>

          {/* Flexibility Selection or Generate */}
          {!suggestion && !generateSuggestionMutation.isPending && (
            <div className="space-y-6">
              {/* Flexibility Options */}
              <div className="bg-gradient-to-br from-[#236383]/5 to-[#47B3CB]/5 dark:from-[#236383]/10 dark:to-[#47B3CB]/10 p-6 rounded-xl border border-[#236383]/20">
                <div className="flex items-start gap-3 mb-4">
                  <AlertCircle className="h-5 w-5 text-[#236383] mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-[#236383] mb-2">Scheduling Flexibility</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                      Help the AI find the best date by letting us know what flexibility the organization has:
                    </p>
                  </div>
                </div>

                <div className="space-y-3 ml-8">
                  {/* Day of Week Flexibility */}
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={flexibility.canChangeDayOfWeek}
                      onChange={(e) => setFlexibility({ ...flexibility, canChangeDayOfWeek: e.target.checked })}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#236383] focus:ring-[#236383] cursor-pointer"
                    />
                    <div className="flex-1">
                      <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-[#236383]">
                        Can change day of the week
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        e.g., Move from Tuesday to Friday within the same week
                      </p>
                    </div>
                  </label>

                  {/* Week Flexibility */}
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={flexibility.canChangeWeek}
                      onChange={(e) => setFlexibility({ ...flexibility, canChangeWeek: e.target.checked })}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#236383] focus:ring-[#236383] cursor-pointer"
                    />
                    <div className="flex-1">
                      <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-[#236383]">
                        Can change to a different week
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        e.g., Move from the 2nd week to the 4th week of the month
                      </p>
                    </div>
                  </label>

                  {/* Month Flexibility */}
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={flexibility.canChangeMonth}
                      onChange={(e) => setFlexibility({ ...flexibility, canChangeMonth: e.target.checked })}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#236383] focus:ring-[#236383] cursor-pointer"
                    />
                    <div className="flex-1">
                      <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-[#236383]">
                        Can move to a different month
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        e.g., Move from November to December
                      </p>
                    </div>
                  </label>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <Button
                    onClick={() => generateSuggestionMutation.mutate()}
                    className="w-full bg-[#236383] hover:bg-[#1a4d66] text-white font-semibold py-3 shadow-md hover:shadow-lg transition-all"
                    data-testid="button-generate-ai-suggestion"
                  >
                    <Sparkles className="h-5 w-5 mr-2" />
                    Analyze Dates with AI
                  </Button>
                </div>
              </div>
            </div>
          )}

          {generateSuggestionMutation.isPending && (
            <div className="text-center py-8 sm:py-12 px-4">
              <div className="bg-gradient-to-br from-[#236383]/5 to-[#47B3CB]/5 dark:from-[#236383]/10 dark:to-[#47B3CB]/10 p-6 sm:p-8 rounded-xl border border-[#236383]/20">
                <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-b-2 border-[#236383] mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400 font-medium text-sm sm:text-base">
                  Analyzing dates and current schedule...
                </p>
                <p className="text-gray-500 dark:text-gray-500 text-xs sm:text-sm mt-2">
                  This may take a moment
                </p>
              </div>
            </div>
          )}

          {suggestion && (
            <div className="space-y-4 sm:space-y-6">
              {/* Originally Requested Date */}
              {suggestion.originallyRequestedDate && (
                <div className="bg-gray-50 dark:bg-gray-900 p-3 sm:p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <p className="text-xs sm:text-sm font-semibold text-gray-600 dark:text-gray-400">Originally Requested Date</p>
                  </div>
                  <p className="text-sm sm:text-base font-medium text-gray-800 dark:text-gray-200 pl-6">
                    {formatDate(suggestion.originallyRequestedDate)}
                  </p>
                </div>
              )}

              {/* AI Recommendation - Prominent Section */}
              <div className="bg-gradient-to-br from-[#236383] to-[#47B3CB] p-1 rounded-xl shadow-lg">
                <div className="bg-white dark:bg-gray-950 p-4 sm:p-6 rounded-lg">
                  {/* Header with Icon and Confidence Badge */}
                  <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6">
                    <div className="flex items-center gap-2">
                      <div className="bg-[#236383]/10 p-2 rounded-lg">
                        <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-[#236383]" />
                      </div>
                      <h3 className="font-bold text-lg sm:text-xl text-[#236383]">
                        AI Recommended Date
                      </h3>
                    </div>
                    {getConfidenceBadge(suggestion.confidence)}
                  </div>

                  {/* The Recommended Date - Extra Prominent with Day of Week */}
                  <div className="text-center py-4 sm:py-6 mb-4 sm:mb-6 bg-gradient-to-br from-[#236383]/5 to-[#47B3CB]/5 dark:from-[#236383]/10 dark:to-[#47B3CB]/10 rounded-lg border-2 border-[#236383]/20">
                    <div className="flex items-center justify-center gap-2 sm:gap-3 mb-2">
                      <Calendar className="h-6 w-6 sm:h-8 sm:w-8 text-[#236383]" />
                      <p className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#236383] leading-tight">
                        {new Date(suggestion.recommendedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' })}
                      </p>
                    </div>
                    <p className="text-xl sm:text-2xl font-semibold text-[#47B3CB] px-2">
                      {formatDate(suggestion.recommendedDate)}
                    </p>
                  </div>

                  {/* Scheduling Context for Recommended Date */}
                  {(() => {
                    const recommendedAnalysis = suggestion.dateAnalysis.find(
                      (a) => a.date === suggestion.recommendedDate
                    );
                    if (!recommendedAnalysis) return null;

                    return (
                      <div className="mb-4 sm:mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className="space-y-3">
                          {/* Week info */}
                          <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                              Week of {formatWeek(recommendedAnalysis.weekStarting)}
                            </p>
                            <div className="flex gap-4 text-sm">
                              <span className="text-gray-700 dark:text-gray-300">
                                📅 {recommendedAnalysis.eventCount} {recommendedAnalysis.eventCount === 1 ? 'event' : 'events'} scheduled
                              </span>
                              <span className="text-gray-700 dark:text-gray-300">
                                🥪 {recommendedAnalysis.totalScheduledSandwiches.toLocaleString()} sandwiches
                              </span>
                            </div>
                          </div>

                          {/* Nearby Events */}
                          {recommendedAnalysis.nearbyEvents && recommendedAnalysis.nearbyEvents.length > 0 && (
                            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Events scheduled this week:
                              </p>
                              <div className="pl-4 border-l-2 border-gray-300 dark:border-gray-600 space-y-1.5">
                                {recommendedAnalysis.nearbyEvents.map((event, eventIdx) => (
                                  <div key={eventIdx} className="flex items-start gap-2 text-sm">
                                    <span className="text-gray-400 mt-0.5">•</span>
                                    <div className="flex-1">
                                      <span className="font-medium text-gray-800 dark:text-gray-200">
                                        {event.organizationName}
                                      </span>
                                      <span className="text-gray-600 dark:text-gray-400">
                                        {' - '}
                                        {new Date(event.date).toLocaleDateString('en-US', { 
                                          weekday: 'long',
                                          month: 'short', 
                                          day: 'numeric' 
                                        })}
                                      </span>
                                      {event.estimatedSandwichCount > 0 && (
                                        <span className="text-gray-500 dark:text-gray-500">
                                          {' '}({event.estimatedSandwichCount.toLocaleString()} 🥪)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Reasoning - Clearly Secondary */}
                  <div className="mb-4 sm:mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="h-4 w-4 text-[#236383] flex-shrink-0" />
                      <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-300">
                        Why This Date?
                      </h4>
                    </div>
                    <div className="pl-6 text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed">
                      <p className="whitespace-pre-wrap">{suggestion.reasoning}</p>
                    </div>
                  </div>

                  {/* Action Button */}
                  {onSelectDate && (
                    <Button
                      onClick={() => handleSelectDate(suggestion.recommendedDate)}
                      className="w-full bg-[#236383] hover:bg-[#1a4d66] text-white font-semibold py-3 sm:py-4 text-base sm:text-lg shadow-md hover:shadow-lg transition-all"
                      data-testid="button-select-recommended-date"
                    >
                      <Calendar className="h-5 w-5 mr-2" />
                      Use Recommended Date ({formatDate(suggestion.recommendedDate).split(',')[0]})
                    </Button>
                  )}
                </div>
              </div>

              {/* Date Analysis Details - Secondary Section */}
              <div className="border-t pt-4 sm:pt-6">
                <h3 className="font-semibold text-sm sm:text-base mb-3 sm:mb-4 flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <TrendingUp className="h-4 w-4 text-gray-500" />
                  Additional Date Analysis
                </h3>
                <div className="space-y-2 sm:space-y-3">
                  {suggestion.dateAnalysis.map((analysis, idx) => (
                    <div
                      key={idx}
                      className={`p-3 sm:p-4 rounded-lg border transition-all ${
                        analysis.isOptimal
                          ? 'border-tsp-sky bg-tsp-sky/15 dark:border-tsp-teal dark:bg-tsp-navy'
                          : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                              <p className="font-medium text-sm sm:text-base">
                                <span className="text-[#236383] font-bold">{analysis.dayOfWeek}</span>
                                {' • '}
                                {formatDate(analysis.date)}
                              </p>
                              <div className="flex gap-2 flex-wrap">
                                {analysis.isOptimal && (
                                  <Badge className="bg-tsp-sky/15 text-tsp-teal dark:bg-tsp-navy dark:text-tsp-sky text-xs">
                                    Good Balance
                                  </Badge>
                                )}
                                {!analysis.isOptimal && analysis.eventCount > 3 && (
                                  <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs">
                                    Busy Week
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 space-y-1">
                              <p>Week of {formatWeek(analysis.weekStarting)}</p>
                              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                                <span className="whitespace-nowrap">
                                  📅 {analysis.eventCount} {analysis.eventCount === 1 ? 'event' : 'events'} scheduled
                                </span>
                                <span className="whitespace-nowrap">
                                  🥪 {analysis.totalScheduledSandwiches.toLocaleString()} sandwiches
                                </span>
                              </div>
                            </div>
                          </div>
                          {analysis.date === suggestion.recommendedDate && (
                            <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6 text-[#236383] flex-shrink-0 self-start" />
                          )}
                        </div>

                        {/* Nearby Events */}
                        {analysis.nearbyEvents && analysis.nearbyEvents.length > 0 && (
                          <div className="pl-4 border-l-2 border-gray-300 dark:border-gray-600">
                            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
                              Events scheduled this week:
                            </p>
                            <div className="space-y-1">
                              {analysis.nearbyEvents.map((event, eventIdx) => (
                                <div key={eventIdx} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
                                  <span className="text-gray-400">•</span>
                                  <div className="flex-1">
                                    <span className="font-medium">{event.organizationName}</span>
                                    {' - '}
                                    <span>{new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                                    {event.estimatedSandwichCount > 0 && (
                                      <span className="text-gray-500">
                                        {' '}({event.estimatedSandwichCount.toLocaleString()} 🥪)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-4 sm:pt-6 border-t mt-4 sm:mt-6">
            <Button
              variant="outline"
              onClick={handleClose}
              className="w-full sm:w-auto order-2 sm:order-1"
              data-testid="button-close-ai-dialog"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
