#!/usr/bin/env bash
# Rehearse supabase/proposed/20261111_insert_tips_dedup_keep_4dp.sql (and its
# rollback) against a DISPOSABLE local Postgres. NEVER point this at
# production or staging.
#
# Usage: PGHOST=/path/to/socket PGPORT=54399 ./run.sh
#
# Builds the production shape from the import_rpc_hardening mirror + the live
# 20261101 function body + the 20261029d tips.usd numeric(12,4) widening, then
# proves: the bug on the live body, the fix, unchanged dedup/conflict handling
# (including rows stored at 2 dp before the change), unchanged derivation and
# filtering, unchanged paid-sessions function, rollback, and safe re-run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"   # glowmetrics_fresh/supabase
MIRROR="$ROOT/tests/import_rpc_hardening/00_mirror.sql"
SEED="$ROOT/tests/import_rpc_hardening/10_seed.sql"
LIVE="$ROOT/migrations/20261101_harden_dedup_rpc_grants.sql"
MIG="$ROOT/proposed/20261111_insert_tips_dedup_keep_4dp.sql"
RB="$ROOT/rollbacks/20261111_insert_tips_dedup_keep_4dp.rollback.sql"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
DB=insert_tips_4dp_rehearsal
LIVE_MD5=697af8bff40087433588302799d1d03e
NEW_MD5=f857f3f7619fc789c2a617487a7a132f
P=00000000-0000-0000-0000-00000000000c   # Pro creator from the seed (no platform cap)
FAILS=0

case "${PGHOST:-}" in
  *supabase.co*|*supabase.com*) echo "Refusing to run against a Supabase host." >&2; exit 2 ;;
esac

