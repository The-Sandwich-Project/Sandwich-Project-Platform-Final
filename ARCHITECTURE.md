# System Architecture

**The Sandwich Project Platform**
**Last Updated:** 2025-10-25

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Technology Stack](#technology-stack)
4. [System Components](#system-components)
5. [Data Flow](#data-flow)
6. [Database Architecture](#database-architecture)
7. [Security Architecture](#security-architecture)
8. [Deployment Architecture](#deployment-architecture)
9. [Integration Points](#integration-points)
10. [Scalability Considerations](#scalability-considerations)

---

## High-Level Overview

The Sandwich Project Platform is a **full-stack TypeScript web application** built as a monorepo containing both client and server code. It follows a traditional three-tier architecture:

```
┌─────────────────────────────────────────────────────────┐
│                    Presentation Layer                    │
│              (React SPA + TypeScript)                    │
└─────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│           (Express REST API + WebSockets)                │
└─────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────┐
│                      Data Layer                          │
│         (PostgreSQL via Drizzle ORM)                     │
└─────────────────────────────────────────────────────────┘
```

### Key Characteristics

- **Monorepo Structure:** Client and server code in single repository
- **Shared Code:** Type definitions and schemas shared between client and server
- **Real-time Features:** WebSocket communication via Socket.IO
- **RESTful API:** Traditional REST endpoints for CRUD operations
- **Serverless Database:** PostgreSQL via Neon (with SQLite fallback for dev)
- **Comprehensive Monitoring:** Built-in observability with Prometheus metrics and Sentry

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                           CLIENT TIER                                 │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  React 18 + TypeScript                                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │  │
│  │  │   Routes     │  │  Components  │  │   Contexts   │        │  │
│  │  │  (Wouter)    │  │  (Radix UI)  │  │   (React)    │        │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │  │
│  │  │ TanStack     │  │  Socket.IO   │  │  React Hook  │        │  │
│  │  │ Query (API)  │  │  Client      │  │    Form      │        │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │  │
│  │                                                                 │  │
│  │  Build Tool: Vite                                              │  │
│  │  Styling: Tailwind CSS                                         │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                    ↕ HTTPS / WSS
┌──────────────────────────────────────────────────────────────────────┐
│                          SERVER TIER                                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Express.js + TypeScript                                       │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │           MIDDLEWARE STACK                              │  │  │
│  │  │  • Session Management (express-session)                 │  │  │
│  │  │  • Authentication Check                                 │  │  │
│  │  │  • Request Logging (Winston)                            │  │  │
│  │  │  • Activity Logger (Audit Trail)                        │  │  │
│  │  │  • Error Handler (Sentry)                               │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │  │
│  │  │   Routes     │  │   Services   │  │  Monitoring  │        │  │
│  │  │   (REST)     │  │   (Logic)    │  │  (Metrics)   │        │  │
│  │  │              │  │              │  │              │        │  │
│  │  │ • users      │  │ • notif      │  │ • Prometheus │        │  │
│  │  │ • projects   │  │ • messaging  │  │ • Health     │        │  │
│  │  │ • collections│  │ • storage    │  │ • Sentry     │        │  │
│  │  │ • events     │  │ • versioning │  │ • Dashboard  │        │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │  │
│  │                                                                 │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │          WEBSOCKET SERVER (Socket.IO)                    │  │  │
│  │  │  • Real-time messaging                                   │  │  │
│  │  │  • Live notifications                                    │  │  │
│  │  │  • Presence tracking                                     │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                    ↕
┌──────────────────────────────────────────────────────────────────────┐
│                          DATA TIER                                    │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Drizzle ORM                                                   │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │         Production: PostgreSQL (Neon Serverless)         │  │  │
│  │  │         Development: SQLite (local file)                 │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  Schema Definition: shared/schema.ts                           │  │
│  │  Connection Pooling: @neondatabase/serverless                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                    ↕
┌──────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL INTEGRATIONS                              │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Twilio Email │  │   Twilio     │  │  Google      │              │
│  │  (Email)     │  │   (SMS)      │  │  (Sheets/    │              │
│  │              │  │              │  │   Calendar)  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Sentry      │  │  Google      │  │  Leaflet     │              │
│  │  (Errors)    │  │  Cloud       │  │  (Maps)      │              │
│  │              │  │  Storage     │  │              │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 18.3.1 | UI framework |
| **TypeScript** | 5.6.3 | Type safety |
| **Vite** | 5.4.20 | Build tool & dev server |
| **Wouter** | 3.3.5 | Lightweight routing |
| **TanStack Query** | 5.60.5 | Server state management |
| **React Hook Form** | 7.55.0 | Form management |
| **Zod** | 3.24.2 | Schema validation |
| **Tailwind CSS** | 3.4.17 | Utility-first styling |
| **Radix UI** | 1.x | Accessible components |
| **Socket.IO Client** | 4.8.1 | Real-time communication |
| **Recharts** | 2.15.2 | Data visualization |
| **Leaflet** | 1.9.4 | Map visualization |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 20.x | Runtime |
| **Express** | 4.21.2 | Web framework |
| **TypeScript** | 5.6.3 | Type safety |
| **Drizzle ORM** | 0.44.6 | Database ORM |
| **@neondatabase/serverless** | 0.10.4 | PostgreSQL driver |
| **better-sqlite3** | 12.4.1 | SQLite driver (dev) |
| **Socket.IO** | 4.8.1 | WebSocket server |
| **Winston** | 3.17.0 | Structured logging |
| **Sentry** | 10.22.0 | Error tracking |
| **prom-client** | 15.1.3 | Prometheus metrics |
| **Bcrypt** | 6.0.0 | Password hashing |
| **Express Session** | 1.18.1 | Session management |

### Infrastructure

| Service | Purpose |
|---------|---------|
| **Replit** | Hosting & deployment |
| **Neon** | Serverless PostgreSQL |
| **Twilio Email** | Transactional email (`server/services/email`) |
| **Twilio** | SMS messaging |
| **Sentry** | Error monitoring |
| **Google Cloud** | File storage, Sheets sync |

---

## System Components

### Client Architecture

**Location:** `/client/src/`

```
client/src/
├── main.tsx              # Application entry point
├── App.tsx               # Root component, routing
├── components/           # Reusable UI components
│   ├── ui/               # Base components (buttons, inputs, etc.)
│   └── [feature]/        # Feature-specific components
├── pages/                # Page-level components (routes)
│   ├── Dashboard.tsx
│   ├── Projects.tsx
│   └── ...
├── hooks/                # Custom React hooks
│   ├── use-user.tsx      # Current user context
│   ├── use-toast.tsx     # Toast notifications
│   └── ...
├── contexts/             # React context providers
│   └── [feature]Context.tsx
├── lib/                  # Client utilities
│   ├── api.ts            # API client wrapper
│   ├── queryClient.ts    # TanStack Query setup
│   └── utils.ts          # Helper functions
└── index.css             # Global styles (Tailwind)
```

**Key Patterns:**

1. **Route-based Code Splitting:** Each page is a separate component
2. **Compound Component Pattern:** Radix UI primitives with custom styling
3. **Hooks for Logic:** Business logic extracted to custom hooks
4. **React Query for Data:** Server state managed via TanStack Query
5. **Context for Global State:** User session, theme, etc.

### Server Architecture

**Location:** `/server/`

```
server/
├── index.ts              # Application entry point
├── routes/               # API endpoint handlers
│   ├── core/             # Health checks, session
│   ├── users/            # User management
│   ├── collections/      # Sandwich collections
│   ├── projects/         # Project CRUD
│   ├── notifications/    # Email/SMS/in-app
│   ├── messaging/        # Real-time chat
│   └── ...
├── services/             # Business logic layer
│   ├── notifications/    # Notification orchestration
│   ├── messaging/        # Chat service
│   ├── storage/          # File uploads
│   └── versioning/       # Change tracking
├── middleware/           # Express middleware
│   ├── activity-logger.ts    # Audit trail
│   ├── logger.ts             # Request logging
│   └── auth.ts               # Authentication check
├── monitoring/           # Observability
│   ├── metrics.ts            # Prometheus metrics
│   ├── health-checks.ts      # Health endpoints
│   ├── sentry.ts             # Error tracking
│   └── database-monitor.ts   # DB performance
├── utils/                # Utilities
│   ├── logger.ts             # Winston logger setup
│   └── db.ts                 # Database connection
└── types/                # TypeScript types
```

**Key Patterns:**

1. **Layered Architecture:** Routes → Services → Database
2. **Middleware Pipeline:** Request flows through middleware stack
3. **Service Layer:** Business logic isolated from HTTP concerns
4. **Dependency Injection:** Database and services passed to routes
5. **Error Handling:** Centralized error middleware with Sentry

### Shared Code

**Location:** `/shared/`

```
shared/
├── schema.ts                 # Drizzle database schema
├── types.ts                  # TypeScript type definitions
├── permission-config.ts      # RBAC configuration
├── notification-types.ts     # Notification type enums
├── unified-auth-utils.ts     # Permission checking
└── validation-schemas.ts     # Zod schemas for API validation
```

**Purpose:** Code shared between client and server for type safety and consistency.

---

## Data Flow

### Typical Request Flow

```
1. User Action (Client)
   ↓
2. TanStack Query Hook (e.g., useMutation)
   ↓
3. API Client Request (fetch)
   ↓
4. Express Middleware Stack
   ↓
5. Route Handler
   ↓
6. Service Layer (business logic)
   ↓
7. Drizzle ORM Query
   ↓
8. PostgreSQL Database
   ↓
9. Response ← ← ← ← ← ← ←
   ↓
10. TanStack Query Cache Update
    ↓
11. React Component Re-render
```

### Example: Creating a Project

**Client Side:**

```typescript
// client/src/hooks/use-projects.tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';

const { mutate: createProject } = useMutation({
  mutationFn: async (data: ProjectInput) => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});
```

**Server Side:**

```typescript
// server/routes/projects/index.ts
app.post('/api/projects', async (req, res) => {
  // 1. Validation
  const validated = projectSchema.parse(req.body);

  // 2. Authorization check
  if (!hasPermission(req.user, 'projects:create')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 3. Business logic (service layer)
  const project = await projectService.create(validated, req.user.id);

  // 4. Audit log
  await auditLog.record('project_created', req.user.id, project.id);

  // 5. Response
  res.json(project);
});
```

### Real-time Communication Flow

```
1. User sends message (Client)
   ↓
2. Socket.IO emit
   ↓
3. WebSocket Server receives event
   ↓
4. Message validation & processing
   ↓
5. Save to database
   ↓
6. Broadcast to relevant clients (Socket.IO rooms)
   ↓
7. Clients receive message via Socket.IO listener
   ↓
8. UI updates in real-time
```

---

## Database Architecture

### Schema Overview

**ORM:** Drizzle (type-safe SQL query builder)
**Location:** `/shared/schema.ts`

### Core Tables

```
users
├── id (serial, PK)
├── email (unique)
├── password_hash
├── full_name
├── role (enum: admin, staff, volunteer, etc.)
└── created_at, updated_at

projects
├── id (serial, PK)
├── name
├── description
├── status (enum: active, completed, archived)
├── created_by (FK → users)
└── created_at, updated_at

collections
├── id (serial, PK)
├── collection_date
├── num_sandwiches
├── location
├── driver_id (FK → users)
├── host_id (FK → users)
└── created_at

event_requests
├── id (serial, PK)
├── requesting_organization
├── event_date
├── status (enum: pending, approved, completed)
└── created_at

notifications
├── id (serial, PK)
├── user_id (FK → users)
├── type (enum: email, sms, in_app)
├── content
├── sent_at
└── read_at

messages
├── id (serial, PK)
├── sender_id (FK → users)
├── recipient_id (FK → users, nullable for group)
├── content
├── conversation_id
└── created_at

user_activity_logs
├── id (serial, PK)
├── user_id (FK → users)
├── action
├── details (JSONB)
├── ip_address
└── timestamp
```

### Relationships

```
users ──1:N──> projects (created_by)
users ──1:N──> collections (driver_id, host_id)
users ──1:N──> notifications
users ──1:N──> messages (sender)
users ──1:N──> user_activity_logs
```

### Indexing Strategy

```sql
-- Performance-critical indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_notifications_user_sent ON notifications(user_id, sent_at);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_collections_date ON collections(collection_date);
CREATE INDEX idx_activity_logs_user_time ON user_activity_logs(user_id, timestamp);
```

### Database Connection

**Production (PostgreSQL via Neon):**

```typescript
// server/utils/db.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

const sql = neon(process.env.PRODUCTION_DATABASE_URL!);
export const db = drizzle(sql);
```

**Development (SQLite):**

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const sqlite = new Database('DATABASE.db');
export const db = drizzle(sqlite);
```

---

## Security Architecture

### Authentication

**Method:** Session-based authentication with secure cookies

```typescript
// server/index.ts
app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  store: new (connectPgSimple(session))({
    // PostgreSQL session store
    conObject: { connectionString: process.env.DATABASE_URL },
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    httpOnly: true,  // Prevent XSS
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'strict', // CSRF protection
  },
}));
```

**Password Security:**

```typescript
// server/routes/users/auth.ts
import bcrypt from 'bcrypt';

// On registration
const passwordHash = await bcrypt.hash(password, 10);

// On login
const isValid = await bcrypt.compare(password, user.password_hash);
```

### Authorization

**Role-Based Access Control (RBAC):**

**Location:** `/shared/permission-config.ts`

```typescript
export const ROLE_PERMISSIONS = {
  admin: [
    'users:read', 'users:create', 'users:update', 'users:delete',
    'projects:read', 'projects:create', 'projects:update', 'projects:delete',
    // ... all permissions
  ],
  staff: [
    'users:read',
    'projects:read', 'projects:create', 'projects:update',
    'collections:read', 'collections:create',
    // ... subset of permissions
  ],
  volunteer: [
    'projects:read',
    'collections:read',
    'messages:read', 'messages:send',
    // ... limited permissions
  ],
};

// Permission checking
export function hasPermission(user: User, permission: string): boolean {
  const rolePermissions = ROLE_PERMISSIONS[user.role] || [];
  return rolePermissions.includes(permission);
}
```

**Middleware:**

```typescript
// server/middleware/auth.ts
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

export function requirePermission(permission: string) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
```

### Input Validation

**Schema Validation with Zod:**

```typescript
// shared/validation-schemas.ts
import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  status: z.enum(['active', 'completed', 'archived']),
});

// In route handler
const validated = projectSchema.parse(req.body); // Throws if invalid
```

### Audit Logging

**All sensitive actions logged:**

```typescript
// server/audit-logger.ts
export async function auditLog(
  action: string,
  userId: number,
  details: Record<string, any>
) {
  await db.insert(userActivityLogs).values({
    userId,
    action,
    details: JSON.stringify(details),
    ipAddress: req.ip,
    timestamp: new Date(),
  });
}
```

---

## Deployment Architecture

### Replit Deployment

**Configuration:** `.replit` file

```toml
[deployment]
deploymentTarget = "autoscale"
build = ["npm", "run", "build"]
run = "NODE_ENV=production node dist/index.js"
```

**Build Process:**

1. **Client Build (Vite):**
   ```bash
   vite build
   # Output: dist/public/
   ```

2. **Server Build (ESBuild):**
   ```bash
   node esbuild.config.js
   # Output: dist/index.js
   ```

3. **Static Asset Serving:**
   ```typescript
   app.use(express.static('dist/public'));
   ```

**Environment Variables (Replit Secrets):**

- `PRODUCTION_DATABASE_URL` - Neon PostgreSQL connection
- `SESSION_SECRET` - Session encryption key
- `SENTRY_DSN` - Error tracking
- `TWILIO_EMAIL_API_KEY`, `TWILIO_EMAIL_API_SECRET`, `EMAIL_FROM_ADDRESS` - Email service (separate from the SMS Twilio credentials)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` - SMS service
- `REPLIT_DOMAIN` - Application domain

**Automatic Scaling:**

Replit autoscale deployment handles:
- Load balancing
- Auto-scaling based on traffic
- Zero-downtime deployments
- SSL/TLS certificate management

### Health Checks

**Location:** `server/monitoring/health-checks.ts`

```typescript
// Simple health (for load balancers)
GET /monitoring/health
→ 200 OK or 503 Service Unavailable

// Detailed health (for ops)
GET /monitoring/health/detailed
→ {
  status: 'healthy',
  timestamp: '2025-10-25T12:00:00Z',
  uptime: 12345,
  components: {
    database: { status: 'healthy', latency: 45 },
    redis: { status: 'healthy' },
    external_apis: { status: 'healthy' }
  }
}

// Kubernetes probes
GET /monitoring/health/ready   # Readiness probe
GET /monitoring/health/live    # Liveness probe
```

---

## Integration Points

### Email (Twilio Email)

**Location:** `server/services/email/`

```typescript
import { sendEmail } from '../services/email';

await sendEmail({
  emailStream: 'operational', // or 'newsletter'
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Welcome to The Sandwich Project</h1>',
});
```

Posts to `https://comms.twilio.com/v1/Emails` with Basic auth (`TWILIO_EMAIL_API_KEY:TWILIO_EMAIL_API_SECRET`). Checks `email_suppressions` first and adds a per-recipient email-preferences link.

### SMS (Twilio)

**Location:** `server/sms-providers/twilio-provider.ts`

```typescript
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendSMS(to: string, message: string) {
  await client.messages.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: message,
  });
}
```

### Google Sheets Sync

**Location:** `server/services/google-sheets-sync.ts`

**Purpose:** Bidirectional sync for project data and event requests

```typescript
import { google } from 'googleapis';

const sheets = google.sheets({ version: 'v4', auth });

export async function syncProjectToSheet(project: Project) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Projects!A:E',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[project.id, project.name, project.status]],
    },
  });
}
```

### Google Cloud Storage

**Location:** `server/services/storage/google-cloud-storage.ts`

**Purpose:** File uploads (documents, images)

```typescript
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME!);

export async function uploadFile(file: Buffer, filename: string) {
  const blob = bucket.file(filename);
  await blob.save(file);
  return blob.publicUrl();
}
```

### Error Tracking (Sentry)

**Location:** `server/monitoring/sentry.ts`

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

// Automatic error capture
app.use(Sentry.Handlers.errorHandler());
```

### Metrics (Prometheus)

**Location:** `server/monitoring/metrics.ts`

```typescript
import client from 'prom-client';

// HTTP request duration histogram
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
});

// Expose metrics
app.get('/monitoring/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
```

---

## Scalability Considerations

### Current Limitations

1. **Single Replit Instance:**
   - Vertical scaling only
   - No multi-region deployment
   - Limited to Replit's autoscale capacity

2. **Session Store:**
   - PostgreSQL session storage works but not ideal at scale
   - Consider Redis for high-traffic scenarios

3. **WebSocket Scaling:**
   - Socket.IO without Redis adapter
   - Won't scale horizontally without sticky sessions

4. **File Storage:**
   - Google Cloud Storage is scalable
   - No CDN in front (consider Cloudflare)

### Scaling Strategies

**When traffic grows:**

1. **Database Optimization:**
   - Add indexes for slow queries
   - Use read replicas (Neon supports this)
   - Implement caching layer (Redis)

2. **WebSocket Scaling:**
   - Add Socket.IO Redis adapter
   - Enable sticky sessions on load balancer

3. **Horizontal Scaling:**
   - Move from Replit to Kubernetes/Docker
   - Deploy multiple instances behind load balancer
   - Use Redis for session store

4. **CDN & Caching:**
   - CloudFlare in front for static assets
   - Cache API responses with Redis
   - Implement HTTP caching headers

5. **Background Jobs:**
   - Move heavy processing to job queue (Bull, BullMQ)
   - Separate worker processes
   - Email/SMS delivery via queue

### Performance Monitoring

**Current Metrics Tracked:**

- HTTP request duration
- Database query performance
- WebSocket connection count
- Memory usage
- Event loop lag
- Error rates

**Access:** `/monitoring/dashboard` or `/monitoring/metrics`

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2025-10-25 | Claude | Initial creation |
