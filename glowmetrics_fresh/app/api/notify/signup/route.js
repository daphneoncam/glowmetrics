import { NextResponse } from 'next/server'
import { requireCronAuth } from '../../../../lib/cron-auth'
import { sendSignupNotification } from '../../../../lib/notifications/founder'

// Internal endpoint. It used to be public: anyone could POST arbitrary
// `email` text and have it sent, unescaped, as HTML to the founder inbox. The
// only caller (app/api/auth/callback) now calls sendSignupNotification()
// directly, so this route needs the same server secret as the cron jobs.
export async function POST(req) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  try {
    const { email, created_at } = await req.json()
    await sendSignupNotification({ email, created_at })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[notify/signup] Failed:', err.message)
    return NextResponse.json({ success: false, error: 'Notification failed' }, { status: 500 })
  }
}
