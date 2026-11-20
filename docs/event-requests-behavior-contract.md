Event Requests Behavior Contract (Pre-filled from code)
0) Metadata
Owner: [YOU FILL]

Last updated: 2026-04-21

Baseline branch/commit: [YOU FILL]

Scope: client/src/components/event-requests/** + direct shared dependencies.

1) Purpose / Non-goals
Purpose
Define current “as-built” behavior so refactors can preserve functionality.

Turn implicit behavior into explicit test targets.

Non-goals
No immediate UX redesign.

No endpoint contract changes in this phase.

No status workflow changes unless explicitly approved.

2) Module boundaries (pre-filled)
Primary entry points
Container/orchestrator: event-requests/index.tsx (main composition point). 

State/data coordinator: EventRequestContext provider. 

Query key/filter source: buildEventRequestsListQuery. 

Mutation orchestration: useEventMutations. 

Global invalidation helper: invalidateEventRequestQueries. 

Child surfaces actively composed
Tabs include all/new/in_process/scheduled/completed/declined/standby/stalled/non_event/rescheduled/my_assignments (+ admin/planning/sandwich_overview by permission). 

Filters/tabs UI + counts logic in RequestFilters. 

3) Runtime state inventory (pre-filled)
A) Data state
Event list data is fetched from /api/event-requests/list with fallback to /api/event-requests; uses stale-while-revalidate via placeholderData. 

Status counts are fetched separately from /api/event-requests/status-counts. 

User volunteer assignments fetched from /api/event-requests/my-volunteers. 

B) View/filter/pagination state
activeTab, quickFilter, search/debounce, statusFilter, confirmationFilter, sortBy, page + page size are context-owned. 

C) Dialog/action state
Context owns many show* booleans and active event references (scheduling/toolkit/contact/assignment/etc.). 

4) URL/navigation contract (pre-filled)
Valid tabs are explicitly enumerated.

If URL has section=event-requests&tab=<valid>, context syncs activeTab to URL.

If section is event-requests and tab missing + current tab invalid, it defaults to new. 

initialTab prop also syncs/overrides when valid. 

5) Status workflow contract (pre-filled)
Canonical statuses
new, in_process, scheduled, rescheduled, completed, declined, cancelled, non_event, standby, stalled. 

Valid transition highlights
scheduled -> completed/cancelled/rescheduled/standby/in_process

rescheduled -> completed/cancelled/standby/in_process

completed -> scheduled

non_event -> new/in_process (reactivation supported) 

Business rule guard messages exist for common mistakes
(e.g., cancel only from scheduled/rescheduled; completed requires scheduled/rescheduled). 

6) Tab/filter query matrix (pre-filled)
Derived from buildEventRequestsListFilterParams:

Active Tab	Query behavior
new	status=new
in_process	status=in_process
scheduled	status=scheduled,rescheduled
rescheduled	status=rescheduled
declined	status=declined,cancelled
completed / standby / stalled / non_event	status=<tab>
all	status=new,in_process,scheduled,rescheduled,cancelled
my_assignments/admin/planning fallback	status=new,in_process,scheduled

Quick filters
week => days=7 (+ status for new/in_process/scheduled contexts)

today => days=1 (+ status similarly)

needsDriver => status=scheduled&needsDriver=true

needsVan => status=scheduled&needsVan=true

7) Query key/cache contract (pre-filled)
Canonical key: ['/api/event-requests/list', filterParams, quickFilter, 'v3']. 

Dashboard prefetch relies on this matching exactly. 

Mutation invalidation helper refetches:

all query keys whose first element starts with /api/event-requests

/api/event-map additionally. 

8) Mutation contract (pre-filled)
Current mutation set in useEventMutations:

delete event request (+ undo/restore)

update event request

create event request

mark toolkit sent

schedule call

update scheduled field (optimistic)

1-day follow-up

1-month follow-up

reschedule event (+ undo)

assign recipients

assign TSP contact

Notable behavior details
Update includes optimistic version check via _expectedVersion unless _skipVersionCheck. 

Conflict path (409) triggers refresh/invalidation and conflict messaging. 

Inline scheduled field update performs optimistic cache patch with rollback on error, then invalidates on settled. 

9) UI tab availability/permissions (pre-filled)
Base tabs always included: all, my_assignments, new, in_process, scheduled, rescheduled, completed, declined, standby, stalled, non_event. 

admin_overview, planning, sandwich_overview appear only with admin-overview permission (or super_admin). 

Same permission logic used when composing tab content in container. 

10) Search/filter semantics (pre-filled)
Search matches organization/department/contact fields/address + TSP contact names + volunteer/driver/speaker assignments + date formats.

Date search handles YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY, and fuzzy parse fallbacks.

“Scheduled tab includes rescheduled” logic appears in filtering as well.

Completed events are considered confirmed in confirmation filtering. 

11) Role defaults (pre-filled)
From shared role defaults:

Admin/super_admin/core_team/committee: default tab scheduled, sort event_date_asc.

Host/driver/volunteer: default tab my_assignments, confirmation confirmed, sort event_date_asc.

Viewer/demo: default tab scheduled. 

12) Form mapping contract (pre-filled)
EventSchedulingForm explicitly declares server→form mapper as “single source of truth” (buildFormDataFromEventRequest).

Includes substantial field mapping and date/time normalization responsibilities.

Form is already sectioned via form-sections/* components. 

13) High-risk areas (pre-filled, for your review order)
Context state breadth (many unrelated concerns in one provider). 

Container orchestration size + many cross-wired dialogs/actions. 

Filtering complexity (rich search + assignment/date parsing logic). 

Mutation side-effects (many toasts/state resets/fetch-refresh steps). 

14) [YOU FILL] sections I cannot infer reliably from code alone
Business SLA targets (e.g., “new requests touched within X hours”).

Must-never-break workflows (ranked + testable)
1) New events are pulled in from Squarespace/Google Sheets and appear in Event Requests
Definition (contract language):

A new external submission reaches the webhook/import path, is authenticated, sync runs, and resulting event is visible in Event Requests list.

Code anchors:

Public webhook endpoint for new event request + secret validation + sync trigger. 

Import route mount ordering and auth bypass only for import endpoint. 

Event requests router explicitly preserves critical legacy import behavior. 

Sync-from-sheets endpoint behavior and permission gate (EVENT_REQUESTS_SYNC). 

Pass criteria:

Webhook call with valid secret returns success and non-zero created/updated when new row exists.

Event appears in new (or expected status tab) in UI.

2) Events are tracked reliably through lifecycle in Event Requests management
Definition:

Events can move through valid statuses only; tabs/filters consistently include the right statuses.

Code anchors:

Canonical statuses + valid transitions rules. 

Transition-specific guard messages (cancel/completed/rescheduled/non_event). 

Tab-to-status query behavior (e.g., scheduled includes rescheduled, declined includes cancelled). 

Pass criteria:

No illegal transition succeeds.

Every tab shows the expected status set every time.

3) Intake team can enter/update event data and it persists throughout lifecycle
Definition:

Intake edits (during/after calls) save successfully and remain on the record through later status changes.

Code anchors:

Create/update mutations and success/error handling. 

Optimistic locking protection against silent overwrites. 

Central invalidation/refetch after changes. 

Form mapping as single source of truth for server→form data hydration. 

Pass criteria:

Edit persists after refresh.

Edit remains intact after status changes and re-open.

Concurrent edit conflict is surfaced (not silently lost).

4) Hosts can submit weekly sandwich collection numbers
Definition:

Authorized user can submit collection data from UI; server accepts and records it.

Code anchors:

Mobile collection entry submit flow + validation + submit action. 

Collection create endpoint requires COLLECTIONS_ADD. 

Collection data validation + create path. 

Pass criteria:

Valid submission returns success.

Invalid/missing required fields fail with clear errors.

Unauthorized user cannot submit.

5) Collection logs are reliably saved and historical data integrity is maintained
Definition:

Every accepted collection write is durable, attributed, and reflected in read/stats views without corrupting historical totals.

Code anchors:

User attribution persisted (createdBy, createdByName). 

Cache invalidation + realtime broadcast on create. 

Stats endpoint computes totals using JSONB groups with legacy fallback. 

Legacy compatibility handling for group fields + new JSONB group collections. 

Pass criteria:

New entry appears in list and affects totals.

Historical totals remain stable under repeated reads/restarts.

No data loss between legacy and JSONB group formats.

6) Users can log in and navigate to application tabs they’re allowed to access
Definition:

Login is reliable; unauthenticated users are redirected; authenticated users can load dashboard sections/tabs.

Code anchors:

Auth endpoints and login flow (/api/auth/login, session creation). 

Frontend login redirect behavior for unauthenticated routes. 

Dashboard section rendering includes Event Requests and other sections. 

Pass criteria:

Valid credentials -> authenticated session.

Invalid credentials -> controlled rejection.

Authenticated user can load permitted sections without blank/error state.

7) Permissions gate content/actions correctly (view/edit/delete boundaries)
Definition:

Users only see what they are allowed to see and only mutate what they are allowed to mutate.

Code anchors:

Explicit permission constants for collections/event-requests and many nav scopes. 

Permission dependency expansion logic (nav permission grants functional dependencies). 

Server-side route gates (requirePermission, requireOwnershipPermission). 

Sync endpoints protected by permission requirements. 

Pass criteria:

Unauthorized attempts return 401/403.

Ownership-protected edits/deletes behave correctly.

Privileged actions unavailable to low-permission users.

Suggested “contract header” update with your info
Owner: Katie Long

Must-never-break workflows: (the seven above, in this order)

Baseline: work @ dfc1c90d6e97696320ef05efda06fb2ca6d9bc19 (from your current repo state)



Acceptable temporary regressions (if any).

User communication/escalation plan for incident fallback.


15) Immediate test checklist derived from this contract (you can start today)
Query-builder unit tests for every tab + quickFilter combination.

URL sync tests for tab behavior under section=event-requests.

Mutation tests for:

update success path

conflict path (409)

optimistic rollback path for inline update

Smoke integration:

edit event → save → list refreshes and dialog closes

scheduled/rescheduled behavior in both tab filter and status filter.

