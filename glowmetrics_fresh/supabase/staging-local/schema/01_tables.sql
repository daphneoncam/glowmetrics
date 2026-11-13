-- Staging schema: the 14 tables the dashboard and import flows use, generated
-- read-only from production's catalog on 2026-11-11 (no data). FKs to tables
-- outside this set (studios etc.) are omitted.
BEGIN;
CREATE SEQUENCE public.tips_id_seq;
CREATE SEQUENCE public.paid_sessions_id_seq;
CREATE SEQUENCE public.tipper_notes_id_seq;

-- Studio access is out of scope for staging: always false (production joins
-- studio_models/studios). Policies that call it then only grant own rows.
CREATE OR REPLACE FUNCTION public.is_linked_studio_admin(target_model_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select false $function$;

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  display_name text,
  plan text DEFAULT 'free'::text,
  created_at timestamp with time zone DEFAULT now(),
  chaturbate_username text,
  broadcaster_type text DEFAULT 'female'::text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  attributed_landing_page text,
  attributed_at timestamp with time zone,
  show_coaching_action_buttons boolean DEFAULT true NOT NULL,
  timezone text,
  stripe_customer_id text,
  plan_expires_at timestamp with time zone,
  plan_expiry_notified_at timestamp with time zone,
  live_mode_guide_sent_at timestamp with time zone,
  pro_trial_email_sent_at timestamp with time zone,
  trial_ends_at timestamp with time zone,
  last_seen_intelligence jsonb,
  primary_pro_platform text,
  streaming_platforms text[],
  trial_days integer DEFAULT 7,
  stripe_subscription_id text,
  subscription_status text DEFAULT 'none'::text,
  bongacams_username text,
  myfreecams_username text
);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_profiles_stripe_customer_id ON public.profiles USING btree (stripe_customer_id);
CREATE INDEX idx_profiles_subscription_status ON public.profiles USING btree (subscription_status);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_own_update ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = id));
CREATE POLICY profiles_own_insert ON public.profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = id));
CREATE POLICY profiles_own_select ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = id));

