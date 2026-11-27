/**
 * The toolkit email: the one template the "Send Toolkit" composer starts from.
 *
 * Every piece of wording is a named section. The text below is the default;
 * admins can change any section on the Email Templates admin page
 * (templateType `toolkit_email` in `email_template_sections`), and senders can
 * still edit anything in the composer before sending. A section with no saved
 * change always uses the default from this file, so updating a default here
 * reaches everyone who hasn't customized it.
 *
 * Section text is plain text (no HTML). Placeholders:
 *   {{firstName}}         group contact's first name
 *   {{organizationName}}  group name
 *   {{senderPhone}}       the sender's phone number
 *   {{budgetPlanner}}     a link to the Budget & Shopping Planner
 * List sections take one item per line. Tip sections that start with
 * "Label: " show the label in bold.
 */

export const TOOLKIT_EMAIL_TEMPLATE_TYPE = 'toolkit_email';

export const BUDGET_PLANNER_URL =
  'https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html';

export interface ToolkitEmailSectionDefault {
  key: string;
  label: string;
  description: string;
  content: string;
  placeholderHints?: string;
}

export const TOOLKIT_EMAIL_SECTIONS: ToolkitEmailSectionDefault[] = [
  {
    key: 'greeting',
    label: 'Greeting',
    description: 'The first line of the email.',
    content: 'Hi {{firstName}},',
    placeholderHints: '{{firstName}}',
  },
  {
    key: 'intro',
    label: 'Introduction',
    description: 'The thank-you paragraph after the greeting.',
    content:
      "Thank you so much for your interest in hosting a sandwich-making event with The Sandwich Project! We're so glad you reached out.",
    placeholderHints: '{{firstName}}, {{organizationName}}',
  },
  {
    key: 'toolkit_attached',
    label: 'Toolkit paragraph',
    description: 'Says the toolkit is attached and what it covers.',
    content:
      "I've attached our Event Toolkit, which walks through our sandwich-making guidelines, food safety requirements and how to prepare for your event.",
  },
  {
    key: 'next_step_lead',
    label: 'Next step: lead-in',
    description:
      'The start of the next-step sentence. The chosen next step follows it, e.g. "Once you\'ve had a chance to look it over, I\'d love to set up a time to chat…"',
    content: "Once you've had a chance to look it over,",
  },
  {
    key: 'next_step_availability',
    label: 'Next step: request availability',
    description: 'Used when the sender picks "Request availability".',
    content: "I'd love to set up a time to chat. Just reply with a few dates and times that work for you.",
  },
  {
    key: 'next_step_call',
    label: 'Next step: call me',
    description: 'Used when the sender picks "Call me". Only offered when the sender has a phone number on their profile.',
    content: 'please feel free to give me a call at {{senderPhone}} whenever it\'s convenient.',
    placeholderHints: '{{senderPhone}}',
  },
  {
    key: 'call_topics',
    label: 'What the call covers',
    description: 'Follows the next step in the same paragraph.',
    content:
      "When we talk, we'll go over your budget, how many sandwiches your group would like to make and the best options for purchasing ingredients.",
  },
  {
    key: 'missing_phone',
    label: 'Ask for a phone number',
    description: 'Added to the next-step paragraph when the request has no phone number and the sender leaves the option on.',
    content: "If you don't mind, please also share the best phone number to reach you.",
  },
  {
    key: 'prep_heading',
    label: 'Preparing for our call: heading',
    description: 'Heading above the checklist.',
    content: 'Preparing for our call',
  },
  {
    key: 'prep_intro',
    label: 'Preparing for our call: intro',
    description: 'The line above the checklist.',
    content: "If you can, it's helpful to have the following on hand:",
  },
  {
    key: 'prep_items',
    label: 'Preparing for our call: checklist',
    description: 'One item per line.',
    content: [
      'Potential event dates, location and start/end times',
      'An estimated budget (our {{budgetPlanner}} can help)',
      "The space you'll have for sandwich-making",
      'The number and type of refrigerators (residential, single-door or double-door commercial) you can clear out for your event, and how close they are to your sandwich-making space',
    ].join('\n'),
    placeholderHints: '{{budgetPlanner}}',
  },
  {
    key: 'tips_heading',
    label: 'Things to keep in mind: heading',
    description: 'Heading above the tips.',
    content: 'A few things to keep in mind',
  },
  {
    key: 'tip_sandwich_type',
    label: 'Tip: sandwich type',
    description: 'Comes before the nutrition list. "Label:" at the start shows in bold.',
    content:
      'Sandwich type: We focus on fresh deli sandwiches because nutrition matters to us just as much as the number of sandwiches we provide. Compared to a typical PB&J, our deli sandwiches offer:',
  },
  {
    key: 'tip_sandwich_nutrition',
    label: 'Tip: sandwich type, nutrition list',
    description: 'One item per line.',
    content: [
      'about twice the protein',
      "25–30% of an adult's daily calcium needs",
      'vitamin B12',
      'significantly less added sugar',
    ].join('\n'),
  },
  {
    key: 'tip_sandwich_type_after',
    label: 'Tip: sandwich type, after the list',
    description: 'Finishes the sandwich type tip.',
    content:
      'A freshly made sandwich is also a meaningful way of showing care for the person receiving it. Only a limited number of our recipient partners can accept PB&J, so we ask that groups planning to make a larger number of sandwiches make deli.',
  },
  {
    key: 'tip_refrigeration',
    label: 'Tip: refrigeration',
    description: '"Label:" at the start shows in bold.',
    content:
      "Refrigeration: Your fridge space needs to hold both the ingredients and the finished sandwiches. Partway through an event, both are in the fridge at the same time, so having room for the ingredients doesn't always mean there's room for the sandwiches too. That's why we ask about refrigerators before our call, but don't worry, we'll go over all of this together when we talk!",
  },
  {
    key: 'tip_van',
    label: 'Tip: refrigerated van',
    description: '"Label:" at the start shows in bold.',
    content:
      "Refrigerated van: If you're short on fridge space, our refrigerated van may be able to help for events of 800 sandwiches or more, depending on our event schedule.",
  },
  {
    key: 'tip_food_safety',
    label: 'Tip: food safety',
    description: '"Label:" at the start shows in bold.',
    content:
      'Food safety: We ask that everyone wear food-safe gloves and hair restraints, and that sandwiches be made indoors.',
  },
  {
    key: 'tip_labels',
    label: 'Tip: labels',
    description: '"Label:" at the start shows in bold.',
    content:
      'Labels: Please place the attached labels on the outside of each loaf bag (10–12 sandwiches per bag).',
  },
  {
    key: 'tip_timing',
    label: 'Tip: timing',
    description: '"Label:" at the start shows in bold.',
    content:
      'Timing: Our events are made possible by volunteers, so the more notice you can give us before your event, the better we can support you.',
  },
  {
    key: 'closing',
    label: 'Closing paragraph',
    description: 'The last paragraph before the sign-off.',
    content:
      "Thank you again for wanting to be part of this. We truly couldn't do it without groups like yours, and I'm looking forward to working with you!",
  },
  {
    key: 'signoff',
    label: 'Sign-off',
    description: "Above the sender's name, email and phone.",
    content: 'Warmly,',
  },
];

