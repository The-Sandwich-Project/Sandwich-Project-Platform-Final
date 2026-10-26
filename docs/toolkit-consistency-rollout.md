# Toolkit consistency repair

The scheduling form allowed toolkitStatus to change while sending a stale toolkitSent boolean. Spreadsheet exports and follow-up queries read that boolean, producing conflicting behavior.

This change makes explicit known toolkit statuses authoritative on saves, with toolkitSent mirrored in the same write. Boolean-only spreadsheet edits remain supported. A matching boolean preserves received_confirmed or not_needed. The form payload, three generic update routes, and both storage implementations share the rule. Generic route contact logging uses the normalized state, so a stale false checkbox on an already-sent event does not add another contact attempt. Notification undo now uses not_sent rather than null. Imports and the dedicated toolkit-send action already write matching fields.

The separate corporate follow-up checklist is not changed. Dates and sender history are never synthesized or cleared by normalization. Unrelated partial updates do not reconcile historical conflicts. Explicit unknown statuses are outside this repair; this is not a new database constraint.

## Production preview, October 21, 2026

Read-only queries against the verified production branch found:

| State | Records | Not soft deleted |
| --- | ---: | ---: |
| sent/received_confirmed with false checkbox | 133 | 130 |
| not_sent with true checkbox | 2 | 2 |
| All other records | 1,684 | 1,661 |

44 of the 133 proposed checkbox corrections have a sent date. Both opposite conflicts have dates, so retain them for history review instead of overwriting their status automatically. Hold the three soft-deleted candidates separately. The 383 already-true records without dates do not need invented dates.

The proposed first cleanup was to set only toolkitSent=true for the 130 non-deleted events explicitly marked sent or received_confirmed. It was executed on October 22, 2026, after the audit-history check below.

## Backfill, October 22, 2026

Before writing, `scripts/sql/classify-toolkit-conflicts.sql` sorted each conflict by its most recent audited toolkit change. The concern was spreadsheet "No" edits: before this PR they changed only toolkitSent, so a sent-status/false-flag record could be a deliberate uncheck rather than a stale checkbox.

| Bucket | Records | Outcome |
| --- | ---: | --- |
| Latest change set status to sent; flag left behind | 49 | toolkitSent set true |
| No audited toolkit change | 80 | toolkitSent set true |
| Deliberate spreadsheet uncheck | 0 | none found |
| Opposite conflicts (flag true, status not_sent) | 2 | toolkitStatus set sent |
| Unclear (partial audit snapshot) | 1 | toolkitSent set true |
| Soft deleted | 3 | left unchanged |

`scripts/sql/diagnose-toolkit-no-history.sql` showed the 80 split into 48 created already marked sent, 18 created before the audit log began (September 5, 2025), and 14 whose status changed through a path that did not write an audit entry. Because their status already said sent and none of the 50 traceable records was a deliberate uncheck, they were treated like the 49.

Both opposite conflicts had a sent date and an audited checkbox-only change from false to true, so the checkbox was the deliberate edit and the status was corrected instead. The unclear record's latest audit entry had no toolkit fields in its after-snapshot, so it was handled like the no-history group.

`scripts/sql/backfill-toolkit-flag-safe.sql` updated 129 records; the three remaining corrections were explicit by ID. Each ran in a transaction, and the returned row count was checked before COMMIT. Only toolkit_sent or toolkit_status changed: dates, senders, contact logs and updated_at were untouched. The returned record IDs were kept privately, not in this public repository. A fresh read afterward found no non-deleted record with a sent status and a false checkbox.

Open question: the 14 unaudited status changes suggest some write path skips the audit log.

## Rollout

1. Review and merge this PR, then deploy the updated application in Replit.
2. In an isolated test environment, save each of the four toolkit statuses and toggle the spreadsheet checkbox. Confirm the response and reloaded event agree. An already-sent event must not gain a duplicate contact attempt merely from a form save.
3. Run `scripts/sql/preview-toolkit-reconciliation.sql` on the verified production connection. It is read-only and returns record IDs and proposed actions without contact names or email addresses. Keep its output private.
4. Review the candidate IDs and verify the production restore point before authorizing a separate, audited backfill. Test that exact backfill on a production-derived isolated branch first. Preserve dates, senders, contact logs, and the two unresolved opposite conflicts.

Status: steps 1, 3 and 4 are done (the backfill ran with an in-transaction row-count check rather than a rehearsal on an isolated branch). Step 2's manual smoke test is still pending.
