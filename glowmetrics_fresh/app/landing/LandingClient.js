"use client"
import { useState, useEffect, useRef, Fragment } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { DM_Sans } from "next/font/google"
import { T as TrackEvents, captureAttribution } from "../../lib/tracking"
import { track } from "../../lib/track"
// NEW (marketing visual only) — see components/landing/*.js. Safe to remove:
// deleting this import + the <FloatingDashboardPreview>/<PlatformsTypewriter>
// block below fully reverts this addition.
import FloatingDashboardPreview from "../../components/landing/FloatingDashboardPreview"
import PlatformsTypewriter from "../../components/landing/PlatformsTypewriter"

// Supabase (and its ~85KB of JS) is only needed once a visitor checks their
// auth state or touches the signup/login form — not for the initial paint.
// Dynamic import splits it into its own chunk instead of the homepage bundle.
let supabasePromise
function getSupabase() {
  if (!supabasePromise) supabasePromise = import("../../lib/supabase").then(m => m.supabase)
  return supabasePromise
}

// Self-hosted (was a render-blocking `@import url(fonts.googleapis.com/...)`
// in the <style jsx> block below — same weights that @import requested).
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

// Only needed once a visitor scrolls this far — deferred so its JS isn't
// downloaded/parsed on every /landing visit.
const FeedbackWidget = dynamic(() => import('../components/FeedbackWidget'), { ssr: false })

// ── CAMCASH BRAND TOKENS (exact values from /mnt/skills/user/branding) ────
const T = {
  cyan: "#16F4FF",
  cyanSoft: "#48E9FF",
  purple: "#7C5CFF",
  pink: "#FF2BAE",
  magenta: "#D83DFF",
  blue: "#248BFF",
  gold: "#FFC857",

  bgMain: "#050713",
  bgPanel: "#080B1A",
  bgCard: "rgba(10, 14, 32, 0.82)",
  bgCardSoft: "rgba(16, 20, 42, 0.72)",
  bgInput: "rgba(5, 9, 24, 0.72)",

  textMain: "#FFFFFF",
  textSoft: "#D7D9EA",
  textMuted: "#8D93AA",
  textFaint: "#5E647C",

  green: "#10B981",
  red: "#f87171",

  gradientPrimary: "linear-gradient(90deg, #16F4FF 0%, #55B8FF 28%, #7C5CFF 52%, #FF2BAE 100%)",
  panelBorderGradient: "linear-gradient(135deg, rgba(22,244,255,0.95), rgba(124,92,255,0.45), rgba(255,43,174,0.95))",
}

// ── Password validation feedback — mirrors app/landing/LandingClient.js so
//    the signup UX (and onboarding funnel behind it) is identical everywhere.
const PASSWORD_REQUIREMENTS = [
  { label: "8+ characters", test: pw => pw.length >= 8 },
  { label: "Uppercase letter", test: pw => /[A-Z]/.test(pw) },
  { label: "Lowercase letter", test: pw => /[a-z]/.test(pw) },
  { label: "Number", test: pw => /[0-9]/.test(pw) },
  { label: "Symbol", test: pw => /[^A-Za-z0-9]/.test(pw) },
]

const PASSWORD_ERROR_PATTERN = /password should be at least|password should contain/i
const FRIENDLY_PASSWORD_ERROR = "Password must include 8+ characters, uppercase, lowercase, a number, and a symbol."

function friendlyAuthError(message) {
  if (!message) return message
  return PASSWORD_ERROR_PATTERN.test(message) ? FRIENDLY_PASSWORD_ERROR : message
}

function PasswordChecklist({ password }) {
  const touched = password.length > 0
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px", margin: "6px 0 10px", padding: "0 1px" }}>
      {PASSWORD_REQUIREMENTS.map(({ label, test }) => {
        const met = test(password)
        const color = met ? T.cyan : touched ? "rgba(251,113,133,0.85)" : T.textFaint
        return (
          <span key={label} style={{ fontSize: 11, lineHeight: 1.6, color, display: "inline-flex", alignItems: "center", gap: 5, transition: "color 0.2s ease" }}>
            <span style={{ fontSize: 8 }}>{met ? "●" : "○"}</span>
            {label}
          </span>
        )
      })}
    </div>
  )
}

// ── AuthPanel defined OUTSIDE LandingPage so React doesn't re-create the
//    component type on every render (prevents input losing focus)
function AuthPanel({
  id, isSignUp, setIsSignUp,
  email, setEmail,
  password, setPassword,
  authLoading, authMsg, authError,
  setAuthError, setAuthMsg,
  handleAuth, handleForgotPassword,
  pendingPlan,
}) {
  const [showPassword, setShowPassword] = useState(false)

  const inputStyle = {
    width: "100%", padding: "11px 14px", borderRadius: 12,
    background: T.bgInput,
    border: "1px solid rgba(255,255,255,0.10)",
    color: "white", fontSize: 14, outline: "none", marginBottom: 10,
    boxSizing: "border-box",
    transition: "border-color 0.15s, box-shadow 0.15s",
  }

  return (
    <div className="camcash-panel-shell" style={{
      borderRadius: 28,
      padding: 1,
      background: T.panelBorderGradient,
      boxShadow: "-20px 0 60px rgba(22,244,255,0.16), 20px 0 60px rgba(255,43,174,0.18), 0 24px 70px rgba(0,0,0,0.55)",
      width: "100%",
    }}>
      <div id={id} style={{
        borderRadius: 27,
        background: `radial-gradient(circle at 0% 10%, rgba(22,244,255,0.10), transparent 40%), radial-gradient(circle at 100% 30%, rgba(255,43,174,0.10), transparent 42%), ${T.bgCard}`,
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "28px 24px",
        backdropFilter: "blur(24px)",
        width: "100%",
        boxSizing: "border-box",
      }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 38, height: 38, borderRadius: 11,
            background: T.gradientPrimary,
            fontSize: 18, fontWeight: 900, color: "#06101A", marginBottom: 10,
            boxShadow: "0 0 20px rgba(22,244,255,0.3), 0 0 22px rgba(255,43,174,0.24)",
          }}>$</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "white", letterSpacing: -0.3 }}>CamCash™</div>
          <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>
            {isSignUp ? "Starts with a 7-day free trial" : "Welcome back 💋"}
          </div>
          {pendingPlan && (
            <div style={{ fontSize: 12, color: T.cyanSoft, marginTop: 8 }}>
              {isSignUp ? "Sign up" : "Log in"} to continue to checkout
            </div>
          )}
        </div>

        <div style={{
          display: "flex", borderRadius: 10, overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)", marginBottom: 18,
          background: "rgba(255,255,255,0.03)",
        }}>
          {[["Sign Up", true], ["Log In", false]].map(([label, val]) => (
            <button key={label} type="button"
              onClick={() => { setIsSignUp(val); setAuthError(""); setAuthMsg("") }}
              style={{
                flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 700,
                background: isSignUp === val ? "rgba(22,244,255,0.12)" : "transparent",
                color: isSignUp === val ? T.cyanSoft : "rgba(255,255,255,0.3)",
                border: "none", cursor: "pointer", transition: "all 0.2s",
              }}>
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleAuth}>
          <input type="email" placeholder="Email address" required
            value={email} onChange={e => setEmail(e.target.value)} style={inputStyle}
            onFocus={e => { e.target.style.borderColor = "rgba(22,244,255,0.6)"; e.target.style.boxShadow = "0 0 0 3px rgba(22,244,255,0.10)"; TrackEvents.signupFormFocused(window?.location?.pathname) }}
            onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,0.10)"; e.target.style.boxShadow = "none" }}
          />
          <div style={{ position: "relative" }}>
            <input type={showPassword ? "text" : "password"} placeholder={isSignUp ? "Create a password" : "Password"} required
              value={password} onChange={e => setPassword(e.target.value)}
              style={{ ...inputStyle, marginBottom: isSignUp ? 4 : 0, paddingRight: 42 }}
              onFocus={e => { e.target.style.borderColor = "rgba(22,244,255,0.6)"; e.target.style.boxShadow = "0 0 0 3px rgba(22,244,255,0.10)" }}
              onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,0.10)"; e.target.style.boxShadow = "none" }}
            />
            <button type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex={-1}
              style={{
                position: "absolute", right: 6, top: 0,
                height: isSignUp ? 44 : 40,
                width: 32, display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", cursor: "pointer",
                color: T.textMuted,
              }}>
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
          {isSignUp && <PasswordChecklist password={password} />}

          {!isSignUp && (
            <div style={{ textAlign: "right", marginBottom: 12 }}>
              <a href="/forgot-password"
                style={{ fontSize: 12, color: T.textMuted, display: "block", textDecoration: "none" }}>
                Forgot your password?
              </a>
            </div>
          )}
          {authError && <div style={{ fontSize: 12, color: T.red, marginBottom: 10, textAlign: "center" }}>{authError}</div>}
          {authMsg   && <div style={{ fontSize: 12, color: T.cyanSoft,  marginBottom: 10, textAlign: "center" }}>{authMsg}</div>}

          <button type="submit" disabled={authLoading} onClick={() => isSignUp && TrackEvents.signupCtaClicked(window?.location?.pathname)} style={{
            width: "100%", padding: "13px 0", borderRadius: 12,
            background: authLoading
              ? "rgba(22,244,255,0.2)"
              : T.gradientPrimary,
            color: "#06101A", fontWeight: 800, fontSize: 15, border: "none",
            cursor: authLoading ? "not-allowed" : "pointer",
            boxShadow: authLoading ? "none" : "0 0 24px rgba(22,244,255,0.28), 0 0 30px rgba(255,43,174,0.24)",
            transition: "all 0.2s", letterSpacing: 0.2,
          }}>
            {authLoading
              ? (isSignUp ? "Creating account…" : "Logging in…")
              : (isSignUp ? "Start Free →" : "Log In →")}
          </button>
        </form>

        {isSignUp && (
          <p style={{ fontSize: 11, color: T.textFaint, textAlign: "center", marginTop: 12, marginBottom: 0 }}>
            7-day free trial · Cancel anytime
          </p>
        )}
      </div>
    </div>
  )
}

