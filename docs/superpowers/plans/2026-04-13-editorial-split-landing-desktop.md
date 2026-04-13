# Editorial Split Landing Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ugly desktop landing hero with a calm editorial split while preserving the native-like mobile experience and the existing verification behavior.

**Architecture:** Keep the current landing page logic in `/Users/mymac/Documents/CISS/src/app/page.tsx`, but simplify the desktop composition so the left column becomes a restrained brand/editorial column and the right column remains the live operational entry surface. Update the regression test first so it rejects the current billboard desktop treatment, then refactor the page, and finally verify with tests, build, and a real localhost browser pass.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest, Playwright MCP

---

## File Structure

- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
  - Remove the oversized desktop slab, unify desktop hierarchy, and keep mobile native-like.
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
  - Update regression coverage so it rejects the current ugly desktop treatment and expects the editorial split.
- Reference: `/Users/mymac/Documents/CISS/docs/superpowers/specs/2026-04-13-editorial-split-landing-desktop.md`
  - Approved visual target and non-goals.

### Task 1: Update the landing regression test for the editorial split desktop

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the failing test**

Update the existing test so it rejects the current desktop billboard layout and expects the new editorial split markers:

```ts
describe("landing page surface", () => {
  it("renders the approved editorial split desktop and native mobile landing surface", () => {
    const LandingPage = loadLandingPage();
    const html = renderToStaticMarkup(React.createElement(LandingPage));
    const textContent = normalizeTextContent(html);
    const hrefs = extractHrefList(html);

    expect(textContent).toContain("CISS Workforce");
    expect(textContent).toContain("Security workforce management platform");
    expect(textContent).toContain("Start with your mobile number.");
    expect(textContent).toContain("Start daily workforce access with fast mobile verification.");
    expect(hrefs).toEqual(expect.arrayContaining(["/attendance", "/guard-login", "/admin-login"]));

    expect(html).toContain('data-desktop-section="brand"');
    expect(html).not.toContain('aria-label="Desktop hero"');
    expect(html).not.toContain("Native mobile access");
    expect(html).not.toContain(
      "rounded-[2rem] border border-white/30 bg-[linear-gradient(135deg,#014c85_0%,#0f67a7_58%,#3f87bd_100%)]",
    );
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
git commit -m "test: cover editorial split desktop landing"
```

### Task 2: Refactor the desktop landing composition into an editorial split

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the minimal implementation**

Refactor the page so the desktop layout becomes a restrained editorial split:

```tsx
<div className="mt-3 grid items-start gap-3 lg:mt-6 lg:grid-cols-[0.88fr_1.12fr] lg:gap-12">
  <section
    data-desktop-section="brand"
    className="hidden lg:flex lg:flex-col lg:justify-center lg:gap-5 lg:px-2"
  >
    <div className="flex items-center gap-4">
      <div className="rounded-[1.35rem] border border-[#d8e5f1] bg-white/88 p-3 shadow-[0_16px_32px_-24px_rgba(1,76,133,0.2)]">
        <Image ... />
      </div>
      <div>
        <p className="text-[1.08rem] font-bold tracking-tight text-[#0c2842]">CISS Workforce</p>
        <p className="text-sm font-medium text-[#5c7086]">
          Security workforce management platform
        </p>
      </div>
    </div>

    <div className="max-w-xl space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#014c85]/72">
        Verification-first access
      </p>
      <h1 className="text-[2.5rem] font-semibold leading-[1.08] text-[#0c2842]">
        Start daily workforce access with fast mobile verification.
      </h1>
      <p className="max-w-lg text-base leading-7 text-[#5c7086]">
        Verify guards, record attendance, and access admin operations fast.
      </p>
    </div>
  </section>

  <div className="flex flex-col gap-3 sm:gap-4">
    {/* verification */}
    {/* quick access */}
    {/* install */}
  </div>
</div>
```

Also remove the remaining competing desktop brand bar treatment:
- keep the slim top header for mobile/tablet
- on large screens, do not show the extra “Native mobile access” pill
- avoid a duplicate full-width desktop brand banner effect
- keep the right column as the operational surface

- [ ] **Step 2: Run the landing test to verify it passes**

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
git commit -m "feat: refactor landing page into editorial split desktop"
```

### Task 3: Verify desktop and mobile landing behavior locally

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx` if final spacing cleanup is needed after browser verification

- [ ] **Step 1: Run static verification**

Run:

```bash
npx vitest run src/app/landing-page-surface.test.ts
npm run typecheck
npm run build
```

Expected:

```text
landing-page test passes
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

- [ ] **Step 3: Check localhost output**

Run:

```bash
curl -s http://127.0.0.1:3000 | rg 'data-desktop-section="brand"|Security workforce management platform|Start daily workforce access with fast mobile verification\\.|Start with your mobile number\\.|Record Attendance|Guard Portal|Admin Login'
```

Expected:

```text
all required strings present
```

- [ ] **Step 4: Browser verify desktop and mobile surfaces**

Use Playwright MCP to:
- open `http://127.0.0.1:3000`
- verify desktop no longer shows a billboard hero slab
- resize to mobile (`390x844`)
- verify mobile still feels compact and verification-first
- confirm fresh console errors are `0`

Expected:

```text
desktop looks balanced
mobile remains native-like
0 fresh console errors
```

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/landing-page-surface.test.ts
git commit -m "chore: verify editorial split landing desktop"
```
