# The Sandwich Project Platform

A comprehensive web-based management system for **The Sandwich Project** nonprofit organization, handling sandwich collections, volunteer coordination, event management, and operational analytics.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd Sandwich-Project-Platform-Final

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Edit .env with your configuration

# 4. Initialize database
npm run db:push
npm run db:seed

# 5. Start development server
npm run dev
```

**Application URLs:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000
- Monitoring Dashboard: http://localhost:5000/monitoring/dashboard

---

## What This Platform Does

The Sandwich Project Platform helps nonprofits manage:

- **Sandwich Collections** - Track pickups, distributions, and inventory
- **Volunteer Management** - Coordinate drivers, hosts, and staff
- **Event Requests** - Handle distribution event intake and scheduling
- **Project Management** - Organize initiatives and campaigns
- **Real-time Messaging** - Coordinate teams via built-in chat
- **Notifications** - Email and SMS alerts via Twilio Email and Twilio SMS
- **Analytics** - Track impact, donations, and volunteer hours
- **Meeting Management** - Create agendas, take notes, generate PDF minutes

---

## Technology Stack

### Frontend
- **React 18** - UI library with hooks
- **TypeScript** - Type safety
- **Vite** - Fast build tool
- **TanStack Query** - Server state management
- **Tailwind CSS** - Utility-first styling
- **Radix UI** - Accessible component primitives
- **Socket.IO Client** - Real-time features (see Socket Architecture section)

### Backend
- **Express.js** - Web framework
- **TypeScript** - Type safety
- **Drizzle ORM** - Type-safe database queries
- **PostgreSQL** - Production database (Neon serverless)
- **SQLite** - Development database
- **Socket.IO** - Real-time server (polling-based in Replit environment)
- **Winston** - Structured logging
- **Sentry** - Error tracking

### Infrastructure
- **Replit** - Hosting and deployment
- **Neon** - Serverless PostgreSQL
- **Twilio Email** - Transactional email (`server/services/email`)
- **Twilio** - SMS messaging
- **Google Cloud** - File storage, Sheets integration

---

## Project Structure

```
/
├── client/              # React frontend application
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page-level components
│   │   ├── hooks/       # Custom React hooks
│   │   └── lib/         # Client utilities
│   └── index.css        # Global styles
│
├── server/              # Express backend application
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic layer
│   ├── middleware/      # Express middleware
│   ├── monitoring/      # Metrics, health checks, alerts
│   └── utils/           # Server utilities
│
├── shared/              # Code shared between client & server
│   ├── schema.ts        # Database schema (Drizzle)
│   ├── types.ts         # TypeScript type definitions
│   └── permission-config.ts  # Role-based access control
│
├── tests/               # Test files
│   ├── integration/     # API integration tests
│   ├── unit/            # Unit tests
│   └── utils/           # Test utilities
│
├── e2e/                 # Playwright end-to-end tests
├── docs/                # Additional documentation
├── migrations/          # Database migrations
└── scripts/             # Utility scripts
```

### Detailed Folder Responsibilities

#### Client (`client/src/`)
- `lib/collaboration-manager.ts` - OWNS collaboration socket singleton
- `lib/socket-singleton.ts` - OWNS notifications socket singleton
- `lib/queryClient.ts` - React Query configuration
- `lib/date-utils.ts` - `parseCollectionDate()` for timezone-safe dates
- `hooks/use-collaboration.ts` - Generic collaboration hook (uses manager)
- `hooks/use-event-collaboration.ts` - Event-specific wrapper
- `hooks/useAuth.ts` - Authentication state
- `hooks/useNotificationSocket.ts` - Notification socket hook
- `components/event-requests/cards/` - Event card components
- `components/collaboration/` - Collaboration UI components

#### Server (`server/`)
- `routes/auth.ts` - Single modern auth router
- `routes/event-requests.ts` - HTTP source of truth for events
- `routes/collections/` - Sandwich collections API
- `services/` - Business logic services
- `middleware/` - Express middleware
- `socket-collaboration.ts` - Collaboration socket server
- `socket-chat.ts` - Chat socket server
- `database-storage.ts` - Database operations (Drizzle ORM)
- `storage.ts` - IStorage interface
- `background-sync-service.ts` - Google Sheets sync service
- `sms-service.ts` - Twilio SMS integration

#### Shared (`shared/`)
- `schema.ts` - Drizzle ORM schemas (source of truth)
- `auth-utils.ts` - PERMISSIONS constants
- `unified-auth-utils.ts` - `hasPermission()` helper

---

## Critical Architecture Rules

**⚠️ READ THIS BEFORE MAKING CHANGES** - These rules prevent common bugs and system failures.

### Socket Architecture

**We use ONE Socket.IO singleton per namespace. Components MUST NOT create socket connections directly.**

#### Namespaces

| Namespace | Manager File | Purpose |
|-----------|-------------|---------|
| `/collaboration` | `client/src/lib/collaboration-manager.ts` | Real-time event editing, presence, comments, field locking |
| `/` (default) | `client/src/lib/socket-singleton.ts` | Notifications, messaging |
| `/chat` | `client/src/hooks/useSocketChat.ts` | Chat functionality |

#### Critical Socket Rules

1. **NO component should call `io()` directly** - always use the singleton/manager
2. **MUST use polling-only** for `/collaboration` namespace in Replit environment
3. **MUST NOT attempt WebSocket upgrade** for collaboration - causes 'Invalid frame header' errors
4. **MUST use path `/socket.io`** for all socket connections
5. **Use `window.location.origin`** for socket URL - never hardcode localhost

#### Socket Configuration

```typescript
// For /collaboration namespace (POLLING ONLY - Replit requirement)
{
  path: '/socket.io',
  transports: ['polling'],  // NO websocket
  upgrade: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
}

