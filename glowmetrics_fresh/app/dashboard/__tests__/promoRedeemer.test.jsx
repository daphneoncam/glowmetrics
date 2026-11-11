/**
 * Promo links (/dashboard?promo=CODE) are redeemed through the existing
 * database function redeem_promo_code(); the database decides validity.
 */
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

let mockSession = { user: { id: 'u1' } }
const rpc = jest.fn()
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockSession } }) },
    rpc: (...a) => rpc(...a),
  },
}))
jest.mock('../../../lib/track', () => ({ track: jest.fn() }))
const { track } = require('../../../lib/track')
const PromoRedeemer = require('../PromoRedeemer').default
const { PENDING_KEY, page } = require('../PromoRedeemer')

const reload = jest.fn()
page.reload = reload
const goTo = (search) => window.history.replaceState(null, '', `/dashboard${search}`)

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear(); sessionStorage.clear()
  mockSession = { user: { id: 'u1' } }
})

test('redeems the code from the link, removes it from the URL, then reloads', async () => {
  goTo('?promo=thankyou14&tab=overview')
  rpc.mockResolvedValue({ data: { duration_days: 14, plan_expires_at: '2026-11-25T10:00:00Z' }, error: null })
  render(<PromoRedeemer />)
  await waitFor(() => expect(reload).toHaveBeenCalled())
  expect(rpc).toHaveBeenCalledWith('redeem_promo_code', { p_code: 'THANKYOU14' })
  expect(window.location.search).toBe('?tab=overview')
  expect(localStorage.getItem(PENDING_KEY)).toBeNull()
  expect(JSON.parse(sessionStorage.getItem('camcash_promo_result')).text).toMatch(/14 days of CamCash Pro/)
  expect(track).toHaveBeenCalledWith('promo_redeemed', { code: 'THANKYOU14', duration_days: 14 })
})

test('signed-out visitor: the code is kept and nothing is redeemed yet', async () => {
  goTo('?promo=CAM30')
  mockSession = null
  render(<PromoRedeemer />)
  await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBe('CAM30'))
  expect(rpc).not.toHaveBeenCalled()
})

test('a kept code is redeemed after sign-in (no promo in the URL)', async () => {
  goTo('')
  localStorage.setItem(PENDING_KEY, 'CAM30')
  rpc.mockResolvedValue({ data: { duration_days: 30 }, error: null })
  render(<PromoRedeemer />)
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('redeem_promo_code', { p_code: 'CAM30' }))
})

test.each([
  ['already_redeemed', /already used a promo code/],
  ['already_pro', /already have Pro/],
  ['code_exhausted', /fully claimed/],
  ['invalid_code', /isn't valid/],
])('database refusal %s shows a clear message and clears the code', async (reason, text) => {
  goTo('?promo=THANKYOU14')
  rpc.mockResolvedValue({ data: null, error: { message: reason } })
  render(<PromoRedeemer />)
  expect(await screen.findByTestId('promo-notice')).toHaveTextContent(text)
  expect(localStorage.getItem(PENDING_KEY)).toBeNull()
  expect(reload).not.toHaveBeenCalled()
})

test('junk in the promo parameter is ignored', async () => {
  goTo('?promo=%3Cscript%3E')
  render(<PromoRedeemer />)
  await new Promise((r) => setTimeout(r, 20))
  expect(rpc).not.toHaveBeenCalled()
  expect(localStorage.getItem(PENDING_KEY)).toBeNull()
})