CREATE TABLE public.csv_uploads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  upload_ref text NOT NULL,
  platform text NOT NULL,
  file_name text,
  date_from timestamp with time zone,
  date_to timestamp with time zone,
  months_covered text[],
  total_rows integer DEFAULT 0,
  inserted_rows integer DEFAULT 0,
  skipped_rows integer DEFAULT 0,
  total_usd numeric DEFAULT 0,
  total_tokens bigint DEFAULT 0,
  uploaded_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'complete'::text
);
ALTER TABLE public.csv_uploads ADD CONSTRAINT csv_uploads_pkey PRIMARY KEY (id);
ALTER TABLE public.csv_uploads ADD CONSTRAINT csv_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_csv_uploads_user ON public.csv_uploads USING btree (user_id, uploaded_at DESC);
ALTER TABLE public.csv_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY csv_uploads_own_delete ON public.csv_uploads AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY csv_uploads_own_update ON public.csv_uploads AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users manage own uploads" ON public.csv_uploads AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY csv_uploads_own_select ON public.csv_uploads AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY csv_uploads_own_insert ON public.csv_uploads AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.live_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  stream_platform text DEFAULT 'Chaturbate'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now(),
  ended_at timestamp with time zone,
  goal_tokens integer DEFAULT 0,
  goal_usd numeric(10,2) DEFAULT 0,
  status text DEFAULT 'active'::text,
  is_active boolean DEFAULT true NOT NULL,
  total_tokens integer DEFAULT 0 NOT NULL,
  total_tips integer DEFAULT 0 NOT NULL,
  total_usd numeric(10,2) DEFAULT 0 NOT NULL,
  peak_viewers integer,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_heartbeat_at timestamp with time zone,
  paused_at timestamp with time zone,
  total_paused_seconds integer DEFAULT 0 NOT NULL,
  website_last_heartbeat_at timestamp with time zone,
  extension_last_heartbeat_at timestamp with time zone,
  extension_platform text,
  broadcaster_page_detected boolean DEFAULT false NOT NULL,
  broadcaster_page_missing_since timestamp with time zone,
  status_before_resolution text,
  tips_cleared_at timestamp with time zone,
  duration_confidence text DEFAULT 'verified'::text NOT NULL,
  starting_earnings_usd numeric,
  ending_earnings_usd numeric,
  session_earnings_usd numeric,
  starting_tokens integer,
  ending_tokens integer,
  session_tokens integer,
  tip_count integer,
  unique_tipper_count integer,
  new_tipper_count integer,
  returning_tipper_count integer,
  whale_tip_count integer,
  largest_tip_usd numeric,
  average_tip_usd numeric,
  earnings_per_active_hour numeric,
  tips_per_active_hour numeric,
  platform_detected_automatically boolean DEFAULT false NOT NULL,
  session_resolution_type text,
  is_inaccurate boolean DEFAULT false NOT NULL,
  inaccuracy_reason text,
  coaching_strategy text DEFAULT 'balanced'::text NOT NULL,
  coaching_goal_tokens integer DEFAULT 0 NOT NULL,
  live_substate text,
  warning_started_at timestamp with time zone,
  final_total_usd numeric(10,2),
  final_tokens integer,
  final_tip_count integer,
  final_unique_tippers integer,
  final_top_tipper_username text,
  final_top_tipper_usd numeric(10,2),
  final_largest_tip_usd numeric(10,2),
  final_avg_tip_usd numeric(10,2),
  final_duration_seconds integer,
  final_usd_per_hour numeric(10,2),
  finalized_at timestamp with time zone,
  final_public_usd numeric(10,2),
  final_private_usd numeric(10,2),
  final_private_seconds integer,
  final_platform_breakdown jsonb,
  dashboard_seen_at timestamp with time zone
);
ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_coaching_goal_tokens_check CHECK ((coaching_goal_tokens >= 0));
ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_coaching_strategy_check CHECK ((coaching_strategy = ANY (ARRAY['balanced'::text, 'aggressive'::text, 'retention'::text, 'engagement'::text, 'whale'::text, 'goal'::text])));
ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_duration_confidence_check CHECK ((duration_confidence = ANY (ARRAY['verified'::text, 'user_confirmed'::text, 'estimated'::text])));
ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_live_substate_check CHECK (((live_substate IS NULL) OR (live_substate = ANY (ARRAY['active'::text, 'paused'::text]))));
ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_resolution_type_check CHECK (((session_resolution_type IS NULL) OR (session_resolution_type = ANY (ARRAY['normal_stop'::text, 'still_live'::text, 'end_at_last_heartbeat'::text, 'chosen_end_time'::text, 'marked_invalid'::text, 'auto_ended_inactivity'::text, 'free_active_limit'::text]))));
ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_status_check CHECK ((status = ANY (ARRAY['starting'::text, 'live'::text, 'inactive_warning'::text, 'ending'::text, 'ended'::text])));
CREATE INDEX idx_live_sessions_user_finalized ON public.live_sessions USING btree (user_id, ended_at DESC) WHERE (finalized_at IS NOT NULL);
CREATE INDEX live_sessions_user_active ON public.live_sessions USING btree (user_id, is_active, started_at DESC);
CREATE UNIQUE INDEX live_sessions_one_running_per_user ON public.live_sessions USING btree (user_id) WHERE (status = ANY (ARRAY['starting'::text, 'live'::text, 'inactive_warning'::text, 'ending'::text]));
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "studio admin read linked model live_sessions" ON public.live_sessions AS PERMISSIVE FOR SELECT TO public USING (is_linked_studio_admin(user_id));
CREATE POLICY "Users read own live sessions" ON public.live_sessions AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE TABLE public.analytics_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  event_name text NOT NULL,
  properties jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  session_id text,
  url text
);
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_analytics_events_user_id ON public.analytics_events USING btree (user_id);
CREATE INDEX analytics_events_user_id_idx ON public.analytics_events USING btree (user_id);
CREATE INDEX idx_analytics_events_created_at ON public.analytics_events USING btree (created_at DESC);
CREATE INDEX analytics_events_event_name_idx ON public.analytics_events USING btree (event_name);
CREATE INDEX analytics_events_created_at_idx ON public.analytics_events USING btree (created_at);
CREATE INDEX analytics_events_session_id_idx ON public.analytics_events USING btree (session_id);
CREATE INDEX idx_analytics_events_event_name ON public.analytics_events USING btree (event_name);
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own events" ON public.analytics_events AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() = user_id) OR (user_id IS NULL)));
CREATE POLICY "Users can view their own events" ON public.analytics_events AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own events" ON public.analytics_events AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Admin can read all events" ON public.analytics_events AS PERMISSIVE FOR SELECT TO public USING (false);
CREATE POLICY users_read_own_analytics ON public.analytics_events AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));

