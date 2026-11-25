# Event Requests: developer map

## Scope and evidence

This document describes the implementation in the current project checkout, not a verified production configuration. Paths are relative to the project root. Environment variable **names**, never their values, are listed below. A provider appearing in the code does not establish that its credentials are configured or that calls to it currently succeed.

The scope includes the Event Requests screen, its supporting routes, directly embedded features, and event-related import/notification jobs. It does not treat every integration elsewhere in the application as an Event Requests integration. Unresolved behavior is labeled **(unverified)**.

## 1. Overview and lifecycle

Event Requests manages group-event intake, organizer contact, scheduling, sandwich estimates and actuals, transportation, recipients, volunteer assignments, follow-up, and completion. The code identifies the Squarespace form-response Google Sheet as an intake source, imports its rows into the application database, and provides a separate integration with the team's planning Google Sheet. However, the lifecycle is **not strictly “start in Squarespace, manage in the app, complete in the planning sheet.”** Events can be created directly in the app or imported from the planning sheet, and completion is a database status that can be changed in the app or by an automatic job. The planning sheet is a separate scheduling/coordination record, not the only place where completion occurs.

### Intake and management

1. **Squarespace → intake Google Sheet.** The intake parser recognizes Squarespace-style fields and timestamps. The upstream Squarespace-to-Sheets automation itself is **(unverified)**: this repository confirms the intake source and receiving/import behavior, not the external automation's deployment.
2. **Intake sheet → application database.**
   - `server/google-sheets-event-requests-sync.ts` implements insert-only `syncFromGoogleSheets()`, with duplicate detection and stable identifiers. It explicitly avoids updating already-imported events.
   - `server/background-sync-service.ts` starts after server initialization and invokes intake import on startup and on a recurring **30-minute** interval. Runtime execution/success is **(unverified)**.
   - `POST /api/webhook/new-event-request` in `server/routes/index.ts` triggers a sheet import after checking the webhook secret.
   - `POST /api/event-requests/import-from-sheets` in the legacy router accepts a submitted row payload using an API-key check. This is a receiving endpoint, not a Squarespace API client.
   - Manual from-sheet sync is also exposed through the sync router.
3. **Application management.** Normal create/update requests persist through the backend storage layer. Users manage contact/intake details, dates, status, sandwich counts/types, destinations, staffing, delivery, flags, comments, and follow-up.
4. **Application ↔ planning sheet, through separate workflows.**
   - Planning-sheet preview/gap endpoints read and compare the sheet with app events.
   - A reviewed planning-sheet import creates missing app events; past dates can be assigned `completed`, future dates `scheduled`, and cancellation markings affect status.
   - The explicit `POST /api/planning-sheet-proposals/push-event/:eventId` route calls `pushEventDirectly()`. A successful push marks the app event as added to the official sheet, with a timestamp when supported.
   - A normal event save is not the same operation as this explicit push.
5. **Completion.** `completed` is an app status. In addition to manual changes and completed planning-sheet imports, `autoCompletePassedEvents()` updates non-deleted `scheduled`/`rescheduled` events whose scheduled date is in the past. The cron registration is nightly; it updates status, not a verified actual sandwich count.

### Status model

`shared/event-status-workflow.ts` defines:

`new`, `in_process`, `scheduled`, `rescheduled`, `completed`, `declined`, `cancelled`, `non_event`, `standby`, and `stalled`.

These are not a mandatory one-way sequence. The current transition table permits moving between different statuses, while other validation helpers and route/form checks still apply. `isScheduledOrRescheduled()` is the shared helper for treating a rescheduled event as an active scheduled event.

### Important sheet boundary

The intake-sheet service's `syncToGoogleSheets()` is **disabled** and returns an explicit failure to prevent data loss. Do not infer bidirectional intake sync from the sync router's comments or the existence of `/sync/to-sheets`. The planning-sheet service is distinct and contains functioning write operations used by the explicit push workflow.

Evidence: `server/google-sheets-event-requests-sync.ts` (`syncFromGoogleSheets`, `syncToGoogleSheets`), `server/background-sync-service.ts`, `server/routes/index.ts`, `server/routes/planning-sheet-import.ts`, `server/routes/planning-sheet-proposals.ts`, `server/planning-sheet-sync-service.ts`, `server/services/cron-jobs.ts`, and `shared/event-status-workflow.ts`.

