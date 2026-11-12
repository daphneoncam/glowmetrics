/**
 * @jest-environment node
 */
// middleware.js must refresh an expired Supabase session and write the new
// tokens back to the response cookies, without ever blocking a request.
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }))
const { createServerClient } = require('@supabase/ssr')
const { NextRequest } = require('next/server')
const { middleware, config, AUTH_TIMEOUT_MS } = require('../../middleware')

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


const never = () => new Promise(() => {})
const authErr = (status, message) => Object.assign(new Error(message), { status })

describe('bounded auth check', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { jest.useRealTimers(); console.error.mockRestore() })

  test('a hung getUser() returns a pass-through response at the deadline, cookies untouched', async () => {
    createServerClient.mockReturnValue({ auth: { getUser: never } })
    const p = middleware(req(`${AUTH}=old-token`))
    await jest.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS)
    const res = await p
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.cookies.getAll()).toEqual([])
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(AUTH_TIMEOUT_MS).toBe(3000)
  })

  test('the timeout aborts the underlying Supabase request and keeps caller signals effective', async () => {
    let gfetch
    createServerClient.mockImplementation((u, k, opts) => { gfetch = opts.global.fetch; return { auth: { getUser: never } } })
    const seen = []
    global.fetch = jest.fn((url, init) => { seen.push(init.signal); return never() })
    const p = middleware(req(`${AUTH}=old-token`))
    const caller = new AbortController()
    gfetch('https://example.supabase.co/auth/v1/user', { signal: caller.signal })
    gfetch('https://example.supabase.co/auth/v1/token')
    caller.abort()
    expect(seen[0].aborted).toBe(true)   // caller abort still propagates
    expect(seen[1].aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS)
    await p
    expect(seen[1].aborted).toBe(true)   // deadline aborts in-flight request
    expect(jest.getTimerCount()).toBe(0) // no timer left behind
  })

  test('cookie writes arriving after the timeout are discarded', async () => {
    let setAll, resolve
    createServerClient.mockImplementation((u, k, { cookies }) => { setAll = cookies.setAll; return { auth: { getUser: () => new Promise((r) => { resolve = r }) } } })
    const request = req(`${AUTH}=old-token`)
    const p = middleware(request)
    await jest.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS)
    const res = await p
    setAll([{ name: AUTH, value: 'late-token', options: {} }]); resolve({ data: {} })
    expect(res.cookies.get(AUTH)).toBeUndefined()
    expect(request.cookies.get(AUTH)?.value).toBe('old-token')
  })

  test('a refresh interrupted by the deadline: request aborted, old cookies kept, rotated tokens never written', async () => {
    // Recovery from an interrupted refresh is NOT guaranteed: if Supabase already
    // rotated the refresh token, the browser keeps the old one and success of the
    // next refresh depends on the project's reuse-interval config and timing.
    let gfetch, setAll, sig
    createServerClient.mockImplementation((u, k, opts) => {
      gfetch = opts.global.fetch; setAll = opts.cookies.setAll
      return { auth: { getUser: () => gfetch('https://example.supabase.co/auth/v1/token?grant_type=refresh_token').then(() => { setAll([{ name: AUTH, value: 'rotated', options: {} }]); return { data: {} } }) } }
    })
    global.fetch = jest.fn((url, init) => { sig = init.signal; return never() })
    const request = req(`${AUTH}=old-token`)
    const p = middleware(request)
    await jest.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS)
    const res = await p
    expect(sig.aborted).toBe(true)
    expect(res.cookies.get(AUTH)).toBeUndefined()
    expect(request.cookies.get(AUTH)?.value).toBe('old-token')
    expect(jest.getTimerCount()).toBe(0)
  })

  test('a thrown error also clears the timer and passes through', async () => {
    createServerClient.mockReturnValue({ auth: { getUser: async () => { throw new Error('boom') } } })
    const res = await middleware(req(`${AUTH}=old-token`))
    expect(res.status).toBe(200)
    expect(res.cookies.getAll()).toEqual([])
    expect(jest.getTimerCount()).toBe(0)
  })

  test('a slow but in-time refresh still commits the new cookies and clears its timer', async () => {
    createServerClient.mockImplementation((u, k, { cookies }) => ({
      auth: { getUser: () => new Promise((r) => setTimeout(() => { cookies.setAll([{ name: AUTH, value: 'fresh', options: { path: '/' } }]); r({ data: { user: { id: 'u' } } }) }, AUTH_TIMEOUT_MS - 500)) },
    }))
    const p = middleware(req(`${AUTH}=old-token`))
    await jest.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS - 500)
    const res = await p
    expect(res.cookies.get(AUTH)?.value).toBe('fresh')
    expect(jest.getTimerCount()).toBe(0)
  })

  test('network-level auth failure keeps the existing session cookies (no false sign-out)', async () => {
    createServerClient.mockImplementation((u, k, { cookies }) => ({
      auth: { getUser: async () => { cookies.setAll([{ name: AUTH, value: '', options: { maxAge: 0 } }]); return { data: { user: null }, error: authErr(0, 'fetch failed') } } },
    }))
    const res = await middleware(req(`${AUTH}=old-token`))
    expect(res.cookies.get(AUTH)).toBeUndefined()
    expect(res.headers.get('location')).toBeNull()
  })

  test('Supabase definitively rejecting the refresh token still applies its sign-out cookies', async () => {
    createServerClient.mockImplementation((u, k, { cookies }) => ({
      auth: { getUser: async () => { cookies.setAll([{ name: AUTH, value: '', options: { maxAge: 0 } }]); return { data: { user: null }, error: authErr(400, 'Invalid Refresh Token') } } },
    }))
    const res = await middleware(req(`${AUTH}=old-token`))
    expect(res.cookies.get(AUTH)?.value).toBe('')
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  test('a 5xx/522-style auth error passes through without touching cookies', async () => {
    createServerClient.mockImplementation((u, k, { cookies }) => ({
      auth: { getUser: async () => { cookies.setAll([{ name: AUTH, value: '', options: { maxAge: 0 } }]); return { data: { user: null }, error: authErr(522, 'connection timed out') } } },
    }))
    const res = await middleware(req(`${AUTH}=old-token`))
    expect(res.cookies.get(AUTH)).toBeUndefined()
  })
})

test('matcher skips static files, webhooks and cron', () => {
  const re = new RegExp('^' + config.matcher[0].replace('/((?!', '/(?!').replace(/\)\.\*\)$/, ').*') + '$')
  for (const p of ['/api/live/session/start', '/dashboard', '/live', '/'] ) expect(re.test(p)).toBe(true)
  for (const p of ['/_next/static/x.js', '/og-image.png', '/api/stripe/webhook', '/api/blog-webhook', '/api/cron/x', '/camcash-extension.zip']) expect(re.test(p)).toBe(false)
})
