import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Upper bound for the session check below. A healthy getUser() (plus a token
// refresh when the access token has expired) finishes well under a second;
// without a bound, a slow Supabase Auth held the request open until Vercel
// killed the middleware, so signed-in users got an error page instead of the
// dashboard, pricing or checkout.
export const AUTH_TIMEOUT_MS = 3000

// Ties every Supabase request made during this check to `signal`, while
// keeping any abort signal the caller already passed effective.
function boundedFetch(signal) {
  return (input, init = {}) => {
    const combined = !init.signal ? signal
      : typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, init.signal])
      : combineSignals([signal, init.signal])
    return fetch(input, { ...init, signal: combined })
  }
}

function combineSignals(signals) {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) { controller.abort(s.reason); break }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
  }
  return controller.signal
}

// Refreshes the Supabase session on each request and writes the new tokens
// back to cookies. Without this, an access token older than 1 h reaches the
// route handlers expired, getUser() fails, and signed-in users get 401s
// (e.g. /api/live/session/start). It only refreshes; it never blocks or
// redirects a request — each page/route still does its own auth check, so a
// timeout here can never grant access.
export async function middleware(request) {
  const passThrough = () => NextResponse.next({ request })

  // Anonymous visitors have no Supabase auth cookie — nothing to refresh.
  const hasAuthCookie = request.cookies.getAll().some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'))
  if (!hasAuthCookie || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return passThrough()
  }

  // Cookie writes are staged and only applied after getUser() succeeds in
  // time. On timeout or error they are discarded, so the browser keeps its
  // existing session cookies (never cleared, never half-written).
  let staged = null
  const controller = new AbortController()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { fetch: boundedFetch(controller.signal) },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          if (controller.signal.aborted) return // late write after timeout
          staged = cookiesToSet
        },
      },
    }
  )

  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), AUTH_TIMEOUT_MS)
  })

  let outcome
  try {
    // getUser() validates the token and triggers the refresh when it has expired.
    // The race is a backstop; the abort below also stops the underlying request.
    outcome = await Promise.race([
      supabase.auth.getUser().then((r) => ({ result: r }), (err) => ({ err })),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }

  if (outcome.timedOut) {
    controller.abort()
    console.error(`Session refresh timed out after ${AUTH_TIMEOUT_MS}ms`)
    return passThrough()
  }
  if (outcome.err || outcome.result?.error) {
    // An auth outage must not take the site down; the route's own check decides.
    const e = outcome.err || outcome.result.error
    console.error('Session refresh failed:', e?.message)
    // A rejected/expired token is a definitive answer from Supabase, and the
    // library's own sign-out cookie writes are kept so the user isn't stuck
    // with a dead session. Network-level failures keep the existing cookies.
    if (!outcome.err && staged && isDefinitiveAuthError(e)) return commit(request, staged)
    return passThrough()
  }

  controller.abort() // nothing left in flight; release any lingering listeners
  return staged ? commit(request, staged) : passThrough()
}

// Supabase answered and rejected the session (as opposed to being unreachable).
function isDefinitiveAuthError(e) {
  const status = e?.status
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429
}

function commit(request, cookiesToSet) {
  cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
  const response = NextResponse.next({ request })
  cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
  return response
}

export const config = {
  matcher: [
    // Everything except static assets, and server-to-server endpoints that
    // never carry a user's cookies (Stripe/blog webhooks, cron).
    '/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/blog-webhook|api/cron|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|pdf|zip|txt|xml|html)$).*)',
  ],
}
