# CamCash Product, Data, and Release Guardrails

This document is mandatory for all CamCash engineering work.

## 1. Do not invent formulas

Do not create new formulas, thresholds, rankings, scores, performance bands, risk labels, recommendation rules, or derived metrics unless:

1. you searched the repository for an existing canonical implementation
2. you identified the current source of truth
3. you confirmed the requested metric is not already implemented
4. you reported the exact proposed formula
5. explicit approval was given

This applies to session performance, best platform/time, earnings/hour, typical session, fan tiers, dependency risk, plan-window matching, Stream Planner recommendations, trend scores, live pace, projected earnings, and any similar derived value.

If no canonical formula exists, STOP and report:
- Metric
- Why it is needed
- Existing related logic
- Proposed formula
- Minimum sample
- Null/unknown handling
- Outlier handling
- Timezone handling
- Plan impact
- Other pages affected

## 2. Do not invent data or insights

Never display an insight unless real stored or derived data supports it.

Do not fabricate:
- comparisons
- percentages
- trends
- recommendations
- fan behavior
- timing performance
- plan adherence
- session causes
- predicted outcomes
- “strong start”
- “weak session”
- “best time”
- “top driver”
- “high dependency”
- “returning fans helped”
- “Live Mode improved performance”

For each new insight, identify:
- source data
- calculation
- sample size
- fallback state

Use truthful fallback copy such as:
- Not enough data
- Unavailable
- Unknown
- Timeline unavailable
- Recommendation unavailable

## 3. Null is not zero

Distinguish:
- 0
- null
- undefined
- not available
- not enough data
- no activity
- not entitled

Never convert missing information to `$0`, `0m`, `0%`, or `0 tips` unless the underlying value is truly zero.

## 4. Canonical analytics are protected

Treat these as protected shared logic:
- sessionization
- meaningful-session filtering
- platform normalization
- creator timezone
- best-time analytics
- Stream Planner recommendation logic
- fan identity
- fan tiers
- dependency logic
- free/pro date gating
- earnings-rate calculations
- canonical datasets
- platform attribution
- historical aggregation
- plan-window matching where canonical
- creator-local date/day grouping

Reuse them. Do not fork them.

## 5. Timezone protection

All creator-facing day/hour/session-window calculations must use the creator timezone through existing canonical utilities.

Do not silently use browser-local, UTC, server-local, or raw `Date` grouping when canonical creator-local conversion exists.

Pay special attention to:
- midnight crossings
- DST
- day-of-week
- recommendation windows
- today/7d/30d boundaries

## 6. Rate calculation safety

Unknown duration:
- earnings still count toward total earnings
- session must not contribute to hourly-rate calculations

Do not:
- substitute zero duration
- create infinite rates
- convert missing rates to `$0/hr`
- infer full stream duration from tip timestamps unless already canonical and clearly labeled

## 7. Do not invent causation

Correlation is not causation.

Prefer:
- “associated with”
- “tends to”
- “in your recent sessions”
- “sessions matching this condition averaged…”

Do not say something “caused” higher earnings unless the product has a supported causal methodology.

## 8. Sample-size guards

Do not make strong analytical claims from tiny samples.

Reuse existing sample guards where available.

Any new insight must define:
- minimum sample
- comparison population
- fallback state
- insufficient-data copy

Do not label something “typical” from one session.

## 9. Low-data / high-data coverage

Every changed analytics feature, dashboard section, insight, comparison, or entitlement path must support:

1. Free + low data
2. Free + high data
3. Pro + low data
4. Pro + high data

### Low-data accounts

May have:
- 1–2 sessions
- few tips
- one usable platform
- few returning fans
- no whales
- no private sessions
- unknown duration
- no recommendation history
- only imported data
- no meaningful comparison set

For low-data accounts:
- do not invent trends or “typical” values
- do not classify over/underperformance without sufficient baseline
- do not show fake confidence
- do not replace unavailable insights with zeroes
- keep the page useful with descriptive truth

Useful low-data information can include:
- actual earnings
- known duration
- platform
- fan contributors
- tip count
- private/public split if known
- saved plan match if objectively known
- Live Mode data
- raw session history

### High-data accounts

May have:
- hundreds/thousands of sessions
- years of history
- multiple platforms
- many fans
- large tip volumes
- rich Live Mode history
- large timelines

High-data implementations must:
- scale without repeated full-history work
- use pagination, controlled expansion, lazy detail rendering, or virtualization where appropriate
- avoid recomputing lifetime fan totals per row
- avoid recalculating full-history analytics on every render
- avoid unnecessary unlimited-history fetching
- keep large fan/session lists navigable

Performance optimizations must not change canonical results.

## 10. Shared-file collision rule

Assume another agent may be working in parallel.

If a task needs to edit a shared analytics/helper/design file, STOP before editing and report:

- File
- Why the task needs it
- Current behavior
- Proposed change
- Other pages using it
- Potential regression
- Feature-local alternative

Wait for approval.

## 11. Git isolation

Use a dedicated feature branch/worktree.

Do not:
- work directly on `main`
- push to `main`
- merge to `main`
- enable auto-merge
- force push
- reset shared branches
- rebase another active branch
- cherry-pick concurrent work without approval

Before editing, report:
- current branch
- current commit SHA
- working tree clean/dirty
- isolated worktree/environment status

If another agent appears to be using the same working directory, STOP.

## 12. Database and production freeze by default

Do not directly modify:
- production schema
- production SQL
- RLS
- policies
- triggers
- RPCs
- production functions
- production rows
- backfills
- production environment variables
- Stripe production settings
- Vercel production configuration

Do not create migrations merely because it is convenient.

If a production/database change appears necessary, report the exact change and STOP for approval.

## 13. No unpassed checks to production

No code is production-ready unless all applicable required checks pass.

This includes:
- feature tests
- analytics tests
- entitlement tests
- integration tests
- full test suite
- lint
- typecheck
- production build
- preview/deployment checks
- migration validation if applicable
- CI checks

If any check fails or remains pending:
- do not merge
- do not deploy
- report the failure and proposed fix

## 14. Never weaken tests to get green

Do not:
- delete tests
- skip tests
- mark failing tests TODO
- loosen assertions
- remove coverage
- change expected values solely to make tests pass
- disable CI
- bypass required status checks
- remove integrity guards

A failing test is information.

## 15. Required release report

Before saying work is ready, report:

- Branch
- Base commit
- Final commit
- Files changed
- Canonical analytics modified: YES/NO
- Entitlement logic modified: YES/NO
- Database modified: YES/NO
- Production modified: YES/NO
- Shared components modified: YES/NO
- Free-plan behavior tested: PASS/FAIL
- Pro-plan behavior tested: PASS/FAIL
- Leakage tests: PASS/FAIL
- Feature tests: PASS/FAIL
- Analytics tests: PASS/FAIL
- Integration tests: PASS/FAIL
- Full suite: PASS/FAIL
- Lint: PASS/FAIL
- Typecheck: PASS/FAIL
- Build: PASS/FAIL
- Preview: PASS/FAIL
- Known risks
- Shared-file overlap

Do not describe work as production-ready if any required check is failing or pending.
