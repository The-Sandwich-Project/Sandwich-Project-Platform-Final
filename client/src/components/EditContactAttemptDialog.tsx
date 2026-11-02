import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Phone, Mail, MessageSquare, X, CheckCircle, User, MessageCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { EventRequest } from '@shared/schema';
import type { User as UserType } from '@shared/schema';

interface ContactAttempt {
  attemptNumber: number;
  timestamp: string;
  method: string;
  outcome: string;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  loggedBy?: string;
  loggedByName?: string;
}

interface EditContactAttemptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequest: EventRequest | null;
  contactAttempt: ContactAttempt | null;
  onEditContact: (data: {
    contactAttempts: number;
    lastContactAttempt: string;
    contactMethod: string;
    contactOutcome: string;
    contactAttemptsLog: Array<ContactAttempt>;
  }) => Promise<void>;
}

const CONTACT_METHODS = [
  { value: 'phone', label: 'Phone', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'text', label: 'Text', icon: MessageCircle },
  { value: 'both', label: 'Phone & Email', icon: MessageSquare },
  { value: 'phone_and_toolkit', label: 'Phone + Toolkit Email', icon: MessageSquare },
  { value: 'email_and_toolkit', label: 'Email + Toolkit', icon: Mail },
];

const CONTACT_OUTCOMES = [
  { value: 'successful', label: 'Successfully contacted - Got response' },
  { value: 'toolkit_sent', label: 'Toolkit sent' },
  { value: 'toolkit_sent_left_message', label: 'Toolkit sent + Left voicemail' },
  { value: 'no_answer', label: 'No answer - No response' },
  { value: 'left_message', label: 'Left voicemail/message' },
  { value: 'wrong_number', label: 'Wrong/disconnected number' },
  { value: 'email_bounced', label: 'Email bounced/failed' },
  { value: 'requested_callback', label: 'Requested callback/follow-up' },
  { value: 'other', label: 'Other (see notes)' },
];

