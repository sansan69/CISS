---
paths:
  - "src/app/api/**/*.ts"
  - "src/app/api/**/*.tsx"
---

## API Route Rules

- All admin API routes use `requireAdmin()` from `src/lib/server/auth.ts`.
- Auth pattern:
  ```ts
  import { requireAdmin } from '@/lib/server/auth';
  export async function GET(request: NextRequest) {
    const { db, uid } = await requireAdmin();
    // ... use db (Admin Firestore) and uid
  }
  ```
- Return `NextResponse.json({ error: 'message' }, { status: code })` for errors.
- Use `NextRequest` and `NextResponse` from `next/server`.
- For file uploads, use `request.formData()` to extract files.
- Never expose Admin SDK credentials in client code.
- API routes under `src/app/api/admin/` require admin auth.
- API routes under `src/app/api/` (non-admin) may use client auth or be public.