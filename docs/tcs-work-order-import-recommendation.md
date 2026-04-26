# TCS Work Order Import — Current vs Required Analysis

**Date:** 2026-04-25
**Scope:** TCS exam duty work order upload, revision, and management
**Files Analyzed:** 1,057 historical TCS exam duty workbooks

---

## Executive Summary

The current implementation covers **80%** of what you need. The core revision engine (diff, commit, cancel) already works. The main gaps are in **preview clarity**, **duplicate protection strength**, and **multi-exam-day visibility**.

---

## What's Already Working Well

| Feature | Status | Notes |
|---------|--------|-------|
| **Excel parsing** | Working | Handles both single-date sheets and pivot-date sheets (multiple dates per row) |
| **Site auto-creation** | Working | New centers are geocoded and created automatically |
| **Revision mode** | Working | Upload updated file → adds new, updates changed, cancels missing |
| **New mode** | Working | Upload fresh file → rejects if overlap exists |
| **Duplicate detection** | Working | Catches exact file re-uploads and identical content re-uploads |
| **Overlap detection** | Working | Detects when file contains sites/dates already in database |
| **Import history** | Working | `workOrderImports` collection stores all imports with audit trail |
| **Exam name extraction** | Working | Extracts from filename; now editable in preview (just added) |
| **Hash validation** | Working | Content hash prevents tampering between preview and commit |
| **Guard assignment preservation** | Working | Assigned guards are retained on updated work orders |

---

## What's Missing or Weak

### 1. Preview Clarity (HIGH PRIORITY)

**Current:** Preview shows 4 numbers only: Rows, Sites, Added, Updated/Cancelled.

**Problem:** Admin cannot see **which** specific sites/dates are being added, updated, or cancelled before committing. This creates anxiety about accidentally removing work orders.

**What's needed:** A per-row diff table showing:
- Site name + district
- Date
- Exam name
- Status (Added / Updated / Unchanged / Cancelled)
- For updates: before/after guard counts
- For cancelled: current guard assignment count (so admin knows if guards are assigned)

### 2. "Same Data Uploaded Again" Protection (MEDIUM-HIGH PRIORITY)

**Current:** Two protections:
- `binaryFileHash` — exact same file bytes
- `contentHash` — same normalized data

**Problem:** If TCS sends a "revised" file with the same data but different filename/formatting, both hashes change and the duplicate is not caught. Admin could accidentally process the same exam twice.

**What's needed:** A semantic duplicate check based on **(examCode + dateRange + site list)**. If an import already exists with the same exam on the same dates at the same sites, warn the admin regardless of file differences.

### 3. Multi-Exam Per Day Visibility (MEDIUM PRIORITY)

**Current:** Work order cards show exam names, but they're small and grouped by site.

**Problem:** On a single day with multiple exams (e.g., SBI JA Prelims on 20 Sept + AIIMS NORCET on 20 Sept), it's hard to see at a glance which exam is which when viewing by date.

**What's needed:** 
- In the site detail view, group work orders by date and show all exams for that date
- In the main list, show exam names more prominently (already improved in last commit)

### 4. Cancelled Work Order Recovery (MEDIUM PRIORITY)

**Current:** Revision mode marks missing rows as `recordStatus: "cancelled"`.

**Problem:** If admin makes a mistake (uploads wrong file), cancelled work orders cannot be easily restored. The assigned guards are still in the cancelled record, but there's no "undo import" or "restore cancelled" feature.

**What's needed:** An "Undo Import" button on the import history page that restores all work orders cancelled by that specific import.

### 5. Revised Filename Handling (LOW-MEDIUM PRIORITY)

**Current:** `cleanExamNameFromFilename()` strips "Revised", "Copy of", "Adhoc" prefixes.

**Problem:** Files named "Revised Adhoc Security Requirement for SBI JA Prelims..." may still extract poorly. The parser also doesn't handle "revised" as a signal that this should automatically suggest Revision mode.

**What's needed:** 
- Better exam name extraction for "Revised" files
- If filename contains "revised", default the import mode to "Revision" instead of "New"

### 6. Multi-Sheet Workbook Support (LOW PRIORITY)

**Current:** Only reads the first sheet.

**Problem:** If TCS ever sends a workbook with multiple exam sheets (one per exam), only the first would be imported.

**What's needed:** Parse all sheets and merge rows, or allow sheet selection in preview.

---

## Recommended Implementation Plan

### Phase 1: Preview Diff Table (Immediate — Biggest Impact)

