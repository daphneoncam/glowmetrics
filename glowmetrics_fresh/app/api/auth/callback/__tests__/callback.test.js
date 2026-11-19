/**
 * @jest-environment node
 */
// Supabase OAuth / magic-link callback. The code exchange and session cookies
// are unchanged; what changed: redirects never go to a host taken from a
// forged Host / X-Forwarded-Host, and the signup notification is a direct
// server call instead of a fetch to `${origin}/api/notify/signup`.
jest.mock('next/server', () => ({ NextResponse: { redirect: (url) => ({ redirectedTo: String(url) }) } }))

const mockExchange = jest.fn()
const mockCreateRouteClient = jest.fn(() => ({ auth: { exchangeCodeForSession: mockExchange } }))
jest.mock('../../../../../lib/supabase-server', () => ({ createSupabaseRouteClient: () => mockCreateRouteClient() }))

const mockNotify = jest.fn(async () => {})
jest.mock('../../../../../lib/notifications/founder', () => ({ sendSignupNotification: (...a) => mockNotify(...a) }))

import { GET } from '../route'

const ENV_KEYS = ['VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'NODE_ENV']
const saved = {}
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  process.env.VERCEL_ENV = 'production'
  process.env.NODE_ENV = 'production'
  mockExchange.mockReset(); mockCreateRouteClient.mockClear(); mockNotify.mockClear()
  global.fetch = jest.fn()
})
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

const req = (url) => ({ url, headers: { get: () => null } })
const user = { id: 'u1', email: 'model@example.com', created_at: '2026-11-18T12:00:00Z' }

test('valid code: session exchanged, signup notified, redirected to onboarding on this site', async () => {
  mockExchange.mockResolvedValue({ data: { user }, error: null })
  const res = await GET(req('https://www.camcashgrl.com/api/auth/callback?code=abc123'))
  expect(mockCreateRouteClient).toHaveBeenCalledTimes(1) // cookie-bound client, as before
  expect(mockExchange).toHaveBeenCalledWith('abc123')
  expect(mockNotify).toHaveBeenCalledWith({ email: 'model@example.com', created_at: '2026-11-18T12:00:00Z' })
  expect(res.redirectedTo).toBe('https://www.camcashgrl.com/onboarding')
  expect(global.fetch).not.toHaveBeenCalled()
})

test('apex domain keeps its own origin so the session cookies just set still apply', async () => {
  mockExchange.mockResolvedValue({ data: { user }, error: null })
  const res = await GET(req('https://camcashgrl.com/api/auth/callback?code=abc'))
  expect(res.redirectedTo).toBe('https://camcashgrl.com/onboarding')
})

test('preview branch URL keeps its own origin', async () => {
  process.env.VERCEL_ENV = 'preview'
  process.env.VERCEL_URL = 'glowmetrics-abc123-team.vercel.app'
  process.env.VERCEL_BRANCH_URL = 'glowmetrics-git-feature-team.vercel.app'
  mockExchange.mockResolvedValue({ data: { user }, error: null })
  const res = await GET(req('https://glowmetrics-git-feature-team.vercel.app/api/auth/callback?code=abc'))
  expect(res.redirectedTo).toBe('https://glowmetrics-git-feature-team.vercel.app/onboarding')
})

test.each([
  'https://evil.example/api/auth/callback?code=abc',
  'https://www.camcashgrl.com.evil.example/api/auth/callback?code=abc',
  'http://www.camcashgrl.com/api/auth/callback?code=abc',
  'https://www.camcashgrl.com:4443/api/auth/callback?code=abc',
])('forged origin %p never becomes the redirect or a request target', async (url) => {
  mockExchange.mockResolvedValue({ data: { user }, error: null })
  const res = await GET(req(url))
  expect(res.redirectedTo).toBe('https://www.camcashgrl.com/onboarding')
  expect(global.fetch).not.toHaveBeenCalled()
})

test('invalid code: no notification, safe redirect to landing', async () => {
  mockExchange.mockResolvedValue({ data: { user: null }, error: { message: 'invalid grant' } })
  const res = await GET(req('https://evil.example/api/auth/callback?code=bad'))
  expect(mockNotify).not.toHaveBeenCalled()
  expect(res.redirectedTo).toBe('https://www.camcashgrl.com/landing')
})

test('missing code: no exchange attempted, redirect to landing', async () => {
  const res = await GET(req('https://www.camcashgrl.com/api/auth/callback'))
  expect(mockExchange).not.toHaveBeenCalled()
  expect(res.redirectedTo).toBe('https://www.camcashgrl.com/landing')
})

test('a failing notification never blocks the login redirect', async () => {
  mockExchange.mockResolvedValue({ data: { user }, error: null })
  mockNotify.mockRejectedValueOnce(new Error('resend down'))
  const res = await GET(req('https://www.camcashgrl.com/api/auth/callback?code=abc'))
  expect(res.redirectedTo).toBe('https://www.camcashgrl.com/onboarding')
})