CREATE TABLE public.beta_users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  email text,
  signed_up_at timestamp with time zone DEFAULT now(),
  csv_upload_count integer DEFAULT 0,
  onboarding_complete boolean DEFAULT false
);
ALTER TABLE public.beta_users ADD CONSTRAINT beta_users_user_id_key UNIQUE (user_id);
ALTER TABLE public.beta_users ADD CONSTRAINT beta_users_pkey PRIMARY KEY (id);
ALTER TABLE public.beta_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read count" ON public.beta_users AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Users can update own record" ON public.beta_users AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert own record" ON public.beta_users AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.email_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email_type text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL,
  resend_response jsonb,
  error_message text,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.email_logs ADD CONSTRAINT email_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.email_logs ADD CONSTRAINT email_logs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])));
CREATE INDEX idx_email_logs_status ON public.email_logs USING btree (status);
CREATE INDEX idx_email_logs_created ON public.email_logs USING btree (created_at DESC);
CREATE INDEX idx_email_logs_type_created ON public.email_logs USING btree (email_type, created_at DESC);
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.live_private_intervals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  live_session_id uuid NOT NULL,
  platform text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  rate_per_minute numeric(10,2) NOT NULL,
  estimated_earnings_usd numeric(10,2),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  username text
);
ALTER TABLE public.live_private_intervals ADD CONSTRAINT live_private_intervals_pkey PRIMARY KEY (id);
ALTER TABLE public.live_private_intervals ADD CONSTRAINT live_private_intervals_live_session_id_fkey FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.live_private_intervals ADD CONSTRAINT live_private_intervals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.live_private_intervals ADD CONSTRAINT live_private_intervals_end_after_start CHECK (((ended_at IS NULL) OR (ended_at >= started_at)));
ALTER TABLE public.live_private_intervals ADD CONSTRAINT live_private_intervals_rate_per_minute_check CHECK ((rate_per_minute >= (0)::numeric));
CREATE UNIQUE INDEX live_private_intervals_one_open_per_session ON public.live_private_intervals USING btree (live_session_id) WHERE (ended_at IS NULL);
CREATE INDEX idx_live_private_intervals_user ON public.live_private_intervals USING btree (user_id);
CREATE INDEX idx_live_private_intervals_user_platform_username ON public.live_private_intervals USING btree (user_id, platform, lower(username)) WHERE (username IS NOT NULL);
CREATE INDEX idx_live_private_intervals_session ON public.live_private_intervals USING btree (live_session_id);
ALTER TABLE public.live_private_intervals ENABLE ROW LEVEL SECURITY;
CREATE POLICY live_private_intervals_select_own ON public.live_private_intervals AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

CREATE TABLE public.live_tips (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid,
  user_id uuid NOT NULL,
  username text NOT NULL,
  tokens integer DEFAULT 0,
  usd numeric(12,4) DEFAULT 0,
  source text DEFAULT 'manual'::text,
  received_at timestamp with time zone DEFAULT now(),
  deduplication_key text,
  platform text DEFAULT 'chaturbate'::text,
  live_session_id uuid,
  client_event_id uuid
);
ALTER TABLE public.live_tips ADD CONSTRAINT live_tips_deduplication_key_key UNIQUE (deduplication_key);
ALTER TABLE public.live_tips ADD CONSTRAINT live_tips_pkey PRIMARY KEY (id);
ALTER TABLE public.live_tips ADD CONSTRAINT live_tips_live_session_id_fkey FOREIGN KEY (live_session_id) REFERENCES live_sessions(id);
ALTER TABLE public.live_tips ADD CONSTRAINT live_tips_session_id_fkey FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE CASCADE;
CREATE INDEX live_tips_session_id ON public.live_tips USING btree (session_id);
CREATE UNIQUE INDEX live_tips_client_event_id_ext_key ON public.live_tips USING btree (user_id, client_event_id) WHERE (client_event_id IS NOT NULL);
CREATE INDEX live_tips_received_idx ON public.live_tips USING btree (received_at DESC);
CREATE INDEX idx_live_tips_user_platform_lower ON public.live_tips USING btree (user_id, lower(platform));
CREATE INDEX live_tips_session_idx ON public.live_tips USING btree (session_id);
ALTER TABLE public.live_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own live tips" ON public.live_tips AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "studio admin read linked model live_tips" ON public.live_tips AS PERMISSIVE FOR SELECT TO public USING (is_linked_studio_admin(user_id));

