/**
 * @jest-environment node
 */
// middleware.js must refresh an expired Supabase session and write the new
// tokens back to the response cookies, without ever blocking a request.
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }))
const { createServerClient } = require('@supabase/ssr')
const { NextRequest } = require('next/server')
const { middleware, config, AUTH_REFRESH_TIMEOUT_MS } = require('../../middleware')

const AUTH = 'sb-hlsdlaibnayzbfflxclj-auth-token'
const req = (cookie) => new NextRequest('https://www.camcashgrl.com/api/live/session/start', {
  method: 'POST', headers: cookie ? { cookie } : {},
})

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  createServerClient.mockReset()
})

test('refreshed tokens are written to the response and the request', async () => {
  let seenRequest
  createServerClient.mockImplementation((url, key, { cookies }) => ({
    auth: { getUser: async () => { cookies.setAll([{ name: AUTH, value: 'new-token', options: { path: '/' } }]); return { data: {} } } },
  }))
  const request = req(`${AUTH}=old-token`)
  const res = await middleware(request)
  expect(res.cookies.get(AUTH)?.value).toBe('new-token')
  expect(request.cookies.get(AUTH)?.value).toBe('new-token') // route handlers see the fresh token
  expect(res.status).toBe(200)
})

test('anonymous requests skip Supabase entirely', async () => {
  const res = await middleware(req())
  expect(createServerClient).not.toHaveBeenCalled()
  expect(res.status).toBe(200)
})

test('an auth outage never blocks the request', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  createServerClient.mockReturnValue({ auth: { getUser: async () => { throw new Error('timeout') } } })
  const res = await middleware(req(`${AUTH}=old-token`))
  expect(res.status).toBe(200)
  expect(res.headers.get('location')).toBeNull()
  console.error.mockRestore()
})

test('a hung Supabase is cut off at the timeout instead of hitting the 25s 504', async () => {
  jest.useFakeTimers()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  createServerClient.mockReturnValue({ auth: { getUser: () => new Promise(() => {}) } }) // never settles
  const pending = middleware(req(`${AUTH}=old-token`))
  await jest.advanceTimersByTimeAsync(AUTH_REFRESH_TIMEOUT_MS)
  const res = await pending
  expect(res.status).toBe(200)
  expect(res.headers.get('location')).toBeNull()
  expect(console.error).toHaveBeenCalledWith('Session refresh failed:', expect.stringContaining('timed out'))
  console.error.mockRestore()
  jest.useRealTimers()
})

test('matcher skips static files, webhooks and cron', () => {
  const re = new RegExp('^' + config.matcher[0].replace('/((?!', '/(?!').replace(/\)\.\*\)$/, ').*') + '$')
  for (const p of ['/api/live/session/start', '/dashboard', '/live', '/'] ) expect(re.test(p)).toBe(true)
  for (const p of ['/_next/static/x.js', '/og-image.png', '/api/stripe/webhook', '/api/blog-webhook', '/api/cron/x', '/camcash-extension.zip']) expect(re.test(p)).toBe(false)
})
