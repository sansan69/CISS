# Flutter Mobile Implementation Plan

Last updated: 2026-04-29

## Delivery Strategy

Build in phases.
Do not attempt the whole platform at once.

## Phase 0: Foundation

Goal:

- scaffold Flutter app
- set architecture
- set up Firebase
- set up routing, state, theme, env config
- define shared data models

Deliverables:

- Flutter app shell
- guard shell
- field officer shell
- role-aware auth state
- API client abstraction
- local sync queue abstraction

## Phase 1: Guard Core

Goal:

- make the app useful to guards immediately

Features:

- guard login with PIN
- guard profile
- mark attendance
- attendance history
- payslip list + detail
- training module list
- evaluation list

Dependencies:

- `/api/guard/auth/login`
- `/api/guard/profile`
- `/api/attendance/submit`
- `/api/guard/attendance`
- `/api/guard/payslips`
- `/api/guard/training`
- `/api/guard/evaluations`

Success criteria:

- guard can log in, mark attendance, and view history/payslips/training

## Phase 2: Guard Workflow Completion

Features:

- PIN setup
- PIN change
- PIN reset OTP
- leave request
- attendance offline queue
- attendance photo upload reliability

Dependencies:

- `/api/guard/auth/setup-pin`
- `/api/guard/auth/change-pin`
- `/api/guard/auth/send-reset-otp`
- `/api/guard/auth/verify-reset-otp`
- `/api/guard/auth/reset-pin`
- `/api/guard/leave`

Success criteria:

- full self-service guard authentication and leave flow

## Phase 3: Field Officer Core

Features:

- field officer login
- field officer dashboard
- work-order list
- guard list by district/site
- visit report submission
- training report submission

Dependencies:

- Firebase auth for field officer sign-in
- `/api/admin/visit-reports`
- `/api/admin/training-reports`
- `/api/admin/work-orders/*`
- scoped employee/site reads

Success criteria:

- field officer can submit reports live from field

## Phase 4: Incident Module

Features:

- guard incident reporting
- field officer incident visibility
- admin escalation ready payload
- attachment uploads

Recommended new APIs:

- `/api/guard/incidents`
- `/api/field-officer/incidents`
- `/api/admin/incidents`

Success criteria:

- incidents can be raised, seen, escalated, and closed

## Phase 5: Offline-First Reliability

Features:

- queued attendance
- queued visit reports
- queued training reports
- draft incident storage
- sync retry engine

Success criteria:

- app remains useful in low network environments

## Phase 6: Patrol and Advanced Ops

Features:

- checkpoint patrol
- route tracking
- missed checkpoint alerts
- patrol summaries

This should come after the core mobile attendance and reporting flows are stable.

## Release Order

Recommended order:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6

## Engineering Rules

1. Shared backend remains source of truth
2. Sensitive validation stays server-side
3. Prefer typed mappers over dynamic map usage
4. Every queued action must be replay-safe
5. Every role flow must be testable independently