// For other namespaces (can try upgrade)
{
  path: '/socket.io/',
  transports: ['polling', 'websocket'],
  upgrade: true,
}
```

#### Correct Socket Usage Pattern

```typescript
// CORRECT: Use collaboration-manager
import { collaborationManager } from '@/lib/collaboration-manager';

const unsubscribe = collaborationManager.subscribe('event', eventId, {
  onConnect: () => {},
  onPresenceUpdate: (users) => {},
  onLocksUpdated: (locks) => {},
});

// WRONG: Never do this
import { io } from 'socket.io-client';
const socket = io('/collaboration'); // ❌ NEVER
```

### Environment Constraints (Replit-Specific)

#### WebSocket Limitations

- **WebSockets frequently fail** with 'Invalid frame header' → use polling-only for critical features
- **Replit proxy returns 502** intermittently → clients must reconnect with infinite attempts
- **Dev server port is dynamic** → use `window.location.origin`, never hardcode `localhost:5000`

#### Socket URL Resolution

```typescript
// CORRECT
const socketUrl = typeof window !== 'undefined' ? window.location.origin : '';

// WRONG
const socketUrl = 'http://localhost:5000'; // ❌ Never hardcode
```

#### Vite HMR Note

The Vite HMR WebSocket may show errors like `wss://localhost:undefined` - this is a known Replit issue with Vite's hot reload, NOT our application sockets. Ignore these errors.

### Authentication Rules

#### Auth Flow

1. All authentication goes through `/api/auth/login`
2. Session managed via `express-session` with PostgreSQL store (`connect-pg-simple`)
3. `/api/auth/me` is the **single source of truth** for current user
4. New users register with `isActive: false` and require admin approval

#### Password Security

- **ONLY bcrypt passwords allowed** - all passwords are hashed with bcrypt
- **Legacy plaintext login paths MUST NOT be used**
- Password reset via `/api/auth/password-reset` with secure tokens

#### Auth Files

| File | Purpose |
|------|---------|
| `server/auth.ts` | Core authentication logic, password hashing |
| `server/routes/auth.ts` | Auth API routes (login, logout, register, me) |
| `server/middleware/` | Authentication and authorization middleware |

### Database Rules

#### Drizzle ORM Patterns

```typescript
// CORRECT: Use .array() as method
sandwichTypes: text('sandwich_types').array(),

// WRONG: Don't wrap with array()
sandwichTypes: array(text('sandwich_types')), // ❌
```

#### Date Handling

**CRITICAL RULE - NEVER USE `new Date(dateString)` DIRECTLY ON DATE-ONLY STRINGS:**

The bug: `new Date("2024-12-15")` is parsed as UTC midnight, which shifts to the PREVIOUS DAY when displayed in Eastern time.

The fix: ALWAYS use helpers from `client/src/lib/date-utils.ts`:
- `formatDateShort(date)` - For short display like "Wed, Dec 15"
- `formatDateForDisplay(date)` - For full display like "Wednesday, December 15, 2024"
- `formatDateForInput(date)` - For HTML date input values
- `parseCollectionDate(dateString)` - For parsing collection dates (timezone is America/New_York)

