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

The proposed first cleanup is to set only toolkitSent=true for the 130 non-deleted events explicitly marked sent or received_confirmed. This is a proposal, not an executed backfill. Re-run the preview at deployment because live counts can change.

## Rollout

1. Review and merge this PR, then deploy the updated application in Replit.
2. In an isolated test environment, save each of the four toolkit statuses and toggle the spreadsheet checkbox. Confirm the response and reloaded event agree. An already-sent event must not gain a duplicate contact attempt merely from a form save.
3. Run `scripts/sql/preview-toolkit-reconciliation.sql` on the verified production connection. It is read-only and returns record IDs and proposed actions without contact names or email addresses. Keep its output private.
4. Review the candidate IDs and verify the production restore point before authorizing a separate, audited backfill. Test that exact backfill on a production-derived isolated branch first. Preserve dates, senders, contact logs, and the two unresolved opposite conflicts.

No database migration, historical UPDATE, deployment, or production-copy write is included in this PR. Automated validation covers the shared normalization rules and actual form payload builder; the deployment smoke test and backfill rehearsal remain rollout steps.
