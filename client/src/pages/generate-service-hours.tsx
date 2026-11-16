import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, FileDown, Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

import { usePageSession } from '@/hooks/usePageSession';
interface ServiceEntry {
  date: string;
  hours: string;
  description: string;
}

export default function GenerateServiceHours() {
  // Track page session for activity logging
  usePageSession({
    section: 'Operations',
    page: 'Service Hours Form',
  });

  const { toast } = useToast();
  const [volunteerName, setVolunteerName] = useState('');
  const [approverName, setApproverName] = useState('Katie Long');
  const [approverSignature, setApproverSignature] = useState('');
  const [approverContact, setApproverContact] = useState('');
  const [serviceEntries, setServiceEntries] = useState<ServiceEntry[]>([
    { date: '', hours: '', description: '' },
  ]);

  const addEntry = () => {
    setServiceEntries([
      ...serviceEntries,
      { date: '', hours: '', description: '' },
    ]);
  };

  const removeEntry = (index: number) => {
    if (serviceEntries.length > 1) {
      setServiceEntries(serviceEntries.filter((_, i) => i !== index));
    }
  };

  const updateEntry = (
    index: number,
    field: keyof ServiceEntry,
    value: string
  ) => {
    const updated = [...serviceEntries];
    updated[index][field] = value;
    setServiceEntries(updated);
  };

  const calculateTotalHours = (entries: ServiceEntry[] = serviceEntries) => {
    return entries.reduce((total, entry) => {
      const hours = parseFloat(entry.hours) || 0;
      return total + hours;
    }, 0);
  };

  const generatePdfMutation = useMutation({
    mutationFn: async (data: {
      volunteerName: string;
      serviceEntries: ServiceEntry[];
      approverName: string;
      approverSignature: string;
      approverContact: string;
      totalHours: number;
    }) => {
      const response = await apiRequest(
        'POST',
        '/api/generate-service-hours-pdf',
        data
      );
      return response;
    },
    onSuccess: (data, variables) => {
      // Create a blob from the base64 data
      const byteArray = Uint8Array.from(atob(data.pdf), c => c.charCodeAt(0));
      const blob = new Blob([byteArray], { type: 'application/pdf' });

      // Download the PDF
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${variables.volunteerName.replace(/\s+/g, '_')}_Service_Hours.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'PDF Generated',
        description: 'Community service hours form has been downloaded.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate PDF',
        variant: 'destructive',
      });
    },
  });

  const handleGenerate = () => {
    // Validation
    if (!volunteerName.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please enter the volunteer name.',
        variant: 'destructive',
      });
      return;
    }

    const hasValidEntry = serviceEntries.some(
      (entry) => entry.date && entry.hours && entry.description
    );

    if (!hasValidEntry) {
      toast({
        title: 'Missing Information',
        description: 'Please add at least one complete service entry.',
        variant: 'destructive',
      });
      return;
    }

    // Filter out empty entries
    const validEntries = serviceEntries.filter(
      (entry) => entry.date && entry.hours && entry.description
    );

    const totalHours = calculateTotalHours(validEntries);

    generatePdfMutation.mutate({
      volunteerName,
      serviceEntries: validEntries,
      approverName,
      approverSignature,
      approverContact,
      totalHours,
    });
  };

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="h-6 w-6" />
            Generate Community Service Hours Form
          </CardTitle>
          <CardDescription>
            Quickly create a filled TSP Community Service Hours verification
            form for volunteers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Volunteer Information */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="volunteerName">Volunteer Name *</Label>
              <Input
                id="volunteerName"
                value={volunteerName}
                onChange={(e) => setVolunteerName(e.target.value)}
                placeholder="Enter volunteer's full name"
                className="mt-1"
              />
            </div>
          </div>

          {/* Service Entries */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-lg">Service Log</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addEntry}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Entry
              </Button>
            </div>

            <div className="space-y-3">
              {serviceEntries.map((entry, index) => (
                <Card key={index} className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-3">
                      <Label htmlFor={`date-${index}`} className="text-sm">
                        Date
                      </Label>
                      <Input
                        id={`date-${index}`}
                        type="date"
                        value={entry.date}
                        onChange={(e) =>
                          updateEntry(index, 'date', e.target.value)
                        }
                        className="mt-1"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor={`hours-${index}`} className="text-sm">
                        Hours
                      </Label>
                      <Input
                        id={`hours-${index}`}
                        type="number"
                        step="0.5"
                        min="0"
                        value={entry.hours}
                        onChange={(e) =>
                          updateEntry(index, 'hours', e.target.value)
                        }
                        placeholder="3"
                        className="mt-1"
                      />
                    </div>
                    <div className="md:col-span-6">
                      <Label
                        htmlFor={`description-${index}`}
                        className="text-sm"
                      >
                        Description
                      </Label>
                      <Input
                        id={`description-${index}`}
                        value={entry.description}
                        onChange={(e) =>
                          updateEntry(index, 'description', e.target.value)
                        }
                        placeholder="e.g., Sandwich preparation at Grace Church"
                        className="mt-1"
                      />
                    </div>
                    <div className="md:col-span-1 flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEntry(index)}
                        disabled={serviceEntries.length === 1}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Total Hours:</span>
                <span className="text-2xl font-bold text-primary">
                  {calculateTotalHours(
                    serviceEntries.filter(
                      (entry) => entry.date && entry.hours && entry.description
                    )
                  ).toFixed(1)}
                </span>
              </div>
            </div>
          </div>

          {/* TSP Approval Section */}
          <div className="space-y-4 border-t pt-6">
            <Label className="text-lg">TSP Approval Information</Label>
            <p className="text-sm text-muted-foreground">
              This section will be filled in by The Sandwich Project. The volunteer signature line will be left blank for the volunteer to sign.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="approverName">Approver Print Name</Label>
                <Input
                  id="approverName"
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  placeholder="Your printed name"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="approverSignature">Approver Signature</Label>
                <Input
                  id="approverSignature"
                  value={approverSignature}
                  onChange={(e) => setApproverSignature(e.target.value)}
                  placeholder="Type your signature"
                  className="mt-1 font-serif italic"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Type your name as you would sign it
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="approverContact">Contact Number</Label>
              <Input
                id="approverContact"
                value={approverContact}
                onChange={(e) => setApproverContact(e.target.value)}
                placeholder="(555) 123-4567"
                className="mt-1"
              />
            </div>
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={generatePdfMutation.isPending}
            className="w-full"
            size="lg"
          >
            {generatePdfMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <FileDown className="mr-2 h-4 w-4" />
                Generate PDF
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
