// Platforms — historical analytics (pure functions, no React).
//
// Rules agreed for the Platforms reference build:
//  - Monthly earnings, audience, tips: all VALID tips (imported + Live), grouped
//    by creator-local month and canonical platform.
//  - Audience identity: distinct platform:username. The same username on two
//    platforms is two fans.
//  - Hours and $/hr: ONLY verified Live Mode streaming time, judged by the
//    canonical rule liveVerifiedHourly() (normal_stop / free_active_limit,
//    finalized, valid span). Imported activity-span estimates are never used as
//    streamed hours.
//  - Three-hour timing windows: earnings from linked tips, hours from verified
//    streaming minutes that fall inside the window, creator-local time, at least
//    three distinct local dates with streaming in the window.
//  - All-time daily high: all valid earnings grouped by creator-local day.
//  - Growth streak: all valid earnings grouped by completed creator-local
//    Monday–Sunday week.
//  - Audience milestones: fixed thresholds on distinct platform:username.
//
// Nothing here changes the existing engine (lib/analytics.js, normalize.js).

import { liveVerifiedHourly } from './sessions/normalize'
import { canonicalPlatform } from './constants'

export const PRO_WINDOW_DAYS = 90
export const FREE_WINDOW_DAYS = 31
export const RANGE_OPTIONS = [30, 90]
export const MILESTONES = [10, 25, 50, 100, 250]
export const WINDOW_HOURS = 3
export const MIN_WINDOW_DATES = 3
export const MIN_GROWTH_STREAK = 2
const DAY = 86400000

// Days the creator may view. Free is capped at FREE_WINDOW_DAYS; Pro may use 90.
export function effectiveRangeDays(selected, isPro) {
  const s = Number(selected) || 30
  return isPro ? Math.min(s, PRO_WINDOW_DAYS) : Math.min(s, FREE_WINDOW_DAYS)
}

