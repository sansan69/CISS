# Mobile Screens, APIs, and Firestore Contracts

Last updated: 2026-04-29

## 1. Guard App Screens

### Authentication

- Splash
- Guard Login
- Setup PIN
- Change PIN
- Forgot PIN
- Verify Reset OTP
- Reset PIN

### Core

- Guard Dashboard
- Mark Attendance
- Attendance History
- Attendance Detail
- Profile
- Payslip List
- Payslip Detail
- Training List
- Training Module Detail
- Quiz Screen
- Evaluations List
- Leave List
- New Leave Request
- Incident List
- New Incident Report

## 2. Field Officer Screens

### Authentication

- Splash
- Field Officer Login

### Core

- Field Officer Dashboard
- Work Orders / Upcoming Duties
- Work Order Detail
- Guard Directory
- Site Directory
- New Visit Report
- Visit Report History
- New Training Report
- Training Report History
- Incident Feed
- Incident Detail

## 3. Phase 1 and 2 APIs

### Guard Auth APIs

#### POST `/api/guard/auth/login`

Request:

```json
{
  "phoneNumber": "9999999999",
  "pin": "1234"
}
```

or

```json
{
  "employeeId": "CISS/TCS/2026-27/123",
  "pin": "1234"
}
```

Response:

```json
{
  "token": "<firebase-custom-token>",
  "employeeName": "Guard Name"
}
```

#### POST `/api/guard/auth/setup-pin`

Request:

```json
{
  "employeeId": "CISS/TCS/2026-27/123",
  "phoneNumber": "9999999999",
  "pin": "1234"
}
```

#### POST `/api/guard/auth/change-pin`

Request:

```json
{
  "currentPin": "1234",
  "newPin": "4567"
}
```

#### POST `/api/guard/auth/send-reset-otp`

Request:

```json
{
  "phoneNumber": "9999999999"
}
```

#### POST `/api/guard/auth/verify-reset-otp`

Request:

```json
{
  "phoneNumber": "9999999999",
  "otp": "123456"
}
```

#### POST `/api/guard/auth/reset-pin`

Request:

```json
{
  "phoneNumber": "9999999999",
  "otp": "123456",
  "newPin": "4567"
}
```

### Guard Data APIs

#### GET `/api/guard/dashboard`

Returns:

- employee summary
- recent attendance
- next shift or duty hint
- counts for dashboard cards

#### GET `/api/guard/profile`

Returns:

- employee profile snapshot
- client and district info
- document URLs if allowed

#### GET `/api/guard/attendance`

Returns:

- attendance history list
- dates
- status
- duty point
- shift
- site name

#### GET `/api/guard/payslips`

Returns:

- payslip list for the guard

#### GET `/api/guard/payslips/[id]/payslip`

Returns:

- payslip detail or file URL/stream

#### GET `/api/guard/training`

Returns:

- assigned modules
- status
- due state

#### GET `/api/guard/training/quiz/[assignmentId]`

Returns:

- quiz questions
- assignment metadata

#### POST `/api/guard/training/quiz/[assignmentId]/submit`

Request:

```json
{
  "answers": [
    { "questionId": "q1", "answer": "A" }
  ]
}
```

#### GET `/api/guard/evaluations`

Returns:

- evaluation summary / results

#### GET/POST `/api/guard/leave`

POST request:

```json
{
  "fromDate": "2026-05-01",
  "toDate": "2026-05-03",
  "reason": "Medical"
}
```

### Attendance APIs

#### GET `/api/public/attendance`

Returns:

- selectable site list
- duty-point-aware site metadata

#### GET `/api/public/attendance/employee`

Query:

- employee lookup by identifier

Returns:

- employee summary
- attendance hint

#### POST `/api/public/attendance/upload`

Used for:

- attendance image upload before submit

#### POST `/api/attendance/submit`

Request shape:

```json
{
  "employeeDocId": "firestoreDocId",
  "employeeId": "CISS/...",
  "employeeClientName": "Geodis India Ltd.",
  "siteId": "siteDocId",
  "district": "Ernakulam",
  "photoUrl": "https://...",
  "lat": 10.1,
  "lng": 76.2,
  "gpsAccuracyMeters": 18,
  "mockLocationDetected": false,
  "reportedAtClient": "2026-04-29T10:10:00.000Z",
  "dutyPointId": "gate-1",
  "dutyPointName": "Gate 1",
  "shiftCode": "day",
  "status": "In"
}
```

Server validates:

- employee
- site/client match
- district
- geofence
- duty point
- shift
- TCS assignment if TCS site

## 4. Field Officer APIs

Current app does not yet expose a dedicated field-officer auth API like guards.
Recommended near-term mobile approach:

- Firebase email/password sign-in
- use custom claims to determine `fieldOfficer`

### GET `/api/admin/visit-reports`

Supports scoped listing by authenticated admin/field officer/client.

### POST `/api/admin/visit-reports`

Request:

```json
{
  "clientId": "clientDocId",
  "clientName": "Geodis India Ltd.",
  "siteId": "siteDocId",
  "siteName": "Main Warehouse",
  "district": "Ernakulam",
  "visitDate": "2026-04-29T09:30:00.000Z",
  "summary": "Visit completed",
  "issuesFound": "None",
  "actionsRequired": "",
  "guardsPresentCount": 4,
  "guardsAbsentCount": 0,
  "photoUrls": []
}
```

### GET `/api/admin/training-reports`

Scoped list.

### POST `/api/admin/training-reports`

Request:

