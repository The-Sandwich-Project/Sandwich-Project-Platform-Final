import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { ResourceAdminModal } from '../components/resource-admin-modal';
import { useOnboardingTracker } from '@/hooks/useOnboardingTracker';
import {
  Search,
  Filter,
  Star,
  Link2,
  FileText,
  ExternalLink,
  Pin,
  TrendingUp,
  Clock,
  Plus,
  Edit,
  Trash2,
  Tag,
  Copy,
  Check,
  ChevronDown,
  Folder,
  Briefcase,
  Shield,
  FileCheck,
  BookOpen,
  FileEdit,
  X,
  Image,
  Download,
  Share2,
  Upload,
  MoreHorizontal,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { encodeAssetPath } from '@/lib/asset-path';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { Skeleton } from '@/components/ui/skeleton';

// Category definitions with icons and colors (using brand color scheme)
const CATEGORIES = [
  {
    id: 'legal_governance',
    label: 'Legal & Governance',
    icon: Shield,
    color: 'text-[#236383]', // Brand dark blue
    bgColor: 'bg-[#236383]/10',
    borderColor: 'border-[#236383]/30',
  },
  {
    id: 'brand_marketing',
    label: 'Brand & Marketing',
    icon: Briefcase,
    color: 'text-[#A31C41]', // Brand red
    bgColor: 'bg-[#A31C41]/10',
    borderColor: 'border-[#A31C41]/30',
  },
  {
    id: 'operations_safety',
    label: 'Operations & Safety',
    icon: Shield,
    color: 'text-[#007E8C]', // Brand teal
    bgColor: 'bg-[#007E8C]/10',
    borderColor: 'border-[#007E8C]/30',
  },
  {
    id: 'forms_templates',
    label: 'Forms & Templates',
    icon: FileCheck,
    color: 'text-[#47B3CB]', // Brand light blue
    bgColor: 'bg-[#47B3CB]/10',
    borderColor: 'border-[#47B3CB]/30',
  },
  {
    id: 'toolkit',
    label: 'Toolkit',
    icon: BookOpen,
    color: 'text-[#FBAD3F]', // Brand orange
    bgColor: 'bg-[#FBAD3F]/10',
    borderColor: 'border-[#FBAD3F]/30',
  },
  {
    id: 'master_documents',
    label: 'Master Documents',
    icon: FileEdit,
    color: 'text-[#236383]', // Brand dark blue
    bgColor: 'bg-[#236383]/10',
    borderColor: 'border-[#236383]/30',
  },
];

interface Resource {
  resource: {
    id: number;
    title: string;
    description: string | null;
    type: 'file' | 'link' | 'google_drive';
    category: string;
    documentId: number | null;
    url: string | null;
    icon: string | null;
    iconColor: string | null;
    isPinnedGlobal: boolean;
    pinnedOrder: number | null;
    accessCount: number;
    lastAccessedAt: string | null;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    updatedAt: string;
    isActive: boolean;
  };
  document?: {
    id: number;
    mimeType: string;
    originalName: string;
    fileSize: number;
  } | null;
  isFavorite: boolean;
  tags: Array<{ id: number; name: string; color: string | null }>;
}

interface Tag {
  tag: {
    id: number;
    name: string;
    color: string | null;
    description: string | null;
  };
  usageCount: number;
}

/** Fallback paths when a seeded resource lost its URL in the DB (e.g. after a bad edit). */
const STATIC_RESOURCE_URLS: Record<string, string> = {
  'Sandwich Sign-In Form':
    '/documents/volunteer-sign-in-sheet.pdf',
};

function getResourceOpenUrl(item: Resource): string | null {
  const { type, documentId, url, title } = item.resource;
  const normalizedTitle = title?.trim() ?? '';

  // Explicit URL wins — seeded link resources and admin-configured paths.
  if (url?.trim()) {
    const trimmed = url.trim();
    if (trimmed.startsWith('/dashboard') || trimmed.startsWith('?')) {
      return trimmed.startsWith('?') ? `/dashboard${trimmed}` : trimmed;
    }
    if (trimmed.startsWith('/')) {
      return encodeAssetPath(trimmed);
    }
    return trimmed;
  }

  // Known static assets when DB url was cleared (e.g. bad edit).
  const fallback = STATIC_RESOURCE_URLS[normalizedTitle];
  if (fallback) {
    return encodeAssetPath(fallback);
  }

  if (type === 'file' && documentId) {
    return `/api/documents/${documentId}/preview`;
  }

  return null;
}

/** Open a URL in a new tab — anchor click is more reliable than window.open for PDFs. */
function openUrlInNewTab(openUrl: string): boolean {
  if (openUrl.startsWith('/dashboard')) {
    window.location.href = openUrl;
    return true;
  }

  const href = openUrl.startsWith('http') ? openUrl : `${window.location.origin}${openUrl}`;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  return true;
}

function ResourceDeleteMenu({
  onDelete,
  triggerClassName,
  deleteTestId,
}: {
  onDelete: () => void;
  triggerClassName?: string;
  deleteTestId?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ??
            'flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 transition-colors'
          }
          aria-label="More actions"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={onDelete}
          className="text-red-600 focus:text-red-600"
          data-testid={deleteTestId}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete resource
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Sandwich Assembly Guides Component — backed by /api/host-resources.
// Public users see + download/share. Admins (admin or super_admin) can upload
// new guides, edit titles/descriptions, and delete them via inline controls.
// Shares the same backend as the Host Resources page, so edits show up in
// both places.

interface HostResource {
  id: number;
  title: string;
  description: string;
  category: string;
  fileType: string;
  fileUrl: string;
  fileName: string;
}

function SandwichAssemblyGuides() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<HostResource | null>(null);
  const [guideToDelete, setGuideToDelete] = useState<{ id: number; title: string } | null>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const { data: apiResources, isLoading } = useQuery<HostResource[]>({
    queryKey: ['/api/host-resources'],
  });

  const guides = (apiResources || []).filter((r) => r.category === 'image');

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/host-resources/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/host-resources'] });
      toast({ title: 'Guide deleted', description: 'The assembly guide has been removed.' });
    },
    onError: () => {
      toast({ title: 'Delete failed', description: 'Could not delete the guide.', variant: 'destructive' });
    },
  });

  const confirmDeleteGuide = () => {
    if (!guideToDelete) return;
    deleteMutation.mutate(guideToDelete.id, {
      onSettled: () => setGuideToDelete(null),
    });
  };

  const handleDownload = async (imageUrl: string, fileName: string) => {
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

  const handleShare = async (title: string, description: string, imageUrl: string) => {
    const shareUrl = window.location.origin + imageUrl;

    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          text: description,
          url: shareUrl,
        });
      } catch (error) {
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
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-[#007E8C]/30">
        <div className="bg-[#007E8C]/10 p-3 rounded-lg">
          <Image className="w-7 h-7 text-[#007E8C]" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Sandwich Assembly Guides</h2>
        <span className="text-sm font-semibold text-gray-500 ml-auto">
          {guides.length} {guides.length === 1 ? 'item' : 'items'}
        </span>
        {isAdmin && (
          <Button
            onClick={() => setUploadOpen(true)}
            size="sm"
            className="bg-[#007E8C] hover:bg-[#236383] text-white gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Guide
          </Button>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Visual guides for proper sandwich assembly. Download or share these with your volunteers.
        {isAdmin && ' As an admin, you can add new guides, edit titles/descriptions, or remove outdated ones.'}
      </p>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : guides.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <Image className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600">No assembly guides yet.</p>
          {isAdmin && (
            <Button
              onClick={() => setUploadOpen(true)}
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Upload the first one
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {guides.map((guide) => (
            <div
              key={guide.id}
              className="bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="aspect-[4/5] relative bg-gray-100">
                <img
                  src={guide.fileUrl}
                  alt={guide.title}
                  className="w-full h-full object-contain p-2"
                />
              </div>
              <div className="p-4">
                <h4 className="font-medium text-sm mb-1">{guide.title}</h4>
                <p className="text-xs text-gray-500 mb-3">{guide.description}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(guide.fileUrl, guide.fileName)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                  <button
                    onClick={() => handleShare(guide.title, guide.description, guide.fileUrl)}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                    title="Share"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => setEditing(guide)}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 transition-colors text-[#007E8C]"
                        title="Edit title/description"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <ResourceDeleteMenu
                        onDelete={() => setGuideToDelete({ id: guide.id, title: guide.title })}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <SandwichGuideUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      )}
      {isAdmin && editing && (
        <SandwichGuideEditDialog
          guide={editing}
          open={!!editing}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
        />
      )}

      <AlertDialog
        open={!!guideToDelete}
        onOpenChange={(open) => {
          if (!open) setGuideToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete assembly guide?</AlertDialogTitle>
            <AlertDialogDescription>
              {guideToDelete
                ? `"${guideToDelete.title}" will be permanently removed. This cannot be undone.`
                : 'This guide will be permanently removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDeleteGuide();
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

// Upload dialog — admin-only. Posts to /api/host-resources/upload with
// category=image so it shows up in the Sandwich Assembly Guides grid
// (and on the Host Resources page).
function SandwichGuideUploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setTitle('');
    setDescription('');
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
      formData.append('category', 'image');

      const res = await fetch('/api/host-resources/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Upload failed');
      }

      queryClient.invalidateQueries({ queryKey: ['/api/host-resources'] });
      toast({ title: 'Guide added', description: `"${title}" is now visible to everyone.` });
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
            <Upload className="w-5 h-5 text-[#007E8C]" />
            Add Assembly Guide
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="guide-title">Title</Label>
            <Input
              id="guide-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Turkey & Cheese Assembly"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="guide-description">Description</Label>
            <Textarea
              id="guide-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description shown under the image..."
              rows={2}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="guide-file">Image File</Label>
            <Input
              ref={fileInputRef}
              id="guide-file"
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
            <p className="text-xs text-gray-500">JPG, PNG, or WEBP up to 15MB.</p>
          </div>

          {file && (
            <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
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
              className="bg-[#007E8C] hover:bg-[#236383] text-white"
            >
              {uploading ? 'Uploading…' : 'Add Guide'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Edit dialog — admin-only. PATCHes title + description (the image file itself
// is not editable here; delete + re-upload if the image needs to change).
function SandwichGuideEditDialog({
  guide,
  open,
  onOpenChange,
}: {
  guide: HostResource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(guide.title);
  const [description, setDescription] = useState(guide.description);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(guide.title);
    setDescription(guide.description);
  }, [guide.id, guide.title, guide.description]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/host-resources/${guide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title, description }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Update failed');
      }
      queryClient.invalidateQueries({ queryKey: ['/api/host-resources'] });
      toast({ title: 'Guide updated' });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Update failed',
        description: error.message || 'Could not save changes.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="w-5 h-5 text-[#007E8C]" />
            Edit Assembly Guide
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-guide-title">Title</Label>
            <Input
              id="edit-guide-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-guide-description">Description</Label>
            <Textarea
              id="edit-guide-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              required
            />
          </div>

          <p className="text-xs text-gray-500">
            To replace the image itself, delete this guide and upload a new one.
          </p>

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !title || !description}
              className="bg-[#007E8C] hover:bg-[#236383] text-white"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Resources() {
  const { user } = useAuth();
  const isAdmin =
    user?.role === 'admin' ||
    user?.role === 'super_admin' ||
    user?.permissions?.includes('manage_resources');
  const { track } = useOnboardingTracker();
  const { toast } = useToast();

  const [resources, setResources] = useState<Resource[]>([]);
  const [favorites, setFavorites] = useState<Resource[]>([]);
  const [recentResources, setRecentResources] = useState<Resource[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('smart');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null);
  const [deletingResource, setDeletingResource] = useState(false);

  // Track onboarding challenge on page load
  useEffect(() => {
    track('view_resources');
  }, []);

  // Load resources
  const loadResources = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        sort: sortBy,
        ...(selectedCategory && { category: selectedCategory }),
        ...(searchTerm && { search: searchTerm }),
        ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
      });

      console.log('Loading resources from API...');
      const [resourcesRes, favoritesRes, recentRes, tagsRes] = await Promise.all([
        fetch(`/api/resources?${params}`, { credentials: 'include' }),
        fetch('/api/resources/user/favorites', { credentials: 'include' }),
        fetch('/api/resources/user/recent?limit=5', { credentials: 'include' }),
        fetch('/api/resources/tags/all', { credentials: 'include' }),
      ]);

      // Check for critical errors
      if (!resourcesRes.ok) {
        const errorText = await resourcesRes.text();
        console.error('Resources API error:', errorText);
        throw new Error(`Failed to load resources: ${resourcesRes.status} ${errorText}`);
      }

      if (resourcesRes.ok) {
        const data = await resourcesRes.json();
        console.log('Resources loaded:', data.length);
        setResources(data);
      }

      if (favoritesRes.ok) {
        const data = await favoritesRes.json();
        setFavorites(data);
      } else {
        console.warn('Failed to load favorites');
      }

      if (recentRes.ok) {
        const data = await recentRes.json();
        setRecentResources(data);
      } else {
        console.warn('Failed to load recent resources');
      }

      if (tagsRes.ok) {
        const data = await tagsRes.json();
        setTags(data);
      } else {
        console.warn('Failed to load tags');
      }
    } catch (err) {
      console.error('Error loading resources:', err);
      setError(err instanceof Error ? err.message : 'Failed to load resources. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadResources();
  }, [sortBy, selectedCategory, searchTerm, selectedTags]);

  // Track resource access
  const trackAccess = async (resourceId: number) => {
    try {
      await fetch(`/api/resources/${resourceId}/access`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Error tracking access:', error);
    }
  };

  // Delete (soft-delete) a resource — admin only (server enforces same check)
  const confirmDeleteResource = async () => {
    if (!resourceToDelete) return;

    const title = resourceToDelete.resource.title;
    setDeletingResource(true);
    try {
      const res = await fetch(`/api/resources/${resourceToDelete.resource.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete resource');
      }
      toast({
        title: 'Resource deleted',
        description: `"${title}" has been removed.`,
      });
      setResourceToDelete(null);
      await loadResources();
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Could not delete resource',
        variant: 'destructive',
      });
    } finally {
      setDeletingResource(false);
    }
  };

  // Toggle favorite
  const toggleFavorite = async (resourceId: number) => {
    try {
      const res = await fetch(`/api/resources/${resourceId}/favorite`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        await loadResources();
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  };

  // Open resource
  const openResource = (resource: Resource) => {
    const openUrl = getResourceOpenUrl(resource);

    if (!openUrl) {
      toast({
        title: 'Unable to open',
        description:
          'This resource has no file or link attached. An admin can re-link it in Edit Resource.',
        variant: 'destructive',
      });
      return;
    }

    try {
      openUrlInNewTab(openUrl);
    } catch (err) {
      console.error('Failed to open resource:', err);
      toast({
        title: 'Unable to open',
        description: 'Could not open this resource. Try Copy link and paste it into a new tab.',
        variant: 'destructive',
      });
      return;
    }

    trackAccess(resource.resource.id);
  };

  // Copy link
  const copyLink = async (resource: Resource) => {
    const openUrl = getResourceOpenUrl(resource);
    let link = openUrl || '';

    if (resource.resource.type === 'file' && resource.resource.documentId) {
      link = `${window.location.origin}/api/documents/${resource.resource.documentId}/download`;
    } else if (openUrl?.startsWith('/')) {
      link = `${window.location.origin}${openUrl}`;
    } else if (openUrl) {
      link = openUrl;
    }

    if (!link) {
      toast({
        title: 'No link to copy',
        description: 'This resource has no file or URL attached.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(resource.resource.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Error copying link:', error);
    }
  };

  // Get category info
  const getCategoryInfo = (categoryId: string) => {
    return CATEGORIES.find((c) => c.id === categoryId) || CATEGORIES[0];
  };

  // Render resource card
  const ResourceCard = ({ item }: { item: Resource }) => {
    const category = getCategoryInfo(item.resource.category);
    const CategoryIcon = category.icon;
    const isCopied = copiedId === item.resource.id;
    const [previewError, setPreviewError] = useState(false);

    // Check if file type supports iframe preview (PDFs and images only)
    const canPreviewInIframe = () => {
      if (!item.document?.mimeType) {
        return false;
      }
      const previewableMimeTypes = [
        'application/pdf',
        'image/png',
        'image/jpg',
        'image/jpeg',
        'image/gif',
        'image/webp',
      ];
      return previewableMimeTypes.includes(item.document.mimeType);
    };

    // Get preview URL for documents (only for previewable types)
    const getPreviewUrl = () => {
      if (item.resource.type === 'file' && item.resource.documentId && canPreviewInIframe() && !previewError) {
        return `/api/documents/${item.resource.documentId}/preview`;
      }
      const staticUrl = getResourceOpenUrl(item);
      if (staticUrl?.startsWith('/') && staticUrl.toLowerCase().endsWith('.pdf') && !previewError) {
        return staticUrl;
      }
      return null;
    };

    const previewUrl = getPreviewUrl();

    return (
      <div
        className={`border ${category.borderColor} ${category.bgColor} rounded-lg overflow-hidden hover:shadow-md transition-shadow relative flex flex-col`}
        data-testid={
          item.resource.title === 'Sandwich Sign-In Form'
            ? 'document-sandwich-signin-form'
            : `resource-card-${item.resource.id}`
        }
      >
        {/* Pinned badge */}
        {item.resource.isPinnedGlobal && (
          <div className="absolute top-2 right-2 z-10">
            <Pin className="w-4 h-4 text-[#FBAD3F] fill-[#FBAD3F]" />
          </div>
        )}

        {/* Document Preview */}
            {previewUrl && (
          <div className="w-full h-48 bg-gray-100 relative overflow-hidden group cursor-pointer" onClick={() => openResource(item)}>
            {(item.document?.mimeType === 'application/pdf' ||
              previewUrl.toLowerCase().endsWith('.pdf')) ? (
              <object
                data={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`}
                type="application/pdf"
                className="w-full h-full pointer-events-none"
                aria-label={`Preview of ${item.resource.title}`}
              >
                <div className="w-full h-full flex items-center justify-center bg-gray-50">
                  <div className="text-center">
                    <FileText className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <span className="text-sm text-gray-500">PDF Preview</span>
                  </div>
                </div>
              </object>
            ) : (
              <img
                src={previewUrl}
                alt={`Preview of ${item.resource.title}`}
                className="w-full h-full object-cover pointer-events-none"
                onError={() => setPreviewError(true)}
              />
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3">
                <ExternalLink className="w-6 h-6 text-[#236383]" />
              </div>
            </div>
          </div>
        )}

        {/* Fallback preview for non-previewable files */}
        {item.resource.type === 'file' && item.resource.documentId && !previewUrl && (
          <div
            className="w-full h-32 bg-gray-50 relative overflow-hidden group cursor-pointer flex items-center justify-center"
            onClick={() => openResource(item)}
          >
            <div className="text-center">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <span className="text-sm text-gray-500">Click to open document</span>
            </div>
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3">
                <ExternalLink className="w-6 h-6 text-[#236383]" />
              </div>
            </div>
          </div>
        )}

        <div className="p-4">
          {/* Header */}
          <div className="flex items-start gap-3 mb-3">
            <div className={`${category.bgColor} p-2 rounded`}>
              <CategoryIcon className={`w-5 h-5 ${category.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 mb-1 truncate">
                {item.resource.title}
              </h3>
              <p className="text-sm text-gray-600 line-clamp-2">
                {item.resource.description || 'No description'}
              </p>
            </div>
          </div>

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {item.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700"
                style={
                  tag.color
                    ? { backgroundColor: `${tag.color}20`, color: tag.color }
                    : undefined
                }
              >
                <Tag className="w-3 h-3" />
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            {item.resource.accessCount} views
          </span>
          {item.resource.lastAccessedAt && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(item.resource.lastAccessedAt).toLocaleDateString()}
            </span>
          )}
        </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openResource(item)}
              className="flex-1 bg-[#236383] text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#007E8C] transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Open
            </button>

            <button
              onClick={() => copyLink(item)}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                isCopied
                  ? 'bg-[#007E8C]/20 text-[#007E8C]'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Copy link"
            >
              {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>

            <button
              onClick={() => toggleFavorite(item.resource.id)}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                item.isFavorite
                  ? 'bg-[#FBAD3F]/20 text-[#FBAD3F]'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star
                className={`w-4 h-4 ${item.isFavorite ? 'fill-[#FBAD3F]' : ''}`}
              />
            </button>

            {isAdmin && (
              <>
                <button
                  onClick={() => setEditingResource(item)}
                  className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-[#236383] hover:bg-[#236383]/10 transition-colors"
                  title="Edit resource"
                  data-testid={`resource-edit-${item.resource.id}`}
                >
                  <Edit className="w-4 h-4" />
                </button>
                <ResourceDeleteMenu
                  onDelete={() => setResourceToDelete(item)}
                  triggerClassName="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  deleteTestId={`resource-delete-${item.resource.id}`}
                />
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Group resources by category
  const groupedResources = useMemo(() => {
    const groups: Record<string, Resource[]> = {};
    resources.forEach((resource) => {
      const cat = resource.resource.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(resource);
    });
    return groups;
  }, [resources]);

  // Pinned resources
  const pinnedResources = useMemo(() => {
    return resources.filter((r) => r.resource.isPinnedGlobal);
  }, [resources]);

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white rounded-lg shadow-sm p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Failed to Load Resources
          </h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => loadResources()}
            className="bg-[#236383] text-white px-4 py-2 rounded-lg hover:bg-[#007E8C] transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading && resources.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading resources...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Admin Modal — handles both "Add" and "Edit" */}
      <ResourceAdminModal
        isOpen={showAddModal || editingResource !== null}
        onClose={() => {
          setShowAddModal(false);
          setEditingResource(null);
        }}
        onSuccess={loadResources}
        availableTags={tags}
        existingResource={editingResource ?? undefined}
      />

      <AlertDialog
        open={!!resourceToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingResource) setResourceToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete resource?</AlertDialogTitle>
            <AlertDialogDescription>
              {resourceToDelete
                ? `"${resourceToDelete.resource.title}" will be hidden from this page for everyone. An admin can restore it later if needed.`
                : 'This resource will be hidden from this page for everyone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingResource}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteResource();
              }}
              disabled={deletingResource}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deletingResource ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Resources</h1>
              <p className="text-gray-600 mt-1">
                Your central hub for all important documents, links, and materials
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-[#236383] text-white px-4 py-2 rounded-lg hover:bg-[#007E8C] transition-colors flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Add Resource
              </button>
            )}
          </div>

          {/* Search and Filters */}
          <div className="bg-white rounded-lg shadow-sm p-4" data-testid="resources-filters">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Search */}
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search resources..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  data-testid="resources-search"
                />
              </div>

              {/* Sort */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="smart">Smart Sort</option>
                <option value="alphabetical">Alphabetical</option>
                <option value="recent">Recently Accessed</option>
                <option value="popular">Most Popular</option>
                <option value="newest">Newest First</option>
              </select>

              {/* Filters Toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                data-tour="resources-filters-toggle"
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
              >
                <Filter className="w-5 h-5" />
                Filters
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showFilters ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>

            {/* Expanded Filters */}
            {showFilters && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                {/* Category Filter */}
                <div className="mb-4" data-testid="resources-categories">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Category
                  </label>
                  <div className="flex flex-wrap gap-2" data-testid="category-filter">
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        selectedCategory === null
                          ? 'bg-[#236383] text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      All
                    </button>
                    {CATEGORIES.map((cat) => {
                      const Icon = cat.icon;
                      return (
                        <button
                          key={cat.id}
                          data-tour={`category-${cat.id}`}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                            selectedCategory === cat.id
                              ? `${cat.bgColor} ${cat.color} border ${cat.borderColor}`
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Tag Filter */}
                {tags.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tags
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => {
                        const isSelected = selectedTags.includes(tag.tag.name);
                        return (
                          <button
                            key={tag.tag.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedTags(
                                  selectedTags.filter((t) => t !== tag.tag.name)
                                );
                              } else {
                                setSelectedTags([...selectedTags, tag.tag.name]);
                              }
                            }}
                            className={`px-3 py-1.5 rounded-full text-sm transition-colors flex items-center gap-1.5 ${
                              isSelected
                                ? 'bg-[#236383] text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                            style={
                              tag.tag.color && !isSelected
                                ? {
                                    backgroundColor: `${tag.tag.color}20`,
                                    color: tag.tag.color,
                                  }
                                : undefined
                            }
                          >
                            <Tag className="w-3 h-3" />
                            {tag.tag.name} ({tag.usageCount})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick Access Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Pinned Resources */}
          {pinnedResources.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-4" data-testid="pinned-resources">
              <div className="flex items-center gap-2 mb-3">
                <Pin className="w-5 h-5 text-[#FBAD3F]" />
                <h2 className="font-semibold text-gray-900">Pinned</h2>
              </div>
              <div className="space-y-2">
                {pinnedResources.slice(0, 3).map((resource) => (
                  <button
                    key={resource.resource.id}
                    onClick={() => openResource(resource)}
                    className="w-full text-left p-2 rounded hover:bg-gray-50 transition-colors"
                  >
                    <p className="font-medium text-sm text-gray-900 truncate">
                      {resource.resource.title}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {resource.resource.accessCount} views
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Favorites */}
          {favorites.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Star className="w-5 h-5 text-[#FBAD3F] fill-[#FBAD3F]" />
                <h2 className="font-semibold text-gray-900">Your Favorites</h2>
              </div>
              <div className="space-y-2">
                {favorites.slice(0, 3).map((fav) => (
                  <button
                    key={fav.resource.id}
                    onClick={() => openResource(fav)}
                    className="w-full text-left p-2 rounded hover:bg-gray-50 transition-colors"
                  >
                    <p className="font-medium text-sm text-gray-900 truncate">
                      {fav.resource.title}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {fav.resource.accessCount} views
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recently Accessed */}
          {recentResources.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-5 h-5 text-[#47B3CB]" />
                <h2 className="font-semibold text-gray-900">Recently Accessed</h2>
              </div>
              <div className="space-y-2">
                {recentResources.slice(0, 3).map((recent) => (
                  <button
                    key={recent.resource.id}
                    onClick={() => openResource(recent)}
                    className="w-full text-left p-2 rounded hover:bg-gray-50 transition-colors"
                  >
                    <p className="font-medium text-sm text-gray-900 truncate">
                      {recent.resource.title}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {recent.lastAccessed &&
                        new Date(recent.lastAccessed).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sandwich Assembly Guides */}
        <SandwichAssemblyGuides />

        {/* All Resources */}
        {resources.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <Folder className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No resources found
            </h3>
            <p className="text-gray-600">
              {searchTerm || selectedCategory || selectedTags.length > 0
                ? 'Try adjusting your filters'
                : isAdmin
                ? 'Get started by adding your first resource'
                : 'Resources will appear here once they are added'}
            </p>
          </div>
        ) : (
          <div className="space-y-6" data-testid="resources-list">
            {CATEGORIES.map((category) => {
              const categoryResources = groupedResources[category.id] || [];
              if (categoryResources.length === 0) return null;

              const CategoryIcon = category.icon;

              // Separate labels from other resources for special layout
              const labelResources = categoryResources.filter(r => 
                r.resource.title.includes('Labels')
              );
              const otherResources = categoryResources.filter(r => 
                !r.resource.title.includes('Labels')
              );

              return (
                <div key={category.id}>
                  <div className={`flex items-center gap-3 mb-4 pb-3 border-b-2 ${category.borderColor}`}>
                    <div className={`${category.bgColor} p-3 rounded-lg`}>
                      <CategoryIcon className={`w-7 h-7 ${category.color}`} />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {category.label}
                    </h2>
                    <span className="text-sm font-semibold text-gray-500 ml-auto">
                      {categoryResources.length} {categoryResources.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>

                  {/* Labels displayed side-by-side */}
                  {labelResources.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      {labelResources.map((resource) => (
                        <ResourceCard key={resource.resource.id} item={resource} />
                      ))}
                    </div>
                  )}

                  {/* Other resources in standard grid */}
                  {otherResources.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                      {otherResources.map((resource) => (
                        <ResourceCard key={resource.resource.id} item={resource} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* AI Assistant */}
      <FloatingAIChat
        contextType="resources"
        title="Resources Assistant"
        subtitle="Ask about documents and links"
        contextData={{
          currentView: 'resources',
          filters: {
            searchTerm: searchTerm || undefined,
            selectedCategory,
            selectedTags,
            sortBy,
          },
          summaryStats: {
            totalResources: resources.length,
            favoriteCount: favorites.length,
            recentCount: recentResources.length,
          },
        }}
        getFullContext={() => ({
          rawData: resources.map(r => ({
            id: r.resource.id,
            title: r.resource.title,
            description: r.resource.description,
            type: r.resource.type,
            category: r.resource.category,
            url: r.resource.url,
            accessCount: r.resource.accessCount,
            isFavorite: r.isFavorite,
            tags: r.tags.map(t => t.name),
          })),
        })}
        suggestedQuestions={[
          "What resources are available?",
          "How many resources do we have?",
          "Show me training materials",
          "What are the most accessed resources?",
          "Show resources by category",
          "What templates are available?",
        ]}
      />
    </div>
  );
}
