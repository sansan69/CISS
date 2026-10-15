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

## Preferred project workflow

- For multi-step project work, load relevant skills/plugins, write a concise plan, use an isolated worktree when practical, make meaningful test-first changes, and run focused regression checks. Preserve existing behavior and inspect the final diff.
- Match model effort to task complexity: routine planning uses GPT-6 Luna low; use GPT-6 Astra only for complex planning. Use GPT-6 Luna low for simple implementation and medium for moderate implementation. Use DeepSeek V4.1 Flash (`ccs-deepseek/deepseek-flash`) at its documented high reasoning effort for reviews by default; medium maps to high, and low is optional only if later selected. Use GPT-6.1 Sol medium only for complex reviews.
- If the requested model or route is unavailable, state that before using a fallback; never silently substitute. Instructions here do not switch the model in a chat that is already running.
- If DeepSeek V4.1 Flash is unavailable or fails to respond reliably, automatically fall back to GPT-6 Luna (`gpt-6-luna`) at medium effort; use high effort when the review needs deeper reasoning. This fallback is pre-authorized: briefly disclose the reason and selected effort, then continue without asking for confirmation. Keep GPT-6.1 Sol medium for complex reviews as specified above.
- Give reviewers compact fresh-context handoffs with the approved plan, relevant diffs/files, and focused checks. Ask them to identify actionable defects and missing requirements. Avoid repetitive context, passing-check reruns, and mandatory agent ceremony for trivial non-code work.
- Fix actionable review findings with GPT-6 Luna at the effort appropriate to the fix, then request a targeted re-review. Repeat until no actionable issues remain and required checks pass. Preserve protocol-required reasoning and tool history, and follow vendor tool instructions; do not impose hard output caps or falsify context-window details.
- Report what changed, verification results, review findings and fixes, and remaining uncertainty. Do not promise literal perfection.
- Do not commit, push, merge, deploy, or change live data unless the user has authorized that specific action.
