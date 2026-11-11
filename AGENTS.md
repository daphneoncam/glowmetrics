# CamCash Codex Instructions

These instructions apply to the entire CamCash repository.

## Mandatory pre-work

Before making changes:

1. Read this entire `AGENTS.md`.
2. Read `docs/CAMCASH_GUARDRAILS.md`.
3. If touching UI/design, also read `docs/CAMCASH_DESIGN_SYSTEM.md`.
4. If touching analytics, formulas, sessions, fans, timing, platforms, Stream Planner, Live Mode, or derived metrics, also read `docs/CAMCASH_ANALYTICS_RULES.md`.
5. If touching plan gating, history limits, Free/Pro behavior, upgrade prompts, fan visibility, platform visibility, API access, selectors, or aggregates, also read `docs/CAMCASH_ENTITLEMENTS.md`.

These documents are authoritative for CamCash product behavior. Do not contradict or duplicate their rules locally.

## Non-negotiable rules

- Never invent formulas, thresholds, scores, classifications, recommendations, or insights.
- Never invent data to make a UI look complete.
- Missing data is not zero.
- Do not create page-specific replacements for canonical analytics.
- Free/Pro presentation and enforcement must agree.
- Free aggregates must be computed only from Free-entitled data.
- Test all changed analytics/UI in:
  - Free + low data
  - Free + high data
  - Pro + low data
  - Pro + high data
- Do not create generic SaaS UI. Follow CamCash’s existing design language and components.
- Do not use image generation as a substitute for understanding the product.
- Do not push directly to `main`.
- Use a dedicated branch/worktree for feature work.
- Assume another agent may be working in parallel.
- Treat shared analytics, entitlement, and global design files as protected.
- Do not modify production database/configuration directly without explicit approval.
- Do not merge or deploy while any required check is failing or pending.
- Never weaken, delete, skip, or loosen tests to obtain a green build.

## Stop instead of guessing

STOP and request approval if:
- a new formula is needed
- a new insight requires assumptions
- canonical analytics must change
- entitlement rules conflict or are ambiguous
- a shared file needs behavioral changes
- a database migration or production mutation is required
- a global UI primitive needs behavioral changes
- required tests reveal a conflict in existing rules
- you cannot verify whether data/insight/entitlement behavior is correct

Correctness is more important than completing the task autonomously.
