/**
 * @jest-environment node
 */
// Static guard for supabase/migrations/20261014b_lock_live_session_writes.sql.
// The behavioral security suite is SQL (chrome-extension/tests/staging-only/
// live-session-write-lockdown-tests.sql) and needs a database; this keeps CI
// from silently losing any part of the lockdown if the migration is edited.
const fs = require('fs')
const path = require('path')

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations')
const lockdown = fs.readFileSync(path.join(MIGRATIONS, '20261014b_lock_live_session_writes.sql'), 'utf8')
const reconcile = fs.readFileSync(path.join(MIGRATIONS, '20261014_reconcile_live_engine_production_baseline.sql'), 'utf8')

const LIFECYCLE = [
  'start_live_session(text)',
  'pause_live_session()',
  'resume_live_session()',
  'stop_live_session()',
  'resolve_live_session(text, timestamptz)',
  'sweep_stale_live_session()',
  'send_website_heartbeat()',
  'send_extension_heartbeat(text, boolean)',
  'clear_live_session_tips()',
  'acknowledge_live_session(uuid)',
  'set_live_session_coaching_strategy(text)',
  'set_live_session_goal_tokens(integer)',
]

const squash = (s) => s.replace(/\s+/g, ' ')

describe('live session write lockdown migration', () => {
  const sql = squash(lockdown)

  test.each([...LIFECYCLE, '_finalize_live_session_metrics(uuid)'])(
    '%s becomes SECURITY DEFINER with a pinned search_path',
    (sig) => {
      expect(sql).toContain(`ALTER FUNCTION public.${sig} SECURITY DEFINER SET search_path = public, pg_temp;`)
    }
  )

  test.each(LIFECYCLE)('%s: EXECUTE revoked from PUBLIC/anon, granted to authenticated', (sig) => {
    expect(lockdown).toContain(`'public.${sig}'`)
  })

  test('lifecycle EXECUTE loop revokes PUBLIC/anon and grants authenticated', () => {
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon")
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role")
  })

  test('_finalize_live_session_metrics is not callable by browser roles', () => {
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public._finalize_live_session_metrics(uuid) FROM PUBLIC, anon, authenticated;')
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\._finalize_live_session_metrics\(uuid\) TO [^;]*authenticated/)
  })

  test.each(['live_sessions', 'live_session_pauses'])('browser roles lose every write privilege on %s', (table) => {
    expect(sql).toMatch(new RegExp(
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\\.${table} FROM anon, authenticated;`
    ))
    expect(sql).toMatch(new RegExp(`GRANT SELECT ON public\\.${table} TO authenticated;`))
    expect(sql).not.toMatch(new RegExp(`GRANT [^;]*(INSERT|UPDATE|DELETE)[^;]* ON public\\.${table} TO`))
  })

  test('column-level write grants are cleared too', () => {
    expect(sql).toContain('REVOKE INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.%2$I FROM anon, authenticated')
  })

  test('write policies are removed; live_sessions keeps an owner-only SELECT policy', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Users manage own live sessions" ON public.live_sessions;')
    expect(sql).toContain('DROP POLICY IF EXISTS live_session_pauses_insert_own ON public.live_session_pauses;')
    expect(sql).toContain('DROP POLICY IF EXISTS live_session_pauses_update_own ON public.live_session_pauses;')
    expect(sql).toContain('CREATE POLICY "Users read own live sessions" ON public.live_sessions FOR SELECT USING ((SELECT auth.uid()) = user_id);')
    expect(sql).not.toMatch(/CREATE POLICY [^;]* FOR (ALL|INSERT|UPDATE|DELETE)/)
  })

  test('postconditions abort the migration if any browser write path remains', () => {
    expect(sql).toContain("RAISE EXCEPTION 'Browser write grants remain: %'")
    expect(sql).toContain("RAISE EXCEPTION 'Browser column write grants remain: %'")
    expect(sql).toContain("RAISE EXCEPTION '_finalize_live_session_metrics is still callable by authenticated'")
  })

  test('the Pro start gate is not loosened', () => {
    const code = lockdown.replace(/--[^\n]*/g, '')
    expect(code).not.toMatch(/check_live_mode_pro_entitlement|enforce_live_mode_pro_entitlement/)
    expect(reconcile).toContain("raise exception 'LIVE_MODE_REQUIRES_PRO: Live Mode is a Pro feature. Upgrade to Pro to start a live session.'")
    expect(reconcile).toContain('perform public.check_live_mode_pro_entitlement(v_uid);')
  })

  // The DEFINER functions run with search_path = public, pg_temp. Every
  // relation and every non-builtin function they reference must be
  // schema-qualified, so nothing can ever resolve through pg_temp (or any
  // other schema) instead of the intended public object. Builtins resolve
  // from pg_catalog, which is implicitly searched first.
  describe('lifecycle bodies are fully schema-qualified', () => {
    const NAMES = [...LIFECYCLE, '_finalize_live_session_metrics(uuid)'].map((s) => s.split('(')[0])
    const BUILTINS = new Set([
      'now', 'greatest', 'extract', 'coalesce', 'nullif', 'trim', 'pg_advisory_xact_lock',
      'hashtextextended', 'count', 'sum', 'max', 'avg', 'min', 'lower', 'round',
      'jsonb_object_agg', 'jsonb_build_object', 'exists', 'in', 'values', 'not',
      // SQL keywords that precede '(' inside builtins: EXTRACT(EPOCH FROM (..)), COUNT(DISTINCT (..))
      'from', 'distinct',
    ])
    const bodies = {}
    const re = /CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$/g
    let m
    while ((m = re.exec(reconcile))) bodies[m[1]] = m[2].replace(/--[^\n]*/g, '')

    test.each(NAMES)('%s', (name) => {
      const body = bodies[name]
      expect(body).toBeDefined()
      const unqualifiedRelations = [...body.matchAll(/\b(?:from|join|update|into)\s+([a-z_][\w.]*)/gi)]
        .map((x) => x[1])
        .filter((x) => !/^(public|auth)\./i.test(x) && !/^v_/i.test(x))
      expect(unqualifiedRelations).toEqual([])
      const unqualifiedCalls = [...body.matchAll(/\b([a-z_]\w*\.)?([a-z_]\w*)\s*\(/gi)]
        .filter((x) => !x[1])
        .map((x) => x[2].toLowerCase())
        .filter((c) => !BUILTINS.has(c))
      expect(unqualifiedCalls).toEqual([])
    })
  })

  test('lockdown does not redefine any function body (attributes only)', () => {
    expect(lockdown).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i)
  })
})
