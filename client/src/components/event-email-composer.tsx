import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { EditableEmailPreview } from '@/components/editable-email-preview';
import {
  TOOLKIT_EMAIL_TEMPLATE_TYPE,
  buildToolkitEmailHtml,
  canOfferCallMe,
  type ToolkitNextStep,
} from '@shared/toolkit-email-template';
import { AiEmailHelper } from '@/components/ai-email-helper';

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
  const [draftSaved, setDraftSaved] = useState(false);
  // Next step the email asks for. "Call me" needs the sender's phone number.
  const [nextStep, setNextStep] = useState<ToolkitNextStep>('availability');
  const [customNextStep, setCustomNextStep] = useState('');
  // The request came in without a phone number: offer (and default to) asking for one.
  const requestHasNoPhone = !(eventRequest.phone && eventRequest.phone.trim());
  const [askForPhone, setAskForPhone] = useState(requestHasNoPhone);

  // Smart regeneration state management
  const [hasManualEdits, setHasManualEdits] = useState(false);
  // True while "Write with AI" is rewriting the email: the subject, body and
  // anything that would regenerate them are locked so edits can't be lost.
  const [aiBusy, setAiBusy] = useState(false);
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

  // Saved wording for the toolkit email (Email Templates admin page). Any
  // section without a saved change uses the default in toolkit-email-template.
  const { data: templateSections } = useQuery<EmailTemplateSection[]>({
    queryKey: ['/api/email-templates/sections'],
    enabled: isOpen,
  });
  const savedToolkitSections = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const section of templateSections || []) {
      if (section.templateType === TOOLKIT_EMAIL_TEMPLATE_TYPE) {
        map[section.sectionKey] = section.currentContent ?? null;
      }
    }
    return map;
  }, [templateSections]);

  const senderPhone = user?.phoneNumber || '';
  const callMeAvailable = canOfferCallMe(senderPhone);

  // Build the email from the template with the current choices.
  const regenerateEmailContent = () => {
    const senderName =
      user?.firstName && user?.lastName
        ? `${user.firstName} ${user.lastName}`
        : user?.email || 'The Sandwich Project Team';
    const senderEmail =
      user?.preferredEmail || user?.email || 'info@thesandwichproject.org';
    const html = buildToolkitEmailHtml({
      firstName: eventRequest.firstName,
      organizationName: eventRequest.organizationName,
      senderName,
      senderEmail,
      senderPhone,
      nextStep: nextStep === 'call' && !callMeAvailable ? 'availability' : nextStep,
      customNextStep,
      askForPhone,
      sections: savedToolkitSections,
    });
    setContent(html);
    lastGeneratedContentRef.current = html;
  };

  // Rebuild unless the sender has edited the email (or always, when forced by
  // "Reset to Template").
  const smartRegenerateEmailContent = (force: boolean = false) => {
    if (hasManualEdits && !force) return false;
    regenerateEmailContent();
    setHasManualEdits(false);
    return true;
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

  // Rebuild the email when a choice changes or the saved wording loads,
  // unless the sender has edited it. The panel tells them their edits are kept
  // and to use "Reset to Template" to apply the new choices.
  useEffect(() => {
    if (isInitialLoad.current || isResettingToTemplate) return;
    if (!isOpen || !content || aiBusy) return;
    if (hasManualEdits) return;
    regenerateEmailContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextStep, customNextStep, askForPhone, savedToolkitSections]);

  // Build the email when the composer opens.
  useEffect(() => {
    if (isOpen && !content) {
      regenerateEmailContent();
      setHasManualEdits(false);
      setSubject(`Your Sandwich-Making Event Toolkit + Next Steps`);
      isInitialLoad.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, eventRequest, user]);

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
      // specific Twilio Email rejection reason — prefer that so the operator sees an
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
      includeSchedulingLink: false,
      requestPhoneCall: askForPhone,
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
    smartRegenerateEmailContent(true);
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

    // The draft remembers whether it asked for a phone number.
    setAskForPhone(!!draft.requestPhoneCall);

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
              disabled={aiBusy}
            />
          </div>

          {/* Content */}
          <div className="space-y-3">
            {/* Next step */}
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200" data-testid="toolkit-next-step">
              <div>
                <Label className="text-sm font-medium text-gray-700">Next step</Label>
                <p className="text-xs text-gray-500 mt-0.5">
                  Finishes the sentence "Once you've had a chance to look it over, …"
                </p>
              </div>
              <RadioGroup
                disabled={aiBusy}
                value={nextStep}
                onValueChange={(value: ToolkitNextStep) => setNextStep(value)}
                className="space-y-2"
              >
                <div className="flex items-start space-x-2">
                  <RadioGroupItem value="availability" id="next-step-availability" data-testid="radio-next-availability" />
                  <Label htmlFor="next-step-availability" className="cursor-pointer font-normal leading-snug">
                    <span className="font-medium">Request availability</span>
                    <span className="block text-xs text-gray-500">"I'd love to set up a time to chat. Just reply with a few dates and times that work for you."</span>
                  </Label>
                </div>
                <div className="flex items-start space-x-2">
                  <RadioGroupItem
                    value="call"
                    id="next-step-call"
                    disabled={!callMeAvailable}
                    data-testid="radio-next-call"
                  />
                  <Label
                    htmlFor="next-step-call"
                    className={`font-normal leading-snug ${callMeAvailable ? 'cursor-pointer' : 'text-gray-400'}`}
                  >
                    <span className="font-medium">Call me</span>
                    <span className="block text-xs text-gray-500">
                      {callMeAvailable
                        ? `"…please feel free to give me a call at ${senderPhone} whenever it's convenient."`
                        : 'Add your phone number in your profile to use this.'}
                    </span>
                  </Label>
                </div>
                <div className="flex items-start space-x-2">
                  <RadioGroupItem value="custom" id="next-step-custom" data-testid="radio-next-custom" />
                  <Label htmlFor="next-step-custom" className="cursor-pointer font-normal leading-snug">
                    <span className="font-medium">Custom</span>
                  </Label>
                </div>
              </RadioGroup>
              {nextStep === 'custom' && (
                <Input
                  value={customNextStep}
                  onChange={(e) => setCustomNextStep(e.target.value)}
                  placeholder="e.g. let's find a time to talk later this week."
                  disabled={aiBusy}
                  data-testid="input-custom-next-step"
                />
              )}

              {requestHasNoPhone && (
                <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2">
                  <Checkbox
                    id="ask-for-phone"
                    checked={askForPhone}
                    disabled={aiBusy}
                    onCheckedChange={(checked) => setAskForPhone(checked === true)}
                    data-testid="checkbox-ask-for-phone"
                  />
                  <Label htmlFor="ask-for-phone" className="cursor-pointer text-sm font-normal text-amber-900 leading-snug">
                    No phone number on file. Ask them to share one?
                  </Label>
                </div>
              )}

              {hasManualEdits && (
                <p className="text-xs text-brand-primary-muted italic bg-brand-primary-lighter p-2 rounded border border-brand-primary-border">
                  💡 Your edits are kept. Use "Reset to Template" below to apply these choices.
                </p>
              )}
            </div>

            <div className="mt-4">
              <AiEmailHelper
                eventRequestId={eventRequest.id}
                format="html"
                subject={subject}
                content={content}
                onApply={({ subject: nextSubject, content: nextContent }) => {
                  setSubject(nextSubject);
                  setContent(nextContent);
                  // Counts as an edit: keeps the template from overwriting it
                  // and shows "Reset to Template".
                  setHasManualEdits(true);
                }}
                onBusyChange={setAiBusy}
              />
            </div>

            <div className="mt-4 relative" aria-busy={aiBusy}>
              {aiBusy && (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70 backdrop-blur-[1px]"
                  data-testid="ai-writing-overlay"
                >
                  <div className="flex items-center gap-2 rounded-full border border-purple-200 bg-white px-4 py-2 text-sm text-purple-800 shadow-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    AI is rewriting your email…
                  </div>
                </div>
              )}
              {hasManualEdits && (
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                    <AlertTriangle className="w-3 h-3" />
                    Custom content
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetToTemplate}
                    disabled={aiBusy}
                    className="text-xs h-7 bg-brand-primary-lighter border-brand-primary-border-strong text-brand-primary hover:bg-brand-primary-light"
                    data-testid="button-reset-template"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Reset to Template
                  </Button>
                </div>
              )}

              <div className="border rounded-lg overflow-hidden bg-white">
                  <div className="bg-gray-100 px-3 py-2 text-xs text-gray-600 border-b">
                    <strong>Click any text below to edit it.</strong> This is
                    how the recipient will see it.
                  </div>
                  <EditableEmailPreview
                    html={content}
                    onChange={handleContentChange}
                    readOnly={aiBusy}
                    data-testid="email-preview"
                  />
                </div>
            </div>
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
              disabled={sendEmailMutation.isPending || aiBusy}
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
                aiBusy ||
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
