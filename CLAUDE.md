# The Sandwich Project Platform

## What This Is
A full-stack management platform for The Sandwich Project, an Atlanta-based nonprofit fighting food insecurity through volunteer-led sandwich collections and group events. The app manages the entire lifecycle: event requests come in from community groups, the intake team coordinates logistics, volunteers sign up, sandwiches get collected and distributed to recipients.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, TanStack Query
- **Backend**: Express.js + TypeScript, Drizzle ORM, WebSockets (Socket.IO)
- **Database**: PostgreSQL on Neon (branched: dev + production)
- **Hosting**: Replit
- **Email**: SendGrid (`katie@thesandwichproject.org` as sender)
- **SMS**: Twilio
- **AI**: Mostly **OpenAI** (gpt-5 / gpt-5-mini) — AI chat, AI analyst, intake assistance, date suggestions, categorization, impact reports, predictions, receipt processing, smart-search embeddings. **Claude** (Anthropic SDK) is used in exactly one place: sign-in sheet photo parsing (`server/services/signin-sheet-parser.ts`).

For a full module inventory, external-service map, and background-job list, see `docs/README.md`.

## Running the App
```bash
npm run dev        # Development server (NODE_ENV=development)
npm run build      # Production build
npm run start      # Production server (NODE_ENV=production)
npm run check      # TypeScript type check
```
The app runs on a single port — Express serves both the API and the Vite-built frontend.

## Database
- **Neon Postgres** with two branches: `dev` and `production`
- **Connection logic** is in `server/db-url.ts` — the SINGLE source of truth:
  - Production (`NODE_ENV=production`): Uses `DATABASE_URL` or `PRODUCTION_DATABASE_URL`
  - Development: Uses `DEV_DATABASE_URL`, falls back to `DATABASE_URL`
- **ORM**: Drizzle. Schema defined in `shared/schema.ts` (single file, ~5000 lines)
- **Migrations**: Hand-written SQL files in `/migrations/`. **They run automatically on every server boot** (dev and production) — `server/migrate.ts` executes any file not yet recorded in the `_migrations` table, via `initializeDatabase()` in `server/db-init.ts`. Merging a migration file means it will hit production on the next deploy.
  - Neon's HTTP driver has no transactions, so a file that fails partway can leave some statements applied. Write migrations idempotently (`IF NOT EXISTS`, `IF EXISTS`, etc.).
  - Running SQL by hand in Neon's SQL editor still works, but the file will then also be executed on next boot unless it's recorded in `_migrations` — another reason to keep it idempotent.
- `npm run db:push` pushes schema changes via Drizzle Kit (dev convenience, not used for production migrations)

## Key Environment Variables (in Replit Secrets)
- `DATABASE_URL` — Production Neon connection string
- `DEV_DATABASE_URL` — Dev Neon branch connection string
- `SENDGRID_API_KEY` — Email sending
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — SMS
- `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI via Replit AI Integrations (most AI features)
- `OPENAI_API_KEY` — Direct OpenAI key (SMS collection parsing, smart-search embeddings, alert generation)
- `ANTHROPIC_API_KEY` — Claude, used only for sign-in sheet photo parsing
- `SESSION_SECRET` — Express session signing
- `NODE_ENV` — `development` or `production`

## Project Structure
```
shared/              # Shared between client and server
  schema.ts          # Drizzle schema (all tables) + Zod validation
  event-status-workflow.ts  # Event status definitions, transitions, validation

server/
  index.ts           # Express app setup, middleware, server start
  db.ts / db-url.ts  # Database connection
  auth.ts            # Authentication (express-session + bcrypt; no Passport)
  routes/            # ~100 route files organized by feature
    event-requests/  # Core event management (split from legacy monolith)
    collections/     # Sandwich collection tracking
    volunteer-event-hub.ts  # Volunteer signup system
  services/          # ~44 service files
    cron-jobs.ts     # All scheduled jobs (auto-complete, reminders, digests)
    email-service.ts # SendGrid integration
    organizations/   # Returning org detection, merge service

client/src/
  App.tsx            # Router — public vs authenticated routes
  pages/             # ~66 page components
  components/        # ~164 components
    event-requests/  # Main feature — cards, tabs, dialogs, context, hooks
    ui/              # shadcn/ui primitives
  hooks/             # Custom hooks (useAuth, useOnboarding, useCollectionsData, etc.)
  lib/               # Utilities (analytics-utils, queryClient, excel-export)