## 2. Key entry points

### Frontend

| Full path from project root | Responsibility |
| --- | --- |
| `client/src/components/event-requests/index.tsx` | Main screen: permissions, tabs, views, dialogs, and supporting widgets. |
| `client/src/components/event-requests/context/EventRequestContext.tsx` | Shared event-list state, list/count/assignment queries, active tab, and data used by child components. |
| `client/src/components/event-requests/context/EventDialogContext.tsx` | Shared dialog-selection/open-state management. |
| `client/src/components/event-requests/hooks/useEventQueries.ts` | Queries supporting reference data such as users, drivers, hosts, volunteers, recipients, and host contacts. |
| `client/src/components/event-requests/hooks/useEventMutations.tsx` | Shared event mutation behavior and cache updates/invalidation. |
| `client/src/components/event-requests/hooks/useEventAssignments.tsx` | Assignment-related actions and state. |
| `client/src/components/event-requests/hooks/useEventFilters.ts` | Event filtering logic used by the screen. |
| `client/src/components/event-requests/hooks/usePreEventFlagMutations.tsx` | Mutations for pre-event operational flags. |
| `client/src/components/event-requests/lib/eventRequestsListQuery.ts` | Builds the list-query parameters used for scoped event requests. |
| `client/src/components/event-requests/EventSchedulingForm.tsx` | Main create/edit form; submits POST/PATCH requests and collects operational details. |
| `client/src/components/event-requests/IntakeCallDialog.tsx` | Intake-call workflow and saving intake/scheduling details. |
| `client/src/components/event-requests/dialogs/EventEditDialog.tsx` | Event-edit dialog entry point. |
| `client/src/components/event-requests/dialogs/AssignmentDialog.tsx` | Assignment UI for an event. |
| `client/src/components/event-requests/tabs/` | Status-specific and operational tab implementations. |
| `client/src/components/event-requests/cards/` | Event-card presentations and actions. |
| `client/src/components/event-requests/EventMapView.tsx` | Map entities, filters, address search, two-point routing, and route display. |
| `client/src/components/event-requests/form-sections/DeliverySection.tsx` | Address/delivery details, including an explicit Geocode action. |
| `client/src/components/maps/BaseMapTiles.tsx` | Leaflet basemap provider selection, Google tile proxy, attribution, and CARTO fallback. |
| `client/src/hooks/useEventRequestSocket.ts` | Same-origin Socket.IO event create/update/delete subscriptions. |
| `client/src/components/event-email-composer.tsx` | Organizer email/toolkit composer, document selection, templates, drafts, and send action. |
| `client/src/components/event-requests/SendToolkitDialog.tsx` | Wraps the shared event email composer for toolkit sending. |
| `client/src/components/ScheduledEventEmailComposer.tsx` | Scheduled-event email composer using the event send-email endpoint. |
| `client/src/components/ContactOrganizerDialog.tsx` | Opens the user's email client with a `mailto:` link; this action is not an email-provider API call. |
| `client/src/components/floating-ai-chat.tsx` | Shared contextual AI panel, including use from Event Requests. |

### Backend and shared contracts

