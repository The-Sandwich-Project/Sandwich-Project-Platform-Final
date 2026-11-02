import { useState, useEffect, useCallback } from 'react';

// Define all onboarding steps/tooltips in the app
export type OnboardingStep =
  | 'nav-badge-intro'           // First time seeing a navigation badge
  | 'team-chat-badge'           // Team chat has unread messages
  | 'gmail-badge'               // Gmail inbox has unread
  | 'notifications-badge'       // Notifications bell
  | 'event-reminders-badge'     // Event reminders
  | 'suggestions-badge'         // Suggestions/messaging
  | 'action-center-intro'       // Action center walkthrough
  | 'smart-search-intro'        // Smart search feature
  | 'holding-zone-intro'        // Holding zone explanation
  | 'project-threads-intro'     // Project threads
  | 'toolkit-apps-intro'        // Toolkit & Apps menu item (formerly Quick Tools)
  | 'status-definitions-review' // One-time prompt to review updated status definitions
  | 'chat-event-reply';         // First time a chat reply is pinned to an event

const STORAGE_KEY = 'sandwich-onboarding-completed';

interface OnboardingState {
  completedSteps: OnboardingStep[];
  lastUpdated: string;
}

function getStoredState(): OnboardingState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error reading onboarding state:', e);
  }
  return { completedSteps: [], lastUpdated: new Date().toISOString() };
}

function saveState(state: OnboardingState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Error saving onboarding state:', e);
  }
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(getStoredState);

  // Check if a step has been completed
  const isStepCompleted = useCallback((step: OnboardingStep): boolean => {
    return state.completedSteps.includes(step);
  }, [state.completedSteps]);

  // Check if a step should be shown (not completed yet)
  const shouldShowStep = useCallback((step: OnboardingStep): boolean => {
    return !state.completedSteps.includes(step);
  }, [state.completedSteps]);

  // Mark a step as completed
  const completeStep = useCallback((step: OnboardingStep): void => {
    setState(prev => {
      if (prev.completedSteps.includes(step)) {
        return prev;
      }
      const newState = {
        completedSteps: [...prev.completedSteps, step],
        lastUpdated: new Date().toISOString()
      };
      saveState(newState);
      return newState;
    });
  }, []);

  // Reset all onboarding (useful for testing or if user wants to see hints again)
  const resetOnboarding = useCallback((): void => {
    const newState = { completedSteps: [], lastUpdated: new Date().toISOString() };
    saveState(newState);
    setState(newState);
  }, []);

  // Reset a specific step
  const resetStep = useCallback((step: OnboardingStep): void => {
    setState(prev => {
      const newState = {
        completedSteps: prev.completedSteps.filter(s => s !== step),
        lastUpdated: new Date().toISOString()
      };
      saveState(newState);
      return newState;
    });
  }, []);

  // Get completion percentage
  const getCompletionPercentage = useCallback((): number => {
    const totalSteps = 10; // Update this if you add more steps
    return Math.round((state.completedSteps.length / totalSteps) * 100);
  }, [state.completedSteps]);

  return {
    completedSteps: state.completedSteps,
    isStepCompleted,
    shouldShowStep,
    completeStep,
    resetOnboarding,
    resetStep,
    getCompletionPercentage
  };
}

// Tooltip content configuration
export const onboardingContent: Record<OnboardingStep, { title: string; message: string; action?: string }> = {
  'nav-badge-intro': {
    title: 'You have unread items!',
    message: 'Red badges show how many unread messages or items are waiting for you. Click to check them out!',
    action: 'Got it!'
  },
  'chat-event-reply': {
    title: 'Replies stay linked to the event',
    message: 'Replies stay linked to this event so you both know what they\'re about. Tap ✕ to send a regular message instead.',
    action: 'Got it'
  },
  'team-chat-badge': {
    title: 'Team Chat',
    message: 'Real-time messaging with your team! You have unread messages waiting. Jump in to collaborate.',
    action: 'Open chat'
  },
  'gmail-badge': {
    title: 'Gmail Inbox',
    message: 'Your connected Gmail inbox has new emails. Stay on top of communications without leaving the app.',
    action: 'Check emails'
  },
  'notifications-badge': {
    title: 'Notifications',
    message: 'System alerts, mentions, and updates appear here. Don\'t miss important activity!',
    action: 'View all'
  },
  'event-reminders-badge': {
    title: 'Event Reminders',
    message: 'Upcoming events you\'ve subscribed to. Review and prepare for what\'s coming up!',
    action: 'See reminders'
  },
  'suggestions-badge': {
    title: 'Suggestions Inbox',
    message: 'Team members and volunteers have submitted ideas or feedback. Review and respond!',
    action: 'View suggestions'
  },
  'action-center-intro': {
    title: 'Your Action Center',
    message: 'Tasks and items that need your attention, prioritized by importance. Start here each day!',
    action: 'Explore'
  },
  'smart-search-intro': {
    title: 'Smart Search',
    message: 'AI-powered search to quickly find anything - events, people, documents, and more.',
    action: 'Try it'
  },
  'holding-zone-intro': {
    title: 'Holding Zone',
    message: 'Items awaiting review or approval. Requests, applications, and pending items live here.',
    action: 'Got it'
  },
  'project-threads-intro': {
    title: 'Project Threads',
    message: 'Email-style threads organized by project. Keep discussions focused and easy to find!',
    action: 'Explore'
  },
  'toolkit-apps-intro': {
    title: 'Toolkit & Apps',
    message: 'Your one-stop hub for the Event Toolkit, Flyers, Inventory Calculator, Donation Receipts, Donor Management, and more!',
    action: 'Check it out'
  },
  'status-definitions-review': {
    title: 'Status Definitions Updated',
    message: 'We\'ve simplified event statuses — Postponed has been removed. Please review the updated Status Definitions to make sure you\'re using the right status for each event.',
    action: 'Review Now'
  }
};
