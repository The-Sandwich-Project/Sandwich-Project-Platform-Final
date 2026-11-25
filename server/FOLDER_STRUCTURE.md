# Server Folder Structure Organization

This document outlines the new organized folder structure for routes and services based on feature areas from the monolithic routes.ts file.

## Routes Structure (server/routes/)

### Organized Route Modules
- **`core/`** - Health checks, session management, and core API functionality
- **`users/`** - User management, authentication, and user profiles
- **`projects/`** - Project management, creation, updates, and assignments
- **`tasks/`** - Task management, completions, and multi-user task tracking
- **`notifications/`** - All notification systems (email, SMS, announcements, shoutouts)
- **`collections/`** - Sandwich distributions, collection tracking, bulk operations
- **`meetings/`** - Meeting agenda compilation, minutes, and meeting management
- **`messaging/`** - Direct messages, group conversations, real-time chat
- **`search/`** - Search functionality and wishlist suggestions
- **`reports/`** - Analytics dashboard, PDF generation, data export
- **`storage/`** - Object storage, document uploads, file permissions
- **`versioning/`** - Version control middleware and change tracking

### Legacy Route Files (to be migrated)
- activity-log.ts → reports/
- admin.ts → core/
- auth.ts → users/
- chat-simple.ts → messaging/
- chat.ts → messaging/
- conversations.ts → messaging/
- data-management.ts → core/
- email-routes.ts → notifications/
- enhanced-user-activity.ts → reports/
- error-logs.ts → core/
- event-requests.ts → meetings/
- google-sheets.ts → reports/
- groups-catalog.ts → collections/
- hosts.ts → collections/
- import-events.ts → meetings/
- message-notifications.ts → notifications/
- messages.ts → messaging/
- messaging.ts → messaging/
- password-reset.ts → users/
- performance.ts → core/
- projects.ts → projects/
- real-time-messages.ts → messaging/
- recipient-tsp-contacts.ts → collections/
- recipients.ts → collections/
- sandwich-distributions.ts → collections/
- shoutouts.ts → notifications/
- signup.ts → users/
- simple-messages.ts → messaging/
- sms-announcement.ts → notifications/
- stream.ts → messaging/
- user-activity.ts → reports/
- work-logs.ts → reports/

## Services Structure (server/services/)

### Organized Service Modules
- **`users/`** - User business logic, validation, and authentication helpers
- **`projects/`** - Project business logic, status management, assignment logic
- **`tasks/`** - Task completion tracking, multi-user task management
- **`collections/`** - Sandwich distribution management, bulk operations
- **`meetings/`** - Meeting agenda compilation, minutes processing
- **`search/`** - Search engine integration, optimization
- **`reports/`** - Analytics, PDF generation, data export functionality
- **`notifications/`** - Email, SMS, and in-app notification business logic ✅ **IMPLEMENTED**
- **`messaging/`** - Direct messaging, group chat, and real-time communication ✅ **IMPLEMENTED**
- **`storage/`** - Object storage, file management, and document handling ✅ **IMPLEMENTED**
- **`versioning/`** - Version control, change tracking, and audit trail management ✅ **IMPLEMENTED**

### Legacy Service Files (remain in root)
- email-notification-service.ts
- email-service.ts
- messaging-service.ts

## Migration Strategy

### Phase 1: Route Migration
1. **Move route logic from routes.ts to appropriate route modules**
2. **Update paths to be relative (remove /api prefix from individual routers)**
3. **Apply consistent middleware patterns using createStandardMiddleware()**
4. **Use shared schemas for validation with validateRequest()**

### Phase 2: Service Extraction
1. **Extract business logic from routes to service modules**
2. **Move complex operations to dedicated service classes**
3. **Implement consistent service interfaces**

### Phase 3: Integration Updates
1. **Update imports and references throughout the application**
2. **Test endpoint parity before and after migration**
3. **Update documentation and type definitions**

### Phase 4: Cleanup
1. **Remove legacy files and cleanup**
2. **Archive outdated code**
3. **Update configuration files**

## Standardized Mount Strategy Guidelines ✅ **IMPLEMENTED**

### Router Mount Points
All feature routers are mounted consistently under `/api` base paths:

```typescript
// In server/routes/index.ts
router.use("/api/users", createStandardMiddleware(), usersRouter);
router.use("/api/users", createErrorHandler("users"));

router.use("/api/projects", createStandardMiddleware(), projectsRouter);
router.use("/api/projects", createErrorHandler("projects"));
```

### Relative Paths in Feature Routers
Individual feature routers use relative paths:

```typescript
// In server/routes/users/index.ts
const router = Router();

// OLD: router.get('/api/users/:id', ...)
// NEW: router.get('/:id', ...)  // Will become /api/users/:id when mounted

export default router;
```

### Migration Example
```typescript
// BEFORE (in monolithic routes.ts):
app.get('/api/users/:id', requirePermission('users.read'), getUserById);

// AFTER (in routes/users/index.ts):
router.get('/:id', getUserById); // Middleware applied at mount point
```

