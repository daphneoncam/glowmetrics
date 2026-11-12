ALTER TABLE public.analytics_events
ADD COLUMN IF NOT EXISTS session_id text,
ADD COLUMN IF NOT EXISTS url text;

CREATE INDEX IF NOT EXISTS analytics_events_session_id_idx ON public.analytics_events (session_id);
