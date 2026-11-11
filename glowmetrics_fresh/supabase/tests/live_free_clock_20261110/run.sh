#!/bin/bash
# Scratch replica of the production Live objects (../live_mode_20261103
# fixture), the 20261103 migration (already in production), then the
# 20261110 migration, then tests.sql.
# Needs a disposable local Postgres: PGHOST/PGPORT/PGUSER as usual.
# NEVER point this at a real project — it drops and recreates database "t".
set -e
cd "$(dirname "$0")"
psql -q -c 'drop database if exists t' -c 'create database t' >/dev/null
psql -q -d t -v ON_ERROR_STOP=1 -f ../live_mode_20261103/fixture.sql
psql -q -d t -v ON_ERROR_STOP=1 -f ../../migrations/20261103_live_mode_free_allowance_and_private_mode.sql
# Fixture gap: production live_tips has received_at (checked 2026-11-10).
psql -q -d t -v ON_ERROR_STOP=1 -c 'ALTER TABLE public.live_tips ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT now()'
psql -q -d t -v ON_ERROR_STOP=1 -f ../../migrations/20261110_free_live_clock_from_first_real_tip.sql
out=$(psql -q -d t -f tests.sql 2>&1)
echo "$out" | grep -E 'pass:|FAIL|ERROR' | sed 's/^psql:[^ ]* //'
! echo "$out" | grep -qE 'FAIL|ERROR'
