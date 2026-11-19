/**
 * @jest-environment node
 */
// Every scheduled job and internal notify endpoint must refuse requests that
// do not carry Vercel's CRON_SECRET, and must do so BEFORE touching Supabase
// (service role), Stripe, Resend or any outbound HTTP. Before this, all of
// them were publicly callable: anyone could downgrade trials, trigger
// lifecycle emails, and read user IDs / Stripe subscription IDs from the
// responses.
jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200, json: async () => body }) } }))

const mockCreateClient = jest.fn(() => { throw new Error('SENTINEL: supabase client created') })
jest.mock('@supabase/supabase-js', () => ({ createClient: (...a) => mockCreateClient(...a) }))

const mockStripeRetrieve = jest.fn()
jest.mock('stripe', () => jest.fn(() => ({ subscriptions: { retrieve: mockStripeRetrieve } })))

const mockResendSend = jest.fn(async () => ({ id: 'em_1' }))
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockResendSend } })) }))

const SECRET = 'test-cron-secret-0123456789abcdef'

const req = (authorization, body) => ({
  url: 'https://evil.example/api/cron/x',
  headers: { get: (n) => (n.toLowerCase() === 'authorization' ? authorization ?? null : null) },
  json: async () => body ?? {},
})

const CRON_ROUTES = [
  'check-email-failures', 'check-subscription-drift', 'check-webhook-failures', 'daily',
  'expire-goodwill-trials', 'notify-conversions', 'notify-daily-summary', 'notify-trial-alerts',
  'send-subscription-tips', 'send-trial-expired', 'send-trial-expiry-1day', 'send-trial-expiry-3day',
]

const ENDPOINTS = [
  ...CRON_ROUTES.map((r) => ({ name: `cron/${r}`, load: () => require(`../${r}/route`).GET })),
  { name: 'notify/digest', load: () => require('../../notify/digest/route').GET },
  { name: 'notify/signup', load: () => require('../../notify/signup/route').POST },
  { name: 'notify/upload', load: () => require('../../notify/upload/route').POST },
]

function noSideEffects() {
  expect(mockCreateClient).not.toHaveBeenCalled()
  expect(mockStripeRetrieve).not.toHaveBeenCalled()
  expect(mockResendSend).not.toHaveBeenCalled()
  expect(global.fetch).not.toHaveBeenCalled()
}

const savedSecret = process.env.CRON_SECRET
beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  mockCreateClient.mockClear(); mockStripeRetrieve.mockClear(); mockResendSend.mockClear()
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'x' }) }))
})
afterAll(() => { process.env.CRON_SECRET = savedSecret })

test('all 12 cron routes are covered (no new route left unprotected)', () => {
  const fs = require('fs')
  const path = require('path')
  const dirs = fs.readdirSync(path.join(__dirname, '..'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(__dirname, '..', d.name, 'route.js')))
    .map((d) => d.name).sort()
  expect(dirs).toEqual([...CRON_ROUTES].sort())
})

describe.each(ENDPOINTS)('$name', ({ load }) => {
  test.each([
    ['no Authorization header', undefined],
    ['wrong secret', 'Bearer wrong-secret'],
    ['secret without Bearer scheme', SECRET],
    ['Basic scheme', `Basic ${SECRET}`],
  ])('rejects %s with 401 and no side effects', async (_label, header) => {
    const res = await load()(req(header, { email: '<b>x</b>@x.com', platform: '<script>' }))
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    noSideEffects()
  })

  test('fails closed (503) when CRON_SECRET is not configured, with no side effects', async () => {
    delete process.env.CRON_SECRET
    const res = await load()(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(503)
    expect(JSON.stringify(res.body)).not.toContain(SECRET)
    noSideEffects()
  })
})

describe('a valid scheduler request gets past the check', () => {
  test.each(CRON_ROUTES.filter((r) => r !== 'daily'))('cron/%s proceeds to its job (creates the Supabase client)', async (r) => {
    const { GET } = require(`../${r}/route`)
    // The sentinel client throws, which stops the job right after the auth
    // check; reaching it proves a valid secret is accepted.
    await GET(req(`Bearer ${SECRET}`)).catch((e) => expect(e.message).toContain('SENTINEL'))
    expect(mockCreateClient).toHaveBeenCalled()
  })

  test('notify/upload sends the (escaped) founder email', async () => {
    const { POST } = require('../../notify/upload/route')
    const res = await POST(req(`Bearer ${SECRET}`, { email: 'm@x.co', platform: '<script>', tip_count: 2, user_id: 'u1' }))
    expect(res.status).toBe(200)
    expect(mockResendSend).toHaveBeenCalledTimes(1)
    expect(mockResendSend.mock.calls[0][0].html).toContain('&lt;script&gt;')
    expect(mockResendSend.mock.calls[0][0].html).not.toContain('<script>')
  })
})
