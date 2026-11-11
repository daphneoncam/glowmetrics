/**
 * @jest-environment node
 */
// Checkout route, with Stripe and the database mocked: no real customer, price
// or session is created. Covers auth, plan validation, the advertised-price guard,
// the 7-day trial, and the success / cancel return URLs.

process.env.STRIPE_MONTHLY_PRICE_ID = 'price_m' // the route reads the monthly price ID from env

const mockSession = { id: 'cs_test_1', url: 'https://checkout.stripe.test/c/cs_test_1' }
const stripe = {
  customers: { create: jest.fn(async () => ({ id: 'cus_new' })) },
  prices: {
    retrieve: jest.fn(),
    list: jest.fn(async () => ({ data: [] })),
  },
  checkout: { sessions: { create: jest.fn(async () => mockSession) } },
}
jest.mock('../../../../../lib/stripe', () => ({ stripe }))

// Chainable, awaitable stand-in for the Supabase query builder used by the route.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const c = {
        select: () => c, eq: () => c, update: () => c,
        insert: async () => ({ error: null }), upsert: async () => ({ error: null }),
        single: async () => ({ data: { stripe_customer_id: null, trial_ends_at: null }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (res) => res({ data: null, error: null }),
      }
      return c
    },
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))

let mockUser
jest.mock('../../../../../lib/supabase-server', () => ({
  createSupabaseRouteClient: () => {
    const c = {
      select: () => c, eq: () => c, update: () => c,
      insert: async () => ({ error: null }), upsert: async () => ({ error: null }),
      single: async () => ({ data: { stripe_customer_id: null, trial_ends_at: null }, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res) => res({ data: null, error: null }),
    }
    return { from: () => c, auth: { getUser: async () => ({ data: { user: global.__checkoutUser } }) } }
  },
}))

const { POST } = require('../route')

const req = (body, { auth = true, origin = 'https://www.camcashgrl.com' } = {}) => ({
  headers: { get: (h) => (h.toLowerCase() === 'origin' ? origin : h.toLowerCase() === 'authorization' && auth ? 'Bearer t' : null) },
  json: async () => body,
})

beforeEach(() => {
  global.__checkoutUser = { id: 'u1', email: 'creator@example.com' }
  jest.clearAllMocks()
  stripe.prices.retrieve.mockResolvedValue({ id: 'price_m', active: true, currency: 'usd', unit_amount: 999, recurring: { interval: 'month' } })
})

describe('POST /api/stripe/checkout', () => {
  test('signed-out request is refused and no session is created', async () => {
    global.__checkoutUser = null
    const res = await POST(req({ plan_type: 'standard_monthly' }, { auth: false }))
    expect(res.status).toBe(401)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  test('unknown plan is rejected', async () => {
    const res = await POST(req({ plan_type: 'enterprise' }))
    expect(res.status).toBe(400)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  test('a Stripe price that does not match the advertised $9.99 is refused, never charged', async () => {
    stripe.prices.retrieve.mockResolvedValueOnce({ id: 'price_m', active: true, currency: 'usd', unit_amount: 1999, recurring: { interval: 'month' } })
    const res = await POST(req({ plan_type: 'standard_monthly' }))
    expect(res.status).toBe(500)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  test('valid monthly request: subscription session with a 7-day trial and the right return URLs', async () => {
    const res = await POST(req({ plan_type: 'standard_monthly' }))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe(mockSession.url)
    const args = stripe.checkout.sessions.create.mock.calls[0][0]
    expect(args.mode).toBe('subscription')
    expect(args.line_items).toEqual([{ price: 'price_m', quantity: 1 }])
    expect(args.subscription_data.trial_period_days).toBe(7)
    expect(args.subscription_data.metadata).toEqual({ userId: 'u1', plan_type: 'standard_monthly' })
    expect(args.success_url).toBe('https://www.camcashgrl.com/dashboard?success=true&trial=7days&plan=standard_monthly')
    expect(args.cancel_url).toBe('https://www.camcashgrl.com/dashboard?canceled=true')
  })

  test('trial request requires a card on file (payment_method_collection always)', async () => {
    await POST(req({ plan_type: 'standard_monthly' }))
    const args = stripe.checkout.sessions.create.mock.calls[0][0]
    expect(args.payment_method_collection).toBe('always')
  })

  test('paid-now request (trial: false): no trial period and no trial in the return URL', async () => {
    const res = await POST(req({ plan_type: 'standard_monthly', trial: false }))
    expect(res.status).toBe(200)
    const args = stripe.checkout.sessions.create.mock.calls[0][0]
    expect(args.subscription_data.trial_period_days).toBeUndefined()
    expect(args.subscription_data.metadata).toEqual({ userId: 'u1', plan_type: 'standard_monthly' })
    expect(args.success_url).toBe('https://www.camcashgrl.com/dashboard?success=true&plan=standard_monthly')
  })

  test('a Stripe session without a URL is an error, not a silent success', async () => {
    stripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_x', url: null })
    const res = await POST(req({ plan_type: 'standard_monthly' }))
    expect(res.status).toBe(500)
  })
})
