/**
 * @jest-environment node
 */
// A stale (deleted/missing) Stripe customer must return a clear 404, not a raw
// "No such customer" 500. Valid customers and transient errors are unchanged.
jest.mock('next/server', () => ({
  NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) },
}))

const mockStripe = {
  customers: { retrieve: jest.fn() },
  billingPortal: { sessions: { create: jest.fn(async () => ({ url: 'https://portal.test' })) } },
}
jest.mock('../../../../../lib/stripe', () => ({ stripe: mockStripe }))
jest.mock('../../../../../lib/supabase-server', () => ({
  createSupabaseRouteClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { stripe_customer_id: 'cus_stale' } }) }) }) }),
  }),
}))

const { POST } = require('../route')
const req = () => ({ headers: { get: () => 'https://x.test' } })

beforeEach(() => jest.clearAllMocks())

test('deleted customer returns 404 with a clear message', async () => {
  mockStripe.customers.retrieve.mockResolvedValue({ id: 'cus_stale', deleted: true })
  const res = await POST(req())
  expect(res.status).toBe(404)
  expect(res.body.error).toMatch(/No active subscription/)
  expect(mockStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
})

test('missing customer (resource_missing) returns 404', async () => {
  mockStripe.customers.retrieve.mockRejectedValue(Object.assign(new Error("No such customer: 'cus_stale'"), { code: 'resource_missing', statusCode: 404 }))
  const res = await POST(req())
  expect(res.status).toBe(404)
  expect(mockStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
})

test('valid customer opens the portal for that customer', async () => {
  mockStripe.customers.retrieve.mockResolvedValue({ id: 'cus_stale' })
  const res = await POST(req())
  expect(res.status).toBe(200)
  expect(res.body.url).toBe('https://portal.test')
  expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_stale', return_url: 'https://x.test/dashboard' })
})

test('transient Stripe error still attempts the portal (unchanged behaviour)', async () => {
  mockStripe.customers.retrieve.mockRejectedValue(Object.assign(new Error('network'), { type: 'StripeConnectionError' }))
  const res = await POST(req())
  expect(res.status).toBe(200)
  expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalled()
})