```json
{
  "clientId": "clientDocId",
  "clientName": "Geodis India Ltd.",
  "siteId": "siteDocId",
  "siteName": "Main Warehouse",
  "district": "Ernakulam",
  "trainingDate": "2026-04-29T11:30:00.000Z",
  "durationMinutes": 60,
  "topic": "Fire Safety",
  "description": "Basic drill briefing",
  "attendeeIds": ["emp1", "emp2"],
  "attendeeCount": 2,
  "photoUrls": []
}
```

### Work-order APIs for field officers

Relevant current endpoints:

- `/api/admin/work-orders`
- `/api/admin/work-orders/[id]`
- `/api/admin/work-orders/todos`

Field officers should use read-only or restricted actions depending on role and backend policy.

## 5. Recommended New Incident APIs

These are not yet the main active backend contract, but recommended for mobile:

- `POST /api/guard/incidents`
- `GET /api/guard/incidents`
- `GET /api/field-officer/incidents`
- `PATCH /api/admin/incidents/[id]`

## 6. Core Firestore Contracts

These are the most important current contracts mobile must understand.

### employees

Essential fields:

```json
{
  "employeeId": "CISS/...",
  "fullName": "NAME",
  "clientName": "Geodis India Ltd.",
  "phoneNumber": "9999999999",
  "district": "Ernakulam",
  "status": "Active",
  "profilePictureUrl": "https://...",
  "signatureUrl": "https://...",
  "guardPin": "<hashed>",
  "guardAuthUid": "firebaseUid"
}
```

### sites

Essential fields:

```json
{
  "clientId": "clientDocId",
  "clientName": "Geodis India Ltd.",
  "siteName": "Main Warehouse",
  "district": "Ernakulam",
  "geolocation": { "latitude": 10.1, "longitude": 76.2 },
  "geofenceRadiusMeters": 150,
  "strictGeofence": true,
  "shiftMode": "fixed",
  "shiftPattern": "2x12",
  "shiftTemplates": [],
  "dutyPoints": [
    {
      "id": "gate-1",
      "name": "Gate 1",
      "coverageMode": "roundClock",
      "dutyHours": "12",
      "shiftMode": "fixed",
      "shiftTemplates": []
    }
  ]
}
```

### attendanceLogs

Essential fields:

```json
{
  "employeeDocId": "employeeDocId",
  "employeeId": "CISS/...",
  "employeeName": "Guard Name",
  "clientName": "Geodis India Ltd.",
  "siteId": "siteDocId",
  "siteName": "Main Warehouse",
  "district": "Ernakulam",
  "status": "In",
  "shiftCode": "day",
  "shiftLabel": "Day Shift",
  "dutyPointId": "gate-1",
  "dutyPointName": "Gate 1",
  "photoUrl": "https://...",
  "lat": 10.1,
  "lng": 76.2,
  "distanceMeters": 21,
  "gpsAccuracyMeters": 18,
  "createdAt": "timestamp"
}
```

### attendanceState

Essential fields:

```json
{
  "lastAttendanceDate": "2026-04-29",
  "lastStatus": "In",
  "lastDutyPointId": "gate-1",
  "lastShiftCode": "day"
}
```

### workOrders

Important for TCS:

```json
{
  "siteId": "siteDocId",
  "siteName": "Center A",
  "clientName": "TCS",
  "district": "Ernakulam",
  "date": "timestamp",
  "examName": "BITSAT",
  "examCode": "bitsat",
  "maleGuardsRequired": 2,
  "femaleGuardsRequired": 1,
  "totalManpower": 3,
  "assignedGuards": []
}
```

### foVisitReports

```json
{
  "fieldOfficerId": "uid",
  "fieldOfficerName": "Officer",
  "clientId": "clientDocId",
  "clientName": "Geodis India Ltd.",
  "siteId": "siteDocId",
  "siteName": "Main Warehouse",
  "district": "Ernakulam",
  "visitDate": "timestamp",
  "summary": "Visit completed",
  "issuesFound": "",
  "actionsRequired": "",
  "guardsPresentCount": 4,
  "guardsAbsentCount": 0,
  "status": "draft"
}
```

### foTrainingReports

```json
{
  "fieldOfficerId": "uid",
  "fieldOfficerName": "Officer",
  "clientId": "clientDocId",
  "clientName": "Geodis India Ltd.",
  "siteId": "siteDocId",
  "siteName": "Main Warehouse",
  "district": "Ernakulam",
  "trainingDate": "timestamp",
  "durationMinutes": 60,
  "topic": "Fire Safety",
  "description": "Briefing",
  "attendeeIds": [],
  "attendeeCount": 0,
  "status": "submitted"
}
```

### payrollEntries

```json
{
  "cycleId": "cycleDocId",
  "period": "2026-04",
  "employeeId": "employeeDocId",
  "employeeName": "Guard Name",
  "employeeCode": "CISS/...",
  "clientId": "clientDocId",
  "clientName": "Geodis India Ltd.",
  "district": "Ernakulam",
  "workingDays": 30,
  "presentDays": 28,
  "lopDays": 2,
  "netPay": 18450,
  "status": "finalized"
}
```

## 7. Mobile DTO Priority

Define these first in Flutter:

- `AuthSessionDto`
- `GuardProfileDto`
- `AttendanceSubmissionDto`
- `AttendanceLogDto`
- `SiteOptionDto`
- `DutyPointDto`
- `ShiftTemplateDto`
- `VisitReportDto`
- `TrainingReportDto`
- `WorkOrderDto`
- `PayslipSummaryDto`
- `TrainingAssignmentDto`

## 8. Recommended Build Order for Flutter Features

1. auth
2. attendance
3. guard profile
4. payslips
5. training/evaluation
6. leave
7. field officer reports
8. incidents

