/**
 * Organizations Merge Admin Tool
 *
 * Allows admins to find and merge duplicate organizations across
 * event requests and sandwich collections.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, RefreshCw, GitMerge, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { usePageSession } from '@/hooks/usePageSession';
interface DuplicatePair {
  org1: {
    name: string;
    eventCount: number;
    collectionCount: number;
  };
  org2: {
    name: string;
    eventCount: number;
    collectionCount: number;
  };
  similarityScore: number;
  canonicalName: string;
  suggestedAction: 'merge' | 'review' | 'keep_separate';
}

interface MergePreview {
  affectedEventRequests: number;
  affectedCollections: number;
  sampleEvents: any[];
  sampleCollections: any[];
}

export default function OrganizationsMerge() {
  // Track page session for activity logging
  usePageSession({
    section: 'Administration',
    page: 'Merge Organizations',
  });

  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(0.85);
  const [selectedPair, setSelectedPair] = useState<DuplicatePair | null>(null);
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [mergeReason, setMergeReason] = useState('');
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [merging, setMerging] = useState(false);
  const [viewMode, setViewMode] = useState<'duplicates' | 'history'>('duplicates');
  const [mergeHistory, setMergeHistory] = useState<any[]>([]);
  const [mergeSourceName, setMergeSourceName] = useState('');
  const [mergeTargetName, setMergeTargetName] = useState('');
  const { toast } = useToast();

  // Fetch duplicates on load
  useEffect(() => {
    fetchDuplicates();
  }, []);

  const fetchDuplicates = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/organizations-admin/duplicates?threshold=${threshold}`);
      if (!response.ok) throw new Error('Failed to fetch duplicates');

      const data = await response.json();
      setDuplicates(data.duplicates || []);

      toast({
        title: 'Duplicates loaded',
        description: `Found ${data.totalPairs} potential duplicate pairs`,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch duplicates',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchMergeHistory = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/organizations-admin/merge-history?limit=100');
      if (!response.ok) throw new Error('Failed to fetch merge history');

      const data = await response.json();
      setMergeHistory(data.merges || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch merge history',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const openMergeDialog = async (pair: DuplicatePair, sourceName: string, targetName: string) => {
    setSelectedPair(pair);
    setMergeReason('');
    setMergeSourceName(sourceName);
    setMergeTargetName(targetName);

    // Fetch preview
    try {
      const response = await fetch('/api/organizations-admin/merge/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceName, targetName }),
      });

      if (!response.ok) throw new Error('Failed to fetch preview');

      const preview = await response.json();
      setMergePreview(preview);
      setShowMergeDialog(true);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch preview',
        variant: 'destructive',
      });
    }
  };

  const executeMerge = async () => {
    if (!selectedPair || !mergePreview || !mergeSourceName || !mergeTargetName) return;

    setMerging(true);
    try {
      const response = await fetch('/api/organizations-admin/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceName: mergeSourceName,
          targetName: mergeTargetName,
          reason: mergeReason
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error('Merge request failed:', result);
        throw new Error(result.error || result.message || 'Merge failed');
      }

      if (result.success) {
        toast({
          title: 'Merge successful!',
          description: `Merged "${mergeSourceName}" into "${mergeTargetName}". Affected ${result.affectedEventRequests} events and ${result.affectedCollections} collections.`,
        });

        // Remove merged pair from list
        setDuplicates(duplicates.filter(d => d !== selectedPair));
        setShowMergeDialog(false);
        setSelectedPair(null);
        setMergePreview(null);
        setMergeSourceName('');
        setMergeTargetName('');
      } else {
        console.error('Merge result not successful:', result);
        throw new Error(result.error || 'Merge failed');
      }
    } catch (error) {
      console.error('Merge error:', error);
      toast({
        title: 'Merge failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setMerging(false);
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'merge':
        return <Badge className="bg-green-500">Auto-Merge Ready</Badge>;
      case 'review':
        return <Badge className="bg-yellow-500">Review Suggested</Badge>;
      case 'keep_separate':
        return <Badge variant="secondary">Keep Separate</Badge>;
      default:
        return null;
    }
  };

  const formatScore = (score: number) => {
    return `${(score * 100).toFixed(1)}%`;
  };

  if (viewMode === 'history') {
    return (
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Organization Merge History</h1>
            <p className="text-muted-foreground">View past organization merges</p>
          </div>
          <Button onClick={() => setViewMode('duplicates')} variant="outline">
            Back to Duplicates
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Merges</CardTitle>
            <CardDescription>Organizations with alternate names</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : mergeHistory.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No merge history found</p>
            ) : (
              <div className="space-y-4">
                {mergeHistory.map((item, idx) => (
                  <div key={idx} className="border rounded-lg p-4">
                    <div className="font-semibold">{item.organizationName}</div>
                    <div className="text-sm text-muted-foreground mt-2">
                      <strong>Alternate names:</strong>{' '}
                      {Array.isArray(item.alternateNames) ? item.alternateNames.join(', ') : 'None'}
                    </div>
                    {item.createdAt && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Created: {new Date(item.createdAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Organization Duplicate Management</h1>
          <p className="text-muted-foreground">
            Find and merge duplicate organizations to improve data quality
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setViewMode('history');
              fetchMergeHistory();
            }}
            variant="outline"
          >
            View History
          </Button>
          <Button onClick={fetchDuplicates} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Info Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>How this works</AlertTitle>
        <AlertDescription>
          This tool scans all event requests and sandwich collections to find organizations with
          similar names. Review the suggestions below and merge duplicates to consolidate your data.
          The organization with more records will be kept as the canonical name.
        </AlertDescription>
      </Alert>

      {/* Threshold Control */}
      <Card>
        <CardHeader>
          <CardTitle>Detection Settings</CardTitle>
          <CardDescription>Adjust the similarity threshold for duplicate detection</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Label htmlFor="threshold" className="w-32">
              Threshold: {formatScore(threshold)}
            </Label>
            <Input
              id="threshold"
              type="range"
              min="0.7"
              max="1.0"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="flex-1"
            />
            <Button onClick={fetchDuplicates} size="sm">
              Apply
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Higher threshold = more strict matching (fewer but more confident duplicates)
          </p>
        </CardContent>
      </Card>

      {/* Duplicates List */}
      <Card>
        <CardHeader>
          <CardTitle>
            Potential Duplicates {duplicates.length > 0 && `(${duplicates.length})`}
          </CardTitle>
          <CardDescription>
            Organizations that likely refer to the same entity
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : duplicates.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="text-lg font-semibold">No duplicates found!</p>
              <p className="text-muted-foreground">
                Your organization data is clean at this threshold.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {duplicates.map((pair, idx) => {
                const org1Total = pair.org1.eventCount + pair.org1.collectionCount;
                const org2Total = pair.org2.eventCount + pair.org2.collectionCount;
                const primaryOrg = org1Total >= org2Total ? pair.org1 : pair.org2;
                const secondaryOrg = org1Total >= org2Total ? pair.org2 : pair.org1;

                return (
                  <div
                    key={idx}
                    className={`border rounded-lg p-4 ${
                      pair.suggestedAction === 'merge'
                        ? 'border-green-300 bg-green-50'
                        : pair.suggestedAction === 'review'
                        ? 'border-yellow-300 bg-yellow-50'
                        : 'border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getActionBadge(pair.suggestedAction)}
                          <span className="text-sm text-muted-foreground">
                            Similarity: {formatScore(pair.similarityScore)}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Primary Org (will be kept) */}
                          <div className="space-y-1">
                            <div className="font-semibold text-green-700 flex items-center gap-2">
                              {primaryOrg.name}
                              <Badge variant="outline" className="text-xs">
                                Keep
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {primaryOrg.eventCount} events, {primaryOrg.collectionCount}{' '}
                              collections
                            </div>
                          </div>

                          {/* Secondary Org (will be merged into primary) */}
                          <div className="space-y-1">
                            <div className="font-semibold text-orange-700 flex items-center gap-2">
                              {secondaryOrg.name}
                              <Badge variant="outline" className="text-xs">
                                Merge
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {secondaryOrg.eventCount} events, {secondaryOrg.collectionCount}{' '}
                              collections
                            </div>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground mt-2">
                          Canonical: {pair.canonicalName}
                        </div>
                      </div>

                      <Button
                        onClick={() => openMergeDialog(pair, secondaryOrg.name, primaryOrg.name)}
                        size="sm"
                        className="ml-4"
                      >
                        <GitMerge className="h-4 w-4 mr-2" />
                        Review & Merge
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Merge Preview Dialog */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Merge Operation</DialogTitle>
            <DialogDescription>
              This will update all references to use the canonical organization name
            </DialogDescription>
          </DialogHeader>

          {selectedPair && mergePreview && (
            <div className="space-y-4">
              {/* What will happen */}
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>What will happen:</AlertTitle>
                <AlertDescription className="space-y-2">
                  <div className="mt-2">
                    All references to{' '}
                    <strong className="text-orange-700">{mergeSourceName}</strong>{' '}
                    will be replaced with{' '}
                    <strong className="text-green-700">{mergeTargetName}</strong>
                  </div>
                  <div>
                    • {mergePreview.affectedEventRequests} event requests will be updated
                  </div>
                  <div>• {mergePreview.affectedCollections} collection logs will be updated</div>
                </AlertDescription>
              </Alert>

              {/* Merge Reason */}
              <div className="space-y-2">
                <Label htmlFor="reason">Reason for merge (optional)</Label>
                <Textarea
                  id="reason"
                  placeholder="e.g., 'Same organization, different name variations' or 'FBC is abbreviation for First Baptist Church'"
                  value={mergeReason}
                  onChange={(e) => setMergeReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMergeDialog(false)} disabled={merging}>
              Cancel
            </Button>
            <Button onClick={executeMerge} disabled={merging}>
              {merging ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <GitMerge className="h-4 w-4 mr-2" />
                  Confirm Merge
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
