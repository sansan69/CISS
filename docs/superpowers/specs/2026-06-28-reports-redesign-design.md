# Enhanced Visit & Training Reports with Preview

**Date:** 2026-06-28
**Status:** Approved

## Objective

Upgrade field officer visit and training reports with photo minimum enforcement, photo categorization UI, a preview-before-submit step, and timestamp/GPS stamping on mobile. Fix drift between local and deployed Firebase Firestore rules, indexes, and storage rules.

## Architecture

No new collections. No new API endpoints. All changes are:
- Frontend validation and UI on both web (Next.js) and mobile (Flutter)
- Firebase configuration deployment (rules, indexes)
- Minor model additions (mobile `toJson()`)

```
Create Report Flow (Web & Mobile):
  Fill Form -> Upload Photos -> Preview -> Submit
                    |              |
            Photo stamped     Read-only summary
            with canvas       + Edit/Submit
            (timestamp/GPS)
```

## Data Model

**foVisitReports/{doc}** -- no field changes. `photoUrls[]` remains single array.
**foTrainingReports/{doc}** -- no field changes.

## Firebase Configuration Changes

### Firestore Rules
Deploy local `firestore.rules` to production. Adds:
- `isStaff()`, `isFieldOfficerForDistrict()`, `isOwnClientDoc()`, `guardAssignedSiteId()`
- Explicit `allow false` for `foVisitReports`, `foTrainingReports` (server-only)
- `leaveRequests`, `leaveBalances`, `notifications`, `workOrderTodos`, `branches`, `resetOtps`
- Stricter `guardLocations`, `workOrders`, `evaluations`, `attendanceLogs` scoping

### Firestore Indexes
Add missing indexes for client dashboard queries:
- `foVisitReports`: `clientId ASC, createdAt DESC`
- `foTrainingReports`: `clientId ASC, createdAt DESC`

### Storage Rules
Deploy local `storage.rules` (adds missing employee doc type paths).

## Web (CISS) Changes

### Photo Minimum Validation
- `visit-reports-panel.tsx`: block submit when `photoUrls.length === 0`
- `training-reports-panel.tsx`: block submit unless `photoUrls.length >= 1 && clientReportUrl != null`

### Preview Component
New `report-preview.tsx` shared between visit/training panels.
- Props: `reportType`, form `data`, `photos`, GPS location, `onEdit`, `onSubmit`
- Sections: Client/Site, Date, Guards/Attendees, Remarks/Description, Photo Grid, GPS
- Edit returns to form, Submit triggers API call

### Photo Categorization
- Camera button labeled "Guard Photo" (back, `capture="environment"`)
- Selfie button labeled "Selfie with Guards" (front, `capture="user"`)
- Gallery button unchanged
- Stamp title matches category

## Mobile (CISS-Mobile) Changes

### Photo Timestamp Stamping
After picking photo, before upload:
- Load into `dart:ui` Canvas
- Draw semi-transparent dark bottom bar overlay (`rgba(8,14,30,0.72)`)
- Stamp: "CISS Field Officer", date/time (IST), GPS, photo title
- Export as JPEG blob

### Photo Minimum + Preview
- Same validation as web
- Preview step: read-only card with Edit/Submit

### Detail Sheet Photo Re-upload
Fix stubbed flow in `VisitReportDetailSheet` and `TrainingReportDetailSheet`:
- Show camera/gallery buttons in "Add Photos" mode
- Upload new photo, PATCH `photoUrls` array

### Model Fixes
- Add `toJson()` to both `VisitReportModel` and `TrainingReportModel`
- Include `fieldOfficerName` in submit payload

## Deployment

1. `firebase deploy --only firestore:rules,firestore:indexes,storage:rules`
2. Vercel auto-deploys web on push to main
3. Flutter build for Android APK / iOS
