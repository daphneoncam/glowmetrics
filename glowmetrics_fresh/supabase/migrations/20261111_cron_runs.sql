-- Step-by-step history of the Vercel daily cron (/api/cron/daily).
-- The admin emails stopped after 2026-11-07 and Vercel Hobby keeps runtime
-- logs for only 1 hour, so failures were invisible. Written only by the
-- server (service role); no browser access.
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      text NOT NULL,
  job         text NOT NULL,
  step        text NOT NULL,
  path        text,
  ok          boolean NOT NULL,
  status_code integer,
  duration_ms integer,
  result      jsonb,
  error       text,
  ran_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cron_runs_ran_at_idx ON public.cron_runs (ran_at DESC);
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_runs FROM anon, authenticated;
