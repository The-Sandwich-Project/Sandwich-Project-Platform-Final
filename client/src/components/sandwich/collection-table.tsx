import { useState } from "react";
import { Edit, Trash2, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SandwichCollection } from "@shared/schema";

interface CollectionTableProps {
  collections: SandwichCollection[];
  onEdit: (collection: SandwichCollection) => void;
  onDelete: (id: number) => void;
  isUpdating: boolean;
  isDeleting: boolean;
}

interface EditDialogProps {
  collection: SandwichCollection | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<SandwichCollection>) => void;
  isUpdating: boolean;
}

function EditCollectionDialog({ collection, isOpen, onClose, onSave, isUpdating }: EditDialogProps) {
  const [formData, setFormData] = useState({
    collectionDate: collection?.collectionDate || '',
    hostName: collection?.hostName || '',
    individualSandwiches: collection?.individualSandwiches || 0,
    group1Name: (collection as any)?.group1Name || '',
    group1Count: (collection as any)?.group1Count || 0,
    group2Name: (collection as any)?.group2Name || '',
    group2Count: (collection as any)?.group2Count || 0
  });

  const handleSave = () => {
    onSave(formData);
  };

  if (!collection) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="mobile-dialog-content sm:max-w-[500px]">
        <DialogHeader className="mobile-modal-header pb-4 border-b border-gray-100">
          <DialogTitle className="premium-text-h3 text-[#236383]">Edit Collection</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mobile-modal-body py-4">
          <div className="space-y-2">
            <Label htmlFor="collectionDate" className="text-sm font-semibold text-[#236383]">
              Collection Date
            </Label>
            <Input
              id="collectionDate"
              type="date"
              value={formData.collectionDate}
              onChange={(e) => setFormData({ ...formData, collectionDate: e.target.value })}
              className="premium-input mobile-input border-[#236383]/20 focus:border-[#236383]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="hostName" className="text-sm font-semibold text-[#236383]">
              Host Name
            </Label>
            <Input
              id="hostName"
              value={formData.hostName}
              onChange={(e) => setFormData({ ...formData, hostName: e.target.value })}
              className="premium-input mobile-input border-[#236383]/20 focus:border-[#236383]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="individualSandwiches" className="text-sm font-semibold text-[#236383]">
              Individual Sandwiches
            </Label>
            <Input
              id="individualSandwiches"
              type="number"
              min="0"
              value={formData.individualSandwiches}
              onChange={(e) => setFormData({ ...formData, individualSandwiches: parseInt(e.target.value) || 0 })}
              className="premium-input mobile-input border-[#236383]/20 focus:border-[#236383]"
            />
          </div>

          <div className="space-y-3 pt-2">
            <Label className="text-sm font-semibold text-[#236383]">Group Collections</Label>
            <div className="space-y-3 ml-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder="Group 1 name"
                  value={formData.group1Name}
                  onChange={(e) => setFormData({ ...formData, group1Name: e.target.value })}
                  className="premium-input mobile-input border-[#236383]/20 focus:border-[#236383]"
                />
                <Input
                  type="number"
                  min="0"
                  placeholder="Count"
                  value={formData.group1Count}
                  onChange={(e) => setFormData({ ...formData, group1Count: parseInt(e.target.value) || 0 })}
                  className="premium-input mobile-input border-[#236383]/20 focus:border-[#236383]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder="Group 2 name"
                  value={formData.group2Name}
                  onChange={(e) => setFormData({ ...formData, group2Name: e.target.value })}
                  className="premium-input mobile-input border-[#236383]/20 focus:border-[#236383]"
                />
                <Input
                  type="number"
                  min="0"
                  placeholder="Count"
                  value={formData.group2Count}
                  onChange={(e) => setFormData({ ...formData, group2Count: parseInt(e.target.value) || 0 })}
                  className="premium-input mobile-input border-[#236383]/20 focus:border-[#236383]"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-gray-100 mobile-form-actions">
            <Button
              variant="outline"
              onClick={onClose}
              className="mobile-button border-[#236383]/30 text-[#236383] hover:bg-[#236383]/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isUpdating}
              className="mobile-button bg-gradient-to-r from-[#236383] to-[#236383] hover:from-[#1e5a75] hover:to-[#1e5a75] text-white shadow-md"
            >
              {isUpdating ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CollectionTable({ collections, onEdit, onDelete, isUpdating, isDeleting }: CollectionTableProps) {
  const [editingCollection, setEditingCollection] = useState<SandwichCollection | null>(null);

  // PHASE 5: Get group collections from new column structure
  const getGroupCollections = (collection: SandwichCollection) => {
    const groups = [];
    const group1Name = (collection as any).group1Name;
    const group1Count = (collection as any).group1Count;
    const group2Name = (collection as any).group2Name;
    const group2Count = (collection as any).group2Count;
    
    if (group1Name && group1Count > 0) {
      groups.push({ groupName: group1Name, sandwichCount: group1Count });
    }
    if (group2Name && group2Count > 0) {
      groups.push({ groupName: group2Name, sandwichCount: group2Count });
    }
    return groups;
  };

  const calculateTotal = (collection: SandwichCollection) => {
    const groupCollections = getGroupCollections(collection);
    const groupTotal = groupCollections.reduce((sum: number, group: any) => 
      sum + (group.sandwichCount || 0), 0
    );
    return collection.individualSandwiches + groupTotal;
  };

  const handleEditClick = (collection: SandwichCollection) => {
    setEditingCollection(collection);
  };

  const handleEditSave = (updates: Partial<SandwichCollection>) => {
    if (editingCollection) {
      onEdit({ ...editingCollection, ...updates });
      setEditingCollection(null);
    }
  };

  const handleEditClose = () => {
    setEditingCollection(null);
  };

  return (
    <>
      {/* Desktop Table View - Only show on large screens (1024px+) */}
      <div className="hidden lg:block overflow-x-auto">
        <div className="premium-card overflow-hidden">
          <table className="w-full border-collapse table-fixed">
            <thead>
              <tr className="border-b-2 border-[#236383]/10 bg-gradient-to-r from-[#236383]/5 to-[#47B3CB]/5">
                <th className="text-left p-3 lg:p-4 premium-text-body-sm font-semibold text-[#236383] w-[120px]">Date</th>
                <th className="text-left p-3 lg:p-4 premium-text-body-sm font-semibold text-[#236383] w-[140px]">Host</th>
                <th className="text-left p-3 lg:p-4 premium-text-body-sm font-semibold text-[#236383] w-[100px]">Individual</th>
                <th className="text-left p-3 lg:p-4 premium-text-body-sm font-semibold text-[#236383] w-[180px]">Groups</th>
                <th className="text-left p-3 lg:p-4 premium-text-body-sm font-semibold text-[#236383] w-[90px]">Total</th>
                <th className="text-left p-3 lg:p-4 premium-text-body-sm font-semibold text-[#236383] w-[150px]">Submitted By</th>
                <th className="text-left p-3 lg:p-4 premium-text-body-sm font-semibold text-[#236383] w-[120px]">Date Submitted</th>
                <th className="text-right p-3 lg:p-4 premium-text-body-sm font-semibold text-[#236383] w-[100px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((collection) => {
                const groupCollections = getGroupCollections(collection);
                const total = calculateTotal(collection);

                return (
                  <tr
                    key={collection.id}
                    className="border-b border-gray-100 hover:bg-gradient-to-r hover:from-[#236383]/[0.02] hover:to-[#47B3CB]/[0.02] transition-all duration-200"
                  >
                    <td className="p-3 lg:p-4">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Calendar className="h-4 w-4 text-[#236383] flex-shrink-0" />
                        <span className="font-medium text-gray-900 text-sm truncate">
                          {(() => {
                            const dateStr = collection.collectionDate;
                            if (!dateStr) return 'No date';
                            let date: Date;
                            if (dateStr.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
                              const dateOnly = dateStr.split('T')[0];
                              date = new Date(dateOnly + 'T12:00:00');
                            } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                              date = new Date(dateStr + 'T12:00:00');
                            } else {
                              date = new Date(dateStr);
                            }
                            return isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleDateString();
                          })()}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 lg:p-4">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <User className="h-4 w-4 text-[#236383] flex-shrink-0" />
                        <span className="text-gray-900 font-medium text-sm truncate">{collection.hostName}</span>
                      </div>
                    </td>
                    <td className="p-3 lg:p-4">
                      <span className="premium-badge-info text-xs">
                        {collection.individualSandwiches}
                      </span>
                    </td>
                    <td className="p-3 lg:p-4">
                      {groupCollections.length > 0 ? (
                        <div className="space-y-1">
                          {groupCollections.map((group: any, idx: number) => (
                            <div key={idx} className="text-xs flex items-center gap-1.5 overflow-hidden">
                              <span className="font-semibold text-[#236383] truncate">{group.groupName}:</span>
                              <span className="premium-badge-success text-xs flex-shrink-0">{group.sandwichCount}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs italic">None</span>
                      )}
                    </td>
                    <td className="p-3 lg:p-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-sm font-bold rounded-full bg-gradient-to-r from-[#236383] to-[#236383] text-white shadow-sm">
                        {total}
                      </span>
                    </td>
                    <td className="p-3 lg:p-4 text-sm">
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <User className="h-3.5 w-3.5 text-[#236383] flex-shrink-0" />
                        <span className="text-gray-700 text-xs truncate">{(collection as any).createdByName || 'Unknown User'}</span>
                      </div>
                    </td>
                    <td className="p-3 lg:p-4 text-xs text-gray-600">
                      {(() => {
                        const dateStr = collection.submittedAt;
                        if (!dateStr) return 'No date';
                        let date: Date;
                        const dateStrString = typeof dateStr === 'string' ? dateStr : dateStr?.toISOString?.() ?? '';
                        if (dateStrString.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
                          const dateOnly = dateStrString.split('T')[0];
                          date = new Date(dateOnly + 'T12:00:00');
                        } else if (dateStrString.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          date = new Date(dateStrString + 'T12:00:00');
                        } else {
                          date = new Date(dateStrString);
                        }
                        return isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleDateString();
                      })()}
                    </td>
                    <td className="p-3 lg:p-4">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClick(collection)}
                          disabled={isUpdating}
                          className="h-8 w-8 p-0 hover:bg-[#236383]/10 hover:text-[#236383] transition-colors"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(collection.id)}
                          disabled={isDeleting}
                          className="h-8 w-8 p-0 text-[#A31C41] hover:text-[#8B1736] hover:bg-[#A31C41]/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile/Tablet Card View - Show on screens smaller than 1024px */}
      <div className="lg:hidden space-y-4 mobile-container-tight">
        {collections.map((collection) => {
          const groupCollections = getGroupCollections(collection);
          const total = calculateTotal(collection);

          return (
            <div
              key={collection.id}
              className="premium-card p-4 mobile-card hover:shadow-lg transition-all duration-300"
            >
              {/* Header Row */}
              <div className="flex items-start justify-between mb-4 pb-3 border-b border-gray-100">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-4 w-4 text-[#236383]" />
                    <span className="font-bold text-gray-900">
                      {(() => {
                        const dateStr = collection.collectionDate;
                        if (!dateStr) return 'No date';
                        let date: Date;
                        if (dateStr.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
                          const dateOnly = dateStr.split('T')[0];
                          date = new Date(dateOnly + 'T12:00:00');
                        } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          date = new Date(dateStr + 'T12:00:00');
                        } else {
                          date = new Date(dateStr);
                        }
                        return isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleDateString();
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-[#236383]" />
                    <span className="text-sm font-medium text-gray-700">{collection.hostName}</span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-base font-bold rounded-full bg-gradient-to-r from-[#236383] to-[#236383] text-white shadow-md">
                  {total}
                </span>
              </div>

              {/* Content Grid */}
              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#236383] uppercase tracking-wide">Individual</span>
                  <span className="premium-badge-info">
                    {collection.individualSandwiches}
                  </span>
                </div>

                {groupCollections.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-[#236383] uppercase tracking-wide block mb-2">Groups</span>
                    <div className="space-y-2 ml-2">
                      {groupCollections.map((group: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-gray-700">{group.groupName}</span>
                          <span className="premium-badge-success text-xs">{group.sandwichCount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <User className="h-3 w-3 text-[#236383]" />
                    <span>Submitted by <span className="font-medium text-gray-800">{(collection as any).createdByName || 'Unknown User'}</span></span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 ml-5">
                    {(() => {
                      const dateStr = collection.submittedAt;
                      if (!dateStr) return 'No date';
                      let date: Date;
                      const dateStrString = typeof dateStr === 'string' ? dateStr : dateStr?.toISOString?.() ?? '';
                      if (dateStrString.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
                        const dateOnly = dateStrString.split('T')[0];
                        date = new Date(dateOnly + 'T12:00:00');
                      } else if (dateStrString.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        date = new Date(dateStrString + 'T12:00:00');
                      } else {
                        date = new Date(dateStrString);
                      }
                      return isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleDateString();
                    })()}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-3 border-t border-gray-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditClick(collection)}
                  disabled={isUpdating}
                  className="flex-1 h-10 gap-2 border-[#236383] text-[#236383] hover:bg-[#236383] hover:text-white transition-colors"
                >
                  <Edit className="h-4 w-4" />
                  <span>Edit</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDelete(collection.id)}
                  disabled={isDeleting}
                  className="h-10 w-10 p-0 border-[#A31C41] text-[#A31C41] hover:bg-[#A31C41] hover:text-white transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <EditCollectionDialog
        collection={editingCollection}
        isOpen={!!editingCollection}
        onClose={handleEditClose}
        onSave={handleEditSave}
        isUpdating={isUpdating}
      />
    </>
  );
}