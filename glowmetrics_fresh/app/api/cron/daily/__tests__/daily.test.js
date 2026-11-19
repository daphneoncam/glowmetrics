/**
 * @jest-environment node
 */
// /api/cron/daily runs the 12 daily jobs. It used to fetch each one at
// `new URL(req.url).origin`, a server-side request whose destination came
// from the incoming Host header (CodeQL js/request-forgery), and with
// CRON_SECRET enforced that fetch would have carried the secret to it. It now
// calls the jobs in-process. These tests pin: auth first, no outbound HTTP,
// same job order, same response shape, per-job error isolation.
jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200, json: async () => body }) } }))

const calls = []
// Function declaration (hoisted) so the hoisted jest.mock factories can use it;
// it only touches `calls` when a job actually runs, after initialization.
function mockJob(name) {
  return jest.fn(async (r) => { calls.push({ name, req: r }); return { json: async () => ({ ran: name }) } })
}

// Mock the 12 job modules: in-process calls are what is being verified.
jest.mock('../../../notify/digest/route', () => ({ GET: mockJob('digest') }))
jest.mock('../../expire-goodwill-trials/route', () => ({ GET: mockJob('goodwillExpiry') }))
jest.mock('../../check-subscription-drift/route', () => ({ GET: mockJob('subscriptionDrift') }))
jest.mock('../../check-webhook-failures/route', () => ({ GET: mockJob('webhookFailures') }))
jest.mock('../../notify-daily-summary/route', () => ({ GET: mockJob('dailySummary') }))
jest.mock('../../notify-trial-alerts/route', () => ({ GET: mockJob('trialAlerts') }))
jest.mock('../../notify-conversions/route', () => ({ GET: mockJob('conversionReport') }))
jest.mock('../../check-email-failures/route', () => ({ GET: mockJob('emailFailures') }))
jest.mock('../../send-trial-expiry-3day/route', () => ({ GET: mockJob('trialExpiry3Day') }))
jest.mock('../../send-trial-expiry-1day/route', () => ({ GET: mockJob('trialExpiry1Day') }))
jest.mock('../../send-trial-expired/route', () => ({ GET: mockJob('trialExpired') }))
jest.mock('../../send-subscription-tips/route', () => ({ GET: mockJob('subscriptionTips') }))

import { GET } from '../route'
import { GET as checkWebhookFailures } from '../../check-webhook-failures/route'

const ORDER = ['digest', 'goodwillExpiry', 'subscriptionDrift', 'webhookFailures', 'dailySummary', 'trialAlerts',
  'conversionReport', 'emailFailures', 'trialExpiry3Day', 'trialExpiry1Day', 'trialExpired', 'subscriptionTips']

const SECRET = 'test-cron-secret-daily'
// A request whose URL / Host the attacker controls.
const req = (authorization, url = 'https://attacker.example/api/cron/daily') => ({
  url,
  headers: { get: (n) => ({ authorization, host: 'attacker.example', 'x-forwarded-host': 'attacker.example' })[n.toLowerCase()] ?? null },
})

const saved = process.env.CRON_SECRET
beforeEach(() => {
  calls.length = 0
  process.env.CRON_SECRET = SECRET
  global.fetch = jest.fn(async () => { throw new Error('daily must not make HTTP requests') })
})
afterAll(() => { process.env.CRON_SECRET = saved })

test('missing or invalid authorization: 401, no job runs, no request made', async () => {
  for (const h of [undefined, 'Bearer nope', SECRET]) {
    const res = await GET(req(h))
    expect(res.status).toBe(401)
  }
  expect(calls).toHaveLength(0)
  expect(global.fetch).not.toHaveBeenCalled()
})

test('valid scheduled run: all 12 jobs in the original order, in-process, with the authenticated request', async () => {
  const r = req(`Bearer ${SECRET}`)
  const res = await GET(r)
  expect(res.status).toBe(200)
  expect(calls.map((c) => c.name)).toEqual(ORDER)
  for (const c of calls) expect(c.req).toBe(r) // each job re-checks the same secret
  expect(global.fetch).not.toHaveBeenCalled() // attacker Host is never contacted
})

test('response shape is unchanged (same keys, success flag)', async () => {
  const res = await GET(req(`Bearer ${SECRET}`))
  const expectedKeys = ['success', ...ORDER.flatMap((k) => [k, `${k}Error`])]
  expect(Object.keys(res.body)).toEqual(expectedKeys)
  expect(res.body.success).toBe(true)
  for (const k of ORDER) {
    expect(res.body[k]).toEqual({ ran: k })
    expect(res.body[`${k}Error`]).toBeNull()
  }
})

test('one failing job is isolated: its error is reported, the rest still run, success=false', async () => {
  checkWebhookFailures.mockImplementationOnce(async () => { throw new Error('webhook check blew up') })
  const res = await GET(req(`Bearer ${SECRET}`))
  expect(res.body.success).toBe(false)
  expect(res.body.webhookFailures).toBeNull()
  expect(res.body.webhookFailuresError).toBe('webhook check blew up')
  expect(calls.map((c) => c.name)).toEqual(ORDER.filter((n) => n !== 'webhookFailures'))
})

test('source no longer builds requests from the request origin', () => {
  const raw = require('fs').readFileSync(require('path').join(__dirname, '..', 'route.js'), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // code only, not comments
  expect(src).not.toMatch(/fetch\(/)
  expect(src).not.toMatch(/new URL\(req\.url\)/)
})
