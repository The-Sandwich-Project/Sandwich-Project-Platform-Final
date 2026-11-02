/**
 * Extract a human-readable name embedded in custom/legacy assignment IDs.
 * Shared by the client (display) and the server (sheet import/push).
 *
 * Supported formats:
 *   custom-1763183106406-Chef-Hank  → Chef Hank
 *   custom:Name                       → Name
 *   1783119755788 Morgan Stanley 1  → Morgan Stanley 1 (legacy timestamp + space)
 *   1783119755788-Morgan-Stanley-1   → Morgan Stanley 1 (legacy timestamp + dashes)
 */
export function extractNameFromAssignmentId(personId: string): string | null {
  if (!personId || typeof personId !== 'string') return null;

  if (personId.startsWith('custom:')) {
    const name = personId.replace('custom:', '').trim();
    return name || null;
  }

  if (personId.startsWith('custom-')) {
    const parts = personId.split('-');
    if (parts.length >= 3) {
      const name = parts.slice(2).join('-').replace(/-/g, ' ').trim();
      return name || null;
    }
    return null;
  }

  const timestampSpaceMatch = personId.match(/^(\d{10,})\s+(.+)$/);
  if (timestampSpaceMatch) {
    return timestampSpaceMatch[2].trim() || null;
  }

  const timestampDashMatch = personId.match(/^(\d{10,})-(.+)$/);
  if (timestampDashMatch) {
    return timestampDashMatch[2].replace(/-/g, ' ').trim() || null;
  }

  return null;
}
