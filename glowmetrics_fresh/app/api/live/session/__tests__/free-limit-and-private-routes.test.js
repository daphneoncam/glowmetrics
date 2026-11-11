/**
 * @jest-environment node
 */
// Free Live Mode allowance + Private Mode, at the route layer. The rules
// themselves live in SQL (20261103 migration); these tests pin down that every
// route asks the database, in the right order, and answers with fixed copy.
jest.mock('next/server', () => ({
  NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, json: async () => body }) },
}))

const LIVE = {
  id: '22222222-2222-4222-8222-222222222222', user_id: 'creator-1', status: 'live', live_substate: 'active',
  stream_platform: 'BongaCams', started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  ended_at: null, paused_at: null, total_paused_seconds: 0,
}
const LIMIT_ENDED = {
  ...LIVE, status: 'ended', live_substate: null, session_resolution_type: 'free_active_limit',
  ended_at: new Date(Date.now() - 30 * 1000).toISOString(),
}

let state
function chain(table) {
  const c = {
    select: jest.fn(() => c), eq: jest.fn(() => c), in: jest.fn(() => c), is: jest.fn(() => c),
    order: jest.fn(() => c), limit: jest.fn(() => c),
    maybeSingle: jest.fn(async () => state.single[table] ?? { data: null, error: null }),
  }
  return c
}
function mockSupabase() {
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: state.user }, error: state.user ? null : { message: 'x' } })) },
    from: jest.fn((t) => chain(t)),
    rpc: jest.fn(async (name, params) => { state.rpcCalls.push({ name, params }); return state.rpc[name] ?? { data: null, error: null } }),
  }
}
const req = (body, url = 'http://x/api') => ({
  url,
  headers: { get: (h) => (h === 'authorization' ? 'Bearer t' : null) },
  json: async () => { if (body === undefined) throw new Error('no body'); return body },
})
const rpcNames = () => state.rpcCalls.map((c) => c.name)
// plpgsql composite NULL as PostgREST returns it
const NULL_ROW = { id: null, status: null }

beforeEach(() => {
  state = { user: { id: 'creator-1' }, single: {}, rpc: {}, rpcCalls: [] }
  jest.resetModules()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.doMock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockSupabase()) }))
  jest.doMock('../../../../../lib/supabase-server', () => ({ createSupabaseRouteClient: jest.fn() }))
})
afterEach(() => console.error.mockRestore())

describe('POST /api/live/session/start', () => {
  test('passes the browser timezone so the Free week resets at the creator-local Monday', async () => {
    state.rpc.start_live_session = { data: { ...LIVE, status: 'starting' }, error: null }
    const { POST } = await import('../start/route.js')
    const res = await POST(req({ platform: 'BongaCams', timezone: 'America/Los_Angeles' }))
    expect(res.status).toBe(200)
    expect(state.rpcCalls).toEqual([{ name: 'start_live_session', params: { p_platform: 'BongaCams', p_timezone: 'America/Los_Angeles' } }])
  })

  test('third Free start this week is a 403 with fixed copy, never the raw DB text', async () => {
    state.rpc.start_live_session = { data: null, error: { code: 'P0001', message: 'FREE_LIVE_WEEKLY_LIMIT: Free Live Mode includes 2 streams per week. internal detail' } }
    const { POST } = await import('../start/route.js')
    const res = await POST(req({ platform: 'Chaturbate' }))
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('FREE_LIVE_WEEKLY_LIMIT')
    expect(body.error).toMatch(/both Free Live Mode streams this week/)
    expect(body.error).toMatch(/Monday at 12:00 AM your time/)
    expect(body.error).not.toMatch(/internal detail/)
  })

  test('an already-running session is returned without calling the start RPC (refresh cannot consume a start)', async () => {
    state.single.live_sessions = { data: LIVE, error: null }
    const { POST } = await import('../start/route.js')
    const res = await POST(req({ platform: 'Chaturbate' }))
    expect((await res.json()).session.id).toBe(LIVE.id)
    expect(rpcNames()).not.toContain('start_live_session')
  })
})

