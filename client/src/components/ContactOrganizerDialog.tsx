import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Mail,
  Phone,
  Copy,
  Building,
  User,
  ExternalLink,
  CheckCircle,
  X,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import type { EventRequest } from '@shared/schema';

interface ContactOrganizerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequest: EventRequest | null;
}

interface CopyState {
  [key: string]: boolean;
}

export default function ContactOrganizerDialog({
  isOpen,
  onClose,
  eventRequest,
}: ContactOrganizerDialogProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [copyStates, setCopyStates] = useState<CopyState>({});

  // Helper function to handle copying text to clipboard
  const handleCopy = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStates(prev => ({ ...prev, [type]: true }));
      
      toast({
        title: 'Copied to clipboard!',
        description: `${type} has been copied to your clipboard.`,
      });

      // Reset copy state after 2 seconds
      setTimeout(() => {
        setCopyStates(prev => ({ ...prev, [type]: false }));
      }, 2000);
    } catch (error) {
      toast({
        title: 'Failed to copy',
        description: `Please copy manually: ${text}`,
        variant: 'destructive',
      });
    }
  };

  // Helper function to handle email functionality
  const handleEmail = () => {
    if (!eventRequest?.email) return;

    const subject = encodeURIComponent(
      `Follow-up: Sandwich Event for ${eventRequest.organizationName}`
    );
    const body = encodeURIComponent(
      `Hello ${eventRequest.firstName},\n\nThank you for your interest in organizing a sandwich event with The Sandwich Project!\n\nI wanted to follow up regarding your event request for ${eventRequest.organizationName}${
        eventRequest.desiredEventDate 
          ? ` scheduled for ${new Date(eventRequest.desiredEventDate).toLocaleDateString()}`
          : ''
      }.\n\nPlease let me know if you have any questions or if there's anything else I can help you with.\n\nBest regards,\nThe Sandwich Project Team`
    );

    const mailtoLink = `mailto:${eventRequest.email}?subject=${subject}&body=${body}`;
    window.location.href = mailtoLink;
  };

  // Helper function to handle phone functionality
  const handlePhone = () => {
    if (!eventRequest?.phone) return;

    if (isMobile) {
      window.location.href = `tel:${eventRequest.phone}`;
    } else {
      handleCopy(eventRequest.phone || '', 'Phone number');
    }
  };

  // Helper function to copy all contact info
  const handleCopyAllInfo = () => {
    if (!eventRequest) return;

    const contactInfo = [
      `Name: ${eventRequest.firstName} ${eventRequest.lastName}`,
      `Organization: ${eventRequest.organizationName}`,
      eventRequest.email ? `Email: ${eventRequest.email}` : null,
      eventRequest.phone ? `Phone: ${eventRequest.phone}` : null,
      eventRequest.desiredEventDate 
        ? `Event Date: ${new Date(eventRequest.desiredEventDate).toLocaleDateString()}` 
        : null,
    ].filter(Boolean).join('\n');

    handleCopy(contactInfo, 'Contact information');
  };

  if (!eventRequest) return null;

  const contactName = `${eventRequest.firstName} ${eventRequest.lastName}`;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-md sm:max-w-lg p-4 sm:p-6" data-testid="dialog-contact-organizer">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2 text-[#236383]">
            <User className="w-5 h-5" />
            <span>Contact Organizer</span>
          </DialogTitle>
          <DialogDescription>
            Get in touch with the event organizer using the contact options below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Contact Information Card */}
          <div className="bg-gradient-to-r from-[#e6f2f5] to-[#f0f7f9] border border-[#236383]/20 rounded-lg p-4">
            <div className="space-y-3">
              {/* Name */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <User className="w-5 h-5 text-[#236383] flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-[#1A2332] text-lg">
                      {contactName}
                    </h3>
                    <p className="text-sm text-[#236383]">Event Contact</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(contactName, 'Contact name')}
                  className="h-8 px-2"
                  data-testid="button-copy-name"
                >
                  {copyStates['Contact name'] ? (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {/* Organization */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <Building className="w-5 h-5 text-[#236383] flex-shrink-0" />
                  <div>
                    <p className="font-medium text-[#1A2332]">
                      {eventRequest.organizationName}
                    </p>
                    <p className="text-sm text-[#236383]">Organization</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(eventRequest.organizationName || '', 'Organization name')}
                  className="h-8 px-2"
                  data-testid="button-copy-organization"
                >
                  {copyStates['Organization name'] ? (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {/* Event Date */}
              {eventRequest.desiredEventDate && (
                <div className="flex items-center space-x-3">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <div className="w-3 h-3 bg-[#FBAD3F] rounded-full"></div>
                  </div>
                  <div>
                    <p className="font-medium text-[#1A2332]">
                      {new Date(eventRequest.desiredEventDate).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                    <p className="text-sm text-[#236383]">Requested Event Date</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Contact Actions */}
          <div className="space-y-4">
            {/* Email Action */}
            {eventRequest.email && (
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <Mail className="w-5 h-5 text-[#236383]" />
                    <div>
                      <p className="font-medium text-[#1A2332]">{eventRequest.email}</p>
                      <p className="text-sm text-gray-600">Email Address</p>
                    </div>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button
                    onClick={handleEmail}
                    className="flex-1 bg-[#236383] hover:bg-[#1e5a75] text-white"
                    data-testid="button-email-contact"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Send Email
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopy(eventRequest.email, 'Email address')}
                    data-testid="button-copy-email"
                  >
                    {copyStates['Email address'] ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Phone Action */}
            {eventRequest.phone && (
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <Phone className="w-5 h-5 text-[#236383]" />
                    <div>
                      <p className="font-medium text-[#1A2332]">{eventRequest.phone}</p>
                      <p className="text-sm text-gray-600">Phone Number</p>
                    </div>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button
                    onClick={handlePhone}
                    className="flex-1 bg-[#FBAD3F] hover:bg-[#E89A2F] text-[#1A2332]"
                    data-testid="button-phone-contact"
                  >
                    <Phone className="w-4 h-4 mr-2" />
                    {isMobile ? 'Call Now' : 'Copy Phone'}
                    {isMobile && <ExternalLink className="w-4 h-4 ml-2" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopy(eventRequest.phone || '', 'Phone number')}
                    data-testid="button-copy-phone"
                  >
                    {copyStates['Phone number'] ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t">
            <Button
              onClick={handleCopyAllInfo}
              variant="outline"
              className="flex-1"
              data-testid="button-copy-all-info"
            >
              {copyStates['Contact information'] ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                  Copied All Info
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy All Info
                </>
              )}
            </Button>
            <Button
              onClick={onClose}
              variant="outline"
              className="flex-1 sm:flex-none"
              data-testid="button-close-dialog"
            >
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}