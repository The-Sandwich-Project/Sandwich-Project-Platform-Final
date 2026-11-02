/**
 * Host Resources Page
 *
 * A centralized hub for host volunteers to access all the tools and documents
 * they need for running their collection site.
 */

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Document, Thumbnail, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { useAuth } from '@/hooks/useAuth';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// UI Components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// Icons
import {
  Building2,
  MapPin,
  Users,
  FileText,
  ClipboardList,
  Download,
  ExternalLink,
  Sandwich,
  Tag,
  UserCheck,
  Phone,
  Mail,
  BookOpen,
  HelpCircle,
  Share2,
  Eye,
  Image,
  Trash2,
  Upload,
  Plus,
  MoreHorizontal,
  ArrowRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { HostResource } from '@shared/schema';

// Brand colors: #236383 (dark teal), #47b3cb (light teal), #236383 (primary teal), #a31c41 (burgundy), #fbad3f (gold)

// Admin-only overflow menu — delete is server-restricted to admin/super_admin as well
function ResourceAdminMenu({ onDelete }: { onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 px-2"
          onClick={(e) => e.stopPropagation()}
          aria-label="More actions"
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-red-600 focus:text-red-600"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete resource
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Resource card component
function ResourceCard({
  title,
  description,
  icon: Icon,
  href,
  isExternal = false,
  variant = 'default',
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  isExternal?: boolean;
  variant?: 'default' | 'primary' | 'secondary';
}) {
  const bgClass = variant === 'primary'
    ? 'bg-[#236383]/10 border-[#236383]/30 hover:bg-[#236383]/20'
    : variant === 'secondary'
    ? 'bg-[#fbad3f]/10 border-[#fbad3f]/30 hover:bg-[#fbad3f]/20'
    : 'bg-white hover:bg-gray-50';

  const iconColor = variant === 'primary'
    ? 'text-[#236383]'
    : variant === 'secondary'
    ? 'text-[#fbad3f]'
    : 'text-[#236383]';

  const content = (
    <Card className={`${bgClass} transition-colors cursor-pointer h-full`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="p-2 bg-white rounded-lg shadow-sm">
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          {isExternal && (
            <ExternalLink className="w-4 h-4 text-gray-400" />
          )}
        </div>
        <CardTitle className="text-base mt-2">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </Card>
  );

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
        {content}
      </a>
    );
  }

  return (
    <Link href={`/${href}`} className="block h-full">
      {content}
    </Link>
  );
}

// Image guide card with download, share, and optional delete
function ImageGuideCard({
  title,
  description,
  imageUrl,
  fileName,
  onDelete,
}: {
  title: string;
  description: string;
  imageUrl: string;
  fileName: string;
  onDelete?: () => void;
}) {
  const { toast } = useToast();

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast({
        title: 'Download started',
        description: `${fileName} is downloading`,
        duration: 3000,
      });
    } catch (error) {
      console.error('Download failed:', error);
      window.open(imageUrl, '_blank');
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    const shareUrl = window.location.origin + imageUrl;

    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          text: description,
          url: shareUrl,
        });
      } catch (error) {
        // User cancelled or error
        if ((error as Error).name !== 'AbortError') {
          await navigator.clipboard.writeText(shareUrl);
          toast({
            title: 'Link copied!',
            description: 'Share link copied to clipboard',
            duration: 3000,
          });
        }
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: 'Link copied!',
        description: 'Share link copied to clipboard',
        duration: 3000,
      });
    }
  };

  return (
    <Card className="bg-white hover:shadow-md transition-shadow overflow-hidden border-l-4 border-l-[#236383]">
      <div className="aspect-[4/5] relative bg-gray-100">
        <img
          src={imageUrl}
          alt={title}
          className="w-full h-full object-contain p-2"
        />
      </div>
      <CardContent className="p-4">
        <h4 className="font-medium text-sm mb-1">{title}</h4>
        <p className="text-xs text-muted-foreground mb-3">{description}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 bg-[#236383] hover:bg-[#236383] text-white border-none"
            onClick={handleDownload}
          >
            <Download className="w-4 h-4" />
            Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleShare}
          >
            <Share2 className="w-4 h-4" />
          </Button>
          {onDelete && <ResourceAdminMenu onDelete={onDelete} />}
        </div>
      </CardContent>
    </Card>
  );
}