| Full path from project root | Responsibility |
| --- | --- |
| `server/routes/index.ts` | Mounts authenticated application routes, Event Requests integrations, and the intake webhook. |
| `server/routes/event-requests/` | Modular Event Requests route directory. |
| `server/routes/event-requests/index.ts` | Composes the modular routes and the still-active legacy router. |
| `server/routes/event-requests-legacy.ts` | Most core list/detail/create/update operations, intake payload import, toolkit/contact/status actions, and event email behavior. “Legacy” does not mean unused. |
| `server/routes/event-requests/sync.ts` | Manual intake-sheet sync/status endpoints; to-sheet service is disabled. |
| `server/routes/event-requests/organizations.ts` | Organization-related helpers for event workflows. |
| `server/routes/event-requests/volunteers.ts` | Event volunteer assignments and decline-related records. |
| `server/routes/event-requests/flags.ts` | Operational flag endpoints. |
| `server/routes/event-requests/lifecycle.ts` | Follow-up-call/status-related actions and manual admin auto-completion trigger. |
| `server/routes/event-requests/conflicts.ts` | Scheduling conflict checks and date/van conflict queries. |
| `server/routes/event-requests/audit.ts` | Event audit history. |
| `server/routes/event-requests/ai.ts` | AI date suggestions, intake assistance, and categorization. |
| `server/routes/event-requests/sms.ts` | Explicit event-details and correction SMS sends. |
| `server/routes/event-map.ts` | Stored-coordinate event-map data and individual/address/batch geocoding endpoints. |
| `server/routes/map-tiles.ts` | Authenticated Google map configuration, tile proxy, and viewport copyright endpoints. |
| `server/routes/directions.ts` | Google Directions request and OSRM fallback. |
| `server/utils/geocoding.ts` | Google-first address geocoding with OpenStreetMap Nominatim fallback. |
| `server/services/google-map-tiles.ts` | Google tile-session management, tile fetching/caching, attribution, and provider fallback state. |
| `server/google-sheets-event-requests-sync.ts` | Intake-sheet authentication, parsing, duplicate handling, and insert-only import. |
| `server/background-sync-service.ts` | Background intake sync and related health/notification behavior. |
| `server/routes/planning-sheet-import.ts` | Review-first planning-sheet preview, gap report, and import. |
| `server/routes/planning-sheet-proposals.ts` | Planning-sheet preview/push and proposal workflow routes. |
| `server/planning-sheet-sync-service.ts` | Planning-sheet parsing, column mapping, matching, and writes. |
| `server/routes/email-routes.ts` | Shared event-email send/draft workflow at `/api/emails/event`. |
| `server/services/email/` | Email helper (Twilio Email): transport, attachments, copies, suppressions, unsubscribe page. |
| `server/sms-service.ts` | Shared event notification/reminder SMS helpers. |
| `server/sms-providers/provider-factory.ts` | Selects/configures Twilio or the optional phone-gateway provider. |
| `server/services/email-notification-service.ts` | Event-related assignment/comment/reminder notification helpers and preference checks. |
| `server/services/cron-jobs.ts` | Event auto-completion, reminders, follow-up, and other scheduled jobs. |
| `server/routes/external-event-requests.ts` | Event API for a separate intake workflow application. |
| `server/storage-wrapper.ts` | Storage entry point used by event routes and services. |
| `server/db.ts` | Neon-backed Drizzle database client. |
| `shared/schema.ts` | Event, assignment, organization, collection, and related persisted data contracts. |
| `shared/event-status-workflow.ts` | Status definitions, transitions, scheduled/rescheduled semantics, and reason helpers. |
| `shared/event-request-patch.ts` | Typed PATCH contract; legacy PATCH currently also has shadow-validation behavior. |
| `shared/event-validation-utils.ts` | Effective date and operational validation helpers. |
| `shared/sandwich-count-utils.ts` | Sandwich count parsing/reporting helpers. |

## 3. Other app areas Event Requests depends on

