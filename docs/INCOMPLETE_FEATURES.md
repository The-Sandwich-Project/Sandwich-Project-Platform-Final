# Incomplete Features Documentation

This document catalogs all incomplete features and TODO items in the codebase, organized by priority and module.

**Notification Infrastructure:** This app uses **Twilio Email** (email) and **Twilio** (SMS) for notifications. There is no Firebase/FCM integration.

---

## 🟠 Medium Priority (Incomplete Features)

### 1. Database Environment Configuration
**Location:** `server/db.ts:10`

```
TODO: Switch back to DEV_DATABASE_URL once dev database has schema pushed
```

**Current State:** Development environment uses production database URL as a workaround.

**Impact:** Risk of accidental production data modification during development.

**To Fix:** Push schema to dev database and update environment variable logic.

---

### 2. Project Files Endpoint
**Location:** `server/routes/projects/index.ts:477`

```typescript
// TODO: Implement actual file retrieval from storage
// For now, return empty array as the original route does
res.json([]);
```

**Current State:** `GET /api/projects/:id/files` always returns empty array.

**Impact:** Project file attachments feature is non-functional.

---

### 3. Intake Call Data Persistence
**Location:** `client/src/components/event-requests/IntakeCallDialog.tsx:147`

```typescript
// TODO: Save itemAnswers, contact info, and callNotes to event request notes or contact log
```

**Current State:** Intake call checklist answers, contact info, and notes are logged to console but not persisted.

**Impact:** Call data is lost after dialog closes.

---

### 4. Smart Search Actions
**Location:** `client/src/components/SmartSearch.tsx:179`

```typescript
// TODO: If result has an action, trigger it (e.g., open a modal)
if (result.feature.action) {
  console.log('Action to trigger:', result.feature.action);
}
```

**Current State:** Search results with actions just log to console instead of executing.

**Impact:** Action-based search results (like "open create dialog") don't work.

---

### 5. A/B Testing for Notifications
**Location:** `server/routes/notifications/smart.ts:239`

```typescript
abTestVariant: null, // TODO: Implement A/B testing assignment
```

**Current State:** All notifications use default variant, no A/B testing.

---

### 6. Search Analytics Tracking
**Location:** `server/services/search/index.ts:428`

```typescript
// TODO: Implement search analytics tracking
```

**Current State:** Search queries are not tracked for analytics.

---

### 7. Meeting Route Data Joins
**Location:** `server/routes/meetings.ts:589`

```typescript
// TODO: Add joined data (projectTitle, meetingTitle) if needed by frontend
```

**Current State:** Some meeting endpoints may return incomplete data.

---

## 🟡 Low Priority (Memory Storage Stubs)

### 8. In-Memory Storage Conversation Methods
**Location:** `server/storage.ts:2564-2595`

These methods are stubs for the in-memory storage fallback (used when database is unavailable):

| Line | Method | Returns |
|------|--------|---------|
| 2565 | `createConversation()` | `null` |
| 2570 | `getConversationMessages()` | `[]` |
| 2575 | `addConversationMessage()` | `null` |
| 2584 | `updateConversationMessage()` | `null` |
| 2589 | `deleteConversationMessage()` | `false` |
| 2594 | `getConversationParticipants()` | `[]` |

**Impact:** Low - these are only used as fallback when database storage fails. Database implementation exists in `database-storage.ts`.

---

### 9. Storage Interface Types
**Location:** `server/index.ts:471`

```typescript
startBackgroundSync(storage as any); // TODO: Fix storage interface types
```

**Impact:** Type safety issue, not a functional problem.

---

## Summary Statistics

| Priority | Count | Notes |
|----------|-------|-------|
| 🟠 Medium | 7 | Actual incomplete features |
| 🟡 Low | 2 | Memory storage stubs, type issues |
| **Total** | **9 items** | |

---

## Recommended Action Order

1. **Intake Call Persistence** - Data loss issue
2. **Project Files Endpoint** - Feature non-functional
3. **Database Environment** - Development safety
4. **Smart Search Actions** - UX improvement
5. Others as time permits

---

*Last updated: December 2024*
*Generated from TODO/FIXME analysis*
