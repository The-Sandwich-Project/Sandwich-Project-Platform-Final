# The Sandwich Project Platform

## What This Is
A full-stack management platform for The Sandwich Project, an Atlanta-based nonprofit fighting food insecurity through volunteer-led sandwich collections and group events. The app manages the entire lifecycle: event requests come in from community groups, the intake team coordinates logistics, volunteers sign up, sandwiches get collected and distributed to recipients.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, TanStack Query
- **Backend**: Express.js + TypeScript, Drizzle ORM, WebSockets (Socket.IO)
- **Database**: PostgreSQL on Neon (branched: dev + production)
- **Hosting**: Replit
- **Email**: Twilio Email API (`katie@thesandwichproject.org` as default sender); all sending goes through `server/services/email`
- **SMS**: Twilio
- **AI**: Codex API for chat insights, intake assistance, event categorization

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
- **Migrations**: Manual SQL files in `/migrations/`. Run them directly against Neon's SQL editor — there is no automated migration runner in CI. Make sure you run against the correct branch.
- `npm run db:push` pushes schema changes via Drizzle Kit (dev convenience, not used for production migrations)

## Key Environment Variables (in Replit Secrets)
- `DATABASE_URL` — Production Neon connection string
- `DEV_DATABASE_URL` — Dev Neon branch connection string
- `TWILIO_EMAIL_API_KEY`, `TWILIO_EMAIL_API_SECRET`, `EMAIL_FROM_ADDRESS` — Email (Twilio Email; separate from the SMS Twilio credentials)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — SMS
- `ANTHROPIC_API_KEY` — Codex AI features
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
  auth.ts            # Authentication (session-based, Passport)
  routes/            # ~100 route files organized by feature
    event-requests/  # Core event management (split from legacy monolith)
    collections/     # Sandwich collection tracking
    volunteer-event-hub.ts  # Volunteer signup system
  services/          # ~44 service files
    cron-jobs.ts     # All scheduled jobs (auto-complete, reminders, digests)
    email/           # Email helper (Twilio Email), suppressions, unsubscribe page
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
All in `server/services/cron-jobs.ts`. Key jobs:
- `autoCompletePassedEvents` — nightly, moves scheduled/rescheduled events past their date to completed
- `sendVolunteerReminders` — daily at 9am, emails volunteers 24-48 hours before their event
- Various digest and follow-up services

### Onboarding System
`client/src/hooks/useOnboarding.ts` — localStorage-based step tracking. Add new steps to the `OnboardingStep` type and `onboardingContent` map. Wrap UI elements with `<OnboardingTooltip>` from `client/src/components/ui/onboarding-tooltip.tsx`.

## Timezone Handling
The app operates in **Eastern Time** (Atlanta). Server-side date comparisons in cron jobs and status logic use Eastern timezone conversions to prevent UTC drift issues (e.g., at 7pm EST, UTC has already rolled to the next day).

## Authentication
Session-based auth via Passport.js. Most API routes use `isAuthenticated` middleware. A few routes are public (SMS opt-in pages, landing page). The volunteer hub currently requires login but is planned to get a public-facing page.

## Common Gotchas
- **Database branch confusion**: When running migrations or SQL queries, always verify you're targeting the correct Neon branch (dev vs production). The app and the Neon console may be pointing at different branches.
- **Schema is one giant file**: `shared/schema.ts` is ~5000 lines. Search by table name (e.g., `eventRequests`, `sandwichCollections`, `eventVolunteers`).
- **Event requests legacy routes**: `server/routes/event-requests-legacy.ts` is a ~5000-line monolith. New routes are being split into `server/routes/event-requests/*.ts`.
- **Pre-existing TypeScript errors**: `tsc --noEmit` will show errors in test files and some components. These are pre-existing and don't block the app from running.
- **The `postponed` status no longer exists**: It was removed and merged into `standby`. Historical data columns (postponementReason, wasPostponed, etc.) still exist in the schema for audit purposes.
- **Embedding external pages in iframes**: The app uses a strict Content-Security-Policy. To embed an external URL in an `<iframe>`, the origin must be listed in `frameSrc` in `server/index.ts`. If the source also sets `X-Frame-Options: DENY/SAMEORIGIN` (Gamma sites, Replit-hosted apps, etc.), the iframe will still be blocked even with CSP allowed — in that case route through `/api/proxy/page?url=...` (see how `important-links.tsx` embeds the toolkit and donor management tabs). If the embed also fetches API data from that origin, add it to `connectSrc` too.