describe('35 active minutes: every polled route asks the database first', () => {
  test('website heartbeat enforces before heartbeating and reports the limit end', async () => {
    state.rpc.enforce_live_active_limit = { data: LIMIT_ENDED, error: null }
    state.rpc.send_website_heartbeat = { data: NULL_ROW, error: null }
    const { POST } = await import('../heartbeat/route.js')
    const body = await (await POST(req())).json()
    expect(rpcNames()).toEqual(['enforce_live_active_limit', 'send_website_heartbeat'])
    expect(body.limitEnded).toMatchObject({ id: LIVE.id, session_resolution_type: 'free_active_limit' })
  })

  test('extension heartbeat enforces before heartbeating', async () => {
    state.rpc.enforce_live_active_limit = { data: NULL_ROW, error: null }
    state.rpc.send_extension_heartbeat = { data: LIVE, error: null }
    const { POST } = await import('../extension-heartbeat/route.js')
    const body = await (await POST(req({ platform: 'bongacams', broadcasterPageDetected: true }))).json()
    expect(rpcNames()).toEqual(['enforce_live_active_limit', 'send_extension_heartbeat'])
    expect(body.limitEnded).toBeNull()
    expect(body.session.id).toBe(LIVE.id)
  })

  test('a failed enforce call never breaks the heartbeat (pg_cron sweep is the backstop)', async () => {
    state.rpc.enforce_live_active_limit = { data: null, error: { message: 'boom' } }
    state.rpc.send_website_heartbeat = { data: LIVE, error: null }
    const { POST } = await import('../heartbeat/route.js')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect((await res.json()).session.id).toBe(LIVE.id)
  })

  test('session poll (GET) sweeps, enforces, then reports a just-limited stream', async () => {
    state.single.live_sessions = { data: null, error: null }
    const { GET } = await import('../route.js')
    // after the running-session lookup finds nothing, the recent-ended lookup returns the limited one
    let lookups = 0
    state.single = new Proxy({}, { get: (_, t) => (t === 'live_sessions' ? (lookups++ === 0 ? { data: null, error: null } : { data: LIMIT_ENDED, error: null }) : undefined) })
    const body = await (await GET(req())).json()
    expect(rpcNames()).toEqual(['sweep_stale_live_session', 'enforce_live_active_limit'])
    expect(body.session).toBeNull()
    expect(body.limitEnded).toMatchObject({ id: LIVE.id })
  })

  test('session poll attaches the Free clock from the database (first real tip)', async () => {
    state.single.live_sessions = { data: LIVE, error: null }
    const tipAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    state.rpc.get_live_free_clock = { data: { session_id: LIVE.id, clock_started_at: tipAt, paused_seconds: 0 }, error: null }
    const { GET } = await import('../route.js')
    const body = await (await GET(req())).json()
    expect(rpcNames()).toEqual(['sweep_stale_live_session', 'enforce_live_active_limit', 'get_live_free_clock'])
    expect(body.session.free_clock).toEqual({ started_at: tipAt, paused_seconds: 0 })
    expect(Math.abs(body.session.free_active_seconds - 300)).toBeLessThanOrEqual(1)
    expect(Math.abs(body.session.active_duration_seconds - 600)).toBeLessThanOrEqual(1)
  })

  test('no real tip yet -> free clock not started (null), stream timing unchanged', async () => {
    state.single.live_sessions = { data: LIVE, error: null }
    state.rpc.get_live_free_clock = { data: { session_id: LIVE.id, clock_started_at: null, paused_seconds: null }, error: null }
    const { GET } = await import('../route.js')
    const body = await (await GET(req())).json()
    expect(body.session.free_active_seconds).toBeNull()
  })

  test('clock lookup failure -> no clock sent (no guessed countdown), poll still succeeds', async () => {
    state.single.live_sessions = { data: LIVE, error: null }
    state.rpc.get_live_free_clock = { data: null, error: { message: 'boom' } }
    const { GET } = await import('../route.js')
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.session.id).toBe(LIVE.id)
    expect(body.session.free_clock).toBeUndefined()
    expect(body.session.free_active_seconds).toBeUndefined()
  })

  test('a clock for a different session is ignored', async () => {
    state.single.live_sessions = { data: LIVE, error: null }
    state.rpc.get_live_free_clock = { data: { session_id: 'other', clock_started_at: new Date().toISOString(), paused_seconds: 0 }, error: null }
    const { GET } = await import('../route.js')
    const body = await (await GET(req())).json()
    expect(body.session.free_clock).toBeUndefined()
  })

  test('resume after the limit returns the ended stream, does not resume', async () => {
    state.rpc.enforce_live_active_limit = { data: LIMIT_ENDED, error: null }
    const { POST } = await import('../resume/route.js')
    const body = await (await POST(req())).json()
    expect(rpcNames()).toEqual(['enforce_live_active_limit'])
    expect(body.session).toBeNull()
    expect(body.limitEnded.id).toBe(LIVE.id)
  })
})

