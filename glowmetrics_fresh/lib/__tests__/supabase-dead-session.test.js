/**
 * @jest-environment node
 *
 * lib/supabase.js — a dead session must not leave a protected page open.
 *
 * When a token refresh is rejected (refresh_token_not_found) with an expired
 * access token, auth-js removes the session and emits SIGNED_OUT. The global
 * listener used to ignore SIGNED_OUT, so the dashboard stayed open retrying
 * with a dead session (377 failed refreshes from one browser on 2026-11-04).
 */

let listener
let fakeAuth
let signOutCalls = 0

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: jest.fn(() => {
    fakeAuth = {
      onAuthStateChange: jest.fn((cb) => {
        listener = cb
        return { data: { subscription: { unsubscribe() {} } } }
      }),
      // Mirrors auth-js: SIGNED_OUT listeners run before signOut() resolves.
      signOut: jest.fn(async () => {
        signOutCalls += 1
        await listener('SIGNED_OUT', null)
        return { error: null }
      }),
    }
    return { auth: fakeAuth }
  }),
}))

// Node environment with a plain window, so the test can read where the module
// sends the browser (jsdom's location cannot be replaced or observed).
function setPath(pathname) {
  global.window = { location: { pathname, href: `https://www.camcashgrl.com${pathname}` } }
}

const href = () => global.window.location.href

function loadModule() {
  let mod
  jest.isolateModules(() => {
    mod = require('../supabase')
  })
  return mod
}

beforeEach(() => {
  listener = undefined
  fakeAuth = undefined
  signOutCalls = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
})

afterAll(() => {
  delete global.window
})

test('a session removed after a rejected refresh sends /dashboard to /landing', async () => {
  setPath('/dashboard')
  loadModule()
  expect(typeof listener).toBe('function')

  await listener('SIGNED_OUT', null)

  expect(href()).toBe('/landing')
})

test('a session removed on /live also leaves the page', async () => {
  setPath('/live')
  loadModule()

  await listener('SIGNED_OUT', null)

  expect(href()).toBe('/landing')
})

test('a sign-out the app requested does not trigger the listener redirect', async () => {
  setPath('/dashboard')
  const { supabase } = loadModule()

  await supabase.auth.signOut()

  // The Sign out button navigates itself (router.replace('/login')).
  expect(href()).toBe(`https://www.camcashgrl.com/dashboard`)
})

test('the flag resets after an explicit sign-out, so a later dead session still redirects', async () => {
  setPath('/dashboard')
  const { supabase } = loadModule()

  await supabase.auth.signOut()
  await listener('SIGNED_OUT', null)

  expect(href()).toBe('/landing')
})

test('public pages are not redirected', async () => {
  setPath('/pricing')
  loadModule()

  await listener('SIGNED_OUT', null)

  expect(href()).toBe(`https://www.camcashgrl.com/pricing`)
})

test('redirects only once even if SIGNED_OUT repeats', async () => {
  setPath('/dashboard')
  loadModule()

  await listener('SIGNED_OUT', null)
  global.window.location.href = 'sentinel'
  await listener('SIGNED_OUT', null)

  expect(href()).toBe('sentinel')
})

test('the existing stale-token cleanup still signs out and leaves the dashboard', async () => {
  setPath('/dashboard')
  loadModule()

  await listener('TOKEN_REFRESHED', null)
  await new Promise((r) => setTimeout(r, 0))

  expect(signOutCalls).toBe(1)
  expect(href()).toBe('/landing')
})
