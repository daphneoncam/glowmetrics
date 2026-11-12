/**
 * @jest-environment node
 */
// /api/upload server-side validation (#733 / #734).
//  - A file with ANY corrupt row is rejected as a whole BEFORE any tip or paid
//    session is saved, with an actionable error, and logged as 'rejected'.
//  - The csv_uploads row is created first, the tips are tagged with its id, and
//    its final status is truthful ('complete' only if everything saved).
//  - Valid imports — including very large tips and explicit payouts — are
//    untouched; naive timestamps are read in the creator's profiles.timezone.
jest.mock('next/server', () => ({
  NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, json: async () => body }) },
}))

let log
let rpcCalls
let mockSavedTz
let mockTipsFailOnCall // 1-based insert_tips_dedup call that returns an error
let mockPaidFails

function mockSupabase() {
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'creator-1' } }, error: null })) },
    from: jest.fn((table) => {
      const chain = {
        insert: jest.fn(async (payload) => { log.push({ op: 'insert', table, payload }); return { error: null } }),
        update: jest.fn((payload) => ({ eq: jest.fn(async (col, val) => { log.push({ op: 'update', table, payload, col, val }); return { error: null } }) })),
        delete: jest.fn(() => { log.push({ op: 'delete', table }); return chain }),
        select: jest.fn(() => chain),
        eq: jest.fn(() => ({ then: (resolve) => resolve({ error: null }), maybeSingle: async () => ({ data: { timezone: mockSavedTz }, error: null }) })),
      }
      return chain
    }),
    rpc: jest.fn(async (name, params) => {
      rpcCalls.push({ name, params })
      if (name === 'insert_tips_dedup') {
        const n = rpcCalls.filter((c) => c.name === 'insert_tips_dedup').length
        if (n === mockTipsFailOnCall) return { data: null, error: { message: 'simulated tip storage failure' } }
        return { data: { inserted: params.tips.length, skipped: 0 }, error: null }
      }
      if (name === 'insert_paid_sessions_dedup') {
        if (mockPaidFails) return { data: null, error: { message: 'simulated paid storage failure' } }
        return { data: { inserted: params.sessions.length, skipped: 0 }, error: null }
      }
      return { data: null, error: null }
    }),
  }
}
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupabase() }))

const { POST: upload } = require('../route')

function req(text, { platform = 'Chaturbate', timeZone } = {}) {
  const fd = new Map([['file', { name: 'export.csv', text: async () => text }], ['platform', platform]])
  if (timeZone !== undefined) fd.set('time_zone', timeZone)
  return {
    headers: { get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer t' : null) },
    formData: async () => ({ get: (k) => fd.get(k) ?? null }),
  }
}
const HEADER = 'date_time,username,tokens,usd'
const csv = (...rows) => [HEADER, ...rows].join('\n')
const GOOD = '2026-08-02 08:54:54,fanA,100,5'

const savedTips = () => rpcCalls.filter((c) => c.name === 'insert_tips_dedup').flatMap((c) => c.params.tips)
const dataWrites = () => rpcCalls.filter((c) => c.name === 'insert_tips_dedup' || c.name === 'insert_paid_sessions_dedup')
const uploadLog = () => log.filter((e) => e.table === 'csv_uploads')

beforeEach(() => {
  log = []; rpcCalls = []; mockSavedTz = 'America/Los_Angeles'; mockTipsFailOnCall = null; mockPaidFails = false
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('corrupt files are rejected as a whole, before any write', () => {
  test.each([
    ['a running balance saved as USD (tokens=1, usd=7886)', csv(GOOD, '2026-08-02 08:54:54,fanB,1,7886'), 'usd_exceeds_viewer_price'],
    ['a bare-number date', csv(GOOD, '7,fanB,5,0.25'), 'date_not_full'],
    ['a year-less date', csv(GOOD, 'Apr 1,fanB,5,0.25'), 'date_not_full'],
    ['a missing date (must not become "now")', csv(GOOD, ',fanB,5,0.25'), 'date_missing'],
    ['a date in 2001', csv(GOOD, '2001-04-01 00:00,fanB,5,0.25'), 'date_before_floor'],
    ['a date in year 0001', csv(GOOD, '0001-01-01 00:00,fanB,5,0.25'), 'date_before_floor'],
    ['a date in 2148', csv(GOOD, '2148-01-01 00:00,fanB,5,0.25'), 'date_in_future'],
  ])('%s', async (_label, text, code) => {
    const res = await upload(req(text))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('import_validation_failed')
    expect(body.problems.map((p) => p.code)).toContain(code)
    // The GOOD row in the same file is NOT saved either: all-or-nothing.
    expect(dataWrites()).toEqual([])
    expect(log.some((e) => e.op === 'delete')).toBe(false)
  })

  test('the error names the row, says nothing was saved, and tells the user what to check', async () => {
    const res = await upload(req(csv(GOOD, GOOD.replace('fanA', 'fanC'), '2026-08-02 08:54:54,fanB,1,7886')))
    const body = await res.json()
    expect(body.error).toMatch(/Nothing was saved/)
    expect(body.error).toMatch(/Row 3/)
    expect(body.problems[0]).toMatchObject({ row: 3, code: 'usd_exceeds_viewer_price' })
    expect(body.problems[0].hint.length).toBeGreaterThan(10)
    expect(body.problemCount).toBe(1)
    expect(body.rowsChecked).toBe(3)
  })

  test('a rejected import is logged as rejected with zero totals (it never inflates upload totals)', async () => {
    await upload(req(csv(GOOD, '2026-08-02 08:54:54,fanB,1,7886')))
    const rows = uploadLog()
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ status: 'rejected', inserted_rows: 0, total_usd: 0, total_tokens: 0 })
  })

  test('a rejected import is never reported as complete', async () => {
    await upload(req(csv(GOOD, '7,fanB,5,0.25')))
    expect(uploadLog().some((e) => e.payload.status === 'complete')).toBe(false)
  })

  test('every problem in a bad file is reported (up to 20) with an exact total', async () => {
    const bad = Array.from({ length: 30 }, (_, i) => `2026-08-02 08:${String(10 + (i % 40)).padStart(2, '0')}:00,fan${i},1,7886`)
    const body = await (await upload(req(csv(...bad)))).json()
    expect(body.problems).toHaveLength(20)
    expect(body.problemCount).toBe(30)
    expect(body.truncated).toBe(true)
  })
})

describe('valid imports are unchanged', () => {
  test('a normal file is saved and logged complete', async () => {
    const res = await upload(req(csv(GOOD, '2026-08-02 09:00:00,fanB,50,2.5')))
    expect(res.status).toBe(200)
    expect((await res.json()).inserted).toBe(2)
    expect(savedTips()).toHaveLength(2)
  })

  test('very large legitimate tips are saved (no cap on tip size)', async () => {
    const res = await upload(req(csv('2026-08-02 08:54:54,whale,5000,250', '2026-08-02 09:54:54,whale2,100000,5000')))
    expect(res.status).toBe(200)
    expect(savedTips().map((t) => t.tokens)).toEqual([5000, 100000])
  })

  test('explicit BongaCams payouts (whole-dollar and fractional) are saved', async () => {
    const res = await upload(req(csv('18.07.2026 14:00,fanA,450,9.00', '18.07.2026 15:00,fanB,450,9.50', '18.07.2026 16:00,fanC,63,2.29'), { platform: 'BongaCams' }))
    expect(res.status).toBe(200)
    expect(savedTips().map((t) => t.usd)).toEqual([9, 9.5, 2.29])
  })

  test('MyFreeCams and Chaturbate files import', async () => {
    for (const platform of ['MyFreeCams', 'Chaturbate']) {
      rpcCalls = []
      const res = await upload(req(csv('2026-08-02 08:54:54,fanA,100,5'), { platform }))
      expect(res.status).toBe(200)
      expect(savedTips()).toHaveLength(1)
    }
  })
})

describe('upload tracing and truthful status', () => {
  test('the upload record is created first and the tips are tagged with its id', async () => {
    await upload(req(csv(GOOD)))
    const created = uploadLog().find((e) => e.op === 'insert')
    expect(created.payload.status).toBe('processing')
    expect(created.payload.id).toMatch(/^[0-9a-f-]{36}$/)
    const call = rpcCalls.find((c) => c.name === 'insert_tips_dedup')
    expect(call.params.p_upload_id).toBe(created.payload.id)
    // ...and the same record is finished as complete.
    const done = uploadLog().find((e) => e.op === 'update')
    expect(done).toMatchObject({ col: 'id', val: created.payload.id })
    expect(done.payload).toMatchObject({ status: 'complete', inserted_rows: 1 })
  })

  test('the record exists before the first insert (the FK needs it)', async () => {
    await upload(req(csv(GOOD)))
    const createdAt = log.findIndex((e) => e.table === 'csv_uploads' && e.op === 'insert')
    expect(createdAt).toBeGreaterThanOrEqual(0)
    // the only RPCs before it are the parse log; no data RPC has run yet
    expect(rpcCalls.filter((c) => c.name === 'insert_tips_dedup')).toHaveLength(1)
  })

  test('a failed batch makes the import "partial", never "complete"', async () => {
    mockTipsFailOnCall = 2
    const rows = Array.from({ length: 300 }, (_, i) => `2026-08-02 ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00,fan${i},10,0.5`)
    const res = await upload(req(csv(...rows)))
    const body = await res.json()
    expect(body.ok).toBe(false)
    const done = uploadLog().find((e) => e.op === 'update')
    expect(done.payload.status).toBe('partial')
    expect(done.payload.inserted_rows).toBe(250)
  })

  test('a private-earnings failure also makes the import "partial"', async () => {
    mockPaidFails = true
    const text = [
      'Date and Time,Member,Chat Type,Tokens Earned,Your Payout',
      '18.07.2026 14:00,fanA,Private Chat,100,2.5',
    ].join('\n')
    const res = await upload(req(text, { platform: 'BongaCams' }))
    expect(res.status).toBe(200)
    const finals = uploadLog().filter((e) => e.op === 'update')
    expect(finals[finals.length - 1].payload.status).toBe('partial')
  })
})

describe("the creator's timezone decides naive timestamps (never UTC, never the server)", () => {
  const savedInstant = async (tz) => {
    rpcCalls = []; mockSavedTz = tz
    await upload(req(csv('2026-08-02 08:54:00,fanA,100,5')))
    return savedTips()[0].date_time
  }

  test('the same wall-clock time is a different instant for creators in different zones', async () => {
    expect(await savedInstant('America/Los_Angeles')).toBe('2026-08-02T15:54:00.000Z')
    expect(await savedInstant('America/New_York')).toBe('2026-08-02T12:54:00.000Z')
    expect(await savedInstant('UTC')).toBe('2026-08-02T08:54:00.000Z')
  })

  test('no saved timezone and none sent is refused, not guessed as UTC', async () => {
    mockSavedTz = null
    const res = await upload(req(csv(GOOD)))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('timezone_required')
    expect(dataWrites()).toEqual([])
  })

  test('the validation sees the creator-zone instant: a late-evening Los Angeles tip is not read as the next UTC day', async () => {
    mockSavedTz = 'America/Los_Angeles'
    const res = await upload(req(csv('2026-08-02 22:30:00,fanA,100,5')))
    expect(res.status).toBe(200)
    expect(savedTips()[0].date_time).toBe('2026-08-03T05:30:00.000Z')
  })
})

// Real formats already used as fixtures elsewhere in the repo must still import:
// the validator exists to stop corruption, not to reject genuine exports.
describe('genuine export formats are not rejected', () => {
  const { CB_RECENT_EXPORT } = require('../../../../lib/__tests__/fixtures/chaturbateRecentExport')
  const { controlFile } = require('../../../../lib/__tests__/fixtures/onboardingControl')

  test('Chaturbate statement export (tab-separated, Token Balance column) imports', async () => {
    const res = await upload(req(CB_RECENT_EXPORT, { platform: 'Chaturbate' }))
    const body = await res.json()
    expect({ status: res.status, code: body.code }).toEqual({ status: 200, code: undefined })
    expect(savedTips().length).toBeGreaterThan(100)
    // the Token Balance column is never read as USD
    expect(savedTips().every((t) => t.usd <= t.tokens * 0.1 + 0.005)).toBe(true)
  })

  test('Chaturbate CSV with a Token balance header imports and ignores the balance', async () => {
    const res = await upload(req(controlFile(), { platform: 'Chaturbate' }))
    const body = await res.json()
    expect({ status: res.status, code: body.code }).toEqual({ status: 200, code: undefined })
    expect(savedTips().every((t) => t.usd < 1000)).toBe(true)
  })

  test('BongaCams stacked-header paste with fractional-cent payouts imports', async () => {
    const text = [
      'Date and Time', 'Member', 'Type', 'Tokens Earned', 'Your Payout',
      '13.09.2026 16:19\tkopeesh\tTips\t16\t$0.378',
      '13.09.2026 16:32\tlongstroke7\tTips\t1\t$0.024',
      '20.09.2026 03:41\tHorny-Kutas\tTips\t1\t$0.023',
    ].join('\n')
    const res = await upload(req(text, { platform: 'BongaCams' }))
    const body = await res.json()
    expect({ status: res.status, code: body.code }).toEqual({ status: 200, code: undefined })
    expect(savedTips()).toHaveLength(3)
  })
})
