import React, { useState, useEffect, useRef } from 'react';
import {
  HelpCircle,
  Lightbulb,
  Target,
  TrendingUp,
  Users,
  Calendar,
  FileText,
  Settings,
  ChevronRight,
  ChevronLeft,
  X,
  CheckCircle,
  Info,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { UserContext } from './useSmartGuide';
import { logger } from '@/lib/logger';

// Define comprehensive guide content based on user context
export interface GuideStep {
  id: string;
  title: string;
  description: string;
  element?: string; // CSS selector or data attribute
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
  type: 'tip' | 'feature' | 'warning' | 'success' | 'onboarding';
  icon: React.ReactNode;
  promotion?: string; // Promotional text like "NEW!", "Popular", "Pro Tip!"
  actions?: {
    primary?: { label: string; action: () => void };
    secondary?: { label: string; action: () => void };
  };
  condition?: (context: UserContext) => boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

// UserContext is now imported from useSmartGuide

export interface GuideSequence {
  id: string;
  name: string;
  description: string;
  promotion?: string; // Promotional text for the entire sequence
  steps: GuideStep[];
  trigger: 'manual' | 'auto' | 'contextual';
  targetRoles: string[];
  category:
    | 'onboarding'
    | 'feature-discovery'
    | 'productivity'
    | 'troubleshooting';
}

interface SmartTooltipGuideProps {
  userContext: UserContext;
  className?: string;
  showGlobalGuide?: boolean;
}

const stepTypeIcons = {
  tip: <Lightbulb className="w-4 h-4 text-yellow-500" />,
  feature: <Sparkles className="w-4 h-4 text-blue-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-orange-500" />,
  success: <CheckCircle className="w-4 h-4 text-green-500" />,
  onboarding: <Target className="w-4 h-4 text-purple-500" />,
};

const stepTypeStyles = {
  tip: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  feature: 'bg-brand-primary-lighter border-brand-primary-border text-brand-primary-darker',
  warning: 'bg-orange-50 border-orange-200 text-orange-900',
  success: 'bg-green-50 border-green-200 text-green-900',
  onboarding: 'bg-purple-50 border-purple-200 text-purple-900',
};

// Smart contextual guide sequences based on user role and activity
const createGuideSequences = (context: UserContext): GuideSequence[] => {
  const sequences: GuideSequence[] = [];

  // New User Onboarding
  if (context.firstTimeUser || !context.hasCompletedOnboarding) {
    sequences.push({
      id: 'new-user-onboarding',
      name: 'Welcome to The Sandwich Project',
      description:
        'Get started with the basics of managing sandwich collections',
      trigger: 'auto',
      targetRoles: ['volunteer', 'host', 'core_team', 'admin'],
      category: 'onboarding',
      steps: [
        {
          id: 'welcome',
          title: 'Welcome to The Sandwich Project!',
          description:
            "This platform helps you track sandwich collections and make a real impact in your community. Let's get you started!",
          position: 'center',
          type: 'onboarding',
          icon: <Target className="w-5 h-5" />,
          priority: 'high',
        },
        {
          id: 'navigation',
          title: 'Navigate the Dashboard',
          description:
            'Use the sidebar to access different sections. Collections, Reports, and Messaging are your main areas.',
          element: '[data-guide="main-navigation"]',
          position: 'right',
          type: 'tip',
          icon: <Target className="w-5 h-5" />,
          priority: 'high',
        },
      ],
    });
  }

  // Role-specific guides
  if (context.role === 'volunteer' || context.role === 'host') {
    sequences.push({
      id: 'collection-basics',
      name: 'Recording Collections',
      description: 'Learn how to record sandwich collections efficiently',
      trigger: 'contextual',
      targetRoles: ['volunteer', 'host'],
      category: 'feature-discovery',
      steps: [
        {
          id: 'add-collection',
          title: 'Add Collection Data',
          description:
            'Click "Record New Collection" to start entering sandwich numbers. You can use either the quick form or step-by-step walkthrough.',
          element: '[data-guide="add-collection"]',
          position: 'bottom',
          type: 'feature',
          icon: <FileText className="w-5 h-5" />,
          priority: 'medium',
          actions: {
            primary: {
              label: 'Try It Now',
              action: () => logger.log('Navigate to collections'),
            },
          },
        },
        {
          id: 'walkthrough-vs-quick',
          title: 'Choose Your Entry Method',
          description:
            'New to collections? Use the step-by-step walkthrough. Experienced? The quick form is perfect for fast data entry.',
          element: '[data-guide="entry-method"]',
          position: 'top',
          type: 'tip',
          icon: <TrendingUp className="w-5 h-5" />,
          priority: 'medium',
        },
      ],
    });
  }

  // Admin/Core Team guides
  if (context.role === 'admin' || context.role === 'core_team') {
    sequences.push({
      id: 'admin-features',
      name: 'Administrative Tools',
      description: 'Discover powerful tools for managing the organization',
      trigger: 'manual',
      targetRoles: ['admin', 'core_team'],
      category: 'feature-discovery',
      steps: [
        {
          id: 'user-management',
          title: 'Manage Team Members',
          description:
            'Add new users, assign roles, and manage permissions from the User Management section.',
          element: '[data-guide="user-management"]',
          position: 'left',
          type: 'feature',
          icon: <Users className="w-5 h-5" />,
          priority: 'medium',
        },
        {
          id: 'reports-analytics',
          title: 'Analytics Dashboard',
          description:
            'Generate comprehensive reports and track community impact with detailed analytics.',
          element: '[data-guide="analytics"]',
          position: 'bottom',
          type: 'feature',
          icon: <TrendingUp className="w-5 h-5" />,
          priority: 'medium',
        },
      ],
    });
  }

  // Productivity tips for experienced users
  if (!context.firstTimeUser && context.recentActivity.length > 10) {
    sequences.push({
      id: 'productivity-tips',
      name: 'Pro Tips',
      description: 'Advanced features to boost your productivity',
      promotion: 'Popular',
      trigger: 'contextual',
      targetRoles: ['volunteer', 'host', 'core_team', 'admin'],
      category: 'productivity',
      steps: [
        {
          id: 'keyboard-shortcuts',
          title: 'Keyboard Shortcuts',
          description:
            'Use Ctrl+K to quickly search, Ctrl+N for new collection, and Ctrl+R for reports.',
          position: 'center',
          type: 'tip',
          icon: <Sparkles className="w-5 h-5" />,
          promotion: 'Pro Tip!',
          priority: 'low',
        },
        {
          id: 'bulk-operations',
          title: 'Bulk Data Entry',
          description:
            'Upload CSV files or use copy-paste for multiple collections at once.',
          element: '[data-guide="bulk-entry"]',
          position: 'top',
          type: 'feature',
          icon: <FileText className="w-5 h-5" />,
          promotion: 'Time Saver!',
          priority: 'medium',
        },
      ],
    });
  }

  return sequences.filter(
    (seq) =>
      seq.targetRoles.includes(context.role) &&
      seq.steps.every((step) => !step.condition || step.condition(context))
  );
};

export function SmartTooltipGuide({
  userContext,
  className = '',
  showGlobalGuide = false,
}: SmartTooltipGuideProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [activeSequence, setActiveSequence] = useState<GuideSequence | null>(
    null
  );
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSequences, setCompletedSequences] = useState<string[]>([]);
  const guideRef = useRef<HTMLDivElement>(null);

  const sequences = createGuideSequences(userContext);
  const availableSequences = sequences.filter(
    (seq) => !completedSequences.includes(seq.id)
  );

  useEffect(() => {
    // Auto-trigger sequences based on context
    const autoSequence = sequences.find(
      (seq) => seq.trigger === 'auto' && !completedSequences.includes(seq.id)
    );

    if (autoSequence && userContext.firstTimeUser) {
      setTimeout(() => {
        setActiveSequence(autoSequence);
        setIsVisible(true);
      }, 1000);
    }
  }, [userContext, sequences, completedSequences]);

  const handleNextStep = () => {
    if (!activeSequence) return;

    if (currentStepIndex < activeSequence.steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      // Sequence completed
      setCompletedSequences((prev) => [...prev, activeSequence.id]);
      setActiveSequence(null);
      setCurrentStepIndex(0);
      setIsVisible(false);
    }
  };

  const handlePreviousStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleSkipSequence = () => {
    if (!activeSequence) return;
    setCompletedSequences((prev) => [...prev, activeSequence.id]);
    setActiveSequence(null);
    setCurrentStepIndex(0);
    setIsVisible(false);
  };

  const handleStartSequence = (sequence: GuideSequence) => {
    setActiveSequence(sequence);
    setCurrentStepIndex(0);
    setIsVisible(true);
  };

  const currentStep = activeSequence?.steps[currentStepIndex];

  return (
    <div className={`smart-tooltip-guide ${className}`}>
      {/* Guide Launcher Button */}
      {!isVisible && availableSequences.length > 0 && (
        <Button
          variant="outline"
          size="default"
          className="fixed bottom-[calc(1.5rem+var(--chat-dock-height,0px))] right-6 z-40 bg-gradient-to-r from-[#FBAD3F] to-yellow-500 text-white hover:from-[#FBAD3F]/90 hover:to-yellow-500/90 border-0 shadow-xl rounded-full px-5 py-6 h-auto flex-col gap-1"
          onClick={() => setIsVisible(true)}
          title="Interactive tutorials and guided walkthroughs"
        >
          <HelpCircle className="w-6 h-6" />
          <span className="text-xs font-medium">Guided Tours</span>
        </Button>
      )}

      {/* Main Guide Interface */}
      {isVisible && (
        <div className="fixed inset-0 z-50 bg-black/20 flex items-center justify-center p-4">
          <Card
            ref={guideRef}
            className="w-full max-w-lg bg-white shadow-2xl border-0"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-slate-900">
                      {activeSequence ? activeSequence.name : 'Smart Guide'}
                    </CardTitle>
                    {activeSequence && (
                      <p className="text-sm text-slate-600 mt-1">
                        {activeSequence.description}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsVisible(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Progress indicator for active sequence */}
              {activeSequence && (
                <div className="mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-slate-600">
                      Step {currentStepIndex + 1} of{' '}
                      {activeSequence.steps.length}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {activeSequence.category}
                    </Badge>
                  </div>
                  <Progress
                    value={
                      ((currentStepIndex + 1) / activeSequence.steps.length) *
                      100
                    }
                    className="h-2"
                  />
                </div>
              )}
            </CardHeader>

            <CardContent>
              {/* Show available sequences if no active sequence */}
              {!activeSequence && (
                <div className="space-y-4">
                  <div className="text-center text-slate-600 mb-4">
                    <Info className="w-8 h-8 mx-auto mb-2 text-teal-600" />
                    <p className="text-sm">
                      Choose a guide to get started, or explore features at your
                      own pace.
                    </p>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {availableSequences.map((sequence) => (
                      <div
                        key={sequence.id}
                        className={`p-3 border rounded-lg hover:bg-slate-50 cursor-pointer transition-all relative ${
                          sequence.promotion ? 'ring-2 ring-[#FBAD3F]/30 hover:ring-[#FBAD3F]/50' : ''
                        }`}
                        onClick={() => handleStartSequence(sequence)}
                      >
                        {sequence.promotion && (
                          <div className="absolute -top-2 -right-2 z-10">
                            <Badge className="bg-gradient-to-r from-[#FBAD3F] to-yellow-500 text-white font-bold px-2 py-0.5 text-xs shadow-lg animate-pulse">
                              {sequence.promotion}
                            </Badge>
                          </div>
                        )}
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-medium text-slate-900 text-sm">
                              {sequence.name}
                            </h4>
                            <p className="text-xs text-slate-600 mt-1">
                              {sequence.description}
                            </p>
                            <div className="flex gap-2 mt-2">
                              <Badge variant="secondary" className="text-xs">
                                {sequence.steps.length} steps
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  sequence.category === 'onboarding'
                                    ? 'border-purple-200 text-purple-700'
                                    : sequence.category === 'feature-discovery'
                                      ? 'border-brand-primary-border text-brand-primary'
                                      : sequence.category === 'productivity'
                                        ? 'border-green-200 text-green-700'
                                        : 'border-orange-200 text-orange-700'
                                }`}
                              >
                                {sequence.category}
                              </Badge>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
                        </div>
                      </div>
                    ))}

                    {availableSequences.length === 0 && (
                      <div className="text-center py-8 text-slate-500">
                        <CheckCircle className="w-8 h-8 mx-auto mb-2" />
                        <p className="text-sm">All guides completed!</p>
                        <p className="text-xs mt-1">
                          You're all set. Keep up the great work!
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Show current step if sequence is active */}
              {currentStep && (
                <div className="space-y-4">
                  <div
                    className={`p-4 rounded-lg border relative ${
                      stepTypeStyles[currentStep.type]
                    } ${currentStep.promotion ? 'ring-2 ring-[#FBAD3F]/40' : ''}`}
                  >
                    {currentStep.promotion && (
                      <div className="absolute -top-2 -right-2 z-10">
                        <Badge className="bg-gradient-to-r from-[#FBAD3F] to-yellow-500 text-white font-bold px-2 py-0.5 text-xs shadow-lg">
                          {currentStep.promotion}
                        </Badge>
                      </div>
                    )}
                    <div className="flex items-start gap-3">
                      {stepTypeIcons[currentStep.type]}
                      <div className="flex-1">
                        <h4 className="font-semibold text-sm mb-2">
                          {currentStep.title}
                        </h4>
                        <p className="text-sm leading-relaxed">
                          {currentStep.description}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Step actions */}
                  {currentStep.actions && (
                    <div className="flex gap-2">
                      {currentStep.actions.primary && (
                        <Button
                          size="sm"
                          onClick={currentStep.actions.primary.action}
                          className="flex-1"
                        >
                          {currentStep.actions.primary.label}
                        </Button>
                      )}
                      {currentStep.actions.secondary && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={currentStep.actions.secondary.action}
                          className="flex-1"
                        >
                          {currentStep.actions.secondary.label}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Navigation buttons */}
                  <div className="flex justify-between items-center pt-2 border-t">
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handlePreviousStep}
                        disabled={currentStepIndex === 0}
                        className="text-slate-600"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSkipSequence}
                        className="text-slate-600"
                      >
                        Skip Guide
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleNextStep}
                        className="bg-teal-600 hover:bg-teal-700"
                      >
                        {currentStepIndex === activeSequence.steps.length - 1
                          ? 'Complete'
                          : 'Next'}
                        {currentStepIndex < activeSequence.steps.length - 1 && (
                          <ChevronRight className="w-4 h-4 ml-1" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
