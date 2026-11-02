import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Loader2, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type {
  AiAnalystChart,
  AiAnalystTable,
  AnalystDataset,
} from '@shared/ai-analyst-contract';
import { ANALYST_DATASET_CATALOG } from '@shared/ai-analyst-contract';

interface AnalystMessage {
  role: 'user' | 'assistant';
  content: string;
  chart?: AiAnalystChart;
  table?: AiAnalystTable;
  dataQualityNotes?: string[];
  unavailableDatasets?: AnalystDataset[];
  datasets?: AnalystDataset[];
}

interface AiAnalystApiResponse {
  analysis: string;
  chart?: AiAnalystChart;
  table?: AiAnalystTable;
  datasets: AnalystDataset[];
  unavailableDatasets: AnalystDataset[];
  dataQualityNotes: string[];
}

const CHART_COLORS = [
  '#236383',
  '#236383',
  '#FBAD3F',
  '#A31C41',
  '#10B981',
  '#6366F1',
];
const SUGGESTED_QUESTIONS = [
  'How are actual sandwich collections trending over the last 12 months?',
  'What is the current event status breakdown and what does it suggest?',
  'How far ahead of the completed event date is an event request usually received?',
  'How much of our actual collection volume comes from group contributions?',
  'Compare September 2025 and September 2026 week by week.',
];

function renderChart(chart: AiAnalystChart) {
  return (
    <div className="mt-4 h-72 rounded-md border bg-white p-3">
      <p className="mb-2 text-sm font-semibold text-gray-800">{chart.title}</p>
      <ResponsiveContainer width="100%" height="88%">
        {chart.type === 'bar' ? (
          <BarChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#236383" radius={[3, 3, 0, 0]} />
          </BarChart>
        ) : chart.type === 'line' ? (
          <LineChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#236383"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        ) : (
          <PieChart>
            <Pie
              data={chart.data}
              dataKey="value"
              nameKey="name"
              outerRadius={85}
              label
            >
              {chart.data.map((item, index) => (
                <Cell
                  key={item.name}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        )}
      </ResponsiveContainer>
      {chart.description && (
        <p className="text-xs text-muted-foreground">{chart.description}</p>
      )}
    </div>
  );
}

function renderTable(table: AiAnalystTable) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border bg-white">
      <p className="border-b px-3 py-2 text-sm font-semibold text-gray-800">
        {table.title}
      </p>
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            {table.columns.map((column) => (
              <th
                key={column}
                className="whitespace-nowrap px-3 py-2 font-medium"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t">
              {row.map((cell, columnIndex) => (
                <td key={columnIndex} className="whitespace-nowrap px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AiAnalyst() {
  const { toast } = useToast();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<AnalystMessage[]>([]);

  const analystMutation = useMutation({
    mutationFn: async (message: string): Promise<AiAnalystApiResponse> => {
      const response = await fetch('/api/ai-analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationHistory: messages
            .slice(-12)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || 'AI Analyst could not answer that question.'
        );
      return data;
    },
    onSuccess: (data) => {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: data.analysis,
          chart: data.chart,
          table: data.table,
          dataQualityNotes: data.dataQualityNotes,
          unavailableDatasets: data.unavailableDatasets,
          datasets: data.datasets,
        },
      ]);
    },
    onError: (error) => {
      toast({
        title: 'Analysis unavailable',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const submitQuestion = () => {
    const message = question.trim();
    if (!message || analystMutation.isPending) return;
    setMessages((current) => [...current, { role: 'user', content: message }]);
    setQuestion('');
    analystMutation.mutate(message);
  };

  return (
    <Card className="border-brand-primary/20">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-primary" />
            AI Analyst
          </CardTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-primary/10 px-2 py-1 text-xs font-medium text-brand-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            Read-only approved data
          </span>
        </div>
        <CardDescription>
          Explore complete event-request and collection histories that your
          permissions allow. The Analyst can investigate records, comparisons,
          and trends, but cannot change data or access credentials.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {messages.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGESTED_QUESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                className="h-auto justify-start whitespace-normal p-3 text-left text-sm"
                onClick={() => setQuestion(suggestion)}
              >
                <BarChart3 className="mr-2 h-4 w-4 shrink-0 text-brand-primary" />
                {suggestion}
              </Button>
            ))}
          </div>
        )}

        {messages.length > 0 && (
          <ScrollArea className="h-[32rem] rounded-md border bg-muted/20 p-4">
            <div className="space-y-4 pr-3">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={
                    message.role === 'user'
                      ? 'ml-auto max-w-[85%]'
                      : 'max-w-full'
                  }
                >
                  <div
                    className={
                      message.role === 'user'
                        ? 'rounded-lg bg-brand-primary px-3 py-2 text-sm text-white'
                        : 'rounded-lg border bg-white px-3 py-3 text-sm text-gray-800'
                    }
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {message.content}
                    </p>
                    {message.table && renderTable(message.table)}
                    {message.chart && renderChart(message.chart)}
                    {message.datasets && message.datasets.length > 0 && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Sources used:{' '}
                        {message.datasets
                          .map(
                            (dataset) => ANALYST_DATASET_CATALOG[dataset].label
                          )
                          .join(', ')}
                        .
                      </p>
                    )}
                    {message.unavailableDatasets &&
                      message.unavailableDatasets.length > 0 && (
                        <p className="mt-3 text-xs text-amber-700">
                          Not included because you do not have access:{' '}
                          {message.unavailableDatasets.join(', ')}.
                        </p>
                      )}
                    {message.dataQualityNotes &&
                      message.dataQualityNotes.length > 0 && (
                        <details className="mt-3 text-xs text-muted-foreground">
                          <summary className="cursor-pointer font-medium">
                            Data notes
                          </summary>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {message.dataQualityNotes.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                  </div>
                </div>
              ))}
              {analystMutation.isPending && (
                <div className="flex items-center gap-2 rounded-lg border bg-white px-3 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Investigating your authorized data…
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitQuestion();
              }
            }}
            maxLength={2_000}
            placeholder="Ask a question about your authorized analytics data…"
            aria-label="Question for AI Analyst"
            className="min-h-[90px] sm:min-h-[72px]"
          />
          <Button
            onClick={submitQuestion}
            disabled={!question.trim() || analystMutation.isPending}
            className="self-end"
          >
            {analystMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Analyze
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Press Cmd/Ctrl+Enter to analyze. Collection counts are actual logged
          totals; event sandwich counts are planning estimates. Headline metrics
          use all authorized eligible records. The Analyst also has recent daily
          and Friday–Thursday weekly collection series for time-bounded
          comparisons.
        </p>
      </CardContent>
    </Card>
  );
}
