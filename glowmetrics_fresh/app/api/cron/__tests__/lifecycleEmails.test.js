/**
 * @jest-environment node
 */
// Lifecycle emails (trial reminders + weekly tips).
// Regression: every route selected profiles.email, a column that does not
// exist, so the query failed daily and no trial or tip email was ever sent.
// Also: wrong brand/domain (GlowMetrics / glowmetrics.co), trial copy that
// contradicted the auto-charging Stripe trial, daily tips, invented features.
const fs = require('fs')
const path = require('path')

const sent = []
let fakeNow
let profileRows = []
let tipHistory = []
let profileSelect = null

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { getUserById: async (id) => ({ data: { user: { id, email: `${id}@example.org` } }, error: null }) } },
    from: (table) => {
      const q = {
        _table: table,
        select(cols) { if (table === 'profiles') profileSelect = cols; return q },
        gte() { return q }, lt() { return q }, eq() { return q }, in() { return q }, neq() { return q },
        order() {
          if (table === 'email_logs') return Promise.resolve({ data: tipHistory, error: null })
          return q
        },
        insert: async () => ({ error: null }),
        then(res) {
          if (table === 'profiles') {
            if (/\bemail\b/.test(profileSelect)) return res({ data: null, error: { message: 'column profiles.email does not exist' } })
            return res({ data: profileRows, error: null })
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
  sent.length = 0
  tipHistory = []
  process.env.RESEND_API_KEY = 're_test'
  global.fetch = jest.fn(async (url, init) => {
    sent.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) }
  })
})

const trialRoutes = ['send-trial-expiry-3day', 'send-trial-expiry-1day', 'send-trial-expired']

describe.each(trialRoutes)('%s', (route) => {
  const { GET } = require(`../${route}/route`)

  test('does not select the non-existent profiles.email; sends to the auth email', async () => {
    profileRows = [{ id: 'u1', plan: 'pro', trial_ends_at: '2026-11-09T12:00:00Z' }]
    const res = await GET()
    expect(res.status).toBe(200)
    expect(profileSelect).not.toMatch(/\bemail\b/)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('u1@example.org')
    expect(res.body.emailsSent).toBe(1)
  })

  test('CamCash branding, real links, and accurate auto-charge wording', async () => {
    profileRows = [{ id: 'u1', plan: 'pro', trial_ends_at: '2026-11-09T12:00:00Z' }]
    await GET()
    const { from, subject, text } = sent[0]
    expect(from).toBe('CamCash <noreply@camcashgrl.com>')
    expect(`${subject} ${text}`).not.toMatch(/glowmetrics/i)
    expect(text).toContain('https://www.camcashgrl.com/dashboard?tab=subscription')
    expect(text).toContain('support@camcashgrl.com')
    expect(text).toMatch(/charged/)
    expect(text).toContain('November 9, 2026')
    expect(text).not.toContain('u1@example.org') // no "Hi <email>," greeting
  })
})

describe('send-subscription-tips (weekly)', () => {
  const { GET } = require('../send-subscription-tips/route')
  const { TIPS } = require('../../../../lib/email/subscriptionTips')

  beforeEach(() => { profileRows = [{ id: 'u1', plan: 'pro', subscription_status: 'active' }] })

  test('first tip is sent when the subscriber has no tip history', async () => {
    const res = await GET()
    expect(profileSelect).not.toMatch(/\bemail\b/)
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toBe(TIPS[0].subject)
    expect(res.body.emailsSent).toBe(1)
  })

  test('no second tip within 7 days', async () => {
    tipHistory = [{ created_at: new Date(Date.now() - 3 * 86400000).toISOString() }]
    const res = await GET()
    expect(sent).toHaveLength(0)
    expect(res.body.skippedRecent).toBe(1)
  })

  test('after 7 days the next tip in rotation is sent', async () => {
    tipHistory = [{ created_at: new Date(Date.now() - 8 * 86400000).toISOString() }]
    await GET()
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toBe(TIPS[1].subject)
  })

  test('tips only describe real features (no invented menus, exports or teams)', () => {
    const all = TIPS.map((t) => `${t.subject}\n${t.text}`).join('\n')
    expect(all).not.toMatch(/glowmetrics|Settings →|PDF|Team Access|Integrations/i)
    for (const t of TIPS) expect(t.text).toContain('https://www.camcashgrl.com/')
  })
})

test('Live Mode guide: marked sent only after Resend accepts, and the batch no longer marks on queue', () => {
  const fn = fs.readFileSync(path.join(__dirname, '../../../../supabase/functions/send-live-mode-guide-email/index.ts'), 'utf8')
  const okCheck = fn.indexOf('if (!res.ok || !data?.id)')
  const mark = fn.indexOf("update({ live_mode_guide_sent_at")
  expect(okCheck).toBeGreaterThan(0)
  expect(mark).toBeGreaterThan(okCheck)
  expect(fn).toContain("email_type: EMAIL_TYPE")
  const sql = fs.readFileSync(path.join(__dirname, '../../../../supabase/migrations/20261106_live_mode_guide_mark_on_delivery.sql'), 'utf8')
  const body = sql.slice(sql.indexOf('create or replace function'))
  expect(body).not.toMatch(/update public\.profiles/i)
  expect(body).toContain("'user_id', r.id")
})