const DEFAULTS: Record<string, string> = Object.fromEntries(
  TOOLKIT_EMAIL_SECTIONS.map((s) => [s.key, s.content])
);

export type ToolkitNextStep = 'availability' | 'call' | 'custom';

export interface ToolkitEmailOptions {
  firstName?: string | null;
  organizationName?: string | null;
  senderName: string;
  senderEmail: string;
  senderPhone?: string | null;
  nextStep: ToolkitNextStep;
  /** The sender's own words for the "custom" next step. */
  customNextStep?: string;
  /** Add the "share your phone number" line (offered when the request has none). */
  askForPhone: boolean;
  /** Saved customizations by section key; anything missing uses the default. */
  sections?: Record<string, string | null | undefined>;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** A section's text: the saved customization if there is one, else the default. */
export function toolkitSectionText(
  key: string,
  sections?: Record<string, string | null | undefined>
): string {
  const saved = sections?.[key];
  return saved != null && saved.trim() !== '' ? saved : DEFAULTS[key] ?? '';
}

/** Whether the "Call me" next step can be offered (it needs the sender's phone). */
export function canOfferCallMe(senderPhone?: string | null): boolean {
  return !!(senderPhone && senderPhone.trim());
}

/** The words that finish the lead-in for the chosen next step. */
export function nextStepText(opts: Pick<ToolkitEmailOptions, 'nextStep' | 'customNextStep' | 'senderPhone' | 'sections'>): string {
  if (opts.nextStep === 'custom') return (opts.customNextStep || '').trim();
  if (opts.nextStep === 'call' && canOfferCallMe(opts.senderPhone)) {
    return toolkitSectionText('next_step_call', opts.sections);
  }
  return toolkitSectionText('next_step_availability', opts.sections);
}

/** Section text with placeholders filled in, as safe HTML. */
function render(text: string, opts: ToolkitEmailOptions): string {
  return escapeHtml(text)
    .replace(/\{\{\s*firstName\s*\}\}/g, escapeHtml(opts.firstName || 'there'))
    .replace(/\{\{\s*organizationName\s*\}\}/g, escapeHtml(opts.organizationName || 'your group'))
    .replace(/\{\{\s*senderPhone\s*\}\}/g, escapeHtml(opts.senderPhone || ''))
    .replace(
      /\{\{\s*budgetPlanner\s*\}\}/g,
      `<a href="${BUDGET_PLANNER_URL}" style="color: #007E8C; text-decoration: underline;">Budget &amp; Shopping Planner</a>`
    );
}

/** "Label: text" with the label in bold. */
function renderTip(text: string, opts: ToolkitEmailOptions): string {
  const m = text.match(/^([^:]{1,40}):\s*([\s\S]*)$/);
  if (!m) return render(text, opts);
  return `<strong>${render(m[1], opts)}:</strong> ${render(m[2], opts)}`;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const P = 'margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #333333;';
const H = 'margin: 24px 0 8px 0; font-size: 18px; font-weight: bold; color: #236383;';
const UL = 'margin: 0 0 16px 0; padding-left: 22px; font-size: 16px; line-height: 1.6; color: #333333;';
const LI = 'margin: 0 0 8px 0;';

/** The toolkit email as a full HTML document, ready for the composer's editable preview. */
export function buildToolkitEmailHtml(opts: ToolkitEmailOptions): string {
  const t = (key: string) => toolkitSectionText(key, opts.sections);

  const step = nextStepText(opts);
  const nextStepParagraph = [
    render(t('next_step_lead'), opts),
    step ? render(step, opts) : '',
    render(t('call_topics'), opts),
    opts.askForPhone ? render(t('missing_phone'), opts) : '',
  ]
    .filter(Boolean)
    .join(' ');

  const list = (key: string) =>
    lines(t(key))
      .map((item) => `<li style="${LI}">${render(item, opts)}</li>`)
      .join('');

  const tip = (key: string) => `<li style="${LI}">${renderTip(t(key), opts)}</li>`;

  const sandwichTip = `<li style="${LI}">${renderTip(t('tip_sandwich_type'), opts)}<ul style="margin: 8px 0; padding-left: 22px;">${list('tip_sandwich_nutrition')}</ul>${render(t('tip_sandwich_type_after'), opts)}</li>`;

  const signature = [
    `<strong>${escapeHtml(opts.senderName)}</strong>`,
    `<a href="mailto:${escapeHtml(opts.senderEmail)}" style="color: #007E8C; text-decoration: none;">${escapeHtml(opts.senderEmail)}</a>`,
    opts.senderPhone && opts.senderPhone.trim() ? escapeHtml(opts.senderPhone.trim()) : '',
  ]
    .filter(Boolean)
    .join('<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The Sandwich Project - Event Toolkit</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5;">
<tr><td align="center" style="padding: 20px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">
<tr><td style="padding: 28px 30px 18px 30px; text-align: center; border-bottom: 4px solid #007E8C;">
<img src="https://the-sandwich-project.github.io/sandwichinventory/CMYK_PRINT_TSP-01-01.jpg" alt="The Sandwich Project" width="240" style="display: block; margin: 0 auto; max-width: 240px; height: auto; border: 0;" />
</td></tr>
<tr><td style="padding: 32px 30px;">
<p style="${P}">${render(t('greeting'), opts)}</p>
<p style="${P}">${render(t('intro'), opts)}</p>
<p style="${P}">${render(t('toolkit_attached'), opts)}</p>
<p style="${P}">${nextStepParagraph}</p>
<h2 style="${H}">${render(t('prep_heading'), opts)}</h2>
<p style="${P}">${render(t('prep_intro'), opts)}</p>
<ul style="${UL}">${list('prep_items')}</ul>
<h2 style="${H}">${render(t('tips_heading'), opts)}</h2>
<ul style="${UL}">${sandwichTip}${tip('tip_refrigeration')}${tip('tip_van')}${tip('tip_food_safety')}${tip('tip_labels')}${tip('tip_timing')}</ul>
<p style="${P}">${render(t('closing'), opts)}</p>
<p style="margin: 24px 0 0 0; font-size: 16px; line-height: 1.6; color: #333333;">${render(t('signoff'), opts)}<br>${signature}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
