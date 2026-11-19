/**
 * @jest-environment node
 */
// Scheduled-job authorization (lib/cron-auth.js). Every /api/cron/* route and
// the internal /api/notify/* routes call requireCronAuth() first.
jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }))

import { requireCronAuth, isAuthorizedCronRequest } from '../cron-auth'

const SECRET = 'a-long-random-cron-secret-value-0123456789'
const req = (authorization) => ({ headers: { get: (n) => (n.toLowerCase() === 'authorization' ? authorization ?? null : null) } })

describe('requireCronAuth', () => {
  const saved = process.env.CRON_SECRET
  afterEach(() => { process.env.CRON_SECRET = saved })
  beforeEach(() => { process.env.CRON_SECRET = SECRET })

  test('valid Vercel cron bearer token is allowed', () => {
    expect(requireCronAuth(req(`Bearer ${SECRET}`))).toBeNull()
    expect(isAuthorizedCronRequest(req(`Bearer ${SECRET}`))).toBe(true)
  })

  test.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['wrong secret', 'Bearer not-the-secret'],
    ['secret prefix only', `Bearer ${SECRET.slice(0, -1)}`],
    ['secret with extra char', `Bearer ${SECRET}x`],
    ['wrong scheme', `Basic ${SECRET}`],
    ['no scheme', SECRET],
    ['lower-case scheme', `bearer ${SECRET}`],
    ['empty bearer', 'Bearer '],
    ['bare "Bearer"', 'Bearer'],
  ])('%s is rejected with 401', (_label, header) => {
    const res = requireCronAuth(req(header))
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ success: false, error: 'Unauthorized' })
  })

  test('request with no headers object is rejected', () => {
    expect(requireCronAuth({}).status).toBe(401)
    expect(requireCronAuth(undefined).status).toBe(401)
  })

  test('fails closed when CRON_SECRET is not configured, even for "Bearer " + empty', () => {
    delete process.env.CRON_SECRET
    for (const h of [undefined, '', 'Bearer ', 'Bearer undefined', `Bearer ${SECRET}`]) {
      const res = requireCronAuth(req(h))
      expect(res.status).toBe(503)
      expect(isAuthorizedCronRequest(req(h))).toBe(false)
    }
    process.env.CRON_SECRET = ''
    expect(requireCronAuth(req('Bearer ')).status).toBe(503)
  })

  test('the secret never appears in any response or log line', () => {
    const logged = []
    const spy = jest.spyOn(console, 'error').mockImplementation((...a) => logged.push(a.join(' ')))
    const outputs = [requireCronAuth(req('Bearer wrong')), requireCronAuth(req(undefined))]
    delete process.env.CRON_SECRET
    outputs.push(requireCronAuth(req(`Bearer ${SECRET}`)))
    spy.mockRestore()
    const text = JSON.stringify(outputs) + logged.join('\n')
    expect(text).not.toContain(SECRET)
  })
})
