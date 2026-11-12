"use client"
import { useMemo } from "react"
import { zonedHour, zonedDay } from "../../lib/creatorTimezone"

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND CENTER
//
// Replaces the Overview tab's former eight stacked sections (KPI wall first,
// insight last) with the hierarchy from the supplied reference:
//
//   DISCOVER    -> "Your next best move" hero: the conclusion, up top
//   EXPLAIN     -> "Why this is your best move": the evidence behind it
//   OPPORTUNITY -> what the gap is worth, only as far as the data supports
//   ACTION      -> one primary CTA
//   MEASURE     -> totals and fans, demoted BELOW the insight
//
// EVERY number rendered here is read from the frozen analytics layer. This
// file performs no aggregation of its own — no reduces over tips or sessions,
// no re-derived hours, rates, windows, or percentages. If a figure is not
// already on `analytics`, it is not shown. That is deliberate: the audit that
// preceded this redesign existed precisely because UI components were
// recomputing metrics locally and disagreeing with one another.
// ═══════════════════════════════════════════════════════════════════════════

// Palette is the dashboard's OWN token set (app/dashboard/page.js's `C`) plus
// the CamCash brand gradient — not a new scheme. The Command Center has to sit
// inside the same shell as every other tab, so it inherits rather than
// redefines. Cyan carries facts/primary actions, purple + pink mark Pro,
// green marks positive movement, gold marks confidence/sample.
const C = {
  bg:      "#05070f",
  card:    "#121826",
  card2:   "#161e2e",
  border:  "#1e2d45",
  border2: "#2a3f5f",
  indigo:  "#7C5CFF",
  cyan:    "#22D3EE",
  pink:    "#EC4899",
  gold:    "#F59E0B",
  blue:    "#60A5FA",
  green:   "#10B981",
  red:     "#F87171",
  white:   "#F1F5F9",
  text:    "#94A3B8",
  muted:   "#475569",
}

// Same glass treatment the rest of the dashboard uses.
const glassCard = {
  background: "rgba(15,20,32,0.75)",
  border: "1px solid rgba(255,255,255,0.08)",
  backdropFilter: "blur(20px)",
  boxShadow: "0 0 40px rgba(59,130,246,0.15), 0 0 80px rgba(236,72,153,0.08)",
}

// The CamCash brand gradient (branding spec): cyan -> purple -> pink.
const CTA_GRADIENT  = "linear-gradient(90deg,#22D3EE 0%,#7C5CFF 48%,#EC4899 100%)"
export const HERO_GRADIENT = "linear-gradient(120deg, rgba(34,211,238,0.10) 0%, rgba(124,92,255,0.12) 46%, rgba(236,72,153,0.10) 100%)"

const fmtUsd  = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtUsd0 = (n) => {
  const v = Number(n || 0)
  // Round to whole dollars only when that does not collapse a real value to
  // "$0" — a $0.32 lifetime fan rendering as "$0 lifetime" reads as a bug.
  return v > 0 && v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString("en-US")}`
}
// Hours: 1 decimal below 10h so a sparse account never shows "0h" beside a
// per-hour rate, which reads as a contradiction.
const fmtHours = (h) => (h > 0 && h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`)
const fmtHour = (h) => {
  const n = ((h % 24) + 24) % 24
  return n === 0 ? "12:00 AM" : n < 12 ? `${n}:00 AM` : n === 12 ? "12:00 PM" : `${n - 12}:00 PM`
}
// The window is exactly the measured bucket: one creator-local hour. The
// hour is numeric (engine bestTimeWindows), so h + 1 is arithmetic.
const fmtWindow = (h) => `${fmtHour(Number(h))} – ${fmtHour(Number(h) + 1)}`
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const fmtRate = (n) => `~$${Number(n || 0).toFixed(2)}/hr`

export const card = (extra = {}) => ({ ...glassCard, borderRadius: 16, ...extra })

