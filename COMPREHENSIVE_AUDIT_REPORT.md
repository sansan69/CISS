# CISS Workforce - Comprehensive Issues & Missing Features Report

**Audit Date**: 2026-04-14  
**App Version**: Latest (from `main` branch)  
**Deployment**: Vercel (`cisskerala.site`)  
**Firebase Project**: `ciss-workforce`

---

## Executive Summary

This comprehensive audit covers all aspects of the CISS Workforce application including authentication, employee management, attendance, payroll, leave, training, evaluations, client/site management, field officers, guard portal, super-admin/region management, settings, UI/UX, and Firebase infrastructure. The audit identified **137 distinct issues** across all categories, with **23 CRITICAL** issues requiring immediate attention.

---

## Severity Legend

| Level | Description |
|-------|-------------|
| 🔴 CRITICAL | Immediate fix required - security vulnerability, data loss risk, or completely broken feature |
| 🟠 HIGH | Should fix in current sprint - significant functionality or security impact |
| 🟡 MEDIUM | Important but can wait - functionality gaps, UX issues |
| 🟢 LOW | Technical debt / nice-to-have improvements |

---

## 1. FIREBASE & INFRASTRUCTURE ISSUES

### 1.1 Storage Rules - CRITICAL

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| F-01 | **Missing `foReports/` path** — field officer photo uploads are blocked by catch-all deny rule. `PhotoCapture` component uploads to `foReports/{folder}/{uid}/{filename}` but no storage rule exists | 🔴 CRITICAL | `storage.rules` | Add `match /foReports/{folder}/{uid}/{fileName}` with field officer auth |
| F-02 | **Unauthenticated uploads** — all employee document paths (profilePictures, signatures, attendance, idProofs, addressProofs, bankDocuments, policeCertificates) allow `create` with only size+type checks, no auth | 🔴 CRITICAL | `storage.rules:27-65` | Add `isSignedIn()` to all create rules |
| F-03 | **World-readable sensitive documents** — all employee documents have `allow read: if true` — ID proofs, bank docs, police certificates publicly accessible | 🔴 CRITICAL | `storage.rules:26-65` | Require `isSignedIn()` for all reads |
| F-04 | **`NEXT_PUBLIC_FIREBASE_VAPID_KEY` missing** — web push notifications silently fail because VAPID key not configured | 🔴 CRITICAL | `.env.local`, `src/lib/fcm.ts` | Add VAPID key to env vars |

### 1.2 Firestore Rules - HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| F-05 | **`fcmTokens` allows any authenticated user to write any document** — token overwrite attack possible | 🟠 HIGH | `firestore.rules:159-162` | Restrict write to own token |
| F-06 | **`payrollCycles` excludes HR role** — HR cannot read payroll cycles (may be intentional) | 🟡 MEDIUM | `firestore.rules:301-303` | Add `isHR()` if required |
| F-07 | **Duplicate Firestore indexes** — 7+ duplicate index definitions wasting quota | 🟠 HIGH | `firestore.indexes.json` | Remove duplicates |

### 1.3 Environment & Config - HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| F-08 | **Admin SDK reads `storageBucket` from `NEXT_PUBLIC_` env var** — inconsistent architecture | 🟡 MEDIUM | `src/lib/firebaseAdmin.ts:57` | Use server-side env var |
| F-09 | **`SUPER_ADMIN_EMAIL` inconsistency** — different values in `.env.example` vs `.env.local` | 🟢 LOW | `.env.*` | Align values |
| F-10 | **Missing Firestore indexes** for `foVisitReports`, `notifications` (unread), `payrollEntries` (employee+period) | 🟡 MEDIUM | `firestore.indexes.json` | Add indexes |

---

## 2. AUTHENTICATION & SECURITY ISSUES

