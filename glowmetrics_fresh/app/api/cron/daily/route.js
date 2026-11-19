import { NextResponse } from 'next/server'
import { requireCronAuth } from '../../../../lib/cron-auth'
import { GET as digestJob } from '../../notify/digest/route'
import { GET as expireGoodwillTrialsJob } from '../expire-goodwill-trials/route'
import { GET as checkSubscriptionDriftJob } from '../check-subscription-drift/route'
import { GET as checkWebhookFailuresJob } from '../check-webhook-failures/route'
import { GET as notifyDailySummaryJob } from '../notify-daily-summary/route'
import { GET as notifyTrialAlertsJob } from '../notify-trial-alerts/route'
import { GET as notifyConversionsJob } from '../notify-conversions/route'
import { GET as checkEmailFailuresJob } from '../check-email-failures/route'
import { GET as sendTrialExpiry3DayJob } from '../send-trial-expiry-3day/route'
import { GET as sendTrialExpiry1DayJob } from '../send-trial-expiry-1day/route'
import { GET as sendTrialExpiredJob } from '../send-trial-expired/route'
import { GET as sendSubscriptionTipsJob } from '../send-subscription-tips/route'

// Cron endpoint — never statically optimize this (see the same note in
// app/api/cron/expire-goodwill-trials/route.js).
export const dynamic = 'force-dynamic'

// The single scheduled entry point (vercel.json, 13:00 UTC daily).
//
// Security: this used to fetch each job over HTTP at `new URL(req.url).origin`,
// a server-side request whose destination came from the incoming request
// (CodeQL js/request-forgery). Now that every job requires CRON_SECRET, that
// fetch would also have sent the secret to whatever host the request named.
// The jobs are called in-process instead: no network hop, no request-derived
// destination, and the already-verified request is handed to each job, which
// checks the same secret again itself.
//
// Order, per-job error isolation, and the response shape are unchanged.
async function runJob(name, job, req) {
  try {
    const res = await job(req)
    return { result: await res.json(), error: null }
  } catch (err) {
    console.error(`[cron/daily] ${name} failed:`, err.message)
    return { result: null, error: err.message }
  }
}

export async function GET(req) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const { result: digest, error: digestError } = await runJob('digest', digestJob, req)
  const { result: goodwillExpiry, error: goodwillExpiryError } = await runJob('expire goodwill trials', expireGoodwillTrialsJob, req)
  const { result: subscriptionDrift, error: subscriptionDriftError } = await runJob('check subscription drift', checkSubscriptionDriftJob, req)
  const { result: webhookFailures, error: webhookFailuresError } = await runJob('check webhook failures', checkWebhookFailuresJob, req)
  const { result: dailySummary, error: dailySummaryError } = await runJob('daily summary', notifyDailySummaryJob, req)
  const { result: trialAlerts, error: trialAlertsError } = await runJob('trial alerts', notifyTrialAlertsJob, req)
  const { result: conversionReport, error: conversionReportError } = await runJob('conversion report', notifyConversionsJob, req)
  const { result: emailFailures, error: emailFailuresError } = await runJob('check email failures', checkEmailFailuresJob, req)
  const { result: trialExpiry3Day, error: trialExpiry3DayError } = await runJob('trial expiry 3day emails', sendTrialExpiry3DayJob, req)
  const { result: trialExpiry1Day, error: trialExpiry1DayError } = await runJob('trial expiry 1day emails', sendTrialExpiry1DayJob, req)
  const { result: trialExpired, error: trialExpiredError } = await runJob('trial expired emails', sendTrialExpiredJob, req)
  const { result: subscriptionTips, error: subscriptionTipsError } = await runJob('subscription tips', sendSubscriptionTipsJob, req)

  return NextResponse.json({
    success: !digestError && !goodwillExpiryError && !subscriptionDriftError && !webhookFailuresError && !dailySummaryError && !trialAlertsError && !conversionReportError && !emailFailuresError && !trialExpiry3DayError && !trialExpiry1DayError && !trialExpiredError && !subscriptionTipsError,
    digest, digestError,
    goodwillExpiry, goodwillExpiryError,
    subscriptionDrift, subscriptionDriftError,
    webhookFailures, webhookFailuresError,
    dailySummary, dailySummaryError,
    trialAlerts, trialAlertsError,
    conversionReport, conversionReportError,
    emailFailures, emailFailuresError,
    trialExpiry3Day, trialExpiry3DayError,
    trialExpiry1Day, trialExpiry1DayError,
    trialExpired, trialExpiredError,
    subscriptionTips, subscriptionTipsError,
  })
}