CREATE TABLE public.paid_sessions (
  id bigint DEFAULT nextval('paid_sessions_id_seq'::regclass) NOT NULL,
  user_id uuid NOT NULL,
  date_time timestamp with time zone NOT NULL,
  platform text DEFAULT 'BongaCams'::text NOT NULL,
  username text NOT NULL,
  username_lower text GENERATED ALWAYS AS (lower(username)) STORED,
  session_type text NOT NULL,
  tokens integer DEFAULT 0 NOT NULL,
  usd numeric(10,4) DEFAULT 0 NOT NULL,
  usd_rounded numeric(10,2) GENERATED ALWAYS AS (round(usd, 2)) STORED,
  upload_id uuid,
  session_ref text,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.paid_sessions ADD CONSTRAINT paid_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.paid_sessions ADD CONSTRAINT paid_sessions_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES csv_uploads(id) ON DELETE SET NULL;
ALTER TABLE public.paid_sessions ADD CONSTRAINT paid_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_paid_sessions_date ON public.paid_sessions USING btree (user_id, date_time);
CREATE INDEX idx_paid_sessions_user_id ON public.paid_sessions USING btree (user_id);
CREATE UNIQUE INDEX idx_paid_sessions_session_ref ON public.paid_sessions USING btree (user_id, session_ref) WHERE (session_ref IS NOT NULL);
CREATE INDEX idx_paid_sessions_upload_id ON public.paid_sessions USING btree (upload_id);
CREATE INDEX idx_paid_sessions_username ON public.paid_sessions USING btree (user_id, username_lower);
CREATE UNIQUE INDEX paid_sessions_dedup_unique ON public.paid_sessions USING btree (user_id, username_lower, tokens, usd_rounded, date_time, session_type);
ALTER TABLE public.paid_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY paid_sessions_own_insert ON public.paid_sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY paid_sessions_own_delete ON public.paid_sessions AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY paid_sessions_own_select ON public.paid_sessions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "studio admin read linked model paid_sessions" ON public.paid_sessions AS PERMISSIVE FOR SELECT TO public USING (is_linked_studio_admin(user_id));

CREATE TABLE public.planned_streams (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone NOT NULL,
  platform text NOT NULL,
  goal text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  source text DEFAULT 'stream_planner'::text NOT NULL
);
ALTER TABLE public.planned_streams ADD CONSTRAINT planned_streams_pkey PRIMARY KEY (id);
ALTER TABLE public.planned_streams ADD CONSTRAINT planned_streams_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.planned_streams ADD CONSTRAINT planned_streams_end_after_start CHECK ((end_at > start_at));
ALTER TABLE public.planned_streams ADD CONSTRAINT planned_streams_max_length CHECK (((end_at - start_at) <= '12:00:00'::interval));
ALTER TABLE public.planned_streams ADD CONSTRAINT planned_streams_platform_check CHECK ((platform = ANY (ARRAY['Chaturbate'::text, 'BongaCams'::text, 'MyFreeCams'::text])));
ALTER TABLE public.planned_streams ADD CONSTRAINT planned_streams_source_check CHECK ((source = ANY (ARRAY['stream_planner'::text, 'manual'::text])));
CREATE INDEX planned_streams_user_id_start_at_idx ON public.planned_streams USING btree (user_id, start_at);
ALTER TABLE public.planned_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY planned_streams_insert_future ON public.planned_streams AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (start_at > now())));
CREATE POLICY planned_streams_update_future ON public.planned_streams AS PERMISSIVE FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (start_at > now()))) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (start_at > now())));
CREATE POLICY planned_streams_select_own ON public.planned_streams AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY planned_streams_delete_future ON public.planned_streams AS PERMISSIVE FOR DELETE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (start_at > now())));

CREATE TABLE public.subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  status text DEFAULT 'free'::text,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  plan_type text DEFAULT 'free'::text,
  billing_cycle text,
  is_lifetime_locked boolean DEFAULT false,
  lifetime_price_locked numeric(10,2),
  current_period_start timestamp with time zone
);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_billing_cycle_check CHECK (((billing_cycle = ANY (ARRAY['monthly'::text, 'annual'::text])) OR (billing_cycle IS NULL)));
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_type_check CHECK ((plan_type = ANY (ARRAY['free'::text, 'early_adopter_monthly'::text, 'early_adopter_annual'::text, 'standard_monthly'::text, 'standard_annual'::text])));
CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON public.subscriptions USING btree (stripe_customer_id);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscription" ON public.subscriptions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can update own subscription" ON public.subscriptions AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY subs_own ON public.subscriptions AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));

