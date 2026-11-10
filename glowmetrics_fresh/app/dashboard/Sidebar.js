"use client"
import { useState } from "react"
import Button from "../../components/ui/Button"
import TimezoneSelect from "../../components/TimezoneSelect"
import { timeZoneLabel } from "../../lib/creatorTimezone"
import { track } from "../../lib/track"

const C = {
  bg: "#05070f", card: "#0d1322", border: "#1e2d45",
  cyan: "#22D3EE", pink: "#EC4899", gold: "#F59E0B",
  green: "#10B981", white: "#F1F5F9", muted: "#475569", text: "#94A3B8",
  purple: "#a855f7"
}

const NAV = [
  {
    group: null,
    items: [{ id: "overview", icon: "⚡", label: "Command Center" }]
  },
  {
    group: "FANS",
    items: [{ id: "whales", icon: "👑", label: "Top Fans" }]
  },
  {
    group: "SESSIONS",
    items: [
      { id: "sessions", icon: "🎥", label: "Free Chat Sessions" },
      { id: "live",     icon: "🔴", label: "Live Mode Sessions" },
    ]
  },
  {
    group: "ANALYTICS",
    items: [
      { id: "platforms", icon: "🎯", label: "Platforms" },
      { id: "monthly",   icon: "📈", label: "Monthly" },
    ]
  },
  {
    group: "TOOLS",
    items: [
      { id: "titles",    icon: "🎬", label: "Room Titles" },
      { id: "calc",      icon: "🪙", label: "Token Calc"  },
      { id: "data",      icon: "📝", label: "Edit Data" },
      { id: "analytics", icon: "📊", label: "Analytics" },
      { id: "planner",   icon: "🗓️", label: "Stream Planner" },
      { id: "moneymap",  icon: "🗺️", label: "Money Map" },
    ]
  },
  {
    group: "SUPPORT",
    items: [
      { id: "upload", icon: "📥", label: "Import CSV" },
      { id: "help",   icon: "❓", label: "CSV Help" },
    ]
  },
]

