"use client"
// Platforms — Unified view, built to the approved Platform Intelligence reference.
// Presentation only. Figures come from:
//  - lib/analytics.js aggregateRows() for range-filtered platform totals (the
//    existing engine), read through lib/platformIntelligenceAnalytics builders;
//  - lib/platformHistory.js for per-platform monthly series, verified Live hours,
//    three-hour windows, audience identity, daily high, growth streak, milestones.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { aggregateRows } from '../../lib/analytics'
import {
  buildBusinessSnapshot, buildPlatformComparison, buildCamCashNoticed,
} from '../../lib/platformIntelligenceAnalytics'
import {
  effectiveRangeDays, rangeBounds, tipsInRange, monthlySeries, verifiedTotals, threeHourWindows,
  audienceCounts, pctChange, allTimeDailyHigh, growthStreak, audienceMilestone, platformGrowthRecord, PLATFORM_GROWTH_MIN_BASE,
  FREE_WINDOW_DAYS, MIN_WINDOW_DATES, MIN_GROWTH_STREAK,
} from '../../lib/platformHistory'
import S from './PlatformsUnified.module.css'

const DAY = 86400000
const cx = (...a) => a.filter(Boolean).join(' ')
const COLOR = { chaturbate: '#22D3EE', bongacams: '#EC4899', myfreecams: '#A855F7', stripchat: '#60A5FA', camsoda: '#34D399' }
export const colorFor = (p) => COLOR[String(p || '').toLowerCase().replace(/[^a-z]/g, '')] || '#94A3B8'
const money = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const money0 = (n) => (n === null || n === undefined ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`)
const num = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(Math.round(n)))
const monthShort = (key) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) }
const dayLong = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) }

// Signed change pill. Only rendered when the change is actually measured.
function Change({ pct }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null
  const r = Math.round(pct * 10) / 10
  const cls = r > 0 ? S.up : r < 0 ? S.down : S.flat
  return <span className={cls}>{r > 0 ? '▲' : r < 0 ? '▼' : '='} {r > 0 ? '+' : ''}{r}%</span>
}

// Track width from the container, so chart text renders at real size on every width.
function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    setW(Math.max(260, Math.floor(el.getBoundingClientRect().width)))
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const ICON = {
  coins: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  gauge: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  crown: <><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8z" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  spark: <><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.5 3 5.2" /></>,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4z" /><path d="M8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></>,
  star: <><path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.3 6.5 20.4l1-6.3-4.5-4.4 6.2-.9L12 3z" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
}
const windowIcon = (w) => (w.startHour >= 20 || w.startHour < 3 ? I.moon : w.startHour < 12 ? I.sun : I.clock)
const I = ICON

function Kpi({ icon, label, value, sub, testId }) {
  return (
    <div className={S.kpi}>
      <span className={S.kpiIcon}><Icon d={I[icon]} /></span>
      <div className={S.kpiBody}>
        <div className={S.kpiLabel}>{label}</div>
        <div className={S.kpiValue} data-testid={testId}>{value}</div>
        {sub && <div className={S.kpiSub}>{sub}</div>}
      </div>
    </div>
  )
}

// Period-over-period state, using the engine's own momentum bands
// (lib/analytics.js: >50 Surging, >10 Growing, ±10 Steady, < -10 Declining).
function trendState(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null
  if (pct > 50) return { label: 'Surging', cls: S.stSurge }
  if (pct > 10) return { label: 'Growing', cls: S.stUp }
  if (pct >= -10) return { label: 'Steady', cls: S.stFlat }
  return { label: 'Declining', cls: S.stDown }
}

// Same construction as the Sessions "Today by Platform" card (SessionsOverview.js
// PlatformCard): platform-tinted glass, platform border + glow, solid badge,
// share at top right, big total with a glowing bar, 4-column stats row.
function PlatformCard({ p, top, pct, verified, onSelect, days }) {
  const color = colorFor(p.platform)
  const key = String(p.platform).toLowerCase().replace(/[^a-z]/g, '')
  const st = trendState(pct)
  const share = Math.min(100, Math.max(0, p.earningsPercent || 0))
  return (
    <button type="button" data-testid={`pu-card-${p.platform}`} onClick={() => onSelect && onSelect(p.platform)}
      className={cx(S.pcard, top && S.pcardTop)} aria-label={`Open ${p.platform} details`}
      style={{
        '--pc': color,
        background: `radial-gradient(90% 120% at 0% 0%, ${color}26 0%, transparent 55%), rgba(12,15,28,0.82)`,
        borderColor: `${color}${top ? 'cc' : '66'}`,
        boxShadow: top ? `0 0 34px ${color}40` : `0 0 18px ${color}1f`,
      }}>
      <div className={S.pcardHead}>
        <span className={S.pBadge} style={{ background: color }}>{String(p.platform).slice(0, key === 'myfreecams' ? 3 : 1).toUpperCase()}</span>
        <span className={S.pName}>{p.platform}{top && <span className={S.crown} title="Top platform in this period" aria-label="Top platform"><Icon d={I.crown} size={13} /></span>}</span>
        <span className={S.pShareBox}><b style={{ color }}>{p.earningsPercent}%</b><small>of earnings</small></span>
      </div>
      {st && (
        <span data-testid={`pu-state-${p.platform}`} className={cx(S.stPill, st.cls)} title={`This ${days}-day period vs the ${days} days before it`}>
          {pct > 0 ? '▲' : pct < 0 ? '▼' : '='} {pct > 0 ? '+' : ''}{Math.round(pct * 10) / 10}% · {st.label}
        </span>
      )}
      <div className={S.pMoneyRow}>
        <div>
          <div className={S.pMoney}>{money(p.earnings)}</div>
          <div className={S.pMoneyLabel}>Total Earned</div>
        </div>
        <div className={S.bar}><span style={{ width: `${share}%`, background: color, boxShadow: `0 0 10px ${color}` }} /></div>
      </div>
      <div className={S.pStats}>
        {[
          [verified.hours > 0 ? `${verified.hours}h` : '—', 'Hours', 'Verified Live Mode hours only'],
          [verified.usdPerHour === null ? '—' : money(verified.usdPerHour), verified.usdPerHour === null ? '$/Hr' : '$/Hr est.', 'Earnings per verified streamed hour'],
          [num(p.tips), p.tips === 1 ? 'Tip' : 'Tips', null],
          [p.avgTipSize > 0 ? money(p.avgTipSize) : '—', 'Avg tip', null],
        ].map(([v, l, t]) => (
          <div key={l} title={t || undefined}><b>{v}</b><small>{l}</small></div>
        ))}
      </div>
    </button>
  )
}

// Historical trends: one line per platform, for the selected metric. Gaps (null)
// break the line — a month with no verified hours is not drawn as zero $/hr.
const METRICS = [
  { k: 'earnings', l: 'Earnings', fmt: money0, pick: (c) => c.earnings },
  { k: 'rate', l: '$/Hour', fmt: (v) => `$${Math.round(v)}`, pick: (c) => c.usdPerHour },
  { k: 'hours', l: 'Hours', fmt: (v) => `${Math.round(v)}h`, pick: (c) => (c.hours > 0 ? c.hours : null) },
  { k: 'audience', l: 'Audience', fmt: (v) => num(v), pick: (c) => c.audience },
]
function TrendChart({ months, platforms, series, metric, width }) {
  const H = 230, P = { l: 52, r: 14, t: 14, b: 30 }
  const W = Math.max(260, width)
  const m = METRICS.find((x) => x.k === metric)
  const lines = platforms.map((p) => ({ p, pts: months.map((mo) => m.pick(series.byPlatform[p][mo])) }))
  const all = lines.flatMap((l) => l.pts).filter((v) => v !== null && Number.isFinite(v))
  if (!all.length) return null
  const max = Math.max(...all, 1)
  const step = months.length > 1 ? (W - P.l - P.r) / (months.length - 1) : 0
  const x = (i) => (months.length > 1 ? P.l + i * step : (W + P.l - P.r) / 2)
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / max)
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const path = (pts) => {
    let d = '', pen = false
    pts.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
      pen = true
    })
    return d.trim()
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className={S.chart} role="img" aria-label={`${m.l} by month and platform`} data-testid="pu-chart">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" />
          <text x={P.l - 8} y={y(t) + 4} textAnchor="end" className={S.axis}>{m.fmt(t)}</text>
        </g>
      ))}
      {lines.map((l) => (
        <g key={l.p}>
          <path d={path(l.pts)} fill="none" stroke={colorFor(l.p)} strokeWidth="2.4" strokeLinejoin="round" />
          {l.pts.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="3.2" fill={colorFor(l.p)}><title>{`${l.p} · ${monthShort(months[i])}: ${m.fmt(v)}`}</title></circle>))}
        </g>
      ))}
      {months.map((mo, i) => <text key={mo} x={x(i)} y={H - 8} textAnchor="middle" className={S.axis}>{monthShort(mo)}</text>)}
    </svg>
  )
}

function Empty({ children }) { return <p className={S.empty}>{children}</p> }

export default function PlatformsUnified({ analytics, tips = [], shows = [], tz = 'UTC', isPro = false, selected = 30, onSelectPlatform = null, onOpenPlanner = null }) {
  const [now] = useState(() => Date.now())
  const [metric, setMetric] = useState('earnings')
  const [chartRef, chartWidth] = useWidth()

  const days = effectiveRangeDays(selected, isPro)
  const clamped = days < selected
  // Each platform's window ends at its OWN latest tip (when that is before today),
  // the same per-platform rule Free history uses (lib/analytics.js applyFreeAnalysisWindow).
  // A window ending "today" is empty for any platform whose last tip is in the past.
  const latestByPlatform = useMemo(() => {
    const out = {}
    for (const t of tips) {
      const ms = new Date(t.date_time || t.dateRaw).getTime()
      if (isNaN(ms)) continue
      const p = t.platform || 'unknown'
      if (out[p] === undefined || ms > out[p]) out[p] = ms
    }
    return out
  }, [tips])
  const anchorFor = (p) => { const l = latestByPlatform[p || 'unknown']; return l !== undefined && l < now ? l : now }
  const anchors = Object.keys(latestByPlatform).map(anchorFor)
  const minAnchor = anchors.length ? Math.min(...anchors) : now
  const maxAnchor = anchors.length ? Math.max(...anchors) : now
  const anchored = minAnchor !== now || maxAnchor !== now
  // Tips inside each platform's own window (current and prior period).
  const windowedTips = useMemo(() => tips.filter((t) => {
    const ms = new Date(t.date_time || t.dateRaw).getTime()
    if (isNaN(ms)) return false
    const a = anchorFor(t.platform)
    return ms >= a - days * DAY && ms <= a
  }), [tips, days, latestByPlatform, now])
  const priorTips = useMemo(() => tips.filter((t) => {
    const ms = new Date(t.date_time || t.dateRaw).getTime()
    if (isNaN(ms)) return false
    const a = anchorFor(t.platform)
    return ms >= a - 2 * days * DAY && ms < a - days * DAY
  }), [tips, days, latestByPlatform, now])
  // Envelope ranges for the helpers; per-platform bounds are applied by the filters above.
  const range = useMemo(() => ({ start: minAnchor - days * DAY, end: maxAnchor }), [minAnchor, maxAnchor, days])
  const prior = useMemo(() => ({ start: minAnchor - 2 * days * DAY, end: maxAnchor - days * DAY }), [minAnchor, maxAnchor, days])

  // Range-filtered engine totals (the same aggregation the page uses), for the
  // platform rows. Pro only gets a prior period, since Free has no earlier data.
  const rangeAnalytics = useMemo(() => { const t = tipsInRange(windowedTips, range); return t.length ? aggregateRows(t, tz) : null }, [windowedTips, range, tz])
  const priorAnalytics = useMemo(() => { if (!isPro) return null; const t = tipsInRange(priorTips, prior); return t.length ? aggregateRows(t, tz) : null }, [priorTips, prior, tz, isPro])
  const snapshot = useMemo(() => buildBusinessSnapshot(rangeAnalytics), [rangeAnalytics])
  const priorSnapshot = useMemo(() => buildBusinessSnapshot(priorAnalytics), [priorAnalytics])
  const comparison = useMemo(() => buildPlatformComparison(rangeAnalytics), [rangeAnalytics])
  const priorComparison = useMemo(() => buildPlatformComparison(priorAnalytics), [priorAnalytics])
  const priorByPlatform = useMemo(() => Object.fromEntries(priorComparison.map((p) => [p.platform, p])), [priorComparison])
  const noticed = useMemo(() => buildCamCashNoticed(rangeAnalytics), [rangeAnalytics])

  // Verified streaming (Live Mode only) and per-platform history.
  const series = useMemo(() => monthlySeries({ tips: windowedTips, shows, tz, range }), [windowedTips, shows, tz, range])
  const totals = useMemo(() => verifiedTotals({ shows, range }), [shows, range])
  const windows = useMemo(() => threeHourWindows({ tips: windowedTips, shows, tz, range }), [windowedTips, shows, tz, range])
  const audience = useMemo(() => audienceCounts({ tips: windowedTips, periodStart: range.start, periodEnd: range.end }), [windowedTips, range])
  const priorAudience = useMemo(() => (isPro ? audienceCounts({ tips: priorTips, periodStart: prior.start, periodEnd: prior.end }) : null), [priorTips, prior, isPro])

  // Records and milestones. Pro: full history. Free: ONLY the Free reporting
  // window (same rows as every other Free figure) — never older entitled history.
  const recordTips = useMemo(() => (isPro ? tips : windowedTips), [isPro, tips, windowedTips])
  const dailyHigh = useMemo(() => allTimeDailyHigh({ tips: recordTips, tz }), [recordTips, tz])
  const streak = useMemo(() => growthStreak({ tips: recordTips, tz, nowMs: now }), [recordTips, tz, now])
  const milestone = useMemo(() => audienceMilestone({ tips: recordTips }), [recordTips])
  const growth = useMemo(() => platformGrowthRecord({ tips: recordTips, tz, nowMs: now }), [recordTips, tz, now])

  // Per-platform verified hours and $/hr over the selected range.
  const verifiedByPlatform = useMemo(() => {
    const out = {}
    for (const p of series.platforms) {
      let h = 0, usd = 0
      for (const mo of series.months) { const c = series.byPlatform[p][mo]; h += c.hours; usd += c.verifiedUsd || 0 }
      out[p] = { hours: Math.round(h * 100) / 100, usdPerHour: h > 0 ? Math.round((usd / h) * 100) / 100 : null }
    }
    return out
  }, [series])

  const topRanked = windows.ranked[0] || null
  const rankedRows = windows.ranked.slice(0, 3)
  // The unranked window with the most verified streaming dates so far (real counts only).
  const building = windows.windows.filter((w) => w.hours > 0 && !w.qualifies).sort((a, b) => b.dates - a.dates || b.hours - a.hours)[0] || null
  const buildDates = building ? Math.min(building.dates, MIN_WINDOW_DATES) : 0
  const overallRate = totals.usdPerHour
  const pct = (cur, prv) => (isPro ? pctChange(cur, prv) : null)
  const hasAnyData = comparison.length > 0 || totals.shows > 0
  const metricDef = METRICS.find((x) => x.k === metric)
  const chartHasData = series.months.length > 0 && series.platforms.length > 0 && series.platforms.some((p) => series.months.some((mo) => metricDef.pick(series.byPlatform[p][mo]) !== null))

  if (!analytics && !tips.length) return null

  return (
    <div className={S.root} data-testid="platforms-unified">
      {/* Reporting period (selector really filters everything below except records) */}
      <div className={S.toolbar}>
        <span className={S.periodNote} data-testid="pu-period-note">
          {(clamped ? `Free shows the last ${FREE_WINDOW_DAYS} days. Pro unlocks 90-day history and comparisons.` : isPro ? `Showing ${days} days · comparisons vs the prior ${days} days` : `Showing ${days} days · Pro adds comparisons vs prior periods`) + (anchored ? " · each platform ends at its own latest tip" : '')}
        </span>
      </div>

      {/* A. KPI strip */}
      <section className={S.kpis} aria-label="Business summary">
        <Kpi icon="coins" label="Total earned" testId="pu-total" value={money(snapshot?.totalEarnings ?? 0)}
          sub={isPro ? <><Change pct={pct(snapshot?.totalEarnings ?? 0, priorSnapshot?.totalEarnings ?? null)} /> <span className={S.muted}>vs prior {days} days</span></> : <span className={S.muted}>Pro: change vs prior period</span>} />
        <Kpi icon="gauge" label="Avg $/hour" testId="pu-hourly" value={overallRate === null ? '—' : `${money(overallRate)}`}
          sub={<span className={S.muted}>{overallRate === null ? 'Needs verified Live Mode time' : 'Estimated · verified Live hours'}</span>} />
        <Kpi icon="clock" label="Total hours" testId="pu-hours" value={totals.hours > 0 ? `${totals.hours}h` : '—'}
          sub={<span className={S.muted}>{totals.hours > 0 ? 'Verified Live Mode streaming' : 'No verified streamed hours'}</span>} />
        <Kpi icon="crown" label="Top platform" testId="pu-top" value={comparison[0] ? comparison[0].platform : '—'}
          sub={comparison[0] ? <span className={S.muted}>{comparison[0].earningsPercent}% of earnings</span> : null} />
        <Kpi icon="calendar" label="Best window (all platforms)" testId="pu-best-window"
          value={topRanked ? topRanked.label : 'Not ranked yet'}
          sub={topRanked ? <span className={S.muted}>{money(topRanked.usdPerHour)}/hr est. · {topRanked.dates} dates</span> : (
            <span className={S.kpiProgress}>
              <span className={S.muted}>{buildDates} of {MIN_WINDOW_DATES} streaming dates</span>
              <span className={S.progress}><span style={{ width: `${Math.round((buildDates / MIN_WINDOW_DATES) * 100)}%` }} /></span>
            </span>
          )} />
      </section>

      {/* B. CamCash Noticed + Platform Performance */}
      <div className={S.rowTop}>
        <section className={S.pulse} aria-label="CamCash noticed">
          <div className={S.pulseEyebrow}>
            <svg className={S.pulseWave} width="30" height="20" viewBox="0 0 34 24" fill="none" aria-hidden="true"><path d="M1 12h7l3-8 5 16 4-12 3 4h10" stroke="url(#puWave)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><defs><linearGradient id="puWave" x1="0" y1="0" x2="34" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#22D3EE" /><stop offset=".5" stopColor="#7C5CFF" /><stop offset="1" stopColor="#EC4899" /></linearGradient></defs></svg>
            <span>CamCash Noticed</span>
            {noticed.length > 0 && <span className={S.pill}>{noticed.length} new {noticed.length === 1 ? 'insight' : 'insights'}</span>}
          </div>
          {noticed.length === 0 ? <p className={S.pulseSentence}>Nothing stands out yet in this period. Findings appear as more comparable history comes in.</p> : (
            <>
              <h2 className={S.pulseHeadline} data-testid="pu-insight"><span aria-hidden="true">{noticed[0].icon} </span>{noticed[0].text}</h2>
              {noticed.length > 1 && (
                <ul className={S.insights}>
                  {noticed.slice(1).map((n, i) => (
                    <li key={i} className={S.insight} data-testid="pu-insight">
                      <span className={S.insightIcon} aria-hidden="true">{n.icon}</span>
                      <span className={S.insightText}>{n.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className={S.pulseActions}>
            {comparison[0] && onSelectPlatform && <button type="button" data-testid="pu-view-top" className={S.pulsePrimary} onClick={() => onSelectPlatform(comparison[0].platform)}>View {comparison[0].platform} <span aria-hidden="true">→</span></button>}
            {onOpenPlanner && <button type="button" data-testid="pu-plan" className={S.pulseSecondary} onClick={onOpenPlanner}><Icon d={I.calendar} size={16} />Plan a stream</button>}
          </div>
        </section>

        <section className={cx(S.glass, S.perf)} aria-label="Platform performance">
          <div className={S.head}>
            <span className={S.titleSm}>Platform Performance</span>
            {onSelectPlatform && comparison.length > 0 && <button type="button" className={S.link} onClick={() => onSelectPlatform(comparison[0].platform)}>Compare platforms →</button>}
          </div>
          {comparison.length === 0 ? <Empty>No platform has earnings in this period.</Empty> : (
            <div className={S.cards}>
              {comparison.map((p, i) => (
                <PlatformCard key={p.platform} p={p} top={i === 0 && comparison.length > 1} days={days}
                  pct={pct(p.earnings, priorByPlatform[p.platform]?.earnings ?? null)}
                  verified={verifiedByPlatform[p.platform] || { hours: 0, usdPerHour: null }}
                  onSelect={onSelectPlatform} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* C. Historical trends · Audience evolution · Timing opportunities */}
      <div className={S.rowMid}>
        <section className={cx(S.glass, S.trends)} aria-label="Historical trends">
          <div className={S.head}>
            <span className={S.titleSm}>Historical Trends</span>
            <div className={S.tabs} role="group" aria-label="Chart metric">
              {METRICS.map((m) => <button key={m.k} type="button" aria-pressed={metric === m.k} className={cx(S.tab, metric === m.k && S.tabOn)} onClick={() => setMetric(m.k)}>{m.l}</button>)}
            </div>
          </div>
          <div ref={chartRef} className={S.chartWrap}>
            {chartHasData ? <TrendChart months={series.months} platforms={series.platforms} series={series} metric={metric} width={chartWidth} /> : (
              <Empty>{metric === 'rate' || metric === 'hours'
                ? 'No verified Live Mode streaming time in this period. Imported history has no real stream durations, so hourly figures are not estimated from it.'
                : 'No recorded activity in this period.'}</Empty>
            )}
          </div>
          {chartHasData && (
            <div className={S.legend}>
              {series.platforms.map((p) => <span key={p}><i style={{ background: colorFor(p) }} />{p}</span>)}
              <span className={S.legendNote}>All months in the period · gaps are months without verified data</span>
            </div>
          )}
        </section>

        <div className={S.side}>
          <section className={cx(S.glass, S.audience)} aria-label="Audience evolution">
            <div className={S.head}><span className={S.titleSm}><span className={S.titleIcon}><Icon d={I.users} size={16} /></span>Audience Evolution</span></div>
            <div className={S.audRow}>
              {[
                ['Active fans', audience.active, priorAudience ? pct(audience.active, priorAudience.active) : null],
                ['Returning', audience.returning, priorAudience ? pct(audience.returning, priorAudience.returning) : null],
                ['New', audience.new, priorAudience ? pct(audience.new, priorAudience.new) : null],
              ].map(([l, v, c]) => (
                <div key={l} className={S.audCell}>
                  <b>{num(v)}</b><small>{l}</small>
                  <span className={S.audChange}>{priorAudience ? (c === null ? '—' : <Change pct={c} />) : <span className={S.muted}>Pro</span>}</span>
                </div>
              ))}
            </div>
            <p className={S.footnote}>Fans are counted per platform (platform:username).</p>
          </section>

          <section className={cx(S.glass, S.timing)} aria-label="Timing opportunities">
            <div className={S.head}>
              <span className={S.titleSm}><span className={S.titleIcon}><Icon d={I.clock} size={16} /></span>Timing Opportunities</span>
              {onOpenPlanner && <button type="button" className={S.link} onClick={onOpenPlanner}>Plan a stream →</button>}
            </div>
            <ol className={S.tlist}>
              {rankedRows.map((w, i) => (
                <li key={w.startHour} className={cx(S.trow, i === 0 && S.trowTop)} data-testid="pu-window">
                  <span className={S.tIcon}><Icon d={windowIcon(w)} size={17} /></span>
                  <span className={S.tLabel}>{w.label}{i === 0 && <span className={S.tag}>Highest $/hr</span>}</span>
                  <span className={S.tPerf}>{overallRate ? <Change pct={pctChange(w.usdPerHour, overallRate)} /> : null}</span>
                  <b className={S.tRate}>{money(w.usdPerHour)}/hr</b>
                </li>
              ))}
              {rankedRows.length < 3 && (
                <li className={S.building} data-testid="pu-window-building">
                  <div className={S.buildingHead}>
                    <span className={S.tIcon}><Icon d={I.clock} size={16} /></span>
                    <span>
                      <b>{building ? `Closest window: ${building.label}` : rankedRows.length ? 'More windows unlock as you stream' : 'Your best 3-hour windows will rank here'}</b>
                      <small>{building ? `${buildDates} of ${MIN_WINDOW_DATES} streaming dates in this window` : 'Stream with Live Mode on 3 separate days in the same time slot'}</small>
                    </span>
                  </div>
                  <span className={S.progress}><span style={{ width: `${Math.round((buildDates / MIN_WINDOW_DATES) * 100)}%` }} /></span>
                </li>
              )}
            </ol>
            <p className={S.footnote}>Ranked by earnings per verified streamed hour. A window needs streaming on at least {MIN_WINDOW_DATES} separate local dates.</p>
          </section>
        </div>
      </div>

      {/* D. Records & milestones */}
      <section className={cx(S.glass, S.records)} aria-label="Records and milestones">
        <div className={S.head}>
          <span className={S.titleSm}><span className={S.titleIcon}><Icon d={I.trophy} size={16} /></span>Records &amp; Milestones</span>
          <span className={S.scope} data-testid="rec-scope">{isPro ? 'All history' : `Last ${days} days · Free`}</span>
        </div>
        <div className={S.recGrid}>
          <div className={S.rec} data-testid="rec-high">
            <small>All-time high</small>
            <b>{dailyHigh ? money(dailyHigh.usd) : '—'}</b>
            <span className={S.muted}>{dailyHigh ? `Best day · ${dayLong(dailyHigh.date)}` : 'No earnings recorded yet'}</span>
          </div>
          <div className={S.rec} data-testid="rec-streak">
            <small>Growth streak</small>
            <b>{streak.active ? `${streak.streak} weeks` : 'None active'}</b>
            <span className={S.muted}>{streak.active ? 'Consecutive completed weeks with more earnings than the week before' : `Needs ${MIN_GROWTH_STREAK}+ consecutive growing weeks`}</span>
          </div>
          <div className={S.rec} data-testid="rec-milestone">
            <small>Audience milestone</small>
            <b>{milestone.latest ? `${milestone.latest}+ fans` : 'Not yet'}</b>
            <span className={S.muted}>{milestone.complete ? `${num(milestone.fans)} fans · all milestones reached` : `${num(milestone.fans)} fans · next ${milestone.next}`}</span>
            {!milestone.complete && <span className={S.msBar}><span style={{ width: `${Math.round(milestone.progress * 100)}%` }} /></span>}
          </div>
          <div className={S.rec} data-testid="rec-platform">
            <small>Platform growth</small>
            {growth ? (
              <>
                <b><span style={{ color: colorFor(growth.platform) }}>{growth.platform}</span> <span className={S.up}>+{growth.pct}%</span></b>
                <span className={S.muted}>{monthShort(growth.fromMonth)} {money(growth.fromUsd)} → {monthShort(growth.toMonth)} {money(growth.toUsd)} · best month-over-month gain</span>
              </>
            ) : (
              <>
                <b>None yet</b>
                <span className={S.muted}>Needs a completed month of at least ${PLATFORM_GROWTH_MIN_BASE} followed by a higher month on the same platform</span>
              </>
            )}
          </div>
        </div>
      </section>

      {!hasAnyData && <Empty>No platform has enough history yet. Import tips or start a Live Mode show to build this page.</Empty>}
    </div>
  )
}