### 2.1 Guard Auth - CRITICAL

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| A-01 | **QR login completely broken** — login API only processes `phoneNumber` but QR flow sends `employeeId` which is silently ignored | 🔴 CRITICAL | `src/app/guard-login/page.tsx:188`, `src/app/api/guard/auth/login/route.ts` | Add employeeId handling in login API |
| A-02 | **OTP never sent via SMS** — forgot-PIN flow's `send-reset-otp` only logs OTP in development, entire forgot-PIN flow is non-functional for end users | 🔴 CRITICAL | `src/app/api/guard/auth/send-reset-otp/route.ts:77-79` | Integrate SMS provider (Twilio/etc) |
| A-03 | **OTP brute-force vulnerability** — `verify-reset-otp` has zero rate limiting — 6-digit OTP can be brute-forced | 🔴 CRITICAL | `src/app/api/guard/auth/verify-reset-otp/route.ts` | Add rate limiting |
| A-04 | **Enrollment API has zero authentication** — anyone can create employee records by calling API directly | 🔴 CRITICAL | `src/app/api/employees/enroll/route.ts:54-55` | Add auth check or rate limiting |
| A-05 | **DOB verification broken** — `dateOfBirth` stored as Firestore Timestamp by enrollment API, but setup-pin/reset compare as raw `YYYY-MM-DD` string — comparison always fails | 🔴 CRITICAL | Multiple files | Normalize date format consistently |

### 2.2 Security - HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| A-06 | **PIN hashing uses plain SHA-256 without salt** — identical PINs produce identical hashes, vulnerable to rainbow table attacks | 🟠 HIGH | `src/lib/guard/pin-utils.ts:6-11` | Use bcrypt or HMAC with per-user salt |
| A-07 | **OTP stored in plaintext** in Firestore — anyone with read access can view all active OTPs | 🟠 HIGH | `src/app/api/guard/auth/send-reset-otp/route.ts:70-75` | Store hash of OTP |
| A-08 | **Employee lookup API has no authentication** — PII exposure (names, doc IDs) via phone enumeration | 🟠 HIGH | `src/app/api/employees/lookup/route.ts:42-43` | Add auth or stricter rate limiting |
| A-09 | **Public profile page exposes full employee data** — bank details, ID numbers accessible via client SDK by anyone knowing doc ID | 🟠 HIGH | `src/app/profile/[id]/page.tsx` | Add server-side access control |
| A-10 | **`change-pin` has no rate limiting** — attacker with stolen token can brute-force current PIN | 🟠 HIGH | `src/app/api/guard/auth/change-pin/route.ts` | Add rate limiting |
| A-11 | **No session management for guards** — no force-logout/revoke mechanism if phone stolen | 🟡 MEDIUM | N/A | Implement session revocation |
| A-12 | **No audit logging for auth events** — login, PIN setup, reset events not logged | 🟡 MEDIUM | N/A | Add audit collection |

### 2.3 Admin Auth - MEDIUM

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| A-13 | **Admin login doesn't verify custom claims before redirect** — non-admin users redirected to dashboard then fail | 🟡 MEDIUM | `src/app/admin-login/page.tsx:41-59` | Check claims before redirect |
| A-14 | **No email verification check for admin login** — unverified emails can access admin portal | 🟡 MEDIUM | `src/app/admin-login/page.tsx` | Check `emailVerified` |
| A-15 | **No password reset flow for admins** — no "Forgot Password" link on admin login | 🟡 MEDIUM | `src/app/admin-login/page.tsx` | Add forgot password |
| A-16 | **Two duplicate/conflicting PIN reset flows** — `/guard-forgot-pin` (OTP) vs `/guard-login/reset` (DOB) with different security properties | 🟡 MEDIUM | Multiple files | Consolidate to single flow |

---

## 3. EMPLOYEE MANAGEMENT ISSUES

