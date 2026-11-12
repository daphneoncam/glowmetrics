/**
 * @jest-environment node
 */
// /api/chaturbate/stats-sync: API rows pass the shared import validation before
// any write. On a bad row nothing is saved, the sync cursor does NOT advance
// (so the rows are retried, not skipped forever), and the failure is logged.
jest.mock('next/server', () => ({
  NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, json: async () => body }) },
}))

let log, rpcCalls, apiResults
function chain(table) {
  const c = {
    select: () => c,
    eq: () => c,
    single: async () => (table === 'profiles' ? { data: { chaturbate_username: 'model', chaturbate_stats_token: 'tok' }, error: null } : { data: null, error: null }),
    insert: async (payload) => { log.push({ op: 'insert', table, payload }); return { error: null } },
    upsert: async (payload) => { log.push({ op: 'upsert', table, payload }); return { error: null } },
  }
  return c
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'creator-1' } }, error: null }) },
    from: (table) => chain(table),
    rpc: async (name, params) => { rpcCalls.push({ name, params }); return { data: { inserted: params.tips.length, skipped: 0 }, error: null } },
  }),
}))

const { POST } = require('../stats-sync/route')
const req = () => ({ headers: { get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer t' : null) } })
const tipRow = (over = {}) => ({ created_at: '2026-08-02T15:54:00.000Z', username: 'fanA', num_tokens: 100, value_in_usd: 5, tip_note: '', ...over })

beforeEach(() => {
  log = []; rpcCalls = []; apiResults = []
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ results: apiResults }) }))
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('/api/chaturbate/stats-sync validation', () => {
  test('valid API rows are saved and the cursor advances', async () => {
    apiResults = [tipRow(), tipRow({ username: 'fanB', num_tokens: 5000, value_in_usd: 250 })]
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(rpcCalls).toHaveLength(1)
    expect(log.some((e) => e.op === 'upsert' && e.table === 'sync_cursors')).toBe(true)
  })

  test.each([
    ['a balance-sized usd', { num_tokens: 1, value_in_usd: 7886 }, 'usd_exceeds_viewer_price'],
    ['a date in 2001', { created_at: '2001-04-01T04:00:00.000Z' }, 'date_before_floor'],
    ['a date in 2148', { created_at: '2148-01-01T00:00:00.000Z' }, 'date_in_future'],
    ['zero tokens', { num_tokens: 0, value_in_usd: 0 }, 'tokens_invalid'],
  ])('%s: nothing saved, cursor not advanced, failure logged', async (_l, over, code) => {
    apiResults = [tipRow(), tipRow({ username: 'fanB', ...over })]
    const res = await POST(req())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('import_validation_failed')
    expect(body.problems.map((p) => p.code)).toContain(code)
    expect(rpcCalls).toEqual([])
    expect(log.some((e) => e.op === 'upsert')).toBe(false)
    const failed = log.find((e) => e.table === 'sync_jobs')
    expect(failed.payload).toMatchObject({ status: 'failed', records_inserted: 0 })
  })
})
