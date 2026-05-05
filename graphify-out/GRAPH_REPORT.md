# Graph Report - /Users/mymac/Documents/CISS  (2026-05-05)

## Corpus Check
- Large corpus: 390 files · ~279,583 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1503 nodes · 3294 edges · 132 communities (117 shown, 15 thin omitted)
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 620 edges (avg confidence: 0.8)
- Token cost: 25,000 input · 2,000 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Work Order Key Functions|Work Order Key Functions]]
- [[_COMMUNITY_API Route Handlers|API Route Handlers]]
- [[_COMMUNITY_TCS Work Order Import|TCS Work Order Import]]
- [[_COMMUNITY_Admin Navigation|Admin Navigation]]
- [[_COMMUNITY_Region Control Plane|Region Control Plane]]
- [[_COMMUNITY_Attendance Capture Flow|Attendance Capture Flow]]
- [[_COMMUNITY_Firestore Test Infrastructure|Firestore Test Infrastructure]]
- [[_COMMUNITY_Field Officer Profiles|Field Officer Profiles]]
- [[_COMMUNITY_Date & Validation Utils|Date & Validation Utils]]
- [[_COMMUNITY_Firestore Test Mocks|Firestore Test Mocks]]
- [[_COMMUNITY_Site Management UI|Site Management UI]]
- [[_COMMUNITY_Compliance & Rate Limiting|Compliance & Rate Limiting]]
- [[_COMMUNITY_UI Component Library|UI Component Library]]
- [[_COMMUNITY_LNG Work Order Import|LNG Work Order Import]]
- [[_COMMUNITY_TCS Exam Parser|TCS Exam Parser]]
- [[_COMMUNITY_Employee Management|Employee Management]]
- [[_COMMUNITY_Guard Auth & Login|Guard Auth & Login]]
- [[_COMMUNITY_Payroll Engine|Payroll Engine]]
- [[_COMMUNITY_Training & Quiz System|Training & Quiz System]]
- [[_COMMUNITY_Client & Region Mgmt|Client & Region Mgmt]]
- [[_COMMUNITY_QR & Scanner Engine|QR & Scanner Engine]]
- [[_COMMUNITY_Guard Portal UI|Guard Portal UI]]
- [[_COMMUNITY_Payroll Run & Cycles|Payroll Run & Cycles]]
- [[_COMMUNITY_Evaluations Engine|Evaluations Engine]]
- [[_COMMUNITY_Location & Geocoding|Location & Geocoding]]
- [[_COMMUNITY_Brand & Design Tokens|Brand & Design Tokens]]
- [[_COMMUNITY_FCM & Notifications|FCM & Notifications]]
- [[_COMMUNITY_Mobile Session Bridge|Mobile Session Bridge]]
- [[_COMMUNITY_Offline Attendance|Offline Attendance]]
- [[_COMMUNITY_Leave Management|Leave Management]]
- [[_COMMUNITY_Module Group 30|Module Group 30]]
- [[_COMMUNITY_Module Group 31|Module Group 31]]
- [[_COMMUNITY_Module Group 32|Module Group 32]]
- [[_COMMUNITY_Module Group 33|Module Group 33]]
- [[_COMMUNITY_Module Group 34|Module Group 34]]
- [[_COMMUNITY_Module Group 35|Module Group 35]]
- [[_COMMUNITY_Module Group 36|Module Group 36]]
- [[_COMMUNITY_Module Group 37|Module Group 37]]
- [[_COMMUNITY_Module Group 38|Module Group 38]]
- [[_COMMUNITY_Module Group 39|Module Group 39]]
- [[_COMMUNITY_Module Group 40|Module Group 40]]
- [[_COMMUNITY_Module Group 41|Module Group 41]]
- [[_COMMUNITY_Module Group 42|Module Group 42]]
- [[_COMMUNITY_Module Group 43|Module Group 43]]
- [[_COMMUNITY_Module Group 44|Module Group 44]]
- [[_COMMUNITY_Module Group 45|Module Group 45]]
- [[_COMMUNITY_Module Group 46|Module Group 46]]
- [[_COMMUNITY_Module Group 47|Module Group 47]]
- [[_COMMUNITY_Module Group 48|Module Group 48]]
- [[_COMMUNITY_Module Group 49|Module Group 49]]
- [[_COMMUNITY_Module Group 50|Module Group 50]]
- [[_COMMUNITY_Module Group 51|Module Group 51]]
- [[_COMMUNITY_Module Group 52|Module Group 52]]
- [[_COMMUNITY_Module Group 53|Module Group 53]]
- [[_COMMUNITY_Module Group 55|Module Group 55]]
- [[_COMMUNITY_Module Group 56|Module Group 56]]
- [[_COMMUNITY_Module Group 57|Module Group 57]]
- [[_COMMUNITY_Module Group 58|Module Group 58]]
- [[_COMMUNITY_Module Group 59|Module Group 59]]
- [[_COMMUNITY_Module Group 60|Module Group 60]]
- [[_COMMUNITY_Module Group 61|Module Group 61]]
- [[_COMMUNITY_Module Group 62|Module Group 62]]
- [[_COMMUNITY_Module Group 63|Module Group 63]]
- [[_COMMUNITY_Module Group 64|Module Group 64]]
- [[_COMMUNITY_Module Group 65|Module Group 65]]
- [[_COMMUNITY_Module Group 66|Module Group 66]]
- [[_COMMUNITY_Module Group 67|Module Group 67]]
- [[_COMMUNITY_Module Group 71|Module Group 71]]
- [[_COMMUNITY_Module Group 125|Module Group 125]]
- [[_COMMUNITY_Module Group 126|Module Group 126]]
- [[_COMMUNITY_Module Group 127|Module Group 127]]
- [[_COMMUNITY_Module Group 128|Module Group 128]]
- [[_COMMUNITY_Module Group 129|Module Group 129]]
- [[_COMMUNITY_Module Group 130|Module Group 130]]
- [[_COMMUNITY_Module Group 131|Module Group 131]]

