"use client"
import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"

const C = {
  bg:     "#050713",
  bg1:    "#080B1A",
  bg2:    "#0D1020",
  card:   "rgba(10,14,32,0.82)",
  border: "rgba(255,255,255,0.09)",
  cyan:   "#16F4FF",
  pink:   "#FF2BAE",
  purple: "#7C5CFF",
  gold:   "#FFC857",
  green:  "#34d399",
  red:    "#f87171",
  white:  "#FFFFFF",
  text:   "#D7D9EA",
  muted:  "#8D93AA",
  dim:    "rgba(255,255,255,0.25)",
}

const ONBOARDING = {
  "no-profile": { label: "No Profile",  color: C.red    },
  "started":    { label: "Onboarding",  color: C.gold   },
  "imported":   { label: "Imported",    color: C.cyan   },
  "complete":   { label: "Complete",    color: C.green  },
}

const DASHBOARD = {
  "no-data":         { label: "No Data",       color: C.muted  },
  "tiny-import":     { label: "Tiny Import",   color: C.gold   },
  "first-valid-data":{ label: "First Data",    color: C.cyan   },
  "growing-insights":{ label: "Growing",       color: C.purple },
  "full-dashboard":  { label: "Full Dashboard",color: C.green  },
  "live-active":     { label: "Live Now",      color: C.pink   },
}

const SUB_COLORS = {
  active:    C.green,
  trialing:  C.cyan,
  cancelled: C.red,
  free:      C.muted,
}

function fmt(d) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
}

