# Maintainer Handoff Guide

**Last Updated:** 2025-10-25
**Primary Maintainer:** [Current Maintainer Name]
**Repository:** The Sandwich Project Platform

## Purpose of This Document

This guide is designed to help a new volunteer maintainer take over this project successfully. It assumes you're a developer with some experience in web development but may not be familiar with this specific codebase.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [What This Project Does](#what-this-project-does)
3. [Critical Knowledge](#critical-knowledge)
4. [Your First Week](#your-first-week)
5. [Key Responsibilities](#key-responsibilities)
6. [Important Contacts](#important-contacts)
7. [Common Tasks](#common-tasks)
8. [Emergency Procedures](#emergency-procedures)
9. [Learning Resources](#learning-resources)

---

## Quick Start

### First 30 Minutes

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Sandwich-Project-Platform-Final
   ```

2. **Read these documents in order:**
   - `README.md` - Project overview and setup
   - `docs/DEVELOPER_SETUP.md` - Development environment setup
   - This document (HANDOFF.md)
   - `ARCHITECTURE.md` - System design overview

3. **Set up your development environment:**
   ```bash
   npm install
   cp .env.example .env
   # Edit .env with development credentials (ask previous maintainer)
   npm run dev
   ```

4. **Verify the application works:**
   - Frontend should be at `http://localhost:3000`
   - Backend API at `http://localhost:5000`
   - Login with test credentials (see DEVELOPER_SETUP.md)

### First Day

1. **Run the test suite:**
   ```bash
   npm run test        # Unit + integration tests
   npm run test:e2e    # End-to-end tests
   ```

2. **Check the monitoring dashboard:**
   - Start the app: `npm run dev`
   - Visit: `http://localhost:5000/monitoring/dashboard`
   - Familiarize yourself with metrics and health checks

3. **Review recent commits:**
   ```bash
   git log --oneline --graph --all -20
   ```

4. **Check for open issues and PRs:**
   - Review GitHub Issues
   - Understand what's in flight

---

## What This Project Does

### Mission

The Sandwich Project Platform is a comprehensive management system for **The Sandwich Project**, a nonprofit organization that:

- Collects donated sandwiches from restaurants
- Coordinates volunteers (drivers, hosts)
- Distributes sandwiches to people in need
- Tracks donations, events, and impact metrics

### Key Features

1. **User Management** - Volunteers, admins, and staff with role-based access
2. **Event Requests** - Organizations can request sandwich distribution events
3. **Collections Tracking** - Log sandwich pickups and distributions
4. **Project Management** - Coordinate initiatives and campaigns
5. **Real-time Messaging** - Chat system for volunteer coordination
6. **Notifications** - Email (Twilio Email) and SMS (Twilio) alerts
7. **Analytics Dashboard** - Track impact, donations, and volunteer hours
8. **Meeting Management** - Agendas, minutes, and documentation

### Users

- **Admins** - Full system access, user management
- **Staff** - Operational management
- **Volunteers** - Drivers, hosts, general helpers
- **Event Organizers** - Request and manage distribution events
- **Recipients** - Track sandwich collections

---

## Critical Knowledge

### Technology Stack

**Frontend:**
- React 18 + TypeScript
- Vite (build tool)
- TanStack Query (data fetching)
- Tailwind CSS + Radix UI (styling)
- Socket.IO (real-time features)

**Backend:**
- Node.js + Express + TypeScript
- Drizzle ORM
- PostgreSQL (Neon serverless in production)
- SQLite (local development fallback)
- Winston (logging)
- Sentry (error tracking)

**Deployment:**
- Primary: Replit (autoscale deployment)
- Branch: `claude/improve-documentation-monitoring-011CUTLxfsddjoAvriqLZo1q`

### Environments

| Environment | URL | Database | Purpose |
|-------------|-----|----------|---------|
| **Development** | `localhost:3000` | SQLite or local PostgreSQL | Local development |
| **Production** | `[REPLIT_DOMAIN]` | Neon PostgreSQL | Live application |

### Critical Environment Variables

**Required for production:**
```env
# Database
PRODUCTION_DATABASE_URL=postgresql://...

# Monitoring
SENTRY_DSN=https://...
SENTRY_RELEASE=<git-sha>

# Email
TWILIO_EMAIL_API_KEY=SK...
TWILIO_EMAIL_API_SECRET=...
EMAIL_FROM_ADDRESS=katie@thesandwichproject.org
NOTIFICATION_FROM_EMAIL=noreply@...

# SMS
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# Domain
REPLIT_DOMAIN=your-app.replit.app

# Session
SESSION_SECRET=<random-string>
```

**Where are these stored?**
- Production: Replit Secrets tab
- Development: `.env` file (never commit this!)
- Template: `.env.example` (safe to commit)

### Critical Files & Folders

| Path | Purpose | Don't Touch Without Understanding |
|------|---------|-----------------------------------|
| `shared/schema.ts` | Database schema (Drizzle ORM) | Changes require migrations |
| `shared/permission-config.ts` | Role-based access control | Breaking changes affect all users |
| `server/index.ts` | Server entry point | Core initialization |
| `client/src/App.tsx` | Frontend entry point | Routing configuration |
| `.replit` | Replit deployment config | Affects production |
| `package.json` | Dependencies & scripts | Version conflicts can break things |

---

## Your First Week

### Day 1: Environment & Exploration

- [ ] Complete "Quick Start" section above
- [ ] Read `ARCHITECTURE.md`
- [ ] Review `MONITORING.md` to understand observability
- [ ] Explore the monitoring dashboard
- [ ] Browse the codebase structure (see `server/FOLDER_STRUCTURE.md`)

### Day 2: Testing & Code Quality

- [ ] Read `TESTING.md`
- [ ] Run all test suites and ensure they pass
- [ ] Run `npm run test:coverage` to see coverage reports
- [ ] Review code quality tools: ESLint, Prettier, TypeScript

### Day 3: Deploy & Monitor

- [ ] Review `DEPLOYMENT.md`
- [ ] Make a trivial change (fix a typo, update a comment)
- [ ] Deploy to a test branch on Replit
- [ ] Monitor the deployment in real-time
- [ ] Check Sentry for any errors

### Day 4: User Flows

- [ ] Create a test user account
- [ ] Go through key workflows:
  - Create an event request
  - Log a sandwich collection
  - Send a notification
  - Use the chat system
- [ ] Review permission system (`shared/permission-config.ts`)

### Day 5: Integration Points

- [ ] Review external integrations:
  - Twilio Email (email)
  - Twilio (SMS)
  - Google Sheets (sync)
  - Sentry (errors)
- [ ] Check integration health in monitoring dashboard
- [ ] Test one integration in development

---

## Key Responsibilities

### Daily

1. **Monitor Sentry for errors**
   - Login to Sentry dashboard
   - Review new errors
   - Triage by impact (production vs. dev)

2. **Check monitoring dashboard**
   - Visit `/monitoring/dashboard`
   - Ensure all health checks are green
   - Review error rates and performance

3. **Review notifications**
   - Check for failed email/SMS deliveries
   - Ensure notification queues are healthy

### Weekly

1. **Review open issues and PRs**
   - Triage new issues
   - Respond to community questions
   - Review and merge PRs

2. **Check database health**
   - Review query performance in monitoring
   - Check for slow queries
   - Monitor database size (Neon free tier has limits)

3. **Update dependencies** (security patches)
   ```bash
   npm audit
   npm audit fix
   ```

### Monthly

1. **Review and update documentation**
   - Update this handoff guide
   - Fix any outdated instructions
   - Add new learnings

2. **Performance review**
   - Check monitoring metrics trends
   - Identify performance bottlenecks
   - Optimize if needed

3. **Backup verification**
   - Ensure database backups are working
   - Test restore procedure (in dev!)

### Quarterly

1. **Dependency updates** (major versions)
   ```bash
   npm outdated
   # Carefully update major versions
   npm run test:all  # Verify after updates
   ```

2. **Security audit**
   - Review permissions and access
   - Audit user roles
   - Check for exposed secrets

3. **Roadmap review**
   - Review feature requests
   - Plan next quarter's priorities
   - Communicate with stakeholders

---

## Important Contacts

### Technical

| Role | Name | Contact | Responsibilities |
|------|------|---------|------------------|
| **Previous Maintainer** | [Name] | [Email/GitHub] | Handoff, knowledge transfer |
| **Replit Support** | - | https://replit.com/support | Deployment issues |
| **Database (Neon)** | - | https://neon.tech/docs | Database support |
| **Sentry** | - | https://sentry.io/support | Error tracking |

### Organizational

| Role | Name | Contact | Responsibilities |
|------|------|---------|------------------|
| **Nonprofit Director** | [Name] | [Email] | Strategic direction |
| **Operations Manager** | [Name] | [Email] | Day-to-day operations |
| **Volunteer Coordinator** | [Name] | [Email] | User issues, feature requests |

### Vendors & Services

| Service | Purpose | Admin Login | Support |
|---------|---------|-------------|---------|
| **Replit** | Hosting | [URL] | https://replit.com/support |
| **Neon** | Database | [URL] | https://neon.tech/docs |
| **Twilio Email** | Email | [URL] | https://help.twilio.com |
| **Twilio** | SMS | [URL] | https://support.twilio.com |
| **Sentry** | Error Tracking | [URL] | https://sentry.io/support |
| **Google Cloud** | Storage, Sheets | [URL] | https://cloud.google.com/support |

---

## Common Tasks

### Adding a New Feature

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Follow the development workflow:**
   - Read `CONTRIBUTING.md` for code standards
   - Write tests first (TDD approach)
   - Implement feature
   - Update documentation
   - Run `npm run test:all`

3. **Deploy to test environment:**
   - Push branch to Replit
   - Test in staging/preview environment
   - Get stakeholder approval

4. **Merge to main:**
   ```bash
   git checkout main
   git merge feature/your-feature-name
   git push origin main
   ```

5. **Monitor deployment:**
   - Check Sentry for new errors
   - Monitor `/monitoring/dashboard`
   - Verify feature works in production

### Fixing a Bug

1. **Reproduce the bug:**
   - Check Sentry error details
   - Reproduce locally if possible
   - Document reproduction steps

2. **Write a failing test:**
   - Add test that exposes the bug
   - Verify test fails

3. **Fix the bug:**
   - Implement fix
   - Verify test passes
   - Run full test suite

4. **Deploy quickly:**
   - For critical bugs, deploy immediately
   - For minor bugs, batch with next release

### Managing Database Migrations

**Adding a new table or column:**

1. **Update schema:**
   ```typescript
   // shared/schema.ts
   export const newTable = pgTable('new_table', {
     id: serial('id').primaryKey(),
     // ... fields
   });
   ```

2. **Generate migration:**
   ```bash
   npm run db:generate
   ```

3. **Apply migration:**
   ```bash
   npm run db:push  # Development
   # Production migrations happen automatically on deploy
   ```

4. **Test thoroughly:**
   - Verify migration works locally
   - Test rollback if needed
   - Backup production database before deploying

**WARNING:** Database migrations can break production. Always test locally first!

### Updating Dependencies

**Security patches (safe):**
```bash
npm audit fix
npm run test:all
git commit -am "chore: security updates"
```

**Minor/major updates (risky):**
```bash
npm outdated
npm update <package-name>
npm run test:all  # CRITICAL!
# Test manually in dev environment
# Deploy to staging first
```

### Handling User Issues

1. **Gather information:**
   - What were they trying to do?
   - What happened instead?
   - Browser, device, timestamp

2. **Check logs:**
   - Sentry errors for that user/time
   - Application logs (Winston)
   - Monitoring dashboard

3. **Reproduce:**
   - Try to reproduce locally
   - Check if it's a permissions issue
   - Verify user's role and access

4. **Fix and communicate:**
   - Fix the issue or provide workaround
   - Update user with resolution
   - Document in troubleshooting guide

---

## Emergency Procedures

### Application is Down

1. **Check Replit status:**
   - Visit https://status.replit.com
   - Check if there's a platform outage

2. **Check health endpoint:**
   ```bash
   curl https://[REPLIT_DOMAIN]/monitoring/health
   ```

3. **Check Sentry:**
   - Look for spike in errors
   - Identify root cause

4. **Quick fixes:**
   - Restart the application (Replit console)
   - Check environment variables
   - Verify database connection

5. **If database is down:**
   - Check Neon dashboard: https://console.neon.tech
   - Verify `PRODUCTION_DATABASE_URL` is correct
   - Check database connection limits

6. **Communicate:**
   - Post status update to stakeholders
   - Update users if downtime is extended
   - Document incident for post-mortem

### Data Loss or Corruption

1. **STOP** - Don't make changes that could make it worse
2. **Assess scope:**
   - What data is affected?
   - When did it happen?
   - How many users impacted?

3. **Check backups:**
   - Neon provides automated backups (7-14 days retention)
   - Contact Neon support for restore options

4. **Document everything:**
   - Take screenshots
   - Export affected data if possible
   - Document timeline

5. **Restore from backup:**
   - Test in development first!
   - Coordinate downtime with stakeholders
   - Perform restore in production

6. **Post-mortem:**
   - Document what happened
   - Implement safeguards to prevent recurrence
   - Update runbooks

### Security Incident

1. **Contain the incident:**
   - If credentials are compromised, rotate immediately
   - Lock affected user accounts
   - Take offline if actively being attacked

2. **Assess damage:**
   - Check audit logs (`user_activity_logs` table)
   - Review Sentry errors
   - Check for data exfiltration

3. **Remediate:**
   - Patch vulnerability
   - Force password resets if needed
   - Update security configurations

4. **Notify:**
   - Inform affected users
   - Report to organizational leadership
   - Consider legal/regulatory requirements

5. **Learn:**
   - Document incident
   - Implement preventive measures
   - Update security practices

### Twilio Email or Twilio SMS Outage

1. **Verify outage:**
   - Check service status pages
   - Check Sentry for delivery errors

2. **Temporary workaround:**
   - Notifications will queue automatically
   - Consider alternative communication (in-app notifications)

3. **When service restores:**
   - Verify queued notifications process
   - Check for any stuck messages

### Database Connection Issues

1. **Check Neon dashboard:**
   - Verify service is running
   - Check connection limits
   - Review query performance

2. **Common fixes:**
   ```bash
   # Verify DATABASE_URL is correct
   echo $PRODUCTION_DATABASE_URL

   # Check connection from Replit shell
   npm run db:check
   ```

3. **Connection pool exhausted:**
   - Check `/monitoring/database` endpoint
   - Look for slow queries
   - Restart application to reset pool

---

## Learning Resources

### Recommended Reading Order

1. **Setup & Architecture:**
   - `README.md`
   - `ARCHITECTURE.md`
   - `docs/DEVELOPER_SETUP.md`

2. **Operations:**
   - `MONITORING.md`
   - `DEPLOYMENT.md`
   - `TROUBLESHOOTING.md`

3. **Development:**
   - `CONTRIBUTING.md`
   - `TESTING.md`
   - `server/FOLDER_STRUCTURE.md`

4. **Specialized Topics:**
   - `docs/SECURITY-NUMERIC-PERMISSIONS.md` - Permission system
   - `server/services/notifications/README.md` - Notification system
   - `replit.md` - Deployment architecture

### External Resources

**Technologies:**
- [React Documentation](https://react.dev)
- [Express.js Guide](https://expressjs.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS](https://tailwindcss.com/docs)

**Tools:**
- [Replit Docs](https://docs.replit.com)
- [Neon Docs](https://neon.tech/docs)
- [Sentry Docs](https://docs.sentry.io)
- [Playwright Docs](https://playwright.dev)

**Monitoring & Observability:**
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)
- [Winston Logging](https://github.com/winstonjs/winston)

---

## Success Criteria

You'll know you're successfully maintaining this project when:

- [ ] You can deploy changes confidently
- [ ] You understand how to read monitoring dashboards
- [ ] You can triage and fix bugs independently
- [ ] You're comfortable with the testing workflow
- [ ] You know who to contact for different issues
- [ ] You've successfully handled an incident
- [ ] You can onboard the next maintainer using this guide

---

## Final Notes

### Things to Remember

1. **You don't need to know everything** - This guide exists to help you learn as you go
2. **Document as you learn** - Update this guide with new discoveries
3. **Ask for help** - Contact the previous maintainer or stakeholders
4. **Test thoroughly** - Especially before database changes
5. **Monitor proactively** - Check dashboards regularly
6. **Communicate clearly** - Keep stakeholders informed

### Keeping This Document Updated

**Please update this document when:**
- Contact information changes
- New critical processes are established
- You discover important information not documented here
- Environment or deployment procedures change
- You wish you had known something when you started

### Passing the Torch

When you hand off to the next maintainer:

1. Schedule a video call to walk through this document
2. Give them access to all necessary systems
3. Add them to monitoring alerts
4. Introduce them to key stakeholders
5. Be available for questions for at least 2 weeks
6. Update this document with lessons learned

---

## Questions?

If you have questions while ramping up, reach out to:

- **Previous Maintainer:** [Contact Info]
- **GitHub Issues:** For technical questions
- **Organization Contact:** [Contact Info]

Good luck, and thank you for volunteering to maintain this project!

---

**Revision History:**

| Date | Author | Changes |
|------|--------|---------|
| 2025-10-25 | Claude | Initial creation |