// ── LIVE DEMO PANEL — cycles through 3 states ──────────────────────────────
const DEMO_STATES = [
  {
    state: "before",
    label: "BEFORE STREAM",
    labelColor: T.cyan,
    headline: "Best Move Right Now",
    command: "Go live on Chaturbate in 42m",
    items: [
      { icon: "💰", text: "Expected earnings", value: "$90–$180", color: T.green },
      { icon: "🐳", text: "Whales likely online", value: "2 VIPs", color: T.gold },
      { icon: "🎯", text: "Best platform tonight", value: "Chaturbate", color: T.cyan },
      { icon: "⏰", text: "Your peak window", value: "1 AM UTC", color: T.purple },
    ],
  },
  {
    state: "during",
    label: "DURING STREAM",
    labelColor: T.green,
    headline: "Live Session Monitor",
    command: "Revenue velocity climbing",
    items: [
      { icon: "📈", text: "Revenue velocity", value: "+18%", color: T.green },
      { icon: "🔁", text: "Returning tippers", value: "rising", color: T.cyan },
      { icon: "⚠️", text: "Viewer conversion", value: "dropping", color: T.gold },
      { icon: "💡", text: "Try higher interaction", value: "prompts", color: T.purple },
    ],
  },
  {
    state: "after",
    label: "AFTER STREAM",
    labelColor: T.pink,
    headline: "Session Review Ready",
    command: "You beat your Tuesday avg by 21%",
    items: [
      { icon: "🏆", text: "vs your avg session", value: "+21%", color: T.green },
      { icon: "⏱️", text: "Best hour discovered", value: "1 AM", color: T.cyan },
      { icon: "🎯", text: "Highest ROI platform", value: "CB", color: T.gold },
      { icon: "💌", text: "Fans to re-engage", value: "3 fans", color: T.pink },
    ],
  },
]

function LiveDemoPanel() {
  const [stateIdx, setStateIdx] = useState(0)
  const [tick, setTick] = useState(0)
  const [transitioning, setTransitioning] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setTransitioning(true)
      setTimeout(() => {
        setStateIdx(i => (i + 1) % DEMO_STATES.length)
        setTick(t => t + 1)
        setTransitioning(false)
      }, 300)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  // Fake mini bar chart data
  const bars = [40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88]
  const demo = DEMO_STATES[stateIdx]

  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  return (
    <div className="camcash-panel-shell" style={{
      borderRadius: 20,
      padding: 1,
      background: T.panelBorderGradient,
      boxShadow: "-18px 0 60px rgba(22,244,255,0.14), 18px 0 60px rgba(255,43,174,0.16), 0 24px 70px rgba(0,0,0,0.55)",
    }}>
      <div style={{
        borderRadius: 19,
        background: T.bgCard,
        backdropFilter: "blur(20px)",
        overflow: "hidden",
      }}>
        {/* Window chrome */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.02)" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.red, opacity: 0.7 }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.gold, opacity: 0.7 }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.green, opacity: 0.7 }} />
          <div style={{ flex: 1, textAlign: "center", fontSize: 10, color: T.textFaint, fontFamily: "monospace" }}>camcashgrl.com/dashboard</div>
          <div style={{ fontSize: 10, color: T.textFaint }}>{timeStr}</div>
        </div>

        {/* State indicator tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {DEMO_STATES.map((s, i) => (
            <button key={i} onClick={() => { setTransitioning(true); setTimeout(() => { setStateIdx(i); setTransitioning(false) }, 200) }}
              style={{
                flex: 1, padding: "7px 4px", fontSize: 9, fontWeight: 800, letterSpacing: 0.8,
                background: i === stateIdx ? `${s.labelColor}18` : "transparent",
                borderBottom: i === stateIdx ? `2px solid ${s.labelColor}` : "2px solid transparent",
                color: i === stateIdx ? s.labelColor : T.textFaint,
                border: "none", cursor: "pointer", transition: "all 0.2s", textTransform: "uppercase",
              }}>{s.label}</button>
          ))}
        </div>

        <div style={{ padding: "18px 18px 16px", opacity: transitioning ? 0 : 1, transition: "opacity 0.25s" }}>
          {/* Live badge + headline */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: demo.labelColor, boxShadow: `0 0 6px ${demo.labelColor}`, animation: "lp-pulse 2s infinite" }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: demo.labelColor, textTransform: "uppercase", letterSpacing: 0.8 }}>AI Command</span>
            </div>
            <span style={{ fontSize: 9, color: T.textFaint, fontFamily: "monospace" }}>Updated {timeStr}</span>
          </div>

          {/* Main command */}
          <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: `${demo.labelColor}12`, border: `1px solid ${demo.labelColor}30` }}>
            <div style={{ fontSize: 9, color: demo.labelColor, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>{demo.headline}</div>
            <div style={{ fontSize: 15, fontWeight: 850, color: "white", lineHeight: 1.3 }}>{demo.command}</div>
          </div>

          {/* Data rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {demo.items.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 10, background: "rgba(255,255,255,0.025)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, color: T.textMuted }}>{item.text}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: item.color }}>{item.value}</span>
              </div>
            ))}
          </div>

          {/* Mini bar chart */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 9, color: T.textFaint, marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Earnings by hour</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 32 }}>
              {bars.map((h, i) => (
                <div key={i} style={{
                  flex: 1, borderRadius: "2px 2px 0 0",
                  height: `${h}%`,
                  background: i === 10
                    ? `linear-gradient(180deg, ${T.cyan}, ${T.cyan}80)`
                    : "rgba(255,255,255,0.07)",
                  transition: "height 0.4s ease",
                }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 8, color: T.textFaint }}>
              <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>Now</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── DASHBOARD SHOWCASE — animates in (count-up stats, drawn-in line chart,
//    filling platform bars) the first time it scrolls into view ───────────
const LP_DASH_STATS = [
  { label: "Total earnings", target: 12842, prefix: "$", delta: "+18.6%" },
  { label: "Tips received",  target: 6231,  prefix: "",  delta: "+22.4%" },
  { label: "Transactions",   target: 3421,  prefix: "",  delta: "+14.3%" },
  { label: "Avg. per hour",  target: 146,   prefix: "$", delta: "+16.7%" },
]

const LP_DASH_PLATFORMS = [
  { name: "BongaCams",  value: "$6,124", pct: 47.6, color: T.pink },
  { name: "Chaturbate", value: "$4,231", pct: 32.9, color: T.cyan },
  { name: "MFC",        value: "$2,487", pct: 19.5, color: T.purple },
]

function useInViewOnce(threshold = 0.25) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); io.disconnect() }
    }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [inView, threshold])
  return [ref, inView]
}

function useCountUp(target, active, duration = 1300) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!active) return
    let raf
    const startTime = performance.now()
    const step = now => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(target * eased))
      if (progress < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [active, target, duration])
  return value
}

function DashStatCard({ label, target, prefix, delta, active, delay }) {
  const value = useCountUp(target, active)
  return (
    <div style={{
      background: "rgba(13,17,38,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 14,
      opacity: active ? 1 : 0, transform: active ? "translateY(0)" : "translateY(8px)",
      transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
    }}>
      <div style={{ fontSize: 10.5, color: T.textFaint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 850, color: "white", marginBottom: 4 }}>{prefix}{value.toLocaleString()}</div>
      <div style={{ fontSize: 10.5, color: T.green, fontWeight: 700 }}>{delta} vs last 7 days</div>
    </div>
  )
}

