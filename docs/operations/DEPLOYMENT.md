# Deployment Guide

**The Sandwich Project Platform**
**Last Updated:** 2025-10-25

This guide covers deploying the Sandwich Project Platform to production and managing deployments.

---

## Table of Contents

1. [Deployment Overview](#deployment-overview)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Replit Deployment](#replit-deployment)
4. [Environment Configuration](#environment-configuration)
5. [Database Migrations](#database-migrations)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Rollback Procedures](#rollback-procedures)
8. [Monitoring Deployments](#monitoring-deployments)
9. [Alternative Deployment Options](#alternative-deployment-options)

---

## Deployment Overview

### Current Setup

**Platform:** Replit (Autoscale Deployment)
**Deployment Method:** Git push to designated branch
**Build Process:** Automated via Replit
**Database:** Neon PostgreSQL (serverless)

### Deployment Flow

```
1. Developer pushes code to branch
   ↓
2. Replit detects changes
   ↓
3. Build process runs (npm run build)
   ↓
4. Health checks pass
   ↓
5. New version deployed
   ↓
6. Old version gracefully shut down
```

### Zero-Downtime Deployment

Replit autoscale provides:
- Rolling deployments
- Health check verification
- Automatic rollback on failure
- Load balancing during transition

---

## Pre-Deployment Checklist

### Code Quality

- [ ] All tests pass locally
  ```bash
  npm run test:all
  ```

- [ ] TypeScript compiles without errors
  ```bash
  npm run typecheck
  ```

- [ ] No linting errors
  ```bash
  npm run lint
  ```

- [ ] Build succeeds locally
  ```bash
  npm run build
  ```

### Testing

- [ ] Unit tests pass (60%+ coverage)
- [ ] Integration tests pass
- [ ] E2E tests pass (if applicable)
- [ ] Manual testing completed for new features
- [ ] Edge cases tested

### Database

- [ ] Migrations tested in development
- [ ] Database backup completed (if schema changes)
- [ ] Migration rollback plan documented
- [ ] No breaking schema changes (or coordinated deployment planned)

### Documentation

- [ ] `CHANGELOG.md` updated (if exists)
- [ ] API documentation updated (if API changes)
- [ ] README updated (if setup changes)
- [ ] Environment variable changes documented

### Security

- [ ] No secrets in code
- [ ] `.env.example` updated (if new env vars)
- [ ] Dependencies audited
  ```bash
  npm audit
  ```
- [ ] Security headers configured

### Monitoring

- [ ] Sentry release tagged
- [ ] Monitoring alerts configured
- [ ] Error tracking tested
- [ ] Metrics verified

---

## Replit Deployment

### Initial Setup

**1. Connect Repository to Replit:**

1. Go to Replit dashboard
2. Create new Repl from GitHub repository
3. Import repository
4. Configure deployment settings

**2. Configure Environment Variables:**

1. Go to Replit project
2. Click "Secrets" (lock icon) in sidebar
3. Add all required environment variables (see [Environment Configuration](#environment-configuration))

**3. Configure `.replit` File:**

Already configured in repository:

```toml
# .replit
modules = ["nodejs-20", "web", "postgresql-16", "python-3.11"]

run = "npm run dev"

[deployment]
deploymentTarget = "autoscale"
build = ["npm", "run", "build"]
run = "NODE_ENV=production node dist/index.js"

[[ports]]
localPort = 80
externalPort = 80

[[ports]]
localPort = 3000
externalPort = 3000

[[ports]]
localPort = 5000
externalPort = 5000
```

### Deploying a New Version

**Method 1: Git Push (Recommended)**

```bash
# 1. Ensure you're on the correct branch
git checkout claude/improve-documentation-monitoring-011CUTLxfsddjoAvriqLZo1q

# 2. Ensure branch is clean and up to date
git status
git pull origin claude/improve-documentation-monitoring-011CUTLxfsddjoAvriqLZo1q

# 3. Merge your changes (if on feature branch)
git merge feature/your-feature

# 4. Push to designated branch
git push -u origin claude/improve-documentation-monitoring-011CUTLxfsddjoAvriqLZo1q

# Replit will automatically detect and deploy
```

**Method 2: Replit Dashboard**

1. Go to Replit project
2. Click "Deployments" tab
3. Click "Deploy" button
4. Monitor build progress
5. Verify deployment

### Build Process

**What happens during build:**

```bash
# 1. Install dependencies
npm install

# 2. Build client (Vite)
vite build
# Output: dist/public/

# 3. Build server (ESBuild)
node esbuild.config.js
# Output: dist/index.js

# 4. Copy static assets
# Assets copied to dist/
```

**Build logs:**

View in Replit Deployments tab → Build Logs

### Deployment Verification

**Automatic health checks:**

Replit checks `/monitoring/health` endpoint:

```bash
curl https://[REPLIT_DOMAIN]/monitoring/health
# Should return 200 OK
```

If health check fails, deployment is rolled back automatically.

---

## Environment Configuration

### Required Environment Variables

**Production (`REPLIT_DOMAIN`):**

```env
# Database
PRODUCTION_DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require

# Session
SESSION_SECRET=<long-random-string-min-32-chars>

# Email (Twilio Email; separate from the SMS Twilio credentials)
TWILIO_EMAIL_API_KEY=SKxxxxx
TWILIO_EMAIL_API_SECRET=xxxxx
EMAIL_FROM_ADDRESS=sender@yourdomain.org
NOTIFICATION_FROM_EMAIL=noreply@yourdomain.com

# SMS (Twilio)
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+15551234567

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
GOOGLE_SHEET_ID=<spreadsheet-id>
GCS_BUCKET_NAME=<bucket-name>

# Monitoring
SENTRY_DSN=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxx@o000000.ingest.sentry.io/0000000
SENTRY_RELEASE=<git-sha-or-version>
NODE_ENV=production

# Domain
REPLIT_DOMAIN=your-app-name.replit.app

# Google Services (if using)
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
```

### Optional Environment Variables

```env
# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Performance
NODE_OPTIONS=--max-old-space-size=4096  # Increase memory if needed

# Features
ENABLE_GOOGLE_SHEETS_SYNC=true
ENABLE_SMS_NOTIFICATIONS=true
```

### Sensitive Credentials Management

**DO:**
- ✅ Store in Replit Secrets
- ✅ Use `.env.example` for template
- ✅ Rotate credentials periodically
- ✅ Use different credentials for dev/prod

**DON'T:**
- ❌ Commit secrets to Git
- ❌ Share secrets in Slack/Email
- ❌ Use same credentials across environments
- ❌ Store in plain text files

---

## Database Migrations

### Migration Strategy

**Development:**

```bash
# Make schema changes
# Edit shared/schema.ts

# Generate migration
npm run db:generate

# Apply migration locally
npm run db:push

# Test thoroughly
npm run test:all

# Commit schema changes
git add shared/schema.ts migrations/
git commit -m "feat(db): add new user_preferences table"
```

**Production:**

Migrations are applied automatically on deployment via Drizzle:

```typescript
// server/index.ts
import { migrate } from 'drizzle-orm/neon-http/migrator';

// On server start
await migrate(db, { migrationsFolder: './migrations' });
```

### Migration Best Practices

**Safe migrations:**

```sql
-- ✅ SAFE: Add nullable column
ALTER TABLE users ADD COLUMN phone_number TEXT;

-- ✅ SAFE: Add table
CREATE TABLE user_preferences (...);

-- ✅ SAFE: Add index
CREATE INDEX idx_users_email ON users(email);
```

**Risky migrations (require careful planning):**

```sql
-- ⚠️ RISKY: Drop column (data loss)
ALTER TABLE users DROP COLUMN deprecated_field;

-- ⚠️ RISKY: Rename column (app code must match)
ALTER TABLE users RENAME COLUMN old_name TO new_name;

-- ⚠️ RISKY: Add NOT NULL constraint (must have default or backfill)
ALTER TABLE users ADD COLUMN required_field TEXT NOT NULL;

-- ⚠️ RISKY: Change column type (data conversion)
ALTER TABLE users ALTER COLUMN age TYPE INTEGER;
```

### Handling Risky Migrations

**Multi-phase deployment:**

**Phase 1: Make column optional**
```sql
ALTER TABLE users ADD COLUMN new_field TEXT;  -- Nullable first
```

Deploy → Wait for adoption → Backfill data

**Phase 2: Make required**
```sql
-- Update all NULL values
UPDATE users SET new_field = 'default' WHERE new_field IS NULL;

-- Add constraint
ALTER TABLE users ALTER COLUMN new_field SET NOT NULL;
```

### Database Backup

**Before risky migrations:**

**Neon PostgreSQL:**
1. Go to Neon console: https://console.neon.tech
2. Select your project
3. Click "Backup"
4. Create manual backup
5. Document backup timestamp

**Recovery from backup:**
1. Contact Neon support
2. Provide backup timestamp
3. Restore to new branch or point-in-time

---

## Post-Deployment Verification

### Immediate Checks (0-5 minutes)

**1. Health Check:**
```bash
curl https://[REPLIT_DOMAIN]/monitoring/health/detailed
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-25T12:00:00Z",
  "components": {
    "database": { "status": "healthy" },
    "memory": { "status": "healthy" }
  }
}
```

**2. Application Loads:**
```bash
# Visit in browser
https://[REPLIT_DOMAIN]

# Should see login page or dashboard
```

**3. API Responds:**
```bash
curl https://[REPLIT_DOMAIN]/api/health
# Should return 200 OK
```

**4. Sentry Reporting:**
- Check Sentry dashboard
- Verify new release appears
- Check for immediate errors

### Short-term Checks (5-30 minutes)

**1. Monitoring Dashboard:**
```
https://[REPLIT_DOMAIN]/monitoring/dashboard
```

Monitor for:
- Error rate spikes
- Slow response times
- Database issues
- Memory leaks

**2. Critical Workflows:**

Test key user journeys:
- User login
- Create project
- Log collection
- Send notification
- Real-time messaging

**3. External Integrations:**
- Twilio Email (`npm run email:test -- you@example.com`)
- Twilio (send test SMS)
- Google Sheets (sync test)

### Long-term Monitoring (1-24 hours)

**1. Error Rates:**

Check Sentry for:
- New error types
- Increased error frequency
- User impact

**2. Performance:**

Monitor:
- Response times
- Database query performance
- Memory usage trends

**3. User Feedback:**

Watch for:
- Support tickets
- User reports
- Unexpected behavior

---

## Rollback Procedures

### When to Rollback

Rollback if:
- ❌ Critical features broken
- ❌ Data corruption occurring
- ❌ Security vulnerability introduced
- ❌ Performance severely degraded
- ❌ External integrations failing

### Quick Rollback (Replit)

**Method 1: Revert Git Commit**

```bash
# 1. Identify last known good commit
git log --oneline -10

# 2. Revert to that commit
git revert <bad-commit-sha>
# Or reset (destructive):
git reset --hard <good-commit-sha>

# 3. Force push to deployment branch
git push origin claude/improve-documentation-monitoring-011CUTLxfsddjoAvriqLZo1q --force

# Replit will auto-deploy
```

**Method 2: Replit Dashboard**

1. Go to Deployments tab
2. Find previous successful deployment
3. Click "Redeploy"
4. Confirm

**Method 3: Manual Revert**

```bash
# Revert specific files
git checkout <good-commit-sha> -- path/to/file.ts

# Commit revert
git commit -m "revert: rollback to previous version due to [issue]"

# Push
git push origin claude/improve-documentation-monitoring-011CUTLxfsddjoAvriqLZo1q
```

### Database Rollback

**If migration needs rollback:**

**Option 1: Write down migration**
```sql
-- migrations/down/001_rollback_user_preferences.sql
DROP TABLE user_preferences;
```

**Option 2: Restore from backup**

Contact Neon support for point-in-time restore.

**Option 3: Manual cleanup**
```sql
-- Remove problematic changes manually
ALTER TABLE users DROP COLUMN problematic_field;
```

### Post-Rollback

1. **Verify rollback successful:**
   ```bash
   curl https://[REPLIT_DOMAIN]/monitoring/health/detailed
   ```

2. **Monitor for stability:**
   - Check error rates
   - Verify functionality
   - Test critical workflows

3. **Communicate:**
   - Notify stakeholders
   - Update status page (if exists)
   - Document incident

4. **Post-mortem:**
   - Identify root cause
   - Document lessons learned
   - Implement safeguards

---

## Monitoring Deployments

### Real-time Monitoring

**Sentry Releases:**

Tag deployments in Sentry:

```bash
# Set SENTRY_RELEASE in environment
SENTRY_RELEASE=$(git rev-parse HEAD)

# Or in package.json script:
"deploy": "SENTRY_RELEASE=$(git rev-parse HEAD) npm run build"
```

View deployment impact in Sentry:
- Compare error rates before/after
- Track issues introduced
- Monitor affected users

### Metrics to Watch

**Application Health:**
- HTTP error rate (target: <1%)
- Response time (p95 <500ms)
- Database query time (p95 <100ms)
- Memory usage (<80% of limit)

**Business Metrics:**
- Active users
- Collections logged
- Notifications sent
- Chat messages

**External Services:**
- Email delivery rate
- SMS delivery rate
- Google Sheets sync status

### Alerting

Set up alerts for critical metrics (see `docs/ALERTING_SETUP.md`):

- Error rate spike (>5%)
- Response time degradation (p95 >1s)
- Database connection failures
- Memory usage high (>90%)
- External service failures

---

## Alternative Deployment Options

### Docker Deployment

**Create `Dockerfile`:**

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 5000

CMD ["node", "dist/index.js"]
```

**Build and run:**

```bash
# Build image
docker build -t sandwich-platform .

# Run container
docker run -p 5000:5000 \
  --env-file .env.production \
  sandwich-platform
```

### Kubernetes Deployment

**Create `k8s/deployment.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sandwich-platform
spec:
  replicas: 3
  selector:
    matchLabels:
      app: sandwich-platform
  template:
    metadata:
      labels:
        app: sandwich-platform
    spec:
      containers:
      - name: app
        image: sandwich-platform:latest
        ports:
        - containerPort: 5000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        livenessProbe:
          httpGet:
            path: /monitoring/health/live
            port: 5000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /monitoring/health/ready
            port: 5000
          initialDelaySeconds: 10
          periodSeconds: 5
```

**Deploy:**

```bash
kubectl apply -f k8s/
```

### Platform-as-a-Service Options

**Alternatives to Replit:**

| Platform | Pros | Cons |
|----------|------|------|
| **Heroku** | Easy setup, PostgreSQL add-on | Expensive at scale |
| **Railway** | Simple, affordable | Limited free tier |
| **Render** | Free tier, auto-deploy | Slower cold starts |
| **Fly.io** | Edge deployment, fast | More complex setup |
| **Vercel** | Great for frontend, serverless | Backend limited |

---

## Deployment Checklist

Use this checklist for every production deployment:

### Pre-Deployment

- [ ] All tests pass
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] Database migrations tested
- [ ] Environment variables verified
- [ ] Dependencies audited
- [ ] Sentry release prepared
- [ ] Stakeholders notified

### Deployment

- [ ] Build successful
- [ ] Health checks pass
- [ ] Application loads
- [ ] API responds
- [ ] Monitoring active

### Post-Deployment

- [ ] Verify critical workflows
- [ ] Check error rates
- [ ] Monitor performance
- [ ] Test integrations
- [ ] Confirm with stakeholders

### Rollback Plan

- [ ] Previous version identified
- [ ] Rollback steps documented
- [ ] Database backup confirmed
- [ ] Team ready to execute

---

## Questions?

For deployment issues:

1. Check `TROUBLESHOOTING.md`
2. Review Replit deployment logs
3. Check Sentry errors
4. Contact maintainer (see `HANDOFF.md`)

---

**Revision History:**

| Date | Author | Changes |
|------|--------|---------|
| 2025-10-25 | Claude | Initial creation |
