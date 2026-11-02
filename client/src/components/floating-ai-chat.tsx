import React, { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  MessageCircle,
  Send,
  Loader2,
  X,
  Minimize2,
  Maximize2,
  Sparkles,
  Copy,
  Check,
  Image,
  FileSpreadsheet,
  Trash2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  chart?: ChartData | null;
  timestamp: Date;
}

interface ChartData {
  type: 'bar' | 'line' | 'pie';
  title: string;
  data: Array<{ name: string; value: number; [key: string]: any }>;
  xKey?: string;
  yKey?: string;
  description?: string;
}

export type AIContextType =
  | 'collections'
  | 'events'
  | 'impact-reports'
  | 'general'
  | 'holding-zone'
  | 'network'
  | 'projects'
  | 'meetings'
  | 'resources'
  | 'organizations'
  | 'links'
  | 'dashboard'
  | 'volunteer-calendar'
  | 'yearly-calendar'
  | 'users';

interface FloatingAIChatProps {
  contextType: AIContextType;
  /** Lightweight context - just filters and summary stats (computed on every render) */
  contextData?: Record<string, any>;
  /** Heavy context with rawData - only called when chat is opened and message is sent */
  getFullContext?: () => Record<string, any>;
  suggestedQuestions?: string[];
  title?: string;
  subtitle?: string;
}

const CHART_COLORS = ['#47B3CB', '#236383', '#FBAD3F', '#007E8C', '#A31C41', '#10B981', '#6366F1', '#F59E0B'];

