# Alerting Setup Guide

**The Sandwich Project Platform**
**Last Updated:** 2025-10-25

This guide explains how to set up monitoring alerts to proactively detect and respond to issues before they impact users.

---

## Table of Contents

1. [Why Alerting Matters](#why-alerting-matters)
2. [Alert Philosophy](#alert-philosophy)
3. [Sentry Alerts](#sentry-alerts)
4. [Prometheus/Grafana Alerts](#prometheusgrafana-alerts)
5. [Uptime Monitoring](#uptime-monitoring)
6. [Custom Alerts](#custom-alerts)
7. [Alert Channels](#alert-channels)
8. [On-Call Procedures](#on-call-procedures)

---

## Why Alerting Matters

**Without alerting, you're flying blind:**
- Users encounter errors before you know
- Downtime goes unnoticed
- Performance degradation happens silently
- Database issues compound before detection

**With alerting, you're proactive:**
- Know about issues before users report them
- Respond quickly to minimize impact
- Track trends and prevent incidents
- Sleep better knowing you'll be notified

---

## Alert Philosophy

### Good Alerts

**Actionable:** Every alert should have a clear response action

```
❌ BAD: "Error rate increased"
✅ GOOD: "Error rate >5% for 5 minutes - check Sentry for cause"
```

**Timely:** Alert before users are significantly impacted

```
❌ BAD: Alert after 30 minutes of downtime
✅ GOOD: Alert after 2 minutes of elevated errors
```

**Specific:** Include context to speed up diagnosis

```
❌ BAD: "Something is wrong"
✅ GOOD: "Database connection pool exhausted (20/20 connections used)"
```

### Alert Fatigue

**Avoid alert fatigue:**

- **Don't alert on every error:** Some errors are expected
- **Set appropriate thresholds:** Not too sensitive
- **Deduplicate:** Group related alerts
- **Acknowledge:** Mark alerts as being handled

**Rule of thumb:** If you're ignoring alerts, they're not tuned correctly.

---

## Sentry Alerts

Sentry is already integrated. Now let's configure alerts.

### Setting Up Sentry Alerts

**1. Access Sentry Dashboard:**
```
https://sentry.io/organizations/your-org/projects/sandwich-platform/
```

**2. Navigate to Alerts:**
- Click "Alerts" in sidebar
- Click "Create Alert Rule"

### Recommended Sentry Alerts

#### Alert 1: Error Rate Spike

**When to alert:** Error rate increases significantly

**Configuration:**
```yaml
Name: High Error Rate
Alert Type: Issues
Conditions:
  - The error count is greater than 50 in 5 minutes
  - AND the error rate increases by 200% compared to the previous 5 minutes
Environment: production
Actions:
  - Send notification to #alerts Slack channel
  - Email on-call engineer
```

**Response:** Check Sentry for new error types, review recent deployments

#### Alert 2: New Error Type

**When to alert:** A new type of error appears

**Configuration:**
```yaml
Name: New Error Detected
Alert Type: Issues
Conditions:
  - A new issue is created
  - AND the issue is first seen
  - AND the environment is production
Actions:
  - Send notification to #alerts Slack channel
```

**Response:** Investigate new error, determine if deployment-related

#### Alert 3: Unhandled Error Spike

**When to alert:** Critical errors (500s, crashes)

**Configuration:**
```yaml
Name: Critical Errors
Alert Type: Issues
Conditions:
  - The error level is error or fatal
  - AND the error count is greater than 10 in 5 minutes
  - AND the environment is production
Actions:
  - Send notification to #critical-alerts Slack channel
  - Email + SMS to on-call engineer
  - Create PagerDuty incident
```

**Response:** Immediate investigation, consider rollback

#### Alert 4: User Impact Threshold

**When to alert:** Many users affected

**Configuration:**
```yaml
Name: High User Impact
Alert Type: Issues
Conditions:
  - The affected users count is greater than 100 in 1 hour
  - AND the environment is production
Actions:
  - Send notification to #alerts Slack channel
  - Email product team
```

**Response:** Assess impact, communicate with stakeholders

### Sentry Alert Channels

**Configure integrations:**

1. **Slack:**
   - Settings → Integrations → Slack
   - Install Slack app
   - Configure channel routing

2. **Email:**
   - Settings → Integrations → Email
   - Add team email addresses

3. **PagerDuty (for critical alerts):**
   - Settings → Integrations → PagerDuty
   - Configure service integration

---

## Prometheus/Grafana Alerts

The app exposes Prometheus metrics at `/monitoring/metrics`. Let's set up alerting.

### Option 1: Grafana Cloud (Recommended)

**1. Sign up for Grafana Cloud:**
```
https://grafana.com/products/cloud/
```
Free tier includes:
- Metrics retention
- Alerting
- Dashboards

**2. Configure Prometheus Remote Write:**

Add to `server/monitoring/metrics.ts`:

```typescript
// Remote write to Grafana Cloud
import { Registry } from 'prom-client';

const registry = new Registry();

// Configure remote write (if using Prometheus)
// Or use Grafana Agent to scrape /monitoring/metrics
```

**3. Import Dashboard:**

Use the included `grafana-dashboard.json` (if available) or create one.

**4. Create Alerts:**

### Recommended Prometheus Alerts

#### Alert 1: High Response Time

**Alert when:** API response times exceed threshold

**Grafana Alert Configuration:**
```yaml
Name: High Response Time
Query: histogram_quantile(0.95, http_request_duration_seconds)
Condition: WHEN last() > 1
For: 5m
Labels:
  severity: warning
Annotations:
  summary: "95th percentile response time is {{ $value }}s"
  description: "API is responding slowly. Check for slow database queries."
```

**Response:** Check monitoring dashboard, optimize slow queries

#### Alert 2: Database Query Slow

**Alert when:** Database queries are slow

```yaml
Name: Slow Database Queries
Query: histogram_quantile(0.95, db_query_duration_seconds)
Condition: WHEN last() > 0.5
For: 5m
Labels:
  severity: warning
Annotations:
  summary: "Database queries are slow ({{ $value }}s)"
```

**Response:** Check database performance, review slow query log

#### Alert 3: High Memory Usage

**Alert when:** Memory usage exceeds threshold

```yaml
Name: High Memory Usage
Query: process_resident_memory_bytes / 1024 / 1024 / 1024
Condition: WHEN last() > 1.5
For: 10m
Labels:
  severity: warning
Annotations:
  summary: "Memory usage is {{ $value }}GB"
  description: "Check for memory leaks or increase container resources"
```

**Response:** Check for memory leaks, restart if necessary

#### Alert 4: Database Connection Pool Exhausted

```yaml
Name: Database Pool Exhausted
Query: db_pool_active_connections / db_pool_max_connections
Condition: WHEN last() > 0.9
For: 5m
Labels:
  severity: critical
Annotations:
  summary: "{{ $value * 100 }}% of database connections in use"
```

**Response:** Check for connection leaks, increase pool size

#### Alert 5: WebSocket Disconnections

```yaml
Name: WebSocket Disconnection Spike
Query: rate(websocket_disconnections_total[5m])
Condition: WHEN last() > 10
For: 5m
Labels:
  severity: warning
Annotations:
  summary: "{{ $value }} WebSocket disconnections per second"
```

**Response:** Check server stability, network issues

---

## Uptime Monitoring

### External Uptime Monitors

**Why external monitoring:**
- Detects full outages (even if your monitoring is down)
- Checks from user perspective
- Monitors from multiple locations

### Option 1: UptimeRobot (Free)

**1. Sign up:**
```
https://uptimerobot.com
```

**2. Create monitors:**

| Monitor | Type | URL | Interval | Alert When |
|---------|------|-----|----------|------------|
| **Main Site** | HTTP(s) | https://[REPLIT_DOMAIN] | 5 min | Down |
| **Health Check** | HTTP(s) | https://[REPLIT_DOMAIN]/monitoring/health | 5 min | Down or ≠200 |
| **API Health** | HTTP(s) | https://[REPLIT_DOMAIN]/api/health | 5 min | Down |

**3. Configure alerts:**
- Email notifications
- Slack webhook
- SMS (paid plan)

**4. Alert when:**
- 2 consecutive failures (avoid false positives)
- Downtime > 2 minutes

### Option 2: Pingdom (Paid)

More features:
- Multi-location monitoring
- Transaction monitoring
- RUM (Real User Monitoring)

### Option 3: Healthchecks.io (Free/Paid)

**For cron jobs and background tasks:**

```typescript
// server/services/daily-report.ts
import fetch from 'node-fetch';

async function sendDailyReport() {
  try {
    // Do work...

    // Ping success
    await fetch('https://hc-ping.com/your-uuid');
  } catch (error) {
    // Ping failure
    await fetch('https://hc-ping.com/your-uuid/fail');
  }
}
```

Healthchecks.io will alert if:
- Job doesn't run on schedule
- Job reports failure

---

## Custom Alerts

### Email Alerts

**Implement custom email alerts:**

```typescript
// server/monitoring/alerts.ts
import { sendEmail } from '../services/email'; // pass emailStream: 'operational'

export async function sendAlert(
  severity: 'info' | 'warning' | 'critical',
  title: string,
  description: string
) {
  const recipients = {
    info: ['team@example.com'],
    warning: ['oncall@example.com', 'team@example.com'],
    critical: ['oncall@example.com', 'manager@example.com'],
  };

  await sendEmail({
    to: recipients[severity],
    subject: `[${severity.toUpperCase()}] ${title}`,
    body: `
      <h2>${title}</h2>
      <p>${description}</p>
      <p>Severity: <strong>${severity}</strong></p>
      <p>Time: ${new Date().toISOString()}</p>
      <hr>
      <p><a href="https://[REPLIT_DOMAIN]/monitoring/dashboard">View Monitoring Dashboard</a></p>
    `,
  });
}

// Usage
await sendAlert('critical', 'Database Connection Failed', 'Unable to connect to PostgreSQL. Check Neon status.');
```

### Slack Alerts

**Setup Slack webhook:**

1. Create Slack app: https://api.slack.com/apps
2. Enable Incoming Webhooks
3. Add webhook URL to environment: `SLACK_WEBHOOK_URL`

**Send alerts:**

```typescript
// server/monitoring/alerts.ts
export async function sendSlackAlert(
  severity: 'info' | 'warning' | 'critical',
  title: string,
  description: string
) {
  const colors = {
    info: '#0000FF',
    warning: '#FFA500',
    critical: '#FF0000',
  };

  await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachments: [{
        color: colors[severity],
        title: `[${severity.toUpperCase()}] ${title}`,
        text: description,
        footer: 'Sandwich Platform Monitoring',
        ts: Math.floor(Date.now() / 1000),
      }],
    }),
  });
}
```

### SMS Alerts (Twilio)

**For critical issues only:**

```typescript
// server/monitoring/alerts.ts
import { sendSMS } from '../sms-providers/twilio-provider';

export async function sendSMSAlert(title: string, description: string) {
  const oncallNumber = process.env.ONCALL_PHONE_NUMBER;

  await sendSMS(
    oncallNumber,
    `[CRITICAL] ${title}: ${description.substring(0, 100)}... Check monitoring dashboard.`
  );
}
```

---

## Alert Channels

### Channel Strategy

| Severity | Channels | Response Time |
|----------|----------|---------------|
| **Info** | Email, Slack #monitoring | Review during business hours |
| **Warning** | Email, Slack #alerts | Investigate within 1 hour |
| **Critical** | Email, Slack #critical-alerts, SMS, PagerDuty | Immediate response |

### Setting Up Channels

**Slack channels:**

1. Create channels:
   - `#monitoring` - All monitoring info
   - `#alerts` - Warning-level alerts
   - `#critical-alerts` - Critical alerts only

2. Configure routing:
   - Sentry → `#alerts`
   - Grafana → `#alerts`
   - UptimeRobot → `#critical-alerts`
   - Custom alerts → Based on severity

**Email distribution lists:**

- `monitoring@example.com` → All team members
- `oncall@example.com` → Current on-call engineer
- `critical@example.com` → Leadership + on-call

---

## On-Call Procedures

### On-Call Rotation

**Setup:**
- Use PagerDuty, Opsgenie, or simple rotation schedule
- Weekly or bi-weekly rotations
- Clear handoff procedure

**Responsibilities:**
- Monitor alert channels
- Respond to critical alerts within 15 minutes
- Escalate if needed
- Document incidents

### Alert Response Workflow

**When you receive an alert:**

1. **Acknowledge** (within 5 minutes)
   - Mark alert as "Investigating"
   - Prevents duplicate responses

2. **Assess severity** (within 10 minutes)
   - Is it actually critical?
   - How many users affected?
   - Is it still happening?

3. **Investigate** (within 15 minutes)
   - Check monitoring dashboard
   - Review Sentry errors
   - Check recent deployments
   - Review logs

4. **Respond**
   - Fix if quick (< 10 minutes)
   - Escalate if complex
   - Rollback if deployment-related
   - Communicate status

5. **Resolve**
   - Verify issue fixed
   - Update alert status
   - Document root cause

6. **Post-mortem** (for critical issues)
   - Write incident report
   - Identify preventive measures
   - Update runbooks

### Escalation Path

```
Level 1: On-call engineer (you)
   ↓ (if can't resolve in 30 min)
Level 2: Senior engineer or previous maintainer
   ↓ (if infrastructure issue)
Level 3: Platform support (Replit, Neon)
   ↓ (if ongoing outage)
Level 4: Organizational leadership
```

---

## Alert Testing

### Test Alerts Regularly

**Monthly alert test:**

1. **Trigger test alert:**
   ```bash
   # Trigger high error rate
   curl -X POST https://[REPLIT_DOMAIN]/api/test/trigger-error?count=100
   ```

2. **Verify alerts sent:**
   - Sentry alert received?
   - Slack message posted?
   - Email delivered?
   - SMS sent (for critical)?

3. **Time response:**
   - How long to detect?
   - How long to respond?

4. **Update procedures:**
   - Document any gaps
   - Update alert thresholds
   - Fix broken integrations

---

## Alert Configuration Checklist

### Initial Setup

- [ ] Sentry alerts configured
  - [ ] Error rate spike
  - [ ] New errors
  - [ ] Critical errors
  - [ ] User impact

- [ ] Uptime monitoring configured
  - [ ] Main site
  - [ ] Health check endpoint
  - [ ] API health

- [ ] Prometheus/Grafana alerts (if using)
  - [ ] High response time
  - [ ] Database slow queries
  - [ ] High memory usage
  - [ ] Connection pool exhaustion

- [ ] Alert channels configured
  - [ ] Slack integration
  - [ ] Email distribution lists
  - [ ] SMS (for critical)

### Maintenance

- [ ] Test alerts monthly
- [ ] Review alert thresholds quarterly
- [ ] Update on-call rotation
- [ ] Document new alert types
- [ ] Remove noisy/unused alerts

---

## Quick Start: Minimal Alerting

**If you can only do 3 things, do these:**

1. **Set up Sentry error alerts:**
   - Alert on error rate spike
   - Send to Slack or email

2. **Set up uptime monitoring:**
   - Use UptimeRobot (free)
   - Monitor `/monitoring/health`
   - Alert via email

3. **Create alert response doc:**
   - Document who to contact
   - Include escalation path
   - Link to monitoring dashboards

This gives you basic coverage for most incidents.

---

## Resources

- **Sentry Docs:** https://docs.sentry.io/product/alerts/
- **Grafana Alerting:** https://grafana.com/docs/grafana/latest/alerting/
- **UptimeRobot:** https://uptimerobot.com
- **Healthchecks.io:** https://healthchecks.io
- **PagerDuty:** https://www.pagerduty.com

---

## Questions?

For alerting setup help:
- Check existing monitoring: `/monitoring/dashboard`
- Review `MONITORING.md` for metrics details
- Contact maintainer (see `HANDOFF.md`)

---

**Revision History:**

| Date | Author | Changes |
|------|--------|---------|
| 2025-10-25 | Claude | Initial creation |
