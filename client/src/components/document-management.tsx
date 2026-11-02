import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Plus,
  Upload,
  Eye,
  Download,
  Edit,
  Trash2,
  Users,
  Shield,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@shared/unified-auth-utils';
import { PERMISSIONS } from '@shared/auth-utils';
import { DocumentPreviewModal } from '@/components/document-preview-modal';

export interface Document {
  id: number;
  title: string;
  description?: string | null;
  fileName: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  category: string;
  isActive: boolean;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentPermission {
  id: number;
  documentId: number;
  userId: string;
  permissionType: string;
  grantedBy: string;
  grantedByName: string;
  grantedAt: string;
  expiresAt?: string;
  notes?: string;
  isActive: boolean;
}

interface DocumentAccessLog {
  id: number;
  documentId: number;
  userId: string;
  userName: string;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  accessedAt: string;
}

const CATEGORIES = [
  { value: 'governance', label: 'Governance' },
  { value: 'operations', label: 'Operations' },
  { value: 'training', label: 'Training' },
  { value: 'confidential', label: 'Confidential' },
  { value: 'general', label: 'General' },
];

const PERMISSION_TYPES = [
  { value: 'view', label: 'View', description: 'Can view document details' },
  {
    value: 'download',
    label: 'Download',
    description: 'Can download and view',
  },
  { value: 'edit', label: 'Edit', description: 'Can modify document' },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full access including permissions',
  },
];

export function documentMatchesFilters(
  doc: Document,
  searchTerm: string,
  categoryFilter: string
) {
  const normalizedSearch = searchTerm.toLowerCase();
  const matchesSearch =
    normalizedSearch === '' ||
    doc.title.toLowerCase().includes(normalizedSearch) ||
    (doc.description ?? '').toLowerCase().includes(normalizedSearch);

  const matchesCategory =
    categoryFilter === 'all' || doc.category === categoryFilter;

  return matchesSearch && matchesCategory;
}

function DocumentUploadDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    setIsUploading(true);
    try {
      const urlResponse = await fetch('/api/documents/request-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type,
        }),
      });

      if (!urlResponse.ok) {
        const err = await urlResponse.json();
        throw new Error(err.error || 'Failed to get upload URL');
      }

      const { uploadURL, objectPath } = await urlResponse.json();

      const putResponse = await fetch(uploadURL, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!putResponse.ok) {
        throw new Error('Failed to upload file to cloud storage');
      }

      const docResponse = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          description,
          category,
          fileName: file.name,
          originalName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          objectPath,
        }),
      });

      if (!docResponse.ok) {
        const err = await docResponse.json();
        throw new Error(err.error || 'Failed to create document record');
      }

      toast({ title: 'Document uploaded successfully' });
      setOpen(false);
      setTitle('');
      setDescription('');
      setCategory('general');
      setFile(null);
      onSuccess();
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Upload Document
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Upload New Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="title">Document Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter document title"
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the document"
            />
          </div>

          <div>
            <Label htmlFor="category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="file">File *</Label>
            <Input
              id="file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
            {file && (
              <p className="text-sm text-muted-foreground mt-1">
                {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isUploading}>
              {isUploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDocumentDialog({
  document,
  onClose,
  onSave,
  isSaving,
}: {
  document: Document;
  onClose: () => void;
  onSave: (values: { title: string; description: string; category: string }) => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description ?? '');
  const [category, setCategory] = useState(document.category);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), category });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Edit Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="edit-title">Document Title *</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter document title"
              required
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the document"
            />
          </div>

          <div>
            <Label htmlFor="edit-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            File contents and filename cannot be edited &mdash; re-upload the document to replace the file.
          </p>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !title.trim()}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPermissionsDialog({
  document,
  onClose,
}: {
  document: Document;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [newUserId, setNewUserId] = useState('');
  const [newPermissionType, setNewPermissionType] = useState('view');
  const [notes, setNotes] = useState('');

  const { data: permissions = [] } = useQuery<DocumentPermission[]>({
    queryKey: ['/api/documents', document.id, 'permissions'],
    enabled: !!document,
  });

  const { data: accessLogs = [] } = useQuery({
    queryKey: ['/api/documents', document.id, 'access-logs'],
    enabled: !!document,
  });

  const grantPermissionMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(
        `/api/documents/${document.id}/permissions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      if (!response.ok) throw new Error('Failed to grant permission');
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Permission granted successfully' });
      queryClient.invalidateQueries({
        queryKey: ['/api/documents', document.id, 'permissions'],
      });
      setNewUserId('');
      setNewPermissionType('view');
      setNotes('');
    },
    onError: (error) => {
      toast({
        title: 'Failed to grant permission',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const revokePermissionMutation = useMutation({
    mutationFn: async ({
      userId,
      permissionType,
    }: {
      userId: string;
      permissionType: string;
    }) => {
      const response = await fetch(
        `/api/documents/${document.id}/permissions/${userId}/${permissionType}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error('Failed to revoke permission');
    },
    onSuccess: () => {
      toast({ title: 'Permission revoked successfully' });
      queryClient.invalidateQueries({
        queryKey: ['/api/documents', document.id, 'permissions'],
      });
    },
  });

  const handleGrantPermission = () => {
    if (!newUserId) return;

    grantPermissionMutation.mutate({
      userId: newUserId,
      permissionType: newPermissionType,
      notes,
    });
  };

  const getCategoryBadgeVariant = (category: string) => {
    switch (category) {
      case 'confidential':
        return 'destructive';
      case 'governance':
        return 'secondary';
      case 'operations':
        return 'default';
      case 'training':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Document Permissions: {document.title}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="permissions" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="permissions">Permissions</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          <TabsContent value="permissions" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Grant New Permission</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="userId">User ID</Label>
                    <Input
                      id="userId"
                      value={newUserId}
                      onChange={(e) => setNewUserId(e.target.value)}
                      placeholder="Enter user ID or email"
                    />
                  </div>
                  <div>
                    <Label htmlFor="permissionType">Permission Level</Label>
                    <Select
                      value={newPermissionType}
                      onValueChange={setNewPermissionType}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERMISSION_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div>
                              <div className="font-medium">{type.label}</div>
                              <div className="text-sm text-muted-foreground">
                                {type.description}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      onClick={handleGrantPermission}
                      disabled={!newUserId || grantPermissionMutation.isPending}
                      className="w-full"
                    >
                      Grant Access
                    </Button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="notes">Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason for granting access"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current Permissions</CardTitle>
              </CardHeader>
              <CardContent>
                {permissions.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Permission</TableHead>
                        <TableHead>Granted By</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {permissions.map((permission: DocumentPermission) => (
                        <TableRow key={permission.id}>
                          <TableCell className="font-medium">
                            {permission.userId}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {permission.permissionType}
                            </Badge>
                          </TableCell>
                          <TableCell>{permission.grantedByName}</TableCell>
                          <TableCell>
                            {new Date(
                              permission.grantedAt
                            ).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                revokePermissionMutation.mutate({
                                  userId: permission.userId,
                                  permissionType: permission.permissionType,
                                })
                              }
                              disabled={revokePermissionMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground">
                    No permissions granted yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {accessLogs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>IP Address</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accessLogs.map((log: DocumentAccessLog) => (
                        <TableRow key={log.id}>
                          <TableCell className="font-medium">
                            {log.userName}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.action}</Badge>
                          </TableCell>
                          <TableCell>
                            {new Date(log.accessedAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {log.ipAddress || 'Unknown'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground">
                    No activity recorded yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Document Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">
                      Title
                    </Label>
                    <p className="font-medium">{document.title}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">
                      Category
                    </Label>
                    <Badge variant={getCategoryBadgeVariant(document.category)}>
                      {document.category}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">
                      File Size
                    </Label>
                    <p>{formatFileSize(document.fileSize)}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">
                      File Type
                    </Label>
                    <p>{document.mimeType}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">
                      Uploaded By
                    </Label>
                    <p>{document.uploadedByName}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">
                      Upload Date
                    </Label>
                    <p>{new Date(document.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                {document.description && (
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">
                      Description
                    </Label>
                    <p className="text-sm">{document.description}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function getDocumentTypeFromMime(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mimeType === 'application/msword') return 'docx';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimeType === 'application/vnd.ms-excel') return 'xlsx';
  if (mimeType?.startsWith('image/')) return 'image';
  return 'other';
}

export default function DocumentManagement() {
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(
    null
  );
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: documents = [], refetch } = useQuery({
    queryKey: ['/api/documents'],
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete document');
    },
    onSuccess: () => {
      toast({ title: 'Document deleted successfully' });
      refetch();
    },
    onError: (error) => {
      toast({
        title: 'Failed to delete document',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const updateDocumentMutation = useMutation({
    mutationFn: async (payload: {
      id: number;
      title: string;
      description: string;
      category: string;
    }) => {
      const { id, ...updates } = payload;
      const response = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update document');
      }
    },
    onSuccess: () => {
      toast({ title: 'Document updated successfully' });
      setEditingDocument(null);
      refetch();
    },
    onError: (error) => {
      toast({
        title: 'Failed to update document',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const filteredDocuments = documents.filter((doc: Document) =>
    documentMatchesFilters(doc, searchTerm, categoryFilter)
  );

  const getCategoryBadgeVariant = (category: string) => {
    switch (category) {
      case 'confidential':
        return 'destructive';
      case 'governance':
        return 'secondary';
      case 'operations':
        return 'default';
      case 'training':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Document Management</h1>
          <p className="text-muted-foreground">
            Manage documents with granular access control
          </p>
        </div>
        <DocumentUploadDialog onSuccess={refetch} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex-1">
              <Input
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredDocuments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((document: Document) => (
                  <TableRow key={document.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{document.title}</p>
                        {document.description && (
                          <p className="text-sm text-muted-foreground">
                            {document.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={getCategoryBadgeVariant(document.category)}
                      >
                        {document.category}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatFileSize(document.fileSize)}</TableCell>
                    <TableCell>{document.uploadedByName}</TableCell>
                    <TableCell>
                      {new Date(document.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Preview"
                          onClick={() => setPreviewDocument(document)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Download"
                          onClick={() =>
                            window.open(
                              `/api/documents/${document.id}/download`,
                              '_blank'
                            )
                          }
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        {user && (user.role === 'admin' || user.role === 'super_admin' || document.uploadedBy === user.id) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Edit"
                            onClick={() => setEditingDocument(document)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        )}
                        {user && (user.role === 'admin' || user.role === 'super_admin') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Permissions"
                            onClick={() => setSelectedDocument(document)}
                          >
                            <Users className="w-4 h-4" />
                          </Button>
                        )}
                        {user && (user.role === 'admin' || user.role === 'super_admin' || document.uploadedBy === user.id) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Delete"
                            onClick={() =>
                              deleteDocumentMutation.mutate(document.id)
                            }
                            disabled={deleteDocumentMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8">
              <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No documents found. Upload your first document to get started.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedDocument && (
        <DocumentPermissionsDialog
          document={selectedDocument}
          onClose={() => setSelectedDocument(null)}
        />
      )}

      {previewDocument && (
        <DocumentPreviewModal
          isOpen={true}
          onClose={() => setPreviewDocument(null)}
          documentPath={`/api/documents/${previewDocument.id}/preview`}
          documentName={previewDocument.originalName || previewDocument.title}
          documentType={getDocumentTypeFromMime(previewDocument.mimeType)}
        />
      )}

      {editingDocument && (
        <EditDocumentDialog
          document={editingDocument}
          onClose={() => setEditingDocument(null)}
          onSave={(values) =>
            updateDocumentMutation.mutate({ id: editingDocument.id, ...values })
          }
          isSaving={updateDocumentMutation.isPending}
        />
      )}
    </div>
  );
}
