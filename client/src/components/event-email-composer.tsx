import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Mail,
  Send,
  Paperclip,
  FileText,
  Calculator,
  Users,
  Clock,
  X,
  Shield,
  Calendar,
  History,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';

interface EventRequest {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  organizationName: string;
  department?: string;
  desiredEventDate?: string;
  eventAddress?: string;
  estimatedSandwichCount?: number;
  eventStartTime?: string;
  eventEndTime?: string;
  message?: string;
}

interface Document {
  id: number;
  title: string;
  fileName: string;
  category: string;
  filePath: string;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  content: string;
  defaultAttachments: string[];
}

interface EmailTemplateSection {
  id: number;
  templateType: string;
  sectionKey: string;
  sectionLabel: string;
  defaultContent: string;
  currentContent: string | null;
  description: string | null;
  placeholderHints: string | null;
}

// Quick start options for subject line
const SUBJECT_SUGGESTIONS = [
  'Your Sandwich-Making Event Toolkit + Next Steps',
  'Let’s Plan Your Event! [Action Required]',
  'Everything You Need to Make 200+ Sandwiches',
  '{organizationName} - Ready to Get Started?',
  'Quick Call to Finalize Your Sandwich Event',
  'Re: {organizationName} Event',
  'custom', // Custom subject
];

interface EventEmailComposerProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequest: EventRequest;
  onEmailSent?: () => void;
}

