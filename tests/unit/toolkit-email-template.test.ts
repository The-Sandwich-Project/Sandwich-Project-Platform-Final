import {
  buildToolkitEmailHtml,
  canOfferCallMe,
  nextStepText,
  toolkitSectionText,
  TOOLKIT_EMAIL_SECTIONS,
  type ToolkitEmailOptions,
} from '../../shared/toolkit-email-template';

const base: ToolkitEmailOptions = {
  firstName: 'Pat',
  organizationName: 'Lincoln Elementary',
  senderName: 'Katie Long',
  senderEmail: 'katie@thesandwichproject.org',
  senderPhone: '404-555-0100',
  nextStep: 'availability',
  askForPhone: false,
};

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('toolkit email template', () => {
  it('builds the locked wording with the greeting, next step and signature', () => {
    const t = text(buildToolkitEmailHtml(base));
    expect(t).toContain('Hi Pat,');
    expect(t).toContain("Once you've had a chance to look it over, I'd love to set up a time to chat. Just reply with a few dates and times that work for you.");
    expect(t).toContain('Preparing for our call');
    expect(t).toContain('events of 800 sandwiches or more');
    expect(t).toContain('Warmly, Katie Long katie@thesandwichproject.org 404-555-0100');
    expect(t).not.toMatch(/200\+|phone number to reach you/);
  });

  it('uses the sender phone for "Call me"', () => {
    expect(text(buildToolkitEmailHtml({ ...base, nextStep: 'call' }))).toContain(
      "give me a call at 404-555-0100 whenever it's convenient."
    );
  });

  it('falls back to "Request availability" when "Call me" has no phone to offer', () => {
    expect(canOfferCallMe('')).toBe(false);
    expect(nextStepText({ nextStep: 'call', senderPhone: '' })).toBe(toolkitSectionText('next_step_availability'));
  });

  it('uses the custom next step as typed', () => {
    const t = text(buildToolkitEmailHtml({ ...base, nextStep: 'custom', customNextStep: "let's talk Tuesday." }));
    expect(t).toContain("look it over, let's talk Tuesday.");
  });

  it('adds the phone request only when asked', () => {
    expect(text(buildToolkitEmailHtml({ ...base, askForPhone: true }))).toContain(
      "If you don't mind, please also share the best phone number to reach you."
    );
  });

  it('uses a saved customization and falls back to the default when blank', () => {
    expect(text(buildToolkitEmailHtml({ ...base, sections: { greeting: 'Hello {{firstName}}!' } }))).toContain('Hello Pat!');
    expect(text(buildToolkitEmailHtml({ ...base, sections: { greeting: '  ' } }))).toContain('Hi Pat,');
  });

  it('escapes HTML in names and custom text, and links the budget planner', () => {
    const html = buildToolkitEmailHtml({ ...base, firstName: '<b>Pat</b>', nextStep: 'custom', customNextStep: '<script>x</script>' });
    expect(html).not.toContain('<b>Pat</b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('inventorycalculator.html');
  });

  it('bolds tip labels', () => {
    expect(buildToolkitEmailHtml(base)).toContain('<strong>Refrigerated van:</strong>');
  });

  it('has unique section keys', () => {
    const keys = TOOLKIT_EMAIL_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