## God Nodes (most connected - your core abstractions)
1. `unauthorizedResponse()` - 130 edges
2. `toast()` - 119 edges
3. `requireAdmin()` - 83 edges
4. `authorizedFetch()` - 77 edges
5. `verifyRequestAuth()` - 59 edges
6. `useToast()` - 52 edges
7. `cn()` - 49 edges
8. `hasAdminAccess()` - 33 edges
9. `PATCH()` - 31 edges
10. `buildServerUpdateAudit()` - 31 edges

## Surprising Connections (you probably didn't know these)
- `Mobile Session API` --resolves--> `Guard Role`  [EXTRACTED]
  src/app/api/mobile/session/route.ts → docs/app-context.md
- `Mobile Session API` --resolves--> `Field Officer Role`  [EXTRACTED]
  src/app/api/mobile/session/route.ts → docs/app-context.md
- `handleContinue()` --calls--> `toast()`  [INFERRED]
  src/app/page.tsx → src/hooks/use-toast.ts
- `fetchSites()` --calls--> `toast()`  [INFERRED]
  src/app/attendance/page.tsx → src/hooks/use-toast.ts
- `capturePhoto()` --calls--> `toast()`  [INFERRED]
  src/app/attendance/page.tsx → src/hooks/use-toast.ts

## Communities (132 total, 15 thin omitted)

### Community 0 - "Work Order Key Functions"
Cohesion: 0.07
Nodes (55): buildFallbackSiteKey(), buildSiteCodeDistrictKey(), buildSiteCodeKey(), buildSiteNameKey(), buildWorkOrderDocId(), buildWorkOrderDocIdForExam(), createStoredDate(), fetchExistingRows() (+47 more)

### Community 1 - "API Route Handlers"
Cohesion: 0.07
Nodes (35): GET(), GET(), POST(), POST(), GET(), POST(), POST(), GET() (+27 more)

### Community 2 - "TCS Work Order Import"
Cohesion: 0.08
Nodes (39): normalizeStoredDistrict(), POST(), normalizeTcsDistrict(), employeeMatchesAnyDistrict(), readText(), resolveEmployeeDistrict(), buildLngFallbackEmail(), buildSearchableFields() (+31 more)

