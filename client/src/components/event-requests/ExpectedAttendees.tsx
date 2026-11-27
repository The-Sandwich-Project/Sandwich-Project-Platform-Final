/** "~40–60 expected" on cards, next to the sandwich estimate ('' when unknown). */
import * as React from 'react';
import { Users } from 'lucide-react';
import { formatAttendance } from '@shared/attendance-estimate';

export function expectedAttendeesLabel(event: {
  estimatedAttendance?: number | null;
  estimatedAttendanceMin?: number | null;
  estimatedAttendanceMax?: number | null;
} | null | undefined): string {
  const t = formatAttendance(event as any);
  return t ? `~${t} expected` : '';
}

export function ExpectedAttendeesInline({ event, className = '' }: { event: any; className?: string }) {
  const label = expectedAttendeesLabel(event);
  if (!label) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm text-gray-700 ${className}`}
      title="Expected attendees (rough estimate)"
      data-testid="expected-attendees"
    >
      <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
