---
paths:
  - "src/components/**/*.tsx"
  - "src/app/(app)/**/*.tsx"
  - "src/app/(guard)/**/*.tsx"
---

## Component Rules

- Use ShadCN UI components from `src/components/ui/`. Check existing components before adding new ones.
- Brand colors: `#014c85` (blue), `#bd9c55` (gold). Use CSS variables `--brand-blue` and `--brand-gold`.
- Use `@/` path alias for imports (maps to `./src/*`).
- Client components: add `"use client"` directive only when needed (useState, useEffect, event handlers).
- Server components: default. No `"use client"` unless interactivity required.
- Form pattern: `react-hook-form` + Zod schema + `@hookform/resolvers/zod`.
- Date handling: use `date-fns`. Never use native `Date` for formatting.
- Icons: use `lucide-react`.
- Charts: use `recharts`.
- Maps: use `leaflet` + `react-leaflet`.
- PDF generation: use `pdf-lib`.
- Excel: use `xlsx` (SheetJS).