**Why first:** This removes the biggest friction point. Admins need to see exactly what will change before they click Confirm.

**Implementation:**
1. In the preview panel, add an expandable "View Details" section
2. Show a table grouped by date, then by site:
   ```
   Date: 2025-09-20
   ├─ Site: ST. THOMAS COLLEGE, Alappuzha
   │  Status: UNCHANGED  Male: 3  Female: 1
   ├─ Site: ION DIGITAL ZONE, Ernakulam
   │  Status: UPDATED    Male: 0→2  Female: 0→3  (4 guards assigned!)
   └─ Site: NEW CENTER, Kottayam
      Status: ADDED      Male: 2  Female: 1
   ```
3. Highlight rows with assigned guards in amber (warns admin before cancelling)
4. Show cancelled rows in a separate "Will Be Cancelled" section with guard counts

**Files to modify:**
- `src/app/(app)/work-orders/page.tsx` — add diff table UI
- No backend changes needed (diffRows already has all the data)

### Phase 2: Semantic Duplicate Detection (Next)

**Why:** Prevents accidental double-processing of the same exam.

**Implementation:**
1. In the preview API, after computing `contentHash`, also compute a `semanticHash`:
   - Key = `examCode + dateRange.from + dateRange.to + sortedSiteList`
2. Query `workOrderImports` for any previous import with matching `semanticHash`
3. If found, add a warning: "A similar import for this exam on these dates was already processed on [date]. Are you sure you want to continue?"
4. Do NOT block commit — just warn (because TCS might legitimately send updated requirements for the same exam)

**Files to modify:**
- `src/app/api/admin/work-orders/import/preview/route.ts` — add semantic duplicate check
- `src/types/work-orders.ts` — add `semanticHash` field
- `src/app/(app)/work-orders/page.tsx` — display semantic duplicate warning

### Phase 3: Undo Import / Restore Cancelled (After Phase 2)

**Why:** Safety net for mistakes.

**Implementation:**
1. Add `cancelledWorkOrderIds` array to `workOrderImports` document at commit time
2. Add `previousRecordStatus` field when cancelling (stores "active")
3. Create API route: `POST /api/admin/work-orders/import/[importId]/undo`
   - Restores all cancelled work orders to `recordStatus: "active"`
   - Re-cancels any work orders that were added by that import
4. Add "Undo Import" button on import history page

**Files to modify:**
- `src/app/api/admin/work-orders/import/commit/route.ts` — track cancelled IDs
- `src/app/api/admin/work-orders/import/[id]/undo/route.ts` — new undo API
- `src/app/(app)/work-orders/imports/page.tsx` — add undo button

### Phase 4: Multi-Exam Day View Polish (Nice to have)

**Implementation:**
- In site detail page (`[siteId]/page.tsx`), group work orders by date
- Show all exams for each date in a single card
- Add a calendar view option (month view with dots for exam days)

---

## File Naming Patterns Observed (1,057 files)

| Pattern | Count | Example |
|---------|-------|---------|
| Contains "Adhoc" | ~99% | "Adhoc Security Guards Requirement for RBI JE Exam..." |
| Contains "Exam" | ~93% | Identifies as exam duty |
| Is "Revised" | ~13% | "Revised Adhoc Security Requirement for..." |
| Single sheet | 100% (sampled) | All files have one sheet |

**Recommendation:** The single-sheet pattern means multi-sheet support is not urgent. Focus on Phase 1 (preview table) and Phase 2 (semantic duplicates) first.

---

## Decision Matrix

| Feature | User Pain | Implementation Effort | Recommended Priority |
|---------|-----------|----------------------|---------------------|
| Preview diff table | HIGH | LOW (data already exists) | **Phase 1** |
| Semantic duplicate detection | MEDIUM | LOW | **Phase 2** |
| Undo import | MEDIUM | MEDIUM | Phase 3 |
| Revised filename auto-mode | LOW | LOW | Phase 3 |
| Multi-sheet support | LOW | MEDIUM | Phase 4 (deferred) |
| Calendar view | LOW | HIGH | Phase 4 (deferred) |

---

## My Recommendation

**Start with Phase 1 (Preview Diff Table) immediately.** It requires zero backend changes and will give you the most value. The diff data is already computed; you just need to display it.

After that, implement Phase 2 (Semantic Duplicate Detection) to prevent accidental double-processing.

The current system is architecturally sound. The parser, diff engine, and commit API are well-designed. The gaps are purely in **presentation and safety checks**, not in core functionality.
