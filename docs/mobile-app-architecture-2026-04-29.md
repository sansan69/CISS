# CISS Workforce Mobile App Architecture

Last updated: 2026-04-29

## Goal

Build one Flutter mobile app that serves:

- Guards
- Field Officers
- later Client Lite or Admin Lite if required

The mobile app is not a separate backend product.
It is a mobile operations client for the existing CISS Workforce platform.

## Recommended Stack

### Mobile

- Flutter
- Dart
- Riverpod
- go_router
- Dio
- Freezed + json_serializable
- Isar for offline-first local persistence
- Firebase Auth
- Firebase Cloud Messaging

### Backend

Keep the existing backend:

- Next.js API routes
- Firebase Auth
- Firestore
- Firebase Storage
- Firebase Admin for sensitive server validation

## Why this stack

Flutter is the best choice because:

- Android now, iOS later from one codebase
- good camera, QR, GPS, upload, offline, and push support
- better long-term maintainability than a WebView wrapper
- aligns with the current product direction

Riverpod is recommended because:

- simpler than over-engineered Bloc for this app
- testable
- good async state management
- scalable for role-based features

Isar is recommended because:

- stronger local query capability than simple key-value storage
- good for queued attendance, reports, and cached modules

## Architecture Principles

1. Keep the web platform as the control center
2. Keep business validation on the server where needed
3. Make the mobile app offline-aware
4. Share domain vocabulary with the web app
5. Use role-based feature gating inside one app
6. Keep TCS work-order rules backend-controlled

## System Split

### Web platform remains responsible for

- client and site setup
- duty points and shift templates
- TCS work-order import and assignment
- payroll and wage configuration
- training module upload and question banks
- field officer review/admin reporting
- client dashboard and exports
- region onboarding and control-plane features

### Mobile app becomes responsible for

Guard:

- PIN login
- profile
- attendance marking
- attendance history
- payslip viewing
- training viewing
- quizzes/evaluations
- leave request
- incident reporting

Field Officer:

- login
- work-order visibility
- district/site guard visibility
- visit report submission
- training report submission
- field operations quick actions

## App Layers

### 1. Presentation layer

Flutter screens and widgets.

Folders:

- `lib/features/*/presentation`
- `lib/shared/widgets`
- `lib/app`

### 2. Application layer

Use cases, state notifiers, orchestration.

Folders:

- `lib/features/*/application`

### 3. Domain layer

Shared entities and feature contracts.

Folders:

- `lib/features/*/domain`
- `lib/core/models`

### 4. Data layer

API clients, Firebase integrations, local persistence, mappers.

Folders:

- `lib/features/*/data`
- `lib/core/network`
- `lib/core/storage`

## Runtime Model

Single Flutter app with role-aware routing.

After login:

- if role = `guard`
  - open guard shell
- if role = `fieldOfficer`
  - open field officer shell
- if later role = `client`
  - open client-lite shell

## Auth Model

Use Firebase Auth.

### Guard auth

Current backend pattern:

- mobile submits phone/employee ID + PIN to `/api/guard/auth/login`
- backend verifies employee record and PIN
- backend returns Firebase custom token
- mobile signs in with custom token
- claims contain:
  - `role`
  - `employeeId`
  - `employeeDocId`

### Field officer auth

Recommended:

- use email/password Firebase Auth
- use custom claims:
  - `role = fieldOfficer`
  - `assignedDistricts`
  - `stateCode`

## Network Strategy

Preferred rule:

- use Next.js APIs for protected operations with validation
- use direct Firestore read streams only where safe and efficient

### Use APIs for

- guard login
- PIN setup/change/reset
- attendance submission
- visit report submission
- training report submission
- incident reporting
- TCS assignment-dependent checks

### Use Firestore direct reads for

- cached training modules
- attendance history
- payslip list
- guard profile snapshot
- selected scoped dashboards if needed later

## Offline Strategy

Must support weak-network scenarios.

Queue locally:

- attendance submissions
- visit reports
- training reports
- incident drafts

Rules:

- queued items get `pending`, `syncing`, `failed`, `synced`
- preserve photo/file references locally until upload succeeds
- do not allow very old attendance replay outside allowed server window

## Notifications

Use FCM for:

- training assignment alerts
- leave approval/rejection
- incident escalation
- attendance reminders
- field officer follow-ups

## Security Model

Keep these validations server-side:

- attendance geofence validation
- duty-point and shift validation
- TCS work-order assignment validation
- client/user scope validation
- PIN policies and lockouts
- report ownership and role checks

## Shared Domain Model

The mobile app should mirror these web concepts:

- Employee
- AttendanceLog
- AttendanceStateHint
- Client
- ManagedSite
- DutyPoint
- ShiftTemplate
- WorkOrder
- AssignedGuardSummary
- TrainingModule
- TrainingAssignment
- EvaluationAssignment
- LeaveRequest
- VisitReport
- TrainingReport
- IncidentReport

## Initial Feature Modules

### Guard modules

- `auth_guard`
- `guard_profile`
- `guard_attendance`
- `guard_training`
- `guard_evaluations`
- `guard_payslips`
- `guard_leave`
- `guard_incidents`

### Field officer modules

- `auth_field_officer`
- `fo_dashboard`
- `fo_work_orders`
- `fo_visit_reports`
- `fo_training_reports`
- `fo_guards`
- `fo_incidents`

## Recommended Folder Structure

```text
ciss_mobile/
  lib/
    app/
      app.dart
      router/
      theme/
    core/
      config/
      constants/
      errors/
      firebase/
      models/
      network/
      storage/
      utils/
    features/
      auth/
      guard/
      field_officer/
      shared/
    shared/
      widgets/
      providers/
```

## Future Expansion

Later modules can be added without breaking the base:

- patrol management
- incident escalation workflows
- site registers
- client-lite mobile
- offline patrol checkpoint sync
- biometric or face-match attendance verification

## Implementation Rule

Do not move admin-heavy workflows into Flutter first.
Build the operational mobile flows first.

That keeps the web app as the stable control plane and makes Flutter the native daily-use layer.

