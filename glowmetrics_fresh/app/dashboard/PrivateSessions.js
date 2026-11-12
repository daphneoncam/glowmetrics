"use client"
import { useState, useMemo } from "react"
import {
  BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts"
import { computePaidSessionAnalytics } from "../../lib/analytics"

const CARD   = "rgba(255,255,255,0.03)"
const BORDER = "rgba(255,255,255,0.08)"
const CYAN   = "#22d3ee"
const PURPLE = "#a855f7"
const PINK   = "#f472b6"
const GOLD   = "#f59e0b"
const GREEN  = "#4ade80"
const SLATE  = "#64748b"
const TEXT   = "#f1f5f9"
const MUTED  = "#94a3b8"
const TYPE_COLORS = { "Private Chat": CYAN, "Full-Private Chat": PURPLE, "Group Chat": GOLD, "Spy Mode": PINK }

function fmtUsd(n) { return `$${Number(n || 0).toFixed(2)}` }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—" }
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—" }
function daysAgo(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

const cardStyle = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "16px 18px" }

function StatCard({ label, value, color = TEXT, sub }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: MUTED, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// Private earnings are additive to — never double-counted with — free-chat
// tips or Live Mode earnings. Each total below is computed from its own
// table (paid_sessions / tips / live_tips) and only ever summed here for
// display, never merged at the row level. See lib/analytics.js's
// computePaidSessionAnalytics header comment.
function RevenueTotalsRow({ tipsTotalUSD, privateTotalUSD, liveTotalUSD }) {
  const combined = (tipsTotalUSD || 0) + (privateTotalUSD || 0) + (liveTotalUSD || 0)
  const rows = [
    { label: "Free-chat tips", value: tipsTotalUSD, color: CYAN },
    { label: "Private/paid sessions", value: privateTotalUSD, color: PURPLE },
    { label: "Live Mode earnings", value: liveTotalUSD, color: GOLD },
  ]
  return (
    <div style={{ ...cardStyle, marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: MUTED, marginBottom: 12 }}>Revenue Sources (each counted once)</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {rows.map(r => (
          <div key={r.label}>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{r.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: r.color }}>{fmtUsd(r.value)}</div>
          </div>
        ))}
        <div style={{ borderLeft: `1px solid ${BORDER}`, paddingLeft: 12 }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Combined earnings</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>{fmtUsd(combined)}</div>
        </div>
      </div>
    </div>
  )
}

// paidSessions: raw rows from the paid_sessions table (page.js's loadData()).
// tipsTotalUSD / liveTotalUSD: optional, for the revenue-totals summary only —
// omit either to hide that column rather than show a misleading $0.
// onViewFan(username, platform): optional callback to open the fan profile
// (Whale Profile Modal) for a row/client, matched by platform+username.
export default function PrivateSessions({ paidSessions = [], tipsTotalUSD = null, liveTotalUSD = null, onViewFan, timezone = 'UTC' }) {
  const [platformFilter, setPlatformFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [clientFilter, setClientFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const platforms = useMemo(() => [...new Set(paidSessions.map(s => s.platform).filter(Boolean))], [paidSessions])
  const types = useMemo(() => [...new Set(paidSessions.map(s => s.session_type).filter(Boolean))], [paidSessions])

  const filtered = useMemo(() => {
    return paidSessions.filter(s => {
      if (platformFilter !== "all" && s.platform !== platformFilter) return false
      if (typeFilter !== "all" && s.session_type !== typeFilter) return false
      if (clientFilter && !(s.username || "").toLowerCase().includes(clientFilter.toLowerCase())) return false
      if (dateFrom && new Date(s.date_time) < new Date(dateFrom)) return false
      if (dateTo && new Date(s.date_time) > new Date(dateTo + "T23:59:59")) return false
      return true
    })
  }, [paidSessions, platformFilter, typeFilter, clientFilter, dateFrom, dateTo])

  const stats = useMemo(() => computePaidSessionAnalytics(filtered, timezone), [filtered, timezone])

  if (!paidSessions.length) {
    return (
      <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 8 }}>No private sessions yet</div>
        <div style={{ fontSize: 13, color: MUTED, maxWidth: 420, margin: "0 auto" }}>
          Import your BongaCams, Chaturbate, or MyFreeCams private-session history from the onboarding or CSV import flow to see Private, Full-Private, Group, and Spy Mode session analytics here.
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 14, color: MUTED }}>No sessions match the current filters.</div>
      </div>
    )
  }

  return (
    <div>
      {(tipsTotalUSD !== null || liveTotalUSD !== null) && (
        <RevenueTotalsRow tipsTotalUSD={tipsTotalUSD} privateTotalUSD={stats.totalUSD} liveTotalUSD={liveTotalUSD} />
      )}

      {/* ── FILTERS ─────────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
        <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} style={selectStyle}>
          <option value="all">All platforms</option>
          {platforms.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={selectStyle}>
          <option value="all">All session types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="Filter by client…" value={clientFilter} onChange={e => setClientFilter(e.target.value)} style={{ ...selectStyle, minWidth: 160 }} />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={selectStyle} />
        <span style={{ color: MUTED, alignSelf: "center", fontSize: 12 }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={selectStyle} />
      </div>

      {/* ── SUMMARY CARDS ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
        <StatCard label="Total Private Earnings" value={fmtUsd(stats.totalUSD)} color={PURPLE} />
        <StatCard label="Total Sessions" value={stats.totalCount} />
        <StatCard label="Total Tokens" value={stats.totalTokens.toLocaleString()} />
        <StatCard label="Avg $/Session" value={fmtUsd(stats.avgSessionUSD)} />
        <StatCard label="Avg Tokens/Session" value={stats.avgTokensPerSession.toLocaleString()} />
        <StatCard label="Avg Payout/Token" value={`$${stats.avgPayoutPerToken.toFixed(4)}`} sub="Effective rate, all sessions" />
        <StatCard label="Unique Clients" value={stats.uniqueClients} />
        <StatCard label="Most Recent Session" value={fmtDate(stats.dateRange?.to)} />
      </div>

      {/* ── CHARTS ──────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 20 }}>
        <div style={cardStyle}>
          <div style={chartTitleStyle}>Earnings Over Time</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={stats.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis dataKey="month" tick={{ fill: MUTED, fontSize: 11 }} />
              <YAxis tick={{ fill: MUTED, fontSize: 11 }} />
              <Tooltip formatter={v => fmtUsd(v)} contentStyle={{ background: "#0a0e1a", border: `1px solid ${BORDER}` }} />
              <Line type="monotone" dataKey="usd" stroke={PURPLE} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={cardStyle}>
          <div style={chartTitleStyle}>Session Count Over Time</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis dataKey="month" tick={{ fill: MUTED, fontSize: 11 }} />
              <YAxis tick={{ fill: MUTED, fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#0a0e1a", border: `1px solid ${BORDER}` }} />
              <Bar dataKey="count" fill={CYAN} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={cardStyle}>
          <div style={chartTitleStyle}>By Session Type</div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={stats.sessionTypeBreakdown} dataKey="usd" nameKey="type" innerRadius={40} outerRadius={70} paddingAngle={2}>
                {stats.sessionTypeBreakdown.map(d => <Cell key={d.type} fill={TYPE_COLORS[d.type] || SLATE} />)}
              </Pie>
              <Tooltip formatter={v => fmtUsd(v)} contentStyle={{ background: "#0a0e1a", border: `1px solid ${BORDER}` }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, justifyContent: "center" }}>
            {stats.sessionTypeBreakdown.map(d => (
              <span key={d.type} style={{ fontSize: 11, color: MUTED }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: TYPE_COLORS[d.type] || SLATE, marginRight: 4 }} />
                {d.type} ({d.pct}%)
              </span>
            ))}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={chartTitleStyle}>By Platform</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.platformBreakdown} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis type="number" tick={{ fill: MUTED, fontSize: 11 }} />
              <YAxis type="category" dataKey="platform" tick={{ fill: MUTED, fontSize: 11 }} width={90} />
              <Tooltip formatter={v => fmtUsd(v)} contentStyle={{ background: "#0a0e1a", border: `1px solid ${BORDER}` }} />
              <Bar dataKey="usd" fill={GOLD} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── PEAK-HOUR TIMELINE (heatmap-style row) ───────────── */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={chartTitleStyle}>Session Timing (by hour, UTC)</div>
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {Array.from({ length: 24 }, (_, h) => {
            const hourData = stats.peakHours.find(p => p.hour === h)
            const maxUsd = Math.max(...stats.peakHours.map(p => p.usd), 1)
            const intensity = hourData ? hourData.usd / maxUsd : 0
            return (
              <div key={h} title={hourData ? `${h}:00 — ${fmtUsd(hourData.usd)} (${hourData.count} sessions)` : `${h}:00 — no sessions`}
                style={{ flex: 1, minWidth: 24, height: 36, borderRadius: 6, background: intensity > 0 ? `rgba(168,85,247,${0.15 + intensity * 0.75})` : "rgba(255,255,255,0.03)", display: "flex", alignItems: "flex-end", justifyContent: "center", fontSize: 9, color: MUTED, paddingBottom: 2 }}>
                {h}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── LEADERBOARD ─────────────────────────────────────── */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={chartTitleStyle}>Private Session Leaderboard</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {stats.topClients.map((c, i) => (
            <div key={c.username} onClick={() => onViewFan?.(c.username, stats.platformBreakdown[0]?.platform)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 10, background: i < 3 ? "rgba(168,85,247,0.08)" : "transparent", cursor: onViewFan ? "pointer" : "default" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: MUTED, width: 20 }}>#{i + 1}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{c.username}</span>
                <span style={{ fontSize: 11, color: MUTED }}>{c.sessionCount} session{c.sessionCount !== 1 ? "s" : ""}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 800, color: PURPLE }}>{fmtUsd(c.totalUSD)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── TABLE ───────────────────────────────────────────── */}
      <div style={{ ...cardStyle, overflowX: "auto" }}>
        <div style={chartTitleStyle}>All Private Sessions ({filtered.length})</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}`, textAlign: "left", color: MUTED }}>
              {["Fan", "Platform", "Date", "Type", "Tokens", "USD", "Rate/token", "Time since last"].map(h => (
                <th key={h} style={{ padding: "8px 10px", fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...filtered].sort((a, b) => new Date(b.date_time) - new Date(a.date_time)).slice(0, 200).map(s => {
              const rate = s.tokens > 0 ? (parseFloat(s.usd) || 0) / s.tokens : 0
              const client = stats.topClients.find(c => c.username === s.username)
              const d = daysAgo(client?.lastSession)
              return (
                <tr key={s.id} onClick={() => onViewFan?.(s.username, s.platform)}
                  style={{ borderBottom: `1px solid ${BORDER}`, cursor: onViewFan ? "pointer" : "default" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 700, color: TEXT }}>{s.username}</td>
                  <td style={{ padding: "8px 10px", color: MUTED }}>{s.platform}</td>
                  <td style={{ padding: "8px 10px", color: MUTED }}>{fmtDateTime(s.date_time)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ color: TYPE_COLORS[s.session_type] || SLATE, fontWeight: 700 }}>{s.session_type}</span>
                  </td>
                  <td style={{ padding: "8px 10px", color: MUTED }}>{s.tokens}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 700, color: GREEN }}>{fmtUsd(s.usd)}</td>
                  <td style={{ padding: "8px 10px", color: MUTED }}>${rate.toFixed(4)}</td>
                  <td style={{ padding: "8px 10px", color: MUTED }}>{d !== null ? `${d}d ago` : "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const selectStyle = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 12px", color: TEXT, fontSize: 12 }
const chartTitleStyle = { fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }
