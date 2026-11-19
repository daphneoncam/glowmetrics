import { NextResponse } from 'next/server'
import { createSupabaseRouteClient } from '../../../../lib/supabase-server'
import { getTrustedOrigin } from '../../../../lib/site-url'
import { sendSignupNotification } from '../../../../lib/notifications/founder'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  // Redirects go back to this site only: the request's own origin is kept
  // when it is a host this deployment serves (so the session cookies set on
  // it stay valid), otherwise the trusted base URL is used. A forged Host /
  // X-Forwarded-Host can never become the redirect destination.
  const origin = getTrustedOrigin(req)
  const code = searchParams.get('code')

  if (code) {
    const supabase = createSupabaseRouteClient()

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data?.user) {
      const user = data.user

      // ── Fire signup notification (non-blocking) ──
      // Called directly instead of POSTing to `${origin}/api/notify/signup`,
      // so no server-side request is built from the incoming request.
      sendSignupNotification({
        email: user.email,
        created_at: user.created_at,
      }).catch(err => console.error('[auth/callback] signup notification failed:', err.message))

      return NextResponse.redirect(`${origin}/onboarding`)
    }
  }

  // Fallback — redirect to landing on failure
  return NextResponse.redirect(`${origin}/landing`)
}
