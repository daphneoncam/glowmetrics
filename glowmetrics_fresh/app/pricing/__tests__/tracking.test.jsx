/**
 * Pricing-page analytics: every button, plan choice, checkout outcome, FAQ
 * toggle, page view and scroll depth is tracked through lib/track.js, and no
 * personal data (email) is ever put in event properties.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('../../../lib/track', () => ({ track: jest.fn() }))
let mockSession = null
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: mockSession } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}))
jest.mock('../../components/SiteFooter', () => () => null)

const { track } = require('../../../lib/track')
const PricingClient = require('../PricingClient').default
const events = (name) => track.mock.calls.filter((c) => c[0] === name).map((c) => c[1])

beforeEach(() => {
  jest.clearAllMocks()
  mockSession = null
  window.alert = jest.fn()
  global.fetch = jest.fn()
})

test('page view fires with logged-in state and no personal data', async () => {
  mockSession = { user: { id: 'u1', email: 'creator@example.com' }, access_token: 't' }
  render(<PricingClient />)
  await waitFor(() => expect(events('pricing_page_viewed')).toHaveLength(1))
  expect(events('pricing_page_viewed')[0]).toEqual({ logged_in: true, traffic_source: 'direct' })
  expect(JSON.stringify(track.mock.calls)).not.toContain('creator@example.com')
})

test('choosing monthly tracks selection and the Stripe redirect', async () => {
  mockSession = { user: { id: 'u1' }, access_token: 't' }
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://checkout.stripe.test/x' }) })
  render(<PricingClient />)
  fireEvent.click(screen.getByRole('button', { name: /Choose Monthly/ }))
  // jsdom cannot navigate; the redirect event is recorded right before assign().
  await waitFor(() => expect(events('pricing_checkout_redirected')).toHaveLength(1))
  expect(events('pricing_plan_selected')[0]).toEqual({ plan_type: 'standard_monthly', plan_price: 9.99 })
  expect(events('pricing_checkout_redirected')[0]).toEqual({ plan_type: 'standard_monthly', plan_price: 9.99 })
  expect(events('pricing_checkout_failed')).toHaveLength(0)
})

test('checkout API error is tracked once with the status code', async () => {
  mockSession = { user: { id: 'u1' }, access_token: 't' }
  global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
  render(<PricingClient />)
  fireEvent.click(screen.getByRole('button', { name: /Choose Annual/ }))
  await waitFor(() => expect(events('pricing_checkout_failed')).toHaveLength(1))
  expect(events('pricing_plan_selected')[0]).toEqual({ plan_type: 'standard_annual', plan_price: 99 })
  expect(events('pricing_checkout_failed')[0]).toEqual({ plan_type: 'standard_annual', reason: 'api_error', status_code: 500 })
})

test('missing login session is tracked as no_session', async () => {
  render(<PricingClient />)
  fireEvent.click(screen.getByRole('button', { name: /Choose Monthly/ }))
  await waitFor(() => expect(events('pricing_checkout_failed')).toHaveLength(1))
  expect(events('pricing_checkout_failed')[0]).toEqual({ plan_type: 'standard_monthly', reason: 'no_session' })
  expect(global.fetch).not.toHaveBeenCalled()
})

test('network failure is tracked as network_error', async () => {
  mockSession = { user: { id: 'u1' }, access_token: 't' }
  global.fetch.mockRejectedValue(new Error('offline'))
  render(<PricingClient />)
  fireEvent.click(screen.getByRole('button', { name: /Choose Monthly/ }))
  await waitFor(() => expect(events('pricing_checkout_failed')).toHaveLength(1))
  expect(events('pricing_checkout_failed')[0].reason).toBe('network_error')
})

test('every other button is tracked with its own cta name (logged out)', async () => {
  render(<PricingClient />)
  await waitFor(() => expect(events('pricing_page_viewed')).toHaveLength(1))
  for (const link of screen.getAllByRole('link')) link.addEventListener('click', (e) => e.preventDefault())
  fireEvent.click(screen.getAllByRole('link', { name: /Create Free Account/ })[0])
  fireEvent.click(screen.getByRole('link', { name: /Start Free/ }))
  fireEvent.click(screen.getAllByRole('link', { name: /Create Free Account/ })[1])
  fireEvent.click(screen.getByRole('link', { name: /View Extension/ }))
  fireEvent.click(screen.getByRole('link', { name: /Cash/ }))
  expect(events('pricing_cta_clicked').map((e) => e.cta)).toEqual([
    'topbar_create_account', 'free_card_start_free', 'final_create_account', 'final_view_extension', 'logo',
  ])
  expect(events('pricing_cta_clicked').every((e) => e.logged_in === false)).toBe(true)
})

test('FAQ open and close are tracked', () => {
  render(<PricingClient />)
  const q = screen.getByRole('button', { name: /How many platforms can I track for free/ })
  fireEvent.click(q)
  fireEvent.click(q)
  expect(events('pricing_faq_toggled').map((e) => e.action)).toEqual(['open', 'close'])
  expect(events('pricing_faq_toggled')[0].question).toMatch(/How many platforms/)
})

test('scroll depth fires each threshold once', () => {
  render(<PricingClient />)
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true, writable: true })
  act(() => { window.scrollY = 600; window.dispatchEvent(new Event('scroll')) })
  act(() => { window.scrollY = 600; window.dispatchEvent(new Event('scroll')) })
  expect(events('pricing_scroll_depth').map((e) => e.percent)).toEqual([25, 50])
  act(() => { window.scrollY = 1000; window.dispatchEvent(new Event('scroll')) })
  expect(events('pricing_scroll_depth').map((e) => e.percent)).toEqual([25, 50, 75, 100])
})