| Module/data area | How Event Requests uses it | Confirmed entry points/evidence |
| --- | --- | --- |
| Users and permissions | Gates screen/actions; resolves TSP contacts, assignees, notification recipients, and “my assignments.” | `useEventQueries.ts`: `/api/users/basic`, `/api/users/for-assignments`; frontend `useAuth`; `shared/auth-utils.ts`, `shared/unified-auth-utils.ts`; backend authentication/permission middleware. |
| Drivers | Driver choices, delivery assignments, phone details, availability/conflicts, and map candidates. | `/api/drivers`; map `/api/drivers/driver-candidates`; assignment hooks; `server/services/event-conflict-detection.ts`. |
| Hosts and host contacts | Host choices, contact details, delivery/destination context, and map locations. | `/api/hosts`, `/api/hosts-with-contacts`, `/api/host-contacts`, `/api/hosts/map`. |
| Volunteers | Assignment choices, event-specific volunteer records, declines, reminders, and current user's event assignments. | `/api/volunteers`, `/api/event-requests/my-volunteers`, `server/routes/event-requests/volunteers.ts`. |
| Recipients | Destinations, allocation editors, recipient assignments and map locations. | `/api/recipients`, `/api/recipients/map`; `RecipientAllocationEditor.tsx`, `InlineRecipientAllocationEditor.tsx`. |
| Organizations/groups | Organization matching, catalog/history/details, and returning-group information. | `server/routes/event-requests/organizations.ts`; `client/src/contexts/batched-returning-org-context.tsx`; organization/detail routes. |
| Sandwich collections | Displays event-linked collection records and supports comparisons with event estimates/actuals. A linked collection is not interchangeable with every event estimate. | `client/src/components/event-requests/EventCollectionLog.tsx`: `/api/sandwich-collections?eventRequestId=...`; shared count helpers. |
| Other event requests | Same-day warnings, van/resource conflicts, repeat-organization context, AI scheduling context, forecasts, and status counts. | Conflict routes, list/count queries, `EventsOnDayBadge.tsx`, `EventConflictWarnings.tsx`, AI routes. |
| Collaboration and audit | Event comments, collaboration locks/state, activity/audit history, and notification side effects. | `client/src/contexts/batched-collaboration-context.tsx`; `client/src/components/collaboration/comment-thread.tsx`; audit routes. |
| Reminders and notification preferences | Per-event check-in rules, snoozing, recipient preferences, scheduled reminders/follow-up, and assignment notifications. | `ReminderRulesManager.tsx`: `/api/event-check-in-reminders`, `/api/me/check-in-reminder-preferences`; email notification service and cron jobs. |
| Email/templates/documents | Toolkit and event-email composition, drafts, reusable template sections, and attachments. | `event-email-composer.tsx`: `/api/storage/documents`, `/api/email-templates/sections`, `/api/emails/event`; scheduled email composer. The inspected send route resolves attachments to local file paths. |
| Planning-sheet coordination | Sheet/app comparisons, missing-event reporting, reviewed import, and explicit sheet push. | `/api/planning-sheet-import/*`, `/api/planning-sheet-proposals/*`. |
| Mapping and routing | Displays events, hosts, recipients, and drivers; geocodes addresses and draws driving routes. | `EventMapView.tsx`, `BaseMapTiles.tsx`, event-map/map-tiles/directions routes. |
| Forecasts/operational views | Sandwich and staffing forecasts and destination/operational summaries. | `sandwich-forecast-widget.tsx`, `staffing-forecast-widget.tsx`, operational tabs. |
| Shared UI/query state | React Query caching, scoped lists, response merging, dialogs, navigation, dates, and validation. | Event contexts/hooks, `client/src/lib/queryClient.ts`, list-query builder, shared date/status/validation helpers. |
| Local traffic-event rules | Flags known Atlanta-area traffic conflicts against event dates. This is not a live traffic-service query. | `TrafficConflictBadge.tsx` imports `shared/traffic-conflicts`. |

## 4. External services

### Confirmed integrations and triggers

Configuration names below include credentials and non-secret settings; they are distinguished where relevant.

