import { NextResponse } from 'next/server'
import { requireCronAuth } from '../../../../lib/cron-auth'
import { sendUploadNotification } from '../../../../lib/notifications/founder'

// Internal endpoint. It used to be public: anyone could POST arbitrary text
// and have it sent, unescaped, as HTML to the founder inbox. The only caller
// (app/api/upload) now calls sendUploadNotification() directly, so this route
// needs the same server secret as the cron jobs.
export async function POST(req) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  try {
    const { email, platform, tip_count, user_id } = await req.json()
    await sendUploadNotification({ email, platform, tip_count, user_id })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[notify/upload] Failed:', err.message)
    return NextResponse.json({ success: false, error: 'Notification failed' }, { status: 500 })
  }
}