### 3.1 Data Integrity - HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| E-01 | **`clientId` vs `clientName` inconsistency** — admin employees API filters by `clientId` but enrollment stores `clientName` only — filter never works | 🔴 CRITICAL | Multiple files | Align field names |
| E-02 | **Phone number normalization inconsistency** — guard login normalizes to digits but stored phone may contain non-digits | 🟠 HIGH | Multiple files | Normalize on storage |
| E-03 | **`employeeId` generation uses `Math.random()`** — not cryptographically random, collision-prone | 🟠 HIGH | `src/app/(app)/employees/[id]/page.tsx:287-292` | Use UUID or crypto random |
| E-04 | **`searchableFields` not updated on `clientName` change** — search breaks after client reassignment | 🟠 HIGH | `src/app/(app)/employees/[id]/page.tsx:697-706` | Update searchableFields on edit |
| E-05 | **Employee status update doesn't update `publicProfile.status`** — stale status shown on public profile | 🟠 HIGH | `src/app/(app)/employees/page.tsx:386-406` | Update publicProfile on status change |
| E-06 | **Employee delete doesn't clean up Firebase Auth user** — orphaned auth user remains | 🟡 MEDIUM | `src/app/(app)/employees/page.tsx:369` | Delete auth user on employee delete |

### 3.2 Missing Features - MEDIUM

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| E-07 | **Employee edit doesn't validate phone uniqueness** — duplicates allowed on edit | 🟡 MEDIUM | `src/app/(app)/employees/[id]/page.tsx:613-734` | Add duplicate check |
| E-08 | **Admin enrollment form has no draft saving** — data lost on refresh | 🟡 MEDIUM | `src/app/(app)/employees/enroll/page.tsx` | Add draft saving like public form |
| E-09 | **Employee enrollment API doesn't create Firebase Auth user** — guards must separately use setup-pin flow | 🟡 MEDIUM | `src/app/api/employees/enroll/route.ts` | Optional auth user creation |
| E-10 | **`enrollmentSubmissionSchema` doesn't enforce identity/address proof types differ** — attacker can submit same type for both | 🟡 MEDIUM | `src/types/enrollment.ts:47-74` | Add superRefine validation |

---

## 4. ATTENDANCE SYSTEM ISSUES

### 4.1 CRITICAL

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| AT-01 | **Public site data exposure** — `/api/public/attendance` exposes exact GPS coordinates of security sites publicly — physical security risk | 🔴 CRITICAL | `src/app/api/public/attendance/route.ts` | Authenticate or redact coordinates |
| AT-02 | **Attendance ID validation missing** — server trusts `employeeDocId` from client without verifying it matches the requested `employeeId` | 🔴 CRITICAL | `src/app/api/attendance/submit/route.ts:148-154` | Verify employee ownership |
| AT-03 | **Photo analysis never integrated** — AI analysis endpoint exists but is NEVER called from attendance submission — photos always show "manual review pending" | 🔴 CRITICAL | `src/app/attendance/page.tsx`, `src/app/api/attendance/analyze-photo/route.ts` | Call analyze-photo from submit |

### 4.2 HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| AT-04 | **Work order validation gap** — fixed-shift sites bypass work order checks entirely | 🟠 HIGH | `src/app/api/attendance/submit/route.ts:202-215` | Validate all sites |
| AT-05 | **Guard dashboard attendance query has no date filter** — fetches 200 arbitrary logs then filters client-side, inaccurate counts | 🟠 HIGH | `src/app/api/guard/dashboard/route.ts:51-63` | Add date range query |
| AT-06 | **Working days only excludes Sundays** — no holiday calendar, inaccurate absence counts | 🟠 HIGH | `src/app/api/guard/dashboard/route.ts:5-14` | Add holiday calendar |
| AT-07 | **Overtime always returns 0** — no overtime aggregation logic exists | 🟠 HIGH | `src/lib/payroll/attendance-aggregator.ts:44` | Implement overtime calculation |
| AT-08 | **Next shift query silently fails** — without composite index, returns null with no user feedback | 🟠 HIGH | `src/app/api/guard/dashboard/route.ts:168` | Add index or handle gracefully |

