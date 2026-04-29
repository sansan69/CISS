# Graph Report - src/app  (2026-04-29)

## Corpus Check
- 166 files · ~152,025 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 722 nodes · 1332 edges · 26 communities detected
- Extraction: 62% EXTRACTED · 38% INFERRED · 0% AMBIGUOUS · INFERRED: 503 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Training And Enrollment APIs|Training And Enrollment APIs]]
- [[_COMMUNITY_Lookup And Validation APIs|Lookup And Validation APIs]]
- [[_COMMUNITY_Work Order Import Commit|Work Order Import Commit]]
- [[_COMMUNITY_Work Order Preview Tests|Work Order Preview Tests]]
- [[_COMMUNITY_Employee Admin And Payroll|Employee Admin And Payroll]]
- [[_COMMUNITY_Employee Profiles And Exports|Employee Profiles And Exports]]
- [[_COMMUNITY_Enrollment Experience|Enrollment Experience]]
- [[_COMMUNITY_Operations Dashboards|Operations Dashboards]]
- [[_COMMUNITY_Client Settings Portal|Client Settings Portal]]
- [[_COMMUNITY_Work Order Board|Work Order Board]]
- [[_COMMUNITY_Attendance Capture Flow|Attendance Capture Flow]]
- [[_COMMUNITY_Work Order Import Preview|Work Order Import Preview]]
- [[_COMMUNITY_State Management Setup|State Management Setup]]
- [[_COMMUNITY_Field Officer Management|Field Officer Management]]
- [[_COMMUNITY_Attendance Photo Analysis|Attendance Photo Analysis]]
- [[_COMMUNITY_Guard Login And States|Guard Login And States]]
- [[_COMMUNITY_Training Module Management|Training Module Management]]
- [[_COMMUNITY_Attendance Submission Rules|Attendance Submission Rules]]
- [[_COMMUNITY_Wage Configuration Builder|Wage Configuration Builder]]
- [[_COMMUNITY_Visit Report APIs|Visit Report APIs]]
- [[_COMMUNITY_Guard Assignment Dialog|Guard Assignment Dialog]]
- [[_COMMUNITY_Leave Workflow UI|Leave Workflow UI]]
- [[_COMMUNITY_Public Upload Endpoints|Public Upload Endpoints]]
- [[_COMMUNITY_Region Metrics Overview|Region Metrics Overview]]
- [[_COMMUNITY_Settings Bulk Import|Settings Bulk Import]]
- [[_COMMUNITY_Work Order Import History|Work Order Import History]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 46 edges
2. `PATCH()` - 25 edges
3. `DELETE()` - 25 edges
4. `toDate()` - 18 edges
5. `POST()` - 17 edges
6. `fetchSites()` - 16 edges
7. `POST()` - 15 edges
8. `GET()` - 13 edges
9. `handlePdfExport()` - 12 edges
10. `resolveCommitRows()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `handleSubmitAttendance()` --calls--> `haversineDistanceMeters()`  [INFERRED]
  attendance/page.tsx → (app)/settings/site-management/page.tsx
- `handlePdfExport()` --calls--> `toDate()`  [INFERRED]
  (app)/settings/data-export/page.tsx → api/client/dashboard/route.ts
- `POST()` --calls--> `save()`  [INFERRED]
  api/public/enroll/upload/route.ts → (app)/settings/wage-config/page.tsx
- `handleNextPage()` --calls--> `fetchSites()`  [INFERRED]
  (app)/settings/site-management/page.tsx → api/admin/work-orders/import/commit/route.ts
- `handlePrevPage()` --calls--> `fetchSites()`  [INFERRED]
  (app)/settings/site-management/page.tsx → api/admin/work-orders/import/commit/route.ts

## Communities

### Community 0 - "Training And Enrollment APIs"
Cohesion: 0.04
Nodes (54): GET(), shuffleInPlace(), GET(), POST(), GET(), POST(), GET(), POST() (+46 more)

### Community 1 - "Lookup And Validation APIs"
Cohesion: 0.06
Nodes (34): POST(), POST(), POST(), POST(), POST(), GET(), PUT(), POST() (+26 more)

### Community 2 - "Work Order Import Commit"
Cohesion: 0.08
Nodes (33): buildFallbackSiteKey(), buildWorkOrderDocId(), buildWorkOrderDocIdForExam(), createStoredDate(), fetchExistingRows(), fetchSites(), findMatchingExistingRow(), getFallbackIdentityKey() (+25 more)

### Community 3 - "Work Order Preview Tests"
Cohesion: 0.08
Nodes (19): compareValues(), FakeBatch, FakeDocRef, FakeDocSnapshot, FakeFirestore, FakeQuery, FakeQuerySnapshot, matchFilter() (+11 more)

### Community 4 - "Employee Admin And Payroll"
Cohesion: 0.06
Nodes (19): FakeCollectionRef, GET(), handleConfirmDelete(), handleConfirmStatusUpdate(), fetchEmployee(), handleRegenerateEmployeeId(), handleRegenerateQrCode(), handleRemoveFile() (+11 more)

### Community 5 - "Employee Profiles And Exports"
Cohesion: 0.1
Nodes (26): fetchClients(), fetchImageBytes(), handleExport(), handlePdfExport(), handleXlsxExport(), toTitleCase(), handleDownloadProfile(), closeCameraDialog() (+18 more)

### Community 6 - "Enrollment Experience"
Cohesion: 0.11
Nodes (28): close(), buildEnrollmentStoragePath(), buildLngEnrollmentEmail(), clearDraft(), clearEnrollmentDraftFiles(), closeCameraDialog(), collapseHeaderOnMobile(), deserializeDraftValues() (+20 more)

### Community 7 - "Operations Dashboards"
Cohesion: 0.08
Nodes (19): downloadBlob(), getReportedAt(), handleExport(), GET(), toCsv(), toISTTimeString(), workingDaysInMonth(), coerce() (+11 more)

### Community 8 - "Client Settings Portal"
Cohesion: 0.1
Nodes (11): buildCoordinatePayload(), createDutyPointDraft(), handleDeleteLocation(), handleDeleteSite(), handleSaveLocation(), handleSaveSite(), isOperationalClientName(), normalizeGeoPoint() (+3 more)

### Community 9 - "Work Order Board"
Cohesion: 0.13
Nodes (10): handleFilterChange(), buildFallbackSiteKey(), clearFilters(), fetchSites(), getWorkOrderExamKey(), handlePreviewImport(), handleRenameExam(), handleTabChange() (+2 more)

### Community 10 - "Attendance Capture Flow"
Cohesion: 0.16
Nodes (8): beginPhotoCapture(), handleRescan(), handleStartVerification(), handleSubmitAttendance(), isRetryableAttendanceError(), resetVerificationState(), startCameraStream(), waitForVideoSurface()

### Community 11 - "Work Order Import Preview"
Cohesion: 0.25
Nodes (14): detectDuplicateState(), fetchExistingRows(), findMatchingExistingRow(), getFallbackIdentityKey(), getIdentityKey(), hasConcreteSiteId(), hasIdentityOverlap(), isActiveRecordStatus() (+6 more)

### Community 12 - "State Management Setup"
Cohesion: 0.22
Nodes (7): buildSecretPayload(), getFirebaseConsoleLinks(), getGuidedSetupSteps(), getValidationChecks(), handleCreateAdmin(), handleSeedRegion(), handleValidateRegion()

### Community 13 - "Field Officer Management"
Cohesion: 0.18
Nodes (4): closeFormDialog(), handleSave(), handleSaveOfficer(), validate()

### Community 14 - "Attendance Photo Analysis"
Cohesion: 0.35
Nodes (11): buildComplianceSchema(), checkRateLimit(), extractJson(), fallbackCompliance(), friendlyError(), GET(), getClientIp(), isQuotaError() (+3 more)

### Community 15 - "Guard Login And States"
Cohesion: 0.29
Nodes (9): fallbackToProductionLogin(), isCustomTokenAccepted(), isLocalHost(), normalizePhone(), POST(), GET(), isAdmin(), isSuperAdmin() (+1 more)

### Community 16 - "Training Module Management"
Cohesion: 0.36
Nodes (7): handleFilePick(), handleSave(), openCreate(), openEdit(), resetFilePicker(), resolveContentType(), uploadPendingFile()

### Community 17 - "Attendance Submission Rules"
Cohesion: 0.2
Nodes (1): AttendanceError

### Community 18 - "Wage Configuration Builder"
Cohesion: 0.33
Nodes (6): buildAttendanceKey(), buildDraft(), buildExpression(), buildRuleType(), dedupeConstants(), proceedToConfigure()

### Community 19 - "Visit Report APIs"
Cohesion: 0.42
Nodes (8): canFieldOfficerUseDistrict(), createdAtMillis(), GET(), getFieldOfficerProfile(), POST(), resolveSite(), serializeDate(), serializeReport()

### Community 20 - "Guard Assignment Dialog"
Cohesion: 0.25
Nodes (1): handleOpenAssignDialog()

### Community 21 - "Leave Workflow UI"
Cohesion: 0.32
Nodes (3): calculateDays(), formatDate(), handleSubmit()

### Community 22 - "Public Upload Endpoints"
Cohesion: 0.43
Nodes (5): buildDownloadUrl(), isSafeAttendancePath(), isSafeEnrollmentPath(), parseImageDataUrl(), POST()

### Community 24 - "Region Metrics Overview"
Cohesion: 0.57
Nodes (6): buildRegionMetrics(), countDocs(), GET(), startOfToday(), summarize(), withTransientRegionApp()

### Community 25 - "Settings Bulk Import"
Cohesion: 0.29
Nodes (1): processClientsSitesImport()

### Community 32 - "Work Order Import History"
Cohesion: 0.5
Nodes (1): getSnapshotData()

## Knowledge Gaps
- **Thin community `Attendance Submission Rules`** (10 nodes): `route.ts`, `AttendanceError`, `.constructor()`, `GET()`, `getAllowedRadiusMeters()`, `getGpsAccuracyLimitMeters()`, `isActiveWorkOrderRecord()`, `mergePhotoCompliance()`, `parseSiteCoordinates()`, `validateEmployee()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Guard Assignment Dialog`** (8 nodes): `page.tsx`, `getGuardDetails()`, `getInitials()`, `handleConfirmDelete()`, `handleOpenAssignDialog()`, `handleSaveAssignments()`, `handleSaveCounts()`, `handleToggleGuard()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Settings Bulk Import`** (7 nodes): `page.tsx`, `excelSerialToDate()`, `handleDownloadClientsSitesTemplate()`, `handleDownloadTemplate()`, `handleFileChange()`, `processAndUpload()`, `processClientsSitesImport()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Work Order Import History`** (4 nodes): `work-order-imports.ts`, `buildTcsWorkOrderImportsQuery()`, `getSnapshotData()`, `normalizeTcsWorkOrderImportRecords()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handlePdfExport()` connect `Employee Profiles And Exports` to `Training And Enrollment APIs`, `Operations Dashboards`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `handleDownloadProfile()` connect `Employee Profiles And Exports` to `Enrollment Experience`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `save()` connect `Employee Profiles And Exports` to `Wage Configuration Builder`, `Public Upload Endpoints`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Are the 39 inferred relationships involving `GET()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`GET()` has 39 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `PATCH()` (e.g. with `.limit()` and `.where()`) actually correct?**
  _`PATCH()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `DELETE()` (e.g. with `toggleEditMode()` and `.limit()`) actually correct?**
  _`DELETE()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `toDate()` (e.g. with `handlePdfExport()` and `getAttendanceTime()`) actually correct?**
  _`toDate()` has 15 INFERRED edges - model-reasoned connections that need verification._