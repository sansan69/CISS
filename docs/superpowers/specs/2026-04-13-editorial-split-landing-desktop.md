# Editorial Split Landing Desktop

Date: 2026-04-13

## Goal

Fix the desktop landing page so it feels clean, modern, and professional instead of looking like a boxed marketing banner.

## Approved Direction

Use `editorial split`.

## Problem

The current desktop landing page still feels visually heavy.

Main issues:
- the top brand bar and hero area compete with each other
- the large blue slab still dominates the screen
- too much empty blue space
- the desktop composition feels like an old website banner instead of a modern product entry screen

## Scope

Refine the landing page at `/`.

Do not change:
- mobile verification logic
- lookup and enrollment behavior
- install prompt logic
- quick access destinations
- existing brand colors

## Layout Direction

### Desktop

Desktop should become a clean two-column editorial split:

- left column:
  - logo
  - `CISS Workforce`
  - `Security workforce management platform`
  - one restrained headline
  - one short support line
- right column:
  - primary verification card
  - quick access rows
  - install surface

Desktop should feel like a premium enterprise product, not a marketing splash screen.

### Mobile

Keep the current native-like mobile direction.

Mobile should stay:
- verification-first
- compact
- app-like
- free from large billboard treatment

## Visual Changes

### Remove

- large blue desktop hero slab
- duplicated brand treatment across top bar and hero
- oversized decorative empty space
- any remaining billboard-style desktop container

### Keep

- CISS logo
- brand colors
- light premium background
- verification-first hierarchy
- compact app-like quick access section

## Composition Rules

- desktop left side should be text-led and restrained
- desktop right side should carry the operational UI
- no giant boxed panel behind desktop headline
- use blue and gold as accents, not as a full-width block
- preserve strong spacing and clarity

## Typography

- reduce oversized desktop headline feel
- keep strong hierarchy
- make copy feel sharper and more enterprise

## Success Criteria

- desktop no longer looks like a boxed hero banner
- layout feels balanced and intentional
- left column feels calm and premium
- right column feels like the actual app entry point
- mobile experience remains native-like
- verification stays the strongest action
