# CLAUDE.md — Instructions for Claude Code

## Core Rules

1. **Always read MEMORY.md first** before implementing any change.
2. **Always read `docs/app-context.md`** for current architecture, collections, and routes.
3. **Never show full code operations inline.** Only give a concise implementation report after completing a task.
4. **Never create separate git branches.** Always work on `main`.
5. **Update MEMORY.md immediately** after every codebase change.
6. **Never add unrequested features**, refactors, or comments. Only implement exactly what is asked.
7. **No emoji** in responses unless explicitly requested.
8. **Terse responses only.** Report what changed; skip preambles and trailing summaries.

## Project Identity

- App: **CISS Workforce** — workforce management PWA for a Kerala-based security company
- Stack: Next.js 15.5 (App Router), React 18, TypeScript, Firebase (Firestore + Auth + Storage), ShadCN UI, Tailwind CSS
- Deployment: Vercel (main branch auto-deploys)
- Firebase project: `ciss-workforce` (alias `cissworkforce`)
- Brand colors: `#014c85` (blue), `#bd9c55` (gold)

## Architecture Rules

- Firebase Admin SDK for all server-side API routes (`src/lib/firebaseAdmin.ts`)
- Firebase Client SDK for browser pages (`src/lib/firebase.ts`)
- All role checks via `requireAdmin()` / Firebase custom claims
- `attendanceLogs`: use `employeeDocId` (Firestore doc ID), NOT `employeeId`
- `attendanceDate` field is a `YYYY-MM-DD` string
- Composite Firestore indexes go in `firestore.indexes.json`
- Wage config stored in `clientWageConfig/{clientId}` collection

## Payroll System

- Wage components: `earning | deduction | employer_contribution`
- Calc types: `fixed_amount | pct_of_basic | pct_of_ctc | pct_of_gross | pct_of_epf_base | balancing | kerala_slab | tds_projected`
- Payroll run uses `employeeDoc.id` → `aggregateAttendance(employeeDocId, period, db)`
- Payroll cycles: `payrollCycles` collection; entries: `payrollEntries` collection

## Files to Read Before Working on a Feature

| Area | Files to Read |
|------|--------------|
| Payroll | `src/lib/payroll/`, `src/app/api/admin/payroll/`, `src/app/(app)/payroll/` |
| Wage Config | `src/app/api/admin/clients/[id]/wage-config/`, `src/app/(app)/settings/wage-config/page.tsx` |
| Attendance | `src/lib/payroll/attendance-aggregator.ts`, `firestore.indexes.json` |
| Auth / Roles | `src/lib/server/auth.ts`, `src/lib/auth/roles.ts` |
| Clients / Sites | `src/app/(app)/settings/clients/` |

## Project Configuration

- **Rules** (`.claude/rules/`): Path-scoped domain rules loaded on demand
  - `firebase.md` — loaded when touching Firebase/server files
  - `payroll.md` — loaded when touching payroll/wage files
  - `api-routes.md` — loaded when touching API routes
  - `components.md` — loaded when touching UI components
- **Commands** (`.claude/commands/`): `/deploy`, `/typecheck`, `/db-query`
- **Agents** (`.claude/agents/`): `ciss-code-reviewer`, `ciss-firebase-expert`
- **Settings** (`.claude/settings.json`): Team-shared permissions and config
- **MCP Servers** (`.mcp.json`): Vercel, Context7

## Memory File

See `MEMORY.md` at project root for full changelog.