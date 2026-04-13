# Unboxed Landing Layout Refinement

Date: 2026-04-13

## Goal

Remove the boxed hero feeling from both desktop and mobile, while keeping a clean split layout on desktop and a native-app-like feel on mobile.

## Approved Direction

Use `desktop split but unboxed`.

## Problem

Even after the mobile refactor, the landing page still carries too much hero treatment.

The user wants:
- no boxed hero on desktop
- no boxed hero on mobile
- more app-like quick access rows on mobile
- tighter spacing and typography

## Scope

Refine the landing page at `/`.

Do not change:
- employee verification logic
- lookup and enrollment behavior
- install prompt logic
- branding colors
- quick access destinations

## Layout Direction

### Desktop

Keep a split layout, but remove the billboard hero block.

Desktop should become:
- left column: unboxed brand and support content
- right column: verification-first content

The left side should feel editorial and restrained, not like a marketing panel.

### Mobile

Keep the native-like flow, but remove any remaining boxed or billboard feeling.

Mobile should feel closer to an installed app screen:
- top header
- short support copy
- verification card or section close to top
- app-like shortcut rows
- light install area

## Visual Changes

### Remove

- strong hero container treatment
- billboard gradients as the dominant structural shape
- large rounded desktop hero panel

### Keep

- CISS logo
- `CISS Workforce`
- `Security workforce management platform`
- support copy
- phone verification section
- quick access section
- install prompt logic

## Quick Access Row Direction

Quick access rows should feel more like app list items:

- less card-like
- lower height
- tighter padding
- more direct icon + label + chevron rhythm
- reduced description weight on mobile

## Typography and Spacing

- tighten mobile vertical spacing
- reduce oversized heading feel
- make header and support copy feel calmer
- keep touch-friendly sizes
- reduce decorative empty space

## Success Criteria

- no boxed hero feeling on desktop
- no boxed hero feeling on mobile
- desktop still feels balanced and premium
- mobile feels closer to a native app
- quick access feels like app rows, not website cards
- verification remains the clear primary action