q() { "${PSQL[@]}" -d "$DB" -tA -c "$1"; }
check() { if [ "$1" = "$2" ]; then echo "PASS: $3"; else echo "FAIL: $3 (got '$1', want '$2')"; FAILS=$((FAILS+1)); fi; }
step() { echo; echo "== $*"; }
md5fn() { q "SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid='public.$1'::regprocedure"; }
# Insert n tips through the RPC as service_role. usd may be 'null' (derive from tokens).
ins() { # user prefix platform tokens usd n start_ts
  q "SELECT (public.insert_tips_dedup(j))->>'inserted' FROM (SELECT set_config('request.jwt.claim.role','service_role',false)) r,
     (SELECT jsonb_agg(jsonb_build_object('user_id','$1','date_time',('$7'::timestamptz + (g||' minutes')::interval),
       'platform','$3','username','$2'||g,'tokens',$4,'usd',$5)) j FROM generate_series(1,$6) g) x"; }
# Exact prefix + sequence number only ('bc' must not also match 'bcd1').
sumu() { q "SELECT coalesce(sum(usd),0)::numeric(12,4) FROM public.tips WHERE user_id='$P' AND username ~ '^$1[0-9]+\$'"; }

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null

step "production shape"
"${PSQL[@]}" -d "$DB" -f "$MIRROR" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$SEED" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$LIVE" >/dev/null
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL'
-- tips.usd numeric(12,4), as 20261029d_widen_tip_usd_precision left production.
DROP INDEX public.tips_dedup_unique;
ALTER TABLE public.tips DROP COLUMN usd_rounded;
ALTER TABLE public.tips ALTER COLUMN usd TYPE numeric(12,4);
ALTER TABLE public.tips ADD COLUMN usd_rounded numeric GENERATED ALWAYS AS (round(usd, 2)) STORED;
CREATE UNIQUE INDEX tips_dedup_unique ON public.tips USING btree (user_id, username_lower, tokens, usd_rounded, date_time, tip_seq);
SQL
check "$(md5fn 'insert_tips_dedup(jsonb,uuid)')" "$LIVE_MD5" "live body fingerprint == production (CR-stripped)"
check "$(q "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid='public.tips'::regclass AND attname='usd'")" "numeric(12,4)" "tips.usd is numeric(12,4)"
PAID_MD5="$(md5fn 'insert_paid_sessions_dedup(jsonb)')"

step "bug on the live body"
check "$(ins $P base BongaCams 1 0.025 40 2026-03-01T00:00:00Z)" 40 "40 one-token BongaCams tips inserted"
check "$(sumu base)" "1.2000" "live body stores 40 x \$0.025 as \$1.20 (the bug)"

step "apply proposed migration"
"${PSQL[@]}" -d "$DB" -f "$MIG" >/dev/null
check "$(md5fn 'insert_tips_dedup(jsonb,uuid)')" "$NEW_MD5" "new body fingerprint"
check "$(md5fn 'insert_paid_sessions_dedup(jsonb)')" "$PAID_MD5" "insert_paid_sessions_dedup unchanged"
check "$(q "SELECT string_agg(grantee||':'||privilege_type, ',' ORDER BY grantee) FROM information_schema.routine_privileges WHERE routine_name='insert_tips_dedup'")" \
      "authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE" "grants unchanged"

step "precision"
check "$(ins $P bc BongaCams 1 0.025 40 2026-03-02T00:00:00Z)" 40 "40 one-token BongaCams tips (payout 0.025) inserted"
check "$(sumu bc)" "1.0000" "40 one-token BongaCams tips total \$1.00"
check "$(ins $P bcd BongaCams 1 null 40 2026-03-03T00:00:00Z)" 40 "40 one-token BongaCams tips with no usd inserted"
check "$(sumu bcd)" "1.0000" "derived from tokens: still \$1.00"
check "$(ins $P sub BongaCams 1 0.0234567 1 2026-03-04T00:00:00Z)" 1 "sub-cent payout inserted"
check "$(sumu sub)" "0.0235" "sub-cent payout kept at 4 dp"

step "Chaturbate / MyFreeCams unchanged"
check "$(ins $P cb Chaturbate 100 5 1 2026-03-05T00:00:00Z)" 1 "Chaturbate 100 tokens"
check "$(sumu cb)" "5.0000" "Chaturbate \$5.00"
check "$(ins $P cbd Chaturbate 3 null 1 2026-03-05T01:00:00Z)" 1 "Chaturbate 3 tokens, no usd"
check "$(sumu cbd)" "0.1500" "Chaturbate derived \$0.15"
check "$(ins $P mfc MyFreeCams 500 25 1 2026-03-05T02:00:00Z)" 1 "MyFreeCams 500 tokens"
check "$(sumu mfc)" "25.0000" "MyFreeCams \$25.00"

step "refunds / negatives / empty rows are not stored"
check "$(ins $P neg BongaCams -10 -0.24 1 2026-03-06T00:00:00Z)" 0 "negative tokens and usd: not inserted"
check "$(ins $P zero BongaCams 0 0 1 2026-03-06T01:00:00Z)" 0 "zero tokens and usd: not inserted"

step "duplicates and conflict handling"
check "$(ins $P bc BongaCams 1 0.025 40 2026-03-02T00:00:00Z)" 0 "re-importing the same 40 tips inserts nothing"
check "$(ins $P base BongaCams 1 0.025 40 2026-03-01T00:00:00Z)" 0 "rows stored at 2 dp before the change still dedup (usd_rounded 0.03 == 0.03)"
check "$(sumu base)" "1.2000" "pre-existing rows untouched"

step "rollback"
"${PSQL[@]}" -d "$DB" -f "$RB" >/dev/null
check "$(md5fn 'insert_tips_dedup(jsonb,uuid)')" "$LIVE_MD5" "rollback restores the live body"
check "$(sumu bc)" "1.0000" "rows inserted under the 4-dp body keep their values"
check "$(ins $P after BongaCams 1 0.025 40 2026-03-07T00:00:00Z)" 40 "insert after rollback"
check "$(sumu after)" "1.2000" "after rollback the old rounding is back (expected)"

step "safe re-run and preflight"
"${PSQL[@]}" -d "$DB" -f "$MIG" >/dev/null && "${PSQL[@]}" -d "$DB" -f "$MIG" >/dev/null
check "$(md5fn 'insert_tips_dedup(jsonb,uuid)')" "$NEW_MD5" "migration applied twice: same result"
"${PSQL[@]}" -d "$DB" -c "COMMENT ON FUNCTION public.insert_tips_dedup(jsonb,uuid) IS 'x'" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$RB" >/dev/null
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL'
-- Simulate an unexpected live body (drift): any other definition.
CREATE OR REPLACE FUNCTION public.insert_tips_dedup(tips jsonb, p_upload_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RETURN '{}'::jsonb; END; $function$;
SQL
if "${PSQL[@]}" -d "$DB" -f "$MIG" >/dev/null 2>&1; then check applied refused "preflight refuses an unexpected live body"; else check refused refused "preflight refuses an unexpected live body"; fi

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS"; else echo "$FAILS FAILED"; exit 1; fi