// ---------- creator-local time ----------
const fmtCache = new Map()
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23', weekday: 'short',
    }))
  }
  return fmtCache.get(tz)
}
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
export function localParts(ms, tz) {
  const p = {}
  for (const x of partsFormatter(tz).formatToParts(ms)) p[x.type] = x.value
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    month: `${p.year}-${p.month}`,
    hour: Number(p.hour) % 24,
    weekday: WD[p.weekday],
  }
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
// Monday of the creator-local week containing ms.
function weekStartOf(ms, tz) {
  const l = localParts(ms, tz)
  return addDays(l.date, -l.weekday)
}
const monthsBetween = (a, b) => {
  const out = []
  let [y, m] = a.split('-').map(Number)
  const [ye, me] = b.split('-').map(Number)
  while (y < ye || (y === ye && m <= me)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}
const tsOf = (t) => { const ms = new Date(t.date_time || t.dateRaw).getTime(); return isNaN(ms) ? null : ms }

// ---------- tips ----------
// A valid tip: finite positive USD, parseable timestamp, known username.
export function validTips(tips = []) {
  const out = []
  for (const t of tips) {
    const usd = Number(t?.usd)
    const ms = tsOf(t)
    if (!Number.isFinite(usd) || usd <= 0 || ms === null || !t.username) continue
    out.push({ usd, ms, platform: canonicalPlatform(t.platform || 'unknown'), user: String(t.username).trim().toLowerCase(), liveId: t.live_session_id || null, id: t.id })
  }
  return out
}
const identity = (x) => `${x.platform}:${x.user}`

// ---------- verified Live shows ----------
// Verified = the canonical liveVerifiedHourly rule passes. Pauses are excluded
// from window placement because their timing is not recorded.
export function verifiedShows(shows = []) {
  return (shows || []).filter((sh) => {
    const entry = { type: 'live', running: false, durationEstimated: false, startTime: sh.startedAt, endTime: sh.endedAt, show: sh }
    return liveVerifiedHourly(entry) !== null
  })
}
const showPlatforms = (sh) => {
  const rev = (sh.platformRevenue || []).map((r) => canonicalPlatform(r.platform)).filter(Boolean)
  const set = [...new Set(rev.length ? rev : [canonicalPlatform(sh.platform || 'unknown')])]
  return set
}
const showMs = (sh) => ({ start: new Date(sh.startedAt).getTime(), end: new Date(sh.endedAt).getTime() })

// ---------- range ----------
export function rangeBounds(days, nowMs) {
  return { start: nowMs - days * DAY, end: nowMs }
}
export const inBounds = (ms, b) => ms !== null && ms >= b.start && ms <= b.end
// Raw tip rows (as the engine receives them) that fall inside a range.
export function tipsInRange(tips = [], range) {
  return tips.filter((t) => inBounds(tsOf(t), range))
}

// ---------- monthly series (per platform) ----------
export function monthlySeries({ tips = [], shows = [], tz, range }) {
  const vt = validTips(tips).filter((t) => inBounds(t.ms, range))
  const vs = verifiedShows(shows).filter((sh) => inBounds(showMs(sh).start, range))
  // A platform counts if it has earnings OR verified streaming time in range.
  const platforms = [...new Set([
    ...vt.map((t) => t.platform),
    ...vs.flatMap((sh) => { const p = showPlatforms(sh); return p.length === 1 ? p : [] }),
  ])]
  const months = monthsBetween(localParts(range.start, tz).month, localParts(range.end, tz).month)
  const byPlatform = {}
  for (const p of platforms) {
    byPlatform[p] = {}
    for (const m of months) byPlatform[p][m] = { earnings: 0, tipCount: 0, _users: new Set(), hours: 0, verifiedUsd: 0, usdPerHour: null, audience: 0 }
  }
  for (const t of vt) {
    const cell = byPlatform[t.platform][localParts(t.ms, tz).month]
    cell.earnings += t.usd; cell.tipCount += 1; cell._users.add(t.user)
  }
  // Verified streaming time: single-platform shows only (a multi-platform show's
  // time cannot be split between platforms without an unapproved rule).
  let multiPlatformShows = 0
  for (const sh of vs) {
    const plats = showPlatforms(sh)
    if (plats.length !== 1) { multiPlatformShows += 1; continue }
    const p = plats[0]
    if (!byPlatform[p]) continue // unreachable: platforms includes every single-platform show
    const cell = byPlatform[p][localParts(showMs(sh).start, tz).month]
    if (!cell) continue
    cell.hours += Number(sh.durationSeconds) / 3600
    cell.verifiedUsd += Number(sh.totalUsd) || 0
  }
  for (const p of platforms) for (const m of months) {
    const c = byPlatform[p][m]
    c.audience = c._users.size
    c.earnings = Math.round(c.earnings * 100) / 100
    c.hours = Math.round(c.hours * 100) / 100
    c.usdPerHour = c.hours > 0 ? Math.round((c.verifiedUsd / c.hours) * 100) / 100 : null
    delete c._users
  }
  return { months, platforms, byPlatform, multiPlatformShows }
}

// Combined (all platforms) series for KPIs.
export function verifiedTotals({ shows = [], range }) {
  const vs = verifiedShows(shows).filter((sh) => inBounds(showMs(sh).start, range))
  let seconds = 0, usd = 0
  for (const sh of vs) { seconds += Number(sh.durationSeconds) || 0; usd += Number(sh.totalUsd) || 0 }
  const hours = seconds / 3600
  return { shows: vs.length, hours: Math.round(hours * 10) / 10, usd: Math.round(usd * 100) / 100, usdPerHour: hours > 0 ? Math.round((usd / hours) * 100) / 100 : null }
}

// ---------- audience (distinct platform:username) ----------
// Counts for one period: active identities, returning (active in the period and
// seen before its start), new (first-ever tip falls in the period).
export function audienceCounts({ tips = [], periodStart, periodEnd }) {
  const vt = validTips(tips)
  const firstSeen = new Map()
  for (const t of vt) { const k = identity(t); if (!firstSeen.has(k) || t.ms < firstSeen.get(k)) firstSeen.set(k, t.ms) }
  const active = new Set(), before = new Set()
  for (const t of vt) {
    if (t.ms >= periodStart && t.ms <= periodEnd) active.add(identity(t))
    else if (t.ms < periodStart) before.add(identity(t))
  }
  let returning = 0, neu = 0
  for (const k of active) {
    if (before.has(k)) returning += 1
    if (firstSeen.get(k) >= periodStart) neu += 1
  }
  return { active: active.size, returning, new: neu }
}
export function pctChange(now, prior) {
  if (prior === null || prior === undefined || prior === 0 || !Number.isFinite(prior)) return null
  return Math.round(((now - prior) / prior) * 1000) / 10
}

// ---------- three-hour timing windows (verified streaming time only) ----------
const hourLabel = (h) => { const x = ((h % 24) + 24) % 24; const ap = x < 12 ? 'AM' : 'PM'; const hh = x % 12 === 0 ? 12 : x % 12; return `${hh} ${ap}` }
export function threeHourWindows({ tips = [], shows = [], tz, range }) {
  const vs = verifiedShows(shows).filter((sh) => inBounds(showMs(sh).start, range))
  const linked = new Map()
  for (const t of validTips(tips)) {
    if (!t.liveId) continue
    if (!linked.has(t.liveId)) linked.set(t.liveId, [])
    linked.get(t.liveId).push(t)
  }
  const hours = Array(24).fill(0)
  const dates = Array.from({ length: 24 }, () => new Set())
  const earn = Array(24).fill(0)
  let usedShows = 0
  for (const sh of vs) {
    const { start, end } = showMs(sh)
    const dur = Number(sh.durationSeconds)
    const span = (end - start) / 1000
    // Pauses (or missing duration) make placement inside the span unknowable: skip.
    if (!Number.isFinite(dur) || Math.abs(span - dur) > 60) continue
    usedShows += 1
    for (let ms = start; ms < end; ms += 60000) {
      const l = localParts(ms, tz)
      hours[l.hour] += 1 / 60
      dates[l.hour].add(l.date)
    }
    for (const t of linked.get(sh.id) || []) {
      if (t.ms < start || t.ms > end) continue
      earn[localParts(t.ms, tz).hour] += t.usd
    }
  }
  const windows = []
  for (let h = 0; h < 24; h++) {
    let H = 0, E = 0, D = new Set()
    for (let k = 0; k < WINDOW_HOURS; k++) {
      const hh = (h + k) % 24
      H += hours[hh]; E += earn[hh]
      for (const d of dates[hh]) D.add(d)
    }
    const qualifies = H > 0 && D.size >= MIN_WINDOW_DATES
    windows.push({
      startHour: h, endHour: (h + WINDOW_HOURS) % 24,
      label: `${hourLabel(h)} – ${hourLabel(h + WINDOW_HOURS)}`,
      hours: Math.round(H * 100) / 100,
      earnings: Math.round(E * 100) / 100,
      usdPerHour: H > 0 ? Math.round((E / H) * 100) / 100 : null,
      dates: D.size, qualifies,
    })
  }
  const ranked = windows.filter((w) => w.qualifies).sort((a, b) => b.usdPerHour - a.usdPerHour)
  return { windows, ranked, usedShows, excludedShows: vs.length - usedShows }
}

// ---------- all-time daily high ----------
export function allTimeDailyHigh({ tips = [], tz }) {
  const byDay = new Map()
  for (const t of validTips(tips)) {
    const d = localParts(t.ms, tz).date
    byDay.set(d, (byDay.get(d) || 0) + t.usd)
  }
  let best = null
  for (const [date, usd] of byDay) if (!best || usd > best.usd) best = { date, usd: Math.round(usd * 100) / 100 }
  return best
}

// ---------- growth streak (completed Monday–Sunday weeks) ----------
export function growthStreak({ tips = [], tz, nowMs }) {
  const currentWeek = weekStartOf(nowMs, tz)
  const byWeek = new Map()
  let earliest = null
  for (const t of validTips(tips)) {
    const w = weekStartOf(t.ms, tz)
    if (w >= currentWeek) continue // incomplete current week is excluded
    byWeek.set(w, (byWeek.get(w) || 0) + t.usd)
    if (!earliest || w < earliest) earliest = w
  }
  if (!earliest) return { streak: 0, active: false, latestCompletedWeek: null, reason: 'no completed weeks' }
  // Continuous list of completed weeks, zero-filled, so an empty week is a real 0.
  const weeks = []
  for (let w = earliest; w < currentWeek; w = addDays(w, 7)) weeks.push({ week: w, usd: Math.round((byWeek.get(w) || 0) * 100) / 100 })
  let streak = 0
  for (let i = weeks.length - 1; i >= 1; i--) {
    const cur = weeks[i], prev = weeks[i - 1]
    const qualifies = cur.usd > 0 && cur.usd > prev.usd
    if (!qualifies) break
    streak += 1
  }
  const latest = weeks[weeks.length - 1]
  return {
    streak,
    active: streak >= MIN_GROWTH_STREAK,
    latestCompletedWeek: latest.week,
    latestWeekUsd: latest.usd,
    priorWeekUsd: weeks.length > 1 ? weeks[weeks.length - 2].usd : null,
    reason: weeks.length < 2 ? 'need two completed weeks' : null,
  }
}

// ---------- audience milestones (all-time distinct platform:username) ----------
export function audienceMilestone({ tips = [] }) {
  const n = new Set(validTips(tips).map(identity)).size
  let latest = null, next = null
  for (const m of MILESTONES) { if (n >= m) latest = m; else { next = m; break } }
  const floor = latest ?? 0
  const progress = next ? Math.max(0, Math.min(1, (n - floor) / (next - floor))) : 1
  return { fans: n, latest, next, progress: Math.round(progress * 100) / 100, complete: !next }
}

// ---------- platform growth record (approved definition) ----------
// The largest month-over-month earnings increase on a single platform:
//  - completed creator-local calendar months only (the current month is excluded);
//  - each month is compared with the calendar month directly before it, on the
//    same platform (months with no earnings count as $0, never skipped);
//  - the earlier month must have at least PLATFORM_GROWTH_MIN_BASE in earnings,
//    so a tiny base cannot produce a misleading percentage;
//  - only a positive increase is a record. Ties: larger dollar gain, then later month.
export const PLATFORM_GROWTH_MIN_BASE = 50
export function platformGrowthRecord({ tips = [], tz, nowMs }) {
  const currentMonth = localParts(nowMs, tz).month
  const byPlatform = new Map()
  for (const t of validTips(tips)) {
    const m = localParts(t.ms, tz).month
    if (m >= currentMonth) continue
    if (!byPlatform.has(t.platform)) byPlatform.set(t.platform, new Map())
    const months = byPlatform.get(t.platform)
    months.set(m, (months.get(m) || 0) + t.usd)
  }
  let best = null
  for (const [platform, months] of byPlatform) {
    const keys = [...months.keys()].sort()
    const all = monthsBetween(keys[0], keys[keys.length - 1])
    for (let i = 1; i < all.length; i++) {
      const prev = Math.round((months.get(all[i - 1]) || 0) * 100) / 100
      const cur = Math.round((months.get(all[i]) || 0) * 100) / 100
      if (prev < PLATFORM_GROWTH_MIN_BASE || cur <= prev) continue
      const cand = { platform, fromMonth: all[i - 1], toMonth: all[i], fromUsd: prev, toUsd: cur, pct: Math.round(((cur - prev) / prev) * 1000) / 10 }
      if (!best || cand.pct > best.pct || (cand.pct === best.pct && (cand.toUsd - cand.fromUsd > best.toUsd - best.fromUsd || (cand.toUsd - cand.fromUsd === best.toUsd - best.fromUsd && cand.toMonth > best.toMonth)))) best = cand
    }
  }
  return best
}