const label = {
  fontSize: 10.5, fontWeight: 800, letterSpacing: "0.14em",
  textTransform: "uppercase", color: C.muted,
}

function BrandButton({ children, onClick, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: CTA_GRADIENT, border: "none", borderRadius: 10,
        padding: "11px 20px", fontSize: 14, fontWeight: 700, color: C.white,
        cursor: "pointer", whiteSpace: "nowrap",
        boxShadow: "0 4px 18px rgba(124,92,255,0.30)",
        transition: "transform 0.15s, box-shadow 0.15s",
        ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 24px rgba(124,92,255,0.45)" }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 18px rgba(124,92,255,0.30)" }}
    >{children}</button>
  )
}

function GhostButton({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "transparent", border: `1px solid ${C.border}`, borderRadius: 9,
      padding: "9px 15px", fontSize: 13, fontWeight: 600, color: C.text, cursor: "pointer", whiteSpace: "nowrap",
    }}>{children}</button>
  )
}

// One measured fact. Never a claim without a number behind it.
export function Chip({ icon, title, value, sub, accent = C.pink }) {
  return (
    <div style={card({ padding: "18px 20px", display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 })}>
      <div style={{ fontSize: 19, flexShrink: 0, marginTop: 1 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{title}</div>
        {/* wraps rather than truncating — at 2-up on a 390px screen these
            were clipping to "8:00 AM - 1..." and "4 high-valu..." */}
        <div style={{ fontSize: 17, fontWeight: 800, color: accent, marginTop: 5, lineHeight: 1.3 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 5, lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </div>
  )
}

export function Stat({ value, label: l, delta, accent = C.white }) {
  return (
    <div style={card({ padding: "18px 16px" })}>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: C.muted }}>{l}</span>
        {delta != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: delta >= 0 ? C.green : "#F87171" }}>
            {delta >= 0 ? "+" : ""}{delta}%
          </span>
        )}
      </div>
    </div>
  )
}

// Proof beside the recommendation: the recommended window's median $/hr
// against the platform's typical hour.
//
// This replaced a 24-bar hour-of-day chart. That chart could not be made
// honest on real data: scoped to the recommended day, the production CSV has
// eight Wednesday buckets, and hour 6 shows $42.09/hr from ONE session —
// exactly the "one good night" the engine's confidence tiers exist to
// discount. Drawn at true height it dwarfed the $9.52/hr recommendation
// (4 sessions), so the chart visibly argued against the headline above it.
// Restricting the chart to buckets meeting the same 4-session bar left a
// single bar, which read as broken. A 24-bar distribution implies a precision
// this data does not have; a two-value comparison states exactly what the
// recommendation rests on.
function WindowProof({ windowRate, baselineRate, sessions, tierLabel, dayLabel, hourLabel }) {
  const max = Math.max(windowRate, baselineRate, 0.01)
  const Bar = ({ v, title, sub, gradient }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 14, color: gradient ? C.white : C.text, fontWeight: gradient ? 700 : 500, minWidth: 0 }}>{title}</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: gradient ? C.cyan : C.text, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{fmtUsd(v)}/hr</span>
      </div>
      <div style={{ height: 18, borderRadius: 9, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{
          width: `${Math.max((v / max) * 100, 4)}%`, height: "100%", borderRadius: 9,
          background: gradient ? CTA_GRADIENT : "rgba(148,163,184,0.35)",
          boxShadow: gradient ? "0 0 14px rgba(34,211,238,0.35)" : "none",
        }} />
      </div>
      {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 7 }}>{sub}</div>}
    </div>
  )
  return (
    <div>
      <div style={{ ...label, fontSize: 12, marginBottom: 16 }}>Why this window</div>
      <Bar v={windowRate} gradient title={`${dayLabel}s ${hourLabel}`} sub={`${sessions} valid session${sessions === 1 ? "" : "s"} · ${tierLabel}`} />
      <Bar v={baselineRate} title="Your typical streamed hour" sub="all your valid sessions · estimated" />
    </div>
  )
}

