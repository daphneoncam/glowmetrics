import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Conversion-focused emails for free users
// Designed to drive upgrades to Pro plan
const CONVERSION_EMAILS = [
  {
    subject: '🎁 You're Missing Out: 7-Day Free Trial Inside',
    text: `Hi there,

We noticed you've been using GlowMetrics on the free plan. Ready to unlock the full power of your analytics?

Try Pro FREE for 7 days:
✅ Advanced audience insights
✅ Real-time growth tracking
✅ Custom reports & exports
✅ Priority support
✅ All features, zero credit card risk for 7 days

Start your free trial → https://glowmetrics.co/upgrade

No credit card required to start. After 7 days, it's just $19/month.

Join hundreds of creators already using Pro.

Best,
The GlowMetrics Team`,
  },
  {
    subject: '📈 Your Growth Deserves Better Analytics',
    text: `Hi there,

Are you tracking your real growth potential? The free plan shows the basics, but Pro reveals the insights that drive revenue.

With GlowMetrics Pro, you'll:
📊 See deep audience breakdown & preferences
💰 Track revenue opportunities in real-time
🎯 Set growth goals & watch them come true
⏰ Get automated daily reports delivered to your inbox

Try Pro free for 7 days → https://glowmetrics.co/upgrade

Your data is more valuable than you think. Let's unlock it together.

Best,
The GlowMetrics Team`,
  },
  {
    subject: '⚡ Pro Upgrade: Your First Week is FREE',
    text: `Hi there,

Quick question: What if you could increase your earnings by just 5% this month? 📈

Our Pro users report:
• 3x better audience understanding
• Faster content decisions (data-driven)
• More consistent growth tracking
• Smarter revenue opportunities

And right now? You get your first 7 days completely FREE.

Upgrade to Pro → https://glowmetrics.co/upgrade

No commitment. Cancel anytime in the first 7 days.

Best,
The GlowMetrics Team`,
  },
  {
    subject: '🚀 Level Up: Everything Your Free Tier Is Missing',
    text: `Hi there,

We built GlowMetrics Pro for creators like you who are serious about growth.

Free tier getting boring? Pro includes:
🎯 Advanced analytics that actually matter
📧 Weekly digest reports (automatic)
🔄 Real-time dashboard customization
💪 Unlimited exports & integrations
🎤 Direct support from our team

Start free for 7 days → https://glowmetrics.co/upgrade

Most users who try Pro never go back.

Best,
The GlowMetrics Team`,
  },
  {
    subject: '💎 Join 500+ Creators on Pro Plan (Free Trial Included)',
    text: `Hi there,

Curious what pro creators are doing differently?

They're using GlowMetrics Pro to:
→ Know exactly who their audience is
→ Track what content resonates most
→ Make faster, data-backed decisions
→ Grow more predictably

Start your 7-day free trial → https://glowmetrics.co/upgrade

No credit card. No risk. Just results.

Best,
The GlowMetrics Team`,
  },
  {
    subject: '🔥 Limited Time: 7-Day Free Trial of Pro (No Card)',
    text: `Hi there,

We want you to experience Pro before paying.

That's why we're offering:
✅ 7 days completely free
✅ No credit card required upfront
✅ Full access to all Pro features
✅ Cancel anytime, no questions asked

Try Pro free → https://glowmetrics.co/upgrade

This offer is live right now. Your data is waiting.

Best,
The GlowMetrics Team`,
  },
]

async function logEmail(supabase, emailType, recipient, subject, status, resendResponse, errorMessage) {
  try {
    await supabase.from('email_logs').insert({
      email_type: emailType,
      recipient,
      subject,
      status,
      resend_response: resendResponse,
      error_message: errorMessage,
    })
  } catch (err) {
    console.error('[logEmail] Failed to log email:', err.message)
  }
}

async function sendEmail(supabase, emailType, recipient, subject, text) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[sendEmail] RESEND_API_KEY not set')
    await logEmail(supabase, emailType, recipient, subject, 'failed', null, 'Missing RESEND_API_KEY')
    return false
  }

  try {
    await logEmail(supabase, emailType, recipient, subject, 'pending', null, null)

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'GlowMetrics <noreply@camcashgrl.com>',
        to: recipient,
        subject,
        text,
      }),
    })

    const resendResponse = await response.json()

    if (response.ok && resendResponse.id) {
      await logEmail(supabase, emailType, recipient, subject, 'sent', resendResponse, null)
      return true
    } else {
      await logEmail(supabase, emailType, recipient, subject, 'failed', resendResponse, resendResponse.message || 'Unknown error')
      return false
    }
  } catch (e) {
    await logEmail(supabase, emailType, recipient, subject, 'failed', null, e.message)
    return false
  }
}

function getRandomEmail() {
  return CONVERSION_EMAILS[Math.floor(Math.random() * CONVERSION_EMAILS.length)]
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Get free tier users (not trialing, not already paid)
  // Only send if they've been inactive for at least 2 days to avoid spamming recent signups
  const { data: freeUsers, error } = await supabase
    .from('profiles')
    .select('id, email, plan, subscription_status, created_at')
    .eq('plan', 'free')
    .neq('subscription_status', 'active')
    .neq('subscription_status', 'trialing')
    .lt('created_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())

  if (error) {
    console.error('[send-conversion-email] query failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  // Filter out users who already received conversion emails recently
  // (Check email_logs for conversion_email entries in last 3 days)
  const { data: recentlyEmailed } = await supabase
    .from('email_logs')
    .select('recipient')
    .eq('email_type', 'conversion_email')
    .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())

  const recentlyEmailedSet = new Set((recentlyEmailed || []).map(r => r.recipient))

  // Filter to only users we haven't emailed recently
  const targetUsers = (freeUsers || []).filter(u => !recentlyEmailedSet.has(u.email))

  let emailsSent = 0
  let emailsFailed = 0
  const email = getRandomEmail()

  if (targetUsers?.length) {
    for (const user of targetUsers) {
      const sent = await sendEmail(supabase, 'conversion_email', user.email, email.subject, email.text)
      if (sent) emailsSent++
      else emailsFailed++
    }
  }

  console.log(`[send-conversion-email] sent ${emailsSent} conversion emails, ${emailsFailed} failed (eligible: ${targetUsers?.length || 0})`)
  return NextResponse.json({
    success: true,
    freeUsersFound: freeUsers?.length || 0,
    eligibleUsers: targetUsers?.length || 0,
    emailsSent,
    emailsFailed,
    emailTopic: email.subject,
  })
}
