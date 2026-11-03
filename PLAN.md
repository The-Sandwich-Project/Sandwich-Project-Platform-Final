# Codebase Cleanup & Refactoring Plan

## Phase 1: Repo Hygiene & Quick Wins (Low Risk, High Signal)

### 1A. Remove non-product root artifacts
- **Delete** `main.py` (6-line Python hello-world stub, unrelated to TS app)
- **Delete** `pyproject.toml` (Python project config for unrelated "repl-nix-workspace")
- **Delete** `wishlisttoolkit.jsx` (1,398-line isolated prototype — standalone React marketing toolkit not imported anywhere in the app)
- **Delete** `create_chart.py` if unused (Python matplotlib script)

### 1B. Clean up `.gitignore` duplicates and overbroad rules
Current issues:
- `*.txt` on line 77 is dangerously broad — hides legitimate text artifacts
- Duplicate entries: `node_modules` (lines 1+2), `.DS_Store` (lines 4+104), `Thumbs.db` (lines 75+105), `.idea/` (lines 49+99), `*.swp`/`*.swo` (lines 50-51+100-101), `*~` (lines 52+90), `*.log` (lines 55+91), `backups/` (lines 29+87), `dist` (lines 3+70)
- Fix: deduplicate, remove `*.txt`, replace with specific patterns (`test_*.txt`, `*_session.txt`, `*_test.txt`)

