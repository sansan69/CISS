# CISS Workforce — UI/UX Update Plan

**Audit date:** 2026-04-17
**Sources:** Codebase audit + Emil Kowalski design engineering philosophy (animations.dev)

---

## Audit Summary

Solid foundation: HSL design-token system, mobile-first PWA, 15+ keyframe animations, dark mode. Main weaknesses: generic login screen, inconsistent spacing/icon scale, mixed loading patterns, underused brand identity, and animations that ignore frequency, easing quality, and `prefers-reduced-motion`.

---

## Priority 1 — Brand Identity

### 1.1 Login Page Rebrand

**Problem:** `admin-login/page.tsx` uses `gray-50` background, `gray-600` labels, `gray-200` borders. Zero brand presence.

**Fix:**
- Background: `bg-[#014c85]` gradient (`from-[#014c85] to-[#012f52]`)
- Card: white with `border-t-4 border-[#bd9c55]` gold top accent
- Wordmark: Exo 2 700 weight, white
- Inputs: `focus-visible:ring-[#014c85]` — override default indigo
- Submit button: `bg-[#014c85] hover:bg-[#013a6b]` (confirm not overridden)
- Layout: asymmetric split or full-bleed card — not generic centered gray

### 1.2 Exo 2 More Prominent

**Problem:** Exo 2 only on `PageHeader` h1. Cards, stats, table headings all fall back to Geist Sans.

**Fix:** Add `font-exo2 tracking-tight` to `CardTitle`, dashboard metric headings, all `<h2>`/`<h3>` section titles. Body text, labels, table cells stay Geist Sans.

### 1.3 Brand Color Usage

**Fix:**
- Active tab: `data-[state=active]` → `text-[#014c85]` underline
- Active sidebar item: `bg-[#014c85]/10 text-[#014c85]`
- Add `brand` Badge variant: `bg-[#014c85]/10 text-[#014c85] border-[#014c85]/20` for district/client chips

---

## Priority 2 — Animation Overhaul (Emil Kowalski principles)

### 2.1 Animation Decision Audit

Apply frequency test to every existing animation:

| Animation | Frequency | Decision |
|---|---|---|
| Sidebar open/close | Tens/day | Remove or `< 150ms` |
| Tab switching | Tens/day | CSS transition only, `< 200ms` |
| Modal open | Occasional | Keep, fix easing |
| Toast notifications | Occasional | Keep, fix easing |
| Skeleton loaders | Constant | Linear pulse — fine |
| Page load stagger | Rare | Keep, fix timing |

**Rule: never animate keyboard-initiated actions.** Any shortcut-triggered open/close → no animation.

### 2.2 Easing — Replace All Defaults

Current state: `transition: all 300ms` and `ease-in` patterns exist throughout.

