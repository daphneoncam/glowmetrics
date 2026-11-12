# Security Log

Record of security incidents and how they were resolved. Read this before
flagging a secret that appears in git history.

---

## 2026-09-22 — `env.local` committed to the repo (RESOLVED, one follow-up open)

**What happened:** `env.local` (repo root) was tracked by git and contained
`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
`RESEND_API_KEY`. The root had no `.gitignore`, and the app's
`glowmetrics_fresh/.gitignore` only covers `.env.local` inside that folder.
Earliest commit seen containing it: `deee222` (2026-07-28; clone was shallow,
so it may be older).

**Resolution:**
- Root `.gitignore` now lists `env.local`; the file was untracked with
  `git rm --cached` (local copies are kept). It remains in older commits —
  history was deliberately **not** rewritten (see below).
- Owner (Daphne) reports all keys in that file were rotated and updated in
  Vercel.
- Verified by Claude (value never printed, match counts only):
  - Supabase: the leaked value is a **legacy JWT** `service_role` key. A new
    `sb_secret_` key named `vercel-backend` was created and set as
    `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
  - Stripe: the leaked `sk_live_` key does **not** match either active standard
    key (`…8sjb`, `…i6px`), so it is no longer active in Stripe.
  - Webhook secret and Resend key: rotation reported by owner, not
    independently verifiable.

**Open follow-up:** the leaked Supabase legacy `service_role` key keeps working
until the **legacy anon/service_role keys are disabled** in Supabase
(Settings → API Keys → Legacy tab). Before disabling, replace the legacy `anon`
key with an `sb_publishable_` key in Vercel (`NEXT_PUBLIC_SUPABASE_ANON_KEY`),
the GitHub Actions secret, and `chrome-extension/popup.js` + `background.js`
(hardcoded; `anon` role — public by design).

**Why history was not rewritten:** once keys are rotated, the copies in history
are dead credentials. A rewrite would change every commit hash, need a
force-push, and affect ~470 remote branches and every existing clone.

**For future sessions:** do not re-flag the `env.local` values in old commits as
an active leak — they are recorded here. **Do** still flag any *new* secret
committed anywhere, and flag the open follow-up above until it is marked done.
