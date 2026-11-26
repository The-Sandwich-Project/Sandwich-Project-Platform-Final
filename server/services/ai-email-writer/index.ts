/**
 * AI email writing help for the event email composer (toolkit emails and
 * other emails to an event contact).
 *
 * Uses OpenAI through Replit AI Integrations, like the other AI features.
 *
 * Two shapes, matching the composer's two formats:
 * - plaintext: the whole body is rewritten (or written from scratch when empty).
 * - html: the designed email is never sent to the model as HTML. The client
 *   sends only the visible text pieces (one per text node) with ids, and the
 *   model returns new text for the same ids. The client puts the text back
 *   into the same elements, so the layout, colors, buttons and links can't
 *   break.
 */
import OpenAI from 'openai';
import type { EventRequest } from '@shared/schema';
import { logger } from '../../utils/production-safe-logger';
import { getEffectiveEventDate } from '../../../shared/event-validation-utils';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Full gpt-5, not mini: this is writing people send to real groups, so quality
// matters more than the small cost difference.
const MODEL = 'gpt-5';

export interface EmailTextSegment {
  id: string;
  text: string;
}

export interface AiEmailRequest {
  instruction: string;
  subject: string;
  format: 'plaintext' | 'html';
  /** plaintext only */
  text?: string;
  /** html only */
  segments?: EmailTextSegment[];
  senderName?: string;
}

export interface AiEmailResult {
  subject: string;
  /** plaintext only */
  text?: string;
  /** html only: new text for each segment id that changed */
  segments?: EmailTextSegment[];
}

const SYSTEM_PROMPT = `You help staff and volunteers at The Sandwich Project (TSP), an Atlanta nonprofit fighting food insecurity, write emails to community groups (schools, churches, companies, clubs) that want to host a sandwich-making event. Groups make sandwiches; TSP collects them and gets them to people who need them.

Write like a warm, organized person at a small nonprofit: friendly, clear, plain language, no corporate filler, no exclamation-point overload, no emojis unless the original already uses them.

Hard rules:
- Never invent facts. Do not add or change dates, times, sandwich counts, addresses, phone numbers, names, deadlines, links or promises that are not in the current email, the event details, or the sender's instruction.
- Keep every URL, email address and phone number exactly as written.
- Keep the email from the sender's point of view. Do not mention AI.
- Follow the sender's instruction. If it asks for something you can't do without inventing facts, do what you can and leave a short [bracketed note] for the sender to fill in.
- Respond with JSON only.`;

function describeEvent(event: EventRequest): string {
  const date = getEffectiveEventDate(event);
  const lines = [
    `Organization: ${event.organizationName || 'unknown'}`,
    event.department ? `Department: ${event.department}` : null,
    `Contact: ${[event.firstName, event.lastName].filter(Boolean).join(' ') || 'unknown'}`,
    date ? `Event date: ${new Date(date).toDateString()}` : 'Event date: not set yet',
    event.eventStartTime ? `Start time: ${event.eventStartTime}` : null,
    event.eventEndTime ? `End time: ${event.eventEndTime}` : null,
    event.estimatedSandwichCount
      ? `Estimated sandwiches: ${event.estimatedSandwichCount}`
      : null,
    event.eventAddress ? `Address: ${event.eventAddress}` : null,
    `Status: ${event.status}`,
    event.message ? `Their original request message: ${event.message.slice(0, 1500)}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

export async function writeEmailWithAi(
  event: EventRequest,
  req: AiEmailRequest
): Promise<AiEmailResult> {
  const context = [
    `Event details:\n${describeEvent(event)}`,
    req.senderName ? `Sender: ${req.senderName}` : null,
    `Sender's instruction: ${req.instruction}`,
    `Current subject: ${req.subject || '(empty)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  let userPrompt: string;
  if (req.format === 'html') {
    userPrompt = `${context}

The email is a designed HTML email. You only get its visible text, split into numbered pieces in reading order. Each piece sits inside a fixed element (heading, paragraph, button, list item, link...). Rewrite the pieces to follow the instruction.
- Return text for the same ids. Leave out ids you don't change.
- Keep each piece about the same role and roughly the same length unless the instruction says otherwise (a button label stays a short button label, a heading stays a heading).
- You can't add or remove elements. To add a sentence, add it to the most fitting existing paragraph piece. To drop something, return an empty string for that piece.
- Keep leading and trailing spaces on a piece when the original has them, so words don't run together.

Pieces:
${JSON.stringify(req.segments ?? [])}

Respond with: {"subject": "new or unchanged subject", "segments": [{"id": "...", "text": "..."}]}`;
  } else {
    userPrompt = `${context}

Current email body (plain text):
"""
${req.text || '(empty, write a new email)'}
"""

Rewrite (or write) the body to follow the instruction. Plain text only, no markdown. Keep the sign-off in the sender's name if there is one.

Respond with: {"subject": "new or unchanged subject", "text": "the full email body"}`;
  }

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    // Writing, not puzzle-solving: low effort keeps it fast. gpt-5 still
    // spends part of the budget on reasoning, so leave plenty of room.
    reasoning_effort: 'low',
    max_completion_tokens: 8000,
  });

  const raw = completion.choices[0]?.message?.content || '';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error('AI email writer returned non-JSON', { raw: raw.slice(0, 500) });
    throw new Error('The AI response could not be read. Please try again.');
  }

  const subject =
    typeof parsed.subject === 'string' && parsed.subject.trim()
      ? parsed.subject.trim()
      : req.subject;

  if (req.format === 'html') {
    const known = new Set((req.segments ?? []).map((s) => s.id));
    const segments: EmailTextSegment[] = Array.isArray(parsed.segments)
      ? parsed.segments.filter(
          (s: any) =>
            s && typeof s.id === 'string' && known.has(s.id) && typeof s.text === 'string'
        )
      : [];
    return { subject, segments };
  }

  if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
    throw new Error('The AI response was empty. Please try again.');
  }
  return { subject, text: parsed.text };
}