### Community 3 - "Admin Navigation"
Cohesion: 0.07
Nodes (32): handleLogin(), getVisibleGroups(), getVisibleNavItems(), isLegacyAdminEmail(), claimsToRole(), refreshClaimedRole(), resolveAppUser(), POST() (+24 more)

### Community 4 - "Region Control Plane"
Cohesion: 0.09
Nodes (36): POST(), GET(), fetchEmployeesForRegion(), GET(), buildRegionVercelProjectName(), buildVercelProjectDashboardUrl(), getVercelTeamSlug(), slugifyRegionName() (+28 more)

### Community 5 - "Attendance Capture Flow"
Cohesion: 0.06
Nodes (32): canRecordNextDayCheckout(), async(), beginPhotoCapture(), capturePhoto(), fetchSites(), handleRescan(), handleStartVerification(), handleSubmitAttendance() (+24 more)

### Community 6 - "Firestore Test Infrastructure"
Cohesion: 0.07
Nodes (11): compareValues(), FakeBatch, FakeCollectionRef, FakeDocRef, FakeDocSnapshot, FakeFirestore, FakeQuery, FakeQuerySnapshot (+3 more)

### Community 7 - "Field Officer Profiles"
Cohesion: 0.13
Nodes (28): GET(), POST(), employeeKey(), GET(), getFieldOfficerProfile(), normalizeText(), toMillis(), toTimeLabel() (+20 more)

### Community 8 - "Date & Validation Utils"
Cohesion: 0.13
Nodes (30): POST(), canHaveTimezoneShift(), formatDateOnly(), guardDobMatches(), hasSeconds(), hasToDate(), isDateOnlyString(), isTimestampLike() (+22 more)

### Community 9 - "Firestore Test Mocks"
Cohesion: 0.09
Nodes (7): cloneValue(), FakeCollectionRef, FakeDocRef, FakeDocSnapshot, FakeFirestore, FakeQuery, FakeQuerySnapshot

### Community 10 - "Site Management UI"
Cohesion: 0.07
Nodes (18): handleSave(), useHaptics(), if(), formatDate(), formatDateRange(), getStatusBadge(), isOperationalWorkOrderClientName(), isWorkOrderAdminRole() (+10 more)

### Community 11 - "Compliance & Rate Limiting"
Cohesion: 0.11
Nodes (27): buildComplianceSchema(), checkRateLimit(), extractJson(), fallbackCompliance(), friendlyError(), GET(), getClientIp(), isQuotaError() (+19 more)

### Community 13 - "LNG Work Order Import"
Cohesion: 0.14
Nodes (28): buildDownloadUrl(), dedupeRows(), deriveDistrict(), driveFileIdFromUrl(), ensureClient(), fetchDriveFile(), guessFileExtension(), importEmployees() (+20 more)

### Community 14 - "TCS Exam Parser"
Cohesion: 0.17
Nodes (27): buildRowBase(), buildValidatedDate(), buildWarnings(), cleanExamNameFromFilename(), cleanTitleText(), countDateLikeCells(), detectParserMode(), extractCellNumber() (+19 more)

### Community 15 - "Employee Management"
Cohesion: 0.11
Nodes (16): GET(), shuffleInPlace(), timestampToMillis(), toISTTimeString(), GET(), POST(), drawLabelValue(), formatAmount() (+8 more)

### Community 16 - "Guard Auth & Login"
Cohesion: 0.1
Nodes (18): coordBadge(), handleDeleteClient(), handleDeleteLocation(), handleDeletePortalUser(), handleRunGpsRepair(), handleSaveClient(), handleSaveModules(), handleSavePortalUser() (+10 more)

### Community 17 - "Payroll Engine"
Cohesion: 0.16
Nodes (18): GET(), PUT(), aggregateAttendance(), applySavedWageTemplate(), applyWageComponents(), calculateEPF(), calculateESIC(), calculatePT() (+10 more)

### Community 18 - "Training & Quiz System"
Cohesion: 0.17
Nodes (25): apiRequest(), buildProductionUrl(), buildProjectName(), buildProjectUrl(), buildTeamProductionUrl(), createStagingCopy(), ensureVercelProject(), extractDeploymentUrl() (+17 more)

