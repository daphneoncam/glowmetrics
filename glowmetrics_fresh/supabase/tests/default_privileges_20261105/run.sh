#!/usr/bin/env bash
# Rehearse 20261106_narrow_public_default_privileges.sql on a DISPOSABLE local
# Postgres (17 to exercise MAINTAIN; 16 skips it). Never production/staging.
# Usage: PGHOST=/path/to/socket ./run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG="$ROOT/migrations/20261106_narrow_public_default_privileges.sql"
RB="$ROOT/rollbacks/20261106_narrow_public_default_privileges.rollback.sql"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
DB=default_privileges_rehearsal
LOG="$(mktemp)"
case "${PGHOST:-}" in
  ""|*supabase.co*|*supabase.com*) echo "Refusing: set PGHOST to a local socket directory (never a Supabase host)." >&2; exit 2 ;;
esac
run() { "${PSQL[@]}" -d "$DB" -f "$1" 2>&1 | tee -a "$LOG" | grep -E 'PASS|FAIL|ERROR' || true; }
step() { echo; echo "== $*"; }
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" 2>/dev/null
echo "server: $("${PSQL[@]}" -d $DB -tAc 'show server_version')"
step "production default privileges";  run "$HERE/00_setup.sql"
step "before";                         run "$HERE/10_before.sql"
step "apply migration";                run "$MIG"
step "verify";                         run "$HERE/20_after.sql"
step "apply again (idempotent)";       run "$MIG"
step "rollback";                       run "$RB"
step "verify rollback";                run "$HERE/30_after_rollback.sql"
step "re-apply after rollback";        run "$MIG"
echo
PASSES=$(grep -c 'PASS' "$LOG" || true); FAILS=$(grep -cE 'FAIL|ERROR' "$LOG" || true)
echo "SUMMARY: $PASSES passed, $FAILS failed"
[ "$FAILS" -eq 0 ]
