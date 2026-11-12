#!/bin/bash
# Scratch replica of the production Live objects (../live_mode_20261103
# fixture), the 20261103 migration (already in production), then the
# 20261110 migration, then tests.sql.
# Needs a disposable local Postgres: PGHOST/PGPORT/PGUSER as usual.
# NEVER point this at a real project — it drops and recreates database "t".
set -e
cd "$(dirname "$0")"
case "${PGHOST:-}" in
  *supabase.co*|*supabase.com*) echo "Refusing to run against a Supabase host." >&2; exit 2 ;;
esac
psql -q -c 'drop database if exists t' -c 'create database t' >/dev/null
psql -q -d t -v ON_ERROR_STOP=1 -f ../live_mode_20261103/fixture.sql
psql -q -d t -v ON_ERROR_STOP=1 -f ../../migrations/20261103_live_mode_free_allowance_and_private_mode.sql
# Fixture gap: production live_tips has received_at (checked 2026-11-10).
psql -q -d t -v ON_ERROR_STOP=1 -c 'ALTER TABLE public.live_tips ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT now()'
# Production grants for creators (read 2026-11-11): live_sessions SELECT only;
# live_tips full write under RLS policy "Users manage own live tips".
psql -q -d t -v ON_ERROR_STOP=1 -c 'GRANT SELECT ON public.live_sessions TO authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_tips TO authenticated'
psql -q -d t -v ON_ERROR_STOP=1 -f ../../migrations/20261110_free_live_clock_from_first_real_tip.sql
out=$(psql -q -d t -f tests.sql 2>&1) || true  # keep going: the FAIL line is printed below

# Lock test (needs two connections): a tip must save at once while another
# transaction holds the session row; the clock is then set by the next tip.
SID=00000000-0000-0000-0000-0000000000c1
psql -q -d t -c "DELETE FROM live_tips; DELETE FROM live_sessions; INSERT INTO live_sessions (id, user_id, status, live_substate, started_at, stream_platform) VALUES ('$SID', '00000000-0000-0000-0000-00000000000f', 'live', 'active', now() - interval '10 minutes', 'BongaCams')" >/dev/null
psql -q -d t -c "BEGIN; SELECT 1 FROM live_sessions WHERE id='$SID' FOR UPDATE; SELECT pg_sleep(4); COMMIT;" >/dev/null &
LOCKER=$!
sleep 1
TIP="INSERT INTO live_tips (user_id, platform, username, usd, tokens, live_session_id, received_at) VALUES ('00000000-0000-0000-0000-00000000000f', 'bongacams', 'fan', 1, 40, '$SID', now())"
if psql -q -d t -v ON_ERROR_STOP=1 -c "SET statement_timeout = '2s'" -c "$TIP" >/dev/null 2>&1; then
  out="$out"$'\n''NOTICE:  pass: tip saved immediately while the session row was locked (no wait, no lost tip)'
else
  out="$out"$'\n''FAIL: tip insert blocked or failed while the session row was locked'
fi
c=$(psql -qtA -d t -c "SELECT free_clock_started_at IS NULL FROM live_sessions WHERE id='$SID'")
[ "$c" = "t" ] && out="$out"$'\n''NOTICE:  pass: locked row skipped, clock not yet set' || out="$out"$'\n''FAIL: clock set despite lock'
wait $LOCKER
psql -q -d t -c "$TIP" >/dev/null
c=$(psql -qtA -d t -c "SELECT free_clock_started_at IS NOT NULL FROM live_sessions WHERE id='$SID'")
[ "$c" = "t" ] && out="$out"$'\n''NOTICE:  pass: next tip after the lock sets the clock' || out="$out"$'\n''FAIL: next tip did not set the clock'

echo "$out" | grep -E 'pass:|FAIL|ERROR' | sed 's/^psql:[^ ]* //'
! echo "$out" | grep -qE 'FAIL|ERROR'
