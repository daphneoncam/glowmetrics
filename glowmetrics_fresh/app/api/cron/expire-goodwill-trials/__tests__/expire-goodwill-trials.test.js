/**
 * Regression tests for the goodwill-trial expiry cron.
 *
 * This exists so the Sep 2026 apology Pro grant (compensating users hit by
 * the Stripe webhook pagination bug) can never become permanent by
 * accident. It must:
 *   - only ever touch subscription_status = 'goodwill_trial' rows (never a
 *     real Stripe-driven 'active'/'trialing' subscription)
 *   - only downgrade rows whose trial_ends_at has actually passed
 *   - leave rows with a future trial_ends_at completely alone
 */
jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => ({ body, init }) } }))

const mockSupabaseClient = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockSupabaseClient) }))

import { GET } from '../route.js'

function mockProfilesTable({ selectResult, updateResult }) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    lt: jest.fn(async () => selectResult),
    update: jest.fn(() => updateChain),
  }
  const updateChain = {
    eq: jest.fn(() => updateChain),
    lt: jest.fn(async () => updateResult),
  }
  mockSupabaseClient.from.mockReturnValue(chain)
  return chain
}

describe('expire-goodwill-trials cron', () => {
  beforeEach(() => jest.clearAllMocks())

  test('downgrades expired goodwill grants to free with no plan/status left behind', async () => {
    mockProfilesTable({
      selectResult: { data: [{ id: 'u1' }, { id: 'u2' }], error: null },
      updateResult: { error: null },
    })
    const res = await GET(authorizedReq())
    expect(res.body.success).toBe(true)
    expect(res.body.downgraded).toBe(2)
    expect(res.body.userIds).toEqual(['u1', 'u2'])

    const chain = mockSupabaseClient.from.mock.results[0].value
    expect(chain.select).toHaveBeenCalled()
    expect(chain.update).toHaveBeenCalledWith({ plan: 'free', subscription_status: 'none', trial_ends_at: null })
  })

  test('only ever filters on subscription_status = goodwill_trial — never touches real subscriptions', async () => {
    const chain = mockProfilesTable({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    })
    await GET(authorizedReq())
    expect(chain.eq).toHaveBeenCalledWith('subscription_status', 'goodwill_trial')
  })

  test('nothing expired: reports zero downgraded and does not call update', async () => {
    const chain = mockProfilesTable({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    })
    const res = await GET(authorizedReq())
    expect(res.body.downgraded).toBe(0)
    expect(chain.update).not.toHaveBeenCalled()
  })

  test('select failure returns an error response instead of downgrading blind', async () => {
    mockProfilesTable({
      selectResult: { data: null, error: { message: 'db unreachable' } },
      updateResult: { error: null },
    })
    const res = await GET(authorizedReq())
    expect(res.body.success).toBe(false)
    expect(res.init.status).toBe(500)
  })
})


// Cron routes now require Vercel's CRON_SECRET bearer token (lib/cron-auth.js).
// These tests exercise the job logic, so they call it as the scheduler does.
// Unauthorized access is covered in app/api/cron/__tests__/cron-auth-all-routes.test.js.
function authorizedReq() {
  process.env.CRON_SECRET = 'test-cron-secret'
  return { headers: { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer test-cron-secret' : null) } }
}
