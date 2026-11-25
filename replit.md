# The Sandwich Project — Project Notes

> Working README for the TSP nonprofit platform. The **Critical Rules & Known Fixes**
> section records hard-won technical findings on purpose — keep them so we never
> re-debug the same issue. Add new findings to the matching subsection.

## Overview
Full-stack app for The Sandwich Project nonprofit: streamlines sandwich collections,
donations, and distributions with data management, analytics, and operational tools for
volunteers, hosts, and recipients. Goal is to reduce food waste and hunger. The annual
sandwich goal is runtime-configurable via the `app_settings` table.

## User Preferences
- **Communication**: simple, everyday language.
- **Button labels**: extremely clear about function — e.g. "Enter New Data", never ambiguous "Submit".
- **Forms**: no redundant/confusing fields — e.g. host dialogs use a single "Host Location Name" field, not separate "Name" + "Host Location".
- **Mobile UX is critical**: chat positioning and space efficiency matter; vehicle type is NOT required for new driver entries.
- **Documentation**: record all technical findings and fixes in `replit.md` to avoid re-debugging.
- **Analytics**: NEVER compare or rank hosts against each other. TSP is about growing volunteer turnout globally — remove all "top/underperforming hosts" and similar comparison language.
- **Desktop chat**: proper scrolling without nested scroll containers (which cause page-focus issues); handle desktop vs mobile layouts differently.
- **Mobile header**: progressive hiding by breakpoint — user info hidden < xs (480px), comments button < xs, OnlineUsers < sm (640px); smaller button padding on mobile; header is `overflow-x-hidden` + `max-w-full`.

## System Architecture

**Stack:** React 18 + TypeScript + Vite frontend (TanStack Query, Tailwind/shadcn/ui).
Express.js (TypeScript) backend with Drizzle ORM, PostgreSQL (Neon serverless),
session-based auth. UI follows TSP's official color palette and Roboto typography —
clarity, responsiveness, card-based dashboards.

### UI/UX decisions
- Compact, modern: white cards, colored left borders for status, warm paper-tone background, subtle shadows, strong tonal hierarchy.
- Operational monitoring uses Wednesday–Tuesday week boundaries.
- Collection trends use two-line charts plus summary cards.
- Map markers: purple = recipients, blue = events, green = hosts. "Nearby Recipients" panel shows recipients within 15 miles of a selected event.