// Helper function to generate descriptive axis labels
function getAxisLabel(key: string, chartTitle: string, isYAxis: boolean = false): string {
  const lowerKey = key.toLowerCase();
  const lowerTitle = chartTitle.toLowerCase();

  // Y-axis labels
  if (isYAxis) {
    if (lowerKey === 'value' || lowerKey === 'count') {
      if (lowerTitle.includes('sandwich')) {
        return 'Number of Sandwiches';
      } else if (lowerTitle.includes('event')) {
        return 'Number of Events';
      } else if (lowerTitle.includes('collection')) {
        return 'Collections';
      } else if (lowerTitle.includes('trend')) {
        return 'Value';
      }
      return 'Count';
    }
    if (lowerKey.includes('sandwich')) return 'Number of Sandwiches';
    if (lowerKey.includes('event')) return 'Number of Events';
    if (lowerKey.includes('collection')) return 'Collections';
    if (lowerKey.includes('amount') || lowerKey.includes('total')) return 'Amount';
    if (lowerKey.includes('percentage') || lowerKey.includes('percent')) return 'Percentage';
  }

  // X-axis labels
  if (lowerKey === 'name' || lowerKey === 'label') {
    if (lowerTitle.includes('month') || lowerTitle.includes('monthly')) return 'Month';
    if (lowerTitle.includes('week') || lowerTitle.includes('weekly')) return 'Week';
    if (lowerTitle.includes('date') || lowerTitle.includes('time')) return 'Date';
    if (lowerTitle.includes('host') || lowerTitle.includes('organization')) return 'Host/Organization';
    return 'Category';
  }
  if (lowerKey.includes('date') || lowerKey.includes('time')) return 'Date';
  if (lowerKey.includes('month')) return 'Month';
  if (lowerKey.includes('year')) return 'Year';
  if (lowerKey.includes('day')) return 'Day';
  if (lowerKey.includes('host')) return 'Host';
  if (lowerKey.includes('organization') || lowerKey.includes('org')) return 'Organization';
  if (lowerKey.includes('category')) return 'Category';

  // Default: capitalize and format
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

const DEFAULT_QUESTIONS: Record<AIContextType, string[]> = {
  collections: [
    "What's our total sandwich count this month?",
    "What's our average collection size?",
    "Show collections by month",
    "How are we trending compared to last month?",
  ],
  events: [
    "How many events do we have scheduled?",
    "Show me events by category",
    "What's our monthly event trend?",
    "Which months are busiest?",
  ],
  'impact-reports': [
    "Show monthly sandwich trends",
    "What's our overall impact this year?",
    "What's our average per event?",
    "How have we grown over time?",
  ],
  general: [
    "What can I do on this platform?",
    "How do I get started?",
    "What features are available?",
    "How can I find help?",
  ],
  'holding-zone': [
    "What open items need attention?",
    "How many tasks are there?",
    "Show me urgent items",
    "What ideas have been submitted?",
  ],
  network: [
    "How many active hosts do we have?",
    "How many drivers are in the network?",
    "Show me network overview",
    "How many recipients do we serve?",
  ],
  projects: [
    "What projects are in progress?",
    "Show me high priority projects",
    "How many projects are complete?",
    "What's the status breakdown?",
  ],
  meetings: [
    "What meetings are coming up?",
    "How many agenda items are pending?",
    "Show recent meetings",
    "When is the next meeting?",
  ],
  resources: [
    "What resources are available?",
    "Show resources by category",
    "What types of documents are here?",
    "How do I find training materials?",
  ],
  organizations: [
    "How many organizations are in the catalog?",
    "Show organizations by category",
    "How many have hosted events?",
    "What types of organizations work with us?",
  ],
  links: [
    "What links are available?",
    "Show links by category",
    "How do I find key resources?",
    "What quick tools are available?",
  ],
  dashboard: [
    "Give me an overview",
    "What are the key metrics?",
    "How many upcoming events?",
    "What needs attention today?",
  ],
  'volunteer-calendar': [
    "Who is unavailable this week?",
    "What events are scheduled for this month?",
    "When are most volunteers unavailable?",
    "Show me upcoming unavailability",
  ],
};

// Simple markdown renderer for AI responses
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (listItems.length > 0) {
      if (listType === 'ol') {
        elements.push(
          <ol
            key={`list-${elements.length}`}
            className="list-decimal list-outside ml-5 space-y-1 my-2"
          >
            {listItems}
          </ol>
        );
      } else {
        elements.push(<ul key={`list-${elements.length}`} className="list-disc list-outside ml-5 space-y-1 my-2">{listItems}</ul>);
      }
      listItems = [];
      listType = null;
    }
  };

  const processInlineFormatting = (line: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*|__(.+?)__/);
      if (boldMatch && boldMatch.index !== undefined) {
        if (boldMatch.index > 0) {
          parts.push(<span key={key++}>{remaining.slice(0, boldMatch.index)}</span>);
        }
        parts.push(<strong key={key++} className="font-semibold">{boldMatch[1] || boldMatch[2]}</strong>);
        remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      } else {
        parts.push(<span key={key++}>{remaining}</span>);
        break;
      }
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={index} className="font-semibold text-gray-800 mt-3 mb-1">
          {processInlineFormatting(trimmedLine.slice(4))}
        </h4>
      );
    } else if (trimmedLine.startsWith('## ')) {
      flushList();
      elements.push(
        <h3 key={index} className="font-bold text-gray-800 mt-3 mb-1">
          {processInlineFormatting(trimmedLine.slice(3))}
        </h3>
      );
    } else if (trimmedLine.startsWith('# ')) {
      flushList();
      elements.push(
        <h2 key={index} className="font-bold text-gray-900 mt-3 mb-2 text-base">
          {processInlineFormatting(trimmedLine.slice(2))}
        </h2>
      );
    } else if (/^\d+\.\s/.test(trimmedLine)) {
      // Numbered list item (e.g., "1. Item", "2. Item")
      // Must have a space after the period to distinguish from decimal numbers
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      // Extract content after the number and period (handles "1. " or "10. " with any spacing)
      const match = trimmedLine.match(/^\d+\.\s+(.+)$/);
      const content = match ? match[1].trim() : trimmedLine.replace(/^\d+\.\s*/, '').trim();
      if (content) {
        // Use index for unique keys across entire message, but preserve list item index for proper numbering
        listItems.push(<li key={`ol-${index}`}>{processInlineFormatting(content)}</li>);
      }
    } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('• ') || trimmedLine.startsWith('* ')) {
      // Bullet list item
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      const content = trimmedLine.slice(2).trim();
      if (content) {
        // Use index for unique keys across entire message
        listItems.push(<li key={`ul-${index}`}>{processInlineFormatting(content)}</li>);
      }
    } else if (trimmedLine === '') {
      flushList();
      elements.push(<div key={index} className="h-2" />);
    } else {
      flushList();
      elements.push(
        <p key={index} className="my-1">
          {processInlineFormatting(trimmedLine)}
        </p>
      );
    }
  });

  flushList();
  return <div className="text-sm leading-relaxed">{elements}</div>;
}

