import {
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import TSPContactManager from '../tsp-contact-manager';
import { getRecipientDisplayRegion } from '@/lib/atlanta-regions';
import type { Recipient } from '@shared/schema';
import {
  getCollectionSchedules,
  getFeedingSchedules,
  getFocusAreas,
  getEstimatedSandwichesRange,
  getContractStatus,
  getCadenceMeta,
  getPlannedSandwichBreakdown,
  sumBreakdownRange,
  formatRange,
} from './recipient-schedule-utils';
import { ScheduleDayChips } from './ScheduleDayChips';

interface RecipientDetailDrawerProps {
  recipient: Recipient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  onEdit: (recipient: Recipient) => void;
  onDelete: (id: number) => void;
  onToggleStatus: (recipient: Recipient) => void;
}

function formatScheduleEntry(entry: { day: string; time: string; notes?: string }) {
  const parts = [entry.day, entry.time].filter(Boolean);
  const main = parts.length > 0 ? parts.join(' at ') : 'Not specified';
  return entry.notes ? `${main} (${entry.notes})` : main;
}

export function RecipientDetailDrawer({
  recipient,
  open,
  onOpenChange,
  canEdit,
  onEdit,
  onDelete,
  onToggleStatus,
}: RecipientDetailDrawerProps) {
  if (!recipient) return null;

  const focusAreas = getFocusAreas(recipient);
  const collectionSchedules = getCollectionSchedules(recipient);
  const feedingSchedules = getFeedingSchedules(recipient);
  const contractStatus = getContractStatus(recipient);
  const displayRegion = getRecipientDisplayRegion(recipient);
  const website = (recipient as Recipient & { website?: string }).website;
  const instagramHandle = (recipient as Recipient & { instagramHandle?: string }).instagramHandle;
  const ein = (recipient as Recipient & { ein?: string }).ein;

  const mapUrl = recipient.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(recipient.address)}`
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-gradient-to-r from-[#236383] to-[#236383] text-white px-6 py-5 pr-14">
          <SheetHeader className="text-left space-y-1">
            <SheetTitle className="text-xl text-white">{recipient.name}</SheetTitle>
            <SheetDescription className="text-white/80 flex flex-wrap items-center gap-2">
              <Badge
                variant={recipient.status === 'active' ? 'default' : 'secondary'}
                className="text-xs"
              >
                {recipient.status}
              </Badge>
              {focusAreas.map((area) => (
                <Badge
                  key={area}
                  variant="outline"
                  className="text-xs border-white/40 text-white bg-white/10"
                >
                  {area}
                </Badge>
              ))}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button
              size="sm"
              disabled={!canEdit}
              onClick={() => onEdit(recipient)}
              className="bg-[#FBAD3F] text-[#1A2332] hover:bg-[#e89a2c]"
            >
              <Edit className="w-4 h-4 mr-1" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit}
              onClick={() => onToggleStatus(recipient)}
              className="border-white/40 text-white hover:bg-white/10"
            >
              {recipient.status === 'active' ? (
                <ToggleRight className="w-4 h-4 mr-1" />
              ) : (
                <ToggleLeft className="w-4 h-4 mr-1" />
              )}
              {recipient.status === 'active' ? 'Mark Inactive' : 'Mark Active'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit}
              onClick={() => onDelete(recipient.id)}
              className="border-red-300/50 text-red-100 hover:bg-red-500/20"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Schedules — prominent */}
          <section className="rounded-lg border border-[#236383]/20 bg-[#E0F2F1]/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[#236383]">Schedules</h3>
            <div>
              <p className="text-xs font-medium text-[#236383] mb-1.5">Collection days</p>
              <ScheduleDayChips schedules={collectionSchedules} variant="collection" />
              {collectionSchedules.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {collectionSchedules.map((s, i) => (
                    <li key={i} className="text-xs text-slate-600">
                      {formatScheduleEntry(s)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-[#B8860B] mb-1.5">Feeding days</p>
              <ScheduleDayChips schedules={feedingSchedules} variant="feeding" />
              {feedingSchedules.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {feedingSchedules.map((s, i) => (
                    <li key={i} className="text-xs text-slate-600">
                      {formatScheduleEntry(s)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Operational */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">Operational Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {recipient.reportingGroup && (
                <div>
                  <span className="text-slate-500 text-xs block">Reporting Group</span>
                  {recipient.reportingGroup}
                </div>
              )}
              {(() => {
                const breakdown = getPlannedSandwichBreakdown(recipient);
                if (breakdown.length > 0) {
                  const total = sumBreakdownRange(breakdown);
                  return (
                    <div className="col-span-2">
                      <span className="text-slate-500 text-xs block">Planned breakdown by type</span>
                      <div className="mt-1 space-y-0.5 text-sm">
                        {breakdown.map((row, i) => (
                          <div key={i} className="flex items-baseline gap-2">
                            <span className="font-semibold tabular-nums text-slate-800 min-w-[70px]">
                              {formatRange(row.min, row.max)}
                            </span>
                            <span className="text-slate-600">{row.type}</span>
                          </div>
                        ))}
                        {total && (
                          <div className="pt-1 mt-1 border-t border-slate-200 text-sm">
                            <span className="text-slate-500 text-xs">Total: </span>
                            <span className="font-semibold tabular-nums text-slate-800">
                              {formatRange(total.min, total.max)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                const range = getEstimatedSandwichesRange(recipient);
                if (range) {
                  return (
                    <div>
                      <span className="text-slate-500 text-xs block">Est. Sandwiches / week</span>
                      <span className="font-semibold tabular-nums">
                        {formatRange(range.min, range.max)}
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
              {(() => {
                const cadence = (recipient as Recipient & { deliveryCadence?: string | null }).deliveryCadence;
                const note = (recipient as Recipient & { deliveryCadenceNote?: string | null })
                  .deliveryCadenceNote;
                const cadenceMeta = getCadenceMeta(cadence);
                if (!cadenceMeta && !note) return null;
                return (
                  <div className="col-span-2">
                    <span className="text-slate-500 text-xs block">Delivery cadence</span>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {cadenceMeta && (
                        <Badge className={`text-xs ${cadenceMeta.badgeClass}`}>
                          {cadenceMeta.label}
                        </Badge>
                      )}
                      {note && <span className="text-xs text-slate-600 italic">{note}</span>}
                    </div>
                  </div>
                );
              })()}
              {recipient.sandwichType && (
                <div>
                  <span className="text-slate-500 text-xs block">Sandwich Type</span>
                  {recipient.sandwichType}
                </div>
              )}
              <div>
                <span className="text-slate-500 text-xs block">Contract</span>
                {contractStatus === 'signed' ? (
                  <Badge className="bg-green-100 text-green-800 text-xs mt-0.5">
                    Signed
                    {recipient.contractSignedDate &&
                      ` (${new Date(recipient.contractSignedDate).toLocaleDateString()})`}
                  </Badge>
                ) : contractStatus === 'pending' ? (
                  <Badge variant="secondary" className="text-xs mt-0.5">
                    Pending
                  </Badge>
                ) : (
                  <span className="text-slate-400">None</span>
                )}
              </div>
            </div>
            {recipient.preferences && (
              <p className="text-sm text-slate-600">
                <span className="font-medium">Preferences:</span> {recipient.preferences}
              </p>
            )}
          </section>

          {/* Contact info */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">Contact Information</h3>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 shrink-0" />
                <span>{recipient.phone}</span>
              </div>
              {recipient.email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 shrink-0" />
                  <a href={`mailto:${recipient.email}`} className="hover:text-[#236383] underline">
                    {recipient.email}
                  </a>
                </div>
              )}
              {website && (
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <a
                    href={website.startsWith('http') ? website : `https://${website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#236383] underline truncate"
                  >
                    {website}
                  </a>
                </div>
              )}
              {instagramHandle && (
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <a
                    href={`https://instagram.com/${instagramHandle.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#236383] underline"
                  >
                    {instagramHandle}
                  </a>
                </div>
              )}
              {ein && (
                <div className="text-sm text-slate-600">
                  <span className="font-medium">EIN:</span> {ein}
                </div>
              )}
              {recipient.address && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span>{recipient.address}</span>
                    {mapUrl && (
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-[#236383] hover:underline mt-1"
                      >
                        Open in Google Maps
                      </a>
                    )}
                  </div>
                </div>
              )}
              {Array.isArray(
                (recipient as typeof recipient & { addresses?: Array<{ label: string; address: string }> })
                  .addresses
              ) &&
                (recipient as typeof recipient & { addresses?: Array<{ label: string; address: string }> })
                  .addresses!.filter((a) => a && a.address)
                  .map((extra, idx) => {
                    const extraMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(extra.address)}`;
                    return (
                      <div key={`extra-${idx}`} className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                        <div>
                          {extra.label && (
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {extra.label}
                            </div>
                          )}
                          <span>{extra.address}</span>
                          <a
                            href={extraMapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-[#236383] hover:underline mt-1"
                          >
                            Open in Google Maps
                          </a>
                        </div>
                      </div>
                    );
                  })}
              {displayRegion && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>
                    <span className="font-medium">Region:</span> {displayRegion}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Contact persons */}
          {(recipient.contactPersonName ||
            recipient.contactPersonPhone ||
            recipient.contactPersonEmail) && (
            <section className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold text-slate-800">Primary Contact Person</h3>
              {recipient.contactPersonName && (
                <div className="text-sm flex items-center gap-2">
                  {recipient.contactPersonName}
                  {recipient.contactPersonRole && (
                    <Badge variant="outline" className="text-xs">
                      {recipient.contactPersonRole}
                    </Badge>
                  )}
                </div>
              )}
              {recipient.contactPersonPhone && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Phone className="w-4 h-4" />
                  {recipient.contactPersonPhone}
                </div>
              )}
              {recipient.contactPersonEmail && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Mail className="w-4 h-4" />
                  {recipient.contactPersonEmail}
                </div>
              )}
            </section>
          )}

          {(recipient as Recipient & { secondContactPersonName?: string }).secondContactPersonName && (
            <section className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold text-slate-800">Second Contact Person</h3>
              <div className="text-sm">{(recipient as Recipient & { secondContactPersonName?: string }).secondContactPersonName}</div>
            </section>
          )}

          {/* Survey & social */}
          {((recipient as Recipient & { surveySubmitted?: boolean }).surveySubmitted ||
            (recipient as Recipient & { hasSharedPost?: boolean }).hasSharedPost) && (
            <section className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold text-slate-800">Engagement</h3>
              <div className="flex flex-wrap gap-2">
                {(recipient as Recipient & { surveySubmitted?: boolean }).surveySubmitted && (
                  <Badge className="text-xs bg-[#47B3CB]/15 text-[#236383] border border-[#47B3CB]/40">
                    Survey submitted
                    {(recipient as Recipient & { surveySubmittedDate?: string }).surveySubmittedDate &&
                      ` (${new Date((recipient as Recipient & { surveySubmittedDate?: string }).surveySubmittedDate!).toLocaleDateString()})`}
                  </Badge>
                )}
                {(recipient as Recipient & { hasSharedPost?: boolean }).hasSharedPost && (
                  <Badge className="text-xs bg-purple-100 text-purple-800">
                    Shared post
                  </Badge>
                )}
              </div>
            </section>
          )}

          <section className="border-t pt-4">
            <TSPContactManager
              recipientId={recipient.id}
              recipientName={recipient.name}
              compact={false}
            />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
