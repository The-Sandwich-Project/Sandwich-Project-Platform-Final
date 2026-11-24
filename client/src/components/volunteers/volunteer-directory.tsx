/**
 * Volunteers directory from the new people list (people/places rebuild,
 * step 7c-1). Read-only: status, email list, location and sheet notes come
 * from the volunteer sheet; contact details are edited on the People page.
 * The old volunteer list stays one click away while the rest of the app
 * (event assignment, driver planning, route map) still uses it.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, Loader2, Search, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

const OldVolunteerList = lazy(() => import('@/components/volunteer-management'));

type Availability = 'active' | 'temporarily_unavailable' | 'inactive';

interface DirectoryVolunteer {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isVolunteer: boolean;
  isDriver: boolean;
  isHost: boolean;
  availabilityStatus: Availability | null;
  onRecruitmentList: boolean | null;
  getsRecruitmentEmails: boolean;
  location: string | null;
  experienceLevel: string | null;
  trainingCompleted: boolean | null;
  onSheet: boolean;
  sheetNotes: string | null;
  notes: string | null;
}

const STATUS_LABELS: Record<Availability, string> = {
  active: 'Active',
  temporarily_unavailable: 'Temporarily unavailable',
  inactive: 'Inactive',
};

const STATUS_STYLES: Record<Availability, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  temporarily_unavailable: 'bg-amber-100 text-amber-900',
  inactive: 'bg-slate-200 text-slate-700',
};

const formatPhone = (v: string | null) =>
  v && /^\d{10}$/.test(v) ? `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}` : v ?? '';

/**
 * Someone whose volunteer role is off (on the People page, or Inactive on the
 * sheet) is inactive; a volunteer with no sheet details yet counts as active.
 */
const statusOf = (v: DirectoryVolunteer): Availability =>
  !v.isVolunteer ? 'inactive' : v.availabilityStatus ?? 'active';

export default function VolunteerDirectory() {
  const [showOld, setShowOld] = useState(false);
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | Availability>('active');
  const [emailsOnly, setEmailsOnly] = useState(false);

  const { data = [], isLoading, error } = useQuery<DirectoryVolunteer[]>({
    queryKey: ['/api/volunteer-directory'],
    enabled: !showOld,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.filter((v) => {
      if (status !== 'all' && statusOf(v) !== status) return false;
      if (emailsOnly && !v.getsRecruitmentEmails) return false;
      if (!term) return true;
      return [`${v.firstName} ${v.lastName}`, v.email ?? '', v.phone ?? '', v.location ?? ''].some((s) =>
        s.toLowerCase().includes(term)
      );
    });
  }, [data, search, status, emailsOnly]);

  const counts = useMemo(() => {
    const c = { active: 0, temporarily_unavailable: 0, inactive: 0, emails: 0 };
    data.forEach((v) => {
      c[statusOf(v)]++;
      if (v.getsRecruitmentEmails) c.emails++;
    });
    return c;
  }, [data]);

  if (showOld) {
    return (
      <div className="space-y-3 p-3 sm:p-6">
        <Button variant="outline" onClick={() => setShowOld(false)}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to the new Volunteers directory
        </Button>
        <Suspense fallback={<div className="p-6 text-slate-500">Loading…</div>}>
          <OldVolunteerList />
        </Suspense>
      </div>
    );
  }

  const copyEmails = async () => {
    const emails = [...new Set(filtered.map((v) => v.email).filter((e): e is string => !!e))];
    try {
      await navigator.clipboard.writeText(emails.join(', '));
      toast({ title: `Copied ${emails.length} email address${emails.length === 1 ? '' : 'es'}` });
    } catch {
      toast({ title: "Couldn't copy", description: 'Your browser blocked the clipboard.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Volunteers
            </CardTitle>
            <CardDescription>
              Kept up to date from the volunteer sheet. To change someone's status or email list, edit the sheet;
              the app picks it up each morning (or with "Sync now" on the People page).
            </CardDescription>
          </div>
          <Button variant="outline" className="shrink-0" onClick={() => setShowOld(true)}>
            Old volunteer list
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">{counts.active} active</Badge>
            <Badge variant="outline">{counts.temporarily_unavailable} temporarily unavailable</Badge>
            <Badge variant="outline">{counts.inactive} inactive</Badge>
            <Badge variant="outline">{counts.emails} get recruitment emails</Badge>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Search name, email, phone or location"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="sm:w-56" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="temporarily_unavailable">Temporarily unavailable</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">Everyone</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={emailsOnly} onCheckedChange={(v) => setEmailsOnly(v === true)} />
              Only people who get recruitment emails
            </label>
            <span className="text-sm text-slate-500">
              {filtered.length} of {data.length}
            </span>
            <Button size="sm" variant="outline" className="sm:ml-auto" disabled={filtered.length === 0} onClick={copyEmails}>
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy these emails
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading volunteers…
            </div>
          ) : error ? (
            <div className="p-6 text-red-700">Couldn't load volunteers: {(error as Error).message}</div>
          ) : data.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-slate-600">
              No volunteers yet. They appear once the volunteer sheet has been synced (People page, "Sync now").
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-md border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">Contact</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Recruitment emails</th>
                    <th className="p-2">Location</th>
                    <th className="p-2">Experience</th>
                    <th className="p-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => {
                    const s = statusOf(v);
                    return (
                      <tr key={v.id} className="border-t align-top">
                        <td className="p-2">
                          <div className="font-medium">
                            {v.lastName ? `${v.lastName}, ${v.firstName}` : v.firstName}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {v.isDriver && <Badge variant="secondary">Driver</Badge>}
                            {v.isHost && <Badge variant="secondary">Host</Badge>}
                            {!v.onSheet && v.availabilityStatus && (
                              <Badge variant="outline" className="text-amber-800">
                                Not on the sheet
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="break-all">{v.email ?? '—'}</div>
                          <div>{formatPhone(v.phone) || '—'}</div>
                        </td>
                        <td className="p-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s]}`}>
                            {STATUS_LABELS[s]}
                          </span>
                        </td>
                        <td className="p-2">
                          {v.getsRecruitmentEmails
                            ? 'Yes'
                            : v.onRecruitmentList === false
                              ? 'No (ask one-to-one)'
                              : v.onRecruitmentList
                                ? 'Paused (not active)'
                                : '—'}
                        </td>
                        <td className="p-2">{v.location ?? '—'}</td>
                        <td className="p-2">
                          {v.experienceLevel === 'experienced' ? 'Experienced' : v.experienceLevel ? 'New' : '—'}
                          {v.trainingCompleted ? ' · trained' : ''}
                        </td>
                        <td className="max-w-xs p-2 whitespace-pre-wrap text-slate-600">
                          {[v.sheetNotes, v.notes].filter(Boolean).join('\n') || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
