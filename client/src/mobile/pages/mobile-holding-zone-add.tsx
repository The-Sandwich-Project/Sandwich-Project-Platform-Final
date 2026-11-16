import { useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  ListTodo,
  StickyNote,
  Lightbulb,
  AlertCircle,
  Calendar,
  Loader2,
  Check,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';

import { usePageSession } from '@/hooks/usePageSession';
type ItemType = 'task' | 'note' | 'idea';

/**
 * Mobile holding zone quick add form
 */
export function MobileHoldingZoneAdd() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Holding Zone Editor',
  });

  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [type, setType] = useState<ItemType>('task');
  const [content, setContent] = useState('');
  const [details, setDetails] = useState('');
  const [category, setCategory] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [dueDate, setDueDate] = useState('');

  // Fetch categories
  const { data: categories = [] } = useQuery<{ id: number; name: string; color?: string }[]>({
    queryKey: ['/api/holding-zone/categories'],
    staleTime: 300000,
  });

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (data: {
      content: string;
      type: ItemType;
      details?: string;
      category?: string;
      urgent?: boolean;
      dueDate?: string;
    }) => {
      return apiRequest('POST', '/api/team-board', data);
    },
    onSuccess: () => {
      toast({ title: 'Item added to holding zone' });
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      navigate('/holding-zone');
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to add item',
        description: error.message || 'Please try again',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = () => {
    if (!content.trim()) {
      toast({
        title: 'Enter content',
        description: 'Please enter what you want to add',
        variant: 'destructive',
      });
      return;
    }

    submitMutation.mutate({
      content: content.trim(),
      type,
      details: details.trim() || undefined,
      category: category || undefined,
      urgent,
      dueDate: dueDate || undefined,
    });
  };

  const typeOptions = [
    { id: 'task', label: 'Task', icon: ListTodo, color: 'bg-blue-500' },
    { id: 'note', label: 'Note', icon: StickyNote, color: 'bg-amber-500' },
    { id: 'idea', label: 'Idea', icon: Lightbulb, color: 'bg-purple-500' },
  ];

  return (
    <MobileShell title="Add to Holding Zone" showBack showNav={false}>
      <div className="flex flex-col h-full">
        <div className="flex-1 p-4 space-y-5">
          {/* Type selector */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              Type
            </label>
            <div className="flex gap-2">
              {typeOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = type === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => setType(option.id)}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl",
                      "border-2 transition-colors",
                      isSelected
                        ? "border-brand-primary bg-brand-primary/5"
                        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    )}
                  >
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", option.color)}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <span className={cn(
                      "text-sm font-medium",
                      isSelected ? "text-brand-primary" : "text-slate-600 dark:text-slate-300"
                    )}>
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              {type === 'task' ? 'What needs to be done?' : type === 'note' ? 'Note' : 'Your idea'}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                type === 'task'
                  ? "e.g., Follow up with new host about pickup schedule"
                  : type === 'note'
                  ? "Write your note here..."
                  : "Describe your idea..."
              }
              rows={3}
              className={cn(
                "w-full px-4 py-3 rounded-xl resize-none",
                "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700",
                "text-slate-900 dark:text-slate-100 placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              )}
              autoFocus
            />
          </div>

          {/* Details (optional) */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              Details (optional)
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Add any additional context or details..."
              rows={2}
              className={cn(
                "w-full px-4 py-3 rounded-xl resize-none",
                "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700",
                "text-slate-900 dark:text-slate-100 placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              )}
            />
          </div>

          {/* Category selector */}
          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                Category (optional)
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(category === cat.name ? '' : cat.name)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                      category === cat.name
                        ? "bg-brand-primary text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Due date (for tasks) */}
          {type === 'task' && (
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                Due Date (optional)
              </label>
              <div className="relative">
                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  className={cn(
                    "w-full pl-12 pr-4 py-4 rounded-xl",
                    "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700",
                    "text-slate-900 dark:text-slate-100",
                    "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  )}
                />
              </div>
            </div>
          )}

          {/* Urgent toggle */}
          <button
            onClick={() => setUrgent(!urgent)}
            className={cn(
              "w-full flex items-center justify-between p-4 rounded-xl",
              "border transition-colors",
              urgent
                ? "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700"
                : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
            )}
          >
            <div className="flex items-center gap-3">
              <AlertCircle className={cn("w-5 h-5", urgent ? "text-red-500" : "text-slate-400")} />
              <span className={cn(
                "font-medium",
                urgent ? "text-red-700 dark:text-red-400" : "text-slate-700 dark:text-slate-300"
              )}>
                Mark as Urgent
              </span>
            </div>
            <div className={cn(
              "w-6 h-6 rounded-full border-2 flex items-center justify-center",
              urgent
                ? "bg-red-500 border-red-500"
                : "border-slate-300 dark:border-slate-600"
            )}>
              {urgent && <Check className="w-4 h-4 text-white" />}
            </div>
          </button>
        </div>

        {/* Submit button */}
        <div className="p-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleSubmit}
            disabled={submitMutation.isPending || !content.trim()}
            className={cn(
              "w-full py-4 rounded-xl font-semibold text-lg",
              "flex items-center justify-center gap-2",
              "transition-all active:scale-[0.98]",
              submitMutation.isPending || !content.trim()
                ? "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500"
                : "bg-brand-primary text-white shadow-lg shadow-brand-primary/25"
            )}
          >
            {submitMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Check className="w-5 h-5" />
                Add {type.charAt(0).toUpperCase() + type.slice(1)}
              </>
            )}
          </button>
        </div>
      </div>
    </MobileShell>
  );
}

export default MobileHoldingZoneAdd;
