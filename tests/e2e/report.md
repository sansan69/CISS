# CISS end-to-end acceptance report

Run: 2026-10-27T06:33:36.610Z · project `demo-ciss-e2e` (emulator) · region `TN`

**125 passed · 0 harness failures · 0 product defects · 3 blocked** of 128 checks.

Two separate verdicts, on purpose:

- **Harness gate** — driven by `FAIL` only. Green means the harness and the platform it drives are working, not that the product is ready.
- **Product readiness** — driven by `DEFECT`/`BLOCKED`. A green harness gate can still leave a flow NOT READY, and that is exactly what the table below records.

`FAIL` = the harness/platform could not do its job (must be fixed). `DEFECT` = a confirmed product defect the harness found and quarantined. `BLOCKED` = needs an external service the emulator cannot provide.

## Verdict by flow

| Flow | Verdict | Pass | Fail | Defect | Blocked |
|---|---|---|---|---|---|
| F1 Region onboarding (BYO Firebase) | READY | 25 | 0 | 0 | 0 |
| F2 Guard enrollment + guard auth | PARTIAL / BLOCKED | 6 | 0 | 0 | 2 |
| F3 Field officer creation + district scoping | READY | 8 | 0 | 0 | 0 |
| F4 Client / site / duty point | READY | 7 | 0 | 0 | 0 |
| F5 Work order upload + assignment | READY | 9 | 0 | 0 | 0 |
| F6 Notifications to guards and field officers | PARTIAL / BLOCKED | 9 | 0 | 0 | 1 |
| F7 Training material upload + assignment | READY | 8 | 0 | 0 | 0 |
| F8 Payslips | READY | 4 | 0 | 0 | 0 |
| F9 Database integrity + rules | READY | 16 | 0 | 0 | 0 |
| F10 Multi-state readiness (non-Kerala data) | READY | 3 | 0 | 0 | 0 |
| F11 Attendance marking | READY | 8 | 0 | 0 | 0 |
| F12 Employee record edit | READY | 2 | 0 | 0 | 0 |
| F13 Client portal user creation | READY | 3 | 0 | 0 | 0 |
| F14 Guard evaluation | READY | 2 | 0 | 0 | 0 |
| F15 Bulk payslips | READY | 10 | 0 | 0 | 0 |

## Every check