| Actual provider/service | What triggers a call | Credential/configuration variable names | Implementation |
| --- | --- | --- | --- |
| **Google Sheets API — intake sheet** | Background import, manual from-sheet sync, webhook-triggered import, and sheet diagnostic/status operations that read the sheet. A normal app edit does not write back to this intake sheet. | Credentials: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`. Initialization also requires `GOOGLE_PROJECT_ID`. Sheet identifier: `EVENT_REQUESTS_SHEET_ID`. The inspected service uses `Sheet1` as its worksheet field. | `server/google-sheets-event-requests-sync.ts`, sync routes, background service, webhook in `server/routes/index.ts`. |
| **Google Sheets API — planning sheet** | Planning-sheet preview/gap/read/import operations; explicit event push reads/matches and writes sheet rows. Separate proposal routes also exist; do not assume their presence makes every app save a sheet write. | Credentials: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`. Settings: `PLANNING_SHEET_ID`, `PLANNING_SHEET_WORKSHEET_NAME`. | `server/planning-sheet-sync-service.ts`, planning-sheet import/proposal routes. |
| **Google Geocoding API** | App event creation with an address; qualifying saves; explicit form geocode; map address search; individual/batch geocoding endpoints. | `GOOGLE_GEOCODING_API_KEY`. | `server/utils/geocoding.ts`; URL is `maps.googleapis.com/maps/api/geocode/json`. See section 5. |
| **OpenStreetMap Nominatim** | Fallback in the shared address geocoder when Google fails or is not configured. | No API-key environment variable in the inspected implementation. | `server/utils/geocoding.ts`. |
| **Google Map Tiles API** | Map mount requests `/api/maps/config`; when Google is selected, map loading/panning/zooming requests tiles and viewport attribution through the server. Sessions/tiles/attribution can be cached, so not every browser request entails a new upstream request. | `GOOGLE_MAPS_API_KEY`. | `BaseMapTiles.tsx`, `server/routes/map-tiles.ts`, `server/services/google-map-tiles.ts`; `tile.googleapis.com`. |
| **CARTO raster basemap** | Browser loads fallback tiles when the shared basemap does not use Google. | No API-key environment variable in this implementation. | `BaseMapTiles.tsx`; `basemaps.cartocdn.com/rastertiles/voyager/...`. |
| **Google Directions API** | Event map has two selected route points; frontend POSTs to `/api/directions`. This is distinct from address geocoding and tile loading. | `GOOGLE_MAPS_API_KEY`. | `EventMapView.tsx`, `server/routes/directions.ts`; `maps.googleapis.com/maps/api/directions/json`. |
| **OSRM public routing service** | Directions fallback when no Google Maps key is configured, or for Google API error cases handled by the route. | No API-key environment variable in the implementation. | `server/routes/directions.ts`; `router.project-osrm.org`. |
| **Twilio SMS** | Explicit event-details/correction sends, shared assignment/comment notification helpers where applicable, and event reminder/follow-up jobs subject to their preferences and checks. | Manual credentials: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`; sender: `TWILIO_PHONE_NUMBER`. Selection: `SMS_PROVIDER`. Connector mode instead obtains account/API-key credentials from the Replit Twilio connection; platform access uses `REPLIT_CONNECTORS_HOSTNAME` and `REPL_IDENTITY` or `WEB_REPL_RENEWAL`. | `server/routes/event-requests/sms.ts`, `server/sms-service.ts`, `server/sms-providers/provider-factory.ts`, `twilio-provider.ts`, `replit-twilio-connector.ts`. |
| **Configurable HTTP phone gateway — provider identity (unverified)** | Same SMS workflows if `SMS_PROVIDER` selects `phone_gateway` instead of Twilio. The actual gateway vendor is not hardcoded. | Credential: `PHONE_GATEWAY_API_KEY`; settings: `PHONE_GATEWAY_URL`, `PHONE_GATEWAY_DEVICE_NUMBER`, `PHONE_GATEWAY_TIMEOUT`, `SMS_PROVIDER`. | `server/sms-providers/phone-gateway-provider.ts`, provider factory. |
| **OpenAI, through the configured Replit AI endpoint** | User requests AI date suggestions, intake assistance, or categorization. The shared floating AI panel calls `/api/ai-chat` when a chat message is submitted. These are not automatic calls on every event save. | `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`. | `server/routes/event-requests/ai.ts`; `server/services/ai-scheduling/index.ts`, `ai-intake-assistant/index.ts`, `ai-event-categorization/index.ts`; `server/routes/ai-chat.ts`. The event helpers specify `gpt-5-mini`; shared AI chat specifies `gpt-5`. |
| **Twilio Email** | Toolkit/event-email send action, scheduled-event email send, and event notification/reminder/follow-up helpers where applicable. Provider sending is disabled/fails explicitly where the relevant helper detects a missing key. | Credentials: `TWILIO_EMAIL_API_KEY`, `TWILIO_EMAIL_API_SECRET`. Sender/copy settings used by event email paths: `EMAIL_FROM_ADDRESS`, `EMAIL_TOOLKIT_BCC`. | `server/services/email/`, `server/routes/email-routes.ts`, legacy event send-email route, `server/services/email-notification-service.ts`, cron/background notification calls. |
| **Neon PostgreSQL over HTTP — shared app infrastructure** | Event/reference-data database reads and writes; not a separate browser-side Event Requests provider call. | Production selection: `DATABASE_URL` or `PRODUCTION_DATABASE_URL`. Development selection: `DEV_DATABASE_URL` or `DATABASE_URL`. `NODE_ENV` controls selection. These connection strings contain credentials and must not be printed. | `server/db.ts`, `server/db-url.ts`, storage layer. |

### Receiving integrations, links, and shared-service boundaries

- **Intake webhook authentication:** `SHEETS_WEBHOOK_SECRET` authenticates the inbound `/api/webhook/new-event-request` request. It is not a Google API credential.
- **Row-payload import authentication:** `GOOGLE_SHEETS_API_KEY` authenticates inbound `/api/event-requests/import-from-sheets`. Despite its name, this middleware uses it as an application shared secret, not as the service-account credential for outgoing Sheets reads.
- **Squarespace:** the code confirms a Squarespace-style intake source, but no outgoing Squarespace API call was established in this flow. Which external script/automation currently writes the intake sheet is **(unverified)**.
- **External intake workflow app:** `server/routes/external-event-requests.ts` exposes reading/updating event data to that application. Its deployed identity and runtime callers are **(unverified)**.
- **Google Calendar:** `server/routes/ai-chat.ts` contains a separate volunteer-calendar context branch that calls Google Calendar read-only APIs using `GoogleAuth` and `GOOGLE_CALENDAR_ID`. Whether that branch is reachable from the Event Requests panel's chosen context is **(unverified)**. It is not evidence that ordinary event create/save or the Event Requests calendar view calls Google Calendar. The inspected Event Requests calendar component queries `/api/event-requests`.
- **Error-log Sheets:** shared error reporting has `server/services/error-log-sheet-sync.ts`, configured by `ERROR_LOG_SHEET_ID`, `ERROR_LOG_WORKSHEET_NAME`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY`. The background sync service invokes application error logging. This is ancillary error reporting, not event/planning-sheet synchronization; an individual error's eventual sheet delivery is **(unverified)**.
- **Email links/static assets:** organizer contact can open `mailto:`; map links can open Google Maps; intake contains a link to the separate host-finder web app. Email HTML references GitHub Pages images/tools. These are links or recipient-side resource loads, not evidence of corresponding server API calls.
- **Realtime updates:** Event Requests uses same-origin **Socket.IO** events. This is not evidence of a Stream Chat API call, and Stream credentials should not be added to an Event Requests configuration list merely because another app area uses them.
- **Attachments:** the inspected event-email send route resolves document metadata/attachments to filesystem paths. An Event Requests-specific outgoing cloud-storage API call through this send path was not established **(unverified)**.
- **Other AI providers:** the inspected Event Requests helpers and shared AI chat use OpenAI. Anthropic/Gemini calls were not established in these paths; their environment variables elsewhere in the project are not evidence of usage here.

