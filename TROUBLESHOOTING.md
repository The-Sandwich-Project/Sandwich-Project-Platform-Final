# Troubleshooting Guide

**The Sandwich Project Platform**
**Last Updated:** 2025-10-25

This runbook contains solutions to common problems you may encounter when maintaining or developing the Sandwich Project Platform.

---

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Application Won't Start](#application-wont-start)
3. [Database Issues](#database-issues)
4. [Authentication Problems](#authentication-problems)
5. [API Errors](#api-errors)
6. [WebSocket/Real-time Issues](#websocketreal-time-issues)
7. [Email/SMS Delivery Failures](#emailsms-delivery-failures)
8. [Performance Issues](#performance-issues)
9. [Build/Deployment Failures](#builddeployment-failures)
10. [Testing Issues](#testing-issues)
11. [External Integration Failures](#external-integration-failures)
12. [Production Incidents](#production-incidents)

---

## Quick Diagnostics

### Health Check Commands

Run these first when investigating issues:

```bash
# 1. Check application health
curl http://localhost:5000/monitoring/health/detailed

# 2. Check database connectivity
npm run db:check

# 3. View recent logs
tail -f logs/combined.log

# 4. Check running processes
ps aux | grep node

# 5. Check port availability
lsof -i :5000
lsof -i :3000
```

### Monitoring Dashboard

Visit the monitoring dashboard for real-time system status:

```
http://localhost:5000/monitoring/dashboard  (development)
https://[REPLIT_DOMAIN]/monitoring/dashboard  (production)
```

**What to look for:**
- Red health checks
- Error rate spikes
- Slow database queries
- High memory usage
- WebSocket disconnections

### Sentry Dashboard

Check for runtime errors:

1. Visit your Sentry dashboard
2. Filter by environment (development/production)
3. Look for recent errors, trends, and affected users

---

## Application Won't Start

### Symptom: `npm run dev` fails immediately

**Common Causes:**

#### 1. Port Already in Use

**Error message:**
```
Error: listen EADDRINUSE: address already in use :::5000
```

**Solution:**
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=5001 npm run dev
```

#### 2. Missing Environment Variables

**Error message:**
```
Error: Environment variable PRODUCTION_DATABASE_URL is not defined
```

**Solution:**
```bash
# Copy example environment file
cp .env.example .env

# Edit .env and add missing variables
nano .env

# Required variables for development:
# - DATABASE_URL (or PRODUCTION_DATABASE_URL)
# - SESSION_SECRET
```

#### 3. Node Modules Not Installed

**Error message:**
```
Cannot find module 'express'
```

**Solution:**
```bash
# Remove existing node_modules
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

#### 4. TypeScript Compilation Errors

**Error message:**
```
error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'
```

**Solution:**
```bash
# Check for type errors
npm run typecheck

# Fix errors in the reported files
# Or temporarily bypass (not recommended for production):
npm run dev -- --no-typecheck
```

### Symptom: Application starts but crashes immediately

**Check logs:**
```bash
tail -f logs/error.log
```

**Common causes:**

1. **Database connection failure** → See [Database Issues](#database-issues)
2. **Sentry initialization failure** → Check `SENTRY_DSN` environment variable
3. **Session store failure** → Check database connection and session table

---

## Database Issues

### Cannot Connect to Database

**Error message:**
```
Error: connect ETIMEDOUT
Error: Connection refused
```

**Diagnosis:**

```bash
# Test database connection
npm run db:check

# For PostgreSQL, test directly:
psql $PRODUCTION_DATABASE_URL

# For SQLite, check file exists:
ls -lh DATABASE.db
```

**Solutions:**

#### Production (Neon PostgreSQL):

1. **Check Neon service status:**
   - Visit https://status.neon.tech
   - Verify your project is active in Neon console

2. **Verify connection string:**
   ```bash
   echo $PRODUCTION_DATABASE_URL
   # Should look like: postgresql://user:pass@host.neon.tech/dbname
   ```

3. **Check connection limits:**
   - Neon free tier has connection limits
   - View active connections in Neon dashboard
   - Consider connection pooling

4. **IP allowlist (if configured):**
   - Ensure Replit IPs are allowed
   - Check Neon project settings

#### Development (SQLite):

1. **Check database file exists:**
   ```bash
   ls -lh DATABASE.db
   ```

2. **Recreate database:**
   ```bash
   rm DATABASE.db
   npm run db:push
   npm run db:seed
   ```

3. **Check file permissions:**
   ```bash
   chmod 644 DATABASE.db
   ```

### Database Migrations Failed

**Error message:**
```
Error: Migration failed
Error: column "xyz" does not exist
```

**Solution:**

```bash
# 1. Check current schema
npm run db:studio  # Opens Drizzle Studio

# 2. Generate new migration
npm run db:generate

# 3. Apply migration
npm run db:push

# 4. If production, backup first!
# Contact Neon support for backup restore if needed
```

**For production issues:**

```bash
# NEVER run db:push directly on production!
# Always test migrations in development first

# 1. Test migration locally
npm run db:push

# 2. Verify application still works
npm run test:all

# 3. Deploy to production
# Migration will run automatically on deploy
```

### Slow Database Queries

**Symptom:** Application is slow, monitoring shows high DB query latency

**Diagnosis:**

1. **Check monitoring dashboard:**
   ```
   /monitoring/dashboard
   ```
   Look at "Database Query Duration" histogram

2. **Check Neon console:**
   - View slow query log
   - Check connection pool utilization

**Solutions:**

1. **Add missing indexes:**
   ```sql
   -- Example: Add index for common query
   CREATE INDEX idx_collections_date ON collections(collection_date);
   ```

2. **Optimize queries:**
   ```typescript
   // BAD: N+1 query
   for (const project of projects) {
     project.owner = await db.query.users.findFirst({
       where: eq(users.id, project.ownerId),
     });
   }

   // GOOD: Join query
   const projects = await db.query.projects.findMany({
     with: { owner: true },
   });
   ```

3. **Implement caching:**
   ```typescript
   // Add Redis caching for frequently accessed data
   const cachedProjects = await redis.get('projects:active');
   if (cachedProjects) return JSON.parse(cachedProjects);
   ```

### Database Connection Pool Exhausted

**Error message:**
```
Error: Connection pool exhausted
Error: Timeout acquiring client from pool
```

**Solution:**

```typescript
// server/utils/db.ts

// Increase pool size
const pool = new Pool({
  connectionString: process.env.PRODUCTION_DATABASE_URL,
  max: 20, // Increase from default 10
  idleTimeoutMillis: 30000,
});

// Ensure connections are released
try {
  const result = await db.query(...);
} finally {
  // Connection automatically released by Drizzle
}
```

---

## Authentication Problems

### User Cannot Log In

**Symptom:** Login fails with correct credentials

**Diagnosis:**

1. **Check user exists:**
   ```sql
   SELECT id, email, role FROM users WHERE email = 'user@example.com';
   ```

2. **Check password hash:**
   ```typescript
   // Test password hash manually
   const bcrypt = require('bcrypt');
   const match = await bcrypt.compare('password123', user.password_hash);
   console.log('Password match:', match);
   ```

3. **Check session store:**
   ```sql
   SELECT * FROM sessions WHERE sess::text LIKE '%userId%';
   ```

**Solutions:**

#### Invalid Password:

```bash
# Reset user password (development only!)
npm run reset-password user@example.com
```

#### Session Issues:

```typescript
// Clear all sessions
await db.delete(sessions);

// Or clear user's session
await db.delete(sessions).where(
  sql`sess::text LIKE '%"userId":${userId}%'`
);
```

#### Cookie Issues:

- Check browser cookie settings (third-party cookies enabled?)
- Verify `SESSION_SECRET` hasn't changed
- In production, ensure `secure: true` matches HTTPS status

### Session Expires Too Quickly

**Diagnosis:**

```typescript
// Check session configuration
// server/index.ts
app.use(session({
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // Should be 7 days
  },
}));
```

**Solution:**

Adjust `maxAge` in session configuration or verify session store is persisting correctly.

### Permission Denied Errors

**Error message:**
```
403 Forbidden
You don't have permission to access this resource
```

**Diagnosis:**

1. **Check user role:**
   ```sql
   SELECT id, email, role FROM users WHERE id = <userId>;
   ```

2. **Check permission configuration:**
   ```typescript
   // shared/permission-config.ts
   console.log(ROLE_PERMISSIONS[user.role]);
   ```

3. **Check permission middleware:**
   ```typescript
   // In route handler
   console.log('Required permission:', 'projects:create');
   console.log('User permissions:', ROLE_PERMISSIONS[req.user.role]);
   console.log('Has permission:', hasPermission(req.user, 'projects:create'));
   ```

**Solution:**

```typescript
// Update user role
await db.update(users)
  .set({ role: 'staff' })
  .where(eq(users.id, userId));

// Or add permission to role in permission-config.ts
```

---

## API Errors

### 500 Internal Server Error

**Diagnosis:**

1. **Check Sentry** for the error details
2. **Check server logs:**
   ```bash
   tail -f logs/error.log
   ```
3. **Check monitoring dashboard** for error spike

**Common causes:**

1. **Uncaught exception:**
   ```typescript
   // Missing error handling
   app.post('/api/foo', async (req, res) => {
     const result = await riskyOperation(); // Might throw
     res.json(result);
   });

   // Solution: Add try-catch
   app.post('/api/foo', async (req, res) => {
     try {
       const result = await riskyOperation();
       res.json(result);
     } catch (error) {
       console.error('Error in /api/foo:', error);
       res.status(500).json({ error: 'Internal server error' });
     }
   });
   ```

2. **Database query error:**
   - Check database connection
   - Verify schema matches expected structure
   - Look for missing columns or tables

### 404 Not Found (API exists but returns 404)

**Diagnosis:**

```bash
# Check route registration
grep -r "app.post('/api/projects'" server/routes/
```

**Common causes:**

1. **Route not registered:**
   ```typescript
   // server/index.ts
   import projectsRouter from './routes/projects';
   app.use('/api', projectsRouter); // Make sure this exists
   ```

2. **Incorrect route path:**
   ```typescript
   // In route file
   router.post('/projects', ...); // Correct
   router.post('/api/projects', ...); // Wrong (double /api)
   ```

### CORS Errors (in browser console)

**Error message:**
```
Access to fetch at 'http://localhost:5000/api/...' from origin 'http://localhost:3000'
has been blocked by CORS policy
```

**Solution:**

```typescript
// server/index.ts
import cors from 'cors';

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.REPLIT_DOMAIN
    : 'http://localhost:3000',
  credentials: true, // Important for cookies/sessions!
}));
```

### Request Validation Errors

**Error message:**
```
400 Bad Request
Validation error: expected string, got number
```

**Diagnosis:**

Check the Zod schema for the endpoint:

```typescript
// shared/validation-schemas.ts
export const projectSchema = z.object({
  name: z.string(), // Client is sending number?
});
```

**Solution:**

Fix client request or update schema:

```typescript
// Option 1: Fix client
fetch('/api/projects', {
  body: JSON.stringify({ name: String(value) }),
});

// Option 2: Coerce in schema
export const projectSchema = z.object({
  name: z.string().or(z.number().transform(String)),
});
```

---

## WebSocket/Real-time Issues

### Socket.IO Connection Fails

**Error in browser console:**
```
WebSocket connection failed
```

**Diagnosis:**

```typescript
// Client side
const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling'],
  withCredentials: true,
});

socket.on('connect', () => console.log('Connected!'));
socket.on('connect_error', (error) => console.error('Connection error:', error));
```

**Solutions:**

1. **CORS issue:**
   ```typescript
   // server/index.ts
   import { Server } from 'socket.io';

   const io = new Server(server, {
     cors: {
       origin: process.env.NODE_ENV === 'production'
         ? process.env.REPLIT_DOMAIN
         : 'http://localhost:3000',
       credentials: true,
     },
   });
   ```

2. **Port/URL mismatch:**
   - Client connects to wrong port
   - Check `REPLIT_DOMAIN` environment variable in production

3. **Firewall blocking WebSocket:**
   - Test with polling-only transport
   - Check Replit or network firewall settings

### Messages Not Received in Real-time

**Symptom:** Chat messages sent but not received by other users

**Diagnosis:**

1. **Check Socket.IO rooms:**
   ```typescript
   // Server side
   io.on('connection', (socket) => {
     console.log('Rooms:', socket.rooms);
   });
   ```

2. **Check event listeners:**
   ```typescript
   // Client side
   socket.on('new-message', (message) => {
     console.log('Received message:', message);
   });
   ```

**Common issues:**

1. **User not in correct room:**
   ```typescript
   // Server side
   socket.join(`conversation-${conversationId}`);
   ```

2. **Event name mismatch:**
   ```typescript
   // Server emits 'new-message', client listens for 'message'
   // Fix: Use same event name
   ```

3. **Message not broadcast to sender:**
   ```typescript
   // BAD: sender doesn't receive their own message
   socket.broadcast.to(room).emit('new-message', message);

   // GOOD: everyone in room receives
   io.to(room).emit('new-message', message);
   ```

---

## Email/SMS Delivery Failures

### Email Not Sending (Twilio Email)

**Diagnosis:**

```bash
npm run email:test -- you@example.com
```

It prints Twilio's HTTP status and response body (never the key). The app logs the same for every failed send (`[email] Twilio Email rejected the request: HTTP ...`), and the admin error log records it under category `twilio-email`.

**Solutions:**

1. **"Email is not configured":** set `TWILIO_EMAIL_API_KEY`, `TWILIO_EMAIL_API_SECRET` and `EMAIL_FROM_ADDRESS` in Replit Secrets (email only; the SMS `TWILIO_*` credentials are separate).
2. **401 / 403:** the API key or secret is wrong, or the key lacks Comms → Emails Create permission.
3. **From address rejected:** the From address must be on the domain verified in the Twilio Console (Email → Domains) and plain ASCII.
4. **"... unsubscribed from ... emails":** the address is in `email_suppressions`. The person can resubscribe from the preferences link in any email; bounces and spam reports can only be removed in the database.
5. **Accepted (202) but never arrived:** check the Twilio Console's email logs for that operation id, and the recipient's spam folder.

### Twilio SMS Not Sending

**Error message:**
```
Error: 21608 - The number is not a valid mobile number
Error: 21606 - The From phone number is not a valid
```

**Diagnosis:**

```bash
# Test Twilio credentials
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json" \
  --data-urlencode "Body=Test message" \
  --data-urlencode "From=$TWILIO_PHONE_NUMBER" \
  --data-urlencode "To=+15551234567" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"
```

**Solutions:**

1. **Phone number format:**
   ```typescript
   // Ensure E.164 format: +1234567890
   const formatted = phone.replace(/\D/g, '');
   const e164 = `+1${formatted}`;
   ```

2. **Twilio number not verified:**
   - In Twilio trial, verify recipient numbers
   - Upgrade to paid account for unrestricted sending

3. **SMS not supported in region:**
   - Check Twilio geographic permissions
   - Some countries require special approval

---

## Performance Issues

### Slow Page Load

**Diagnosis:**

1. **Check browser DevTools Network tab:**
   - Identify slow requests
   - Check for failed requests

2. **Check monitoring dashboard:**
   ```
   /monitoring/dashboard
   ```
   - Look at HTTP request duration
   - Identify slow endpoints

**Solutions:**

1. **Slow API calls:**
   - Optimize database queries (see [Database Issues](#database-issues))
   - Implement caching
   - Add pagination

2. **Large bundle size:**
   ```bash
   # Analyze bundle
   npm run build -- --analyze

   # Implement code splitting
   # Use React.lazy() for routes
   const ProjectPage = React.lazy(() => import('./pages/Projects'));
   ```

3. **Too many requests:**
   - Batch API calls
   - Use TanStack Query to deduplicate requests
   - Implement data prefetching

### High Memory Usage

**Diagnosis:**

```bash
# Check memory usage
curl http://localhost:5000/monitoring/metrics | grep process_resident_memory

# Or in monitoring dashboard
```

**Common causes:**

1. **Memory leak:**
   - Check for unremoved event listeners
   - Check for unclosed database connections
   - Profile with Node.js inspector

2. **Large data loads:**
   ```typescript
   // BAD: Load all data at once
   const allProjects = await db.query.projects.findMany();

   // GOOD: Paginate
   const projects = await db.query.projects.findMany({
     limit: 50,
     offset: page * 50,
   });
   ```

3. **Caching too much:**
   - Implement cache eviction
   - Set TTL on cached items

---

## Build/Deployment Failures

### Vite Build Fails

**Error message:**
```
Error: Build failed with X errors
```

**Common causes:**

1. **TypeScript errors:**
   ```bash
   # Check for type errors
   npm run typecheck
   ```

2. **Import errors:**
   - Missing node_modules
   - Incorrect import paths
   - Case-sensitive filename issues

**Solution:**

```bash
# Clean build
rm -rf dist node_modules
npm install
npm run build
```

### Replit Deployment Fails

**Check Replit deployment logs:**

1. Go to Replit Deployments tab
2. View deployment logs
3. Look for error messages

**Common issues:**

1. **Environment variables missing:**
   - Check Replit Secrets tab
   - Ensure all required variables are set

2. **Build command failed:**
   - Test build locally: `npm run build`
   - Fix any build errors

3. **Start command failed:**
   - Check `run` field in `.replit` file
   - Test start command locally: `node dist/index.js`

---

## Testing Issues

### Tests Fail Locally

**Error message:**
```
FAIL tests/integration/...
```

**Diagnosis:**

```bash
# Run tests with verbose output
npm run test -- --verbose

# Run specific test file
npm run test -- tests/integration/auth.test.ts
```

**Common causes:**

1. **Database not initialized:**
   ```bash
   # Reset test database
   npm run db:reset
   npm run db:seed
   ```

2. **Port conflicts:**
   - Test server can't bind to port
   - Kill conflicting process or use different port

3. **Environment variables:**
   ```bash
   # Ensure .env is set up for testing
   cp .env.example .env
   ```

### E2E Tests Fail

**Playwright errors:**

```bash
# Run E2E tests with UI
npm run test:e2e:ui

# Debug specific test
npm run test:e2e -- --debug tests/e2e/auth.spec.ts
```

**Solutions:**

1. **Application not running:**
   ```bash
   # Start app in separate terminal
   npm run dev

   # Then run E2E tests
   npm run test:e2e
   ```

2. **Selectors outdated:**
   - Update test selectors to match current UI
   - Use Playwright codegen: `npx playwright codegen`

---

## External Integration Failures

### Google Sheets Sync Not Working

**Error message:**
```
Error: Invalid credentials
Error: The caller does not have permission
```

**Solution:**

1. **Check service account credentials:**
   - Verify `GOOGLE_SERVICE_ACCOUNT_KEY` environment variable
   - Ensure JSON is properly formatted

2. **Check sheet permissions:**
   - Share sheet with service account email
   - Grant edit permissions

3. **Check sheet ID:**
   - Verify `GOOGLE_SHEET_ID` is correct
   - Test with Google Sheets API directly

### Google Cloud Storage Upload Fails

**Error message:**
```
Error: Could not load credentials
```

**Solution:**

```bash
# Set credentials explicitly
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Or in code:
import { Storage } from '@google-cloud/storage';
const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
```

---

## Production Incidents

### Application Down - Emergency Response

**Step 1: Verify outage**

```bash
# Check if site is accessible
curl -I https://[REPLIT_DOMAIN]/monitoring/health
```

**Step 2: Check Replit status**

- Visit https://status.replit.com
- Check for platform-wide issues

**Step 3: Check Sentry**

- Look for error spikes
- Identify root cause

**Step 4: Quick fixes**

```bash
# Restart application (Replit console)
# Or redeploy last known good version
```

**Step 5: Notify stakeholders**

Send status update to users and team.

### Data Integrity Issues

**If data corruption detected:**

1. **STOP** - Don't make changes
2. **Document** - Screenshot/export affected data
3. **Backup** - Contact Neon for point-in-time restore
4. **Restore** - Test in dev first!
5. **Post-mortem** - Document and prevent

### Security Incident Response

1. **Contain:** Disable affected accounts, rotate credentials
2. **Assess:** Check audit logs, Sentry errors
3. **Remediate:** Patch vulnerability, force password resets
4. **Notify:** Inform affected users and leadership
5. **Document:** Write incident report, update security practices

---

## Getting Help

### When to Ask for Help

- You've tried solutions in this guide
- Issue persists for >30 minutes
- Production is down
- Security incident
- Data loss risk

### Who to Contact

See **HANDOFF.md** for contact information:

- Previous maintainer
- Replit support
- Neon support
- Sentry support
- Organizational leadership

### Gathering Information

Before asking for help, gather:

1. **Error messages** (full stack trace)
2. **Reproduction steps**
3. **Logs** (server, database, Sentry)
4. **Environment** (dev vs. production)
5. **Timeline** (when did it start?)
6. **Impact** (how many users affected?)

---

## Contributing to This Guide

Found a solution not documented here? Please add it!

1. Document the problem
2. Document the diagnosis steps
3. Document the solution
4. Add to appropriate section
5. Update Table of Contents if needed

---

**Revision History:**

| Date | Author | Changes |
|------|--------|---------|
| 2025-10-25 | Claude | Initial creation |
