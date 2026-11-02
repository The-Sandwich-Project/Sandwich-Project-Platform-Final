# The Sandwich Project Platform — Developer Overview

> **Status of this doc:** Phase 1 of the onboarding docs. Written 2026-10-07 against `main` at that date.
> Everything here was checked against the code. Anything marked **(unverified)** could not be confirmed from source alone.
> Some earlier `CLAUDE.md` claims were wrong and have been corrected — see [Known discrepancies](#7-known-discrepancies-with-claudemd).

---

## 1. What the app is

The Sandwich Project (TSP) is an Atlanta-based nonprofit fighting food insecurity. Volunteers and community groups make sandwiches, which are collected at host sites and delivered to recipient organizations. This platform is TSP's internal operations app. It handles:

- **Event requests:** groups ask to run a sandwich-making event, and the intake team moves each request from `new` to `completed`.
- **Collections:** the weekly sandwich collection log, which is the single source of truth for all sandwich totals.
- **People:** drivers, hosts, volunteers and recipients.
- **Team communication:** inbox, chat, SMS and kudos.
- **Reporting:** analytics, grant metrics and impact reports.

Most users are TSP staff and volunteers who log in. A few pages are public, mainly SMS opt-in and signup.

---

## 2. Tech stack

| Layer | What's used | Where to look |
|---|---|---|
| **Frontend** | React 18, TypeScript, **wouter** for routing, TanStack Query v5, TailwindCSS 3, shadcn/ui (Radix), Recharts, Leaflet / react-leaflet | `client/src/` |
| **Backend** | Express 4 with TypeScript, run by `tsx` in dev | `server/` |
| **Real-time** | Socket.IO (chat and collaboration), plus a native `ws` WebSocket at `/notifications` | `server/socket-chat.ts`, `server/socket-collaboration.ts`, `server/index.ts` |
| **Database** | PostgreSQL on **Neon**, with a `dev` branch and a `production` branch. Connects through `@neondatabase/serverless` over **HTTP**. | `server/db.ts`, `server/db-url.ts` |
| **ORM** | Drizzle ORM (`drizzle-orm/neon-http`) and drizzle-kit. The schema is one large file. | `shared/schema.ts`, `drizzle.config.ts` |
| **Validation** | Zod, shared by client and server | `shared/` |
| **Auth** | Session-based. Uses `express-session`, sessions stored in Postgres via `connect-pg-simple`, and `bcrypt` password hashes. **Passport is installed but not imported anywhere.** | `server/routes.ts`, `server/auth.ts`, `server/routes/auth/` |
| **Build** | Vite 5 builds the client. esbuild bundles `server/index.ts` and `server/meeting-agenda-pdf-generator.ts` into `dist/`. | `package.json` → `build`, `vite.config.ts` |
| **Hosting** | **Replit.** The deployment target is `gce` (see `.replit`). Express serves both the API and the built frontend on one port. | `.replit`, `.replitdeployconfig` |
| **Testing** | Jest for unit and integration tests, Playwright for e2e | `jest.config*.js`, `tests/`, `e2e/` |
| **CI** | One GitHub Actions workflow. It runs an undefined-reference gate and checks for route-inventory drift. | `.github/workflows/undefined-refs-gate.yml` |
| **Error monitoring** | Sentry, server side only | `server/monitoring/sentry.ts` |

**Common commands:**

```bash
npm run dev     # tsx server/index.ts (NODE_ENV=development)
npm run build   # vite build + esbuild server bundle
npm run start   # node dist/index.js (NODE_ENV=production)
npm run check   # tsc (pre-existing errors exist; see CLAUDE.md)
npm run inventory:routes   # regenerate docs/route-inventory.md (CI checks it)
```

---

## 3. Folder structure

```
client/                  React app (Vite root)
  src/
    App.tsx              Top-level routes. Most features render inside <Dashboard>.
    pages/               ~66 page components
    components/          Feature components. event-requests/ is the biggest.
      ui/                shadcn/ui primitives
    mobile/              Mobile shell at /m/* (mobile/pages/*)
    hooks/  lib/         Custom hooks and utilities (analytics-utils, queryClient, …)
    context/  contexts/  React context providers (two folders; both are in use)
    nav.config.ts        Sidebar icons; the nav items themselves come from shared/nav-catalog.ts

server/
  index.ts               App bootstrap: middleware, CSP, Socket.IO, startup phases
  routes.ts              Session setup, then mounts routes/index.ts
  routes/index.ts        Central router. Nearly every /api/* router is mounted here.
  routes/                ~110 route files and folders, organized by feature
  services/              Business logic, AI services, cron-jobs.ts, email and SMS helpers
  sms-providers/         SMS provider abstraction (Twilio or a custom phone gateway)
  monitoring/            Sentry, health checks, Prometheus-style metrics
  google-sheets-*.ts     Google Sheets integrations (see §6)
  migrate.ts, db-init.ts Migrations that run automatically on boot (see §6)
  legacy-scripts/, scripts/   One-off and maintenance scripts, not part of the running app

shared/                  Code imported by both client and server
  schema.ts              Drizzle tables and Zod schemas (~5000 lines)
  event-status-workflow.ts  Event status transitions
  nav-catalog.ts         Sidebar / navigation definition and permissions
  permission-config.ts   Permission definitions

migrations/              Hand-written SQL migrations. Applied automatically on boot.
archivedmigrations/, drizzle/   Older migration artifacts
tests/, test/, e2e/      Jest and Playwright tests
scripts/                 Dev-DB seed/reset, route inventory, migration verification
docs/                    Docs, including this file and route-inventory.md
attached_assets/, uploads/, exports/, reports/, data/   Committed files: assets, uploads, exports, reports and data
```

Some root-level files are leftovers and not part of the app, for example `main.py` (a Replit "hello world" stub), `create_chart.py` and `wishlisttoolkit.jsx`. Several large planning docs also live at the root: `ARCHITECTURE.md`, `EVENT_REQUESTS_RELIABILITY_PLAN*.md` and `TROUBLESHOOTING.md`.

### How routing works

- **Backend:** `server/routes.ts` mounts `server/routes/index.ts`, and that file `router.use(...)`s almost every feature router. If a route file isn't imported there, it's dead.
- **Frontend:** `App.tsx` defines a few standalone routes such as `/login`, `/photo-scanner`, `/m/*` and `/notifications`. Most features are **sections** of the dashboard. `/dashboard/:section` resolves through a big `switch(section)` in `client/src/pages/dashboard.tsx`.
- **Sidebar:** built from `shared/nav-catalog.ts`. A page can be routed without having a nav entry. Several are reachable only by URL (listed in §4).

---

## 4. Module inventory

**Status legend:**
- **Active:** routed and mounted, linked from the nav, and called by the client.
- **Partial:** some pieces work, while other parts are stubbed, unused or unreachable.
- **Abandoned:** code exists, but nothing reaches it, or it hasn't been touched in a long time and has no callers.

**How status was judged:** whether the route is mounted, whether the client calls it, whether the page is in the nav, and TODO / "coming soon" markers. "Last touched" dates come from the commit history on `main`. Local `git log` is shallow and shows 2026-09-09 for most files, so don't rely on it. A stale date does **not** prove a feature is unused in production.

### Core operations

| Area | Frontend | Backend | What it does | Status |
|---|---|---|---|---|
| **Event requests** | `client/src/components/event-requests/` (cards, tabs, dialogs, `context/EventRequestContext.tsx`) | `server/routes/event-requests/*.ts`, plus `server/routes/event-requests-legacy.ts` (~5400 lines, still mounted via `event-requests/index.ts`) | The core pipeline from intake through scheduling to completion | **Active.** The most-edited area in the repo, changed as recently as 2026-10. The legacy monolith is **still live and still being edited**, so it isn't dead code. |
| **Sandwich collections** | `components/sandwich-collection-log.tsx`, `components/sandwich/`, mobile `/m/collections` | `server/routes/collections/`, `import-collections.ts`, `collection-favorites.ts` | Weekly collection log and the source of every sandwich total | **Active** (changed 2026-09-28) |
| **Drivers** | `components/drivers-management-simple.tsx`, `components/drivers/` | `server/routes/drivers.ts` | Driver records and availability | **Active.** In the nav and heavily called. Statuses are moved by a nightly cron. |
| **Driver planning** | `pages/driver-planning.tsx`, `mobile/pages/mobile-driver-planning.tsx` | Reuses the event-requests, drivers and `directions.ts` APIs | Weekly driver assignment | **Active** (changed 2026-09/10) |
| **Hosts** | `components/hosts-management-consolidated.tsx` | `server/routes/hosts.ts` | Collection host sites and contacts | **Active.** Host availability is also scraped weekly (see §6). |
| **Recipients** | `components/recipients-management.tsx`, `components/recipients/` | `server/routes/recipients.ts`, `recipient-tsp-contacts.ts` | Organizations that receive sandwiches | **Active** |
| **Volunteers** | `components/volunteer-management.tsx` | `server/routes/volunteers.ts` | Volunteer records | **Active** |
| **Volunteer Event Hub** | `pages/volunteer-event-hub.tsx` | `server/routes/volunteer-event-hub.ts` | Volunteers sign up for roles at events (intended to replace SignUpGenius) | **Active.** In the nav, permission-gated, changed 2026-09-23. Requires login; there is no public page yet. |
| **Organizations** | `components/organizations-catalog.tsx`, `pages/admin/organizations-merge.tsx` | `routes/collections/groups-catalog.ts`, `organizations-admin.ts`, `event-requests/organizations.ts`, `services/organizations/` | Group catalog, returning-org detection, merge tool | **Active** |
| **Event reminders / check-ins** | `components/event-reminders-management.tsx`, `check-in-reminder-preferences.tsx` | `routes/event-reminders.ts`, `event-check-in-reminders.ts`, `services/check-in-reminder-service.ts` | Per-event reminder rules set by TSP contacts | **Active**, but there's no sidebar item (URL `/event-reminders` only) |
| **Planning sheet proposals** | `pages/planning-sheet-proposals.tsx`, `propose-to-sheet-button.tsx` | `routes/planning-sheet-proposals.ts`, `planning-sheet-import.ts`, `server/planning-sheet-sync-service.ts` | Propose and review edits to the Google planning sheet | **Partial.** The backend is active (changed 2026-09-19), but the review page has no nav entry. Direct writes to the sheet are hard-blocked by `server/sheets-write-guard.ts` (see §6). |

### Users, permissions and admin

| Area | Frontend | Backend | What it does | Status |
|---|---|---|---|---|
| **Users / auth / permissions** | `components/user-management-redesigned.tsx`, `user-management/`, `clean-permissions-editor.tsx`; pages `login`, `signup`, `forgot-password`, `reset-password`, `set-password`, `pending-approval` | `routes/auth/`, `routes/users/`, `signup.ts`, `password-reset.ts`, `permission-requests.ts`, `me.ts`, `nav-user-view.ts`; `shared/permission-config.ts` | Session login, admin approval of new users, granular permissions | **Active** |
| **Admin / audit / monitoring** | `pages/admin-settings.tsx` (tabs: audit logs, error logs, issue reports, SMS/toll-free, volunteer signups, nav user view, …) | `routes/core/admin.ts`, `audit-logs.ts`, `error-logs.ts`, `user-issue-reports.ts`, `monitoring.ts`, `app-settings.ts`, `feature-flags.ts` | Admin tooling | **Active.** The pages `performance-dashboard`, `data-management` and `cleanup-audit` are URL-only. `cleanup-audit` is likely abandoned (untouched since 2025-10). |
| **Onboarding** | `GuidedTour.tsx`, `FirstLoginTourPrompt.tsx`, `hooks/useOnboarding.ts`, `admin-onboarding-kudos.tsx`, `pages/onboarding-admin.tsx` | `routes/onboarding.ts`, `services/onboarding-service.ts` | Guided tours and onboarding challenges | **Partial.** Tours and tracking work. The user-facing challenge UI (`onboarding-challenge.tsx`) is only imported by an unused button. `routes/onboarding-admin.ts` is **not mounted**. |

### Maps

| Area | Frontend | Backend | What it does | Status |
|---|---|---|---|---|
| **Event map** | `pages/event-map.tsx`, `components/maps/` | `routes/event-map.ts`, `map-tiles.ts`, `directions.ts` | Map of events with Google tiles, directions and geocoding | **Active** |
| **Locations / route map** | `pages/route-map.tsx` (sections `route-map`, `recipient-map`) | `routes/routes.ts` (`/api/routes`) | Combined map of hosts and recipients | The page is **Active**. The `/api/routes` route-optimization backend is **Abandoned**: no client calls, untouched since 2025-10. |

### Communications

| Area | Frontend | Backend | What it does | Status |
|---|---|---|---|---|
| **Inbox / messaging** | `components/gmail-style-inbox.tsx` (`/messages`, `/inbox`) | `routes/messaging.ts`, `email-routes.ts`, `email-drafts.ts`, `message-notifications.ts` | Internal mail-style messaging | **Active.** `pages/messaging-inbox.tsx` is URL-only. `server/routes/messaging/index.ts` is **dead**: `./messaging` resolves to `messaging.ts` first, so the folder version never loads. |
| **Team chat (Stream)** | `components/stream-chat-rooms.tsx`, mobile `/m/chat` | `routes/stream.ts` | Group chats and DMs through GetStream | **Active** (in the nav) |
| **Instant messages / presence** | `contexts/instant-messaging-context.tsx`, `online-users.tsx` | `routes/instant-messages.ts`, `server/socket-chat.ts`, `server/socket-collaboration.ts` | 1:1 messages, online presence, live event-editing locks | **Active.** The Socket.IO **floating chat windows** (`components/chat/`, `hooks/useSocketChat.ts`) are mounted, but nothing ever opens one, so that piece is **Abandoned** (moderate confidence, not run-tested). |
| **Email templates** | `pages/admin/email-templates.tsx`, `user-email-templates-settings.tsx`, `event-email-composer.tsx` | `routes/email-templates.ts`, `user-email-templates.ts` | Templated outbound email | **Active.** The admin page is URL-only. |
| **SMS** | `pages/sms-opt-in.tsx`, `sms-signup.tsx`, `sms-verification-docs.tsx` (public), `quick-sms-links.tsx`, `sms-test-panel.tsx` | `routes/sms-users.ts` (including Twilio webhooks), `sms-testing.ts`, `sms-announcement.ts`, `quick-sms.ts`, `event-requests/sms.ts`, `server/sms-service.ts` | SMS opt-in, alerts, texting in collection counts | **Active** |
| **Kudos** | `kudos-inbox.tsx`, `kudos-team-feed.tsx`, `send-kudos-button.tsx` | `/api/messaging/kudos/*`, `/api/emails/kudos` | Peer recognition | **Active.** `routes/shoutouts.ts` (`/api/shoutouts`) is mounted but no client code calls it, so it is **Abandoned**. |
| **Announcements** | `announcement-banner.tsx` | `routes/announcements.ts` | Site-wide banners | **Active** (untouched since 2025-10) |
| **Notifications** | `pages/notifications.tsx`, `enhanced-notifications.tsx`, `alert-preferences/` | `routes/notifications/`, `services/notifications/` | In-app notifications and alert preferences | **Active.** A/B testing is an unfinished TODO (`routes/notifications/smart.ts`). `NotificationAnalyticsDashboard.tsx` and `notification-preferences.tsx` are never imported. |

### AI tools

> **Note:** Most AI features use **OpenAI**, not Claude. Only one file uses the Anthropic SDK. See §5.

| Area | Frontend | Backend | What it does | Status |
|---|---|---|---|---|
| **AI chat** | `components/floating-ai-chat.tsx` (embedded in many pages) | `routes/ai-chat.ts` | Context-aware assistant | **Active** |
| **AI analyst** | `components/ai-analyst.tsx` (an Analytics tab, gated by `canUseAiAnalyst`) | `routes/ai-analyst.ts`, `services/ai-analyst*.ts` (includes a SQL guard) | Natural-language questions turned into read-only SQL | **Active** (changed 2026-09-16) |
| **Intake assistant / date suggestions** | `event-requests/dialogs/AiIntakeAssistantDialog.tsx`, `AiDateSuggestionDialog.tsx` | `routes/event-requests/ai.ts` → `services/ai-intake-assistant`, `ai-scheduling` | AI help during intake | **Active** |
| **AI categorization** | Buttons in `data-management-dashboard.tsx`, `event-impact-reports.tsx` | `services/ai-organization-categorization` (via `routes/core/admin.ts`); `services/ai-event-categorization` (via `event-requests/ai.ts`) | Categorizes organizations and events | **Partial.** Organization categorization is used. The per-event `ai-categorize` endpoint has no client caller. |
| **Impact reports** | `pages/event-impact-reports.tsx` | `routes/impact-reports.ts`, `services/ai-impact-reports` | AI-written impact reports, plus a monthly cron | **Active** |
| **Predictions** | `predictive-forecasts.tsx`, `sandwich-forecast-widget.tsx`, `staffing-forecast-widget.tsx` | `routes/predictions.ts`, `services/ai-predictions` | Demand forecasting | **Partial.** The UI computes forecasts **in the browser**, and no client code calls `/api/predictions`. The AI service is still used by the monthly prediction-alert cron. |
| **Photo scanner** | `pages/photo-scanner.tsx` (`/photo-scanner`, `/m/photo-scanner`) | `routes/photo-scanner.ts`, `services/signin-sheet-parser.ts` | Reads a photo of a sign-in sheet into collection data (Claude vision) | **Active** |
| **Receipt processor** | none | `routes/expenses.ts` `/process-receipt` → `services/ai-receipt-processor` | Receipt OCR | **Partial.** Backend only; the expense UI never calls it. |
| **Smart search** | `SmartSearch.tsx` (command palette, top search), `pages/smart-search-admin.tsx` | `routes/smart-search.ts`, `services/smart-search.service.ts` | Feature search using OpenAI embeddings | **Active** |
| **AI alert generator** | none | `routes/alert-requests.ts` | Generates alert text | **Abandoned / no UI.** No client caller. |

### Planning, reporting and resources

| Area | Frontend | Backend | What it does | Status |
|---|---|---|---|---|
| **Analytics / dashboards / grant metrics** | `pages/analytics.tsx`, `impact-dashboard.tsx`, `grant-metrics.tsx`, `weekly-collections-report.tsx`, `group-collections-viewer.tsx`, `components/dashboard-overview.tsx` | `routes/reports/`, `meaningful-analytics.ts`, `group-engagement.ts`, `mobile-dashboard.ts`; client math in `lib/analytics-utils.ts` | Reporting on collections and events | **Active** |
| **Meetings / agendas** | `components/enhanced-meeting-dashboard.tsx`, `components/meetings/` | `routes/meetings/index.ts`, `agenda-items.ts`, `meeting-notes.ts`, `server/meeting-agenda-pdf-generator.ts` | Meetings, agendas, notes, PDF agendas | **Active but quiet** (UI last changed 2026-03). `server/routes/meetings.ts` and `client/src/pages/meetings.tsx` are **dead**: never imported. |
| **Projects / tasks** | `components/projects/`, `pages/project-detail-clean.tsx` | `routes/projects/`, `routes/tasks/` | Project management. Edits push to the Projects Google Sheet. | **Active but quiet** (2026-01 to 03). `GET /api/projects/:id/files` always returns `[]` (a TODO). |
| **Holding zone / team board** | `pages/HoldingZone.tsx` (`/team-board`), mobile `/m/holding-zone` | `routes/team-board.ts`, `holding-zone-categories.ts`, `holding-zone-collaboration.ts` | Ideas and to-dos board | **Active.** The "Manage Categories" dialog says "coming soon", even though the API exists. |
| **Work logs** | `pages/work-log.tsx` | `routes/work-logs.ts` | Volunteer hours and timers | **Active.** The most recent work in the repo (2026-10). |
| **Service hours** | `pages/generate-service-hours.tsx` | `routes/service-hours.ts`, `services/service-hours-pdf-generator.ts` | Service-hours PDF letters | **Active** (untouched since 2025-12) |
| **Calendars / availability** | `pages/yearly-calendar.tsx`, `my-availability.tsx`, `team-availability.tsx`, `google-calendar-availability.tsx` | `routes/yearly-calendar.ts`, `availability.ts`, `tracked-calendar.ts`, `google-calendar.ts` | Calendars and availability | **Active** |
| **Expenses** | `pages/ExpensesPage.tsx`, `components/expenses/` | `routes/expenses.ts` | Expense and receipt submission | **Active** (untouched since 2026-01) |
| **Documents / resources / links** | `pages/resources.tsx`, `important-links.tsx`, `important-documents.tsx`, `governance.tsx`, `flyers.tsx`, `logos.tsx`, `components/document-management.tsx` | `routes/documents.ts`, `resources.ts`, `dashboard-documents.ts`, `objects.ts`, `storage/`, plus `/api/proxy/page` | Document library and toolkit (including embedded external pages) | **Active.** The document permissions and access-log endpoints are stubs ("coming soon", `routes/documents.ts`). |
| **Host resources** | `pages/host-resources.tsx` | `routes/host-resources.ts` | Host-facing content | **Active** |
| **Coolers** | `pages/cooler-tracking.tsx` | `routes/coolers.ts` | Cooler inventory | **Active** (untouched since 2025-11) |
| **Donation tracking** | `components/donation-tracking.tsx` | `routes/sandwich-distributions.ts` | Sandwich distribution tracking | **Active** (route untouched since 2025-10) |
| **Promotion graphics** | `pages/promotion-graphics.tsx` | `routes/promotion-graphics.ts` | Social media graphics library | **Active** (untouched since 2025-12) |
| **Wishlist** | `pages/wishlist.tsx` (items are hardcoded) | `routes/wishlist.ts` | Donation wishlist | The page is **Active** as static content. The backend is **Abandoned**: no client calls. |
| **Google Sheets viewer** | `pages/google-sheets.tsx`; the `events` nav item uses `events-viewer.tsx` | `routes/google-sheets.ts` | Embedded and synced sheets | The sync is **Active** (§6). The standalone `google-sheets` page is **likely abandoned**: no nav entry, untouched since 2025-10. |
| **Mobile app** | `client/src/mobile/pages/*` (`/m/*`) | `routes/mobile-dashboard.ts` | Mobile shell | **Active** but mostly unchanged since 2025-12 |

### Dead or unreachable code (good cleanup candidates)

- **Route files not mounted:** `server/routes/meetings.ts`, `server/routes/onboarding-admin.ts`, `server/routes/messaging/index.ts` (shadowed by `messaging.ts`)
- **Mounted but never called by the client:** `/api/activities` (behind the `unified-activities-read` DB feature flag, which defaults to off), `/api/predictions`, `/api/alert-requests`, `/api/wishlist-*`, `/api/shoutouts`, `/api/routes`, `/api/versioning`
- **Pages never routed:** `pages/meetings.tsx`; `pages/landing.tsx` is imported but never routed (unauthenticated `/` redirects to `/login`)
- **Components never imported:** about 25 top-level components, for example `meeting-agenda.tsx`, `meeting-minutes.tsx`, `weekly-impact-report.tsx`, `sms-announcement-modal.tsx`, `kudos-login-notifier.tsx`
- **Unused server modules:** `server/services/geocoding-service.ts`, `server/google-sheets-meeting-export.ts`, `server/operations/backup-manager.ts`, `scheduleWeeklyMonitoring()` in `server/weekly-monitoring.ts`
- **Broken link:** `components/dashboard-overview.tsx` links to `/important-documents`, which isn't a route. It should probably be `/dashboard/important-documents`.

**Caveat:** "never called" means no literal `/api/<prefix>` string appears in `client/src`. An endpoint hit through a dynamically built URL, or by an external caller, would be missed.

---

## 5. External services

Env var **names** only. Values live in Replit Secrets. `.env.example` lists only some of these.

| Provider | What it's used for | Modules / files | What triggers calls | Env vars |
|---|---|---|---|---|
| **Neon (Postgres)** | Primary database and session store | `server/db.ts`, `server/db-url.ts`, `server/migrate.ts`, `server/services/ai-analyst-query-runner.ts`; sessions via `connect-pg-simple` in `server/routes.ts` | Every request; migrations on startup | `DATABASE_URL`, `DEV_DATABASE_URL`, `PRODUCTION_DATABASE_URL` |
| **SendGrid** | All outbound email | `server/sendgrid.ts`, `server/services/sendgrid.ts`, `server/services/email-notification-service.ts`, `event-notification-dispatcher.ts`, `weekly-digest-service.ts`, `check-in-reminder-service.ts`, `prediction-alert-service.ts`, `application-error-logger.ts`, `background-sync-service.ts`; routes `password-reset.ts`, `auth/`, `volunteer-event-hub.ts`, `email-routes.ts`, `shoutouts.ts` | User actions (password reset, hub signups, event emails, kudos, @mentions); cron digests and alerts (§6); sync-failure alerts | `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_TOOLKIT_BCC`, `FROM_EMAIL`, `NOTIFICATION_FROM_EMAIL`, `ADMIN_EMAIL` |
| **Twilio** | SMS out, SMS/MMS in, toll-free verification | `server/sms-service.ts` (SDK plus raw REST for phone numbers and toll-free verification), `server/sms-providers/twilio-provider.ts`, `routes/sms-users.ts`, `quick-sms.ts`, `sms-announcement.ts`, `sms-testing.ts`, plus several services | User actions (opt-in, quick SMS, announcements); cron (admin SMS pulse, check-in reminders); **inbound webhooks** (§6) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SMS_PROVIDER` |
| **Replit Twilio connector** | Alternative way to get Twilio credentials; preferred when available | `server/sms-providers/replit-twilio-connector.ts` | SMS provider initialization at startup | `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL` |
| **Custom phone SMS gateway** | Alternative SMS provider when `SMS_PROVIDER=phone_gateway` | `server/sms-providers/phone-gateway-provider.ts`, `provider-factory.ts` | Same as Twilio, when selected | `PHONE_GATEWAY_URL`, `PHONE_GATEWAY_API_KEY`, `PHONE_GATEWAY_DEVICE_NUMBER`, `PHONE_GATEWAY_TIMEOUT`. **Which service sits behind the URL is (unverified).** |
| **OpenAI (via Replit AI Integrations proxy)** | Most AI features: gpt-5 and gpt-5-mini | `routes/ai-chat.ts`, `ai-analyst.ts`, `impact-reports.ts`; `services/ai-impact-reports`, `ai-receipt-processor`, `ai-scheduling`, `ai-intake-assistant`, `ai-event-categorization`, `ai-predictions`, `ai-organization-categorization`, `integration-health.ts` | User actions in those features; monthly impact-report and prediction-alert crons; daily health check | `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`. That the proxy forwards to OpenAI is inferred from the SDK and var names **(unverified)**. |
| **OpenAI (direct key)** | SMS collection parsing, alert generation, smart-search embeddings (`text-embedding-3-small`) | `services/sms-collection-parser.ts`, `routes/alert-requests.ts`, `services/smart-search.service.ts` (constructed in `routes/index.ts`), `integration-health.ts`; manual scripts in `server/scripts/` | Inbound SMS webhook; smart-search queries and embedding regeneration; alert endpoint | `OPENAI_API_KEY` |
| **Anthropic (Claude)** | Vision parsing of sign-in sheet photos | `server/services/signin-sheet-parser.ts`, the **only** Anthropic SDK user | `/api/photo-scanner/*`; MMS photos arriving on the Twilio webhook | `ANTHROPIC_API_KEY` |
| **Google Sheets API** (service account) | Event-requests sheet (read), planning sheet (read; writes blocked), Projects sheet (write), Error Log sheet (append) | `server/google-sheets-event-requests-sync.ts`, `planning-sheet-sync-service.ts`, `google-sheets-service.ts`, `google-sheets-sync.ts`, `services/error-log-sheet-sync.ts`, `sheets-write-guard.ts`, `routes/google-sheets.ts` | 30-minute background sync, Apps Script webhook, project edits, error logging, manual routes (§6) | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_PROJECT_ID`, `EVENT_REQUESTS_SHEET_ID`, `PLANNING_SHEET_ID`, `PLANNING_SHEET_WORKSHEET_NAME`, `PROJECTS_SHEET_ID`, `PROJECTS_WORKSHEET_NAME`, `GOOGLE_SPREADSHEET_ID`, `GOOGLE_WORKSHEET_NAME`, `ERROR_LOG_SHEET_ID`, `ERROR_LOG_WORKSHEET_NAME` |
| **Google Calendar API** | Read-only calendar events | `server/google-calendar-service.ts` and `routes/google-calendar.ts` (calendar ID hardcoded); `routes/ai-chat.ts` (uses Application Default Credentials) | Opening the Google Calendar availability page; AI chat building calendar context | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`. Whether the AI-chat ADC path works on Replit is **(unverified)**. |
| **Google Maps Platform** | Map tiles, directions, geocoding | `services/google-map-tiles.ts` and `routes/map-tiles.ts`; `routes/directions.ts`; `server/utils/geocoding.ts` | Viewing maps; `POST /api/directions` from the event map and driver planning; creating or editing addresses (hosts, drivers, recipients, volunteers, users, event requests) and the event-request sync | `GOOGLE_MAPS_API_KEY`, `GOOGLE_GEOCODING_API_KEY` |
| **OSRM** (public demo server) | Fallback for directions | `routes/directions.ts` | When `GOOGLE_MAPS_API_KEY` is missing | none |
| **Nominatim / OpenStreetMap** | Fallback geocoder | `server/utils/geocoding.ts`; background geocoding batch in `routes/event-map.ts` | When Google geocoding fails or isn't configured | none |
| **CARTO basemaps, cdnjs, GitHub raw** (client) | Fallback map tiles and Leaflet marker icons | `components/maps/BaseMapTiles.tsx` and the map pages | Rendering maps | none |
| **Replit Object Storage** (Google Cloud Storage via the Replit sidecar) | File uploads and downloads | `server/objectStorage.ts` and `server/replit_integrations/object_storage/` (two near-duplicate implementations); routes `objects.ts`, `documents.ts`, `expenses.ts`, `messaging.ts`, `promotion-graphics.ts`; the client PUTs to signed URLs | Uploading documents, receipts, attachments, graphics | `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` |
| **Stream (GetStream Chat)** | Team chat rooms and DMs | `server/routes/stream.ts` (issues tokens); client `components/stream-chat-rooms.tsx`, `hooks/useStreamChatUnread.ts` connect directly to Stream | Opening chat; polling unread counts | `STREAM_API_KEY`, `STREAM_API_SECRET` |
| **Sentry** | Server error and performance monitoring | `server/monitoring/sentry.ts` (initialized at top of `server/index.ts`), plus other `server/monitoring/*` | Errors and traces at runtime | `SENTRY_DSN`, `SENTRY_RELEASE` |
| **Google Analytics (gtag)** | Page analytics | `client/src/lib/analytics.ts` (`initGA` in `App.tsx`), `hooks/usePageAnalytics.ts` | Page views and events in the browser | `VITE_GA_MEASUREMENT_ID` |
| **GitHub Pages site** (`the-sandwich-project.github.io`) | Host availability is **scraped** from a collection-sites page | `server/services/host-availability-scraper.ts`; triggered from cron and `routes/hosts.ts` | Weekly cron; manual `/scrape-availability` | none |
| **Allowlisted page proxy** | Server fetches external pages so they can be iframed despite `X-Frame-Options` | `/api/proxy/page` in `server/routes/index.ts` (allowlist: the GitHub Pages site, a Replit receipt app, a Lovable donor app, the Gamma host handbook) | Viewing embedded toolkit and links pages | none |

**Links or iframes only (no API calls):** SignUpGenius, Gamma, Google Docs and published Sheets, Lovable apps. They appear in `shared/nav-catalog.ts`, `pages/important-links.tsx` and similar files.

**Installed but never imported:** `@slack/web-api`, `passport` / `passport-local`, `openid-client`, `@google-cloud/local-auth`, and `@uppy/*` (only a type import). `SLACK_BOT_TOKEN`, `GOOGLE_SHEETS_CREDENTIALS` and `GOOGLE_CALENDAR_CREDENTIALS` are only existence-checked in `server/monitoring/health-checks.ts`. Nothing actually uses them. There is **no Slack alerting**; alerts go out by email and to the Error Log sheet.

**Look-alike env vars that are not third-party keys:**
- `GOOGLE_SHEETS_API_KEY` is an **inbound** shared secret for an import endpoint in `event-requests-legacy.ts`.
- `SHEETS_WEBHOOK_SECRET` authenticates the Apps Script webhook.

**Other app config vars:** `SESSION_SECRET`, `NODE_ENV`, `APP_ENV`, `PORT`, `PUBLIC_APP_URL`, `APP_URL`, `CLIENT_URL`, `ALLOWED_ORIGINS`, `REPLIT_DEPLOYMENT`, `REPLIT_DOMAIN`, `REPLIT_DEV_DOMAIN`, `REPL_ID`, `REPL_OWNER`, `REPL_SLUG`, `REPL_URL`, `LOG_LEVEL`, `DISABLE_LOGIN_RATE_LIMIT`, `EVENT_PATCH_SHADOW_VALIDATION`, `DEFAULT_ADMIN_PASSWORD`, `DEFAULT_COMMITTEE_PASSWORD`, `DEFAULT_DRIVER_PASSWORD`, `VITE_SOCKET_POLLING_ONLY`.

> ⚠️ **Security note for maintainers:** `server/routes/google-sheets.ts` has a hardcoded Google service-account credential block inside the `POST /api/google-sheets/test-direct-auth` route. It includes a key ID and a partial private key; the PEM is truncated in source. Treat that service account as exposed: rotate the key and remove the route. No values are reproduced here.

---

## 6. Background jobs, syncs and webhooks

There is **no job queue** (no Bull, BullMQ, Agenda or pg-boss). Everything runs in-process on the single Express server. If the server restarts, in-memory timers are lost.

### Startup sequence (`server/index.ts`)

1. The port opens and health routes go live (`/healthz`, `/health`, `/api/health`).
2. **Phase 1:** routes, Socket.IO (`/socket.io/` and the `/collaboration` namespace), and the native WebSocket at `/notifications`.
3. **Phase 2.** Each step is wrapped so that one failure doesn't stop the others:
   1. `initializeDatabase()` (`server/db-init.ts`):
      - **Runs any `.sql` file in `/migrations` that isn't yet recorded in the `_migrations` table** (`server/migrate.ts`). This happens in every environment, including production.
      - Then runs a schema-drift check and makes sure the `sessions` table exists.
   2. SMS provider initialization.
   3. Google Sheets auth check. If it fails, admins are alerted.
   4. `startBackgroundSync()`, the 30-minute Sheets sync (below).
   5. `initializeCronJobs()`.
   6. Metrics updates every 5 minutes.

Because Neon's HTTP driver has no transactions, a migration that fails partway can leave some statements applied. **Write migrations idempotently** (`IF NOT EXISTS`, and so on).

### Cron jobs (`server/services/cron-jobs.ts`, node-cron, `America/New_York`)

"Prod only" means the job body returns early unless `NODE_ENV=production`.

| Job | Schedule (ET) | What it does | Gate |
|---|---|---|---|
| Host availability scraper | Mon 1:00 PM | Scrapes the GitHub Pages collection-sites page and updates host availability | none (runs in dev too) |
| Monthly impact report | 1st of the month, 9:00 AM | Generates last month's AI impact report (OpenAI) | none |
| Auto-complete past events | Daily 12:05 AM | Moves scheduled/rescheduled events whose date has passed to `completed` | none |
| Driver availability transitions | Daily 12:10 AM | Moves drivers to unavailable or pending check-in based on dates | none |
| Weekly digest | Mon 8:00 AM | Emails each TSP contact a digest of their events | prod only |
| Admin weekly digest | Sun 6:00 PM | Admin summary email | prod only |
| Admin SMS pulse | Mon 8:00 AM | Admin summary text | prod only |
| Prediction alert | 1st of the month, 10:00 AM | AI demand forecast; emails if demand is ±30% vs. the 12-month average | prod only |
| Check-in reminders | Hourly at :15 | Sends the per-event reminders TSP contacts turned on | prod only |
| Standby follow-ups | Daily 9:30 AM | Emails the TSP contact when a standby event's check-back date arrives | prod only |
| Integration health check | Daily 6:00 AM | Live-checks OpenAI, SendGrid, Twilio, Sentry, Anthropic and the Projects sheet | none |
| Daily error digest | Daily 7:05 AM | Emails a roll-up of the last 24h of errors (skipped if there are none) | prod only |
| Collective Learning auto-log | Daily 6:20 PM | Logs the standing weekly PBJ count for Collective Learning (default 250, dated the week's Wednesday) unless that week has an override, a real log, or is a holiday week. Idempotent. Controls + overrides are a card on the Collections page (`services/collections/collective-learning-auto-log.ts`) | prod only |

**"Disabled" jobs:** volunteer reminders, past-date notifications, TSP follow-ups, corporate follow-ups, corporate 24h escalation, event approaching, weekly contact reminder.
- These pass `{ scheduled: false }`, but **node-cron 4.x ignores that option**: `schedule()` always starts the task, and `TaskOptions` has no `scheduled` field. So they **do fire**.
- Their bodies only write a "DISABLED" log line, so nothing is sent. They are effectively no-ops that add log noise.
- If you ever restore a real body, it will run immediately on its schedule.

### Interval loops

| Loop | Interval | What it does | Started? |
|---|---|---|---|
| **Background Sheets sync** (`server/background-sync-service.ts`) | First run 45s after boot, then every 30 min | Reads the **Event Requests sheet** into the DB, then auto-transitions past events. Emails an admin after 3 failures or 60 min without a successful sync. | Yes, but it skips if the event-requests sheet env vars are missing. `syncProjects()` is defined and **never called**. |
| Production heartbeat | 60s | Log line; prod only | Yes |
| Business metrics | 5 min | Updates active-user and active-session counts | Yes |
| Socket collaboration cleanup | 30s / 60s | Clears stale presence and expired edit locks | Yes |
| In-memory cache sweeps (`device-presence.ts`, `middleware/activity-logger.ts`, `performance/query-optimizer.ts`) | 5 min | Cache cleanup | Yes, when the module is first imported |
| Weekly monitoring (`server/weekly-monitoring.ts`) | hourly check | Missing-submission emails | **No.** `scheduleWeeklyMonitoring()` is never called. It can only be run manually via the monitoring route. |
| Backup manager (`server/operations/backup-manager.ts`) | daily 2 AM | Backups | **No.** Dead code. |

**Per-request in-memory timers (lost on restart):**
- Email fallback for unread messages after 30 minutes (`services/messaging-service.ts`)
- Scheduled notification delivery (`services/notifications/smart-delivery.ts`)
- Background geocoding batches, about 1 request/sec (`routes/event-map.ts`)

### Google Sheets: direction of each sync

`server/sheets-write-guard.ts` **hard-blocks writes** to the event-requests and planning sheets. It only allows the `projects-sync`, `meeting-export` and `error-log-sync` writers.

| Sheet | Direction | Triggered by |
|---|---|---|
| Event Requests (`EVENT_REQUESTS_SHEET_ID`) | **Sheet → DB** (read only) | 30-minute background sync; the Apps Script webhook; manual routes in `routes/event-requests/sync.ts` |
| Planning sheet (`PLANNING_SHEET_ID`) | **Read only** (write calls exist but are blocked by the guard) | User actions in planning-sheet proposals and import routes. Nothing scheduled. |
| Projects (`PROJECTS_SHEET_ID`) | **DB → Sheet** | Fires automatically when a project or task is updated; manual `/api/google-sheets/projects/...` routes. Not on the 30-minute timer. |
| Error Log (`ERROR_LOG_SHEET_ID`) | **Append** | Every server error or critical log, client error report, and user issue report |

### Inbound webhooks

| Endpoint | Caller | Auth | What it does |
|---|---|---|---|
| `POST /api/sms/webhook` (`routes/sms-users.ts`) | Twilio inbound SMS/MMS | Twilio signature (`X-Twilio-Signature`) validated | Handles STOP / START / HELP / IDEA keywords; parses texted collection counts (OpenAI); reads MMS sign-in sheet photos (Claude) |
| `POST /api/sms-webhook/status` (`routes/sms-users.ts`) | Twilio delivery status callbacks | **No signature check** | Logs failed deliveries and updates the user's SMS status for certain error codes |
| `POST /api/webhook/new-event-request` (`routes/index.ts`) | Google Apps Script on the event-requests sheet | `SHEETS_WEBHOOK_SECRET` in the `x-webhook-secret` header or the body | Triggers a full Sheet → DB event-request sync |

There is no SendGrid event or inbound-parse webhook. SendGrid is send-only.

### Real-time channels

| Channel | Server file | Notes |
|---|---|---|
| Socket.IO `/socket.io/` | `server/socket-chat.ts` | Messaging and event-request update broadcasts; activity typing indicators |
| Socket.IO `/collaboration` namespace | `server/socket-collaboration.ts` | Live presence, field locks and comments while editing an event |
| Native WebSocket `/notifications` | `server/index.ts` | `global.broadcastNewMessage` for new-message pushes |

---

## 7. Known discrepancies with CLAUDE.md

These were found while writing this doc and have since been **corrected in `CLAUDE.md`** (2026-10-07). They're kept here as a record, so anyone who learned the old version knows what changed.

| CLAUDE.md says | What the code does |
|---|---|
| Migrations are run manually in Neon's SQL editor; there's no automated runner. | `server/migrate.ts` **runs pending `/migrations/*.sql` on every server boot**, in dev and production, and tracks them in `_migrations`. |
| "Claude API for chat insights, intake assistance, event categorization." | Those features use **OpenAI** (gpt-5 / gpt-5-mini). Claude is used only for sign-in sheet photo parsing. |
| Auth is "session-based, Passport". | Sessions use `express-session` with `connect-pg-simple` and `bcrypt`. **Passport is never imported.** |
| `sendVolunteerReminders` runs daily at 9am. | That job is disabled (log-only). Reminders now come from per-event check-in reminder rules (the hourly `check-in reminders` job). |
| Event-requests legacy routes are being split out. | True, but `event-requests-legacy.ts` is **still mounted and still being edited**. |
