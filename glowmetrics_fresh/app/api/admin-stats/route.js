import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyAdminToken, getAdminTokenFromCookieHeader } from '../../../lib/adminAuth'

const sb = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function getDashboardStage(tipCount, totalUsd, liveActive) {
  if (liveActive) return 'live-active'
  if (tipCount === 0) return 'no-data'
  if (tipCount >= 250 && totalUsd >= 100) return 'full-dashboard'
  if (tipCount >= 100 && totalUsd >= 50) return 'growing-insights'
  if (tipCount >= 25 && totalUsd >= 10) return 'first-valid-data'
  return 'tiny-import'
}

function getOnboardingStage(beta, uploadCount) {
  if (!beta) return 'no-profile'
  if (beta.onboarding_complete) return 'complete'
  if (uploadCount > 0) return 'imported'
  return 'started'
}

export async function GET(req) {
  const token = getAdminTokenFromCookieHeader(req.headers.get('cookie'))
  if (!verifyAdminToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = sb()
  const now = new Date()
  const h24  = new Date(now - 86400000).toISOString()
  const h12  = new Date(now - 12 * 3600000).toISOString()
  const d7   = new Date(now - 7  * 86400000).toISOString()
  const d30  = new Date(now - 30 * 86400000).toISOString()

  const [
    authResult,
    profilesResult,
    betaResult,
    uploadsResult,
    tipsResult,
    liveTipsResult,
    subsResult,
    feedbackResult,
    paidSessionsResult,
  ] = await Promise.all([
    client.auth.admin.listUsers({ perPage: 1000 }),
    client.from('profiles').select('id, created_at, plan, utm_source, utm_medium, utm_campaign'),
    client.from('beta_users').select('user_id, email, onboarding_complete, csv_upload_count, signed_up_at'),
    client.from('csv_uploads').select('user_id, platform, status, total_rows, inserted_rows, total_usd, uploaded_at').order('uploaded_at', { ascending: false }),
    client.from('tips').select('user_id, usd, created_at'),
    client.from('live_tips').select('user_id, received_at, usd').order('received_at', { ascending: false }),
    client.from('subscriptions').select('user_id, status, plan_type, current_period_end, stripe_subscription_id'),
    client.from('feedback').select('message, page_url, created_at, user_id').order('created_at', { ascending: false }).limit(15),
    client.from('paid_sessions').select('user_id'),
  ])

  const users    = authResult.data?.users || []
  const profiles = profilesResult.data   || []
  const betas    = betaResult.data        || []
  const uploads  = uploadsResult.data     || []
  const tips     = tipsResult.data        || []
  const liveTips = liveTipsResult.data    || []
  const subs     = subsResult.data        || []
  const feedback = feedbackResult.data    || []

  // Index maps
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]))
  const betaMap    = Object.fromEntries(betas.map(b => [b.user_id, b]))
  const subMap     = Object.fromEntries(subs.map(s => [s.user_id, s]))

  // Per-user tip aggregates
  const tipsByUser = {}
  for (const t of tips) {
    if (!tipsByUser[t.user_id]) tipsByUser[t.user_id] = { count: 0, usd: 0, last: null }
    tipsByUser[t.user_id].count++
    tipsByUser[t.user_id].usd += parseFloat(t.usd) || 0
    if (!tipsByUser[t.user_id].last || t.created_at > tipsByUser[t.user_id].last)
      tipsByUser[t.user_id].last = t.created_at
  }

  // Per-user upload aggregates
  const uploadsByUser = {}
  for (const u of uploads) {
    if (!uploadsByUser[u.user_id]) uploadsByUser[u.user_id] = []
    uploadsByUser[u.user_id].push(u)
  }

  // Live tips last 12h per user
  const liveActive12h = new Set(liveTips.filter(lt => lt.received_at > h12).map(lt => lt.user_id))

  // Build per-user rows
  const userRows = users.map(u => {
    const profile  = profileMap[u.id]
    const beta     = betaMap[u.id]
    const sub      = subMap[u.id]
    const userUploads = uploadsByUser[u.id] || []
    const tipStat  = tipsByUser[u.id] || { count: 0, usd: 0, last: null }
    const isLive   = liveActive12h.has(u.id)

    return {
      id:               u.id,
      email:            u.email,
      createdAt:        u.created_at,
      lastSignIn:       u.last_sign_in_at || null,
      plan:             sub?.plan_type || profile?.plan || 'free',
      onboardingStage:  getOnboardingStage(beta, userUploads.length),
      dashboardStage:   getDashboardStage(tipStat.count, tipStat.usd, isLive),
      uploadCount:      userUploads.length,
      tipCount:         tipStat.count,
      totalUsd:         +tipStat.usd.toFixed(2),
      liveActive:       isLive,
      subStatus:        sub?.status || 'free',
      platforms:        [...new Set(userUploads.map(u => u.platform))],
      lastActivity:     tipStat.last || u.last_sign_in_at || null,
    }
  }).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))

  // KPIs
  const totalUsers        = users.length
  const newUsers24h       = users.filter(u => u.created_at > h24).length
  const newUsers7d        = users.filter(u => u.created_at > d7).length
  const newUsers30d       = users.filter(u => u.created_at > d30).length
  const onboardingComplete = betas.filter(b => b.onboarding_complete).length
  const usersWithImports  = Object.keys(uploadsByUser).length
  const liveModeUsers     = new Set(liveTips.map(lt => lt.user_id)).size
  const activeUsers24h    = new Set([
    ...tips.filter(t => t.created_at > h24).map(t => t.user_id),
    ...liveTips.filter(lt => lt.received_at > h24).map(lt => lt.user_id),
  ]).size

  // Onboarding funnel
  const funnel = {
    signedUp:            totalUsers,
    hasProfile:          profiles.length,
    startedOnboarding:   betas.length,
    hasImports:          usersWithImports,
    completedOnboarding: onboardingComplete,
  }

  // Import health
  const platformBreakdown = {}
  for (const u of uploads) {
    platformBreakdown[u.platform] = (platformBreakdown[u.platform] || 0) + 1
  }
  const importHealth = {
    total:     uploads.length,
    failed:    uploads.filter(u => u.status === 'failed').length,
    last24h:   uploads.filter(u => u.uploaded_at > h24).length,
    last7d:    uploads.filter(u => u.uploaded_at > d7).length,
    platforms: platformBreakdown,
    recent:    uploads.slice(0, 8).map(u => ({
      userEmail: users.find(usr => usr.id === u.user_id)?.email || u.user_id,
      platform:  u.platform,
      status:    u.status,
      rows:      u.total_rows,
      inserted:  u.inserted_rows,
      usd:       u.total_usd,
      at:        u.uploaded_at,
    })),
  }

  // Live mode health
  const liveMode = {
    totalUsers:   liveModeUsers,
    tips24h:      liveTips.filter(lt => lt.received_at > h24).length,
    tips12h:      liveTips.filter(lt => lt.received_at > h12).length,
    lastTip:      liveTips[0]?.received_at || null,
    currentlyLive: liveActive12h.size,
  }

  // Subscription breakdown
  // 'active' counts PAYING subscribers only: a row must carry a real Stripe
  // subscription id. Manual/goodwill rows marked active without one are
  // counted as 'grants' (they were showing as paying users).
  const subBreakdown = { active: 0, grants: 0, trialing: 0, cancelled: 0, free: 0 }
  for (const s of subs) {
    if (s.status === 'active' && s.stripe_subscription_id) subBreakdown.active++
    else if (s.status === 'active')                   subBreakdown.grants++
    else if (s.status === 'trialing')                       subBreakdown.trialing++
    else if (s.status === 'canceled' || s.status === 'cancelled') subBreakdown.cancelled++
    else                                                    subBreakdown.free++
  }
  subBreakdown.free += Math.max(0, totalUsers - subs.length)

  // Dashboard stage breakdown
  const stageBreakdown = {}
  for (const u of userRows) {
    stageBreakdown[u.dashboardStage] = (stageBreakdown[u.dashboardStage] || 0) + 1
  }

  // UTM source breakdown from profiles
  const utmMap = {}
  for (const p of profiles) {
    const key = [p.utm_source || null, p.utm_medium || null, p.utm_campaign || null].join('|')
    if (!utmMap[key]) utmMap[key] = { utm_source: p.utm_source || null, utm_medium: p.utm_medium || null, utm_campaign: p.utm_campaign || null, count: 0 }
    utmMap[key].count++
  }
  const utmBreakdown = Object.values(utmMap)
    .filter(r => r.utm_source !== null)
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    kpis: { totalUsers, newUsers24h, newUsers7d, newUsers30d, onboardingComplete, usersWithImports, liveModeUsers, activeUsers24h },
    funnel,
    stageBreakdown,
    users: userRows,
    importHealth,
    liveMode,
    subscriptions: subBreakdown,
    feedback,
    utmBreakdown,
    generatedAt: now.toISOString(),
  })
}