function DashLineChart({ active }) {
  const pathRef = useRef(null)
  const [length, setLength] = useState(0)
  useEffect(() => {
    if (pathRef.current) setLength(pathRef.current.getTotalLength())
  }, [])
  return (
    <svg viewBox="0 0 300 90" width="100%" height="80" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lpLineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={T.cyan} />
          <stop offset="55%" stopColor={T.purple} />
          <stop offset="100%" stopColor={T.pink} />
        </linearGradient>
      </defs>
      <path
        ref={pathRef}
        d="M0,60 C20,50 35,70 50,55 C65,40 80,65 100,45 C120,25 140,55 160,35 C180,15 200,50 220,30 C240,10 260,40 280,20 C290,10 295,15 300,10"
        fill="none" stroke="url(#lpLineGrad)" strokeWidth="2.5"
        style={{
          strokeDasharray: length || 1,
          strokeDashoffset: active ? 0 : length,
          transition: "stroke-dashoffset 1.6s cubic-bezier(0.4,0,0.2,1)",
        }}
      />
      {length > 0 && (
        <circle cx="300" cy="10" r="4" fill={T.pink} style={{
          opacity: active ? 1 : 0,
          transition: "opacity 0.4s ease 1.5s",
          animation: active ? "lp-pulse 2s infinite" : "none",
        }} />
      )}
    </svg>
  )
}

function DashPlatformBar({ name, value, pct, color, active, delay }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 5, color: T.textSoft }}>
        <span>{name}</span><span style={{ color: T.textMuted }}>{value}</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{
          height: "100%", width: active ? `${pct}%` : "0%", borderRadius: 999, background: color,
          transition: `width 1s cubic-bezier(0.4,0,0.2,1) ${delay}ms`,
        }} />
      </div>
    </div>
  )
}