// Renders the first page of a PDF as a real thumbnail using react-pdf
function PdfThumbnail({ url, title }: { url: string; title: string }) {
  const [error, setError] = React.useState(false);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 bg-gradient-to-br from-[#a31c41]/5 to-[#a31c41]/15">
        <FileText className="w-8 h-8 text-[#a31c41]/60" />
        <span className="text-[10px] font-semibold text-[#a31c41]/60 uppercase tracking-wide">PDF</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-start justify-center overflow-hidden bg-white">
      <Document
        file={url}
        onLoadError={() => setError(true)}
        loading={
          <div className="flex flex-col items-center justify-center h-full gap-1 bg-gradient-to-br from-[#a31c41]/5 to-[#a31c41]/15">
            <FileText className="w-8 h-8 text-[#a31c41]/60 animate-pulse" />
          </div>
        }
      >
        <Thumbnail
          pageNumber={1}
          width={128}
          onItemClick={() => {}}
        />
      </Document>
    </div>
  );
}

// Document download card with preview and optional delete
function DocumentCard({
  title,
  description,
  fileType,
  downloadUrl,
  onDelete,
}: {
  title: string;
  description: string;
  fileType: string;
  downloadUrl: string;
  onDelete?: () => void;
}) {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const { toast } = useToast();

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const response = await fetch(downloadUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = downloadUrl.split('/').pop() || 'document.pdf';
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      window.open(downloadUrl, '_blank');
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const shareUrl = `${window.location.origin}${downloadUrl}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          text: description,
          url: shareUrl,
        });
      } catch (error) {
        // User cancelled or share failed, fall back to clipboard
        await copyToClipboard(shareUrl);
      }
    } else {
      await copyToClipboard(shareUrl);
    }
  };

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Link copied!',
        description: 'The document link has been copied to your clipboard.',
      });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: 'Could not copy link. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Card
        className="bg-white hover:bg-gray-50 transition-colors cursor-pointer border-l-4 border-l-[#a31c41]"
        onClick={() => setPreviewOpen(true)}
      >
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* PDF Thumbnail - renders actual document preview */}
            <div className="relative w-full sm:w-32 h-40 sm:h-24 bg-white rounded-lg overflow-hidden flex-shrink-0 group border border-[#a31c41]/20">
              {fileType.toUpperCase() === 'PDF' ? (
                <PdfThumbnail url={downloadUrl} title={title} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-1 bg-gradient-to-br from-[#a31c41]/5 to-[#a31c41]/15">
                  <FileText className="w-8 h-8 text-[#a31c41]/60" />
                  <span className="text-[10px] font-semibold text-[#a31c41]/60 uppercase tracking-wide">{fileType}</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-2">
                  <Eye className="w-4 h-4 text-[#236383]" />
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <h4 className="font-medium text-sm">{title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
                <Badge variant="outline" className="mt-2 text-[10px] bg-[#a31c41]/10 text-[#a31c41] border-[#a31c41]/30">
                  {fileType}
                </Badge>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 flex-1 sm:flex-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewOpen(true);
                  }}
                >
                  <Eye className="w-4 h-4" />
                  <span className="hidden sm:inline">Preview</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 flex-1 sm:flex-none bg-[#236383] hover:bg-[#236383] text-white border-none"
                  onClick={handleDownload}
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Download</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 flex-1 sm:flex-none"
                  onClick={handleShare}
                >
                  <Share2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
                {onDelete && <ResourceAdminMenu onDelete={onDelete} />}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Full Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl h-[90vh] p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2 border-b bg-white">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-lg">{title}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">{description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 bg-[#236383] hover:bg-[#236383] text-white border-none"
                  onClick={handleDownload}
                >
                  <Download className="w-4 h-4" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleShare}
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 h-full bg-gray-100">
            <iframe
              src={`${downloadUrl}#toolbar=1&navpanes=1`}
              className="w-full h-[calc(90vh-80px)]"
              title={`Full preview of ${title}`}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


// Upload dialog for admin users
function UploadResourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<string>('document');
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('document');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title || !description) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title);
      formData.append('description', description);
      formData.append('category', category);

      const res = await fetch('/api/host-resources/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Upload failed');
      }

      queryClient.invalidateQueries({ queryKey: ['/api/host-resources'] });
      toast({ title: 'Upload complete', description: `"${title}" has been added to host resources.` });
      resetForm();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Upload failed',
        description: error.message || 'Could not upload the file.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-[#236383]" />
            Upload Resource
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="resource-title">Title</Label>
            <Input
              id="resource-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Deli Sandwich Making 101"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource-description">Description</Label>
            <Textarea
              id="resource-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this resource..."
              rows={2}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="document">Document (PDF)</SelectItem>
                <SelectItem value="image">Assembly Guide (Image)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource-file">File</Label>
            <Input
              ref={fileInputRef}
              id="resource-file"
              type="file"
              accept={category === 'document' ? '.pdf' : '.jpg,.jpeg,.png,.gif,.webp'}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
            <p className="text-xs text-muted-foreground">
              {category === 'document' ? 'PDF files up to 15MB' : 'Image files (JPG, PNG, WEBP) up to 15MB'}
            </p>
          </div>

          {file && (
            <div className="text-sm text-muted-foreground bg-gray-50 rounded-lg p-3">
              Selected: <span className="font-medium">{file.name}</span> ({(file.size / 1024 / 1024).toFixed(1)} MB)
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={uploading || !file || !title || !description}
              className="bg-[#236383] hover:bg-[#236383] text-white"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function HostResources() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [resourceToDelete, setResourceToDelete] = React.useState<{ id: number; title: string } | null>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  // Fetch resources from API
  const { data: apiResources, isLoading } = useQuery<HostResource[]>({
    queryKey: ['/api/host-resources'],
  });

  // Map API resources (DB auto-seeds defaults on first empty fetch)
  const resources = (apiResources || []).map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    fileType: r.fileType || '',
    fileUrl: r.fileUrl,
    fileName: r.fileName || r.fileUrl.split('/').pop() || 'file',
  }));

  const documents = resources.filter(r => r.category === 'document');
  const images = resources.filter(r => r.category === 'image');

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/host-resources/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/host-resources'] });
      toast({ title: 'Resource deleted', description: 'The resource has been removed.' });
    },
    onError: () => {
      toast({ title: 'Delete failed', description: 'Could not delete the resource.', variant: 'destructive' });
    },
  });

  const requestDelete = (id: number, title: string) => {
    setResourceToDelete({ id, title });
  };

  const confirmDelete = () => {
    if (!resourceToDelete) return;
    deleteMutation.mutate(resourceToDelete.id, {
      onSettled: () => setResourceToDelete(null),
    });
  };

  // Admins can delete any resource (all resources now have real DB IDs)
  const canDelete = !!isAdmin;

  return (
    <div className="p-4 sm:p-6 space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-3">
          <div className="p-3 bg-[#236383]/10 rounded-full">
            <Building2 className="w-8 h-8 text-[#236383]" />
          </div>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold">Host Resources</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Everything you need to run your sandwich collection site.
          Access tools, download documents, and find important information all in one place.
        </p>
        {isAdmin && (
          <Button
            onClick={() => setUploadOpen(true)}
            className="mt-3 bg-[#236383] hover:bg-[#236383] text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            Upload New Resource
          </Button>
        )}
      </div>

      {/* Primary action — weekly collection logging, separate from reference tools */}
      <section>
        <Link href="/collections" className="block group">
          <Card className="bg-gradient-to-r from-[#fbad3f]/25 via-[#fbad3f]/10 to-white border-2 border-[#fbad3f]/60 hover:border-[#fbad3f] hover:shadow-md transition-all cursor-pointer">
            <CardContent className="flex flex-col sm:flex-row items-center gap-4 p-5 sm:p-6">
              <div className="p-3.5 bg-[#fbad3f] rounded-xl shadow-sm flex-shrink-0">
                <ClipboardList className="w-7 h-7 text-[#3d2800]" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0 text-center sm:text-left">
                <p className="text-xs font-bold uppercase tracking-wide text-[#fbad3f] mb-1">
                  Weekly action
                </p>
                <h2 className="text-lg sm:text-xl font-bold text-[#236383]">Log Your Collections</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Record sandwich collections from your site — the task hosts do every week.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#236383] bg-white border border-[#fbad3f]/40 rounded-lg px-4 py-2.5 shrink-0 group-hover:bg-[#fbad3f]/10 transition-colors">
                Open collection form
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </span>
            </CardContent>
          </Card>
        </Link>
      </section>

      {/* Upload Dialog */}
      {isAdmin && <UploadResourceDialog open={uploadOpen} onOpenChange={setUploadOpen} />}

      {/* Featured: Host Handbook */}
      <section>
        <a
          href="https://tsp-host-handbook-ylfb92u.gamma.site/"
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <Card className="bg-gradient-to-r from-[#236383]/10 to-[#236383]/10 border-[#236383]/30 hover:from-[#236383]/20 hover:to-[#236383]/20 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="p-3 bg-white rounded-lg shadow-sm flex-shrink-0">
                <BookOpen className="w-6 h-6 text-[#236383]" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-[#236383]">TSP Host Handbook</h3>
                <p className="text-sm text-gray-600 mt-0.5">
                  Complete guide for host collection sites — everything you need to know about hosting a sandwich collection.
                </p>
              </div>
              <ExternalLink className="w-5 h-5 text-[#236383] flex-shrink-0" />
            </CardContent>
          </Card>
        </a>
      </section>

      {/* Reference — passive lookup tools (not weekly actions) */}
      <section>
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <Sandwich className="w-5 h-5 text-[#236383]" />
          Collection Reference
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Look up past entries and recipient organizations when you need them.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ResourceCard
            title="Collection History"
            description="View your past collection entries and see your site's impact over time."
            icon={Sandwich}
            href="collections"
          />
          <ResourceCard
            title="Recipient Database"
            description="Browse the database of recipient organizations that receive sandwiches."
            icon={Users}
            href="recipients"
          />
        </div>
      </section>

      {/* Maps Section */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-[#236383]" />
          Maps & Locations
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ResourceCard
            title="Host Locations Map"
            description="See all host collection sites on an interactive map. Great for finding nearby hosts!"
            icon={MapPin}
            href="route-map"
            variant="secondary"
          />
          <ResourceCard
            title="All Hosts Directory"
            description="Browse the complete list of host collection sites and their details."
            icon={Building2}
            href="dashboard?section=hosts"
          />
        </div>
      </section>

      {/* Documents Section */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-[#a31c41]" />
          Downloadable Documents
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Download and print these documents for your collection site.
        </p>
        <div className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </>
          ) : documents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No documents available.</p>
          ) : (
            documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                title={doc.title}
                description={doc.description}
                fileType={doc.fileType}
                downloadUrl={doc.fileUrl}
                onDelete={canDelete ? () => requestDelete(doc.id, doc.title) : undefined}
              />
            ))
          )}
        </div>
      </section>

      {/* Sandwich Assembly Guides Section */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Image className="w-5 h-5 text-[#236383]" />
          Sandwich Assembly Guides
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Visual guides for proper sandwich assembly. Download or share these with your volunteers.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading ? (
            <>
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </>
          ) : images.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4 col-span-full">No assembly guides available.</p>
          ) : (
            images.map((img) => (
              <ImageGuideCard
                key={img.id}
                title={img.title}
                description={img.description}
                imageUrl={img.fileUrl}
                fileName={img.fileName}
                onDelete={canDelete ? () => requestDelete(img.id, img.title) : undefined}
              />
            ))
          )}
        </div>
      </section>

      {/* Contact Section */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-[#236383]" />
          Need Help?
        </h2>
        <Card className="bg-gradient-to-r from-[#47b3cb]/10 to-[#236383]/10 border-[#236383]/30">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-3">Contact TSP Staff</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="w-4 h-4" />
                    <a href="mailto:info@thesandwichproject.org" className="hover:text-primary">
                      info@thesandwichproject.org
                    </a>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="w-4 h-4" />
                    <span>Check the directory for direct contacts</span>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="font-medium mb-3">Quick Resources</h3>
                <div className="space-y-2">
                  <Link href="/help">
                    <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                      <BookOpen className="w-4 h-4" />
                      Help Center
                    </Button>
                  </Link>
                  <Link href="/suggestions">
                    <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                      <HelpCircle className="w-4 h-4" />
                      Submit a Question
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Tips Section */}
      <section>
        <Card className="bg-[#fbad3f]/10 border-[#fbad3f]/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="w-5 h-5 text-[#fbad3f]" />
              Host Tips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2 text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-[#fbad3f] font-bold">•</span>
                Log your collections promptly so we can track our impact accurately.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#fbad3f] font-bold">•</span>
                Use the sign-in sheets to track volunteer hours for service hour verification.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#fbad3f] font-bold">•</span>
                Labels should include date made and allergen info (especially for PB&J).
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#fbad3f] font-bold">•</span>
                Connect with other hosts on the map to share best practices!
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>

      <AlertDialog
        open={!!resourceToDelete}
        onOpenChange={(open) => {
          if (!open) setResourceToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete resource?</AlertDialogTitle>
            <AlertDialogDescription>
              {resourceToDelete
                ? `"${resourceToDelete.title}" will be permanently removed. This cannot be undone.`
                : 'This resource will be permanently removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
