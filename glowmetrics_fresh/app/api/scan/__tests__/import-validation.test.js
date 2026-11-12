/**
 * @jest-environment node
 */
// /api/scan/import: rows that reach the insert RPC must pass the shared
// import validation (full, plausible dates; whole-number tokens). A file with
// any bad row saves NOTHING. USD is recomputed server-side from tokens, so a
// misread balance can never become the amount here.
jest.mock('next/server', () => ({
  NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, json: async () => body }) },
}))

let rpcCalls
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'creator-1' } }, error: null }) },
    rpc: async (name, params) => { rpcCalls.push({ name, params }); return { data: { inserted: params.tips.length, skipped: 0, total: params.tips.length }, error: null } },
  }),
}))

const { POST } = require('../import/route')

const req = (rows) => ({
  headers: { get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer t' : null) },
  json: async () => ({ rows }),
})
const row = (over = {}) => ({ username: 'fanA', tokens: 100, timestamp: '2026-08-02T15:54:00.000Z', platform: 'chaturbate', ...over })

beforeEach(() => { rpcCalls = [] })

describe('/api/scan/import validation', () => {
  test('valid rows are saved with usd recomputed from tokens x the platform rate', async () => {
    const res = await POST(req([row(), row({ platform: 'bongacams', tokens: 1 })]))
    expect(res.status).toBe(200)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].params.tips.map((t) => t.usd)).toEqual([5, 0.03])
  })

  test.each([
    ['a date in 2000', '2000-04-01T04:00:00.000Z', 'date_before_floor'],
    ['year 0001', '0001-01-01T00:00:00.000Z', 'date_before_floor'],
    ['a date in 2148', '2148-01-01T00:00:00.000Z', 'date_in_future'],
  ])('%s rejects the whole file before any write', async (_l, timestamp, code) => {
    const res = await POST(req([row(), row({ timestamp })]))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('import_validation_failed')
    expect(body.problems[0]).toMatchObject({ row: 2, code })
    expect(rpcCalls).toEqual([])
  })

  test('a very large legitimate tip is saved (no cap on tip size)', async () => {
    const res = await POST(req([row({ tokens: 100000 })]))
    expect(res.status).toBe(200)
    expect(rpcCalls[0].params.tips[0].usd).toBe(5000)
  })
})