### Community 19 - "Client & Region Mgmt"
Cohesion: 0.1
Nodes (18): handleDownloadClientsSitesTemplate(), handleDownloadTemplate(), handleFileChange(), processAndUpload(), addToRemoveQueue(), dispatch(), genId(), reducer() (+10 more)

### Community 20 - "QR & Scanner Engine"
Cohesion: 0.14
Nodes (18): chooseCameraSelection(), createDuplicateScanGuard(), deliverScanResultSafely(), getBarcodeDetectorCtor(), openVideoStream(), setVideoSource(), shouldFallbackToZxing(), startHybridQrScanner() (+10 more)

### Community 21 - "Guard Portal UI"
Cohesion: 0.14
Nodes (7): handleAssign(), useAppAuth(), useToast(), EvaluationDetailPage(), PayrollCyclePage(), SettingsPage(), Skeleton()

### Community 22 - "Payroll Run & Cycles"
Cohesion: 0.17
Nodes (18): DetailItem(), drawMultilineText(), drawSection(), drawText(), fetchEmployee(), handleDownloadProfile(), handleFileChange(), handleRegenerateEmployeeId() (+10 more)

### Community 23 - "Evaluations Engine"
Cohesion: 0.13
Nodes (16): handleFilterChange(), buildFallbackSiteKey(), buildSiteCodeDistrictKey(), clearFilters(), getWorkOrderExamKey(), handleConfirmImport(), handleFileChange(), handlePreviewImport() (+8 more)

### Community 24 - "Location & Geocoding"
Cohesion: 0.14
Nodes (13): handleDelete(), handleSave(), handleSave(), handleDelete(), handleSave(), authorizedFetch(), waitForCurrentUser(), handleRun() (+5 more)

### Community 25 - "Brand & Design Tokens"
Cohesion: 0.1
Nodes (6): FakeCollectionRef, FakeDocRef, FakeDocSnapshot, FakeFirestore, FakeQuery, FakeQuerySnapshot

### Community 26 - "FCM & Notifications"
Cohesion: 0.19
Nodes (13): POST(), POST(), buildServerAuditEvent(), buildServerCreateAudit(), buildServerUpdateAudit(), normalizeActor(), GET(), POST() (+5 more)

### Community 27 - "Mobile Session Bridge"
Cohesion: 0.17
Nodes (19): buildEnrollmentStoragePath(), buildLngEnrollmentEmail(), closeCameraDialog(), fetchClients(), handleCapturePhoto(), handleUploadError(), onSubmit(), openCamera() (+11 more)

### Community 28 - "Offline Attendance"
Cohesion: 0.2
Nodes (11): DELETE(), GET(), PATCH(), validatePriority(), validateStatus(), GET(), verifyRequestAuth(), GET() (+3 more)

### Community 29 - "Leave Management"
Cohesion: 0.17
Nodes (17): clearDraft(), clearEnrollmentDraftFiles(), collapseHeaderOnMobile(), deserializeDraftValues(), getStepIssues(), goToNextStep(), goToPreviousStep(), goToStep() (+9 more)

### Community 30 - "Module Group 30"
Cohesion: 0.16
Nodes (10): buildCoordinatePayload(), handleSaveLocation(), handleSaveSite(), handleConfirmDelete(), handleConfirmStatusUpdate(), buildFirestoreAuditEvent(), buildFirestoreCreateAudit(), buildFirestoreUpdateAudit() (+2 more)

### Community 31 - "Module Group 31"
Cohesion: 0.16
Nodes (15): coordinateSummary(), buildGoogleMapsLink(), buildOsmEmbedUrl(), buildSiteLocationSyncPatch(), deriveCoordinateSource(), formatCoordinate(), normalizeCoordinateSource(), normalizeCoordinateStatus() (+7 more)

### Community 32 - "Module Group 32"
Cohesion: 0.23
Nodes (16): GET(), toCsv(), hasClientAccess(), matchesClientScope(), normalizeClientKey(), normalizeClientMatch(), normalizeText(), resolveClientScope() (+8 more)

### Community 33 - "Module Group 33"
Cohesion: 0.16
Nodes (9): PhotoCapture(), getSiteUploadHint(), hasSiteUploads(), isSiteUploadRequired(), handleAcknowledge(), handleSubmit(), handleMarkReviewed(), handleSubmit() (+1 more)