export default function CommandCenter({
  tz = undefined, // creator timezone (profiles.timezone); undefined → device clock
  analytics,
  isPro = false,
  firstName = null,
  onPlanStream,
  onViewFans,
  onSeePerformance,
  onUpgrade,
  // Relocated from the old Overview's "Make Money Right Now" section. The
  // merge (go-live signal + nextMoves + realTimeAlerts, capped at 3) happens
  // in the dashboard where those sources already live; this component only
  // renders the prepared list. Same rule as every other value here: nothing
  // is computed locally.
  nowActions = [],
  onMessageFan,
}) {
  // ── All values READ from the frozen layer. No local aggregation. ──
  // Today's recommendation: the best qualifying platform x 1-hour window on
  // the creator-local weekday, from the shared best-time formula ($ per
  // streamed hour, >= 3 separate days, calculateConfidence above "Very Low").
  // null => "Not enough data yet" for today; the full week lives in the
  // Stream Planner, which reads the same function.
  const bestTimes    = analytics?.bestTimeWindows || null
  const todayName    = DAY_NAMES[tz ? zonedDay(new Date(), tz) : new Date().getDay()]
  const nowHour      = tz ? zonedHour(new Date(), tz) : new Date().getHours()
  // Every recommended window for today, best first. Only windows that have
  // not ended are recommended: the current hour (still in progress) and later
  // ones. If today's windows have all passed, say so rather than recommend a
  // past hour.
  const todayWindows = bestTimes?.recommendedByDay?.[todayName] || []
  const todayBest    = todayWindows.find(w => w.hour >= nowHour) || null
  const passedBest   = !todayBest && todayWindows.length > 0 ? todayWindows[0] : null
  const overlap      = todayBest?.fanOverlap || null
  const hourlyRate   = analytics?.estimatedHourlyRate ?? 0
  const totalUSD     = analytics?.totalUSD ?? 0
  const fanCount     = analytics?.uniqueFanCount ?? 0
  const sessionCount = analytics?.meaningfulSessionCount ?? 0
  const streamHours  = (analytics?.totalStreamMinutes ?? 0) / 60
  const momentum     = analytics?.momentum || null
  const whales       = analytics?.whales || []
  const platforms    = analytics?.platforms || []

  const topPlatform = useMemo(
    () => [...platforms].sort((a, b) => (b.usdPerHour || 0) - (a.usdPerHour || 0))[0] || null,
    [platforms]
  )

  // Fans inside their typical return window. Uses the canonical
  // expectedNextTip string; no probability percentage is invented, and only
  // fans with >=3 tips (enough history for churnRisk to be meaningful).
  const returningSoon = useMemo(
    () => whales
      .filter(w => w.tipCount >= 3 && (w.expectedNextTip === "Overdue" || w.expectedNextTip === "Tomorrow" || /^In [1-3] days?$/.test(w.expectedNextTip || "")))
      .sort((a, b) => b.totalUSD - a.totalUSD).slice(0, 3),
    [whales]
  )

  // Comparison baseline: the engine's estimatedHourlyRate — USD / streamed
  // hours over all valid sessions (>= 30 min AND >= 2 tips, known duration),
  // the same units and session rule as the window rate. Read, not computed.
  // null/0 until there is a valid session, in which case no comparison is drawn.
  const baseline = hourlyRate > 0 ? hourlyRate : null
  const pctAbove = (todayBest && baseline > 0)
    ? Math.round(((todayBest.usdPerStreamedHour - baseline) / baseline) * 100) : null

  const hasWindow = !!todayBest
  const greeting = `Good ${nowHour < 12 ? "morning" : nowHour < 18 ? "afternoon" : "evening"}, ${firstName || "there"}`

  // Hourly distribution for the evidence bar chart — read straight off the
  // canonical grid, summed per local hour. Presentational shaping of an
  // existing canonical array, not a new metric.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 27, fontWeight: 800, color: C.white, letterSpacing: "-0.025em" }}>👋 {greeting}</div>
          <div style={{ fontSize: 15, color: C.muted, marginTop: 6 }}>
            {hasWindow ? "Here's how to make more money today." : "Here's what your data says so far."}
          </div>
        </div>
      </div>

      {/* ── HERO: YOUR NEXT BEST MOVE ──────────────────────────────── */}
      <div style={{
        background: hasWindow ? HERO_GRADIENT : "rgba(15,20,32,0.75)",
        backdropFilter: "blur(20px)",
        border: hasWindow ? "1px solid rgba(34,211,238,0.28)" : `1px solid ${C.border}`,
        borderRadius: 22, padding: 38, position: "relative", overflow: "hidden",
      }}>
        {hasWindow && <div style={{ position: "absolute", right: -70, top: -70, width: 300, height: 300, borderRadius: "50%", background: "rgba(34,211,238,0.12)", filter: "blur(80px)", pointerEvents: "none" }} />}
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 40, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 420px", minWidth: 0 }}>
            <div style={{ ...label, fontSize: 12, color: hasWindow ? C.cyan : C.muted, marginBottom: 14 }}>Your next best move</div>

            {hasWindow ? (
              <>
                <div data-testid="hero-headline" style={{ fontSize: 38, fontWeight: 800, color: C.white, letterSpacing: "-0.035em", lineHeight: 1.12 }}>
                  Go live today {fmtWindow(todayBest.hour)} on {todayBest.platform}
                </div>
                {/* Confidence + sample sit directly under the recommendation. */}
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginTop: 14 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gold, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)", padding: "5px 12px", borderRadius: 20 }}>
                    {todayBest.confidence.label}
                  </span>
                  <span data-testid="hero-sample" style={{ fontSize: 13, color: C.text }}>
                    based on <strong style={{ color: C.white }}>{todayBest.validSessionCount} valid session{todayBest.validSessionCount === 1 ? "" : "s"}</strong> across <strong style={{ color: C.white }}>{todayBest.localDates} separate {todayName}s</strong>
                  </span>
                </div>
                <div style={{ fontSize: 16, color: C.text, marginTop: 16, lineHeight: 1.62, maxWidth: 520 }}>
                  On {todayName}s this hour on {todayBest.platform} earns about{" "}
                  <strong style={{ color: C.cyan }}>{fmtRate(todayBest.usdPerStreamedHour)} streamed</strong>
                  {pctAbove != null && pctAbove > 0 && <> — <strong style={{ color: C.cyan }}>{pctAbove}% higher</strong> than your typical streamed hour</>}.
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                    Estimated: imported tips don't include stream start and end times, so streamed time is measured from your first to last tip in each session.
                  </div>
                </div>
              </>
            ) : (
              <>
                <div data-testid="hero-headline" style={{ fontSize: 22, fontWeight: 800, color: C.white, letterSpacing: "-0.02em", lineHeight: 1.25 }}>
                  {passedBest ? "Today's best window has already passed" : "Not enough data yet for today's best window"}
                </div>
                <div style={{ fontSize: 13.5, color: C.text, marginTop: 11, lineHeight: 1.6, maxWidth: 500 }}>
                  {passedBest
                    ? <>Your best {todayName} window was {fmtWindow(passedBest.hour)} on {passedBest.platform}, and no later {todayName} window has enough history to recommend. Your streaming plan shows the rest of the week.</>
                    : <>CamCash names a {todayName} window only after you've streamed it on at least {bestTimes?.minLocalDates || 3} separate {todayName}s with enough streamed time to be more than one good night. Your streaming plan shows every day of the week.</>}
                </div>
              </>
            )}

            <div style={{ marginTop: 26 }}>
              <BrandButton onClick={onPlanStream} style={{ padding: "15px 28px", fontSize: 16, borderRadius: 12 }}>See your full streaming plan →</BrandButton>
            </div>
          </div>

          {/* RIGHT: the proof beside the recommendation — today's window rate
              against your typical streamed hour, both from the engine. (The
              former "estimated opportunity" range was removed: it multiplied
              by an unsupported 1.5 and read an engine field that never
              existed, so this half rendered empty.) */}
          {hasWindow && (
            <div style={{ flex: "1 1 340px", minWidth: 280 }}>
              {baseline != null && (
                <WindowProof
                  windowRate={todayBest.usdPerStreamedHour}
                  baselineRate={baseline}
                  sessions={todayBest.validSessionCount}
                  tierLabel={todayBest.confidence.label}
                  dayLabel={todayName}
                  hourLabel={fmtWindow(todayBest.hour)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── EVIDENCE CHIPS ─────────────────────────────────────────── */}
      {hasWindow && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))", gap: 11 }}>
          <Chip icon="🕐" title="Today's window" value={fmtWindow(todayBest.hour)} sub={`${todayName}s on ${todayBest.platform} · ${todayBest.confidence.label}`} />
          <Chip icon="👥" title={overlap?.count ? "Fans active in it" : "Fan overlap"}
                value={overlap?.count ? `${overlap.count} high-value fan${overlap.count === 1 ? "" : "s"}` : "None yet"}
                sub={overlap?.count ? `${fmtUsd0(overlap.totalUSD)} lifetime combined` : "No fan with $20+ lifetime has tipped near this hour"}
                accent={overlap?.count ? C.indigo : C.muted} />
          {topPlatform && (
            <Chip icon="📈" title={`${topPlatform.platform} is #1`} value={`${fmtUsd(topPlatform.usdPerHour)}/hr`} sub={`${topPlatform.sessions} sessions · ${fmtHours(topPlatform.hours || 0)}`} accent={C.cyan} />
          )}
          <Chip icon="📊" title="Sample behind it" value={`${todayBest.validSessionCount} valid session${todayBest.validSessionCount === 1 ? "" : "s"}`} sub={`${todayBest.localDates} separate ${todayName}s · ${todayBest.confidence.label}`} accent={C.gold} />
        </div>
      )}

      {/* ── RIGHT NOW ──────────────────────────────────────────────
          The hero says what to do next; this says what is worth doing in
          the next few minutes. Time-sensitive and capped at three, so it
          stays an action list rather than the alert wall it replaced. */}
      {nowActions.length > 0 && (
        <div style={card({ padding: 20 })}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <span style={{ fontSize: 17 }}>⚡</span>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.white }}>Right now</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {nowActions.map((a, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
                padding: "14px 15px", borderRadius: 12,
                background: i === 0 ? `${a.color}18` : `${a.color}0d`,
                border: `1px solid ${i === 0 ? a.color + "50" : a.color + "28"}`,
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 19, flexShrink: 0 }}>{a.icon}</span>
                  <div style={{ fontSize: 14, color: C.white, lineHeight: 1.55, minWidth: 0, overflowWrap: "anywhere" }}>{a.text}</div>
                </div>
                {a.cta && a.username && (
                  <button onClick={() => onMessageFan?.(a.username)}
                    aria-label={`Message ${a.username}`} title="Message fan"
                    style={{ flexShrink: 0, padding: "7px 12px", borderRadius: 9, background: "rgba(236,72,153,0.14)", border: "1px solid rgba(236,72,153,0.3)", color: C.pink, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                    Message
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chart moved into the hero (above). The standalone "Why this is your
          best move" card was removed: it duplicated the same distribution in a
          second card while the hero sat half-empty. */}

      {/* ── FANS + PERFORMANCE ─────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 14, alignItems: "start" }}>
        <div style={card({ padding: 20 })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.white }}>Who deserves your attention</div>
          </div>
          {returningSoon.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {returningSoon.map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 15px", borderRadius: 12, background: C.card2, border: `1px solid ${C.border}` }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,#22D3EE,#7C5CFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: C.white, flexShrink: 0 }}>
                    {w.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: C.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.username}</div>
                    <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>
                      {fmtUsd0(w.totalUSD)} lifetime · {w.tipCount} tips · usually every ~{Math.round(w.avgDaysBetweenTips)}d
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 11px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0,
                    background: w.expectedNextTip === "Overdue" ? "rgba(236,72,153,0.14)" : "rgba(16,185,129,0.13)",
                    color: w.expectedNextTip === "Overdue" ? C.pink : C.green }}>
                    {w.expectedNextTip}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.65 }}>
              No supporters are inside their typical return window right now. This fills in as your fans build a repeat pattern — it needs at least 3 tips from someone before it will make a call.
            </div>
          )}
          <div style={{ marginTop: 14 }}><GhostButton onClick={onViewFans}>See all fans →</GhostButton></div>
        </div>

        <div style={card({ padding: 20 })}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.white, marginBottom: 14 }}>Your money story</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 10 }}>
            <Stat value={fmtUsd(totalUSD)} label="Total earnings" accent={C.white} />
            <Stat value={`${fmtUsd(hourlyRate)}`} label="Per hour" accent={C.green} />
            <Stat value={fmtHours(streamHours)} label="Total hours" accent={C.white} />
            <Stat value={sessionCount.toLocaleString()} label="Sessions" accent={C.white} />
            <Stat value={fanCount.toLocaleString()} label="Fans" accent={C.indigo} />
            {momentum && momentum.label !== "No data" && (
              <Stat value={fmtUsd0(momentum.last30USD)} label="Last 30 days" delta={Math.round(momentum.pct)} accent={C.white} />
            )}
          </div>
          <div style={{ marginTop: 14 }}><GhostButton onClick={onSeePerformance}>View full performance →</GhostButton></div>
        </div>
      </div>

      {/* ── PRO STRATEGY FOOTER ────────────────────────────────────────
          One contextual upsell, not a paywall on every section. Only
          rendered when there is a real, personalized thing being held back. */}
      {!isPro && hasWindow && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 22, flexWrap: "wrap",
          padding: "24px 26px", borderRadius: 18,
          background: "linear-gradient(115deg, rgba(124,92,255,0.10), rgba(236,72,153,0.08))",
          border: "1px solid rgba(124,92,255,0.26)",
        }}>
          <div style={{ minWidth: 280, flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.white, letterSpacing: "-0.015em" }}>
              You found the window. Pro builds the week around it.
            </div>
            <div style={{ fontSize: 14, color: C.text, marginTop: 8, lineHeight: 1.65 }}>
              You already know <strong style={{ color: C.cyan }}>{todayName}s {fmtWindow(todayBest.hour)}</strong> on {todayBest.platform} earns about {fmtRate(todayBest.usdPerStreamedHour)} streamed
              {pctAbove != null && pctAbove > 0 ? <> — <strong style={{ color: C.green }}>{pctAbove}% above</strong> your typical streamed hour</> : null}.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 13 }}>
              {[
                `Every ranked window for the week, not just the top one`,
                `Which platform to run in each window, not just today's`,
                overlap?.count ? `Alerts when your ${overlap.count} high-value fan${overlap.count === 1 ? "" : "s"} in this window go quiet` : `Alerts when a high-value supporter goes quiet`,
                `A forecast you can hold next week's schedule against`,
              ].map((line, i) => (
                <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13.5, color: C.text, lineHeight: 1.5 }}>
                  <span style={{ color: C.indigo, fontWeight: 800, flexShrink: 0 }}>→</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>
          <BrandButton onClick={() => onUpgrade?.("command_center_strategy")} style={{ padding: "14px 26px", fontSize: 15.5, borderRadius: 12, flexShrink: 0 }}>Build My Strategy →</BrandButton>
        </div>
      )}
    </div>
  )
}
