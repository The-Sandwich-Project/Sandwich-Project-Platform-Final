import * as React from 'react';
import {
  HelpCircle,
  X,
  Heart,
  Users,
  Calendar,
  BarChart3,
  MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface HelpBubbleProps {
  title: string;
  content: string;
  character?: 'sandy' | 'helper' | 'guide' | 'coordinator';
  position?: 'top' | 'bottom' | 'left' | 'right';
  trigger?: 'hover' | 'click';
  className?: string;
  children: React.ReactNode;
}

interface Character {
  avatar: string;
  color: string;
}

const characters: Record<string, Character> = {
  sandy: {
    avatar: '🥪',
    color: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  },
  helper: {
    avatar: '🤝',
    color: 'bg-brand-primary-lighter border-brand-primary-border text-brand-primary-dark',
  },
  guide: {
    avatar: '🧭',
    color: 'bg-green-50 border-green-200 text-green-800',
  },
  coordinator: {
    avatar: '📋',
    color: 'bg-purple-50 border-purple-200 text-purple-800',
  },
};

export const HelpBubble: React.FC<HelpBubbleProps> = ({
  title,
  content,
  character = 'sandy',
  position = 'top',
  trigger = 'hover',
  className = '',
  children,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const characterData = characters[character] || characters['sandy'];

  const positionClasses = {
    top: 'bottom-full left-1/2 transform -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 transform -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 transform -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 transform -translate-y-1/2 ml-2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 transform -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-yellow-200',
    bottom:
      'bottom-full left-1/2 transform -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-yellow-200',
    left: 'left-full top-1/2 transform -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-yellow-200',
    right:
      'right-full top-1/2 transform -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-yellow-200',
  };

  const handleTrigger = () => {
    if (trigger === 'click') {
      setIsOpen(!isOpen);
    }
  };

  const handleMouseEnter = () => {
    if (trigger === 'hover') {
      setIsOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (trigger === 'hover') {
      setIsOpen(false);
    }
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <div
        onClick={handleTrigger}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="cursor-help"
      >
        {children}
      </div>

      {isOpen && (
        <div className={`absolute z-50 ${positionClasses[position]}`}>
          <Card
            className={`p-4 shadow-lg border-2 max-w-xs ${characterData.color}`}
          >
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none">{characterData.avatar}</span>
                <h5 className="font-medium text-sm flex-1">{title}</h5>
                {trigger === 'click' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                    className="ml-auto p-1 h-6 w-6 -mt-1"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
              <p className="text-sm leading-relaxed">{content}</p>
            </div>
          </Card>

          {/* Arrow */}
          <div
            className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`}
          />
        </div>
      )}
    </div>
  );
};

// Contextual help content for different sections
export const helpContent = {
  collections: {
    enterData: {
      title: 'Recording Your Collection',
      content:
        "Hi there! I'm here to help you record sandwich collections. Just fill in the details about where and when you collected sandwiches. Don't worry if you make a mistake - you can always edit it later!",
      character: 'sandy' as const,
    },

    bulkImport: {
      title: 'Importing Multiple Collections',
      content:
        "Need to add lots of collections at once? I can help you upload a CSV file! Make sure your file has columns for date, host, and sandwich counts. I'll guide you through any issues.",
      character: 'helper' as const,
    },

    filters: {
      title: 'Finding Specific Collections',
      content:
        "Looking for something specific? Use these filters to narrow down your search. You can filter by date range, host, or even search for specific text. It's like having a super-powered search!",
      character: 'guide' as const,
    },

    stats: {
      title: 'Understanding Your Impact',
      content:
        "These numbers show the amazing work you're doing! Each sandwich represents someone fed, and I'm here to help you track that impact over time.",
      character: 'sandy' as const,
    },
  },

  dashboard: {
    welcome: {
      title: 'Welcome to Your Dashboard',
      content:
        'This is your command center! From here, you can see recent activity, quick stats, and jump to any section you need. Think of me as your friendly guide around here.',
      character: 'coordinator' as const,
    },
  },

  messaging: {
    compose: {
      title: 'Staying Connected',
      content:
        "Communication is key to our mission! Use this to send messages to team members, share updates, or ask for help. We're all in this together!",
      character: 'helper' as const,
    },
  },

  analytics: {
    charts: {
      title: 'Your Data Story',
      content:
        "These charts tell the story of your impact! I love helping people understand their data - each trend and pattern shows how you're making a difference in the community.",
      character: 'guide' as const,
    },
  },
};

// Quick Help Component for floating help button
export const QuickHelp: React.FC<{ section: string }> = ({ section }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const getSectionHelp = () => {
    switch (section) {
      case 'collections':
        return {
          title: 'Collections Help',
          tips: [
            "Click 'Enter New Collection Data' to record sandwiches",
            'Use filters to find specific collections quickly',
            'Export data for reports using the Data button',
            'Edit collections by clicking the edit icon',
          ],
        };
      case 'dashboard':
        return {
          title: 'Dashboard Help',
          tips: [
            'View quick stats at the top of each section',
            'Use the navigation menu to jump between sections',
            'Check notifications for important updates',
            'Your recent activity shows your latest contributions',
          ],
        };
      case 'meetings':
        return {
          title: 'Meeting Management Help',
          tips: [
            'Access meeting minutes, agendas, and calendar all in one place',
            'Use the tabs to switch between different meeting functions',
            'Upload documents for meeting minutes',
            'Schedule new meetings using the calendar view',
          ],
        };
      default:
        return {
          title: 'General Help',
          tips: [
            'Use the navigation menu to move between sections',
            'Look for the help icons for specific guidance',
            'Contact your coordinator if you need assistance',
            'Your work makes a real difference in our community!',
          ],
        };
    }
  };

  const helpData = getSectionHelp();

  return (
    <div className="fixed bottom-[calc(1.5rem+var(--chat-dock-height,0px))] right-6 z-50">
      {isOpen && (
        <Card className="mb-4 p-4 w-80 bg-white shadow-lg border-2 border-yellow-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🥪</span>
              <h4 className="font-medium text-sm">Sandy's Quick Tips</h4>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="p-1 h-6 w-6"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>

          <h5 className="font-medium text-sm mb-2">{helpData.title}</h5>
          <ul className="text-sm space-y-1">
            {helpData.tips.map((tip, index) => (
              <li key={index} className="flex items-start gap-2">
                <Heart className="w-3 h-3 text-yellow-600 mt-0.5 flex-shrink-0" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded-full w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-white shadow-lg"
      >
        <HelpCircle className="w-5 h-5" />
      </Button>
    </div>
  );
};

export default HelpBubble;