### Community 34 - "Module Group 34"
Cohesion: 0.23
Nodes (16): buildForwardQueries(), buildForwardQuery(), classifySiteGpsState(), extractIndianPostcode(), extractSiteCoordinates(), formatCoords(), initializeAdmin(), isWithinIndiaBounds() (+8 more)

### Community 35 - "Module Group 35"
Cohesion: 0.11
Nodes (3): handleSubmit(), handleRun(), Badge()

### Community 36 - "Module Group 36"
Cohesion: 0.2
Nodes (12): isRecognizedDistrictName(), buildLocationIdentity(), deriveCoordinateStatus(), hasValidCoordinates(), async(), getDistrictValidationMessage(), handleBackfillCoordinateMetadata(), handleBulkDelete() (+4 more)

### Community 37 - "Module Group 37"
Cohesion: 0.21
Nodes (12): GET(), getFieldOfficerProfile(), getWorkOrderTimestampValue(), isTodayInIst(), normalizeText(), serializeDate(), sortByDateDesc(), timestampToMillis() (+4 more)

### Community 38 - "Module Group 38"
Cohesion: 0.17
Nodes (10): fetchClients(), fetchImageBytes(), handleExport(), handlePdfExport(), handleXlsxExport(), toTitleCase(), fetchClients(), handleAward() (+2 more)

### Community 39 - "Module Group 39"
Cohesion: 0.23
Nodes (11): handleFileChange(), assertEnrollmentUploadSize(), getEnrollmentFileSelectionError(), isEnrollmentFileSelectionValid(), analyzeTemplateFields(), inferSheetFamily(), buildDownloadUrl(), isSafeAttendancePath() (+3 more)

### Community 40 - "Module Group 40"
Cohesion: 0.22
Nodes (10): buildSecretPayload(), getFirebaseConsoleLinks(), getGuidedSetupSteps(), getValidationChecks(), handleCreateAdmin(), handleCreateRegion(), handleSaveMetadata(), handleSeedRegion() (+2 more)

### Community 41 - "Module Group 41"
Cohesion: 0.24
Nodes (11): createDutyPointDraft(), handleDeleteSite(), isOperationalClientName(), openCreateSite(), buildDutyPointShiftTemplates(), buildShiftTemplates(), normalizeDutyPoint(), resolveSiteDutyPoints() (+3 more)

### Community 42 - "Module Group 42"
Cohesion: 0.24
Nodes (9): buildConstants(), detectHeaderRow(), extractNumbers(), inferCategory(), inferStandardName(), isPayrollishHeader(), rowNonEmptyCount(), rowTextishScore() (+1 more)

### Community 43 - "Module Group 43"
Cohesion: 0.18
Nodes (3): FakeFirestore, FakeQuery, FakeSnapshot

### Community 45 - "Module Group 45"
Cohesion: 0.36
Nodes (8): handleDelete(), handleFilePick(), handleSave(), openCreate(), openEdit(), resetFilePicker(), resolveContentType(), uploadPendingFile()

### Community 46 - "Module Group 46"
Cohesion: 0.29
Nodes (8): buildAttendanceKey(), buildDraft(), buildExpression(), buildRuleType(), dedupeConstants(), handleFile(), proceedToConfigure(), save()

### Community 47 - "Module Group 47"
Cohesion: 0.39
Nodes (5): buildPublicAttendanceEmployee(), buildPublicAttendanceSiteOption(), parsePublicAttendanceCoordinates(), toFiniteNumber(), GET()

### Community 49 - "Module Group 49"
Cohesion: 0.43
Nodes (6): addImportById(), addImportsByHash(), cleanupOrphanWorkOrderImports(), hasActiveDocs(), queryActiveWorkOrders(), stringValue()

### Community 50 - "Module Group 50"
Cohesion: 0.43
Nodes (5): useSites(), normalizeClientKey(), normalizeToken(), siteBelongsToClient(), sortSitesByName()

### Community 51 - "Module Group 51"
Cohesion: 0.29
Nodes (8): Mobile Session API, Firebase Backend, Admin Role, Client Role, Field Officer Role, Guard Role, Super Admin Role, CISS Workforce (Webapp)

