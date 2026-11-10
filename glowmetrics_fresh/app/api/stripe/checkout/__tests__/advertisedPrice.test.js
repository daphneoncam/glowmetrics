/**
 * Checkout must only ever charge the advertised price ($9.99/mo, $99/yr).
 * Production regression: STRIPE_MONTHLY_PRICE_ID pointed at a $19.99 price,
 * so every monthly trial converted at double the advertised amount.
 */
jest.mock('next/server', () => ({
  NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) },
}))

const mockStripe = {
  prices: { retrieve: jest.fn(), list: jest.fn() },
  customers: { create: jest.fn(), retrieve: jest.fn(async (id) => ({ id })) },
  checkout: { sessions: { create: jest.fn() } },
}
jest.mock('../../../../../lib/stripe', () => ({ stripe: mockStripe }))
jest.mock('../../../../../lib/supabase-server', () => ({
  createSupabaseRouteClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.c' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { stripe_customer_id: 'cus_1' } }) }) }) }),
  }),
}))
// Service-role client: the route records checkout/trial attempts with it
// (hotfix 9073305), so the stub must accept insert() and update().eq().
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: () => ({
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  })),
}))

const { POST } = require('../route')

const price = (id, amount, interval) => ({ id, active: true, currency: 'usd', unit_amount: amount, recurring: { interval } })
const req = (plan_type) => ({ json: async () => ({ plan_type }), headers: { get: () => 'https://x.test' } })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_wrong1999'
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_year'
  mockStripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.test' })
})

test('monthly env price at $19.99 is replaced by the $9.99 lookup-key price', async () => {
  mockStripe.prices.retrieve.mockResolvedValue(price('price_wrong1999', 1999, 'month'))
  mockStripe.prices.list.mockResolvedValue({ data: [price('price_999', 999, 'month')] })
  const res = await POST(req('standard_monthly'))
  expect(res.status).toBe(200)
  expect(mockStripe.prices.list).toHaveBeenCalledWith(expect.objectContaining({ lookup_keys: ['Monthly_Premuim'] }))
  expect(mockStripe.checkout.sessions.create.mock.calls[0][0].line_items).toEqual([{ price: 'price_999', quantity: 1 }])
})

test('monthly env price already $9.99 is used as-is', async () => {
  mockStripe.prices.retrieve.mockResolvedValue(price('price_wrong1999', 999, 'month'))
  const res = await POST(req('standard_monthly'))
  expect(res.status).toBe(200)
  expect(mockStripe.prices.list).not.toHaveBeenCalled()
})

test('refuses checkout when no price matches the advertised amount', async () => {
  mockStripe.prices.retrieve.mockResolvedValue(price('price_wrong1999', 1999, 'month'))
  mockStripe.prices.list.mockResolvedValue({ data: [] })
  const res = await POST(req('standard_monthly'))
  expect(res.status).toBe(500)
  expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
})

test('annual must be $99/year', async () => {
  mockStripe.prices.retrieve.mockResolvedValue(price('price_year', 9900, 'year'))
  expect((await POST(req('standard_annual'))).status).toBe(200)
  mockStripe.prices.retrieve.mockResolvedValue(price('price_year', 19900, 'year'))
  expect((await POST(req('standard_annual'))).status).toBe(500)
})
