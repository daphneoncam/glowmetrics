/**
 * Site-wide tracker volume/privacy guards: init once, one 'input' and one
 * 'page_exit' per page, scroll rows only at new 25% milestones, no query
 * strings in link URLs, never the typed value.
 */
// The tracker attaches global listeners, so it is loaded and initialised once;
// each test starts a fresh page view (which resets the per-page guards).
let bodies = []
global.fetch = jest.fn((url, init) => { bodies.push(JSON.parse(init.body)); return Promise.resolve({}) })
jest.useFakeTimers()
const a = require('../analytics-client')
a.initializeAnalytics()
const initBodies = bodies.slice()

beforeEach(() => {
  a.trackPageView()
  bodies.length = 0
})

const kinds = (t) => bodies.filter((b) => b.eventType === 'engagement' && b.properties.engagementType === t)

test('initialises once and records one session + page view', () => {
  a.initializeAnalytics()
  expect(bodies.filter((b) => b.eventType === 'session')).toHaveLength(0)
  expect(initBodies.filter((b) => b.eventType === 'session')).toHaveLength(1)
  expect(initBodies.filter((b) => b.properties.engagementType === 'page_view')).toHaveLength(1)
})

test('typing records one input event per page and never the value', () => {
  const input = document.createElement('input')
  document.body.appendChild(input)
  for (let i = 0; i < 5; i++) { input.value = 'secret' + i; input.dispatchEvent(new Event('input', { bubbles: true })) }
  expect(kinds('input')).toHaveLength(1)
  expect(JSON.stringify(bodies)).not.toContain('secret')
  a.trackPageView()
  input.dispatchEvent(new Event('input', { bubbles: true }))
  expect(kinds('input')).toHaveLength(2)
})

test('scroll only records new 25% milestones', () => {
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 4000, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true, writable: true })
  const scrollTo = (y) => { window.scrollY = y; window.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(1100) }
  scrollTo(100)   // 27%
  scrollTo(150)   // 28% -> same milestone
  scrollTo(1100)  // 52%
  expect(kinds('scroll').map((b) => b.properties.scrollDepthPercent)).toEqual([25, 50])
})

test('page_exit fires once even if hidden and unloaded', () => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('beforeunload'))
  expect(kinds('page_exit')).toHaveLength(1)
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

test('click on a link drops the query string', () => {
  const link = document.createElement('a')
  link.href = 'https://www.camcashgrl.com/dashboard?token=abc#x'
  link.textContent = 'Go'
  link.addEventListener('click', (e) => e.preventDefault())
  document.body.appendChild(link)
  link.click()
  const click = bodies.find((b) => b.eventType === 'click')
  expect(click.properties.linkHref).toBe('https://www.camcashgrl.com/dashboard')
  expect(JSON.stringify(click)).not.toContain('token=abc')
})
