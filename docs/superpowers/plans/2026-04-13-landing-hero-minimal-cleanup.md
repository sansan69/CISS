# Landing Hero Minimal Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the left hero panel on the landing page so it feels minimal, professional, and modern while preserving the existing phone verification flow.

**Architecture:** Keep the current split landing layout and all phone verification logic intact. Only refactor the left hero presentation by removing decorative content blocks and tightening the copy hierarchy, then verify the cleaned surface with regression tests, typecheck, build, and a live localhost check.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest

---

## File Structure

- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
  - Simplify the left hero presentation only.
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
  - Update the surface assertions to match the new minimal hero.
- Reference: `/Users/mymac/Documents/CISS/docs/superpowers/specs/2026-04-13-landing-hero-minimal-design.md`
  - Approved scope and success criteria.

### Task 1: Lock the minimal hero surface in a failing test

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const landingPageSource = readFileSync(
  resolve(process.cwd(), "src/app/page.tsx"),
  "utf8",
);

describe("landing page surface", () => {
  it("shows the approved minimal brand copy", () => {
    expect(landingPageSource).toContain("Security workforce management platform");
    expect(landingPageSource).toContain("Verify guards, record attendance, and access admin operations fast.");
  });

  it("keeps the main access shortcuts visible", () => {
    expect(landingPageSource).toContain("/attendance");
    expect(landingPageSource).toContain("/guard-login");
    expect(landingPageSource).toContain("/admin-login");
  });

  it("removes the cluttered hero extras", () => {
    expect(landingPageSource).not.toContain("Phone-first access");
    expect(landingPageSource).not.toContain(">OTP<");
    expect(landingPageSource).not.toContain(">Daily<");
    expect(landingPageSource).not.toContain(">PWA<");
    expect(landingPageSource).not.toContain("Built for active workforce operations");
  });
});
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
git commit -m "test: cover minimal landing hero cleanup"
```

### Task 2: Simplify the landing hero presentation

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the minimal implementation**

Replace the current left hero section inside `return (...)` with this simplified block:

```tsx
<section className="relative overflow-hidden rounded-[2rem] border border-white/20 bg-[linear-gradient(135deg,#014c85_0%,#0d5d97_55%,#2f79b1_100%)] px-6 py-8 text-white shadow-[0_28px_80px_-30px_rgba(1,76,133,0.85)] sm:px-8 sm:py-10 lg:px-11 lg:py-12">
  <div className="absolute right-[-4rem] top-[-4rem] h-40 w-40 rounded-full bg-white/8 blur-3xl" />
  <div className="absolute bottom-[-5rem] left-[-4rem] h-40 w-40 rounded-full bg-[#bd9c55]/18 blur-3xl" />

  <div className="relative flex h-full flex-col justify-between gap-12">
    <div className="flex items-center gap-4">
      <div className="rounded-2xl border border-white/16 bg-white/10 p-3 backdrop-blur">
        <Image
          src="/ciss-logo.png"
          alt="CISS Workforce Logo"
          width={54}
          height={54}
          priority
          className="h-[54px] w-[54px]"
        />
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight sm:text-3xl">CISS Workforce</p>
        <p className="text-sm font-medium text-white/72 sm:text-base">
          Security workforce management platform
        </p>
      </div>
    </div>

    <div className="max-w-2xl space-y-5">
      <h1 className="max-w-3xl text-4xl font-bold leading-[1.08] sm:text-5xl lg:text-[4.1rem]">
        Mobile verification for daily workforce access.
      </h1>
      <p className="max-w-lg text-base leading-7 text-white/78 sm:text-lg">
        Verify guards, record attendance, and access admin operations fast.
      </p>
    </div>
  </div>
</section>
```

Also remove:
- the `Phone-first access` pill
- the three `OTP / Daily / PWA` cards
- the `Built for active workforce operations` block

- [ ] **Step 2: Run the test to verify it passes**

Run:

```bash
npx vitest run src/app/landing-page-surface.test.ts
```

Expected:

```text
1 passed
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx src/app/landing-page-surface.test.ts
git commit -m "feat: simplify landing hero presentation"
```

### Task 3: Verify the cleaned hero in the app shell

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx` if follow-up spacing tweaks are needed

- [ ] **Step 1: Run static verification**

Run:

```bash
npm run typecheck
npm run build
```

Expected:

```text
typecheck passes
build passes
```

- [ ] **Step 2: Run the app locally**

Run:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Expected:

```text
Local: http://127.0.0.1:3000
```

- [ ] **Step 3: Check the landing page output**

Run:

```bash
curl -s http://127.0.0.1:3000 | rg "Security workforce management platform|Mobile verification for daily workforce access.|Record Attendance|Guard Portal|Admin Login"
```

Expected:

```text
all approved strings present
```

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/landing-page-surface.test.ts
git commit -m "chore: verify minimal landing hero cleanup"
```
