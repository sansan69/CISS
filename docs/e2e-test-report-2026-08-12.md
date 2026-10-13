# CISS Workforce — End-to-End Playwright Test Report

**Date:** 2026-08-12
**Tester:** Playwright (Chromium headless, 1440×900), scripted sweep
**Targets:** Local dev server (`http://localhost:3000`, HEAD of repo) + live production (`https://cisskerala.site`) for confirmation
**Artifacts:** `output/playwright/e2e-2026-08-12/` — `sweep-results.json`, `guard-results.json`, ~90 screenshots

## Coverage

| Surface | Routes visited | Result |
|---|---|---|
| Public / unauthenticated (landing, logins, enrollment, attendance, download, public profile) | 12 | 10 OK, **1 crash**, 1 note |
| Authed admin+superAdmin sections (dashboard, employees, work orders, attendance, field officers, reports, training, evaluations, leaderboard, payroll, wizard, notifications) | 26 | 25 OK, **1 crash** |
| Settings + sub-pages (clients, sites, wage config, qr, exports, imports, admin tools, state mgmt, enrollment form) | 17 | 15 OK, 2 redirect-shim notes |
| Guard portal (PIN setup → login → all 6 sections) | 6 (+2 flows) | All OK (live) |
| Sidebar nav link sweep (all unique links) | ~60 | **1 dead link** |

Interactions exercised (read-only): search/filter inputs, tab switches, accordion/row expansion, detail navigation, admin login, guard PIN setup + login. No business-data writes were performed.

## Findings

### P0-1 — Public employee profile crashes for every employee (`/profile/[id]`)

- **Error (error boundary):** `TypeError: Cannot read properties of undefined (reading 'replace')`
- **Where:** `src/app/profile/[id]/page.tsx:691` — `<DetailItem label="Full Address" value={employee.fullAddress.replace(/\n/g, ", ")} />` renders unconditionally.
- **Why:** the page's data source `/api/employees/public-profile/[id]` deliberately returns only `id, fullName, employeeId, clientName, profilePictureUrl, status, qrCodeUrl, joiningDate` (privacy filter). `fullAddress` is **never** present, so `.replace` throws on every employee, every time.
- **Reproduced:** local dev AND live `https://cisskerala.site/profile/00HtpfKLFCPmIS6Xi9OK` → "Something went wrong / Cannot read properties of undefined (reading 'replace')".
- **Impact:** every public profile link (guard QR cards, share links) renders an error page.
- **Fix direction:** guard the render (`employee.fullAddress?.replace(...)` / render N/A when absent) — the API intentionally omits the field, so the page must tolerate its absence.

### P0-2 — Employees roster crashes for superAdmin (`/employees`)

- **Error (error boundary):** `RangeError: Invalid time value` (thrown by `date-fns/format`)
- **Where:** `src/app/(app)/employees/page.tsx` (~line 670/755) — `const d = emp.createdAt?.toDate ? emp.createdAt.toDate() : new Date(emp.createdAt);` then `format(d, 'dd MMM yyyy')`.
- **Why (superAdmin only):** the superAdmin data path fetches `/api/super-admin/employees` (`src/app/(app)/employees/page.tsx:290-306`). That route (`src/app/api/super-admin/employees/route.ts:105-114`) spreads raw Firestore docs into JSON; Firestore `Timestamp` serializes as `{_seconds, _nanoseconds}`, which has no `.toDate`, and `new Date({_seconds, ...})` is an Invalid Date → `format()` throws. Other roles query Firestore directly and receive real `Timestamp` objects, so they are unaffected.
- **Reproduced:** local dev AND live (logged in as superAdmin) → "Something went wrong / Invalid time value".
- **Impact:** the superAdmin cannot view the employee roster at all — the platform's primary operational view.
- **Fix direction:** either serialize dates to ISO strings in the API route, or make the page tolerant (`createdAt.toDate?.()` / `Timestamp`-shape handling). Note the API leaks raw `{_seconds,_nanoseconds}` objects to the client generally — normalizing there fixes the page and the contract.

### P1-1 — Dead nav link: Leave (`/leave`)

- `src/app/(app)/navigation.ts:84` lists **Leave** (`/leave`, adminOnly) in the Payroll group, but no `src/app/(app)/leave/page.tsx` exists (only the API `src/app/api/guard/leave/route.ts` remains). The same holds for the guard portal's Leave page (`(guard)/guard/leave`).
- **Reproduced:** `/leave` → 404 locally and on live; sidebar sweep reported `{"link":"/leave","status":404}`.
- **Impact:** admins clicking "Leave" in the sidebar hit a 404 page.
- **Fix direction:** re-add the leave-management page or remove the nav item.

## Observations (non-blocking)

1. **Empty route dirs → 404:** `src/app/map-live-test/` and `src/app/dashboard-design-preview/` contain no `page.tsx`; both 404. Likely leftovers from moved/deleted dev helpers — delete the dirs.
2. **Redirect shims (by design):** `/settings/work-order-imports` → `/work-orders/imports`; `/settings/assigned-guards-export` → `/work-orders?tab=assigned-guards-export`; `/settings/wage-config` renders in place when logged in (sweep-time "offline" on these routes was a dev-server compile-burst artifact, confirmed by clean retests).
3. **Next.js image warnings (dev):** `/ciss-logo.png` flagged for missing `priority` (LCP) and for width/height set via CSS without the matching `auto` style — minor perf/polish items on the login/landing pages.
4. **Guard dashboard stats for fresh guard:** shows 26 Absent / 26 working days with no assigned shift — expected for a record with no shift/attendance, but reads oddly; worth a UX look.
5. **Transient dev-only:** service-worker `offline.html` fallback appears if `next dev` drops a request during heavy on-demand compilation; not reproducible on live.

## What passed clean

- **Login flows:** admin email/password login (local + live) → `/dashboard`; guard PIN setup (`/guard-login/setup`) and PIN login (`/guard-login`, phone tab) end-to-end on live.
- **All remaining public pages:** landing, admin/guard login screens, PIN setup/reset/forgot-PIN pages, enrollment form (5-step wizard renders), app download, attendance recording entry, record-attendance.
- **All remaining authed sections** rendered with data and no console/page errors: dashboard, employees/enroll, employee detail, attendance logs, work orders + site detail + imports, field officers, visit/training/patrol reports, training modules/assignments/banks, evaluations, leaderboard, payroll runs/run-wizard/cycle detail, wizard, admin notifications, settings hub, clients + client detail + geocode, site management, state management, wage config, QR management, data export, bulk import, settings reports, admin tools, client locations, client management, enrollment form config.
- **Guard portal (live):** dashboard (stats render), attendance (month calendar), training, profile, payslips, evaluations — all 200, zero console/page errors.

## Environment notes

- **Local guard-login limitation:** `/api/guard/auth/login` mints a custom token via the Admin SDK, which needs a service-account private key (`signBlob`). The local service-account key in `.env.local` is **revoked** (`invalid_grant`), and gcloud user-ADC cannot sign tokens — so the guard login 500s locally (`Failed to determine service account … getaddrinfo ENOTFOUND metadata`). Guard flows were therefore exercised against live, where the production key is present. Consider rotating the local service-account key.
- **Test data:** one disposable superAdmin auth account and one disposable guard employee (`CISS/TEST/2026-27/*`) were created for the sweep and **both fully deleted** afterward. No business data was modified.

## Suggested fix order

1. Profile page crash (P0, one-line guard) — blocks every public profile link.
2. superAdmin employees crash (P0) — serialize `Timestamp` → ISO in `/api/super-admin/employees`.
3. Leave nav item (P1) — restore page or drop the link.