export function EventEmailComposer({
  isOpen,
  onClose,
  eventRequest,
  onEmailSent,
}: EventEmailComposerProps) {
  const [selectedSubjectSuggestion, setSelectedSubjectSuggestion] =
    useState<string>('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [isDraft, setIsDraft] = useState(false);
  const [includeSchedulingLink, setIncludeSchedulingLink] = useState(false);
  const [requestPhoneCall, setRequestPhoneCall] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [emailFormat, setEmailFormat] = useState<'html' | 'plaintext'>('html'); // User's choice: HTML template or plain text
  const [templateStyle, setTemplateStyle] = useState<'classic' | 'optimized'>('optimized'); // Template version: Classic or Optimized

  // Smart regeneration state management
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [isResettingToTemplate, setIsResettingToTemplate] = useState(false);
  const lastGeneratedContentRef = useRef<string>('');
  const isInitialLoad = useRef(true);
  const { toast } = useToast();
  const { user } = useAuth();

  // Fetch available documents
  const { data: documentsData = [], isLoading: isDocumentsLoading } = useQuery<
    Document[]
  >({
    queryKey: ['/api/storage/documents'],
    enabled: isOpen, // Only fetch when dialog is open
  });
  const documents = Array.isArray(documentsData) ? documentsData : [];

  // Fetch available drafts for this event request
  const { data: availableDraftsData = [], isLoading: isDraftsLoading } = useQuery({
    queryKey: ['/api/emails/event', eventRequest.id, 'drafts'],
    queryFn: () =>
      apiRequest('GET', `/api/emails/event/${eventRequest.id}/drafts`),
    enabled: isOpen, // Only fetch when dialog is open
  });
  const availableDrafts = Array.isArray(availableDraftsData) ? availableDraftsData : [];

  // Fetch customizable email template sections
  const { data: templateSections } = useQuery<EmailTemplateSection[]>({
    queryKey: ['/api/email-templates/sections', 'follow_up_email'],
    enabled: isOpen,
  });

  // Helper to get section content (uses currentContent if set, otherwise defaultContent)
  const getSectionContent = (sectionKey: string, fallback: string = ''): string => {
    if (!templateSections) return fallback;
    const section = templateSections.find(s => s.sectionKey === sectionKey);
    if (!section) return fallback;
    return section.currentContent ?? section.defaultContent;
  };

  // Helper to substitute placeholders in template text
  const substitutePlaceholders = (text: string, eventReq: EventRequest): string => {
    return text
      .replace(/\{\{firstName\}\}/g, eventReq.firstName || '')
      .replace(/\{\{organizationName\}\}/g, eventReq.organizationName || '');
  };

  // Check if current content has been manually edited
  const isContentManuallyEdited = () => {
    // If we don't have a last generated content, assume it's manual
    if (!lastGeneratedContentRef.current) return true;

    // Compare current content with last generated template (ignore whitespace differences)
    const currentContentNormalized = content.trim().replace(/\s+/g, ' ');
    const lastGeneratedNormalized = lastGeneratedContentRef.current
      .trim()
      .replace(/\s+/g, ' ');

    return currentContentNormalized !== lastGeneratedNormalized;
  };

  // Smart regenerate - only regenerate if content hasn't been manually edited
  const smartRegenerateEmailContent = (
    includeScheduling: boolean,
    requestPhone: boolean,
    force: boolean = false
  ) => {
    // If hasManualEdits is true, never regenerate (unless forced)
    if (hasManualEdits && !force) {
      return false; // Content was not regenerated
    }

    // If forced (Reset to Template) or content hasn't been manually edited, regenerate
    if (force || !isContentManuallyEdited()) {
      regenerateEmailContent(includeScheduling, requestPhone);
      setHasManualEdits(false);
      return true; // Content was regenerated
    }
    return false; // Content was not regenerated
  };

  // Regenerate email content based on selected options
  const regenerateEmailContent = (
    includeScheduling: boolean,
    requestPhone: boolean,
    templateStyleOverride?: 'classic' | 'optimized',
    emailFormatOverride?: 'html' | 'plaintext'
  ) => {
    const userName =
      user?.firstName && user?.lastName
        ? `${user.firstName} ${user.lastName}`
        : user?.email || 'The Sandwich Project Team';

    const userPhone = user?.phoneNumber || '';
    const userEmail =
      user?.preferredEmail || user?.email || 'info@thesandwichproject.org';

    // Use overrides if provided, otherwise use state
    const activeTemplateStyle = templateStyleOverride ?? templateStyle;
    const activeEmailFormat = emailFormatOverride ?? emailFormat;

    // Generate plain text email if user selected plaintext format
    if (activeEmailFormat === 'plaintext') {
      // Get customizable sections for plain text with fallbacks
      const plainGreeting = substitutePlaceholders(
        getSectionContent('greeting', `Hi ${eventRequest.firstName},`),
        eventRequest
      );
      const plainIntro = substitutePlaceholders(
        getSectionContent('intro', "Thank you for your interest in hosting a sandwich-making event with The Sandwich Project!"),
        eventRequest
      );
      const plainCta = substitutePlaceholders(
        getSectionContent('cta_subtitle', "To get started, please reply to this email with your phone number and best times to call you. We'll reach out within 1-2 business days."),
        eventRequest
      );

      let plainTextContent = `${plainGreeting}

${plainIntro}

`;

      if (includeScheduling || requestPhone) {
        plainTextContent += `${plainCta}

`;
      } else {
        // Non-scheduling, non-phone path - use a distinct general CTA section
        const generalCta = substitutePlaceholders(
          getSectionContent('cta_subtitle_general', "I'd love to discuss your event and answer any questions you may have."),
          eventRequest
        );
        plainTextContent += `${generalCta}

`;
      }

      plainTextContent += `In the meantime, here are some helpful resources:

- Event Toolkit (food safety guides, labels, instructions): https://the-sandwich-project.github.io/sandwichinventory/toolkit.html
- Inventory Calculator: https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html
- We typically serve groups of 50-200 people
- Events usually last 1-2 hours

Looking forward to working with you!

Warmly,
${userName}
${userEmail}${userPhone ? `\n${userPhone}` : ''}`;

      setContent(plainTextContent);
      lastGeneratedContentRef.current = plainTextContent;
      return;
    }

    // Use styled HTML template when includeScheduling is true
    if (includeScheduling) {
      // Choose template based on style selection
      const htmlTemplate = activeTemplateStyle === 'optimized'
        ? generateOptimizedSchedulingTemplate(eventRequest, userName, userEmail, userPhone)
        : generateClassicSchedulingTemplate(eventRequest, userName, userEmail, userPhone);

      setContent(htmlTemplate);
      lastGeneratedContentRef.current = htmlTemplate;
      return;
    }

    // Use styled HTML template for non-scheduling version (unless requesting phone)
    if (!requestPhone) {
      // Choose template based on style selection
      const htmlTemplate = activeTemplateStyle === 'optimized'
        ? generateOptimizedNonSchedulingTemplate(eventRequest, userName, userEmail, userPhone)
        : generateClassicNonSchedulingTemplate(eventRequest, userName, userEmail, userPhone);

      setContent(htmlTemplate);
      lastGeneratedContentRef.current = htmlTemplate;
      return;
    }

    // Phone call request - respect email format setting
    if (activeEmailFormat === 'html') {
      // Generate HTML template for phone call request
      const htmlTemplate = activeTemplateStyle === 'optimized'
        ? generateOptimizedPhoneRequestTemplate(eventRequest, userName, userEmail, userPhone)
        : generateClassicPhoneRequestTemplate(eventRequest, userName, userEmail, userPhone);

      setContent(htmlTemplate);
      lastGeneratedContentRef.current = htmlTemplate;
      return;
    }

    // Plain text template for phone request (only when emailFormat is plaintext)
    // Get customizable sections for plain text with fallbacks
    const plainGreeting = substitutePlaceholders(
      getSectionContent('greeting', `Hi ${eventRequest.firstName},`),
      eventRequest
    );
    const plainIntro = substitutePlaceholders(
      getSectionContent('intro', "Thank you for reaching out and for your interest in making sandwiches with us! We are so glad you want to get involved. Attached you'll find a toolkit (everything you need to plan a sandwich-making event), plus a link to our interactive planning guide with an inventory calculator and food safety tips."),
      eventRequest
    );
    const schedulingCallText = substitutePlaceholders(
      getSectionContent('cta_subtitle', "Once you have reviewed everything, we would love to connect! Please reply to this email with your phone number and best times to call you. We'll reach out within 1-2 business days."),
      eventRequest
    );

    const template = `${plainGreeting}

${plainIntro}


**Event Scheduling**

• Groups may host events on any day of the week if making 200+ sandwiches.

• If you have some flexibility with dates, let us know! We can suggest times when sandwiches are especially needed.

• Once you have set a date, we ask for at least two weeks' notice so we can add you to our schedule.


**Transportation**

• We provide transportation for 200+ deli sandwiches and for larger amounts of PBJs (based on volunteer driver availability).

• If you're located outside our host home radius, we would be happy to discuss delivery options with you.


**Food Safety Reminders**

• A refrigerator is required to make deli sandwiches so that meat, cheese, and sandwiches are always cold.

• Food-safe gloves must be worn.

• Hair should be tied back or in a hairnet.

• Sandwiches must be made indoors.

• We provide food to vulnerable populations, so please read and follow all safety rules.


${schedulingCallText}


We look forward to working with you!

Warmly,
${userName}${userPhone ? '\n' + userPhone : ''}
${userEmail}`;

    setContent(template);
    // Store the generated content for comparison
    lastGeneratedContentRef.current = template;
  };

  // Generate optimized scheduling template
  const generateOptimizedSchedulingTemplate = (
    eventRequest: EventRequest,
    userName: string,
    userEmail: string,
    userPhone: string
  ) => {
    // Get customizable section content with fallbacks
    const greeting = substitutePlaceholders(
      getSectionContent('greeting', `Hi ${eventRequest.firstName},`),
      eventRequest
    );
    const intro = substitutePlaceholders(
      getSectionContent('intro', "Thank you for reaching out! We're excited to help you plan a sandwich-making event."),
      eventRequest
    );
    const ctaText = substitutePlaceholders(
      getSectionContent('call_to_action', '📞 Next Step: Share Your Phone Number'),
      eventRequest
    );
    const ctaSubtitle = substitutePlaceholders(
      getSectionContent('cta_subtitle', "Please reply to this email with your phone number and a few times that work for you this week, and we'll give you a call!"),
      eventRequest
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Sandwich Project - Event Information</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #ffffff; padding: 30px 30px 20px 30px; text-align: center; border-bottom: 4px solid #236383;">
                            <img src="https://the-sandwich-project.github.io/sandwichinventory/CMYK_PRINT_TSP-01-01.jpg" alt="The Sandwich Project" width="280" style="display: block; margin: 0 auto; max-width: 280px; height: auto; border: 0;" />
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px; color: #333333; line-height: 1.7;">
                            <p style="font-size: 18px; margin: 0 0 15px 0;">${greeting}</p>
                            <p style="font-size: 18px; margin: 0 0 20px 0;">${intro}</p>

                            <!-- TL;DR Quick Start Box -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0 30px 0;">
                                <tr>
                                    <td style="background-color: #fff7e6; border-left: 5px solid #FBAD3F; padding: 25px;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">⚡ Quick Start (3 Simple Steps)</h2>
                                        <ol style="margin: 10px 0; padding-left: 25px; font-size: 17px; line-height: 1.8;">
                                            <li style="margin: 8px 0; color: #333333;"><strong>Review the attached toolkit</strong> (everything you need is included)</li>
                                            <li style="margin: 8px 0; color: #333333;"><strong>Schedule a quick planning call</strong> using the button below</li>
                                            <li style="margin: 8px 0; color: #333333;"><strong>We'll finalize details together</strong> and get you on the calendar</li>
                                        </ol>
                                    </td>
                                </tr>
                            </table>

                            <!-- Primary CTA -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td style="background-color: #FBAD3F; color: #333333; padding: 25px; text-align: center; border-radius: 8px;">
                                        <p style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">${ctaText}</p>
                                        <p style="margin: 0 0 15px 0; font-size: 16px;">${ctaSubtitle}</p>
                                        <p style="margin: 0; font-size: 14px; font-style: italic; color: #666666;">We'll reach out within 1-2 business days.</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- What's Included Section -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f0f9fa; border-left: 4px solid #236383;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">📦 What's in Your Toolkit</h2>
                                        <p style="margin: 10px 0; color: #444444; font-size: 16px;">You'll find everything attached to this email:</p>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Step-by-step event planning guide</li>
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Food safety requirements checklist</li>
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Loaf bag labels (print & use)</li>
                                        </ul>
                                        <p style="margin: 15px 0 0 0; font-size: 16px;">
                                            <a href="https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html" style="color: #236383; text-decoration: underline; font-weight: bold;">🧮 Use our Budget & Shopping Planner</a>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Key Things to Know (Collapsed) -->
                            <h2 style="margin: 30px 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">💡 Key Things to Know</h2>

                            <!-- Section: Event Scheduling -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">📅 Scheduling</h3>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">We host group events if you are going to make over 200 sandwiches on days other than our normal Wednesday collections</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Flexible on dates? We can suggest high-need times</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">We appreciate 2+ weeks notice when possible</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Transportation -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">🚗 Transportation</h3>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">You just need refrigeration at your sandwich-making location, our drivers will bring coolers for transportation</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Outside our area? We'll try to work with you on finding a recipient in your area</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Food Safety -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">🧤 Food Safety Essentials</h3>
                                        <p style="margin: 5px 0 10px 0; color: #444444; font-size: 15px;">Quick requirements (full details in toolkit):</p>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Refrigerator required for deli sandwiches</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Food-safe gloves & hair restraints must be worn</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Indoor preparation only</li>
                                        </ul>
                                        <p style="margin: 10px 0 0 0; padding: 12px; background-color: #fff7e6; border-left: 3px solid #FBAD3F; font-size: 14px; color: #333333;">
                                            <strong>💡 Tip:</strong> Place the attached labels on the <strong>outside of each loaf bag</strong> containing 10-12 sandwiches.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Secondary CTA -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 35px 0 20px 0;">
                                <tr>
                                    <td style="background-color: #236383; color: #ffffff; padding: 25px; text-align: center; border-radius: 6px;">
                                        <p style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">Ready to Make a Difference?</p>
                                        <p style="margin: 0 0 20px 0; font-size: 16px;">Please reply to this email with your phone number and best times to call you, and we'll get you on the calendar!</p>
                                        <p style="margin: 0; font-size: 14px; font-style: italic; color: #666666;">We'll reach out within 1-2 business days.</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin-top: 25px; text-align: center; font-size: 16px; color: #666666;">Questions? Just reply to this email—we're here to help!</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #236383; color: #ffffff; padding: 30px; text-align: center;">
                            <p style="margin: 5px 0;"><strong>Warmly,</strong></p>
                            <p style="margin: 10px 0;">●</p>
                            <p style="margin: 5px 0;"><strong>${userName}</strong></p>
                            <p style="margin: 5px 0;"><a href="mailto:${userEmail}" style="color: #47B3CB; text-decoration: none;">${userEmail}</a></p>
                            ${userPhone ? `<p style="margin: 5px 0;">${userPhone}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  };

  // Generate optimized non-scheduling template
  const generateOptimizedNonSchedulingTemplate = (
    eventRequest: EventRequest,
    userName: string,
    userEmail: string,
    userPhone: string
  ) => {
    // Get customizable section content with fallbacks
    const greeting = substitutePlaceholders(
      getSectionContent('greeting', `Hi ${eventRequest.firstName},`),
      eventRequest
    );
    const intro = substitutePlaceholders(
      getSectionContent('intro', "Thank you for reaching out! We're excited to help you plan a sandwich-making event."),
      eventRequest
    );
    const ctaText = substitutePlaceholders(
      getSectionContent('call_to_action', '📞 Next Step: Share Your Phone Number'),
      eventRequest
    );
    const ctaSubtitle = substitutePlaceholders(
      getSectionContent('cta_subtitle_general', "I'd love to discuss your event and answer any questions you may have."),
      eventRequest
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Sandwich Project - Event Information</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #ffffff; padding: 30px 30px 20px 30px; text-align: center; border-bottom: 4px solid #236383;">
                            <img src="https://the-sandwich-project.github.io/sandwichinventory/CMYK_PRINT_TSP-01-01.jpg" alt="The Sandwich Project" width="280" style="display: block; margin: 0 auto; max-width: 280px; height: auto; border: 0;" />
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px; color: #333333; line-height: 1.7;">
                            <p style="font-size: 18px; margin: 0 0 15px 0;">${greeting}</p>
                            <p style="font-size: 18px; margin: 0 0 20px 0;">${intro}</p>

                            <!-- TL;DR Quick Start Box -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0 30px 0;">
                                <tr>
                                    <td style="background-color: #fff7e6; border-left: 5px solid #FBAD3F; padding: 25px;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">⚡ Quick Start (3 Simple Steps)</h2>
                                        <ol style="margin: 10px 0; padding-left: 25px; font-size: 17px; line-height: 1.8;">
                                            <li style="margin: 8px 0; color: #333333;"><strong>Review the attached toolkit</strong> (everything you need is included)</li>
                                            <li style="margin: 8px 0; color: #333333;"><strong>Reply with your availability</strong> for a quick planning call</li>
                                            <li style="margin: 8px 0; color: #333333;"><strong>We'll finalize details together</strong> and get you on the calendar</li>
                                        </ol>
                                    </td>
                                </tr>
                            </table>

                            <!-- Primary CTA -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td style="background-color: #FBAD3F; color: #333333; padding: 25px; text-align: center; border-radius: 8px;">
                                        <p style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">${ctaText}</p>
                                        <p style="margin: 0 0 15px 0; font-size: 16px;">${ctaSubtitle}</p>
                                        <p style="margin: 0; font-size: 14px; font-style: italic; color: #666666;">We look forward to scheduling your planning call soon.</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- What's Included Section -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f0f9fa; border-left: 4px solid #236383;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">📦 What's in Your Toolkit</h2>
                                        <p style="margin: 10px 0; color: #444444; font-size: 16px;">You'll find everything attached to this email:</p>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Step-by-step event planning guide</li>
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Food safety requirements checklist</li>
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Loaf bag labels (print & use)</li>
                                        </ul>
                                        <p style="margin: 15px 0 0 0; font-size: 16px;">
                                            <a href="https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html" style="color: #236383; text-decoration: underline; font-weight: bold;">🧮 Use our Budget & Shopping Planner</a>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Key Things to Know (Collapsed) -->
                            <h2 style="margin: 30px 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">💡 Key Things to Know</h2>

                            <!-- Section: Event Scheduling -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">📅 Scheduling</h3>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">We host group events if you are going to make over 200 sandwiches on days other than our normal Wednesday collections</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Flexible on dates? We can suggest high-need times</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">We appreciate 2+ weeks notice when possible</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Transportation -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">🚗 Transportation</h3>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">You just need refrigeration at your sandwich-making location, our drivers will bring coolers for transportation</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Outside our area? We'll try to work with you on finding a recipient in your area</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Food Safety -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">🧤 Food Safety Essentials</h3>
                                        <p style="margin: 5px 0 10px 0; color: #444444; font-size: 15px;">Quick requirements (full details in toolkit):</p>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Refrigerator required for deli sandwiches</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Food-safe gloves & hair restraints must be worn</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Indoor preparation only</li>
                                        </ul>
                                        <p style="margin: 10px 0 0 0; padding: 12px; background-color: #fff7e6; border-left: 3px solid #FBAD3F; font-size: 14px; color: #333333;">
                                            <strong>💡 Tip:</strong> Place the attached labels on the <strong>outside of each loaf bag</strong> containing 10-12 sandwiches.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Secondary CTA -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 35px 0 20px 0;">
                                <tr>
                                    <td style="background-color: #236383; color: #ffffff; padding: 25px; text-align: center; border-radius: 6px;">
                                        <p style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">Ready to Make a Difference?</p>
                                        <p style="margin: 0; font-size: 16px;">Reply with your availability and let's get started!</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin-top: 25px; text-align: center; font-size: 16px; color: #666666;">Questions? Just reply to this email—we're here to help!</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #236383; color: #ffffff; padding: 30px; text-align: center;">
                            <p style="margin: 5px 0;"><strong>Warmly,</strong></p>
                            <p style="margin: 10px 0;">●</p>
                            <p style="margin: 5px 0;"><strong>${userName}</strong></p>
                            <p style="margin: 5px 0;"><a href="mailto:${userEmail}" style="color: #47B3CB; text-decoration: none;">${userEmail}</a></p>
                            ${userPhone ? `<p style="margin: 5px 0;">${userPhone}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  };

  // Generate classic scheduling template (original version)
  const generateClassicSchedulingTemplate = (
    eventRequest: EventRequest,
    userName: string,
    userEmail: string,
    userPhone: string
  ) => {
    // Get customizable section content with fallbacks
    const greeting = substitutePlaceholders(
      getSectionContent('greeting', `Hi ${eventRequest.firstName},`),
      eventRequest
    );
    const intro = substitutePlaceholders(
      getSectionContent('intro', "Thank you for reaching out and for your interest in making sandwiches with us! We are so glad you want to get involved. Attached you'll find a toolkit (everything you need to plan a sandwich-making event), plus a link to our interactive planning guide with food safety tips and helpful resources."),
      eventRequest
    );
    const ctaText = substitutePlaceholders(
      getSectionContent('call_to_action', '📞 Next Step: Share Your Phone Number'),
      eventRequest
    );
    const ctaSubtitle = substitutePlaceholders(
      getSectionContent('cta_subtitle', "Please reply to this email with your phone number and a few times that work for you this week, and we'll give you a call!"),
      eventRequest
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Sandwich Project - Event Information</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #ffffff; padding: 30px 30px 20px 30px; text-align: center; border-bottom: 4px solid #236383;">
                            <img src="https://the-sandwich-project.github.io/sandwichinventory/CMYK_PRINT_TSP-01-01.jpg" alt="The Sandwich Project" width="280" style="display: block; margin: 0 auto; max-width: 280px; height: auto; border: 0;" />
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px; color: #333333; line-height: 1.7;">
                            <p style="font-size: 18px; margin: 0 0 15px 0;">${greeting}</p>
                            <p style="font-size: 18px; margin: 0 0 30px 0;">${intro}</p>

                            <!-- CTA Button -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td align="center" style="padding: 20px 0;">
                                        <a href="https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html" style="display: inline-block; background-color: #47B3CB; color: #ffffff; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 10px; font-size: 16px;">🧮 Budget & Shopping Planner</a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Event Scheduling -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">📅 Event Scheduling</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>Groups may host events on any day of the week</strong> if making 200+ sandwiches.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>If you have flexibility with your date</strong>, let us know! We can suggest times when sandwiches are especially needed.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>We appreciate at least two weeks' notice when possible</strong>—it helps us coordinate drivers and resources.</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Transportation -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">🚗 Transportation</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">We provide transportation for <strong>200+ deli sandwiches</strong> and for larger amounts of PBJs (based on volunteer driver availability).</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">If you're located outside our host home radius, we would be happy to discuss delivery options with you.</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Food Safety -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">🧤 Food Safety Reminders</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">A <strong>refrigerator is required</strong> to make deli sandwiches so that meat, cheese, and sandwiches are always cold.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Food-safe gloves must be worn.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Hair should be tied back or in a hairnet.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Sandwiches must be made indoors.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">We provide food to vulnerable populations, so please read and follow all safety rules.</li>
                                        </ul>
                                        <p style="margin-top: 15px; padding: 15px; background-color: #fff7e6; border-left: 3px solid #FBAD3F; font-size: 15px; color: #333333;">
                                            <strong>📝 Labeling Tip:</strong> The attached PDF for labels are intended to go on the <strong>outside of each bag</strong> containing a loaf of sandwiches.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Highlight Box -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 25px 0;">
                                <tr>
                                    <td style="background-color: #236383; color: #ffffff; padding: 20px; text-align: center;">
                                        <p style="margin: 5px 0; font-size: 17px;"><strong>Ready to get started?</strong></p>
                                        <p style="margin: 5px 0; font-size: 17px;">Once you have reviewed everything, we would love to connect!</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Phone Number Request -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td style="background-color: #FBAD3F; color: #333333; padding: 25px; text-align: center; border-radius: 8px;">
                                        <p style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">${ctaText}</p>
                                        <p style="margin: 0 0 15px 0; font-size: 16px;">${ctaSubtitle}</p>
                                        <p style="margin: 0; font-size: 14px; font-style: italic; color: #666666;">We'll reach out within 1-2 business days.</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin-top: 30px; text-align: center; font-size: 16px;">We look forward to working with you!</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #236383; color: #ffffff; padding: 30px; text-align: center;">
                            <p style="margin: 5px 0;"><strong>Warmly,</strong></p>
                            <p style="margin: 10px 0;">●</p>
                            <p style="margin: 5px 0;"><strong>${userName}</strong></p>
                            <p style="margin: 5px 0;"><a href="mailto:${userEmail}" style="color: #47B3CB; text-decoration: none;">${userEmail}</a></p>
                            ${userPhone ? `<p style="margin: 5px 0;">${userPhone}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  };

  // Generate classic non-scheduling template (original version)
  const generateClassicNonSchedulingTemplate = (
    eventRequest: EventRequest,
    userName: string,
    userEmail: string,
    userPhone: string
  ) => {
    // Get customizable section content with fallbacks
    const greeting = substitutePlaceholders(
      getSectionContent('greeting', `Hi ${eventRequest.firstName},`),
      eventRequest
    );
    const intro = substitutePlaceholders(
      getSectionContent('intro', "Thank you for reaching out and for your interest in making sandwiches with us! We are so glad you want to get involved. Attached you'll find a toolkit (everything you need to plan a sandwich-making event), plus a link to our interactive planning guide with food safety tips and helpful resources."),
      eventRequest
    );
    const ctaText = substitutePlaceholders(
      getSectionContent('call_to_action', '📞 Next Step: Share Your Phone Number'),
      eventRequest
    );
    const ctaSubtitle = substitutePlaceholders(
      getSectionContent('cta_subtitle_general', "I'd love to discuss your event and answer any questions you may have."),
      eventRequest
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Sandwich Project - Event Information</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #ffffff; padding: 30px 30px 20px 30px; text-align: center; border-bottom: 4px solid #236383;">
                            <img src="https://the-sandwich-project.github.io/sandwichinventory/CMYK_PRINT_TSP-01-01.jpg" alt="The Sandwich Project" width="280" style="display: block; margin: 0 auto; max-width: 280px; height: auto; border: 0;" />
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px; color: #333333; line-height: 1.7;">
                            <p style="font-size: 18px; margin: 0 0 15px 0;">${greeting}</p>
                            <p style="font-size: 18px; margin: 0 0 30px 0;">${intro}</p>

                            <!-- CTA Button -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td align="center" style="padding: 20px 0;">
                                        <a href="https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html" style="display: inline-block; background-color: #47B3CB; color: #ffffff; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 10px; font-size: 16px;">🧮 Budget & Shopping Planner</a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Event Scheduling -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">📅 Event Scheduling</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>Groups may host events on any day of the week</strong> if making 200+ sandwiches.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>If you have flexibility with your date</strong>, let us know! We can suggest times when sandwiches are especially needed.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>We appreciate at least two weeks' notice when possible</strong>—it helps us coordinate drivers and resources.</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Transportation -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">🚗 Transportation</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">We provide transportation for <strong>200+ deli sandwiches</strong> and for larger amounts of PBJs (based on volunteer driver availability).</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">If you're located outside our host home radius, we would be happy to discuss delivery options with you.</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Food Safety -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">🧤 Food Safety Reminders</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">A <strong>refrigerator is required</strong> to make deli sandwiches so that meat, cheese, and sandwiches are always cold.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Food-safe gloves must be worn.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Hair should be tied back or in a hairnet.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Sandwiches must be made indoors.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">We provide food to vulnerable populations, so please read and follow all safety rules.</li>
                                        </ul>
                                        <p style="margin-top: 15px; padding: 15px; background-color: #fff7e6; border-left: 3px solid #FBAD3F; font-size: 15px; color: #333333;">
                                            <strong>📝 Labeling Tip:</strong> The attached PDF for labels are intended to go on the <strong>outside of each bag</strong> containing a loaf of sandwiches.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Highlight Box -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 25px 0;">
                                <tr>
                                    <td style="background-color: #236383; color: #ffffff; padding: 20px; text-align: center;">
                                        <p style="margin: 5px 0; font-size: 17px;"><strong>Ready to get started?</strong></p>
                                        <p style="margin: 5px 0; font-size: 17px;">Once you have reviewed everything, please reply to this email with a few times that work for you and we'll schedule a planning call.</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin-top: 30px; text-align: center; font-size: 16px;">We look forward to working with you!</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #236383; color: #ffffff; padding: 30px; text-align: center;">
                            <p style="margin: 5px 0;"><strong>Warmly,</strong></p>
                            <p style="margin: 10px 0;">●</p>
                            <p style="margin: 5px 0;"><strong>${userName}</strong></p>
                            <p style="margin: 5px 0;"><a href="mailto:${userEmail}" style="color: #47B3CB; text-decoration: none;">${userEmail}</a></p>
                            ${userPhone ? `<p style="margin: 5px 0;">${userPhone}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  };

  // Generate optimized phone request template
  const generateOptimizedPhoneRequestTemplate = (
    eventRequest: EventRequest,
    userName: string,
    userEmail: string,
    userPhone: string
  ) => {
    // Get customizable section content with fallbacks
    const greeting = substitutePlaceholders(
      getSectionContent('greeting', `Hi ${eventRequest.firstName},`),
      eventRequest
    );
    const intro = substitutePlaceholders(
      getSectionContent('intro', "Thank you for reaching out! We're excited to help you plan a sandwich-making event."),
      eventRequest
    );
    const ctaText = substitutePlaceholders(
      getSectionContent('call_to_action', '📞 Next Step: Share Your Phone Number'),
      eventRequest
    );
    const ctaSubtitle = substitutePlaceholders(
      getSectionContent('cta_subtitle', "Reply to this email with your phone number and a few times that work for you this week, and we'll give you a call!"),
      eventRequest
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Sandwich Project - Event Information</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #ffffff; padding: 30px 30px 20px 30px; text-align: center; border-bottom: 4px solid #236383;">
                            <img src="https://the-sandwich-project.github.io/sandwichinventory/CMYK_PRINT_TSP-01-01.jpg" alt="The Sandwich Project" width="280" style="display: block; margin: 0 auto; max-width: 280px; height: auto; border: 0;" />
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px; color: #333333; line-height: 1.7;">
                            <p style="font-size: 18px; margin: 0 0 15px 0;">${greeting}</p>
                            <p style="font-size: 18px; margin: 0 0 20px 0;">${intro}</p>

                            <!-- TL;DR Quick Start Box -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0 30px 0;">
                                <tr>
                                    <td style="background-color: #fff7e6; border-left: 5px solid #FBAD3F; padding: 25px;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">⚡ Quick Start (3 Simple Steps)</h2>
                                        <ol style="margin: 10px 0; padding-left: 25px; font-size: 17px; line-height: 1.8;">
                                            <li style="margin: 8px 0; color: #333333;"><strong>Review the attached toolkit</strong> (everything you need is included)</li>
                                            <li style="margin: 8px 0; color: #333333;"><strong>Reply with your phone number</strong> and best times for a quick call</li>
                                            <li style="margin: 8px 0; color: #333333;"><strong>We'll call you</strong> to finalize details and get you on the calendar</li>
                                        </ol>
                                    </td>
                                </tr>
                            </table>

                            <!-- Primary CTA -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td style="background-color: #FBAD3F; color: #333333; padding: 25px; text-align: center; border-radius: 8px;">
                                        <p style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">${ctaText}</p>
                                        <p style="margin: 0 0 15px 0; font-size: 16px;">${ctaSubtitle}</p>
                                        <p style="margin: 0; font-size: 14px; font-style: italic; color: #666666;">We'll reach out within 1-2 business days.</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- What's Included Section -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f0f9fa; border-left: 4px solid #236383;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">📦 What's in Your Toolkit</h2>
                                        <p style="margin: 10px 0; color: #444444; font-size: 16px;">You'll find everything attached to this email:</p>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Step-by-step event planning guide</li>
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Food safety requirements checklist</li>
                                            <li style="margin: 8px 0; color: #444444; font-size: 16px;">Loaf bag labels (print & use)</li>
                                        </ul>
                                        <p style="margin: 15px 0 0 0; font-size: 16px;">
                                            <a href="https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html" style="color: #236383; text-decoration: underline; font-weight: bold;">🧮 Use our Budget & Shopping Planner</a>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Key Things to Know (Collapsed) -->
                            <h2 style="margin: 30px 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">💡 Key Things to Know</h2>

                            <!-- Section: Event Scheduling -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">📅 Scheduling</h3>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">We host group events if you are going to make over 200 sandwiches on days other than our normal Wednesday collections</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Flexible on dates? We can suggest high-need times</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">We appreciate 2+ weeks notice when possible</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Transportation -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">🚗 Transportation</h3>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">You just need refrigeration at your sandwich-making location, our drivers will bring coolers for transportation</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Outside our area? We'll try to work with you on finding a recipient in your area</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Food Safety -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 15px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f9f9f9; border-left: 3px solid #FBAD3F;">
                                        <h3 style="margin: 0 0 10px 0; color: #236383; font-size: 18px; font-weight: bold;">🧤 Food Safety Essentials</h3>
                                        <p style="margin: 5px 0 10px 0; color: #444444; font-size: 15px;">Quick requirements (full details in toolkit):</p>
                                        <ul style="margin: 5px 0; padding-left: 20px;">
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Refrigerator required for deli sandwiches</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Food-safe gloves & hair restraints must be worn</li>
                                            <li style="margin: 6px 0; color: #444444; font-size: 15px;">Indoor preparation only</li>
                                        </ul>
                                        <p style="margin: 10px 0 0 0; padding: 12px; background-color: #fff7e6; border-left: 3px solid #FBAD3F; font-size: 14px; color: #333333;">
                                            <strong>💡 Tip:</strong> Place the attached labels on the <strong>outside of each loaf bag</strong> containing 10-12 sandwiches.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Secondary CTA -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 35px 0 20px 0;">
                                <tr>
                                    <td style="background-color: #236383; color: #ffffff; padding: 25px; text-align: center; border-radius: 6px;">
                                        <p style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">Ready to Make a Difference?</p>
                                        <p style="margin: 0; font-size: 16px;">Reply with your phone number and we'll connect soon!</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin-top: 25px; text-align: center; font-size: 16px; color: #666666;">Questions? Just reply to this email—we're here to help!</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #236383; color: #ffffff; padding: 30px; text-align: center;">
                            <p style="margin: 5px 0;"><strong>Warmly,</strong></p>
                            <p style="margin: 10px 0;">●</p>
                            <p style="margin: 5px 0;"><strong>${userName}</strong></p>
                            <p style="margin: 5px 0;"><a href="mailto:${userEmail}" style="color: #47B3CB; text-decoration: none;">${userEmail}</a></p>
                            ${userPhone ? `<p style="margin: 5px 0;">${userPhone}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  };

  // Generate classic phone request template
  const generateClassicPhoneRequestTemplate = (
    eventRequest: EventRequest,
    userName: string,
    userEmail: string,
    userPhone: string
  ) => {
    // Get customizable section content with fallbacks
    const greeting = substitutePlaceholders(
      getSectionContent('greeting', `Hi ${eventRequest.firstName},`),
      eventRequest
    );
    const intro = substitutePlaceholders(
      getSectionContent('intro', "Thank you for reaching out and for your interest in making sandwiches with us! We are so glad you want to get involved. Attached you'll find a toolkit (everything you need to plan a sandwich-making event), plus a link to our interactive planning guide with food safety tips and helpful resources."),
      eventRequest
    );
    const ctaText = substitutePlaceholders(
      getSectionContent('call_to_action', '📞 Next Step: Share Your Phone Number'),
      eventRequest
    );
    const ctaSubtitle = substitutePlaceholders(
      getSectionContent('cta_subtitle', "Please reply to this email with your phone number and a few times that work for you this week, and we'll give you a call!"),
      eventRequest
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Sandwich Project - Event Information</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #ffffff; padding: 30px 30px 20px 30px; text-align: center; border-bottom: 4px solid #236383;">
                            <img src="https://the-sandwich-project.github.io/sandwichinventory/CMYK_PRINT_TSP-01-01.jpg" alt="The Sandwich Project" width="280" style="display: block; margin: 0 auto; max-width: 280px; height: auto; border: 0;" />
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px; color: #333333; line-height: 1.7;">
                            <p style="font-size: 18px; margin: 0 0 15px 0;">${greeting}</p>
                            <p style="font-size: 18px; margin: 0 0 30px 0;">${intro}</p>

                            <!-- CTA Button -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td align="center" style="padding: 20px 0;">
                                        <a href="https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html" style="display: inline-block; background-color: #47B3CB; color: #ffffff; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 10px; font-size: 16px;">🧮 Budget & Shopping Planner</a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Event Scheduling -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">📅 Event Scheduling</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>Groups may host events on any day of the week</strong> if making 200+ sandwiches.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>If you have flexibility with your date</strong>, let us know! We can suggest times when sandwiches are especially needed.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;"><strong>We appreciate at least two weeks' notice when possible</strong>—it helps us coordinate drivers and resources.</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Transportation -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">🚗 Transportation</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">We provide transportation for <strong>200+ deli sandwiches</strong> and for larger amounts of PBJs (based on volunteer driver availability).</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">If you're located outside our host home radius, we would be happy to discuss delivery options with you.</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>

                            <!-- Section: Food Safety -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                                <tr>
                                    <td style="padding: 25px; background-color: #f9f9f9; border-left: 4px solid #FBAD3F;">
                                        <h2 style="margin: 0 0 15px 0; color: #236383; font-size: 20px; font-weight: bold;">🧤 Food Safety Reminders</h2>
                                        <ul style="margin: 10px 0; padding-left: 20px;">
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">A <strong>refrigerator is required</strong> to make deli sandwiches so that meat, cheese, and sandwiches are always cold.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Food-safe gloves must be worn.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Hair should be tied back or in a hairnet.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">Sandwiches must be made indoors.</li>
                                            <li style="margin: 10px 0; color: #444444; font-size: 16px;">We provide food to vulnerable populations, so please read and follow all safety rules.</li>
                                        </ul>
                                        <p style="margin-top: 15px; padding: 15px; background-color: #fff7e6; border-left: 3px solid #FBAD3F; font-size: 15px; color: #333333;">
                                            <strong>📝 Labeling Tip:</strong> The attached PDF for labels are intended to go on the <strong>outside of each bag</strong> containing a loaf of sandwiches.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Highlight Box -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 25px 0;">
                                <tr>
                                    <td style="background-color: #236383; color: #ffffff; padding: 20px; text-align: center;">
                                        <p style="margin: 5px 0; font-size: 17px;"><strong>Ready to get started?</strong></p>
                                        <p style="margin: 5px 0; font-size: 17px;">Once you have reviewed everything, please reply to this email with your phone number and best times to call you. We'll reach out within 1-2 business days.</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin-top: 30px; text-align: center; font-size: 16px;">We look forward to working with you!</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #236383; color: #ffffff; padding: 30px; text-align: center;">
                            <p style="margin: 5px 0;"><strong>Warmly,</strong></p>
                            <p style="margin: 10px 0;">●</p>
                            <p style="margin: 5px 0;"><strong>${userName}</strong></p>
                            <p style="margin: 5px 0;"><a href="mailto:${userEmail}" style="color: #47B3CB; text-decoration: none;">${userEmail}</a></p>
                            ${userPhone ? `<p style="margin: 5px 0;">${userPhone}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  };

  // Format event details for template insertion.
  // Prefer the actual scheduled date once it exists — `desiredEventDate` is
  // only the originally requested date and may be stale after scheduling.
  const formatEventDetails = () => {
    const details = [];
    const effectiveDateStr = getEffectiveEventDate(eventRequest as any);
    if (effectiveDateStr) {
      const date = new Date(effectiveDateStr + 'T12:00:00');
      details.push(
        `Date: ${date.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}`
      );
    }
    if (eventRequest.eventStartTime && eventRequest.eventEndTime) {
      details.push(
        `Time: ${eventRequest.eventStartTime} - ${eventRequest.eventEndTime}`
      );
    }
    if (eventRequest.eventAddress) {
      details.push(`Location: ${eventRequest.eventAddress}`);
    }
    if (eventRequest.estimatedSandwichCount) {
      details.push(
        `Estimated Sandwiches: ${eventRequest.estimatedSandwichCount}`
      );
    }

    return details.length > 0 ? `\n${details.join('\n')}\n` : '';
  };

  // Apply subject suggestion when selected
  useEffect(() => {
    if (selectedSubjectSuggestion && selectedSubjectSuggestion !== 'custom') {
      const processedSubject = selectedSubjectSuggestion.replace(
        '{organizationName}',
        eventRequest.organizationName
      );
      setSubject(processedSubject);
    }
  }, [selectedSubjectSuggestion, eventRequest]);

  // Effect to handle option changes with smart regeneration
  useEffect(() => {
    // Skip on initial load or when resetting to template
    if (isInitialLoad.current || isResettingToTemplate) return;

    // Skip if dialog is not open
    if (!isOpen) return;

    // Skip if no content exists yet
    if (!content) return;

    // Always regenerate when checkboxes change (force=true to bypass manual edits check)
    regenerateEmailContent(includeSchedulingLink, requestPhoneCall);
    setHasManualEdits(false);
  }, [includeSchedulingLink, requestPhoneCall]);

  // Initialize with comprehensive template when component opens
  useEffect(() => {
    if (isOpen && !content) {
      // Just call regenerateEmailContent to avoid duplicating template logic
      regenerateEmailContent(includeSchedulingLink, requestPhoneCall);

      // Mark as not having manual edits initially
      setHasManualEdits(false);

      setSubject(`Your Sandwich-Making Event Toolkit + Next Steps`);

      // Clear initial load flag after first template generation
      isInitialLoad.current = false;
    }
  }, [
    isOpen,
    eventRequest,
    formatEventDetails,
    includeSchedulingLink,
    requestPhoneCall,
    user,
  ]);

  // Separate effect to handle default attachment selection after documents load
  useEffect(() => {
    // Only run when dialog is open, documents are loaded, and no attachments are currently selected
    // This ensures we don't override manually selected attachments or loaded drafts
    if (isOpen && documents.length > 0 && selectedAttachments.length === 0) {
      // Pre-select standard toolkit documents based on available documents
      const defaultAttachments = documents
        .filter((doc) => {
          const searchText = `${doc.title} ${doc.fileName}`.toLowerCase();
          // Exclude recipients document - only for hosts and volunteers
          if (searchText.includes('recipient')) return false;

          return (
            searchText.includes('food safety') ||
            searchText.includes('deli') ||
            searchText.includes('pbj') ||
            searchText.includes('pb&j') ||
            searchText.includes('sandwich making') ||
            searchText.includes('group event reference') ||
            searchText.includes('event reference guide')
          );
        })
        .map((doc) => doc.filePath);

      if (defaultAttachments.length > 0) {
        setSelectedAttachments(defaultAttachments);
      }
    }
  }, [isOpen, documents, selectedAttachments.length]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      // Reset all state when dialog closes
      setHasManualEdits(false);
      setIsResettingToTemplate(false);
      lastGeneratedContentRef.current = '';
      isInitialLoad.current = true;
      setDraftSaved(false);
    }
  }, [isOpen]);

  const sendEmailMutation = useMutation({
    mutationFn: async (emailData: {
      recipientEmail: string;
      subject: string;
      content: string;
      isDraft: boolean;
      attachments: string[];
      includeSchedulingLink: boolean;
      requestPhoneCall: boolean;
    }) => {
      return apiRequest('POST', '/api/emails/event', {
        eventRequestId: eventRequest.id,
        recipientId: 'external', // External contact
        recipientName: `${eventRequest.firstName} ${eventRequest.lastName}`,
        recipientEmail: emailData.recipientEmail,
        subject: emailData.subject,
        content: emailData.content,
        isDraft: emailData.isDraft,
        attachments: emailData.attachments,
        includeSchedulingLink: emailData.includeSchedulingLink,
        requestPhoneCall: emailData.requestPhoneCall,
        contextType: 'event_request',
        contextId: eventRequest.id.toString(),
        contextTitle: `Event: ${eventRequest.organizationName}`,
      });
    },
    onSuccess: (data) => {
      console.log('[EventEmailComposer] Email sent successfully:', data);
      queryClient.invalidateQueries({ queryKey: ['/api/emails'] });

      if (isDraft) {
        // For drafts: Keep dialog open, show clear feedback
        toast({
          title: '📝 Draft Saved Successfully',
          description: `Your draft has been saved. You can continue editing or find it later in Communication > Inbox > Drafts folder.`,
          duration: 6000, // Longer duration for important info
        });
        // Reset the isDraft flag but keep dialog open for continued editing
        setIsDraft(false);
        setDraftSaved(true);
      } else {
        // For sent emails: Close dialog, show success
        toast({
          title: '✅ Email Sent Successfully',
          description: `Email sent to ${eventRequest.firstName} ${eventRequest.lastName}`,
        });
        onEmailSent?.();
        onClose();
      }
    },
    onError: (error: any) => {
      console.error('[EventEmailComposer] Email sending failed:', error);
      console.error('[EventEmailComposer] Error details:', {
        message: error?.message,
        status: error?.status,
        data: error?.data,
      });

      // ApiError exposes the parsed server body on `.data` (not `.response.data`).
      // The event-email route returns { message, error } where `error` holds the
      // specific SendGrid rejection reason — prefer that so the operator sees an
      // actionable message instead of a generic one.
      const errorMessage =
        error?.data?.error ||
        error?.data?.message ||
        error?.message ||
        'Please try again';

      toast({
        title: 'Failed to send email',
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });

  const handleSend = (asDraft: boolean = false) => {
    if (!subject.trim() || !content.trim()) {
      toast({
        title: 'Missing information',
        description: 'Please enter both subject and content',
        variant: 'destructive',
      });
      return;
    }

    console.log('[EventEmailComposer] Sending email:', {
      isDraft: asDraft,
      recipientEmail: eventRequest.email,
      subject: subject.trim(),
      attachmentsCount: selectedAttachments.length,
      attachments: selectedAttachments,
      contentLength: content.length,
      contentPreview: content.substring(0, 100),
    });

    setIsDraft(asDraft);
    sendEmailMutation.mutate({
      recipientEmail: eventRequest.email,
      subject: subject.trim(),
      content: content.trim(),
      isDraft: asDraft,
      attachments: selectedAttachments,
      includeSchedulingLink: includeSchedulingLink,
      requestPhoneCall: requestPhoneCall,
    });
  };

  const toggleAttachment = (fileUrl: string) => {
    setSelectedAttachments((prev) =>
      prev.includes(fileUrl)
        ? prev.filter((f) => f !== fileUrl)
        : [...prev, fileUrl]
    );
  };

  // Handle content changes to track manual edits
  const handleContentChange = (newContent: string) => {
    setContent(newContent);

    // Don't mark as manual edit if we're resetting to template or on initial load
    if (!isResettingToTemplate && !isInitialLoad.current) {
      // Only mark as manual edit if the content differs from last generated
      if (
        lastGeneratedContentRef.current &&
        newContent.trim() !== lastGeneratedContentRef.current.trim()
      ) {
        setHasManualEdits(true);
      }
    }
  };

  // Reset to template functionality
  const resetToTemplate = () => {
    setIsResettingToTemplate(true);
    smartRegenerateEmailContent(includeSchedulingLink, requestPhoneCall, true);
    setIsResettingToTemplate(false);

    toast({
      title: '✨ Template Refreshed',
      description:
        'Email content has been reset to the current template with your selected options.',
      duration: 3000,
    });
  };

  // Load draft functionality
  const loadDraft = (draft: any) => {
    // Hydrate all state from the selected draft
    setSubject(draft.subject || '');
    setContent(draft.content || '');

    // Parse attachments if they exist (they might be stored as JSON)
    if (draft.attachments) {
      try {
        const attachments =
          typeof draft.attachments === 'string'
            ? JSON.parse(draft.attachments)
            : draft.attachments;
        setSelectedAttachments(attachments || []);
      } catch {
        setSelectedAttachments([]);
      }
    }

    // Load explicit boolean preferences from the draft data
    setIncludeSchedulingLink(draft.includeSchedulingLink || false);
    setRequestPhoneCall(draft.requestPhoneCall || false);

    // Clear the subject suggestion since we're loading a custom draft
    setSelectedSubjectSuggestion('custom');

    // Clear draft saved state since we're now editing
    setDraftSaved(false);

    // Mark as manual edits since we're loading custom draft content
    setHasManualEdits(true);
    lastGeneratedContentRef.current = draft.content || '';

    // Show success toast
    toast({
      title: '📝 Draft Loaded',
      description: `Draft from ${new Date(draft.updatedAt).toLocaleDateString()} has been loaded. You can continue editing.`,
      duration: 4000,
    });
  };

  const getDocumentIcon = (document: Document) => {
    const searchText = `${document.title} ${document.fileName}`.toLowerCase();
    if (searchText.includes('inventory') || searchText.includes('calculator'))
      return Calculator;
    if (searchText.includes('safety')) return Shield;
    if (searchText.includes('making') || searchText.includes('sandwich'))
      return Users;
    return FileText;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[85vh] flex flex-col p-4 sm:p-6">
        <DialogHeader className="pb-4 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Mail className="w-5 h-5 text-teal-600" />
            Send Email to Event Contact
            {draftSaved && (
              <Badge
                variant="outline"
                className="ml-2 bg-amber-50 text-amber-700 border-amber-300"
              >
                📝 Draft Saved
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto flex-1 pr-2">
          {/* Recipient Info */}
          <Card className="bg-gradient-to-r from-teal-50 to-cyan-100 border border-teal-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-teal-600" />
                <div>
                  <p className="font-medium text-gray-900">
                    {eventRequest.firstName} {eventRequest.lastName}
                  </p>
                  <p className="text-sm text-gray-600">{eventRequest.email}</p>
                  <p className="text-sm text-teal-700 font-medium">
                    {eventRequest.organizationName}
                  </p>
                  {eventRequest.department && (
                    <p className="text-sm text-gray-600">
                      {eventRequest.department}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Load Draft Section */}
          {isDraftsLoading && (
            <Card className="bg-brand-primary-lighter border border-brand-primary-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-brand-primary-muted animate-spin" />
                  <div>
                    <p className="font-medium text-brand-primary-darker">
                      Loading drafts...
                    </p>
                    <p className="text-sm text-brand-primary-muted">
                      Checking for previously saved drafts for this event.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!isDraftsLoading && availableDrafts.length > 0 && (
            <Card className="bg-amber-50 border border-amber-200">
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-amber-600" />
                    <Label className="text-sm font-medium text-amber-900">
                      Previous Drafts Found ({availableDrafts.length})
                    </Label>
                  </div>
                  <p className="text-sm text-amber-700">
                    You have saved drafts for this event. Load one to continue
                    where you left off.
                  </p>
                  <div className="space-y-2">
                    {availableDrafts.map((draft: any) => (
                      <div
                        key={draft.id}
                        className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 truncate">
                            {draft.subject || 'Untitled Draft'}
                          </p>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span>
                              Saved:{' '}
                              {new Date(draft.updatedAt).toLocaleDateString()}{' '}
                              at{' '}
                              {new Date(draft.updatedAt).toLocaleTimeString(
                                [],
                                { hour: '2-digit', minute: '2-digit' }
                              )}
                            </span>
                            <span>To: {draft.recipientName}</span>
                          </div>
                          {draft.content && (
                            <p className="text-sm text-gray-500 mt-1 truncate">
                              {draft.content.substring(0, 100)}...
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => loadDraft(draft)}
                          className="ml-3 bg-amber-100 border-amber-300 text-amber-700 hover:bg-amber-200"
                          data-testid={`button-load-draft-${draft.id}`}
                        >
                          <History className="w-4 h-4 mr-1" />
                          Load Draft
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Original Request Message */}
          {eventRequest.message && (
            <Card className="bg-gray-50 border border-gray-200">
              <CardContent className="p-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-gray-600" />
                    <Label className="text-sm font-medium text-gray-700">
                      Original Request Message:
                    </Label>
                  </div>
                  <div className="pl-7">
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                      {eventRequest.message}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Subject Suggestions */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              Quick Subject Ideas (optional)
            </Label>
            <Select
              value={selectedSubjectSuggestion}
              onValueChange={setSelectedSubjectSuggestion}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a subject suggestion or write your own" />
              </SelectTrigger>
              <SelectContent>
                {SUBJECT_SUGGESTIONS.map((suggestion, index) => (
                  <SelectItem key={index} value={suggestion}>
                    {suggestion === 'custom'
                      ? 'Custom subject'
                      : suggestion.replace(
                          '{organizationName}',
                          eventRequest.organizationName
                        )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="subject" className="text-sm font-medium">
              Subject
            </Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter email subject"
              className="w-full"
            />
          </div>

          {/* Content */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Message Format</Label>

            <RadioGroup
              value={emailFormat}
              onValueChange={(value: 'html' | 'plaintext') => {
                setEmailFormat(value);
                // Regenerate content in the new format (pass value directly to avoid race condition)
                regenerateEmailContent(includeSchedulingLink, requestPhoneCall, undefined, value);
              }}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="html"
                  id="format-html"
                  data-testid="radio-html"
                />
                <Label
                  htmlFor="format-html"
                  className="cursor-pointer font-normal"
                >
                  Use prebuilt HTML template
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="plaintext"
                  id="format-plaintext"
                  data-testid="radio-plaintext"
                />
                <Label
                  htmlFor="format-plaintext"
                  className="cursor-pointer font-normal"
                >
                  Write plain text email
                </Label>
              </div>
            </RadioGroup>

            {/* Template Style Selection (only for HTML format) */}
            {emailFormat === 'html' && (
              <div className="mt-4">
                <Label className="text-sm font-medium mb-2 block">Template Style</Label>
                <RadioGroup
                  value={templateStyle}
                  onValueChange={(value: 'classic' | 'optimized') => {
                    setTemplateStyle(value);
                    // Regenerate content with new template style (pass value directly to avoid race condition)
                    regenerateEmailContent(includeSchedulingLink, requestPhoneCall, value);
                  }}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="optimized"
                      id="style-optimized"
                      data-testid="radio-optimized"
                    />
                    <Label
                      htmlFor="style-optimized"
                      className="cursor-pointer font-normal"
                    >
                      ⚡ Optimized (Engagement-focused)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="classic"
                      id="style-classic"
                      data-testid="radio-classic"
                    />
                    <Label
                      htmlFor="style-classic"
                      className="cursor-pointer font-normal"
                    >
                      📋 Classic (Original)
                    </Label>
                  </div>
                </RadioGroup>
                <p className="text-xs text-gray-500 mt-2">
                  {templateStyle === 'optimized'
                    ? '✓ Optimized template: Quick Start summary, prominent CTA, condensed details'
                    : '✓ Classic template: Traditional format with full information sections'}
                </p>
              </div>
            )}

            <div className="mt-4">
              {emailFormat === 'plaintext' && hasManualEdits && (
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                    <AlertTriangle className="w-3 h-3" />
                    Custom content
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetToTemplate}
                    className="text-xs h-7 bg-brand-primary-lighter border-brand-primary-border-strong text-brand-primary hover:bg-brand-primary-light"
                    data-testid="button-reset-template"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Reset to Template
                  </Button>
                </div>
              )}

              {emailFormat === 'plaintext' && (
                <div className="text-xs text-gray-500 mb-2 p-2 bg-blue-50 rounded border border-blue-200">
                  💡 <strong>Quick Links:</strong> Inventory Calculator:
                  https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html
                  | Please reply with your phone number and best times to call
                </div>
              )}

              {emailFormat === 'html' ? (
                <div className="border rounded-lg overflow-hidden bg-white">
                  <div className="bg-gray-100 px-3 py-2 text-xs text-gray-600 border-b">
                    Email Preview (this is how the recipient will see it)
                  </div>
                  <div
                    className="p-4 max-h-[400px] overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
                    data-testid="email-preview"
                  />
                </div>
              ) : (
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Write your message here..."
                  className="min-h-[300px] w-full resize-none"
                  data-testid="textarea-email-content"
                />
              )}
            </div>
          </div>

          {/* Next Step Options */}
          <div className="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <Label className="text-sm font-medium text-gray-700">
              Next Steps for Event Scheduling (select at least one):
            </Label>

            {/* Scheduling Link Option */}
            <div className="flex items-center space-x-3">
              <Checkbox
                id="include-scheduling"
                checked={includeSchedulingLink}
                onCheckedChange={(checked) => {
                  setIncludeSchedulingLink(checked as boolean);
                  if (checked) {
                    setRequestPhoneCall(false); // Make them mutually exclusive
                  }
                }}
              />
              <Label
                htmlFor="include-scheduling"
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <Calendar className="w-4 h-4 text-teal-600" />
                Include self-service scheduling link
              </Label>
            </div>

            {/* Phone Call Request Option */}
            <div className="flex items-center space-x-3">
              <Checkbox
                id="request-phone"
                checked={requestPhoneCall}
                onCheckedChange={(checked) => {
                  setRequestPhoneCall(checked as boolean);
                  if (checked) {
                    setIncludeSchedulingLink(false); // Make them mutually exclusive
                  }
                }}
              />
              <Label
                htmlFor="request-phone"
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <Users className="w-4 h-4 text-orange-600" />
                Request they reply with phone number for follow-up call
              </Label>
            </div>

            {!includeSchedulingLink && !requestPhoneCall && (
              <p className="text-xs text-amber-600 italic">
                ⚠️ At least one follow-up method should be selected
              </p>
            )}

            {hasManualEdits && (includeSchedulingLink || requestPhoneCall) && (
              <p className="text-xs text-brand-primary-muted italic bg-brand-primary-lighter p-2 rounded border border-brand-primary-border">
                💡 Your custom content is preserved. Use "Reset to Template"
                above to apply these new options.
              </p>
            )}
          </div>

          {/* Attachments */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Paperclip className="w-4 h-4" />
              Attach Documents (optional)
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {documents.map((doc) => {
                const IconComponent = getDocumentIcon(doc);
                const isSelected = selectedAttachments.includes(doc.filePath);

                return (
                  <Card
                    key={doc.id}
                    className={`cursor-pointer transition-all duration-200 ${
                      isSelected
                        ? 'bg-gradient-to-r from-teal-100 to-cyan-200 border-teal-300 shadow-md'
                        : 'bg-gradient-to-r from-gray-50 to-white border-gray-200 hover:border-teal-200'
                    }`}
                    onClick={() => toggleAttachment(doc.filePath)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleAttachment(doc.filePath)}
                          className="flex-shrink-0"
                        />
                        <IconComponent
                          className={`w-4 h-4 flex-shrink-0 ${
                            isSelected ? 'text-teal-600' : 'text-gray-500'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-sm font-medium truncate ${
                              isSelected ? 'text-teal-900' : 'text-gray-700'
                            }`}
                          >
                            {doc.title}
                          </p>
                          <p className="text-xs text-gray-500 uppercase">
                            {doc.category || 'Document'}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {selectedAttachments.length > 0 && (
              <div className="mt-3">
                <Badge
                  variant="outline"
                  className="bg-gradient-to-r from-teal-100 to-cyan-200 text-teal-800 border-teal-300"
                >
                  {selectedAttachments.length} document
                  {selectedAttachments.length !== 1 ? 's' : ''} selected
                </Badge>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t flex-shrink-0">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Cancel
          </Button>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => handleSend(true)}
              disabled={sendEmailMutation.isPending}
              className="flex items-center gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              <Clock className="w-4 h-4" />
              {sendEmailMutation.isPending && isDraft
                ? 'Saving Draft...'
                : 'Save as Draft'}
            </Button>

            <Button
              onClick={() => handleSend(false)}
              disabled={
                sendEmailMutation.isPending ||
                !subject.trim() ||
                !content.trim()
              }
              className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-cyan-700 hover:from-teal-700 hover:to-cyan-800"
            >
              <Send className="w-4 h-4" />
              {sendEmailMutation.isPending && !isDraft
                ? 'Sending Email...'
                : 'Send Email Now'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