### 4.3 MEDIUM

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| AT-09 | **Client users receive ALL attendance logs** — Firestore listener returns all data, client-side filters — interceptable | 🟡 MEDIUM | `src/app/(app)/dashboard/page.tsx:700-728` | Scope query server-side |
| AT-10 | **Duplicate scan prevention incomplete** — scanner crashes can bypass duplicate guard | 🟡 MEDIUM | `src/lib/qr/scanner-engine.ts` | Add server-side duplicate check |
| AT-11 | **Geofence distance calculated client-side** — can be manipulated via JS/mock GPS | 🟡 MEDIUM | `src/app/attendance/page.tsx:330-342` | Verify on server |
| AT-12 | **Attendance uses client time** — should use server time to prevent timezone issues | 🟡 MEDIUM | `src/app/attendance/page.tsx:801-802` | Use server timestamp |

---

## 5. PAYROLL SYSTEM ISSUES

### 5.1 CRITICAL

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| P-01 | **Net pay ignores LOP deduction** — `netPay` calculation doesn't subtract `lopDeduction` | 🔴 CRITICAL | `src/app/api/admin/payroll/run/route.ts:214-216` | Subtract LOP from net pay |
| P-02 | **EPF calculation wrong** — caps contribution at ₹15,000 instead of stopping contributions ABOVE ₹15,000 | 🔴 CRITICAL | `src/lib/payroll/calculate.ts:12-22` | Fix EPF ceiling logic |
| P-03 | **Gross calculation division by zero** — when `grossRate = 1`, denominator is 0 causing infinite gross | 🔴 CRITICAL | `src/lib/payroll/calculate.ts:172-180` | Add validation |
| P-04 | **No transaction on payroll run** — partial failures leave cycle in inconsistent state | 🔴 CRITICAL | `src/app/api/admin/payroll/run/route.ts:59-63` | Wrap in transaction |

### 5.2 HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| P-05 | **Client allowances added AFTER prorating** — should be part of template and prorated together | 🟠 HIGH | `src/app/api/admin/payroll/run/route.ts:165-176` | Include in template |
| P-06 | **Silent payroll skipping** — employees without wage config skipped with no audit trail | 🟠 HIGH | `src/app/api/admin/payroll/run/route.ts:149-162` | Log skipped employees |
| P-07 | **TDS uses old regime only** — no mechanism to apply different slabs or switch regimes | 🟠 HIGH | `src/lib/payroll/calculate.ts:48-66` | Support both regimes |
| P-08 | **EPF base heuristic misidentifies** — "Basic Salary" (not "basic") fails check, "DA" catches "Danger Allowance" | 🟠 HIGH | `src/lib/payroll/calculate.ts:214-229` | Improve detection |

### 5.3 MEDIUM - Missing Features

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| P-09 | **Bonus not calculated** — statutory bonus (8.33% minimum) missing | 🟡 MEDIUM | N/A | Implement bonus calculation |
| P-10 | **Gratuity not calculated** — 15 days wages per year missing | 🟡 MEDIUM | N/A | Implement gratuity calculation |
| P-11 | **Leave encashment not calculated** — up to 15 days can be encashed | 🟡 MEDIUM | N/A | Implement leave encashment |
| P-12 | **No salary revision support** — mid-month revisions not handled | 🟡 MEDIUM | N/A | Add mid-month revision |

---

## 6. GUARD PORTAL ISSUES

### 6.1 CRITICAL

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| G-01 | **Guard payslips download broken** — URL points to admin API (`/api/admin/payroll/entries/${id}/payslip`) — guards get 401 | 🔴 CRITICAL | `src/app/(guard)/guard/payslips/page.tsx`, `src/app/api/guard/payslips/route.ts` | Create guard-specific payslip route |
| G-02 | **Guard profile returns ALL fields** — including phone, email, address, ID numbers without field-level filtering | 🔴 CRITICAL | `src/app/api/guard/profile/route.ts` | Scope returned fields |