export function FloatingAIChat({
  contextType,
  contextData,
  getFullContext,
  suggestedQuestions,
  title = 'AI Assistant',
  subtitle = 'Ask questions about your data',
}: FloatingAIChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-hide on scroll down, show on scroll up or after scroll stops
  useEffect(() => {
    // Don't auto-hide when chat is open or minimized (user is interacting with it)
    if (isOpen || isMinimized) {
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
  }, [isOpen, isMinimized]);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [copiedChartId, setCopiedChartId] = useState<string | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);

  const questions = suggestedQuestions || DEFAULT_QUESTIONS[contextType];

  // Helper function to scroll to show new messages (but not force to absolute bottom)
  const scrollToShowNew = (forceBottom: boolean = false) => {
    // Use requestAnimationFrame for better timing, then setTimeout for DOM updates
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (scrollRef.current) {
          // Find the viewport element
          const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
          if (!viewport) {
            const viewportByClass = scrollRef.current.querySelector('.rt-ScrollAreaViewport') as HTMLElement;
            if (viewportByClass) {
              if (forceBottom) {
                viewportByClass.scrollTop = viewportByClass.scrollHeight;
              } else {
                // Scroll to show new content if user is at or near the bottom (within 100px)
                const maxScroll = viewportByClass.scrollHeight - viewportByClass.clientHeight;
                const distanceFromBottom = maxScroll - viewportByClass.scrollTop;
                // Scroll if user is at or near the bottom (within 100px) to show new messages
                if (distanceFromBottom <= 100) {
                  viewportByClass.scrollTop = viewportByClass.scrollHeight - viewportByClass.clientHeight;
                }
              }
              return;
            }
          } else {
            if (forceBottom) {
              viewport.scrollTop = viewport.scrollHeight;
            } else {
              // Scroll to show new content if user is at or near the bottom (within 100px)
              const maxScroll = viewport.scrollHeight - viewport.clientHeight;
              const distanceFromBottom = maxScroll - viewport.scrollTop;
              // Scroll if user is at or near the bottom (within 100px) to show new messages
              if (distanceFromBottom <= 100) {
                viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
              }
            }
            return;
          }
          
          // Fallback: try to scroll the container directly
          const scrollElement = scrollRef.current as HTMLElement;
          if (scrollElement.scrollHeight > scrollElement.clientHeight) {
            if (forceBottom) {
              scrollElement.scrollTop = scrollElement.scrollHeight;
            } else {
              const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
              const distanceFromBottom = maxScroll - scrollElement.scrollTop;
              // Scroll if user is at or near the bottom (within 100px) to show new messages
              if (distanceFromBottom <= 100) {
                scrollElement.scrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
              }
            }
          }
        }
      }, 100);
    });
  };

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      // Only compute full context (with rawData) at the moment of sending
      // This prevents expensive computation on every render
      const fullContext = getFullContext ? getFullContext() : {};

      // Limit rawData to prevent 413 errors (request too large)
      // AI doesn't need all records - a sample + summary stats is enough
      const MAX_RAW_DATA_ITEMS = 150;
      let limitedContext = { ...contextData, ...fullContext };

      if (limitedContext.rawData && Array.isArray(limitedContext.rawData)) {
        const totalCount = limitedContext.rawData.length;
        if (totalCount > MAX_RAW_DATA_ITEMS) {
          // For events, prioritize upcoming scheduled/in_process events
          // Sort by date so we don't miss important upcoming events
          const sortedData = [...limitedContext.rawData].sort((a, b) => {
            // Prioritize scheduled and in_process events
            const statusPriority = (status: string) => {
              if (isScheduledOrRescheduled(status)) return 0;
              if (status === 'in_process') return 1;
              if (status === 'new') return 2;
              return 3;
            };
            const aPriority = statusPriority(a.status);
            const bPriority = statusPriority(b.status);
            if (aPriority !== bPriority) return aPriority - bPriority;

            // Then sort by date (upcoming first)
            const aDate = getEffectiveEventDate(a) || a.collectionDate;
            const bDate = getEffectiveEventDate(b) || b.collectionDate;
            if (!aDate && !bDate) return 0;
            if (!aDate) return 1;
            if (!bDate) return -1;
            return new Date(aDate).getTime() - new Date(bDate).getTime();
          });

          limitedContext = {
            ...limitedContext,
            rawData: sortedData.slice(0, MAX_RAW_DATA_ITEMS),
            _dataNote: `Showing ${MAX_RAW_DATA_ITEMS} of ${totalCount} total records (prioritized by status and date). Summary stats reflect full dataset.`,
          };
        }
      }

      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message,
          contextType,
          contextData: limitedContext,
          conversationHistory: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.response,
          chart: data.chart,
          timestamp: new Date(),
        },
      ]);
      setShowSuggestions(false);
      // Scroll after AI response is added (with extra delay if chart is present for rendering)
      setTimeout(() => scrollToShowNew(false), data.chart ? 300 : 100);
    },
    onError: () => {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error processing your request. Please try again.',
          timestamp: new Date(),
        },
      ]);
    },
  });

  // Scroll when messages change - only scroll if user is near bottom
  useEffect(() => {
    if (messages.length > 0) {
      // Only auto-scroll if user hasn't manually scrolled up
      scrollToShowNew(false);
    }
  }, [messages]);

  // Scroll when AI starts responding - gentle scroll
  useEffect(() => {
    if (chatMutation.isPending) {
      scrollToShowNew(false);
    }
  }, [chatMutation.isPending]);

  const handleSend = () => {
    if (!inputValue.trim() || chatMutation.isPending) return;

    const userMessage = inputValue.trim();
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage, timestamp: new Date() },
    ]);
    setInputValue('');
    chatMutation.mutate(userMessage);
    // Scroll immediately after adding user message - gentle scroll
    scrollToShowNew(false);
  };

  const handleSuggestionClick = (question: string) => {
    setMessages(prev => [
      ...prev,
      { role: 'user', content: question, timestamp: new Date() },
    ]);
    chatMutation.mutate(question);
    // Scroll immediately after adding user message - gentle scroll
    scrollToShowNew(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setShowSuggestions(true);
  };

  const toggleSuggestions = () => {
    setShowSuggestions(!showSuggestions);
  };

  const exportAsCSV = (chart: ChartData) => {
    const xKey = chart.xKey || 'name';
    const yKey = chart.yKey || 'value';
    const headers = [xKey, yKey].join(',');
    const rows = chart.data.map(row => `"${row[xKey]}",${row[yKey]}`).join('\n');
    const csvContent = `${headers}\n${rows}`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${chart.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({ title: 'CSV Downloaded', description: `${chart.title} data exported successfully` });
  };

  const copyToClipboard = async (chart: ChartData, chartId: string) => {
    const xKey = chart.xKey || 'name';
    const yKey = chart.yKey || 'value';
    const headers = `${xKey}\t${yKey}`;
    const rows = chart.data.map(row => `${row[xKey]}\t${row[yKey]}`).join('\n');
    const content = `${headers}\n${rows}`;

    try {
      await navigator.clipboard.writeText(content);
      setCopiedChartId(chartId);
      setTimeout(() => setCopiedChartId(null), 2000);
      toast({ title: 'Copied to Clipboard', description: 'Data ready to paste into Excel or Google Sheets' });
    } catch {
      toast({ title: 'Copy Failed', description: 'Unable to copy to clipboard', variant: 'destructive' });
    }
  };

  const copyMessageToClipboard = async (content: string, messageIndex: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageIndex(messageIndex);
      setTimeout(() => setCopiedMessageIndex(null), 2000);
      toast({ title: 'Copied', description: 'Response copied to clipboard' });
    } catch {
      toast({ title: 'Copy Failed', description: 'Unable to copy to clipboard', variant: 'destructive' });
    }
  };

  const exportAsPNG = async (chart: ChartData, chartId: string) => {
    const chartElement = document.getElementById(chartId);
    if (!chartElement) return;

    const svgElement = chartElement.querySelector('svg');
    if (!svgElement) {
      toast({ title: 'Export Failed', description: 'Could not find chart to export', variant: 'destructive' });
      return;
    }

    try {
      const xKey = chart.xKey || 'name';
      const yKey = chart.yKey || 'value';
      
      // Get original chart dimensions
      const bbox = svgElement.getBoundingClientRect();
      const chartWidth = bbox.width;
      const chartHeight = bbox.height;

      // Create a larger canvas to accommodate title, labels, and description
      const padding = 40;
      const titleHeight = 50;
      const xAxisLabelHeight = 30;
      const yAxisLabelWidth = 60;
      const descriptionHeight = chart.description ? 40 : 0;
      
      const canvasWidth = chartWidth + yAxisLabelWidth + padding * 2;
      const canvasHeight = titleHeight + chartHeight + xAxisLabelHeight + descriptionHeight + padding * 2;
      
      // Create high-resolution canvas (2x for retina)
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth * scale;
      canvas.height = canvasHeight * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        toast({ title: 'Export Failed', description: 'Could not create canvas context', variant: 'destructive' });
        return;
      }

      ctx.scale(scale, scale);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Clone and prepare SVG
      const svgClone = svgElement.cloneNode(true) as SVGElement;
      svgClone.setAttribute('width', String(chartWidth));
      svgClone.setAttribute('height', String(chartHeight));

      // Add white background to SVG
      const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('width', String(chartWidth));
      bgRect.setAttribute('height', String(chartHeight));
      bgRect.setAttribute('fill', 'white');
      svgClone.insertBefore(bgRect, svgClone.firstChild);

      const svgData = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const img = new window.Image();
      img.onload = () => {
        // Draw title at the top (centered)
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const titleX = canvasWidth / 2;
        ctx.fillText(chart.title, titleX, padding);

        // Draw Y-axis label (rotated)
        ctx.save();
        ctx.translate(padding + 15, titleHeight + padding + chartHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#4b5563';
        ctx.font = '14px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const yAxisLabel = getAxisLabel(yKey, chart.title, true);
        ctx.fillText(yAxisLabel, 0, 0);
        ctx.restore();

        // Draw chart
        const chartX = padding + yAxisLabelWidth;
        const chartY = titleHeight + padding;
        ctx.drawImage(img, chartX, chartY, chartWidth, chartHeight);

        // Draw X-axis label at the bottom (centered)
        ctx.fillStyle = '#4b5563';
        ctx.font = '14px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const xAxisLabel = getAxisLabel(xKey, chart.title, false);
        const xAxisLabelY = titleHeight + padding + chartHeight + xAxisLabelHeight;
        ctx.fillText(xAxisLabel, titleX, xAxisLabelY);

        // Draw description if present
        if (chart.description) {
          ctx.fillStyle = '#6b7280';
          ctx.font = '12px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const descriptionY = titleHeight + padding + chartHeight + xAxisLabelHeight + 10;
          
          // Word wrap description if needed
          // Note: maxWidth is in logical coordinates (pre-scale)
          // After ctx.scale(), measureText() returns scaled measurements
          // So we need to account for the scale factor when comparing
          const maxWidth = canvasWidth - padding * 2;
          const words = chart.description.split(' ');
          let line = '';
          let y = descriptionY;

          words.forEach((word, index) => {
            const testLine = line + word + ' ';
            const metrics = ctx.measureText(testLine);
            // Compare in the same coordinate space (scaled)
            if (metrics.width > maxWidth * scale && index > 0) {
              ctx.fillText(line.trim(), titleX, y);
              line = word + ' ';
              y += 16;
            } else {
              line = testLine;
            }
          });
          ctx.fillText(line.trim(), titleX, y);
        }

        // Download the image
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${chart.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            URL.revokeObjectURL(svgUrl);

            toast({ title: 'PNG Downloaded', description: `${chart.title} chart exported successfully` });
          } else {
            URL.revokeObjectURL(svgUrl);
            toast({ title: 'Export Failed', description: 'Unable to create image', variant: 'destructive' });
          }
        }, 'image/png');
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        toast({ title: 'Export Failed', description: 'Unable to load chart image', variant: 'destructive' });
      };
      
      img.src = svgUrl;
    } catch (error) {
      toast({ 
        title: 'Export Failed', 
        description: error instanceof Error ? error.message : 'Unable to export chart as PNG', 
        variant: 'destructive' 
      });
    }
  };

  const renderChart = (chart: ChartData, messageIndex: number) => {
    const xKey = chart.xKey || 'name';
    const yKey = chart.yKey || 'value';
    const chartId = `floating-chart-${messageIndex}`;

    return (
      <div className="mt-3 p-3 bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700">{chart.title}</h4>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-500 hover:text-[#47B3CB]"
              onClick={() => copyToClipboard(chart, chartId)}
              title="Copy data"
              aria-label="Copy chart data to clipboard"
            >
              {copiedChartId === chartId ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-500 hover:text-[#47B3CB]"
              onClick={() => exportAsCSV(chart)}
              title="Download CSV"
              aria-label="Download chart data as CSV"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-500 hover:text-[#47B3CB]"
              onClick={() => exportAsPNG(chart, chartId)}
              title="Download PNG"
              aria-label="Download chart as PNG image"
            >
              <Image className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div id={chartId}>
          <ResponsiveContainer width="100%" height={180}>
            {chart.type === 'bar' ? (
              <BarChart data={chart.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={xKey} fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Bar dataKey={yKey} fill="#47B3CB">
                  {chart.data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            ) : chart.type === 'line' ? (
              <LineChart data={chart.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={xKey} fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Line type="monotone" dataKey={yKey} stroke="#47B3CB" strokeWidth={2} />
              </LineChart>
            ) : (
              <PieChart>
                <Pie
                  data={chart.data}
                  dataKey={yKey}
                  nameKey={xKey}
                  cx="50%"
                  cy="50%"
                  outerRadius={60}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={9}
                >
                  {chart.data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
        {chart.description && (
          <p className="text-xs text-gray-500 mt-2 italic">{chart.description}</p>
        )}
      </div>
    );
  };

  // Floating button when closed
  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-[calc(5rem+var(--chat-dock-height,0px))] right-4 h-11 w-11 rounded-full shadow-lg bg-gradient-to-r from-[#47B3CB] to-[#236383] hover:from-[#236383] hover:to-[#47B3CB] z-50",
          "transition-all duration-300 ease-in-out",
          "hover:h-14 hover:w-14 hover:shadow-xl",
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}
        size="icon"
        title="AI Data Assistant"
        aria-label="Open AI Data Assistant"
      >
        <Sparkles className="h-5 w-5 text-white transition-transform duration-300 hover:scale-110" />
      </Button>
    );
  }

  // Minimized state
  if (isMinimized) {
    return (
      <div className="fixed bottom-[calc(5rem+var(--chat-dock-height,0px))] right-4 z-50">
        <Card className="w-72 shadow-xl border-[#47B3CB]/30">
          <CardHeader className="py-2 px-3 flex flex-row items-center justify-between bg-gradient-to-r from-[#47B3CB] to-[#236383] text-white rounded-t-lg">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="font-medium text-sm">{title}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-6 w-6 text-white hover:bg-white/20" onClick={() => setIsMinimized(false)} aria-label="Expand chat window">
                <Maximize2 className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-white hover:bg-white/20" onClick={() => setIsOpen(false)} aria-label="Close chat">
                <X className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Full chat panel
  return (
    <div className="fixed bottom-[calc(5rem+var(--chat-dock-height,0px))] right-4 z-50">
      <Card className="w-96 h-[500px] shadow-xl border-[#47B3CB]/30 flex flex-col">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between bg-gradient-to-r from-[#47B3CB] to-[#236383] text-white rounded-t-lg flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <div>
              <span className="font-semibold">{title}</span>
              <p className="text-xs text-white/80">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/20" onClick={() => setIsMinimized(true)} aria-label="Minimize chat window">
              <Minimize2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/20" onClick={() => setIsOpen(false)} aria-label="Close chat">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4" ref={scrollRef}>
            {showSuggestions && (
              <div className={`space-y-3 ${messages.length > 0 ? 'mb-4 pb-4 border-b border-gray-200' : ''}`}>
                <p className="text-sm text-gray-600 text-center mb-4">
                  {messages.length === 0 ? 'I can help you understand your data. Try asking:' : 'Suggested questions:'}
                </p>
                {questions.map((question, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    className="w-full text-left justify-start items-start h-auto py-2 px-3 text-xs hover:bg-[#47B3CB]/10 hover:border-[#47B3CB]"
                    onClick={() => handleSuggestionClick(question)}
                    disabled={chatMutation.isPending}
                  >
                    <MessageCircle className="h-4 w-4 mr-2 flex-shrink-0 text-[#47B3CB] mt-0.5" />
                    <span className="text-gray-700 whitespace-normal break-words text-left leading-snug">{question}</span>
                  </Button>
                ))}
              </div>
            )}

            {messages.map((message, index) => (
              <div key={index} className={`mb-4 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                <div
                  className={`inline-block max-w-[85%] rounded-lg px-3 py-2 ${
                    message.role === 'user'
                      ? 'bg-[#47B3CB] text-white'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {message.role === 'user' ? (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  ) : (
                    renderMarkdown(message.content)
                  )}
                </div>
                {message.role === 'assistant' && (
                  <div className="mt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                      onClick={() => copyMessageToClipboard(message.content, index)}
                      title="Copy response"
                    >
                      {copiedMessageIndex === index ? (
                        <>
                          <Check className="h-3 w-3 mr-1 text-green-500" />
                          <span className="text-green-500">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                )}
                {message.chart && renderChart(message.chart, index)}
              </div>
            ))}

            {chatMutation.isPending && (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Analyzing data...</span>
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="p-3 border-t bg-gray-50 rounded-b-lg flex-shrink-0">
          {/* Quick actions row */}
          {messages.length > 0 && (
            <div className="flex items-center justify-between mb-2 text-xs">
              <button
                onClick={toggleSuggestions}
                className="text-[#47B3CB] hover:text-[#236383] hover:underline"
              >
                {showSuggestions ? 'Hide suggestions' : 'Need ideas?'}
              </button>
              <button
                onClick={clearConversation}
                className="text-gray-400 hover:text-red-500 flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" />
                New chat
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Ask about your data..."
              className="flex-1 text-sm"
              disabled={chatMutation.isPending}
            />
            <Button
              onClick={handleSend}
              disabled={!inputValue.trim() || chatMutation.isPending}
              size="icon"
              className="bg-[#47B3CB] hover:bg-[#236383]"
              aria-label={chatMutation.isPending ? "Sending message..." : "Send message"}
              aria-live="polite"
              aria-busy={chatMutation.isPending}
            >
              {chatMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
