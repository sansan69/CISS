# Unboxed Landing Layout Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the boxed hero feel from both desktop and mobile while preserving a clean split layout on desktop and a native-app-like verification-first flow on mobile.

**Architecture:** Keep the current landing page logic and semantic mobile markers, but refactor the presentation so the brand area is unboxed and restrained on all screen sizes. The verification section remains the primary interactive area, while the quick access rows become tighter, more list-like, and more native-app-friendly on mobile.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest

---

## File Structure

- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
  - Remove boxed hero treatments and tighten spacing/typography.
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
  - Update regression coverage so it reflects the unboxed layout and app-like quick-access rows.
- Reference: `/Users/mymac/Documents/CISS/docs/superpowers/specs/2026-04-13-unboxed-landing-layout-design.md`
  - Approved behavior and visual scope.

### Task 1: Update the landing regression test for the unboxed layout

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the failing test**

Update the current render-based test so it rejects boxed-hero structure and expects tighter app-like sections:

```ts
describe("landing page surface", () => {
  it("renders the approved unboxed desktop/mobile landing surface", () => {
    const LandingPage = loadLandingPage();
    const html = renderToStaticMarkup(React.createElement(LandingPage));
    const textContent = normalizeTextContent(html);
    const hrefs = extractHrefList(html);

    expect(textContent).toContain("CISS Workforce");
    expect(textContent).toContain("Security workforce management platform");
    expect(textContent).toContain("Start with your mobile number.");
    expect(hrefs).toEqual(expect.arrayContaining(["/attendance", "/guard-login", "/admin-login"]));

    expect(html).not.toContain('aria-label="Desktop hero"');
    expect(html).not.toContain("Mobile verification for attendance and access.");
    expect(html).not.toContain("shadow-[0_28px_80px_-30px_rgba(1,76,133,0.85)]");

    expect(html).toContain('data-mobile-section="header"');
    expect(html).toContain('data-mobile-section="verification"');
    expect(html).toContain('data-mobile-section="quick-access"');
    expect(html).toContain('data-mobile-section="install"');
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
git commit -m "test: cover unboxed landing layout"
```

### Task 2: Remove the boxed hero presentation from the landing page

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the minimal implementation**

Refactor the brand/hero area into an unboxed split layout:

```tsx
<div className="mt-4 grid items-start gap-5 lg:mt-6 lg:grid-cols-[0.82fr_1.18fr] lg:gap-10">
  <section
    data-desktop-section="brand"
    className="flex flex-col justify-start gap-5 px-1 py-2 lg:px-2 lg:py-8"
  >
    <div className="flex items-center gap-3">
      <div className="rounded-2xl border border-[#d8e5f1] bg-white/88 p-2.5 shadow-[0_16px_34px_-24px_rgba(1,76,133,0.35)]">
        <Image ... />
      </div>
      <div>
        <p className="text-[1.08rem] font-bold tracking-tight text-[#0c2842] sm:text-[1.2rem]">
          CISS Workforce
        </p>
        <p className="text-xs font-medium text-[#5c7086] sm:text-sm">
          Security workforce management platform
        </p>
      </div>
    </div>

    <div className="max-w-xl space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#014c85]/72">
        Verification-first access
      </p>
      <h1 className="text-[1.95rem] font-semibold leading-tight text-[#0c2842] sm:text-[2.35rem] lg:text-[3rem]">
        Start daily workforce access with fast mobile verification.
      </h1>
      <p className="max-w-lg text-sm leading-6 text-[#5c7086] sm:text-base">
        Verify guards, record attendance, and access admin operations fast.
      </p>
    </div>
  </section>

  <div className="flex flex-col gap-3.5 sm:gap-4">
    {/* verification section */}
    {/* quick access section */}
    {/* install section */}
  </div>
</div>
```

Also tighten the mobile app feel:
- remove any remaining desktop billboard gradients as structural containers
- make quick-access rows shorter and more list-like
- reduce supporting description weight in quick-access rows on mobile
- tighten section padding and vertical gaps

- [ ] **Step 2: Run the test to verify it passes**

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
git commit -m "feat: remove boxed landing hero layout"
```

### Task 3: Verify local behavior and build health

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx` if final spacing tweaks are needed

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
curl -s http://127.0.0.1:3000 | rg "Security workforce management platform|Start daily workforce access with fast mobile verification.|Start with your mobile number.|Record Attendance|Guard Portal|Admin Login"
```

Expected:

```text
all required strings present
```

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/landing-page-surface.test.ts
git commit -m "chore: verify unboxed landing refinement"
```