These helpers add `T12:00:00` (noon) to date-only strings before parsing, avoiding timezone boundary issues.

```typescript
// CORRECT: Use date-utils helpers
import { parseCollectionDate, formatDateShort, formatDateForDisplay } from '@/lib/date-utils';

const date = parseCollectionDate(dateString);
const display = formatDateShort(date);

// WRONG: Never use new Date() directly on date-only strings
const date = new Date("2024-12-15"); // ❌ Causes day-early bug
const display = format(new Date(dateString), 'MMM d'); // ❌ Also causes bug
```

#### ID Column Types

**NEVER change primary key ID column types** - this breaks migrations

```typescript
// Keep existing type - don't convert serial ↔ varchar
id: serial("id").primaryKey(),  // If already serial, keep it
```

#### Raw SQL Queries with db.execute()

**CRITICAL**: When using `db.execute()` with raw SQL, results return as a `QueryResult` object, NOT as an array directly.

```typescript
// CORRECT: Access .rows property
const result = await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`);
const users = result.rows;  // ✅ Access .rows

// WRONG: Treating result as array
const users = await db.execute(sql`SELECT * FROM users`); // ❌ Returns { rows: [...], rowCount: n }
```

### React Query Patterns

#### Query Keys

```typescript
// CORRECT: Use array for hierarchical keys
queryKey: ['/api/event-requests', eventId]

// WRONG: Don't interpolate into string
queryKey: [`/api/event-requests/${eventId}`] // ❌
```

#### Mutations

```typescript
// Always invalidate cache after mutation
const mutation = useMutation({
  mutationFn: async (data) => {
    return apiRequest('/api/endpoint', { method: 'POST', body: data });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['/api/endpoint'] });
  },
});
```

### DO NOT TOUCH Without Approval

These sections are critical and have complex dependencies:

#### Configuration
- Express session configuration (`server/index.ts`)
- Socket.IO namespace definitions
- Drizzle schema primary key types

#### Business Logic
- Event request status transition logic
- Background sync scheduler (`background-sync-service.ts`)
- Google Sheets ingestion pipeline (`google-sheets-*.ts`)
- Cron jobs (`server/index.ts` - cron section)
- Organization Merge System (duplicate detection and batch updates)

#### Data Integrity
- `sandwich_collections` table - operational source of truth
- External ID blacklist system (prevents duplicate imports)
- User permission system (`PERMISSIONS` constants)
- Event Impact Report data source logic (only `sandwichCollections`, never `eventRequests`)

---

## Documentation

### Getting Started

- **[Developer Setup](docs/DEVELOPER_SETUP.md)** - Set up your development environment
- **[Architecture Overview](ARCHITECTURE.md)** - System design and components
- **[Contributing Guide](CONTRIBUTING.md)** - Code standards and workflow

### Operations & Deployment

- **[Deployment Guide](DEPLOYMENT.md)** - Deploy to production
- **[Monitoring Guide](MONITORING.md)** - Observability and metrics
- **[Alerting Setup](docs/ALERTING_SETUP.md)** - Configure monitoring alerts
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues and solutions

### Maintainer Resources

- **[Handoff Guide](HANDOFF.md)** - For new maintainers taking over the project
- **[Testing Guide](TESTING.md)** - Testing infrastructure and best practices

### Specialized Topics

- **[Security & Permissions](docs/SECURITY-NUMERIC-PERMISSIONS.md)** - Role-based access control
- **[Notification System](server/services/notifications/README.md)** - Email/SMS notifications
- **[Folder Structure](server/FOLDER_STRUCTURE.md)** - Server code organization

---

## Development

### Available Commands

```bash
# Development
npm run dev              # Start development server (Vite + API)
npm run dev:client       # Start client only
npm run dev:server       # Start server only

# Building
npm run build            # Build for production
npm run typecheck        # Check TypeScript types
npm run lint             # Run ESLint

# Testing
npm run test             # Run unit + integration tests
npm run test:unit        # Run unit tests only
npm run test:integration # Run integration tests only
npm run test:e2e         # Run end-to-end tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Generate coverage report

# Database
npm run db:push          # Apply schema to database
npm run db:seed          # Seed database with sample data
npm run db:reset         # Reset database (clean slate)
npm run db:studio        # Open Drizzle Studio (DB GUI)

# Production
npm run start            # Start production server
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Database
DATABASE_URL=postgresql://... (or use SQLite locally)

# Session
SESSION_SECRET=your-secret-key-min-32-chars

