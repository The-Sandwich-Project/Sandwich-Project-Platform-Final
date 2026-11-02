/**
 * Notes Section
 *
 * Handles initial request message, next action, scheduling notes, and planning notes.
 * Includes collaboration field locking support.
 *
 * For website/Google Form submissions, the initial message is click-to-edit
 * (protects the original form text). For manually added events, all notes
 * fields — including the initial message — are freely editable like the rest
 * of the form.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FileText, CheckCircle2 } from 'lucide-react';
import { FieldLockIndicator } from '@/components/collaboration';
import type { EventFormData } from './types';

interface NotesSectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  isComplete: boolean;
  isMessageEditable: boolean;
  setIsMessageEditable: (editable: boolean) => void;
  /** When true, message is a normal editable field (manual create/edit). */
  alwaysEditableMessage?: boolean;
  // Collaboration
  isCollaborationEnabled: boolean;
  isFieldLockedByOther: (fieldName: string) => boolean;
  getFieldLock: (fieldName: string) => any;
  handleFieldFocus: (fieldName: string) => void;
  handleFieldBlur: (fieldName: string) => void;
}

export const NotesSection: React.FC<NotesSectionProps> = ({
  formData,
  setFormData,
  isComplete,
  isMessageEditable,
  setIsMessageEditable,
  alwaysEditableMessage = false,
  isCollaborationEnabled,
  isFieldLockedByOther,
  getFieldLock,
  handleFieldFocus,
  handleFieldBlur,
}) => {
  const [messageBeforeEdit, setMessageBeforeEdit] = React.useState(formData.message || '');

  const showMessageEditor = alwaysEditableMessage || isMessageEditable;

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-white">
      <div className="flex items-center gap-3 pb-2 border-b">
        <FileText className="w-5 h-5 text-tsp-teal" />
        <span className="text-lg font-semibold text-tsp-teal">Notes & Requirements</span>
        {isComplete && <CheckCircle2 className="w-4 h-4 text-tsp-teal" />}
      </div>
      <div>
        {/* Initial Request Message */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <Label htmlFor="message">Initial Request Message</Label>
            {!alwaysEditableMessage && !isMessageEditable && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setMessageBeforeEdit(formData.message || ''); setIsMessageEditable(true); }}
                className="text-xs text-gray-500 hover:text-gray-700"
                data-testid="button-edit-message"
              >
                {formData.message ? 'Edit' : 'Add'}
              </Button>
            )}
          </div>
          {showMessageEditor ? (
            alwaysEditableMessage ? (
              <Textarea
                id="message"
                value={formData.message}
                onChange={(e) => {
                  const value = e.target.value;
                  setFormData((prev: any) => ({ ...prev, message: value }));
                }}
                placeholder="Notes from the organizer or how this request came in"
                className="min-h-[80px]"
                data-testid="textarea-message"
              />
            ) : (
              <div className="space-y-2">
                <Textarea
                  id="message"
                  value={formData.message}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData((prev: any) => ({ ...prev, message: value }));
                  }}
                  placeholder="Original request message from the organizer"
                  className="min-h-[80px]"
                  data-testid="textarea-message"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setIsMessageEditable(false)}
                    className="bg-tsp-sky hover:bg-tsp-sky/80 text-white"
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsMessageEditable(false);
                      setFormData((prev: any) => ({ ...prev, message: messageBeforeEdit }));
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="bg-brand-primary-lighter p-3 rounded border-l-4 border-brand-primary-border text-sm text-gray-700">
              {formData.message || 'No initial message recorded'}
            </div>
          )}
        </div>

        {/* Next Action */}
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Label htmlFor="nextAction" className="text-amber-800 font-semibold">Next Action</Label>
            {isCollaborationEnabled && isFieldLockedByOther('nextAction') && (
              <FieldLockIndicator
                lockedBy={getFieldLock('nextAction')?.lockedByName || 'Another user'}
                expiresAt={getFieldLock('nextAction')?.expiresAt}
                data-testid="field-lock-next-action"
              />
            )}
          </div>
          <p className="text-sm text-amber-700 mb-2">What needs to happen next for this event? (e.g., "Waiting for callback", "Need to confirm date", "Follow up on van availability")</p>
          <Input
            id="nextAction"
            value={formData.nextAction}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, nextAction: e.target.value }))}
            onFocus={() => handleFieldFocus('nextAction')}
            onBlur={() => handleFieldBlur('nextAction')}
            placeholder="Enter the next action needed..."
            className="bg-white border-amber-300 focus:border-amber-500"
            disabled={isCollaborationEnabled && isFieldLockedByOther('nextAction')}
            data-testid="input-next-action"
          />
        </div>

        {/* Scheduling Notes */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Label htmlFor="schedulingNotes">Scheduling Notes</Label>
            {isCollaborationEnabled && isFieldLockedByOther('schedulingNotes') && (
              <FieldLockIndicator
                lockedBy={getFieldLock('schedulingNotes')?.lockedByName || 'Another user'}
                expiresAt={getFieldLock('schedulingNotes')?.expiresAt}
                data-testid="field-lock-scheduling-notes"
              />
            )}
          </div>
          <p className="text-sm text-gray-500 mb-2">Notes added while the event is being processed</p>
          <Textarea
            id="schedulingNotes"
            value={formData.schedulingNotes}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, schedulingNotes: e.target.value }))}
            onFocus={() => handleFieldFocus('schedulingNotes')}
            onBlur={() => handleFieldBlur('schedulingNotes')}
            placeholder="Add notes about scheduling, coordination, or processing status"
            className="min-h-[80px]"
            disabled={isCollaborationEnabled && isFieldLockedByOther('schedulingNotes')}
            data-testid="textarea-scheduling-notes"
          />
        </div>

        {/* Planning Notes */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Label htmlFor="planningNotes">Planning Notes</Label>
            {isCollaborationEnabled && isFieldLockedByOther('planningNotes') && (
              <FieldLockIndicator
                lockedBy={getFieldLock('planningNotes')?.lockedByName || 'Another user'}
                expiresAt={getFieldLock('planningNotes')?.expiresAt}
                data-testid="field-lock-planning-notes"
              />
            )}
          </div>
          <p className="text-sm text-gray-500 mb-2">Notes for when the event is scheduled or being planned</p>
          <Textarea
            id="planningNotes"
            value={formData.planningNotes}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, planningNotes: e.target.value }))}
            onFocus={() => handleFieldFocus('planningNotes')}
            onBlur={() => handleFieldBlur('planningNotes')}
            placeholder="Add planning notes, logistics, or post-scheduling information"
            className="min-h-[80px]"
            disabled={isCollaborationEnabled && isFieldLockedByOther('planningNotes')}
            data-testid="textarea-planning-notes"
          />
        </div>
      </div>
    </div>
  );
};
