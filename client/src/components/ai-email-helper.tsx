import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Loader2, Undo2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import {
  applyEmailTextSegments,
  extractEmailTextSegments,
  type EmailTextSegment,
} from '@/lib/email-text-segments';

/**
 * "Write with AI" panel for the event email composer. Sends the sender's
 * instruction plus the current email to OpenAI (server route
 * /api/event-requests/:id/ai-email-assist) and swaps in the result, with a
 * one-step undo. Designed HTML emails only send their visible text, so the
 * design stays intact.
 */

const QUICK_PROMPTS = [
  'Make it warmer and more personal',
  'Make it shorter',
  'More casual',
  'Fix grammar and flow',
];

interface AiEmailHelperProps {
  eventRequestId: number;
  format: 'html' | 'plaintext';
  subject: string;
  content: string;
  onApply: (next: { subject: string; content: string }) => void;
}

interface AiEmailResponse {
  subject: string;
  text?: string;
  segments?: EmailTextSegment[];
}

export function AiEmailHelper({
  eventRequestId,
  format,
  subject,
  content,
  onApply,
}: AiEmailHelperProps) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [previous, setPrevious] = useState<{ subject: string; content: string } | null>(null);
  // An AI result that arrived after the sender changed the email. Held back
  // until they choose to replace their newer edits or discard it.
  const [pending, setPending] = useState<{ subject: string; content: string } | null>(null);
  const { toast } = useToast();

  // The email as it is right now. The request can take a while, and the
  // mutation callbacks would otherwise see the props from when it started.
  const latest = useRef({ eventRequestId, format, subject, content });
  useEffect(() => {
    latest.current = { eventRequestId, format, subject, content };
  });

  // A held-back suggestion or undo snapshot is in the old format; drop it.
  useEffect(() => {
    setPending(null);
    setPrevious(null);
  }, [eventRequestId, format]);

  // Undo goes back to whatever was there just before the AI version went in,
  // not to the email as it was when Rewrite was clicked.
  const applySuggestion = (next: { subject: string; content: string }) => {
    const { subject: curSubject, content: curContent } = latest.current;
    setPrevious({ subject: curSubject, content: curContent });
    setPending(null);
    onApply(next);
    toast({
      title: 'AI suggestion applied',
      description: 'Read it over before sending. You can undo or keep editing.',
    });
  };

  const mutation = useMutation({
    mutationFn: async (prompt: string) => {
      const body =
        format === 'html'
          ? { instruction: prompt, subject, format, segments: extractEmailTextSegments(content) }
          : { instruction: prompt, subject, format, text: content };
      // gpt-5 can take a while on a long email.
      const result: AiEmailResponse = await apiRequest(
        'POST',
        `/api/event-requests/${eventRequestId}/ai-email-assist`,
        body,
        120000
      );
      return { result, before: { eventRequestId, format, subject, content } };
    },
    onSuccess: ({ result, before }) => {
      const now = latest.current;
      // A different event or format means the suggestion no longer fits.
      if (now.eventRequestId !== before.eventRequestId || now.format !== before.format) {
        toast({
          title: 'AI suggestion discarded',
          description: 'The email changed format while the AI was writing. Try again.',
        });
        return;
      }
      // The HTML text pieces map onto the email as it was sent to the AI.
      const nextContent =
        before.format === 'html'
          ? applyEmailTextSegments(before.content, result.segments ?? [])
          : result.text ?? before.content;
      const next = { subject: result.subject || before.subject, content: nextContent };

      if (now.subject !== before.subject || now.content !== before.content) {
        setPending(next);
        return;
      }
      applySuggestion(next);
    },
    onError: (error: any) => {
      toast({
        title: 'AI help failed',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const run = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || mutation.isPending) return;
    setPending(null);
    mutation.mutate(trimmed);
  };

  const undo = () => {
    if (!previous) return;
    onApply(previous);
    setPrevious(null);
  };

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-purple-800"
        data-testid="button-toggle-ai-helper"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          Write with AI
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs text-purple-900/80">
            Tell it what to change, e.g. "mention we spoke on the phone Tuesday" or
            "ask if they can do a weekday instead".
            {format === 'html' && ' Only the wording changes; the design stays.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs bg-white"
                disabled={mutation.isPending}
                onClick={() => run(p)}
              >
                {p}
              </Button>
            ))}
          </div>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(instruction);
            }}
            placeholder="What should the AI change or write?"
            className="min-h-[60px] bg-white text-sm"
            maxLength={2000}
            data-testid="textarea-ai-instruction"
          />
          {pending && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 space-y-2">
              <p>
                You changed the email while the AI was writing. Replacing it
                will drop those changes.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-white"
                  onClick={() => applySuggestion(pending)}
                  data-testid="button-ai-replace-anyway"
                >
                  Replace with AI version
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setPending(null)}
                >
                  Discard
                </Button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => run(instruction)}
              disabled={!instruction.trim() || mutation.isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
              data-testid="button-ai-rewrite"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Writing…
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3 mr-1" />
                  Rewrite
                </>
              )}
            </Button>
            {previous && !mutation.isPending && (
              <Button type="button" size="sm" variant="ghost" onClick={undo}>
                <Undo2 className="w-3 h-3 mr-1" />
                Undo AI changes
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
