# Design System: CISS Workforce

Semantic design language for the CISS Workforce web platform (Next.js 15 + Tailwind + ShadCN, `https://cisskerala.site`). This file is the single source of truth for screen generation and future UI work — Google Stitch format. Source of record: `src/app/globals.css`, `tailwind.config.ts`, `src/components/ui/*`, `src/components/layout/*`.

## 1. Visual Theme & Atmosphere

A restrained operations-grade interface with confident asymmetry and quiet motion. The atmosphere is clinical yet warm — like a well-lit security operations centre. Density is "Daily App Balanced" (5/10): dense data surfaces (tables, dashboards, payroll) offset by generous whitespace and composed empty states. Variance is "Offset Asymmetric" (6/10): page headers split title/actions, dashboards use staggered stat grids and asymmetric hero rows, never centered marketing layouts. Motion is "Fluid CSS" (5/10): spring curves, staggered reveals, perpetual micro-loops only on live status elements (pulse dots, shimmer skeletons) — never decorative noise.

## 2. Color Palette & Roles

One brand blue + one gold accent. No purple/blue neon, no pure black.

- **Canvas** (`--background` hsl(208 33% 97%)) — page background, blue-tinted near-white
- **Pure Surface** (`--card` / `--popover` hsl(0 0% 100%)) — cards, dialogs, sheets
- **Brand Blue** (`--primary` #014c85, hsl(206 98% 26%)) — primary actions, active nav, links, focus rings, info accents. Dark mode: hsl(204 78% 57%)
- **Brand Gold** (`--accent` #bd9c55) — the single decorative accent: award CTAs, sidebar active dot, PageHeader marker. Used sparingly
- **Charcoal Ink** (`--foreground` hsl(207 52% 13%)) — primary text
- **Muted Steel** (`--muted-foreground` hsl(207 13% 42%)) — secondary text, metadata, descriptions
- **Whisper** (`--muted` hsl(207 25% 94%), `--border` hsl(207 22% 87%)) — fills and 1px structural lines
- **Success** (green hsl(142 71% 35%)) — active status, positive trends, success alerts
- **Destructive** (red hsl(0 72% 51%)) — errors, negative trends, destructive actions
- **Warning** (amber hsl(38 92% 50%) for fills/dots; `--warning-strong` hsl(28 87% 37%) for warning TEXT legibility on light surfaces)
- **Sidebar** — surface-tinted variants of the above for the app shell

**Banned:** raw Tailwind color families (`text-green-600`, `bg-amber-50`, `bg-slate-100`, …) anywhere in page code — status hues must come from the semantic tokens above so dark mode adapts automatically. Leaflet map markers are the single allowed exception (literal hex mirroring token hues: success `#15803d`, destructive `#dc2626`, primary `#014c85`, warning `#d97706`, gold `#bd9c55`).

## 3. Typography Rules

- **Display:** `Exo 2` (`font-exo2`) — page titles, section h3s, wizard title, profile-name headers. Track-tight (`tracking-[-0.035em]`), weight-driven hierarchy, never screaming
- **Body:** `Lato` (`--font-ciss-body`, `font-sans`) — relaxed leading, `max-w-[65ch]` on descriptions, `text-muted-foreground` for secondary
- **Mono:** `Geist Mono` — tabular numbers, IDs, timestamps, data-heavy cells (`tabular-nums`)
- **Micro-labels:** `text-[10px] font-bold uppercase tracking-[0.16em–0.2em]` for eyebrows/section labels
- **Banned:** generic serifs, `Inter`, system-ui fallback as primary in premium contexts

## 4. Component Stylings

- **Page headers:** always `PageHeader` (`src/components/layout/page-header.tsx`) — eyebrow, breadcrumbs, Exo 2 title, optional gold accent marker, actions slot, `backHref` for detail pages. No hand-rolled `<h1>` headers
- **Buttons** (`ui/button`): flat, no outer glow, `active:scale-[0.97]` tactile press, `bg-primary hover:bg-primary/90` default; outline/secondary/ghost/destructive variants; `size="lg"` instead of manual padding overrides. Gold (`bg-brand-gold`) reserved for awards
- **Cards** (`ui/card`): generous `rounded-lg` (0.875rem), `shadow-card` (brand-tinted, 1px depth), borders `border-border/80`. `Card` with `variant="interactive"` for clickable cards. In data-dense areas use `operations-panel`/`operations-row` divider rows instead of nested cards
- **Badges** (`ui/badge`): `rounded-full`, `text-[11px] font-bold`. Semantic variants `success` / `warning` / `info` / `error` + status variants `active` / `inactive` / `leave` / `exited`, all token-based (dark-mode safe)
- **Inputs/Selects:** shadcn components only — native `<select>` is banned; use `Select`. Label above, error below, focus ring in `--primary`
- **Loaders:** composed `PageLoading` (`components/common/page-loading.tsx`) — brand icon bubble + shimmer bars + label. Skeletons (`.skeleton`/`animate-shimmer`) match layout dimensions. Bare centered spinners banned
- **Empty states:** composed, bordered (`border-dashed`) blocks with icon + guidance, not bare "No data" text
- **Tables:** `ui/table`, `tbody tr:hover` muted row tint, tabular numerals for numeric columns
- **Dialogs/Sheets/Toasts:** shadcn primitives; dark overlays (`bg-slate-950/45`) are the deliberate exception to the no-black rule; destructive toast close controls use `destructive-foreground` tokens

## 5. Layout Principles

- CSS Grid over flexbox math; no `calc()` percentage hacks. Container max-widths (`max-w-3xl/5xl`) centered on form pages
- Page shells: `page-content` (flex column gap) inside the app shell; sidebar navigation collapses to mobile bottom nav + drawer
- Mobile-first collapse below `md`/768px: multi-column grids → single column, actions stack full-width, horizontal scroll only for chip rows (`scrollbar-none`)
- Touch targets ≥ 44px (`min-h-touch`, `.touch-target` 48px); safe-area utilities (`pb-safe` etc.) on mobile surfaces
- No overlapping/absolute-stacked content; every element owns its spatial zone
- Radii from the token scale only: `sm`/`md`/`lg` = radius ± 2/4px, `xl` 0.75rem, `2xl` 1rem, `rounded-full` for pills

## 6. Motion & Interaction

- **Curves:** Emil Kowalski set — `--ease-out` cubic-bezier(0.23,1,0.32,1), `ease-spring` cubic-bezier(0.16,1,0.3,1), `ease-drawer` for sheets. No linear easing
- **Reveals:** `animate-slide-down` page headers, `animate-slide-up` stat cards with `.stagger-1..4` cascades, `animate-scale-in`/`scale-bounce` dialogs
- **Perpetual micro-loops:** live status pulse dots (`animate-ping` on the PageLoading badge, `status-dot` colors), shimmer skeletons. Restrained — no decorative looping elsewhere
- **Interactions:** `card-interactive` hover lift (border tint + shadow), `press-scale`/`active:scale-[0.97]` tactile presses, `transition-colors duration-150` on links
- **Performance:** transform/opacity animations only; `prefers-reduced-motion` globally disables animation; hover transforms gated off touch devices
- **Icons:** Phosphor family everywhere; icon + short label pattern on buttons; inline icon bubbles `stat-icon` (h-10 w-10 rounded-xl)

## 7. Anti-Patterns (Banned)

- Emojis anywhere in UI (medals/trophies/checks are Phosphor icons)
- Raw Tailwind color families in pages/components (tokens only)
- `Inter`, generic serifs, pure black text
- Neon/outer-glow shadows; default gray-based Tailwind shadows (`shadow-sm/md/lg`) — use `shadow-brand-*`
- Bare centered spinner loaders; "Loading..." text without skeleton structure
- Hand-rolled page headers, native `<select>` elements
- Centered hero sections; 3-equal-card feature rows; overlapping absolute content
- AI copywriting clichés ("Elevate", "Seamless", "Unleash", "Next-Gen"); filler UI text ("Scroll to explore")
- Generic placeholder names ("John Doe", "Acme") and fake round numbers
- Hard-coded hex in components (Leaflet markers excepted)