### 1C. Script taxonomy cleanup
- **Rename** `server/run-migration.ts` → `server/run-migration-sandwich-range.ts` (it's a one-off migration for sandwich range fields — name should reflect that)
- Keep `server/run-migrations.ts` as the batch migration runner (it has tracking table logic)
- Move completed one-off scripts from `scripts/` root into `scripts/one-off-imports/` or a new `scripts/completed/` folder:
  - `migrate-user-ids.ts`, `migrate-focus-areas.ts`, `migrate-email-threads.ts`, `migrate-messages-to-comments.ts`, `migrate-numeric-permissions-neon.ts` — these are all one-off data migrations
  - `fix-backwards-compat.js` — transitional fix
- Consolidate permission audit scripts (3 variants): `audit-numeric-permissions.ts`, `audit-numeric-permissions-neon.ts`, `audit-numeric-permissions-simple.mjs` → keep the most complete one, archive the rest

---

## Phase 2: Type Safety Hardening (Medium Risk, High Value)

### 2A. Fix `useRecipientForm.ts` — 21 `as any` casts
- Create a `LegacyRecipient` type interface capturing the old field names (`focusArea`, `preferredContactMethod`, etc.)
- Use a typed union `Recipient | LegacyRecipient` in the `normalizeRecipient` function
- Replace all 21 `as any` casts with proper type narrowing using `in` operator checks
- File: `client/src/hooks/useRecipientForm.ts` (lines 88-125)

### 2B. Fix `production-safe-logger.ts` — 7 `any` usages
- Replace `(...args: any[])` with `(...args: unknown[])` in all logger method signatures
- Update `serializeArgs` parameter from `any[]` to `unknown[]`
- Update `table(data: any)` to `table(data: unknown)`
- File: `server/utils/production-safe-logger.ts`

### 2C. Remove debug `console.log` from mobile runtime
- `client/src/mobile/pages/mobile-driver-planning.tsx:87` — remove render log
- `client/src/mobile/components/mobile-bottom-nav.tsx:56` — remove nav click log
- Keep the `console.error` calls (those are legitimate error handling)

### 2D. Add ESLint rule for new code (optional, lower priority)
- Add `@typescript-eslint/no-explicit-any` as `warn` in eslint config
- This prevents new `any` additions while not breaking existing code

---

## Phase 3: Architecture Boundary Stabilization (Higher Risk, Highest Value)

### 3A. Split `server/storage.ts` IStorage interface (3,768 lines)
Split the monolithic `IStorage` interface into domain-specific interfaces:
- `IUserStorage` — user CRUD, authentication, profiles
- `IEventStorage` — events, event requests, scheduling
- `IMessagingStorage` — messages, conversations, chat
- `ICollectionStorage` — sandwich distributions, recipients
- `IProjectStorage` — projects, tasks, work logs
- `INotificationStorage` — announcements, shoutouts, notifications
- `IDocumentStorage` — documents, uploads, objects
- `IReportStorage` — analytics, activity logs, reports

Create `server/storage/index.ts` that re-exports a composed `IStorage = IUserStorage & IEventStorage & ...` for backward compatibility. Individual modules then import only the sub-interface they need.

### 3B. Split `server/database-storage.ts` (5,313 lines)
Decompose the `DatabaseStorage` class into domain-specific implementations matching the interfaces from 3A:
- `server/storage/user-storage.ts` — implements `IUserStorage`
- `server/storage/event-storage.ts` — implements `IEventStorage`
- `server/storage/messaging-storage.ts` — implements `IMessagingStorage`
- `server/storage/collection-storage.ts` — implements `ICollectionStorage`
- `server/storage/project-storage.ts` — implements `IProjectStorage`
- `server/storage/notification-storage.ts` — implements `INotificationStorage`
- `server/storage/document-storage.ts` — implements `IDocumentStorage`
- `server/storage/report-storage.ts` — implements `IReportStorage`

Use a composition pattern: `DatabaseStorage` class composes all sub-storages via mixins or delegation. The existing `storage-wrapper.ts` continues to work unchanged.

### 3C. Slim down `server/routes/index.ts` (1,219 lines)
- Group route registrations into domain registrar functions:
  - `registerUserRoutes(router)` — users, auth, signup, password-reset, onboarding
  - `registerEventRoutes(router)` — events, event-requests, calendar, check-ins
  - `registerMessagingRoutes(router)` — messages, chat, conversations, instant-messages
  - `registerCollectionRoutes(router)` — collections, recipients, distributions, hosts
  - `registerNotificationRoutes(router)` — announcements, email, sms, shoutouts
  - `registerProjectRoutes(router)` — projects, tasks, work-logs
  - `registerReportRoutes(router)` — reports, analytics, exports
  - `registerAdminRoutes(router)` — admin, migrations, feature-flags, monitoring
- Each registrar lives in its own file under `server/routes/registrars/`
- `index.ts` becomes a thin orchestrator that calls each registrar

---

## Phase 4: Legacy Route Migration (Medium Risk)

### 4A. Migrate `event-requests-legacy.ts` (5,393 lines)
- This is the largest route file. Map its endpoints to the existing `server/routes/event-requests/` module (which already has 8 sub-modules)
- Identify which endpoints in the legacy file are already duplicated in the new modules
- Move remaining unique endpoints to appropriate sub-modules
- Add deprecation middleware to legacy endpoints that redirects to new paths
- After verification, delete the legacy file

### 4B. Clean up transition tooling
- After legacy routes are migrated, `scripts/check-legacy-routes.js` becomes unnecessary — archive it
- Update `server/FOLDER_STRUCTURE.md` to reflect actual state (remove "to be migrated" items that are done, mark newly completed items)
- Remove the "Legacy Route Files (to be migrated)" section once migration is complete

---

## Phase 5: Test Suite Hardening (Low Risk)

### 5A. Improve E2E test fixtures
- Replace hardcoded generic credentials in `e2e/auth.spec.ts` with environment-sourced test credentials
- Type the login helper in `e2e/drivers.spec.ts` (currently `any`)
- Replace `if (await element.isVisible())` branching with deterministic assertions where possible

### 5B. Add missing test coverage for migrated routes
- Follow the parity testing approach outlined in `server/FOLDER_STRUCTURE.md`
- Focus on the domain modules that received migrated code

---

## Phase 6: Documentation Trim (Low Risk)

### 6A. Reduce `replit.md` scope
- Extract architecture details into `ARCHITECTURE.md` (already exists at 901 lines — consolidate)
- Extract operational procedures into a concise `OPERATIONS.md`
- Keep `replit.md` focused only on Replit-specific deployment/runtime configuration

### 6B. Keep `server/FOLDER_STRUCTURE.md` accurate
- Update after each phase to reflect reality
- Remove completed migration checklists
- Add a "last verified" date

---

## Implementation Order & Effort Estimates

| Phase | Task | Effort | Risk | Priority |
|-------|------|--------|------|----------|
| 1A | Remove root artifacts | 10 min | None | P0 |
| 1B | Fix .gitignore | 15 min | Low | P0 |
| 1C | Script taxonomy | 20 min | Low | P1 |
| 2A | Type useRecipientForm | 1-2 hrs | Low | P1 |
| 2B | Type production-safe-logger | 15 min | None | P0 |
| 2C | Remove console.log from mobile | 5 min | None | P0 |
| 2D | ESLint any rule | 15 min | Low | P2 |
| 3A | Split IStorage interface | 2-3 hrs | Medium | P1 |
| 3B | Split DatabaseStorage class | 4-6 hrs | Medium | P1 |
| 3C | Slim routes/index.ts | 1-2 hrs | Low | P1 |
| 4A | Migrate legacy event-requests | 3-4 hrs | Medium | P2 |
| 4B | Clean transition tooling | 30 min | Low | P2 |
| 5A | Improve E2E fixtures | 1-2 hrs | Low | P2 |
| 5B | Add migration test coverage | 2-3 hrs | Low | P2 |
| 6A | Trim replit.md | 1 hr | None | P3 |
| 6B | Update FOLDER_STRUCTURE.md | 30 min | None | P3 |

**Total estimated effort: ~18-26 hours of focused work**

## Execution Strategy

Start with **Phase 1 + Phase 2C + 2B** (all quick wins, zero risk, immediately shippable).
Then **Phase 2A** (type safety in a single file, well-scoped).
Then **Phase 3** (the big architectural win — do 3A first, then 3B, then 3C).
Phases 4-6 can follow incrementally as capacity allows.

Each phase should be committed and tested independently. No phase depends on a later phase.
