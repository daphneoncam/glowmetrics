"use client"
import React, { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase"
import { parseCSV, detectPlatform, aggregateRows as runEngine, toLocalDow, toLocalHour } from "../../lib/analytics"
import { toLocalDateStr } from "../../lib/analytics/localTime"
import { computeRoomHealth, ROOM_STATES, MOMENTUM_DIRECTIONS } from "../../lib/analytics/roomHealth"
import { computeRevenueVelocity, computeLiveComparison } from "../../lib/analytics/velocity"
import { detectSessionPhase, PHASES, getRecoveryActions, getGoalStrategy } from "../../lib/analytics/sessionPhase"
import { computeOpportunityScore, computeStreamHealth } from "../../lib/analytics/opportunity"
import { computeCoachingState } from "../../lib/coaching/triggers"
import dynamic from "next/dynamic"
import Sidebar from "./Sidebar"
import SiteFooter from "../components/SiteFooter"
import { PLATFORM_TOKEN_RATES, tokenRate } from "../../lib/constants"
import { track as logEvent } from '../../lib/track'
import { isProPlan, trialDaysRemaining, getAccessState, TRIAL_DAYS } from '../../lib/plan'
import { resolveCreatorTimezone, autoPopulateTimezoneIfMissing } from '../../lib/timezone'
import CommandCenter from './CommandCenter'
import Performance from './Performance'
import Fans from './Fans'
import { getDashboardReadiness, getModuleLockState, canShowHourlyRate, LockedInsightCard, DashboardProgressCard } from './DashboardPreview'
import Button from '../../components/ui/Button'
import { useLiveSessionEngine } from '../live/useLiveSessionEngine'

// Tab-only components loaded on demand instead of in the initial dashboard
// bundle — each is only ever rendered behind an `activeTab === '...'` check,
// and StreamPlanner/MoneyMap alone pull in all of recharts.
// Behavior-triggered upgrade copy — keyed by the `source` passed to
// openUpgradeModal(source). Each trigger fires because of something the
// user actually just did, so the headline should say that back to them
// instead of one generic pitch for every context. Falls back to
// UPGRADE_COPY.default for any source not listed here.
const UPGRADE_COPY = {
  default: {
    headline: "Unlock Your Full Earning Potential",
    subhead: "You're only seeing a preview of your data. Here's what's waiting for you inside:",
  },
  multi_platform: {
    headline: "You've tracked 1 platform",
    subhead: "Compare all your platforms with Creator Pro to see exactly where you actually earn best.",
  },
  whales_cutoff: {
    headline: "You've found your top fans",
    subhead: "See your full fan list — every VIP, not just the first 3 — and track them over time.",
  },
  whales_empty: {
    headline: "Unlock Your Full Fan Insights",
    subhead: "See your highest-value fans, repeat spenders, and who's worth re-engaging.",
  },
  creator_report: {
    headline: "You have enough data for deeper insights",
    subhead: "Upgrade to unlock your remaining personalized recommendations for next stream.",
  },
}

const TAB_LOADING = (
  <div style={{ padding: "80px 0", textAlign: "center" }}>
    <div style={{ width: 40, height: 40, border: "2px solid #1e2d45", borderTop: "2px solid #22D3EE", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
  </div>
)
const CreatorReport = dynamic(() => import('./CreatorReport'), { ssr: false, loading: () => TAB_LOADING })
const Settings = dynamic(() => import('./Settings'), { ssr: false, loading: () => TAB_LOADING })
const OnboardingChecklist = dynamic(() => import('./OnboardingChecklist'), { ssr: false })
const AnalyticsCharts = dynamic(() => import('./AnalyticsCharts'), { ssr: false, loading: () => TAB_LOADING })
const StreamPlanner = dynamic(() => import('./StreamPlanner'), { ssr: false, loading: () => TAB_LOADING })
const MoneyMap = dynamic(() => import('./MoneyMap'), { ssr: false, loading: () => TAB_LOADING })
const PrivateSessions = dynamic(() => import('./PrivateSessions'), { ssr: false, loading: () => TAB_LOADING })
const SessionRevenueMix = dynamic(() => import('./SessionRevenueMix'), { ssr: false })
const DashboardGrowthCharts = dynamic(() => import('./DashboardGrowthCharts'), { ssr: false })
const TokenCalculator = dynamic(() => import('../guides/cam-model-token-calculator/TokenCalculatorClient'), { ssr: false, loading: () => TAB_LOADING })
// The exact same Live Engine page component /live uses — not a rebuild, not
// a second copy. Embedding it directly here means the dashboard's "Live
// Mode Sessions" tab and the standalone /live page are provably running the
// identical engine, timer, coaching, and tip feed; there is no way for them
// to drift apart the way the old fake in-dashboard engine did.
const LiveEnginePage = dynamic(() => import('../live/page'), { ssr: false, loading: () => TAB_LOADING })

// Analytics tracking — works whether or not @vercel/analytics is installed
let track = (event, props) => {}
try { track = require("@vercel/analytics").track } catch (e) {}

// Manual memoization for expensive derived values computed after the
// `if (loading) return` early-exit below — that early return means a real
// useMemo() there would violate the Rules of Hooks (hook count would differ
// between loading/loaded renders), so we cache by reference-equality of
// deps in a plain ref object instead. Recomputes only when deps change,
// not on every render (e.g. unrelated clicks, the 30s/60s timers).
function memoOn(cache, key, deps, compute) {
  const prev = cache[key]
  if (prev && prev.deps.length === deps.length && prev.deps.every((d, i) => d === deps[i])) {
    return prev.value
  }
  const value = compute()
  cache[key] = { deps, value }
  return value
}

const C = {
  bg: "#05070f", card: "#121826", card2: "#161e2e", border: "#1e2d45", border2: "#2a3f5f",
  indigo: "#7C5CFF", cyan: "#22D3EE", pink: "#EC4899", gold: "#F59E0B", blue: "#60A5FA",
  green: "#10B981", red: "#F87171", orange: "#FB923C", white: "#F1F5F9", text: "#94A3B8", muted: "#475569"
}

const TIER_COLORS = {
  "Whale": C.gold, "Shark": C.blue, "Regular": C.cyan, "Dormant": C.orange
}

// Rotating microcopy shown on the CSV importer button/progress bar while a
// real upload request is in flight — purely cosmetic (doesn't imply we know
// the server's actual step), but keeps the card feeling alive during the wait.
const IMPORT_MESSAGES = [
  "Reading your CSV…",
  "Detecting platform…",
  "Importing tips…",
  "Analyzing your top spenders…",
  "Finding your peak stream hours…",
  "Analyzing your fans…",
  "Calculating your earnings…",
  "Gathering AI insights…",
  "Creating your personalized streaming schedule…",
  "Updating your dashboard…",
]

const glassCard = {
  background: "rgba(15,20,32,0.75)",
  border: "1px solid rgba(255,255,255,0.08)",
  backdropFilter: "blur(20px)",
  boxShadow: "0 0 40px rgba(59,130,246,0.15), 0 0 80px rgba(236,72,153,0.08)",
}

const formatImportDate = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Turns a raw day count into a friendly "Last active …" phrase without
// altering the underlying days-since-last-tip value used elsewhere.
const formatLastActive = (days) => {
  if (days === null || days === undefined || isNaN(days)) return "Not enough data yet"
  if (days <= 0) return "Last active today"
  if (days === 1) return "Last active yesterday"
  if (days < 30) return `Last active ${days} days ago`
  if (days < 365) return `Last active ${Math.round(days / 30)} months ago`
  return `Last active ${(days / 365).toFixed(1)} years ago`
}

// Single custom "message a fan" glyph — one envelope outline with a heart
// centered inside — used everywhere the Message action appears so it reads
// as one consistent icon instead of a mix of emoji.
function EnvelopeHeartIcon({ size = 16, heartColor = "#FF2BAE" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 6.5L12 13L21 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M12 11.3c-.85-1.3-2.75-1.2-3.2.2-.4 1.1.6 2 3.2 3.7 2.6-1.7 3.6-2.6 3.2-3.7-.45-1.4-2.35-1.5-3.2-.2z" fill={heartColor} />
    </svg>
  )
}

// Builds the "quick preview" stats (tips / fans / earnings / top spender)
// shown when a free-tier user's import is blocked by the platform limit —
// same shape as onboarding's buildPreview(), minus paid-session handling,
// since this only needs to answer "what's in the file" for a soft paywall.
function buildImportPreview(rawText, platform) {
  if (!rawText) return null
  const rows = parseCSV(rawText, platform)
  if (!rows.length) return null
  const totalUsd = rows.reduce((sum, r) => sum + (r.usd || 0), 0)
  const fanTotals = rows.reduce((acc, r) => { acc[r.username] = (acc[r.username] || 0) + r.tokens; return acc }, {})
  const topSpender = Object.entries(fanTotals).sort((a, b) => b[1] - a[1])[0]
  return {
    tipsDetected: rows.length,
    fansDetected: Object.keys(fanTotals).length,
    estimatedEarnings: parseFloat(totalUsd.toFixed(2)),
    topSpender: topSpender ? topSpender[0] : null,
  }
}

// Sparkle burst — ports the same completion animation used in onboarding's
// "First Insights" step so the platform-limit preview feels visually
// consistent with a real completed import.
function ImportSparkle() {
  const ref = useRef()
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d'); c.width = window.innerWidth; c.height = window.innerHeight
    const COLS = ['#22D3EE', '#ffffff', '#EC4899', '#A78BFA', '#7C5CFF']
    const dots = Array.from({ length: 38 }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      r: Math.random() * 2.2 + 0.4, color: COLS[Math.floor(Math.random() * COLS.length)],
      alpha: Math.random() * 0.9 + 0.1, aDir: Math.random() > 0.5 ? 1 : -1, aSpd: Math.random() * 0.025 + 0.008,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
    }))
    let frame = 0, raf
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height)
      dots.forEach(d => {
        d.x += d.vx; d.y += d.vy; d.alpha += d.aDir * d.aSpd
        if (d.alpha >= 1) { d.alpha = 1; d.aDir = -1 }
        if (d.alpha <= 0) { d.alpha = 0; d.aDir = 1 }
        if (d.x < -4) d.x = c.width + 4; if (d.x > c.width + 4) d.x = -4
        if (d.y < -4) d.y = c.height + 4; if (d.y > c.height + 4) d.y = -4
        ctx.save(); ctx.globalAlpha = d.alpha; ctx.translate(d.x, d.y); ctx.fillStyle = d.color
        const s = d.r
        ctx.beginPath(); ctx.moveTo(0, -s * 2.5); ctx.lineTo(s * 0.5, -s * 0.5); ctx.lineTo(s * 2.5, 0); ctx.lineTo(s * 0.5, s * 0.5); ctx.lineTo(0, s * 2.5); ctx.lineTo(-s * 0.5, s * 0.5); ctx.lineTo(-s * 2.5, 0); ctx.lineTo(-s * 0.5, -s * 0.5); ctx.closePath(); ctx.fill(); ctx.restore()
      })
      frame++
      if (frame < 140) raf = requestAnimationFrame(draw)
      else { let op = 1; const fade = () => { op -= 0.06; ctx.globalAlpha = op; if (op > 0) requestAnimationFrame(fade); else ctx.clearRect(0, 0, c.width, c.height) }; fade() }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }} />
}

// Formats an ALREADY creator-local hour (its only caller reads
// platformTimes[...].hours, which is bucketed with toLocalHour). It used to
// treat the input as UTC and shift it by the BROWSER's offset — a second
// conversion in a different zone than the analytics.
const formatHour = (hour) => {
  const localHourIn = parseInt(hour)
  if (isNaN(localHourIn)) return "—"
  const h = ((localHourIn % 24) + 24) % 24
  if (h === 0) return "12 AM"
  if (h < 12) return `${h} AM`
  if (h === 12) return "12 PM"
  return `${h - 12} PM`
}

// ── FIX: Standalone copy button component so each item can have its own
// copied state WITHOUT calling useState inside a .map() callback.
// Rules of Hooks require hooks to only be called at the top level of a
// React function component — never inside loops, conditions, or callbacks.
// ── Title Generator extracted as a proper component so useState calls are legal
// ============================================================
// ROOM TITLE ENGINE — ONE TITLE AT A TIME
// Formula: HOOK + TARGET + ACTION + REWARD + URGENCY
// ============================================================

// ── TOY CATEGORY LIBRARY ────────────────────────────────────────────────────
// Each category has its own language — sensation, power, intensity, etc.
// Extend by adding new keys. Matched by detecting keywords in toy name.
const TOY_CATEGORIES = {
  lush: {
    sensation: ["I feel every tip inside me", "every vibration takes me higher", "I feel it deep with every tip"],
    control:   ["you control what I feel", "tip to decide my intensity", "you're inside my head right now"],
    buildup:   ["so close… keep going", "don't stop — I'm almost there", "one more tip and I lose it"],
  },
  domi: {
    sensation: ["the power hits different with every tip", "Domi doesn't hold back", "full intensity on command"],
    control:   ["you set the power level", "tip to push it harder", "Domi obeys you"],
    buildup:   ["turning it up with every tip", "building to max — don't stop", "almost at full power"],
  },
  edge: {
    sensation: ["edging myself with every tip", "tip to push me further", "so close to the edge"],
    control:   ["you decide when I fall", "tip to keep me on the edge", "you control the limit"],
    buildup:   ["closer… and closer…", "don't let me fall yet", "holding on as long as you tip"],
  },
  hush: {
    sensation: ["wearing it in public… tip to activate", "you have no idea what this does to me", "shh… I feel every one"],
    control:   ["secret control in your hands", "tip and watch my reaction", "nobody knows but you"],
    buildup:   ["getting harder to stay quiet", "one more tip and I can't hide it", "you're making this impossible"],
  },
  // Generic fallback for any other toy
  default: {
    sensation: ["I feel every tip", "tip = instant reaction", "every one hits harder"],
    control:   ["you decide what happens", "you run this room", "tip to take control"],
    buildup:   ["getting closer with every tip", "almost there — keep going", "don't stop now"],
  }
}

function getToyCategory(toyName) {
  if (!toyName) return null
  const t = toyName.toLowerCase()
  if (t.includes("lush"))  return TOY_CATEGORIES.lush
  if (t.includes("domi"))  return TOY_CATEGORIES.domi
  if (t.includes("edge"))  return TOY_CATEGORIES.edge
  if (t.includes("hush"))  return TOY_CATEGORIES.hush
  return TOY_CATEGORIES.default
}

// ── MOOD LIBRARY ─────────────────────────────────────────────────────────────
// Mood shapes the emotional tone of hooks and closers
const MOOD_HOOKS = {
  tease: [
    "let's see how far you take me",
    "I'm not giving it up that easy",
    "you have to earn it tonight",
    "almost… not yet",
    "make me want to",
  ],
  dominant: [
    "top tipper owns this room",
    "you earn what I give you",
    "prove you deserve it",
    "this is my show — tip to play",
    "I decide — you tip",
  ],
  submissive: [
    "I do what you say tonight",
    "you're in charge — tip to command me",
    "whatever you want, tip for it",
    "your wish is my reaction",
    "tell me what to do",
  ],
  hype: [
    "WE ARE SO CLOSE",
    "the energy in here is insane right now",
    "LET'S GOOO — tip to push it",
    "this room is on fire",
    "we're making history tonight",
  ],
  mystery: [
    "you won't believe what happens at goal",
    "something big is coming… tip to find out",
    "I have a surprise — help me get there",
    "you're not ready for what's next",
    "curious? tip to unlock it",
  ],
}

function buildOneTitle(ctx) {
  const {
    isPeakNow, peakSoon, bestHourLabel, hoursUntilPeak,
    hasWhales, topWhaleName, whaleCount,
    hasReturners, returningPct,
    lowActivity, todayIsBestDay, todayDay,
    tokenGoal, action, toy, mood,
    useEmojis, avgSessionUSD,
  } = ctx

  const e = (emoji) => useEmojis ? emoji : ""
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

  const hasToy  = Boolean(toy && toy.trim())
  const hasMood = Boolean(mood && mood !== "none")
  const toyLib  = getToyCategory(toy)

  // ── HOOKS ─────────────────────────────────────────────────────────────────
  // Priority: mood hooks > toy hooks > data hooks > evergreen
  const moodHooks   = hasMood ? (MOOD_HOOKS[mood] || []) : []
  const toyHooks    = hasToy ? [
    `tip to control my ${toy} ${e("🎮")}`,
    `you control my ${toy} ${e("⚡")}`,
    `my ${toy} is on — you decide ${e("😈")}`,
    `${toy} is live and waiting`,
    toyLib ? pick(toyLib.control) : `tip to run my ${toy}`,
  ] : []

  const dataHooks = [
    ...(isPeakNow      ? [`live right now ${e("🔴")}`, `going live this second`] : []),
    ...(peakSoon       ? [`going live in ${hoursUntilPeak}h — don't miss it`] : []),
    ...(lowActivity    ? [`miss me? ${e("👀")}`, `been a minute ${e("💭")}`] : []),
    ...(todayIsBestDay ? [`${todayDay}s hit different ${e("🔥")}`] : []),
    ...(hasWhales      ? [`VIPs run the show tonight ${e("💎")}`] : []),
  ]

  const evergreen = [
    `you decide what I do ${e("👑")}`,
    `top tipper controls everything`,
    `feeling dangerous tonight ${e("😈")}`,
    `not holding back tonight ${e("🔥")}`,
    `bad girl energy ${e("😈")}`,
    `catching me in a mood ${e("🌙")}`,
    `prove you want it ${e("👀")}`,
    `make me ${e("😏")}`,
  ]

  // Weight: if mood+toy both set, 50% mood, 50% toy; otherwise bias toward what's set
  let hookPool
  if (moodHooks.length && toyHooks.length) {
    hookPool = Math.random() < 0.5 ? moodHooks : toyHooks
  } else if (moodHooks.length) {
    hookPool = [...moodHooks, ...dataHooks, ...evergreen.slice(0, 4)]
  } else if (toyHooks.length) {
    hookPool = [...toyHooks, ...dataHooks.slice(0, 2), ...evergreen.slice(0, 3)]
  } else {
    hookPool = [...dataHooks, ...evergreen]
  }

  // ── GOAL TEXT ─────────────────────────────────────────────────────────────
  let goalText
  if (hasToy && tokenGoal && action) {
    goalText = pick([
      `hit ${tokenGoal} → ${action} + ${toy} reacts`,
      `${tokenGoal} tokens = ${action} & full ${toy} control`,
      `tip to reach ${tokenGoal} — ${toy} goes wild & you get ${action}`,
    ])
  } else if (hasToy && tokenGoal) {
    goalText = pick([
      `hit ${tokenGoal} → my ${toy} reacts`,
      `${tokenGoal} = full ${toy} control`,
      `tip to ${tokenGoal} — ${toy} goes crazy`,
      `get me to ${tokenGoal} and feel what happens`,
    ])
  } else if (hasToy && action) {
    goalText = pick([
      `tip → ${action} + ${toy} control`,
      `tip = ${action} & ${toy} reaction`,
      `unlock ${action} — ${toy} goes with it`,
    ])
  } else if (hasToy) {
    // Toy only — use toy library sensations
    goalText = toyLib
      ? pick([...toyLib.sensation, ...toyLib.control])
      : pick([`tip to control my ${toy}`, `tip = ${toy} reacts`, `tip to push my ${toy}`])
  } else if (tokenGoal && action) {
    goalText = pick([
      `hit ${tokenGoal} → ${action}`,
      `${tokenGoal} tokens = ${action}`,
      `tip to reach ${tokenGoal} & get ${action}`,
      `${tokenGoal} gets you ${action}`,
    ])
  } else if (tokenGoal) {
    goalText = pick([
      `help me hit ${tokenGoal}`,
      `tip to reach ${tokenGoal}`,
      `${tokenGoal} is the goal — push me there`,
      `so close to ${tokenGoal} — don't stop`,
    ])
  } else if (action) {
    goalText = pick([
      `tip → ${action}`,
      `tip = ${action}`,
      `unlock ${action}`,
      `tip and I ${action}`,
    ])
  } else if (hasMood) {
    // Mood only — use buildup or mystery phrasing
    goalText = pick([
      "tip to decide what happens next",
      "tip to take this further",
      "tip = reaction",
      "tip and see what I do",
    ])
  } else {
    goalText = pick([
      "tip to take control",
      "tip = instant reaction",
      "tip to decide what happens",
      "tip to run this room",
    ])
  }

  // ── REWARDS ───────────────────────────────────────────────────────────────
  // Toy → sensation rewards; Mood → mood-matched rewards; fallback → general
  let rewards
  if (hasToy && toyLib) {
    rewards = [
      ...toyLib.sensation,
      ...toyLib.buildup,
      `${toy} goes full power ${e("⚡")}`,
      `full ${toy} control ${e("👑")}`,
      ...(action ? [`${action} + ${toy} reaction`] : []),
    ]
  } else if (hasMood && mood === "tease") {
    rewards = [
      `and maybe I give you what you want ${e("😏")}`,
      `but you have to earn it first`,
      `if you're lucky tonight ${e("👀")}`,
      `I might just let go ${e("💋")}`,
    ]
  } else if (hasMood && mood === "dominant") {
    rewards = [
      `you earn your reward ${e("👑")}`,
      `top earner gets access ${e("🔒")}`,
      `I reward the ones who prove it`,
      `exclusive access for top tipper`,
    ]
  } else if (hasMood && mood === "hype") {
    rewards = [
      `something HUGE happens at goal ${e("🔥")}`,
      `biggest reaction of the night ${e("⚡")}`,
      `I go all out ${e("🔥")}`,
    ]
  } else {
    rewards = [
      ...(action ? [`${action} ${e("😏")}`, `you get ${action}`] : []),
      `special reaction ${e("🔥")}`,
      `private show ${e("💎")}`,
      `you choose everything ${e("👑")}`,
      `I react to every tip ${e("⚡")}`,
      `exclusive content ${e("🔒")}`,
      `big surprise ${e("🎁")}`,
    ]
  }

  // ── URGENCY ───────────────────────────────────────────────────────────────
  const urgencies = [
    ...(isPeakNow ? ["live now", "happening right now"] : []),
    ...(peakSoon  ? [`${hoursUntilPeak}h left`, "starting soon"] : []),
    "tonight only",
    "this hour only",
    "now or never",
    "before I log off",
    "don't miss it",
    "limited time",
    "while I'm in this mood",
    "live now",
  ]

  const hook    = pick(hookPool)
  const reward  = pick(rewards)
  const urgency = pick(urgencies)

  // ── 9 DISTINCT STRUCTURES — varied rhythm, length, tone ──────────────────
  // Includes short punchy, mid-length emotional, and longer descriptive forms
  const n = Math.floor(Math.random() * 9)
  let title

  if (n === 0) {
    // Classic formula — mid length
    title = `${hook} ${e("💦")} ${goalText} → ${reward} (${urgency})`
  } else if (n === 1) {
    // Reward-first — payoff leads
    title = `${reward} ${e("🔥")} — ${goalText} • ${urgency}`
  } else if (n === 2) {
    // Short punchy — goal = reward only
    title = `${goalText} = ${reward} ${e("🔥")} • ${urgency}`
  } else if (n === 3) {
    // Mystery — hook leads with curiosity gap
    title = `${hook}… ${goalText} (${urgency}) ${e("👀")}`
  } else if (n === 4) {
    // FOMO urgency first — time pressure leads
    title = `${urgency.toUpperCase()} ${e("⚡")} ${hook} — ${goalText}`
  } else if (n === 5) {
    // Power dynamic — three-beat structure
    title = `${hook} • ${goalText} • ${reward} (${urgency})`
  } else if (n === 6) {
    // Clean CTA — minimal noise
    title = `${goalText} ${e("→")} ${reward} ${e("💋")} ${urgency}`
  } else if (n === 7) {
    // Emotional / tease — conversational, no formula markers
    title = `${hook}… ${reward} ${e("😈")} (${urgency})`
  } else {
    // Buildup — toyLib.buildup or mood closer if available
    const closer = hasToy && toyLib ? pick(toyLib.buildup) : (hasMood ? pick(MOOD_HOOKS[mood] || [reward]) : reward)
    title = `${hook} ${e("💦")} ${goalText} — ${closer} (${urgency})`
  }

  // Sanitize
  title = title.replace(/\s{2,}/g, " ").replace(/→\s*→/g, "→").trim()
  if (title.length > 100) title = title.slice(0, 97) + "..."

  // ── DRIVERS ───────────────────────────────────────────────────────────────
  const drivers = []
  if (isPeakNow || peakSoon) drivers.push("peak hour timing")
  if (hasWhales)             drivers.push(`${whaleCount} VIP fans`)
  if (todayIsBestDay)        drivers.push(`${todayDay} is your best day`)
  if (lowActivity)           drivers.push("low recent activity")
  if (tokenGoal)             drivers.push(`${tokenGoal} token goal`)
  if (hasToy)                drivers.push(`${toy} (${getToyCategory(toy) === TOY_CATEGORIES.lush ? "wearable" : toy.toLowerCase().includes("domi") ? "wand" : "toy"})`)
  if (hasMood && mood !== "none") drivers.push(`${mood} mood`)
  if (action)                drivers.push(`reward: ${action}`)
  if (hasReturners)          drivers.push(`${returningPct}% returning fans`)
  if (drivers.length === 0)  drivers.push("general engagement")

  return { title, drivers }
}

// ============================================================
// HASHTAG GENERATOR — standalone component
// ============================================================
const HASHTAG_POOLS_HG = {
  platform: {
    Chaturbate:  ['#Chaturbate','#CBLive','#ChaturbateModel','#CB','#ChaturbateLive','#ChaturbateGirl'],
    BongaCams:   ['#BongaCams','#BongaLive','#BCModel','#BongaCamsLive','#BongaCamsGirl'],
    MyFreeCams:  ['#MyFreeCams','#MFC','#MFCModel','#MFCShare','#MyFreeCamsModel'],
    Stripchat:   ['#Stripchat','#StripchatLive','#StripchatModel','#StripchatGirl'],
    CamSoda:     ['#CamSoda','#CamSodaLive','#CamSodaModel'],
    Any:         ['#CamGirl','#Webcam','#LiveStream','#AdultStream','#LiveCam'],
  },
  toy: {
    Lush:        ['#Lush','#LushControl','#ControlMyLush','#LushVibrator','#InteractiveToy','#TipToControl'],
    Domi:        ['#Domi','#DomiControl','#ControlMyDomi','#Lovense','#InteractiveToy','#TipToControl'],
    Edge:        ['#Edge','#LovenseEdge','#InteractiveToy','#TipToControl','#Lovense'],
    Hush:        ['#Hush','#LovenseHush','#InteractiveToy','#TipToControl','#Lovense'],
    Interactive: ['#InteractiveShow','#TipToControl','#LiveShow','#InteractiveToy','#Lovense'],
    None:        ['#TipMenu','#GoalShow','#LiveNow','#TipToDecide'],
  },
  vibe: {
    tease:       ['#TeasingYou','#SlowBurn','#EarnIt','#NaughtyStream','#BadGirl'],
    dominant:    ['#BossMode','#YouObey','#InControl','#BadGirl','#DominantVibes'],
    submissive:  ['#YouDecide','#YouControl','#GoodGirl','#YourWish','#SubVibes'],
    hype:        ['#LiveNow','#TipGoal','#GoGoGo','#HighEnergy','#LetsDo'],
    mystery:     ['#Surprise','#TonightOnly','#SecretShow','#MysteryReward','#FindOut'],
    none:        ['#LiveNow','#TipMenu','#StreamLife','#OnlineNow'],
  },
  goal:        ['#TokenGoal','#GoalShow','#TipToFinish','#AlmostThere','#TipMenu','#HelpMeHitGoal'],
  highTraffic: ['#CamGirl','#LiveStream','#AdultStream','#WebcamModel','#OnlineFun','#NSFW','#AdultContent'],
  content:     ['#CamModel','#OnlineStar','#StreamerLife','#LiveEntertainment','#CamLife'],
}

function generateHashtagsHG({ platform, toy, mood, hasGoal, count = 15 }) {
  const tags = new Set()
  const platTags = HASHTAG_POOLS_HG.platform[platform] || HASHTAG_POOLS_HG.platform.Any
  platTags.slice(0, 3).forEach(t => tags.add(t))
  HASHTAG_POOLS_HG.platform.Any.slice(0, 2).forEach(t => tags.add(t))
  const toyTags = HASHTAG_POOLS_HG.toy[toy] || HASHTAG_POOLS_HG.toy.None
  toyTags.slice(0, 4).forEach(t => tags.add(t))
  const vibeTags = HASHTAG_POOLS_HG.vibe[mood] || HASHTAG_POOLS_HG.vibe.none
  vibeTags.slice(0, 3).forEach(t => tags.add(t))
  if (hasGoal) HASHTAG_POOLS_HG.goal.slice(0, 2).forEach(t => tags.add(t))
  HASHTAG_POOLS_HG.highTraffic.forEach(t => { if (tags.size < count) tags.add(t) })
  HASHTAG_POOLS_HG.content.forEach(t => { if (tags.size < count) tags.add(t) })
  return Array.from(tags).slice(0, count)
}

