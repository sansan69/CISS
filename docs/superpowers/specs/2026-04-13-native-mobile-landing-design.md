# Native Mobile Landing Refactor

Date: 2026-04-13

## Goal

Refactor the landing page so it feels like a native mobile app on phones instead of a desktop website squeezed into a mobile screen.

## Approved Direction

Use a `PWA neutral` mobile style.

This means:
- clean on both Android and iPhone
- no heavy platform imitation
- no oversized hero blocks
- compact, app-like spacing and hierarchy

## Problem

The current landing page still uses a large hero panel that behaves like a website banner.

On mobile this causes:
- too much vertical space used by branding
- the verification action pushed too far down
- a web-style first impression instead of an app-style first impression

## Scope

Refactor the landing page at `/` only.

Do not change:
- employee lookup logic
- enrollment redirect behavior
- install prompt logic
- quick access destinations
- branding colors or logo

## Mobile Design Direction

### Remove on mobile

- giant boxed hero treatment
- oversized headline block
- wide desktop-style two-panel composition

### Replace with

1. Slim top app header
   - logo
   - `CISS Workforce`
   - `Security workforce management platform`

2. Verification-first content
   - mobile number label
   - input
   - main verify button

3. Compact quick access rows
   - attendance
   - guard portal
   - admin login

4. Small install surface
   - visually light
   - secondary priority

## Desktop / Larger Screen Behavior

Desktop can still keep a richer split layout, but it should also be cleaner.

The mobile-specific requirement is stronger:
- no dominant boxed hero
- verification must feel like the first app action

## Interaction Style

The page should feel closer to an installed app home screen:

- tighter spacing
- calmer typography scale
- fewer decorative containers
- less marketing hero language
- more immediate task flow

## Visual Rules

- preserve official blue/gold brand language
- reduce large rounded billboard sections on mobile
- use softer section separation instead of giant cards
- keep interface touch-friendly
- keep first screen focused on verification

## Information Hierarchy

On mobile, the first visible stack should be:

1. app header
2. short headline or supporting line
3. phone verification input
4. verify button
5. compact shortcuts

## Success Criteria

- mobile landing page feels native-like
- no large desktop-style box dominating the viewport
- verification starts near the top on phones
- quick actions stay available but visually secondary
- page still feels branded and professional
