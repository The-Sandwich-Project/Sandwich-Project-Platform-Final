import React, { useState, useEffect } from 'react';
import { X, Upload, Link2, Plus, Tag as TagIcon } from 'lucide-react';

interface ResourceFormData {
  title: string;
  description: string;
  type: 'file' | 'link' | 'google_drive';
  category: string;
  url: string;
  file: File | null;
  icon: string;
  iconColor: string;
  isPinnedGlobal: boolean;
  pinnedOrder: number | null;
  tags: number[];
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

interface ResourceAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingResource?: any; // For editing
  availableTags: Tag[];
}

const CATEGORIES = [
  { id: 'legal_governance', label: 'Legal & Governance' },
  { id: 'brand_marketing', label: 'Brand & Marketing' },
  { id: 'operations_safety', label: 'Operations & Safety' },
  { id: 'forms_templates', label: 'Forms & Templates' },
  { id: 'toolkit', label: 'Toolkit' },
  { id: 'master_documents', label: 'Master Documents' },
];

export function ResourceAdminModal({
  isOpen,
  onClose,
  onSuccess,
  existingResource,
  availableTags,
}: ResourceAdminModalProps) {
  const [formData, setFormData] = useState<ResourceFormData>({
    title: '',
    description: '',
    type: 'link',
    category: 'legal_governance',
    url: '',
    file: null,
    icon: '',
    iconColor: '',
    isPinnedGlobal: false,
    pinnedOrder: null,
    tags: [],
  });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3B82F6');

  useEffect(() => {
    if (existingResource) {
      setFormData({
        title: existingResource.resource.title,
        description: existingResource.resource.description || '',
        type: existingResource.resource.type,
        category: existingResource.resource.category,
        url: existingResource.resource.url || '',
        file: null,
        icon: existingResource.resource.icon || '',
        iconColor: existingResource.resource.iconColor || '',
        isPinnedGlobal: existingResource.resource.isPinnedGlobal,
        pinnedOrder: existingResource.resource.pinnedOrder,
        tags: existingResource.tags.map((t: any) => t.id),
      });
    } else {
      // When the modal is reopened for "Add" after being used to edit,
      // clear any leftover values from the previous edit session.
      setFormData({
        title: '',
        description: '',
        type: 'link',
        category: 'legal_governance',
        url: '',
        file: null,
        icon: '',
        iconColor: '',
        isPinnedGlobal: false,
        pinnedOrder: null,
        tags: [],
      });
    }
    setError(null);
  }, [existingResource, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUploading(true);

    try {
      let documentId = null;

      // Upload file if type is 'file' and a file is selected.
      // Uses the two-step presigned-URL flow: request a cloud upload URL,
      // PUT the file directly to storage, then create the document record.
      if (formData.type === 'file' && formData.file) {
        const file = formData.file;

        // Step 1: Request a presigned upload URL
        const urlRes = await fetch('/api/documents/request-upload-url', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            size: file.size,
            contentType: file.type,
          }),
        });

        if (!urlRes.ok) {
          const err = await urlRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to get upload URL');
        }

        const { uploadURL, objectPath } = await urlRes.json();

        // Step 2: Upload the file directly to cloud storage
        const uploadRes = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!uploadRes.ok) {
          throw new Error('Failed to upload file to storage');
        }

        // Step 3: Create the document record in the database
        const createRes = await fetch('/api/documents', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: formData.title,
            description: formData.description || null,
            category: formData.category,
            fileName: file.name,
            originalName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            objectPath,
          }),
        });

        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to create document record');
        }

        const uploadData = await createRes.json();
        documentId = uploadData.document?.id ?? uploadData.id;
      }

      // Create or update resource
      const resourceData: Record<string, unknown> = {
        title: formData.title,
        description: formData.description,
        type: formData.type,
        category: formData.category,
        icon: formData.icon || null,
        iconColor: formData.iconColor || null,
        isPinnedGlobal: formData.isPinnedGlobal,
        pinnedOrder: formData.isPinnedGlobal ? formData.pinnedOrder : null,
        tags: formData.tags,
      };

      if (existingResource) {
        // PUT: don't wipe url/documentId when editing metadata without a new file upload
        if (formData.type === 'link' || formData.type === 'google_drive') {
          resourceData.url = formData.url;
        } else if (documentId) {
          resourceData.documentId = documentId;
          resourceData.url = null;
        }
      } else {
        resourceData.url = formData.type !== 'file' ? formData.url : null;
        resourceData.documentId = documentId;
      }

      const url = existingResource
        ? `/api/resources/${existingResource.resource.id}`
        : '/api/resources';
      const method = existingResource ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(resourceData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save resource');
      }

      // Tags are now handled by the backend in both POST and PUT requests
      onSuccess();
      onClose();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      const res = await fetch('/api/resources/tags', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newTagName,
          color: newTagColor,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to create tag');
      }

      const newTag = await res.json();
      setFormData({ ...formData, tags: [...formData.tags, newTag.id] });
      setNewTagName('');
      setNewTagColor('#3B82F6');
      setShowNewTagForm(false);
      onSuccess(); // Refresh tags list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      type: 'link',
      category: 'legal_governance',
      url: '',
      file: null,
      icon: '',
      iconColor: '',
      isPinnedGlobal: false,
      pinnedOrder: null,
      tags: [],
    });
    setError(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            {existingResource ? 'Edit Resource' : 'Add New Resource'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type *
            </label>
            <select
              value={formData.type}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  type: e.target.value as 'file' | 'link' | 'google_drive',
                })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="link">External Link</option>
              <option value="google_drive">Google Drive Link</option>
              <option value="file">Upload File</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category *
            </label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* URL or File Upload */}
          {formData.type !== 'file' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                URL *
              </label>
              <div className="flex items-center gap-2">
                <Link2 className="w-5 h-5 text-gray-400" />
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://example.com"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                File *
              </label>
              <div className="flex items-center gap-4">
                <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-500 transition-colors">
                  <Upload className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {formData.file ? formData.file.name : 'Choose a file'}
                  </span>
                  <input
                    type="file"
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        file: e.target.files?.[0] || null,
                      })
                    }
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tags
            </label>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => {
                  const isSelected = formData.tags.includes(tag.tag.id);
                  return (
                    <button
                      key={tag.tag.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setFormData({
                            ...formData,
                            tags: formData.tags.filter((id) => id !== tag.tag.id),
                          });
                        } else {
                          setFormData({
                            ...formData,
                            tags: [...formData.tags, tag.tag.id],
                          });
                        }
                      }}
                      className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                        isSelected
                          ? 'bg-[#236383] text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {tag.tag.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowNewTagForm(!showNewTagForm)}
                  className="px-3 py-1.5 rounded-full text-sm bg-[#236383]/20 text-[#236383] hover:bg-[#236383]/30 transition-colors flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  New Tag
                </button>
              </div>

              {showNewTagForm && (
                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Tag name"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={handleCreateTag}
                    className="px-4 py-2 bg-[#236383] text-white rounded-lg hover:bg-[#236383] transition-colors"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewTagForm(false);
                      setNewTagName('');
                      setNewTagColor('#3B82F6');
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Pin Settings */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center gap-3 mb-3">
              <input
                type="checkbox"
                id="isPinned"
                checked={formData.isPinnedGlobal}
                onChange={(e) =>
                  setFormData({ ...formData, isPinnedGlobal: e.target.checked })
                }
                className="w-4 h-4 text-[#236383] rounded focus:ring-2 focus:ring-[#236383]"
              />
              <label htmlFor="isPinned" className="text-sm font-medium text-gray-700">
                Pin this resource globally
              </label>
            </div>

            {formData.isPinnedGlobal && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pin Order (lower = higher priority)
                </label>
                <input
                  type="number"
                  value={formData.pinnedOrder || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      pinnedOrder: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="px-6 py-2 bg-[#236383] text-white rounded-lg hover:bg-[#236383] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading
                ? 'Saving...'
                : existingResource
                ? 'Update Resource'
                : 'Create Resource'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
