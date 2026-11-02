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

interface LogContactAttemptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequest: EventRequest | null;
  onLogContact: (data: {
    contactAttempts: number;
    lastContactAttempt: string;
    contactMethod: string;
    contactOutcome: string;
    contactAttemptsLog: Array<{
      attemptNumber: number;
      timestamp: string;
      method: string;
      outcome: string;
      notes?: string;
      createdBy: string;
      createdByName?: string;
      loggedBy?: string;
      loggedByName?: string;
    }>;
    // Legacy field - kept for backward compatibility but no longer written to
    unresponsiveNotes?: string;
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

export default function LogContactAttemptDialog({
  isOpen,
  onClose,
  eventRequest,
  onLogContact,
}: LogContactAttemptDialogProps) {
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

  // Set default date/time to current when dialog opens, and reset attribution to current user
  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCustomDateTime(`${year}-${month}-${day}T${hours}:${minutes}`);
      // Default to current user, but allow changing
      setAttributedToUserId(user?.id || '');
    }
  }, [isOpen, user?.id]);

  const handleSubmit = async () => {
    if (!contactMethod || !contactOutcome || !attributedToUserId) {
      toast({
        title: 'Missing information',
        description: 'Please select contact method, outcome, and who made the contact.',
        variant: 'destructive',
      });
      return;
    }

    // When outcome is "Other", require a note explaining what "Other" means —
    // otherwise the log becomes useless for follow-up.
    if (contactOutcome === 'other' && !notes.trim()) {
      toast({
        title: 'Notes required',
        description: 'When the outcome is "Other", please describe what happened in the notes field.',
        variant: 'destructive',
      });
      return;
    }

    if (!eventRequest) return;

    setIsSubmitting(true);
    try {
      // Use custom date/time or current time
      const contactDate = customDateTime ? new Date(customDateTime) : new Date();

      // Build structured contact attempt log (new format only)
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

      // Create new attempt without attemptNumber (will be assigned after sorting)
      const newAttempt = {
        attemptNumber: 0, // Placeholder, will be updated after sorting
        timestamp: contactDate.toISOString(),
        method: contactMethod,
        outcome: contactOutcome,
        notes: notes || undefined,
        createdBy: attributedUser?.id || 'unknown',
        createdByName,
        // Track who actually logged it (for audit purposes)
        loggedBy: user?.id || 'unknown',
        loggedByName: user?.displayName || 
          (user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}`.trim() : user?.email) || 
          'Unknown',
      };

      // Add new attempt to existing log
      const allAttempts = [...existingLog, newAttempt];

      // Sort all attempts by timestamp (chronological order, oldest first)
      allAttempts.sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return dateA - dateB;
      });

      // Renumber attempts sequentially based on chronological order
      const updatedLog = allAttempts.map((attempt, index) => ({
        ...attempt,
        attemptNumber: index + 1,
      }));

      // Find the most recent contact attempt (last in sorted array)
      const mostRecentAttempt = updatedLog[updatedLog.length - 1];
      const lastContactAttempt = mostRecentAttempt.timestamp;

      // Total count is the length of the array
      const totalAttempts = updatedLog.length;

      // Find which attempt number was assigned to the newly added attempt
      const addedAttemptIndex = updatedLog.findIndex(
        (attempt) => attempt.timestamp === contactDate.toISOString() &&
        attempt.method === contactMethod &&
        attempt.outcome === contactOutcome
      );
      const addedAttemptNumber = addedAttemptIndex !== -1 ? addedAttemptIndex + 1 : totalAttempts;

      await onLogContact({
        contactAttempts: totalAttempts,
        lastContactAttempt: lastContactAttempt,
        contactMethod,
        contactOutcome,
        contactAttemptsLog: updatedLog,
        // No longer writing to unresponsiveNotes - using structured format only
      });

      const methodLabel = CONTACT_METHODS.find(m => m.value === contactMethod)?.label || contactMethod;
      toast({
        title: 'Contact attempt logged',
        description: `Logged attempt #${addedAttemptNumber} via ${methodLabel}`,
      });

      // Reset form
      setContactMethod('');
      setContactOutcome('');
      setNotes('');
      setCustomDateTime('');
      setAttributedToUserId(user?.id || '');
      onClose();
    } catch (error) {
      toast({
        title: 'Failed to log contact',
        description: 'There was an error logging the contact attempt.',
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
      setAttributedToUserId(user?.id || '');
      onClose();
    }
  };

  if (!eventRequest) return null;

  const currentAttempts = eventRequest.contactAttempts || 0;
  const nextAttemptNumber = currentAttempts + 1;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-md sm:max-w-lg p-4 sm:p-6" data-testid="dialog-log-contact">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2 text-[#236383]">
            <MessageSquare className="w-5 h-5" />
            <span>Log Contact Attempt</span>
          </DialogTitle>
          <DialogDescription>
            Record your contact attempt for {eventRequest.firstName} {eventRequest.lastName} - {eventRequest.organizationName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Attempt Counter */}
          <div className="bg-gradient-to-r from-[#e6f2f5] to-[#f0f7f9] border border-[#236383]/20 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#236383] font-medium">Previous Attempts</p>
                <p className="text-2xl font-bold text-[#1A2332]">{currentAttempts}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-[#236383] font-medium">This Will Be</p>
                <p className="text-2xl font-bold text-[#FBAD3F]">Attempt #{nextAttemptNumber}</p>
              </div>
            </div>
            {eventRequest.lastContactAttempt && (
              <p className="text-xs text-gray-600 mt-2">
                Last attempt: {new Date(eventRequest.lastContactAttempt).toLocaleString('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            )}
          </div>

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
            <p className="text-xs text-gray-500">
              Defaults to current date/time. You can change this to log a contact from earlier.
            </p>
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
            <p className="text-xs text-gray-500">
              Select the team member who actually made this contact attempt. Defaults to you.
            </p>
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
            <p className="text-xs text-gray-500">
              This will be saved with a timestamp and attempt number in the event record.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t">
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !contactMethod || !contactOutcome || !attributedToUserId}
              className="flex-1 bg-[#236383] hover:bg-[#1e5a75] text-white"
              data-testid="button-submit-contact-log"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Logging...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Log Attempt #{nextAttemptNumber}
                </>
              )}
            </Button>
            <Button
              onClick={handleClose}
              disabled={isSubmitting}
              variant="outline"
              className="flex-1 sm:flex-none"
              data-testid="button-cancel-contact-log"
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