## Shared Middleware Ordering Guidelines ✅ **IMPLEMENTED**

### Standard Middleware Stack Order
1. **Request Logging** - Track all incoming requests
2. **Input Sanitization** - Clean and validate input data
3. **Activity Logging** - Log user actions for audit trails
4. **Authentication** - Verify user identity (if required)
5. **Authorization** - Check permissions (if required)
6. **Validation** - Validate request data against schemas
7. **Version Control** - Track entity changes (if required)

### Middleware Application Patterns
```typescript
// Basic route (no auth required)
router.use(createStandardMiddleware());

// Protected route (auth required)
router.use(createStandardMiddleware(['users.read']));

// Custom middleware stack
router.use([
  requestLogger,
  sanitizeMiddleware,
  requirePermission('admin.access'),
  validateRequest(userSchema, 'body'),
  versionControlMiddleware
]);
```

## Validation via Shared Schemas Approach

### Schema Organization
```typescript
// shared/schemas/users.ts
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['user', 'admin', 'super_admin'])
});

export const updateUserSchema = createUserSchema.partial();
```

### Usage in Routes
```typescript
// routes/users/index.ts
import { validateRequest } from '../../middleware';
import { createUserSchema, updateUserSchema } from '../../../shared/schemas/users';

router.post('/', validateRequest(createUserSchema), createUser);
router.patch('/:id', validateRequest(updateUserSchema), updateUser);
```

## Parity Testing Checklist

### Pre-Migration Testing
- [ ] Document all existing endpoints and their behavior
- [ ] Create comprehensive test suite for legacy routes
- [ ] Capture baseline performance metrics
- [ ] Document authentication/authorization requirements

### During Migration Testing
- [ ] Verify endpoint parity between old and new routes
- [ ] Test middleware application order
- [ ] Validate request/response formats
- [ ] Check error handling consistency
- [ ] Verify permission checks work correctly

### Post-Migration Testing
- [ ] Run full regression test suite
- [ ] Compare performance metrics
- [ ] Test error scenarios and edge cases
- [ ] Validate logging and monitoring functionality
- [ ] Check documentation accuracy

### Testing Tools and Setup
```typescript
// __tests__/routes/users.test.ts
import request from 'supertest';
import { app } from '../../server';

describe('Users API Parity', () => {
  test('GET /api/users should return user list', async () => {
    const response = await request(app)
      .get('/api/users')
      .expect(200);
    
    expect(response.body).toHaveProperty('users');
  });
});
```

## File Naming Conventions

### Route Files
- All `index.ts` files export the main router for that module
- Feature-specific routes use descriptive names (`users.ts`, `projects.ts`)
- Sub-feature routes use kebab-case (`user-profiles.ts`, `project-assignments.ts`)

### Service Files
- Service classes use PascalCase with "Service" suffix (`UserService.ts`)
- Service interfaces use "I" prefix (`IUserService.ts`)
- Utility functions use camelCase (`userUtils.ts`)

### Middleware Files ✅ **IMPLEMENTED**
- Middleware functions use camelCase (`authMiddleware.ts`)
- Middleware factories use descriptive names (`createAuthMiddleware.ts`)
- Centralized exports in `middleware/index.ts`

## Error Handling Standards ✅ **IMPLEMENTED**

### Consistent Error Responses
```typescript
// All routes should return consistent error format
{
  "error": "Module Error",
  "message": "Descriptive error message",
  "status": 400,
  "module": "users",
  "timestamp": "2025-09-13T04:55:00.000Z"
}
```

### Module-Specific Error Handlers
```typescript
// Each feature module gets its own error handler
export function createErrorHandler(moduleId: string) {
  return (error: any, req: any, res: any, next: any) => {
    logger.error(`${moduleId} error: ${error.message}`, error);
    
    res.status(error.status || 500).json({
      error: `${moduleId} error`,
      message: isDevelopment ? error.message : 'Something went wrong',
      module: moduleId,
      timestamp: new Date().toISOString()
    });
  };
}
```

## Benefits

- **Modularity**: Related functionality is grouped together
- **Maintainability**: Easier to find and update specific features
- **Scalability**: New features can be added to appropriate modules
- **Testing**: Individual modules can be tested in isolation
- **Team Collaboration**: Multiple developers can work on different modules
- **Consistency**: Standardized patterns across all feature areas ✅ **IMPLEMENTED**
- **Performance**: Better code splitting and lazy loading opportunities

## Implementation Status

### Completed ✅
- [x] Services structure: notifications, messaging, storage, versioning
- [x] Centralized middleware configuration in `middleware/index.ts`
- [x] Router aggregator with consistent mount points in `routes/index.ts`
- [x] Standardized middleware ordering and error handling patterns
- [x] Comprehensive migration guidelines and testing approach

### Next Steps
- [ ] Migrate legacy route files to organized feature modules
- [ ] Implement comprehensive test suite for endpoint parity
- [ ] Extract business logic from routes to service classes
- [ ] Update all imports and references throughout application
- [ ] Archive legacy files after successful migration