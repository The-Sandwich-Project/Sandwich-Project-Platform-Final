import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ClipboardList, Edit2, Trash2, Save, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { EventPostEventNote } from '@shared/schema';

interface PostEventNotesProps {
  eventId: number;
}

export function PostEventNotes({ eventId }: PostEventNotesProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const queryKey = ['/api/event-requests', eventId, 'post-event-notes'];

  const { data: notes = [], isLoading } = useQuery<EventPostEventNote[]>({
    queryKey,
    queryFn: () => apiRequest('GET', `/api/event-requests/${eventId}/post-event-notes`),
    enabled: !!eventId,
  });

  const isSuperAdmin = user?.role === 'super_admin';

  const addMutation = useMutation({
    mutationFn: (content: string) =>
      apiRequest('POST', `/api/event-requests/${eventId}/post-event-notes`, { content }),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not save note',
        description: err?.message ?? 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ noteId, content }: { noteId: number; content: string }) =>
      apiRequest('PATCH', `/api/event-requests/${eventId}/post-event-notes/${noteId}`, { content }),
    onSuccess: () => {
      setEditingId(null);
      setEditDraft('');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not update note',
        description: err?.message ?? 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: number) =>
      apiRequest('DELETE', `/api/event-requests/${eventId}/post-event-notes/${noteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not delete note',
        description: err?.message ?? 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = () => {
    const content = draft.trim();
    if (!content) return;
    addMutation.mutate(content);
  };

  const handleEditSave = (noteId: number) => {
    const content = editDraft.trim();
    if (!content) return;
    editMutation.mutate({ noteId, content });
  };

  const handleDelete = (noteId: number) => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    deleteMutation.mutate(noteId);
  };

  const startEditing = (note: EventPostEventNote) => {
    setEditingId(note.id);
    setEditDraft(note.content);
  };

  const canModify = (note: EventPostEventNote) =>
    isSuperAdmin || String(note.userId) === String(user?.id);

  return (
    <div className="bg-white rounded-lg p-4 mb-4 border border-gray-200">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-4 h-4 text-tsp-teal" />
        <h3 className="text-sm font-semibold text-gray-800">Post-event Notes</h3>
        {notes.length > 0 && (
          <span className="text-xs text-gray-500">({notes.length})</span>
        )}
      </div>

      {/* Composer */}
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note about how the event went..."
          rows={3}
          className="resize-none"
          data-testid="textarea-post-event-note"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!draft.trim() || addMutation.isPending}
            className="bg-tsp-teal hover:bg-[#1d5470]"
            data-testid="button-add-post-event-note"
          >
            {addMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5 mr-1" />
            )}
            Save note
          </Button>
        </div>
      </div>

      {/* Existing notes */}
      {isLoading ? (
        <p className="text-xs text-gray-500 mt-4">Loading notes...</p>
      ) : notes.length > 0 ? (
        <ul className="mt-4 pt-3 border-t space-y-3" data-testid="list-post-event-notes">
          {notes.map((note) => {
            const isEditing = editingId === note.id;
            const showActions = canModify(note);
            const created = new Date(note.createdAt);
            const wasEdited = note.editedAt && new Date(note.editedAt).getTime() !== created.getTime();
            return (
              <li key={note.id} className="text-sm" data-testid={`post-event-note-${note.id}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs text-gray-500">
                    <span className="font-medium text-gray-700">{note.userName}</span>
                    <span className="mx-1.5">·</span>
                    <span>{format(created, 'MMM d, yyyy')} at {format(created, 'h:mm a').toLowerCase()}</span>
                    {wasEdited && <span className="ml-1.5 italic">(edited)</span>}
                  </div>
                  {showActions && !isEditing && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing(note)}
                        className="h-6 px-2 text-xs text-gray-500 hover:text-gray-800"
                        data-testid={`button-edit-note-${note.id}`}
                      >
                        <Edit2 className="w-3 h-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(note.id)}
                        disabled={deleteMutation.isPending}
                        className="h-6 px-2 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                        data-testid={`button-delete-note-${note.id}`}
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Delete
                      </Button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={3}
                      autoFocus
                      className="resize-none text-sm"
                      data-testid={`textarea-edit-note-${note.id}`}
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setEditingId(null); setEditDraft(''); }}
                        className="text-xs h-7"
                      >
                        <X className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleEditSave(note.id)}
                        disabled={!editDraft.trim() || editMutation.isPending}
                        className="text-xs h-7 bg-tsp-teal hover:bg-[#1d5470]"
                      >
                        {editMutation.isPending ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-3 h-3 mr-1" />
                        )}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-gray-700 whitespace-pre-wrap break-words">{note.content}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