### Core features
- **Auth & Permissions**: role-based access control, session management, password security, active-user enforcement (env-var controlled modes).
- **Data Management**: collections, hosts, recipients, users, audit logs; Zod validation, timezone-safe dates, soft deletes. `sandwich_collections` is the source of truth. Totals sum either `jsonb group_collections` OR legacy `group1_count`/`group2_count` — never both (avoids double-counting).
- **Event Requests Management**: requests, duplicates, statuses; Google Sheets integration, van-driver staffing, multi-recipient assignment, intake validation, Leaflet maps with AI assistants, auto-save, corporate/standby follow-ups. (See `EVENT_REQUESTS_RELIABILITY_PLAN_V2.md` for the authoritative, code-verified diagnosis, scope/sequencing, and engine-room bug list.) **Status transitions are UNRESTRICTED (July 2026, user request — the rules blocked real workflows)**: `VALID_STATUS_TRANSITIONS` in `shared/event-status-workflow.ts` is generated allow-all; the old restricted graph is preserved in its doc comment for restoration. Still enforced: reasons for Declined/Cancelled/Non-Event, and an event date for transitions to Scheduled/Rescheduled (PATCH `MISSING_EVENT_DATE` guard + PUT required-fields check — without it, a dateless event could land on the calendar/volunteer hub/reminder queries).
- **Planning Sheet Import (review-first PULL)**: "Import from Planning Sheet" button in the Event Requests toolbar (same gate as Sync: `EVENT_REQUESTS_SYNC` or admin/super_admin, matching `requirePermission(PERMISSIONS.EVENT_REQUESTS_SYNC)` server-side). GET `/api/planning-sheet-import/preview` is READ-ONLY: buckets sheet rows into missing / possible-match / already-in-app (date keys computed in BOTH UTC and ET; name normalize + containment + token-overlap ≥ 0.5; separator/blank rows skipped). POST `/import` creates ONLY human-selected rows — never updates/deletes app events, never writes to the sheet, NO auto-sync (past auto-pulls went awry). Dedup is a hard guarantee via unique `externalId` fingerprint `planning-sheet:<iso-date>:<normalized-name>` + `onConflictDoNothing`; each selection echoes its fingerprint back so rows that shifted position on the sheet between preview and import are skipped ("sheet changed") instead of importing something unreviewed. `googleSheetRowId` stays NULL (avoids intake-sync row-id dedup collision); provenance block written to `planningNotes`; dates stored at UTC noon. Files: `server/routes/planning-sheet-import.ts`, `client/src/components/event-requests/PlanningSheetImportDialog.tsx`. Server-side — requires republish.
- **Messaging & Notifications**: Email (Twilio Email, via `server/services/email`), Socket.IO chat, SMS (Twilio), dashboard notifications. Most outgoing emails also send a separate monitoring copy to `katie@thesandwichproject.org`. Tiered URGENT/IMPORTANT/DIGEST to avoid alert fatigue; SMS batched per user (emails individual); stale-event escalations batched into a weekly admin summary; notification queries exclude inactive event statuses; corporate escalation SMS rate-limited to once/24h per event. SMS opt-in supports 'hosts' (weekly reminders) and 'events' campaigns. Kudos mark-as-read via messaging service.
- **Real-Time Collaboration**: Socket.IO sync, presence tracking, field-level locking, threaded comments, edit revision history, online-presence toasts.
- **Reminders & Follow-ups**: 24h volunteer reminder cron (configurable email/SMS); TSP contact follow-ups for approaching 'in_progress' events and toolkit follow-ups. Standby check-back reminders: the standby dialog offers one-week / specific-date / "No reminder" (date is OPTIONAL — `standbyExpectedDate` cleared to null when declined); a daily 9:30 AM ET cron (`standbyFollowupJob`, prod-only) emails the assigned TSP contact via `processStandbyFollowups()` when the date arrives; dedup is per follow-up date (`sentAt::date >= standbyExpectedDate::date`), so pushing the date forward or re-entering standby re-reminds. `standbyMarkedAt` is stamped server-side on transition INTO standby (both PATCH and PUT) and drives the "on standby since" badge.
- **Other**: sandwich type tracking (individual + group), interactive route map & driver optimization, user activity logging, TSP Holding Zone (inbox-style ideas/tasks, 3-tier permissions), guided tours/onboarding, organization merge tool, email template customization, external API key auth (SHA-256 hashed, role-based), intake workflow app integration, document storage in Replit Object Storage (GCS).
- **App Settings (configurable annual goal)**: key/value `app_settings` table backs runtime config. Annual goal at key `annual_sandwich_goal`; frontend reads via `useAnnualSandwichGoal()` (falls back to `DEFAULT_ANNUAL_SANDWICH_GOAL`). Admin/super_admin/admin_coordinator edit inline on Analytics → Pace & Comparison. Routes: `GET /api/app-settings`, `GET/PATCH /api/app-settings/:key` (PATCH role-gated).
- **Navigation/Analytics layout**: Weekly Collections Report and Group Collections Viewer are sub-items under Collections Log (`client/src/nav.config.ts`). Analytics view has Pace & Comparison (default) and Low/High Weeks tabs.