```

## Core Domain Concepts

### Event Requests (the main feature)
The event request pipeline is the heart of the app. Community groups submit requests, and the intake team shepherds them through statuses:

**Status workflow** (defined in `shared/event-status-workflow.ts`):
- `new` → `in_process` → `scheduled` → `completed`
- Side tracks: `standby` (waiting on group), `stalled` (unreachable), `declined`, `cancelled`
- `rescheduled` = scheduled event moved to a new date
- `non_event` = not a real event request (terminal)
- Transitions are enforced — see `VALID_STATUS_TRANSITIONS` and `isValidTransition()`

### Sandwich Collections
The collections log (`sandwich_collections` table) is the **single source of truth** for sandwich counts. Every total in the app — dashboard, analytics, grant metrics — is computed from this table. Never use `actualSandwichCount` from event requests for totals.

Formula: `total = individualSandwiches + sum(groupCollections[].count)`
Fallback for legacy records: `group1Count + group2Count`

Centralized calculation utilities: `client/src/lib/analytics-utils.ts`

### Volunteer Event Hub
Intended to replace SignupGenius. Volunteers browse events and sign up for roles (driver, speaker, general). Events must have `showOnVolunteerHub = true` to appear. Coordinator approves signups. Confirmation emails sent on signup and approval.

### Returning Organization Detection
`server/services/organizations/returning-organization.ts` — checks if an org or contact has worked with TSP before. Runs independently: org matching (exact + fuzzy) AND contact matching (by email or name+phone across all past events). Shows badges on event cards.

## Important Patterns

### Event Request Context
`client/src/components/event-requests/context/EventRequestContext.tsx` is the central state manager for the event requests feature. It owns the active tab, query parameters, dialog visibility, and selected events. All event request components read from this context.

### Data Fetching
- TanStack Query everywhere. Query keys follow the pattern `['/api/endpoint', filterParams]`
- `client/src/components/event-requests/lib/eventRequestsListQuery.ts` builds the query for each tab
- Status counts fetched separately at `/api/event-requests/status-counts`

### Quick Toggle Pattern
Boolean fields on event cards (isConfirmed, addedToOfficialSheet, showOnVolunteerHub) use a `quickToggleBoolean` function that sends `{ [field]: !currentValue }` to the PATCH endpoint. No special server logic needed.

### Cron Jobs
All in `server/services/cron-jobs.ts` (node-cron, `America/New_York`). Key jobs:
- `autoCompletePassedEvents` — nightly at 12:05am, moves scheduled/rescheduled events past their date to completed
- `processCheckInReminders` — hourly at :15, sends the per-event check-in reminders TSP contacts turn on (this replaced the old automatic volunteer reminders)
- Collective Learning auto-log — daily at 6:20pm (prod only), records the standing weekly PBJ count (default 250) as a `submission_method = 'auto_recurring'` collection unless a per-week override (`recurring_collection_overrides`) says they didn't collect or gives a different count. Admin card on the Collections page.
- Weekly/admin digests, admin SMS pulse, standby follow-ups, daily error digest — **production only** (bodies return early unless `NODE_ENV=production`)
- Monthly AI impact report and prediction alert; daily integration health check; Monday host-availability scrape
- **Disabled jobs** (volunteer reminders, TSP/corporate follow-ups, event-approaching, etc.) are log-only stubs. Note: they pass `{ scheduled: false }`, but node-cron 4.x ignores that option and starts them anyway — if you restore a real body, it will run on schedule immediately.

Separately, `server/background-sync-service.ts` reads the Event Requests Google Sheet into the DB every 30 minutes.

### Onboarding System
`client/src/hooks/useOnboarding.ts` — localStorage-based step tracking. Add new steps to the `OnboardingStep` type and `onboardingContent` map. Wrap UI elements with `<OnboardingTooltip>` from `client/src/components/ui/onboarding-tooltip.tsx`.

## Timezone Handling
The app operates in **Eastern Time** (Atlanta). Server-side date comparisons in cron jobs and status logic use Eastern timezone conversions to prevent UTC drift issues (e.g., at 7pm EST, UTC has already rolled to the next day).

## Authentication
Session-based auth using `express-session`, with sessions stored in Postgres (`sessions` table) via `connect-pg-simple` and passwords hashed with `bcrypt`. Session setup is in `server/routes.ts`. **Passport is in `package.json` but is not imported anywhere** — don't build on it. Most API routes use `isAuthenticated` middleware (`server/middleware/auth.ts`). A few routes are public (login, signup, password reset, SMS opt-in pages, Twilio webhooks). The volunteer hub currently requires login but is planned to get a public-facing page.

## Common Gotchas
- **Database branch confusion**: When running migrations or SQL queries, always verify you're targeting the correct Neon branch (dev vs production). The app and the Neon console may be pointing at different branches.
- **Schema is one giant file**: `shared/schema.ts` is ~5000 lines. Search by table name (e.g., `eventRequests`, `sandwichCollections`, `eventVolunteers`).
- **Event requests legacy routes**: `server/routes/event-requests-legacy.ts` is a ~5400-line monolith. New routes are being split into `server/routes/event-requests/*.ts`, but the legacy file is **still mounted** (via `server/routes/event-requests/index.ts`) and still serves live traffic — don't treat it as dead code.
- **Pre-existing TypeScript errors**: `tsc --noEmit` will show errors in test files and some components. These are pre-existing and don't block the app from running.
- **The `postponed` status no longer exists**: It was removed and merged into `standby`. Historical data columns (postponementReason, wasPostponed, etc.) still exist in the schema for audit purposes.
- **Embedding external pages in iframes**: The app uses a strict Content-Security-Policy. To embed an external URL in an `<iframe>`, the origin must be listed in `frameSrc` in `server/index.ts`. If the source also sets `X-Frame-Options: DENY/SAMEORIGIN` (Gamma sites, Replit-hosted apps, etc.), the iframe will still be blocked even with CSP allowed — in that case route through `/api/proxy/page?url=...` (see how `important-links.tsx` embeds the toolkit and donor management tabs). If the embed also fetches API data from that origin, add it to `connectSrc` too.
