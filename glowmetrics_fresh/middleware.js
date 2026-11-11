import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Refreshes the Supabase session on each request and writes the new tokens
// back to cookies. Without this, an access token older than 1 h reaches the
// route handlers expired, getUser() fails, and signed-in users get 401s
// (e.g. /api/live/session/start). It only refreshes; it never blocks or
// redirects a request — each route still does its own auth check.
export const AUTH_REFRESH_TIMEOUT_MS = 4000

export async function middleware(request) {
  let response = NextResponse.next({ request })

  // Anonymous visitors have no Supabase auth cookie — nothing to refresh.
  const hasAuthCookie = request.cookies.getAll().some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'))
  if (!hasAuthCookie || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  let timer
  try {
    // getUser() validates the token and triggers the refresh when it has expired.
    // Capped so a slow or down Supabase can't hold every page past Vercel's 25s
    // limit (504 MIDDLEWARE_INVOCATION_TIMEOUT, seen 2026-11-11).
    await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`auth refresh timed out after ${AUTH_REFRESH_TIMEOUT_MS}ms`)), AUTH_REFRESH_TIMEOUT_MS) }),
    ])
  } catch (err) {
    // An auth outage must not take the site down; the route's own check decides.
    console.error('Session refresh failed:', err?.message)
  } finally {
    clearTimeout(timer)
  }

  return response
}

export const config = {
  matcher: [
    // Everything except static assets, and server-to-server endpoints that
    // never carry a user's cookies (Stripe/blog webhooks, cron).
    '/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/blog-webhook|api/cron|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|pdf|zip|txt|xml|html)$).*)',
  ],
}