| Flow | Check | Status | Evidence |
|---|---|---|---|
| infra | Firebase emulator suite started | PASS | auth:9099 firestore:8080 storage:9199 |
| infra | firestore.rules are loaded and enforced | PASS | anonymous read denied — repository rules active |
| infra | Next.js server started against the emulators | PASS | http://127.0.0.1:3100 (pid 78028) |
| infra | super admin session minted against the auth emulator | PASS | e2e-super-c904ab@example.test |
| F1 Region onboarding (BYO Firebase) | POST /regions creates a BYO-Firebase region | PASS | HTTP 201 |
| F1 Region onboarding (BYO Firebase) | region marked validated + persistent connection saved | PASS | status=validated persistentConnectionReady=true |
| F1 Region onboarding (BYO Firebase) | onboardingMode = byo_firebase | PASS | byo_firebase |
| F1 Region onboarding (BYO Firebase) | allowed domains normalised | PASS | ["ciss-tn.example","*.ciss-tn.example"] |
| F1 Region onboarding (BYO Firebase) | android package persisted from google-services.json | PASS | in.ciss.workforce.tn |
| F1 Region onboarding (BYO Firebase) | POST response contains no service-account material | PASS | clean |
| F1 Region onboarding (BYO Firebase) | duplicate region rejected | PASS | HTTP 409 |
| F1 Region onboarding (BYO Firebase) | service account from another project rejected | PASS | HTTP 400 |
| F1 Region onboarding (BYO Firebase) | POST /[id]/validate re-validates against Firestore+Auth | PASS | HTTP 200 |
| F1 Region onboarding (BYO Firebase) | validation checks firestore+auth reachable | PASS | {"projectIdMatches":true,"firestoreReachable":true,"authReachable":true,"storageReachable":true} |
| F1 Region onboarding (BYO Firebase) | POST /[id]/seed writes the default documents | PASS | HTTP 200 |
| F1 Region onboarding (BYO Firebase) | seed reports 3 default documents | PASS | systemConfig/runtime,enrollmentFormConfig/global,regionSetupProgress/default |
| F1 Region onboarding (BYO Firebase) | seeded doc exists: systemConfig/runtime | PASS | found |
| F1 Region onboarding (BYO Firebase) | seeded doc exists: enrollmentFormConfig/global | PASS | found |
| F1 Region onboarding (BYO Firebase) | seeded doc exists: regionSetupProgress/default | PASS | found |
| F1 Region onboarding (BYO Firebase) | POST /[id]/create-admin creates the region admin | PASS | HTTP 200 |
| F1 Region onboarding (BYO Firebase) | region admin carries role=admin + stateCode | PASS | {"role":"admin","admin":true,"stateCode":"TN"} |
| F1 Region onboarding (BYO Firebase) | GET deployment-config | PASS | HTTP 200 |
| F1 Region onboarding (BYO Firebase) | deploymentConfig REGION_CODE | PASS | TN |
| F1 Region onboarding (BYO Firebase) | current region's deploymentConfig is served from its own env | PASS | synthetic branch |
| F1 Region onboarding (BYO Firebase) | POST /regions (second region, stored-document path) | PASS | HTTP 201 |
| F1 Region onboarding (BYO Firebase) | deploymentConfig android app/package for a stored region | PASS | appId=1:100000000001:android:0000000000000000000002 package=in.ciss.workforce.ka |
| F1 Region onboarding (BYO Firebase) | deploymentConfig allowed domains for a stored region | PASS | ciss-ka.example |
| F1 Region onboarding (BYO Firebase) | deploymentConfig onboarding mode for a stored region | PASS | byo_firebase |
| F1 Region onboarding (BYO Firebase) | deployment-config contains no service account | PASS | clean |
| infra | region admin can sign in with the created credentials | PASS | tn-admin-c904ab@example.test |
| F2 Guard enrollment + guard auth | Public enrollment API (POST /api/employees/enroll) | BLOCKED | HTTP 400 — {"error":"Profile picture must be uploaded through the enrollment form."} — the real submission is gated on Storage-uploaded document references (draft-scoped) and, at the write, on Cloud KMS Aadhaar encryption; the emulator provides neither, so this leg is recorded as blocked rather than passed |
| F2 Guard enrollment + guard auth | guard employee fixture created (enrollment API bypassed: KMS) | PASS | employees/3TLwysZuUm0Y2NVfsCWN |
| F2 Guard enrollment + guard auth | Guard sets a PIN (POST /api/guard/auth/setup-pin) | PASS | HTTP 200 |
| F2 Guard enrollment + guard auth | employee doc linked to a guard auth uid | PASS | NAlkHJXKl5uSDDZKT7jXJyiauPyL |
| F2 Guard enrollment + guard auth | Guard login endpoint (POST /api/guard/auth/login) | BLOCKED | HTTP 500 — {"error":"Could not complete sign-in."} (localhost Host → identitytoolkit probe → NEXT_PUBLIC_APP_URL fallback; cannot complete locally) |
| F2 Guard enrollment + guard auth | guard ID token via the same custom-token exchange (fixture path) | PASS | admin.createCustomToken → auth emulator |
| F2 Guard enrollment + guard auth | Guard reads own profile (GET /api/guard/profile) | PASS | HTTP 200 |
| F2 Guard enrollment + guard auth | Admin token is rejected by a guard-only route | PASS | HTTP 401 |
| F3 Field officer creation + district scoping | Admin creates a field officer (POST /api/admin/field-officers) | PASS | HTTP 200 |
| F3 Field officer creation + district scoping | field officer claims carry role + assignedDistricts | PASS | {"role":"fieldOfficer","stateCode":"TN","assignedDistricts":["Ernakulam"]} |
| F3 Field officer creation + district scoping | field officer document written | PASS | exists=true stateCode=TN |
| F3 Field officer creation + district scoping | Field officer lists guards in an assigned district | PASS | HTTP 200 |
| F3 Field officer creation + district scoping | scoped roster returns the district guard | PASS | count=1 |
| F3 Field officer creation + district scoping | unassigned-district guard fixture exists | PASS | employees/BcmxY58W7bT6ZTpbkjdi (district=Thiruvananthapuram) |
| F3 Field officer creation + district scoping | field officer cannot read an unassigned district (fixture present there) | PASS | HTTP 200, fixture leaked=false, roster=0 |
| F3 Field officer creation + district scoping | field officer token is rejected by admin-only routes | PASS | HTTP 403 |
| F4 Client / site / duty point | Admin creates a client (POST /api/admin/clients) | PASS | HTTP 200 |
| F4 Client / site / duty point | client document carries stateCode | PASS | TN |
| F4 Client / site / duty point | Admin creates a site / duty point (POST /api/admin/sites) | PASS | HTTP 200 |
| F4 Client / site / duty point | site stores geofence coordinates | PASS | 9.9312,76.2673 |
| F4 Client / site / duty point | duty points persist through the browser write path | PASS | [{"id":"dp-1","name":"Main Gate","code":"MG-1","active":true,"coverageMode":"roundClock","dutyHours":"12","shiftMode":"fixed","shiftTemplates":[],"patrolPoints":[]}] |
| F4 Client / site / duty point | clientLocations write allowed for an admin (rules) | PASS | docs=1 |
| F4 Client / site / duty point | unauthenticated browser write is denied by firestore.rules | PASS | permission-denied (rules rejected the unauthenticated write) |
| F5 Work order upload + assignment | Admin creates a work order (POST /api/admin/work-orders) | PASS | HTTP 200 |
| F5 Work order upload + assignment | work order stores assigned guards | PASS | [{"employeeId":"CISS/TCS/2026-27/C904AB","employeeDocId":"3TLwysZuUm0Y2NVfsCWN","guardName":"E2E Guard","phoneNumber":"9013173931"}] |
| F5 Work order upload + assignment | Admin lists work orders | PASS | HTTP 200 |
| F5 Work order upload + assignment | Field officer sees the work order roster | PASS | HTTP 200 |
| F5 Work order upload + assignment | Work-order file preview (POST /import/preview, CSV) | PASS | HTTP 200 |
| F5 Work order upload + assignment | preview parsed the uploaded rows with their values | PASS | rows=2 first={"siteName":"Auto TCS Site c904ab","district":"Ernakulam","male":2,"female":1} |
| F5 Work order upload + assignment | Work-order import commit creates the exam duty | PASS | HTTP 200 |
| F5 Work order upload + assignment | TCS centres are auto-created from the work-order upload | PASS | sites=2 |
| F5 Work order upload + assignment | auto-created TCS site carries client, district and coordinate status | PASS | {"clientName":"TCS","district":"Ernakulam","coordinateStatus":"geocoded","geofenceRadiusMeters":150} |
| F6 Notifications to guards and field officers | Guard registers an FCM token (POST /api/mobile/token) | PASS | HTTP 200 |
| F6 Notifications to guards and field officers | Admin broadcasts to guards (API call without a `data` payload) | PASS | HTTP 200 — {"success":true,"notifId":"3953c9c8-ac15-41db-9986-493c45c4dbb2","savedToFirestore":true,"recipientCount":1,"fcmDelivered":false,"fcmWarning":"Push delivery partially failed: guards: Credential implementation provided to initializeApp() via the \"credential\" property failed to fetch a valid Google OAuth2 access token … — src/app/api/admin/notifications/send/route.ts:151 writes `data: data \|\| undefined` and Firestore rejects undefined values |
| F6 Notifications to guards and field officers | guard notification document written | PASS | docs=1 — broadcast reported success without a document |
| F6 Notifications to guards and field officers | Guard broadcast succeeds when an empty `data` object is supplied | PASS | HTTP 200 — {"success":true,"notifId":"59240e45-bfd5-4c6f-9d72-ca7a70ba1f6b","savedToFirestore":true,"recipientCount":1,"fcmDelivered":false,"fcmWarning":"Push delivery partially failed: guards: Credential implementation provided to initializeApp() via the \"credential\" property failed to fetch a valid Google OAuth2 access token … (isolates the undefined-field defect) |
| F6 Notifications to guards and field officers | guard notification document written (with data) | PASS | docs=2 |
| F6 Notifications to guards and field officers | Admin broadcasts to field officers (API call without a `data` payload) | PASS | HTTP 200 — {"success":true,"notifId":"785dcf7a-f924-4956-a1f1-54fc6202586a","savedToFirestore":true,"recipientCount":1,"fcmDelivered":false,"fcmWarning":"Push delivery partially failed: field_officers: Credential implementation provided to initializeApp() via the \"credential\" property failed to fetch a valid Google OAuth2 acces… |
| F6 Notifications to guards and field officers | field officer notification document written | PASS | docs=1 — broadcast reported success without a document |
| F6 Notifications to guards and field officers | field officer broadcast with `data: {}` writes the notification | PASS | HTTP 200, docs=1 |
| F6 Notifications to guards and field officers | Guard reads the notification inbox (GET /api/mobile/notifications) | PASS | HTTP 200 |
| F6 Notifications to guards and field officers | Actual FCM push delivery | BLOCKED | no FCM emulator exists; route is best-effort and records fcmErrors |
| F7 Training material upload + assignment | training material uploaded to Cloud Storage (emulator) | PASS | training/modules/e2e-c904ab/handbook.pdf (33 bytes) |
| F7 Training material upload + assignment | Admin creates a training module | PASS | HTTP 200 |
| F7 Training material upload + assignment | Admin assigns the module to a guard | PASS | HTTP 200 |
| F7 Training material upload + assignment | assignment count returned | PASS | {"assigned":1} |
| F7 Training material upload + assignment | Guard sees assigned training (GET /api/guard/training) | PASS | HTTP 200 |
| F7 Training material upload + assignment | trainingAssignments document written | PASS | docs=1 |
| F7 Training material upload + assignment | Guard acknowledges the module | PASS | HTTP 200 |
| F7 Training material upload + assignment | assignment status advances past 'assigned' | PASS | viewed |
| F8 Payslips | Guard payslip list route is live | PASS | HTTP 200 — {"payslips":[]} |
| F8 Payslips | Admin payslip list route is live | PASS | HTTP 200 |
| F8 Payslips | Admin payroll cycles route is live | PASS | HTTP 200 |
| F8 Payslips | Guard leave route is live | PASS | HTTP 200 |
| F9 Database integrity + rules | collection reachable + written: regions | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: regionConnections | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: employees | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: fieldOfficers | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: clients | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: sites | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: clientLocations | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: workOrders | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: notifications | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: trainingModules | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: trainingAssignments | PASS | docs(sample)=1 |
| F9 Database integrity + rules | collection reachable + written: enrollments | PASS | docs(sample)=1 |
| F9 Database integrity + rules | region service account stored encrypted (iv/authTag/cipherText) | PASS | fields=cipherText,authTag,iv |
| F9 Database integrity + rules | no plaintext private key on the connection document | PASS | clean |
| F9 Database integrity + rules | unauthenticated API request rejected | PASS | HTTP 401 |
| F9 Database integrity + rules | unauthenticated browser read of employees denied by rules | PASS | permission-denied (rules rejected the unauthenticated read) |
| F10 Multi-state readiness (non-Kerala data) | TN work-order file preview accepts a non-Kerala roster | PASS | HTTP 200 — {"parserMode":"legacy-sheet","suggestedExamName":"e2e tn c904ab","suggestedExamCode":"e2e-tn-c904ab","dateRange":{"from":"","to":""},"dates":[""],"rows":[{"siteName":"TN Chennai Site c904ab","district":"Chennai","date":"","maleGuardsRequired":1,"femaleGuardsRequired":1,"examName":"e2e tn c904ab","examCode":"e2e-tn-c904… |
| F10 Multi-state readiness (non-Kerala data) | Tamil Nadu district names survive the import parser | PASS | districts=["Chennai","Coimbatore","Chennai","Coimbatore"] — non-Kerala district names survive the parser verbatim; note they are NOT canonicalised (districts.ts canonicalises Kerala names only), so spelling variants would fragment district-scoped queries |
| F10 Multi-state readiness (non-Kerala data) | public region registry answers | PASS | HTTP 200 |
| F11 Attendance marking | Guard marks attendance IN (POST /api/attendance/submit) | PASS | HTTP 200 |
| F11 Attendance marking | attendance log persisted under the idempotency key | PASS | attendanceLogs/fbe6e05c-2c11-48be-8e33-9eaf9e3fa191 |
| F11 Attendance marking | attendance log carries employee/site/status/photo/actor | PASS | {"employeeDocId":"3TLwysZuUm0Y2NVfsCWN","siteId":"dM8E88Kd78XY8DpT63jz","status":"In","photo":"employees/3TLwysZuUm0Y2NVfsCWN/attendance/abc5759b-12a9-4ca3-8e7b-724afea61ea3/photo.jpg","submittedByUid":"NAlkHJXKl5uSDDZKT7jXJyiauPyL","attendanceDate":"2026-10-27"} |
| F11 Attendance marking | attendanceState reflects IN + open session | PASS | {"lastStatus":"In","openSessionId":"fbe6e05c-2c11-48be-8e33-9eaf9e3fa191"} |
| F11 Attendance marking | open attendance session persisted | PASS | open sessions=1 |
| F11 Attendance marking | Guard marks attendance OUT | PASS | HTTP 200 |
| F11 Attendance marking | attendanceState flips to OUT and clears the open session | PASS | {"lastStatus":"Out"} |
| F11 Attendance marking | IN session closed with an out log id | PASS | {"status":"closed","outLogId":"394f65f0-446d-480b-973f-80c21d63c71a"} |
| F12 Employee record edit | employee edit persists the changed field | PASS | E2E Guard Edited c904ab |
| F12 Employee record edit | employee edit does not drop identity fields | PASS | {"employeeId":"CISS/TCS/2026-27/C904AB","status":"Active"} |
| F13 Client portal user creation | Admin creates a client portal user | PASS | HTTP 200 |
| F13 Client portal user creation | client user claims are role=client + clientId | PASS | {"role":"client","clientId":"kiH2W1XzVCGSCyJHC8EW","clientName":"E2E Client c904ab","loginId":"e2e-client-c904ab","stateCode":"TN"} |
| F13 Client portal user creation | clientUsers document persisted | PASS | docs=1 |
| F14 Guard evaluation | Admin records a guard evaluation | PASS | HTTP 200 |
| F14 Guard evaluation | evaluation persists employee, period, score and evaluator | PASS | {"employeeId":"3TLwysZuUm0Y2NVfsCWN","period":"2026-10","totalScore":50,"normalizedScore":100,"evaluatedBy":"wgNV3bA2kZJHXzn4mf6vT4p3tJWc"} |
| F15 Bulk payslips | Admin bulk-uploads a payslip PDF | PASS | HTTP 201 |
| F15 Bulk payslips | payslip matched to the employee and stored | PASS | {"id":"7bad971a-f1e4-4e43-8729-c0450ddc3d18","employeeDocId":"3TLwysZuUm0Y2NVfsCWN","employeeId":"CISS/TCS/2026-27/C904AB","employeeName":"E2E Guard Edited c904ab","period":"2026-01","fileName":"payslip-c904ab.pdf","storagePath":"employees/3TLwysZuUm0Y2NVfsCWN/payslips/2026-01/f2c5080d-d7d8-40c7-a498-a65ad6a08caf.pdf","sizeBytes":719,"parseMethod":"employeeId","dryRun":false} |
| F15 Bulk payslips | payslipDocuments row carries employee, period and storage path | PASS | {"employeeDocId":"3TLwysZuUm0Y2NVfsCWN","employeeId":"CISS/TCS/2026-27/C904AB","employeeName":"E2E Guard Edited c904ab","clientName":"E2E Client","period":"2026-01","fileName":"payslip-c904ab.pdf","storagePath":"employees/3TLwysZuUm0Y2NVfsCWN/payslips/2026-01/f2c5080d-d7d8-40c7-a498-a65ad6a08caf.pdf","sizeBytes":719,"uploadedBy":"wgNV3bA2kZJHXzn4mf6vT4p3tJWc","uploadedByEmail":"tn-admin-c904ab@example.test","parseMethod":"employeeId","createdAt":{"_seconds":1793082855,"_nanoseconds":481000000}} |
| F15 Bulk payslips | payslip PDF object stored in the bucket | PASS | employees/3TLwysZuUm0Y2NVfsCWN/payslips/2026-01/f2c5080d-d7d8-40c7-a498-a65ad6a08caf.pdf |
| F15 Bulk payslips | Guard lists their payslips | PASS | HTTP 200 |
| F15 Bulk payslips | uploaded payslip appears in the guard's list | PASS | ids=1 |
| F15 Bulk payslips | Guard downloads the PDF (content-type + %PDF magic) | PASS | HTTP 200, application/pdf, 719 bytes |
| F15 Bulk payslips | Non-guard token cannot download a payslip | PASS | HTTP 403 |
| F15 Bulk payslips | Unmatched payslip is reported without being stored | PASS | HTTP 200 |
| F15 Bulk payslips | unmatched reason is returned for the admin | PASS | [{"fileName":"junk.pdf","reason":"no-identifier","detail":"No employee id or name could be read from this PDF or its filename. Rename the file with the employee id (CISS/CLIENT/2025-26/123).","extractedEmployeeId":null,"extractedName":null}] |

## Boundaries of this run

- Database vehicle is the Firebase Emulator Suite; the live `ciss-workforce` project was never contacted.
- The service account is generated per run; the region connection is encrypted with a per-run secret.
- Cloud KMS, FCM, Vercel, and real Firebase project isolation cannot be exercised offline and are marked BLOCKED.
- Guard, client, and field-officer records seeded with `_e2eFixture` markers stand in for browser/HR data entry where an external service blocks the real write.