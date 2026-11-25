### Overview
This full-stack application for The Sandwich Project nonprofit streamlines sandwich collections, donations, and distributions. It provides comprehensive data management, analytics, and operational tools for volunteers, hosts, and recipients. The project aims to enhance data visibility, support organizational growth, and become a vital tool for food security initiatives, ultimately reducing food waste and hunger. The organizational annual goal is to collect 500,000 sandwiches.

### User Preferences
Preferred communication style: Simple, everyday language.
UI Design: Button labels and interface text must be extremely clear about their function - avoid ambiguous labels like "Submit" in favor of specific action descriptions like "Enter New Data".
Form Design: Eliminate redundant or confusing form fields - host dialogs should have a single "Host Location Name" field instead of separate "Name" and "Host Location" fields.
Mobile UX Priority: Mobile user experience is critical - chat positioning and space efficiency are key concerns. Vehicle type should NOT be required for new driver entries.
Documentation: All technical findings and fixes must be documented in replit.md to avoid repeated searching and debugging.
Analytics Philosophy: NEVER compare or rank hosts against each other. The Sandwich Project is about increasing volunteer turnout globally, not about which host reported more/less sandwiches. All host comparison features, "top performing hosts", "underperforming hosts", and similar language must be removed from analytics.
Desktop Chat UX: Desktop users require proper scrolling behavior without nested scrolling containers that cause page focus issues - chat layout must handle desktop and mobile differently.

### System Architecture
The application features a React 18 frontend with TypeScript, Vite, TanStack Query, and Tailwind CSS (with shadcn/ui). The backend uses Express.js (TypeScript), Drizzle ORM, and PostgreSQL (Neon serverless), including session-based authentication. The UI/UX adheres to The Sandwich Project's official color palette and Roboto typography, prioritizing clarity, responsiveness, and card-based dashboards.

**UI/UX Decisions:**
- Modern, compact design with white card backgrounds, colored left borders for status, warm paper tone page background, subtle shadows, and a strong tonal hierarchy.
- Operational monitoring uses Wednesday-Tuesday week boundaries.
- Visualizations for collection trends include two-line charts (individual vs group sandwiches) and summary cards.
- Purple markers for recipients on maps (distinct from blue events, green hosts).
- "Nearby Recipients" section in right panel showing recipients within 15 miles of selected event.

**Technical Implementations & Feature Specifications:**
- **Authentication & Permissions**: Role-based access control, granular permissions, session management, password security, and active user enforcement.
- **Data Management**: Comprehensive management of collections, hosts, recipients, users, and audit logs with Zod validation, timezone-safe date handling, and soft deletes. `sandwich_collections` table is the operational source of truth.
- **Messaging & Notifications**: Email (Twilio Email, via `server/services/email`), Socket.IO chat, SMS via Twilio, and dashboard notifications. Most outgoing emails also send a separate monitoring copy to `katie@thesandwichproject.org`.
- **Operational Tools**: Project, meeting, and work log management, user feedback, analytics dashboards, and a permissions-based Collection Walkthrough Tool.
- **Event Requests Management System**: Tracks requests, handles duplicate detection, manages statuses, integrates with Google Sheets, calculates van driver staffing, supports multi-recipient assignment, performs comprehensive intake validation, and features interactive Leaflet maps with AI Intake and Scheduling Assistants, including van conflict detection.
- **Real-Time Collaboration System**: Multi-user collaboration for event editing and other resources with Socket.IO synchronization, including presence tracking, field-level locking, threaded comments, and edit revision history. All real-time communication is consolidated onto a single Socket.IO instance to prevent connection issues.
- **User Activity Logging System**: Comprehensive tracking of authenticated user actions.
- **Sandwich Type Tracking System**: Comprehensive tracking for individual and group collections with real-time validation and analytics.
- **Interactive Route Map & Driver Optimization**: Leaflet map for visualizing host contact locations, route optimization, and driver assignment. Recipients are geocoded and displayed on this map.
- **Automated Reminders**: 24-hour volunteer reminder system via cron job with configurable email/SMS delivery channels.
- **SMS Alert Configuration System**: Users can opt-in to SMS notifications via the SMS opt-in page. Event reminders currently support SMS delivery (configurable in Alert Preferences as email/sms/both). Other alert types (TSP contact assignments, chat mentions, task assignments, collection reminders) are shown as "Coming Soon" for SMS. All alert types support email delivery. Key files: `client/src/components/alert-preferences.tsx` (UI with `smsImplemented` flag per alert), `client/src/pages/sms-opt-in.tsx` (opt-in flow), `server/services/cron-jobs.ts` (SMS sending via Twilio).
- **TSP Holding Zone**: Simple inbox-style system for capturing long-term ideas and tasks with flexible categories, urgent flagging, commenting, likes, assignments, and a three-tier permission system.
- **Guided Tours & Onboarding System**: Interactive step-by-step tours for new users covering all major features. Tours are defined in `client/src/lib/tourDefinitions.ts` with permission-based filtering. Available tours include: Resources Overview, Host Location Map, Event Planning Overview, Collections Log, Dashboard & Analytics, Team Chat, TSP Holding Zone, Projects, Hosts Management, Event Reminders, Availability, Volunteers, and Driver Planning.
- **Error Handling & Logging**: Robust error handling with `lazyWithRetry` and improved production-safe logging.
- **Timezone Management**: Ensures accurate storage of user-entered times, strictly adhering to `timeZone: 'America/New_York'` for display and using provided utility functions to prevent timezone conversion issues.
  
  **CRITICAL DATE HANDLING RULE - NEVER USE `new Date(dateString)` DIRECTLY ON DATE-ONLY STRINGS:**
  - The bug: `new Date("2024-12-15")` is parsed as UTC midnight, which shifts to the PREVIOUS DAY when displayed in Eastern time.
  - The fix: ALWAYS use helpers from `client/src/lib/date-utils.ts`:
    - `formatDateShort(date)` - For short display like "Wed, Dec 15"
    - `formatDateForDisplay(date)` - For full display like "Wednesday, December 15, 2024"
    - `formatDateForInput(date)` - For HTML date input values
  - These helpers add `T12:00:00` (noon) to date-only strings before parsing, avoiding timezone boundary issues.
  - NEVER use `format(new Date(date), ...)` from date-fns on date-only strings - this causes the day-early bug.
