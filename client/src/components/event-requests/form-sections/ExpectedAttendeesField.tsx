/**
 * Expected attendees: optional, a single number or a range ("40" or "40-60").
 * Rough is fine; it's expected to change as planning goes on.
 *
 * Writes estimatedAttendance (the number, or the middle of the range) and
 * estimatedAttendanceMin/Max (the range's ends, 0 for a single number) to form
 * state. Text it can't read sets attendanceError, which blocks saving.
 */
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatAttendance, parseAttendanceText } from '@shared/attendance-estimate';

interface ExpectedAttendeesFieldProps {
  formData: {
    estimatedAttendance?: number | null;
    estimatedAttendanceMin?: number | null;
    estimatedAttendanceMax?: number | null;
    attendanceError?: string;
  };
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}

export const ExpectedAttendeesField: React.FC<ExpectedAttendeesFieldProps> = ({ formData, setFormData }) => {
  const stored = formatAttendance(formData);
  const [text, setText] = React.useState(stored);

  // Follow outside changes without fighting the person mid-typing:
  //  - the stored value changed (a recovered draft, a reload) and the text
  //    no longer means it;
  //  - the form was reset (Discard) while the box held text it couldn't read:
  //    the reset clears attendanceError, which typing bad text always sets, so
  //    a cleared error with unreadable text means "show the stored value",
  //    even when the stored number itself didn't change.
  const hasFormError = !!formData.attendanceError;
  React.useEffect(() => {
    const r = parseAttendanceText(text);
    if (r.error ? !hasFormError : formatAttendance(r.fields) !== stored) setText(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, hasFormError]);

  const error = parseAttendanceText(text).error;

  const onChange = (value: string) => {
    setText(value);
    const r = parseAttendanceText(value);
    if (r.error) {
      setFormData((prev: any) => ({ ...prev, attendanceError: r.error }));
      return;
    }
    setFormData((prev: any) => ({
      ...prev,
      attendanceError: undefined,
      estimatedAttendance: r.fields.estimatedAttendance ?? 0,
      estimatedAttendanceMin: r.fields.estimatedAttendanceMin ?? 0,
      estimatedAttendanceMax: r.fields.estimatedAttendanceMax ?? 0,
    }));
  };

  return (
    <div className="space-y-1" data-testid="expected-attendees-field">
      <Label htmlFor="expectedAttendees">Expected attendees (optional)</Label>
      <Input
        id="expectedAttendees"
        inputMode="text"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 40 or 40-60"
        className="w-44"
        aria-invalid={!!error}
        data-testid="input-expected-attendees"
      />
      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : (
        <p className="text-xs text-gray-600">
          A number or a range. Rough estimate is fine; it's expected to change as planning goes on.
        </p>
      )}
    </div>
  );
};