# Email (Twilio Email; separate from the SMS Twilio credentials)
TWILIO_EMAIL_API_KEY=SKxxxxx
TWILIO_EMAIL_API_SECRET=xxxxx
EMAIL_FROM_ADDRESS=sender@yourdomain.org
NOTIFICATION_FROM_EMAIL=noreply@yourdomain.com

# SMS (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1234567890

# Monitoring
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx

# Optional
NODE_ENV=development
LOG_LEVEL=debug
```

### Testing

**Test Coverage Goals:**
- Server: 60% minimum, 70%+ target
- Client: 40% minimum, 60%+ target
- Critical paths (auth, permissions): 90%+ required

**Writing Tests:**

```typescript
// Unit test example
import { hasPermission } from './auth-utils';

test('admin has all permissions', () => {
  expect(hasPermission({ role: 'admin' }, 'users:delete')).toBe(true);
});

// Integration test example
import request from 'supertest';
import { app } from './server';

test('GET /api/users returns user list', async () => {
  const response = await request(app).get('/api/users');
  expect(response.status).toBe(200);
});
```

See **[TESTING.md](TESTING.md)** for comprehensive testing guide.

### Socket Code Modification Checklist

Before completing any socket-related changes:

1. [ ] Verify only ONE socket connection per namespace in Network tab
2. [ ] Confirm polling transport (no WebSocket frames) for `/collaboration`
3. [ ] Test reconnection after simulated disconnect
4. [ ] Check server logs for duplicate connections
5. [ ] Verify presence/locks update correctly across tabs
6. [ ] Use polling-only for `/collaboration` → `transports: ['polling']`
7. [ ] Use `/socket.io` path
8. [ ] Do NOT create additional socket instances
9. [ ] Always reuse the existing namespace singleton
10. [ ] No direct `io()` calls inside components or hooks

### Adding New Socket Events

```typescript
// In collaboration-manager.ts (client)
// 1. Add to event handlers in connect()
socket.on('new_event', (data) => {
  // Handle event
});

// In socket-collaboration.ts (server)
// 2. Add emit in appropriate handler
socket.emit('new_event', data);
```

---

## Key Features & Implementation Details

### Organization Merge System

Admin tool to merge duplicate organizations (e.g., "Dutton Family" vs "Dutton family"). Includes:
- Duplicate detection with similarity scoring
- Merge preview
- Batch updates across `event_requests` and `sandwich_collections` tables

**CRITICAL**: When using `db.execute()` with raw SQL in this system, results return as `{ rows: [...], rowCount: n }` QueryResult object. Always access `.rows` to get the data array.

### SMS Alert Configuration System

- Users can opt-in to SMS notifications via the SMS opt-in page
- Event reminders support SMS delivery (configurable in Alert Preferences as email/sms/both)
- Other alert types (TSP contact assignments, chat mentions, task assignments, collection reminders) show "Coming Soon" for SMS
- All alert types support email delivery
- Key files:
  - `client/src/components/alert-preferences.tsx` (UI with `smsImplemented` flag per alert)
  - `client/src/pages/sms-opt-in.tsx` (opt-in flow)
  - `server/services/cron-jobs.ts` (SMS sending via Twilio)

### Guided Tours & Onboarding System

Interactive step-by-step tours for new users covering all major features. Tours are defined in `client/src/lib/tourDefinitions.ts` with permission-based filtering. Available tours include:
- Resources Overview
- Host Location Map
- Event Planning Overview
- Collections Log
- Dashboard & Analytics
- Team Chat
- TSP Holding Zone
- Projects
- Hosts Management
- Event Reminders
- Availability
- Volunteers
- Driver Planning

### Automated Reminders

24-hour volunteer reminder system via cron job with configurable email/SMS delivery channels.

---

## External Integrations

### Twilio SMS

- Uses Replit Twilio integration with API Key authentication
- Configured via environment secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- **Text-to-App (Holding Zone ideas) pipeline:**
  - Inbound SMS webhook at `/api/sms/webhook` (Twilio signature validated) handled in `server/routes/sms-users.ts`
  - Users text `IDEA <their idea>`; message is turned into a Holding Zone item (`teamBoardItems` table) with `createdByName` marked as "(via SMS)" and `createdBy` set to the matched user or `sms-system`
  - Confirmation SMS is sent back; failures return a polite error via Twilio response
  - Opt-in/consent is stored on the user (`metadata.smsConsent`) and checked before use
  - Keep the webhook URL in Twilio console synced with deployment URL (`https://<host>/api/sms/webhook`)

