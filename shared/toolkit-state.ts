/** Toolkit status is authoritative when explicitly supplied; the boolean is a mirror. */
export interface ToolkitState {
  toolkitStatus?: string | null;
  toolkitSent?: boolean | null;
}

export function isToolkitSent(state: ToolkitState): boolean {
  if (state.toolkitStatus === 'sent' || state.toolkitStatus === 'received_confirmed') return true;
  if (state.toolkitStatus === 'not_sent' || state.toolkitStatus === 'not_needed') return false;
  return state.toolkitSent === true;
}

/**
 * Normalize only explicit toolkit edits, leaving unrelated patches untouched.
 * Older spreadsheet clients may send only the boolean. Preserve the more specific
 * status when that toggle agrees with it. Dates and attribution are historical
 * evidence: never invent or erase them as a side effect of synchronizing flags.
 */
export function normalizeToolkitPatch<T extends ToolkitState>(patch: T, previous: ToolkitState = {}): T & ToolkitState {
  const status = patch.toolkitStatus;
  if (['sent', 'received_confirmed', 'not_sent', 'not_needed'].includes(status ?? '')) {
    return { ...patch, toolkitSent: isToolkitSent(patch) };
  }
  if (typeof patch.toolkitSent === 'boolean') {
    const toolkitStatus = patch.toolkitSent
      ? (previous.toolkitStatus === 'received_confirmed' ? 'received_confirmed' : 'sent')
      : (previous.toolkitStatus === 'not_needed' ? 'not_needed' : 'not_sent');
    return { ...patch, toolkitStatus };
  }
  return { ...patch };
}
