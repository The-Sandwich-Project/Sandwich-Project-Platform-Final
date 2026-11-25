# Code Guide - Key Patterns and Components

**The Sandwich Project Platform**
**Last Updated:** 2025-10-25

This guide explains key patterns, components, and code conventions used throughout the codebase. Read this to understand how the code is organized and how to work with it effectively.

---

## Table of Contents

1. [Server-Side Patterns](#server-side-patterns)
2. [Client-Side Patterns](#client-side-patterns)
3. [Database Patterns](#database-patterns)
4. [Testing Patterns](#testing-patterns)
5. [Common Utilities](#common-utilities)
6. [Integration Patterns](#integration-patterns)

---

## Server-Side Patterns

### Application Entry Point

**Location:** `server/index.ts`

**Key initialization order (IMPORTANT):**

1. **Sentry initialization** - Must be first to catch all errors
2. **Health check route** (`/healthz`) - Before middleware for deployment checks
3. **Performance monitoring** - Early in middleware chain
4. **Compression** - For performance
5. **Body parsing** - JSON and URL-encoded
6. **Session management** - PostgreSQL-backed sessions
7. **Route registration** - API routes
8. **Error handlers** - Catch-all error handling
9. **Server start** - HTTP server and WebSocket setup

**Why this order matters:**
- Health checks must respond even if other middleware fails
- Sentry must wrap all code to capture errors
- Session management before routes that need authentication

### Route Structure

**Pattern:** Routes → Handlers → Services → Database

```typescript
// server/routes/projects/index.ts
import { Router } from 'express';
import { db } from '../db';
import * as handlers from './handlers';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();

// Public route (no auth required)
router.get('/api/projects/public', handlers.listPublicProjects);

// Authenticated route
router.get('/api/projects', requireAuth, handlers.listProjects);

// Permission-protected route
router.post('/api/projects', requireAuth, requirePermission('projects:create'), handlers.createProject);

// Route with validation
router.put('/api/projects/:id', requireAuth, validateProjectUpdate, handlers.updateProject);
```

**File organization for routes:**

```
server/routes/projects/
├── index.ts          # Route definitions
├── handlers.ts       # Request handlers (thin layer)
├── service.ts        # Business logic (thick layer)
└── validation.ts     # Zod schemas
```

### Middleware Patterns

**Authentication middleware:**

```typescript
// server/middleware/auth.ts

// Adds req.user if authenticated, but doesn't reject
export function attachUser(req, res, next) {
  if (req.session?.userId) {
    req.user = await db.query.users.findFirst({
      where: eq(users.id, req.session.userId),
    });
  }
  next();
}

// Rejects unauthenticated requests
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Permission checking
export function requirePermission(permission: string) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
```

**Usage:**

```typescript
// Optional auth (user available if logged in)
router.get('/api/projects', attachUser, handler);

// Required auth
router.post('/api/projects', requireAuth, handler);

// Required permission
router.delete('/api/projects/:id', requireAuth, requirePermission('projects:delete'), handler);
```

### Error Handling Pattern

**Async route handlers:**

```typescript
// ✅ CORRECT: Errors caught and sent to error middleware
router.post('/api/users', async (req, res, next) => {
  try {
    const validated = userSchema.parse(req.body);
    const user = await createUser(validated);
    res.json(user);
  } catch (error) {
    next(error); // Pass to error middleware
  }
});

// Or use express-async-handler wrapper:
import asyncHandler from 'express-async-handler';

router.post('/api/users', asyncHandler(async (req, res) => {
  const validated = userSchema.parse(req.body);
  const user = await createUser(validated);
  res.json(user);
}));
```

**Error middleware (at end of middleware chain):**

```typescript
// server/index.ts
app.use((err, req, res, next) => {
  // Zod validation errors
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors,
    });
  }

  // Log error
  logger.error('Unhandled error:', err);

  // Send to Sentry
  Sentry.captureException(err);

  // Send generic error to client
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});
```

### Service Layer Pattern

**Keep business logic in services, not routes:**

```typescript
// server/routes/projects/handlers.ts
export async function createProject(req, res) {
  const validated = projectSchema.parse(req.body);
  const project = await projectService.create(validated, req.user.id);
  res.status(201).json(project);
}

// server/routes/projects/service.ts
export const projectService = {
  async create(data: ProjectInput, userId: number): Promise<Project> {
    // Validate business rules
    if (data.startDate > data.endDate) {
      throw new Error('Start date must be before end date');
    }

    // Create project
    const project = await db.insert(projects).values({
      ...data,
      createdBy: userId,
      createdAt: new Date(),
    }).returning();

    // Perform side effects
    await auditLog('project_created', userId, project.id);
    await notifyTeam('New project created', project);

    // Sync to Google Sheets
    await syncProjectToSheet(project);

    return project[0];
  },

  async update(id: number, data: ProjectInput): Promise<Project> {
    // Business logic here...
  },
};
```

**Why services?**
- Testable without HTTP layer
- Reusable across different routes
- Centralizes business logic
- Easier to maintain

---

## Client-Side Patterns

### Component Structure

**Location:** `client/src/components/`

**Pattern:** Smart components + Dumb components

```typescript
// Smart component (connected to data)
export function UserProfile({ userId }: { userId: number }) {
  const { data: user, isLoading } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  });

  const { mutate: updateUser } = useMutation({
    mutationFn: updateUserProfile,
    onSuccess: () => queryClient.invalidateQueries(['user', userId]),
  });

  if (isLoading) return <Spinner />;

  return <UserProfileView user={user} onUpdate={updateUser} />;
}

// Dumb component (pure presentation)
interface UserProfileViewProps {
  user: User;
  onUpdate: (data: Partial<User>) => void;
}

export function UserProfileView({ user, onUpdate }: UserProfileViewProps) {
  return (
    <div>
      <h1>{user.name}</h1>
      <button onClick={() => onUpdate({ name: 'New Name' })}>
        Update
      </button>
    </div>
  );
}
```

### Custom Hooks Pattern

**Extract logic to custom hooks:**

```typescript
// client/src/hooks/useUser.tsx
export function useUser(userId: number) {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetch(`/api/users/${userId}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { mutate: updateUser, isLoading: isUpdating } = useMutation({
    mutationFn: (data: Partial<User>) =>
      fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries(['user', userId]);
      toast.success('User updated');
    },
  });

  return { user, isLoading, error, updateUser, isUpdating };
}

// Usage in component
export function UserProfile({ userId }: { userId: number }) {
  const { user, isLoading, updateUser } = useUser(userId);

  if (isLoading) return <Spinner />;

  return <div>...</div>;
}
```

### TanStack Query Patterns

**Query keys:**

```typescript
// Organize query keys by entity
const queryKeys = {
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    list: (filters: UserFilters) => [...queryKeys.users.lists(), filters] as const,
    details: () => [...queryKeys.users.all, 'detail'] as const,
    detail: (id: number) => [...queryKeys.users.details(), id] as const,
  },
  projects: {
    all: ['projects'] as const,
    // ... similar structure
  },
};

// Usage
useQuery({
  queryKey: queryKeys.users.detail(userId),
  queryFn: () => fetchUser(userId),
});

// Invalidate all user queries
queryClient.invalidateQueries(queryKeys.users.all);

// Invalidate specific user
queryClient.invalidateQueries(queryKeys.users.detail(userId));
```

### Form Handling Pattern

**Using React Hook Form + Zod:**

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const projectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(5000).optional(),
  startDate: z.string(),
});

type ProjectForm = z.infer<typeof projectSchema>;

export function ProjectForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const { mutate: createProject } = useMutation({
    mutationFn: (data: ProjectForm) =>
      fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
  });

  const onSubmit = (data: ProjectForm) => {
    createProject(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}

      <textarea {...register('description')} />

      <button type="submit" disabled={isSubmitting}>
        Create Project
      </button>
    </form>
  );
}
```

---

## Database Patterns

### Drizzle ORM Queries

**Location:** Queries throughout server code

**Basic CRUD:**

```typescript
import { db } from './db';
import { users, projects } from '../shared/schema';
import { eq, and, desc, like } from 'drizzle-orm';

// Create
const newUser = await db.insert(users).values({
  email: 'user@example.com',
  fullName: 'John Doe',
}).returning();

// Read - single
const user = await db.query.users.findFirst({
  where: eq(users.id, userId),
});

// Read - multiple with conditions
const activeProjects = await db.query.projects.findMany({
  where: and(
    eq(projects.status, 'active'),
    eq(projects.createdBy, userId)
  ),
  orderBy: [desc(projects.createdAt)],
  limit: 10,
});

// Update
await db.update(users)
  .set({ fullName: 'Jane Doe', updatedAt: new Date() })
  .where(eq(users.id, userId));

// Delete
await db.delete(users).where(eq(users.id, userId));
```

**Relations (joins):**

```typescript
// Define relation in schema (shared/schema.ts)
export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  createdBy: integer('created_by').references(() => users.id),
});

export const projectsRelations = relations(projects, ({ one }) => ({
  owner: one(users, {
    fields: [projects.createdBy],
    references: [users.id],
  }),
}));

// Query with relations
const projectsWithOwners = await db.query.projects.findMany({
  with: {
    owner: true, // Automatically joins and populates owner
  },
});

// Result:
// [{ id: 1, name: 'Project 1', owner: { id: 1, name: 'John' } }]
```

**Transactions:**

```typescript
await db.transaction(async (tx) => {
  // Create project
  const project = await tx.insert(projects).values({
    name: 'New Project',
  }).returning();

  // Create initial tasks
  await tx.insert(tasks).values([
    { projectId: project[0].id, name: 'Task 1' },
    { projectId: project[0].id, name: 'Task 2' },
  ]);

  // If any operation fails, entire transaction rolls back
});
```

### Schema Definition

**Location:** `shared/schema.ts`

```typescript
import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  role: text('role', { enum: ['admin', 'staff', 'volunteer'] }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Add columns
export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', { enum: ['active', 'completed', 'archived'] }).notNull(),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## Testing Patterns

### Unit Tests

**Location:** `tests/unit/`

```typescript
import { describe, test, expect } from '@jest/globals';
import { hasPermission } from '../shared/unified-auth-utils';

describe('hasPermission', () => {
  test('admin has all permissions', () => {
    const admin = { id: 1, role: 'admin' };
    expect(hasPermission(admin, 'users:delete')).toBe(true);
    expect(hasPermission(admin, 'projects:create')).toBe(true);
  });

  test('volunteer has limited permissions', () => {
    const volunteer = { id: 2, role: 'volunteer' };
    expect(hasPermission(volunteer, 'users:delete')).toBe(false);
    expect(hasPermission(volunteer, 'projects:read')).toBe(true);
  });
});
```

### Integration Tests

**Location:** `tests/integration/`

```typescript
import request from 'supertest';
import { app } from '../../server';
import { db } from '../../server/db';
import { users } from '../../shared/schema';

describe('POST /api/users', () => {
  beforeEach(async () => {
    // Clean database before each test
    await db.delete(users);
  });

  test('creates user with valid data', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({
        email: 'test@example.com',
        password: 'secure123',
        fullName: 'Test User',
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.email).toBe('test@example.com');
  });

  test('rejects duplicate email', async () => {
    // Create first user
    await db.insert(users).values({
      email: 'test@example.com',
      passwordHash: 'hash',
      fullName: 'First User',
    });

    // Try to create duplicate
    const response = await request(app)
      .post('/api/users')
      .send({
        email: 'test@example.com',
        password: 'secure123',
        fullName: 'Second User',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('already exists');
  });
});
```

---

## Common Utilities

### Logger

**Location:** `server/utils/logger.ts`

```typescript
import logger, { createServiceLogger } from './utils/logger';

// App-wide logger
logger.info('Application started');
logger.error('Database connection failed', { error });

// Service-specific logger
const projectLogger = createServiceLogger('projects');
projectLogger.info('Project created', { projectId: 123 });

// Logs are structured JSON:
// { level: 'info', message: 'Project created', projectId: 123, timestamp: '...' }
```

### Permissions

**Location:** `shared/unified-auth-utils.ts`

```typescript
import { hasPermission } from '../shared/unified-auth-utils';

// Check single permission
if (hasPermission(req.user, 'projects:create')) {
  // User can create projects
}

// Check multiple permissions (any)
if (hasPermission(req.user, 'projects:update', 'projects:delete')) {
  // User can update OR delete
}
```

---

## Integration Patterns

### Email (Twilio Email)

**Location:** `server/services/email/`

```typescript
import { sendEmail } from '../services/email';

await sendEmail({
  emailStream: 'operational', // 'newsletter' for announcements
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Welcome to The Sandwich Project</h1>',
});
```

### Twilio SMS

**Location:** `server/sms-providers/twilio-provider.ts`

```typescript
import { sendSMS } from './sms-providers/twilio-provider';

await sendSMS('+15551234567', 'Your sandwich collection is ready!');
```

### Google Sheets Sync

**Location:** `server/services/google-sheets-sync.ts`

```typescript
import { syncProjectToSheet } from './services/google-sheets-sync';

// Automatically sync project data to Google Sheets
await syncProjectToSheet(project);
```

---

## Code Reading Tips

### Understanding a New Feature

1. **Start with routes:** `server/routes/<feature>/index.ts`
2. **Check handlers:** `server/routes/<feature>/handlers.ts`
3. **Review service logic:** `server/routes/<feature>/service.ts`
4. **Examine schema:** `shared/schema.ts` (database tables)
5. **Check permissions:** `shared/permission-config.ts`
6. **Read tests:** `tests/integration/routes/<feature>.test.ts`

### Following Request Flow

1. **Client sends request** → `client/src/lib/api.ts` or TanStack Query hook
2. **HTTP request** → Express receives at route
3. **Middleware runs** → Auth, validation, logging
4. **Route handler** → Thin layer, calls service
5. **Service layer** → Business logic
6. **Database query** → Drizzle ORM
7. **Response** → Back through middleware, to client
8. **Client updates** → TanStack Query cache, React re-renders

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2025-10-25 | Claude | Initial creation |
