#!/usr/bin/env bash
# Rehearse 20261105_harden_earnings_table_grants.sql against a DISPOSABLE local
# Postgres. NEVER point this at production or staging: 15_baseline.sql really
# truncates tables (inside rolled-back transactions) to prove the holes exist.
#
# Builds on the production-shaped import mirror (../import_rpc_hardening,
# captured 2026-11-01) plus 20261101 (applied in production), then sets the
# exact table/sequence ACLs read from production on 2026-11-05.
#
# Usage: PGHOST=/path/to/socket ./run.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"   # glowmetrics_fresh/supabase
BASE="$ROOT/tests/import_rpc_hardening"
MIG="$ROOT/migrations/20261105_harden_earnings_table_grants.sql"
RB="$ROOT/rollbacks/20261105_harden_earnings_table_grants.rollback.sql"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
DB=earnings_grants_rehearsal
LOG="$(mktemp)"

case "${PGHOST:-}" in
  ""|*supabase.co*|*supabase.com*) echo "Refusing: set PGHOST to a local socket directory (never a Supabase host)." >&2; exit 2 ;;
esac

run() { "${PSQL[@]}" -d "$DB" -f "$1" 2>&1 | tee -a "$LOG" | grep -E 'PASS|FAIL|ERROR' || true; }
step() { echo; echo "== $*"; }

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
echo "server: $("${PSQL[@]}" -d $DB -tAc 'show server_version')"

step "mirror + seed + 20261101 (production state)"; run "$BASE/00_mirror.sql"; run "$BASE/10_seed.sql"; run "$ROOT/migrations/20261101_harden_dedup_rpc_grants.sql"
step "production ACLs of 2026-11-05";              run "$HERE/05_prod_state.sql"
step "baseline: holes exist";                       run "$HERE/15_baseline.sql"
step "apply migration";                             run "$MIG"
step "verify";                                      run "$HERE/20_after.sql"
step "apply migration again (idempotent)";          run "$MIG"
step "rollback";                                    run "$RB"
step "verify rollback";                             run "$HERE/40_after_rollback.sql"
step "re-apply after rollback";                     run "$MIG"; run "$HERE/20_after.sql"

echo
PASSES=$(grep -c 'PASS' "$LOG" || true); FAILS=$(grep -cE 'FAIL|ERROR' "$LOG" || true)
echo "SUMMARY: $PASSES passed, $FAILS failed"
[ "$FAILS" -eq 0 ]