export default function EditContactAttemptDialog({
  isOpen,
  onClose,
  eventRequest,
  contactAttempt,
  onEditContact,
}: EditContactAttemptDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [contactMethod, setContactMethod] = useState<string>('');
  const [contactOutcome, setContactOutcome] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [customDateTime, setCustomDateTime] = useState<string>('');
  const [attributedToUserId, setAttributedToUserId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch team members for attribution dropdown
  const { data: teamMembers = [], isLoading: isLoadingTeamMembers } = useQuery<UserType[]>({
    queryKey: ['/api/users/for-assignments'],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', '/api/users/for-assignments');
        return Array.isArray(response) ? response : [];
      } catch (error) {
        console.error('Error fetching team members:', error);
        return [];
      }
    },
    retry: false,
  });

  // Pre-populate form with existing contact attempt data
  useEffect(() => {
    if (isOpen && contactAttempt) {
      setContactMethod(contactAttempt.method);
      setContactOutcome(contactAttempt.outcome);
      setNotes(contactAttempt.notes || '');

      // Convert timestamp to local datetime-local format (YYYY-MM-DDTHH:mm)
      const attemptDate = new Date(contactAttempt.timestamp);
      const year = attemptDate.getFullYear();
      const month = String(attemptDate.getMonth() + 1).padStart(2, '0');
      const day = String(attemptDate.getDate()).padStart(2, '0');
      const hours = String(attemptDate.getHours()).padStart(2, '0');
      const minutes = String(attemptDate.getMinutes()).padStart(2, '0');
      setCustomDateTime(`${year}-${month}-${day}T${hours}:${minutes}`);

      setAttributedToUserId(contactAttempt.createdBy);
    }
  }, [isOpen, contactAttempt]);

  const handleSubmit = async () => {
    if (!contactMethod || !contactOutcome || !attributedToUserId) {
      toast({
        title: 'Missing information',
        description: 'Please select contact method, outcome, and who made the contact.',
        variant: 'destructive',
      });
      return;
    }

    // When outcome is "Other", require a note explaining what "Other" means.
    if (contactOutcome === 'other' && !notes.trim()) {
      toast({
        title: 'Notes required',
        description: 'When the outcome is "Other", please describe what happened in the notes field.',
        variant: 'destructive',
      });
      return;
    }

    if (!eventRequest || !contactAttempt) return;

    setIsSubmitting(true);
    try {
      // Use the updated date/time
      const contactDate = customDateTime ? new Date(customDateTime) : new Date(contactAttempt.timestamp);

      // Get existing log
      const existingLog = eventRequest.contactAttemptsLog || [];

      // Find the user to attribute the contact attempt to
      const attributedUser = attributedToUserId
        ? teamMembers.find(u => u.id === attributedToUserId)
        : user;

      // Build user name with proper fallback logic for the attributed user
      let createdByName: string | undefined;
      if (attributedUser?.displayName) {
        createdByName = attributedUser.displayName;
      } else if (attributedUser?.firstName && attributedUser?.lastName) {
        createdByName = `${attributedUser.firstName} ${attributedUser.lastName}`.trim();
      } else if (attributedUser?.email) {
        createdByName = attributedUser.email;
      } else if (attributedUser?.id) {
        createdByName = `User ${attributedUser.id}`;
      } else {
        createdByName = 'Unknown User';
      }

      // Update the specific attempt
      const updatedAttempt: ContactAttempt = {
        ...contactAttempt,
        timestamp: contactDate.toISOString(),
        method: contactMethod,
        outcome: contactOutcome,
        notes: notes || undefined,
        createdBy: attributedUser?.id || 'unknown',
        createdByName,
        // Keep the original loggedBy but add edit tracking
        loggedBy: contactAttempt.loggedBy,
        loggedByName: contactAttempt.loggedByName,
      };

      // Replace the old attempt with the updated one
      const updatedLog = existingLog.map(attempt =>
        attempt.timestamp === contactAttempt.timestamp &&
        attempt.attemptNumber === contactAttempt.attemptNumber
          ? updatedAttempt
          : attempt
      );

      // Sort all attempts by timestamp (chronological order, oldest first)
      updatedLog.sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return dateA - dateB;
      });

      // Renumber attempts sequentially based on chronological order
      const renumberedLog = updatedLog.map((attempt, index) => ({
        ...attempt,
        attemptNumber: index + 1,
      }));

      // Find the most recent contact attempt (last in sorted array)
      const mostRecentAttempt = renumberedLog[renumberedLog.length - 1];
      const lastContactAttempt = mostRecentAttempt.timestamp;

      // Total count is the length of the array
      const totalAttempts = renumberedLog.length;

      await onEditContact({
        contactAttempts: totalAttempts,
        lastContactAttempt: lastContactAttempt,
        contactMethod: mostRecentAttempt.method,
        contactOutcome: mostRecentAttempt.outcome,
        contactAttemptsLog: renumberedLog,
      });

      const methodLabel = CONTACT_METHODS.find(m => m.value === contactMethod)?.label || contactMethod;
      toast({
        title: 'Contact attempt updated',
        description: `Updated attempt via ${methodLabel}`,
      });

      // Reset form
      setContactMethod('');
      setContactOutcome('');
      setNotes('');
      setCustomDateTime('');
      setAttributedToUserId('');
      onClose();
    } catch (error) {
      toast({
        title: 'Failed to update contact',
        description: 'There was an error updating the contact attempt.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setContactMethod('');
      setContactOutcome('');
      setNotes('');
      setCustomDateTime('');
      setAttributedToUserId('');
      onClose();
    }
  };

  if (!eventRequest || !contactAttempt) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-md sm:max-w-lg p-4 sm:p-6" data-testid="dialog-edit-contact">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2 text-[#236383]">
            <MessageSquare className="w-5 h-5" />
            <span>Edit Contact Attempt #{contactAttempt.attemptNumber}</span>
          </DialogTitle>
          <DialogDescription>
            Edit contact attempt for {eventRequest.firstName} {eventRequest.lastName} - {eventRequest.organizationName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Date/Time of Contact */}
          <div className="space-y-2">
            <Label htmlFor="contact-datetime" className="text-[#1A2332] font-medium">
              Date & Time of Contact *
            </Label>
            <Input
              id="contact-datetime"
              type="datetime-local"
              value={customDateTime}
              onChange={(e) => setCustomDateTime(e.target.value)}
              className="w-full"
              data-testid="input-contact-datetime"
            />
          </div>

          {/* Attributed To */}
          <div className="space-y-2">
            <Label htmlFor="attributed-to" className="text-[#1A2332] font-medium">
              Who Made This Contact? *
            </Label>
            <Select
              value={attributedToUserId}
              onValueChange={setAttributedToUserId}
              disabled={isLoadingTeamMembers}
            >
              <SelectTrigger id="attributed-to" className="w-full">
                <SelectValue placeholder="Select team member who made the contact" />
              </SelectTrigger>
              <SelectContent>
                {teamMembers.map((member) => {
                  const displayName = member.displayName ||
                    `${member.firstName || ''} ${member.lastName || ''}`.trim() ||
                    member.email;
                  return (
                    <SelectItem key={member.id} value={member.id}>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        <span>{displayName}</span>
                        {member.email && member.email !== displayName && (
                          <span className="text-xs text-gray-500">({member.email})</span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Contact Method */}
          <div className="space-y-2">
            <Label htmlFor="contact-method" className="text-[#1A2332] font-medium">
              Contact Method *
            </Label>
            <Select value={contactMethod} onValueChange={setContactMethod}>
              <SelectTrigger id="contact-method" className="w-full">
                <SelectValue placeholder="Select how you contacted them" />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_METHODS.map((method) => {
                  const Icon = method.icon;
                  return (
                    <SelectItem key={method.value} value={method.value}>
                      <div className="flex items-center space-x-2">
                        <Icon className="w-4 h-4" />
                        <span>{method.label}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Contact Outcome */}
          <div className="space-y-2">
            <Label htmlFor="contact-outcome" className="text-[#1A2332] font-medium">
              What Happened? *
            </Label>
            <Select value={contactOutcome} onValueChange={setContactOutcome}>
              <SelectTrigger id="contact-outcome" className="w-full">
                <SelectValue placeholder="Select the outcome" />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_OUTCOMES.map((outcome) => (
                  <SelectItem key={outcome.value} value={outcome.value}>
                    {outcome.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes — required when outcome is "Other", otherwise optional */}
          <div className="space-y-2">
            <Label htmlFor="contact-notes" className="text-[#1A2332] font-medium">
              {contactOutcome === 'other' ? (
                <>
                  Notes <span className="text-red-600">*</span>{' '}
                  <span className="text-xs font-normal text-red-600">
                    (required — please describe what "Other" means)
                  </span>
                </>
              ) : (
                <>Notes (Optional)</>
              )}
            </Label>
            <Textarea
              id="contact-notes"
              placeholder={
                contactOutcome === 'other'
                  ? 'Required: describe what happened on this contact attempt…'
                  : 'Add any additional details about this contact attempt...'
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className={`resize-none ${
                contactOutcome === 'other' && !notes.trim()
                  ? 'border-red-300 focus-visible:ring-red-300'
                  : ''
              }`}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t">
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !contactMethod || !contactOutcome || !attributedToUserId}
              className="flex-1 bg-[#236383] hover:bg-[#1e5a75] text-white"
              data-testid="button-submit-contact-edit"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Updating...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
            <Button
              onClick={handleClose}
              disabled={isSubmitting}
              variant="outline"
              className="flex-1 sm:flex-none"
              data-testid="button-cancel-contact-edit"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