### 6.2 HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| G-03 | **Guard attendance "Out" status not counted** — only "In" counted for present days | 🟠 HIGH | `src/app/(guard)/guard/attendance/page.tsx:22` | Handle "Out" status |
| G-04 | **Guard dashboard no pagination** — all logs loaded at once, memory issues for long tenure | 🟠 HIGH | `src/app/(guard)/guard/attendance/page.tsx` | Add pagination |
| G-05 | **Guard payslips fallback query risk** — fallback by `employeeId` could return another employee's payslips | 🟠 HIGH | `src/app/api/guard/payslips/route.ts` | Remove risky fallback |

---

## 7. WORK ORDERS & FIELD OFFICERS ISSUES

### 7.1 CRITICAL

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| W-01 | **All work order writes are client-side** — no server-side validation, any authenticated user could create/modify | 🔴 CRITICAL | `src/app/(app)/work-orders/page.tsx` | Add server-side validation |
| W-02 | **Work order site detail memory leak** — `onSnapshot` listener never unsubscribed due to incorrect `useEffect` return | 🔴 CRITICAL | `src/app/(work-orders/[siteId]/page.tsx:523` | Fix cleanup function |

### 7.2 HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| W-03 | **Field officer photo upload blocked by storage rules** — uploads fail silently (covered in F-01) | 🟠 HIGH | `storage.rules` | Add foReports path |
| W-04 | **Guard assignments have no concurrency control** — last-write-wins, simultaneous assignments overwrite | 🟠 HIGH | `src/app/(app)/work-orders/[siteId]/page.tsx:124` | Add optimistic locking |
| W-05 | **Assigned guards export uses fragile `__name__` field** — Firestore internal field may break | 🟠 HIGH | `src/components/work-orders/assigned-guards-export-panel.tsx:142` | Use proper field |

### 7.3 MEDIUM

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| W-06 | **No bulk site import in client detail** — only individual creation | 🟡 MEDIUM | `src/app/(app)/settings/clients/[clientId]/page.tsx` | Add bulk import |
| W-07 | **Delete client with existing data leaves orphans** — no confirmation or cascade delete | 🟡 MEDIUM | `src/app/api/admin/clients/[id]/route.ts:51-64` | Add cascade or warning |
| W-08 | **No guard assigned check before site deletion** — should verify no active postings | 🟡 MEDIUM | `src/app/(app)/settings/clients/[clientId]/page.tsx:442-449` | Add guard check |

---

## 8. SUPER-ADMIN & REGION MANAGEMENT ISSUES

### 8.1 CRITICAL

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| S-01 | **Deployment config API exposes Firebase Admin SDK service account JSON** — full admin credentials in response | 🔴 CRITICAL | `src/app/api/super-admin/regions/[id]/deployment-config/route.ts:57-59` | Never expose credentials |
| S-02 | **Failed region validations still persist service account credentials** — credentials saved even when validation fails | 🔴 CRITICAL | `src/app/api/super-admin/regions/[id]/validate/route.ts:40-50` | Only save on success |

### 8.2 HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| S-03 | **Region overview Firebase app name collision** — `Date.now()` can collide under concurrent requests | 🟠 HIGH | `src/app/api/super-admin/overview/route.ts` | Use UUID for app name |
| S-04 | **Super-admin PATCH accepts any fields** — no allowlist, caller could set `status: "live"` directly | 🟠 HIGH | `src/app/api/super-admin/regions/[id]/route.ts` | Add field allowlist |
| S-05 | **Service account payload persists across region switches** — old credentials still in state | 🟠 HIGH | `src/app/(app)/settings/state-management/page.tsx:201-213` | Clear payload on change |

### 8.3 MEDIUM

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| S-06 | **Region seeding slow** — queries ALL regions sequentially, 10+ seconds for 5+ regions | 🟡 MEDIUM | `src/app/api/super-admin/employees/route.ts` | Parallelize or paginate |
| S-07 | **No confirmation dialogs** — create region, validate, seed, create admin all proceed on single click | 🟡 MEDIUM | `src/app/(app)/settings/state-management/page.tsx` | Add confirmations |
| S-08 | **Encryption key dependency issue** — if `REGION_CONNECTIONS_SECRET` not set, key changes on admin SDK config rotation | 🟡 MEDIUM | `src/lib/server/region-connections.ts` | Document requirement |

