# Graph Report - src/lib  (2026-04-29)

## Corpus Check
- 73 files · ~21,539 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 359 nodes · 501 edges · 38 communities detected
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]

## God Nodes (most connected - your core abstractions)
1. `normalizeText()` - 10 edges
2. `parseLegacySheet()` - 10 edges
3. `parsePivotSheet()` - 10 edges
4. `startHybridQrScanner()` - 10 edges
5. `round2()` - 10 edges
6. `buildTcsExamDiff()` - 8 edges
7. `extractExamName()` - 8 edges
8. `normalizeSegment()` - 7 edges
9. `normalizeHeader()` - 7 edges
10. `openAttendanceDb()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `buildPublicAttendanceSiteOption()` --calls--> `resolveSiteDutyPoints()`  [INFERRED]
  attendance/public-attendance.ts → shift-utils.ts
- `hasAdminAccess()` --calls--> `isLegacyAdminEmail()`  [INFERRED]
  server/auth.ts → auth/admin.ts
- `startHybridQrScanner()` --calls--> `shouldUseNativeBarcodeDetector()`  [INFERRED]
  qr/scanner-engine.ts → qr/scanner-support.ts
- `resolveAppUser()` --calls--> `isLegacyAdminEmail()`  [INFERRED]
  auth/roles.ts → auth/admin.ts
- `requireGuard()` --calls--> `verifyRequestAuth()`  [INFERRED]
  server/guard-auth.ts → server/auth.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.2
Nodes (27): buildRowBase(), buildValidatedDate(), buildWarnings(), cleanExamNameFromFilename(), cleanTitleText(), countDateLikeCells(), detectParserMode(), extractCellNumber() (+19 more)

### Community 1 - "Community 1"
Cohesion: 0.16
Nodes (14): chooseCameraSelection(), createDuplicateScanGuard(), getBarcodeDetectorCtor(), openVideoStream(), setVideoSource(), shouldFallbackToZxing(), startHybridQrScanner(), startNativeScanLoop() (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (12): isLegacyAdminEmail(), claimsToRole(), refreshClaimedRole(), resolveAppUser(), hasAdminAccess(), hasFieldOfficerAccess(), requireAdmin(), requireAdminLike() (+4 more)

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (13): applySavedWageTemplate(), applyWageComponents(), calculateEPF(), calculateESIC(), calculateLOP(), calculateTDS(), computeEpfApplicableWage(), derivePayrollTemplateFromWageConfig() (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.22
Nodes (10): buildPublicAttendanceSiteOption(), parsePublicAttendanceCoordinates(), toFiniteNumber(), buildDutyPointShiftTemplates(), buildShiftTemplates(), normalizeDutyPoint(), resolveSiteDutyPoints(), resolveSiteShift() (+2 more)

### Community 5 - "Community 5"
Cohesion: 0.2
Nodes (9): buildConstants(), detectHeaderRow(), extractNumbers(), inferCategory(), inferStandardName(), isPayrollishHeader(), rowNonEmptyCount(), rowTextishScore() (+1 more)

### Community 6 - "Community 6"
Cohesion: 0.26
Nodes (10): buildError(), buildForwardQueries(), buildForwardQuery(), extractIndianPostcode(), extractPlaceAccuracy(), handleLocationGeocode(), lookupLocationGeocode(), normalizeText() (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.26
Nodes (11): buildServerAuditEvent(), buildServerCreateAudit(), buildServerUpdateAudit(), normalizeActor(), decrypt(), encrypt(), getRegionConnection(), getRegionConnectionsSecret() (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.32
Nodes (10): getRetryDelay(), hasIndexedDb(), loadAttendanceHistory(), loadQueuedAttendance(), markRetryAttempt(), openAttendanceDb(), readSingleton(), saveAttendanceHistory() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.27
Nodes (7): createRegionAdminAccount(), makeRegionRecord(), normalizeRegionCode(), parseServiceAccount(), seedRegionDefaults(), validateRegionFirebaseConnection(), withRegionAdminApp()

### Community 10 - "Community 10"
Cohesion: 0.33
Nodes (8): buildClientPortalAuthEmail(), buildClientPortalUrl(), getClientPortalContext(), getRootDomain(), normalizeClientLoginId(), normalizeClientPortalAccountToken(), normalizeHost(), slugifyPortalSubdomain()

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (5): compressImage(), getExtensionFromName(), getUploadFileExtension(), prepareFileForUpload(), replaceFileExtension()

### Community 12 - "Community 12"
Cohesion: 0.53
Nodes (9): buildDiffRow(), buildTcsExamDiff(), getFallbackKey(), getIdentityKey(), getSiteKey(), hasSiteId(), normalizeSegment(), sameCounts() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.28
Nodes (3): deriveCoordinateSource(), deriveCoordinateStatus(), hasValidCoordinates()

### Community 14 - "Community 14"
Cohesion: 0.43
Nodes (6): classifySiteGpsState(), extractSiteCoordinates(), hasUsableSiteGps(), isWithinIndiaBounds(), normalizeCoordinateStatus(), readCoordinatePart()

### Community 15 - "Community 15"
Cohesion: 0.5
Nodes (6): canonicalizeDistrictName(), districtKey(), districtMatches(), isRecognizedDistrictName(), mergeDistrictOptions(), normalizeDistrictName()

### Community 16 - "Community 16"
Cohesion: 0.43
Nodes (4): drawMultilineText(), normalizePdfText(), sanitizePdfString(), wrapTextToWidth()

### Community 17 - "Community 17"
Cohesion: 0.48
Nodes (5): formatDateOnly(), hasSeconds(), hasToDate(), isTimestampLike(), normalizeGuardDob()

### Community 18 - "Community 18"
Cohesion: 0.4
Nodes (2): buildRegionVercelProjectName(), slugifyRegionName()

### Community 19 - "Community 19"
Cohesion: 0.53
Nodes (5): buildBinaryFileHash(), buildTcsExamContentHash(), normalizeHashSegment(), serializeRow(), toBuffer()

### Community 20 - "Community 20"
Cohesion: 0.7
Nodes (4): buildFirestoreAuditEvent(), buildFirestoreCreateAudit(), buildFirestoreUpdateAudit(), resolveActor()

### Community 21 - "Community 21"
Cohesion: 0.6
Nodes (3): getFCMMessaging(), onForegroundMessage(), requestNotificationPermission()

### Community 22 - "Community 22"
Cohesion: 0.7
Nodes (4): buildTcsExamContentHashBrowser(), normalizeHashSegment(), serializeRow(), sha256Hex()

### Community 23 - "Community 23"
Cohesion: 0.8
Nodes (4): matchesClientScope(), normalizeClientMatch(), normalizeText(), resolveClientScope()

### Community 24 - "Community 24"
Cohesion: 0.6
Nodes (3): extractJson(), getOptionalHeaders(), requestOpenRouterJson()

### Community 25 - "Community 25"
Cohesion: 0.83
Nodes (3): buildGeocodeReportLine(), getGeocodeStatusMarker(), normalizeGeocodeStatus()

### Community 26 - "Community 26"
Cohesion: 0.83
Nodes (3): getAdminProjectId(), initializeAdmin(), initializeCustomTokenSigner()

### Community 27 - "Community 27"
Cohesion: 0.83
Nodes (3): abbreviateClientName(), generateEmployeeId(), getCurrentFinancialYear()

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (2): isOperationalWorkOrderClientName(), normalizeWorkOrderClientName()

### Community 29 - "Community 29"
Cohesion: 0.67
Nodes (2): getEnrollmentFileSelectionError(), isEnrollmentFileSelectionValid()

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (2): detectMockLocation(), validateLocation()

### Community 31 - "Community 31"
Cohesion: 0.67
Nodes (2): normalizeToken(), siteBelongsToClient()

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (2): hashPin(), verifyPin()

### Community 33 - "Community 33"
Cohesion: 0.83
Nodes (3): drawLabelValue(), formatAmount(), generatePayslipPdf()

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (2): authorizedFetch(), waitForCurrentUser()

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (2): normalizeQrText(), parseEmployeeIdFromQrText()

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (2): hashOtp(), verifyOtp()

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (2): aggregateApprovedLeave(), coerceDate()

## Knowledge Gaps
- **Thin community `Community 18`** (6 nodes): `buildRegionVercelProjectName()`, `buildVercelProductionUrl()`, `buildVercelProjectDashboardUrl()`, `getVercelTeamSlug()`, `slugifyRegionName()`, `vercel-region.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (4 nodes): `isOperationalWorkOrderClientName()`, `isWorkOrderAdminRole()`, `normalizeWorkOrderClientName()`, `work-orders.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (4 nodes): `enrollmentFiles.ts`, `assertEnrollmentUploadSize()`, `getEnrollmentFileSelectionError()`, `isEnrollmentFileSelectionValid()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (4 nodes): `geo.ts`, `detectMockLocation()`, `haversineDistanceMeters()`, `validateLocation()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (4 nodes): `normalizeToken()`, `siteBelongsToClient()`, `sortSitesByName()`, `site-directory.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (4 nodes): `hashPin()`, `pin-utils.ts`, `validatePinFormat()`, `verifyPin()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (3 nodes): `api-client.ts`, `authorizedFetch()`, `waitForCurrentUser()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (3 nodes): `normalizeQrText()`, `parseEmployeeIdFromQrText()`, `employee-qr.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (3 nodes): `hashOtp()`, `otp-utils.ts`, `verifyOtp()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (3 nodes): `aggregateApprovedLeave()`, `coerceDate()`, `leave-aggregator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `buildRegionAudit()` connect `Community 7` to `Community 9`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._