CREATE TABLE public.tipper_notes (
  id bigint DEFAULT nextval('tipper_notes_id_seq'::regclass) NOT NULL,
  user_id uuid NOT NULL,
  tipper_username text NOT NULL,
  note text,
  follow_up boolean DEFAULT false,
  contact_pref text,
  updated_at timestamp with time zone DEFAULT now(),
  platform text
);
ALTER TABLE public.tipper_notes ADD CONSTRAINT tipper_notes_user_id_tipper_username_platform_key UNIQUE (user_id, tipper_username, platform);
ALTER TABLE public.tipper_notes ADD CONSTRAINT tipper_notes_pkey PRIMARY KEY (id);
ALTER TABLE public.tipper_notes ADD CONSTRAINT tipper_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_notes_user ON public.tipper_notes USING btree (user_id, tipper_username, platform);
ALTER TABLE public.tipper_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_own_delete ON public.tipper_notes AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY notes_own_insert ON public.tipper_notes AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY notes_own_update ON public.tipper_notes AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY notes_own_select ON public.tipper_notes AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

CREATE TABLE public.tips (
  id bigint DEFAULT nextval('tips_id_seq'::regclass) NOT NULL,
  user_id uuid NOT NULL,
  date_time timestamp with time zone NOT NULL,
  platform text NOT NULL,
  username text NOT NULL,
  tip_type text DEFAULT 'Tip'::text NOT NULL,
  tokens integer DEFAULT 0 NOT NULL,
  usd numeric(12,4) DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  session_id uuid,
  tip_note text DEFAULT ''::text,
  username_lower text GENERATED ALWAYS AS (lower(username)) STORED,
  upload_id uuid,
  tip_ref text,
  tip_seq integer DEFAULT 1 NOT NULL,
  client_event_id uuid,
  source text,
  live_session_id uuid,
  usd_rounded numeric GENERATED ALWAYS AS (round(usd, 2)) STORED
);
ALTER TABLE public.tips ADD CONSTRAINT tips_pkey PRIMARY KEY (id);
ALTER TABLE public.tips ADD CONSTRAINT tips_live_session_id_fkey FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.tips ADD CONSTRAINT tips_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES csv_uploads(id) ON DELETE SET NULL;
ALTER TABLE public.tips ADD CONSTRAINT tips_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_tips_user_platform_lower ON public.tips USING btree (user_id, lower(platform));
CREATE UNIQUE INDEX idx_tips_tip_ref ON public.tips USING btree (user_id, tip_ref) WHERE (tip_ref IS NOT NULL);
CREATE UNIQUE INDEX tips_client_event_id_ext_key ON public.tips USING btree (user_id, client_event_id) WHERE (client_event_id IS NOT NULL);
CREATE INDEX idx_tips_live_session_id ON public.tips USING btree (live_session_id) WHERE (live_session_id IS NOT NULL);
CREATE UNIQUE INDEX tips_dedup_unique ON public.tips USING btree (user_id, username_lower, tokens, usd_rounded, date_time, tip_seq);
CREATE INDEX idx_tips_username ON public.tips USING btree (user_id, username);
CREATE INDEX idx_tips_upload_id ON public.tips USING btree (upload_id);
CREATE INDEX idx_tips_user_id ON public.tips USING btree (user_id);
CREATE INDEX idx_tips_date ON public.tips USING btree (user_id, date_time);
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY tips_own_insert ON public.tips AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY tips_own_select ON public.tips AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY tips_own_delete ON public.tips AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "studio admin read linked model tips" ON public.tips AS PERMISSIVE FOR SELECT TO public USING (is_linked_studio_admin(user_id));

CREATE TABLE public.user_goals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  goal_type text DEFAULT 'monthly'::text NOT NULL,
  target_usd numeric DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.user_goals ADD CONSTRAINT user_goals_user_id_goal_type_key UNIQUE (user_id, goal_type);
ALTER TABLE public.user_goals ADD CONSTRAINT user_goals_pkey PRIMARY KEY (id);
ALTER TABLE public.user_goals ADD CONSTRAINT user_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own goals" ON public.user_goals AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

ALTER SEQUENCE public.tips_id_seq OWNED BY public.tips.id;
ALTER SEQUENCE public.paid_sessions_id_seq OWNED BY public.paid_sessions.id;
ALTER SEQUENCE public.tipper_notes_id_seq OWNED BY public.tipper_notes.id;
COMMIT;