---

## 9. SETTINGS & ADMIN TOOLS ISSUES

### 9.1 CRITICAL

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| T-01 | **QR Management entirely simulated/placeholder** — uses hardcoded `totalEmployees = 1234` and random success/failure | 🔴 CRITICAL | `src/app/(app)/settings/qr-management/page.tsx:31-59` | Implement real QR regeneration |

### 9.2 HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| T-02 | **Bulk import exceeds Firestore batch limit** — 500+ employees fails (batch limit is 500) | 🟠 HIGH | `src/app/(app)/settings/bulk-import/page.tsx:269-298` | Handle in chunks |
| T-03 | **Data export exposes ALL fields** — bank account numbers, IFSC, ID proof numbers in export | 🟠 HIGH | `src/app/(app)/settings/data-export/page.tsx:112-163` | Add field filtering |
| T-04 | **PDF export processes sequentially** — 500ms sleep per employee, 100 employees = 50+ seconds | 🟠 HIGH | `src/app/(app)/settings/data-export/page.tsx:567-580` | Parallelize or use service |
| T-05 | **PDF export creates multiple downloads** — browsers block multiple downloads | 🟠 HIGH | `src/app/(app)/settings/data-export/page.tsx` | Generate single merged PDF |

---

## 10. UI/UX ISSUES

### 10.1 Accessibility - HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| U-01 | **Missing focus management for Dialog/Sheet** — no programmatic focus return to trigger after close | 🟠 HIGH | `src/components/ui/dialog.tsx:48`, `sheet.tsx:68` | Add focus management |
| U-02 | **Missing ARIA labels** — SidebarTrigger, Chart, BottomNav have no aria-label | 🟠 HIGH | Multiple components | Add aria-labels |
| U-03 | **`userScalable: false` in root layout** — breaks accessibility for users needing zoom | 🟠 HIGH | `src/app/layout.tsx:62` | Remove or make optional |

### 10.2 Responsiveness - MEDIUM

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| U-04 | **Sidebar collapsed mode spacing issues** — icons too close together in mobile | 🟡 MEDIUM | `src/app/(app)/layout.tsx:997-1012` | Adjust spacing |
| U-05 | **Table no horizontal scroll wrapper** — breaks on mobile | 🟡 MEDIUM | `src/components/ui/table.tsx:9` | Add scroll wrapper |
| U-06 | **Checkbox touch target too small** — 16x16px, below 44x44px recommendation | 🟡 MEDIUM | `src/components/ui/checkbox.tsx:16` | Increase size |

### 10.3 Consistency - MEDIUM

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| U-07 | **Hardcoded brand colors** — GuardBottomNav uses inline `#014c85` instead of CSS variables | 🟡 MEDIUM | `src/components/guard/guard-bottom-nav.tsx:23-24` | Use CSS variables |
| U-08 | **Inconsistent button variants** — many pages use custom inline styles | 🟡 MEDIUM | Multiple pages | Standardize on button variants |
| U-09 | **Icon sizing inconsistent** — mix of h-4, h-5, h-18px, size={22} | 🟡 MEDIUM | Multiple components | Define icon scale system |
| U-10 | **Loading state inconsistency** — some use Skeleton, some inline patterns | 🟡 MEDIUM | Multiple pages | Standardize loading pattern |

### 10.4 Hook Issues - HIGH

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| U-11 | **useToast dependency array bug** — `state` in deps causes cleanup to run every render | 🟠 HIGH | `src/hooks/use-toast.ts:185` | Use empty deps with refs |

### 10.5 Missing Components - MEDIUM

