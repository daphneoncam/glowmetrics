# CamCash Design System and UI Guardrails

This document governs product UI work. The existing repository remains the primary visual reference.

## Core principle

Do not create a generic SaaS dashboard.

A design that could be dropped into another analytics product with only the logo changed is not specific enough to CamCash.

## Existing visual direction

Preserve where established in the repository:

- near-black / deep dark canvas
- restrained glass surfaces
- pink `#FF2BAE`
- purple `#7C5CFF`
- cyan/blue `#16F4FF → #55B8FF`
- selective ambient glow
- existing card radii
- existing hover lift/glow behavior
- existing typography
- existing spacing rhythm
- existing buttons, badges, tabs, charts, and selection states

Do not introduce a second design system.

## Repository-first design

Before changing UI, inspect:
- dashboard shell
- Command Center
- Platforms
- Sessions
- Fans
- Stream Planner
- Live Mode
- shared cards
- buttons
- tabs
- badges
- charts
- empty states
- global CSS
- responsive rules

Use actual component/file evidence.

## No generic UI

Do not introduce:
- default Tailwind dashboards
- generic fintech cards
- random glassmorphism
- arbitrary gradient families
- random pills/badges
- oversized decorative whitespace
- unrelated “premium analytics” patterns
- generic AI-generated mockups
- visual language inconsistent with neighboring CamCash pages

## Typography

Do not invent new fonts, type scales, weights, letter spacing, or heading systems without repository evidence.

Inspect the actual project first.

Do not solve layout problems by shrinking text below readable sizes.

## Spacing

Do not invent arbitrary spacing values for one page.

Inspect:
- content gutters
- section gaps
- card padding
- grid gaps
- vertical rhythm

Match surrounding dashboard pages.

## Components

Before creating a new:
- card
- panel
- tab
- badge
- filter
- drawer
- modal
- chart treatment
- button
- metric strip
- empty state

search for an existing CamCash equivalent.

Prefer:
1. reuse
2. composition
3. feature-local wrapper
4. new component only when necessary

## Icons

Do not use decorative emojis for analytical UI.

Use the icon approach already present in the repository.

Do not add a new icon library solely for one page without approval.

## Empty states

Design explicit states for:
- no data
- no activity today
- insufficient comparison history
- unknown duration
- missing timestamps
- no recommendation
- no attributable fan
- partial/error state
- not entitled

Do not convert missing values into zeroes.

## Responsive behavior

Do not just stack everything blindly.

Define priority on smaller screens.

Preserve:
- primary status
- key metrics
- selected/active entity
- relevant plan state
- top drivers
- evidence/why

Collapse or defer secondary detail.

## Accessibility

Maintain:
- readable contrast
- keyboard navigability
- visible focus states
- semantic buttons/tabs
- text labels in addition to color
- reduced-motion support
- non-hover-only access to important information

## Visual proof

Do not generate concept images for product design.

Use:
- the actual repository
- the actual dev/preview build
- screenshots of the implemented application

The product itself is the design reference.
