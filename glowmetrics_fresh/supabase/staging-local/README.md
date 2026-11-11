# Local staging ($0, no Supabase account changes)

A throwaway copy of CamCash's database structure that runs inside a dev
machine or cloud session with Docker. **It never connects to production and
holds no production data.** It is used to test the real browser → `/api/upload`
→ database → Sessions/Platforms path.

## What is here
| Path | What |
|---|---|
| `schema/01_tables.sql` | The 14 tables the dashboard and import use: columns, constraints, indexes, RLS, policies. Generated read-only from production's catalog on 2026-11-11. No rows. |
| `schema/02_functions_small.sql` | Helper functions and triggers the import/sign-up path needs. |
| `schema/fingerprint.sql` | Run on staging and on production; matching hashes prove the structure matches. |
| `fixtures/` | Synthetic test files with known totals (no real people). The pseudonymised real BongaCams export lives in `lib/__tests__/fixtures/real-exports/`. |
| `browser/` | Playwright scripts: log in, upload through the real Import CSV screen, take Sessions/Platforms screenshots at 1440 and 390 px. They refuse any host other than localhost. |

The two import functions are loaded from
`supabase/migrations/20261101_harden_dedup_rpc_grants.sql` (lines 61–248),
which is byte-identical to production's live bodies.

## Deliberately left out
`get_user_insights` (dashboard handles its absence), the Live Mode entitlement
chain, studios (`is_linked_studio_admin` is stubbed to false), the welcome-email
trigger, and `error_events` (only telemetry writes there).

## Run
1. Start Docker. Then `npx supabase@2.48.3 init`, and in `supabase/config.toml` set `enabled = false` for realtime, studio, inbucket, storage, analytics and edge_runtime.
2. Run `npx supabase@2.48.3 start -x imgproxy,vector,postgres-meta,supavisor`.
3. Load the schema, all against `postgresql://postgres:postgres@127.0.0.1:54322/postgres`:
   - `schema/01_tables.sql`
   - `schema/02_functions_small.sql`
   - the import functions: lines 61–248 of `migrations/20261101_harden_dedup_rpc_grants.sql`, wrapped in BEGIN/COMMIT.
4. Run the app with ONLY local values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env`, then `npx next dev -p 3100`. Do not set Stripe, Resend or Telegram keys.
5. Create test users with the local Auth admin API. Then insert their `beta_users` rows with `onboarding_complete = true` so the dashboard opens.
6. Upload with `node browser/pw_upload.js <email> BongaCams <file>…` (set `NODE_PATH=$(npm root -g)`).
7. Clean up with `npx supabase@2.48.3 stop --no-backup`.

## Known totals (independent oracle)
| File | Rows | Expected USD |
|---|---:|---:|
| `bc_40_one_token_*.tsv` | 40 | $1.00 at 4 dp. Stored $1.20 while `insert_tips_dedup` still rounds to cents. |
| `bc_with_corrupt_row.tsv` | 3 of 4 | $0.80. One row rejected and reported. |
| `cb_tokens.csv` | 3 | $5.20 |
| `mfc_tokens.csv` | 2 | $25.35 |
| real export (pseudonymised) | 406 | $60.55, 2,636 tokens |