## 5. Geocoding: create/save versus opening the map

**Geocoding runs independently of the map view. It is not limited to opening the map.**

| Operation | Condition and timing |
| --- | --- |
| App `POST /api/event-requests` | After creating the record, a truthy `eventAddress` starts `geocodeAddress()` asynchronously. The create response does not await geocoding. Coordinates are persisted afterward if a result is returned. |
| Main `PATCH /api/event-requests/:id` | The incoming update must include a truthy `eventAddress`, and either it differs from the original address or the updated record lacks latitude/longitude. The handler **awaits** geocoding and the coordinate update before responding. |
| `PUT /api/event-requests/:id` and other legacy update variants | Similar changed-address/missing-coordinate checks exist. Do not assume PATCH is the only geocoding-capable update route. |
| Save unrelated fields, with address unchanged and coordinates present | Does not trigger geocoding through these checks. Missing coordinates alone do not trigger the main PATCH check if the save payload omits the address. |
| Delivery-section Geocode button | Explicit POST to `/api/event-map/geocode/:id`, without opening the map. |
| Opening Event Map | Fetches map data containing stored coordinates and loads basemap resources. It does **not** automatically geocode every event. The map-data query filters for coordinates already present. |
| Map address search | Explicit POST to `/api/event-map/geocode-address`. |
| Batch/manual API actions | `/api/event-map/geocode-all` and `/api/event-map/batch-geocode` expose batch geocoding; availability of a specific UI button for each endpoint is **(unverified)**. |
| Selecting two route points | Calls Directions, not address geocoding. |

