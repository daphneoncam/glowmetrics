"use client"
import React, { useState, useMemo } from 'react'
import {
  buildBusinessSnapshot,
  buildPlatformComparison,
  buildEfficiencyComparison,
  buildTimeIntelligence,
  buildFanRevenue,
  buildCamCashNoticed,
  buildPlatformSnapshot,
  buildDataCoverage,
  formatHour,
} from '../../lib/platformIntelligenceAnalytics'
import { computeDataVaultStats } from './DashboardPreview'
import PlatformsUnified from './PlatformsUnified'

const C = {
  card: "#0d1322", card2: "#111829", border: "#1e2d45", border2: "#2a3f5f",
  cyan: "#22D3EE", pink: "#EC4899", gold: "#F59E0B", blue: "#60A5FA",
  green: "#10B981", white: "#F1F5F9", muted: "#475569", text: "#94A3B8",
  purple: "#a855f7", red: "#F87171",
}

const PLATFORM_ACCENT = {
  chaturbate: C.purple, bongacams: C.red, myfreecams: C.gold,
  camsoda: C.green, stripchat: C.blue, flirt4free: C.pink,
}
const accentFor = (p) => PLATFORM_ACCENT[(p || '').toLowerCase().trim()] || C.cyan

const fmt$ = (n) => n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmt$0 = (n) => n === null || n === undefined ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`
const fmtN = (n) => n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(Math.round(n))
const fmtH = (n) => n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}h`

// ============================================
// COMPACT PRIMITIVES
// Dense by construction: no fixed heights, no oversized type, 14–20px padding.
// ============================================

