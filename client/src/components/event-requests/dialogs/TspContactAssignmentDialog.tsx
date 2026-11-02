import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  User,
  Check,
  X,
  UserPlus,
  Users,
  Edit,
} from 'lucide-react';
import { useEventMutations } from '../hooks/useEventMutations';
import { logger } from '@/lib/logger';

interface TspContactAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequestId: number;
  eventRequestTitle?: string;
  currentTspContact?: string;
  currentCustomTspContact?: string;
}

interface User {
  id: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email: string;
  role?: string;
}

export const TspContactAssignmentDialog: React.FC<TspContactAssignmentDialogProps> = ({
  isOpen,
  onClose,
  eventRequestId,
  eventRequestTitle,
  currentTspContact,
  currentCustomTspContact,
}) => {
  const [activeTab, setActiveTab] = useState<'user' | 'custom'>('user');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [customContactText, setCustomContactText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { assignTspContactMutation } = useEventMutations();

  // Fetch all users for selection using the for-assignments endpoint (no special permissions required)
  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['/api/users/for-assignments'],
    enabled: isOpen,
  });

  // Initialize form with current values
  useEffect(() => {
    if (isOpen) {
      if (currentTspContact && !currentCustomTspContact) {
        // Current assignment is a user
        setActiveTab('user');
        setSelectedUserId(currentTspContact);
        setCustomContactText('');
      } else if (currentCustomTspContact) {
        // Current assignment is custom text
        setActiveTab('custom');
        setSelectedUserId('');
        setCustomContactText(currentCustomTspContact);
      } else {
        // No current assignment
        setActiveTab('user');
        setSelectedUserId('');
        setCustomContactText('');
      }
      setSearchTerm('');
    }
  }, [isOpen, currentTspContact, currentCustomTspContact]);

  // Filter users based on search term
  const filteredUsers = users.filter(user => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    const displayName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 
                       user.displayName || 
                       user.email || 
                       'Unknown User';
    return (
      displayName.toLowerCase().includes(searchLower) ||
      (user.email && user.email.toLowerCase().includes(searchLower)) ||
      (user.role && user.role.toLowerCase().includes(searchLower))
    );
  });

  const handleSave = async () => {
    if (isSubmitting) return;

    let assignmentData: any = {
      id: eventRequestId,
    };

    if (activeTab === 'user' && selectedUserId) {
      // Assign a user as TSP contact
      assignmentData.tspContact = selectedUserId;
      assignmentData.customTspContact = null;
    } else if (activeTab === 'custom' && customContactText.trim()) {
      // Assign custom text as TSP contact
      assignmentData.tspContact = null;
      assignmentData.customTspContact = customContactText.trim();
    } else {
      // No assignment (clear existing)
      assignmentData.tspContact = null;
      assignmentData.customTspContact = null;
    }

    setIsSubmitting(true);
    try {
      await assignTspContactMutation.mutateAsync(assignmentData);
      onClose();
    } catch (error) {
      logger.error('Failed to assign TSP contact:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  const getSelectedUserName = (userId: string): string => {
    const user = users.find(u => u.id === userId);
    if (!user) return userId;
    return `${user.firstName || ''} ${user.lastName || ''}`.trim() || 
           user.displayName || 
           user.email || 
           'Unknown User';
  };

  const getCurrentAssignment = (): string => {
    if (currentTspContact && !currentCustomTspContact) {
      return `User: ${getSelectedUserName(currentTspContact)}`;
    } else if (currentCustomTspContact) {
      return `Custom: ${currentCustomTspContact}`;
    }
    return 'No TSP contact assigned';
  };

  const hasChanges = (): boolean => {
    // Check both user and custom fields for any changes
    const userChanged = selectedUserId !== (currentTspContact || '');
    const customChanged = customContactText.trim() !== (currentCustomTspContact || '');
    return userChanged || customChanged;
  };

  const canSave = (): boolean => {
    // Must have changes to save
    if (!hasChanges()) return false;
    
    // Check if we're removing an existing assignment
    const hasExistingAssignment = currentTspContact || currentCustomTspContact;
    const isClearing = !selectedUserId && !customContactText.trim();
    
    // Allow clearing an existing assignment (removal is valid)
    if (hasExistingAssignment && isClearing) {
      return true;
    }
    
    // Otherwise, require content based on active tab to save a new assignment
    if (activeTab === 'user') {
      return !!selectedUserId;
    } else {
      return !!customContactText.trim();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Assign TSP Contact
          </DialogTitle>
          <DialogDescription>
            {eventRequestTitle && (
              <span className="font-medium">Event: {eventRequestTitle}</span>
            )}
            <br />
            Current assignment: {getCurrentAssignment()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'user' | 'custom')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="user" className="flex items-center gap-2" data-testid="tab-user-selection">
                <Users className="w-4 h-4" />
                Select User
              </TabsTrigger>
              <TabsTrigger value="custom" className="flex items-center gap-2" data-testid="tab-custom-entry">
                <Edit className="w-4 h-4" />
                Custom Contact
              </TabsTrigger>
            </TabsList>

            <TabsContent value="user" className="space-y-4">
              <div className="space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search users by name, email, or role..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    data-testid="input-user-search"
                  />
                </div>

                {/* Selected User */}
                {selectedUserId && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-700">Selected TSP Contact</Label>
                    <Badge variant="secondary" className="bg-tsp-sky/15 text-tsp-teal border-tsp-sky p-2">
                      <User className="w-4 h-4 mr-2" />
                      {getSelectedUserName(selectedUserId)}
                      <button
                        onClick={() => setSelectedUserId('')}
                        className="ml-2 hover:bg-tsp-sky/25 rounded-full w-4 h-4 flex items-center justify-center"
                        data-testid="button-clear-user-selection"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  </div>
                )}

                {/* Available Users */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">
                    Available Users ({filteredUsers.length})
                  </Label>
                  <ScrollArea className="h-80 border rounded-md">
                    <div className="p-2 space-y-2">
                      {usersLoading ? (
                        <div className="text-center text-gray-500 py-4">Loading users...</div>
                      ) : filteredUsers.length === 0 ? (
                        <div className="text-center text-gray-500 py-4">
                          {searchTerm ? 'No users found matching your search' : 'No users available'}
                        </div>
                      ) : (
                        filteredUsers.map((user) => {
                          const isSelected = selectedUserId === user.id;
                          const displayName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 
                                             user.displayName || 
                                             user.email || 
                                             'Unknown User';
                          
                          return (
                            <div
                              key={user.id}
                              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-tsp-sky/15 border-tsp-sky text-tsp-teal'
                                  : 'bg-white border-gray-200 hover:bg-gray-50'
                              }`}
                              onClick={() => setSelectedUserId(user.id)}
                              data-testid={`user-option-${user.id}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <User className="w-4 h-4 text-gray-400" />
                                  <div>
                                    <div className="font-medium">{displayName}</div>
                                    {user.email && (
                                      <div className="text-sm text-gray-500">{user.email}</div>
                                    )}
                                    {user.role && (
                                      <div className="text-sm text-gray-500 capitalize">{user.role}</div>
                                    )}
                                  </div>
                                </div>
                                {isSelected && (
                                  <Check className="w-4 h-4 text-tsp-teal" />
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="custom" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="customContact" className="text-sm font-medium text-gray-700">
                    Custom TSP Contact Information
                  </Label>
                  <p className="text-sm text-gray-500 mb-2">
                    Enter contact information for someone not in the system (name, email, phone, etc.)
                  </p>
                  <Textarea
                    id="customContact"
                    placeholder="e.g., John Smith - john.smith@email.com - (555) 123-4567 - External coordinator"
                    value={customContactText}
                    onChange={(e) => setCustomContactText(e.target.value)}
                    className="min-h-[100px]"
                    data-testid="textarea-custom-contact"
                  />
                </div>
                
                {customContactText.trim() && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-700">Preview</Label>
                    <div className="p-3 bg-gray-50 border rounded-lg">
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">
                        {customContactText.trim()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave() || isSubmitting}
            data-testid="button-save-assignment"
          >
            {isSubmitting ? 'Saving...' : 
             (!selectedUserId && !customContactText.trim() && (currentTspContact || currentCustomTspContact)) ? 'Remove Assignment' :
             hasChanges() ? 'Save Assignment' : 'No Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};