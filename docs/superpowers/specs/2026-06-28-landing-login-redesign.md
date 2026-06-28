# Landing & Login Redesign — Mobile-First

**Date**: 2026-06-28
**Stack**: Next.js 15 / React 18 / Tailwind v3 / ShadCN
**Theme**: Bold & Industrial (deep navy + gold)
**Fonts**: Exo 2 (display), Geist (body/inputs)

---

## 1. Architecture

All three pages (`/`, `/guard-login`, `/admin-login`) share a consistent visual shell:
- Full‑screen deep‑navy gradient background (`hsl(206 98% 10%)` → `hsl(206 98% 18%)`)
- Dark‑tinted glass card (`bg-black/10 backdrop-blur-xl` on mobile; desktop uses the same card on the right half)
- Gold accent (`#bd9c55`) on primary CTAs and small labels
- Subtle security‑grid overlay (low‑opacity diagonal pattern, no blurred blobs)

No new API routes are needed. The three existing lookups are reused:
- `/api/employees/lookup` – phone→employee (landing → guard-login or enroll)
- `/api/public/attendance/employee?employeeId=…` – QR→attendance
- Firebase `signInWithEmailAndPassword` – admin login

---

## 2. Landing Page (`/`) — Mobile Layout

```
┌──────────────────────────────────┐
│  [logo] CISS Workforce           │ ← thin header, logo always visible
├──────────────────────────────────┤
│                                  │
│  ┌──────────────────────────────┐│
│  │  GUARD ATTENDANCE            ││ ← gold label, uppercase, 0.2em tracking
│  │                              ││
│  │  Mark attendance or          ││
│  │  scan your QR card.          ││ ← subtitle, white/70
│  │                              ││
│  │ ┌────────────────────┐ ┐     ││
│  │ │ 📱 +91            │ │     ││
│  │ │  10-digit mobile   │📷│     ││ ← phone input + QR icon button
│  │ └────────────────────┘ ┘     ││
│  │                              ││
│  │ ┌──────────────────────────┐││
│  │ │  Verify Employee         │││ ← gold solid button
│  │ └──────────────────────────┘││
│  └──────────────────────────────┘│
│                                  │
│  → New guard? Enroll here        │ ← ghost link
│  → Guard Portal                  │ ← ghost link
│                                  │
│  Admin  ·  Download App          │ ← footer, white/40
│  © 2026 CISS Workforce           │
└──────────────────────────────────┘
```

### 2.1 Phone input flow (unchanged)
1. Enter 10‑digit mobile
2. Tap "Verify Employee"
3. Calls `/api/employees/lookup`
4. If found → `/guard-login`
5. If not found → `/enroll`

### 2.2 QR button (new)
1. Icon button with `<QrCode />` next to phone input
2. Opens `QrScannerDialog` — full‑screen video feed with scan overlay
3. On success: `parseEmployeeIdFromQrText(text)`
4. Calls `/api/public/attendance/employee?employeeId=…`
5. If found → `router.push(/attendance?employeeId=…)`
6. If not found → toast "Unknown QR code. Try entering your phone number."

### 2.3 Links below card
- **New guard? Enroll here** → `/enroll`
- **Guard Portal** → `/guard-login`
- Footer: **Admin** → `/admin-login`, **Download App** → `/download`

---

## 3. Guard Login (`/guard-login`) — Mobile Layout

Same dark background + glass card:
1. Logo + "Guard Portal" header (centered, mobile only; desktop shows brand panel on left)
2. Phone + PIN tab (default)
   - +91 prefix fixed, 10‑digit input
   - Next step: PIN input (4–6 digits, centered large tracking)
   - Submit → guard dashboard
3. QR Login tab (existing — guards who prefer QR + PIN)
4. "First time? Set up PIN" link at bottom
5. Home button (absolute top‑right)

---

## 4. Admin Login (`/admin-login`) — Mobile Layout

Same shell:
1. Logo + "Admin Portal" header
2. Email input (or client login ID for client portals)
3. Password input
4. Gold "Sign In" button
5. Home button top‑right

---

## 5. Key States

| State | Landing | Guard Login | Admin Login |
|-------|---------|-------------|-------------|
| **Loading** | Spinner in Verify button | Spinner in sign‑in | Spinner in sign‑in |
| **Empty** | Phone input focused, QR inactive | Tab defaults to phone | Email input focused |
| **Error** | Toast for invalid phone / QR | Toast for wrong PIN | Toast for wrong credentials |
| **Success** | Redirect | Redirect to dashboard | Redirect to dashboard |
| **QR scan fail** | Toast "Unknown QR code" | Toast "Could not verify" | N/A |
| **Camera denied** | Toast "Camera permission needed" | Same | N/A |

---

## 6. Components

### New: `qr-scanner-dialog.tsx`
- Wraps Radix `<Dialog>` + `<video>` + scanner engine
- Props: `open`, `onOpenChange`, `onScan(text: string)`
- Internal: `startHybridQrScanner` from `@/lib/qr/scanner-engine`
- Scan overlay frame with `ScanLine` icon
- Cleanup: stops scanner on close/unmount

### Modified: landing page
- Add `QrCode` to icon imports
- Add `parseEmployeeIdFromQrText` import
- Add `qrDialogOpen` state
- Add QR button next to phone input
- Add `QrScannerDialog` component usage
- Restyled to Bold & Industrial theme

### Modified: guard-login, admin-login
- Background swap to new navy gradient
- Card styling updated (dark glass, gold accents)
- All functionality unchanged

---

## 7. What stays untouched

- All API routes, Firebase auth, FCM, scanner engine, shift logic, photo capture, offline queue
- Desktop brand panel (still hidden on mobile, shown on >768px)
- Guard-login QR tab (exists alongside the landing-page QR for portal users)
- Admin login client‑portal logic
- Footer legal text

---

## 8. Anti-goals

- No new backend endpoints
- No changes to the attendance recording flow logic
- No changes to the enrollment page
- No dark/light mode toggle

---

## 9. Self-review

- [x] No placeholders or TBD
- [x] Architecture consistent with existing code (same APIs, same scanner, same auth)
- [x] Scope focused on 3 pages + 1 new component
- [x] No ambiguity: phone → guard-login/enroll, QR → attendance, both flows clearly defined
- [x] No contradictions with CLAUDE.md or MEMORY.md