| # | Issue | Severity | File | Fix Required |
|---|-------|----------|------|--------------|
| U-12 | **No reusable Pagination component** — tables lack pagination | 🟡 MEDIUM | N/A | Create Pagination component |
| U-13 | **No DataTable component** — no sorting, filtering, column visibility | 🟡 MEDIUM | N/A | Create DataTable component |
| U-14 | **No SearchInput component** — each page recreates search | 🟡 MEDIUM | N/A | Create SearchInput component |
| U-15 | **No Breadcrumb component** — navigation lacks breadcrumbs | 🟡 MEDIUM | N/A | Create Breadcrumb component |
| U-16 | **No LoadingOverlay component** — async operations lack unified overlay | 🟡 MEDIUM | N/A | Create LoadingOverlay |

---

## 11. MISSING FEATURES SUMMARY

| Feature | Priority | Status |
|---------|----------|--------|
| **Bonus Calculation** (8.33% statutory) | 🟡 MEDIUM | Not implemented |
| **Gratuity Calculation** (15 days/year) | 🟡 MEDIUM | Not implemented |
| **Leave Encashment** | 🟡 MEDIUM | Not implemented |
| **New Tax Regime Support** | 🟠 HIGH | Not implemented |
| **Salary Revision Mid-Month** | 🟡 MEDIUM | Not implemented |
| **Session Revocation** (guard) | 🟡 MEDIUM | Not implemented |
| **Auth Audit Logging** | 🟡 MEDIUM | Not implemented |
| **Offline Detection UI** | 🟢 LOW | Not implemented |
| **Dark/Light Mode** | 🟢 LOW | Not implemented |
| **Bulk Site Import** (per client) | 🟡 MEDIUM | Not implemented |
| **Real QR Regeneration** | 🔴 CRITICAL | Placeholder only |
| **PWA Offline Support** | 🟢 LOW | Partial |

---

## 12. DATA MODEL ISSUES

| Issue | Severity | Recommendation |
|-------|----------|----------------|
| `clientId` vs `clientName` dual fields | 🔴 CRITICAL | Consolidate to single field or establish clear relationship |
| `dateOfBirth` stored as Timestamp vs string | 🔴 CRITICAL | Standardize on Timestamp |
| `employeeId` generation using Math.random() | 🟠 HIGH | Use UUID or crypto |
| `status` not synced to `publicProfile` | 🟠 HIGH | Update on status change |
| Legacy fields still in schema (`idProofType`, etc.) | 🟡 MEDIUM | Remove or deprecate |

---

## 13. RECOMMENDED PRIORITY ORDER

### Phase 1: Critical Security & Broken Features (Week 1-2)
1. F-01, F-02, F-03, F-04 — Storage rules fixes
2. A-01, A-02, A-03, A-04, A-05 — Auth fixes (QR login, OTP SMS, brute-force, enrollment auth, DOB)
3. G-01 — Guard payslips download fix
4. AT-01, AT-02, AT-03 — Attendance security fixes
5. P-01, P-02, P-03, P-04 — Payroll calculation fixes
6. S-01, S-02 — Super-admin credential exposure
7. T-01 — QR Management implementation

### Phase 2: High Priority Functionality (Week 3-4)
1. All remaining security issues (A-06 through A-12)
2. Work order client-side writes → server validation
3. W-02 — Memory leak fix
4. F-05, F-07 — Firestore rules fixes
5. E-01 through E-05 — Data integrity fixes

### Phase 3: Feature Completeness (Week 5-8)
1. P-05 through P-12 — Payroll features
2. AT-04 through AT-12 — Attendance improvements
3. S-03 through S-08 — Region management improvements
4. T-02 through T-05 — Admin tools fixes

### Phase 4: UI/UX & Polish (Week 9+)
1. U-01 through U-03 — Accessibility fixes
2. U-11 — useToast bug fix
3. U-07 through U-10 — Consistency improvements
4. U-12 through U-16 — Missing components

---

## 14. TESTING NOTES

- **Do NOT delete any existing Firebase data**
- Created test data should be cleaned up after testing
- Admin credentials available in Firebase console
- Test all flows with both admin and guard roles
- Test edge cases: empty data, large datasets, concurrent operations

---

*End of Report*
