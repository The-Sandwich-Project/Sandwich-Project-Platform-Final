import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Send, Check, MessageSquare } from 'lucide-react';
import { NAV_ITEMS } from '@/nav.config';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';

export default function QuickSMSLinks() {
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [lastSent, setLastSent] = useState<string | null>(null);

  // Get all navigable sections (include sub-items for specific deep links)
  const appSections = NAV_ITEMS.filter(
    (item) => item.href
  ).map((item) => ({
    value: item.href!,
    label: item.label,
  }));

  const sendSMSMutation = useMutation({
    mutationFn: async (data: {
      phoneNumber: string;
      appSection: string;
      sectionLabel: string;
      customMessage?: string;
    }) => {
      return apiRequest('POST', '/api/quick-sms/send', data);
    },
    onSuccess: (data) => {
      toast({
        title: 'Link Sent!',
        description: `Successfully sent link to ${data.sentTo}`,
      });
      setLastSent(data.section);
      // Clear form
      setPhoneNumber('');
      setSelectedSection('');
      setCustomMessage('');
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to Send',
        description: error.message || 'Failed to send SMS link',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!phoneNumber || !selectedSection) {
      toast({
        title: 'Missing Information',
        description: 'Please enter a phone number and select an app section',
        variant: 'destructive',
      });
      return;
    }

    const sectionLabel =
      appSections.find((s) => s.value === selectedSection)?.label || selectedSection;

    sendSMSMutation.mutate({
      phoneNumber,
      appSection: selectedSection,
      sectionLabel,
      customMessage: customMessage.trim() || undefined,
    });
  };

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <PageBreadcrumbs segments={[
        { label: 'Communication' },
        { label: 'Quick SMS Links' }
      ]} />

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold" style={{ color: '#236383' }}>
          Quick SMS Links
        </h1>
        <p className="text-gray-600 mt-2">
          Send your team direct links to features in the app via text message
        </p>
      </div>

      {/* Success Banner */}
      {lastSent && (
        <Card className="mb-6 border-[#47B3CB] bg-[#E8F7FB]">
          <CardContent className="p-4 flex items-center gap-3">
            <Check className="w-5 h-5 text-[#236383]" />
            <p className="text-sm font-medium text-[#236383]">
              Link to {lastSent} sent successfully!
            </p>
          </CardContent>
        </Card>
      )}

      {/* Main Form Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" style={{ color: '#236383' }} />
            Send App Link
          </CardTitle>
          <CardDescription>
            Choose a section of the app and text someone the direct link
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Phone Number */}
            <div>
              <Label htmlFor="phone-number">Phone Number *</Label>
              <Input
                id="phone-number"
                type="tel"
                placeholder="(678) 555-1234 or +16785551234"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={sendSMSMutation.isPending}
                data-testid="input-phone-number"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter any format - the recipient must have SMS enabled in their profile to receive messages
              </p>
            </div>

            {/* App Section Selector */}
            <div>
              <Label htmlFor="app-section">App Section *</Label>
              <Select
                value={selectedSection}
                onValueChange={setSelectedSection}
                disabled={sendSMSMutation.isPending}
              >
                <SelectTrigger id="app-section" data-testid="select-app-section">
                  <SelectValue placeholder="Select a section..." />
                </SelectTrigger>
                <SelectContent>
                  {appSections.map((section) => (
                    <SelectItem key={section.value} value={section.value}>
                      {section.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                Choose what feature you want to share
              </p>
            </div>

            {/* Optional Custom Message */}
            <div>
              <Label htmlFor="custom-message">Custom Message (Optional)</Label>
              <Textarea
                id="custom-message"
                placeholder="Add a personal note before the link..."
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={3}
                disabled={sendSMSMutation.isPending}
                maxLength={300}
                data-testid="textarea-custom-message"
              />
              <p className="text-xs text-gray-500 mt-1">
                {customMessage.length}/300 characters
              </p>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              style={{ backgroundColor: '#236383', color: 'white' }}
              disabled={sendSMSMutation.isPending || !phoneNumber || !selectedSection}
              data-testid="button-send-link"
            >
              {sendSMSMutation.isPending ? (
                'Sending...'
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Link via Text
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="mt-6 bg-[#FAF8F5] border-[#E7E4DF]">
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm mb-2" style={{ color: '#236383' }}>
            How it works:
          </h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Select any section of the app from the dropdown</li>
            <li>• Enter the recipient's phone number</li>
            <li>• Add an optional message to provide context</li>
            <li>• They'll receive a text with a direct link to that feature</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