function Section({ title, note, children, style }) {
  return (
    <section style={{ marginBottom: 20, ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: C.text }}>
          {title}
        </h2>
        {note ? <span style={{ fontSize: 11, color: C.muted }}>{note}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Panel({ children, style, accent }) {
  return (
    <div style={{
      background: 'rgba(15,20,32,0.75)',
      border: `1px solid ${accent ? `${accent}33` : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 10, padding: 14, ...style,
    }}>{children}</div>
  )
}

export function MetricStrip({ items }) {
  return (
    <div className="pi-strip" style={{
      display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
      gap: 1, background: C.border, border: `1px solid ${C.border}`,
      borderRadius: 10, overflow: 'hidden',
    }}>
      {items.map((it, i) => (
        <div key={i} style={{ background: C.card, padding: '10px 12px', minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {it.label}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: it.color || C.white, marginTop: 2, lineHeight: 1.2 }}>
            {it.value}
          </div>
          {it.sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// Dense table. Scrolls inside its own container on narrow screens.
function DataTable({ columns, rows }) {
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{
                textAlign: c.align || 'right', padding: '8px 12px', background: C.card2,
                color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
              {r.map((cell, ci) => (
                <td key={ci} style={{
                  textAlign: columns[ci].align || 'right', padding: '7px 12px',
                  color: C.white, whiteSpace: 'nowrap', borderTop: ri ? `1px solid ${C.border}` : 'none',
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FactRow({ label, facts, accent = C.cyan }) {
  return (
    <div style={{ padding: '9px 12px', borderLeft: `2px solid ${accent}`, background: 'rgba(255,255,255,0.02)', borderRadius: '0 8px 8px 0' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted }}>{label}</div>
      <div style={{ fontSize: 13, color: C.white, fontWeight: 600, marginTop: 2 }}>{facts}</div>
    </div>
  )
}

function Empty({ children }) {
  return <div style={{ padding: '12px 14px', fontSize: 12, color: C.muted, border: `1px dashed ${C.border2}`, borderRadius: 10 }}>{children}</div>
}

function ProTag() {
  return <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: C.gold, border: `1px solid ${C.gold}55`, borderRadius: 4, padding: '1px 5px', marginLeft: 6 }}>PRO</span>
}

function LockedRow({ text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', border: `1px dashed ${C.gold}44`, borderRadius: 8, background: `${C.gold}0a` }}>
      <span style={{ fontSize: 11 }}>🔒</span>
      <span style={{ fontSize: 11.5, color: C.text }}>{text}</span>
      <ProTag />
    </div>
  )
}

function ShareBar({ percent, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
      <div style={{ width: 46, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, Math.max(0, percent || 0))}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ minWidth: 30, textAlign: 'right' }}>{percent === null || percent === undefined ? '—' : `${percent}%`}</span>
    </div>
  )
}

// Shows a trend only when the engine measured one against a real prior period.
function TrendCell({ trend }) {
  if (!trend || trend.pct === null) {
    return <span style={{ color: C.muted }} title="No earlier period to compare against">—</span>
  }
  const up = trend.pct > 10, down = trend.pct < -10
  const color = up ? C.green : down ? C.red : C.text
  return (
    <span style={{ color, whiteSpace: 'nowrap' }} title={`${fmt$(trend.prior30USD)} → ${fmt$(trend.last30USD)} (last 30 days vs prior 30)`}>
      {trend.emoji} {trend.pct > 0 ? '+' : ''}{Math.round(trend.pct)}%
    </span>
  )
}

export function PlatformCell({ platform }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: accentFor(platform), flexShrink: 0 }} />
      {platform}
    </span>
  )
}

// Confidence is the engine's own band — never restated as a bare percentage.
function ConfidenceTag({ confidence }) {
  if (!confidence) return null
  const tone = { High: C.green, Medium: C.cyan, Low: C.gold, 'Very Low': C.muted }[confidence.level] || C.muted
  return (
    <span style={{ fontSize: 10, color: tone, border: `1px solid ${tone}44`, borderRadius: 4, padding: '1px 6px' }}>
      {confidence.label}
    </span>
  )
}

// Suggestions restate figures the engine produced; nothing is inferred beyond them.
function NextBestMove({ comparison, efficiency, timeIntel, onOpenPlanner }) {
  const moves = []

  if (efficiency.length >= 2) {
    const best = efficiency[0]
    const worst = efficiency[efficiency.length - 1]
    if (best.usdPerHour >= worst.usdPerHour * 1.25) {
      moves.push(`Shift hours from ${worst.platform} (${fmt$(worst.usdPerHour)}/hr) toward ${best.platform} (${fmt$(best.usdPerHour)}/hr).`)
    }
  }
  if (timeIntel?.hasPattern && timeIntel.confidence?.level !== 'Very Low') {
    const parts = []
    if (timeIntel.bestDay) parts.push(timeIntel.bestDay.day)
    if (timeIntel.bestHour) parts.push(`around ${timeIntel.bestHour.label}`)
    if (parts.length) moves.push(`Protect ${parts.join(' ')} — your strongest recorded window (${timeIntel.confidence.label.toLowerCase()}).`)
  }
  if (comparison.length === 1) {
    moves.push('You have one platform with enough data to analyse. A second gives CamCash something to compare against.')
  }

  const planner = onOpenPlanner ? (
    <button onClick={onOpenPlanner} style={{
      justifySelf: 'start', padding: '7px 13px', fontSize: 12, fontWeight: 700,
      borderRadius: 8, cursor: 'pointer', color: '#05070f',
      border: 'none', background: C.cyan,
    }}>Build your stream plan →</button>
  ) : null

  if (moves.length === 0) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <Empty>Once there is enough data to compare platforms and times, suggested moves appear here.</Empty>
        {planner}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {moves.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 13px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <span style={{ color: C.cyan, fontSize: 12 }}>→</span>
          <span style={{ fontSize: 12.5, color: C.white, lineHeight: 1.45 }}>{m}</span>
        </div>
      ))}
      {planner && <div style={{ marginTop: 2 }}>{planner}</div>}
    </div>
  )
}

// Coverage of the analysis window, in days actually imported. No estimate of
// what is "missing" — that number is not knowable from the data on file.
function DataCoverage({ coverage }) {
  if (!coverage || coverage.historyDays === 0) return null
  const complete = coverage.historyDays >= coverage.windowDays

  return (
    <Section
      title="Your data"
      note={coverage.hasMoreThanWindow
        ? `${fmtN(coverage.historyDays)} days on file · ${coverage.windowDays}-day window analysed`
        : `${fmtN(coverage.historyDays)} of ${coverage.windowDays} days imported`}
    >
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
        {!complete && (
          <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ width: `${coverage.windowCoveragePct}%`, height: '100%', background: C.cyan, borderRadius: 2 }} />
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {coverage.milestones.map((m, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 11, padding: '3px 9px', borderRadius: 6,
              color: m.done ? C.white : C.muted,
              background: m.done ? `${C.green}14` : 'transparent',
              border: `1px solid ${m.done ? `${C.green}44` : C.border}`,
            }}>
              <span style={{ color: m.done ? C.green : C.muted }}>{m.done ? '✓' : `${m.days}d`}</span>
              {m.label}
            </span>
          ))}
        </div>
      </div>
    </Section>
  )
}

// ============================================
// UNIFIED VIEW
// ============================================

function UnifiedView({ analytics, coverage, isPro, onOpenPlanner }) {
  const snapshot = useMemo(() => buildBusinessSnapshot(analytics), [analytics])
  const comparison = useMemo(() => buildPlatformComparison(analytics), [analytics])
  const efficiency = useMemo(() => buildEfficiencyComparison(analytics), [analytics])
  const timeIntel = useMemo(() => buildTimeIntelligence(analytics), [analytics])
  const fans = useMemo(() => buildFanRevenue(analytics, isPro), [analytics, isPro])
  const noticed = useMemo(() => buildCamCashNoticed(analytics), [analytics])

  const hasHours = snapshot.totalHours > 0
  const topRevenue = comparison[0] || null
  const topEfficiency = efficiency[0] || null
  const momentum = snapshot.momentum

  return (
    <>
      <Section
        title="Your cam business"
        note={momentum?.label ? `${momentum.emoji || ''} ${momentum.label}`.trim() : null}
      >
        <MetricStrip items={[
          { label: 'Earnings', value: fmt$0(snapshot.totalEarnings), color: C.green },
          { label: 'Tips', value: fmtN(snapshot.totalTips) },
          { label: 'Hours', value: hasHours ? fmtH(snapshot.totalHours) : '—', sub: hasHours ? null : 'no timed sessions' },
          { label: '$ / hour', value: snapshot.usdPerHour === null ? '—' : fmt$(snapshot.usdPerHour), sub: snapshot.usdPerHour === null ? null : `est · ${fmt$0(snapshot.rateUSD)} / ${snapshot.rateHours}h`, color: snapshot.usdPerHour === null ? C.muted : C.cyan },
          { label: 'Sessions', value: fmtN(snapshot.sessions) },
          { label: 'Platforms', value: fmtN(snapshot.platformCount) },
        ]} />
        <div style={{ marginTop: 8 }}>
          <MetricStrip items={[
            { label: 'Avg / session', value: snapshot.sessions > 0 ? fmt$(snapshot.avgEarningsPerSession) : '—' },
            { label: 'Avg tip', value: snapshot.avgTipSize > 0 ? fmt$(snapshot.avgTipSize) : '—' },
            { label: 'Tips / hour', value: snapshot.tipsPerHour > 0 ? snapshot.tipsPerHour.toFixed(1) : '—' },
            { label: 'Supporters', value: fmtN(fans.uniqueTippers) },
            { label: 'Top 3 share', value: fans.topThreeContribution === null ? '—' : `${fans.topThreeContribution}%` },
            { label: 'Top supporter', value: fans.topSpender ? fmt$(fans.topSpender.earnings) : '—' },
          ]} />
        </div>
      </Section>

      <div className="pi-two-col" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, marginBottom: 20 }}>
        <Section title="Where your money comes from" style={{ marginBottom: 0 }}>
          {comparison.length === 0 ? (
            <Empty>No platform has enough session data to compare yet.</Empty>
          ) : (
            <DataTable
              columns={[{ label: 'Platform', align: 'left' }, { label: 'Earnings' }, { label: 'Share' }, { label: 'Trend' }, { label: 'Tips' }, { label: 'Sessions' }]}
              rows={comparison.map(p => [
                <PlatformCell key="p" platform={p.platform} />,
                fmt$(p.earnings),
                <ShareBar key="s" percent={p.earningsPercent} color={accentFor(p.platform)} />,
                <TrendCell key="t" trend={p.trend} />,
                fmtN(p.tips),
                fmtN(p.sessions),
              ])}
            />
          )}
        </Section>

        <Section title="Where your time pays best" style={{ marginBottom: 0 }}>
          {efficiency.length === 0 ? (
            <Empty>Hourly rates need sessions with a known duration. None qualify yet.</Empty>
          ) : (
            <>
              <DataTable
                columns={[{ label: 'Platform', align: 'left' }, { label: '$/hr' }, { label: 'Rated hours' }, { label: 'vs avg' }]}
                rows={efficiency.map(p => [
                  <PlatformCell key="p" platform={p.platform} />,
                  fmt$(p.usdPerHour),
                  fmtH(p.rateHours),
                  <span key="v" style={{ color: p.vsAverage > 0 ? C.green : p.vsAverage < 0 ? C.red : C.muted }}>
                    {p.vsAverage > 0 ? '+' : ''}{p.vsAverage}%
                  </span>,
                ])}
              />
              {topRevenue && topEfficiency && topRevenue.platform !== topEfficiency.platform && (
                <div style={{ marginTop: 8 }}>
                  <FactRow label="Revenue vs efficiency" accent={C.gold}
                    facts={`${topRevenue.platform} earns most · ${topEfficiency.platform} pays best per hour`} />
                </div>
              )}
            </>
          )}
        </Section>
      </div>

      <Section title="Platform performance" note="Meaningful sessions only">
        {comparison.length === 0 ? (
          <Empty>Import platform data to compare performance.</Empty>
        ) : (
          <DataTable
            columns={[
              { label: 'Platform', align: 'left' }, { label: 'Earnings' }, { label: 'Hours' },
              { label: 'Tips' }, { label: 'Avg tip' }, { label: '$/session' }, { label: 'Sessions' }, { label: 'Time share' },
            ]}
            rows={comparison.map(p => [
              <PlatformCell key="p" platform={p.platform} />,
              fmt$(p.earnings),
              p.hours > 0 ? fmtH(p.hours) : '—',
              fmtN(p.tips),
              p.avgTipSize > 0 ? fmt$(p.avgTipSize) : '—',
              p.sessions > 0 ? fmt$(p.earningsPerSession) : '—',
              fmtN(p.sessions),
              hasHours ? <ShareBar key="h" percent={p.hoursPercent} color={C.blue} /> : '—',
            ])}
          />
        )}
      </Section>

      <div className="pi-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Section title="When you earn best" style={{ marginBottom: 0 }}>
          {!timeIntel?.hasPattern ? (
            <Empty>Not enough repeat activity yet to name a reliable time. CamCash waits for a pattern across at least three separate days before calling one.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -2 }}>
                <ConfidenceTag confidence={timeIntel.confidence} />
              </div>
              {timeIntel.bestHour && (
                <FactRow label="Best hour" accent={C.cyan}
                  facts={`${timeIntel.bestHour.label} · ${fmt$(timeIntel.bestHour.avg)} typical · ${fmtN(timeIntel.bestHour.count)} days`} />
              )}
              {timeIntel.bestDay && (
                <FactRow label="Best day" accent={C.purple}
                  facts={`${timeIntel.bestDay.day} · ${fmt$(timeIntel.bestDay.avg)} typical · ${fmtN(timeIntel.bestDay.count)} days`} />
              )}
              {topRevenue && (
                <FactRow label="Strongest platform" accent={accentFor(topRevenue.platform)}
                  facts={`${topRevenue.platform} · ${fmt$(topRevenue.earnings)} · ${topRevenue.earningsPercent}% of earnings`} />
              )}
              {isPro ? (
                (() => {
                  const rows = comparison
                    .map(p => ({ platform: p.platform, t: timeIntel.platformBestTimes[p.platform] }))
                    .filter(r => r.t && (r.t.hour || r.t.bestDay))
                  if (rows.length === 0) return null
                  return (
                    <DataTable
                      columns={[{ label: 'Per platform', align: 'left' }, { label: 'Best hour' }, { label: 'Best day' }]}
                      rows={rows.map(r => [
                        <PlatformCell key="p" platform={r.platform} />,
                        r.t.hour ? formatHour(r.t.hour.hour) : '—',
                        r.t.bestDay ? r.t.bestDay.day : '—',
                      ])}
                    />
                  )
                })()
              ) : (
                <LockedRow text="Best hour and day broken out per platform" />
              )}
            </div>
          )}
        </Section>

        <Section title="Who is driving your revenue" note="Share of all tracked tips" style={{ marginBottom: 0 }}>
          {fans.uniqueTippers === 0 ? (
            <Empty>No supporters recorded yet.</Empty>
          ) : (
            <>
              <MetricStrip items={[
                { label: 'Supporters', value: fmtN(fans.uniqueTippers) },
                { label: 'Top supporter', value: fans.topSpender ? fmt$(fans.topSpender.earnings) : '—' },
                { label: 'Top 3 share', value: fans.topThreeContribution === null ? '—' : `${fans.topThreeContribution}%`, color: (fans.topThreeContribution || 0) >= 50 ? C.gold : C.white },
              ]} />
              <div style={{ marginTop: 8 }}>
                <DataTable
                  columns={[{ label: 'Top supporters', align: 'left' }, { label: 'Platform', align: 'left' }, { label: 'Tips' }, { label: 'Total' }]}
                  rows={fans.visibleSpenders.map(f => [
                    f.username, <PlatformCell key="p" platform={f.platform} />, fmtN(f.tipCount), fmt$(f.earnings),
                  ])}
                />
              </div>
              {!isPro && fans.uniqueTippers > 3 && (
                <div style={{ marginTop: 6 }}>
                  <LockedRow text={`Full ranking of all ${fmtN(fans.uniqueTippers)} supporters`} />
                </div>
              )}
            </>
          )}
        </Section>
      </div>

      <Section title="CamCash noticed" note="Observations from your own data">
        {noticed.length === 0 ? (
          <Empty>Nothing stands out yet. As more data comes in, findings appear here.</Empty>
        ) : (
          <div style={{ display: 'grid', gap: 1, background: `${C.cyan}22`, border: `1px solid ${C.cyan}33`, borderRadius: 10, overflow: 'hidden' }}>
            {noticed.map((n, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'rgba(13,19,34,0.92)', padding: '10px 13px' }}>
                <span style={{ fontSize: 13, lineHeight: 1.4 }}>{n.icon}</span>
                <span style={{ fontSize: 12.5, color: C.white, lineHeight: 1.45 }}>{n.text}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {!isPro && (
        <Section title="Go deeper with Pro">
          <div className="pi-pro-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { t: 'Full history', d: 'Analysis beyond the free 31-day window, with month-over-month movement.' },
              { t: 'Per-platform timing', d: 'Best hour and day broken out for every platform you stream on.' },
              { t: 'Complete fan ranking', d: 'All supporters, spend history, and who has gone quiet.' },
            ].map((p, i) => (
              <Panel key={i} accent={C.gold} style={{ padding: 13 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.white, display: 'flex', alignItems: 'center' }}>
                  {p.t}<ProTag />
                </div>
                <div style={{ fontSize: 11, color: C.text, marginTop: 4, lineHeight: 1.45 }}>{p.d}</div>
              </Panel>
            ))}
          </div>
        </Section>
      )}

      <DataCoverage coverage={coverage} />

      <Section title="Your next best move">
        <NextBestMove comparison={comparison} efficiency={efficiency} timeIntel={timeIntel} onOpenPlanner={onOpenPlanner} />
      </Section>
    </>
  )
}

// ============================================
// SPLIT VIEW — single platform
// ============================================

function SplitView({ analytics, platformName, isPro }) {
  const snap = useMemo(() => buildPlatformSnapshot(analytics, platformName), [analytics, platformName])
  const accent = accentFor(platformName)

  if (!snap) {
    return <Empty>{platformName} has no meaningful session data yet, so there is nothing reliable to break down.</Empty>
  }

  return (
    <>
      <Section title={`${platformName} snapshot`}>
        <MetricStrip items={[
          { label: 'Earnings', value: fmt$0(snap.earnings), color: C.green },
          { label: 'Share', value: `${snap.earningsPercent}%` },
          { label: 'Tips', value: fmtN(snap.tips) },
          { label: 'Hours', value: snap.hours > 0 ? fmtH(snap.hours) : '—' },
          // Sub-label names the hours the rate divides by, which is a subset of
          // Hours beside it — without it the two read as failing to divide.
          { label: '$ / hour', value: snap.usdPerHour > 0 ? fmt$(snap.usdPerHour) : '—', sub: snap.rateHours > 0 ? `est · ${fmt$0(snap.rateUSD)} / ${snap.rateHours}h` : null, color: snap.usdPerHour > 0 ? accent : C.muted },
          { label: 'Sessions', value: fmtN(snap.sessions) },
        ]} />
      </Section>

      <div className="pi-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Section title="Performance" style={{ marginBottom: 0 }}>
          <MetricStrip items={[
            { label: '$ / session', value: snap.sessions > 0 ? fmt$(snap.earningsPerSession) : '—' },
            { label: 'Avg tip', value: snap.avgTipSize > 0 ? fmt$(snap.avgTipSize) : '—' },
            { label: 'Time share', value: `${snap.hoursPercent}%` },
          ]} />
          {snap.missedRevenue && (
            <div style={{ marginTop: 8 }}>
              <FactRow label="Timing gap" accent={C.gold}
                facts={`Sessions at ${formatHour(snap.missedRevenue.bestHour)} typically earn ${snap.missedRevenue.multiplier}× your average here.`} />
            </div>
          )}
        </Section>

        <Section title="Revenue mix" style={{ marginBottom: 0 }}>
          {snap.revenueMix.length === 0 ? (
            <Empty>No revenue-type detail recorded for this platform.</Empty>
          ) : (
            <DataTable
              columns={[{ label: 'Type', align: 'left' }, { label: 'Count' }, { label: 'Avg' }, { label: 'Earnings' }, { label: 'Share' }]}
              rows={snap.revenueMix.slice(0, 6).map(t => [
                t.type, fmtN(t.count), fmt$(t.avgUsd), fmt$(t.usd),
                <ShareBar key="s" percent={t.pct} color={accent} />,
              ])}
            />
          )}
        </Section>

      </div>

      <div className="pi-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Section title={`When ${platformName} pays`} style={{ marginBottom: 0 }}>
          {!snap.bestHour && !snap.bestDay ? (
            <Empty>Not enough repeat activity on this platform to name a reliable time.</Empty>
          ) : !isPro ? (
            <LockedRow text={`Best hour and day for ${platformName}`} />
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {snap.bestHour && (
                <FactRow label="Best hour" accent={accent}
                  facts={`${snap.bestHour.label} · ${fmt$(snap.bestHour.avg)} typical · ${fmtN(snap.bestHour.sessionCount)} sessions`} />
              )}
              {snap.bestDay && (
                <FactRow label="Best day" accent={C.purple}
                  facts={`${snap.bestDay.day} · ${fmt$(snap.bestDay.avg)} typical · ${fmtN(snap.bestDay.activeDays)} days`} />
              )}
              {snap.hourly.length > 1 && (
                <DataTable
                  columns={[{ label: 'Hour', align: 'left' }, { label: 'Typical' }, { label: 'Sessions' }]}
                  rows={snap.hourly.slice(0, 6).map(h => [
                    formatHour(h.hour), fmt$(h.avg), fmtN(h.sessionCount),
                  ])}
                />
              )}
            </div>
          )}
        </Section>
        <Section title="Day of week" style={{ marginBottom: 0 }}>
          {snap.weekdays.length === 0 ? (
            <Empty>No weekday has three separate active days yet, so there is no dependable pattern to show.</Empty>
          ) : (
            <DataTable
              // No total column: these come from every tip, while the earnings
              // above count meaningful sessions only, so a total here would
              // invite a sum that does not match the snapshot.
              columns={[{ label: 'Day', align: 'left' }, { label: 'Typical day' }, { label: 'Active days' }]}
              rows={snap.weekdays.map(d => [
                d.day, fmt$(d.avg), fmtN(d.activeDays),
              ])}
            />
          )}
        </Section>
      </div>

      <Section title={`Supporters on ${platformName}`} note="Identities are never merged across platforms">
        {snap.topFans.length === 0 ? (
          <Empty>No supporters recorded on this platform yet.</Empty>
        ) : (
          <>
            <DataTable
              columns={[{ label: 'Supporter', align: 'left' }, { label: 'Tips' }, { label: 'Total' }, { label: 'Share' }]}
              rows={snap.topFans.slice(0, isPro ? 10 : 3).map(f => [
                f.username, fmtN(f.tipCount), fmt$(f.earnings),
                <ShareBar key="s" percent={f.earningsPercent} color={C.pink} />,
              ])}
            />
            {!isPro && snap.topFans.length > 3 && (
              <div style={{ marginTop: 6 }}><LockedRow text="Full supporter list for this platform" /></div>
            )}
          </>
        )}
      </Section>
    </>
  )
}

// ============================================
// PAGE
// ============================================

export default function PlatformsIntelligence({ analytics = null, tips = [], shows = [], tz = 'UTC', isPro = false, onOpenPlanner = null, onGoLive = null }) {
  const [view, setView] = useState('unified')
  const [selectedPlatform, setSelectedPlatform] = useState(null)
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  // Coverage reads the account's real import span via the canonical vault
  // helper rather than deriving its own.
  const coverage = useMemo(() => buildDataCoverage(computeDataVaultStats(tips)), [tips])

  const platformNames = useMemo(
    () => buildPlatformComparison(analytics).map(p => p.platform),
    [analytics]
  )
  const activePlatform = platformNames.includes(selectedPlatform) ? selectedPlatform : (platformNames[0] || null)

  return (
    <div className="pi-root" style={{ maxWidth: 1280 }}>
      <style>{`
        .pi-root { max-width: 100%; }
        .pi-root table { font-variant-numeric: tabular-nums; }
        /* Grid and flex children default to min-width:auto, which lets a wide
           table stretch its column and scroll the whole page sideways instead
           of scrolling inside its own wrapper. */
        .pi-root section, .pi-root .pi-two-col > * { min-width: 0; }
        @media (max-width: 900px) {
          .pi-root .pi-two-col { grid-template-columns: 1fr !important; gap: 14px !important; }
          .pi-root .pi-pro-grid { grid-template-columns: 1fr !important; }
          .pi-root .pi-strip { grid-template-columns: repeat(3, minmax(0,1fr)) !important; }
        }
        @media (max-width: 520px) {
          .pi-root .pi-strip { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
        }
      `}</style>

      <div className="pi-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <span aria-hidden="true" style={{ flex: '0 0 50px', height: 50, borderRadius: '50%', display: 'grid', placeItems: 'center', color: C.pink, background: 'radial-gradient(circle at 30% 30%, rgba(236,72,153,0.28), rgba(124,92,255,0.12))', border: '1px solid rgba(236,72,153,0.35)', boxShadow: '0 0 22px rgba(236,72,153,0.22)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 20V13M10 20V8M15 20V11M20 20V4" /></svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.text }}>Platforms</div>
            <h1 style={{ margin: '2px 0 0', fontSize: 'clamp(22px, 2.4vw, 30px)', fontWeight: 850, letterSpacing: '-0.02em', color: C.white }}>Platform Intelligence</h1>
            <div style={{ fontSize: 13, color: C.text, marginTop: 2 }}>Cross-platform performance, trends &amp; opportunities</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Same control as the Sessions range group (Stream Planner Pill styling) */}
          <div role="group" aria-label="View" style={{ display: 'flex', gap: 4, background: 'rgba(8,11,22,0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 4 }}>
            {[['unified', 'Unified View'], ['split', 'Split View']].map(([v, l]) => (
              <button key={v} data-testid={`pi-view-${v}`} aria-pressed={view === v} onClick={() => setView(v)} style={{
                padding: '5px 13px', fontSize: 12, borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
                border: `1px solid ${view === v ? '#22d3ee' : 'rgba(255,255,255,0.08)'}`,
                background: view === v ? 'rgba(34,211,238,0.10)' : 'transparent',
                color: view === v ? '#22d3ee' : '#64748b', fontWeight: view === v ? 700 : 400,
              }}>{l}</button>
            ))}
          </div>
          {onGoLive && (
            <button data-testid="pi-go-live" onClick={onGoLive} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', fontSize: 14, fontWeight: 800,
              borderRadius: 11, cursor: 'pointer', border: 'none', color: '#04120d',
              background: 'linear-gradient(90deg, #10B981, #22D3EE)', boxShadow: '0 0 18px rgba(16,185,129,0.3)',
            }}><span aria-hidden="true">⚡</span>Go Live</button>
          )}
        </div>
      </div>

      {!analytics || platformNames.length === 0 ? (
        <Empty>
          No platform has enough session data to analyse yet. Import tips from a platform and CamCash will build its intelligence from there.
        </Empty>
      ) : view === 'unified' ? (
        <>
          <PlatformsUnified analytics={analytics} tips={tips} shows={shows} tz={tz} isPro={isPro} onSelectPlatform={p => { setSelectedPlatform(p); setView('split') }} onOpenPlanner={onOpenPlanner} />
          {/* Detailed tables (efficiency, comparison, supporters, next move) stay available, collapsed. */}
          <div style={{ marginTop: 16, border: '1px solid rgba(168,85,247,0.22)', borderRadius: 16, background: 'rgba(10,12,28,0.7)' }}>
            <button data-testid="pi-breakdown-toggle" aria-expanded={breakdownOpen} onClick={() => setBreakdownOpen(v => !v)} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 18px',
              background: 'none', border: 'none', color: C.white, fontSize: 14, fontWeight: 750, cursor: 'pointer', textAlign: 'left',
            }}><span>Full breakdown <span style={{ color: C.text, fontWeight: 500 }}>· tables, supporters, next best move</span></span><span aria-hidden="true" style={{ color: C.text }}>{breakdownOpen ? '–' : '+'}</span></button>
            {breakdownOpen && <div data-testid="pi-breakdown" style={{ padding: '4px 18px 18px' }}><UnifiedView analytics={analytics} coverage={coverage} isPro={isPro} onOpenPlanner={onOpenPlanner} /></div>}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {platformNames.map(p => (
              <button key={p} onClick={() => setSelectedPlatform(p)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 11px', fontSize: 11.5, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
                background: activePlatform === p ? `${accentFor(p)}1f` : 'transparent',
                border: `1px solid ${activePlatform === p ? `${accentFor(p)}88` : C.border}`,
                color: activePlatform === p ? C.white : C.text,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: accentFor(p) }} />
                {p}
              </button>
            ))}
          </div>
          {activePlatform && (
            <SplitView analytics={analytics} platformName={activePlatform} isPro={isPro} />
          )}
        </>
      )}
    </div>
  )
}
