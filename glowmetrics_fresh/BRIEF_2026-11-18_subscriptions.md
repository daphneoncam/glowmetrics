# Brief — 2026-11-18 — Supabase/Vercel subscriptions and GitHub plan

## New tasks (most important first)
1. Decide on the GitHub plan. Pro is recommended if the repo goes private, because it adds branch protection and more Actions minutes.
2. Set up staging: a Supabase branch or a separate staging project for Vercel previews, so previews never write to production user data.
3. Supabase Pro: check that daily backups are on and decide whether to add point-in-time recovery (PITR). Do one test restore. Set up custom SMTP through Resend for auth emails. Keep the spend cap on.
4. Vercel Pro: turn on spend management and protection for preview deployments. Turn on Speed Insights and Analytics, plus alerts for runtime errors.
5. Optional: let Claude audit the Supabase and Vercel settings through the connected tools. This is read-only unless you approve changes.

## Completed this chat
- Reviewed the repo's stack: Next.js on Vercel, Supabase, Stripe, Resend, and 10 GitHub Actions workflows.
- `env.local`: you confirmed it holds old keys that no longer work. With your approval, every value is now masked as `*****` plus the last 4 characters. No code reads this file.

## In progress
- Waiting for your decision on the GitHub plan (#1).
