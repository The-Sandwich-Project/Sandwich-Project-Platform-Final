import { useState } from 'react';
import {
  Calculator,
  FileSpreadsheet,
  FileImage,
  Calendar,
  Receipt,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

import { usePageSession } from '@/hooks/usePageSession';
interface QuickTool {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  url: string;
  color: string;
  category: 'calculator' | 'document' | 'flyer';
}

const QUICK_TOOLS: QuickTool[] = [
  {
    id: 'inventory-calculator',
    name: 'Inventory Calculator',
    description: 'Calculate sandwich inventory and distribution',
    icon: Calculator,
    url: 'https://docs.google.com/spreadsheets/d/1-ABC123/edit',
    color: 'bg-blue-500',
    category: 'calculator',
  },
  {
    id: 'event-estimator',
    name: 'Event Estimator',
    description: 'Estimate attendance and sandwich needs',
    icon: Calendar,
    url: 'https://docs.google.com/spreadsheets/d/1-DEF456/edit',
    color: 'bg-green-500',
    category: 'calculator',
  },
  {
    id: 'donation-receipt',
    name: 'Donation Receipt',
    description: 'Generate donation receipts for donors',
    icon: Receipt,
    url: 'https://receipt-gen--katielong2316.replit.app/',
    color: 'bg-purple-500',
    category: 'document',
  },
  {
    id: 'events-sheet',
    name: 'Events Google Sheet',
    description: 'Master events spreadsheet',
    icon: FileSpreadsheet,
    url: 'https://docs.google.com/spreadsheets/d/1-JKL012/edit',
    color: 'bg-amber-500',
    category: 'document',
  },
  {
    id: 'digital-flyer',
    name: 'Digital Flyer',
    description: 'Digital promotional flyer for The Sandwich Project',
    icon: FileImage,
    url: 'https://the-sandwich-project.github.io/sandwichprojectcollectionsites/Flyers/digital-flyer.html',
    color: 'bg-pink-500',
    category: 'flyer',
  },
  {
    id: 'qr-margins-flyer',
    name: 'QR Code Flyer with Margins',
    description: 'Printable QR code flyer with margins',
    icon: FileImage,
    url: 'https://the-sandwich-project.github.io/sandwichprojectcollectionsites/Flyers/QR%20Code%20flyer%20with%20margins.pdf',
    color: 'bg-teal-500',
    category: 'flyer',
  },
];

/**
 * Mobile quick tools screen
 */
export function MobileQuickTools() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Quick Tools',
  });

  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Group tools by category
  const calculators = QUICK_TOOLS.filter((t) => t.category === 'calculator');
  const documents = QUICK_TOOLS.filter((t) => t.category === 'document');
  const flyers = QUICK_TOOLS.filter((t) => t.category === 'flyer');

  const openTool = (tool: QuickTool) => {
    window.open(tool.url, '_blank');
  };

  const copyLink = (tool: QuickTool) => {
    navigator.clipboard.writeText(tool.url)
      .then(() => {
        setCopiedId(tool.id);
        toast({ title: 'Link copied' });
        setTimeout(() => setCopiedId(null), 2000);
      })
      .catch(() => {
        toast({ title: 'Failed to copy link', variant: 'destructive' });
      });
  };

  const renderToolCard = (tool: QuickTool) => {
    const Icon = tool.icon;
    return (
      <div
        key={tool.id}
        className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <button
          onClick={() => openTool(tool)}
          className="w-full p-4 text-left active:bg-slate-50 dark:active:bg-slate-700 transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", tool.color)}>
              <Icon className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-slate-900 dark:text-slate-100">
                {tool.name}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {tool.description}
              </p>
            </div>
            <ExternalLink className="w-5 h-5 text-slate-400 flex-shrink-0" />
          </div>
        </button>
        <div className="px-4 pb-3 flex gap-2">
          <button
            onClick={() => openTool(tool)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg",
              "bg-brand-primary/10 text-brand-primary text-sm font-medium"
            )}
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </button>
          <button
            onClick={() => copyLink(tool)}
            className={cn(
              "flex items-center justify-center gap-2 px-4 py-2 rounded-lg",
              "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-medium"
            )}
          >
            {copiedId === tool.id ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <MobileShell title="Quick Tools" showBack showNav>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Calculators section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="w-5 h-5 text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Calculators
            </h2>
          </div>
          <div className="space-y-3">
            {calculators.map(renderToolCard)}
          </div>
        </section>

        {/* Documents section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet className="w-5 h-5 text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Documents & Sheets
            </h2>
          </div>
          <div className="space-y-3">
            {documents.map(renderToolCard)}
          </div>
        </section>

        {/* Flyers section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FileImage className="w-5 h-5 text-pink-500" />
            <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Flyers & Graphics
            </h2>
          </div>
          <div className="space-y-3">
            {flyers.map(renderToolCard)}
          </div>
        </section>

        {/* Link to desktop */}
        <div className="mt-6 p-4 bg-slate-100 dark:bg-slate-800 rounded-xl">
          <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
            Need embedded views with zoom controls?{' '}
            <a href="/important-links" className="text-brand-primary font-medium">
              Open on desktop
            </a>
          </p>
        </div>
      </div>
    </MobileShell>
  );
}

export default MobileQuickTools;
