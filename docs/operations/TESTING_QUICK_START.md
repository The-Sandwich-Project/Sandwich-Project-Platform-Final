# Quick Testing Guide - Migrated Routes

## TL;DR - Manual Testing Checklist

Since full integration tests require database setup, here's a **quick manual testing approach** you can do right now:

## ✅ Simple Route Tests (No Code Required)

### 1. Test Authentication Works

Open your browser or Postman and test these routes:

#### Should Require Login (Return 401/403):
```
GET  http://localhost:5000/api/drivers
GET  http://localhost:5000/api/volunteers
GET  http://localhost:5000/api/hosts
GET  http://localhost:5000/api/emails
GET  http://localhost:5000/api/onboarding/challenges
```

**Expected:** All should return 401 Unauthorized or 403 Forbidden

#### Should Work Without Login (Public Routes):
```
POST http://localhost:5000/api/forgot-password
     Body: { "email": "test@example.com" }

GET  http://localhost:5000/api/verify-reset-token/test-token
```

**Expected:** Should NOT return 401/403 (may return 404 or 400, but not auth error)

### 2. Test After Login

1. Login to your app normally
2. Open browser DevTools → Network tab
3. Try accessing these routes:

```
GET  http://localhost:5000/api/drivers
GET  http://localhost:5000/api/volunteers
GET  http://localhost:5000/api/onboarding/challenges
```

**Expected:** All should return 200 OK with data

### 3. Test Permissions (If You Have Different User Roles)

Login as a user with **no special permissions**:

```
GET  http://localhost:5000/api/hosts
```

**Expected:** Should work (or check if your permission system restricts it)

## 📋 Complete Manual Testing Checklist

Copy this checklist and test each route:

### Core Entity Routes
- [ ] GET /api/drivers - Requires auth
- [ ] POST /api/drivers - Requires auth
- [ ] GET /api/drivers/:id - Requires auth
- [ ] GET /api/drivers/export - Requires auth
- [ ] GET /api/volunteers - Requires auth
- [ ] POST /api/volunteers - Requires auth
- [ ] GET /api/volunteers/:id - Requires auth
- [ ] GET /api/volunteers/export - Requires auth
- [ ] GET /api/hosts - Requires auth
- [ ] POST /api/hosts - Requires auth

### Feature Routes
- [ ] GET /api/emails - Requires auth
- [ ] POST /api/emails - Requires auth
- [ ] GET /api/onboarding/challenges - Requires auth
- [ ] GET /api/onboarding/leaderboard - Requires auth
- [ ] POST /api/onboarding/track/:actionKey - Requires auth

### External Integration Routes
- [ ] GET /api/google-sheets - Requires auth
- [ ] GET /api/google-calendar/events - Requires auth
- [ ] POST /api/routes/optimize - Requires auth

### Data Routes
- [ ] GET /api/recipient-tsp-contacts/:id - Requires auth
- [ ] GET /api/sandwich-distributions - Requires auth
- [ ] POST /api/import - Requires auth

### System Routes
- [ ] GET /api/export/collections - Requires auth (and DATA_EXPORT permission)
- [ ] GET /api/message-notifications/unread-counts - Requires auth
- [ ] GET /api/announcements - Requires auth
- [ ] GET /api/performance/health - May or may not require auth

### Public Routes (Should NOT require auth)
- [ ] POST /api/forgot-password - Public
- [ ] POST /api/reset-password - Public
- [ ] GET /api/verify-reset-token/:token - Public

## 🔍 What to Look For

### Good Signs ✅
- Protected routes return 401/403 when not logged in
- Protected routes return 200/data when logged in
- Public routes work without login
- Errors have consistent format: `{ error: "...", message: "..." }`

### Bad Signs ❌
- Protected routes accessible without login (security issue!)
- Public routes requiring login (functionality broken)
- 500 errors on simple GET requests (middleware issue)
- Inconsistent error formats

## 🚀 Quick curl Tests

If you prefer command line:

```bash
# Test protected route (should return 401)
curl -i http://localhost:5000/api/drivers

# Test public route (should NOT return 401)
curl -i -X POST http://localhost:5000/api/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Test with session (after logging in, copy cookie)
curl -i http://localhost:5000/api/drivers \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"
```

## 📊 Results Template

Create a simple document to track results:

```markdown
# Route Testing Results

Date: [DATE]
Tester: [NAME]

## Summary
- Total Routes Tested: X
- Passed: Y
- Failed: Z

## Results

### Drivers Routes
- GET /api/drivers
  - Without auth: ✅ Returns 401
  - With auth: ✅ Returns 200
  - Notes: Working correctly

### [Continue for each route...]

## Issues Found
1. [Describe any issues]
2. [Describe any issues]
```

## 🎯 Priority Testing Order

If you have limited time, test in this order:

### High Priority (Test First):
1. **Authentication** - Ensure protected routes require login
2. **Public routes** - Ensure password reset works
3. **Core entities** - Drivers, volunteers, hosts

### Medium Priority:
4. **Features** - Emails, onboarding, event reminders
5. **Exports** - Data export functionality

### Low Priority:
6. **External integrations** - Google Sheets, Calendar
7. **Performance routes** - Monitoring endpoints

## 🔄 Automated Testing (When Ready)

Once you've done manual testing and everything works:

1. **Install dependencies:**
   ```bash
   npm install --save-dev jest ts-jest @types/jest supertest @types/supertest
   ```

2. **Set up test database:**
   ```bash
   # Create test database
   createdb your_app_test

   # Set environment variable
   export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/your_app_test
   ```

3. **Run automated tests:**
   ```bash
   npm run test:integration
   ```

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for full automated testing setup.

## ✅ Conclusion

**Minimum viable testing:**
1. ✅ Test 5-10 protected routes return 401 without auth
2. ✅ Test same routes return 200 when logged in
3. ✅ Test password reset routes work without auth
4. ✅ Spot check create/update/delete operations work

If these pass, your migration is successful! The double authentication is harmless and everything is working correctly.