### Twilio Email

- All sending goes through `server/services/email` (POST https://comms.twilio.com/v1/Emails)
- Most emails also send a separate monitoring copy to `katie@thesandwichproject.org` (Twilio Email has no BCC)
- Unsubscribes and bounces live in `email_suppressions`; every email links to `/api/email-preferences`
- `npm run email:test -- you@example.com` sends a real test email

### Google Sheets

- Background sync every 5 minutes
- Uses permanent external_id blacklist to prevent duplicate imports
- Advisory locks replaced with in-memory locking (Neon serverless limitation)
- Comprehensive monitoring and email alerts for no sync, stale sync, failures, and service stoppage

### Data Source Rules

#### Event Impact Reports

**CRITICAL**: Event Impact Reports ONLY count sandwiches from actual `sandwichCollections` records. They do NOT fall back to estimated/planned counts from `eventRequests`.

#### Sandwich Collections

The `sandwich_collections` table is the **operational source of truth** for all sandwich data.

---

## Monitoring & Observability

### Built-in Monitoring

The platform includes enterprise-grade monitoring:

- **Sentry** - Error tracking and performance monitoring
- **Prometheus Metrics** - Exposed at `/monitoring/metrics`
- **Health Checks** - `/monitoring/health`, `/monitoring/health/detailed`
- **Real-time Dashboard** - `/monitoring/dashboard`
- **Structured Logging** - Winston JSON logs
- **Audit Trail** - User activity logging

### Key Metrics Tracked

- HTTP request duration and count
- Database query performance
- WebSocket connections
- Memory and CPU usage
- Business metrics (users, collections, notifications)
- External API calls

**Access monitoring:** Visit http://localhost:5000/monitoring/dashboard

See **[MONITORING.md](MONITORING.md)** for details.

---

## Deployment

### Production Deployment (Replit)

```bash
# 1. Push to deployment branch
git push origin main

# 2. Replit auto-deploys
# Monitor deployment in Replit dashboard

# 3. Verify deployment
curl https://[REPLIT_DOMAIN]/monitoring/health
```

### Deployment Checklist

- [ ] All tests pass
- [ ] Environment variables configured
- [ ] Database migrations tested
- [ ] Documentation updated
- [ ] Monitoring alerts active
- [ ] Rollback plan ready

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for comprehensive deployment guide.

---

## Security

### Authentication & Authorization

- **Session-based authentication** with secure cookies
- **Role-based access control (RBAC)** with granular permissions
- **Password hashing** via bcrypt
- **Audit logging** for sensitive actions

### Roles & Permissions

| Role | Description | Permissions |
|------|-------------|-------------|
| **Admin** | Full system access | All permissions |
| **Staff** | Operational management | Most features, limited user management |
| **Volunteer** | Drivers, hosts, helpers | View own data, basic operations |
| **Recipient** | Event organizers | Request events, view own events |

See **[SECURITY-NUMERIC-PERMISSIONS.md](docs/SECURITY-NUMERIC-PERMISSIONS.md)** for details.

---

## UI/UX Conventions & Philosophy

### User Preferences

- **Communication Style**: Use simple, everyday language - avoid technical jargon
- **Button Labels**: Must be extremely clear about their function - avoid ambiguous labels like "Submit" in favor of specific action descriptions like "Enter New Data" or "Save Event"
- **Form Design**: Eliminate redundant or confusing form fields - host dialogs should have a single "Host Location Name" field instead of separate "Name" and "Host Location" fields
- **Mobile UX Priority**: Mobile user experience is critical - chat positioning and space efficiency are key concerns. Vehicle type should NOT be required for new driver entries
- **Desktop Chat UX**: Desktop users require proper scrolling behavior without nested scrolling containers that cause page focus issues - chat layout must handle desktop and mobile differently

### Design System

- **Color Palette**: Adheres to The Sandwich Project's official color palette
- **Typography**: Roboto font family
- **Visual Style**: Modern, compact design with:
  - White card backgrounds
  - Colored left borders for status indicators
  - Warm paper tone page background
  - Subtle shadows
  - Strong tonal hierarchy
- **Map Markers**:
  - Purple markers for recipients
  - Blue markers for events
  - Green markers for hosts
- **Week Boundaries**: Operational monitoring uses Wednesday-Tuesday week boundaries

### Analytics Philosophy

**NEVER compare or rank hosts against each other** - The Sandwich Project focuses on increasing volunteer turnout globally, not ranking hosts. All host comparison features, "top performing hosts", "underperforming hosts", and similar language must be removed from analytics.

---

## Common Pitfalls

### Import Errors

```typescript
// Toast hook location
import { useToast } from '@/hooks/use-toast';

// React NOT explicitly imported (Vite JSX transformer handles it)
// import React from 'react'; // ❌ Not needed
```

### SelectItem Value

```tsx
// CORRECT: Always provide value
<SelectItem value="option1">Option 1</SelectItem>

// WRONG: Missing value causes error
<SelectItem>Option 1</SelectItem> // ❌
```

### Tooltip + ConfirmationDialog

Never wrap `ConfirmationDialog` triggers with `Tooltip` - causes ref forwarding issues.

---

## Contributing

We welcome contributions! Please read our **[Contributing Guide](CONTRIBUTING.md)** for:

- Code style and standards
- Development workflow
- Testing requirements
- Pull request process

### Quick Contribution Workflow

```bash
# 1. Create feature branch
git checkout -b feature/your-feature-name

# 2. Make changes and test
npm run test:all

# 3. Commit with conventional commits
git commit -m "feat(feature): description"

# 4. Push and create PR
git push origin feature/your-feature-name
```

---

## Troubleshooting

### Common Issues

**Application won't start:**
```bash
# Check port availability
lsof -i :5000

# Reinstall dependencies
rm -rf node_modules && npm install
```

**Database connection failed:**
```bash
# Verify environment variables
echo $DATABASE_URL

# Reset local database
npm run db:reset
```

**Tests failing:**
```bash
# Reset test database
npm run db:reset
npm run db:seed
```

**Socket connection issues:**
- Verify only one connection per namespace in browser Network tab
- Check that `/collaboration` uses polling-only transport
- Ensure socket URL uses `window.location.origin`, not hardcoded localhost
- Check server logs for connection errors

For comprehensive troubleshooting, see **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.

---

## Maintainer Handoff

**Are you taking over this project?** Start here:

1. Read **[HANDOFF.md](HANDOFF.md)** - Critical for new maintainers
2. Complete the "First Week" checklist in the handoff guide
3. Set up monitoring alerts (see **[ALERTING_SETUP.md](docs/ALERTING_SETUP.md)**)
4. Familiarize yourself with deployment process

The handoff guide contains everything you need to successfully maintain this project.

---

## Architecture Highlights

### Three-Tier Architecture

```
┌─────────────────────────┐
│   React Frontend (SPA)   │  Vite, TanStack Query, Tailwind
└─────────────────────────┘
            ↕
┌─────────────────────────┐
│   Express REST API       │  TypeScript, Session Auth, WebSockets
└─────────────────────────┘
            ↕
┌─────────────────────────┐
│   PostgreSQL Database    │  Drizzle ORM, Neon Serverless
└─────────────────────────┘
```

### Key Design Principles

- **Type Safety** - TypeScript everywhere, shared types between client/server
- **Testing** - Comprehensive test coverage with Jest and Playwright
- **Observability** - Built-in monitoring, logging, and error tracking
- **Security** - RBAC, input validation, audit logging
- **Maintainability** - Clean code, documentation, modular architecture

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for detailed system design.

---

## Performance

### Optimization Features

- **Code Splitting** - React lazy loading for routes
- **Query Optimization** - Indexed database queries
- **Caching** - TanStack Query client-side caching
- **Connection Pooling** - Efficient database connections
- **Static Asset Optimization** - Vite production builds

### Monitoring Performance

- View metrics at `/monitoring/dashboard`
- Track response times with Prometheus
- Monitor database query performance
- Profile with Sentry performance monitoring

---

## Support & Resources

### Getting Help

- **Documentation** - Start with docs listed above
- **Issues** - Search existing GitHub issues
- **Maintainer** - Contact info in [HANDOFF.md](HANDOFF.md)

### Useful Links

- **Replit Docs:** https://docs.replit.com
- **Drizzle ORM:** https://orm.drizzle.team
- **React Docs:** https://react.dev
- **TypeScript Handbook:** https://www.typescriptlang.org/docs/

---

## License

[Add your license here - MIT, Apache 2.0, etc.]

---

## Acknowledgments

Built with love for The Sandwich Project nonprofit organization and the community it serves.

---

## Changelog

See commit history for detailed changes:
```bash
git log --oneline --graph
```

---

**Last Updated:** December 2024

For questions or issues, please open a GitHub issue or contact the maintainer.