function fmtTime(d) {
  if (!d) return "—"
  const now = Date.now()
  const diff = now - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins/60)}h ago`
  return `${Math.floor(mins/1440)}d ago`
}

const pill = (label, color) => (
  <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:99, fontSize:10, fontWeight:700, letterSpacing:"0.04em", background:`${color}22`, color, border:`1px solid ${color}44` }}>
    {label}
  </span>
)

const Card = ({ children, style={} }) => (
  <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:18, padding:"20px 22px", boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.28)", ...style }}>
    {children}
  </div>
)

const SectionTitle = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:700, color:C.muted, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:14 }}>
    {children}
  </div>
)

const KpiCard = ({ label, value, sub, accent=C.cyan }) => (
  <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`2px solid ${accent}`, borderRadius:16, padding:"18px 20px", position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", top:0, right:0, width:70, height:70, background:`radial-gradient(circle at top right, ${accent}18, transparent 70%)`, pointerEvents:"none" }}/>
    <div style={{ fontSize:10, fontWeight:700, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>{label}</div>
    <div style={{ fontSize:28, fontWeight:800, color:accent, fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{value ?? "—"}</div>
    {sub && <div style={{ fontSize:11, color:C.muted, marginTop:6 }}>{sub}</div>}
  </div>
)

const FunnelRow = ({ label, count, total, prev }) => {
  const pct = total ? Math.round((count/total)*100) : 0
  const drop = prev != null && prev > 0 ? Math.round(((prev-count)/prev)*100) : null
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <span style={{ fontSize:12, color:C.text }}>{label}</span>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {drop !== null && drop > 0 && <span style={{ fontSize:10, color:C.red }}>-{drop}% drop</span>}
          <span style={{ fontSize:12, fontWeight:700, color:C.white, fontFamily:"'DM Mono',monospace" }}>{count} <span style={{ color:C.muted, fontWeight:400 }}>({pct}%)</span></span>
        </div>
      </div>
      <div style={{ height:5, background:"rgba(255,255,255,0.07)", borderRadius:99, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg, ${C.cyan}, ${C.purple})`, borderRadius:99, transition:"width 0.5s ease" }}/>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const router  = useRouter()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState("")
  const [search,  setSearch]  = useState("")
  const [filterOnboarding, setFilterOnboarding] = useState("all")
  const [filterDashboard,  setFilterDashboard]  = useState("all")
  const [sortBy,  setSortBy]  = useState("createdAt")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/stats")
      if (res.status === 401) { router.replace("/admin/login"); return }
      const d = await res.json()
      if (d.error) { setError(d.error); return }
      setData(d)
    } catch { setError("Failed to load stats.") }
    finally { setLoading(false) }
  }, [router])

  useEffect(() => {
    if (!document.cookie.includes("gm_admin=")) { router.replace("/admin/login"); return }
    load()
  }, [load])

  const logout = () => {
    document.cookie = "gm_admin=;path=/;max-age=0"
    router.replace("/admin/login")
  }

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:40, height:40, border:`3px solid ${C.border}`, borderTopColor:C.cyan, borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }}/>
        <div style={{ color:C.muted, fontSize:13 }}>Loading command center…</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (error) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <Card style={{ maxWidth:400, textAlign:"center" }}>
        <div style={{ color:C.red, fontSize:13, marginBottom:12 }}>{error}</div>
        <button onClick={load} style={{ padding:"8px 20px", borderRadius:10, background:`${C.cyan}22`, border:`1px solid ${C.cyan}44`, color:C.cyan, cursor:"pointer", fontSize:12 }}>Retry</button>
      </Card>
    </div>
  )

  const { kpis, funnel, stageBreakdown, platformBreakdown, users=[], importHealth, liveMode, extension, subscriptions, feedback, signupsByDay=[], signupsByDayOfWeek=[], signupsByDayOfWeekStats={}, utmBreakdown={}, generatedAt } = data || {}

  // Filter + sort users
  const filtered = users
    .filter(u => {
      const q = search.toLowerCase()
      const matchSearch = !q || u.email?.toLowerCase().includes(q)
      const matchOnboarding = filterOnboarding === "all" || u.onboardingStage === filterOnboarding
      const matchDashboard  = filterDashboard  === "all" || u.dashboardStage  === filterDashboard
      return matchSearch && matchOnboarding && matchDashboard
    })
    .sort((a, b) => {
      if (sortBy === "createdAt")   return b.createdAt > a.createdAt ? 1 : -1
      if (sortBy === "tipCount")    return b.tipCount - a.tipCount
      if (sortBy === "totalUsd")    return b.totalUsd - a.totalUsd
      if (sortBy === "lastActivity")return (b.lastActivity||"") > (a.lastActivity||"") ? 1 : -1
      return 0
    })

  const signedUpNoImport = users.filter(u => u.uploadCount === 0).length

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'DM Sans','Inter',sans-serif", paddingBottom:60 }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}
        *{box-sizing:border-box}
        th{font-size:10px;font-weight:700;color:${C.muted};letter-spacing:0.08em;text-transform:uppercase;padding:8px 12px;text-align:left;white-space:nowrap}
        td{font-size:12px;color:${C.text};padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:middle}
        tr:last-child td{border-bottom:none}
        tr:hover td{background:rgba(255,255,255,0.03)}
        select,input{background:rgba(255,255,255,0.06);border:1px solid ${C.border};border-radius:8px;color:${C.text};padding:6px 10px;font-size:12px;outline:none}
        select option{background:#0D1020}
      `}</style>

      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, background:C.bg1, padding:"0 32px" }}>
        <div style={{ maxWidth:1400, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:56 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontSize:16, fontWeight:800, background:`linear-gradient(90deg, ${C.cyan}, ${C.pink})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
              CamCash Admin
            </div>
            <span style={{ fontSize:10, padding:"2px 8px", borderRadius:99, background:"rgba(22,244,255,0.1)", color:C.cyan, border:`1px solid ${C.cyan}33`, fontWeight:700, letterSpacing:"0.08em" }}>
              COMMAND CENTER
            </span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <span style={{ fontSize:11, color:C.muted }}>Updated {fmtTime(generatedAt)}</span>
            <button onClick={load} style={{ padding:"5px 14px", borderRadius:8, background:`${C.cyan}18`, border:`1px solid ${C.cyan}33`, color:C.cyan, cursor:"pointer", fontSize:11, fontWeight:700 }}>↻ Refresh</button>
            <button onClick={() => router.push("/admin/preview")} style={{ padding:"5px 14px", borderRadius:8, background:`${C.purple}18`, border:`1px solid ${C.purple}44`, color:C.purple, cursor:"pointer", fontSize:11, fontWeight:700 }}>👁 Stage Preview</button>
            <button onClick={logout} style={{ padding:"5px 14px", borderRadius:8, background:"rgba(255,255,255,0.05)", border:`1px solid ${C.border}`, color:C.muted, cursor:"pointer", fontSize:11 }}>Sign out</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1400, margin:"0 auto", padding:"28px 32px" }}>

        {/* KPI Cards — Row 1: User counts */}
        <div style={{ fontSize:10, fontWeight:700, color:C.muted, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>Users</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12, marginBottom:20 }}>
          <KpiCard label="Real Users"         value={kpis?.totalRealUsers}    accent={C.cyan}   sub={`${kpis?.testUsers ?? 0} test excluded`} />
          <KpiCard label="New This Month"     value={kpis?.newUsers30d}       accent={C.green}  sub="last 30 days" />
          <KpiCard label="New This Week"      value={kpis?.newUsers7d}        accent={C.cyan}   sub="last 7 days" />
          <KpiCard label="New Today"          value={kpis?.newUsers24h}       accent={C.purple} sub="last 24h" />
          <KpiCard label="Have Tip Data"      value={kpis?.usersWithTipData}  accent={C.green}  sub="imported tips" />
          <KpiCard label="Zero Tips"          value={kpis?.usersWithZeroTips} accent={C.gold}   sub="never imported" />
          <KpiCard label="Live Mode Users"    value={kpis?.liveModeUsers}     accent={C.pink}   sub="ever used live" />
          <KpiCard label="Active 24h"         value={kpis?.activeUsers24h}    accent={C.gold}   sub="tip or live activity" />
        </div>

        {/* KPI Cards — Row 2: Data health */}
        <div style={{ fontSize:10, fontWeight:700, color:C.muted, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>Data Health</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12, marginBottom:28 }}>
          <KpiCard label="Total Tip Rows"     value={kpis?.totalTipRows}      accent={C.cyan}   sub="in tips table" />
          <KpiCard label="Live Tips"          value={kpis?.totalLiveTips}     accent={C.pink}   sub="in live_tips table" />
          <KpiCard label="CSV Uploads"        value={kpis?.totalCsvUploads}   accent={C.purple} sub="all time" />
          <KpiCard label="Beta Users"         value={kpis?.betaUsers}         accent={C.gold}   sub="in beta_users" />
          <KpiCard label="Onboarding Done"    value={kpis?.onboardingComplete} accent={C.green} sub={`of ${kpis?.totalRealUsers ?? 0} real users`} />
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>

          {/* Onboarding Funnel */}
          <Card>
            <SectionTitle>Onboarding Funnel</SectionTitle>
            <FunnelRow label="Signed Up"            count={funnel?.signedUp}            total={funnel?.signedUp} prev={null} />
            <FunnelRow label="Profile Created"      count={funnel?.hasProfile}          total={funnel?.signedUp} prev={funnel?.signedUp} />
            <FunnelRow label="Started Onboarding"   count={funnel?.startedOnboarding}   total={funnel?.signedUp} prev={funnel?.hasProfile} />
            <FunnelRow label="Imported Data"        count={funnel?.hasImports}          total={funnel?.signedUp} prev={funnel?.startedOnboarding} />
            <FunnelRow label="Completed Onboarding" count={funnel?.completedOnboarding} total={funnel?.signedUp} prev={funnel?.hasImports} />
            <div style={{ marginTop:16, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>Signed up but never imported</div>
              <span style={{ fontSize:22, fontWeight:800, color:C.gold, fontFamily:"'DM Mono',monospace" }}>{signedUpNoImport}</span>
              <span style={{ fontSize:11, color:C.muted, marginLeft:6 }}>users need a nudge</span>
            </div>
          </Card>

          {/* Dashboard Stage Breakdown */}
          <Card>
            <SectionTitle>Dashboard Stage Distribution</SectionTitle>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {Object.entries(DASHBOARD).map(([key, { label, color }]) => {
                const count = stageBreakdown?.[key] || 0
                const pct   = kpis?.totalUsers ? Math.round((count/kpis.totalUsers)*100) : 0
                return (
                  <div key={key}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ fontSize:12, color }}>{label}</span>
                      <span style={{ fontSize:12, fontWeight:700, color:C.white, fontFamily:"'DM Mono',monospace" }}>{count} <span style={{ color:C.muted, fontWeight:400 }}>({pct}%)</span></span>
                    </div>
                    <div style={{ height:4, background:"rgba(255,255,255,0.07)", borderRadius:99, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:99 }}/>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:20, marginBottom:20 }}>

          {/* Import Health */}
          <Card>
            <SectionTitle>Import Health</SectionTitle>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              {[
                ["Total Imports", importHealth?.total, C.cyan],
                ["Failed",        importHealth?.failed, importHealth?.failed > 0 ? C.red : C.green],
                ["Last 24h",      importHealth?.last24h, C.gold],
                ["Last 7d",       importHealth?.last7d,  C.purple],
              ].map(([l,v,color]) => (
                <div key={l} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.06em" }}>{l}</div>
                  <div style={{ fontSize:20, fontWeight:800, color, fontFamily:"'DM Mono',monospace" }}>{v ?? 0}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:11, color:C.muted, marginBottom:8 }}>Platform breakdown</div>
            {Object.entries(importHealth?.platforms || {}).map(([p, n]) => (
              <div key={p} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                <span style={{ fontSize:12 }}>{p}</span>
                <span style={{ fontSize:12, fontWeight:700, color:C.cyan, fontFamily:"'DM Mono',monospace" }}>{n}</span>
              </div>
            ))}
            {!Object.keys(importHealth?.platforms || {}).length && <div style={{ fontSize:12, color:C.muted }}>No imports yet</div>}
          </Card>

          {/* Live Mode Health */}
          <Card>
            <SectionTitle>Live Mode Health</SectionTitle>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                ["Users Ever Used Live",   liveMode?.totalUsers,    C.cyan],
                ["Currently Active (12h)", liveMode?.currentlyLive, liveMode?.currentlyLive > 0 ? C.pink : C.muted],
                ["Tips Last 24h",          liveMode?.tips24h,       C.gold],
                ["Tips Last 12h",          liveMode?.tips12h,       C.gold],
              ].map(([l,v,color]) => (
                <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                  <span style={{ fontSize:12, color:C.text }}>{l}</span>
                  <span style={{ fontSize:16, fontWeight:800, color, fontFamily:"'DM Mono',monospace" }}>{v ?? 0}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0" }}>
                <span style={{ fontSize:12, color:C.text }}>Last Live Tip</span>
                <span style={{ fontSize:12, color:C.muted }}>{fmtTime(liveMode?.lastTip)}</span>
              </div>
            </div>
          </Card>

          {/* Extension Health */}
          <Card>
            <SectionTitle>Extension Health</SectionTitle>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                ["Installs",             extension?.installs,       C.cyan],
                ["Updates",              extension?.updates,        C.muted],
                ["Download Clicks",      extension?.downloadClicks, C.gold],
                ["Ever Active",          extension?.activeUsers,    C.purple],
                ["Active (24h)",         extension?.active24h,      extension?.active24h > 0 ? C.pink : C.muted],
              ].map(([l,v,color]) => (
                <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                  <span style={{ fontSize:12, color:C.text }}>{l}</span>
                  <span style={{ fontSize:16, fontWeight:800, color, fontFamily:"'DM Mono',monospace" }}>{v ?? 0}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0" }}>
                <span style={{ fontSize:12, color:C.text }}>Last Install</span>
                <span style={{ fontSize:12, color:C.muted }}>{fmtTime(extension?.lastInstall)}</span>
              </div>
            </div>
          </Card>

          {/* Subscriptions */}
          <Card>
            <SectionTitle>Subscriptions</SectionTitle>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {Object.entries(subscriptions || {}).map(([status, count]) => (
                <div key={status} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:SUB_COLORS[status] || C.muted }}/>
                    <span style={{ fontSize:12, textTransform:"capitalize" }}>{status}</span>
                  </div>
                  <span style={{ fontSize:16, fontWeight:800, color:SUB_COLORS[status] || C.muted, fontFamily:"'DM Mono',monospace" }}>{count}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}`, fontSize:11, color:C.muted }}>
              {subscriptions?.active === 0
                ? "No paid subscribers yet"
                : `${subscriptions?.active} paying user${subscriptions?.active !== 1 ? "s" : ""}`}
            </div>
          </Card>
        </div>

        {/* Platform Breakdown + Signup Trend */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>

          {/* Platform Breakdown (from tips) */}
          <Card>
            <SectionTitle>Platform Breakdown (from tips)</SectionTitle>
            {Object.keys(platformBreakdown || {}).length === 0
              ? <div style={{ fontSize:12, color:C.muted }}>No tip data yet</div>
              : Object.entries(platformBreakdown || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([platform, count]) => {
                    const total = Object.values(platformBreakdown).reduce((s, n) => s + n, 0)
                    const pct   = total ? Math.round((count / total) * 100) : 0
                    return (
                      <div key={platform} style={{ marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                          <span style={{ fontSize:12, color:C.text, textTransform:"capitalize" }}>{platform}</span>
                          <span style={{ fontSize:12, fontWeight:700, color:C.cyan, fontFamily:"'DM Mono',monospace" }}>{count.toLocaleString()} tips <span style={{ color:C.muted, fontWeight:400 }}>({pct}%)</span></span>
                        </div>
                        <div style={{ height:4, background:"rgba(255,255,255,0.07)", borderRadius:99, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg, ${C.cyan}, ${C.pink})`, borderRadius:99 }}/>
                        </div>
                      </div>
                    )
                  })
            }
          </Card>

          {/* Signup Trend */}
          <Card>
            <SectionTitle>Signup Trend — Last 30 Days</SectionTitle>
            {signupsByDay.length === 0
              ? <div style={{ fontSize:12, color:C.muted }}>No signups in last 30 days</div>
              : (() => {
                  const max = Math.max(...signupsByDay.map(d => d.count), 1)
                  return signupsByDay.slice(-20).map(({ date, count }) => (
                    <div key={date} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                      <span style={{ fontSize:10, color:C.muted, fontFamily:"'DM Mono',monospace", minWidth:72 }}>{date.slice(5)}</span>
                      <div style={{ flex:1, height:14, background:"rgba(255,255,255,0.04)", borderRadius:4, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${(count/max)*100}%`, background:`linear-gradient(90deg, ${C.cyan}99, ${C.purple}99)`, borderRadius:4, minWidth: count > 0 ? 4 : 0 }}/>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color:C.white, fontFamily:"'DM Mono',monospace", minWidth:16, textAlign:"right" }}>{count}</span>
                    </div>
                  ))
                })()
            }
          </Card>
        </div>

        {/* Signups by Day of Week */}
        <Card style={{ marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <SectionTitle>Signups by Day of Week (All Time)</SectionTitle>
            {signupsByDayOfWeekStats?.average && (
              <span style={{ fontSize:10, color:C.muted }}>Avg: {signupsByDayOfWeekStats.average}/day</span>
            )}
          </div>
          {signupsByDayOfWeek.length === 0
            ? <div style={{ fontSize:12, color:C.muted }}>No signup data</div>
            : (() => {
                const max = Math.max(...signupsByDayOfWeek.map(d => d.count), 1)
                const dayOrder = [1, 2, 3, 4, 5, 6, 0] // Monday through Sunday
                const ordered = dayOrder.map(i => signupsByDayOfWeek[i]).filter(Boolean)
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:12 }}>
                    {ordered.map(({ day, count, percentage }) => (
                      <div key={day} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"12px" }}>
                        <div style={{ fontSize:11, fontWeight:700, color:C.text, marginBottom:6 }}>{day}</div>
                        <div style={{ fontSize:18, fontWeight:800, color:C.cyan, fontFamily:"'DM Mono',monospace", marginBottom:4 }}>{count}</div>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div style={{ height:3, flex:1, background:"rgba(255,255,255,0.07)", borderRadius:99, overflow:"hidden", marginRight:6 }}>
                            <div style={{ height:"100%", width:`${(count/max)*100}%`, background:`linear-gradient(90deg, ${C.cyan}, ${C.purple})`, borderRadius:99 }}/>
                          </div>
                          <span style={{ fontSize:9, color:C.muted, fontFamily:"'DM Mono',monospace" }}>{percentage}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()
          }
          {signupsByDayOfWeekStats && (
            <div style={{ marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Highest Day</div>
                  <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                    <span style={{ fontSize:14, fontWeight:800, color:C.green }}>{signupsByDayOfWeekStats.maxDay}</span>
                    <span style={{ fontSize:11, color:C.muted }}>({signupsByDayOfWeekStats.maxCount} signups)</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Lowest Day</div>
                  <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                    <span style={{ fontSize:14, fontWeight:800, color:C.red }}>{signupsByDayOfWeekStats.minDay}</span>
                    <span style={{ fontSize:11, color:C.muted }}>({signupsByDayOfWeekStats.minCount} signups)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Recent Imports */}
        {importHealth?.recent?.length > 0 && (
          <Card style={{ marginBottom:20 }}>
            <SectionTitle>Recent Imports</SectionTitle>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr>
                  <th>User</th><th>Platform</th><th>Status</th><th>Rows</th><th>Inserted</th><th>USD</th><th>When</th>
                </tr></thead>
                <tbody>
                  {importHealth.recent.map((imp, i) => (
                    <tr key={i}>
                      <td style={{ color:C.cyan, fontFamily:"'DM Mono',monospace", fontSize:11 }}>{imp.userEmail}</td>
                      <td>{imp.platform}</td>
                      <td>{pill(imp.status, imp.status === 'complete' ? C.green : C.red)}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace" }}>{imp.rows ?? "—"}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace" }}>{imp.inserted ?? "—"}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace", color:C.gold }}>${imp.usd ?? "0"}</td>
                      <td style={{ color:C.muted }}>{fmtTime(imp.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* UTM Source Breakdown */}
        {Object.keys(utmBreakdown).length > 0 && (
          <Card style={{ marginBottom:20 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <SectionTitle>Signups by Source</SectionTitle>
              <span style={{ fontSize:10, color:C.muted }}>First-touch attribution</span>
            </div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr>
                  <th>Source</th><th>Medium</th><th>Campaign</th><th>Signups</th><th>Share</th>
                </tr></thead>
                <tbody>
                  {utmBreakdown.map((row, i) => {
                    const maxCount = utmBreakdown[0]?.count || 1
                    const pct = Math.round((row.count / maxCount) * 100)
                    return (
                      <tr key={i}>
                        <td style={{ color:C.cyan, fontWeight:700 }}>{row.utm_source || <span style={{color:C.muted}}>direct</span>}</td>
                        <td style={{ color:C.text }}>{row.utm_medium || <span style={{color:C.muted}}>—</span>}</td>
                        <td style={{ color:C.text, fontSize:11 }}>{row.utm_campaign || <span style={{color:C.muted}}>—</span>}</td>
                        <td style={{ fontFamily:"'DM Mono',monospace", fontWeight:700, color:C.white }}>{row.count}</td>
                        <td style={{ width:120 }}>
                          <div style={{ height:5, background:"rgba(255,255,255,0.07)", borderRadius:99, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${C.cyan},${C.purple})`, borderRadius:99 }}/>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Users Table */}
        <Card style={{ marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:10 }}>
            <SectionTitle>Real Users ({filtered.length} of {users.length} — test accounts excluded)</SectionTitle>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <input
                placeholder="Search email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width:180 }}
              />
              <select value={filterOnboarding} onChange={e => setFilterOnboarding(e.target.value)}>
                <option value="all">All Onboarding</option>
                {Object.entries(ONBOARDING).map(([k,{label}]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <select value={filterDashboard} onChange={e => setFilterDashboard(e.target.value)}>
                <option value="all">All Dashboard Stages</option>
                {Object.entries(DASHBOARD).map(([k,{label}]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="createdAt">Sort: Newest</option>
                <option value="tipCount">Sort: Most Tips</option>
                <option value="totalUsd">Sort: Most USD</option>
                <option value="lastActivity">Sort: Last Active</option>
              </select>
            </div>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:900 }}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Signed Up</th>
                  <th>Onboarding</th>
                  <th>Dashboard Stage</th>
                  <th>Imports</th>
                  <th>Tips</th>
                  <th>Total USD</th>
                  <th>Platforms</th>
                  <th>Sub</th>
                  <th>Last Active</th>
                  <th>Live</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={11} style={{ textAlign:"center", color:C.muted, padding:24 }}>No users match filters</td></tr>
                )}
                {filtered.map(u => {
                  const ob = ONBOARDING[u.onboardingStage] || { label: u.onboardingStage, color: C.muted }
                  const db = DASHBOARD[u.dashboardStage]   || { label: u.dashboardStage,  color: C.muted }
                  return (
                    <tr key={u.id}>
                      <td style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:C.cyan, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {u.email || "—"}
                      </td>
                      <td style={{ color:C.muted, whiteSpace:"nowrap" }}>{fmt(u.createdAt)}</td>
                      <td>{pill(ob.label, ob.color)}</td>
                      <td>{pill(db.label, db.color)}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace", textAlign:"center" }}>{u.uploadCount}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace", textAlign:"center" }}>{u.tipCount}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace", color:C.gold }}>{u.totalUsd > 0 ? `$${u.totalUsd.toFixed(0)}` : "—"}</td>
                      <td style={{ fontSize:11, color:C.muted }}>
                        {u.platforms?.length ? u.platforms.join(", ") : "—"}
                      </td>
                      <td>
                        {u.subStatus !== "free"
                          ? pill(u.subStatus, SUB_COLORS[u.subStatus] || C.muted)
                          : <span style={{ color:C.muted, fontSize:11 }}>free</span>}
                      </td>
                      <td style={{ color:C.muted, whiteSpace:"nowrap" }}>{fmtTime(u.lastActivity)}</td>
                      <td style={{ textAlign:"center" }}>
                        {u.liveActive ? <span style={{ color:C.pink, fontSize:14 }}>●</span> : <span style={{ color:"rgba(255,255,255,0.15)" }}>○</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent Feedback */}
        {feedback?.length > 0 && (
          <Card>
            <SectionTitle>Recent Feedback ({feedback.length})</SectionTitle>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {feedback.map((f, i) => (
                <div key={i} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"10px 14px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:10, color:C.muted }}>{f.page_url || "unknown page"}</span>
                    <span style={{ fontSize:10, color:C.muted }}>{fmtTime(f.created_at)}</span>
                  </div>
                  <div style={{ fontSize:12, color:C.text }}>{f.message}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

      </div>
    </div>
  )
}