### Grant Metrics page (`grant-reporting`)
- YoY growth derived from completed annual totals (not hard-coded years); the in-progress year is called out separately.
- Key achievements are a compact highlight row in the YoY section (duplicate hero/volunteer/financial cards removed).
- Volunteer methodology lives in `shared/volunteer-engagement-metrics.ts` (single source of truth; do not duplicate the formulas in components). Metric is **estimated volunteer engagements** — one instance of a person making sandwiches, NOT unique volunteers, because the collection log has no person-level records. Group sandwiches ÷ 22 central (÷25 low / ÷20 high); individual sandwiches ÷ 20 central (÷25 low / ÷20 high) with **no household-size multiplier** — the old "÷20 × 2.5 people per family" assumption was removed as unsupported by TSP data. Volunteer hours are a separate calculation: total sandwiches ÷ 25 per active sandwich-making hour (excludes setup, cleanup, driving, hosting, distribution, admin), and economic value = those hours × the Independent Sector rate. Drivers/host homes/support roles are deliberately NOT added in (overlap + double-count risk). The fixed "4,000+" hero figure is a separately maintained community-network number, not measured annual volunteers.
- Ingredient-cost methodology documents deli (Nature's Own Honey Wheat bread, Kirkland cheddar + deli turkey, sandwich bags) and PB&J (same bread, Jif PB ~2–3 tbsp, jelly ~2 tsp) baselines; food value uses the deli baseline (data lacks a deli/PB&J split).
- Recipient need labeled "Estimated Weekly Bare Minimum Need" (a likely undercount, not a ceiling).
- Group Events stat = average sandwich output per completed group event (NOT social-media engagement/attendance — not reliably recorded).
- Technology value uses number-free language: TSP avoided a substantial custom-software expense via AI-assisted internal development + volunteer labor, while still needing ongoing maintenance/hosting/security/integrations. No firm dollar claims.
- Capacity argument frames grant need as paid coordination capacity (operations, group-event coordination, recipient comms, transport logistics, reporting, tech upkeep, follow-up) plus one additional smaller refrigerated van — NOT a full-time admin, ingredients, office, or sandwich-making staff.

### Volunteer Hub (`client/src/pages/volunteer-event-hub.tsx`)
- Defaults to Calendar; view chooser ordered Calendar, List, Map ("Events" renamed "List"). Calendar uses TSP's warm palette, monthly summary stats, day cards with event/open-spot counts, and a selected-day detail panel with sign-up/assignment actions. Keep plain-language and action-focused for non-technical volunteers.
- Calendar shows ALL upcoming events even when List/Map default to "only events that need help"; fully-staffed events show "Extra help welcome"/needs-met language.
- Banner uses stronger contrast / larger text for readability.
- Permissions are separate toggles: `NAV_VOLUNTEER_HUB` (open page), `EVENT_REQUESTS_SELF_SIGNUP`, `EVENT_REQUESTS_ASSIGN_OTHERS`, `VOLUNTEER_SIGNUP_APPROVE` (manage pending approvals); driver-role approval also needs `DRIVER_SIGNUP_APPROVE`. Shown in the common permissions editor with plain-language labels.
- **Rule**: any Event Management mutation must invalidate BOTH `/api/event-requests*` and `/api/volunteer-hub*` caches, or role needs go stale. The hub API treats an uncovered van-driver requirement as unfilled and hides it once `assignedVanDriverId` or `isDhlVan` is present.

## Critical Rules & Known Fixes

Quick index:
1. Database, Migrations & Runtime
2. Production Resilience — DB blips & app hangs
3. Production CSP & External Embeds
4. Event Save Integrity
5. Email (Twilio Email) & SMS opt-in
6. Documents & Uploads
7. Google Sheets Sync
8. Data Parsing & Reports
9. Messaging — Linked Admin Accounts
10. Team Chat (Stream) — group member editing
11. Traffic Conflict Badges
12. UI — floating help button vs chat send button
13. Code Health Baseline
14. Build Assets & `.gitignore`

> Many prod-only fixes (CSP, proxy, ESM `require`, Twilio image, server code) can ONLY be
> verified on the published app, and most server fixes require a **republish** to take effect.

### 1. Database, Migrations & Runtime
- **Two separate databases** (easy to confuse): the app uses a **Neon** DB via `DATABASE_URL` (`server/db-url.ts` → `getDatabaseUrl()`, branch `dev`). The agent's `executeSql` tool targets Replit's **built-in** Postgres — a DIFFERENT database. **Rule: to change the schema/data the app uses, run SQL via a script importing `getDatabaseUrl()`+`neon()` (like `server/migrate.ts`) or `npm run db:push` — NOT `executeSql`.**
- **Migrations can be multi-statement**: `server/migrate.ts` `splitSqlStatements()` splits on top-level semicolons (respecting quotes/dollar-blocks/comments) and normalizes `--> statement-breakpoint`. **Rule: never assume one statement per file** (Neon's HTTP driver otherwise throws `cannot insert multiple commands into a prepared statement`). `20260526_add_app_settings.sql` was applied manually to dev+prod because broken migration `20260315` blocks the auto-runner.
- **Neon HTTP driver has NO transactions**: `db.transaction()` throws in production. **Rule: never use `db.transaction()` in server code** — use sequential `db.*` calls.
- **SIGTERM exit prevention**: production overrides `process.exit` (to block accidental library exits), which also swallowed `process.exit(0)` in the shutdown handler → ports held forever → EADDRINUSE. **Fix: save `realExit = process.exit.bind(process)` BEFORE the override and use it in the shutdown function.**
- **Dev ports**: `Start application` runs `PORT=5000 npm run start`; `Start Server` runs `npm run dev` on port 3000. Replit proxy forwards the preview to port 5000 (`waitForPort = 5000`). Do NOT bind port 80 (Replit system process); `lsof -ti:80 | xargs kill -9` kills the Node server — avoid it.

### 2. Production Resilience — DB blips & app hangs
- **A brief Neon connection blip can hang the ENTIRE prod app** (not just slow a page). The session store (`connect-pg-simple`) runs on every request over a node-postgres **TCP pool**; its queries have no timeout, so when Neon briefly recycles connections those session lookups hang and stack up until the Node process freezes.
- **Signatures (deploy logs):** `terminating connection due to administrator command`, `read ECONNRESET`, `Client network socket disconnected before secure TLS connection was established` (all on `connect-pg-simple`/`pg-pool`), plus `NeonDbError` / `Error connecting to database: fetch failed` on the HTTP driver. A `Slow request detected ... duration: 60s` often appears right before the logs go silent.
- **What a full hang looks like:** the live site returns nothing — `curl https://tspapp.org/` **times out (HTTP 000)**; deploy logs stop entirely; the periodic "Production heartbeat - uptime" and the hourly `:15` cron stop firing.
- **Confirm it's the app, not the platform/DB:** `getDeploymentInfo()` shows `isDeployed:true`, `hasSuccessfulBuild:true` (build fine), and a prod read-replica `SELECT 1` (`executeSql` `environment:"production"`) succeeds (DB fine). So neither Replit nor Neon is "down" — the app process is wedged.
- **Remedy (this deployment is `vm`/always-on):** a frozen-but-not-crashed process does NOT auto-restart. **Republish** to start a fresh process; with DB + build healthy it recovers immediately. There is no agent tool to restart prod directly — the user must republish.
- **Durable fix (Option A — IMPLEMENTED & LIVE in prod as of 2026-06-26):** the session-store pg Pool is now explicitly configured in `server/routes.ts` (`sessionPool`): `max: 5`, `idleTimeoutMillis: 30s`, `connectionTimeoutMillis: 5s`, `keepAlive` (+10s initial delay), `statement_timeout: 10s`, plus a `sessionPool.on('error')` handler that logs and lets the pool replace the dead client (so an idle-client error can never crash/wedge the process). `createTableIfMissing` is intentionally omitted — the `sessions` table is provisioned by `ensureSessionsTable()` (`server/session-migrate.ts`, schema `sid`/`sess`/`expire`) at startup, so connect-pg-simple never races a `CREATE TABLE` during the very blip we're surviving. Sessions stay in Postgres (users stay logged in across restarts). Rejected alternatives: `@neondatabase/serverless` WebSocket Pool (more change, no real gain on a VM); Redis/in-memory (new infra, or logs everyone out on restart). **Note: this only protects prod after the publish that includes it — verify the latest "Published" commit is a descendant of the change.**
- **Browser-side noise during these events is secondary:** CSP `connect-src` blocks (usually just Google Analytics) and socket.io `ERR_NAME_NOT_RESOLVED` / `ERR_NETWORK_CHANGED` — the socket ones mean the *client's own network* blipped, not a server bug.

### 3. Production CSP & External Embeds
CSP is DISABLED in dev — this class of bug only appears on the published app (Helmet config in `server/index.ts`).
- **Rule: any browser-side `fetch`/PUT to a new external origin must be added to `connectSrc`.** Presigned uploads PUT to `https://storage.googleapis.com/...`; missing it broke uploads ("Failed to fetch"). Downloads stream same-origin via `/api/documents/:id` (covered by `'self'`).
- **Rule: `<object>`/`<embed>` need `object-src` — `'none'` silently shows fallback.** PDF previews use `<object data="/api/documents/:id/preview">`; `objectSrc` is `["'self'"]`.
- **Rule: any new external URL embedded via the `GET /api/proxy/page?url=...` proxy must have its origin added to `ALLOWED_PROXY_ORIGINS` in `server/routes/index.ts`** (else `403 "URL not in allowlist"`). The proxy bypasses upstream `X-Frame-Options` by fetching HTML and injecting `<base>`. Toolkit / Important Links embeds (e.g. Volunteer Handbook `https://tsp-host-handbook-ylfb92u.gamma.site`) flow through it.

### 4. Event Save Integrity
- **Full-form save**: `EventSchedulingForm` sends the entire `buildEventDataForServer()` payload on every save (no change-detection of a subset). This removes the silent-dropped-field bug class at the root — `detectChangedFields` and `ALWAYS_INCLUDE_FIELDS` were deleted (the bug: van flags `vanDriverNeeded`/`isDhlVan`/`selfTransport` dropped by a change-detection race during the SpeakerWarningDialog pause). The old partial/full split is gone: `/api/event-requests/list` returns full event records and the form no longer does a second full-record fetch. Schedule-mode date coupling lives in `buildEventDataForServer` — `scheduledEventDate` is attached only when the resolved status is `scheduled`.
- **Save verification**: the form does NOT treat every 200 as a clean save — after PATCH it checks the server's `_droppedFields` marker. **Only `_droppedFields` blocks completion**: when present, the form stays open, auto-save is preserved, queries refresh, and a sticky "Partial Save - Please Review" warning shows. `findMismatchedSavedFields()` (`form-utils.ts`) is logged as **non-blocking diagnostics only** (it false-positives on routine server transforms, so it must never gate saves). **Rule: quick-edits to `/api/event-requests/:id` must use `patchEventRequestVerified()` (`client/src/lib/event-save-verification.ts`), not raw `fetch`** — it throws a sticky error if the save didn't round-trip; on failure, don't clear edit state. Converted: Driver Planning, Event Map address edits, ScheduledCard, NewRequest confirmation toggles, CompletedCard inline edits.
- **Event list shape**: `/api/event-requests/list` returns full event records. **Rule: do not reintroduce a lightweight allow-list mapper for card fields** — that split caused silent UI drift (e.g. social-media fields saving but badges not flipping).
- **Diff-based save vs explicit clears (fieldOverrides)**: `performSubmit`'s diff-based save omits any key whose value equals the baseline serialization — but keys present in `fieldOverrides` are ALWAYS kept in the payload. This matters for deliberate writes that happen to equal the baseline: e.g. standby "No reminder" sends `standbyExpectedDate: null`, and the baseline (built from the pre-standby snapshot) also computes null, so a plain diff silently dropped the clear and a stale date from a previous standby episode survived to fire a declined reminder. **Rule: any intentional write that may equal the baseline (especially null-clears) must be passed via `fieldOverrides`, and `buildEventDataForServer` overrides must be checked with `'key' in fieldOverrides` (not truthiness) so explicit nulls win.**
- **Timestamp string→Date conversion (standby-save bug, July 2026)**: every client-editable timestamp field on event requests MUST be in `EVENT_REQUEST_TIMESTAMP_FIELDS` (top of `server/routes/event-requests-legacy.ts`, shared by the PATCH and PUT handlers). A field missing from the list reaches Drizzle as a raw string and the ENTIRE save fails with `value.toISOString is not a function` (PgTimestamp.mapToDriverValue). This broke "move to standby" in prod — `standbyExpectedDate` was missing from both (previously separate, drifted) lists; `actualSandwichCountRecordedDate`, `followUpOneDayDate`, `followUpOneMonthDate` had the same latent bug and were added too. The two per-handler lists were consolidated into the one shared constant so they can't drift again. **Rule: when adding a timestamp column that the form sends, add it to `EVENT_REQUEST_TIMESTAMP_FIELDS`.** Server-side — requires republish.

### 5. Email (Twilio Email) & SMS opt-in
- **Twilio Email has no CC, BCC or Reply-To** (moved off SendGrid, Nov 2026). `server/services/email` sends each CC/BCC/admin copy as its own request (de-duplicated, so the old to-vs-bcc collision can't happen), and turns a `replyTo` that isn't the From address into a "To reply, email …" line. Team-member emails send FROM their own @thesandwichproject.org address when they have one (`buildUserSender`). Unsubscribes/bounces live in `email_suppressions`; every email links to the public `/api/email-preferences` page (GET shows, POST changes, so scanners can't unsubscribe anyone).
- **Twilio "EIO: i/o error, read" 500 on `/api/users/sms-opt-in`**: NOT a Twilio API/credentials error and NOT a code bug. The Twilio SDK lazy-`require()`s its resource tree at first use; the stack shows `readFileSync` of a `node_modules/twilio/...` file failing with EIO = a **corrupted/unreadable package file in the deployed image** (dev loads Twilio fine). **Fix: republish for a fresh deploy image; if it recurs across clean republishes, reinstall the `twilio` package.** Note: the opt-in route (`server/routes/sms-users.ts`) sends the confirmation SMS FIRST and only persists `metadata.smsConsent` after it succeeds — so a Twilio send failure blocks opt-in by design (no code = nothing to confirm).

### 6. Documents & Uploads
- **Two-step presigned-URL JSON flow**: POST `/api/documents/request-upload-url`, PUT bytes to the returned `uploadURL`, then POST `/api/documents` JSON with `objectPath` (create returns `{ document }`). **Rule: never POST file bytes to `/api/documents` — that route only accepts JSON metadata.** Files serve from cloud via `/api/documents/:id` with legacy local fallback.
- **Reference Materials** (`client/src/pages/resources.tsx`): "Open" uses `/api/documents/:id/preview` (inline), "Copy link" uses `/:id/download`. Bare `/api/documents/:id` has NO route.
- **Rule: never use `require(...)` in server code** — it only works in dev under `tsx` and throws in the prod ESM bundle (`"type": "module"`, `esbuild --format=esm`, no `createRequire` banner); use top-level ESM `import`. This caused a prod-only 500 on legacy local-file downloads. All `require()` was swept from the server (`storage.ts`, `routes/storage/index.ts`, `monitoring/health-checks.ts`); `rg "require\(" server/` is clean. Local file streams also have `.on('error')` handlers.

### 7. Google Sheets Sync
- Background service with monitoring, alerts, triple dedup, message backfill. Active sheet ID is in the `EVENT_REQUESTS_SHEET_ID` secret — when Squarespace publishes a new sheet, only update the secret (sync reads `A2:K1000`). Manual trigger: `POST /api/google-sheets/event-requests/sync/from-sheets`.
- **Sheet-migration dedup bugs** (fixed in `server/google-sheets-event-requests-sync.ts`): when a new sheet resets row IDs to 1, three false-duplicate paths silently skipped new submissions — (1) cross-sheet row-ID match (fixed with org-name validation), (2) stale carried-over `sheets-import-*` externalIds (fixed with org-name agreement), (3) null-date email-hash match where `null === null` (fixed to not-a-match when either date is missing).

### 8. Data Parsing & Reports
- **Sandwich range parsing**: text like `500-600`, `500 – 600`, `500 to 600`, `500 through 600` is a range stored/reported as the midpoint (`550`), NOT `500600`. Helper: `shared/sandwich-count-utils.ts`. Sheets imports preserve min/max; AI reports and Event Impact Reports use midpoints and ignore suspiciously huge estimated-only counts (50,000+).
- **Event Impact Reports**: current week/month/quarter/year cover the full named period (not year-to-date); "All Time" includes future scheduled events. Scheduled count/filter include both `scheduled` and `rescheduled`. Org categories normalized before filtering/charting/exporting; corporate variants (`corp`, `corporate`, `company`, `small_medium_corp`, `small/medium business`, `large_corp`, `large company`) grouped under `Corporate`.
- **AI Impact Report PDF**: jsPDF Helvetica can't render emoji (mojibake). The route sanitizes AI text to printable ASCII, strips mojibake prefixes, replaces trend emoji with plain labels (`Growth:`, `Seasonal:`), uses an ASCII footer; the prompt also asks for plain text.

### 9. Messaging — Linked Admin Accounts (merged inbox)
- Linked admin accounts share a merged view of messages, kudos, and notifications (shared read/archive/delete), while login/permissions/profile stay separate. Defined in `server/lib/linked-accounts.ts` (`LINKED_ACCOUNT_GROUPS` + `getLinkedUserIds(userId)`; 5-min cache, case-insensitive email match, always includes self). Pattern: recipient/owner-scoped read/count/mutate filters use `inArray(col, linkedIds)`; 403 guards use `linkedIds.includes(...)`. Covered: `messaging-service`, `notifications` (index + actions), `email-service`, `message-notifications`, `email-routes`. **Sent and Drafts stay per-account (NOT merged).**
- **Rule: to add a linked pair, edit only `LINKED_ACCOUNT_GROUPS`; any new recipient/owner-scoped query must use `getLinkedUserIds`+`inArray`, never bare `eq(...userId)`.** Server-side — requires republish.

### 10. Team Chat (Stream) — group member editing
- **Rule: create group chats with an EXPLICIT channel ID, never `undefined`.** A `messaging` channel created with no ID + a member list becomes a Stream "distinct" channel (identity = member set), which rejects `addMembers`/`removeMembers` with error 17. In `server/routes/stream.ts` `POST /channels`, groups (3+ members or any `channelName`) get `group_<random>` IDs; only 1:1 DMs stay distinct (no ID) so a pair reuses one channel. Pre-fix groups are permanently distinct — the members handler returns a plain-language "start a new group" message for error 17. (`client/src/components/group-messaging.tsx` is a separate legacy DB system — unrelated.)

### 11. Traffic Conflict Badges (World Cup / Atlanta)
- Known high-traffic dates live in `shared/traffic-conflicts.ts` (`TRAFFIC_CONFLICTS`, YYYY-MM-DD Eastern). `getTrafficConflictForEvent(...dates)` hits if ANY supplied date matches. **Rule: on event cards pass only the operative date — `[request.scheduledEventDate ?? request.desiredEventDate]`, NOT both** (passing both left a stale badge after an event was rescheduled off a conflict date). Fixed in `ScheduledCardEnhanced`, `NewRequestCard`, `InProcessCard`. (Atlanta 2026 WC semifinal is July 15; final July 19.)

### 12. UI — floating help button vs chat send button
- The `GuidedTour` floating help button (`fixed bottom-4 right-4`) is hidden on sections with a bottom-anchored composer (`HELP_BUTTON_HIDDEN_SECTIONS` in `client/src/pages/dashboard.tsx`: `chat`, `messages`, `inbox`, `stream-messages`, `gmail-inbox`) so it doesn't cover the send button. **Rule: `GuidedTourGate` must check the dashboard's real `activeSection` AND the multi-view panel sections** — in single-view nav the panel state lags `activeSection`, so checking panels alone left the button visible over Team Chat.

### 13. Code Health Baseline (May 2026)
`npm run build` passes; `npm run check` still fails on pre-existing TS debt. Cleanup excluded `*.test.tsx` from app type-check, set TS target `ES2020` (Node 20), routed GA imports through `client/src/lib/analytics`, and hardened shared permission helpers (non-array permission data → no permissions). Remaining debt: Drizzle JSON fields typed `unknown`, oversized event-request card files, storage interface drift, legacy fields.

### 14. Build Assets & `.gitignore` (deploy-build break)
- The vite `@assets/...` alias resolves to `attached_assets/` (vite.config.ts), but `attached_assets/` is gitignored — so logo PNGs imported via `@assets/...` are NOT in version control. Task-agent merges (and any clean checkout) don't preserve untracked-ignored files, so they vanish; the next publish then fails in `vite build` with `[vite:asset] Could not load .../attached_assets/LOGOS/...png: ENOENT` (dev shows `[vite] Pre-transform error: Failed to resolve import "@assets/..."` then exits). **Rule: every asset imported via `@assets/...` at build time MUST be un-ignored in `.gitignore` so it stays tracked** — `attached_assets/*` ignore plus explicit `!` negations (re-include the `LOGOS/` dir before its files). Verify with `git status --porcelain -uall -- attached_assets/` that ONLY the intended small files become tracked (never un-ignore the whole 200MB+ dir).
- Currently tracked logos: `LOGOS/{TSP_transparent.png, Copy of TSP_transparent.png, sandwich logo.png}`, `CMYK_PRINT_TSP-01_1749585167435.png`, `CMYK_PRINT_TSP-01 (2).png`. Find all build-time refs: `rg -oN --no-filename "@assets/[^'\"]+" client/ | sort -u`. (Public-folder assets referenced by URL string are fine gitignored — they serve at runtime, not at build.)

## External Dependencies
- **Database**: `@neondatabase/serverless`, `drizzle-orm`
- **Web framework**: `express`
- **UI/styling**: `@radix-ui`, `tailwindcss`, `lucide-react`, `class-variance-authority`, `shadcn/ui`
- **Data/state**: `@tanstack/react-query`, `react-hook-form`, `zod`
- **Email**: Twilio Email API via `server/services/email` (plain `fetch`)
- **Real-time**: `socket.io`, `socket.io-client`
- **PDF**: `pdfkit`
- **Auth/session**: `connect-pg-simple`
- **File uploads**: `multer`, `@uppy/core`, `@uppy/aws-s3`, `@uppy/dashboard`, `@uppy/react`
- **Cloud storage**: `@google-cloud/storage`
- **Google**: Google Sheets API, Google Analytics
- **Mapping**: `leaflet`, `react-leaflet`, `react-leaflet-cluster`
- **SMS**: `twilio`
