import { createHash, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

// Server-side authorization for scheduled jobs and internal machine endpoints
// (/api/cron/*, /api/notify/*).
//
// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` on every scheduled
// invocation once CRON_SECRET is set in the project's environment variables
// (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// Before this check existed, every cron route was publicly callable: anyone
// could trigger trial downgrades and lifecycle emails, and read the user IDs /
// Stripe subscription IDs some of them return. The middleware matcher
// excludes api/cron, and it only refreshes sessions anyway, so each route has
// to enforce this itself.
//
// Fails closed: if CRON_SECRET is not configured, every request is refused.
// The secret is never logged or returned.

function digest(value) {
  // Hashing both sides gives equal-length buffers, so timingSafeEqual never
  // throws and the comparison time does not reveal the secret's length.
  return createHash('sha256').update(String(value)).digest()
}

export function isAuthorizedCronRequest(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req?.headers?.get?.('authorization')
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  return timingSafeEqual(digest(header.slice('Bearer '.length)), digest(secret))
}

// Returns null when the request may proceed, otherwise the response to send.
// Call it as the FIRST statement of the handler, before any Supabase, Stripe
// or email client is created, so a rejected request has no side effects.
export function requireCronAuth(req) {
  if (!process.env.CRON_SECRET) {
    console.error('[cron-auth] CRON_SECRET is not configured; refusing request')
    return NextResponse.json({ success: false, error: 'Scheduled jobs are not configured' }, { status: 503 })
  }
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
