import { createBrowserClient } from '@supabase/ssr'

// createBrowserClient (not the plain supabase-js createClient) so the
// session is persisted in a cookie the server route handlers can read via
// createServerClient (lib/supabase-server.js) — localStorage-only sessions
// are invisible to /api/stripe/checkout, /api/stripe/portal, and /api/track,
// which all read auth from cookies.

let supabaseInstance = null

// True while the app itself is running auth.signOut() (Sign out buttons, the
// stale-token cleanup below). auth-js notifies SIGNED_OUT listeners before
// signOut() resolves, so the listener can tell a sign-out the app asked for
// from auth-js discarding a dead session after a rejected token refresh.
let signOutRequested = false
let redirectingToLanding = false

const isProtectedPath = () =>
  window.location.pathname.startsWith('/dashboard') ||
  window.location.pathname.startsWith('/live')

// Pages that need a signed-in user cannot load data with a dead session
// (tips/profiles reads return 401), so send them to /landing, once.
const leaveProtectedPage = () => {
  if (redirectingToLanding || !isProtectedPath()) return
  redirectingToLanding = true
  window.location.href = '/landing'
}

const initSupabase = () => {
  if (typeof window === 'undefined') {
    return null
  }

  if (supabaseInstance) return supabaseInstance

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.warn('Supabase env vars not available')
    return null
  }

  try {
    supabaseInstance = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
    const auth = supabaseInstance.auth
    const originalSignOut = auth.signOut.bind(auth)
    auth.signOut = async (...args) => {
      signOutRequested = true
      try {
        return await originalSignOut(...args)
      } finally {
        signOutRequested = false
      }
    }
  } catch (err) {
    console.error('Supabase initialization failed:', err.message)
  }

  return supabaseInstance
}

const createStubClient = () => ({
  auth: { onAuthStateChange: () => {}, signOut: async () => {} },
  from: () => ({ select: () => ({ eq: () => ({}) }) }),
  rpc: () => ({})
})

export const supabase = new Proxy(createStubClient(), {
  get(target, prop) {
    const instance = initSupabase() || createStubClient()
    const value = instance[prop]
    if (typeof value === 'function') {
      return value.bind(instance)
    }
    return value
  }
})

// Global handler — catches the refresh_token_not_found 400 loop
// that was hammering auth logs and locking out returning users
if (typeof window !== 'undefined') {
  const instance = initSupabase()
  instance?.auth?.onAuthStateChange?.((event, session) => {
    if (event === 'SIGNED_OUT') {
      // A sign-out the app asked for: the caller handles navigation itself.
      if (signOutRequested) return
      // Otherwise auth-js removed the session because the refresh token was
      // rejected (refresh_token_not_found) or another tab signed out. Without
      // this, the dashboard stayed open retrying with a dead session.
      leaveProtectedPage()
      return
    }
    if (!session && event !== 'INITIAL_SESSION') {
      // Session gone but not by choice — clear stale tokens
      instance.auth.signOut().then(leaveProtectedPage)
    }
  })
}
