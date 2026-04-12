# CISS HRM Upgrade Todo

> Historical tracking note (2026-04-11): several items listed below have since shipped in partial or full form, especially `superAdmin`/region tooling, training surfaces, payroll surfaces, leave flows, and branch operations. Treat [docs/app-context.md](/Users/mymac/Documents/CISS/docs/app-context.md) as the current-state reference before using this roadmap.

Last updated: 2026-03-16

## Current Baseline

### Done
- Core workforce operations are live:
  - employee enrollment
  - employee directory and profile pages
  - attendance capture and admin attendance logs
  - work-order import and assignment
  - field-officer access and claims repair
  - client management, client locations, and duty-site management
- Attendance photo stamping and compliance placeholder flow exist.
- Location system has been upgraded with `clientLocations` and linked duty sites.
- Mixed duty-site shift support is live:
  - `TCS` sites stay flexible
  - non-TCS sites can use `2x12` or `3x8`
- Mobile fixes already exist for enrollment, work orders, and attendance capture.
- CI, lint, typecheck, build, and Vercel deployment workflows are established.

### Partial
- Mobile-first UX exists in important flows, but the full app shell redesign is not complete.
- Dashboard has basic charts and role-aware data, but not the new role-specific infographic layout.
- Attendance hardening is partly done, but not all GPS/spoofing/offline rules from the target plan are present.
- Client/location management is stronger, but payroll-linked client configuration is not present yet.

### Not Started
- Multi-state `stateCode` architecture
- `superAdmin` role and state management
- Training & Evaluation system
- Leaderboard and awards
- Payroll engine and salary structures
- Leave management
- Branch operations management
- Full role-tailored redesigned dashboards

## Phase Checklist

### Phase 1 — UI/UX Redesign
- [x] Brand direction aligned toward CISS colors and cleaner mobile-first layout primitives.
- [x] Shared shell foundation started:
  - [x] brand tokens in global styles
  - [x] mobile bottom navigation
  - [x] reusable page header
  - [x] reusable stat card
- [ ] Full grouped sidebar with final HR navigation structure
- [ ] Settings sub-navigation cleanup
- [ ] Dashboard redesign per role:
  - [ ] admin
  - [ ] field officer
  - [ ] client user
- [ ] Mobile filter sheets on list pages
- [ ] Data-card-list/table shared responsive pattern
- [ ] Consistent compact page headers across all app pages

### Phase 2 — Training & Evaluation
- [ ] Add collections:
  - [ ] `trainingModules`
  - [ ] `trainingAssignments`
  - [ ] `evaluations`
  - [ ] `guardScores`
  - [ ] `awards`
- [ ] Add API routes for training/evaluation CRUD
- [ ] Build training pages
- [ ] Build evaluation pages
- [ ] Build leaderboard page
- [ ] Auto-pull uniform compliance into evaluations

### Phase 3 — Payroll Engine
- [ ] Add `decimal.js`
- [ ] Add `complianceSettings/{stateCode}` model
- [ ] Add `clientWageConfig`
- [ ] Add `payrollCycles`
- [ ] Add `payrollEntries`
- [ ] Add payroll calculation library
- [ ] Add wage-config upload parser and review UI
- [ ] Add payroll run/review/finalize screens
- [ ] Add payslip generation

### Phase 4 — Leave Management
- [ ] Add `leaveRequests`
- [ ] Add `leaveBalances`
- [ ] Add leave management UI
- [ ] Link unpaid leave to payroll LOP

### Phase 5 — Attendance & Site Hardening
- [ ] Per-site `strictGeofence`
- [ ] GPS accuracy gate
- [ ] Mock-location suspicion flag
- [ ] Shift window warning rules for fixed-shift sites
- [ ] IndexedDB offline queue hardening
- [ ] Auto-geocode on work-order upload
- [ ] Site verification / unverified queue UI
- [ ] Client holiday and allowance settings

### Phase 6 — Field Officer Reporting
- [ ] Add `foVisitReports`
- [ ] Add `foTrainingReports`
- [ ] Build field officer mobile reporting

### Phase 7 — Multi-State Scaling
- [ ] Extend role model with `superAdmin`
- [ ] Add `stateCode` to all relevant schemas and writes
- [ ] Add `scripts/migrate-add-state-code.ts`
- [ ] Add state-scoped Firestore rules
- [ ] Add state management APIs and UI
- [ ] Add cross-state analytics

## Next Safe Slices

1. Finish the Phase 1 shell rollout across all authenticated pages.
2. Add shared `stateCode` scaffolding and role model changes before training/payroll.
3. Build Training & Evaluation before Payroll so leaderboard/performance data exists early.
