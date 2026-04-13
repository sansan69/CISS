# Right Heavy Landing Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the desktop left panel and make the right verification panel the clear focus without changing the mobile-native landing flow.

**Architecture:** Keep the current landing page logic and mobile layout, but adjust the desktop grid ratio and trim the left-column content so it behaves like a supporting brand rail. The right column stays the main interactive surface and gains stronger visual dominance through width and calmer surrounding content.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest

---

## File Structure

- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
  - Adjust desktop grid proportions and trim the left desktop copy.
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
  - Update the landing regression test so it expects the right-heavy split marker values.
- Reference: `/Users/mymac/Documents/CISS/docs/superpowers/specs/2026-04-13-right-heavy-landing-balance.md`
  - Approved behavior and scope.

### Task 1: Update regression coverage for the right-heavy desktop balance

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the failing test**

Tighten the test so it rejects the current wider left panel and expects the new desktop grid ratio and trimmed left content:

```ts
expect(html).toContain("lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]");
expect(textContent).not.toContain("Verify guards, record attendance, and access admin operations fast.");
expect(textContent).toContain("Fast mobile verification for daily workforce access.");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/app/landing-page-surface.test.ts
```

Expected:

```text
FAIL
```

- [ ] **Step 3: Commit**

```bash
git add src/app/landing-page-surface.test.ts
git commit -m "test: cover right-heavy landing balance"
```

### Task 2: Refine the desktop layout into a right-heavy split

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the minimal implementation**

Adjust the desktop grid and trim the left rail copy:

```tsx
<div className="mt-3 grid items-start gap-3 lg:mt-0 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-14">
```

Left desktop column should become:

```tsx
<section data-desktop-section="brand" className="hidden lg:flex lg:flex-col lg:justify-center lg:gap-4 lg:px-1">
  <div className="flex items-center gap-3.5">
    {/* logo + product name */}
  </div>

  <div className="max-w-sm space-y-2.5">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#014c85]/72">
      Verification-first access
    </p>
    <h1 className="text-[2.15rem] font-semibold leading-[1.08] text-[#0c2842]">
      Fast mobile verification for daily workforce access.
    </h1>
  </div>
</section>
```

Also:
- remove the longer support paragraph from the left side
- keep the right column unchanged in behavior
- keep mobile classes and markers unchanged

- [ ] **Step 2: Run test to verify it passes**

Run:

```bash
npx vitest run src/app/landing-page-surface.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx src/app/landing-page-surface.test.ts
git commit -m "feat: shift landing focus to right panel"
```

### Task 3: Verify the updated balance locally

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx` if final spacing tweak is needed

- [ ] **Step 1: Run static verification**

Run:

```bash
npx vitest run src/app/landing-page-surface.test.ts
npm run typecheck
npm run build
```

Expected:

```text
landing test passes
typecheck passes
build passes
```

- [ ] **Step 2: Run a stable local server**

Run:

```bash
npm run start -- --hostname 127.0.0.1 --port 3001
```

Expected:

```text
Local: http://127.0.0.1:3001
```

- [ ] **Step 3: Check the output**

Run:

```bash
curl -s http://127.0.0.1:3001 | rg 'data-desktop-section=\"brand\"|lg:grid-cols-\\[minmax\\(0,0.72fr\\)_minmax\\(0,1.28fr\\)\\]|Fast mobile verification for daily workforce access\\.|Start with your mobile number\\.|Record Attendance|Guard Portal|Admin Login'
```

Expected:

```text
all required strings present
```

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/landing-page-surface.test.ts
git commit -m "chore: verify right-heavy landing balance"
```
