/**
 * @jest-environment node
 */
// Daily cron step history, admin-report email lookups, owner-alert sender,
// and the email-function lock / promo safety migrations.
const fs = require('fs')
const path = require('path')
const read = (rel) => fs.readFileSync(path.join(__dirname, '../../../..', rel), 'utf8')

const inserts = []
let profileSelect = []
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@example.org` } }, error: null }) } },
    from: (table) => {
      const q = {
        select(cols) { if (table === 'profiles') profileSelect.push(cols); return q },
        gte() { return q }, lt() { return q }, eq() { return q }, in() { return q }, neq() { return q }, order() { return q },
        insert: async (row) => { inserts.push({ table, row }); return { error: null } },
        then(res) {
          if (table === 'profiles') {
            if (profileSelect.some((c) => /\bemail\b/.test(c))) return res({ data: null, error: { message: 'column profiles.email does not exist' } })
            return res({ data: [{ id: 'u1', plan: 'free', created_at: '2026-11-10T00:00:00Z', trial_ends_at: null }], error: null })
          }
          return res({ data: [], error: null })
        },
      }
      return q
    },
  }),
}))
jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }))

beforeEach(() => {
  inserts.length = 0
  profileSelect = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.RESEND_API_KEY = 're_test'
})

describe('/api/cron/daily', () => {
  const { GET, maxDuration } = require('../daily/route')
  const req = { url: 'https://www.camcashgrl.com/api/cron/daily' }

  test('runs all 12 steps in order and records each one in cron_runs', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }))
    const res = await GET(req)
    const paths = global.fetch.mock.calls.map((c) => new URL(c[0]).pathname)
    expect(paths).toEqual([
      '/api/notify/digest', '/api/cron/expire-goodwill-trials', '/api/cron/check-subscription-drift',
      '/api/cron/check-webhook-failures', '/api/cron/notify-daily-summary', '/api/cron/notify-trial-alerts',
      '/api/cron/notify-conversions', '/api/cron/check-email-failures', '/api/cron/send-trial-expiry-3day',
      '/api/cron/send-trial-expiry-1day', '/api/cron/send-trial-expired', '/api/cron/send-subscription-tips',
    ])
    const runs = inserts.filter((i) => i.table === 'cron_runs')
    expect(runs).toHaveLength(12)
    expect(runs.every((r) => r.row.ok && r.row.job === 'daily' && r.row.run_id === res.body.runId)).toBe(true)
    expect(res.body.success).toBe(true)
    expect(res.body).toHaveProperty('dailySummary')
    expect(res.body).toHaveProperty('dailySummaryError', null)
    expect(maxDuration).toBe(60)
  })

  test('a failing step is recorded with its error and the job keeps going', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith('/api/cron/notify-daily-summary')) throw new Error('timeout')
      if (url.endsWith('/api/cron/check-subscription-drift')) return { ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) }
      return { ok: true, status: 200, json: async () => ({ success: true }) }
    })
    const res = await GET(req)
    const byStep = Object.fromEntries(inserts.filter((i) => i.table === 'cron_runs').map((i) => [i.row.step, i.row]))
    expect(byStep.dailySummary).toMatchObject({ ok: false, error: 'timeout' })
    expect(byStep.subscriptionDrift).toMatchObject({ ok: false, status_code: 500, error: 'boom' })
    expect(byStep.subscriptionTips.ok).toBe(true)
    expect(res.body.dailySummaryError).toBe('timeout')
    expect(res.body.success).toBe(false)
  })
})

test('daily summary no longer selects profiles.email and lists signups by auth email', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'em_1' }) }))
  const { GET } = require('../notify-daily-summary/route')
  await GET()
  expect(profileSelect.length).toBeGreaterThan(0)
  expect(profileSelect.some((c) => /\bemail\b/.test(c))).toBe(false)
  const sent = JSON.parse(global.fetch.mock.calls[0][1].body)
  expect(sent.from).toBe('CamCash <noreply@camcashgrl.com>')
  expect(sent.text).toContain('NEW SIGNUPS: 1')
  expect(sent.text).toContain('u1@example.org')
})

test.each(['app/api/cron/notify-conversions/route.js', 'app/api/cron/notify-trial-alerts/route.js'])('%s does not select profiles.email', (file) => {
  const src = read(file)
  expect(src).not.toMatch(/select\('id, email/)
  expect(src).toContain('attachEmails(')
})

test('owner alerts use the verified sender, not the old domain', () => {
  for (const file of ['app/api/stripe/webhook/route.js', 'app/api/cron/check-subscription-drift/route.js']) {
    const src = read(file)
    expect(src).not.toMatch(/@glowmetrics\.co/)
    expect(src).toContain("'CamCash <noreply@camcashgrl.com>'")
  }
})

test('email functions require the shared secret; signup trigger sends only the email', () => {
  for (const fn of ['send-welcome-email', 'send-live-mode-guide-email', 'send-pro-trial-email']) {
    const src = read(`supabase/functions/${fn}/index.ts`)
    expect(src).toContain("req.headers.get('x-camcash-secret')")
    expect(src).toMatch(/if \(!\(await isAuthorized\(req, [a-zA-Z()]+\)\)\) return json\(\{ error: 'unauthorized' \}, 401\)/)
  }
  const sql = read('supabase/migrations/20261111_lock_email_functions.sql')
  expect(sql).toContain("body := jsonb_build_object('email', NEW.email)")
  expect(sql).not.toMatch(/row_to_json\(NEW\)\s*\)/)
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_email_function_secret\(\) TO service_role/)
  expect((sql.match(/headers := public\.email_function_headers\(\)/g) || []).length).toBe(2)
})

test('promo redeem refuses paying / permanent Pro, and expiry never touches subscribers', () => {
  const sql = read('supabase/migrations/20261111_promo_redeem_safety.sql')
  expect(sql).toContain("RAISE EXCEPTION 'already_pro'")
  expect(sql).toMatch(/IN \('active', 'trialing', 'past_due'\)\s+OR v_current_plan = 'unlimited'\s+OR \(v_current_plan = 'pro' AND v_current_exp IS NULL\)/)
  const expire = sql.slice(sql.indexOf('FUNCTION public.expire_promo_plans'))
  expect(expire).toMatch(/plan_expires_at IS NOT NULL\s+AND plan_expires_at <= now\(\)\s+AND coalesce\(subscription_status, 'none'\) NOT IN \('active', 'trialing', 'past_due'\)/)
  expect(sql).toContain("cron.schedule('expire-promo-plans'")
})
