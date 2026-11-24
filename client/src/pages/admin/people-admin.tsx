/**
 * People admin page (people/places rebuild, step 6). Super admins and admins.
 *
 * Everyone in `people` with a checkbox per role, an active switch, each
 * person's full record, and the "needs a decision" list the backfill left.
 * Rules (docs/data-model.md): unticking a role never deletes anything;
 * people are deactivated, not deleted; a changed name is kept as an alias.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, GitMerge, Loader2, Plus, Search, UserCog } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest, queryClient } from '@/lib/queryClient';

const API = '/api/people-admin';
const ALLOWED_ROLES = ['super_admin', 'admin'];

type RoleKey = 'isVolunteer' | 'isDriver' | 'isVanDriver' | 'isHost' | 'isTeamMember' | 'isBoardMember' | 'isAdvisoryBoardMember' | 'isIntakeTeam';
const ROLES: { key: RoleKey; label: string }[] = [
  { key: 'isVolunteer', label: 'Volunteer' },
  { key: 'isDriver', label: 'Driver' },
  { key: 'isVanDriver', label: 'Van driver' },
  { key: 'isHost', label: 'Host' },
  { key: 'isTeamMember', label: 'Team member' },
  { key: 'isIntakeTeam', label: 'Intake team' },
  { key: 'isBoardMember', label: 'Board' },
  { key: 'isAdvisoryBoardMember', label: 'Advisory board' },
];

interface PersonRow {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isVolunteer: boolean;
  isDriver: boolean;
  isVanDriver: boolean;
  isHost: boolean;
  isTeamMember: boolean;
  isBoardMember: boolean;
  isAdvisoryBoardMember: boolean;
  isIntakeTeam: boolean;
  isActive: boolean;
  chapterRegionId: number | null;
  openFlags: number;
  hasLogin: boolean;
}

interface Flag {
  id: number;
  kind: string;
  detail: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

interface PersonDetail {
  person: PersonRow & {
    address: string | null;
    notes: string | null;
    nameSource: string;
  };
  aliases: { id: number; alias: string; source: string }[];
  legacy: { id: number; sourceTable: string; sourceKey: string }[];
  logins: { id: string; role: string; isActive: boolean | null }[];
  flags: Flag[];
}

const KIND_LABELS: Record<string, string> = {
  contact_conflict: 'Contact details disagree',
  shared_contact: 'Shares an email or phone',
  multiple_people: 'May be two people',
  abbreviated_name: 'Name incomplete',
  possible_duplicate: 'Possible duplicate',
  not_on_sheet: 'No longer on the volunteer sheet',
  new_from_sheet: 'New from the volunteer sheet',
};

const NAME_SOURCE_LABELS: Record<string, string> = {
  self_verified: 'confirmed by the person',
  self_reported: 'from their own survey',
  admin_entered: 'typed in by an admin',
  sheet: 'from a sheet',
  legacy_import: 'from old records',
};

const SOURCE_TABLE_LABELS: Record<string, string> = {
  users: 'Login',
  volunteers: 'Volunteers',
  drivers: 'Drivers',
  host_contacts: 'Hosts',
  contacts: 'Contacts',
};

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

function invalidate(id?: number) {
  queryClient.invalidateQueries({ queryKey: [API] });
  if (id) queryClient.invalidateQueries({ queryKey: [`${API}/${id}`] });
}

export default function PeopleAdmin() {
  const { user } = useAuth() as { user?: { role?: string } };
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | RoleKey | 'none'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [needsDecisionOnly, setNeedsDecisionOnly] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const allowed = !!user?.role && ALLOWED_ROLES.includes(user.role);
  const { data, isLoading, error } = useQuery<{ people: PersonRow[]; chapters: { id: number; name: string }[] }>({
    queryKey: [API],
    enabled: allowed,
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiRequest('PATCH', `${API}/${id}`, body),
    onSuccess: (_res, { id }) => invalidate(id),
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: 'destructive' }),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.people ?? []).filter((p) => {
      if (statusFilter === 'active' && !p.isActive) return false;
      if (statusFilter === 'inactive' && p.isActive) return false;
      if (needsDecisionOnly && p.openFlags === 0) return false;
      if (roleFilter === 'none' && ROLES.some((r) => p[r.key])) return false;
      if (roleFilter !== 'all' && roleFilter !== 'none' && !p[roleFilter]) return false;
      if (!term) return true;
      return [fullName(p), p.email ?? '', p.phone ?? ''].some((v) => v.toLowerCase().includes(term));
    });
  }, [data, search, roleFilter, statusFilter, needsDecisionOnly]);

  if (!allowed) {
    return (
      <div className="p-6 text-slate-600">The People page is only available to admins.</div>
    );
  }

  const openDecisions = (data?.people ?? []).reduce((n, p) => n + p.openFlags, 0);
  const peopleWithDecisions = (data?.people ?? []).filter((p) => p.openFlags > 0).length;

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" /> People
            </CardTitle>
            <CardDescription>
              Everyone TSP knows, one record per person. Tick a box to give someone a role; unticking it
              keeps all their details, so ticking it again restores everything.
            </CardDescription>
          </div>
          <Button onClick={() => setAdding(true)} className="shrink-0" disabled={(data?.people.length ?? 0) === 0}>
            <Plus className="mr-1 h-4 w-4" /> Add person
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {openDecisions > 0 && (
            <button
              type="button"
              onClick={() => setNeedsDecisionOnly((v) => !v)}
              className="flex w-full items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{openDecisions}</strong> question{openDecisions === 1 ? '' : 's'} about{' '}
                <strong>{peopleWithDecisions}</strong> {peopleWithDecisions === 1 ? 'person needs' : 'people need'} a
                decision.{' '}
                <span className="underline">{needsDecisionOnly ? 'Show everyone' : 'Show only them'}</span>
              </span>
            </button>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Search name, email or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
              <SelectTrigger className="sm:w-44" aria-label="Filter by role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}s
                  </SelectItem>
                ))}
                <SelectItem value="none">No role</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="sm:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">Everyone</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-slate-500">
              {filtered.length} of {data?.people.length ?? 0}
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading people…
            </div>
          ) : error ? (
            <div className="p-6 text-red-700">Couldn't load people: {(error as Error).message}</div>
          ) : (data?.people.length ?? 0) === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-slate-600">
              No people yet. They appear here once the people backfill has been run.
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-md border">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">Contact</th>
                    {ROLES.map((r) => (
                      <th key={r.key} className="p-2 text-center">
                        {r.label}
                      </th>
                    ))}
                    <th className="p-2 text-center">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className={`border-t ${p.isActive ? '' : 'bg-slate-50 text-slate-500'}`}>
                      <td className="p-2">
                        <button
                          type="button"
                          className="text-left font-medium text-teal-800 hover:underline"
                          onClick={() => setOpenId(p.id)}
                        >
                          {p.lastName ? `${p.lastName}, ${p.firstName}` : p.firstName}
                        </button>
                        {p.openFlags > 0 && (
                          <Badge variant="outline" className="ml-2 border-amber-400 text-amber-800">
                            {p.openFlags} to decide
                          </Badge>
                        )}
                      </td>
                      <td className="p-2 text-slate-600">
                        <div className="break-all">{p.email ?? '—'}</div>
                        <div>{p.phone ?? ''}</div>
                      </td>
                      {ROLES.map((r) => (
                        <td key={r.key} className="p-2 text-center">
                          <Checkbox
                            aria-label={`${r.label}: ${fullName(p)}`}
                            checked={p[r.key]}
                            disabled={patch.isPending}
                            onCheckedChange={(v) => patch.mutate({ id: p.id, body: { [r.key]: v === true } })}
                          />
                        </td>
                      ))}
                      <td className="p-2 text-center">
                        <Switch
                          aria-label={`Active: ${fullName(p)}`}
                          checked={p.isActive}
                          disabled={patch.isPending}
                          onCheckedChange={(v) => patch.mutate({ id: p.id, body: { isActive: v } })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PersonPanel
        id={openId}
        chapters={data?.chapters ?? []}
        onClose={() => setOpenId(null)}
        onOpen={(id) => setOpenId(id)}
      />
      <AddPersonDialog open={adding} onClose={() => setAdding(false)} onCreated={(id) => setOpenId(id)} />
    </div>
  );
}

function PersonPanel({
  id,
  chapters,
  onClose,
  onOpen,
}: {
  id: number | null;
  chapters: { id: number; name: string }[];
  onClose: () => void;
  onOpen: (id: number) => void;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<PersonDetail>({
    queryKey: [`${API}/${id}`],
    enabled: id != null,
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [resolving, setResolving] = useState<Flag | null>(null);

  const p = data?.person;
  const value = (k: string) => form[k] ?? ((p as any)?.[k] ?? '');

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const k of ['firstName', 'lastName', 'email', 'phone', 'address', 'notes']) {
        if (form[k] !== undefined) body[k] = form[k];
      }
      if (form.chapterRegionId !== undefined) {
        body.chapterRegionId = form.chapterRegionId === 'none' ? null : Number(form.chapterRegionId);
      }
      if (nameConfirmed) body.nameConfirmed = true;
      return apiRequest('PATCH', `${API}/${id}`, body);
    },
    onSuccess: () => {
      invalidate(id ?? undefined);
      setForm({});
      setNameConfirmed(false);
      toast({ title: 'Saved' });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: 'destructive' }),
  });

  const dirty = Object.keys(form).length > 0 || nameConfirmed;
  const openFlags = (data?.flags ?? []).filter((f) => !f.resolvedAt);
  const closedFlags = (data?.flags ?? []).filter((f) => f.resolvedAt);

  return (
    <Sheet
      open={id != null}
      onOpenChange={(o) => {
        if (!o) {
          setForm({});
          setNameConfirmed(false);
          onClose();
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {isLoading || !p ? (
          <div className="flex items-center gap-2 p-6 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle>{fullName(p)}</SheetTitle>
              <SheetDescription>
                Name {NAME_SOURCE_LABELS[p.nameSource] ?? p.nameSource}
                {p.isActive ? '' : ' · inactive'}
              </SheetDescription>
            </SheetHeader>

            {openFlags.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-amber-900">Needs a decision</h3>
                {openFlags.map((f) => (
                  <div key={f.id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                    <div className="font-medium">{KIND_LABELS[f.kind] ?? f.kind}</div>
                    <div className="mt-1 text-slate-700">{f.detail}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(f.kind === 'possible_duplicate' || f.kind === 'shared_contact') && (
                        <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
                          <GitMerge className="mr-1 h-3.5 w-3.5" /> Same person: merge
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setResolving(f)}>
                        {f.kind === 'possible_duplicate' || f.kind === 'shared_contact'
                          ? 'Different people'
                          : 'Done / mark resolved'}
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="pa-first">First name</Label>
                  <Input id="pa-first" value={value('firstName')} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="pa-last">Last name</Label>
                  <Input id="pa-last" value={value('lastName')} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={nameConfirmed} onCheckedChange={(v) => setNameConfirmed(v === true)} />
                This person confirmed this spelling
              </label>
              <div>
                <Label htmlFor="pa-email">Email</Label>
                <Input id="pa-email" type="email" value={value('email')} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="pa-phone">Phone</Label>
                <Input id="pa-phone" value={value('phone')} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="pa-address">Address</Label>
                <Input id="pa-address" value={value('address')} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              {chapters.length > 0 && (
                <div>
                  <Label>Chapter</Label>
                  <Select
                    value={form.chapterRegionId ?? (p.chapterRegionId ? String(p.chapterRegionId) : 'none')}
                    onValueChange={(v) => setForm({ ...form, chapterRegionId: v })}
                  >
                    <SelectTrigger aria-label="Chapter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No chapter</SelectItem>
                      {chapters.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="pa-notes">Notes</Label>
                <Textarea id="pa-notes" rows={3} value={value('notes')} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </section>

            <section className="space-y-1 text-sm">
              <h3 className="font-semibold">Other spellings</h3>
              {data!.aliases.length === 0 ? (
                <p className="text-slate-500">None</p>
              ) : (
                <ul className="list-disc pl-5 text-slate-700">
                  {data!.aliases.map((a) => (
                    <li key={a.id}>{a.alias}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-1 text-sm">
              <h3 className="font-semibold">Came from</h3>
              <ul className="list-disc pl-5 text-slate-700">
                {data!.legacy.map((l) => (
                  <li key={l.id}>
                    {SOURCE_TABLE_LABELS[l.sourceTable] ?? l.sourceTable} #{l.sourceKey}
                  </li>
                ))}
                {data!.legacy.length === 0 && <li className="list-none text-slate-500">Added on this page</li>}
              </ul>
              <p className="text-slate-500">
                {data!.logins.length === 0
                  ? 'No app login.'
                  : `${data!.logins.length} app login${data!.logins.length === 1 ? '' : 's'} (${data!.logins
                      .map((l) => l.role)
                      .join(', ')}).`}
              </p>
            </section>

            {closedFlags.length > 0 && (
              <section className="space-y-1 text-sm">
                <h3 className="font-semibold">Decided</h3>
                <ul className="space-y-1 text-slate-600">
                  {closedFlags.map((f) => (
                    <li key={f.id}>
                      {KIND_LABELS[f.kind] ?? f.kind}: {f.resolution}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Button variant="outline" onClick={() => setMergeOpen(true)}>
              <GitMerge className="mr-1 h-4 w-4" /> Merge with another person…
            </Button>
          </div>
        )}
      </SheetContent>

      {p && (
        <MergeDialog
          open={mergeOpen}
          keep={p}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            setMergeOpen(false);
            onOpen(p.id);
          }}
        />
      )}
      <ResolveDialog flag={resolving} personId={id} onClose={() => setResolving(null)} />
    </Sheet>
  );
}

function ResolveDialog({ flag, personId, onClose }: { flag: Flag | null; personId: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const different = flag?.kind === 'possible_duplicate' || flag?.kind === 'shared_contact';
  const [note, setNote] = useState('');
  const resolve = useMutation({
    mutationFn: () =>
      apiRequest('POST', `${API}/flags/${flag!.id}/resolve`, {
        resolution: note.trim() || (different ? 'Different people' : 'Resolved'),
      }),
    onSuccess: () => {
      invalidate(personId ?? undefined);
      setNote('');
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: 'destructive' }),
  });
  return (
    <Dialog open={!!flag} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{different ? 'Mark as different people' : 'Mark as resolved'}</DialogTitle>
          <DialogDescription>{flag?.detail}</DialogDescription>
        </DialogHeader>
        {!different && (
          <p className="text-sm text-slate-600">
            Fix the details on the person's record first (for example, the right phone number), then mark this resolved.
          </p>
        )}
        <div>
          <Label htmlFor="pa-note">Note (optional)</Label>
          <Textarea id="pa-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={resolve.isPending} onClick={() => resolve.mutate()}>
            {resolve.isPending ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog({
  open,
  keep,
  onClose,
  onMerged,
}: {
  open: boolean;
  keep: PersonRow;
  onClose: () => void;
  onMerged: () => void;
}) {
  const { toast } = useToast();
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<{ id: number; firstName: string; lastName: string; email: string | null } | null>(null);
  const { data: results = [] } = useQuery<{ id: number; firstName: string; lastName: string; email: string | null }[]>({
    queryKey: [`${API}/search?q=${encodeURIComponent(term)}&except=${keep.id}`],
    enabled: open && term.trim().length >= 2,
  });
  const merge = useMutation({
    mutationFn: () => apiRequest('POST', `${API}/merge`, { keepId: keep.id, dropId: chosen!.id }),
    onSuccess: () => {
      invalidate(keep.id);
      toast({ title: 'Merged', description: `${fullName(chosen!)} is now part of ${fullName(keep)}.` });
      setTerm('');
      setChosen(null);
      onMerged();
    },
    onError: (e: Error) => toast({ title: "Couldn't merge", description: e.message, variant: 'destructive' }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setChosen(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge into {fullName(keep)}</DialogTitle>
          <DialogDescription>
            The other person's roles, old records, logins and open questions move to {fullName(keep)}, and their record
            is removed. The better-confirmed name is kept and the other becomes another spelling. {fullName(keep)}'s
            contact details and address stay; blanks are filled from the other record. Any "same person?" questions
            between the two are marked resolved.
          </DialogDescription>
        </DialogHeader>
        {!chosen ? (
          <div className="space-y-2">
            <Input autoFocus placeholder="Search for the other person" value={term} onChange={(e) => setTerm(e.target.value)} />
            <ul className="max-h-60 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                    onClick={() => setChosen(r)}
                  >
                    {fullName(r)} <span className="text-slate-500">{r.email ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm">
            Merge <strong>{fullName(chosen)}</strong> into <strong>{fullName(keep)}</strong>? This can't be undone from
            this page.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => (chosen ? setChosen(null) : onClose())}>
            {chosen ? 'Back' : 'Cancel'}
          </Button>
          <Button disabled={!chosen || merge.isPending} onClick={() => merge.mutate()}>
            {merge.isPending ? 'Merging…' : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPersonDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const create = useMutation({
    mutationFn: () => apiRequest('POST', API, form),
    onSuccess: (created: { id: number }) => {
      invalidate();
      setForm({ firstName: '', lastName: '', email: '', phone: '' });
      onClose();
      onCreated(created.id);
    },
    onError: (e: Error) => toast({ title: "Couldn't add", description: e.message, variant: 'destructive' }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>
            For example, when one old record held two people ("Stacey &amp; Jack"): add the second person here, then fix
            the first one's name.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pa-new-first">First name</Label>
            <Input id="pa-new-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="pa-new-last">Last name</Label>
            <Input id="pa-new-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="pa-new-email">Email</Label>
            <Input id="pa-new-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="pa-new-phone">Phone</Label>
            <Input id="pa-new-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.firstName.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Adding…' : 'Add person'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
