import React, { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  MessageCircle,
  Send,
  Loader2,
  Sparkles,
  BarChart3,
  TrendingUp,
  Download,
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

interface AIInsightsChatProps {
  dateRange: {
    start: Date;
    end: Date;
  };
}

const CHART_COLORS = ['#47B3CB', '#236383', '#FBAD3F', '#236383', '#A31C41', '#10B981', '#6366F1', '#F59E0B'];

const SUGGESTED_QUESTIONS = [
  "Show me the monthly growth trend",
  "What's our total sandwich count this year?",
  "What's the typical sandwich count for school events?",
  "How do event categories compare overall?",
  "Which month had the highest sandwich collection?",
  "What percentage of events are from schools?",
  "How have we grown year over year?",
  "Show me events by category breakdown",
];

// Simple markdown renderer for AI responses
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (listItems.length > 0) {
      if (listType === 'ol') {
        elements.push(<ol key={`list-${elements.length}`} className="list-decimal list-inside space-y-1 my-2">{listItems}</ol>);
      } else {
        elements.push(<ul key={`list-${elements.length}`} className="list-disc list-inside space-y-1 my-2">{listItems}</ul>);
      }
      listItems = [];
      listType = null;
    }
  };

  const processInlineFormatting = (line: string): React.ReactNode => {
    // Process bold (**text** or __text__)
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*|__(.+?)__/);
      if (boldMatch && boldMatch.index !== undefined) {
        // Add text before the match
        if (boldMatch.index > 0) {
          parts.push(<span key={key++}>{remaining.slice(0, boldMatch.index)}</span>);
        }
        // Add bold text
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

    // Headers
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
    }
    // Numbered list items
    else if (/^\d+\.\s/.test(trimmedLine)) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      const content = trimmedLine.replace(/^\d+\.\s/, '');
      listItems.push(<li key={index}>{processInlineFormatting(content)}</li>);
    }
    // Bullet list items
    else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('• ')) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      const content = trimmedLine.slice(2);
      listItems.push(<li key={index}>{processInlineFormatting(content)}</li>);
    }
    // Empty line
    else if (trimmedLine === '') {
      flushList();
      elements.push(<div key={index} className="h-2" />);
    }
    // Regular paragraph
    else {
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

export function AIInsightsChat({ dateRange }: AIInsightsChatProps) {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [copiedChartId, setCopiedChartId] = useState<string | null>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message,
          conversationHistory: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          dataContext: {
            startDate: dateRange.start.toISOString(),
            endDate: dateRange.end.toISOString(),
          },
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
    },
    onError: (error) => {
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

  const handleSend = () => {
    if (!inputValue.trim() || chatMutation.isPending) return;

    const userMessage = inputValue.trim();
    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      },
    ]);
    setInputValue('');
    chatMutation.mutate(userMessage);
  };

  const handleSuggestionClick = (question: string) => {
    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        content: question,
        timestamp: new Date(),
      },
    ]);
    chatMutation.mutate(question);
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

  // Export chart data as CSV
  const exportAsCSV = (chart: ChartData) => {
    const xKey = chart.xKey || 'name';
    const yKey = chart.yKey || 'value';

    // Build CSV content
    const headers = [xKey, yKey].join(',');
    const rows = chart.data.map(row => `"${row[xKey]}",${row[yKey]}`).join('\n');
    const csvContent = `${headers}\n${rows}`;

    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${chart.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: 'CSV Downloaded',
      description: `${chart.title} data exported successfully`,
    });
  };

  // Copy chart data to clipboard
  const copyToClipboard = async (chart: ChartData, chartId: string) => {
    const xKey = chart.xKey || 'name';
    const yKey = chart.yKey || 'value';

    // Format as tab-separated for easy paste into Excel/Sheets
    const headers = `${xKey}\t${yKey}`;
    const rows = chart.data.map(row => `${row[xKey]}\t${row[yKey]}`).join('\n');
    const content = `${headers}\n${rows}`;

    try {
      await navigator.clipboard.writeText(content);
      setCopiedChartId(chartId);
      setTimeout(() => setCopiedChartId(null), 2000);
      toast({
        title: 'Copied to Clipboard',
        description: 'Data ready to paste into Excel or Google Sheets',
      });
    } catch (err) {
      toast({
        title: 'Copy Failed',
        description: 'Unable to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  // Export chart as PNG using SVG conversion
  const exportAsPNG = async (chart: ChartData, chartId: string) => {
    const chartElement = document.getElementById(chartId);
    if (!chartElement) return;

    const svgElement = chartElement.querySelector('svg');
    if (!svgElement) {
      toast({
        title: 'Export Failed',
        description: 'Could not find chart to export',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Clone the SVG and set dimensions
      const svgClone = svgElement.cloneNode(true) as SVGElement;
      const bbox = svgElement.getBoundingClientRect();
      svgClone.setAttribute('width', String(bbox.width));
      svgClone.setAttribute('height', String(bbox.height));

      // Add white background
      const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('width', '100%');
      bgRect.setAttribute('height', '100%');
      bgRect.setAttribute('fill', 'white');
      svgClone.insertBefore(bgRect, svgClone.firstChild);

      // Convert to data URL
      const svgData = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      // Create image and canvas for PNG conversion
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = bbox.width * 2; // 2x for better quality
        canvas.height = bbox.height * 2;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(2, 2);
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, bbox.width, bbox.height);
          ctx.drawImage(img, 0, 0);

          // Download PNG
          const pngUrl = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.href = pngUrl;
          link.download = `${chart.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          toast({
            title: 'PNG Downloaded',
            description: `${chart.title} chart exported successfully`,
          });
        }
        URL.revokeObjectURL(svgUrl);
      };
      img.src = svgUrl;
    } catch (err) {
      toast({
        title: 'Export Failed',
        description: 'Unable to export chart as PNG',
        variant: 'destructive',
      });
    }
  };

  const renderChart = (chart: ChartData, messageIndex: number) => {
    const xKey = chart.xKey || 'name';
    const yKey = chart.yKey || 'value';
    const chartId = `ai-chart-${messageIndex}`;

    return (
      <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-base font-semibold text-gray-700">{chart.title}</h4>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-500 hover:text-[#47B3CB]"
              onClick={() => copyToClipboard(chart, chartId)}
              title="Copy data to clipboard"
              aria-label="Copy chart data to clipboard"
            >
              {copiedChartId === chartId ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-500 hover:text-[#47B3CB]"
              onClick={() => exportAsCSV(chart)}
              title="Download as CSV"
              aria-label="Download chart data as CSV"
            >
              <FileSpreadsheet className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-500 hover:text-[#47B3CB]"
              onClick={() => exportAsPNG(chart, chartId)}
              title="Download as PNG"
              aria-label="Download chart as PNG image"
            >
              <Image className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div id={chartId}>
          <ResponsiveContainer width="100%" height={300}>
            {chart.type === 'bar' ? (
              <BarChart data={chart.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={xKey} fontSize={11} />
                <YAxis fontSize={11} />
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
                <XAxis dataKey={xKey} fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey={yKey} stroke="#47B3CB" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            ) : (
              <PieChart>
                <Pie
                  data={chart.data}
                  dataKey={yKey}
                  nameKey={xKey}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={true}
                  fontSize={11}
                >
                  {chart.data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
        {chart.description && (
          <p className="text-sm text-gray-500 mt-3 italic">{chart.description}</p>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Chat Section */}
      <div className="lg:col-span-2">
        <Card className="h-[700px] flex flex-col">
          <CardHeader className="py-4 px-6 bg-gradient-to-r from-[#47B3CB] to-[#236383] text-white rounded-t-lg flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="h-6 w-6" />
                <div>
                  <CardTitle className="text-lg">AI Data Insights</CardTitle>
                  <p className="text-sm text-white/80">
                    Ask questions about your event and sandwich data
                  </p>
                </div>
              </div>
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/20"
                  onClick={clearConversation}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>

          {/* Messages Area */}
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full p-6" ref={scrollRef}>
              {messages.length === 0 && showSuggestions ? (
                <div className="space-y-4">
                  <div className="text-center mb-6">
                    <Sparkles className="h-12 w-12 mx-auto text-[#47B3CB] mb-3" />
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">
                      What would you like to know?
                    </h3>
                    <p className="text-sm text-gray-500">
                      I can analyze your event data and create custom visualizations. Try one of these questions or ask your own:
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {SUGGESTED_QUESTIONS.map((question, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        className="text-left justify-start items-start h-auto py-3 px-4 text-xs hover:bg-[#47B3CB]/10 hover:border-[#47B3CB] transition-colors min-h-[60px]"
                        onClick={() => handleSuggestionClick(question)}
                        disabled={chatMutation.isPending}
                      >
                        <MessageCircle className="h-4 w-4 mr-2 flex-shrink-0 text-[#47B3CB] mt-0.5" />
                        <span className="text-gray-700 whitespace-normal break-words text-left leading-snug">{question}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`${message.role === 'user' ? 'flex justify-end' : ''}`}
                    >
                      <div
                        className={`max-w-[90%] ${
                          message.role === 'user'
                            ? 'bg-[#47B3CB] text-white rounded-2xl rounded-tr-sm px-4 py-3'
                            : 'bg-gray-50 text-gray-800 rounded-2xl rounded-tl-sm px-4 py-3'
                        }`}
                      >
                        {message.role === 'user' ? (
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                        ) : (
                          renderMarkdown(message.content)
                        )}
                      </div>
                      {message.chart && renderChart(message.chart, index)}
                    </div>
                  ))}

                  {chatMutation.isPending && (
                    <div className="flex items-center gap-3 text-gray-500 bg-gray-50 rounded-2xl px-4 py-3 max-w-[90%]">
                      <Loader2 className="h-5 w-5 animate-spin text-[#47B3CB]" />
                      <span className="text-sm">Analyzing your data...</span>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </CardContent>

          {/* Input Area */}
          <div className="p-4 border-t bg-gray-50 rounded-b-lg flex-shrink-0">
            <div className="flex gap-3">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask a question about your data..."
                className="flex-1"
                disabled={chatMutation.isPending}
              />
              <Button
                onClick={handleSend}
                disabled={!inputValue.trim() || chatMutation.isPending}
                className="bg-[#47B3CB] hover:bg-[#236383] px-6"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">
              Analyzing data from {dateRange.start.toLocaleDateString()} to {dateRange.end.toLocaleDateString()}
            </p>
          </div>
        </Card>
      </div>

      {/* Tips Panel */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[#47B3CB]" />
              Tips for Better Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-600">
            <div>
              <h4 className="font-medium text-gray-700 mb-1">Ask for comparisons</h4>
              <p className="text-xs">"Compare school events vs corporate events"</p>
            </div>
            <div>
              <h4 className="font-medium text-gray-700 mb-1">Request specific charts</h4>
              <p className="text-xs">"Show me a pie chart of events by category"</p>
            </div>
            <div>
              <h4 className="font-medium text-gray-700 mb-1">Look for trends</h4>
              <p className="text-xs">"What's the monthly growth trend for sandwiches?"</p>
            </div>
            <div>
              <h4 className="font-medium text-gray-700 mb-1">Get rankings</h4>
              <p className="text-xs">"Top 5 organizations by sandwich count"</p>
            </div>
            <div>
              <h4 className="font-medium text-gray-700 mb-1">Explore patterns</h4>
              <p className="text-xs">"Which months have the most events?"</p>
            </div>
            <div className="pt-3 border-t">
              <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#47B3CB]" />
                Export Options
              </h4>
              <p className="text-xs text-gray-500">
                Every chart can be exported as CSV, PNG, or copied to clipboard for use in presentations or spreadsheets.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
