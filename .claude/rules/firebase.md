---
paths:
  - "src/lib/firebase*.ts"
  - "src/app/api/**/*.ts"
  - "firestore.indexes.json"
  - "src/lib/server/**/*.ts"
  - "firebase.json"
---

## Firebase Rules

- Use Firebase Admin SDK (`firebase-admin`) in all server-side API routes. Import from `src/lib/firebaseAdmin.ts`.
- Use Firebase Client SDK (`firebase`) in browser code. Import from `src/lib/firebase.ts`.
- Never use Admin SDK in client components.
- All admin API routes must call `requireAdmin()` or `verifyAuth()` from `src/lib/server/auth.ts`.
- Firestore queries: use `employeeDocId` (Firestore doc ID) for attendance, NOT `employeeId` (CISS guard ID).
- `attendanceDate` is a `YYYY-MM-DD` string. Use string comparison for date ranges.
- Composite indexes go in `firestore.indexes.json`. After adding an index, run `firebase deploy --only firestore:rules` or let Vercel deploy handle it.
- Firestore security rules: check `src/lib/firebase.ts` for client-side patterns. Server-side uses Admin SDK which bypasses rules.
- Storage uploads: use Firebase Storage with `uploadBytesResumable`. Validate file type and size before upload.
- Custom claims: set via Admin SDK `auth.setCustomUserClaims()`. Claims include `admin`, `clientAdmin`, `guard` roles.