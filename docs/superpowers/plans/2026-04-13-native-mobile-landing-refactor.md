# Native Mobile Landing Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the landing page so mobile devices get a native-app-like first screen with verification near the top and no oversized web-style hero box.

**Architecture:** Keep the existing landing-page logic, routing, and install behavior, but shift the layout into a mobile-first structure. The page should use responsive composition so phones get a compact app-header plus verification-first flow, while larger screens still preserve a polished branded split layout without reintroducing the heavy boxed hero.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest

---

## File Structure

- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
  - Refactor the landing layout for mobile-first native feel.
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
  - Update regression coverage for the new mobile/native structure.
- Reference: `/Users/mymac/Documents/CISS/docs/superpowers/specs/2026-04-13-native-mobile-landing-design.md`
  - Approved scope and success criteria.

### Task 1: Update the landing regression test for the mobile-native layout

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the failing test**

Adjust the current render-based test so it expects the mobile-native structure:

```ts
describe("landing page surface", () => {
  it("renders the mobile-native verification-first surface", () => {
    const LandingPage = loadLandingPage();
    const html = renderToStaticMarkup(React.createElement(LandingPage));
    const textContent = normalizeTextContent(html);
    const hrefs = extractHrefList(html);
    const images = extractImageData(html);

    expect(textContent).toContain("CISS Workforce");
    expect(textContent).toContain("Security workforce management platform");
    expect(textContent).toContain("Verify guards, record attendance, and access admin operations fast.");
    expect(textContent).toContain("Start with your mobile number.");
    expect(textContent).not.toContain("Mobile verification for attendance and access.");
    expect(hrefs).toEqual(expect.arrayContaining(["/attendance", "/guard-login", "/admin-login"]));
    expect(images).toEqual(
      expect.arrayContaining([{ alt: "CISS Workforce Logo", src: "/ciss-logo.png" }]),
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
git commit -m "test: cover native mobile landing layout"
```

### Task 2: Refactor the landing page into a mobile-native layout

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/page.tsx`
- Test: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`

- [ ] **Step 1: Write the minimal implementation**

Restructure the page so phones render:
- a slim top app header
- a short supporting line
- the verification form immediately after
- compact shortcut rows

Use this responsive structure in `src/app/page.tsx`:

```tsx
<main className="min-h-screen bg-[#f5f8fc] text-[#0c2842]">
  <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-8 pt-5 sm:px-6 lg:justify-center lg:px-8 lg:py-10">
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-8">
      <section className="rounded-[1.75rem] bg-[linear-gradient(180deg,#0b4d83_0%,#0f67a7_100%)] px-5 py-5 text-white shadow-[0_22px_60px_-32px_rgba(1,76,133,0.85)] sm:px-6 sm:py-6 lg:min-h-[520px] lg:px-8 lg:py-8">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/14 backdrop-blur">
            <Image
              src="/ciss-logo.png"
              alt="CISS Workforce Logo"
              width={48}
              height={48}
              priority
              className="h-12 w-12"
            />
          </div>
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight sm:text-2xl">CISS Workforce</p>
            <p className="text-sm text-white/72 sm:text-[15px]">
              Security workforce management platform
            </p>
          </div>
        </div>

        <div className="mt-8 max-w-md space-y-3 lg:mt-12">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#f2d58f]">
            Daily workforce access
          </p>
          <h1 className="text-[2rem] font-semibold leading-tight sm:text-[2.35rem] lg:text-[3.25rem]">
            Verification-first access for guards and attendance.
          </h1>
          <p className="text-sm leading-6 text-white/80 sm:text-base">
            Verify guards, record attendance, and access admin operations fast.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-[1.75rem] border border-[#d9e5f1] bg-white/96 px-4 py-4 shadow-[0_22px_54px_-34px_rgba(1,76,133,0.42)] sm:px-5 sm:py-5 lg:px-7 lg:py-7">
        {/* keep existing verification form logic here */}
        {/* keep quick access links, but make them compact rows */}
        {/* keep install surface smaller and visually lighter */}
      </section>
    </div>
  </div>
</main>
```

Within the right section:
- keep the `Employee Verification` label
- keep the phone input and verify button
- reduce padding and corner sizes on mobile
- convert quick access into tighter list rows
- keep install area, but visually smaller than the form

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
git commit -m "feat: refactor landing page for native mobile feel"
```

### Task 3: Verify mobile-native behavior and build health

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
curl -s http://127.0.0.1:3000 | rg "Security workforce management platform|Start with your mobile number.|Record Attendance|Guard Portal|Admin Login"
```

Expected:

```text
all required strings present
```

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/landing-page-surface.test.ts
git commit -m "chore: verify native mobile landing refactor"
```