// Compact creator-timezone row under the plan badge. The saved
// profiles.timezone is the dashboard's single clock; changing it here saves
// it and re-runs analytics. A failed save keeps the old value and shows a
// retryable inline error.
function CreatorTimezoneRow({ tz, onChange }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const pick = async (next) => {
    if (next === tz) { setEditing(false); return }
    setSaving(true); setError("")
    const res = await onChange(next)
    setSaving(false)
    if (res?.error) setError("Couldn't save your timezone. Try again.")
    else setEditing(false)
  }
  return (
    <div data-testid="sidebar-timezone" style={{ marginBottom: 8, padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 11 }}>
        <span title={tz} style={{ color: "#7d8aa3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          Timezone · <span style={{ color: C.text, fontWeight: 600 }}>{timeZoneLabel(tz)}</span>
        </span>
        <button onClick={() => { setEditing(e => !e); setError("") }} disabled={saving}
          style={{ flexShrink: 0, background: "none", border: "none", padding: 0, fontSize: 11, fontWeight: 700, color: C.cyan, cursor: saving ? "wait" : "pointer" }}>
          {saving ? "Saving…" : editing ? "Cancel" : "Change"}
        </button>
      </div>
      {editing && <div style={{ marginTop: 6 }}><TimezoneSelect value={tz} onPick={pick} fontSize={11} /></div>}
      {error && <div role="alert" style={{ marginTop: 4, fontSize: 10.5, color: "#F87171" }}>{error}</div>}
    </div>
  )
}

export default function Sidebar({ activeTab, onTabChange, user, onSignOut, isPro = false, creatorTz = null, onChangeTimezone = null }) {
  const [hoveredId, setHoveredId] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  const renderItem = (id, icon, label) => {
    const isActive  = activeTab === id
    const isHovered = hoveredId === id
    return (
      <button key={id}
        onClick={() => { onTabChange(id); setMobileOpen(false) }}
        onMouseEnter={() => setHoveredId(id)}
        onMouseLeave={() => setHoveredId(null)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer",
          background: isActive
            ? "linear-gradient(135deg,rgba(34,211,238,0.14),rgba(124,92,255,0.08))"
            : isHovered ? "rgba(255,255,255,0.05)" : "transparent",
          borderLeft: isActive ? "2px solid #22D3EE" : "2px solid transparent",
          transition: "all 0.15s", marginBottom: 2,
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0, opacity: isActive ? 1 : 0.7 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? C.white : C.text, letterSpacing: -0.2 }}>
          {label}
        </span>
        {isActive && (
          <div style={{ marginLeft: "auto", width: 5, height: 5, borderRadius: "50%", background: C.cyan, boxShadow: "0 0 5px #22D3EE" }} />
        )}
      </button>
    )
  }

  const sidebarContent = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "18px 12px" }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 4px", marginBottom: 22 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#22D3EE,#EC4899)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900, color: "white", boxShadow: "0 0 14px rgba(34,211,238,0.3)", flexShrink: 0 }}>$</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.white, letterSpacing: -0.4 }}>
            Cam<span style={{ background: "linear-gradient(90deg,#22D3EE,#EC4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Cash</span>
          </div>
          <div style={{ fontSize: 9, color: "#7d8aa3", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 1 }}>Creator Intelligence</div>
        </div>
      </div>

      {/* Nav groups */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {NAV.map((group, gi) => (
          <div key={gi} style={{ marginBottom: group.group ? 12 : 5 }}>
            {group.group && (
              <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7488", letterSpacing: 1, textTransform: "uppercase", padding: "0 12px", marginBottom: 4 }}>
                {group.group}
              </div>
            )}
            {group.items.map(({ id, icon, label }) => renderItem(id, icon, label))}
          </div>
        ))}

        {/* Studio is a separate route (app/studio/page.js), not a dashboard
            tab, so it's a plain link rather than an onTabChange button. */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7488", letterSpacing: 1, textTransform: "uppercase", padding: "0 12px", marginBottom: 4 }}>
            STUDIO
          </div>
          <a href="/studio"
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", borderRadius: 10, textDecoration: "none",
              marginBottom: 2,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ fontSize: 16, flexShrink: 0, opacity: 0.7 }}>🏢</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.text, letterSpacing: -0.2 }}>Studio</span>
          </a>
        </div>
      </div>

      {/* Upgrade CTA — always visible, but the Pro state stays low-key since it's a status, not a call to action */}
      {isPro ? (
        <button data-testid="subscription-badge" onClick={() => { track('subscription_badge_clicked', { plan_state: 'pro_active' }); onTabChange('subscription') }} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", borderRadius: 9, background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.2)", marginBottom: 8, fontSize: 11.5, fontWeight: 700, color: C.purple, cursor: "pointer", width: "100%", transition: "all 0.15s" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(168,85,247,0.14)"; e.currentTarget.style.borderColor = "rgba(168,85,247,0.4)" }} onMouseLeave={e => { e.currentTarget.style.background = "rgba(168,85,247,0.07)"; e.currentTarget.style.borderColor = "rgba(168,85,247,0.2)" }}>
          <span>✦</span>
          <span>Pro plan active</span>
        </button>
      ) : (
        <Button as="a" href="/pricing" data-testid="sidebar-upgrade" onClick={() => track('upgrade_to_pro_clicked', { source: 'sidebar' })} style={{ width: "100%", marginBottom: 8, fontSize: 13, padding: "11px 12px", textAlign: "center" }}>
          ✦ Upgrade to Pro
        </Button>
      )}

      {creatorTz && onChangeTimezone && <CreatorTimezoneRow tz={creatorTz} onChange={onChangeTimezone} />}

      {/* User footer — email + sign out share one compact row */}
      {user && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10, marginTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div title={user.email} style={{ fontSize: 11, color: "#7d8aa3", padding: "0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {user.email}
          </div>
          <button onClick={onSignOut}
            style={{ flexShrink: 0, padding: "5px 8px", borderRadius: 8, background: "transparent", border: "none", color: "#F87171", fontSize: 11.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "background 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(248,113,113,0.1)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <span>→</span> Sign Out
          </button>
        </div>
      )}
    </div>
  )

  return (
    <>
      <aside style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 240, background: "rgba(6,9,20,0.97)", borderRight: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(20px)", zIndex: 50 }}
        className="sidebar-desktop">
        {sidebarContent}
      </aside>

      <button onClick={() => setMobileOpen(o => !o)}
        className="sidebar-mobile-btn"
        style={{ position: "fixed", top: 14, left: 14, zIndex: 200, width: 36, height: 36, borderRadius: 10, background: "rgba(6,9,20,0.95)", border: "1px solid rgba(255,255,255,0.1)", color: C.white, fontSize: 18, cursor: "pointer", display: "none", alignItems: "center", justifyContent: "center" }}>
        ☰
      </button>

      {mobileOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100 }}>
          <div onClick={() => setMobileOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
          <aside style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 240, background: "rgba(6,9,20,0.99)", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}>
            {sidebarContent}
          </aside>
        </div>
      )}

      <style jsx>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile-btn { display: flex !important; }
        }
      `}</style>
    </>
  )
}
