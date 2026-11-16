import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Camera,
  Upload,
  Loader2,
  CheckCircle,
  AlertTriangle,
  ArrowLeft,
  Image as ImageIcon,
} from 'lucide-react';

import { usePageSession } from '@/hooks/usePageSession';
interface ExtractedEntry {
  location: string;
  sandwichCount: number;
  volunteerName?: string;
  date?: string;
  confidence: number;
  notes?: string;
}

interface ScanResult {
  entries: ExtractedEntry[];
  totalSandwiches: number;
  suggestedDate: string;
  overallConfidence: number;
  warnings: string[];
}

interface EditableEntry {
  location: string;
  sandwichCount: number;
  collectionDate: string;
  volunteerName?: string;
  isEditing: boolean;
}

// Combined entry for the new bulk location mode
interface CombinedEntry {
  location: string;
  collectionDate: string;
  totalSandwiches: number;
  originalEntries: Array<{ volunteerName?: string; sandwichCount: number }>;
}

type ScanStage = 'upload' | 'scanning' | 'review' | 'saving' | 'success';

export default function PhotoScanner() {
  // Track page session for activity logging
  usePageSession({
    section: 'Collections',
    page: 'Photo Scanner',
  });

  const [, navigate] = useLocation();
  const [stage, setStage] = useState<ScanStage>('upload');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [editableEntries, setEditableEntries] = useState<EditableEntry[]>([]);
  const [contextHint, setContextHint] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // New state for bulk location mode - combines all entries into one
  const [combinedEntry, setCombinedEntry] = useState<CombinedEntry | null>(null);

  // Cleanup blob URL on unmount or when it changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Get list of known hosts for location matching
  const { data: hostsData } = useQuery<{ success: boolean; hosts: Array<{ id: number; name: string }> }>({
    queryKey: ['/api/photo-scanner/hosts'],
  });
  const knownHosts = hostsData?.hosts || [];

  // Scan mutation
  const scanMutation = useMutation({
    mutationFn: async (imageData: { base64: string; mimeType: string }) => {
      return apiRequest('POST', '/api/photo-scanner/scan-base64', {
        imageData: imageData.base64,
        mimeType: imageData.mimeType,
        contextHint: contextHint || undefined,
      });
    },
    onSuccess: (data) => {
      if (data.success) {
        setScanResult(data.data);
        // Initialize editable entries with extracted data
        const entries = data.data.entries.map((entry: ExtractedEntry) => ({
          location: entry.location,
          sandwichCount: entry.sandwichCount,
          collectionDate: entry.date || data.data.suggestedDate,
          volunteerName: entry.volunteerName,
          isEditing: false,
        }));
        setEditableEntries(entries);

        // Initialize combined entry for bulk location mode
        // Use the first location found or empty string, and total all sandwiches
        const totalSandwiches = entries.reduce((sum: number, e: EditableEntry) => sum + e.sandwichCount, 0);
        const firstLocation = entries.find((e: EditableEntry) => e.location)?.location || '';
        setCombinedEntry({
          location: firstLocation,
          collectionDate: data.data.suggestedDate,
          totalSandwiches,
          originalEntries: entries.map((e: EditableEntry) => ({
            volunteerName: e.volunteerName,
            sandwichCount: e.sandwichCount,
          })),
        });

        setStage('review');
      } else {
        toast({
          title: 'Failed to scan image',
          description: data.warnings?.[0] || 'Could not extract data from the image',
          variant: 'destructive',
        });
        setStage('upload');
      }
    },
    onError: (error) => {
      toast({
        title: 'Scan failed',
        description: error instanceof Error ? error.message : 'Failed to process image',
        variant: 'destructive',
      });
      setStage('upload');
    },
  });

  // Confirm mutation - now sends a single combined entry
  const confirmMutation = useMutation({
    mutationFn: async (entry: CombinedEntry) => {
      return apiRequest('POST', '/api/photo-scanner/confirm', {
        entries: [{
          location: entry.location,
          sandwichCount: entry.totalSandwiches,
          collectionDate: entry.collectionDate,
        }],
      });
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: 'Collections saved!',
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections'] });
        queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections/stats'] });
        setStage('success');
      } else {
        toast({
          title: 'Failed to save',
          description: 'Could not save the collections',
          variant: 'destructive',
        });
        setStage('review');
      }
    },
    onError: (error) => {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save collections',
        variant: 'destructive',
      });
      setStage('review');
    },
  });

  const handleFileSelect = useCallback((file: File) => {
    // Validate file type - must match Claude's vision API supported formats
    // Note: HEIC/HEIF not included because browsers auto-convert to JPEG
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a JPEG, PNG, WebP, or GIF image',
        variant: 'destructive',
      });
      return;
    }

    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    // Read file as base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setStage('scanning');
      scanMutation.mutate({
        base64,
        mimeType: file.type,
      });
    };
    reader.onerror = () => {
      toast({
        title: 'Error reading file',
        description: 'Could not read the selected file',
        variant: 'destructive',
      });
    };
    reader.readAsDataURL(file);
  }, [scanMutation, toast]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleCapturePhoto = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleConfirm = () => {
    // Validate combined entry
    if (!combinedEntry || !combinedEntry.location.trim() || combinedEntry.totalSandwiches <= 0) {
      toast({
        title: 'Missing information',
        description: 'Please ensure location is set and there are sandwiches to record',
        variant: 'destructive',
      });
      return;
    }

    setStage('saving');
    confirmMutation.mutate(combinedEntry);
  };

  const handleReset = () => {
    setStage('upload');
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setScanResult(null);
    setEditableEntries([]);
    setCombinedEntry(null);
    setContextHint('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.6) return 'Medium';
    return 'Low';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-brand-primary mb-2">
            Sign-in Sheet Scanner
          </h1>
          <p className="text-gray-600">
            Take a photo of your handwritten sign-in sheet to automatically extract collection data
          </p>
        </div>

        {/* Upload Stage */}
        {stage === 'upload' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Upload Sign-in Sheet Photo
              </CardTitle>
              <CardDescription>
                Take a photo or upload an existing image of your handwritten sign-in sheet
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Optional context hint */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Context (optional)
                </label>
                <Input
                  placeholder="e.g., 'Dunwoody Wednesday collection'"
                  value={contextHint}
                  onChange={(e) => setContextHint(e.target.value)}
                  className="h-12"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Providing context can help improve accuracy
                </p>
              </div>

              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-brand-primary transition-colors cursor-pointer"
                onClick={handleCapturePhoto}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-brand-primary/10 rounded-full flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-brand-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-700">
                      Tap to take a photo or upload
                    </p>
                    <p className="text-sm text-gray-500">
                      or drag and drop an image here
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="lg" className="bg-brand-primary hover:bg-brand-primary-dark">
                      <Camera className="w-5 h-5 mr-2" />
                      Take Photo
                    </Button>
                    <Button size="lg" variant="outline">
                      <Upload className="w-5 h-5 mr-2" />
                      Upload
                    </Button>
                  </div>
                </div>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                capture="environment"
                onChange={handleInputChange}
                className="hidden"
              />

              <p className="text-xs text-gray-500 text-center">
                Supported formats: JPEG, PNG, WebP. For best results, ensure good lighting and clear handwriting.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Scanning Stage */}
        {stage === 'scanning' && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Uploaded sign-in sheet"
                    className="max-h-48 rounded-lg shadow-md mb-4"
                  />
                )}
                <Loader2 className="w-12 h-12 text-brand-primary animate-spin" />
                <p className="text-lg font-medium text-gray-700">Analyzing sign-in sheet...</p>
                <p className="text-sm text-gray-500">
                  Claude is reading the handwriting and extracting data
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Review Stage */}
        {stage === 'review' && scanResult && combinedEntry && (
          <div className="space-y-4">
            {/* Preview image */}
            {previewUrl && (
              <Card>
                <CardContent className="py-4">
                  <img
                    src={previewUrl}
                    alt="Uploaded sign-in sheet"
                    className="max-h-48 mx-auto rounded-lg shadow-md"
                  />
                </CardContent>
              </Card>
            )}

            {/* Combined Entry Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between">
                  <span>Collection Summary</span>
                  <span className={`text-sm font-normal ${getConfidenceColor(scanResult.overallConfidence)}`}>
                    {getConfidenceLabel(scanResult.overallConfidence)} Confidence
                  </span>
                </CardTitle>
                <CardDescription>
                  Found {editableEntries.length} entries on this sheet
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Warnings */}
                {scanResult.warnings.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-yellow-800">Please review:</p>
                        <ul className="text-sm text-yellow-700 mt-1 list-disc list-inside">
                          {scanResult.warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* Location field - applies to entire sheet */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">
                    Location (applies to entire sheet)
                  </label>
                  <Input
                    value={combinedEntry.location}
                    onChange={(e) => setCombinedEntry({ ...combinedEntry, location: e.target.value })}
                    placeholder="Enter location name"
                    list="hosts-combined"
                    className="h-12"
                  />
                  <datalist id="hosts-combined">
                    {knownHosts.map((host) => (
                      <option key={host.id} value={host.name} />
                    ))}
                  </datalist>
                </div>

                {/* Date field */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">
                    Collection Date
                  </label>
                  <Input
                    type="date"
                    value={combinedEntry.collectionDate}
                    onChange={(e) => setCombinedEntry({ ...combinedEntry, collectionDate: e.target.value })}
                    className="h-12"
                  />
                </div>

                {/* Total sandwiches - large display */}
                <div className="bg-gradient-to-r from-brand-primary/10 to-brand-orange/10 rounded-lg p-6 text-center">
                  <p className="text-sm font-medium text-gray-600 mb-1">Total Sandwiches</p>
                  <div className="flex items-center justify-center gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCombinedEntry({
                        ...combinedEntry,
                        totalSandwiches: Math.max(0, combinedEntry.totalSandwiches - 1)
                      })}
                      className="h-10 w-10 p-0"
                    >
                      -
                    </Button>
                    <Input
                      type="number"
                      value={combinedEntry.totalSandwiches || ''}
                      onChange={(e) => setCombinedEntry({
                        ...combinedEntry,
                        totalSandwiches: parseInt(e.target.value, 10) || 0
                      })}
                      className="h-14 w-24 text-center text-3xl font-bold"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCombinedEntry({
                        ...combinedEntry,
                        totalSandwiches: combinedEntry.totalSandwiches + 1
                      })}
                      className="h-10 w-10 p-0"
                    >
                      +
                    </Button>
                  </div>
                </div>

                {/* Individual entries breakdown (read-only) */}
                {editableEntries.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Extracted entries from sheet:
                    </p>
                    <div className="bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto">
                      <div className="space-y-1">
                        {editableEntries.map((entry, index) => (
                          <div key={index} className="flex justify-between text-sm">
                            <span className="text-gray-600">
                              {entry.volunteerName || entry.location || `Entry ${index + 1}`}
                            </span>
                            <span className="font-medium text-gray-800">
                              {entry.sandwichCount} sandwiches
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      These entries have been totaled above. You can adjust the total if needed.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleReset}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Start Over
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-brand-orange to-[#e89b2e] hover:from-[#e89b2e] hover:to-brand-orange text-white"
                onClick={handleConfirm}
                disabled={!combinedEntry.location.trim() || combinedEntry.totalSandwiches <= 0}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Confirm & Save
              </Button>
            </div>
          </div>
        )}

        {/* Saving Stage */}
        {stage === 'saving' && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-12 h-12 text-brand-primary animate-spin" />
                <p className="text-lg font-medium text-gray-700">Saving collections...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Success Stage */}
        {stage === 'success' && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <p className="text-lg font-medium text-gray-700">Collections saved successfully!</p>
                <p className="text-sm text-gray-500 text-center">
                  Your sandwich collection data has been recorded and will appear in the collection log.
                </p>
                <div className="flex gap-3 mt-4">
                  <Button
                    variant="outline"
                    onClick={handleReset}
                  >
                    Scan Another Sheet
                  </Button>
                  <Button
                    onClick={() => navigate('/collections')}
                    className="bg-brand-primary hover:bg-brand-primary-dark"
                  >
                    View Collections
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