function DashboardShowcasePanel() {
  const [ref, inView] = useInViewOnce(0.25)
  return (
    <div ref={ref} className="camcash-panel-shell" style={{ borderRadius: 24, padding: 1, background: T.panelBorderGradient, boxShadow: "-18px 0 60px rgba(22,244,255,0.14), 18px 0 60px rgba(255,43,174,0.16), 0 24px 70px rgba(0,0,0,0.5)" }}>
      <div style={{ borderRadius: 23, background: T.bgPanel, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: T.gradientPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: "#06101A" }}>$</div>
            <span style={{ fontSize: 14, fontWeight: 800, color: "white" }}>Cam<span style={{ background: T.gradientPrimary, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Cash</span></span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <div style={{ fontSize: 11, padding: "6px 10px", borderRadius: 8, background: "rgba(22,244,255,0.1)", color: T.cyanSoft, fontWeight: 700 }}>Overview</div>
            <div style={{ fontSize: 11, padding: "6px 10px", borderRadius: 8, color: T.textFaint, fontWeight: 700 }}>Best hours</div>
            <div style={{ fontSize: 11, padding: "6px 10px", borderRadius: 8, color: T.textFaint, fontWeight: 700 }}>Top spenders</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          {LP_DASH_STATS.map((s, i) => (
            <DashStatCard key={s.label} {...s} active={inView} delay={i * 90} />
          ))}
        </div>

        <div className="lp-dash-charts" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
          <div style={{ background: "rgba(13,17,38,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 14, height: 150 }}>
            <div style={{ fontSize: 10.5, color: T.textFaint, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Earnings over time</div>
            <DashLineChart active={inView} />
          </div>
          <div style={{ background: "rgba(13,17,38,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 10.5, color: T.textFaint, fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>Earnings by platform</div>
            {LP_DASH_PLATFORMS.map((p, i) => (
              <DashPlatformBar key={p.name} {...p} active={inView} delay={400 + i * 150} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── DEMO PREVIEW GRID — mini interactive cards for features not covered
//    by the Live Demo widget or the Message Generator Preview section ───────
const LP_PLATFORMS = [
  { name: "Chaturbate",  rate: "$61/hr", pct: 100, color: T.cyan },
  { name: "BongaCams",   rate: "$38/hr", pct: 62,  color: T.pink },
  { name: "MyFreeCams",  rate: "$28/hr", pct: 46,  color: T.gold },
]

const LP_SESSIONS = [
  { day: "Mon", usd: 210 }, { day: "Tue", usd: 95 },  { day: "Wed", usd: 340 },
  { day: "Thu", usd: 610 }, { day: "Fri", usd: 180 }, { day: "Sat", usd: 520 }, { day: "Sun", usd: 140 },
]

const LP_MONEYMAP_SLOTS = ["12–6am", "6am–12pm", "12–6pm", "6pm–12am"]
const LP_MONEYMAP_DAYS  = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const LP_MONEYMAP_GRID  = [
  [0, 0, 2, 18], [0, 0, 3, 22], [0, 0, 2, 16], [0, 0, 4, 28],
  [0, 0, 5, 62], [0, 0, 3, 34], [0, 0, 6, 38],
]

const LP_PLAN = [
  { day: "Thursday", window: "9–11 PM", rate: "$62/hr", tag: "Top Pick" },
  { day: "Saturday", window: "8–11 PM", rate: "$41/hr", tag: "Peak"     },
  { day: "Monday",   window: "9–10 PM", rate: "$29/hr", tag: "Steady"   },
]

const LP_TITLES = {
  Tease:     (g) => [`let's see how far you take me 💦 hit ${g} → full control`, `I'm not giving it up that easy 😏 ${g} tokens and you decide`],
  Hype:      (g) => [`WE ARE SO CLOSE 🔥 ${g} tokens and this room explodes`, `the energy in here is insane — push to ${g} 💥`],
  Mystery:   (g) => [`you won't believe what happens at ${g} 👀 tip to find out`, `something big is coming… ${g} unlocks it 🎁`],
}

function DemoMiniCard({ icon, title, sub, children }) {
  return (
    <div style={{ padding: "20px 18px", borderRadius: 18, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 17 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>{title}</div>
          <div style={{ fontSize: 11, color: T.textFaint }}>{sub}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

function PlatformCompareMini() {
  return (
    <DemoMiniCard icon="🎯" title="Platform Comparison" sub="See where your time is worth more">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {LP_PLATFORMS.map(p => (
          <div key={p.name}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 4, color: T.textSoft }}>
              <span>{p.name}</span><span style={{ color: p.color, fontWeight: 700 }}>{p.rate}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${p.pct}%`, borderRadius: 999, background: p.color }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: T.textFaint }}>Chaturbate earns <strong style={{ color: T.cyanSoft }}>2.2x more</strong> per hour than MyFreeCams here.</div>
    </DemoMiniCard>
  )
}

function SessionsMini() {
  const max = Math.max(...LP_SESSIONS.map(s => s.usd))
  return (
    <DemoMiniCard icon="🎥" title="Sessions Breakdown" sub="Every session, timed and totaled">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70 }}>
        {LP_SESSIONS.map(s => (
          <div key={s.day} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: 54, display: "flex", alignItems: "flex-end" }}>
              <div style={{ width: "100%", borderRadius: "3px 3px 0 0", height: `${(s.usd / max) * 100}%`, background: s.usd === max ? T.cyan : "rgba(22,244,255,0.18)" }} />
            </div>
            <div style={{ fontSize: 9, color: T.textFaint, marginTop: 4 }}>{s.day}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: T.textFaint }}>Thursday's session earned <strong style={{ color: T.cyanSoft }}>${max}</strong> — your best of the week.</div>
    </DemoMiniCard>
  )
}

function MoneyMapMini() {
  const maxVal = Math.max(...LP_MONEYMAP_GRID.flat())
  return (
    <DemoMiniCard icon="🗺️" title="Money Map" sub="Exactly when your earnings land">
      <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${LP_MONEYMAP_SLOTS.length},1fr)`, gap: 3 }}>
        <div />
        {LP_MONEYMAP_SLOTS.map(s => <div key={s} style={{ fontSize: 7, color: T.textFaint, textAlign: "center" }}>{s.split("–")[0]}</div>)}
        {LP_MONEYMAP_DAYS.map((day, d) => (
          <Fragment key={day}>
            <div style={{ fontSize: 9, color: T.textFaint, display: "flex", alignItems: "center" }}>{day}</div>
            {LP_MONEYMAP_SLOTS.map((s, i) => {
              const val = LP_MONEYMAP_GRID[d][i]
              const t = val ? val / maxVal : 0
              return <div key={s} title={`${day} ${s}: $${val}`} style={{ height: 12, borderRadius: 3, background: val ? `rgba(22,244,255,${(0.12 + t * 0.75).toFixed(2)})` : "rgba(255,255,255,0.04)" }} />
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: T.textFaint }}>Hottest window: <strong style={{ color: T.cyanSoft }}>Thursday, 6pm–12am</strong>.</div>
    </DemoMiniCard>
  )
}

function StreamingPlanMini() {
  return (
    <DemoMiniCard icon="📅" title="Streaming Plan" sub="Your personalized weekly schedule">
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {LP_PLAN.map(row => (
          <div key={row.day} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 9, background: "rgba(255,255,255,0.03)" }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSoft }}>{row.day}</div>
              <div style={{ fontSize: 10, color: T.textFaint }}>{row.window}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: T.cyanSoft }}>{row.rate}</div>
              <div style={{ fontSize: 9, color: T.gold }}>{row.tag}</div>
            </div>
          </div>
        ))}
      </div>
    </DemoMiniCard>
  )
}

function RoomTitleMini() {
  const [mood, setMood]   = useState("Tease")
  const [goal, setGoal]   = useState("500")
  const [idx, setIdx]     = useState(0)
  const variants = (LP_TITLES[mood] || LP_TITLES.Tease)(goal || "500")
  return (
    <DemoMiniCard icon="🎬" title="Room Title Generator" sub="Pick a mood, generate a title live">
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <select aria-label="Room title mood" value={mood} onChange={e => { setMood(e.target.value); setIdx(0) }} style={{ flex: 1, padding: "7px 8px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontSize: 11 }}>
          {Object.keys(LP_TITLES).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input type="number" aria-label="Tip goal" value={goal} onChange={e => { setGoal(e.target.value); setIdx(0) }} placeholder="Goal" style={{ width: 70, padding: "7px 8px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontSize: 11 }} />
      </div>
      <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,43,174,0.06)", border: "1px solid rgba(255,43,174,0.2)", fontSize: 12, color: T.textSoft, minHeight: 44, marginBottom: 10, fontStyle: "italic" }}>
        "{variants[idx % variants.length]}"
      </div>
      <button onClick={() => setIdx(i => i + 1)} style={{ width: "100%", padding: "9px", borderRadius: 9, background: "linear-gradient(135deg,#FF2BAE,#7C5CFF)", border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✨ Generate New Title</button>
    </DemoMiniCard>
  )
}

function LiveModeMini() {
  const [active, setActive]   = useState(false)
  const [tips, setTips]       = useState([])
  const [total, setTotal]     = useState(0)

  useEffect(() => {
    if (!active) return
    const names = ["diamondkingx", "euro_titan", "mfc_godfather", "vaultmaster99"]
    let count = 0
    const t = setInterval(() => {
      const amt = [25, 50, 100, 250][Math.floor(Math.random() * 4)]
      const name = names[Math.floor(Math.random() * names.length)]
      setTips(prev => [{ name, amt, id: Date.now() + Math.random() }, ...prev].slice(0, 4))
      setTotal(prev => prev + amt)
      count += 1
      if (count >= 8) clearInterval(t)
    }, 1100)
    return () => clearInterval(t)
  }, [active])

  const start = () => { setActive(true); setTips([]); setTotal(0) }

  return (
    <DemoMiniCard icon="🔴" title="Live Mode" sub="Watch tips arrive during a real stream">
      {!active ? (
        <button onClick={start} style={{ width: "100%", padding: "10px", borderRadius: 9, background: "linear-gradient(135deg,#10B981,#22D3EE)", border: "none", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>▶ Start Demo Stream</button>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: T.textFaint }}>Session Total</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: T.green }}>${total}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 90 }}>
            {tips.length === 0 && <div style={{ fontSize: 11, color: T.textFaint, textAlign: "center", padding: "20px 0" }}>Waiting for the first tip…</div>}
            {tips.map(t => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 8, background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.16)" }}>
                <span style={{ fontSize: 11.5, color: T.textSoft }}>{t.name}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: T.gold }}>+{t.amt}t</span>
              </div>
            ))}
          </div>
        </>
      )}
    </DemoMiniCard>
  )
}

// ── MAIN LANDING PAGE (also rendered at the root "/" via app/page.js) ───────
export default function LandingClient() {
  const router = useRouter()

  // Auth state
  const [isSignUp, setIsSignUp]       = useState(true)
  const [email, setEmail]             = useState("")
  const [password, setPassword]       = useState("")
  const [authLoading, setAuthLoading] = useState(false)
  const [authMsg, setAuthMsg]         = useState("")
  const [authError, setAuthError]     = useState("")
  const [pendingPlan, setPendingPlan] = useState(null)

  // Demo cycling state for feature cards
  const [msgIndex, setMsgIndex]       = useState(0)
  const [whaleIndex, setWhaleIndex]   = useState(0)
  const [copied, setCopied]           = useState(false)

  const messages = [
    "Hey, I was just thinking about you 💕 Going live tonight — come say hi?",
    "Miss you 😘 It's been a minute. I'm on tonight — would love to see you there 🔥",
    "Hey love 💕 I'm going live soon and always have more fun when you're around 💋",
  ]
  const whales = [
    { name: "user_ULTRAVIP999", spent: "$41,820", days: "520 days ago", pct: "23%", churn: "Critical", nextTip: "$2,140" },
    { name: "user_TOPSPENDERX", spent: "$33,140", days: "300 days ago", pct: "18%", churn: "High",     nextTip: "$1,680" },
  ]
  const [showFanProfile, setShowFanProfile] = useState(false)

  useEffect(() => {
    const a = setInterval(() => {
      setMsgIndex(p => (p + 1) % messages.length)
      setWhaleIndex(p => (p + 1) % whales.length)
    }, 5000)
    return () => clearInterval(a)
  }, [])

  useEffect(() => {
    const plan = new URLSearchParams(window.location.search).get('plan')
    if (plan) {
      // Signed-out purchase intent. Previously this arrival was completely
      // silent: the visitor was shown a signup form and, if they left without
      // completing it, no record survived that they had tried to buy at all.
      // captureAttribution() does not fill the gap either — it stores
      // window.location.pathname, so ?plan= is discarded before it is saved.
      track('checkout_intent_signed_out', { plan_type: plan, source: 'landing_plan_link' })
      setPendingPlan(plan)
      setIsSignUp(true)
    }
  }, [])

  useEffect(() => {
    getSupabase().then(supabase => supabase.auth.getUser()).then(async ({ data: { user } }) => {
      if (!user) return
      const supabase = await getSupabase()
      const plan = new URLSearchParams(window.location.search).get('plan')
      if (plan) { goToCheckout(plan); return }
      const { data: profile } = await supabase
        .from('beta_users')
        .select('onboarding_complete')
        .eq('user_id', user.id)
        .single()
      // Only force fully-onboarded users off the marketing page. Incomplete
      // onboarding is NOT redirected here — the explicit sign-in handler
      // below already sends users to /onboarding right after login; doing
      // it again on every landing-page mount trapped anyone who'd
      // intentionally left onboarding (e.g. via the exit survey) back into
      // it the moment they landed on '/'.
      if (profile?.onboarding_complete) router.replace('/dashboard')
    })
  }, [])

  useEffect(() => { captureAttribution() }, [])

  // Never fail silently. The previous version swallowed every error and
  // returned false, so a creator who clicked through a ?plan= link into a
  // broken checkout was left on the landing page with nothing happening and
  // no way to know why — which is exactly what happened to the only user who
  // has ever attempted to subscribe. Any failure now says so and routes to
  // /pricing, where they can still buy.
  const goToCheckout = async (planType) => {
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_type: planType }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) { window.location.href = data.url; return true }
      track('checkout_failed', { plan_type: planType, status: res.status, reason: data.error || 'no_url' })
      setAuthError(data.error || 'We could not open checkout just now. Taking you to the pricing page.')
      setTimeout(() => { window.location.href = '/pricing' }, 2200)
    } catch (e) {
      track('checkout_failed', { plan_type: planType, reason: 'network' })
      setAuthError('We could not reach checkout. Taking you to the pricing page.')
      setTimeout(() => { window.location.href = '/pricing' }, 2200)
    }
    return false
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(messages[msgIndex])
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setAuthLoading(true); setAuthError(""); setAuthMsg("")
    const supabasePromise = getSupabase()
    if (isSignUp) {
      track('signup_started')
      const captchaRes = await fetch('/api/auth/verify-captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const captchaData = await captchaRes.json()
      if (!captchaData.ok) { track('signup_captcha_failed'); setAuthError(captchaData.error || 'Security check failed.'); setAuthLoading(false); return }
      let attribution = null
      try { attribution = JSON.parse(localStorage.getItem('camcash_attribution') || 'null') } catch {}
      const supabase = await supabasePromise
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) { track('signup_auth_error', { reason: error.message }); setAuthError(friendlyAuthError(error.message)); setAuthLoading(false) }
      else {
        if (typeof twq === 'function') twq('event', 'tw-rc0w2-rcj9h', {})
        fetch('/api/admin/notify-signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, source: 'landing' }) }).catch(() => {})
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          if (attribution) {
            supabase.from('profiles').update({
              utm_source: attribution.utm_source || null,
              utm_medium: attribution.utm_medium || null,
              utm_campaign: attribution.utm_campaign || null,
              utm_content: attribution.utm_content || null,
              utm_term: attribution.utm_term || null,
              referrer: attribution.referrer || null,
              attributed_landing_page: attribution.landing_page || null,
              attributed_at: new Date().toISOString(),
            }).eq('id', user.id).then(({ error: e }) => {
              if (e) console.warn('[UTM] profile update failed:', e.message)
              else try { localStorage.removeItem('camcash_attribution') } catch {}
            })
          }
          // One event for one moment. TrackEvents.signupCompleted() now emits
          // 'signup_success' itself, enriched with signup_method/source_page/
          // traffic_source, so the bare track('signup_success') that used to
          // sit beside it here would be a duplicate.
          TrackEvents.signupCompleted(window?.location?.pathname)
          if (pendingPlan && await goToCheckout(pendingPlan)) return
          // New signups always go through onboarding first — never straight to /dashboard.
          router.push("/onboarding")
        }
        else { setAuthMsg("Account created! Check your email to confirm, then log in."); setIsSignUp(false); setAuthLoading(false) }
      }
    } else {
      const supabase = await supabasePromise
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setAuthError(friendlyAuthError(error.message)); setAuthLoading(false) }
      else {
        track('login_success')
        if (pendingPlan && await goToCheckout(pendingPlan)) return
        const { data: { user } } = await supabase.auth.getUser()
        const { data: profile } = await supabase
          .from('beta_users')
          .select('onboarding_complete')
          .eq('user_id', user.id)
          .single()
        router.push(profile?.onboarding_complete ? '/dashboard' : '/onboarding')
      }
    }
  }

  const handleForgotPassword = async () => {
    if (!email) { setAuthError("Enter your email first."); return }
    const supabase = await getSupabase()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "https://www.camcashgrl.com/reset-password",
    })
    if (error) setAuthError(friendlyAuthError(error.message))
    else setAuthMsg("Password reset email sent — check your inbox.")
  }

  const authPanelProps = {
    isSignUp, setIsSignUp, email, setEmail, password, setPassword,
    authLoading, authMsg, authError, setAuthError, setAuthMsg,
    handleAuth, handleForgotPassword,
    pendingPlan,
  }

  // Feature strip data (additive — new section, matches redesign reference)
  const featureStrip = [
    { icon: "⏱", accent: T.cyan,    title: "Best hours",         body: "Discover the exact hours when you earn the most.",           href: "/demo", cta: "See peak times →" },
    { icon: "★", accent: T.pink,    title: "Top fans & profiles",body: "Every high-value fan, ranked, with churn risk and AI predictions.", href: "/demo", cta: "See fan profiles →" },
    { icon: "💌", accent: T.magenta,title: "Message re-generator",body: "AI-written re-engagement messages for fans going cold.",      href: "/demo", cta: "Try the generator →" },
    { icon: "📊", accent: T.purple, title: "Platform comparison", body: "Compare platforms and focus on what pays more.",              href: "/demo", cta: "See ROI breakdown →" },
    { icon: "🎥", accent: T.blue,   title: "Sessions breakdown",  body: "Every session, timed and totaled, so you see what worked.",   href: "/demo", cta: "See sessions →" },
    { icon: "🗺️", accent: T.cyan,   title: "Money Map",           body: "A heat map of exactly when and where your earnings land.",   href: "/demo", cta: "Explore the map →" },
    { icon: "📅", accent: T.gold,   title: "Streaming plan",      body: "A personalized weekly schedule built from your own data.",    href: "/demo", cta: "Build your plan →" },
    { icon: "🎬", accent: T.pink,   title: "Room title generator",body: "Mood + goal in, a scroll-stopping title out — instantly.",    href: "/demo", cta: "Generate a title →" },
    { icon: "🔴", accent: T.red,    title: "Live Mode",           body: "Watch tips arrive during a real stream — pace, goal, coaching.", href: "/demo", cta: "Watch live mode →" },
  ]

  const faqs = [
    { q: "Is CamCash free to use?", a: "CamCash starts with a 7-day free trial that unlocks the entire product on your own data — every platform, every insight. A card is required to begin the trial, nothing is charged during it, and cancelling before it ends costs you nothing. After that it is $19.99/mo or $99/yr." },
    { q: "What file formats do you support?", a: "CSV exports from Chaturbate, BongaCams, and MyFreeCams, plus automatic tip capture through the Chrome extension." },
    { q: "Can I track more than one platform for free?", a: "The free tier tracks 1 platform at a time. If you work on more than one platform, the Standard plan ($19.99/month) unlocks tracking multiple platforms at once." },
    { q: "Is my data safe and private?", a: "Yes. Your data is encrypted, never shared, and never sold." },
  ]

  return (
    <div className={dmSans.className} style={{ minHeight: "100vh", background: T.bgMain, color: T.textMuted, overflowX: "hidden" }}>

      {/* ── AMBIENT BACKGROUND ── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.3), transparent), radial-gradient(1px 1px at 60% 10%, rgba(255,255,255,0.22), transparent), radial-gradient(1px 1px at 80% 60%, rgba(255,255,255,0.26), transparent), radial-gradient(1px 1px at 35% 80%, rgba(255,255,255,0.18), transparent), radial-gradient(1px 1px at 90% 85%, rgba(255,255,255,0.22), transparent)" }} />
        <div style={{ position: "absolute", width: 700, height: 700, top: "-15%", right: "-5%", background: "radial-gradient(circle,rgba(22,244,255,0.08),transparent 65%)", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", width: 600, height: 600, bottom: "10%", left: "-10%", background: "radial-gradient(circle,rgba(255,43,174,0.08),transparent 65%)", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", width: 600, height: 600, top: "40%", left: "40%", background: "radial-gradient(circle,rgba(124,92,255,0.06),transparent 65%)", filter: "blur(60px)" }} />
      </div>

      {/* ── NAV ── */}
      <nav style={{ position: "relative", zIndex: 10, padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, background: T.gradientPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: "#06101A", boxShadow: "0 0 14px rgba(22,244,255,0.3)" }}>$</div>
          <span style={{ fontSize: 17, fontWeight: 800, color: "white", letterSpacing: -0.4 }}>Cam<span style={{ background: T.gradientPrimary, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Cash</span>™</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginRight: 8 }}>
          <a href="/landing#features" style={{ fontSize: 13, color: T.textMuted, textDecoration: "none" }}>Features</a>
          <a href="/pricing" style={{ fontSize: 13, color: T.textMuted, textDecoration: "none" }}>Pricing</a>
          <a href="/blog" style={{ fontSize: 13, color: T.textMuted, textDecoration: "none" }}>Blog</a>
          <a href="/affiliates" style={{ fontSize: 13, color: T.textMuted, textDecoration: "none" }}>Affiliates</a>
          <a href="/contact" style={{ fontSize: 13, color: T.purple, fontWeight: 700, textDecoration: "none" }}>Contact Us</a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/demo" style={{ padding: "7px 18px", borderRadius: 10, background: "rgba(124,92,255,0.1)", border: "1px solid rgba(124,92,255,0.28)", color: T.purple, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
            Try Demo
          </a>
          <button onClick={() => document.getElementById("lp-auth-bottom")?.scrollIntoView({ behavior: "smooth" })}
            style={{ padding: "7px 18px", borderRadius: 10, background: "rgba(22,244,255,0.1)", border: "1px solid rgba(22,244,255,0.28)", color: T.cyanSoft, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Sign In
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "72px 32px 56px" }}>
        <div className="lp-hero-grid" style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 60, alignItems: "center" }}>

          {/* Left */}
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "7px 14px", borderRadius: 999,
              background: "rgba(22,244,255,0.08)", border: "1px solid rgba(22,244,255,0.28)",
              fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
              color: T.cyanSoft, marginBottom: 22,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.cyan, boxShadow: "0 0 8px rgba(22,244,255,0.8)" }} />
              7-day free trial
            </div>

            <h1 style={{ fontSize: "clamp(36px,4vw,56px)", color: "white", fontWeight: 900, lineHeight: 1.08, marginBottom: 20, letterSpacing: -1.5 }}>
              The operating system<br />
              for cam model<br />
              <span style={{ background: T.gradientPrimary, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>revenue</span>
            </h1>

            <p style={{ fontSize: 17, lineHeight: 1.7, color: T.textMuted, marginBottom: 32, maxWidth: 440 }}>
              Upload your CSV. CamCash finds your peak hours, tracks high-value fans, and tells you exactly what to do to earn more — tonight.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 30 }}>
              {[
                ["⚡", "Your best stream time, calculated from your real data"],
                ["👑", "Top fan alerts — who to message and when"],
                ["📊", "Platform ROI — where your time is actually worth more"],
                ["🔓", "Free tier tracks 1 platform (extension or CSV upload) — $19.99/mo to track multiple"],
              ].map(([icon, text]) => (
                <div key={text} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: T.textFaint }}>
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ width: 24, height: 24, borderRadius: 7, background: "rgba(22,244,255,0.08)", border: "1px solid rgba(22,244,255,0.24)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: T.cyanSoft }}>✓</div>
                <span style={{ fontSize: 12.5, color: T.textMuted }}>7-day free trial, cancel any time</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ width: 24, height: 24, borderRadius: 7, background: "rgba(255,200,87,0.08)", border: "1px solid rgba(255,200,87,0.24)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: T.gold }}>🔒</div>
                <span style={{ fontSize: 12.5, color: T.textMuted }}>Private and secure</span>
              </div>
            </div>

            {/* Mobile CTA */}
            <button className="lp-mobile-cta"
              onClick={() => document.getElementById("lp-auth-mobile")?.scrollIntoView({ behavior: "smooth" })}
              style={{ display: "none", marginTop: 28, padding: "14px 36px", borderRadius: 14, background: T.gradientPrimary, color: "#06101A", fontWeight: 800, fontSize: 16, border: "none", cursor: "pointer", boxShadow: "0 0 28px rgba(22,244,255,0.28), 0 0 34px rgba(255,43,174,0.24)", letterSpacing: 0.2 }}>
              Start Free →
            </button>
          </div>

          {/* Right — Auth Panel (desktop) */}
          <div className="lp-desktop-auth">
            <AuthPanel id="lp-auth-desktop" {...authPanelProps} />
          </div>
        </div>

        {/* Mobile auth */}
        <div id="lp-auth-mobile" className="lp-mobile-auth" style={{ display: "none", marginTop: 40 }}>
          <AuthPanel id="lp-auth-mobile-inner" {...authPanelProps} />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          NEW — FLOATING DASHBOARD PREVIEW (marketing visual, MOCK/DEMO DATA)
          Added alongside existing hero/sections, nothing above or below this
          block was changed. To revert: delete this <section> plus the two
          imports at the top of the file.
          ══════════════════════════════════════════════════════════════════ */}
      <section style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "0 32px 72px" }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: "clamp(22px,2.6vw,30px)", fontWeight: 850, color: "white", letterSpacing: -0.6 }}>
            See CamCash in action
          </div>
          <div style={{ fontSize: 14, color: T.textFaint, marginTop: 8, marginBottom: 30 }}>
            A live look at what your dashboard tracks — updating in real time while you stream
          </div>
        </div>
        <FloatingDashboardPreview />
        <div style={{ marginTop: 20 }}>
          <PlatformsTypewriter />
        </div>
      </section>
      {/* ══════════════════════════════ END NEW BLOCK ══════════════════════════════ */}

      {/* ── WHAT IS CAMCASH — scannable definition block, semantic markup for AI/LLM crawlers ── */}
      <section aria-labelledby="what-is-camcash-heading" style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "0 32px 56px" }}>
        <div style={{
          borderRadius: 24, border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)), rgba(12,16,34,0.68)",
          padding: "36px 36px 32px",
        }}>
          <h2 id="what-is-camcash-heading" style={{ fontSize: "clamp(24px,3vw,32px)", fontWeight: 850, color: "white", letterSpacing: "-0.02em", marginTop: 0, marginBottom: 14 }}>
            What is CamCash?
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: T.textSoft, maxWidth: 720, marginBottom: 26 }}>
            <strong style={{ color: "white" }}>CamCash is a free analytics dashboard built for cam models.</strong> It reads your tip history and tells you your best hours to stream, which fans to message, and which platform actually pays more — no spreadsheets, no guessing.
          </p>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "22px 28px", margin: 0 }}>
            {[
              ["Category", "Analytics software for cam models & content creators"],
              ["Built for", "Chaturbate, BongaCams & MyFreeCams"],
              ["What it does", "Finds peak earning hours, ranks top tippers with churn-risk alerts, compares platform payouts, and generates fan re-engagement messages & room titles"],
              ["How you use it", "Install the free Chrome extension or upload a CSV export — no manual data entry"],
              ["Price", "7-day free trial with everything unlocked, then $19.99/mo or $99/yr"],
              ["Your data", "Encrypted, private, never sold"],
            ].map(([term, desc]) => (
              <div key={term}>
                <dt style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: T.cyanSoft, marginBottom: 6 }}>{term}</dt>
                <dd style={{ fontSize: 14, lineHeight: 1.55, color: T.textMuted, margin: 0 }}>{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── FEATURE STRIP ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "0 32px 64px" }}>
        <div className="lp-feature-strip" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {featureStrip.map(({ icon, accent, title, body, href, cta }) => (
            <a key={title} href={href} style={{
              display: "block", textDecoration: "none",
              background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)), rgba(12,16,34,0.68)",
              border: `1px solid ${accent}30`, borderRadius: 18, padding: "22px 20px",
              boxShadow: `0 0 22px -10px ${accent}70, 0 10px 26px -14px rgba(0,0,0,0.6)`,
              transition: "border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${accent}80`; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 0 34px -6px ${accent}90, 0 16px 34px -12px rgba(0,0,0,0.65)` }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = `${accent}30`; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 0 22px -10px ${accent}70, 0 10px 26px -14px rgba(0,0,0,0.6)` }}
            >
              <div style={{ width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, fontSize: 19, background: `${accent}18`, border: `1px solid ${accent}40`, color: accent, boxShadow: `0 0 16px -4px ${accent}90` }}>{icon}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "white", marginBottom: 6, letterSpacing: -0.01 }}>{title}</div>
              <div style={{ fontSize: 13.5, color: T.textMuted, lineHeight: 1.5, marginBottom: 12 }}>{body}</div>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.cyanSoft }}>{cta}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ── LIVE DEMO ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "0 32px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>Live Demo</div>
          <div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 800, color: "white", letterSpacing: -0.8 }}>Your dashboard, before you even sign up</div>
          <div style={{ fontSize: 14, color: T.textFaint, marginTop: 10 }}>Cycles through real states — before, during, and after a stream</div>
        </div>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <LiveDemoPanel />
        </div>
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <a href="/demo" style={{ fontSize: 13.5, fontWeight: 700, color: T.cyanSoft, textDecoration: "none" }}>
            This is just a taste — see fan profiles, the message re-generator, platform comparison, sessions, Money Map, Streaming Plan, live tip tracking & the room title generator in the full demo →
          </a>
        </div>
      </div>

      {/* ── DASHBOARD SHOWCASE ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "0 32px 88px" }}>
        <div className="lp-showcase-grid" style={{ display: "grid", gridTemplateColumns: "0.85fr 1.15fr", gap: 56, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: T.cyanSoft, marginBottom: 12 }}>Your command center</div>
            <h2 style={{ fontSize: "clamp(28px,3vw,38px)", fontWeight: 850, letterSpacing: "-0.03em", lineHeight: 1.15, color: "white", marginBottom: 18 }}>Everything you need. One powerful dashboard.</h2>
            <p style={{ color: T.textMuted, fontSize: 16, lineHeight: 1.65, marginBottom: 28, maxWidth: 420 }}>Track earnings, compare platforms, spot trends, and plan your streams with confidence.</p>
            <a href="/demo" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "11px 22px", borderRadius: 12, background: T.gradientPrimary,
              fontSize: 14.5, fontWeight: 800, color: "#06101A", textDecoration: "none",
              boxShadow: "0 0 20px rgba(22,244,255,0.24), 0 0 26px rgba(255,43,174,0.22)",
            }}>View full demo →</a>
          </div>

          <DashboardShowcasePanel />
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <div style={{ position: "relative", zIndex: 1, padding: "0 32px 48px", maxWidth: 960, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.purple, marginBottom: 8 }}>How It Works</div>
          <div style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 800, color: T.textSoft, marginBottom: 8 }}>Free immediately. Powerful when connected.</div>
          <div style={{ fontSize: 15, color: T.textFaint }}>Use the extension the moment you install it. Add an account when you're ready.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20 }}>
          {[
            { num: "1", accent: T.cyan, icon: "🧩", title: "Download Extension", body: "Auto-detect tips instantly. Works without an account. Use immediately.", link: ["/extension", "Download free →"] },
            { num: "2", accent: T.purple, icon: "📊", title: "Start Your Free Trial", body: "Save your analytics, track growth, unlock AI intelligence — everything, for 7 days free.", link: null, note: "7-day free trial · cancel any time" },
            { num: "3", accent: T.pink, icon: "🚀", title: "Upgrade When You're Ready", body: "Creator Pro unlocks every platform, fan, and insight for $19.99/month.", link: ["/pricing", "See Creator Pro →"] },
          ].map(({ num, accent, icon, title, body, link, note }) => (
            <div key={title} style={{ background: `${accent}0d`, border: `1px solid ${accent}30`, borderRadius: 18, padding: "28px 24px", textAlign: "center", position: "relative" }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: T.gradientPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13, color: "#06101A", margin: "0 auto 14px", boxShadow: "0 0 14px rgba(22,244,255,0.3)" }}>{num}</div>
              <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "white", marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.6, marginBottom: 16 }}>{body}</div>
              {link
                ? <a href={link[0]} style={{ fontSize: 13, fontWeight: 700, color: accent, textDecoration: "none" }}>{link[1]}</a>
                : <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>{note}</span>
              }
            </div>
          ))}
        </div>
      </div>

      {/* ── TRUST SECTION ── */}
      <div style={{ position: "relative", zIndex: 1, padding: "0 32px 64px", maxWidth: 960, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.textSoft }}>Why Creators Choose CamCash™</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          {[
            { icon: "🌿", text: "Free tier always exists" },
            { icon: "🔍", text: "Transparent about everything" },
            { icon: "🔒", text: "No surprise feature locks" },
            { icon: "⏰", text: "Cancel anytime, no lock-in contracts" },
            { icon: "💜", text: "Built by cam models, for cam models" },
          ].map(({ icon, text }) => (
            <div key={text} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span style={{ fontSize: 13, color: T.textMuted }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── SOCIAL PROOF STRIP ── */}
      <div className="lp-social-proof" style={{ position: "relative", zIndex: 1, borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "28px 32px", background: "rgba(255,255,255,0.015)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, textAlign: "center" }}>
          {[
            ["$2.4M+",  "Earnings tracked"],
            ["18,000+", "Sessions analyzed"],
            ["5,000+",  "Fan interactions"],
            ["3",       "Platforms supported"],
          ].map(([val, label]) => (
            <div key={label}>
              <div style={{ fontSize: "clamp(22px,2.5vw,30px)", fontWeight: 900, color: "white", letterSpacing: -0.5, marginBottom: 4 }}>{val}</div>
              <div style={{ fontSize: 12, color: T.textFaint, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── HOW IT MAKES YOU MORE MONEY ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1000, margin: "0 auto", padding: "80px 32px 40px" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>How It Works</div>
          <div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 800, color: "white", letterSpacing: -0.8 }}>Three ways CamCash™ makes you more money</div>
        </div>

        <div className="lp-three-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
          {[
            {
              icon: "⏰",
              title: "Stream at your real peak hours",
              body: "Not generic advice — your peak hours, from your own tip history. Streaming off-peak can cut $/hr by 40%.",
              accent: T.cyan,
              visual: (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36, marginTop: 14 }}>
                  {[30,50,45,80,60,95,70,85,55,90,40,75].map((h,i) => (
                    <div key={i} style={{ flex:1, borderRadius:"2px 2px 0 0", height:`${h}%`, background: i===5 ? T.cyan : "rgba(22,244,255,0.15)", transition:"height 0.3s" }} />
                  ))}
                </div>
              ),
            },
            {
              icon: "👑",
              title: "Identify and retain high-value fans",
              body: "Your top 10% of tippers generate 60–70% of revenue. CamCash shows you who they are and when to reach out.",
              accent: T.gold,
              visual: (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 5 }}>
                  {[["VIPfan99","$1,820","🔥 Hot"],["user8812","$940","⚠️ Cold"]].map(([n,v,s]) => (
                    <div key={n} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 8px", borderRadius:8, background:"rgba(255,200,87,0.08)", fontSize:11 }}>
                      <span style={{ color:T.textMuted }}>{n}</span>
                      <span style={{ color:T.gold, fontWeight:700 }}>{v}</span>
                      <span style={{ fontSize:10, color:T.textFaint }}>{s}</span>
                    </div>
                  ))}
                </div>
              ),
            },
            {
              icon: "🎯",
              title: "Optimize your platform split",
              body: "See $/hr by platform. Most models earn 2–3x more on one platform and don't know it.",
              accent: T.pink,
              visual: (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 5 }}>
                  {[["Chaturbate","$28/hr",85],["BongaCams","$12/hr",36],["MFC","$19/hr",57]].map(([p,v,pct]) => (
                    <div key={p}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.textFaint, marginBottom:2 }}>
                        <span>{p}</span><span style={{ color:T.pink, fontWeight:700 }}>{v}</span>
                      </div>
                      <div style={{ height:3, borderRadius:2, background:"rgba(255,255,255,0.07)", overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:T.pink, borderRadius:2 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
          ].map(({ icon, title, body, accent, visual }) => (
            <div key={title} className="lp-card" style={{ padding: "22px 20px", borderRadius: 18, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", transition: "all 0.2s", cursor: "default" }}
              onMouseEnter={e => { e.currentTarget.style.background="rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor=`${accent}40` }}
              onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.07)" }}
            >
              <div style={{ fontSize: 24, marginBottom: 10 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "white", marginBottom: 8, lineHeight: 1.4 }}>{title}</div>
              <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.65 }}>{body}</div>
              {visual}
            </div>
          ))}
        </div>
      </div>

      {/* ── MESSAGE GENERATOR PREVIEW ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "20px 32px 80px" }}>
        <div className="lp-msg-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* Message generator */}
          <div style={{ padding: "22px 20px", borderRadius: 18, background: "rgba(255,255,255,0.025)", border: `1px solid ${T.magenta}30`, boxShadow: `0 0 22px -10px ${T.magenta}70, 0 10px 26px -14px rgba(0,0,0,0.6)`, transition: "border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = `${T.magenta}80`; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 0 34px -6px ${T.magenta}90, 0 16px 34px -12px rgba(0,0,0,0.65)` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = `${T.magenta}30`; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 0 22px -10px ${T.magenta}70, 0 10px 26px -14px rgba(0,0,0,0.6)` }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 18 }}>💌</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>Fan Re-engagement</div>
                <div style={{ fontSize: 11, color: T.textFaint }}>AI-generated, personalized per fan</div>
              </div>
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", fontSize: 13, color: T.textMuted, lineHeight: 1.6, minHeight: 70, marginBottom: 14, fontStyle: "italic" }}>
              "{messages[msgIndex]}"
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setMsgIndex(p => (p+1)%messages.length)}
                style={{ flex:1, padding:"9px", borderRadius:10, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", color:T.textMuted, fontSize:12, cursor:"pointer" }}>
                Regenerate
              </button>
              <button onClick={handleCopy}
                style={{ flex:1, padding:"9px", borderRadius:10, background: copied ? "rgba(16,185,129,0.15)" : "rgba(22,244,255,0.1)", border: `1px solid ${copied ? "rgba(16,185,129,0.3)" : "rgba(22,244,255,0.28)"}`, color: copied ? T.green : T.cyanSoft, fontSize:12, fontWeight:700, cursor:"pointer", transition:"all 0.15s" }}>
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>

          {/* Whale card / Fan Profile */}
          <div style={{ padding: "22px 20px", borderRadius: 18, background: "rgba(255,255,255,0.025)", border: `1px solid ${T.pink}30`, boxShadow: `0 0 22px -10px ${T.pink}70, 0 10px 26px -14px rgba(0,0,0,0.6)`, transition: "border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = `${T.pink}80`; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 0 34px -6px ${T.pink}90, 0 16px 34px -12px rgba(0,0,0,0.65)` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = `${T.pink}30`; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 0 22px -10px ${T.pink}70, 0 10px 26px -14px rgba(0,0,0,0.6)` }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 18 }}>🐳</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>Top Fans & Profiles</div>
                <div style={{ fontSize: 11, color: T.textFaint }}>Your real tippers, ranked</div>
              </div>
            </div>
            <div style={{ padding: "14px", borderRadius: 12, background: "rgba(255,200,87,0.08)", border: "1px solid rgba(255,200,87,0.2)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textMuted, marginBottom: 8, fontFamily: "monospace" }}>{whales[whaleIndex].name}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: T.gold, marginBottom: 4 }}>{whales[whaleIndex].spent}</div>
              <div style={{ fontSize: 11, color: T.textFaint }}>lifetime · last tipped {whales[whaleIndex].days}</div>
              <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted }}>
                <span style={{ color: T.red, fontWeight: 700 }}>{whales[whaleIndex].pct} of your revenue</span> — at risk of churning
              </div>
              {showFanProfile && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: T.textFaint }}>Churn risk</span>
                    <span style={{ color: T.red, fontWeight: 700 }}>{whales[whaleIndex].churn}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: T.textFaint }}>Predicted next tip</span>
                    <span style={{ color: T.gold, fontWeight: 700 }}>{whales[whaleIndex].nextTip}</span>
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setShowFanProfile(v => !v)} style={{ width: "100%", marginTop: 10, padding: "8px", borderRadius: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: T.textMuted, fontSize: 11.5, cursor: "pointer" }}>
              {showFanProfile ? "Hide full profile" : "🔍 View full fan profile"}
            </button>
          </div>
        </div>

        <div className="lp-demo-mini-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 20 }}>
          <PlatformCompareMini />
          <SessionsMini />
          <MoneyMapMini />
          <StreamingPlanMini />
          <RoomTitleMini />
          <LiveModeMini />
        </div>

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <a href="/demo" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 12, background: T.gradientPrimary, fontSize: 14, fontWeight: 800, color: "#06101A", textDecoration: "none", boxShadow: "0 0 20px rgba(22,244,255,0.24), 0 0 26px rgba(255,43,174,0.22)" }}>
            Explore the full interactive demo →
          </a>
        </div>
      </div>

      {/* ── HOW TO START ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 700, margin: "0 auto", padding: "0 32px 80px", textAlign: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>Getting Started</div>
        <div style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 800, color: "white", marginBottom: 40, letterSpacing: -0.5 }}>Up and earning in 2 minutes</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { n:"01", title:"Upload your CSV", body:"Export from Chaturbate, BongaCams, or MFC. Paste into Google Sheets → Download as CSV → upload here." },
            { n:"02", title:"AI analyzes your sessions", body:"CamCash reads your peak hours, top fans, platform ROI, and session patterns automatically." },
            { n:"03", title:"Get your personalized playbook", body:"Your Command Center tells you when to stream, who to message, and where to focus — updated daily." },
          ].map(({ n, title, body }, i) => (
            <div key={n} style={{ display:"flex", gap:20, padding:"20px 0", borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none", textAlign:"left" }}>
              <div style={{
                width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                background: T.gradientPrimary, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 900, color: "#06101A", boxShadow: "0 0 12px rgba(22,244,255,0.28)",
              }}>{n}</div>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:"white", marginBottom:5 }}>{title}</div>
                <div style={{ fontSize:13, color:T.textFaint, lineHeight:1.65 }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FAQ ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "0 32px 88px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: "clamp(24px,3vw,34px)", fontWeight: 850, letterSpacing: "-0.02em", color: "white" }}>Frequently asked <span style={{ background: T.gradientPrimary, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>questions</span></div>
        </div>
        <div className="lp-faq-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {faqs.map(({ q, a }) => (
            <div key={q} style={{ background: "rgba(12,16,34,0.6)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "18px 20px" }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, color: "white" }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, background: "rgba(22,244,255,0.1)", border: "1px solid rgba(22,244,255,0.28)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: T.cyanSoft, fontWeight: 900 }}>?</span>
                {q}
              </div>
              <p style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.55, paddingLeft: 32, margin: 0 }}>{a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── FINAL CTA ── */}
      <div id="lp-auth-bottom" style={{ position: "relative", zIndex: 1, maxWidth: 480, margin: "0 auto", padding: "0 32px 100px", textAlign: "center" }}>
        <div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, color: "white", marginBottom: 10, letterSpacing: -0.8 }}>
          Turn your analytics<br />into income.
        </div>
        <div style={{ fontSize: 14, color: T.textFaint, marginBottom: 32 }}>7-day free trial. Takes 2 minutes.</div>
        <AuthPanel id="lp-auth-bottom-panel" {...authPanelProps} />
      </div>

      {/* ── FREE TOOLS SECTION ── */}
      <div style={{ position: "relative", zIndex: 1, padding: "0 32px 64px", maxWidth: 860, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.purple, marginBottom: 10 }}>Free Tools</div>
          <div style={{ fontSize: "clamp(20px,2.5vw,28px)", fontWeight: 800, color: "white", marginBottom: 8 }}>Two free tools. No account needed.</div>
          <div style={{ fontSize: 14, color: T.textFaint }}>Use them right now — completely free.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 20 }}>
          <a href="/guides/chaturbate-room-title-generator" style={{ display: "block", background: "rgba(124,92,255,0.08)", border: "1px solid rgba(124,92,255,0.28)", borderRadius: 16, padding: "28px 24px", textDecoration: "none" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✏️</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.textSoft, marginBottom: 8 }}>Room Title Generator</div>
            <p style={{ fontSize: 14, color: T.textMuted, margin: "0 0 16px", lineHeight: 1.6 }}>Generate click-worthy Chaturbate room titles that get you more viewers. Free, instant, no login.</p>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.purple }}>Try it free →</span>
          </a>
          <a href="/guides/chaturbate-token-calculator" style={{ display: "block", background: "rgba(22,244,255,0.06)", border: "1px solid rgba(22,244,255,0.22)", borderRadius: 16, padding: "28px 24px", textDecoration: "none" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>💰</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.textSoft, marginBottom: 8 }}>Token Calculator</div>
            <p style={{ fontSize: 14, color: T.textMuted, margin: "0 0 16px", lineHeight: 1.6 }}>Instantly convert Chaturbate tokens to USD. See your real take-home for any tip amount.</p>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.cyanSoft }}>Try it free →</span>
          </a>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer style={{ background: T.bgMain, borderTop: "1px solid rgba(124,92,255,0.16)", padding: "48px 40px 0", position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 40, marginBottom: 40 }}>

            {/* Free Tools */}
            <div>
              <h4 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.purple, marginBottom: 16, marginTop: 0 }}>Free Tools</h4>
              {[
                ["Token Calculator", "/guides/cam-model-token-calculator"],
                ["Room Title Generator", "/guides/cam-model-room-title-generator"],
                ["Name Generator", "/tools/cam-model-name-generator"],
                ["Earnings Tracker", "/guides/chaturbate-earnings-tracker"],
              ].map(([label, href]) => (
                <a key={href} href={href} style={{ display: "block", fontSize: 13, lineHeight: 1.6, marginBottom: 6, color: T.textMuted, textDecoration: "none" }}
                  onMouseEnter={e => e.target.style.color = T.purple}
                  onMouseLeave={e => e.target.style.color = T.textMuted}
                >{label}</a>
              ))}
            </div>

            {/* Guides */}
            <div>
              <h4 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.purple, marginBottom: 16, marginTop: 0 }}>Guides</h4>
              {[
                ["BongaCams Analytics", "/guides/bongacams-analytics"],
                ["MyFreeCams Analytics", "/guides/myfreecams-analytics"],
                ["Best Time to Stream", "/guides/best-time-to-stream-chaturbate"],
                ["All Guides →", "/guides"],
              ].map(([label, href]) => (
                <a key={href} href={href} style={{ display: "block", fontSize: 13, lineHeight: 1.6, marginBottom: 6, color: T.textMuted, textDecoration: "none" }}
                  onMouseEnter={e => e.target.style.color = T.purple}
                  onMouseLeave={e => e.target.style.color = T.textMuted}
                >{label}</a>
              ))}
            </div>

            {/* Product */}
            <div>
              <h4 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.purple, marginBottom: 16, marginTop: 0 }}>Product</h4>
              {[
                ["Dashboard", "/dashboard"],
                ["Live Mode", "/live"],
                ["Chrome Extension", "/extension"],
                ["Pricing", "/pricing"],
                ["Live Demo", "/demo"],
              ].map(([label, href]) => (
                <a key={href} href={href} style={{ display: "block", fontSize: 13, lineHeight: 1.6, marginBottom: 6, color: T.textMuted, textDecoration: "none" }}
                  onMouseEnter={e => e.target.style.color = T.purple}
                  onMouseLeave={e => e.target.style.color = T.textMuted}
                >{label}</a>
              ))}
            </div>

            {/* Support */}
            <div>
              <h4 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.purple, marginBottom: 16, marginTop: 0 }}>Support</h4>
              {[
                ["Contact Us", "/contact"],
                ["Submit a Feature Request", "/feature-request"],
                ["Privacy Policy", "/privacy"],
              ].map(([label, href]) => (
                <a key={href} href={href} style={{ display: "block", fontSize: 13, lineHeight: 1.6, marginBottom: 6, color: T.textMuted, textDecoration: "none" }}
                  onMouseEnter={e => e.target.style.color = T.purple}
                  onMouseLeave={e => e.target.style.color = T.textMuted}
                >{label}</a>
              ))}
            </div>

          </div>

          {/* Bottom bar */}
          <div style={{ borderTop: "1px solid rgba(124,92,255,0.10)", padding: "24px 0 32px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 13, color: T.textMuted }}>© 2026 CamCash™ — Made for cam models, by a cam model 💜</span>
              <p style={{ fontSize: 10, color: T.textFaint, marginTop: 6, marginBottom: 0, textAlign: "center" }}>CamCash™ is a trademark of CamCashGrl. All dashboard features, analytics methodology, streaming plan logic, and Money Map visualizations are proprietary. Unauthorized reproduction or use of CamCash concepts, features, or content is prohibited.</p>
              <div style={{ display: "flex", gap: 16 }}>
                <a href="/privacy" style={{ fontSize: 12, color: T.textFaint, textDecoration: "none" }}
                  onMouseEnter={e => e.target.style.color = T.purple}
                  onMouseLeave={e => e.target.style.color = T.textFaint}
                >Privacy Policy</a>
                <a href="/contact" style={{ fontSize: 12, color: T.textFaint, textDecoration: "none" }}
                  onMouseEnter={e => e.target.style.color = T.purple}
                  onMouseLeave={e => e.target.style.color = T.textFaint}
                >Contact</a>
              </div>
            </div>
            <a href="https://twitter.com/daphneslive" style={{ fontSize: 13, color: T.textFaint, textDecoration: "none" }}
              onMouseEnter={e => e.target.style.color = T.purple}
              onMouseLeave={e => e.target.style.color = T.textFaint}
            >@daphneslive</a>
          </div>
        </div>
      </footer>

      <FeedbackWidget />

      {/* ── GLOBAL STYLES ── */}
      <style jsx>{`
        @keyframes lp-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.4); }
        }

        .lp-card { transition: all 0.2s ease; }

        @media (max-width: 980px) {
          .lp-showcase-grid  { grid-template-columns: 1fr !important; }
          .lp-feature-strip  { grid-template-columns: repeat(2, 1fr) !important; }
          .lp-dash-charts    { grid-template-columns: 1fr !important; }
          .lp-demo-mini-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }

        @media (max-width: 768px) {
          .lp-hero-grid      { grid-template-columns: 1fr !important; }
          .lp-desktop-auth   { display: none !important; }
          .lp-mobile-cta     { display: inline-block !important; }
          .lp-mobile-auth    { display: block !important; }
          .lp-three-grid     { grid-template-columns: 1fr !important; }
          .lp-msg-grid       { grid-template-columns: 1fr !important; }
          .lp-faq-grid       { grid-template-columns: 1fr !important; }
          .lp-demo-mini-grid { grid-template-columns: 1fr !important; }
        }

        @media (max-width: 600px) {
          .lp-social-proof   { grid-template-columns: repeat(2,1fr) !important; }
          .lp-feature-strip  { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
