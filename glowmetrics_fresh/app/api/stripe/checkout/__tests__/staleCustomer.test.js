/**
 * @jest-environment node
 */
// Production regression: a profile pointed at a Stripe customer that had been
// deleted, so checkout failed with "No such customer" and nobody could upgrade.
jest.mock('next/server', () => ({
  NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) },
}))

const mockUpdates = []
const mockStripe = {
  prices: { retrieve: jest.fn(), list: jest.fn() },
  customers: { create: jest.fn(async () => ({ id: 'cus_fresh' })), retrieve: jest.fn() },
  checkout: { sessions: { create: jest.fn(async () => ({ id: 'cs_1', url: 'https://checkout.test' })) } },
}
jest.mock('../../../../../lib/stripe', () => ({ stripe: mockStripe }))
jest.mock('../../../../../lib/supabase-server', () => ({
  createSupabaseRouteClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.c' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { stripe_customer_id: 'cus_stale' } }) }) }) }),
  }),
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: () => ({
      insert: async () => ({ error: null }),
      update: (row) => ({ eq: async (col, val) => { mockUpdates.push({ row, col, val }); return { error: null } } }),
    }),
  })),
}))

const { POST } = require('../route')
const req = () => ({ json: async () => ({ plan_type: 'standard_monthly' }), headers: { get: () => 'https://x.test' } })

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdates.length = 0
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_999'
  mockStripe.prices.retrieve.mockResolvedValue({ id: 'price_999', active: true, currency: 'usd', unit_amount: 999, recurring: { interval: 'month' } })
})

test('deleted customer is replaced and the new id is saved for the same user', async () => {
  mockStripe.customers.retrieve.mockResolvedValue({ id: 'cus_stale', deleted: true })
  const res = await POST(req())
  expect(res.status).toBe(200)
  expect(mockStripe.customers.create).toHaveBeenCalledWith({ email: 'a@b.c', metadata: { userId: 'u1' } })
  expect(mockStripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_fresh')
  expect(mockUpdates).toContainEqual({ row: { stripe_customer_id: 'cus_fresh' }, col: 'id', val: 'u1' })
})

test('missing customer (resource_missing) is replaced', async () => {
  mockStripe.customers.retrieve.mockRejectedValue(Object.assign(new Error("No such customer: 'cus_stale'"), { code: 'resource_missing', statusCode: 404 }))
  const res = await POST(req())
  expect(res.status).toBe(200)
  expect(mockStripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_fresh')
})

test('valid customer is reused, no new customer created', async () => {
  mockStripe.customers.retrieve.mockResolvedValue({ id: 'cus_stale' })
  await POST(req())
  expect(mockStripe.customers.create).not.toHaveBeenCalled()
  expect(mockStripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_stale')
})

test('transient Stripe error keeps the stored customer (no duplicate customer)', async () => {
  mockStripe.customers.retrieve.mockRejectedValue(Object.assign(new Error('network'), { type: 'StripeConnectionError' }))
  await POST(req())
  expect(mockStripe.customers.create).not.toHaveBeenCalled()
  expect(mockStripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_stale')
})
