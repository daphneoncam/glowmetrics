"use client"
// Platforms — Unified view, laid out after the approved Platform Intelligence
// mockup. Presentation only: every figure comes from the existing builders in
// lib/platformIntelligenceAnalytics.js (which re-read the canonical engine
// output) or from analytics.monthlyData / bestMonth. Nothing is computed here
// beyond picking, sorting and formatting those values. Sections the engine does
// not support yet (per-platform monthly lines, ranked time windows with $/hr,
// period-over-period changes for $/hr, hours and audience) are left out rather
// than approximated — see the Phase 2 proposal in the PR.
import React, { useMemo, useState } from 'react'
import {
  buildBusinessSnapshot,
  buildPlatformComparison,
  buildTimeIntelligence,
  buildFanRevenue,
  buildCamCashNoticed,
  formatHour,
} from '../../lib/platformIntelligenceAnalytics'
import S from './PlatformsUnified.module.css'

const cx = (...a) => a.filter(Boolean).join(' ')
// Mockup colours (same as the Sessions/Stream Planner platform chips).
const PLATFORM_COLOR = { chaturbate: '#22D3EE', bongacams: '#EC4899', myfreecams: '#A855F7', stripchat: '#60A5FA', camsoda: '#34D399' }
export const colorFor = (p) => PLATFORM_COLOR[String(p || '').toLowerCase().replace(/[^a-z]/g, '')] || '#94A3B8'
const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const money0 = (n) => (n === null || n === undefined ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`)
const num = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(Math.round(n)))
const monthLabel = (key) => { const [y, m] = String(key).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) }
const monthLong = (key) => { const [y, m] = String(key).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }

// A measured change only: pct null means the engine had no prior period.
function Change({ pct, suffix = '' }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null
  const r = Math.round(pct)
  const cls = r > 0 ? S.up : r < 0 ? S.down : S.flat
  return <span className={cls}>{r > 0 ? '▲' : r < 0 ? '▼' : '='} {r > 0 ? '+' : ''}{r}%{suffix}</span>
}

const Icon = ({ d, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const I = {
  coins: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  gauge: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  crown: <><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8z" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  spark: <><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.5 3 5.2" /></>,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4z" /><path d="M8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7" /></>,
  bolt: <><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
}

function Kpi({ icon, label, children, sub }) {
  return (
    <div className={S.kpi}>
      <span className={S.kpiIcon}><Icon d={I[icon]} /></span>
      <div style={{ minWidth: 0 }}>
        <div className={S.kpiLabel}>{label}</div>
        <div className={S.kpiValue}>{children}</div>
        {sub && <div className={S.kpiSub}>{sub}</div>}
      </div>
    </div>
  )
}

function PlatformCard({ p, top, onSelect }) {
  const color = colorFor(p.platform)
  const rated = p.rateHours > 0 && p.usdPerHour > 0
  return (
    <button type="button" data-testid={`pu-card-${p.platform}`} onClick={() => onSelect && onSelect(p.platform)}
      className={cx(S.pcard, top && S.pcardTop)} style={{ '--pc': color }} aria-label={`Open ${p.platform} details`}>
      <div className={S.pcardHead}>
        <span className={S.pInitial} style={{ color, borderColor: color }}>{String(p.platform).charAt(0).toUpperCase()}</span>
        <span className={S.pName}>{p.platform}</span>
        {top && <span className={S.crown} title="Your top platform by earnings" aria-label="Top platform"><Icon d={I.crown} size={14} /></span>}
      </div>
      <div className={S.pMoneyRow}>
        <span className={S.pMoney}>{money(p.earnings)}</span>
        {p.trend && <span className={S.pTrend} title={p.trend.pct === null ? 'No earlier 30 days to compare' : `${money(p.trend.prior30USD)} → ${money(p.trend.last30USD)} · last 30 days vs prior 30`}><Change pct={p.trend.pct} /></span>}
      </div>
      <div className={S.pShare}>{p.earningsPercent}% of total</div>
      <div className={S.bar}><span style={{ width: `${Math.min(100, Math.max(0, p.earningsPercent || 0))}%`, background: color }} /></div>
      <div className={S.pFoot}>
        <span title={rated ? `Estimated from ${p.rateHours}h of duration-qualified sessions` : 'Needs sessions with a known duration'}><b>{rated ? `${money(p.usdPerHour)}/hr` : '—/hr'}</b>{rated && <small> est.</small>}</span>
        <span><b>{p.hours > 0 ? `${p.hours}h` : '—'}</b></span>
        <span><b>{num(p.tips)}</b> tips</span>
      </div>
    </button>
  )
}

// Combined monthly series from analytics.monthlyData (all platforms together —
// the engine does not split months by platform yet).
function TrendChart({ months, metric, currentKey = null }) {
  const W = 640, H = 200, P = { l: 52, r: 14, t: 14, b: 26 }
  const vals = months.map((m) => (metric === 'tips' ? m.tips : m.usd))
  const max = Math.max(...vals, 0) || 1
  const step = months.length > 1 ? (W - P.l - P.r) / (months.length - 1) : 0
  const x = (i) => P.l + i * step
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / max)
  const open = currentKey && months.length > 1 && months[months.length - 1].month === currentKey // month still in progress
  const solidN = open ? vals.length - 1 : vals.length
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const solid = vals.slice(0, solidN).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const tail = open ? `M${x(vals.length - 2).toFixed(1)},${y(vals[vals.length - 2]).toFixed(1)} L${x(vals.length - 1).toFixed(1)},${y(vals[vals.length - 1]).toFixed(1)}` : null
  const area = `${line} L${x(vals.length - 1).toFixed(1)},${(H - P.b).toFixed(1)} L${x(0).toFixed(1)},${(H - P.b).toFixed(1)} Z`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const fmt = (v) => (metric === 'tips' ? num(v) : money0(v))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={S.chart} role="img" aria-label={`${metric === 'tips' ? 'Tips' : 'Earnings'} by month`}>
      <defs>
        <linearGradient id="puArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" /><stop offset="100%" stopColor="#22D3EE" stopOpacity="0" /></linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
          <text x={P.l - 8} y={y(t) + 4} textAnchor="end" className={S.axis}>{fmt(t)}</text>
        </g>
      ))}
      <path d={area} fill="url(#puArea)" />
      <path d={solid} fill="none" stroke="#22D3EE" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 0 6px rgba(34,211,238,0.6))' }} />
      {tail && <path d={tail} fill="none" stroke="#22D3EE" strokeWidth="2" strokeDasharray="5 5" opacity="0.8" />}
      {vals.map((v, i) => { const last = open && i === vals.length - 1; return <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={last ? '#0a0c1c' : '#22D3EE'} stroke="#22D3EE" strokeWidth={last ? 2 : 0}><title>{`${monthLong(months[i].month)}${last ? ' (to date)' : ''}: ${fmt(v)}`}</title></circle> })}
      {months.map((m, i) => <text key={m.month} x={x(i)} y={H - 6} textAnchor="middle" className={S.axis}>{monthLabel(m.month)}{open && i === months.length - 1 ? ' (to date)' : ''}</text>)}
    </svg>
  )
}

export default function PlatformsUnified({ analytics, coverage = null, isPro = false, onSelectPlatform = null, onOpenPlanner = null }) {
  const snapshot = useMemo(() => buildBusinessSnapshot(analytics), [analytics])
  const comparison = useMemo(() => buildPlatformComparison(analytics), [analytics])
  const timeIntel = useMemo(() => buildTimeIntelligence(analytics), [analytics])
  const fans = useMemo(() => buildFanRevenue(analytics, isPro), [analytics, isPro])
  const noticed = useMemo(() => buildCamCashNoticed(analytics), [analytics])
  const [metric, setMetric] = useState('usd')
  if (!snapshot) return null

  const top = comparison[0] || null
  const momentum = snapshot.momentum
  const months = (analytics.monthlyData || []).filter((m) => m && m.month)
  const bestMonth = analytics.bestMonth || null
  const currentMonthKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
  const pattern = timeIntel?.hasPattern && timeIntel.confidence?.level !== 'Very Low'
  const perPlatformTimes = isPro ? comparison.map((p) => ({ platform: p.platform, t: timeIntel?.platformBestTimes?.[p.platform] })).filter((r) => r.t && (r.t.hour || r.t.bestDay)) : []

  return (
    <div className={S.root} data-testid="platforms-unified">
      {/* KPI strip */}
      <section className={cx(S.glass, S.kpis)} aria-label="Business summary">
        <Kpi icon="coins" label="Total earned" sub={momentum && momentum.pct !== null ? <><Change pct={momentum.pct} /> <span className={S.muted}>last 30 days vs prior 30</span></> : <span className={S.muted}>Across your analysed history</span>}>
          <span data-testid="pu-total">{money(snapshot.totalEarnings)}</span>
        </Kpi>
        <Kpi icon="gauge" label="Avg $/hour" sub={<span className={S.muted}>{snapshot.usdPerHour === null ? 'Needs sessions with a known duration' : `Estimated · ${snapshot.rateHours}h qualified`}</span>}>
          <span data-testid="pu-hourly">{snapshot.usdPerHour === null ? '—' : money(snapshot.usdPerHour)}</span>
        </Kpi>
        <Kpi icon="clock" label="Total hours" sub={<span className={S.muted}>{snapshot.totalHours > 0 ? 'Estimated from tip activity' : 'No timed sessions yet'}</span>}>
          <span data-testid="pu-hours">{snapshot.totalHours > 0 ? `${snapshot.totalHours}h` : '—'}</span>
        </Kpi>
        <Kpi icon="crown" label="Top platform" sub={top ? <span className={S.muted}>{top.earningsPercent}% of earnings</span> : null}>
          <span data-testid="pu-top" style={{ color: top ? colorFor(top.platform) : undefined }}>{top ? top.platform : '—'}</span>
        </Kpi>
        <Kpi icon="calendar" label="Best time" sub={pattern && timeIntel.bestHour ? <span className={S.muted}>{money(timeIntel.bestHour.avg)} typical · {num(timeIntel.bestHour.count)} days</span> : <span className={S.muted}>Needs a pattern across 3+ days</span>}>
          <span data-testid="pu-best-time">{pattern && timeIntel.bestHour ? `${timeIntel.bestHour.label}${timeIntel.bestDay ? ` · ${String(timeIntel.bestDay.day).slice(0, 3)}` : ''}` : '—'}</span>
        </Kpi>
      </section>

      <div className={S.rowNoticed}>
        {/* CamCash Noticed */}
        <section className={cx(S.glass, S.feature, S.noticed)} aria-label="CamCash noticed">
          <div className={S.head}>
            <span className={S.title}><span className={S.titleIcon} style={{ color: '#EC4899' }}><Icon d={I.spark} size={18} /></span>CAMCASH NOTICED</span>
            {noticed.length > 0 && <span className={S.pill}>{noticed.length} {noticed.length === 1 ? 'insight' : 'insights'}</span>}
          </div>
          {noticed.length === 0 ? <p className={S.empty}>Nothing stands out yet. As more data comes in, findings appear here.</p> : (
            <div className={S.list}>
              {noticed.slice(0, 4).map((n, i) => (
                <div key={i} className={S.insight} data-testid="pu-insight">
                  <span className={S.insightIcon} aria-hidden="true">{n.icon}</span>
                  <span className={S.insightText}>{n.text}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Platform performance */}
        <section className={cx(S.glass, S.perf)} aria-label="Platform performance">
          <div className={S.head}>
            <span className={S.titleSm}>Platform Performance</span>
            {onSelectPlatform && comparison.length > 0 && <button type="button" className={S.link} onClick={() => onSelectPlatform(comparison[0].platform)}>Compare in Split view →</button>}
          </div>
          <div className={S.cards} style={{ '--n': Math.min(3, Math.max(1, comparison.length)) }}>
            {comparison.slice(0, 3).map((p, i) => <PlatformCard key={p.platform} p={p} top={i === 0 && comparison.length > 1} onSelect={onSelectPlatform} />)}
          </div>
          {comparison.length > 3 && <p className={S.footnote}>+{comparison.length - 3} more platform{comparison.length - 3 === 1 ? '' : 's'} in the full breakdown below.</p>}
          {comparison.length === 1 && <p className={S.footnote}>Add a second platform's history and CamCash will compare them here.</p>}
        </section>
      </div>

      <div className={S.rowTrends}>
        {/* Historical trends (combined) */}
        <section className={cx(S.glass, S.trends)} aria-label="Historical trends">
          <div className={S.head}>
            <span className={S.titleSm}>Historical Trends</span>
            <div className={S.tabs} role="group" aria-label="Trend metric">
              {[['usd', 'Earnings'], ['tips', 'Tips']].map(([k, l]) => <button key={k} type="button" aria-pressed={metric === k} className={cx(S.tab, metric === k && S.tabOn)} onClick={() => setMetric(k)}>{l}</button>)}
            </div>
          </div>
          {months.length >= 2 ? (
            <>
              <TrendChart months={months.slice(-12)} metric={metric} currentKey={currentMonthKey} />
              <p className={S.footnote}>All platforms combined, by month. The first month on file and the current month can be partial{isPro ? '' : ' · Free covers your current analysis window'}.</p>
            </>
          ) : <p className={S.empty}>A trend line appears once you have activity in at least two months.</p>}
        </section>

        <div className={S.sideStack}>
          {/* Audience */}
          <section className={cx(S.glass, S.audience)} aria-label="Audience">
            <div className={S.head}><span className={S.titleSm}><span className={S.titleIcon}><Icon d={I.users} size={17} /></span>Audience</span></div>
            <div className={S.audRow}>
              <div><b data-testid="pu-fans">{num(fans.uniqueTippers)}</b><small>Active fans</small></div>
              <div><b>{fans.returningTippers === null ? '—' : num(fans.returningTippers)}</b><small>Returning</small></div>
              <div><b>{fans.newTippers === null ? '—' : num(fans.newTippers)}</b><small>New</small></div>
            </div>
          </section>

          {/* Timing */}
          <section className={cx(S.glass, S.timing)} aria-label="Timing opportunities">
            <div className={S.head}>
              <span className={S.titleSm}><span className={S.titleIcon}><Icon d={I.clock} size={17} /></span>Timing Opportunities</span>
              {onOpenPlanner && <button type="button" className={S.link} onClick={onOpenPlanner}>Plan a stream →</button>}
            </div>
            {!pattern ? <p className={S.empty}>CamCash names a time once it sees a pattern across at least three separate days.</p> : (
              <div className={S.tlist}>
                {timeIntel.bestHour && <div className={cx(S.trow, S.trowTop)}><span>★ {timeIntel.bestHour.label}</span><span className={S.tag}>Best hour</span><b>{money(timeIntel.bestHour.avg)} typical</b></div>}
                {timeIntel.bestDay && <div className={S.trow}><span>{timeIntel.bestDay.day}</span><span className={S.muted}>Best day</span><b>{money(timeIntel.bestDay.avg)} typical</b></div>}
                {isPro ? perPlatformTimes.map((r) => (
                  <div key={r.platform} className={S.trow}><span style={{ color: colorFor(r.platform) }}>{r.platform}</span><span className={S.muted}>{r.t.hour ? formatHour(r.t.hour.hour) : '—'}</span><b>{r.t.bestDay ? r.t.bestDay.day : '—'}</b></div>
                )) : <div className={cx(S.trow, S.locked)}><span><Icon d={I.lock} size={13} /> Best hour and day per platform</span><span /><b className={S.proTag}>PRO</b></div>}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Records & milestones */}
      <section className={cx(S.glass, S.records)} aria-label="Records and milestones">
        <div className={S.head}><span className={S.titleSm}><span className={S.titleIcon} style={{ color: '#F59E0B' }}><Icon d={I.trophy} size={17} /></span>Records &amp; Milestones</span></div>
        <div className={S.recGrid}>
          <div className={S.rec}><small>Best month</small><b>{bestMonth ? money(bestMonth.usd) : '—'}</b><span className={S.muted}>{bestMonth ? monthLong(bestMonth.month) : 'Needs a full month'}</span></div>
          <div className={S.rec}><small>Top supporter</small><b>{fans.topSpender ? money(fans.topSpender.earnings) : '—'}</b><span className={S.muted}>{fans.topSpender ? `${fans.topSpender.username} · ${fans.topSpender.platform}` : 'No supporters yet'}</span></div>
          <div className={S.rec}><small>Last 30 days</small><b>{momentum ? money(momentum.last30USD) : '—'}</b><span className={S.muted}>{momentum && momentum.pct !== null ? <><Change pct={momentum.pct} /> vs prior 30</> : 'No earlier period to compare'}</span></div>
          <div className={S.rec}><small>History on file</small><b>{coverage && coverage.historyDays ? `${num(coverage.historyDays)} days` : '—'}</b>
            <span className={S.milestones}>{(coverage?.milestones || []).map((m, i) => <span key={i} className={cx(S.ms, m.done && S.msDone)}>{m.done ? '✓' : `${m.days}d`} {m.label}</span>)}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