describe('POST /api/live/session/private/start', () => {
  test('Skip: no rate and no username are sent to the database as NULL (never 0)', async () => {
    state.rpc.start_private_interval = { data: { id: 'p1', platform: 'BongaCams', username: null, rate_per_minute: null }, error: null }
    const { POST } = await import('../private/start/route.js')
    const res = await POST(req({ ratePerMinute: null, username: null }))
    expect(res.status).toBe(200)
    expect(state.rpcCalls[1]).toEqual({ name: 'start_private_interval', params: { p_rate_per_minute: null, p_platform: null, p_username: null } })
  })

  test('blank username is NULL, not an empty string', async () => {
    const { POST } = await import('../private/start/route.js')
    await POST(req({ ratePerMinute: 2, username: '   ' }))
    expect(state.rpcCalls[1].params).toEqual({ p_rate_per_minute: 2, p_platform: null, p_username: null })
  })

  test.each([[-1], [1001], ['abc'], [true]])('a given rate must be valid (%p) -> 400, nothing called', async (bad) => {
    const { POST } = await import('../private/start/route.js')
    const res = await POST(req({ ratePerMinute: bad, username: 'fan' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_RATE')
    expect(state.rpcCalls).toEqual([])
  })

  test('username over 80 characters -> 400, nothing called', async () => {
    const { POST } = await import('../private/start/route.js')
    const res = await POST(req({ ratePerMinute: 2, username: 'x'.repeat(81) }))
    expect(res.status).toBe(400)
    expect(state.rpcCalls).toEqual([])
  })

  test('sends username, and no platform when the client sent none (server uses the session platform)', async () => {
    state.rpc.start_private_interval = { data: { id: 'p1', platform: 'BongaCams', username: 'fan1', rate_per_minute: 2 }, error: null }
    const { POST } = await import('../private/start/route.js')
    const body = await (await POST(req({ ratePerMinute: 2, username: ' fan1 ' }))).json()
    expect(state.rpcCalls).toEqual([
      { name: 'enforce_live_active_limit', params: undefined },
      { name: 'start_private_interval', params: { p_rate_per_minute: 2, p_platform: null, p_username: 'fan1' } },
    ])
    expect(body.privateInterval).toMatchObject({ platform: 'BongaCams', username: 'fan1' })
  })

  test('platform the server cannot confirm is refused with a clear message (not guessed)', async () => {
    state.rpc.start_private_interval = { data: null, error: { code: '22023', message: 'PLATFORM_MISMATCH: session platform Chaturbate but extension detected BongaCams' } }
    const { POST } = await import('../private/start/route.js')
    const res = await POST(req({ ratePerMinute: 2, username: 'fan1' }))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('PLATFORM_MISMATCH')
    expect(body.error).toMatch(/wasn’t saved/)
  })

  test('no private start once the Free stream has hit 35 active minutes', async () => {
    state.rpc.enforce_live_active_limit = { data: LIMIT_ENDED, error: null }
    const { POST } = await import('../private/start/route.js')
    const res = await POST(req({ ratePerMinute: 2, username: 'fan1' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('FREE_LIVE_ACTIVE_LIMIT')
    expect(rpcNames()).not.toContain('start_private_interval')
  })
})

describe('GET /api/live/usage', () => {
  test('reads the allowance from the database with the browser timezone', async () => {
    state.rpc.get_live_mode_allowance = { data: { unlimited: false, streams_used: 1, streams_per_week: 2 }, error: null }
    const { GET } = await import('../../usage/route.js')
    const body = await (await GET(req(undefined, 'http://x/api/live/usage?timezone=Asia%2FTokyo'))).json()
    expect(state.rpcCalls).toEqual([{ name: 'get_live_mode_allowance', params: { p_timezone: 'Asia/Tokyo' } }])
    expect(body.allowance.streams_used).toBe(1)
  })
})