Provider sequence in `server/utils/geocoding.ts`:

1. Reject an empty/blank address and normalize input.
2. Try **Google Geocoding** with `GOOGLE_GEOCODING_API_KEY`.
3. If unsuccessful or unavailable, try **OpenStreetMap Nominatim**.
4. Return coordinates when successful; callers handle a missing result/error.

Useful anchors in the inspected checkout:

- `server/routes/event-requests-legacy.ts:1932–1951`: asynchronous creation geocoding.
- `server/routes/event-requests-legacy.ts:3084–3102`: awaited main PATCH geocoding.
- `server/routes/event-requests-legacy.ts:3590–3608`: PUT geocoding.
- `server/utils/geocoding.ts:41–55`: Google request; `:236–281`: provider sequence.
- `client/src/components/event-requests/form-sections/DeliverySection.tsx`: manual geocode.
- `client/src/components/event-requests/EventMapView.tsx`: search and two-point routing.
- `client/src/components/maps/BaseMapTiles.tsx`: tile provider selection.

These statements describe the app CRUD routes, not every import implementation: a Sheets importer can insert records directly through storage rather than entering the app POST handler.

## 6. Other components that read Event Requests

This is a confirmed set of consumers, not a guarantee that no additional consumer exists.

| Consumer and full path | Dependency on Event Requests |
| --- | --- |
| `client/src/pages/dashboard.tsx` | Event status counts and Event Requests navigation/list integration. |
| `client/src/components/action-center.tsx` | Reads the all-events endpoint alongside collections to build operational actions. |
| `client/src/components/event-calendar-view.tsx` | Reads events for calendar presentation. |
| `client/src/components/event-operational-dashboard.tsx` | Uses event data for operational summaries. |
| `client/src/components/operational-overview.tsx` | Uses event data for operational overview information. |
| `client/src/components/dashboard-overview.tsx` | Event-related dashboard information. |
| `client/src/components/volunteer-opportunities-spotlight.tsx` | Event-linked volunteering opportunities. |
| `client/src/components/sandwich-forecast-widget.tsx` | Event inputs for sandwich forecasts. |
| `client/src/components/staffing-forecast-widget.tsx` | Event inputs for staffing forecasts. |
| `client/src/components/predictive-forecasts.tsx` | Reads all event requests and collections for forecasts. |
| `client/src/components/low-volume-alert.tsx` | Event inputs for low-volume warnings. |
| `client/src/components/organizations-catalog.tsx` | Loads event-request details for an organization. |
| `client/src/pages/event-impact-reports.tsx` | Reads events and associates them with collection/impact data. |
| `client/src/pages/grant-metrics.tsx` | Reads events, including completed-event metrics. |
| `client/src/pages/driver-planning.tsx` | Integrates event driver assignments; also calls an event driver-assignment update endpoint. This is not a read-only relationship. |
| `server/routes/meaningful-analytics.ts` | Queries the event table for analytics. |
| `server/routes/impact-reports.ts` | Reads completed events and their counts/types; some operations also update event records. |
| `server/routes/ai-chat.ts` | Builds contextual summaries from event records. |
| `server/routes/external-event-requests.ts` | External intake application's event reads/updates. |
| `server/services/cron-jobs.ts` | Reads dates/status/assignments/preferences for reminders and follow-up, and updates status during auto-completion. |
| `server/services/email-notification-service.ts` | Reads events and users to construct event-related notifications. |
| `server/routes/planning-sheet-import.ts` / `server/planning-sheet-sync-service.ts` | Compare event records with planning rows and use app data for explicit pushes. |

## 7. Known rough spots and maintenance cautions

These are observations from code, not claims that a particular production incident has been reproduced.

