# CISS Workforce — Web Platform Workspace

This repo is the web/mobile platform half of CISS Services Ltd. (Kerala). The other half — all
business documents, client records, compliance packs, wagesheets, and the assistant's full
memory — lives in the **SANJAY BACKUP workspace**:

```
/Users/mymac/Library/CloudStorage/GoogleDrive-sanjay.deltah@gmail.com/Other computers/My Laptop (1)/SANJAY BACKUP
```

## Load before any work here

1. Read `.opencode/reference/ciss-kerala-knowledge.md` in that folder — the authoritative memory:
   verified company registrations, client registry + rates, per-client compliance calendars,
   template registry, digital-platform section (§14), automation capability & guardrails (§15).
2. Read `.opencode/reference/work-log.md` — dated log of every substantive task.
3. `.opencode/private-memory.json` — private registrations/bank/client GSTINs (never commit/print).

## Working rules (knowledge base §15)

- **NEVER delete data** (Firestore, Storage, files, mail) without explicit permission; prefer soft
  status changes (e.g. status/portalEnabled) over deletes.
- **Read-only on live systems by default**; any write/import/migration needs the user's go-ahead
  and a dry-run first (repo `scripts/*.mjs` follow `--apply` convention).
- Answers grounded in **actual data only** (Firestore, wagesheets, mail, agreements); mark
  inferences; never print secrets (API keys, service accounts, KMS material, passwords).
- After substantive work, append to `work-log.md` and refresh the knowledge base.

## Platform facts

- Live: **https://cisskerala.site** (Vercel). Firebase project **`ciss-workforce`** — Firestore
  `(default)`, Storage `ciss-workforce.firebasestorage.app`. MCP active project set to
  `ciss-workforce` (project_dir this repo).
- Roles: `superAdmin` / `admin` / `hr` / `accounts` / `compliance` / `fieldOfficer` / `client` /
  `guard` (synthetic email `{phone}@guard.cisskerala.app` + 4–6 digit PIN). Field officers are
  district-scoped via `assignedDistricts` custom claims.
- Attendance: QR (HMAC token) + GPS geofence (150 m), strict IN→OUT; shifts 2x12 / 3x8.
- Payroll engine: EPF 12%/EPS 8.33% (cap ₹15k), ESIC 0.75/3.25 (cap ₹21k), Kerala PT slabs, TDS
  new regime — see `src/lib/payroll/defaults.ts`.
- Deploys to Vercel on push to `main`. Firebase rules: `firebase deploy --only firestore:rules,indexes,storage:rules`.
- This AGENTS.md is a local convenience pointer — not part of the app build.