Add to `globals.css`:

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
```

| Before | After | Why |
|---|---|---|
| `transition: all 300ms` | `transition: transform 200ms var(--ease-out), opacity 200ms var(--ease-out)` | `all` animates layout props; specify exact |
| `ease-in` on dropdowns | `var(--ease-out)` | `ease-in` starts slow — feels sluggish |
| `300-500ms` on UI elements | `150-250ms` | Faster = more responsive |
| Default `ease` on modals | `var(--ease-out)` enter, `150ms ease-in` exit | Asymmetric: slow in, fast out |

### 2.3 Button Active State

Add to all pressable elements (buttons, cards with onClick, tab triggers):

```css
.button {
  transition: transform 160ms var(--ease-out);
}
.button:active {
  transform: scale(0.97);
}
```

In Tailwind: `active:scale-[0.97] transition-transform duration-[160ms]`

### 2.4 Modal / Sheet Animations — Fix Origin

| Before | After | Why |
|---|---|---|
| `scale(0)` enter | `scale(0.95) opacity(0)` enter | Nothing appears from nothing |
| `transform-origin: center` on popovers | `transform-origin: var(--radix-popover-content-transform-origin)` | Scale from trigger, not center |
| Modal `transform-origin` | Keep `center` | Modals not anchored to trigger |

### 2.5 Tab Switching — clip-path Technique

Current tab color transitions feel abrupt. Implement duplicate-list clip-path pattern:

```css
.tabs-active-overlay {
  /* active styling */
  clip-path: inset(0 var(--right-inset) 0 var(--left-inset) round 6px);
  transition: clip-path 200ms var(--ease-out);
}
```

Result: seamless color transition that spans the indicator moving — no individual color toggle flicker.

### 2.6 Tooltip Instant-on-Subsequent-Hover

```css
.tooltip {
  transition: transform 125ms var(--ease-out), opacity 125ms var(--ease-out);
}
.tooltip[data-instant] {
  transition-duration: 0ms;
}
```

First tooltip: delay + animate. Adjacent tooltips: instant open. Entire toolbar feels faster.

### 2.7 Stagger on List Entry

Dashboard stat cards and employee list rows currently appear simultaneously.

```css
.list-item {
  animation: fadeUp 300ms var(--ease-out) both;
}
.list-item:nth-child(1) { animation-delay: 0ms; }
.list-item:nth-child(2) { animation-delay: 40ms; }
.list-item:nth-child(3) { animation-delay: 80ms; }
.list-item:nth-child(4) { animation-delay: 120ms; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

Stagger ≤ 50ms between items. Never block interaction during stagger.

### 2.8 prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Opacity/color transitions survive (aid comprehension). Transform-based motion removed.

### 2.9 Framer Motion → CSS for Tab Animations

If any Vercel-style tab indicator uses Framer Motion `x`/`y` props, switch to `transform: translateX()` string or pure CSS. Main thread drops frames during navigation.

---

## Priority 3 — Consistency Fixes

### 3.1 Spacing Scale

Standardize to two values only:
- Card body: `p-4` mobile, `p-6` sm+
- Section gap: `gap-4` mobile, `gap-6` sm+
- Remove all `p-3.5` (non-standard)

**Files:** `employees/page.tsx`, `attendance-logs/page.tsx`, `field-officers/page.tsx`, all `*-panel.tsx`

### 3.2 Icon Size Scale

| Context | Size |
|---|---|
| Inline text prefix | `h-3.5 w-3.5` |
| Button icon | `h-4 w-4` |
| Card/section icon | `h-5 w-5` |
| Feature hero icon | `h-6 w-6` |

Remove `h-3` and `h-7`.

### 3.3 Loading States — Unify

- Lists/tables → skeleton (matches content shape)
- Button actions → inline spinner inside button
- Full-page auth loading → centered `<Loader2>` brand blue
- Kill all `isLoading && <div>Loading...</div>` plain text

### 3.4 Empty States — Component

Create `src/components/ui/empty-state.tsx`:

```tsx
<EmptyState
  icon={ClipboardList}
  title="No records found"
  description="..."
  action={<Button>...</Button>}
/>
```

Use in: attendance-logs, employees, work-orders-panel, visit-reports-panel, training-reports-panel.

---

## Priority 4 — Visual Polish

### 4.1 Form Input Focus

```css
/* globals.css */
[data-slot="input"]:focus-visible,
[data-slot="textarea"]:focus-visible {
  --tw-ring-color: #014c85;
  border-color: #014c85;
}
```

Apply to `Select`, `Combobox`, `DatePicker` triggers.

### 4.2 Card Depth System

- Primary stat cards: `shadow-md border-l-4 border-l-[#014c85]`
- Secondary info cards: `shadow-sm` (current default)
- Nested inner panels: `bg-muted/40 shadow-none border`

### 4.3 Table Row Hover

```css
tbody tr {
  transition: background-color 100ms ease;
}
tbody tr:hover {
  @apply bg-muted/40;
}
```

### 4.4 Touch Device Hover Guard

Wrap all hover animations:

```css
@media (hover: hover) and (pointer: fine) {
  .card:hover { transform: translateY(-1px); }
}
```

No ghost hover on tap.

### 4.5 Status Badge Colors — Semantic

| Status | Style |
|---|---|
| active / present / approved | `bg-green-50 text-green-700 border-green-200` |
| inactive / absent | `bg-red-50 text-red-700 border-red-200` |
| pending / on-leave | `bg-amber-50 text-amber-700 border-amber-200` |
| off-duty / draft | shadcn secondary (keep) |
| district / client name chips | brand variant (Priority 1.3) |

---

## Priority 5 — Dark Mode Audit

- Any hardcoded `text-gray-*`/`bg-gray-*` that doesn't flip → replace with semantic tokens
- Status badge backgrounds → add `dark:` variants for green/red/amber
- Brand blue `#014c85` on dark backgrounds → check contrast, may need `#4a9ade` variant
- Skeleton → confirm uses `bg-muted` not `bg-gray-200`

---

## Implementation Order

| Step | Area | Effort |
|---|---|---|
| 1 | Login rebrand (1.1) | 2–3 hr |
| 2 | Custom easing vars + `transition: all` sweep (2.2) | 1 hr |
| 3 | Button `active:scale` global (2.3) | 30 min |
| 4 | `prefers-reduced-motion` gate (2.8) | 15 min |
| 5 | Touch hover guard (4.4) | 15 min |
| 6 | Semantic status badges (4.5) | 1 hr |
| 7 | Modal/popover origin fix (2.4) | 1 hr |
| 8 | Spacing scale fix (3.1) | 1–2 hr |
| 9 | Form input focus (4.1) | 30 min |
| 10 | Exo 2 expansion (1.2) | 1 hr |
| 11 | Animation frequency audit (2.1) | 1 hr |
| 12 | Stagger on list entry (2.7) | 1 hr |
| 13 | Tooltip instant-on-subsequent (2.6) | 1 hr |
| 14 | Tab clip-path transition (2.5) | 2 hr |
| 15 | Empty state component (3.4) | 2 hr |
| 16 | Loading state unification (3.3) | 2–3 hr |
| 17 | Icon size standardisation (3.2) | 1–2 hr |
| 18 | Card depth system (4.2) | 1 hr |
| 19 | Table row hover (4.3) | 15 min |
| 20 | Brand color tightening (1.3) | 1 hr |
| 21 | Dark mode audit (Priority 5) | 3–4 hr |

**Total estimated:** ~25–30 hr

---

## What NOT to Change

- HSL CSS variable architecture — already best-in-class
- Mobile edge-to-edge `-mx-4 px-4` scroll technique
- Geist Sans for body text
- ShadCN component base — extend, don't replace
- Brand colors `#014c85` / `#bd9c55` — apply more, not less
