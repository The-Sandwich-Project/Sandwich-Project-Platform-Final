import type React from 'react';
import { Mail, Phone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Recipient } from '@shared/schema';
import { getRecipientRegion } from './recipient-schedule-utils';

/**
 * The default Recipients view: a plain, read-only directory list.
 * Name, who to contact, and where they are. Everything else (schedules,
 * estimates, inline editing) lives in the "Detailed views" tab.
 *
 * Clicking a row opens the same detail drawer as the other views.
 */
interface RecipientDirectoryListProps {
  recipients: Recipient[];
  onRowClick: (recipient: Recipient) => void;
  highlightedId?: number;
  highlightRowRef?: React.RefObject<HTMLTableRowElement>;
}

function getContact(recipient: Recipient) {
  // Prefer the named contact person; fall back to the org's own phone/email.
  return {
    name: recipient.contactPersonName || recipient.contactName || '',
    role: recipient.contactPersonRole || '',
    phone: recipient.contactPersonPhone || recipient.phone || '',
    email: recipient.contactPersonEmail || recipient.email || '',
  };
}

/**
 * "404-555-1234 ext. 102" → "tel:4045551234,102": the comma makes the phone
 * pause and then dial the extension, instead of running the digits together.
 */
export function telHref(phone: string) {
  const [main, ext] = phone.split(/\s*(?:ext\.?|extension|x|#)\s*/i);
  const digits = main.replace(/[^\d+]/g, '');
  const extDigits = (ext || '').replace(/\D/g, '');
  return `tel:${digits}${extDigits ? `,${extDigits}` : ''}`;
}

export function RecipientDirectoryList({
  recipients,
  onRowClick,
  highlightedId,
  highlightRowRef,
}: RecipientDirectoryListProps) {
  // Links inside a row shouldn't also open the drawer.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead className="w-[30%]">Recipient</TableHead>
            <TableHead className="w-[35%]">Contact</TableHead>
            <TableHead>Address</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipients.map((recipient) => {
            const contact = getContact(recipient);
            const isHighlighted = recipient.id === highlightedId;
            const isInactive = recipient.status !== 'active';
            const region = getRecipientRegion(recipient);

            return (
              <TableRow
                key={recipient.id}
                ref={isHighlighted ? highlightRowRef : undefined}
                onClick={() => onRowClick(recipient)}
                className={`cursor-pointer align-top ${
                  isHighlighted ? 'bg-amber-50' : ''
                } ${isInactive ? 'text-slate-500' : ''}`}
                data-testid={`recipient-list-row-${recipient.id}`}
              >
                <TableCell className="py-3">
                  <div className="font-medium text-slate-900 break-words">
                    {recipient.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {region && region !== 'Not geocoded' && <span>{region}</span>}
                    {isInactive && (
                      <Badge variant="outline" className="text-[10px] py-0">
                        Inactive
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-3 text-sm">
                  {contact.name && (
                    <div className="text-slate-900">
                      {contact.name}
                      {contact.role && (
                        <span className="text-slate-500"> · {contact.role}</span>
                      )}
                    </div>
                  )}
                  {contact.phone && (
                    <a
                      href={telHref(contact.phone)}
                      onClick={stop}
                      className="mt-0.5 flex items-center gap-1.5 text-slate-700 hover:text-blue-700 hover:underline"
                    >
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      {contact.phone}
                    </a>
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      onClick={stop}
                      className="mt-0.5 flex items-center gap-1.5 text-slate-700 hover:text-blue-700 hover:underline break-all"
                    >
                      <Mail className="w-3.5 h-3.5 shrink-0" />
                      {contact.email}
                    </a>
                  )}
                  {!contact.name && !contact.phone && !contact.email && (
                    <span className="text-slate-400">No contact on file</span>
                  )}
                </TableCell>
                <TableCell className="py-3 text-sm text-slate-700 break-words">
                  {recipient.address || (
                    <span className="text-slate-400">No address on file</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
