# TSP contact reconciliation — stage 1

`tsp_contact` is the current form's primary user selection. `tsp_contact_assigned` is still consumed by reminders, assignment filters and imports. This change normalizes unambiguous new assignments into the primary field and a compatibility mirror; it does not drop either column.

## Identity rules

- Exact user IDs are preserved, including historical inactive accounts.
- An exact email or full first/last name resolves only when it identifies one account and that account is not inactive. Inactive duplicates still count toward ambiguity.
- First names, nicknames, combined names, notes, missing IDs and duplicate accounts are not guessed.
- New ambiguous imports preserve the text as `customTspContact` and a labeled planning note. Successful non-ID imports also retain the original label in planning notes.
- Existing unchanged full-form snapshots, unresolved historical text, and conflicting assignments are not silently migrated. Historical pairs with different people remain review items.
- The persistence boundary covers create/update in both storage implementations, including the spreadsheet import routes. The Apps Script import no longer pre-resolves TSP contacts with the permissive staff matcher. Notification contact assignment now uses the same storage boundary.
- The external intake PATCH allowlist does not include these contact fields. External whole-row GET responses retain both columns. The Google Sheets intake sync does not populate these contact columns.

## Production review

October 26 read-only check: 232 primary-field non-ID entries and one legacy-field non-ID entry, across 60 distinct trimmed labels. Eight primary entries match unique full names; these are the only proposed automatic historical corrections. Twenty-two records have different valid user IDs in the two columns; all are completed, one soft deleted. Sixteen have no audited reassignment. Review data with identities is private and is not committed here.

The standalone `scripts/sql/reconcile-event-contact-names.sql` requires exactly eight non-deleted, nonconflicting matches. It locks those rows, sets primary and compatibility fields to the resolved ID, updates updated_at, and records original field values in audit_logs. It preserves assignment dates, custom text and every other event field. Its verification aborts the transaction on unexpected changes. It rejects reruns after its audit marker exists. It is not part of automatic migrations.

The exact SQL was tested successfully on a fresh production-derived Neon branch: eight corrections and eight audit records, no unrelated event changes. **Production execution completed after explicit user approval.** All eight approved event IDs were checked inside the transaction, eight audit entries preserve the original values, and a separate read verified all eight corrected pairs. The 22 different-person conflicts remain unchanged. Do not rerun this backfill; its audit marker prevents duplicate execution.

## Remaining work

Merge/deploy this application change after review. The eight verified historical corrections have been applied. Resolve duplicate user accounts and review first-name/combined labels before further backfills. Resolve primary/additional roles for the 22 different-person conflicts. Only then migrate remaining consumers to a single authoritative contact representation and consider dropping the legacy column. No columns are removed here; TSP-shopping fields remain reserved for the planned workflow.