| Rough spot | Evidence and why it matters |
| --- | --- |
| Large active “legacy” route surface | `server/routes/event-requests/index.ts` still mounts `event-requests-legacy.ts`, which contains core operations and several update variants. Modular files do not replace that entire implementation. A change made only in a newer module may miss the live code path. |
| Duplicated update/geocoding behavior | PATCH, PUT, and other update routes repeat address checks, coordinate updates, date handling, contact/toolkit behavior, and notifications. Their behavior can diverge; the repeated geocoding checks are directly visible in the legacy file. |
| Create geocoding is eventually consistent | The create route returns before coordinate persistence. Immediate map/list consumers can receive the new event without coordinates. The inspected callback persists coordinates through storage; an additional coordinate-specific realtime emission was not established **(unverified)**. |
| Some saves depend on external-provider latency | Qualifying save routes await geocoding. The inspected shared geocoder does not show an explicit fetch timeout/cancellation or address cache. This makes address-related save latency dependent on the provider/fallback, unlike ordinary saves. |
| Address/coordinate consistency after failed geocoding | The inspected update blocks only replace coordinates when a result exists; they do not visibly clear old coordinates when an address changes and geocoding fails. An event can therefore retain coordinates that no longer match its address. |
| Missing-coordinate repair depends on the payload | The main PATCH check requires `processedUpdates.eventAddress`. Updating another field does not necessarily repair a coordinate-less event, even when its stored address exists. |
| Intake-sync comments/routes overstate write capability | The sync module describes bidirectional sync, but the service hard-disables to-sheet sync. That disabled behavior is intentional protection, not a task to casually re-enable. |
| Background interval comment is stale | `BackgroundSyncService.start()` has a “5 minutes” comment, while the recurring implementation uses 30 minutes. Follow the executable interval rather than the comment. |
| Intake worksheet configuration is not generalized | The inspected intake service sets its worksheet field to `Sheet1`; no consumption of `EVENT_REQUESTS_SHEET_WORKSHEET_NAME` was established there. A similarly named environment variable elsewhere does not prove it changes this import. |
| Planning push and app flag are not atomic | The push route writes to the external sheet before separately updating the app's official-sheet flag/timestamp. It explicitly tolerates app-flag failure after a successful sheet write and contains a timestamp-column fallback. Sheet/app state can diverge in that failure window. |
| Automatic completion is not proof of delivery/count verification | `autoCompletePassedEvents()` sets status based on a passed scheduled date. It does not establish an actual count or reconcile collection records in the inspected update. Reports should not equate completed status with confirmed production/delivery without checking the relevant data fields. |
| Transition-policy comments can mislead | `shared/event-status-workflow.ts` retains examples of a stricter transition model, while its active transition table allows all other statuses. Read the current table and validation helpers, not just the historical comment examples. |
| Conflict-check errors resemble a clean result in part of the response | `/check-conflicts` returns HTTP 500 on failure but includes `hasConflicts: false` and an empty warnings array. Consumers must honor the error status rather than interpret those fields as successful clearance. |
| Typed PATCH migration is not uniform enforcement | The legacy PATCH route has `EVENT_PATCH_SHADOW_VALIDATION` behavior alongside manual normalization. The existence of `shared/event-request-patch.ts` does not establish that every update variant enforces one identical contract. |
| SMS send permissions are inconsistent across explicit routes | In `server/routes/event-requests/sms.ts`, event-details send requires `EVENT_REQUESTS_VIEW`, while correction send requires `EVENT_REQUESTS_SEND_SMS`. This difference is confirmed and deserves deliberate policy review rather than assuming both routes have the same gate. |
| Scheduling role retirement is incomplete across the surface | The conflict route explicitly does not forward speaker IDs because the speaker role is retired, while legacy event fields and other assignment/reference-data structures still contain speaker-related data. Treat that as a migration boundary; do not infer that every old speaker field remains a supported operational role. |
| Data interpretation spans several sources | Event estimates, actual counts, linked collection logs, and sheet counts are separate inputs used by different consumers. Existing count helpers and the impact-report merge logic demonstrate that these are not interchangeable. Avoid blindly adding them together or double-counting an event and its linked collection. |

### Suggested investigation order for a new developer

Start with the main screen and its context, then follow the specific action through its hook/form to the route mounted in `server/routes/index.ts`. Check whether the route lives in the legacy file or a modular router. For sheet behavior, identify **which sheet** and **which operation** before diagnosing sync. For map behavior, separate **geocoding**, **tiles**, and **directions**: they have different triggers, credentials, fallbacks, and latency characteristics.