### Community 52 - "Module Group 52"
Cohesion: 0.25
Nodes (8): Field Officer API Routes, Guard API Routes, Attendance Module, Evaluations Module, Incidents Module, Payroll Module, Training Module, Work Orders Module

### Community 53 - "Module Group 53"
Cohesion: 0.62
Nodes (6): initializeApp(), isActiveRecord(), main(), normalizeKey(), normalizeText(), toDateKey()

### Community 55 - "Module Group 55"
Cohesion: 0.71
Nodes (6): GET(), normalizeText(), readFieldOfficerProfile(), readGuardProfile(), repairClaims(), resolveMobileSession()

### Community 56 - "Module Group 56"
Cohesion: 0.43
Nodes (4): drawMultilineText(), normalizePdfText(), sanitizePdfString(), wrapTextToWidth()

### Community 57 - "Module Group 57"
Cohesion: 0.53
Nodes (4): backfillExamNames(), fetchImports(), initializeApp(), main()

### Community 58 - "Module Group 58"
Cohesion: 0.53
Nodes (4): buildParams(), downloadBlob(), handleDownload(), handleGenerate()

### Community 60 - "Module Group 60"
Cohesion: 0.47
Nodes (3): getISTDateString(), isFutureDate(), isToday()

### Community 63 - "Module Group 63"
Cohesion: 0.8
Nodes (3): buildGeocodeReportLine(), getGeocodeStatusMarker(), normalizeGeocodeStatus()

### Community 64 - "Module Group 64"
Cohesion: 0.83
Nodes (3): initializeApp(), main(), migrateCollection()

### Community 66 - "Module Group 66"
Cohesion: 0.83
Nodes (3): checkRateLimit(), getClientIp(), POST()

### Community 67 - "Module Group 67"
Cohesion: 0.83
Nodes (3): getAdminProjectId(), initializeAdmin(), initializeCustomTokenSigner()

## Knowledge Gaps
- **16 isolated node(s):** `Admin Role`, `Super Admin Role`, `Client Role`, `Firebase Backend`, `Payroll Module` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `unauthorizedResponse()` connect `API Route Handlers` to `Work Order Key Functions`, `Module Group 32`, `TCS Work Order Import`, `Admin Navigation`, `Region Control Plane`, `Module Group 37`, `Field Officer Profiles`, `Date & Validation Utils`, `Employee Management`, `Module Group 55`, `FCM & Notifications`, `Offline Attendance`?**
  _High betweenness centrality (0.134) - this node is a cross-community bridge._
- **Why does `districtMatches()` connect `Field Officer Profiles` to `Work Order Key Functions`, `Module Group 32`, `TCS Work Order Import`, `Module Group 33`, `Attendance Capture Flow`, `Module Group 37`, `Date & Validation Utils`, `Site Management UI`, `Payroll Run & Cycles`, `Evaluations Engine`, `Module Group 62`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Why does `requireAdmin()` connect `API Route Handlers` to `Work Order Key Functions`, `TCS Work Order Import`, `Admin Navigation`, `Region Control Plane`, `Module Group 39`, `Field Officer Profiles`, `Employee Management`, `Payroll Engine`, `FCM & Notifications`, `Offline Attendance`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Are the 65 inferred relationships involving `unauthorizedResponse()` (e.g. with `GET()` and `POST()`) actually correct?**
  _`unauthorizedResponse()` has 65 INFERRED edges - model-reasoned connections that need verification._
- **Are the 116 inferred relationships involving `toast()` (e.g. with `handleContinue()` and `fetchSites()`) actually correct?**
  _`toast()` has 116 INFERRED edges - model-reasoned connections that need verification._
- **Are the 40 inferred relationships involving `requireAdmin()` (e.g. with `GET()` and `POST()`) actually correct?**
  _`requireAdmin()` has 40 INFERRED edges - model-reasoned connections that need verification._
- **Are the 48 inferred relationships involving `authorizedFetch()` (e.g. with `handleCreate()` and `handleSaveClient()`) actually correct?**
  _`authorizedFetch()` has 48 INFERRED edges - model-reasoned connections that need verification._