function HashtagGenerator({ C, glassCard, defaultPlatform = "Chaturbate" }) {
  const [platform, setPlatform] = useState(defaultPlatform)
  const [toy, setToy] = useState("None")
  const [mood, setMood] = useState("none")
  const [hasGoal, setHasGoal] = useState(false)
  const [count, setCount] = useState(15)
  const [hashtags, setHashtags] = useState([])
  const [copied, setCopied] = useState(false)
  const [copiedTag, setCopiedTag] = useState(null)

  const generate = () => {
    const tags = generateHashtagsHG({ platform, toy, mood, hasGoal, count })
    setHashtags(tags)
  }

  const copyAll = () => {
    navigator.clipboard.writeText(hashtags.join(' ')).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const copyOne = (tag) => {
    navigator.clipboard.writeText(tag).catch(() => {})
    setCopiedTag(tag)
    setTimeout(() => setCopiedTag(null), 1500)
  }

  const inp = {
    padding: '8px 12px', borderRadius: 8, fontSize: 13,
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: C.white, outline: 'none', width: '100%', boxSizing: 'border-box',
  }
  const lbl = { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, display: 'block' }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.white, marginBottom: 4 }}># Hashtag Generator</div>
        <div style={{ fontSize: 13, color: C.muted }}>Platform-specific hashtags for your stream — mix of high-traffic and niche</div>
      </div>

      <div style={{ ...glassCard, borderRadius: 16, padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 20 }}>
          <div>
            <label style={lbl}>Platform</label>
            <select value={platform} onChange={e => setPlatform(e.target.value)} style={inp}>
              {['Chaturbate','BongaCams','MyFreeCams','Stripchat','CamSoda','Any'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Toy</label>
            <select value={toy} onChange={e => setToy(e.target.value)} style={inp}>
              {['None','Lush','Domi','Edge','Hush','Interactive'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Mood / Vibe</label>
            <select value={mood} onChange={e => setMood(e.target.value)} style={inp}>
              {[['none','No mood'],['tease','Tease'],['dominant','Dominant'],['submissive','Submissive'],['hype','Hype'],['mystery','Mystery']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>How many</label>
            <select value={count} onChange={e => setCount(parseInt(e.target.value))} style={inp}>
              {[10,12,15,18,20].map(n => <option key={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={hasGoal} onChange={e => setHasGoal(e.target.checked)} style={{ accentColor: C.cyan }} />
            Include token goal hashtags
          </label>
        </div>

        <button onClick={generate} style={{
          padding: '10px 28px', borderRadius: 9,
          background: 'linear-gradient(135deg, #22D3EE, #EC4899)',
          border: 'none', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>
          # Generate Hashtags
        </button>
      </div>

      {hashtags.length > 0 && (
        <div style={{ ...glassCard, borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.white }}>
              {hashtags.length} hashtags generated
            </div>
            <button onClick={copyAll} style={{
              padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: copied ? 'rgba(16,185,129,0.2)' : 'rgba(34,211,238,0.1)',
              border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'rgba(34,211,238,0.3)'}`,
              color: copied ? '#10B981' : C.cyan, cursor: 'pointer',
            }}>
              {copied ? '✓ Copied All!' : '📋 Copy All'}
            </button>
          </div>

          {/* Tag cloud */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {hashtags.map(tag => (
              <button key={tag} onClick={() => copyOne(tag)} style={{
                padding: '6px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                background: copiedTag === tag ? 'rgba(16,185,129,0.15)' : 'rgba(124,92,255,0.1)',
                border: `1px solid ${copiedTag === tag ? 'rgba(16,185,129,0.4)' : 'rgba(124,92,255,0.25)'}`,
                color: copiedTag === tag ? '#10B981' : '#A78BFA',
                fontWeight: 500, transition: 'all 0.15s',
              }}>
                {copiedTag === tag ? '✓' : ''}{tag}
              </button>
            ))}
          </div>

          {/* Full text for easy copy-paste */}
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: C.muted, lineHeight: 1.7, wordBreak: 'break-all' }}>
            {hashtags.join(' ')}
          </div>
        </div>
      )}
    </div>
  )
}


function scoreTitle(title, ctx) {
  let score = 0
  const t = title.toLowerCase()
  // Length: 45-80 chars is ideal
  const len = title.length
  if (len >= 45 && len <= 80)      score += 20
  else if (len >= 30 && len < 45)  score += 12
  else if (len > 80 && len <= 100) score += 10
  else                             score += 4
  // Urgency
  if (/tonight|live now|right now|\d+h left|now or never|this hour|before i|don't miss|limited|starting soon/i.test(t)) score += 25
  else if (/tonight|live|now|only|soon|miss/i.test(t)) score += 14
  else score += 5
  // Token/goal clarity
  if (ctx.tokenGoal && title.includes(String(ctx.tokenGoal))) score += 25
  else if (/\d{2,}/.test(title))   score += 14
  else if (/goal|hit|reach/i.test(t)) score += 8
  // Action/reward clarity
  if (ctx.action && t.includes(ctx.action.toLowerCase())) score += 25
  else if (/tip|control|unlock|react|win|earn|reward/i.test(t)) score += 14
  else score += 5
  // Emoji
  if (/\p{Emoji_Presentation}/u.test(title)) score += 5
  return Math.min(score, 100)
}

// Game-based title generation engine
function buildGameTitles(game, { mood = 'none', tokenGoal = 0, toy = '' }) {
  const ENGINES = {
    'Spin the Wheel': {
      short: 'wheel', verb: 'Spin',
      tags: ['#spinthewheel', '#wheelgame', '#chatdecides', '#interactive', '#live'],
      hooks: ['Spin it and see', 'The wheel is waiting', 'Let the wheel decide', 'Spin for it', 'Chat spins next', 'Wheel goes tonight'],
    },
    'Roll the Dice': {
      short: 'dice', verb: 'Roll',
      tags: ['#rolldice', '#dicegame', '#chatdecides', '#interactive', '#live'],
      hooks: ['Dice decide', 'Roll it. Risk it.', 'Your roll', 'Feeling lucky?', 'Roll for it', 'Dice night'],
    },
    'Truth or Dare': {
      short: 'dare', verb: 'Dare',
      tags: ['#truthordare', '#dare', '#chatdecides', '#interactive', '#live'],
      hooks: ['Truth or dare?', 'I dare you', 'Make me choose', 'Your dare', 'Dare me', 'Come closer'],
    },
  }
  const MOOD_MAP = {
    none: { adj: '', cap: '' }, tease: { adj: 'teasing', cap: 'Teasing' },
    dominant: { adj: 'dominant', cap: 'Dominant' }, submissive: { adj: 'soft', cap: 'Soft' },
    hype: { adj: 'chaotic', cap: 'Chaotic' }, mystery: { adj: 'mysterious', cap: 'Mystery' },
  }
  const g = ENGINES[game]; if (!g) return []
  const m = MOOD_MAP[mood] || MOOD_MAP.none
  const hasMood = mood !== 'none', hasGoal = tokenGoal > 0, hasToy = !!toy
  const toyName = toy ? toy.toLowerCase() : ''
  const results = []; const used = new Set()
  const rand = arr => arr[Math.floor(Math.random() * arr.length)]
  const hook = rand(g.hooks)
  const hook2 = g.hooks.find(h => h !== hook) || g.hooks[0]

  const add = (title, hashtags, why) => {
    if (used.has(title) || title.length > 150 || title.length < 4) return
    used.add(title)
    const len = title.length
    const lengthLabel = len < 45 ? 'Punchy' : len <= 70 ? 'Sweet Spot' : 'Long'
    results.push({ title, charCount: len, lengthLabel, hashtags: hashtags.slice(0, 5), whyItWorks: why })
  }

  // Punchy combos
  if (!hasMood && !hasGoal && !hasToy) {
    add(hook, g.tags, 'Short, curious, and action-based.')
    add(hook2, g.tags, 'Makes the game feel like something viewers can enter.')
  }
  if (hasGoal && !hasMood && !hasToy) {
    add(`Goal unlocks the ${g.short}`, [...g.tags.slice(0,3), '#goal', '#unlock'], 'Clearly connects the goal to the reward.')
    add(`Hit ${tokenGoal}, ${g.short === 'dare' ? 'dare starts' : g.short === 'dice' ? 'dice roll' : `spin the ${g.short}`}`, [...g.tags.slice(0,2), '#goalpush', '#unlock', '#tips'], 'Direct and easy to understand fast.')
  }
  if (hasMood && !hasGoal && !hasToy) {
    add(`${m.cap} ${g.short} night`, [...g.tags.slice(0,2), `#${m.adj}`, '#gamenight', '#live'], 'Gives the room a clear fun event identity.')
    add(`${m.cap} ${g.short === 'dare' ? 'dares' : g.short === 'dice' ? 'rolls' : 'spins'} only`, [...g.tags.slice(0,2), `#${m.adj}`, '#flirtyvibes', '#live'], 'Combines mood and game without getting too long.')
  }
  if (hasToy && !hasMood && !hasGoal) {
    add(`${g.verb} for toy mode`, [...g.tags.slice(0,2), '#toy', '#chatfun', '#live'], 'Makes the game feel directly connected to the toy.')
    add(`${g.short.charAt(0).toUpperCase() + g.short.slice(1)} decides the toy`, [...g.tags.slice(0,2), '#toy', '#tipactivated', '#interactive'], `Makes the ${g.short} outcome feel meaningful.`)
  }
  if (hasGoal && hasMood && !hasToy) {
    add(`${m.cap} ${g.short} goal`, [...g.tags.slice(0,2), `#${m.adj}`, '#goalpush', '#unlock'], 'Short but specific — mood, game, and goal in one.')
    add(`Goal unlocks lucky ${g.short}`, [...g.tags.slice(0,2), '#goal', '#unlock', '#live'], 'Adds mood and payoff in a compact way.')
  }
  if (hasGoal && hasToy && !hasMood) {
    add(`${g.short.charAt(0).toUpperCase() + g.short.slice(1)} unlocks toy mode`, [...g.tags.slice(0,2), '#toy', '#goal', '#unlock'], 'Connects tipping, toy, and game in one hook.')
    add(`Toy ${g.short} round at goal`, [...g.tags.slice(0,2), '#toygoal', '#goalpush', '#interactive'], 'Ties the toy reward directly to the goal.')
  }
  if (hasMood && hasToy && !hasGoal) {
    add(`${m.cap} toy ${g.short}`, [...g.tags.slice(0,2), '#toy', `#${m.adj}`, '#live'], 'Compact, clear, and multi-layered.')
    add(`${m.cap} toy ${g.short === 'dare' ? 'dares' : g.short === 'dice' ? 'rolls' : 'spins'} tonight`, [...g.tags.slice(0,2), '#toy', '#interactive', '#live'], 'Blends vibe, toy, and game in a readable way.')
  }
  if (hasGoal && hasMood && hasToy) {
    add(`${m.cap} toy ${g.short} goal`, [...g.tags.slice(0,2), '#toygoal', '#unlock', '#live'], 'All selected options while staying short.')
    add(`Goal unlocks the ${m.adj} toy ${g.short}`, [...g.tags.slice(0,2), '#goal', '#toy', '#unlock'], 'Clearly shows the reward without overexplaining.')
  }
  if (results.length === 0) {
    add(hook, g.tags, 'Short, curious, and action-based.')
    add(hook2, g.tags, 'Makes the game feel like something viewers can enter.')
  }

  // Sweet Spot combos (45–70 chars)
  if (!hasGoal && !hasMood && !hasToy) {
    add(`Don't just watch — chat decides with the ${g.short}`, [...g.tags.slice(0,3), '#chatgame', '#joinme'], 'Invites participation and makes the game feel viewer-driven.')
    add(`${hook} — next round starts when you tip`, [...g.tags.slice(0,3), '#tips', '#gamenight'], 'Creates a tip incentive tied directly to the game.')
  } else if (hasGoal && !hasMood && !hasToy) {
    add(`Chat decides — ${g.short} unlocks at ${tokenGoal} tokens`, [...g.tags.slice(0,3), '#goal', '#chatdecides'], 'Makes the goal feel tied to a specific rewarding event.')
    add(`${hook} — ${g.short} starts when goal drops`, [...g.tags.slice(0,2), '#goalpush', '#gamenight', '#interactive'], 'Creates a clear before-and-after event.')
  } else if (hasMood && !hasGoal && !hasToy) {
    add(`Feeling ${m.adj} — ${g.short === 'dare' ? 'truth or dare' : `${g.short}s`} decide tonight`, [...g.tags.slice(0,3), '#chatfun', '#interactive'], 'Adds mood and a sense of player control.')
    add(`${m.cap} ${g.short} vibes — chat chooses the next round`, [...g.tags.slice(0,3), '#chatdecides', '#live'], 'Sets a mood and invites the audience in.')
  } else if (hasToy && !hasMood && !hasGoal) {
    add(`${g.short.charAt(0).toUpperCase() + g.short.slice(1)} decides the toy — one tip changes it`, [...g.tags.slice(0,2), '#toy', '#chatcontrol', '#tipactivated'], 'Makes tips feel directly tied to an interactive outcome.')
    add(`Toy activated — ${g.short} decides the next move`, [...g.tags.slice(0,2), '#toy', '#interactive', '#tipactivated'], 'Creates curiosity about what comes next.')
  } else {
    const ctx = [hasMood ? `${m.adj} vibes` : null, hasToy ? `${toyName} on` : null, hasGoal ? `goal: ${tokenGoal}` : null].filter(Boolean)
    add(`${hook} — ${ctx.join(', ')}`, [...g.tags.slice(0,3), hasGoal ? '#unlock' : '#live', hasToy ? '#toy' : '#chatfun'].slice(0,5), 'Stacks all selected inputs in a scannable hook.')
    add(`Chat decides with ${g.short}${hasToy ? ` + ${toyName}` : ''}${hasGoal ? ` — goal: ${tokenGoal}` : ''}`, [...g.tags.slice(0,3), hasGoal ? '#goal' : '#interactive', hasToy ? '#toy' : '#live'].slice(0,5), 'Communicates all features without sounding stuffed.')
  }

  // Long title (only if under 5 results and fits 71–150)
  if (results.length < 5) {
    const longParts = [hook, hasMood ? `${m.adj} energy` : null, hasToy ? `${toyName} activated` : null, hasGoal ? `goal: ${tokenGoal} tokens` : null, `${g.short} decides`].filter(Boolean)
    const longTitle = longParts.join(' — ')
    if (longTitle.length >= 71 && longTitle.length <= 150) add(longTitle, g.tags, "Full description of the room's interactive setup.")
  }
  return results.slice(0, 5)
}

function TitleGenerator({ C, glassCard, analytics, tips, sessions, whales, timezone = 'UTC' }) {
  const [innerTab,  setInnerTab]  = useState("quick")

  // Quick tab state
  const [qMood,     setQMood]     = useState("none")
  const [qGoal,     setQGoal]     = useState("")
  const [qToy,      setQToy]      = useState("")          // replaces qPlatform
  const [qTitle,    setQTitle]    = useState(null)
  const [qCopied,   setQCopied]   = useState(false)
  const [qCopyAnim, setQCopyAnim] = useState(false)

  // Heart / liked
  const [likedTitles, setLikedTitles] = useState([])
  const [hearts,      setHearts]      = useState([])
  const [qLiked,      setQLiked]      = useState(false)

  // Settings panel
  const [show5Mode,  setShow5Mode]  = useState(false)
  const [showLiked,  setShowLiked]  = useState(false)

  // Advanced tab state
  const [titles,      setTitles]      = useState([])
  const [gameTitles,  setGameTitles]  = useState([])
  const [copied,      setCopied]      = useState(null)
  const [copiedHtags, setCopiedHtags] = useState(null)
  const [likedGame,   setLikedGame]   = useState(new Set())
  const [tokenGoal,   setTokenGoal]   = useState(0)
  const [action,      setAction]      = useState("")
  const [toy,         setToy]         = useState("")
  const [mood,        setMood]        = useState("none")
  const [gameType,    setGameType]    = useState("none")
  const [useEmojis,   setUseEmojis]   = useState(true)

  const buildCtx = (overrides = {}) => {
    const now = new Date()
    // Creator-local, NOT the browser clock. This is compared against
    // bestHour below (canonicalBestTimes.bestWindow.localHour, creator-local),
    // so reading the browser's hour made "Peak NOW"/"Peak in Xh" wrong by the
    // offset between the two zones for any creator not sitting in their own
    // saved timezone.
    const currentHour = toLocalHour(now.toISOString(), timezone)
    const todayDay = now.toLocaleDateString("en-US", { weekday: "long" })
    // Generic "peak" claim (the Title Generator's chips say "Peak NOW"/"Peak
    // in Xh" — no "today" framing), so this reads canonicalBestTimes.
    // bestWindow directly — same source as the command-bar Peak Window KPI
    // — instead of the legacy analytics.bestHour, with its own second,
    // hand-rolled mean-based fallback calculated from `sessions` right here
    // when analytics.bestHour was absent. That fallback was a third
    // independent "best hour" formula that could disagree with both the
    // legacy field it backstopped and the canonical engine; the canonical
    // engine already has its own confidence-tiered handling for sparse data,
    // so no local fallback calculation is needed here at all.
    const bestHour = analytics?.canonicalBestTimes?.bestWindow
      ? analytics.canonicalBestTimes.bestWindow.localHour
      : null
    // bestHour is already a local hour — format directly, no offset needed
    const fmtLocalHour = h => h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`
    const bestHourLabel = (bestHour === null || isNaN(bestHour)) ? null : fmtLocalHour(bestHour)
    const hoursUntilPeak = bestHour !== null ? (bestHour - currentHour + 24) % 24 : 99
    const isPeakNow = hoursUntilPeak <= 1
    const peakSoon = hoursUntilPeak <= 3 && !isPeakNow
    // meaningfulSessions — same canonical population the Overview KPI card and
    // the Daily Brief now use. Previously read the page-level `sessions`
    // (= analytics.sessions = allValidSessions), giving the Title Generator a
    // third, lower average than the two figures shown on Overview.
    const _ctxSessions = analytics?.meaningfulSessions || []
    const avgSessionUSD = _ctxSessions.length
      ? _ctxSessions.reduce((s, x) => s + (x.totalUSD || 0), 0) / _ctxSessions.length : 0
    return {
      isPeakNow, peakSoon, bestHour, bestHourLabel, hoursUntilPeak,
      tokenGoal: overrides.tokenGoal !== undefined ? overrides.tokenGoal : tokenGoal,
      action:    overrides.action    !== undefined ? overrides.action    : action,
      toy:       overrides.toy       !== undefined ? overrides.toy       : toy,
      mood:      overrides.mood      !== undefined ? overrides.mood      : mood,
      useEmojis: overrides.useEmojis !== undefined ? overrides.useEmojis : useEmojis,
      avgSessionUSD,
    }
  }

  const generateQuick = () => {
    const ctx = buildCtx({ mood: qMood, tokenGoal: parseInt(qGoal) || 0, action: "", toy: qToy })
    setQTitle(buildOneTitle(ctx))
    setQCopied(false); setQCopyAnim(false); setQLiked(false)
  }

  const copyQuick = () => {
    if (!qTitle) return
    navigator.clipboard.writeText(qTitle.title).catch(() => {})
    setQCopied(true); setQCopyAnim(true)
    setTimeout(() => { setQCopied(false); setQCopyAnim(false) }, 1800)
  }

  const likeQuick = () => {
    if (!qTitle || qLiked) return
    setQLiked(true)
    setLikedTitles(prev => prev.find(t => t.title === qTitle.title) ? prev : [{ title: qTitle.title, drivers: qTitle.drivers, likedAt: Date.now() }, ...prev])
    const newHearts = Array.from({ length: 6 }, (_, i) => ({ id: Date.now() + i, x: 30 + Math.random() * 40, delay: i * 80 }))
    setHearts(h => [...h, ...newHearts])
    setTimeout(() => setHearts(h => h.filter(hh => !newHearts.find(n => n.id === hh.id))), 1600)
  }

  const generateAdvanced = useCallback(() => {
    if (gameType !== "none") {
      setGameTitles(buildGameTitles(gameType, { mood, tokenGoal, toy }))
      setCopied(null); setCopiedHtags(null)
      return
    }
    const ctx = buildCtx()
    const results = []
    let attempts = 0
    while (results.length < 5 && attempts < 25) {
      const { title, drivers } = buildOneTitle(ctx)
      if (!results.find(r => r.title === title)) results.push({ title, drivers, score: scoreTitle(title, ctx) })
      attempts++
    }
    results.sort((a, b) => b.score - a.score)
    setTitles(results); setCopied(null)
  }, [tokenGoal, action, toy, mood, gameType, useEmojis, analytics, tips, sessions, whales])

  const copyGameTitle = (title, i) => {
    navigator.clipboard.writeText(title).catch(() => {})
    setCopied(i); setTimeout(() => setCopied(null), 1800)
  }
  const copyGameHashtags = (tags, i) => {
    navigator.clipboard.writeText(tags.join(' ')).catch(() => {})
    setCopiedHtags(i); setTimeout(() => setCopiedHtags(null), 1800)
  }
  const copyGameBoth = (title, tags) => {
    navigator.clipboard.writeText(`${title}\n${tags.join(' ')}`).catch(() => {})
  }
  const likeGameTitle = (title, i) => {
    setLikedGame(prev => { const next = new Set(prev); next.add(i); return next })
    setLikedTitles(prev => prev.find(t => t.title === title) ? prev : [{ title, drivers: [], likedAt: Date.now() }, ...prev])
    const newHearts = Array.from({ length: 4 }, (_, j) => ({ id: Date.now() + j, x: 20 + Math.random() * 60, delay: j * 100 }))
    setHearts(h => [...h, ...newHearts])
    setTimeout(() => setHearts(h => h.filter(hh => !newHearts.find(n => n.id === hh.id))), 1600)
  }
  const copyAdv = (title, i) => {
    navigator.clipboard.writeText(title).catch(() => {})
    setCopied(i); setTimeout(() => setCopied(null), 1800)
  }

  // Stats chips — peak timing (data) + static stats
  const ctx0 = buildCtx()
  const chips = []
  if (ctx0.isPeakNow && ctx0.bestHourLabel)     chips.push({ label: `🔴 Peak NOW (${ctx0.bestHourLabel})`, color: C.orange })
  else if (ctx0.peakSoon && ctx0.bestHourLabel) chips.push({ label: `⏳ Peak in ${ctx0.hoursUntilPeak}h (${ctx0.bestHourLabel})`, color: C.gold })
  chips.push({ label: `✍️ 3,000+ titles generated`, color: C.cyan })
  chips.push({ label: `📈 ~30% more tips rotating titles`, color: C.green })

  const optStyle = { background: "#1a1f2e", color: "#f0f2f6" }
  const inp = {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
    padding: "8px 10px", borderRadius: 9, color: C.white, outline: "none",
    fontSize: 13, boxSizing: "border-box", width: "100%",
  }
  const lbl = { fontSize: 10, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }
  const tabBtn = (id) => ({
    padding: "7px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
    background: innerTab === id ? "rgba(255,255,255,0.07)" : "transparent",
    color: innerTab === id ? C.white : C.muted,
    borderBottom: innerTab === id ? `2px solid ${C.pink}` : "2px solid transparent",
  })

  const Toggle = ({ on, onToggle }) => (
    <div onClick={onToggle} style={{ width: 32, height: 18, borderRadius: 9, cursor: "pointer", position: "relative", flexShrink: 0, background: on ? C.pink : "rgba(255,255,255,0.12)", transition: "background 0.2s" }}>
      <div style={{ position: "absolute", top: 3, left: on ? 16 : 3, width: 12, height: 12, borderRadius: "50%", background: C.white, transition: "left 0.2s" }} />
    </div>
  )

  const lenColor = (label) => label === 'Punchy' ? C.green : label === 'Sweet Spot' ? C.gold : C.orange

  return (
    <div style={{ paddingTop: 0 }}>
      <style>{`
        @keyframes floatHeart { 0% { transform: translateY(0) scale(1); opacity: 1; } 60% { opacity: 1; } 100% { transform: translateY(-80px) scale(1.4); opacity: 0; } }
        @keyframes copyPop { 0% { transform: scale(1); } 40% { transform: scale(1.12); } 100% { transform: scale(1); } }
        @keyframes heartPop { 0% { transform: scale(1); } 30% { transform: scale(1.35); } 60% { transform: scale(0.9); } 100% { transform: scale(1); } }
      `}</style>

      {/* HEADER + SETTINGS */}
      <div style={{ display: "flex", gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.white, marginBottom: 6 }}>🎬 Room Title Generator</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {chips.map((c, i) => (
              <span key={i} style={{ fontSize: 10, fontWeight: 600, color: c.color, padding: "2px 8px", borderRadius: 20, background: `${c.color}12`, border: `1px solid ${c.color}24` }}>{c.label}</span>
            ))}
          </div>
        </div>
        <div style={{ flexShrink: 0, minWidth: 160, padding: "9px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 7 }}>Settings</div>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: 7 }}>
            <span style={{ fontSize: 11, color: C.text }}>Generate 5 titles</span>
            <Toggle on={show5Mode} onToggle={() => setShow5Mode(v => !v)} />
          </label>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <span style={{ fontSize: 11, color: C.text }}>Liked ({likedTitles.length})</span>
            <Toggle on={showLiked} onToggle={() => setShowLiked(v => !v)} />
          </label>
        </div>
      </div>

      {/* LIKED TITLES PANEL */}
      {showLiked && (
        <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(236,72,153,0.05)", border: "1px solid rgba(236,72,153,0.18)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.pink, marginBottom: 6 }}>❤️ Liked Titles</div>
          {likedTitles.length === 0 ? (
            <div style={{ fontSize: 11, color: C.muted }}>No liked titles yet — hit ❤️ on any title to save it.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {likedTitles.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 9px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ flex: 1, fontSize: 12, color: C.white, lineHeight: 1.4 }}>{t.title}</div>
                  <button onClick={() => navigator.clipboard.writeText(t.title).catch(() => {})} style={{ flexShrink: 0, padding: "4px 8px", borderRadius: 6, fontSize: 10, cursor: "pointer", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: C.muted }}>📋</button>
                  <button onClick={() => setLikedTitles(prev => prev.filter((_, j) => j !== i))} style={{ flexShrink: 0, padding: "4px 7px", borderRadius: 6, fontSize: 10, cursor: "pointer", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)", color: "#ef4444" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB BAR */}
      <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 12 }}>
        <button style={tabBtn("quick")}    onClick={() => setInnerTab("quick")}>⚡ Quick</button>
        <button style={tabBtn("advanced")} onClick={() => setInnerTab("advanced")}>⚙️ Advanced</button>
        <button style={tabBtn("hashtags")} onClick={() => setInnerTab("hashtags")}># Hashtags</button>
      </div>

      {/* ── QUICK TAB ── */}
      {innerTab === "quick" && (
        <div>
          {/* 3 controls: Mood | Goal | Toy */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={lbl}>Mood</div>
              <select value={qMood} onChange={e => setQMood(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="none" style={optStyle}>Auto</option>
                <option value="tease" style={optStyle}>Tease</option>
                <option value="dominant" style={optStyle}>Dominant</option>
                <option value="submissive" style={optStyle}>Submissive</option>
                <option value="hype" style={optStyle}>Hype</option>
                <option value="mystery" style={optStyle}>Mystery</option>
              </select>
            </div>
            <div>
              <div style={lbl}>Token goal</div>
              <input type="number" value={qGoal} onChange={e => setQGoal(e.target.value)} style={inp} placeholder="e.g. 500" />
            </div>
            <div>
              <div style={lbl}>Toy</div>
              <select value={qToy} onChange={e => setQToy(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="" style={optStyle}>No toy</option>
                <option value="Lush" style={optStyle}>Lush</option>
                <option value="Domi" style={optStyle}>Domi</option>
                <option value="Edge" style={optStyle}>Edge</option>
                <option value="Hush" style={optStyle}>Hush</option>
                <option value="interactive toy" style={optStyle}>Interactive</option>
              </select>
            </div>
          </div>

          <Button onClick={generateQuick} style={{ width: "100%", marginBottom: 10 }}>
            ✨ Generate Title →
          </Button>

          {/* OUTPUT — above fold */}
          {qTitle ? (
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "100%", pointerEvents: "none", overflow: "hidden" }}>
                {hearts.map(h => (
                  <div key={h.id} style={{ position: "absolute", bottom: 20, left: `${h.x}%`, fontSize: 20, animation: `floatHeart 1.4s ease-out ${h.delay}ms forwards` }}>❤️</div>
                ))}
              </div>
              <div style={{ ...glassCard, borderRadius: 12, padding: "14px 14px", border: "1px solid rgba(236,72,153,0.28)", background: "linear-gradient(135deg, rgba(236,72,153,0.07), rgba(124,92,255,0.07))" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>Generated Title</div>
                  <div style={{ fontSize: 9, color: lenColor(qTitle.lengthLabel || 'Punchy'), fontWeight: 700 }}>
                    {qTitle.title.length} chars · {qTitle.lengthLabel || (qTitle.title.length < 45 ? 'Punchy' : qTitle.title.length <= 70 ? 'Sweet Spot' : 'Long')}
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.white, lineHeight: 1.4, marginBottom: 10 }}>{qTitle.title}</div>
                <div style={{ display: "flex", gap: 7, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(qTitle.drivers || []).map((d, i) => (
                      <span key={i} style={{ fontSize: 9, color: C.cyan, padding: "2px 6px", borderRadius: 20, background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.18)" }}>{d}</span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={generateQuick} style={{ padding: "6px 11px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: C.muted }}>↻</button>
                    <button onClick={copyQuick} style={{ padding: "6px 13px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", background: qCopied ? "rgba(16,185,129,0.2)" : "linear-gradient(135deg, #22D3EE, #EC4899)", border: qCopied ? "1px solid rgba(16,185,129,0.4)" : "none", color: C.white, animation: qCopyAnim ? "copyPop 0.3s ease" : "none" }}>
                      {qCopied ? "✔ Copied!" : "📋 Copy"}
                    </button>
                    <button onClick={likeQuick} style={{ padding: "6px 11px", borderRadius: 8, fontSize: 14, cursor: qLiked ? "default" : "pointer", background: qLiked ? "rgba(236,72,153,0.18)" : "rgba(255,255,255,0.06)", border: `1px solid ${qLiked ? "rgba(236,72,153,0.4)" : "rgba(255,255,255,0.12)"}`, animation: qLiked ? "heartPop 0.4s ease" : "none", opacity: qLiked ? 0.8 : 1 }}>
                      {qLiked ? "❤️" : "🤍"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "22px 20px", color: C.muted, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 24, marginBottom: 5 }}>🎬</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Your title will appear here</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>Pick a mood and hit Generate</div>
            </div>
          )}

          {/* 5-title mode when toggled */}
          {show5Mode && (
            <div style={{ marginTop: 14 }}>
              <Button onClick={generateAdvanced} style={{ width: "100%", padding: "10px 0", fontSize: 13, marginBottom: 10 }}>✨ Generate 5 Titles</Button>
              {titles.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {titles.map((t, i) => {
                    const scoreColor = t.score >= 85 ? C.green : t.score >= 70 ? C.gold : C.orange
                    const tLen = t.title.length
                    const tLabel = tLen < 45 ? 'Punchy' : tLen <= 70 ? 'Sweet Spot' : 'Long'
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, background: copied === i ? "rgba(16,185,129,0.05)" : "rgba(255,255,255,0.03)", border: `1px solid ${copied === i ? "rgba(16,185,129,0.28)" : "rgba(255,255,255,0.07)"}`, transition: "all 0.18s" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: copied === i ? C.green : C.white, lineHeight: 1.4, wordBreak: "break-word", marginBottom: 2 }}>{t.title}</div>
                          <div style={{ fontSize: 9, color: lenColor(tLabel) }}>{tLen} chars · {tLabel}</div>
                        </div>
                        <div style={{ textAlign: "center", flexShrink: 0, minWidth: 36 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: scoreColor }}>{t.score}</div>
                          <div style={{ fontSize: 8, color: C.muted }}>/100</div>
                        </div>
                        <button onClick={() => copyAdv(t.title, i)} style={{ flexShrink: 0, padding: "6px 11px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", background: copied === i ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.07)", border: `1px solid ${copied === i ? "rgba(16,185,129,0.38)" : "rgba(255,255,255,0.1)"}`, color: copied === i ? C.green : C.muted }}>
                          {copied === i ? "✓" : "📋"}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* VIRAL FORMULA — below fold, always there */}
          <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 12, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.18)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#6366F1", marginBottom: 6 }}>⚡ Viral Room Title Formula</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 10 }}>Hook + Control + Urgency</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
              {[
                { label: 'Hook', desc: 'Makes them stop scrolling', examples: ['"Don\'t just watch"', '"Only if you can keep up"', '"Feeling dangerous"', '"Your move"'] },
                { label: 'Control', desc: 'Makes them feel involved', examples: ['"chat decides"', '"spin the wheel"', '"roll the dice"', '"one tip changes it"'] },
                { label: 'Urgency', desc: 'Reason to click now', examples: ['"almost unlocked"', '"goal is close"', '"wheel is waiting"', '"tonight only"'] },
              ].map((col, i) => (
                <div key={i}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", marginBottom: 4 }}>{col.label}</div>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>{col.desc}</div>
                  {col.examples.map((ex, j) => (
                    <div key={j} style={{ fontSize: 10, color: C.text, marginBottom: 2 }}>{ex}</div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[
                '"Don\'t just watch — chat decides tonight"',
                '"Spin it and see — goal is almost unlocked"',
                '"Your move — dice decide the next round"',
                '"Only if you can keep up — wheel starts at goal"',
              ].map((ex, i) => (
                <div key={i} style={{ fontSize: 11, color: C.textMid || C.text, padding: "5px 8px", borderRadius: 7, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.1)", fontStyle: "italic" }}>{ex}</div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 10, color: C.muted, lineHeight: 1.6 }}>
              💡 <strong style={{ color: C.text }}>Rotate your title every 20–30 min</strong> — platforms rank active streams higher on the top page when titles change frequently.
            </div>
          </div>
        </div>
      )}

      {/* ── ADVANCED TAB ── */}
      {innerTab === "advanced" && (
        <div>
          {/* Row 1: Goal | Reward | Mood */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={lbl}>Token goal</div>
              <input type="number" value={tokenGoal || ""} onChange={e => setTokenGoal(Number(e.target.value) || 0)} style={inp} placeholder="e.g. 500" />
            </div>
            <div>
              <div style={lbl}>Reward</div>
              <input value={action} onChange={e => setAction(e.target.value)} style={inp} placeholder="flash, strip…" />
            </div>
            <div>
              <div style={lbl}>Mood</div>
              <select value={mood} onChange={e => setMood(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="none" style={optStyle}>Auto</option>
                <option value="tease" style={optStyle}>Tease</option>
                <option value="dominant" style={optStyle}>Dominant</option>
                <option value="submissive" style={optStyle}>Submissive</option>
                <option value="hype" style={optStyle}>Hype</option>
                <option value="mystery" style={optStyle}>Mystery</option>
              </select>
            </div>
          </div>
          {/* Row 2: Toy | Game/Event | Emojis */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div>
              <div style={lbl}>Toy</div>
              <select value={toy} onChange={e => setToy(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="" style={optStyle}>No toy</option>
                <option value="Lush" style={optStyle}>Lush</option>
                <option value="Domi" style={optStyle}>Domi</option>
                <option value="Edge" style={optStyle}>Edge</option>
                <option value="Hush" style={optStyle}>Hush</option>
                <option value="interactive toy" style={optStyle}>Interactive</option>
              </select>
            </div>
            <div>
              <div style={lbl}>Game / Event</div>
              <select value={gameType} onChange={e => { setGameType(e.target.value); setGameTitles([]) }} style={{ ...inp, cursor: "pointer" }}>
                <option value="none" style={optStyle}>None</option>
                <option value="Spin the Wheel" style={optStyle}>Spin the Wheel</option>
                <option value="Roll the Dice" style={optStyle}>Roll the Dice</option>
                <option value="Truth or Dare" style={optStyle}>Truth or Dare</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, color: C.text }}>
                <input type="checkbox" checked={useEmojis} onChange={() => setUseEmojis(v => !v)} style={{ accentColor: C.pink }} />
                Include emojis
              </label>
            </div>
          </div>

          <Button onClick={generateAdvanced} style={{ width: "100%", padding: "11px 0", marginBottom: 12 }}>
            {gameType !== "none" ? `🎲 Generate ${gameType} Titles` : "✨ Generate 5 Titles"}
          </Button>

          {/* GAME TITLES OUTPUT */}
          {gameType !== "none" && gameTitles.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
                {gameType}{toy ? ` + ${toy}` : ''}{tokenGoal > 0 ? ` + Goal: ${tokenGoal}` : ''}{mood !== 'none' ? ` + ${mood.charAt(0).toUpperCase() + mood.slice(1)}` : ''}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                {gameTitles.map((t, i) => (
                  <div key={i} style={{ padding: "12px 14px", borderRadius: 11, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    {/* Title + char info */}
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.white, lineHeight: 1.45, marginBottom: 4 }}>{t.title}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, color: lenColor(t.lengthLabel), fontWeight: 700 }}>{t.charCount} chars · {t.lengthLabel}</span>
                      <span style={{ fontSize: 10, color: C.muted, fontStyle: "italic" }}>"{t.whyItWorks}"</span>
                    </div>
                    {/* Hashtags */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                      {t.hashtags.map((tag, j) => (
                        <span key={j} style={{ fontSize: 10, color: "#6366F1", padding: "2px 6px", borderRadius: 6, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>{tag}</span>
                      ))}
                    </div>
                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => copyGameTitle(t.title, i)} style={{ padding: "5px 10px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer", background: copied === i ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.07)", border: `1px solid ${copied === i ? "rgba(16,185,129,0.38)" : "rgba(255,255,255,0.12)"}`, color: copied === i ? C.green : C.muted }}>
                        {copied === i ? "✓ Copied" : "📋 Copy Title"}
                      </button>
                      <button onClick={() => copyGameHashtags(t.hashtags, i)} style={{ padding: "5px 10px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer", background: copiedHtags === i ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.07)", border: `1px solid ${copiedHtags === i ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.12)"}`, color: copiedHtags === i ? "#6366F1" : C.muted }}>
                        {copiedHtags === i ? "✓ Copied" : "# Copy Tags"}
                      </button>
                      <button onClick={() => copyGameBoth(t.title, t.hashtags)} style={{ padding: "5px 10px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: C.muted }}>
                        📋 Copy Both
                      </button>
                      <button onClick={() => likeGameTitle(t.title, i)} style={{ padding: "5px 10px", borderRadius: 7, fontSize: 12, cursor: likedGame.has(i) ? "default" : "pointer", background: likedGame.has(i) ? "rgba(236,72,153,0.18)" : "rgba(255,255,255,0.07)", border: `1px solid ${likedGame.has(i) ? "rgba(236,72,153,0.4)" : "rgba(255,255,255,0.12)"}`, animation: likedGame.has(i) ? "heartPop 0.4s ease" : "none" }}>
                        {likedGame.has(i) ? "❤️" : "🤍"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Floating hearts for game likes */}
              <div style={{ position: "relative", height: 0, overflow: "visible", pointerEvents: "none" }}>
                {hearts.map(h => (
                  <div key={h.id} style={{ position: "absolute", bottom: 0, left: `${h.x}%`, fontSize: 18, animation: `floatHeart 1.4s ease-out ${h.delay}ms forwards` }}>❤️</div>
                ))}
              </div>
            </div>
          )}

          {/* REGULAR 5-TITLE OUTPUT (when no game selected) */}
          {gameType === "none" && titles.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 12 }}>
              {titles.map((t, i) => {
                const scoreColor = t.score >= 85 ? C.green : t.score >= 70 ? C.gold : C.orange
                const tLen = t.title.length
                const tLabel = tLen < 45 ? 'Punchy' : tLen <= 70 ? 'Sweet Spot' : 'Long'
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, background: copied === i ? "rgba(16,185,129,0.05)" : "rgba(255,255,255,0.03)", border: `1px solid ${copied === i ? "rgba(16,185,129,0.28)" : "rgba(255,255,255,0.07)"}`, transition: "all 0.18s" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: copied === i ? C.green : C.white, lineHeight: 1.4, wordBreak: "break-word", marginBottom: 2 }}>{t.title}</div>
                      <div style={{ fontSize: 9, color: lenColor(tLabel) }}>{tLen} chars · {tLabel}</div>
                    </div>
                    <div style={{ textAlign: "center", flexShrink: 0, minWidth: 36 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: scoreColor }}>{t.score}</div>
                      <div style={{ fontSize: 8, color: C.muted }}>/100</div>
                    </div>
                    <button onClick={() => copyAdv(t.title, i)} style={{ flexShrink: 0, padding: "6px 11px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", background: copied === i ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.07)", border: `1px solid ${copied === i ? "rgba(16,185,129,0.38)" : "rgba(255,255,255,0.1)"}`, color: copied === i ? C.green : C.muted }}>
                      {copied === i ? "✓" : "📋"}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 9 }}>
            <div style={{ fontSize: 11, color: C.gold }}>💡 Rotate your title every 20–30 min — platforms rank active streams higher on the top page when titles change frequently.</div>
          </div>
        </div>
      )}

      {/* ── HASHTAGS TAB ── */}
      {innerTab === "hashtags" && (
        <HashtagGenerator C={C} glassCard={glassCard} defaultPlatform="Chaturbate" />
      )}
    </div>
  )
}

function CopyButton({ text, label = "📋 Copy", copiedLabel = "✅ Copied!", style = {} }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      style={{
        padding: "7px 14px", borderRadius: 8,
        background: copied ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)",
        border: `1px solid ${copied ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.1)"}`,
        color: copied ? C.green : C.muted,
        fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
        ...style
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}

export default function Dashboard() {
  const router = useRouter()
  // Open directly to a specific tab when ?tab=X is in the URL
  const initialTab = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('tab') || localStorage.getItem('camcash_tab') || 'overview')
    : 'overview'
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  // Which tabs this browser has ever opened — powers the onboarding
  // checklist's action items (report/whales/live) without a DB write.
  const [visitedTabs, setVisitedTabs] = useState(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('camcash_visited_tabs') || '[]') } catch (_) { return [] }
  })
  const [promoCodeInput, setPromoCodeInput] = useState('')
  const [promoCodeStatus, setPromoCodeStatus] = useState(null) // { type: 'success'|'error', message }
  const [promoCodeSubmitting, setPromoCodeSubmitting] = useState(false)
  const [showPromoPopover, setShowPromoPopover] = useState(false)
  const [tips, setTips] = useState([])
  const [paidSessions, setPaidSessions] = useState([])
  const [liveTipsTotalUSD, setLiveTipsTotalUSD] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [liveAnalytics, setLiveAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  // Import flow: idle -> processing -> success | error
  const [importStage, setImportStage] = useState('idle')
  const [importMessageIdx, setImportMessageIdx] = useState(0)
  const importMessageTimerRef = useRef(null)
  const uploading = importStage === 'processing'
  const [uploadPlatform, setUploadPlatform] = useState("")
  const [lastUploadResult, setLastUploadResult] = useState(null)
  // Platform-limit soft paywall: preview of what's in a blocked import, shown
  // instead of a hard block (see denyWithPlatformPreview / handleCSV below)
  const [lockedPreview, setLockedPreview] = useState(null)
  const [showImportSparkle, setShowImportSparkle] = useState(false)
  const [activeTab, setActiveTab] = useState(initialTab)
  const [toast, setToast] = useState("")
  const [uploadCount, setUploadCount] = useState(0)
  const [meaningfulOnly, setMeaningfulOnly] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedWhale, setSelectedWhale] = useState(null)
  const [messageTarget, setMessageTarget] = useState(null)
  const [messageIndex, setMessageIndex] = useState(0)
  const [messageCopied, setMessageCopied] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [upgradeModalSource, setUpgradeModalSource] = useState(null)
  const [fanSearchOpen, setFanSearchOpen] = useState(false)
  const [fanSearchQuery, setFanSearchQuery] = useState("")
  const [shareModalOpen, setShareModalOpen] = useState(false)
  // Element that had focus right before the fan profile modal opened, so we
  // can return focus to it (the "View Fan" button) once the modal closes.
  // Set synchronously in the "View Fan" onClick (via e.currentTarget) rather
  // than read back from document.activeElement in an effect — by the time a
  // passive effect runs, the modal's autoFocus has already moved focus onto
  // the close button, so reading activeElement here would just capture that.
  const whaleModalTriggerRef = useRef(null)
  // Stash a promo code from an email CTA link (/dashboard?promo=CAMCASH-XXXXXX)
  // into localStorage right away. A signed-out visitor gets bounced through
  // /login -> /landing -> back here (or through /onboarding first, for a
  // brand-new user), and the query string does not survive that round trip —
  // localStorage does, so the auth-check effect below can pick it back up
  // once we actually know the user is signed in and staying on this page.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const promoParam = new URLSearchParams(window.location.search).get('promo')
    if (promoParam) {
      localStorage.setItem('camcash_pending_promo', promoParam.trim().toUpperCase())
    }
  }, [])
  useEffect(() => {
    if (selectedWhale) {
      const onKeyDown = (e) => { if (e.key === "Escape") setSelectedWhale(null) }
      document.addEventListener("keydown", onKeyDown)
      return () => {
        document.removeEventListener("keydown", onKeyDown)
        if (whaleModalTriggerRef.current && typeof whaleModalTriggerRef.current.focus === "function") {
          whaleModalTriggerRef.current.focus()
        }
      }
    }
  }, [selectedWhale])
  // ── LIVE MODE STATE ───────────────────────────────────────
  const [liveActive, setLiveActive] = useState(false)
  const [liveStartTime, setLiveStartTime] = useState(null)
  // The single canonical Live Mode session engine (live_sessions table) —
  // same hook app/live/page.js uses. Mirrors its status into liveActive/
  // liveStartTime, which the Overview command bar's momentum widget reads.
  const liveEngine = useLiveSessionEngine()
  useEffect(() => {
    const status = liveEngine.serverSession?.status
    setLiveActive(status === 'live')
    setLiveStartTime(status === 'live' && liveEngine.serverSession?.started_at ? new Date(liveEngine.serverSession.started_at) : null)
  }, [liveEngine.serverSession?.status, liveEngine.serverSession?.started_at])
  const [liveEvents, setLiveEvents] = useState([])
  // ── SESSION REPLAY (Live Mode Sessions tab) ───────────────────────────
  // Read-only history of past Live Mode sessions, pulled directly from
  // live_sessions/coaching_events — the single source of truth every other
  // surface (dashboard live bar, /live, the extension) also reads from.
  // No local engine, no recomputed coaching — this only ever renders what
  // already happened.
  const [replaySessions, setReplaySessions] = useState([])
  const [replayLoading, setReplayLoading] = useState(false)
  const [replayLoaded, setReplayLoaded] = useState(false)
  const [expandedReplayId, setExpandedReplayId] = useState(null)
  const [replayCoachingEvents, setReplayCoachingEvents] = useState({})
  const [replayCoachingLoading, setReplayCoachingLoading] = useState(null)

  useEffect(() => {
    if (activeTab !== 'live-sessions' || replayLoaded || !user) return
    setReplayLoading(true)
    supabase
      .from('live_sessions')
      .select('id, stream_platform, started_at, ended_at, total_paused_seconds, session_earnings_usd, session_tokens, tip_count, unique_tipper_count, largest_tip_usd, session_resolution_type, is_inaccurate')
      .eq('user_id', user.id)
      .eq('status', 'ended')
      .order('started_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setReplaySessions(data || [])
        setReplayLoading(false)
        setReplayLoaded(true)
      })
  }, [activeTab, replayLoaded, user])

  const loadReplayCoachingEvents = (sessionId) => {
    if (replayCoachingEvents[sessionId]) return
    setReplayCoachingLoading(sessionId)
    supabase
      .from('coaching_events')
      .select('id, type, priority, title, message, action_status, shown_at')
      .eq('session_id', sessionId)
      .order('shown_at', { ascending: true })
      .then(({ data }) => {
        setReplayCoachingEvents(prev => ({ ...prev, [sessionId]: data || [] }))
        setReplayCoachingLoading(null)
      })
  }
  const [liveGoalTokens, setLiveGoalTokens] = useState(0)
  const [livePlatform, setLivePlatform] = useState('Chaturbate')
  const [liveTick, setLiveTick] = useState(0)
  const [minuteTick, setMinuteTick] = useState(0) // increments every 60s to refresh time-based alerts
  const [betaCount, setBetaCount] = useState(null)
  const [earlyAccessSubmitting, setEarlyAccessSubmitting] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackType, setFeedbackType] = useState('feature')
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [tipPage, setTipPage] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [tokenRates, setTokenRates] = useState({ ...PLATFORM_TOKEN_RATES })
  const [showRateEditor, setShowRateEditor] = useState(false)
  // ── ROUND 1 FEATURES ─────────────────────────────────────────────
  const [monthlyGoal, setMonthlyGoal] = useState(null)
  const [goalInput, setGoalInput] = useState('')
  const [showGoalEditor, setShowGoalEditor] = useState(false)
  const [tipperNotes, setTipperNotes] = useState({}) // { username: { note, followUp } }
  const [noteTarget, setNoteTarget] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [engineInsights, setEngineInsights] = useState(null)

  // ── ANIMATION STATE ──────────────────────────────────────
  const [counterBumping, setCounterBumping] = useState(false)
  const [lastUpdatedSection, setLastUpdatedSection] = useState(null)
  const [newAlertKey, setNewAlertKey] = useState(0)
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [newTipCount, setNewTipCount] = useState(0)
  const [flashTipId, setFlashTipId] = useState(null)   // for new-tip highlight animation
  const prevTipCountRef = useRef(0)
  const realtimeChannelRef = useRef(null)
  const liveTipsChannelRef = useRef(null)
  const refreshTimerRef = useRef(null)
  const liveTickerRef = useRef(null)
  const derivedCacheRef = useRef({}) // see memoOn() — caches expensive per-render recomputation below
  // Fingerprint (row count + last row id) of the tips array as of the last runEngine()
  // call, from ANY trigger (initial load, realtime batch, or the 30s timer itself).
  // Lets the 30s timer skip the expensive recompute when nothing has changed.
  const lastEngineTipsFingerprintRef = useRef(null)
  // Batches Realtime `tips` INSERT events so a burst of inserts triggers one
  // runEngine() pass instead of one per row. See flushPendingTipInserts below.
  const pendingTipInsertsRef = useRef([])
  const tipFlushTimerRef = useRef(null)
  const tipBatchStartRef = useRef(0)
  // ── LIVE MODE INTELLIGENCE ────────────────────────────────────────────
  const [liveStrategy, setLiveStrategy]       = useState('balanced')
  const [coachingHistory, setCoachingHistory] = useState([])
  const prevPhaseRef       = useRef(null)
  const isHydratingHistory = useRef(false)
  const processedTipIds    = useRef(new Set())
  const coachingCooldowns  = useRef({})
  const firedAlertsLog     = useRef([])
  const phaseChangeLog     = useRef([])

  const isBetaUser = true
  const isPro = isProPlan(profile)
  // Whether to SAY "free trial" in upgrade copy.
  //
  // This used to also require !profile?.stripe_customer_id, on the reasoning
  // that anyone who had been a Stripe customer might already have used a
  // trial. That was wrong twice over. A stripe_customer_id is created when
  // checkout OPENS, so abandoning checkout — or having a card declined —
  // permanently downgraded the creator's copy to the plain price, which is
  // exactly backwards: someone who just tried to pay and failed is the person
  // most worth offering a trial to. It also silently hid this copy from the
  // owner's own test account, making the feature look unshipped.
  //
  // It is moot now regardless: the 7-day trial lives on the Stripe PRICE
  // (recurring.trial_period_days), so every subscription created from it
  // trials, whatever the customer's history. Promising a trial to any non-Pro
  // creator is therefore accurate, not optimistic.
  const trialEligible = !isPro
  const uploadLimit = Infinity

  const fmtHour = h => { if (h == null || isNaN(h)) return 'N/A'; return h === 0 ? '12 AM' : h < 12 ? h+' AM' : h === 12 ? '12 PM' : (h-12)+' PM' }

  const openUpgradeModal = (source) => {
    track('upgrade_click', { source })
    logEvent('paywall_hit', { feature: source })
    setUpgradeModalSource(source || 'default')
    setShowUpgradeModal(true)
  }

  // ── PRO PREVIEW IMPRESSION TRACKING ─────────────────────────────────────
  // One event (pro_preview_viewed) with a `feature` property, not a
  // separate event per locked surface — so "which Pro value proposition
  // caused engagement" is one queryable dimension, not N event names.
  // Distinct from upgrade_click/paywall_hit (fired by openUpgradeModal
  // above, the CLICK side of the funnel on every CTA already) — this is
  // the IMPRESSION side: the free user actually saw the locked preview,
  // whether or not they clicked it. Deduped per session via a ref so
  // re-renders of the same surface don't spam the event.
  const proPreviewFiredRef = useRef(new Set())
  const trackProPreviewViewed = (feature) => {
    if (proPreviewFiredRef.current.has(feature)) return
    proPreviewFiredRef.current.add(feature)
    logEvent('pro_preview_viewed', { feature })
  }

  const redeemPromoCode = async () => {
    const code = promoCodeInput.trim()
    if (!code || promoCodeSubmitting) return
    setPromoCodeSubmitting(true)
    setPromoCodeStatus(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/promo/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPromoCodeStatus({ type: 'error', message: data.error || 'Could not redeem that code.' })
        return
      }
      setProfile(p => ({ ...(p || {}), plan: 'pro', plan_expires_at: data.plan_expires_at }))
      setPromoCodeInput('')
      setPromoCodeStatus({ type: 'success', message: `Pro unlocked! You're covered through ${new Date(data.plan_expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.` })
      track('promo_code_redeemed', { code })
    } catch (e) {
      setPromoCodeStatus({ type: 'error', message: 'Something went wrong. Please try again.' })
    } finally {
      setPromoCodeSubmitting(false)
    }
  }

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3500) }

  // ── SAVE TIPPER NOTE ─────────────────────────────────────────────
  const saveTipperNote = async (username, note, followUp = false) => {
    if (!user) return
    setNoteSaving(true)
    try {
      await supabase.from('tipper_notes').upsert({
        user_id: user.id,
        tipper_username: username.toLowerCase(),
        note,
        follow_up: followUp,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,tipper_username' })
      setTipperNotes(prev => ({ ...prev, [username.toLowerCase()]: { note, followUp } }))
      showToast('✅ Note saved')
      setNoteTarget(null)
    } catch(e) { showToast('❌ Failed to save note') }
    finally { setNoteSaving(false) }
  }

  // ── SAVE MONTHLY GOAL ─────────────────────────────────────────────
  const saveMonthlyGoal = async (amount) => {
    if (!user || !amount) return
    const target = parseFloat(amount)
    if (isNaN(target) || target <= 0) return
    try {
      await supabase.from('user_goals').upsert({
        user_id: user.id,
        goal_type: 'monthly',
        target_usd: target,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,goal_type' })
      setMonthlyGoal(target)
      setShowGoalEditor(false)
      showToast(`✅ Goal set: $${target.toFixed(0)}/month`)
    } catch(e) { showToast('❌ Failed to save goal') }
  }

  // Tab persistence
  const handleTabChange = (tab) => {
    logEvent('tab_switched', { tab_name: tab })
    // Live Mode is the one tab that's ENTIRELY a locked Pro preview for
    // free users (see the isPro gate a few hundred lines below) — this is
    // the funnel's "Pro preview viewed" step for that surface specifically,
    // fired at the moment of actually landing on it, not just clicking an
    // upgrade CTA (which upgrade_click/paywall_hit already cover elsewhere).
    if (tab === 'live' && !isPro) trackProPreviewViewed('live_mode')
    setActiveTab(tab)
    if (typeof window !== 'undefined') {
      localStorage.setItem('camcash_tab', tab)
      // Scroll both window and the main content div to top
      window.scrollTo({ top: 0, behavior: 'instant' })
      document.querySelector('.dash-main')?.scrollTo({ top: 0, behavior: 'instant' })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }
  }

  // Record every tab this browser opens, for the onboarding checklist —
  // watches activeTab directly rather than wrapping every setActiveTab call
  // site (Sidebar and the "Go Live" button both set it without going
  // through handleTabChange).
  useEffect(() => {
    if (!activeTab || visitedTabs.includes(activeTab)) return
    const next = [...visitedTabs, activeTab]
    setVisitedTabs(next)
    try { localStorage.setItem('camcash_visited_tabs', JSON.stringify(next)) } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // Counter bump when new tips arrive
  useEffect(() => {
    if (newTipCount > prevTipCountRef.current) {
      setCounterBumping(true)
      setLastUpdatedSection('tips')
      setTimeout(() => setCounterBumping(false), 320)
      setTimeout(() => setLastUpdatedSection(null), 2500)
    }
    prevTipCountRef.current = newTipCount
  }, [newTipCount])

  // ── EXTENSION LISTENER — receives tips from Chrome extension ────────────
  useEffect(() => {
    const handleExtensionMessage = (event) => {
      if (event.source !== window) return
      if (event.data?.type !== 'CAMCASH_TIP_EVENT') return
      const { event: tipEvent } = event.data
      if (!tipEvent || !tipEvent.username) return

      // Deduplication: extension may fire the same event twice on reload
      const dedupKey = tipEvent.id || `${tipEvent.username}:${tipEvent.tokens}:${tipEvent.timestamp}`
      if (processedTipIds.current.has(dedupKey)) return
      processedTipIds.current.add(dedupKey)

      const tokens  = parseInt(tipEvent.tokens) || 0
      const usd     = parseFloat(tipEvent.usd)  || 0
      const normalized = {
        _id:              dedupKey,
        _isHistory:       false,
        username:         tipEvent.username,
        tokens,
        usd,
        normalizedRevenue: usd > 0 ? usd : parseFloat((tokens * tokenRate(tipEvent.platform)).toFixed(2)),
        sourceUsed:       usd > 0 ? 'usd' : 'tokens',
        timestamp:        new Date(tipEvent.timestamp || Date.now()),
        platform:         tipEvent.platform || 'Unknown',
        source:           'extension',
      }
      setLiveEvents(prev => [...prev, normalized])
      // Auto-activate live mode on first real tip
      setLiveActive(active => {
        if (!active) setLiveStartTime(prev => prev || new Date())
        return true
      })
    }
    window.addEventListener('message', handleExtensionMessage)
    return () => window.removeEventListener('message', handleExtensionMessage)
  }, [])

  // ── LIVE TIPS: historical hydration + realtime subscription ─────────────
  // Runs whenever the live tab is opened and a user is present.
  // SAFETY RULES:
  //   1. Singleton — only one channel ever; skips if already subscribed
  //   2. isHydratingHistory.current = true during the initial DB query so
  //      coaching / alerts / animations are suppressed for stale data
  //   3. Every event is checked against processedTipIds before processing
  //   4. Historical events get _isHistory:true so computeState() excludes
  //      them from timing/pace calculations (only uses them for totals)
  useEffect(() => {
    if (activeTab !== 'live-sessions' || !user) return
    if (liveTipsChannelRef.current) return // singleton guard

    isHydratingHistory.current = true
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

    supabase
      .from('live_tips')
      .select('*')
      .eq('user_id', user.id)
      .gte('received_at', since)
      .order('received_at', { ascending: true })
      .then(({ data }) => {
        if (data?.length) {
          const normalized = data.map(tip => {
            const id = tip.id
            processedTipIds.current.add(id)
            return {
              _id:              id,
              _isHistory:       true,
              username:         tip.username || 'Unknown',
              tokens:           parseInt(tip.tokens) || 0,
              usd:              parseFloat(tip.usd) || 0,
              normalizedRevenue: parseFloat(tip.usd) || parseFloat(((tip.tokens || 0) * tokenRate(tip.platform)).toFixed(2)),
              sourceUsed:       tip.source || 'extension',
              timestamp:        new Date(tip.received_at),
              platform:         tip.platform || 'extension',
              source:           'history',
            }
          })
          setLiveEvents(prev => {
            const existingIds = new Set(prev.map(e => e._id).filter(Boolean))
            return [...prev, ...normalized.filter(t => !existingIds.has(t._id))]
          })
        }
        isHydratingHistory.current = false
      })

    const channel = supabase
      .channel(`live_tips_dash_${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_tips',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (isHydratingHistory.current) return
        const tip = payload.new
        if (!tip?.id) return
        if (processedTipIds.current.has(tip.id)) return
        processedTipIds.current.add(tip.id)

        const normalized = {
          _id:              tip.id,
          _isHistory:       false,
          username:         tip.username || 'Unknown',
          tokens:           parseInt(tip.tokens) || 0,
          usd:              parseFloat(tip.usd) || 0,
          normalizedRevenue: parseFloat(tip.usd) || parseFloat(((tip.tokens || 0) * tokenRate(tip.platform)).toFixed(2)),
          sourceUsed:       tip.source || 'extension',
          timestamp:        new Date(tip.received_at),
          platform:         tip.platform || 'extension',
          source:           'extension',
        }
        setLiveEvents(prev => [...prev, normalized])
        setLiveActive(prev => {
          if (!prev) setLiveStartTime(st => st || new Date())
          return true
        })
      })
      .subscribe()

    liveTipsChannelRef.current = channel

    return () => {
      if (liveTipsChannelRef.current) {
        supabase.removeChannel(liveTipsChannelRef.current)
        liveTipsChannelRef.current = null
      }
      isHydratingHistory.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user])

  useEffect(() => {
    // Stripe redirects here with ?success=true&plan=X after checkout
    // completes (app/api/stripe/checkout/route.js's success_url) — this was
    // previously unhandled: no funnel event, no user-visible confirmation
    // that the upgrade actually went through. Closes the funnel's final
    // step (signup->import->first-insight->pro-preview->upgrade-click->
    // checkout-started->subscription-completed). Strips the query params
    // after firing so a page refresh doesn't double-count.
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('success') === 'true') {
        logEvent('subscription_completed', { plan_type: params.get('plan') || null })
        window.history.replaceState({}, '', window.location.pathname)
      } else if (params.get('canceled') === 'true') {
        logEvent('checkout_canceled', {})
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
  }, [])

  useEffect(() => {
    // Restore saved tab
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('camcash_tab')
      if (saved) setActiveTab(saved)
    }
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace("/login"); return }
      // Users who never finished importing any data (abandoned onboarding
      // right after entering their username, or landed here directly) would
      // otherwise sit on a permanently empty dashboard with no forcing
      // function to go back and connect a data source — send them to the
      // guided import flow instead. Gated on onboarding_complete too, so a
      // returning user who finished onboarding and later deleted all their
      // uploads isn't bounced into a redirect loop (/onboarding sends
      // onboarding_complete=true users straight back to /dashboard) — they
      // just see the normal empty-state dashboard with its Import CTA.
      Promise.all([
        supabase.from('tips').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('beta_users').select('onboarding_complete').eq('user_id', user.id).maybeSingle(),
      ]).then(([{ count }, { data: beta }]) => {
        if (count === 0 && !beta?.onboarding_complete) { router.replace('/onboarding'); return }
        // Signed in and staying on the dashboard — safe to redeem a promo
        // code stashed by the effect above from an email CTA link.
        if (typeof window !== 'undefined') {
          const pendingPromo = localStorage.getItem('camcash_pending_promo')
          if (pendingPromo) {
            setPromoCodeInput(pendingPromo)
            setShowPromoPopover(true)
            localStorage.removeItem('camcash_pending_promo')
          }
        }
      })
      setUser(user)
      supabase.from('profiles')
        .select('plan, plan_expires_at, trial_ends_at, stripe_customer_id, timezone')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => { if (data) setProfile(data) })
      loadData(user.id)
      // Load monthly goal from DB
      supabase.from('user_goals').select('*').eq('user_id', user.id).eq('goal_type', 'monthly').maybeSingle()
        .then(({ data }) => { if (data) { setMonthlyGoal(data.target_usd); setGoalInput(data.target_usd.toString()) } })
      // Load tipper notes
      supabase.from('tipper_notes').select('*').eq('user_id', user.id)
        .then(({ data }) => {
          if (data?.length) {
            const map = {}
            data.forEach(n => { map[n.tipper_username.toLowerCase()] = { note: n.note, followUp: n.follow_up } })
            setTipperNotes(map)
          }
        })
      supabase.from('beta_users').select('id', { count: 'exact', head: true })
        .then(({ count }) => { if (count !== null) setBetaCount(count) })
      try {
        supabase.from('beta_users').upsert({
          user_id: user.id, email: user.email, signed_up_at: user.created_at
        }, { onConflict: 'user_id', ignoreDuplicates: true })
        supabase.from('analytics_events').insert({
          user_id: user.id, event_name: 'dashboard_opened', properties: { email: user.email }
        })
      } catch(e) {}

      // ── SUPABASE REALTIME ──────────────────────────────────
      // Inserted rows are queued and merged in one batch (see flushPendingTipInserts)
      // instead of re-running the full analytics engine per row — at large tip counts,
      // a burst of inserts (e.g. re-sync, bulk import) would otherwise run the full
      // engine once per row and freeze the tab.
      const TIP_BATCH_DEBOUNCE_MS = 2500
      const TIP_BATCH_MAX_WAIT_MS = 5000

      const flushPendingTipInserts = () => {
        clearTimeout(tipFlushTimerRef.current)
        tipFlushTimerRef.current = null
        tipBatchStartRef.current = 0
        const batch = pendingTipInsertsRef.current
        if (!batch.length) return
        pendingTipInsertsRef.current = []

        setTips(prev => {
          const existingKeys = new Set(prev.map(t => `${t.date_time}|${t.username}|${t.tokens}`))
          const newRows = batch.filter(row => {
            const key = `${row.date_time}|${row.username}|${row.tokens}`
            if (existingKeys.has(key)) return false
            existingKeys.add(key)
            return true
          })
          if (!newRows.length) return prev
          const updated = [...prev, ...newRows].sort((a,b) => new Date(a.date_time)-new Date(b.date_time))
          try {
            // Browser-fallback tier only (see lib/timezone.js) — this is the
            // "NO DB calls" lightweight recompute path, so it can't re-fetch
            // profiles.timezone here; loadData()'s full reload path resolves
            // the canonical profile timezone and is what corrects this on
            // the next full load.
            const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
            const r = runEngine(updated, userTz)
            if (r) setAnalytics(r)
            lastEngineTipsFingerprintRef.current = { length: updated.length, lastId: updated[updated.length - 1]?.id ?? null }
          } catch(e) { console.error('realtime runEngine failed:', e) }
          setNewTipCount(n => n + newRows.length)
          setNewAlertKey(k => k + 1)
          setLastRefreshed(new Date())
          // Invalidate the sessionStorage cache so next hard reload gets fresh data
          try { sessionStorage.removeItem(`camcash_tips_${user.id}`) } catch(e) {}
          return updated
        })
      }

      const channel = supabase
        .channel(`tips_live_${user.id}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'tips',
          filter: `user_id=eq.${user.id}`
        }, (payload) => {
          pendingTipInsertsRef.current.push(payload.new)
          if (!tipBatchStartRef.current) tipBatchStartRef.current = Date.now()
          // Debounce so a burst of inserts collapses into one flush, but never
          // wait longer than TIP_BATCH_MAX_WAIT_MS from the first queued insert —
          // a continuous stream of inserts still flushes periodically instead of
          // appearing to stop updating.
          const elapsed = Date.now() - tipBatchStartRef.current
          const wait = Math.max(Math.min(TIP_BATCH_DEBOUNCE_MS, TIP_BATCH_MAX_WAIT_MS - elapsed), 0)
          clearTimeout(tipFlushTimerRef.current)
          tipFlushTimerRef.current = setTimeout(flushPendingTipInserts, wait)
        })
        .subscribe()
      realtimeChannelRef.current = channel

      // ── EXTENSION LIVE TIPS — realtime feed from chrome extension sync ──
      const liveTipsChannel = supabase
        .channel(`live_tips_ext_${user.id}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'live_tips',
          filter: `user_id=eq.${user.id}`
        }, (payload) => {
          const tip = payload.new
          const tokens = parseInt(tip.tokens) || 0
          const usd = parseFloat(tip.usd) || parseFloat((tokens * tokenRate(tip.platform)).toFixed(2))
          const normalized = {
            username: tip.username || 'Unknown',
            tokens, usd,
            normalizedRevenue: usd,
            sourceUsed: 'extension',
            timestamp: new Date(tip.received_at || Date.now()),
            platform: tip.platform || 'chaturbate',
            _id: tip.id || Date.now(),
          }
          setLiveActive(true)
          setLiveStartTime(prev => prev || new Date())
          setLiveEvents(prev => [...prev, normalized])
          // Flash animation: highlight the new tip row for 2.5s
          setFlashTipId(normalized._id)
          setTimeout(() => setFlashTipId(null), 2500)
          // Switch to Live Mode tab automatically if user is on another tab
          setActiveTab('live-sessions')
        })
        .subscribe()
      liveTipsChannelRef.current = liveTipsChannel

      // ── LIGHTWEIGHT 30s analytics re-run (NO DB calls — just re-runs engine on cached data)
      // Full reloads only happen on: initial load, CSV upload, focus after 5+ min away
      // Gated on a cheap fingerprint (row count + last row id) so it only actually
      // re-runs the (expensive, at large tip counts) engine when the tips array has
      // changed since the last runEngine() call — otherwise this ticked forever and
      // recomputed the full analytics pipeline every 30s even with no new data.
      refreshTimerRef.current = setInterval(() => {
        setTips(prev => {
          if (!prev.length) return prev
          const fingerprint = { length: prev.length, lastId: prev[prev.length - 1]?.id ?? null }
          const last = lastEngineTipsFingerprintRef.current
          if (last && last.length === fingerprint.length && last.lastId === fingerprint.lastId) {
            return prev // unchanged since the last engine run — skip the recompute
          }
          try {
            const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
            const r = runEngine(prev, userTz)
            if (r) setAnalytics(r)
            lastEngineTipsFingerprintRef.current = fingerprint
          } catch(e) { console.error('refresh runEngine failed:', e) }
          return prev
        })
      }, 30000)

      // ── MINUTE TICK — re-evaluates time-based alerts every 60s ──
      // Daily Brief, real-time alerts, and best-time alert update as the hour changes
      const minuteTimer = setInterval(() => {
        setMinuteTick(t => t + 1)
      }, 60000)
    })
    return () => {
      if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current)
      if (liveTipsChannelRef.current) supabase.removeChannel(liveTipsChannelRef.current)
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
      if (tipFlushTimerRef.current) clearTimeout(tipFlushTimerRef.current)
      // minuteTimer cleared inline
    }
  }, [])

  // ── VISIBILITY REFRESH: only reload if tab was hidden for 15+ min ──
  // Uses visibilitychange instead of focus so switching windows doesn't fire it
  useEffect(() => {
    if (!user) return
    let hiddenAt = null
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else if (hiddenAt && Date.now() - hiddenAt > 15 * 60 * 1000) {
        // Tab was hidden for 15+ min — reload fresh data
        try { sessionStorage.removeItem(`camcash_tips_${user.id}`) } catch(e) {}
        loadData(user.id, true, { silent: true }).then(() => setLastRefreshed(new Date()))
        hiddenAt = null
      } else {
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [user])

  // ── LIVE MODE: load existing tips when tab is activated ───────────────────
  useEffect(() => {
    if (activeTab !== 'live-sessions' || !user) return
    let cancelled = false

    const loadRecentLiveTips = async () => {
      // Load tips from the last 12 hours so the session has real context
      const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('live_tips')
        .select('*')
        .eq('user_id', user.id)
        .gte('received_at', since)
        .order('received_at', { ascending: true })

      if (cancelled || error || !data || data.length === 0) return

      const normalized = data.map(tip => ({
        username:          tip.username || 'Unknown',
        tokens:            parseInt(tip.tokens) || 0,
        usd:               parseFloat(tip.usd) || parseFloat(((tip.tokens || 0) * tokenRate(tip.platform)).toFixed(2)),
        normalizedRevenue: parseFloat(tip.usd) || parseFloat(((tip.tokens || 0) * tokenRate(tip.platform)).toFixed(2)),
        sourceUsed:        tip.source || 'extension',
        timestamp:         new Date(tip.received_at),
        platform:          tip.platform || 'chaturbate',
      }))

      setLiveEvents(normalized)
      setLiveActive(true)
      // Use earliest tip as session start so pace/coaching calculations are accurate
      setLiveStartTime(prev => prev || new Date(data[0].received_at))
    }

    loadRecentLiveTips()
    return () => { cancelled = true }
  }, [activeTab, user])

  // ── LIVE TICKER: 1-second interval drives time-based re-renders ─────────────
  // Drives the command bar's momentum widget (visible on every tab), which
  // reads liveActive/liveEvents/liveStartTime — without this, elapsed-time-
  // based values never update because React only re-renders on state
  // changes, and Date.now() alone is not enough.
  useEffect(() => {
    if (liveActive) {
      liveTickerRef.current = setInterval(() => setLiveTick(t => t + 1), 1000)
    } else {
      clearInterval(liveTickerRef.current)
    }
    return () => clearInterval(liveTickerRef.current)
  }, [liveActive])

  useEffect(() => {
    if (analytics) setLiveAnalytics(analytics)
  }, [analytics])

  // Stop the rotating-microcopy interval if the dashboard unmounts mid-import
  useEffect(() => () => {
    if (importMessageTimerRef.current) clearInterval(importMessageTimerRef.current)
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const loadData = async (uid, force = false, { silent = false } = {}) => {
    // `silent` keeps the current screen mounted (e.g. after a CSV upload) instead of
    // replacing the whole dashboard with the full-page spinner, so the just-shown
    // success/error confirmation stays visible while data refreshes in the background.
    if (silent) setIsRefreshing(true)
    else setLoading(true)
    try {
      // Canonical timezone contract (canonical-analytics-rules.md): the
      // creator's saved profiles.timezone is the source of truth; browser
      // detection is fallback-only, used to auto-populate the profile once
      // (see autoPopulateTimezoneIfMissing) rather than being read live on
      // every load.
      const { data: profileTzRow } = await supabase.from('profiles').select('timezone').eq('id', uid).maybeSingle()
      const { timezone: userTz } = resolveCreatorTimezone(profileTzRow?.timezone)
      autoPopulateTimezoneIfMissing(supabase, uid, profileTzRow?.timezone)
      const PAGE = 1000
      // First page also asks for the exact row count, so the remaining pages
      // (if any) can be fired off in parallel instead of one round trip at a
      // time — with tens of thousands of rows the old serial loop meant
      // dozens of sequential awaits before the dashboard could paint at all.
      let allData = []
      const { data: firstPage, count, error: firstErr } = await supabase
        .from("tips").select("*", { count: 'exact' }).eq("user_id", uid)
        .order("date_time", { ascending: true }).range(0, PAGE - 1)
      if (!firstErr && firstPage) {
        allData = firstPage
        const total = count ?? firstPage.length
        if (total > PAGE) {
          const remainingRanges = []
          for (let from = PAGE; from < total; from += PAGE) remainingRanges.push(from)
          const pages = await Promise.all(remainingRanges.map(from =>
            supabase.from("tips").select("*").eq("user_id", uid).order("date_time", { ascending: true }).range(from, from + PAGE - 1)
          ))
          for (const { data, error } of pages) {
            if (!error && data?.length) allData = allData.concat(data)
          }
        }
      }
      if (allData.length) {
        setTips(allData)
        try {
          const result = runEngine(allData, userTz)
          setAnalytics(result)
          lastEngineTipsFingerprintRef.current = { length: allData.length, lastId: allData[allData.length - 1]?.id ?? null }
        } catch (engineErr) {
          console.error('[loadData] runEngine failed:', engineErr)
        }
      }
      // paid_sessions (BongaCams Private/Full-Private/Group/Spy) — separate
      // table, separate state, never merged into `tips`/`analytics`. Same
      // pagination pattern as the tips fetch above.
      let allPaidSessions = []
      let paidFrom = 0
      while (true) {
        const { data, error } = await supabase.from("paid_sessions").select("*").eq("user_id", uid).order("date_time", { ascending: true }).range(paidFrom, paidFrom + PAGE - 1)
        if (error) break
        if (data?.length) allPaidSessions = [...allPaidSessions, ...data]
        if (!data || data.length < PAGE) break
        paidFrom += PAGE
      }
      setPaidSessions(allPaidSessions)

      // Live Mode total, for the Private Sessions page's revenue-sources
      // summary only — kept as its own query against its own table, never
      // merged into `tips`/`paidSessions` rows or the `analytics` totals.
      try {
        const { data: liveRows, error: liveErr } = await supabase.from("live_tips").select("usd").eq("user_id", uid)
        if (!liveErr) setLiveTipsTotalUSD((liveRows || []).reduce((sum, r) => sum + (parseFloat(r.usd) || 0), 0))
      } catch (e) { /* non-fatal — Private Sessions page just omits this total */ }

      const { data: engineData } = await supabase.rpc('get_user_insights', { p_user_id: uid, p_timezone: userTz })
      setEngineInsights(engineData)
      setLastRefreshed(new Date())
    } finally {
      if (silent) setIsRefreshing(false)
      else setLoading(false)
    }
  }
const stopImportMessageRotation = () => {
    if (importMessageTimerRef.current) {
      clearInterval(importMessageTimerRef.current)
      importMessageTimerRef.current = null
    }
  }

  const resetImport = () => {
    stopImportMessageRotation()
    setImportStage('idle')
    setLastUploadResult(null)
    setLockedPreview(null)
  }

  // Shows a quick preview of what's in a blocked import (tips/fans/earnings/
  // top spender) plus a soft paywall, instead of just refusing the upload —
  // so a free-tier user sees real value before being asked to subscribe.
  const denyWithPlatformPreview = async (file, platformLabel) => {
    let rawText = ''
    try { rawText = await file.text() } catch (e) {}
    const detectedLabel = platformLabel || (rawText ? detectPlatform(rawText) : null) || 'this platform'
    const preview = buildImportPreview(rawText, platformLabel)
    setLastUploadResult(null)
    setLockedPreview({ platform: detectedLabel, preview })
    setImportStage('locked_preview')
    // Only play the celebratory checkmark/sparkle when we actually found
    // something to preview — an unparseable file isn't a "confirmation".
    if (preview) {
      setShowImportSparkle(true)
      setTimeout(() => setShowImportSparkle(false), 2400)
    }
    logEvent('platform_limit_preview_shown', { platform: detectedLabel, hasPreview: !!preview })
  }

  const handleCSV = async (file, forcePlatform = null) => {
    if (!file || !user) return
    // Free plan tracks a single platform — instead of a hard block, show a
    // quick preview of the file's contents plus a soft paywall below it.
    if (freePlatformLimitReached && forcePlatform && !allPlatforms.includes(forcePlatform)) {
      await denyWithPlatformPreview(file, forcePlatform)
      return
    }
    setImportStage('processing')
    setImportMessageIdx(0)
    setLastUploadResult(null)
    logEvent('csv_upload_started', { platform: forcePlatform || uploadPlatform || 'unknown' })

    stopImportMessageRotation()
    importMessageTimerRef.current = setInterval(() => {
      setImportMessageIdx(i => (i + 1) % IMPORT_MESSAGES.length)
    }, 1400)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { showToast("❌ Not logged in"); setImportStage('error'); setLastUploadResult({ success: false, error: 'Not logged in.' }); return }

      const fd = new FormData()
      fd.append('file', file)
      if (forcePlatform) fd.append('platform', forcePlatform)

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      })

      const result = await res.json()

      if (!res.ok || result.error) {
        if (result.code === 'platform_limit_reached') {
          await denyWithPlatformPreview(file, forcePlatform || uploadPlatform || result.platform || null)
        } else {
          showToast("❌ " + (result.error || 'Upload failed'))
          setLastUploadResult({ success: false, error: result.error || "We couldn't read this CSV. Please check the format or try another file." })
          setImportStage('error')
        }
        return
      }

      track('csv_imported', { rows: result.inserted, platform: result.platform || 'Unknown' })
      logEvent('csv_upload_success', { platform: result.platform || 'unknown', row_count: result.inserted })

      const msg = result.skipped > 0
        ? `✅ Imported ${result.inserted} tips (${result.skipped} duplicates skipped)`
        : `✅ Imported ${result.inserted} tips from ${result.platform}!`
      showToast(msg)
      setLastUploadResult({
        success: true,
        inserted: result.inserted,
        skipped: result.skipped,
        platform: result.platform,
        totalUsd: result.totalUsd,
        dateFrom: result.dateFrom,
        dateTo: result.dateTo,
      })
      setImportStage('success')

      setUploadCount(c => c + 1)
      if (typeof window !== 'undefined') localStorage.setItem('camcash_onboarded', '1')
      // Force reload after upload — bypass cache so new tips appear immediately
      try { sessionStorage.removeItem(`camcash_tips_${user.id}`) } catch(e) {}
      await loadData(user.id, true, { silent: true })

    } catch (err) {
      showToast("❌ " + err.message)
      setLastUploadResult({ success: false, error: err.message || "We couldn't read this CSV. Please check the format or try another file." })
      setImportStage('error')
    } finally {
      stopImportMessageRotation()
    }
  }

  const deleteTip = async (tipId) => {
    if (!confirm("Delete this tip?")) return
    try { const { error } = await supabase.from("tips").delete().eq("id", tipId); if (error) throw error; showToast("✅ Tip deleted"); await loadData(user.id, false, { silent: true }) }
    catch (err) { showToast("❌ " + err.message) }
  }

  const deleteAllTips = async () => {
    if (!user) return
    try { const { error } = await supabase.from("tips").delete().eq("user_id", user.id); if (error) throw error; showToast("✅ All tips deleted"); setShowDeleteConfirm(false); try { sessionStorage.removeItem(`camcash_tips_${user.id}`) } catch(e) {}; await loadData(user.id, true, { silent: true }) }
    catch (err) { showToast("❌ " + err.message) }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#05070f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: "2px solid #1e2d45", borderTop: "2px solid #22D3EE", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
          <div style={{ color: C.muted, fontSize: 14 }}>Loading...</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </div>
    )
  }

  const sessions = analytics?.sessions || []
  const whales = analytics?.whales || []
  // Opens the Whale Profile Modal for a fan, matched by fanKey (platform +
  // normalized username, never merged across platforms) -- reused by the
  // existing Top Fans list and now also by Private Sessions. If the fan has
  // no tip history at all (private-only fan), builds a safe minimal
  // whale-shaped object instead of crashing the tip-centric modal.
  const viewFanProfile = (username, platform) => {
    if (!username) return
    const uname = username.toLowerCase()
    const existing = whales.find(w => w.username.toLowerCase() === uname && w.platform === platform)
    if (existing) { setSelectedWhale(existing); return }
    setSelectedWhale({
      username, platform, tier: "New / Low Data",
      totalUSD: 0, tipCount: 0, avgTipSize: 0, lastTipDate: null,
      typicalOnlineHours: null,
    })
  }
  const insights = analytics?.insights || []
  const platforms = analytics?.platforms || []
  const dependencyRisk = analytics?.dependencyRisk || null
  const alerts = liveAnalytics?.whaleAlerts || analytics?.whaleAlerts || []
  const lossAlerts = liveAnalytics?.lossAlerts || analytics?.lossAlerts || []
  const nextMoves = liveAnalytics?.nextMoves || analytics?.nextMoves || []
  const totalRevenue = analytics?.totalUSD || 0
  // Estimated $/Hour — imported CSVs only carry tip timestamps, never real stream
  // start/end times, so this is inferred from the gap between a session's first
  // and last recorded tip. analytics.estimatedHourlyRate is the single source of
  // truth (lib/analytics.js) — a weighted total across hourly-rate-eligible
  // sessions only (>=2 tips, known duration, >=15 observed minutes). Both the
  // sticky command bar and the Money Snapshot KPI card read this same value;
  // neither computes it independently.
  const avgPerHour = analytics?.estimatedHourlyRate ?? 0
  const hourlyRateSessionCount = analytics?.hourlyRateSessionCount || 0
  const hourlyRateTotalMinutes = analytics?.hourlyRateTotalMinutes || 0
  // Gate display on the same eligible sessions/minutes the number itself is
  // built from — never on the broader meaningfulSessionCount/totalStreamMinutes,
  // which include sessions this rate calc deliberately excludes.
  const hourlyRateUnlocked = canShowHourlyRate({
    sessionCount: hourlyRateSessionCount,
    totalStreamMinutes: hourlyRateTotalMinutes,
  })
  const formatDuration = (mins) => {
    const m = Math.round(mins || 0)
    const h = Math.floor(m / 60)
    const rem = m % 60
    return h > 0 ? `${h}h ${rem}m` : `${rem}m`
  }
  const hourlyRateSubtext = hourlyRateUnlocked
    ? `Based on ${hourlyRateSessionCount} session${hourlyRateSessionCount === 1 ? '' : 's'} and ${formatDuration(hourlyRateTotalMinutes)} tracked.`
    : 'Unlocks after 3 eligible sessions and 60 minutes tracked.'
  const HOURLY_RATE_TOOLTIP = 'Estimated from the time between your first and last recorded tips in each session. Imported tip files do not include exact stream start and end times.'
  // Single source of truth — pre-computed in aggregateRows, same values used everywhere
  const analyticsbestDay  = analytics?.bestDay  || null
  const analyticsBestHour = analytics?.bestHour || null
  // Advanced analytics — from aggregateRows
  const platformBestTimes     = analytics?.platformBestTimes     || {}
  const earningsVelocity      = analytics?.earningsVelocity      ?? null
  const platformVelocity      = analytics?.platformVelocity      || {}
  // Canonical missed revenue (lib/analytics/missedRevenue.js): median $/hr in
  // the platform's own best day+hour window vs its overall median $/hr, times
  // sessions outside that window. Meaningful sessions only, creator-local.
  const missedRevenueByPlat   = analytics?.missedRevenue?.cumulative_by_platform || {}
  const returningVsNew        = analytics?.returningVsNew        || null
  const topFanDependency      = analytics?.topFanDependency      || null

  // ── RESOLVED CREATOR TIMEZONE ────────────────────────────────────────
  // THE single timezone value every local-time analytical calculation on
  // this page consumes. Contract (lib/timezone.js): profiles.timezone is
  // the source of truth; the browser's zone is a fallback used only to
  // auto-populate the profile once, never read live as the analytical
  // basis. Defined here (rather than lower down, where it used to live as
  // _momTz) because platformTimes below is the first analytical consumer.
  const creatorTz = resolveCreatorTimezone(profile?.timezone).timezone

  // Build platformTimes from INDIVIDUAL TIPS (not session start time)
  // so hour/day reflects when money actually came in, not when the session
  // started.
  //
  // Bucketed in the creator's resolved timezone via toLocalHour/toLocalDow
  // (lib/analytics/localTime.js — the same primitives the canonical
  // bestTimes engine and Stream Planner use). Previously this used
  // getUTCHours()/getUTCDay(), so the "Earnings by hour of day" heatmap and
  // the per-platform day totals were bucketed in UTC while being presented
  // as the creator's own hours — a tip at 7 PM Pacific landed in the 02:00
  // bucket, and one after 4 PM Pacific was attributed to the next day.
  const LOCAL_DAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const platformTimes = memoOn(derivedCacheRef.current, 'platformTimes', [tips, creatorTz], () => {
    const pt = {}
    tips.forEach(t => {
      if (!pt[t.platform]) pt[t.platform] = { hours: {}, days: {} }
      const ts = t.date_time || t.dateRaw
      const hour = toLocalHour(ts, creatorTz)
      const day = LOCAL_DAYS_LONG[toLocalDow(ts, creatorTz)]
      pt[t.platform].hours[hour] = (pt[t.platform].hours[hour] || 0) + (t.usd || 0)
      pt[t.platform].days[day]   = (pt[t.platform].days[day]   || 0) + (t.usd || 0)
    })
    return pt
  })

  // Free plan: the Fans tab caps at the 3 highest spenders (`whales` is
  // already sorted by total spend upstream). Pro sees everyone. Fans.js
  // receives this as a prop and applies it; it is not applied here.
  // REMOVED with the Phase 4 Fans rebuild: buildWhatsNextAlerts() and
  // buildReengageList(), plus their memoised results. Both fed only the old
  // "Your Top Earners" milestone/at-risk lists. Fans.js derives the same
  // priorities from canonical per-fan fields (expectedNextTip, churnRisk,
  // avgDaysBetweenTips) instead of a second heuristic pass over `whales`.
  // The re-engage message templates buildReengageList() carried were never
  // the ones the creator saw — the message modal has always built its own
  // list (see `messages` in the modal below), so nothing user-facing changed.
  const FREE_FAN_LIMIT = 3
  // Impression event — fires once per render where the locked fan preview is
  // actually on screen, not once per blurred card. Fans.js renders that
  // preview from the same `whales` array and the same limit, so this
  // condition matches what the creator sees.
  if (activeTab === 'whales' && !isPro && whales.length > FREE_FAN_LIMIT) trackProPreviewViewed('whale_intelligence')

  // REMOVED with the Phase 4 Fans rebuild: filteredWhales, visibleWhales,
  // hiddenWhales and lockedFanStats. They existed only to feed the old Top
  // Fans grid — its tier/platform filter pills, its blurred card slice and
  // its locked-stats panel — all of which Fans.js replaces. filteredWhales
  // in particular re-ran a per-fan tip scan on every render for a
  // chartDrillDay filter whose only trigger (the platform heatmap's "View
  // top fans from <day>" button) was itself removed in the Phase 3
  // Performance rebuild, so it could never match anything again.

  const allPlatforms = memoOn(derivedCacheRef.current, 'allPlatforms', [tips], () => [...new Set(tips.map(t => t.platform))])
  const freePlatformLimitReached = !isPro && allPlatforms.length > 0

  // ── Build "What's Next" alerts — smarter, personalized, prioritized
  const buildDailyBrief = () => {
    if (!tips || tips.length === 0 || !analytics) return null
    const now = new Date()
    // Creator-local current hour. Was the BROWSER's hour; all the analytics
    // hours it is compared against below are creator-local.
    const utcHour = toLocalHour(now.toISOString(), creatorTz)
    const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const todayName = DAYS[now.getDay()] // local day of week

    // Best hour: today-specific per platform first, then all-time fallback
    // Formula: SUM(usd) / COUNT(DISTINCT hour-bucket) for THIS day of week on THIS platform
    // bestHour values from analytics are already local hours — format directly, no offset
    const fmtHour = h => h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
    const platBestTimes = analytics?.platformBestTimes || {}
    let todayBestPlat = null, todayBestHourNum = null, todayBestAvg = 0
    Object.entries(platBestTimes).forEach(([plat, times]) => {
      const todayEntry = times?.bestHourByDay?.[todayName]
      if (todayEntry && todayEntry.avg > todayBestAvg) {
        todayBestAvg = todayEntry.avg
        todayBestHourNum = todayEntry.hour
        todayBestPlat = plat
      }
    })
    // Phase 1B: all-time fallback now reads the canonical best-time result
    // (lib/analytics/bestTimes.js — session-based, median $/hour,
    // confidence-tiered) instead of the legacy tip-level computeBestTimes()
    // output, per the approved Best-Time Migration Matrix. Same {hour, avg}
    // shape preserved so every downstream consumer below (bhLabel,
    // displayAvg, peakAvg, sessionsAtPeak) is unaffected by the source swap.
    const _canonicalBest = analytics?.canonicalBestTimes?.bestWindow
    const bestHour = _canonicalBest ? { hour: _canonicalBest.localHour, avg: _canonicalBest.medianUsdPerHour } : null
    const _bhRaw = todayBestHourNum !== null ? todayBestHourNum : (bestHour ? parseInt(bestHour.hour) : null)
    const bh = (_bhRaw !== null && !isNaN(_bhRaw)) ? _bhRaw : null
    const bhLabel = bh === null ? null : fmtHour(bh)
    const hoursUntilPeak = bh !== null ? (bh - utcHour + 24) % 24 : null
    const atPeak = hoursUntilPeak === 0 || hoursUntilPeak === 1

    // Best platform per hour
    const platHourUSD = {}; const platHourSessions = {}
    tips.forEach(t => {
      const p = t.platform || 'Chaturbate'
      const d = new Date(t.date_time || t.dateRaw)
      // Creator-local. The old comment claimed this matched analytics.js's
      // toLocalHour — it did not: toLocalHour resolves the creator's saved
      // timezone, getHours() resolves the browser's, so this bucket silently
      // disagreed with every other hour bucket in the app.
      const h = toLocalHour(t.date_time || t.dateRaw, creatorTz)
      const bucket = Math.floor(d.getTime() / 3600000)
      if (!platHourUSD[p]) { platHourUSD[p] = {}; platHourSessions[p] = {} }
      if (!platHourUSD[p][h]) { platHourUSD[p][h] = 0; platHourSessions[p][h] = new Set() }
      platHourUSD[p][h] += t.usd || 0
      platHourSessions[p][h].add(bucket)
    })
    let bestPlatNow = null; let bestPlatNowAvg = 0
    Object.keys(platHourUSD).forEach(plat => {
      const sessions = platHourSessions[plat][utcHour]?.size || 0
      if (sessions === 0) return
      const avg = platHourUSD[plat][utcHour] / sessions
      if (avg > bestPlatNowAvg) { bestPlatNowAvg = avg; bestPlatNow = plat }
    })
    let bestPlatPeak = null; let bestPlatPeakAvg = 0
    if (bh !== null) {
      Object.keys(platHourUSD).forEach(plat => {
        const sessions = platHourSessions[plat][bh]?.size || 0
        if (sessions === 0) return
        const avg = platHourUSD[plat][bh] / sessions
        if (avg > bestPlatPeakAvg) { bestPlatPeakAvg = avg; bestPlatPeak = plat }
      })
    }
    // todayBestPlat/bestPlatPeak/bestPlatNow are time-bucketed (need 3+ session
    // buckets at a specific hour/day) and are often null for sparse accounts.
    // Real fallback: the platform with the highest total earnings across all
    // tips — needs only 1 tip to resolve, so it's never a fake/wrong platform.
    const platTotalUSD = {}
    tips.forEach(t => { const p = t.platform || 'Unknown'; platTotalUSD[p] = (platTotalUSD[p] || 0) + (t.usd || 0) })
    const topEarningPlat = Object.entries(platTotalUSD).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    const displayPlat = todayBestPlat || bestPlatPeak || bestPlatNow || topEarningPlat
    const displayAvg = todayBestAvg || bestPlatPeakAvg || bestPlatNowAvg || bestHour?.avg || 0

    // Best day — canonicalBestTimes.bestWindow, not legacy analytics.bestDay
    // (tip-level mean). This card already reads the canonical hour (bh,
    // above) for "today's peak"; using the legacy field just for "is today
    // your best day" let the two halves of the same card disagree — e.g. bh
    // correctly reflecting a Wednesday canonical window while isBestDay was
    // computed against a legacy "Friday" answer, so the 🏆 badge could be
    // wrong on the exact day the canonical hour says is best.
    const bestDay = analytics?.canonicalBestTimes?.bestWindow
      ? { day: analytics.canonicalBestTimes.bestWindow.localDay, avg: analytics.canonicalBestTimes.bestWindow.medianUsdPerHour }
      : null
    const isBestDay = bestDay?.day === todayName
    // meaningfulSessions, not analytics.sessions (= allValidSessions, which
    // still includes low_signal sessions). The Overview KPI card's "Avg Per
    // Session" already uses meaningfulSessions, and lib/analytics/sessions.js
    // documents that population as "the population every rate calculation
    // should use" — so reading allValidSessions here put two different
    // answers to "what is a session worth?" on the same screen. On the real
    // regression CSV that gap is $2.79 (168 allValid) vs $5.10 (78
    // meaningful) — the same class of contradiction reported as
    // "$2 avg vs $10 avg per session".
    const _avgPop = analytics?.meaningfulSessions || []
    const sessionAvg = _avgPop.length
      ? _avgPop.reduce((s, x) => s + (x.totalUSD || 0), 0) / _avgPop.length : 0

    // Income prediction for peak window — use median-based displayAvg as single source of truth
    const sessionsAtPeak = (analytics?.sessions || []).filter(s => {
      // Creator-local — `bh` is canonicalBestTimes.bestWindow.localHour, so
      // bucketing these sessions with the browser clock compared two
      // different clocks.
      const h = toLocalHour(s.startTime, creatorTz)
      return bh !== null && Math.abs(h - bh) <= 1
    })
    // UNIT CONSISTENCY: every tier here is $/HOUR — displayAvg resolves to a
    // per-hour-bucket figure (todayBestAvg/bestPlatPeakAvg/bestPlatNowAvg,
    // all "$ earned within an hour"), and bestHour.avg is
    // canonicalBestTimes.bestWindow.medianUsdPerHour. sessionAvg was
    // previously the last fallback here, silently swapping in a $/SESSION
    // value and feeding it to a forecast rendered as an hourly figure.
    // Dropped rather than converted: if no $/hour figure qualifies, the
    // honest output is no forecast, not one in the wrong unit.
    const peakAvg = displayAvg || bestHour?.avg || 0
    const predictionLow = Math.max(0, Math.round(peakAvg - (peakAvg * 0.4)))
    const predictionHigh = Math.round(peakAvg + (peakAvg * 0.4))

    // Re-engage list — fans who tip 50+ tokens avg per session, appear in 2+ streams, and are overdue
    // "Every 2-3 streams" = session-level frequency, not tip count
    const SESSION_GAP_MS = 3 * 60 * 60 * 1000
    const reengageFans = (whales || [])
      .filter(w => {
        if (!w.tips || w.tips.length < 2) return false

        // Group this fan's tips into sessions (3hr gap = new session)
        const sorted = [...w.tips].sort((a, b) =>
          new Date(a.date_time || a.dateRaw) - new Date(b.date_time || b.dateRaw)
        )
        const fanSessions = []
        let cur = [sorted[0]]
        for (let i = 1; i < sorted.length; i++) {
          const gap = new Date(sorted[i].date_time || sorted[i].dateRaw) -
                      new Date(sorted[i-1].date_time || sorted[i-1].dateRaw)
          if (gap > SESSION_GAP_MS) { fanSessions.push(cur); cur = [sorted[i]] }
          else cur.push(sorted[i])
        }
        fanSessions.push(cur)

        // Must have appeared in 2+ sessions
        if (fanSessions.length < 2) return false

        // Avg tokens per session must be 50+
        const avgTokensPerSession = fanSessions.reduce((sum, s) =>
          sum + s.reduce((t, tip) => t + (tip.tokens || 0), 0), 0) / fanSessions.length
        if (avgTokensPerSession < 50) return false

        // Calculate avg days between sessions
        const sessionDates = fanSessions.map(s => new Date(s[0].date_time || s[0].dateRaw))
        let totalGap = 0
        for (let i = 1; i < sessionDates.length; i++) {
          totalGap += (sessionDates[i] - sessionDates[i-1]) / 86400000
        }
        const avgDaysBetweenSessions = fanSessions.length > 1 ? totalGap / (fanSessions.length - 1) : 30

        // Must be overdue — gone longer than 1.5x their normal interval
        // (accounts for "every 2-3 streams" — if they stream 2-3x/week that's a few days)
        const daysSince = w.daysSinceLastTip
        const overdueThreshold = Math.max(avgDaysBetweenSessions * 1.5, 3)
        // Cap at 90 days: beyond that the fan is "At Risk", not "Re-engage"
        return daysSince >= overdueThreshold && daysSince <= 90
      })
      .sort((a, b) => b.totalUSD - a.totalUSD)
      .slice(0, 5)

    // Likely online right now
    const likelyOnline = (whales || [])
      .filter(w => {
        if (!w.tips || w.tips.length < 3) return false
        if (w.totalUSD < 3) return false
        const hc = {}
        w.tips.forEach(t => { const h = toLocalHour(t.date_time || t.dateRaw, creatorTz); hc[h] = (hc[h] || 0) + 1 })
        const peakH = parseInt(Object.entries(hc).sort((a,b) => b[1]-a[1])[0][0])
        return (peakH - utcHour + 24) % 24 <= 1
      })
      .sort((a, b) => b.totalUSD - a.totalUSD)
      .slice(0, 3)

    return { todayName, bhLabel, bh, atPeak, hoursUntilPeak, displayPlat, displayAvg,
      isBestDay, bestDay, sessionAvg, peakAvg, predictionLow, predictionHigh,
      reengageFans, likelyOnline, sessionsAtPeakCount: sessionsAtPeak.length }
  }

  const buildRealTimeAlerts = () => {
    const now = Date.now()
    // Creator-local "now" — both of these are compared against tip data that
    // is now bucketed in the creator's zone, and surfaced in alert copy.
    const alertCurrentHour = toLocalHour(new Date().toISOString(), creatorTz)
    const currentDay = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][toLocalDow(new Date().toISOString(), creatorTz)]
    const alerts = []

    // --- PLATFORM DAY-OF-WEEK PERFORMANCE ---
    // Use UTC day to avoid timezone shifts (DB stores UTC timestamps)
    const UTC_DAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const platDayMap = {}
    tips.forEach(t => {
      const p = t.platform
      const day = UTC_DAYS_LONG[toLocalDow(t.date_time || t.dateRaw, creatorTz)]
      if (!platDayMap[p]) platDayMap[p] = {}
      if (!platDayMap[p][day]) platDayMap[p][day] = 0
      platDayMap[p][day] += t.usd || 0
    })

    // Find best day per platform
    const platBestDay = {}
    Object.entries(platDayMap).forEach(([plat, days]) => {
      const sorted = Object.entries(days).sort((a, b) => b[1] - a[1])
      if (sorted.length > 0) platBestDay[plat] = { day: sorted[0][0], usd: sorted[0][1] }
    })


    // --- PLATFORM vs PLATFORM HOUR COMPARISON ---
    // FIX: use avg USD per hour-session (not raw cumulative totals)
    // Bucketed in the creator's resolved timezone (was getUTCHours()): the
    // resulting hour is compared against "now" and rendered as a local time.
    const platHourUSD = {}; const platHourSessions = {}
    tips.forEach(t => {
      const p = t.platform
      const d = new Date(t.date_time || t.dateRaw)
      // Absolute hour-bucket key for session dedup — intentionally UTC-based
      // (it is an opaque identity key, never displayed or compared to a
      // wall-clock hour), so it is correct regardless of timezone.
      const bucketKey = Math.floor(d.getTime() / 3600000)
      const h = toLocalHour(t.date_time || t.dateRaw, creatorTz)
      if (!platHourUSD[p]) { platHourUSD[p] = {}; platHourSessions[p] = {} }
      if (!platHourUSD[p][h]) { platHourUSD[p][h] = 0; platHourSessions[p][h] = new Set() }
      platHourUSD[p][h] += t.usd || 0
      platHourSessions[p][h].add(bucketKey)
    })
    // Compute avg per session at each UTC hour per platform
    const platHourAvg = {}
    Object.keys(platHourUSD).forEach(p => {
      platHourAvg[p] = {}
      Object.keys(platHourUSD[p]).forEach(h => {
        const sessions = platHourSessions[p][h].size || 1
        platHourAvg[p][h] = platHourUSD[p][h] / sessions
      })
    })

    const platNames = Object.keys(platHourAvg)
    const currentUTCHour = toLocalHour(new Date().toISOString(), creatorTz)
    if (platNames.length >= 2) {
      platNames.forEach(plat => {
        const hourVal = platHourAvg[plat][currentUTCHour] || 0
        const otherPlats = platNames.filter(p => p !== plat)
        otherPlats.forEach(other => {
          const otherVal = platHourAvg[other][currentUTCHour] || 0
          if (hourVal > 0 && otherVal > 0 && hourVal >= otherVal * 1.5) {
            const mult = (hourVal / otherVal).toFixed(1)
            const label = (() => { const _lh=((currentUTCHour%24)+24)%24; return _lh===0?'12 AM':_lh<12?`${_lh} AM`:_lh===12?'12 PM':`${_lh-12} PM` })()
            alerts.push({
              type: 'platform_hour', priority: 1, icon: '⚡', color: '#22D3EE',
              title: `Right now ${plat} earns ${mult}x more than ${other}`,
              message: `At ${label}, ${plat} historically averages $${hourVal.toFixed(0)} vs $${otherVal.toFixed(0)} on ${other}. Stream on ${plat} now.`
            })
          }
        })
      })
    }

    // --- TOP WHALE LIKELY ONLINE ---
    // Uses actual peak hour from their tip history
    const topWhales = [...whales].sort((a, b) => b.totalUSD - a.totalUSD).slice(0, 5)
    topWhales.forEach(w => {
      if (w.tipCount < 3) return

      // Canonical peak hour (identifyWhales' peakLocalHour), NOT a local
      // re-bucketing. Three defects were stacked here:
      //   1. This was a third independent implementation of "this fan's peak
      //      hour" — identifyWhales() already computes it, and the Fans tab
      //      had its own copy too (removed in the Phase 4 rebuild).
      //   2. It bucketed with new Date(...).getHours(), the BROWSER's zone,
      //      then compared the result against toLocalHour(now, creatorTz),
      //      the CREATOR's zone — so `hoursAway` was a difference between two
      //      different clocks whenever those zones disagreed, which is the
      //      normal case for a travelling or non-local creator.
      //   3. The "{n}% confidence" it rendered came from
      //      peakFraction * 200 * proximityDecay clamped to 25-90 — a
      //      hand-rolled score with nothing calibrating it, shown to the
      //      creator as a probability.
      if (w.peakLocalHour == null) return
      const peakHour = w.peakLocalHour
      const hoursAway = (peakHour - toLocalHour(new Date().toISOString(), creatorTz) + 24) % 24
      const label = peakHour === 0 ? '12 AM' : peakHour < 12 ? `${peakHour} AM` : peakHour === 12 ? '12 PM' : `${peakHour - 12} PM`
      const daysSince = Math.floor((now - new Date(w.lastTipDate)) / 86400000)

      if (hoursAway === 0 || hoursAway === 1) {
        alerts.push({
          type: 'whale_online_now', priority: 0, icon: '🟢', color: '#10B981',
          title: `${w.username} is likely online RIGHT NOW on ${w.platform}`,
          message: `Your #${topWhales.indexOf(w)+1} tipper ($${w.totalUSD.toFixed(0)} lifetime) peaks at ${label} — go live on ${w.platform} immediately. ${daysSince > 0 ? `They haven't tipped in ${daysSince} days.` : 'They tipped recently!'}`
        })
      } else if (hoursAway <= 3) {
        alerts.push({
          type: 'whale_online_soon', priority: 1, icon: '⏰', color: '#F59E0B',
          title: `${w.username} likely online in ~${hoursAway}h on ${w.platform}`,
          message: `Your top whale peaks at ${label} — ${w.peakHourTipCount} of their ${w.tipCount} tips land in that hour. Prep your stream on ${w.platform}; they've spent $${w.totalUSD.toFixed(0)} with you.`
        })
      }
    })

    // --- PLATFORM DOMINANCE ALERT ---
    const platTotals = {}
    tips.forEach(t => {
      platTotals[t.platform] = (platTotals[t.platform] || 0) + (t.usd || 0)
    })
    const sortedPlats = Object.entries(platTotals).sort((a, b) => b[1] - a[1])
    if (sortedPlats.length >= 2) {
      const [topPlat, topUSD] = sortedPlats[0]
      const [bottomPlat, bottomUSD] = sortedPlats[sortedPlats.length - 1]
      if (bottomUSD > 0) {
        const mult = (topUSD / bottomUSD).toFixed(1)
        alerts.push({
          type: 'platform_dominance', priority: 2, icon: '🏆', color: '#F59E0B',
          title: `${topPlat} earns ${mult}x more than ${bottomPlat} overall`,
          message: `$${topUSD.toFixed(0)} on ${topPlat} vs $${bottomUSD.toFixed(0)} on ${bottomPlat} all time. Your time on ${topPlat} is ${mult}x more valuable.`
        })
      }
    }

    return alerts.sort((a, b) => a.priority - b.priority).slice(0, 6)
  }

  // re-runs every minuteTick (as well as when the underlying data changes)
  const dailyBrief = memoOn(derivedCacheRef.current, 'dailyBrief', [tips, analytics, whales, minuteTick], buildDailyBrief)

  // ── BEST-TIME SOURCE RECONCILIATION ─────────────────────────────────────
  // Per the Free/Pro UX audit's best-time reconciliation pass: ONE metric,
  // ONE definition, ONE source of truth, per distinct product question —
  // and any surface answering a genuinely different question must be
  // labeled as such, never silently substituted for the generic claim.
  //
  // Two genuinely different questions get asked on this page:
  //
  // 1. "What is my peak/best time to stream, in general?" (no day-of-week
  //    scoping) — the command-bar "Peak Window" KPI, the "You're Losing
  //    Money" missed-revenue card, and Smart Insights' peak-window insight
  //    all ask this. canonicalBestTimes.bestWindow (lib/analytics/bestTimes.js
  //    — session-based, median $/hour, confidence-tiered) is the DEFAULT,
  //    authoritative source for this question, full stop. It used to lose to
  //    engineInsights.daily_plan.best_hour (the SQL get_user_insights engine)
  //    whenever that was present — meaning a completely different, narrower
  //    SQL calculation (see canonicalTodaySpecificHourLocal below) could
  //    silently override the canonical account-wide answer on a generic
  //    "peak window" label with no indication anything had changed sources.
  const canonicalPeakHourLocal = analytics?.canonicalBestTimes?.bestWindow
    ? analytics.canonicalBestTimes.bestWindow.localHour
    : null
  const canonicalPeakLabel = canonicalPeakHourLocal != null
    ? (() => { const _lh = ((canonicalPeakHourLocal % 24) + 24) % 24; return _lh===0?'12 AM':_lh<12?`${_lh} AM`:_lh===12?'12 PM':`${_lh-12} PM` })()
    : null

  // 2. "What is my best hour specifically for TODAY's day-of-week,
  //    historically?" — a genuinely different, narrower question (SQL's
  //    get_user_insights filters to tips that fell on today's weekday, min 2;
  //    the canonical engine has no such day-of-week-only mode). Used ONLY by
  //    the Daily Brief card below, whose copy explicitly says "today" — never
  //    by a surface using generic "peak window" language. dailyBrief.bh is
  //    itself already a graceful degradation chain (today-specific JS
  //    calculation, then the canonical account-wide window as a last
  //    resort — see buildDailyBrief() above), so this alone is the correct
  //    fallback order for a "today" claim; it must not also feed the
  //    generic peak-window claim above.
  const canonicalTodaySpecificHourLocal = (
    engineInsights?.daily_plan?.best_hour ??
    dailyBrief?.bh ??
    null
  )
  const canonicalTodaySpecificLabel = canonicalTodaySpecificHourLocal != null
    ? (() => { const _lh = ((canonicalTodaySpecificHourLocal % 24) + 24) % 24; return _lh===0?'12 AM':_lh<12?`${_lh} AM`:_lh===12?'12 PM':`${_lh-12} PM` })()
    : null

  // re-runs every minuteTick (as well as when the underlying data changes)
  const realTimeAlerts = memoOn(derivedCacheRef.current, 'realTimeAlerts', [tips, whales, minuteTick], buildRealTimeAlerts)
  void minuteTick // ensures re-render when minute changes

  // ── MONTH-OVER-MONTH GROWTH ── used by Momentum indicator and KPI cards
  // Canonical source: analytics.monthlyData (lib/analytics.js), bucketed by
  // creator-local calendar month with growthPct pre-computed once — see
  // canonical-analytics-rules.md's Monthly-Growth Reconciliation. Do not
  // recompute month boundaries here.
  //
  // monthlyData only contains months that actually have tip data — it is
  // NOT guaranteed to have an entry for the real current calendar month, so
  // "last entry" is not a safe stand-in for "this month" (a creator who
  // hasn't tipped yet this month would otherwise see last month's revenue
  // mislabeled as "this month"). Match the real current-month key instead,
  // via the same resolved-timezone contract lib/timezone.js defines.
  const _momMonthly = analytics?.monthlyData || []
  const _momTz = creatorTz // single resolved source, hoisted above platformTimes
  const _momCurrentKey = (() => {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: _momTz }).format(new Date()).slice(0, 7) }
    catch { return null }
  })()
  const _momThisIdx = _momCurrentKey ? _momMonthly.findIndex(m => m.month === _momCurrentKey) : -1
  const _momThisMonth = _momThisIdx >= 0 ? _momMonthly[_momThisIdx] : null
  const _momPrevMonth = _momThisIdx > 0 ? _momMonthly[_momThisIdx - 1] : null
  const _momThisRev = _momThisMonth?.usd ?? 0
  const _momPrevRev = _momPrevMonth?.usd ?? 0
  const growthPct = _momThisMonth?.growthPct ?? null

  // ── DASHBOARD READINESS — always renders real dashboard, module-level locking ─
  const {
    dashboardReadiness, _isLowData, _plannerLock, _moneyMapLock,
  } = memoOn(derivedCacheRef.current, 'readiness', [tips, analytics, isPro], () => {
    const drDates      = tips.map(t => new Date(t.date_time || t.dateRaw)).filter(d => !isNaN(d)).sort((a, b) => a - b)
    const drRangeDays  = drDates.length >= 2 ? Math.round((drDates[drDates.length - 1] - drDates[0]) / 86400000) : 0
    const drStreamDays = new Set(drDates.map(d => d.toDateString())).size
    const drPlatCount  = [...new Set(tips.map(t => t.platform).filter(p => p && p !== 'Unknown'))].length
    const readiness = getDashboardReadiness({
      totalTips:     tips.length,
      totalSessions: analytics?.meaningfulSessionCount || 0,
      totalFans:     analytics?.uniqueFanCount ?? 0,
      totalEarnings: analytics?.totalUSD || 0,
      dateRangeDays: drRangeDays,
      streamDays:    drStreamDays,
    })
    const isLowData  = readiness !== 'ready'
    const modLockArgs = { totalTips: tips.length, totalSessions: analytics?.meaningfulSessionCount || 0, totalFans: analytics?.uniqueFanCount ?? 0, totalEarnings: analytics?.totalUSD || 0, totalStreamMinutes: analytics?.totalStreamMinutes || 0, importedPlatformCount: drPlatCount, isPro, liveModeSessions: 0 }
    const plannerLock  = getModuleLockState({ module: 'streamPlanner',  ...modLockArgs })
    const moneyMapLock = getModuleLockState({ module: 'moneyMap',       ...modLockArgs })
    return { dashboardReadiness: readiness, _isLowData: isLowData, _plannerLock: plannerLock, _moneyMapLock: moneyMapLock }
  })

  return (
    <div style={{
      minHeight: "100vh",
      background: `radial-gradient(circle at 20% 30%, rgba(59,130,246,0.25), transparent 40%), radial-gradient(circle at 80% 70%, rgba(236,72,153,0.25), transparent 40%), radial-gradient(circle at 50% 50%, rgba(168,85,247,0.15), transparent 60%), #05070f`,
      fontFamily: "'Inter', sans-serif", color: C.text
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: #05070f; }
        ::-webkit-scrollbar-thumb { background: #2a3f5f; border-radius: 3px; }
        .dash-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .dash-card:hover { transform: translateY(-2px); }
        .whale-row { transition: background 0.15s, transform 0.12s ease; }
        .whale-row:hover { background: rgba(59,130,246,0.08) !important; transform: translateX(2px); }
        @keyframes pulse-msg { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.25); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── ALERT ANIMATIONS ── */
        @keyframes alertEnter {
          0%   { opacity: 0; transform: translateY(-10px) scale(0.97); }
          60%  { opacity: 1; transform: translateY(1px) scale(1.01); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes alertExit {
          0%   { opacity: 1; transform: translateY(0) scale(1); max-height: 200px; margin-bottom: 8px; }
          100% { opacity: 0; transform: translateY(6px) scale(0.97); max-height: 0; margin-bottom: 0; padding: 0; }
        }
        @keyframes alertPulseCritical {
          0%   { box-shadow: 0 0 0 0 rgba(248,113,113,0.45); }
          50%  { box-shadow: 0 0 0 8px rgba(248,113,113,0); }
          100% { box-shadow: 0 0 0 0 rgba(248,113,113,0); }
        }
        @keyframes alertPulseWarning {
          0%   { box-shadow: 0 0 0 0 rgba(251,146,60,0.4); }
          50%  { box-shadow: 0 0 0 7px rgba(251,146,60,0); }
          100% { box-shadow: 0 0 0 0 rgba(251,146,60,0); }
        }
        @keyframes alertPulseSuccess {
          0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.4); }
          50%  { box-shadow: 0 0 0 7px rgba(16,185,129,0); }
          100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
        }
        @keyframes alertPulseInfo {
          0%   { box-shadow: 0 0 0 0 rgba(34,211,238,0.35); }
          50%  { box-shadow: 0 0 0 6px rgba(34,211,238,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,211,238,0); }
        }
        @keyframes counterBump {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.4); }
          70%  { transform: scale(0.9); }
          100% { transform: scale(1); }
        }
        @keyframes recentlyUpdated {
          0%   { background-color: rgba(34,211,238,0.14); }
          100% { background-color: transparent; }
        }
        @keyframes listSlotIn {
          0%   { opacity: 0; transform: translateY(-8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes timestampTick {
          0%   { opacity: 0.45; }
          50%  { opacity: 1; }
          100% { opacity: 0.45; }
        }
        .alert-enter { animation: alertEnter 280ms cubic-bezier(0.34,1.2,0.64,1) forwards; }
        .alert-exit  { animation: alertExit 180ms ease-in forwards; overflow: hidden; pointer-events: none; }
        .alert-pulse-critical { animation: alertPulseCritical 500ms ease-out 280ms 1 forwards; }
        .alert-pulse-warning  { animation: alertPulseWarning  500ms ease-out 280ms 1 forwards; }
        .alert-pulse-success  { animation: alertPulseSuccess  500ms ease-out 280ms 1 forwards; }
        .alert-pulse-info     { animation: alertPulseInfo     500ms ease-out 280ms 1 forwards; }
        .counter-bump { display: inline-block; animation: counterBump 300ms cubic-bezier(0.34,1.3,0.64,1) forwards; }
        .recently-updated { animation: recentlyUpdated 2500ms ease-out forwards; border-radius: inherit; }
        .list-slot-in { animation: listSlotIn 220ms ease-out forwards; }
        .timestamp-idle { animation: timestampTick 3s ease-in-out infinite; }
        .hoverable { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .hoverable:hover { transform: translateY(-2px) scale(1.005); box-shadow: 0 6px 24px rgba(0,0,0,0.35); }
        .alert-row { transition: transform 0.12s ease; }
        .alert-row:hover { transform: translateX(3px); }
        button:active { transform: scale(0.96) !important; transition: transform 0.1s ease !important; }
        .dash-main { margin-left: 240px; width: calc(100% - 240px); overflow-x: hidden; box-sizing: border-box; }
        @media (max-width: 768px) { .dash-main { margin-left: 0 !important; width: 100% !important; } }
        @media (max-width: 1024px) { .stat-grid-4 { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 640px)  { .stat-grid-4 { grid-template-columns: 1fr !important; } }
        /* position:sticky's "top" shifts the bar's painted position but — like
           position:relative — doesn't reserve extra flow space, so the next
           sibling (LIVE status row) needs a matching margin-bottom or it sits
           underneath the visually-shifted bar. This clears the fixed mobile
           hamburger button (36px + 14px) both at rest and once scrolled. */
        @media (max-width: 768px) { .sticky-command-bar { top: 56px !important; margin-bottom: 68px !important; } }

        /* ── COMMAND BAR "WAKE UP" — plays once on mount (page load/navigation
           into /dashboard), never replays on in-app tab switches since the bar
           itself never remounts when activeTab changes. Short + staggered:
           pill first, KPIs settle in next, Go Live gets one glow sweep. ── */
        @keyframes cmdbarFadeSlide { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes golive-wake-sweep {
          0%   { box-shadow: 0 0 16px rgba(16,185,129,0.25); }
          40%  { box-shadow: 0 0 28px rgba(34,211,238,0.55), 0 0 15px rgba(16,185,129,0.4); }
          100% { box-shadow: 0 0 16px rgba(16,185,129,0.25); }
        }
        .cmdbar-wake .cmdbar-kpi { animation: cmdbarFadeSlide 400ms ease-out both; }
        .cmdbar-wake .cmdbar-kpi-1 { animation-delay: 60ms; }
        .cmdbar-wake .cmdbar-kpi-2 { animation-delay: 110ms; }
        .cmdbar-wake .cmdbar-kpi-3 { animation-delay: 160ms; }
        .cmdbar-wake .cmdbar-kpi-4 { animation-delay: 200ms; }
        .cmdbar-wake .cmdbar-kpi-5 { animation-delay: 240ms; }
        .cmdbar-wake-pill { animation: cmdbarFadeSlide 350ms ease-out both; }
        .cmdbar-wake-btn { animation: cmdbarFadeSlide 400ms ease-out 120ms both, golive-wake-sweep 900ms ease-out 550ms 1; }
        .cmdbar-golive { transition: transform 150ms ease, box-shadow 150ms ease, filter 150ms ease; }
        .cmdbar-golive:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 0 22px rgba(34,211,238,0.35), 0 0 14px rgba(16,185,129,0.3); }
        @media (prefers-reduced-motion: reduce) {
          .cmdbar-wake .cmdbar-kpi, .cmdbar-wake-pill, .cmdbar-wake-btn { animation: none !important; }
          .cmdbar-golive:hover { transform: none; }
        }

        @keyframes shimmer-sweep {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .hero-revenue-shimmer {
          background: linear-gradient(90deg, #60a5fa 0%, #f472b6 25%, #a78bfa 50%, #22d3ee 75%, #60a5fa 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer-sweep 5s linear infinite;
        }
        .card-glow-pink:hover  { box-shadow: 0 0 38px rgba(244,114,182,0.32), 0 8px 32px rgba(0,0,0,0.5) !important; transform: translateY(-4px) !important; }
        .card-glow-cyan:hover  { box-shadow: 0 0 38px rgba(34,211,238,0.28), 0 8px 32px rgba(0,0,0,0.5) !important; transform: translateY(-4px) !important; }
        .card-glow-violet:hover{ box-shadow: 0 0 38px rgba(167,139,250,0.28),0 8px 32px rgba(0,0,0,0.5) !important; transform: translateY(-4px) !important; }
        .card-glow-gold:hover  { box-shadow: 0 0 38px rgba(251,191,36,0.26), 0 8px 32px rgba(0,0,0,0.5) !important; transform: translateY(-4px) !important; }
        .stat-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        @keyframes cmd-pulse { 0%,100% { opacity:1; } 50% { opacity:0.55; } }

        /* ── CSV IMPORTER STATES ── */
        .import-spinner {
          width: 15px; height: 15px; flex-shrink: 0; border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
          animation: spin 0.7s linear infinite;
        }
        .import-progress-track {
          position: relative; height: 4px; border-radius: 4px; overflow: hidden;
          background: rgba(255,255,255,0.06);
        }
        .import-progress-fill {
          position: absolute; top: 0; left: 0; height: 100%; width: 40%; border-radius: 4px;
          background: linear-gradient(90deg,#21E6F3,#6C5CFF,#FF2FAE);
          box-shadow: 0 0 12px rgba(108,92,255,0.65);
          animation: import-progress-sweep 1.15s ease-in-out infinite;
        }
        @keyframes import-progress-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        @keyframes import-flash {
          0%   { opacity: 0;   transform: scale(0.55); }
          35%  { opacity: 0.9; transform: scale(1.2); }
          100% { opacity: 0;   transform: scale(1.5); }
        }
        @keyframes import-check-pop {
          0%   { opacity: 0; transform: scale(0.4); }
          60%  { opacity: 1; transform: scale(1.15); }
          100% { opacity: 1; transform: scale(1); }
        }
        .import-flash-ring { animation: import-flash 900ms ease-out; }
        .import-check-badge { animation: import-check-pop 420ms cubic-bezier(0.34,1.3,0.64,1); }

        /* ── FAN CARD / MESSAGE (HEART-ENVELOPE) ──
           .heart-envelope-btn is hover/focus-only (cheap, no continuous
           repaint) and is safe on every per-row instance across a fan list
           of any size. The continuous "breathing" keyframe lives on
           .heart-envelope-btn-idle instead, which must only ever be applied
           to a single, always-one-at-a-time element (the big "Message Fan"
           button in the profile modal) — running an infinite filter:
           drop-shadow animation on every row of a long fan list pegs the
           GPU/CPU continuously and can make the whole page (and machine)
           unresponsive once a list gets into the hundreds of fans. */
        .heart-envelope-btn:hover, .heart-envelope-btn:focus-visible {
          transform: scale(1.08);
          box-shadow: 0 0 0 3px rgba(255,43,174,0.14), 0 0 10px rgba(255,43,174,0.25);
        }
        @keyframes heart-envelope-breathe {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,43,174,0)); }
          50% { transform: scale(1.045); filter: drop-shadow(0 0 3px rgba(255,43,174,0.32)); }
        }
        .heart-envelope-btn-idle { animation: heart-envelope-breathe 3.4s ease-in-out infinite; }
        .heart-envelope-btn-idle:hover, .heart-envelope-btn-idle:focus-visible {
          transform: scale(1.08);
          box-shadow: 0 0 0 3px rgba(255,43,174,0.14), 0 0 10px rgba(255,43,174,0.25);
        }
        @media (prefers-reduced-motion: reduce) {
          .heart-envelope-btn-idle { animation: none; }
          .heart-envelope-btn:hover, .heart-envelope-btn:focus-visible,
          .heart-envelope-btn-idle:hover, .heart-envelope-btn-idle:focus-visible { transform: none; }
        }
        .tier-filter-btn { transition: background 0.15s ease, color 0.15s ease; }
        .whale-modal-shell { box-shadow: 0 0 36px rgba(34,211,238,0.16), 0 0 54px rgba(124,92,255,0.15), 0 0 44px rgba(255,43,174,0.13), 0 22px 54px rgba(0,0,0,0.55); }
        .whale-modal-grid { display: grid; grid-template-columns: 1fr 220px; gap: 0; align-items: start; }
        .whale-modal-actions-col { border-left: 1px solid rgba(255,255,255,0.08); padding-left: 22px; margin-left: 22px; }
        .whale-hero-metrics { display: grid; grid-template-columns: repeat(4, 1fr); }
        .whale-hero-metric { padding: 0 14px; }
        .whale-hero-metric:first-child { padding-left: 0; }
        .whale-hero-metric:not(:first-child) { border-left: 1px solid rgba(255,255,255,0.1); }
        .whale-intel-split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 640px) {
          .whale-modal-grid { grid-template-columns: 1fr; }
          .whale-modal-actions-col { border-left: none; padding-left: 0; margin-left: 0; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; margin-top: 18px; }
          .whale-hero-metrics { grid-template-columns: repeat(2, 1fr); row-gap: 12px; }
          .whale-hero-metric:nth-child(odd) { border-left: none; padding-left: 0; }
          .whale-intel-split { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", width: 900, height: 900, top: "-20%", left: "-10%", background: "radial-gradient(circle, rgba(59,130,246,0.35), transparent 60%)", filter: "blur(120px)" }} />
        <div style={{ position: "absolute", width: 900, height: 900, bottom: "-20%", right: "-10%", background: "radial-gradient(circle, rgba(236,72,153,0.35), transparent 60%)", filter: "blur(120px)" }} />
      </div>

      {/* SIDEBAR — desktop only, hidden on mobile via CSS */}
      <Sidebar activeTab={activeTab} onTabChange={(tab) => { setActiveTab(tab); if (typeof window !== "undefined") { localStorage.setItem("camcash_tab", tab); window.scrollTo({ top: 0, behavior: "instant" }); } }} user={user} onSignOut={async () => { await supabase.auth.signOut(); router.replace("/login"); }} isPro={isPro} trialEligible={trialEligible} />{/* MAIN CONTENT */}
      <div className="dash-main" style={{ marginLeft: 240, width: "calc(100% - 240px)", minWidth: 0, padding: 32, boxSizing: "border-box", overflowX: "hidden" }}>

        {/* ── TRIAL COUNTDOWN ──
            Shown only while a card-backed trial is actually running (Stripe's
            trial_end, mirrored to profiles.trial_ends_at by the webhook). Not
            an upsell and not a countdown to a lost feature — the user already
            has everything; this is just honest notice of when billing starts,
            with a link to cancel. Disappears the moment the trial converts. */}
        {(() => {
          const daysLeft = trialDaysRemaining(profile)
          if (daysLeft == null) return null
          return (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              padding: '12px 16px', borderRadius: 16, marginBottom: 18,
              background: 'linear-gradient(90deg, rgba(34,211,238,0.10), rgba(236,72,153,0.10))',
              border: '1px solid rgba(34,211,238,0.22)',
            }}>
              <span style={{ fontSize: 13.5, color: C.white, fontWeight: 700 }}>
                {daysLeft === 1 ? 'Last day of your free trial' : `${daysLeft} days left in your free trial`}
              </span>
              <span style={{ fontSize: 12.5, color: C.text }}>
                Your subscription starts automatically when it ends — cancel any time before then.
              </span>
              <button
                onClick={() => setActiveTab('settings')}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.cyan, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Manage billing
              </button>
            </div>
          )
        })()}

        {/* ── STICKY COMMAND BAR ── */}
        {(() => {
          const safeAvg = (!isNaN(avgPerHour) && isFinite(avgPerHour)) ? avgPerHour : 0
          const brief = dailyBrief
          const atPeak = brief?.atPeak
          // Momentum in the command bar reflects the CURRENT live room, not
          // historical revenue trend — it's only meaningful while actually
          // streaming, so outside live mode it reads as a waiting state
          // rather than fabricating a Surging/Declining verdict.
          const liveOnlyTips = liveActive
            ? liveEvents.filter(e => !e._isHistory).map(e => ({ received_at: e.timestamp, usd: e.normalizedRevenue, tokens: e.tokens, username: e.username }))
            : []
          const liveCoachState = liveActive && liveStartTime
            ? computeCoachingState({ tips: liveOnlyTips, startedAt: liveStartTime, goalTokens: liveGoalTokens })
            : null
          const liveMomentumState = liveCoachState
            ? { ...liveCoachState, tipsPerMinute: liveCoachState.elapsedMins > 0 ? parseFloat((liveCoachState.liveOnlyCount / liveCoachState.elapsedMins).toFixed(2)) : 0 }
            : null
          const liveRoomHealth = liveActive ? computeRoomHealth(liveMomentumState) : null
          const momentum = !liveActive ? 'Waiting for live stream'
            : atPeak ? '🔥 AT PEAK'
            : `${liveRoomHealth.directionLabel}`
          const momentumColor = !liveActive ? '#475569'
            : atPeak ? '#10B981'
            : liveRoomHealth.directionColor
          const localNow = toLocalHour(new Date().toISOString(), creatorTz)
          const hoursUntilLocal = canonicalPeakHourLocal != null ? (canonicalPeakHourLocal - localNow + 24) % 24 : brief?.hoursUntilPeak
          const peakLabel = hoursUntilLocal === 0 ? 'NOW' : hoursUntilLocal === 1 ? 'in 1 hr' : (hoursUntilLocal > 0 && !isNaN(hoursUntilLocal)) ? `in ${hoursUntilLocal}h` : null
          const _eiPeakLabel = canonicalPeakLabel || brief?.bhLabel
          // Same precedence as the Daily Brief card below (engineInsights first,
          // then the client-side hour-bucketed calc) — these used to be computed
          // independently, which could show two different "best platform" values
          // on the same screen. tips[0]?.platform is not a real fallback (just
          // whichever tip happens to be first in the array), so it's dropped.
          // ONE canonical answer (analytics.bestPlatformByRate) — ranked by
          // usdPerHour, excluding the parser's "Unknown" bucket and any
          // platform with no measurable hours. engineInsights' best_platform
          // ranks by AVG(usd) PER TIP, which on the owner's real account
          // returned "Unknown" (13 undetected tips averaging $13.51 vs
          // Chaturbate's $0.36 across 4,835), so this KPI read
          // "Best Platform: Unknown" while the Creator Report showed the
          // same bucket at $0.00/hr.
          const bestPlat = analytics?.bestPlatformByRate?.platform || null
          const safeRevenue = (!isNaN(totalRevenue) && isFinite(totalRevenue)) ? totalRevenue : 0

          // ── truthful live status — single source of truth is useLiveSessionEngine,
          // never a second status system. 'active' phase covers server status 'live';
          // live_substate further distinguishes actively-broadcasting from paused. ──
          const livePhase = liveEngine.phase
          const liveSubstate = liveEngine.serverSession?.live_substate
          const isPaused = livePhase === 'active' && liveSubstate === 'paused'
          const statusInfo =
            livePhase === 'starting' ? { label: 'STARTING', color: '#F59E0B', pulse: true } :
            livePhase === 'inactive_warning' ? { label: 'INACTIVE', color: '#FB923C', pulse: true } :
            (livePhase === 'justEnded' || livePhase === 'resolved') ? { label: 'ENDING', color: '#94A3B8', pulse: false } :
            livePhase === 'active' ? { label: isPaused ? 'LIVE · PAUSED' : 'LIVE', color: '#10B981', pulse: !isPaused } :
            { label: 'OFFLINE', color: '#64748B', pulse: false }
          const liveDurationLabel = (() => {
            if (livePhase !== 'active' || !liveEngine.duration) return null
            const secs = liveEngine.duration.active_duration_seconds || 0
            const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
            return h > 0 ? `Live for ${h}h ${m}m` : `Live for ${m}m`
          })()
          const updatedLabel = lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null

          return (
            <div className="sticky-command-bar cmdbar-wake" style={{ position: 'sticky', top: 0, zIndex: 20, marginBottom: 14, marginLeft: -32, marginRight: -32, width: 'calc(100% + 64px)', maxWidth: 'none', padding: '14px 32px', background: 'rgba(5,7,15,0.88)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderBottom: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 2px 24px rgba(0,0,0,0.45)' }}>

              {/* primary row — Total Earned dominant, secondary metrics + Go Live, wraps instead of clipping/scrolling */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px 24px', minWidth: 0 }}>
                  <div className="cmdbar-kpi cmdbar-kpi-1" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: '#8a93ab', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, marginBottom: 3 }}>Total Earned</div>
                    <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1, background: 'linear-gradient(135deg,#60a5fa,#f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', whiteSpace: 'nowrap' }}>${safeRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </div>

                  <div style={{ width: 1, height: 34, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

                  <div className="cmdbar-kpi cmdbar-kpi-2" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
                    <div title={HOURLY_RATE_TOOLTIP} style={{ fontSize: 10, color: '#8a93ab', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, marginBottom: 3, cursor: 'help' }}>Est. $/Hour</div>
                    {hourlyRateUnlocked ? (
                      <div title={hourlyRateSubtext} style={{ fontSize: 18, fontWeight: 800, color: '#22D3EE', whiteSpace: 'nowrap', cursor: 'help' }}>${safeAvg.toFixed(2)}</div>
                    ) : (
                      <div onClick={() => handleTabChange('upload')} title={hourlyRateSubtext} style={{ fontSize: 13, fontWeight: 700, color: '#7d8aa3', whiteSpace: 'nowrap', cursor: 'pointer' }}>🔒 Locked</div>
                    )}
                  </div>

                  <div style={{ width: 1, height: 34, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

                  <div className="cmdbar-kpi cmdbar-kpi-3" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: '#8a93ab', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, marginBottom: 3 }}>Momentum</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: momentumColor, whiteSpace: 'nowrap', animation: atPeak ? 'cmd-pulse 1.5s infinite' : 'none' }}>{momentum}</div>
                  </div>

                  <div className="cmdbar-kpi cmdbar-kpi-4" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0, opacity: 0.85 }}>
                    <div style={{ fontSize: 10, color: '#8a93ab', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, marginBottom: 3 }}>Best Platform</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', whiteSpace: 'nowrap' }}>{bestPlat || '—'}</div>
                  </div>

                  <div className="cmdbar-kpi cmdbar-kpi-5" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0, opacity: 0.85 }}>
                    <div style={{ fontSize: 10, color: '#8a93ab', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, marginBottom: 3 }}>Peak Window</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: atPeak ? '#10B981' : '#fbbf24', whiteSpace: 'nowrap' }}>{_eiPeakLabel ? `${_eiPeakLabel}${peakLabel ? ` · ${peakLabel}` : ''}` : '—'}</div>
                  </div>
                </div>

                <button className="cmdbar-golive cmdbar-wake-btn" onClick={() => { setActiveTab('live'); if (typeof window !== 'undefined') { localStorage.setItem('camcash_tab', 'live'); window.scrollTo({ top: 0, behavior: 'instant' }); } }} style={{ padding: '10px 22px', borderRadius: 12, background: 'linear-gradient(135deg,#10B981,#22D3EE)', border: 'none', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 0 16px rgba(16,185,129,0.25)', letterSpacing: 0.3, flexShrink: 0 }}>
                  ⚡ Go Live
                </button>
              </div>

              {/* secondary row — truthful status pill + updated/live-duration + refresh + new-tip feedback */}
              <div className="cmdbar-wake-pill" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, background: `${statusInfo.color}1A`, border: `1px solid ${statusInfo.color}40` }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusInfo.color, boxShadow: `0 0 6px ${statusInfo.color}`, animation: statusInfo.pulse ? 'pulse-msg 2s infinite' : 'none' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: statusInfo.color, letterSpacing: 0.3 }}>{statusInfo.label}</span>
                </div>

                {(liveDurationLabel || updatedLabel) && (
                  <span key={liveDurationLabel || (lastRefreshed && lastRefreshed.getTime())} className={!liveDurationLabel ? 'recently-updated' : ''} style={{ fontSize: 11, color: '#7d8aa3', padding: '2px 6px', borderRadius: 4 }}>
                    {liveDurationLabel || updatedLabel}
                  </span>
                )}

                {isRefreshing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94A3B8' }}>
                    <div style={{ width: 12, height: 12, border: '1.5px solid rgba(34,211,238,0.3)', borderTopColor: '#22D3EE', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    Refreshing...
                  </div>
                )}
                {newTipCount > 0 && (
                  <div style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(236,72,153,0.15)', border: '1px solid rgba(236,72,153,0.35)', fontSize: 11, fontWeight: 700, color: '#EC4899', animation: 'alertEnter 0.3s ease forwards' }}>
                    +<span key={newTipCount} className={counterBumping ? 'counter-bump' : ''}>{newTipCount}</span> new tip{newTipCount > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* ── DASHBOARD PROGRESS CARD — visible on all tabs when data is warming up ── */}
        {_isLowData && (
          <DashboardProgressCard
            totalTips={tips.length}
            totalSessions={analytics?.meaningfulSessionCount || 0}
            totalFans={analytics?.uniqueFanCount ?? 0}
            totalEarnings={analytics?.totalUSD || 0}
            readiness={dashboardReadiness}
            onImport={() => handleTabChange('upload')}
          />
        )}

        {activeTab === "report" && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <CreatorReport analytics={analytics} tips={tips} isPro={isPro} onUpgrade={() => openUpgradeModal('creator_report')} engineInsights={engineInsights} />
          </div>
        )}

        {activeTab === "settings" && (
          <Settings
            user={user} profile={profile} isPro={isPro} supabase={supabase}
            onTimezoneSaved={(tz) => {
              setProfile(p => ({ ...(p || {}), timezone: tz }))
              loadData(user.id, true, { silent: true })
            }}
          />
        )}

        {activeTab === "overview" && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>

            <OnboardingChecklist
              tips={tips}
              isPro={isPro}
              visitedTabs={visitedTabs}
              onNavigate={handleTabChange}
              onUpgrade={() => openUpgradeModal('default')}
            />

            {/* ═══════════════════════════════════════════════════════
                COMMAND CENTER — DISCOVER -> EXPLAIN -> OPPORTUNITY ->
                ACTION -> MEASURE. Replaces the former sections 1-3
                (Money Snapshot KPI wall, growth charts, Daily Brief),
                which led with totals and buried the insight.
                All values read from the frozen analytics layer.
            ═══════════════════════════════════════════════════════ */}
            <CommandCenter
              analytics={analytics}
              isPro={isPro}
              nowActions={(() => {
                // Moved from the old Overview's "Make Money Right Now"
                // section. Merges nextMoves + top realTimeAlerts, dedupes,
                // and prepends the SQL engine's go-live signal, capped at 3.
                const merged = []
                ;(nextMoves || []).forEach(a => {
                  merged.push({ icon: a.icon, color: a.color || C.cyan, text: a.text, cta: a.cta, username: a.username, source: 'move' })
                })
                ;(realTimeAlerts || []).slice(0, 3).forEach(a => {
                  const isDupe = merged.some(m => m.text && a.message && m.text.toLowerCase().includes((a.title || '').toLowerCase().slice(0, 20)))
                  if (!isDupe) merged.push({ icon: a.icon, color: a.color || C.cyan, text: `${a.title} — ${a.message}`, cta: false, source: 'alert' })
                })
                if (engineInsights?.go_live_status?.status) {
                  const gl = engineInsights.go_live_status
                  const glColor = gl.status === 'peak' ? C.green : gl.status === 'good' ? C.cyan : C.muted
                  const glIcon = gl.status === 'peak' ? '🟢' : gl.status === 'good' ? '⚡' : '⏰'
                  // get_user_insights is called with p_timezone, so
                  // go_live_status.current_hour is ALREADY creator-local.
                  const localHour = gl.current_hour ?? toLocalHour(new Date().toISOString(), creatorTz)
                  const localLabel = localHour === 0 ? '12 AM' : localHour < 12 ? `${Math.floor(localHour)} AM` : localHour === 12 ? '12 PM' : `${Math.floor(localHour) - 12} PM`
                  const glText = gl.multiplier
                    ? `${gl.status === 'peak' ? 'Peak hour right now' : 'Good time to stream'} (${localLabel}) — this window earns ${gl.multiplier}x your average. Go live on ${analytics?.bestPlatformByRate?.platform || 'your top platform'}.`
                    : `Go-live signal: ${gl.status} — check your stream timing`
                  merged.unshift({ icon: glIcon, color: glColor, text: glText, cta: false, source: 'engine' })
                }
                return merged.slice(0, 3)
              })()}
              onMessageFan={(username) => {
                const w = whales.find(wh => wh.username === username)
                if (w) { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) }
              }}
              firstName={profile?.display_name || null}
              onPlanStream={() => handleTabChange('planner')}
              onViewFans={() => handleTabChange('whales')}
              onSeePerformance={() => handleTabChange('platforms')}
              onUpgrade={(src) => openUpgradeModal(src)}
            />

            {/* ═══════════════════════════════════════════════════════
                The Overview's old stacked sections were RELOCATED, not
                deleted, so this tab is one Command Center rather than a
                Command Center with a second dashboard underneath:

                  "Make Money Right Now"  -> CommandCenter (nowActions prop
                                             below; the same merge of
                                             go_live_status + nextMoves +
                                             realTimeAlerts, rendered inside
                                             the Command Center's hierarchy)
                  "What's Working"        -> Performance (platforms tab)
                  "Your Top Earners"      -> Fans (whales tab)
                  "You're Losing Money"   -> Performance (platforms tab)
                  "Revenue Dependency Risk" -> Performance (platforms tab)

                "Smart Insights" was NOT relocated. All three of its insights
                restated a claim already on screen: peak-window (the Command
                Center hero), highest-ROI platform (the hero's evidence chip
                and Performance's Platform ROI cards) and top lifetime
                supporter (Who deserves your attention, and the Fans tab). Its
                only other branch was a fallback asserting "sessions over 60
                minutes earn disproportionately more", which no calculation in
                this repo produces. Per the cleanup rule -- keep genuinely
                synthesized insights, drop repeated claims -- nothing in it
                survived. No logic was lost: every figure it read is still
                rendered by the card that owns it.
            ═══════════════════════════════════════════════════════ */}

            {/* The "Tip Behavior Patterns" card that used to sit here was
                removed in the dead-UI pass: analytics.preTipBehavior was
                permanently null, so it never rendered. It wasn't implemented
                instead because its "peak tipping window" duplicated
                canonicalBestTimes.bestWindow (the single best-time source
                everything else was just consolidated onto) and its
                clusteringDetected/recommendation fields had no definition
                anywhere — filling them in would have meant inventing
                metrics. Avg-gap-between-tips remains available from the SQL
                engine (get_user_insights' session_optimization) if a future
                card wants it, sourced from there rather than a second JS
                implementation. */}

          </div>
        )}

        {/* Trend charts live on Performance, not the Command Center — the
            Command Center answers "what should I do next", this answers
            "what happened". Relocated here from the old Overview tab. */}
        {/* ═══════════════════════════════════════════════════════
            PHASE 3 — PERFORMANCE. Answers "what happened", not "what
            should I do" (the Command Center's job) or "who should I pay
            attention to" (Fans). Replaces three earlier things stacked on
            this tab: the standalone DashboardGrowthCharts mount, the
            sections relocated here from the old Overview in Phase 2
            (What's Working / You're Losing Money / Revenue Dependency
            Risk), and the legacy "Platform Comparison" card pile —
            which itself contained a real defect this rebuild fixes by
            omission: its per-platform "Peak time" insight ranked hours by
            raw total $ earned, not $/hour, the exact thing
            canonical-analytics-rules.md's Best Time section says never to
            do, and it duplicated (and could disagree with) the one
            canonical bestWindow every other surface reads. That insight
            is not reintroduced here.
            All content Performance.js renders is read from the frozen
            analytics layer. DashboardGrowthCharts is the one exception,
            mounted here (not inside Performance.js) because its
            daily/weekly/time-of-day modes need raw tips/sessions —
            Performance.js itself receives analytics only, same discipline
            as CommandCenter.js.
        ═══════════════════════════════════════════════════════ */}
        {activeTab === "platforms" && (
          <Performance
            analytics={analytics}
            isPro={isPro}
            onUpgrade={(src) => openUpgradeModal(src)}
            earningsTrend={tips.length > 0 ? (
              <DashboardGrowthCharts tips={tips} sessions={sessions} monthlyData={analytics?.monthlyData} timezone={creatorTz} />
            ) : null}
          />
        )}

        {/* ═══════════════════════════════════════════════════════
            PHASE 4 — FANS. Answers "who should I pay attention to", as an
            action queue rather than a CRM grid. Replaces two stacked
            blocks: the "Your Top Earners" section relocated here in Phase 2
            (Likely Online / Milestones / At Risk) and the filterable Top
            Fans card grid with its Fan Intelligence panel.

            That relocated block carried a real duplicate calculation: it
            re-bucketed every fan's tips by creator-local hour to find their
            peak hour, which identifyWhales() already computes once
            (typicalOnlineHours, and now its numeric peakLocalHour form).
            Fans.js reads the canonical field instead, so there is one
            implementation of "when is this fan usually around".

            Fans.js reads canonical per-fan fields only and computes
            nothing — same discipline as CommandCenter.js and
            Performance.js. Free/Pro gating uses the same FREE_FAN_LIMIT
            this tab already enforced.
        ═══════════════════════════════════════════════════════ */}
        {activeTab === "whales" && (
          <Fans
            analytics={analytics}
            isPro={isPro}
            freeFanLimit={FREE_FAN_LIMIT}
            onMessageFan={(username) => {
              const w = whales.find(wh => wh.username === username)
              if (w) { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) }
            }}
            onUpgrade={(src) => openUpgradeModal(src)}
            onPlanStream={() => handleTabChange('planner')}
          />
        )}

        {activeTab === "live" && (isPro ? <LiveEnginePage embedded /> : (() => {
          // Live Mode is Pro-only (real-time coaching/room-health/predictive
          // nudges is Layer 3 "Action" intelligence). Per the no-surprise-
          // locks rule: this must be visible and explained BEFORE the user
          // starts a session, never discovered mid-stream — so free users
          // never reach LiveEnginePage at all, not even to see it locked
          // once inside. Personalized where the user's own real data
          // supports it; never a fabricated number.
          const bw = analytics?.canonicalBestTimes?.bestWindow
          const bestWindowLine = bw
            ? `Your data shows a real earning pattern around ${fmtHour(bw.localHour)} — Live Mode tracks your pace against it in real time and tells you when you're ahead or behind.`
            : whales.length > 0
              ? `You have ${whales.length} repeat fan${whales.length === 1 ? '' : 's'} in your history. Live Mode flags them the moment they show up in a session, in real time.`
              : `Live Mode tracks your session pace, room health, and fan activity in real time while you stream.`
          return (
            <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 0' }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🔴</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.white, marginBottom: 8 }}>While you&apos;re live, CamCash can watch your pace for you</div>
                <div style={{ fontSize: 13, color: C.muted, maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>{bestWindowLine}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
                {[
                  { icon: '⚡', label: 'Real-time revenue pace', desc: 'See exactly how tonight compares to your average as tips come in.' },
                  { icon: '🐳', label: 'Whale alerts', desc: 'Know instantly when a top fan joins your room.' },
                  { icon: '🧭', label: 'Room-health coaching', desc: 'Live prompts when engagement or pace is slipping.' },
                  { icon: '🎯', label: 'Peak-window countdown', desc: 'A live countdown to your own historical best hour.' },
                ].map((f, i) => (
                  <div key={i} style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize: 18, marginBottom: 6 }}>{f.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.white, marginBottom: 3 }}>{f.label}</div>
                    <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{f.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center' }}>
                <button onClick={() => openUpgradeModal('live_mode_locked')} style={{ padding: '12px 28px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13, color: '#06101A', background: 'linear-gradient(135deg,#22D3EE,#EC4899)', animation: 'upgradeGlow 2.2s ease-in-out infinite' }}>
                  {trialEligible ? "Start My 7-Day Pro Trial →" : "Turn On Live Coaching →"}
                </button>
              </div>
            </div>
          )
        })())}

        {activeTab === "live-sessions" && (() => {
          const fmtSessionDuration = (secs) => {
            const s = Math.max(0, Math.floor(secs || 0))
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
            return h > 0 ? `${h}h ${m}m` : `${m}m`
          }
          const RESOLUTION_LABEL = {
            normal_stop: 'Ended manually',
            end_at_last_heartbeat: 'Auto-ended (inactivity)',
            chosen_end_time: 'End time corrected',
            marked_invalid: 'Marked invalid',
          }

          return (
            <div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.white, marginBottom: 4 }}>Live Mode Sessions</div>
                <div style={{ fontSize: 13, color: C.muted }}>
                  A read-only report of your past Live Mode sessions — pulled directly from the same session record every surface (dashboard, extension, Live Mode tab) shares. To go live, use the <b>Live Mode</b> tab.
                </div>
              </div>

              {replayLoading && (
                <div style={{ ...glassCard, borderRadius: 16, padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>
                  Loading session history…
                </div>
              )}

              {!replayLoading && replaySessions.length === 0 && (
                <div style={{ ...glassCard, borderRadius: 16, padding: 40, textAlign: 'center' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>📼</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.white, marginBottom: 6 }}>No completed sessions yet</div>
                  <div style={{ fontSize: 13, color: C.muted }}>Once you end a Live Mode session, it'll show up here with what happened and what coaching fired during it.</div>
                </div>
              )}

              {!replayLoading && replaySessions.map((s) => {
                const activeSecs = s.ended_at
                  ? (new Date(s.ended_at) - new Date(s.started_at)) / 1000 - (s.total_paused_seconds || 0)
                  : 0
                const isExpanded = expandedReplayId === s.id
                const events = replayCoachingEvents[s.id]
                return (
                  <div key={s.id} style={{ ...glassCard, borderRadius: 14, padding: 18, marginBottom: 12, opacity: s.is_inaccurate ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.white }}>
                          {s.stream_platform || 'Chaturbate'} — {new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                          {new Date(s.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {fmtSessionDuration(activeSecs)} · {RESOLUTION_LABEL[s.session_resolution_type] || 'Ended'}
                          {s.is_inaccurate && ' · excluded from stats'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>${(s.session_earnings_usd || 0).toFixed(2)}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>{s.tip_count || 0} tips · {s.unique_tipper_count || 0} supporters</div>
                        </div>
                        <button
                          onClick={() => {
                            const next = isExpanded ? null : s.id
                            setExpandedReplayId(next)
                            if (next) loadReplayCoachingEvents(s.id)
                          }}
                          style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: C.muted, fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                          {isExpanded ? 'Hide' : 'Coaching timeline'}
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        {replayCoachingLoading === s.id && (
                          <div style={{ fontSize: 12, color: C.muted }}>Loading coaching timeline…</div>
                        )}
                        {replayCoachingLoading !== s.id && events && events.length === 0 && (
                          <div style={{ fontSize: 12, color: C.muted }}>No coaching prompts fired during this session.</div>
                        )}
                        {replayCoachingLoading !== s.id && events && events.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {events.map((e) => (
                              <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12 }}>
                                <span style={{ color: C.dim, minWidth: 62, fontVariantNumeric: 'tabular-nums' }}>
                                  {new Date(e.shown_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                </span>
                                <span style={{
                                  padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, flexShrink: 0,
                                  background: e.action_status === 'performed' ? 'rgba(16,185,129,0.15)' : e.action_status === 'skipped' ? 'rgba(148,163,184,0.15)' : 'rgba(245,158,11,0.15)',
                                  color: e.action_status === 'performed' ? C.green : e.action_status === 'skipped' ? C.muted : C.gold,
                                }}>
                                  {e.action_status === 'performed' ? 'Done' : e.action_status === 'skipped' ? 'Skipped' : 'Unmarked'}
                                </span>
                                <span style={{ color: C.white }}>{e.title || e.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {activeTab === "sessions" && (() => {
          const displaySessions = meaningfulOnly
            ? (analytics?.meaningfulSessions || sessions)
            : (analytics?.allValidSessions   || sessions)

          // Every clock/date on this tab renders in the creator's resolved
          // timezone, not the browser's. Bare toLocaleTimeString() here meant
          // a creator reviewing sessions while travelling saw start/end times
          // that disagreed with every other tab (see the same bug called out
          // at the platform-hour bucketing above).
          const fmtClock = ms => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: creatorTz })
          const fmtDay   = iso => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: creatorTz })

          // ── SESSION BREAKDOWN ENGINE ────────────────────────────────
          // Pure logic — runs on each session's tips array
          const getSessionBreakdown = (s) => {
            const rawTips = s.tips || []
            if (rawTips.length === 0) return null

            const sorted = [...rawTips].sort((a, b) =>
              new Date(a.dateRaw || a.date_time) - new Date(b.dateRaw || b.date_time)
            )

            const startMs = new Date(s.startTime).getTime()
            const endMs   = new Date(s.endTime).getTime()
            const durationMins = Math.max(s.durationMinutes || 1, 1)

            // ── TIMELINE BUCKETS (5-min intervals) ──────────────────
            const bucketCount = Math.max(Math.ceil(durationMins / 5), 1)
            const buckets = Array.from({ length: bucketCount }, (_, i) => ({
              label: `${i * 5}m`,
              usd: 0,
              count: 0,
            }))
            sorted.forEach(t => {
              const tMs = new Date(t.dateRaw || t.date_time).getTime()
              const minOffset = (tMs - startMs) / 60000
              const idx = Math.min(Math.floor(minOffset / 5), bucketCount - 1)
              if (idx >= 0 && idx < buckets.length) {
                buckets[idx].usd += parseFloat(t.usd) || 0
                buckets[idx].count += 1
              }
            })

            // ── PEAK BUCKET ─────────────────────────────────────────
            const peakBucket = [...buckets].sort((a, b) => b.usd - a.usd)[0]
            const peakBucketIdx = buckets.indexOf(peakBucket)
            const peakMinute = peakBucketIdx * 5
            const peakTime = new Date(startMs + peakMinute * 60000)

            // ── FIRST HALF vs SECOND HALF ────────────────────────────
            // Read straight off the session — finalizeSession() already split
            // it at the timestamp midpoint, and that is the same split
            // velocityTrend uses. Re-halving by 5-minute bucket index here
            // disagreed with the momentum badge on any odd bucket count, so a
            // card could show "First half 62%" beside "Momentum building".
            const firstHalfPct = s.firstHalfPct

            // ── TOP TIPPERS ─────────────────────────────────────────
            const tipperMap = {}
            sorted.forEach(t => {
              const u = t.username || "unknown"
              tipperMap[u] = (tipperMap[u] || 0) + (parseFloat(t.usd) || 0)
            })
            const topTippers = Object.entries(tipperMap)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([username, usd]) => ({
                username,
                usd: parseFloat(usd.toFixed(2)),
                pct: s.totalUSD > 0 ? Math.round((usd / s.totalUSD) * 100) : 0,
              }))

            // ── SPIKES (bucket > 2x avg) ─────────────────────────────
            const avgBucketUSD = s.totalUSD / buckets.length
            const spikes = buckets
              .map((b, i) => ({ ...b, idx: i }))
              .filter(b => b.usd >= avgBucketUSD * 2 && b.usd > 0)
              .map(b => ({
                minute: b.idx * 5,
                usd: parseFloat(b.usd.toFixed(2)),
                time: fmtClock(startMs + b.idx * 5 * 60000),
              }))
            // `spikes` stays chronological for the timeline. Anything that
            // says "biggest" must read this instead — sorting by USD, not by
            // time. spikes[0] is the EARLIEST spike, and captioning the gold
            // peak bar with it pointed the label at a different bar.
            const topSpike = spikes.length
              ? [...spikes].sort((a, b) => b.usd - a.usd)[0]
              : null

            // ── PERFORMANCE vs historical avg ────────────────────────
            const allAvg = displaySessions.length > 0
              ? displaySessions.reduce((s, x) => s + x.totalUSD, 0) / displaySessions.length
              : 0
            const performance = s.totalUSD >= allAvg * 1.3
              ? "high"
              : s.totalUSD <= allAvg * 0.6
              ? "low"
              : "average"

            // ── REVENUE PER MINUTE ───────────────────────────────────
            // s.usdPerMinute is null on durationUnknown sessions. Deriving it
            // locally as totalUSD/durationMins printed a confident $X.XX/min
            // in the header while the $/Min metric right below it showed "—".
            const revenuePerMin = s.usdPerMinute

            // ── INSIGHTS ────────────────────────────────────────────
            const insights = []
            if (firstHalfPct >= 60)
              insights.push(`You earned ${firstHalfPct}% of your revenue in the first half of the stream`)
            if (firstHalfPct <= 35 && durationMins > 20)
              insights.push(`Your stream warmed up slowly — earnings picked up in the second half`)
            if (topTippers[0] && topTippers[0].pct >= 40)
              insights.push(`${topTippers[0].username} drove ${topTippers[0].pct}% of this session's revenue`)
            if (topSpike)
              insights.push(`Your biggest spike was at ${topSpike.time} — $${topSpike.usd} in 5 minutes`)
            if (s.uniqueFans === 1)
              insights.push(`Only one fan tipped this session — great loyalty, but audience diversity helps`)
            if (s.uniqueFans >= 5)
              insights.push(`${s.uniqueFans} different fans tipped — strong audience engagement`)
            if (durationMins < 20 && s.totalUSD > 0)
              insights.push(`Short session (${Math.round(durationMins)} min) with solid earnings — your hook is working`)
            if (performance === "high")
              insights.push(`This was one of your top sessions — $${s.totalUSD} vs $${allAvg.toFixed(0)} avg`)
            if (performance === "low")
              insights.push(`Below your average session ($${allAvg.toFixed(0)}) — see recommendations below`)

            // ── RECOMMENDATIONS ─────────────────────────────────────
            const recommendations = []
            if (firstHalfPct >= 60)
              recommendations.push("Your best earnings happen early — open with high energy and a strong tip goal right away")
            if (firstHalfPct <= 35)
              recommendations.push("Slow start detected — open with a countdown goal or shoutout to get early tipping momentum")
            if (topTippers[0] && topTippers[0].pct >= 50)
              recommendations.push(`Retain ${topTippers[0].username} — they drove half your session. Give them public recognition next time`)
            if (s.uniqueFans <= 2 && s.tipCount > 10)
              recommendations.push("Diversify your audience — most tips came from 1–2 fans. Engage lurkers with low-barrier goals")
            if (durationMins < 30 && s.totalUSD > 0)
              // "could 2x your earnings" removed — that multiplier was hardcoded,
              // not derived from this creator's short-vs-long session history or
              // any calculation in the codebase, while reading as her own data.
              recommendations.push(`You earned $${s.totalUSD} in ${Math.round(durationMins)} min — short sessions give tipping momentum less time to build. Try extending to 45–60 min`)
            if (spikes.length >= 2)
              recommendations.push("Multiple spike moments detected — identify what triggered them and recreate it intentionally")
            if (revenuePerMin !== null && revenuePerMin > 0 && revenuePerMin < 0.10)
              recommendations.push("Low revenue per minute — try setting a token goal every 15 min to maintain tipping momentum")
            if (performance === "high")
              recommendations.push("Replicate this stream: same time, same platform, similar energy — your data supports it")
            if (recommendations.length === 0)
              recommendations.push("Keep streaming consistently — more data helps us give you sharper recommendations")

            return {
              buckets, peakTime, peakBucket, firstHalfPct,
              topTippers, spikes, topSpike, performance, revenuePerMin,
              insights, recommendations,
            }
          }

          // ── PERFORMANCE BADGE CONFIG ────────────────────────────────
          const PERF = {
            high:    { label: "🔥 High Performing", color: "#10B981", bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)" },
            average: { label: "📊 Average",          color: "#F59E0B", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)" },
            low:     { label: "📉 Underperforming",  color: "#F87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.25)" },
          }

          const avgSession = displaySessions.length ? displaySessions.reduce((s,x) => s+x.totalUSD,0)/displaySessions.length : 0

          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
                <div>
                  <h1 style={{ fontSize: 28, fontWeight: 800, color: C.white, marginBottom: 4 }}>🎥 Session Breakdown</h1>
                  <p style={{ fontSize: 13, color: C.muted }}>What happened in each free-chat stream and how to earn more next time. Session cards below cover public tips only — the mix panel shows every stream.</p>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', borderRadius:20, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', flexShrink:0 }}>
                  <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:C.muted }}>
                    <input type="checkbox" checked={meaningfulOnly} onChange={e => setMeaningfulOnly(e.target.checked)} style={{ accentColor: C.cyan }} />
                    Meaningful sessions only
                  </label>
                  {(analytics?.lowSignalSessionCount > 0) && (
                    <span style={{ fontSize:11, color:C.muted }}>({analytics.lowSignalSessionCount} low-signal hidden)</span>
                  )}
                </div>
              </div>

              {/* EARNINGS MIX — free chat vs private/full-private/group/spy vs
                  Live Mode, toggleable to a per-platform view. Sits above the
                  stats bar because the bar's totals are free-chat-only, which
                  read as all-earnings without this context. */}
              <SessionRevenueMix
                C={C}
                glassCard={glassCard}
                freeChatSessions={displaySessions}
                paidSessions={paidSessions}
                liveTotalUSD={liveTipsTotalUSD}
                populationLabel={meaningfulOnly ? 'meaningful sessions only' : 'all valid sessions'}
              />

              {/* OVERVIEW STATS BAR */}
              {displaySessions.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
                  {[
                    { label: "Total Sessions", value: displaySessions.length, color: C.cyan },
                    { label: "Avg Earnings", value: `$${avgSession.toFixed(2)}`, color: C.green },
                    { label: "Best Session", value: `$${Math.max(...displaySessions.map(s => s.totalUSD)).toFixed(2)}`, color: C.gold },
                    { label: "Free-Chat Earned", value: `$${displaySessions.reduce((s,x) => s+x.totalUSD,0).toFixed(2)}`, color: C.pink },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ ...glassCard, borderRadius: 12, padding: "16px 18px" }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* SESSION CARDS */}
              {displaySessions.length === 0 && (
                <div style={{ ...glassCard, borderRadius: 14, padding: 40, textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🎥</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>{sessions.length > 0 ? 'No meaningful sessions match this filter' : 'No sessions yet'}</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>{sessions.length > 0 ? 'Try unchecking "Meaningful sessions only" to see all sessions' : 'Import your CSV data to see session breakdowns'}</div>
                  {sessions.length > 0 && meaningfulOnly && <button onClick={() => setMeaningfulOnly(false)} style={{ marginTop:12, padding:'7px 18px', borderRadius:8, background:'rgba(34,211,238,0.12)', border:'1px solid rgba(34,211,238,0.3)', color:C.cyan, fontSize:12, cursor:'pointer' }}>Show all sessions</button>}
                </div>
              )}

              {displaySessions.map((s, si) => {
                const bd = getSessionBreakdown(s)
                if (!bd) return null
                const perf = PERF[bd.performance]
                const maxBucketUSD = Math.max(...bd.buckets.map(b => b.usd), 0.01)
                const fmt = dt => fmtClock(new Date(dt).getTime())

                return (
                  <div key={si} style={{ ...glassCard, borderRadius: 16, marginBottom: 24, overflow: "hidden" }}>

                    {/* SESSION HEADER */}
                    <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: C.white }}>
                            {fmtDay(s.startTime)}
                          </span>
                          <span style={{ fontSize: 13, color: C.muted }}>{fmt(s.startTime)} → {fmt(s.endTime)}</span>
                          <span style={{ fontSize: 12, color: C.muted }}>• {s.platform}</span>
                        </div>
                        <span style={{ padding: "3px 10px", borderRadius: 20, background: perf.bg, border: `1px solid ${perf.border}`, fontSize: 11, fontWeight: 700, color: perf.color }}>{perf.label}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: C.green }}>${s.totalUSD.toFixed(2)}</div>
                        <div style={{ fontSize: 12, color: C.muted }}>{Math.round(s.durationMinutes)} min{bd.revenuePerMin !== null ? ` • $${bd.revenuePerMin.toFixed(2)}/min` : ""}</div>
                      </div>
                    </div>

                    <div style={{ padding: 24 }}>

                      {/* REVENUE GAP — vs last 5 sessions */}
                      {(() => {
                        const recentSessions = displaySessions.filter(x => x.id !== s.id && !x.durationUnknown)
                        const comparable = recentSessions.filter(x => x.platform === s.platform).slice(-5)
                        const base = comparable.length >= 3 ? comparable : recentSessions.slice(-5)
                        if (base.length < 2 || s.durationUnknown) return null
                        const expected = base.reduce((a, x) => a + x.totalUSD, 0) / base.length
                        const gap = expected - s.totalUSD
                        const gapPct = expected > 0 ? Math.round((gap / expected) * 100) : 0
                        if (Math.abs(gapPct) < 10) return null
                        const isUnder = gap > 0
                        const color = isUnder ? C.red : C.green
                        const bg    = isUnder ? "rgba(248,113,113,0.06)" : "rgba(16,185,129,0.06)"
                        const bdr   = isUnder ? "rgba(248,113,113,0.25)" : "rgba(16,185,129,0.25)"
                        return (
                          <div style={{ padding: "10px 14px", borderRadius: 10, background: bg, border: `1px solid ${bdr}`, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 13, color, fontWeight: 600 }}>
                              {isUnder ? `⚠️ $${gap.toFixed(0)} below your avg session ($${expected.toFixed(0)}) — ${gapPct}% shortfall` : `✅ $${Math.abs(gap).toFixed(0)} above your avg session — top ${Math.abs(gapPct)}% performance`}
                            </span>
                          </div>
                        )
                      })()}

                      {/* CORE METRICS */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
                        {[
                          { label: "Tips",        value: s.tipCount,                    color: C.cyan  },
                          { label: "Unique Fans", value: s.uniqueFans,                  color: C.pink  },
                          { label: "Avg Tip",     value: `$${s.avgTipSize}`,            color: C.gold  },
                          { label: "$/Hour",      value: s.usdPerHour !== null ? `$${s.usdPerHour}` : "—",  color: C.green },
                          { label: "$/Min",       value: s.usdPerMinute !== null ? `$${s.usdPerMinute}` : "—", color: C.cyan },
                        ].map(({ label, value, color }) => (
                          <div key={label} style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
                          </div>
                        ))}
                      </div>

                      {/* VELOCITY + CONCENTRATION ROW */}
                      {(s.velocityTrend !== 'unknown' || s.topContributorPct >= 40) && (
                        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
                          {s.velocityTrend !== 'unknown' && (() => {
                            const vConfig = {
                              growing: { icon: "📈", label: "Momentum building", color: C.green, bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.25)" },
                              dying:   { icon: "📉", label: "Earnings slowing", color: C.red,   bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.25)" },
                              steady:  { icon: "➡️", label: "Steady pace",       color: C.muted, bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)" },
                            }
                            const v = vConfig[s.velocityTrend]
                            const pctChange = s.firstHalfUPM && s.secondHalfUPM
                              ? Math.round(Math.abs((s.secondHalfUPM - s.firstHalfUPM) / s.firstHalfUPM) * 100)
                              : null
                            return (
                              <div style={{ flex: 1, minWidth: 180, padding: "10px 14px", borderRadius: 10, background: v.bg, border: `1px solid ${v.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 16 }}>{v.icon}</span>
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: v.color }}>{v.label}</div>
                                  {pctChange !== null && (
                                    <div style={{ fontSize: 11, color: C.muted }}>
                                      {s.velocityTrend === 'growing' ? `+${pctChange}%` : s.velocityTrend === 'dying' ? `-${pctChange}%` : '~0%'} vs first half
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })()}
                          {s.topContributorPct >= 40 && (
                            <div style={{ flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 16 }}>⚠️</span>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: C.gold }}>{s.topContributorPct}% from one fan</div>
                                <div style={{ fontSize: 11, color: C.muted }}>{s.topContributor} drove most of this session</div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* TIMELINE CHART */}
                      {bd.buckets.length > 1 && (
                        <div style={{ marginBottom: 24 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>⏱ Earnings Timeline (5-min buckets)</div>
                          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 64, padding: "0 0 4px" }}>
                            {bd.buckets.map((b, bi) => {
                              const heightPct = maxBucketUSD > 0 ? (b.usd / maxBucketUSD) : 0
                              const isPeak = bi === bd.buckets.indexOf(bd.peakBucket)
                              const barColor = isPeak ? C.gold : b.usd > 0 ? C.cyan : "rgba(255,255,255,0.06)"
                              return (
                                <div key={bi} title={`${b.label}: $${b.usd.toFixed(2)}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                                  <div style={{ width: "100%", height: `${Math.max(heightPct * 100, b.usd > 0 ? 4 : 2)}%`, background: barColor, borderRadius: "3px 3px 0 0", transition: "height 0.3s", minHeight: b.usd > 0 ? 4 : 2 }} />
                                </div>
                              )
                            })}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                            <span style={{ fontSize: 9, color: C.muted }}>{fmt(s.startTime)}</span>
                            {bd.peakBucket?.usd > 0 && <span style={{ fontSize: 9, color: C.gold }}>🔥 Peak at {fmtClock(bd.peakTime.getTime())}</span>}
                            <span style={{ fontSize: 9, color: C.muted }}>{fmt(s.endTime)}</span>
                          </div>
                        </div>
                      )}

                      {/* FIRST HALF vs SECOND HALF */}
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>📊 Session Pacing</div>
                        <div style={{ display: "flex", height: 28, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <div style={{ width: `${bd.firstHalfPct}%`, background: "linear-gradient(90deg, #22D3EE, #60A5FA)", display: "flex", alignItems: "center", justifyContent: "center", transition: "width 0.4s" }}>
                            {bd.firstHalfPct >= 20 && <span style={{ fontSize: 10, fontWeight: 800, color: "#fff" }}>First half {bd.firstHalfPct}%</span>}
                          </div>
                          <div style={{ flex: 1, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {100 - bd.firstHalfPct >= 20 && <span style={{ fontSize: 10, color: C.muted }}>Second half {100 - bd.firstHalfPct}%</span>}
                          </div>
                        </div>
                      </div>

                      {/* TOP TIPPERS */}
                      {bd.topTippers.length > 0 && (
                        <div style={{ marginBottom: 24 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>🏆 Top Contributors</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {bd.topTippers.map((t, ti) => (
                              <div key={ti} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <span style={{ fontSize: 14, flexShrink: 0 }}>{["🥇","🥈","🥉"][ti]}</span>
                                <span style={{ fontSize: 13, color: C.white, fontWeight: 600, minWidth: 100 }}>{t.username}</span>
                                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${t.pct}%`, background: ti === 0 ? `linear-gradient(90deg, ${C.gold}, ${C.orange})` : ti === 1 ? C.cyan : C.muted, borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: 12, color: C.green, fontWeight: 700, flexShrink: 0 }}>${t.usd}</span>
                                <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>{t.pct}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* INSIGHTS + RECOMMENDATIONS side by side */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                        {/* INSIGHTS */}
                        <div style={{ padding: "14px 16px", background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.cyan, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>💡 What Happened</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            {bd.insights.map((ins, ii) => (
                              <div key={ii} style={{ fontSize: 12, color: C.text, lineHeight: 1.5, display: "flex", gap: 6 }}>
                                <span style={{ color: C.cyan, flexShrink: 0 }}>→</span>
                                <span>{ins}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* RECOMMENDATIONS */}
                        <div style={{ padding: "14px 16px", background: "rgba(236,72,153,0.06)", border: "1px solid rgba(236,72,153,0.2)", borderRadius: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.pink, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>🚀 Do This Next Time</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            {bd.recommendations.map((rec, ri) => (
                              <div key={ri} style={{ fontSize: 12, color: C.text, lineHeight: 1.5, display: "flex", gap: 6 }}>
                                <span style={{ color: C.pink, flexShrink: 0 }}>•</span>
                                <span>{rec}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {activeTab === "data" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ fontSize: 28, fontWeight: 800, color: C.white }}>📝 Edit Data</h1>

            {/* TOKEN RATE CONFIGURATOR */}
            <div style={{ ...glassCard, borderRadius: 14, padding: 20, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showRateEditor ? 16 : 0 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.white }}>⚙️ Token → USD Rates</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Configurable per platform. Default is $0.05/token (Chaturbate standard)</div>
                </div>
                <button onClick={() => setShowRateEditor(v => !v)} style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.3)", color: C.cyan, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {showRateEditor ? "▲ Close" : "✏️ Edit Rates"}
                </button>
              </div>
              {showRateEditor && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
                    {Object.entries(tokenRates).map(([plat, rate]) => (
                      <div key={plat} style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: "uppercase" }}>{plat}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 13, color: C.muted }}>$</span>
                          <input
                            type="number" step="0.001" min="0.001" max="1"
                            value={rate}
                            onChange={e => setTokenRates(r => ({ ...r, [plat]: parseFloat(e.target.value) || 0.05 }))}
                            style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "6px 8px", color: C.white, fontSize: 13, outline: "none" }}
                          />
                          <span style={{ fontSize: 11, color: C.muted }}>/token</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, padding: "8px 12px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8 }}>
                    💡 Chaturbate pays $0.05/token to broadcasters. BongaCams, Stripchat, and others vary — check your payout page. Changes apply to new uploads only.
                  </div>
                </div>
              )}
            </div>
              <button onClick={() => setShowDeleteConfirm(true)} style={{ padding: "10px 20px", borderRadius: 8, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)", color: C.red, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑️ Delete All Tips</button>
            </div>

            <div style={{ ...glassCard, borderRadius: 14, padding: 16, marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Filter by date:</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: C.muted }}>From</span>
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setTipPage(0) }}
                  min={tips.length ? new Date(Math.min(...tips.map(t => new Date(t.date_time)))).toISOString().split('T')[0] : ''}
                  max={dateTo || new Date().toISOString().split('T')[0]}
                  style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: C.white, fontSize: 13, colorScheme: "dark" }} />
                <span style={{ fontSize: 12, color: C.muted }}>To</span>
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setTipPage(0) }}
                  min={dateFrom || (tips.length ? new Date(Math.min(...tips.map(t => new Date(t.date_time)))).toISOString().split('T')[0] : '')}
                  max={new Date().toISOString().split('T')[0]}
                  style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: C.white, fontSize: 13, colorScheme: "dark" }} />
              </div>
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); setTipPage(0) }}
                  style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: C.muted, fontSize: 12, cursor: "pointer" }}>
                  ✕ Clear
                </button>
              )}
            </div>

            {(() => {
              const filtered = tips.filter(t => {
                const d = new Date(t.date_time)
                if (dateFrom && d < new Date(dateFrom)) return false
                if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false
                return true
              })
              const PAGE = 100
              const totalPages = Math.ceil(filtered.length / PAGE)
              const pageTips = filtered.slice(tipPage * PAGE, (tipPage + 1) * PAGE)

              return (
                <>
                  <div style={{ ...glassCard, borderRadius: 14, padding: 16, marginBottom: 16, display: "flex", gap: 24 }}>
                    <div style={{ fontSize: 14, color: C.muted }}>Showing <span style={{ color: C.white, fontWeight: 600 }}>{filtered.length}</span> tips{(dateFrom || dateTo) ? ' (filtered)' : ''}</div>
                    <div style={{ fontSize: 14, color: C.muted }}>Total: <span style={{ color: C.green, fontWeight: 700 }}>${filtered.reduce((s, t) => s + t.usd, 0).toFixed(2)}</span></div>
                  </div>

                  <div style={{ ...glassCard, borderRadius: 14, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                          {["Date", "Username", "Platform", "Amount", "Tokens", "Type", "Actions"].map(h => (
                            <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: C.muted, fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageTips.map((t, i) => (
                          <tr key={t.id || i} className="whale-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                            <td style={{ padding: "12px 16px", color: C.white, fontSize: 12 }}>{new Date(t.date_time).toLocaleDateString()}</td>
                            <td style={{ padding: "12px 16px", color: C.white, fontWeight: 600 }}>{t.username}</td>
                            <td style={{ padding: "12px 16px", color: C.muted }}>{t.platform}</td>
                            <td style={{ padding: "12px 16px", color: C.green, fontWeight: 700 }}>${t.usd.toFixed(2)}</td>
                            <td style={{ padding: "12px 16px", color: C.cyan }}>{t.tokens}</td>
                            <td style={{ padding: "12px 16px", color: C.muted, fontSize: 12 }}>{t.tip_type}</td>
                            <td style={{ padding: "12px 16px" }}>
                              <button onClick={() => deleteTip(t.id)} style={{ padding: "4px 12px", borderRadius: 6, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)", color: C.red, fontSize: 11, cursor: "pointer" }}>Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {totalPages > 1 && (
                      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.02)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <button onClick={() => setTipPage(p => Math.max(0, p - 1))} disabled={tipPage === 0}
                          style={{ padding: "7px 18px", borderRadius: 8, background: tipPage === 0 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: tipPage === 0 ? C.muted : C.white, fontSize: 13, cursor: tipPage === 0 ? "not-allowed" : "pointer" }}>
                          ← Prev
                        </button>
                        <div style={{ fontSize: 13, color: C.muted }}>
                          Page <span style={{ color: C.white, fontWeight: 600 }}>{tipPage + 1}</span> of <span style={{ color: C.white, fontWeight: 600 }}>{totalPages}</span>
                          <span style={{ marginLeft: 12 }}>({tipPage * PAGE + 1}–{Math.min((tipPage + 1) * PAGE, filtered.length)} of {filtered.length})</span>
                        </div>
                        <button onClick={() => setTipPage(p => Math.min(totalPages - 1, p + 1))} disabled={tipPage >= totalPages - 1}
                          style={{ padding: "7px 18px", borderRadius: 8, background: tipPage >= totalPages - 1 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: tipPage >= totalPages - 1 ? C.muted : C.white, fontSize: 13, cursor: tipPage >= totalPages - 1 ? "not-allowed" : "pointer" }}>
                          Next →
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {activeTab === "upload" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: C.white, marginBottom: 8 }}>📥 Import CSV</h1>
            <p style={{ fontSize: 14, color: C.muted, marginBottom: 12 }}>
              {isPro ? "Unlimited platforms • Auto-removes duplicates" : freePlatformLimitReached ? `Free plan — tracking ${allPlatforms[0]}. Auto-removes duplicates.` : "Free plan tracks 1 platform. Auto-removes duplicates."}
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: freePlatformLimitReached ? 16 : 32 }}>
              <a href="/blog/how-to-upload-csv-to-camcash" style={{ fontSize: 13, color: C.cyan, textDecoration: "none", fontWeight: 600 }}>📹 Watch the SOP: How to upload a CSV →</a>
              <a href="#csv-help" style={{ fontSize: 13, color: C.cyan, textDecoration: "none", fontWeight: 600 }}>❓ CSV help →</a>
            </div>
            {freePlatformLimitReached && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)", marginBottom: 16 }}>
                <span style={{ fontSize: 18 }}>🔒</span>
                <div style={{ flex: 1, fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>
                  You're on the free plan (1 platform). Upgrade to Pro to add BongaCams, MyFreeCams, and more.
                </div>
                <Button onClick={() => openUpgradeModal('multi_platform')} style={{ flexShrink: 0, padding: "8px 14px", fontSize: 12, whiteSpace: "nowrap" }}>Upgrade →</Button>
              </div>
            )}
            <div style={{ ...glassCard, borderRadius: 14, padding: 32, marginBottom: 16, position: "relative", overflow: "hidden" }}>
              {!['success', 'locked_preview'].includes(importStage) && (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "block" }}>Platform (optional — helps if auto-detect fails)</label>
                  <select value={uploadPlatform} onChange={e => setUploadPlatform(e.target.value)} disabled={uploading}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: C.white, fontSize: 14, outline: "none", opacity: uploading ? 0.6 : 1 }}>
                    <option value="">Auto-detect (recommended)</option>
                    {["Chaturbate", "BongaCams", "MyFreeCams", "Stripchat", "CamSoda"].map(p => {
                      // Not disabled: a locked platform must stay selectable so
                      // uploading against it can show the preview + soft paywall
                      // below, instead of silently blocking selection itself.
                      const locked = freePlatformLimitReached && !allPlatforms.includes(p)
                      return <option key={p} value={p}>{locked ? `🔒 ${p} — requires Pro` : p}</option>
                    })}
                  </select>
                </div>
              )}

              {(importStage === 'idle') && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
                  <Button as="label" style={{ padding: "14px 32px", fontSize: 15 }}>
                    Upload CSV
                    <input type="file" accept=".csv,.txt" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files[0]; e.target.value = ''; handleCSV(f, uploadPlatform || null) }} />
                  </Button>
                  <p style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>Supports Chaturbate, BongaCams, MyFreeCams, Stripchat, CamSoda</p>
                </div>
              )}

              {importStage === 'processing' && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 12, animation: "pulse-msg 1.6s ease-in-out infinite" }}>📁</div>
                  <Button disabled style={{ padding: "14px 32px", fontSize: 15, minWidth: 236 }}>
                    <span className="import-spinner" />
                    {IMPORT_MESSAGES[importMessageIdx]}
                  </Button>
                  <div className="import-progress-track" style={{ marginTop: 20 }}>
                    <div className="import-progress-fill" />
                  </div>
                  <p style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>Hang tight — this only takes a moment.</p>
                </div>
              )}

              {importStage === 'success' && lastUploadResult?.success && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ position: "relative", width: 56, height: 56, margin: "0 auto 14px" }}>
                    <div className="import-flash-ring" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle,rgba(34,211,238,0.55),rgba(236,72,153,0.35) 60%,transparent 70%)" }} />
                    <div className="import-check-badge" style={{ position: "relative", width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#10B981,#22D3EE)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#fff", boxShadow: "0 0 24px rgba(16,185,129,0.45)" }}>✓</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.white, marginBottom: 8 }}>Success — your tips were imported.</div>
                  <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.6 }}>
                    Imported <strong style={{ color: C.white }}>{(lastUploadResult.inserted || 0).toLocaleString()}</strong> tips from <strong style={{ color: C.cyan }}>{lastUploadResult.platform}</strong>
                    {typeof lastUploadResult.totalUsd === 'number' && (
                      <> — <strong style={{ color: C.green }}>${lastUploadResult.totalUsd.toFixed(2)}</strong> tracked</>
                    )}
                  </div>
                  {(formatImportDate(lastUploadResult.dateFrom) && formatImportDate(lastUploadResult.dateTo)) && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                      {formatImportDate(lastUploadResult.dateFrom)} – {formatImportDate(lastUploadResult.dateTo)}
                    </div>
                  )}
                  {lastUploadResult.skipped > 0 && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{lastUploadResult.skipped} duplicates skipped</div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
                    <Button onClick={() => handleTabChange('overview')} style={{ padding: "12px 26px", fontSize: 14 }}>View Dashboard</Button>
                    <Button variant="secondary" onClick={resetImport} style={{ padding: "12px 22px", fontSize: 13 }}>Import another CSV</Button>
                  </div>
                </div>
              )}

              {importStage === 'error' && lastUploadResult && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 34, marginBottom: 10 }}>⚠️</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.red, marginBottom: 4 }}>
                    {lastUploadResult.error}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Check the file format, or try a different export from your platform.</div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <Button variant="secondary" onClick={resetImport} style={{ padding: "12px 24px", fontSize: 13 }}>Try Again</Button>
                  </div>
                </div>
              )}

              {/* Platform-limit soft paywall — a quick preview of what's in the
                  attempted import, so a free-tier user sees real value before
                  being asked to subscribe, rather than a hard block. */}
              {importStage === 'locked_preview' && lockedPreview && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ position: "relative", width: 56, height: 56, margin: "0 auto 14px" }}>
                    {lockedPreview.preview && <div className="import-flash-ring" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle,rgba(34,211,238,0.55),rgba(236,72,153,0.35) 60%,transparent 70%)" }} />}
                    <div className={lockedPreview.preview ? "import-check-badge" : ""} style={{ position: "relative", width: 56, height: 56, borderRadius: "50%", background: lockedPreview.preview ? "linear-gradient(135deg,#10B981,#22D3EE)" : "rgba(255,255,255,0.06)", border: lockedPreview.preview ? "none" : "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#fff", boxShadow: lockedPreview.preview ? "0 0 24px rgba(16,185,129,0.45)" : "none" }}>{lockedPreview.preview ? "✓" : "📁"}</div>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: C.cyan, marginBottom: 8 }}>Quick Preview</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.white, marginBottom: 16 }}>
                    Here's what's in your {lockedPreview.platform} import
                  </div>

                  {lockedPreview.preview ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 16, textAlign: "left" }}>
                      {[
                        { label: "Tips Imported", value: lockedPreview.preview.tipsDetected.toLocaleString(), color: C.cyan },
                        { label: "Unique Fans", value: lockedPreview.preview.fansDetected.toLocaleString(), color: C.gold },
                        { label: "Est. Earnings", value: `$${lockedPreview.preview.estimatedEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: C.green },
                        { label: "Top Spender", value: lockedPreview.preview.topSpender || "—", color: C.pink },
                      ].map(s => (
                        <div key={s.label} className="stat-card" style={{ ...glassCard, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${s.color}00,${s.color}88,${s.color}00)` }} />
                          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.muted, marginBottom: 5 }}>{s.label}</div>
                          <div style={{ fontSize: 17, fontWeight: 900, color: s.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
                      We couldn't read enough of this file for a preview, but here's what unlocking {lockedPreview.platform} gets you.
                    </div>
                  )}

                  {/* Soft paywall — smaller and less prominent than the preview above */}
                  <div style={{ borderRadius: 12, border: "1px solid rgba(168,85,247,0.25)", background: "rgba(168,85,247,0.06)", padding: "12px 14px" }}>
                    <div style={{ fontSize: 12.5, color: C.text, marginBottom: 8 }}>
                      🔒 Subscribe to view your insights for <strong style={{ color: C.white }}>{lockedPreview.platform}</strong>
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                      <Button as="a" href="/pricing" style={{ padding: "8px 16px", fontSize: 12.5 }}>Subscribe →</Button>
                      <Button variant="secondary" onClick={resetImport} style={{ padding: "8px 16px", fontSize: 12.5 }}>Not now</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Plan explainer + subscribe CTA */}
            <div style={{ ...glassCard, borderRadius: 14, padding: 24, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                Your plan
              </div>
              {isPro ? (() => {
                // Everyone inside the dashboard has access now (gated app —
                // see the /start-trial redirect above), so this line's job is
                // to say WHICH kind of access, not to sell anything.
                const state = getAccessState(profile)
                const daysLeft = trialDaysRemaining(profile)
                const label = state === 'trialing'
                  ? `✦ Free trial — ${daysLeft === 1 ? 'last day' : `${daysLeft} days left`}`
                  : state === 'legacy'
                    ? '✦ Founding member access'
                    : '✦ Subscription active'
                const sub = state === 'trialing'
                  ? '— billing starts automatically when the trial ends; cancel any time before then'
                  : state === 'legacy'
                    ? '— full access, on the house, for being here early'
                    : '— track and compare unlimited platforms'
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.indigo }}>{label}</span>
                    <span style={{ fontSize: 12, color: C.text }}>{sub}</span>
                  </div>
                )
              })() : (
                <>
                  <p style={{ fontSize: 13, color: C.text, lineHeight: 1.65, marginBottom: 16 }}>
                    The <strong style={{ color: C.white }}>free plan</strong> tracks <strong style={{ color: C.cyan }}>1 platform</strong> — import as much history as you want from it, no limits. A <strong style={{ color: C.white }}>subscription</strong> unlocks tracking <strong style={{ color: C.pink }}>multiple platforms at once</strong> and lets you compare which cam site pays you best by hour, day, and fan type.
                  </p>
                  <Button onClick={() => router.push('/pricing')} style={{ padding: "12px 26px", fontSize: 13 }}>
                    View Plans & Subscribe →
                  </Button>

                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>Have a promo code?</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input
                        value={promoCodeInput}
                        onChange={e => { setPromoCodeInput(e.target.value); if (promoCodeStatus) setPromoCodeStatus(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') redeemPromoCode() }}
                        placeholder="Enter code"
                        style={{
                          flex: "1 1 160px", padding: "10px 14px", borderRadius: 10,
                          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                          color: C.white, fontSize: 13, outline: "none", textTransform: "uppercase",
                        }}
                      />
                      <Button
                        variant="secondary"
                        onClick={redeemPromoCode}
                        disabled={promoCodeSubmitting || !promoCodeInput.trim()}
                        style={{ padding: "10px 20px", fontSize: 13, opacity: promoCodeSubmitting || !promoCodeInput.trim() ? 0.6 : 1 }}
                      >
                        {promoCodeSubmitting ? "Applying…" : "Apply"}
                      </Button>
                    </div>
                    {promoCodeStatus && (
                      <div style={{ marginTop: 8, fontSize: 12.5, color: promoCodeStatus.type === 'success' ? C.indigo : '#f87171' }}>
                        {promoCodeStatus.type === 'success' ? '✦ ' : ''}{promoCodeStatus.message}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "20px 0 14px" }} />

              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                Some insights unlock as you upload more data
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 8 }}>
                {[
                  ["Peak earning hours", "25+ tips & 3+ sessions"],
                  ["Average $/hour", "3+ sessions & 60+ tracked minutes"],
                  ["Top fans", "10+ tips & 5+ fans"],
                  ["Whale detection", "10+ fans & $50+ earned"],
                  ["Session breakdown", "3+ sessions"],
                  ["Fan re-engagement", "20+ fans & $50+ earned"],
                  ["Earnings forecasting", "8+ sessions & $50+ earned"],
                  ["Platform comparison", isPro ? "2+ platforms imported" : "Subscription + 2+ platforms"],
                ].map(([label, req]) => (
                  <div key={label} style={{ fontSize: 12, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ color: C.white, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>Unlocks at {req}</div>
                  </div>
                ))}
              </div>
            </div>

            <div id="csv-help" style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.15)", fontSize: 12, color: C.muted, scrollMarginTop: 80 }}>
              <strong style={{ color: C.cyan }}>CSV not loading?</strong> Try selecting your platform from the dropdown above, then re-upload. For Chaturbate: export from Stats & Data → Token Stats. For BongaCams: export from Reports.
              {' '}Need a full walkthrough? See the <a href="/blog/how-to-upload-csv-to-camcash" style={{ color: C.cyan }}>step-by-step CSV upload guide</a> (with video).
            </div>
          </div>
        )}

        {activeTab === "monthly" && (() => {
          const monthly = analytics?.monthlyData || []
          const tipTypes = analytics?.tipTypeBreakdown || []
          const privFans = analytics?.privateShowFans || []
          const spyFans = analytics?.spyShowFans || []
          const bestMo = analytics?.bestMonth
          const totalUSD = analytics?.totalUSD || 0
          const now = new Date()
          // Creator-local calendar month/day. analytics.monthlyData is keyed by
          // LOCAL month (lib/analytics.js's monthKeyLocal), so a UTC-derived key
          // could miss the current month entirely near a month boundary — and
          // dayOfMonth feeds the end-of-month projection below.
          const _localYmd = toLocalDateStr(now.toISOString(), creatorTz)   // YYYY-MM-DD
          const thisMonthKey = _localYmd.slice(0, 7)
          const [_lY, _lM, _lD] = _localYmd.split('-').map(Number)
          const thisMonth = monthly.find(m => m.month === thisMonthKey)
          const thisMonthUSD = thisMonth?.usd || 0
          const goalPct = monthlyGoal > 0 ? Math.min(100, Math.round((thisMonthUSD / monthlyGoal) * 100)) : null
          const daysInMonth = new Date(_lY, _lM, 0).getDate()
          const dayOfMonth = _lD
          const daysLeft = daysInMonth - dayOfMonth
          const projectedEnd = thisMonthUSD > 0 ? Math.round(thisMonthUSD / dayOfMonth * daysInMonth) : null
          const maxBarUSD = Math.max(...monthly.map(m => m.usd), 1)
          const fmtMonth = (key) => { const [y,m] = key.split('-'); const mo = new Date(y,parseInt(m)-1,1).toLocaleDateString('en-US',{month:'short'}); return mo + " '" + String(y).slice(-2) }

          return (
            <div style={{ animation: "fadeUp 0.3s ease" }}>

              {/* ── HEADER ── */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:28, flexWrap:"wrap", gap:12 }}>
                <div>
                  <div style={{ fontSize:24, fontWeight:900, color:C.white }}>📈 Monthly Overview</div>
                  <div style={{ fontSize:13, color:C.muted }}>Earnings trends, tip types, and private show breakdown</div>
                </div>
              </div>

              {/* ── GOAL TRACKER ── */}
              <div style={{ ...glassCard, borderRadius:18, padding:24, marginBottom:24, border:"1px solid rgba(16,185,129,0.25)" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#10B981,#22D3EE)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🎯</div>
                    <div>
                      <div style={{ fontSize:16, fontWeight:800, color:C.white }}>Monthly Goal</div>
                      <div style={{ fontSize:12, color:C.muted }}>{now.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</div>
                    </div>
                  </div>
                  <button onClick={() => setShowGoalEditor(v => !v)} style={{ padding:"6px 14px", borderRadius:8, background:"rgba(16,185,129,0.15)", border:"1px solid rgba(16,185,129,0.35)", color:C.green, fontSize:12, fontWeight:700, cursor:"pointer" }}>
                    {monthlyGoal ? "✏️ Edit Goal" : "➕ Set Goal"}
                  </button>
                </div>

                {showGoalEditor && (
                  <div style={{ display:"flex", gap:8, marginBottom:16, alignItems:"center" }}>
                    <span style={{ color:C.green, fontSize:16, fontWeight:700 }}>$</span>
                    <input
                      type="number" placeholder="e.g. 500" value={goalInput}
                      onChange={e => setGoalInput(e.target.value)}
                      onFocus={e => e.target.style.borderColor="rgba(16,185,129,0.6)"}
                      onBlur={e => e.target.style.borderColor="rgba(255,255,255,0.1)"}
                      style={{ flex:1, padding:"8px 12px", borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:C.white, fontSize:14, outline:"none" }}
                    />
                    <button onClick={() => saveMonthlyGoal(goalInput)} style={{ padding:"8px 16px", borderRadius:8, background:"linear-gradient(135deg,#10B981,#22D3EE)", border:"none", color:C.white, fontSize:13, fontWeight:700, cursor:"pointer" }}>Save</button>
                  </div>
                )}

                {monthlyGoal ? (
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                      <span style={{ fontSize:13, color:C.muted }}>
                        <span style={{ color:C.white, fontWeight:700, fontSize:18 }}>${thisMonthUSD.toFixed(0)}</span>
                        <span style={{ color:C.muted }}> / ${monthlyGoal.toFixed(0)} goal</span>
                      </span>
                      <span style={{ fontSize:13, fontWeight:700, color: goalPct >= 100 ? C.green : goalPct >= 70 ? C.gold : C.cyan }}>{goalPct}%</span>
                    </div>
                    <div style={{ height:12, borderRadius:6, background:"rgba(255,255,255,0.08)", overflow:"hidden", marginBottom:10 }}>
                      <div style={{ height:"100%", width:`${goalPct}%`, borderRadius:6, background: goalPct >= 100 ? "linear-gradient(90deg,#10B981,#22D3EE)" : goalPct >= 70 ? "linear-gradient(90deg,#F59E0B,#10B981)" : "linear-gradient(90deg,#22D3EE,#7C5CFF)", transition:"width 0.8s ease" }} />
                    </div>
                    <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                      <span style={{ fontSize:12, color:C.muted }}>{daysLeft} days left this month</span>
                      {projectedEnd && <span style={{ fontSize:12, color: projectedEnd >= monthlyGoal ? C.green : C.orange }}>At this pace: ${projectedEnd} projected</span>}
                      {goalPct >= 100 && <span style={{ fontSize:12, color:C.green, fontWeight:700 }}>🎉 Goal smashed!</span>}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign:"center", padding:"12px 0", color:C.muted, fontSize:13 }}>Set a monthly earnings goal to track your progress here</div>
                )}
              </div>

              {/* ── BEST MONTH CALLOUT ── */}
              {bestMo && (
                <div style={{ ...glassCard, borderRadius:14, padding:18, marginBottom:24, border:"1px solid rgba(245,158,11,0.3)", background:"rgba(245,158,11,0.06)", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                  <div style={{ fontSize:28 }}>🏆</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, color:C.gold, fontWeight:700, marginBottom:2 }}>Best Month Ever</div>
                    <div style={{ fontSize:20, fontWeight:900, color:C.white }}>{fmtMonth(bestMo.month)} — ${bestMo.usd.toLocaleString('en-US',{minimumFractionDigits:0})}</div>
                    <div style={{ fontSize:12, color:C.muted }}>{bestMo.fans} fans · {bestMo.tips} tips · ${bestMo.usdPerFan} avg per fan</div>
                  </div>
                  {thisMonthUSD > 0 && (
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:11, color:C.muted }}>vs this month</div>
                      <div style={{ fontSize:14, fontWeight:700, color: thisMonthUSD >= bestMo.usd ? C.green : C.orange }}>
                        {thisMonthUSD >= bestMo.usd ? "🔥 New record!" : `${Math.round((thisMonthUSD/bestMo.usd)*100)}% there`}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── MONTHLY BAR CHART ── */}
              <div style={{ ...glassCard, borderRadius:18, padding:24, marginBottom:24 }}>
                <div style={{ fontSize:16, fontWeight:800, color:C.white, marginBottom:4 }}>Monthly Earnings</div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:20 }}>{monthly.length} months of data</div>
                {monthly.length === 0 ? (
                  <div style={{ textAlign:"center", padding:40, color:C.muted }}>No monthly data yet — upload a CSV to get started</div>
                ) : (
                  <div style={{ overflowX:"auto" }}>
                    <div style={{ display:"flex", alignItems:"flex-end", gap:6, minWidth: Math.max(monthly.length * 44, 400), height:180, paddingBottom:24, position:"relative" }}>
                      {/* Grid lines */}
                      {[0.25,0.5,0.75,1].map(pct => (
                        <div key={pct} style={{ position:"absolute", left:0, right:0, bottom: pct*180+24+"px", borderTop:"1px solid rgba(255,255,255,0.05)", pointerEvents:"none" }}>
                          <span style={{ fontSize:9, color:C.muted, position:"absolute", left:0, top:-9 }}>${Math.round(maxBarUSD*pct)}</span>
                        </div>
                      ))}
                      {monthly.map((m, i) => {
                        const h = Math.max(4, Math.round((m.usd / maxBarUSD) * 156))
                        const isBest = m.month === bestMo?.month
                        const isCurrent = m.month === thisMonthKey
                        const col = isBest ? C.gold : isCurrent ? C.green : C.indigo
                        return (
                          <div key={m.month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, cursor:"default" }}
                            title={`${fmtMonth(m.month)}: $${m.usd.toFixed(2)} · ${m.fans} fans · ${m.tips} tips`}>
                            <div style={{ fontSize:9, color:C.muted, fontWeight:600, opacity: m.usd > maxBarUSD*0.1 ? 1 : 0 }}>${m.usd >= 100 ? Math.round(m.usd) : m.usd.toFixed(0)}</div>
                            <div style={{ width:"100%", height:h, borderRadius:"4px 4px 0 0", background: isBest ? `linear-gradient(180deg,${C.gold},${C.orange})` : isCurrent ? `linear-gradient(180deg,${C.green},${C.cyan})` : `linear-gradient(180deg,${C.indigo},rgba(124,92,255,0.4))`, boxShadow: isBest ? `0 0 12px ${C.gold}40` : isCurrent ? `0 0 12px ${C.green}40` : "none", transition:"height 0.4s ease", animationDelay:`${i*30}ms` }} />
                            <div style={{ fontSize:9, color: isCurrent ? C.green : isBest ? C.gold : C.muted, fontWeight: isCurrent || isBest ? 700 : 400, whiteSpace:"nowrap" }}>{fmtMonth(m.month)}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {/* Legend */}
                <div style={{ display:"flex", gap:16, marginTop:8, flexWrap:"wrap" }}>
                  {[["🟡","Best month",C.gold],["🟢","This month",C.green],["🟣","Past months",C.indigo]].map(([dot,label,col]) => (
                    <span key={label} style={{ fontSize:11, color:C.muted, display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ width:8, height:8, borderRadius:2, background:col, display:"inline-block" }} />{label}
                    </span>
                  ))}
                </div>
              </div>

              {/* ── MONTHLY STATS GRID ── */}
              {monthly.length > 0 && (() => {
                const last3 = monthly.slice(-3)
                const avgMonthly = monthly.reduce((s,m) => s+m.usd, 0) / monthly.length
                const trend = monthly.length >= 2 ? monthly[monthly.length-1].usd - monthly[monthly.length-2].usd : 0
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12, marginBottom:24 }}>
                    {[
                      { label:"Avg / Month", value:`$${Math.round(avgMonthly)}`, icon:"📊", color:C.cyan },
                      { label:"Best Month", value:`$${bestMo?.usd?.toFixed(0)||0}`, sub:bestMo ? fmtMonth(bestMo.month) : '', icon:"🏆", color:C.gold },
                      { label:"MoM Trend", value: trend >= 0 ? `+$${Math.round(trend)}` : `-$${Math.round(Math.abs(trend))}`, icon: trend >= 0 ? "📈" : "📉", color: trend >= 0 ? C.green : C.red },
                      { label:"Months Tracked", value: monthly.length, icon:"📅", color:C.indigo },
                    ].map(({ label, value, sub, icon, color }) => (
                      <div key={label} style={{ ...glassCard, borderRadius:14, padding:16, border:`1px solid ${color}20` }}>
                        <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>{icon} {label}</div>
                        <div style={{ fontSize:20, fontWeight:900, color }}>{value}</div>
                        {sub && <div style={{ fontSize:11, color:C.muted }}>{sub}</div>}
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* ── TIP TYPE BREAKDOWN ── */}
              <div style={{ ...glassCard, borderRadius:18, padding:24, marginBottom:24 }}>
                <div style={{ fontSize:16, fontWeight:800, color:C.white, marginBottom:4 }}>Revenue by Type</div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:20 }}>How your earnings break down across tips, privates, and spy shows</div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {tipTypes.map(t => {
                    const col = t.type.toLowerCase().includes('private') ? C.pink : t.type.toLowerCase().includes('spy') ? C.orange : t.type.toLowerCase().includes('received') ? C.cyan : C.indigo
                    return (
                      <div key={t.type} style={{ padding:"14px 16px", borderRadius:12, background:`${col}0d`, border:`1px solid ${col}25` }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <div style={{ fontSize:14, fontWeight:700, color:C.white }}>{t.type}</div>
                          <div style={{ fontSize:16, fontWeight:900, color:col }}>${t.usd.toFixed(2)} <span style={{ fontSize:12, color:C.muted }}>({t.pct}%)</span></div>
                        </div>
                        <div style={{ height:6, borderRadius:3, background:"rgba(255,255,255,0.06)", overflow:"hidden", marginBottom:8 }}>
                          <div style={{ height:"100%", width:`${t.pct}%`, borderRadius:3, background:col, transition:"width 0.8s ease" }} />
                        </div>
                        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                          {[
                            [`${t.count} tips`],
                            [`${t.fans} fans`],
                            [`$${t.avgUsd} avg tip`],
                          ].map(([v]) => <span key={v} style={{ fontSize:11, color:C.muted }}>{v}</span>)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── PRIVATE SHOW INTEL ── */}
              {privFans.length > 0 && (
                <div style={{ ...glassCard, borderRadius:18, padding:24, marginBottom:24, border:"1px solid rgba(236,72,153,0.2)" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#EC4899,#7C5CFF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🔒</div>
                    <div>
                      <div style={{ fontSize:16, fontWeight:800, color:C.white }}>Private Show Fans</div>
                      <div style={{ fontSize:12, color:C.muted }}>{privFans.length} fans have booked a private show</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {privFans.slice(0,8).map((f,i) => (
                      <div key={f.username} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderRadius:10, background:"rgba(236,72,153,0.07)", border:"1px solid rgba(236,72,153,0.15)" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ width:28, height:28, borderRadius:8, background:`linear-gradient(135deg,#EC4899,#7C5CFF)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:C.white, flexShrink:0 }}>{f.username[0]?.toUpperCase()}</div>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:C.white }}>{f.username}</div>
                            <div style={{ fontSize:11, color:C.muted }}>{f.count} private{f.count>1?'s':''}</div>
                          </div>
                        </div>
                        <div style={{ fontSize:14, fontWeight:700, color:C.pink }}>${f.usd.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                  {spyFans.length > 0 && (
                    <div style={{ marginTop:16, padding:"12px 14px", borderRadius:10, background:"rgba(251,146,60,0.07)", border:"1px solid rgba(251,146,60,0.2)" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:C.orange, marginBottom:4 }}>👁️ Spy Show Viewers ({spyFans.length} fans)</div>
                      <div style={{ fontSize:12, color:C.muted }}>These fans watched your privates but never booked one — warm leads for re-engagement</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8 }}>
                        {spyFans.slice(0,10).map(u => (
                          <span key={u} style={{ padding:"3px 8px", borderRadius:6, background:"rgba(251,146,60,0.12)", border:"1px solid rgba(251,146,60,0.2)", fontSize:11, color:C.orange }}>{u}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── MONTHLY FAN TABLE ── */}
              {monthly.length > 0 && (
                <div style={{ ...glassCard, borderRadius:18, padding:24 }}>
                  <div style={{ fontSize:16, fontWeight:800, color:C.white, marginBottom:16 }}>Month by Month</div>
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                      <thead>
                        <tr style={{ borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                          {["Month","Revenue","Tips","Fans","$/Fan","Sessions"].map(h => (
                            <th key={h} style={{ padding:"8px 12px", textAlign:"left", color:C.muted, fontWeight:600, fontSize:11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...monthly].reverse().map((m,i) => {
                          const isBest = m.month === bestMo?.month
                          const isCurrent = m.month === thisMonthKey
                          return (
                            <tr key={m.month} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)", background: isBest ? "rgba(245,158,11,0.06)" : isCurrent ? "rgba(16,185,129,0.06)" : "transparent" }}>
                              <td style={{ padding:"10px 12px", color: isBest ? C.gold : isCurrent ? C.green : C.white, fontWeight: isBest||isCurrent ? 700 : 400 }}>{fmtMonth(m.month)}{isBest?" 🏆":isCurrent?" ◀":""}</td>
                              <td style={{ padding:"10px 12px", color:C.white, fontWeight:700 }}>${m.usd.toFixed(2)}</td>
                              <td style={{ padding:"10px 12px", color:C.muted }}>{m.tips}</td>
                              <td style={{ padding:"10px 12px", color:C.muted }}>{m.fans}</td>
                              <td style={{ padding:"10px 12px", color:C.cyan }}>${m.usdPerFan}</td>
                              <td style={{ padding:"10px 12px", color:C.muted }}>{m.sessions}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )
        })()}

        {activeTab === "titles" && (
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <TitleGenerator C={C} glassCard={glassCard} analytics={analytics} tips={tips} sessions={sessions} whales={whales} timezone={creatorTz} />
          </div>
        )}

        {activeTab === "calc" && (
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: C.white, marginBottom: 8 }}>🪙 Token Calculator</h1>
            <p style={{ fontSize: 14, color: C.muted, marginBottom: 32 }}>Convert tokens to USD earnings across Chaturbate, BongaCams, MyFreeCams, Stripchat & CamSoda</p>
            <TokenCalculator />
          </div>
        )}

        {activeTab === "help" && (
          <div style={{ maxWidth: 900 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: C.white, marginBottom: 8 }}>❓ How to Import Your Tips</h1>
            <p style={{ fontSize: 14, color: C.muted, marginBottom: 32 }}>Follow these steps to get your tip data into CamCash in under 2 minutes</p>

            <div style={{ ...glassCard, borderRadius: 16, padding: 28, marginBottom: 32, border: "1px solid rgba(34,211,238,0.2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #10B981, #22D3EE)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🔍</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: C.white }}>How CamCash Actually Works</h2>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  { icon: "📁", title: "Your data, your files", body: "Everything you see in this dashboard comes directly from the CSV files you upload. We don't connect to Chaturbate, BongaCams, or any platform — you export the data yourself and bring it here." },
                  { icon: "💯", title: "100% real numbers", body: "Every dollar amount, tip count, fan name, and session shown is calculated from your actual CSV data. No estimates, no made-up stats. If it shows $1,700 — that's exactly what your CSV says you earned." },
                  { icon: "🐳", title: "Top Fans are your real tippers", body: "The fans listed under Top Fans are real usernames pulled from your tip history. Their totals, tip counts, and last tip dates all come directly from your uploaded data." },
                  { icon: "💌", title: "Message Generator — copy & paste only", body: "The 💌 Message button does NOT send messages. It generates a re-engagement message for you to copy, then go to that fan's profile on Chaturbate, BongaCams, or wherever they tipped you, and paste it yourself. CamCash has no access to any platform." },
                  { icon: "🔒", title: "Your data stays yours", body: "Your tip data is stored securely in your account only. It's never shared, sold, or visible to anyone else." },
                ].map(({ icon, title, body }) => (
                  <div key={title} style={{ display: "flex", gap: 14, padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 4 }}>{title}</div>
                      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ ...glassCard, borderRadius: 16, padding: 28, marginBottom: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #22D3EE, #7C5CFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: C.white }}>The Easiest Way — Works on Every Platform</h2>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                {[{ step: "1", icon: "🖱️", title: "Go to your platform", desc: "Log in and navigate to your earnings or tip history page" }, { step: "2", icon: "📋", title: "Select & copy the data", desc: "Choose your date range, highlight all tip rows and copy (Ctrl+C)" }, { step: "3", icon: "📄", title: "Paste into Google Sheets", desc: "Go to sheets.new and paste your data (Ctrl+V)" }, { step: "4", icon: "⬇️", title: "Download as CSV & import", desc: 'File → Download → "Comma Separated Values (.csv)" — then upload here' }].map(({ step, icon, title, desc }) => (
                  <div key={step} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: 18, position: "relative", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ position: "absolute", top: 14, right: 14, width: 24, height: 24, borderRadius: "50%", background: "rgba(34,211,238,0.2)", border: "1px solid rgba(34,211,238,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: C.cyan }}>{step}</div>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 6 }}>{title}</div>
                    <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{desc}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: 16, background: "rgba(0,0,0,0.3)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: 28, flexShrink: 0 }}>💡</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 4 }}>Why Google Sheets?</div>
                  <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>Most cam platforms don't have a direct "Download CSV" button. Go to <span style={{ color: C.cyan, fontWeight: 600 }}>sheets.new</span> — opens instantly, no sign-in needed.</div>
                </div>
              </div>
            </div>

            <div style={{ ...glassCard, borderRadius: 14, padding: 24, marginBottom: 32 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: C.white, marginBottom: 20 }}>🎬 Step-by-Step: Copy → Sheets → Download CSV</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[{ num: "01", color: C.cyan, text: "On your cam platform, find your tip/earnings history and set the date range you want" }, { num: "02", color: C.cyan, text: "Click the first row, scroll to the last row, hold Shift and click — then press Ctrl+C (Cmd+C on Mac)" }, { num: "03", color: C.indigo, text: "Open a new tab and go to sheets.new — a blank Google Sheet opens immediately" }, { num: "04", color: C.indigo, text: "Click cell A1 and press Ctrl+V — your data pastes in with columns already separated" }, { num: "05", color: C.pink, text: 'Click "File" in the top menu → hover "Download" → click "Comma Separated Values (.csv)"' }, { num: "06", color: C.green, text: 'The CSV file downloads to your computer — come back here, click "Import CSV", and select that file. Done! ✅' }].map(({ num, color, text }) => (
                  <div key={num} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "14px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color, minWidth: 28, paddingTop: 1 }}>{num}</div>
                    <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>{text}</div>
                  </div>
                ))}
              </div>
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 700, color: C.white, marginBottom: 16 }}>📖 Platform-Specific Tips</h2>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>Where to find the earnings data on each site before you copy it</p>
            {[{ emoji: "🟣", name: "Chaturbate", steps: ["Log into your Chaturbate broadcaster account", "Go to Stats & Data → Token Stats", "Select your date range (last 30 days, 90 days, or custom)", "Click \"Download CSV\" or \"Export\"", "Upload the CSV file to CamCash"], tip: "Chaturbate CSVs usually have \"Tip from:\" format" }, { emoji: "🔴", name: "BongaCams", steps: ["Log into your BongaCams model account", "Navigate to Statistics → Earnings History", "Select date range and filter by \"Tips\" or \"All Transactions\"", "Look for \"Export to Excel\" or \"Download CSV\" button", "Save the file and upload to CamCash"], tip: "BongaCams format: Date, Username, Type, Tokens, USD" }, { emoji: "🟠", name: "MyFreeCams (MFC)", steps: ["Log into your MFC model account at wiki.myfreecams.com", "Go to Model Admin → Token Stats", "Click \"Transaction History\" or \"Detailed Stats\"", "Select date range and click \"Export CSV\"", "Upload the exported file to CamCash"], tip: "MFC CSVs are usually very detailed with all transaction types" }, { emoji: "🟢", name: "CamSoda", steps: ["Log into your CamSoda broadcaster dashboard", "Navigate to Earnings → Transaction History", "Choose your date range (last week, month, or custom dates)", "Click \"Download\" or \"Export to CSV\"", "Save and upload to CamCash"], tip: "CamSoda exports include both tokens and USD amounts" }].map(({ emoji, name, steps, tip }) => (
              <div key={name} className="dash-card" style={{ ...glassCard, borderRadius: 14, padding: 24, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 32 }}>{emoji}</div>
                  <h2 style={{ fontSize: 22, fontWeight: 700, color: C.white }}>{name}</h2>
                </div>
                <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
                  {steps.map((step, i) => <p key={i} style={{ marginBottom: 12 }}><strong style={{ color: C.white }}>Step {i + 1}:</strong> {step}</p>)}
                  <div style={{ padding: 16, background: "rgba(255,255,255,0.04)", borderRadius: 10, marginTop: 8 }}>
                    <div style={{ fontSize: 13, color: C.text }}>💡 {tip}</div>
                  </div>
                </div>
              </div>
            ))}

            <div style={{ background: "linear-gradient(135deg, rgba(124,92,255,0.15), rgba(236,72,153,0.15))", border: "1px solid rgba(236,72,153,0.3)", borderRadius: 14, padding: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: C.white, marginBottom: 16 }}>💡 General Tips</h2>
              <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
                {[["Export regularly", "Download your data weekly or monthly"], ["Don't edit CSVs", "Upload the original file — we handle the formatting"], ["Multiple platforms", "Upload CSVs from different sites — we'll combine them"], ["Duplicates removed", "Don't worry about re-uploading the same data"], ["File size", "Most CSVs are under 5MB and upload instantly"]].map(([title, desc]) => (
                  <p key={title} style={{ marginBottom: 12 }}>✅ <strong style={{ color: C.white }}>{title}:</strong> {desc}</p>
                ))}
                <p>⚠️ <strong style={{ color: C.white }}>Privacy:</strong> Your data is encrypted and never shared</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && <AnalyticsCharts analytics={analytics} />}
        {activeTab === 'private' && (
          <PrivateSessions
            paidSessions={paidSessions}
            tipsTotalUSD={analytics?.totalUSD ?? null}
            liveTotalUSD={liveTipsTotalUSD}
            onViewFan={viewFanProfile}
            timezone={creatorTz}
          />
        )}
        {activeTab === 'planner' && (
          _plannerLock.locked
            ? <div style={{ padding: '32px 0' }}><LockedInsightCard title="Stream Planner" description="Plan your schedule around your best earning windows." lockType="needs_data" requirement={_plannerLock.message} ctaLabel="Upload More Data" ctaAction={() => handleTabChange('upload')} /></div>
            : <StreamPlanner tips={tips} isPro={isPro} timezone={_momTz} analytics={analytics} />
        )}
        {activeTab === 'moneymap' && (
          _moneyMapLock.locked
            ? <div style={{ padding: '32px 0' }}><LockedInsightCard title="Money Map" description="See where and when your money comes from across sessions and platforms." lockType="needs_data" requirement={_moneyMapLock.message} ctaLabel="Upload More Data" ctaAction={() => handleTabChange('upload')} /></div>
            : <MoneyMap tips={tips} isPro={isPro} timezone={creatorTz} />
        )}
      </div>

      {/* DELETE MODAL */}
      {showDeleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ ...glassCard, borderRadius: 14, padding: 32, maxWidth: 400, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: C.white, marginBottom: 12 }}>Delete All Tips?</h2>
            <p style={{ fontSize: 14, color: C.muted, marginBottom: 24 }}>This will permanently delete all {tips.length} tips. This cannot be undone!</p>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, padding: "10px 20px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: C.white, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              <button onClick={deleteAllTips} style={{ flex: 1, padding: "10px 20px", borderRadius: 8, background: "linear-gradient(135deg, #F87171, #FB923C)", boxShadow: "0 0 20px rgba(248,113,113,0.4)", border: "none", color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Delete All</button>
            </div>
          </div>
        </div>
      )}

      {/* WHALE PROFILE MODAL */}
      {selectedWhale && (() => {
        const w = selectedWhale
        const whaleTips = tips.filter(t => t.username === w.username && t.platform === w.platform)
        const sortedTips = [...whaleTips].sort((a, b) => new Date(b.date_time) - new Date(a.date_time))
        const firstTip = whaleTips.length ? whaleTips.reduce((a, b) => new Date(a.date_time) < new Date(b.date_time) ? a : b) : null
        // A fan reached from Private Sessions may have no free-chat tip
        // history at all (paid-only) -- w.lastTipDate is null in that case,
        // guarded below rather than assumed to exist.
        const daysSinceLastTip = w.lastTipDate ? Math.floor((Date.now() - new Date(w.lastTipDate)) / 86400000) : null
        const tierColor = TIER_COLORS[w.tier] || C.cyan
        const tierIcon = w.tier === 'Whale' ? '💎' : w.tier === 'Shark' ? '🦈' : w.tier === 'Regular' ? '⭐' : '💤'
        const avgDaysBetweenTips = whaleTips.length > 1 ? Math.floor((new Date(w.lastTipDate) - new Date(firstTip?.date_time)) / 86400000 / (whaleTips.length - 1)) : 7
        const likelyReturnDays = daysSinceLastTip !== null ? Math.max(0, avgDaysBetweenTips - daysSinceLastTip) : null
        // Reuse the shared churn-risk formula (w.churnRisk) from analytics.js —
        // same fix as the card grid — instead of a second local calculation.
        const churnRisk = w.churnRisk?.level && w.churnRisk.level !== "Unknown" ? w.churnRisk.level : null
        const churnColor = churnRisk === "Critical" || churnRisk === "High" ? C.red : churnRisk === "Medium" ? C.orange : C.green
        // Relationship score — identical formula to the Top Fans card grid,
        // computed here too so the modal's "REL" badge always agrees with it.
        const relScore = Math.min(100, Math.round((w.tipCount * 3) + (w.totalUSD / 10) + (daysSinceLastTip !== null && daysSinceLastTip < 7 ? 20 : daysSinceLastTip !== null && daysSinceLastTip < 30 ? 10 : 0)))
        const relColor = relScore >= 70 ? C.green : relScore >= 40 ? C.gold : C.red
        const valueLabel = w.isTopSpender || w.spendPercentile >= 95 ? "Ultra high value"
          : relScore >= 70 ? "High value supporter"
          : relScore >= 40 ? "Growing relationship"
          : "New supporter"
        const topSpenderPct = typeof w.spendPercentile === "number" ? Math.max(1, 100 - w.spendPercentile) : null
        // A short, data-grounded read on the fan — built only from values the
        // shared analytics engine already computed (churn risk / tip
        // probability / tip count), never a fabricated observation.
        const fanInsight = churnRisk === "Critical" || churnRisk === "High"
          ? "This fan's tipping has slowed — a quick message could bring them back."
          : w.tipProbability?.level === "High"
          ? "This fan is highly engaged and likely to tip again soon."
          : w.tipCount >= 5 && (churnRisk === "Low" || churnRisk === "Medium")
          ? "This fan is highly engaged and tips consistently. Keep the momentum going!"
          : null
        // Fan-key match: platform + normalized username (never merge across
        // platforms). Mirrors the whaleTips filter above exactly, over
        // paid_sessions instead of tips.
        const fanPaidSessions = paidSessions.filter(s => (s.username || '').toLowerCase() === w.username.toLowerCase() && s.platform === w.platform)
        const fanPrivateUSD = fanPaidSessions.reduce((sum, s) => sum + (parseFloat(s.usd) || 0), 0)
        const fanPrivateTokens = fanPaidSessions.reduce((sum, s) => sum + (parseInt(s.tokens) || 0), 0)
        const fanPrivateSorted = [...fanPaidSessions].sort((a, b) => new Date(a.date_time) - new Date(b.date_time))
        const fanPrivateTypeCounts = {}
        fanPaidSessions.forEach(s => { fanPrivateTypeCounts[s.session_type] = (fanPrivateTypeCounts[s.session_type] || 0) + 1 })
        const fanMostCommonType = Object.entries(fanPrivateTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
        const biggestTip = whaleTips.length ? Math.max(...whaleTips.map(t => t.usd)) : 0
        const dayKeys = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
        const dayCounts = { Mon:0,Tue:0,Wed:0,Thu:0,Fri:0,Sat:0,Sun:0 }
        whaleTips.forEach(t => {
          const d = toLocalDow(t.date_time, creatorTz)
          const key = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]
          if (key in dayCounts) dayCounts[key]++
        })
        const maxDayCount = Math.max(...Object.values(dayCounts), 1)
        const bestDay = whaleTips.length ? Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0] : null
        return (
          <div onClick={() => setSelectedWhale(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
            <div className="whale-modal-shell" style={{ width: "min(760px, calc(100vw - 32px))", borderRadius: 19, padding: 1, background: `linear-gradient(135deg, ${tierColor}90, rgba(124,92,255,0.4), rgba(255,43,174,0.85))` }} onClick={e => e.stopPropagation()}>
              <div className="modal-inner" role="dialog" aria-modal="true" aria-label={`${w.username} fan profile`} style={{ maxHeight: "90vh", overflowY: "auto", ...glassCard, borderRadius: 18 }}>
                <div style={{ padding: "20px 24px", background: `linear-gradient(90deg, rgba(30,58,110,0.4), rgba(91,58,140,0.32), rgba(122,46,85,0.3))`, borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 88, height: 88, borderRadius: "50%", background: `linear-gradient(135deg, ${C.cyan}, ${tierColor}, ${C.pink})`, padding: 3 }}>
                      <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: `linear-gradient(135deg, ${tierColor}, ${tierColor}80)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 800, color: "#fff", boxShadow: `0 0 22px ${tierColor}40` }}>{w.username.charAt(0).toUpperCase()}</div>
                    </div>
                    <div title={`${w.tier} tier`} style={{ position: "absolute", right: -2, bottom: -2, width: 26, height: 26, borderRadius: "50%", background: C.bg, border: `1px solid ${tierColor}70`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{tierIcon}</div>
                  </div>

                  <div style={{ minWidth: 0, flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: C.white, wordBreak: "break-word" }}>{w.username}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                      <span style={{ padding: "2px 10px", borderRadius: 100, background: `${tierColor}20`, border: `1px solid ${tierColor}50`, color: tierColor, fontSize: 11, fontWeight: 700 }}>{w.tier}</span>
                      <span style={{ padding: "2px 10px", borderRadius: 100, background: "rgba(124,92,255,0.14)", border: "1px solid rgba(124,92,255,0.3)", color: "#a78bfa", fontSize: 11, fontWeight: 600 }}>{w.platform || "Unknown"}</span>
                    </div>
                    {topSpenderPct !== null && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                        <div style={{ width: 26, height: 26, borderRadius: "50%", background: `${relColor}18`, border: `2px solid ${relColor}55`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <div style={{ fontSize: 9, fontWeight: 800, color: relColor, lineHeight: 1 }}>{relScore}</div>
                        </div>
                        <div style={{ fontSize: 11, color: C.text, lineHeight: 1.3 }}>
                          <span style={{ color: C.white, fontWeight: 700 }}>Top {topSpenderPct}%</span> of supporters
                          <div style={{ fontSize: 10 }}>{valueLabel}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="whale-hero-metrics" style={{ flex: 1, minWidth: 240 }}>
                    {[{ label: "Total Spent", value: `$${w.totalUSD.toFixed(2)}`, color: C.cyan }, { label: "Tips Given", value: w.tipCount, color: "#a78bfa" }, { label: "Avg Tip", value: `$${w.avgTipSize.toFixed(2)}`, color: "#C4B5FD" }, { label: "Biggest Tip", value: `$${biggestTip.toFixed(2)}`, color: "#FF2BAE" }].map(({ label, value, color }) => (
                      <div key={label} className="whale-hero-metric">
                        <div style={{ fontSize: 10, color: C.text, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => setSelectedWhale(null)} aria-label="Close profile" autoFocus style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: C.text, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, alignSelf: "flex-start" }}>✕</button>
                </div>

                <div className="whale-modal-grid" style={{ padding: "20px 24px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.white, textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: C.cyan }}>✦</span> Fan Intelligence
                      <span style={{ width: 26, height: 2, borderRadius: 2, background: "linear-gradient(90deg, #FF2BAE, transparent)", marginLeft: 2 }} />
                    </div>

                    <div className="whale-intel-split">
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {[
                          { icon: "📅", label: "First tip", value: firstTip ? new Date(firstTip.date_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Not enough data yet" },
                          { icon: "📅", label: "Last tip", value: w.lastTipDate ? new Date(w.lastTipDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Not enough data yet", sub: daysSinceLastTip !== null ? `${daysSinceLastTip.toLocaleString()} days ago` : null },
                          { icon: "🕐", label: "Avg days between tips", value: whaleTips.length > 1 ? `Every ~${avgDaysBetweenTips} days` : "Not enough data yet" },
                          { icon: "⚠️", label: "Churn risk", value: churnRisk || "Not enough data yet", color: churnColor },
                        ].map(({ icon, label, value, sub, color }) => (
                          <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                            <span style={{ fontSize: 12, marginTop: 1, flexShrink: 0 }}>{icon}</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 10, color: C.text }}>{label}</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: color || C.white }}>{value}</div>
                              {sub && <div style={{ fontSize: 10, color: C.text, marginTop: 1 }}>{sub}</div>}
                            </div>
                          </div>
                        ))}
                        {w.typicalOnlineHours && w.typicalOnlineHours !== "Unknown" && (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", background: `${C.cyan}12`, border: `1px solid ${C.cyan}30`, borderRadius: 100, alignSelf: "flex-start" }}>
                            <span style={{ fontSize: 11 }}>🕐</span>
                            <span style={{ fontSize: 11, color: C.cyan, fontWeight: 600 }}>{w.typicalOnlineHours}</span>
                          </div>
                        )}
                      </div>

                      <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div style={{ fontSize: 10, color: C.text, marginBottom: 8, fontWeight: 700 }}>📊 Tips by day of week</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                          {dayKeys.map(d => {
                            const count = dayCounts[d]
                            const isBest = bestDay && bestDay[0] === d && count > 0
                            const heightPct = 24 + (count / maxDayCount) * 76
                            return (
                              <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                                <div style={{ width: "100%", height: 38, display: "flex", alignItems: "flex-end" }}>
                                  <div style={{ width: "100%", height: `${count > 0 ? heightPct : 8}%`, borderRadius: 4, background: count > 0 ? (isBest ? "#FF2BAE" : `linear-gradient(180deg, ${C.cyan}, #7C5CFF)`) : "rgba(255,255,255,0.06)" }} />
                                </div>
                                <span style={{ fontSize: 8, color: C.text }}>{d}</span>
                              </div>
                            )
                          })}
                        </div>
                        {bestDay && bestDay[1] > 0 && (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                            <div style={{ fontSize: 11, color: C.text }}>Most active <strong style={{ color: "#FF2BAE" }}>{{Mon:"Monday",Tue:"Tuesday",Wed:"Wednesday",Thu:"Thursday",Fri:"Friday",Sat:"Saturday",Sun:"Sunday"}[bestDay[0]]}</strong></div>
                            <div style={{ fontSize: 11, color: C.text }}>{whaleTips.length.toLocaleString()} tips total</div>
                          </div>
                        )}
                      </div>
                    </div>

                    {fanInsight && (
                      <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, display: "flex", alignItems: "flex-start", gap: 9 }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>✨</span>
                        <span style={{ fontSize: 12, color: C.white, lineHeight: 1.45 }}>{fanInsight}</span>
                      </div>
                    )}
                  </div>

                  <div className="whale-modal-actions-col" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.white, textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}>
                      Actions
                      <span style={{ width: 26, height: 2, borderRadius: 2, background: "linear-gradient(90deg, #FF2BAE, transparent)" }} />
                    </div>
                    <button onClick={() => { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) }}
                      className="heart-envelope-btn-idle"
                      aria-label={`Message ${w.username}`}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "13px 16px", borderRadius: 12, background: "linear-gradient(135deg, rgba(255,43,174,0.22), rgba(124,92,255,0.22))", border: "1px solid rgba(255,43,174,0.45)", color: C.white, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                      <EnvelopeHeartIcon size={18} /> Message Fan
                    </button>
                    <div style={{ fontSize: 11, color: C.text, textAlign: "center", marginTop: -4, marginBottom: 4 }}>Start a private conversation</div>
                    <button onClick={() => setNoteTarget(w.username)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 10, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      📝 Add Note
                    </button>
                  </div>
                </div>

                <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>🏆 Top 3 Tips</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {[...whaleTips].sort((a,b) => b.usd - a.usd).slice(0,3).map((t, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 14 }}>{["🥇","🥈","🥉"][i]}</span>
                          <span style={{ fontSize: 12, color: C.text }}>{new Date(t.date_time).toLocaleDateString()}</span>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: C.gold }}>${t.usd.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>🕐 Recent Tips</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {sortedTips.slice(0, 5).map((t, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div style={{ fontSize: 12, color: C.text }}>{new Date(t.date_time).toLocaleDateString()} at {new Date(t.date_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>${t.usd.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {fanPaidSessions.length > 0 && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>💎 Private Sessions</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 12 }}>
                      {[
                        { label: "Lifetime private earnings", value: `$${fanPrivateUSD.toFixed(2)}`, color: C.purple || "#a855f7" },
                        { label: "Total private sessions", value: fanPaidSessions.length },
                        { label: "Total private tokens", value: fanPrivateTokens.toLocaleString() },
                        { label: "Avg value per private", value: `$${(fanPrivateUSD / fanPaidSessions.length).toFixed(2)}` },
                        { label: "Avg private token rate", value: fanPrivateTokens > 0 ? `$${(fanPrivateUSD / fanPrivateTokens).toFixed(4)}/tok` : "Not enough data yet" },
                        { label: "Most common session type", value: fanMostCommonType || "Not enough data yet" },
                        { label: "First private session", value: fanPrivateSorted[0] ? new Date(fanPrivateSorted[0].date_time).toLocaleDateString() : "Not enough data yet" },
                        { label: "Most recent private session", value: fanPrivateSorted[fanPrivateSorted.length - 1] ? new Date(fanPrivateSorted[fanPrivateSorted.length - 1].date_time).toLocaleDateString() : "Not enough data yet" },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ padding: 14, background: "rgba(168,85,247,0.06)", borderRadius: 10, border: "1px solid rgba(168,85,247,0.15)" }}>
                          <div style={{ fontSize: 11, color: C.text, marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: color || C.white }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[...fanPaidSessions].sort((a, b) => new Date(b.date_time) - new Date(a.date_time)).slice(0, 5).map(s => (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
                          <div style={{ fontSize: 12, color: C.text }}>{s.session_type} · {new Date(s.date_time).toLocaleDateString()}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#a855f7" }}>${parseFloat(s.usd).toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                    {/* Combined lifetime value — each source labeled separately, summed once */}
                    <div style={{ marginTop: 12, padding: 14, background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ fontSize: 11, color: C.text, marginBottom: 8 }}>Combined Lifetime Value</div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: C.text }}>Free-chat tips</span><span style={{ color: C.cyan, fontWeight: 700 }}>${(w.totalUSD || 0).toFixed(2)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8 }}>
                        <span style={{ color: C.text }}>Private sessions</span><span style={{ color: "#a855f7", fontWeight: 700 }}>${fanPrivateUSD.toFixed(2)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <span style={{ color: C.white, fontWeight: 700 }}>Combined total</span><span style={{ color: C.white, fontWeight: 800 }}>${((w.totalUSD || 0) + fanPrivateUSD).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}
                {whaleTips.length > 0 && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>🤖 AI Predictions</div>
                    <div style={{ padding: 16, background: "rgba(255,255,255,0.04)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 10 }}>
                      {[{ label: "📅 Likely to tip again in", value: likelyReturnDays === 0 ? "Overdue!" : `~${likelyReturnDays} days`, color: C.cyan }, { label: "💸 Predicted next tip size", value: `$${(w.avgTipSize * 1.1).toFixed(2)}`, color: C.gold }, { label: "🎯 Engagement score", value: `${Math.min(99, Math.round((w.tipCount / 10) * 20 + (w.totalUSD / 100) * 10))} / 100`, color: C.pink }, { label: "📈 30-day revenue forecast", value: `$${((w.totalUSD / Math.max(1, Math.floor((Date.now() - new Date(firstTip?.date_time)) / 2592000000))) * 1.05).toFixed(2)}`, color: C.green }].map(({ label, value, color }) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                          <div style={{ fontSize: 13, color: C.text }}>{label}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => setSelectedWhale(null)} style={{ width: "100%", padding: "12px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: C.text, fontSize: 14, cursor: "pointer" }}>Close Profile</button>
                <div style={{ textAlign: "center", fontSize: 11, color: C.text, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>🔒 All fan data is private and secure.</div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* MESSAGE GENERATOR MODAL */}
      {messageTarget && (() => {
        const w = messageTarget
        const days = Math.floor((Date.now() - new Date(w.lastTipDate)) / 86400000)
        const name = w.username
        const messages = [
          `Hey ${name}! I've been thinking about you lately 💕 I'm going live tonight and would love to see your name in the chat 🔥`,
          `${name}! It's been a minute and honestly I miss you 😊 Jumping on soon — come say hi? 💋`,
          `Hey love 💕 Just wanted to reach out because I was literally just thinking about you. I go live tonight — hope to see you there!`,
          `${name}! You crossed my mind today 🥺 I'm streaming soon and it's always better when you're around 💗`,
          `Hey babe! I haven't seen you in a bit and I miss your energy 💕 Going live tonight — don't be a stranger! 😘`,
          `${name}! Going live in a bit and I'm SO excited 🔥 Wanted to make sure you knew because it's always more fun with you there 💕`,
          `Hey! I'm about to go live and literally thought of you first 😍 Come through, it's gonna be a good one tonight 🎉`,
          `${name}! Live stream starting soon 🎥 You're one of my favorites and I'd love to see you tonight 💗`,
          `Hey gorgeous 💕 Going live soon — I've got some fun things planned and thought of you immediately. See you there? 🔥`,
          `${name}! Stream is happening tonight and it won't be the same without you 😘 Come hang with me 💋`,
          `Hey ${name}! I just wanted to say your support genuinely means the world to me 💕 Streaming tonight and hoping to see your face 😊`,
          `${name}! You're honestly one of the sweetest people I get to talk to 🥺 Going live soon — come say hi! 💗`,
          `Hey love! I was looking back at my favorites and you came to mind immediately 💕 I stream tonight, would mean a lot to see you 🔥`,
          `${name}! Just wanted to send some love your way 💋 I'm going live soon and you're always one of my favorite people to have around 😍`,
          `Hey babe 💕 Thinking about my favorite fans tonight and you're at the top of the list 🥰 Going live — hope to see you!`,
          `${name}! Okay don't judge me but I may have been thinking about you today 😂💕 Going live tonight — come flirt with me 😘`,
          `Hey you 👀 I see you haven't come to visit lately… I'm going live tonight and I'll be a little sad if you don't show up 😢💗`,
          `${name}! I was literally just telling someone about my favorite fans and your name came up 🔥 Going live soon, don't miss it 😘`,
          `Hey babe! Fair warning: I'm going live tonight and I may or may not be extra flirty 😏💕 Thought you'd want to know 😘`,
          `${name}! Missing your energy lately 😩 I go live tonight — come remind me why you're one of my faves 💗🔥`,
          `Hey ${name}! Last stream was SO fun and I don't want you to miss tonight's 🎉 Going live soon — get ready 💕`,
          `${name}! I have something special planned for tonight's stream 👀🔥 Didn't want you to miss out — going live soon 💋`,
          `Hey love! Tonight's stream is going to be one of my best ones 🔥 Saving a spot for you 💕 See you soon?`,
          `${name}! Streaming tonight and I promise it'll be worth it 😍 I've been planning something fun and thought of you 💗`,
          `Hey babe 💕 I know you've been busy but I really hope you can make tonight's stream — I have a feeling it's going to be special 🔥😘`,
        ]
        const currentMsg = messages[messageIndex % messages.length]
        const vibes = ["💕 Reconnect", "🔥 Going Live", "🥰 Appreciation", "😘 Flirty", "👀 FOMO"]
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001, padding: 20 }}>
            <div className="modal-inner" style={{ width: 520, ...glassCard, borderRadius: 20, overflow: "hidden" }}>
              <div style={{ padding: "20px 24px", background: "linear-gradient(135deg, rgba(236,72,153,0.2), rgba(124,92,255,0.15))", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.white }}>💌 Message Generator</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>For <span style={{ color: C.pink, fontWeight: 600 }}>{name}</span> · <span style={{ color: C.cyan, fontWeight: 600 }}>{w.platform}</span> · {days === 0 ? "tipped today" : `${days} days since last tip`}</div>
                </div>
                <button onClick={() => setMessageTarget(null)} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: C.muted, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
              <div style={{ padding: 24 }}>
                <div style={{ position: "relative", marginBottom: 16 }}>
                  <div style={{ padding: 20, background: "rgba(255,255,255,0.04)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", fontSize: 15, color: C.white, lineHeight: 1.7, minHeight: 100 }}>{currentMsg}</div>
                  <div style={{ position: "absolute", top: 12, right: 12, fontSize: 10, color: C.muted, background: "rgba(0,0,0,0.5)", padding: "2px 8px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)" }}>{(messageIndex % messages.length) + 1} / {messages.length}</div>
                </div>
                <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 11, color: C.muted }}>Vibe:</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.pink, padding: "2px 10px", background: "rgba(236,72,153,0.15)", border: "1px solid rgba(236,72,153,0.3)", borderRadius: 20 }}>{vibes[messageIndex % 5]}</div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setMessageIndex(i => i + 1); setMessageCopied(false) }} style={{ flex: 1, padding: "12px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>🔄 Generate Another</button>
                  <Button onClick={() => { navigator.clipboard.writeText(currentMsg); setMessageCopied(true); setTimeout(() => setMessageCopied(false), 2500) }} style={{ flex: 1, padding: "12px", fontSize: 14, ...(messageCopied ? { background: "rgba(16,185,129,0.2)", boxShadow: "none", border: "1px solid rgba(16,185,129,0.4)" } : {}) }}>{messageCopied ? "✅ Copied!" : "📋 Copy Message"}</Button>
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: C.muted, textAlign: "center" }}>Tip: paste directly into Chaturbate, BongaCams, or your DM platform</div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* UPGRADE MODAL */}
      {showUpgradeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1002, padding: 20 }}>
          <div style={{ width: 480, background: "rgba(15,20,32,0.97)", backdropFilter: "blur(24px)", borderRadius: 24, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 0 80px rgba(59,130,246,0.2), 0 0 160px rgba(236,72,153,0.1)", overflow: "hidden" }}>
            <div style={{ height: 4, background: "linear-gradient(90deg, #3b82f6, #a855f7, #ec4899)" }} />
            <div style={{ padding: 36 }}>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🚀</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: C.white, marginBottom: 8 }}>{(UPGRADE_COPY[upgradeModalSource] || UPGRADE_COPY.default).headline}</h2>
                <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>{(UPGRADE_COPY[upgradeModalSource] || UPGRADE_COPY.default).subhead}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                {[
                  { icon: "🐳", text: "See ALL your top spenders — not just the top 3" },
                  { icon: "⏰", text: "Discover your exact highest-earning hours & days" },
                  { icon: "💡", text: "Unlock 15+ advanced insights & strategy tips" },
                  { icon: "📈", text: "Full session history with trend analysis" },
                  { icon: "🤖", text: "AI fan behavior predictions & return forecasts" },
                  { icon: "💌", text: "Unlimited re-engagement scripts & fan tracking" },
                ].map(({ icon, text }) => (
                  <div key={text} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 10 }}>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                    <span style={{ fontSize: 13, color: C.white }}>{text}</span>
                  </div>
                ))}
              </div>
              {/* Was: "Most creators miss 30-60% of their earning potential
                  without this" — an invented statistic about creators we have
                  never measured. Replaced with a claim that is true and
                  checkable: what is actually being offered. */}
              {trialEligible && (
                <div style={{ textAlign: "center", padding: "12px 16px", background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)", borderRadius: 10, marginBottom: 24 }}>
                  <div style={{ fontSize: 13, color: C.cyan, fontWeight: 600 }}>Free for 7 days — every Pro feature, on your own data</div>
                </div>
              )}
              <Button
                disabled={earlyAccessSubmitting}
                onClick={async () => {
                  setEarlyAccessSubmitting(true)
                  track('upgrade_checkout_clicked', { source: 'upgrade_modal' })
                  try {
                    const { data: { session } } = await supabase.auth.getSession()
                    if (!session?.access_token) {
                      showToast("Please sign in again, then retry upgrading.")
                      return
                    }
                    const res = await fetch('/api/stripe/checkout', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                      credentials: 'include',
                      body: JSON.stringify({ plan_type: 'standard_monthly' }),
                    })
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok || !data.url) throw new Error(data.error || 'Unable to start checkout.')
                    window.location.assign(data.url)
                  } catch (e) {
                    showToast(e?.message || "Something went wrong starting checkout. Please try again.")
                    setEarlyAccessSubmitting(false)
                  }
                }}
                style={{ width: "100%", padding: "16px", borderRadius: 14, fontSize: 16, marginBottom: 12 }}>
                {earlyAccessSubmitting
                  ? "Redirecting to checkout..."
                  : trialEligible ? "Start my 7-day free trial →" : "🔓 Upgrade to Pro — $19.99/mo"}
              </Button>
              <div style={{ textAlign: "center", fontSize: 12, color: C.muted, marginBottom: 20 }}>
                {trialEligible
                  ? `Card required to start. $19.99/mo begins after ${TRIAL_DAYS} days — cancel any time before then and you pay nothing.`
                  : "Secure checkout powered by Stripe • Cancel anytime"}
              </div>
              <button onClick={() => setShowUpgradeModal(false)} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: C.muted, fontSize: 13, cursor: "pointer" }}>
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING FEEDBACK BUTTON — collapsed to a small icon in a safe gutter so it
          never sits over a fan card's actions or the bottom of the page content */}
      <button
        onClick={() => { setShowFeedback(true); setFeedbackSent(false); setFeedbackText('') }}
        aria-label="Share feedback"
        title="Feedback"
        style={{
          position: "fixed", bottom: 18, right: 18, zIndex: 60,
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 42, height: 42, borderRadius: "50%",
          background: "rgba(15,20,32,0.95)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: C.text, fontSize: 17, cursor: "pointer",
          boxShadow: "0 4px 18px rgba(0,0,0,0.5)", transition: "all 0.2s"
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(34,211,238,0.4)"; e.currentTarget.style.color = C.white }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = C.text }}
      >
        💬
      </button>

      {/* FEEDBACK MODAL */}
      {showFeedback && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", justifyContent: "flex-start", zIndex: 1003, padding: 24, paddingBottom: 80 }}>
          <div style={{ width: 400, background: "rgba(15,20,32,0.98)", backdropFilter: "blur(24px)", borderRadius: 20, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 0 60px rgba(59,130,246,0.15)", overflow: "hidden" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.white }}>Share Feedback 💬</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Help us build what you actually need</div>
              </div>
              <button onClick={() => setShowFeedback(false)} style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: C.muted, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
            <div style={{ padding: 20 }}>
              {feedbackSent ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🙏</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.white, marginBottom: 6 }}>Thank you!</div>
                  <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>Your feedback helps us build better features for you.</div>
                  <Button onClick={() => setShowFeedback(false)} style={{ padding: "9px 24px", fontSize: 13 }}>Close</Button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    {[{ id: 'feature', label: '✨ Feature Request', color: C.cyan }, { id: 'bug', label: '🐛 Bug Report', color: C.red }].map(({ id, label, color }) => (
                      <button key={id} onClick={() => setFeedbackType(id)} style={{ flex: 1, padding: "9px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s", background: feedbackType === id ? `${color}20` : "rgba(255,255,255,0.04)", border: feedbackType === id ? `1px solid ${color}50` : "1px solid rgba(255,255,255,0.08)", color: feedbackType === id ? color : C.muted }}>{label}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                    {feedbackType === 'feature' ? "What feature would make CamCash more useful for you?" : "What's broken or not working as expected?"}
                  </div>
                  <textarea
                    value={feedbackText}
                    onChange={e => setFeedbackText(e.target.value)}
                    placeholder={feedbackType === 'feature' ? "e.g. I wish I could see my earnings by day of week..." : "e.g. When I upload a CSV from Chaturbate, it shows an error..."}
                    rows={4}
                    style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: C.white, fontSize: 13, lineHeight: 1.6, resize: "none", outline: "none", fontFamily: "inherit", marginBottom: 14 }}
                    onFocus={e => e.target.style.borderColor = "rgba(34,211,238,0.4)"}
                    onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
                  />
                  <Button
                    disabled={!feedbackText.trim() || feedbackSubmitting}
                    onClick={async () => {
                      if (!feedbackText.trim() || feedbackSubmitting) return
                      setFeedbackSubmitting(true)
                      const typeLabel = feedbackType === 'feature' ? 'Feature Request' : 'Bug Report'
                      const payload = {
                        message: `[${typeLabel}] ${feedbackText.trim()}`,
                        page_url: typeof window !== 'undefined' ? window.location.href : '',
                        page_title: typeof window !== 'undefined' ? document.title : '',
                        user_agent: typeof window !== 'undefined' ? navigator.userAgent : '',
                        referrer: typeof document !== 'undefined' ? document.referrer : '',
                        user_id: user?.id || null,
                        created_at: new Date().toISOString(),
                      }
                      // Same two-step pattern as the site-wide FeedbackWidget: persist
                      // to Supabase first (so it always shows up in /admin even if the
                      // email fails), then fire the notification email — never block
                      // the "thanks" confirmation on either one.
                      try { await supabase.from('feedback').insert([payload]) } catch (_) {}
                      try {
                        await fetch('/api/feedback', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(payload),
                        })
                      } catch (_) {}
                      track('feedback_submitted', { type: feedbackType, length: feedbackText.length })
                      setFeedbackSubmitting(false)
                      setFeedbackSent(true)
                    }}
                    style={{ width: "100%", padding: "12px", fontSize: 14 }}>
                    {feedbackSubmitting ? 'Sending…' : feedbackType === 'feature' ? '✨ Submit Feature Request' : '🐛 Submit Bug Report'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FAN SEARCH MODAL */}
      {fanSearchOpen && (() => {
        const q = fanSearchQuery.toLowerCase().trim()
        const results = q.length < 1 ? [] : whales.filter(w => w.username?.toLowerCase().includes(q)).slice(0, 8)
        return (
          <div onClick={() => { setFanSearchOpen(false); setFanSearchQuery("") }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1010, padding: "80px 20px 20px" }}>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, background: "rgba(15,20,32,0.98)", backdropFilter: "blur(24px)", borderRadius: 20, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 0 80px rgba(59,130,246,0.2)", overflow: "hidden" }}>
              <div style={{ height: 3, background: "linear-gradient(90deg, #3b82f6, #a855f7, #ec4899)" }} />
              <div style={{ padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, background: "rgba(255,255,255,0.05)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", padding: "10px 14px" }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>🔍</span>
                  <input
                    autoFocus
                    value={fanSearchQuery}
                    onChange={e => setFanSearchQuery(e.target.value)}
                    placeholder="Search by username..."
                    style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.white, fontSize: 15, fontFamily: "inherit" }}
                  />
                  {fanSearchQuery && (
                    <button onClick={() => setFanSearchQuery("")} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>✕</button>
                  )}
                </div>

                {q.length < 1 && (
                  <p style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "20px 0" }}>Type a username to search your fans</p>
                )}

                {q.length >= 1 && results.length === 0 && (
                  <p style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "20px 0" }}>No fans found matching "{fanSearchQuery}"</p>
                )}

                {results.map((w, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, rgba(59,130,246,0.3), rgba(236,72,153,0.3))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: C.white, flexShrink: 0 }}>
                        {w.username?.[0]?.toUpperCase() || "?"}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.white }}>{w.username}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>{w.platform} · {w.tipCount} tips · last {new Date(w.lastTipDate).toLocaleDateString()}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>${w.totalUSD.toFixed(2)}</div>
                      <span style={{ padding: "3px 8px", borderRadius: 100, background: `${TIER_COLORS[w.tier]}20`, color: TIER_COLORS[w.tier], fontSize: 10, fontWeight: 600 }}>{w.tier}</span>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 16, textAlign: "center" }}>
                  <button onClick={() => { setFanSearchOpen(false); setFanSearchQuery("") }} style={{ padding: "8px 20px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: C.muted, fontSize: 13, cursor: "pointer" }}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* SHARE MY STATS MODAL */}
      {/* ── NOTE MODAL ── */}
      {noteTarget && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ ...glassCard, borderRadius:20, padding:28, width:"100%", maxWidth:440, border:"1px solid rgba(245,158,11,0.3)" }}>
            <div style={{ fontSize:18, fontWeight:800, color:C.white, marginBottom:4 }}>📝 Note for {noteTarget}</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:16 }}>Private note — only you can see this</div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="e.g. Loves privates, tips on Sundays, favorite toy is the Lush..."
              rows={4}
              style={{ width:"100%", padding:"10px 12px", borderRadius:10, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(245,158,11,0.3)", color:C.white, fontSize:13, outline:"none", resize:"vertical", fontFamily:"inherit", boxSizing:"border-box" }}
            />
            <div style={{ display:"flex", gap:10, marginTop:14 }}>
              <Button onClick={() => saveTipperNote(noteTarget, noteText)}
                disabled={noteSaving}
                style={{ flex:1, padding:"10px 0", fontSize:14 }}>
                {noteSaving ? "Saving..." : "Save Note"}
              </Button>
              {tipperNotes[noteTarget?.toLowerCase()]?.note && (
                <button onClick={() => saveTipperNote(noteTarget, '')}
                  style={{ padding:"10px 14px", borderRadius:10, background:"rgba(248,113,113,0.15)", border:"1px solid rgba(248,113,113,0.3)", color:C.red, fontSize:13, cursor:"pointer" }}>
                  Delete
                </button>
              )}
              <button onClick={() => setNoteTarget(null)}
                style={{ padding:"10px 14px", borderRadius:10, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:C.muted, fontSize:13, cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModalOpen && (() => {
        const topFan = whales[0]
        // Canonical (session-based, median $/hour) best window, not the legacy
        // tip-level analyticsbestDay — the two can disagree (e.g. legacy "best
        // day" landing on a day the canonical engine wouldn't even qualify as
        // confident), and this share card should say the same day the rest of
        // the app is being migrated to treat as authoritative.
        const bestDayLabel = analytics?.canonicalBestTimes?.bestWindow?.localDay || null
        const platforms = [...new Set(tips.map(t => t.platform))].join(" & ")
        const oneTimerPct = whales.length > 0 ? Math.round((whales.filter(w => w.tipCount === 1).length / whales.length) * 100) : 0
        const cardLines = [
          `💰 Total Earned: $${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          topFan ? `🏆 Top Fan: ${topFan.username} ($${topFan.totalUSD.toFixed(2)})` : null,
          bestDayLabel ? `📅 Best Day: ${bestDayLabel}s` : null,
          `👥 ${whales.length} total fans across ${platforms}`,
          `🔁 ${oneTimerPct}% one-time tippers — that many to win back!`,
          `\nAnalytics by CamCash → camcashgrl.com`,
        ].filter(Boolean).join("\n")

        return (
          <div onClick={() => setShareModalOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1010, padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "rgba(15,20,32,0.98)", backdropFilter: "blur(24px)", borderRadius: 24, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 0 80px rgba(236,72,153,0.2)", overflow: "hidden" }}>
              <div style={{ height: 4, background: "linear-gradient(90deg, #ec4899, #a855f7, #3b82f6)" }} />
              <div style={{ padding: 32 }}>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: C.white, marginBottom: 6 }}>📤 Share My Stats</h2>
                <p style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>Copy your earnings snapshot to flex on Twitter or in cam communities</p>

                {/* Stats card preview */}
                <div style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.1), rgba(236,72,153,0.1))", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)", padding: 20, marginBottom: 20, fontFamily: "monospace" }}>
                  {cardLines.split("\n").map((line, i) => (
                    <div key={i} style={{ fontSize: 13, color: line.startsWith("Analytics") ? C.cyan : C.white, lineHeight: 1.9, fontWeight: line.startsWith("Analytics") ? 600 : 400 }}>{line}</div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <Button
                    onClick={() => { navigator.clipboard.writeText(cardLines); setShareModalOpen(false); setToast("Copied to clipboard! 🎉") }}
                    style={{ flex: 1, padding: "12px", fontSize: 14 }}>
                    📋 Copy to Clipboard
                  </Button>
                  <button
                    onClick={() => { const encoded = encodeURIComponent(cardLines); window.open(`https://twitter.com/intent/tweet?text=${encoded}`, "_blank") }}
                    style={{ flex: 1, padding: "12px", borderRadius: 12, background: "rgba(29,161,242,0.15)", border: "1px solid rgba(29,161,242,0.4)", color: "#1DA1F2", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    𝕏 Post to Twitter
                  </button>
                </div>

                <button onClick={() => setShareModalOpen(false)} style={{ width: "100%", marginTop: 12, padding: "10px", borderRadius: 10, background: "transparent", border: "none", color: C.muted, fontSize: 13, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {showImportSparkle && <ImportSparkle />}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: 272, background: "rgba(15,20,32,0.95)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px 20px", color: C.white, fontSize: 14, zIndex: 9999, boxShadow: "0 8px 32px rgba(0,0,0,0.8)" }}>
        {toast}
        </div>
      )}
      <SiteFooter variant="simple" />
    </div>
  )
}
