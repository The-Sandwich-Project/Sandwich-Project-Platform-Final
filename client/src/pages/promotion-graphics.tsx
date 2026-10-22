import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { apiRequest } from '@/lib/queryClient';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import {
  Upload,
  Image as ImageIcon,
  Calendar,
  Users,
  Trash2,
  Eye,
  Send,
  Archive,
  Download,
  Plus,
  FileText,
  RotateCcw,
  Pencil,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { hasPermission } from '@shared/unified-auth-utils';
import { logger } from '@/lib/logger';
import { format } from 'date-fns';

// Helper function to convert URLs in text to clickable links
function LinkifyText({ text }: { text: string }) {
  // Regular expression to match URLs
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
  
  const parts = text.split(urlRegex);
  
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null;
        
        // Check if this part is a URL
        if (part.match(/^https?:\/\//)) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        } else if (part.match(/^www\./)) {
          return (
            <a
              key={index}
              href={`https://${part}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

interface PromotionGraphic {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  fileName: string;
  fileSize?: number;
  fileType?: string;
  intendedUseDate?: string | null;
  targetAudience: string;
  status: string;
  notificationSent: boolean;
  notificationSentAt?: string | null;
  viewCount?: number;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

export default function PromotionGraphics() {
  const { trackView } = useActivityTracker();
  const [selectedGraphic, setSelectedGraphic] = useState<PromotionGraphic | null>(null);
  const [editingGraphic, setEditingGraphic] = useState<PromotionGraphic | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAudience, setFilterAudience] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<string>('active');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [intendedUseDate, setIntendedUseDate] = useState('');
  const [targetAudience, setTargetAudience] = useState('hosts');
  const [sendNotification, setSendNotification] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState('');
  const [localPreviewUrl, setLocalPreviewUrl] = useState('');

  // Ref to track the current preview URL for cleanup on unmount
  const previewUrlRef = useRef<string>('');

  useEffect(() => {
    trackView(
      'Promotion Graphics',
      'Promotion',
      'Social Media Graphics',
      'User accessed promotion graphics page'
    );
  }, [trackView]);

  // Clean up local preview URL when component unmounts
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  // Get current user
  const { data: currentUser } = useQuery({
    queryKey: ['/api/auth/user'],
    enabled: true,
  });

  // Check permissions
  const canUpload = hasPermission(currentUser, 'ADMIN_ACCESS');
  const canDelete = hasPermission(currentUser, 'ADMIN_ACCESS');

  // Fetch promotion graphics
  const { data: graphics = [], isLoading } = useQuery<PromotionGraphic[]>({
    queryKey: ['/api/promotion-graphics'],
    enabled: true,
  });

  // Filter to show only active graphics
  const activeGraphics = graphics.filter((g) => g.status === 'active');

  // Filter to show only archived graphics
  const archivedGraphics = graphics.filter((g) => g.status === 'archived');

  // Apply search and audience filters
  const filteredGraphics = activeGraphics.filter((graphic) => {
    // Search filter
    const matchesSearch =
      searchQuery === '' ||
      graphic.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      graphic.description?.toLowerCase().includes(searchQuery.toLowerCase());

    // Audience filter
    const matchesAudience =
      filterAudience === 'all' || graphic.targetAudience === filterAudience;

    return matchesSearch && matchesAudience;
  });

  // Apply same filters to archived graphics
  const filteredArchivedGraphics = archivedGraphics.filter((graphic) => {
    const matchesSearch =
      searchQuery === '' ||
      graphic.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      graphic.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesAudience =
      filterAudience === 'all' || graphic.targetAudience === filterAudience;

    return matchesSearch && matchesAudience;
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => {
      return apiRequest('DELETE', `/api/promotion-graphics/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/promotion-graphics'] });
      setShowDeleteDialog(false);
      setSelectedGraphic(null);
      toast({
        title: 'Success',
        description: 'Graphic deleted successfully.',
      });
    },
    onError: (error: any) => {
      logger.error('Failed to delete graphic', error);
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete graphic. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: (id: number) => {
      return apiRequest('PUT', `/api/promotion-graphics/${id}`, { status: 'archived' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/promotion-graphics'] });
      toast({
        title: 'Success',
        description: 'Graphic archived successfully.',
      });
    },
    onError: (error: any) => {
      logger.error('Failed to archive graphic', error);
      toast({
        title: 'Archive Failed',
        description: error.message || 'Failed to archive graphic. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: (id: number) => {
      return apiRequest('PUT', `/api/promotion-graphics/${id}`, { status: 'active' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/promotion-graphics'] });
      toast({
        title: 'Success',
        description: 'Graphic restored successfully.',
      });
    },
    onError: (error: any) => {
      logger.error('Failed to restore graphic', error);
      toast({
        title: 'Restore Failed',
        description: error.message || 'Failed to restore graphic. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => {
      return apiRequest('PUT', `/api/promotion-graphics/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/promotion-graphics'] });
      setShowEditDialog(false);
      setEditingGraphic(null);
      // Reset form fields
      setTitle('');
      setDescription('');
      setIntendedUseDate('');
      setTargetAudience('hosts');
      toast({
        title: 'Success',
        description: 'Graphic updated successfully.',
      });
    },
    onError: (error: any) => {
      logger.error('Failed to update graphic', error);
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update graphic. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // View tracking mutation
  const trackViewMutation = useMutation({
    mutationFn: (id: number) => {
      return apiRequest('POST', `/api/promotion-graphics/${id}/view`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/promotion-graphics'] });
    },
    onError: (error: any) => {
      logger.error('Failed to track view', error);
    },
  });

  // Handle opening edit dialog
  const handleEditClick = (graphic: PromotionGraphic) => {
    setEditingGraphic(graphic);
    setTitle(graphic.title);
    setDescription(graphic.description || '');
    setIntendedUseDate(graphic.intendedUseDate ? format(new Date(graphic.intendedUseDate), 'yyyy-MM-dd') : '');
    setTargetAudience(graphic.targetAudience || 'hosts');
    setShowEditDialog(true);
  };

  // Handle edit form submission
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGraphic) return;

    const updateData: any = {
      title,
      description,
      targetAudience,
    };

    if (intendedUseDate) {
      updateData.intendedUseDate = intendedUseDate;
    } else {
      updateData.intendedUseDate = null;
    }

    updateMutation.mutate({ id: editingGraphic.id, data: updateData });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type - accept images and PDFs
    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    const validPdfType = 'application/pdf';
    const isValidImage = validImageTypes.includes(file.type);
    const isValidPdf = file.type === validPdfType;

    if (!isValidImage && !isValidPdf) {
      toast({
        title: 'Invalid File',
        description: 'Please select an image file (PNG, JPG, GIF, WEBP, HEIC) or a PDF',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10485760) {
      toast({
        title: 'File Too Large',
        description: 'Please select a file smaller than 10MB',
        variant: 'destructive',
      });
      return;
    }

    // Store the file and create a local preview URL
    setUploadedFile(file);

    // Clean up previous preview URL
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }

    // Create a local preview URL for images only
    if (isValidImage) {
      const previewUrl = URL.createObjectURL(file);
      previewUrlRef.current = previewUrl;
      setLocalPreviewUrl(previewUrl);
    } else {
      // For PDFs, clear preview URL (we'll show a PDF icon instead)
      setLocalPreviewUrl('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!uploadedFile) {
      toast({
        title: 'Missing File',
        description: 'Please select an image or PDF file first',
        variant: 'destructive',
      });
      return;
    }

    if (!title.trim()) {
      toast({
        title: 'Missing Title',
        description: 'Please provide a title for the graphic',
        variant: 'destructive',
      });
      return;
    }

    if (!description.trim()) {
      toast({
        title: 'Missing Description',
        description: 'Please provide a description for the graphic',
        variant: 'destructive',
      });
      return;
    }

    // Upload the file using FormData
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);
      formData.append('title', title);
      formData.append('description', description);
      formData.append('targetAudience', targetAudience);
      formData.append('sendNotification', sendNotification.toString());
      if (intendedUseDate) {
        formData.append('intendedUseDate', intendedUseDate);
      }

      const response = await fetch('/api/promotion-graphics/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include', // Include cookies for authentication
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.error || `Upload failed with status ${response.status}`);
      }

      const newGraphic = await response.json();
      
      // Invalidate the query to refresh the graphics list
      queryClient.invalidateQueries({ queryKey: ['/api/promotion-graphics'] });
      setShowUploadDialog(false);
      resetForm();
      
      toast({
        title: 'Success',
        description: sendNotification 
          ? 'Graphic uploaded successfully! Notifications are being sent to the team.'
          : 'Graphic uploaded successfully!',
      });
    } catch (error) {
      logger.error('Upload error:', error);
      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setIntendedUseDate('');
    setTargetAudience('hosts');
    setSendNotification(false);
    setUploadedFile(null);
    setUploadedFileUrl('');

    // Clean up the local preview URL
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
      setLocalPreviewUrl('');
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: '#236383' }}>
            Social Media Graphics
          </h1>
          <p className="text-gray-600 mt-2">
            Share promotional graphics with the team to amplify our message
          </p>
        </div>
        {canUpload && (
          <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
            <DialogTrigger asChild>
              <Button style={{ backgroundColor: '#007E8C', color: 'white' }}>
                <Plus className="mr-2 h-4 w-4" />
                Upload Graphic
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Upload New Graphic</DialogTitle>
                <DialogDescription>
                  Upload a social media graphic and notify the team
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="file-upload">Image or PDF File *</Label>
                  <Input
                    id="file-upload"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleFileSelect}
                    disabled={isUploading}
                  />
                  {uploadedFile && (
                    <p className="text-sm text-gray-600 mt-2">
                      Selected: {uploadedFile.name} ({formatFileSize(uploadedFile.size)})
                    </p>
                  )}
                </div>

                {uploadedFile && (
                  <div>
                    <Label>Preview</Label>
                    {localPreviewUrl ? (
                      <img
                        src={localPreviewUrl}
                        alt="Preview"
                        className="mt-2 max-w-full h-auto rounded-lg border"
                        style={{ maxHeight: '300px' }}
                      />
                    ) : uploadedFile.type === 'application/pdf' ? (
                      <div className="mt-2 p-8 border rounded-lg bg-gray-50 flex flex-col items-center justify-center">
                        <FileText className="h-16 w-16 text-gray-400 mb-2" />
                        <p className="text-sm text-gray-600 font-medium">PDF Document</p>
                        <p className="text-xs text-gray-500 mt-1">{uploadedFile.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(uploadedFile.size)}</p>
                      </div>
                    ) : null}
                  </div>
                )}

                <div>
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Spring 2024 Fundraiser"
                    maxLength={200}
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what this graphic is for and how it should be used..."
                    rows={4}
                    maxLength={1000}
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    {description.length}/1000 characters
                  </p>
                </div>

                <div>
                  <Label htmlFor="intended-use-date">Intended Use Date (Optional)</Label>
                  <Input
                    id="intended-use-date"
                    type="date"
                    value={intendedUseDate}
                    onChange={(e) => setIntendedUseDate(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="target-audience">Target Audience</Label>
                  <Select value={targetAudience} onValueChange={setTargetAudience}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hosts">Hosts</SelectItem>
                      <SelectItem value="volunteers">All Volunteers</SelectItem>
                      <SelectItem value="all">Everyone</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center space-x-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <Checkbox
                    id="send-notification"
                    checked={sendNotification}
                    onCheckedChange={(checked) => setSendNotification(checked as boolean)}
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="send-notification"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Send email notifications to {targetAudience === 'all' ? 'everyone' : targetAudience}
                    </Label>
                    <p className="text-xs text-gray-600 mt-1">
                      {sendNotification 
                        ? 'Email notifications will be sent when you upload this graphic' 
                        : 'Graphic will be uploaded without sending notifications'}
                    </p>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowUploadDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!uploadedFile || isUploading}
                    style={{ backgroundColor: '#007E8C', color: 'white' }}
                  >
                    {isUploading 
                      ? 'Uploading...' 
                      : sendNotification 
                        ? 'Upload & Send Notifications' 
                        : 'Upload Graphic'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Edit Dialog */}
      {canUpload && (
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Graphic</DialogTitle>
              <DialogDescription>
                Update the details of this social media graphic
              </DialogDescription>
            </DialogHeader>
            {editingGraphic && (
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="edit-title">Title *</Label>
                  <Input
                    id="edit-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Spring 2024 Fundraiser"
                    maxLength={200}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="edit-description">Description *</Label>
                  <Textarea
                    id="edit-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what this graphic is for and how it should be used..."
                    rows={4}
                    maxLength={1000}
                    required
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    {description.length}/1000 characters
                  </p>
                </div>

                <div>
                  <Label htmlFor="edit-intended-use-date">Intended Use Date (Optional)</Label>
                  <Input
                    id="edit-intended-use-date"
                    type="date"
                    value={intendedUseDate}
                    onChange={(e) => setIntendedUseDate(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="edit-target-audience">Target Audience</Label>
                  <Select value={targetAudience} onValueChange={setTargetAudience}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hosts">Hosts</SelectItem>
                      <SelectItem value="volunteers">All Volunteers</SelectItem>
                      <SelectItem value="all">Everyone</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowEditDialog(false);
                      setEditingGraphic(null);
                      setTitle('');
                      setDescription('');
                      setIntendedUseDate('');
                      setTargetAudience('hosts');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending || !title || !description}
                    style={{ backgroundColor: '#007E8C', color: 'white' }}
                  >
                    {updateMutation.isPending ? 'Updating...' : 'Update Graphic'}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <Input
            type="text"
            placeholder="Search by title or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="w-full sm:w-48">
          <Select value={filterAudience} onValueChange={setFilterAudience}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by audience" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Audiences</SelectItem>
              <SelectItem value="hosts">Hosts</SelectItem>
              <SelectItem value="volunteers">All Volunteers</SelectItem>
              <SelectItem value="all">Everyone</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs for Active/Archived */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="active" className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Active ({activeGraphics.length})
          </TabsTrigger>
          <TabsTrigger value="archived" className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Archived ({archivedGraphics.length})
          </TabsTrigger>
        </TabsList>

        {/* Active Graphics Tab */}
        <TabsContent value="active">
          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading graphics...</p>
            </div>
          ) : activeGraphics.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <ImageIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500 mb-4">No graphics available yet</p>
                {canUpload && (
                  <Button
                    onClick={() => setShowUploadDialog(true)}
                    style={{ backgroundColor: '#007E8C', color: 'white' }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Upload First Graphic
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : filteredGraphics.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <ImageIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500 mb-4">No graphics match your filters</p>
                <Button
                  onClick={() => {
                    setSearchQuery('');
                    setFilterAudience('all');
                  }}
                  variant="outline"
                >
                  Clear Filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredGraphics.map((graphic) => (
                <Card key={graphic.id} className="flex flex-col overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="aspect-square w-full overflow-hidden bg-gray-100 flex items-center justify-center cursor-pointer" onClick={() => {
                    setSelectedGraphic(graphic);
                    trackViewMutation.mutate(graphic.id);
                  }}>
                    {graphic.fileType === 'application/pdf' ? (
                      <div className="w-full h-full relative">
                        <iframe
                          src={`/api/objects/proxy?url=${encodeURIComponent(graphic.imageUrl)}`}
                          className="w-full h-full pointer-events-none"
                          title={graphic.title}
                        />
                        <div className="absolute inset-0 cursor-pointer" onClick={() => setSelectedGraphic(graphic)} />
                      </div>
                    ) : (
                      <img
                        src={`/api/objects/proxy?url=${encodeURIComponent(graphic.imageUrl)}`}
                        alt={graphic.title}
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between">
                      <span className="text-lg">{graphic.title}</span>
                      {graphic.notificationSent && (
                        <Badge variant="outline" className="ml-2">
                          <Send className="h-3 w-3 mr-1" />
                          Sent
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">
                      <LinkifyText text={graphic.description} />
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      {graphic.intendedUseDate && (
                        <div className="flex items-center text-gray-600">
                          <Calendar className="h-4 w-4 mr-2" style={{ color: '#FBAD3F' }} />
                          <span>
                            Use by: {format(new Date(graphic.intendedUseDate), 'MMM d, yyyy')}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center text-gray-600">
                        <Users className="h-4 w-4 mr-2" style={{ color: '#47B3CB' }} />
                        <span className="capitalize">{graphic.targetAudience}</span>
                      </div>
                      {graphic.viewCount !== undefined && graphic.viewCount > 0 && (
                        <div className="flex items-center text-gray-600">
                          <Eye className="h-4 w-4 mr-2" style={{ color: '#007E8C' }} />
                          <span>{graphic.viewCount} {graphic.viewCount === 1 ? 'view' : 'views'}</span>
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        Uploaded by {graphic.uploadedByName}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 min-w-[80px]"
                        onClick={() => {
                          setSelectedGraphic(graphic);
                          trackViewMutation.mutate(graphic.id);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 min-w-[100px]"
                        onClick={() => window.open(`/api/objects/proxy?url=${encodeURIComponent(graphic.imageUrl)}&download=true&filename=${encodeURIComponent(graphic.fileName)}`, '_blank')}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                      {canUpload && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditClick(graphic)}
                          title="Edit this graphic"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => archiveMutation.mutate(graphic.id)}
                          title="Archive this graphic"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Archived Graphics Tab */}
        <TabsContent value="archived">
          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading graphics...</p>
            </div>
          ) : archivedGraphics.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Archive className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500 mb-4">No archived graphics</p>
                <p className="text-sm text-gray-400">
                  Graphics you archive will appear here for historical reference
                </p>
              </CardContent>
            </Card>
          ) : filteredArchivedGraphics.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Archive className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500 mb-4">No archived graphics match your filters</p>
                <Button
                  onClick={() => {
                    setSearchQuery('');
                    setFilterAudience('all');
                  }}
                  variant="outline"
                >
                  Clear Filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredArchivedGraphics.map((graphic) => (
                <Card key={graphic.id} className="flex flex-col overflow-hidden hover:shadow-lg transition-shadow opacity-75 hover:opacity-100">
                  <div className="aspect-square w-full overflow-hidden bg-gray-100 flex items-center justify-center cursor-pointer relative" onClick={() => {
                    setSelectedGraphic(graphic);
                    trackViewMutation.mutate(graphic.id);
                  }}>
                    <Badge className="absolute top-2 left-2 z-10 bg-gray-600">
                      <Archive className="h-3 w-3 mr-1" />
                      Archived
                    </Badge>
                    {graphic.fileType === 'application/pdf' ? (
                      <div className="w-full h-full relative">
                        <iframe
                          src={`/api/objects/proxy?url=${encodeURIComponent(graphic.imageUrl)}`}
                          className="w-full h-full pointer-events-none"
                          title={graphic.title}
                        />
                        <div className="absolute inset-0 cursor-pointer" onClick={() => setSelectedGraphic(graphic)} />
                      </div>
                    ) : (
                      <img
                        src={`/api/objects/proxy?url=${encodeURIComponent(graphic.imageUrl)}`}
                        alt={graphic.title}
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between">
                      <span className="text-lg">{graphic.title}</span>
                    </CardTitle>
                    <CardDescription className="line-clamp-2">
                      <LinkifyText text={graphic.description} />
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      {graphic.intendedUseDate && (
                        <div className="flex items-center text-gray-600">
                          <Calendar className="h-4 w-4 mr-2" style={{ color: '#FBAD3F' }} />
                          <span>
                            Use by: {format(new Date(graphic.intendedUseDate), 'MMM d, yyyy')}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center text-gray-600">
                        <Users className="h-4 w-4 mr-2" style={{ color: '#47B3CB' }} />
                        <span className="capitalize">{graphic.targetAudience}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        Uploaded by {graphic.uploadedByName}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 min-w-[80px]"
                        onClick={() => {
                          setSelectedGraphic(graphic);
                          trackViewMutation.mutate(graphic.id);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 min-w-[100px]"
                        onClick={() => window.open(`/api/objects/proxy?url=${encodeURIComponent(graphic.imageUrl)}&download=true&filename=${encodeURIComponent(graphic.fileName)}`, '_blank')}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                      {canUpload && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditClick(graphic)}
                          title="Edit this graphic"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => restoreMutation.mutate(graphic.id)}
                            title="Restore this graphic"
                            style={{ borderColor: '#007E8C', color: '#007E8C' }}
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Restore
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setSelectedGraphic(graphic);
                              setShowDeleteDialog(true);
                            }}
                            title="Permanently delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Detail View Dialog */}
      <Dialog open={!!selectedGraphic} onOpenChange={() => setSelectedGraphic(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedGraphic && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedGraphic.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {selectedGraphic.fileType === 'application/pdf' ? (
                  <div className="w-full border rounded-lg bg-gray-50 overflow-hidden">
                    <iframe
                      src={`/api/objects/proxy?url=${encodeURIComponent(selectedGraphic.imageUrl)}`}
                      className="w-full h-[600px]"
                      title={selectedGraphic.title}
                    />
                  </div>
                ) : (
                  <img
                    src={`/api/objects/proxy?url=${encodeURIComponent(selectedGraphic.imageUrl)}`}
                    alt={selectedGraphic.title}
                    className="w-full h-auto rounded-lg"
                  />
                )}
                <div>
                  <Label>Description</Label>
                  <p className="text-gray-700 mt-1">
                    <LinkifyText text={selectedGraphic.description} />
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {selectedGraphic.intendedUseDate && (
                    <div>
                      <Label>Intended Use Date</Label>
                      <p className="text-gray-700 mt-1">
                        {format(new Date(selectedGraphic.intendedUseDate), 'MMMM d, yyyy')}
                      </p>
                    </div>
                  )}
                  <div>
                    <Label>Target Audience</Label>
                    <p className="text-gray-700 mt-1 capitalize">
                      {selectedGraphic.targetAudience}
                    </p>
                  </div>
                  <div>
                    <Label>Uploaded By</Label>
                    <p className="text-gray-700 mt-1">{selectedGraphic.uploadedByName}</p>
                  </div>
                  <div>
                    <Label>Upload Date</Label>
                    <p className="text-gray-700 mt-1">
                      {format(new Date(selectedGraphic.createdAt), 'MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
                {selectedGraphic.notificationSent && selectedGraphic.notificationSentAt && (
                  <div>
                    <Label>Notification Status</Label>
                    <p className="text-gray-700 mt-1">
                      Sent on {format(new Date(selectedGraphic.notificationSentAt), 'MMMM d, yyyy h:mm a')}
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => window.open(`/api/objects/proxy?url=${encodeURIComponent(selectedGraphic.imageUrl)}&download=true&filename=${encodeURIComponent(selectedGraphic.fileName)}`, '_blank')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                {canDelete && (
                  <>
                    {selectedGraphic.status === 'archived' ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          restoreMutation.mutate(selectedGraphic.id);
                          setSelectedGraphic(null);
                        }}
                        style={{ borderColor: '#007E8C', color: '#007E8C' }}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => {
                          archiveMutation.mutate(selectedGraphic.id);
                          setSelectedGraphic(null);
                        }}
                      >
                        <Archive className="h-4 w-4 mr-2" />
                        Archive
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Graphic?</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete this graphic? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedGraphic && deleteMutation.mutate(selectedGraphic.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