- **Storage Wrapper**: Includes a `StorageWrapper` with fallback mechanisms for database operations.
- **Event Impact Report Data Source**: ONLY counts sandwiches from actual `sandwichCollections` records; does NOT fall back to estimated/planned counts from `eventRequests`.
- **User Registration & Approval System**: New users sign up with `isActive: false` and require admin approval before accessing the application, enforced at login and through middleware.
- **Google Sheets Sync Monitoring & Alerts**: Background sync service includes comprehensive monitoring and email alerts for no sync, stale sync, failures, and service stoppage. Advisory locks replaced with in-memory locking due to Neon serverless limitations.
- **Google Sheets Sync Deduplication & Message Backfill**: Triple deduplication system: (1) SHA-256 hash on email+submittedOn+org+contact for new records, (2) old-style base64 email-only hash for legacy records, (3) org+date+contact name fallback. Hash lookup prioritizes new-style matches over old-style to correctly identify records when same email is used for multiple events. Message backfill automatically updates empty database message fields from sheet content during sync. Key file: `server/google-sheets-event-requests-sync.ts`.
- **React Query Cache Management**: Uses `queryClient.refetchQueries` in mutation success handlers to ensure immediate UI updates after data changes.
- **Organization Merge System**: Admin tool to merge duplicate organizations (e.g., "Dutton Family" vs "Dutton family"). Includes duplicate detection with similarity scoring, merge preview, and batch updates across event_requests and sandwich_collections tables. **CRITICAL**: When using `db.execute()` with raw SQL, results return as `{ rows: [...], rowCount: n }` QueryResult object, NOT as an array directly. Always access `.rows` to get the data array.
- **Email Template Customization System**: Allows admins to customize key text sections of follow-up HTML emails without touching code. Database table `email_template_sections` stores customizable sections (greeting, intro, call_to_action, cta_subtitle, etc.) with default content and placeholder support (`{{firstName}}`, `{{organizationName}}`). Admin UI at `/admin/email-templates`. Key files: `shared/schema.ts` (emailTemplateSections table), `server/routes/email-templates.ts` (API), `client/src/pages/admin/email-templates.tsx` (admin UI), `client/src/components/event-email-composer.tsx` (integration), `server/seeds/seed-email-template-sections.ts` (seed script).

### External Dependencies
- **Database**: `@neondatabase/serverless`, `drizzle-orm`
- **Web Framework**: `express`
- **UI/Styling**: `@radix-ui`, `tailwindcss`, `lucide-react`, `class-variance-authority`, `shadcn/ui`
- **Data Fetching/State**: `@tanstack/react-query`, `react-hook-form`, `zod`
- **Email**: Twilio Email API (plain `fetch`, no SDK)
- **Real-time Communication**: `socket.io`, `socket.io-client`
- **PDF Generation**: `pdfkit`
- **Authentication**: `connect-pg-simple`
- **File Uploads**: `multer`
- **Google Integration**: Google Sheets API, `@google-cloud/storage`, Google Analytics
- **Mapping**: `leaflet`, `react-leaflet`, `react-leaflet-cluster`
- **SMS**: `twilio` (using Replit Twilio integration with API Key authentication)

### Technical Documentation
For detailed architecture rules, environment constraints, and development guidelines, see **[README.md](./README.md)**. This includes:
- Socket Architecture (namespaces, singleton patterns, polling-only constraints)
- Environment Constraints (Replit-specific)
- Authentication Rules
- Folder Structure & Responsibilities
- DO NOT TOUCH sections
- Socket Modification Checklist
- Database Rules and Query Patterns
- UI/UX Conventions and Philosophy