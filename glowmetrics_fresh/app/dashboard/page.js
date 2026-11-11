"use client"
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase"
import { readUploadJson } from "../../lib/readUploadJson"
import { parseCSV, detectPlatform, aggregateRows as runEngine, applyFreeAnalysisWindow, summarizeWindowExclusion, accessibleDataset } from "../../lib/analytics"
import { totalEarned, privateEarningRows } from "../../lib/sessions/normalize"
import { logParseAttempt, analyzeFormat } from "../../lib/parseTracking"
import { buildProTeasers } from "../../lib/proTeasers"
import { computeRoomHealth, ROOM_STATES, MOMENTUM_DIRECTIONS } from "../../lib/analytics/roomHealth"
import { computeRevenueVelocity, computeLiveComparison } from "../../lib/analytics/velocity"
import { detectSessionPhase, PHASES, getRecoveryActions, getGoalStrategy } from "../../lib/analytics/sessionPhase"
import { computeOpportunityScore, computeStreamHealth } from "../../lib/analytics/opportunity"
import { computeCoachingState } from "../../lib/coaching/triggers"
import dynamic from "next/dynamic"
import Sidebar from "./Sidebar"
import SiteFooter from "../components/SiteFooter"
import { PLATFORM_TOKEN_RATES, tokenRate, platformColor, platformDisplayName, canonicalPlatform } from "../../lib/constants"
import { track as gtmTrack } from '../../lib/track'
import { trackTrialEvent } from '../../lib/analytics-client'
import { getDashboardReadiness, getModuleLockState, canShowHourlyRate, LockedInsightCard, DashboardProgressCard } from './DashboardPreview'
import PlatformsIntelligence from './PlatformsIntelligence'
import CommandCenter from './CommandCenter'
import SubscriptionManager from './SubscriptionManager'
import { platformLimitMessage, FREE_PLATFORM_LIMIT, resolvePlatformRoles as resolvePlanPlatformRoles } from '../../lib/planLimits'
import Button from '../../components/ui/Button'
import { useLiveSessionEngine } from '../live/useLiveSessionEngine'
import PrivateShowControl from '../live/PrivateShowControl'
import LiveModeAllowanceBar from '../live/LiveModeAllowanceBar'
import { LatestShowDelta } from './LatestShows'
import SessionsOverview from './SessionsOverview'
import PlannedStreams from './PlannedStreams'
import LoadWarningBanner from './LoadWarningBanner'
import { loadUserHistory, failureState } from '../../lib/dataLoad/resolveLoad'
import { tipsSource, paidSessionsSource, toAscending } from '../../lib/dataLoad/queries'
import { PrimaryPlatformBanner } from './PrimaryPlatformPrompt'
import { SESSION_GAP_MS } from '../../lib/analytics/sessions'
import { useRecentShows } from './useRecentShows'
import FeedbackButton from '../../components/FeedbackButton'
import ContextualFeedbackPopup from '../../components/ContextualFeedbackPopup'
import { resolveCreatorTimeZone, isValidTimeZone, zonedHour, zonedDay, zonedYMD, zonedMonthKey } from '../../lib/creatorTimezone'

// Tab-only components loaded on demand instead of in the initial dashboard
// bundle — each is only ever rendered behind an `activeTab === '...'` check,
// and StreamPlanner/MoneyMap alone pull in all of recharts.
const TAB_LOADING = (
  <div style={{ padding: "80px 0", textAlign: "center" }}>
    <div style={{ width: 40, height: 40, border: "2px solid #1e2d45", borderTop: "2px solid #22D3EE", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
  </div>
)
const AnalyticsCharts = dynamic(() => import('./AnalyticsCharts'), { ssr: false, loading: () => TAB_LOADING })
const StreamPlanner = dynamic(() => import('./StreamPlanner'), { ssr: false, loading: () => TAB_LOADING })
const MoneyMap = dynamic(() => import('./MoneyMap'), { ssr: false, loading: () => TAB_LOADING })
const DashboardGrowthCharts = dynamic(() => import('./DashboardGrowthCharts'), { ssr: false })
const TokenCalculator = dynamic(() => import('../guides/cam-model-token-calculator/TokenCalculatorClient'), { ssr: false, loading: () => TAB_LOADING })

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
  "Whale": C.gold, "Shark": C.blue, "Regular": C.cyan, "Occasional": C.indigo,
  "New/Developing": C.green, "Dormant": C.orange
}

// Fans-tab filter pills. MUST list every tier identifyWhales() in
// lib/analytics.js can assign — a tier missing here is only reachable via
// "All" and its fans silently vanish from every other pill. Display-only:
// the tier formula itself lives in identifyWhales() and is not changed here.
const FAN_TIER_FILTERS = ["ALL", "Whale", "Shark", "Regular", "Occasional", "New/Developing", "Dormant"]
const FAN_TIER_FILTER_LABELS = { "ALL": "All", "New/Developing": "New" }

// Risk Signals toggle: a top spender (Whale/Shark tier) whose engine-computed
// behavioralState is 'At Risk'. Reads identifyWhales() output only -- no new
// threshold. 'At Risk' is already relative to the fan's own visit cadence and
// is never assigned when the creator hasn't streamed meaningfully on that
// platform (calcFanBehavioralState returns 'Dormant' instead), so a long
// creator break can't trip this.
const isTopSpenderAtRisk = (w) => (w.tier === 'Whale' || w.tier === 'Shark') && w.behavioralState === 'At Risk'

// Shown in the Risk Signals upgrade modal. Each line maps to an item on the
// Pro plan list in app/pricing/PricingClient.js -- do not add claims here
// that the pricing page (and the product) doesn't back.
const PRO_FAN_INTEL_FEATURES = [
  { icon: "🚨", title: "Deeper fan risk signals", text: "Flags a top spender when they break from their own personal tipping rhythm." },
  { icon: "💌", title: "Churn & re-engagement insights", text: "See who is drifting, why, and when to reach out." },
  { icon: "🐳", title: "Full fan profiles & CRM tools", text: "Every fan, not just your top 3, with notes and history." },
  { icon: "📈", title: "Complete historical trend analysis", text: "Spot fans warming up or cooling off over time." },
  { icon: "🗂️", title: "Full permanent history", text: "On every platform, so patterns are built from your real history, not 31 days." },
  { icon: "🌐", title: "Cross-platform comparisons", text: "See how your fans and earnings stack up across every platform." },
]

// Rotating microcopy shown on the CSV importer button/progress bar while a
// real upload request is in flight — purely cosmetic (doesn't imply we know
// the server's actual step), but keeps the card feeling alive during the wait.
const IMPORT_MESSAGES = [
  "Reading your CSV…",
  "Detecting platform…",
  "Importing tips…",
  "Calculating earnings…",
  "Finding top fans…",
  "Building your dashboard…",
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

const formatHour = (hour) => {
  const utcHour = parseInt(hour)
  if (isNaN(utcHour)) return "—"
  const offsetHours = new Date().getTimezoneOffset() / -60
  const localHour = ((utcHour + offsetHours) % 24 + 24) % 24
  const h = Math.round(localHour)
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

function TitleGenerator({ C, glassCard, analytics, tips, sessions, whales, creatorTz }) {
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
    const currentHour = zonedHour(now, creatorTz) // creator-local hour, not UTC
    const todayDay = now.toLocaleDateString("en-US", { weekday: "long", timeZone: creatorTz })
    const _analyticsBestHourCtx = analytics?.bestHour || null
    let bestHour = null
    if (_analyticsBestHourCtx) {
      bestHour = parseInt(_analyticsBestHourCtx.hour) // already local from analytics.js toLocalHour
    } else {
      const hourUSD = {}; const hourCount = {}
      ;(sessions || []).forEach(s => {
        const h = zonedHour(s.startTime, creatorTz) // creator-local hour
        hourUSD[h] = (hourUSD[h] || 0) + s.totalUSD
        hourCount[h] = (hourCount[h] || 0) + 1
      })
      const bestHourEntry = Object.entries(hourUSD).map(([h, usd]) => [h, usd / (hourCount[h] || 1)]).sort((a,b) => b[1]-a[1])[0]
      bestHour = bestHourEntry ? parseInt(bestHourEntry[0]) : null
    }
    // bestHour is already a local hour — format directly, no offset needed
    const fmtLocalHour = h => h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`
    const bestHourLabel = (bestHour === null || isNaN(bestHour)) ? null : fmtLocalHour(bestHour)
    const hoursUntilPeak = bestHour !== null ? (bestHour - currentHour + 24) % 24 : 99
    const isPeakNow = hoursUntilPeak <= 1
    const peakSoon = hoursUntilPeak <= 3 && !isPeakNow
    const avgSessionUSD = sessions?.length ? sessions.reduce((s,x) => s + x.totalUSD, 0) / sessions.length : 0
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

// Compact ranked-row for the Fans tab Leaderboard / Directory sections.
// Pure presentation over already-computed fan fields — no derived scoring.
// No avatar: username is the primary identity, platform is a prominent
// color-coded badge (colors from lib/constants.js platformColor(), the
// single shared source, not a new one-off palette).
function FanRow({ w, rank, onView, onMessage, onNote }) {
  const tc = TIER_COLORS[w.tier] || C.cyan
  const pc = platformColor(w.platform)
  const days = w.daysSinceLastTip ?? (w.lastTipDate ? Math.floor((Date.now() - new Date(w.lastTipDate)) / 86400000) : null)
  return (
    <div className="whale-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
      {rank != null && (
        <div style={{ width: 22, flexShrink: 0, fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "center" }}>#{rank}</div>
      )}
      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
        <div title={w.username} style={{ fontSize: 14, fontWeight: 800, color: C.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.username}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ padding: "1px 6px", borderRadius: 100, background: `${tc}18`, color: tc, fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{w.tier}</span>
          <span style={{ padding: "3px 9px", borderRadius: 6, background: `${pc}22`, border: `1px solid ${pc}70`, color: pc, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 0 }}>{platformDisplayName(w.platform)}</span>
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 74 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.white }}>${(w.totalUSD || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div style={{ fontSize: 9, color: C.text }}>{(w.tipCount || 0).toLocaleString()} tips</div>
      </div>
      <div style={{ textAlign: "right", minWidth: 84 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{formatLastActive(days).replace("Last active ", "")}</div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <button onClick={onView} style={{ padding: "5px 10px", borderRadius: 7, background: "linear-gradient(135deg, #22D3EE, #EC4899)", border: "none", color: "#06101A", fontSize: 11, fontWeight: 800, cursor: "pointer" }} title="View fan profile">View Fan</button>
        {onMessage && (
          <button onClick={onMessage} aria-label={`Message ${w.username}`} title="Message fan" style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, background: "rgba(255,43,174,0.1)", border: "1px solid rgba(255,43,174,0.25)", color: C.pink, cursor: "pointer" }}><EnvelopeHeartIcon size={13} /></button>
        )}
        {onNote && (
          <button onClick={onNote} aria-label={`Add note for ${w.username}`} title="Add note" style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", fontSize: 12, cursor: "pointer" }}>📝</button>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  // Saved, dated stream plans (Stream Planner "Plan a stream"); the only
  // source for the Sessions Schedule tab.
  const [plannedStreams, setPlannedStreams] = useState([])
  const loadPlannedStreams = useCallback(async () => {
    if (!user?.id) return
    const { data, error } = await supabase.from('planned_streams')
      .select('id, platform, start_at, end_at, source, created_at')
      .eq('user_id', user.id).order('start_at', { ascending: false }).limit(500)
    if (!error) setPlannedStreams(data || [])
  }, [user?.id])
  useEffect(() => { loadPlannedStreams() }, [loadPlannedStreams])
  const [profile, setProfile] = useState(null)
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
  const [activeTab, setActiveTab] = useState('overview')
  const [toast, setToast] = useState("")
  const [uploadCount, setUploadCount] = useState(0)
  const [whaleFilter, setWhaleFilter] = useState("ALL")
  // Risk Signals toggle (Fans tab). Pro: filters to top spenders off their
  // own pattern. Free: opens the Unlock Risk Signals modal instead -- free
  // plans only analyze 31 days on secondary platforms, too thin for reliable
  // per-fan rhythm signals.
  const [riskOnly, setRiskOnly] = useState(false)
  const [showRiskUpgrade, setShowRiskUpgrade] = useState(false)
  const [platformFilter, setPlatformFilter] = useState("ALL")
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false) // Fans tab Leaderboard "Show More" toggle
  const [meaningfulOnly, setMeaningfulOnly] = useState(true)
  const [platformTimeFilter, setPlatformTimeFilter] = useState("ALL")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedWhale, setSelectedWhale] = useState(null)
  const [messageTarget, setMessageTarget] = useState(null)
  const [messageIndex, setMessageIndex] = useState(0)
  const [messageCopied, setMessageCopied] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [fanSearchOpen, setFanSearchOpen] = useState(false)
  const [fanSearchQuery, setFanSearchQuery] = useState("")
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [chartDrillDay, setChartDrillDay] = useState(null)
  // Element that had focus right before the fan profile modal opened, so we
  // can return focus to it (the "View Fan" button) once the modal closes.
  // Set synchronously in the "View Fan" onClick (via e.currentTarget) rather
  // than read back from document.activeElement in an effect — by the time a
  // passive effect runs, the modal's autoFocus has already moved focus onto
  // the close button, so reading activeElement here would just capture that.
  const whaleModalTriggerRef = useRef(null)
  // Escape closes the Unlock Risk Signals modal.
  useEffect(() => {
    if (!showRiskUpgrade) return
    const onKeyDown = (e) => { if (e.key === "Escape") setShowRiskUpgrade(false) }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [showRiskUpgrade])
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
  // The canonical server session (live_sessions) via the same engine
  // /app/live/page.js uses. Go Live / End / Pause / Resume call the server;
  // "live" here is only ever the server session's status — never set from
  // the UI or inferred from tips — so a session started or ended on any
  // surface (extension, another tab, the server's limits) shows the same.
  const liveEngine = useLiveSessionEngine()
  const liveActive = liveEngine.serverSession?.status === 'live' || liveEngine.serverSession?.status === 'starting'
  const liveStartedAtIso = liveActive ? liveEngine.serverSession?.started_at || null : null
  const liveStartTime = useMemo(() => (liveStartedAtIso ? new Date(liveStartedAtIso) : null), [liveStartedAtIso])
  // Finalized shows from persisted data; refetched whenever a show finishes.
  const recentShows = useRecentShows(liveEngine.completedShowsVersion, { enabled: !!user })
  // Closed private intervals of finalized Live shows — the Live term of
  // Total Earned. Reloaded whenever a show finishes.
  const [livePrivateIntervals, setLivePrivateIntervals] = useState([])
  // Detailed per-session analytics are progressive disclosure on Sessions.
  const [showDetailedBreakdown, setShowDetailedBreakdown] = useState(false)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetch('/api/live/sessions/private-earnings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.intervals) setLivePrivateIntervals(d.intervals) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user, liveEngine.completedShowsVersion])
  // Opening Sessions shows every new show in full; after a moment on screen
  // they count as viewed for this account (all devices).
  const newShowIdsKey = recentShows.newIds.join(',')
  useEffect(() => {
    if (activeTab !== 'sessions' || !newShowIdsKey) return
    const t = setTimeout(() => recentShows.acknowledge(newShowIdsKey.split(',')), 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, newShowIdsKey])
  // A finished show changes the canonical tips behind every historical KPI:
  // reload them from the database rather than adding anything in memory.
  useEffect(() => {
    if (!user || liveEngine.completedShowsVersion === 0) return
    loadData(user.id, true, { silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEngine.completedShowsVersion, user?.id])
  // Creator timezone — the dashboard's single clock for best hours, day
  // boundaries, session timestamps and time-based recommendations. Source of
  // truth is profiles.timezone (set in onboarding Step 1 or via the sidebar);
  // falls back to the browser zone, then UTC. The ref is read by code that
  // runs outside render (loadData, realtime handlers).
  const [creatorTz, setCreatorTz] = useState('UTC')
  const creatorTzRef = useRef(null)
  const ensureCreatorTz = async (uid) => {
    if (creatorTzRef.current) return creatorTzRef.current
    let saved = null
    try {
      const { data } = await supabase.from('profiles').select('timezone').eq('id', uid).maybeSingle()
      saved = data?.timezone ?? null
    } catch (_) { /* fall back to browser zone */ }
    const tz = resolveCreatorTimeZone(saved)
    creatorTzRef.current = tz
    setCreatorTz(tz)
    return tz
  }
  // Sidebar "Change": save first, then switch the dashboard clock and re-run
  // analytics (engine + get_user_insights) on the new zone. On failure the
  // current zone stays in effect and the error is returned to the caller.
  const changeCreatorTimezone = async (tz) => {
    if (!user?.id || !isValidTimeZone(tz)) return { error: 'invalid' }
    const { error } = await supabase.from('profiles').update({ timezone: tz }).eq('id', user.id)
    if (error) return { error }
    creatorTzRef.current = tz
    setCreatorTz(tz)
    loadData(user.id, true, { silent: true })
    return {}
  }
  const fmtDuration = (secs) => {
    const s = Math.max(0, Math.floor(secs || 0))
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
      : `${m}m ${String(r).padStart(2, '0')}s`
  }
  const [liveEvents, setLiveEvents] = useState([])
  const [liveGoalTokens, setLiveGoalTokens] = useState(0)
  const [livePlatform, setLivePlatform] = useState('Chaturbate')
  const [liveTipInput, setLiveTipInput] = useState({ username: '', tokens: '', usd: '' })
  const [liveAlerts, setLiveAlerts] = useState([])
  const [liveTick, setLiveTick] = useState(0)
  const [minuteTick, setMinuteTick] = useState(0) // increments every 60s to refresh time-based alerts
  const [betaCount, setBetaCount] = useState(null)
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
  // Did the tips / private-session history on screen come from a COMPLETE load?
  // loadIssues drives the persistent warning; dataComplete is passed to Sessions
  // as tipsLoadComplete (covers tips AND private sessions). See lib/dataLoad.
  const [loadIssues, setLoadIssues] = useState([])
  const [dataComplete, setDataComplete] = useState(true)
  // Per-table load state { complete, state, coverage, asOf } (lib/dataLoad/resolveLoad.js).
  // S1 records coverage only; nothing on screen reads it yet.
  const loadStateRef = useRef({ tips: { complete: false }, paid: { complete: false } })
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
  // Go Live creates (or reattaches to) the real server session; the feed and
  // coaching reset only once the server has confirmed a session.
  const handleDashboardGoLive = async () => {
    const session = await liveEngine.goLive(livePlatform)
    if (!session) return
    setLiveEvents([])
    processedTipIds.current = new Set()
    coachingCooldowns.current = {}
  }
  const firedAlertsLog     = useRef([])
  const phaseChangeLog     = useRef([])
  const streamHealthCacheRef = useRef({ value: null, deps: null })
  const sessionPhaseCacheRef = useRef({ value: null, deps: null })

  const isBetaUser = true
  const isPro = profile?.plan === 'pro' || profile?.plan === 'unlimited'
  // Free tier: every platform (max FREE_PLATFORM_LIMIT = 2) keeps a rolling
  // 31-day window. No primary-platform exception on Free (per 2026-11-10 plan change).
  const freeUnlimitedPlatform = null
  const uploadLimit = Infinity

  // Compute windowed tips for free users; windowSummary feeds teaser signal detection
  const analysisTips = isPro ? tips : applyFreeAnalysisWindow(tips, { windowDays: 31, unlimitedPlatform: freeUnlimitedPlatform })
  const windowSummary = summarizeWindowExclusion(tips, analysisTips)
  // Re-run the engine when the plan or primary platform changes after tips
  // loaded (profile arrives separately; choosing a primary updates it), so
  // every tab reflects the same gating without a reload.
  const gatingKeyRef = useRef(null)
  // Current gating for async loaders (their closures can predate the profile).
  const gatingRef = useRef({ isPro, unlimited: freeUnlimitedPlatform })
  gatingRef.current = { isPro, unlimited: freeUnlimitedPlatform }
  useEffect(() => {
    const key = `${isPro}|${freeUnlimitedPlatform || ''}`
    if (gatingKeyRef.current === null) { gatingKeyRef.current = key; return }
    if (gatingKeyRef.current === key || !tips.length) { gatingKeyRef.current = key; return }
    gatingKeyRef.current = key
    try {
      const tz = creatorTzRef.current || resolveCreatorTimeZone(null)
      const r = runEngine(isPro ? tips : applyFreeAnalysisWindow(tips, { windowDays: 31, unlimitedPlatform: freeUnlimitedPlatform }), tz)
      if (r) setAnalytics(r)
    } catch (e) { console.error('gating re-run failed:', e) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, freeUnlimitedPlatform])

  // whales must be declared before use here — buildProTeasers reads it below,
  // and this runs unconditionally on every render (including before the
  // loading gate), so declaring it later caused a TDZ ReferenceError on
  // every single dashboard load.
  const whales = analytics?.whales || []

  // Build Pro teaser cards (only shown to free users when real signal exists)
  const proTeasers = buildProTeasers({
    tips,
    analysisTips,
    whales,
    windowSummary,
    isPro
  })

  const fmtHour = h => { if (h == null || isNaN(h)) return 'N/A'; return h === 0 ? '12 AM' : h < 12 ? h+' AM' : h === 12 ? '12 PM' : (h-12)+' PM' }

  const openUpgradeModal = (source) => {
    track('upgrade_click', { source })
    gtmTrack('paywall_hit', { feature: source })
    setShowUpgradeModal(true)
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
    gtmTrack('tab_switched', { tab_name: tab })
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

  // ── SINGLE NORMALIZER FOR ALL TIP SOURCES ──────────────────────────────────
  // Ensures consistent object shape and stable _id across initial load, realtime,
  // and extension sources. Critical for deduplication.
  const normalizeLiveTip = (tip, deliveryPath = 'unknown') => {
    const id = tip.id || tip._id
    if (!id) {
      console.warn('normalizeLiveTip: tip has no id', tip)
      return null
    }
    return {
      _id:              id,
      _isHistory:       tip._isHistory ?? false,
      username:         tip.username || 'Unknown',
      tokens:           parseInt(tip.tokens) || 0,
      usd:              parseFloat(tip.usd) || 0,
      normalizedRevenue: parseFloat(tip.usd) || parseFloat(((tip.tokens || 0) * tokenRate(tip.platform)).toFixed(2)),
      sourceUsed:       tip.source || tip.sourceUsed || 'unknown',
      timestamp:        tip.timestamp instanceof Date ? tip.timestamp : new Date(tip.timestamp || tip.received_at || Date.now()),
      platform:         tip.platform || 'Unknown',
      deliveryPath,     // track how this event arrived: 'initial_load', 'realtime', 'extension'
    }
  }

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

      const normalized = normalizeLiveTip({ ...tipEvent, id: tipEvent.id || dedupKey }, 'extension')
      if (!normalized) return

      console.debug('[liveEvents] extension tip', { revenue: normalized.normalizedRevenue, total: liveEvents.length + 1 })
      setLiveEvents(prev => {
        // Ensure no duplicate by ID
        if (prev.some(e => e._id === normalized._id)) return prev
        return [...prev, normalized]
      })
    }
    window.addEventListener('message', handleExtensionMessage)
    return () => window.removeEventListener('message', handleExtensionMessage)
  }, [])

  // ── LIVE TIPS: historical hydration + realtime subscription ─────────────
  // The single live-tip channel for the whole dashboard — mount-scoped (not
  // tab-gated), so it stays connected and auto-switches the user to the Live
  // tab on a new tip even while they're on another tab. Previously there were
  // two separate channels here (one tab-gated, one mount-scoped) that both
  // wrote to the same channel ref; the second one to subscribe silently won
  // ownership of the ref, so tab switches could tear down the wrong
  // connection and leave the live feed disconnected until a full reload, and
  // the mount-scoped one had no de-dup so tips could appear twice. Consolidated
  // into one channel with de-dup + history hydration, matching app/live/page.js.
  // SAFETY RULES:
  //   1. Singleton — only one channel ever; skips if already subscribed
  //   2. isHydratingHistory.current = true during the initial DB query so
  //      coaching / alerts / animations are suppressed for stale data
  //   3. Every event is checked against processedTipIds before processing
  //   4. Historical events get _isHistory:true so computeState() excludes
  //      them from timing/pace calculations (only uses them for totals)
  useEffect(() => {
    if (!user) return
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
              platform:         tip.platform || 'Unknown',
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
          platform:         tip.platform || 'Unknown',
          source:           'extension',
        }
        setLiveEvents(prev => [...prev, normalized])
        // Flash animation: highlight the new tip row for 2.5s
        setFlashTipId(normalized._id)
        setTimeout(() => setFlashTipId(null), 2500)
        // Switch to Live Mode tab automatically if user is on another tab
        setActiveTab('live')
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
  }, [user])

  useEffect(() => {
    // Restore the active tab post-mount only (never during render) so the
    // client's first render matches the server's — reading window/localStorage
    // during render here previously caused a hydration mismatch. Same
    // precedence as before: ?tab= URL param, then localStorage, else the
    // 'overview' default already set by useState above.
    if (typeof window !== 'undefined') {
      const fromUrl = new URLSearchParams(window.location.search).get('tab')
      const saved = localStorage.getItem('camcash_tab')
      const target = fromUrl || saved
      if (target) setActiveTab(target)
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
        if (count === 0 && !beta?.onboarding_complete) router.replace('/onboarding')
      })
      setUser(user)
      // Log the trial start for funnel analytics (free_trial_events). Stripe
      // itself remains the source of truth for actual trial/subscription
      // status (profiles.subscription_status / subscriptions table, kept in
      // sync by the webhook) — this is a separate, best-effort marketing
      // signal, so an approximate expiry computed from the redirect's trial
      // day count is fine here. Params are stripped right after so a refresh
      // of this URL doesn't log a duplicate trial_started event.
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        if (params.get('success') === 'true' && params.get('trial')) {
          const trialDays = parseInt(params.get('trial'), 10) || 7
          const startsAt = new Date()
          const expiresAt = new Date(startsAt.getTime() + trialDays * 86400000)
          trackTrialEvent('trial_started', {
            trialDaysOffered: trialDays,
            trialStartsAt: startsAt.toISOString(),
            trialExpiresAt: expiresAt.toISOString(),
          })
          params.delete('success'); params.delete('trial'); params.delete('plan')
          const rest = params.toString()
          router.replace(`/dashboard${rest ? `?${rest}` : ''}`)
        }
      }
      supabase.from('profiles')
        .select('plan, primary_pro_platform, streaming_platforms, timezone')
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
        batch.forEach(r => { r.platform = canonicalPlatform(r.platform) })

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
            const userTz = creatorTzRef.current || resolveCreatorTimeZone(null)
            const analysisTips = gatingRef.current.isPro ? updated : applyFreeAnalysisWindow(updated, { windowDays: 31, unlimitedPlatform: gatingRef.current.unlimited })
            const r = runEngine(analysisTips, userTz)
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

      // Extension live-tip realtime handling now lives entirely in the
      // dedicated live_tips_dash_ effect above (single channel, de-duped,
      // with history hydration) — this used to be a second, separate
      // channel here that raced with that one over the same channel ref.

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
            const userTz = creatorTzRef.current || resolveCreatorTimeZone(null)
            const analysisTips = gatingRef.current.isPro ? prev : applyFreeAnalysisWindow(prev, { windowDays: 31, unlimitedPlatform: gatingRef.current.unlimited })
            const r = runEngine(analysisTips, userTz)
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
      // liveTipsChannelRef is owned and cleaned up by the live_tips_dash_
      // effect above — removing it here too would double-remove the same
      // channel on unmount (and previously could tear down the wrong one
      // while both effects were racing over the same ref).
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
        // loadData sets "Updated" itself, and only after a fully fresh load (a failed refresh must not look fresh)
        loadData(user.id, true, { silent: true })
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
    if (activeTab !== 'live' || !user) return
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
        platform:          tip.platform || 'Unknown',
      }))

      setLiveEvents(normalized)
    }

    loadRecentLiveTips()
    return () => { cancelled = true }
  }, [activeTab, user])

  // ── LIVE TICKER: 1-second interval drives time-based re-renders ─────────────
  // Without this, computeState() / getAlerts() / coaching never update because
  // React only re-renders on state changes — Date.now() alone is not enough.
  useEffect(() => {
    if (activeTab === 'live' && liveActive) {
      liveTickerRef.current = setInterval(() => setLiveTick(t => t + 1), 1000)
    } else {
      clearInterval(liveTickerRef.current)
    }
    return () => clearInterval(liveTickerRef.current)
  }, [activeTab, liveActive])

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
      const userTz = await ensureCreatorTz(uid)
      // Tips and private sessions are loaded together and the load says, explicitly,
      // whether it is complete. A failed or partial load never replaces data that
      // came from a complete load (lib/dataLoad/resolveLoad.js).
      const history = await loadUserHistory({
        tips: tipsSource(supabase, uid),
        paid: paidSessionsSource(supabase, uid),
        previous: () => loadStateRef.current, // read when the fetches finish, not when they start
      })
      if (history.issues.length) console.error('[loadData] history load incomplete', history.issues.map((i) => ({ table: i.table, reason: i.reason, stale: i.stale, error: i.error, expected: i.expected, received: i.received })))
      let allData = history.tips.apply ? toAscending(history.tips.rows) : []
      // One name per platform ('BC' → 'BongaCams') before any analytics run.
      allData.forEach(t => { t.platform = canonicalPlatform(t.platform) })
      // CHECKPOINT 1: Immediately after Supabase tips fetch
      console.log('[DASH TRACE] tips fetch', {
        count: allData?.length,
        targetRows: allData?.filter(t =>
          ['gutteraide', 'ekkel92', 'demboner'].includes(t.username)
        )
      })
      // Track live tips total for Private Sessions page only
      // Live tips are separate from main analytics; canonical tips table is
      // the single source of truth for historical earnings analysis
      try {
        const { data: liveRows, error: liveErr } = await supabase
          .from("live_tips")
          .select("id, usd")
          .eq("user_id", uid)
        if (!liveErr && liveRows?.length) {
          setLiveTipsTotalUSD(liveRows.reduce((sum, r) => sum + (parseFloat(r.usd) || 0), 0))
        }
      } catch (e) { /* non-fatal — live tips total just won't display */ }

      if (allData.length) {
        setTips(allData)
        try {
          // Apply 31-day rolling window for free users (per-platform, activity-anchored)
          const analysisTips = gatingRef.current.isPro ? allData : applyFreeAnalysisWindow(allData, { windowDays: 31, unlimitedPlatform: gatingRef.current.unlimited })
          // CHECKPOINT 2: Immediately before runEngine()
          console.log('[DASH TRACE] before engine', {
            count: analysisTips.length,
            targetRows: analysisTips.filter(t =>
              ['gutteraide', 'ekkel92', 'demboner'].includes(t.username)
            ),
            rawUsdSum: analysisTips.reduce(
              (sum, t) => sum + (Number(t.usd) || 0),
              0
            )
          })
          const result = runEngine(analysisTips, userTz)
          // CHECKPOINT 3: Immediately after runEngine()
          console.log('[DASH TRACE] engine output', {
            totalUSD: result?.totalUSD,
            totalTokens: result?.totalTokens
          })
          setAnalytics(result)
          lastEngineTipsFingerprintRef.current = { length: allData.length, lastId: allData[allData.length - 1]?.id ?? null }
        } catch (engineErr) {
          console.error('[loadData] runEngine failed:', engineErr)
        }
        // Save to cache (complete loads only: a partial list is never cached as if complete)
        try {
          if (history.tips.complete) sessionStorage.setItem(`camcash_tips_${uid}`, JSON.stringify(allData))
          if (history.tips.complete) sessionStorage.setItem(`camcash_tips_time_${uid}`, Date.now().toString())
        } catch(e) {} // quota exceeded — fine, skip cache
      }
      // paid_sessions (BongaCams Private/Full-Private/Group/Spy) — separate
      // table, separate state, never merged into `tips`/`analytics`. Same
      // pagination pattern as the tips fetch above.
      if (history.paid.apply) {
        const allPaidSessions = toAscending(history.paid.rows)
        allPaidSessions.forEach(p => { p.platform = canonicalPlatform(p.platform) })
        setPaidSessions(allPaidSessions)
      }

      const { data: engineData, error: engineError } = await supabase.rpc('get_user_insights', { p_user_id: uid, p_timezone: userTz })
      if (engineError) console.error('[loadData] get_user_insights failed:', { code: engineError.code, message: engineError.message })
      else setEngineInsights(engineData) // a failed call never overwrites insights already on screen
      loadStateRef.current = history.loadState
      setDataComplete(history.complete)
      setLoadIssues(history.issues)
      if (history.fullyFresh) setLastRefreshed(new Date())
    } catch (err) {
      // Anything thrown (network, timezone lookup, engine): never claim completeness we cannot prove.
      console.error('[loadData] failed:', { message: err?.message })
      const f = failureState(loadStateRef.current)
      loadStateRef.current = f.loadState
      setDataComplete(f.tipsComplete && f.paidComplete)
      setLoadIssues(f.issues)
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

    // Log parse attempt for analysis
    if (user?.id && rawText) {
      const formatAnalysis = analyzeFormat(rawText)
      logParseAttempt({
        userId: user.id,
        source: 'dashboard',
        attemptedPlatform: detectedLabel,
        claimedPlatform: platformLabel,
        rawText,
        formatAnalysis,
        parseSuccess: !!preview,
        errorReason: preview ? null : "Could not parse file — no valid rows found",
        errorDetails: formatAnalysis,
      })
    }

    // Only play the celebratory checkmark/sparkle when we actually found
    // something to preview — an unparseable file isn't a "confirmation".
    if (preview) {
      setShowImportSparkle(true)
      setTimeout(() => setShowImportSparkle(false), 2400)
    }
    gtmTrack('platform_limit_preview_shown', { platform: detectedLabel, hasPreview: !!preview })
  }

  const handleCSV = async (file, forcePlatform = null, dateOrder = null) => {
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
    gtmTrack('csv_upload_started', { platform: forcePlatform || uploadPlatform || 'unknown' })

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
      if (dateOrder) fd.append('date_order', dateOrder)
      // Export times are the creator's wall clock; the server reads them in the
      // saved zone, or this resolved zone when none is saved yet.
      fd.append('time_zone', creatorTzRef.current || resolveCreatorTimeZone(null))

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      })

      // A timed-out, too-large or crashed upload returns a non-JSON or empty
      // body; readUploadJson turns that into a clear error instead of a parse
      // crash that reads as a broken CSV.
      const result = await readUploadJson(res)

      if (!res.ok || result.error) {
        if (result.code === 'platform_limit_reached') {
          await denyWithPlatformPreview(file, forcePlatform || uploadPlatform || result.platform || null)
        } else {
          showToast("❌ " + (result.error || 'Upload failed'))
          // date_order_required: the file's dates fit both MM/DD and DD/MM —
          // keep the file so the creator can pick the format and retry.
          setLastUploadResult({
            success: false,
            error: result.error || "We couldn't read this CSV. Please check the format or try another file.",
            code: result.code || null,
            retry: result.code === 'date_order_required' ? { file, forcePlatform } : null,
          })
          setImportStage('error')
        }
        return
      }

      track('csv_imported', { rows: result.inserted, platform: result.platform || 'Unknown' })
      gtmTrack('csv_upload_success', { platform: result.platform || 'unknown', row_count: result.inserted })

      // Skipped rows are already-saved duplicates (e.g. a re-upload after an
      // interrupted import), not lost data — say so plainly (#669).
      const msg = result.skipped > 0
        ? `✅ All ${result.inserted + result.skipped} tips imported (${result.skipped} were already saved from an earlier upload)`
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

      // Google Ads — CSV Upload conversion
      try {
        if (typeof window.gtag !== 'undefined') {
          window.gtag('event', 'conversion', {
            'send_to': 'AW-18107430539/5qolCPeRnLMcEIvtpbpD',
            'value': 0.0,
            'currency': 'USD'
          })
        }
      } catch(e) {}

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
    // Clear the cached tip list and force a refetch, exactly as deleteAllTips
    // does. Without this the deleted row is served back from sessionStorage on
    // the next load, so the tip reappears after a refresh.
    try { const { error } = await supabase.from("tips").delete().eq("id", tipId); if (error) throw error; showToast("✅ Tip deleted"); try { sessionStorage.removeItem(`camcash_tips_${user.id}`) } catch(e) {}; await loadData(user.id, true, { silent: true }) }
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
  const preTipBehavior = analytics?.preTipBehavior || null
  const trueHourlyAvg  = analytics?.trueHourlyAvg  || []
  const alerts = liveAnalytics?.whaleAlerts || analytics?.whaleAlerts || []
  const lossAlerts = liveAnalytics?.lossAlerts || analytics?.lossAlerts || []
  const nextMoves = liveAnalytics?.nextMoves || analytics?.nextMoves || []
  // Total Earned = public tip earnings + private earnings (lib/sessions/normalize.js).
  // Free tier: private earnings use the same per-platform window as the tips.
  // One gated dataset for everything that shows history (header total,
  // Sessions): same windows as the analytics engine, applied to every table.
  // (memoOn, not useMemo: this runs after the `if (loading) return` above.)
  const accessible = memoOn(derivedCacheRef.current, 'accessible',
    [tips, paidSessions, livePrivateIntervals, recentShows.shows, isPro, freeUnlimitedPlatform],
    () => accessibleDataset({
      tips, paidSessions, liveIntervals: livePrivateIntervals, shows: recentShows.shows,
      isPro, unlimitedPlatform: freeUnlimitedPlatform,
    }))
  const earned = totalEarned({
    publicUSD: analytics?.totalUSD || 0,
    privateRows: privateEarningRows({ paidSessions: accessible.paidSessions, liveIntervals: accessible.liveIntervals }),
  })
  const totalRevenue = analytics?.totalUSD || 0 // public tips only (shares, per-session averages)
  const totalEarnedUSD = earned.totalUSD        // header / share card: public + private
  // Store data in window object for debugging
  if (typeof window !== 'undefined') {
    window.__dashboardDebug = {
      analytics_totalUSD: analytics?.totalUSD,
      totalRevenue,
      allTipsCount: tips?.length,
      analyticsKeys: analytics ? Object.keys(analytics) : [],
      timestamp: new Date().toISOString()
    }
  }
  // Estimated $/Hour — imported CSVs only carry tip timestamps, never real stream
  // start/end times, so this is inferred from the gap between a session's first
  // and last recorded tip. analytics.estimatedHourlyRate is the single source of
  // truth (lib/analytics.js) — a weighted total across hourly-rate-eligible
  // sessions only (valid sessions — >=30 min AND >=2 tips — with a known
  // duration and revenue). Both the
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
  // Platform $/hr, single source of truth — taken straight from the engine,
  // which builds every hourly rate from one set of eligible sessions. Never
  // substitute a locally computed rate when the engine reports none: a platform
  // can have streamed hours without any session whose duration is reliable
  // enough to divide by, and dividing its full revenue by those hours produces
  // a rate far above the one shown everywhere else. No rate is correct there.
  const platformRoiMap = {}
  ;(analytics?.platforms || []).forEach(p => {
    if (platformVelocity[p.platform] !== undefined) {
      platformRoiMap[p.platform] = platformVelocity[p.platform]
    } else if (p.hours && p.hours > 0) {
      // Calculate ROI locally: total revenue / total hours streamed
      platformRoiMap[p.platform] = (p.totalUSD || 0) / p.hours
    } else {
      platformRoiMap[p.platform] = null
    }
  })
  const missedRevenueByPlat   = analytics?.missedRevenueByPlatform || {}
  const returningVsNew        = analytics?.returningVsNew        || null
  const topFanDependency      = analytics?.topFanDependency      || null

  // Build platformTimes from INDIVIDUAL TIPS (not session start time)
  // so hour/day reflects when money actually came in, not when the session started
  // Use UTC to match the database timestamps
  const UTC_DAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const platformTimes = memoOn(derivedCacheRef.current, 'platformTimes', [tips], () => {
    const pt = {}
    tips.forEach(t => {
      if (!pt[t.platform]) pt[t.platform] = { hours: {}, days: {} }
      const dt = new Date(t.date_time || t.dateRaw)
      const hour = dt.getUTCHours()
      const day = UTC_DAYS_LONG[dt.getUTCDay()]
      pt[t.platform].hours[hour] = (pt[t.platform].hours[hour] || 0) + (t.usd || 0)
      pt[t.platform].days[day]   = (pt[t.platform].days[day]   || 0) + (t.usd || 0)
    })
    return pt
  })

  const filteredWhales = memoOn(derivedCacheRef.current, 'filteredWhales', [whales, whaleFilter, platformFilter, chartDrillDay, tips, riskOnly, isPro], () => whales.filter(w => {
    if (whaleFilter !== "ALL" && w.tier !== whaleFilter) return false
    if (riskOnly && isPro && !isTopSpenderAtRisk(w)) return false
    if (platformFilter !== "ALL" && w.platform !== platformFilter) return false
    if (chartDrillDay) {
      const fanTips = (w.tips && w.tips.length > 0) ? w.tips : tips.filter(t => t.username?.toLowerCase() === w.username?.toLowerCase())
      const tippedOnDay = fanTips.some(t => {
        const dayShort = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][zonedDay(t.date_time || t.dateRaw, creatorTz)]
        return dayShort === chartDrillDay
      })
      if (!tippedOnDay) return false
    }
    return true
  }))

  const allPlatforms = memoOn(derivedCacheRef.current, 'allPlatforms', [tips], () => [...new Set(tips.map(t => t.platform))])
  const freePlatformLimitReached = !isPro && allPlatforms.length > 0

  // ── Build "What's Next" alerts — smarter, personalized, prioritized
  const buildWhatsNextAlerts = () => {
    const now = Date.now()
    const strikeHot = []
    const winBack = []
    const milestone = []
    const onlineNow = []
    const dormant = []
    const performance = []

    // Helper: get personalized re-engage message based on fan behavior
    const getPersonalMsg = (w) => {
      const name = w.username
      if (w.hasPrivates && w.privateCount >= 2)
        return `Hey ${name}! Been thinking about doing more privates lately 👀 You always make them so fun 💕`
      if (w.tipCount >= 20 && w.avgTipSize < 5)
        return `Hey ${name}! I always love seeing your name pop up in chat 💕 Going live soon — come say hi!`
      if (w.avgTipSize >= 20)
        return `Hey ${name}! I was literally just thinking about that amazing tip you sent 🥺 Going live tonight 🔥`
      return `Hey ${name}! I've been thinking about you lately 💕 I'm going live soon and would love to see you there 🔥`
    }

    // 1. STRIKE WHILE HOT — tipped in last 24h AND high tip probability
    whales.forEach(w => {
      const hrs = (now - new Date(w.lastTipDate)) / 3600000
      if (hrs <= 24 && w.tipProbability?.level === 'High') {
        strikeHot.push({
          type: 'strike_hot', icon: '🔥', color: C.orange, severity: 'success',
          title: `Strike while ${w.username} is hot`,
          message: `They tipped in the last 24 hours and their tip probability is high — go live NOW while they're warm`,
          cta: 'Copy Message', username: w.username, whale: w,
          reengageMsg: getPersonalMsg(w)
        })
      }
    })

    // 2. WIN BACK — $50+ lifetime AND a canonical, baseline-gated "At Risk"
    // behavioral state (lib/analytics.js calcFanBehavioralState). A fan
    // with only one visit has no established personal cadence, so an
    // independent day-range can't tell us their absence is abnormal --
    // only the canonical behavioralState may make that call.
    whales.filter(w => w.totalUSD >= 50 && w.behavioralState === 'At Risk').forEach(w => {
      const days = Math.floor((now - new Date(w.lastTipDate)) / 86400000)
      const name = w.username
      winBack.push({
        type: 'win_back', icon: '💔', color: C.pink, severity: 'warning',
        title: `Win back ${name} — $${w.totalUSD.toFixed(0)} lifetime fan`,
        message: `They spent $${w.totalUSD.toFixed(0)} total but haven't tipped in ${days} days. A personal message could bring them back.`,
        cta: 'Copy Message', username: name, whale: w,
        reengageMsg: `Hey ${name}! I miss you — it's been a while and I just wanted to check in 💕 I'm going live tonight and it would mean a lot to see you there`
      })
    })

    // 3. MILESTONE — within 10% of $50 / $100 / $200 / $500
    // Exclude fans gone > 90 days: they belong in At Risk, not Close to Milestone
    const milestones = [50, 100, 200, 500]
    whales.forEach(w => {
      const daysSinceMilestone = Math.floor((now - new Date(w.lastTipDate)) / 86400000)
      if (daysSinceMilestone > 90) return
      for (const m of milestones) {
        const remaining = m - w.totalUSD
        if (remaining > 0 && remaining <= m * 0.10) {
          milestone.push({
            type: 'milestone', icon: '💰', color: C.gold, severity: 'info',
            title: `${w.username} is $${remaining.toFixed(0)} away from $${m}`,
            message: `They've spent $${w.totalUSD.toFixed(0)} lifetime — a little encouragement could push them to the $${m} milestone`,
            cta: 'Copy Message', username: w.username, whale: w,
            reengageMsg: getPersonalMsg(w)
          })
          break
        }
      }
    })

    // 4. ONLINE NOW / ONLINE SOON — removed. This previously computed its
    // own hour-of-day "usually tips around X" pattern and probability
    // percentage from raw tip timestamps, gated only on raw tipCount >= 5.
    // Raw tips within one behavioral visit (observationCount) can all land
    // minutes apart, which can fabricate an hourly pattern from a single
    // visit. No canonical field in lib/analytics.js currently supports an
    // "expected time of day" claim, so no such behavioral action is
    // rendered here rather than inventing a new formula for it.

    // 5. DORMANT — $20+ lifetime AND a canonical, baseline-gated 'Watch'
    // behavioral state (lib/analytics.js calcFanBehavioralState). A fan
    // with fewer than 3 behavioral visits has no established personal
    // cadence, so an independent day-range can't tell us their absence is
    // unusual -- only the canonical behavioralState may make that call.
    // 'Watch' (not the canonical 'Dormant' state) is the correct match:
    // canonical 'Dormant' means the CREATOR hasn't streamed enough to
    // attribute the fan's absence to the fan at all, whereas 'Watch' means
    // this specific fan has a real, baseline-backed deviation from their
    // own pattern that isn't yet severe enough to be 'At Risk' -- which is
    // exactly the softer "check in on them" tone this action uses.
    whales.filter(w => w.totalUSD >= 20 && w.behavioralState === 'Watch').slice(0, 3).forEach(w => {
      const days = Math.floor((now - new Date(w.lastTipDate)) / 86400000)
      const timeStr = days >= 30 ? `${Math.round(days / 30)} month${days >= 60 ? 's' : ''}` : `${days} days`
      dormant.push({
        type: 'dormant', icon: '💤', color: C.orange, severity: 'warning',
        title: `You haven't heard from ${w.username} in ${timeStr}`,
        message: `They've spent $${w.totalUSD.toFixed(0)} total — send them a message so they know you're thinking of them`,
        cta: 'Copy Message', username: w.username, whale: w,
        reengageMsg: getPersonalMsg(w)
      })
    })


    // Social mention alerts (keep, they're genuinely useful)
    const socialAlerts = []
    const SOCIAL_KEYWORDS = {
      snapchat: /snap\s?chat|snapchat|snap/i,
      instagram: /instagram|insta|ig\b/i,
      twitter: /twitter|x\.com|\bx\b/i,
      onlyfans: /onlyfans|only fans|of\b/i,
    }
    whales.forEach(w => {
      if (!w.tipNotes || w.tipNotes.length === 0) return
      Object.entries(SOCIAL_KEYWORDS).forEach(([platform, regex]) => {
        const matchingNote = w.tipNotes.find(n => regex.test(n))
        if (matchingNote) {
          const usernameMatch = matchingNote.match(/@[\w.]+|(?:my|is|:)\s*([\w.@]+)/i)
          const extractedUser = usernameMatch ? usernameMatch[1] || usernameMatch[0] : null
          socialAlerts.push({
            type: 'social_mention', icon: '📱', color: C.cyan, severity: 'info',
            title: `${w.username} mentioned ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
            message: extractedUser
              ? `They left their ${platform} as "${extractedUser}" in a tip note — add them before you forget!`
              : `They mentioned ${platform} in a tip note — ask them for their handle next time`,
            cta: 'Copy Message', username: w.username, whale: w,
            reengageMsg: getPersonalMsg(w)
          })
        }
      })
    })

    // Merge in priority order, cap at 6
    return [
      ...strikeHot,
      ...winBack,
      ...milestone,
      ...onlineNow,
      ...dormant,
      ...performance,
      ...socialAlerts,
    ].slice(0, 6)
  }

  // ── Build re-engage list outside JSX for the same reason
  // Eligibility comes from the canonical, evidence-gated behavioralState
  // (lib/analytics.js calcFanBehavioralState) -- NOT an independent
  // days-since-last-tip + minimum-spend filter. That standalone filter
  // could flag a fan with a single tip as "at risk" purely from elapsed
  // time, bypassing the per-fan baseline/eligibility/evidence checks the
  // canonical function requires. This list is a display ordering over
  // fans already determined to be At Risk elsewhere, not a second
  // determination of who counts as at risk.
  const buildReengageList = () => {
    const messageSets = [
      (name) => `Hey ${name}! I've been thinking about you lately 💕 I'm going live tonight and would love to see your name in the chat 🔥`,
      (name) => `${name}! It's been a minute and honestly I miss you 😊 Jumping on soon — come say hi? 💋`,
      (name) => `Hey love 💕 Just wanted to reach out because I was literally just thinking about you. Going live tonight — hope to see you there!`,
    ]
    return whales
      .filter(w => w.behavioralState === 'At Risk')
      .sort((a, b) => b.totalUSD - a.totalUSD)
      .slice(0, 5)
      .map((w, i) => {
        const days = w.daysSinceLastTip ?? Math.floor((Date.now() - new Date(w.lastTipDate)) / 86400000)
        return {
          whale: w,
          days,
          urgency: days > 30 ? C.red : days > 14 ? C.orange : C.gold,
          msg: messageSets[i % messageSets.length](w.username)
        }
      })
  }

  // ============================================================
  // REAL-TIME INTELLIGENCE COMPUTED FROM ACTUAL DB DATA
  // ============================================================

  const buildDailyBrief = () => {
    if (!tips || tips.length === 0 || !analytics) return null
    const now = new Date()
    const utcHour = zonedHour(now, creatorTz) // creator-local hour — analytics hours are in creatorTz too
    const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const todayName = DAYS[zonedDay(now, creatorTz)] // creator-local day of week

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
    const bestHour = analytics?.bestHour
    const _bhRaw = todayBestHourNum !== null ? todayBestHourNum : (bestHour ? parseInt(bestHour.hour) : null)
    const bh = (_bhRaw !== null && !isNaN(_bhRaw)) ? _bhRaw : null
    const bhLabel = bh === null ? null : fmtHour(bh)
    const hoursUntilPeak = bh !== null ? (bh - utcHour + 24) % 24 : null
    const atPeak = hoursUntilPeak === 0 || hoursUntilPeak === 1

    // BEST PLATFORM: highest revenue across ALL tips in the engine's dataset —
    // read from analytics.platforms (same plan-gated tips and platform keys as
    // every other platform figure), never re-summed from raw history here.
    const topEarningPlat = [...(analytics?.platforms || [])].sort((a, b) => (b.totalUSD || 0) - (a.totalUSD || 0))[0]?.platform || null
    const displayPlat = topEarningPlat

    // Peak hour average for this platform (for context/forecast only)
    // Do NOT use hour-bucket calculations for session averages — these aren't actual sessions
    let peakHourAvgForPlatform = bestHour?.avg || 0
    if (bh !== null && analytics?.platformBestTimes?.[displayPlat]) {
      const platTimes = analytics.platformBestTimes[displayPlat]
      const peakHourEntry = platTimes.allHours?.find(h => h.hour === bh)
      if (peakHourEntry?.avg) {
        peakHourAvgForPlatform = peakHourEntry.avg
      }
    }
    const displayAvg = peakHourAvgForPlatform

    // Best day
    const bestDay = analytics?.bestDay
    const isBestDay = bestDay?.day === todayName
    const sessionAvg = analytics?.sessions?.length
      ? analytics.sessions.reduce((s, x) => s + x.totalUSD, 0) / analytics.sessions.length : 0

    // Income prediction for peak window
    // Use bestHour?.avg (median-based from analytics) as canonical metric
    // This is calculated from ALL tips and represents typical earnings at that hour
    const sessionsAtPeak = (analytics?.sessions || []).filter(s => {
      const h = zonedHour(s.startTime, creatorTz) // creator-local hour
      return bh !== null && Math.abs(h - bh) <= 1
    })
    // Use displayAvg (which is now consistently the peak hour value) for prediction
    const predictionLow = displayAvg > 0 ? Math.max(0, Math.round(displayAvg - (displayAvg * 0.4))) : 0
    const predictionHigh = displayAvg > 0 ? Math.round(displayAvg + (displayAvg * 0.4)) : 0
    // Fallback to sessionAvg only if no best hour data exists
    const peakAvg = displayAvg > 0 ? displayAvg : (sessionAvg || 0)

    // Re-engage list — fans who tip 50+ tokens avg per session, appear in 2+ streams, and are overdue
    // "Every 2-3 streams" = session-level frequency, not tip count
    const reengageFans = (whales || [])
      .filter(w => {
        if (!w.tips || w.tips.length < 2) return false

        // Group this fan's tips into sessions (shared SESSION_GAP_MS = new session)
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
        w.tips.forEach(t => { const h = zonedHour(t.date_time || t.dateRaw, creatorTz); hc[h] = (hc[h] || 0) + 1 })
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
    // Creator-local, matching the analytics hours these alerts compare against
    // (previously getUTCHours(), which misfired for anyone outside UTC).
    const alertCurrentHour = zonedHour(new Date(), creatorTz)
    const currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: creatorTz })
    const alerts = []

    // --- PLATFORM DAY-OF-WEEK PERFORMANCE ---
    // Creator-local day (same clock as currentDay above)
    const UTC_DAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const platDayMap = {}
    tips.forEach(t => {
      const p = t.platform
      const d = new Date(t.date_time || t.dateRaw)
      const day = UTC_DAYS_LONG[zonedDay(d, creatorTz)]
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
    // Hours are bucketed on the creator's clock (same clock as "now" below).
    const platHourUSD = {}; const platHourSessions = {}
    tips.forEach(t => {
      const p = t.platform
      const d = new Date(t.date_time || t.dateRaw)
      // Floor to UTC hour-bucket key for deduplication
      const bucketKey = Math.floor(d.getTime() / 3600000)
      const h = zonedHour(d, creatorTz)
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
    // Creator-local current hour, matching the buckets above
    const currentUTCHour = zonedHour(new Date(), creatorTz)
    if (platNames.length >= 2) {
      platNames.forEach(plat => {
        const hourVal = platHourAvg[plat][currentUTCHour] || 0
        const otherPlats = platNames.filter(p => p !== plat)
        otherPlats.forEach(other => {
          const otherVal = platHourAvg[other][currentUTCHour] || 0
          if (hourVal > 0 && otherVal > 0 && hourVal >= otherVal * 1.5) {
            const mult = (hourVal / otherVal).toFixed(1)
            const label = (() => { const _lh=currentUTCHour; return _lh===0?'12 AM':_lh<12?`${_lh} AM`:_lh===12?'12 PM':`${_lh-12} PM` })() // already creator-local
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
      const fanTips = (w.tips && w.tips.length > 0)
        ? w.tips
        : tips.filter(t => t.username.toLowerCase() === w.username.toLowerCase())
      if (fanTips.length < 3) return

      // Use local hours — tips' date_time is UTC but getHours() converts to browser local
      const hourCounts = {}
      fanTips.forEach(t => {
        const h = zonedHour(t.date_time || t.dateRaw, creatorTz) // creator-local hour
        hourCounts[h] = (hourCounts[h] || 0) + 1
      })
      const sortedHours = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])
      if (!sortedHours.length) return

      const peakHour = parseInt(sortedHours[0][0]) // already local
      const hoursAway = (peakHour - zonedHour(new Date(), creatorTz) + 24) % 24
      const _pf1 = sortedHours[0][1] / fanTips.length
      const _pd1 = hoursAway === 0 ? 1.0 : hoursAway === 1 ? 0.65 : 0.35
      const confidence = Math.min(90, Math.max(25, Math.round(_pf1 * 200 * _pd1)))
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
          message: `Your top whale peaks at ${label} with ${confidence}% confidence. Prep your stream on ${w.platform} — they've spent $${w.totalUSD.toFixed(0)} with you.`
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

  const whatsNextAlerts = memoOn(derivedCacheRef.current, 'whatsNextAlerts', [whales, tips], buildWhatsNextAlerts)
  const reengageList = memoOn(derivedCacheRef.current, 'reengageList', [whales], buildReengageList)
  // re-runs every minuteTick (as well as when the underlying data changes)
  const dailyBrief = memoOn(derivedCacheRef.current, 'dailyBrief', [tips, analytics, whales, minuteTick], buildDailyBrief)

  // ── CANONICAL PEAK HOUR ──────────────────────────────────────────────────────
  // Single source of truth used by the header, Daily Brief, and Losing Money.
  // Prefer engineInsights daily_plan (most specific), then today's analytics best
  // hour from dailyBrief, then the all-time analytics best hour as final fallback.
  // All three sources are already user-local hours: get_user_insights is called
  // with p_timezone above, so daily_plan.best_hour comes back local (not UTC);
  // dailyBrief.bh and analytics.bestHour.hour were already local via toLocalHour().
  const canonicalPeakHourLocal = (
    engineInsights?.daily_plan?.best_hour ??
    dailyBrief?.bh ??
    (analytics?.bestHour ? parseInt(analytics.bestHour.hour) : null)
  )
  const canonicalPeakLabel = canonicalPeakHourLocal != null
    ? (() => { const _lh = ((canonicalPeakHourLocal % 24) + 24) % 24; return _lh===0?'12 AM':_lh<12?`${_lh} AM`:_lh===12?'12 PM':`${_lh-12} PM` })()
    : null

  // re-runs every minuteTick (as well as when the underlying data changes)
  const realTimeAlerts = memoOn(derivedCacheRef.current, 'realTimeAlerts', [tips, whales, minuteTick], buildRealTimeAlerts)
  void minuteTick // ensures re-render when minute changes

  // ── MONTH-OVER-MONTH ── this vs previous calendar month on the creator's
  // clock, read from the engine's monthlyData (creator-local months, same
  // plan-gated tips as every other figure). No local re-aggregation.
  const _momThisKey = zonedMonthKey(new Date(), creatorTz)
  const _momPrevKey = (() => {
    const [y, m] = _momThisKey.split('-').map(Number)
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  })()
  const _momUsdByMonth = Object.fromEntries((analytics?.monthlyData || []).map(m => [m.month, m.usd || 0]))
  const momThisMonthUSD = _momUsdByMonth[_momThisKey] || 0
  const momPrevMonthUSD = _momUsdByMonth[_momPrevKey] || 0

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
      totalFans:     analytics?.uniqueFanCount || [...new Set(tips.map(t => (t.username || '').toLowerCase()).filter(Boolean))].length,
      totalEarnings: analytics?.totalUSD || 0,
      dateRangeDays: drRangeDays,
      streamDays:    drStreamDays,
    })
    const isLowData  = readiness !== 'ready'
    const modLockArgs = { totalTips: tips.length, totalSessions: analytics?.meaningfulSessionCount || 0, totalFans: analytics?.uniqueFanCount || 0, totalEarnings: analytics?.totalUSD || 0, totalStreamMinutes: analytics?.totalStreamMinutes || 0, importedPlatformCount: drPlatCount, isPro, liveModeSessions: 0 }
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
        @keyframes riskPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(1.35); } }
        .risk-pulse-dot { animation: riskPulse 1.6s ease-in-out infinite; }
        .risk-toggle:hover { transform: translateY(-1px); }
        @media (prefers-reduced-motion: reduce) { .risk-pulse-dot { animation: none; } }
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
      <Sidebar activeTab={activeTab} onTabChange={(tab) => { setActiveTab(tab); if (typeof window !== "undefined") { localStorage.setItem("camcash_tab", tab); window.scrollTo({ top: 0, behavior: "instant" }); } }} user={user} onSignOut={async () => { await supabase.auth.signOut(); router.replace("/login"); }} isPro={isPro} creatorTz={creatorTz} onChangeTimezone={changeCreatorTimezone} />{/* MAIN CONTENT */}
      <div className="dash-main" style={{ marginLeft: 240, width: "calc(100% - 240px)", minWidth: 0, padding: 32, boxSizing: "border-box", overflowX: "hidden" }}>

        {/* ── STICKY COMMAND BAR — shown on every tab (Go Live must stay
             reachable everywhere, not just Command Center) ── */}
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
          const localNow = zonedHour(new Date(), creatorTz)
          const hoursUntilLocal = canonicalPeakHourLocal != null ? (canonicalPeakHourLocal - localNow + 24) % 24 : brief?.hoursUntilPeak
          const peakLabel = hoursUntilLocal === 0 ? 'NOW' : hoursUntilLocal === 1 ? 'in 1 hr' : (hoursUntilLocal > 0 && !isNaN(hoursUntilLocal)) ? `in ${hoursUntilLocal}h` : null
          const _eiPeakLabel = canonicalPeakLabel || brief?.bhLabel
          const bestPlat = brief?.displayPlat || (tips.length > 0 ? tips[0]?.platform : null)
          const safeRevenue = (!isNaN(totalEarnedUSD) && isFinite(totalEarnedUSD)) ? totalEarnedUSD : 0
          return (
            <div className="sticky-command-bar" style={{ position: 'sticky', top: 0, zIndex: 20, marginBottom: 12, marginLeft: -32, marginRight: -32, width: 'calc(100% + 64px)', maxWidth: 'none', padding: '0 32px', background: 'rgba(5,7,15,0.86)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderBottom: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 2px 20px rgba(0,0,0,0.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', height: 48, gap: 8 }}>
                {/* Metrics scroll independently so Go Live — outside this container — never gets clipped or scrolled out of view on narrower desktop widths */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', flex: '1 1 auto', minWidth: 0 }}>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', paddingRight:20, borderRight:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
                  <div style={{ fontSize:10, color:'#8a93ab', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600, marginBottom:2 }}>Total Earned</div>
                  <div style={{ fontSize:18, fontWeight:900, background:'linear-gradient(135deg,#60a5fa,#f472b6)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', whiteSpace:'nowrap' }}>${safeRevenue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', padding:'0 20px', borderRight:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
                  <div title={HOURLY_RATE_TOOLTIP} style={{ fontSize:10, color:'#8a93ab', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600, marginBottom:2, cursor:'help' }}>Estimated $/Hour</div>
                  {hourlyRateUnlocked ? (
                    <div title={hourlyRateSubtext} style={{ fontSize:18, fontWeight:900, color:'#22D3EE', whiteSpace:'nowrap', cursor:'help' }}>${safeAvg.toFixed(2)}</div>
                  ) : (
                    <div onClick={() => handleTabChange('upload')} title={hourlyRateSubtext} style={{ fontSize:13, fontWeight:700, color:'#7d8aa3', whiteSpace:'nowrap', cursor:'pointer' }}>🔒 Locked</div>
                  )}
                </div>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', padding:'0 20px', borderRight:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
                  <div style={{ fontSize:10, color:'#8a93ab', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600, marginBottom:2 }}>Momentum</div>
                  <div style={{ fontSize:13, fontWeight:800, color:momentumColor, whiteSpace:'nowrap', animation: atPeak ? 'cmd-pulse 1.5s infinite' : 'none' }}>{momentum}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', padding:'0 20px', borderRight:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
                  <div style={{ fontSize:10, color:'#8a93ab', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600, marginBottom:2 }}>Best Platform</div>
                  <div style={{ fontSize:13, fontWeight:800, color:'#a78bfa', whiteSpace:'nowrap' }}>{bestPlat || '—'}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', padding:'0 20px', flexShrink:0 }}>
                  <div style={{ fontSize:10, color:'#8a93ab', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600, marginBottom:2 }}>Peak Window</div>
                  <div style={{ fontSize:13, fontWeight:800, color: atPeak ? '#10B981' : '#fbbf24', whiteSpace:'nowrap' }}>{_eiPeakLabel ? `${_eiPeakLabel}${peakLabel ? ` · ${peakLabel}` : ''}` : '—'}</div>
                </div>
                </div>
                <div style={{ paddingLeft:12, borderLeft:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', gap:8 }}>
                  <button onClick={() => { setActiveTab('live'); if (typeof window !== 'undefined') { localStorage.setItem('camcash_tab','live'); window.scrollTo({top:0,behavior:'instant'}); } }} style={{ padding:'8px 20px', borderRadius:11, background:'linear-gradient(135deg,#10B981,#22D3EE)', border:'none', color:'#fff', fontWeight:800, fontSize:13, cursor:'pointer', whiteSpace:'nowrap', boxShadow:'0 0 14px rgba(16,185,129,0.3)', letterSpacing:0.3 }}>
                    ⚡ Go Live
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── LIVE STATUS BAR ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 6px #10B981", animation: "pulse-msg 2s infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#10B981" }}>LIVE</span>
          </div>
          {isRefreshing && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#94A3B8" }}>
              <div style={{ width: 12, height: 12, border: "1.5px solid rgba(34,211,238,0.3)", borderTopColor: "#22D3EE", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              Refreshing...
            </div>
          )}
          {lastRefreshed && !isRefreshing && (
            <span key={lastRefreshed.getTime()} className="recently-updated" style={{ fontSize: 11, color: "#7d8aa3", padding: "2px 6px", borderRadius: 4 }}>
              Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {newTipCount > 0 && (
            <div style={{ padding: "3px 10px", borderRadius: 20, background: "rgba(236,72,153,0.15)", border: "1px solid rgba(236,72,153,0.35)", fontSize: 11, fontWeight: 700, color: "#EC4899", animation: "alertEnter 0.3s ease forwards" }}>
              +<span key={newTipCount} className={counterBumping ? "counter-bump" : ""}>{newTipCount}</span> new tip{newTipCount > 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Persistent warning + Retry whenever the history on screen is incomplete or stale (issue #747). */}
        <LoadWarningBanner issues={loadIssues} onRetry={() => user && loadData(user.id, true, { silent: true })} retrying={isRefreshing} />

        {/* ── DASHBOARD PROGRESS CARD — Command Center only, so it doesn't
             compete with tab-specific content (e.g. the Fans tab) ── */}
        {_isLowData && activeTab === 'overview' && (
          <DashboardProgressCard
            totalTips={tips.length}
            totalSessions={analytics?.meaningfulSessionCount || 0}
            totalFans={analytics?.uniqueFanCount || 0}
            totalEarnings={analytics?.totalUSD || 0}
            readiness={dashboardReadiness}
            onImport={() => handleTabChange('upload')}
          />
        )}

        {(activeTab === "overview" || activeTab === "sessions") && (
          <PrimaryPlatformBanner isPro={isPro} primary={freeUnlimitedPlatform}
            onSaved={(d) => setProfile(prev => ({ ...(prev || {}), ...d }))} />
        )}
        {activeTab === "overview" && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            {recentShows.delta && (
              <div style={{ marginBottom: 16 }}>
                <LatestShowDelta
                  delta={recentShows.delta}
                  onDismiss={() => recentShows.acknowledge([recentShows.delta.sessionId])}
                />
              </div>
            )}


            {/* ═══════════════════════════════════════
                1. MONEY SNAPSHOT
            ═══════════════════════════════════════ */}
            {(() => {
              // ── empty state — show null; DashboardProgressCard above covers zero-data ──
              if (tips.length === 0) return null

              const thisMonthRev = momThisMonthUSD
              const prevMonthRev = momPrevMonthUSD
              const growthPct = (prevMonthRev > 0 && thisMonthRev > 0) ? Math.round(((thisMonthRev - prevMonthRev) / prevMonthRev) * 100) : null
              const safeThisMonthRev = (!isNaN(thisMonthRev) && isFinite(thisMonthRev)) ? thisMonthRev : 0
              // First-party comparison only (the creator's own previous month).
              // CamCash has no cross-creator dataset, so no ranking is ever shown.
              const prevMonthLine = (isFinite(prevMonthRev) && prevMonthRev > 0)
                ? `vs $${prevMonthRev.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} last month`
                : null
              const sessionsLast30 = sessions.filter(s => (Date.now() - new Date(s.startTime)) / 86400000 <= 30).length
              const fansActiveLast30 = new Set(tips.filter(t => (Date.now() - new Date(t.date_time || t.dateRaw)) / 86400000 <= 30).map(t => t.username)).size

              // ── Per-card month-over-month trend ──
              // Meaningful sessions only (analytics.meaningfulSessions), matching the
              // valid-session rule used everywhere else — never the raw session list.
              const meaningfulSessions = analytics?.meaningfulSessions || []
              // Creator-local month of a timestamp; null for unparseable dates (skipped, never thrown).
              const _monthOf = (v) => { if (v == null) return null; const d = new Date(v); return isNaN(d) ? null : zonedMonthKey(d, creatorTz) }
              const thisMonthMeaningful = meaningfulSessions.filter(s => _monthOf(s.startTime) === _momThisKey)
              const prevMonthMeaningful = meaningfulSessions.filter(s => _monthOf(s.startTime) === _momPrevKey)
              const sessGrowth = (prevMonthMeaningful.length > 0 && thisMonthMeaningful.length > 0)
                ? Math.round(((thisMonthMeaningful.length - prevMonthMeaningful.length) / prevMonthMeaningful.length) * 100) : null

              const avgSessionUSD = meaningfulSessions.length ? meaningfulSessions.reduce((s,x) => s+(x.totalUSD||0),0) / meaningfulSessions.length : 0
              const tmAvgSession = thisMonthMeaningful.length ? thisMonthMeaningful.reduce((s,x) => s+(x.totalUSD||0),0) / thisMonthMeaningful.length : null
              const pmAvgSession = prevMonthMeaningful.length ? prevMonthMeaningful.reduce((s,x) => s+(x.totalUSD||0),0) / prevMonthMeaningful.length : null
              const avgSessionGrowth = (tmAvgSession !== null && pmAvgSession !== null && pmAvgSession > 0)
                ? Math.round(((tmAvgSession - pmAvgSession) / pmAvgSession) * 100) : null

              const thisMonthFans = new Set(tips.filter(t => _monthOf(t.date_time || t.dateRaw) === _momThisKey).map(t => t.username)).size
              const prevMonthFans = new Set(tips.filter(t => _monthOf(t.date_time || t.dateRaw) === _momPrevKey).map(t => t.username)).size
              const fansGrowth = (prevMonthFans > 0 && thisMonthFans > 0) ? Math.round(((thisMonthFans - prevMonthFans) / prevMonthFans) * 100) : null

              // trend badge renderer
              const TrendBadge = ({ pct }) => {
                if (pct === null || isNaN(pct)) return null
                const up = pct >= 0
                return <span style={{ fontSize:10, fontWeight:700, color: up ? '#10B981' : '#f87171', marginLeft:6 }}>{up ? '↑' : '↓'}{Math.abs(pct)}%</span>
              }

              // Card row intentionally shows different metrics than the sticky command
              // bar above (which already covers Total Earned / Estimated $/Hour) —
              // these four add depth instead of repeating the same headline numbers.
              const cardDefs = [
                { label:"Earnings This Month", accent:'#f472b6', glowClass:'card-glow-pink', trend:growthPct,
                  value: `$${safeThisMonthRev.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`,
                  sub: prevMonthLine,
                  icon:'💰', isHero:true },
                { label:"Avg Per Session", accent:'#22d3ee', glowClass:'card-glow-cyan', trend:avgSessionGrowth,
                  value: meaningfulSessions.length > 0 ? `$${avgSessionUSD.toFixed(2)}` : '—',
                  sub: meaningfulSessions.length > 0 ? `Across ${meaningfulSessions.length.toLocaleString()} meaningful sessions` : 'Not enough data yet',
                  icon:'🎯' },
                { label:"Total Fans", accent:'#a78bfa', glowClass:'card-glow-violet', trend:fansGrowth,
                  value: whales.length > 0 ? whales.length.toLocaleString() : '—',
                  sub: fansActiveLast30 > 0 ? `${fansActiveLast30} active in last 30 days` : 'None active in the last 30 days',
                  icon:'👥' },
                { label:"Meaningful Sessions", accent:'#fbbf24', glowClass:'card-glow-gold', trend:sessGrowth,
                  value: meaningfulSessions.length > 0 ? meaningfulSessions.length.toLocaleString() : (sessions.length > 0 ? '0' : '—'),
                  sub: meaningfulSessions.length > 0
                    ? `${sessions.length.toLocaleString()} tracked · ${(analytics?.lowSignalSessionCount || 0).toLocaleString()} low-signal`
                    : (sessions.length > 0 ? `${sessions.length} detected, none meaningful yet` : (sessionsLast30 > 0 ? `${sessionsLast30} in last 30 days` : 'No sessions yet')),
                  icon:'🎥' }
              ]

              // Earnings velocity per platform for velocity strip
              const velPlatforms = Object.entries(platformVelocity).filter(([,v]) => v !== null).sort((a,b) => (b[1]||0)-(a[1]||0))
              return (
                <>
                  <div className="stat-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                    {cardDefs.map((s, i) => (
                      <div key={i} className={`stat-card ${s.glowClass}`} style={{ ...glassCard, borderRadius: 16, padding: "13px 16px", position: "relative", overflow: "hidden", animation: `fadeUp 0.3s ease ${i * 0.06}s both`, cursor:'default', display:'flex', flexDirection:'column' }}>
                        {/* accent top bar */}
                        <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${s.accent}80,${s.accent}20)`, borderRadius:'16px 16px 0 0' }} />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: C.text, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>{s.label}</span>
                          <span style={{ fontSize: 18, opacity: 0.75 }}>{s.icon}</span>
                        </div>
                        <div className={s.isHero ? 'hero-revenue-shimmer' : ''} style={{ fontSize: 'clamp(20px, 2.4vw, 26px)', fontWeight: 900, lineHeight: 1.1, marginBottom: 4, ...(s.isHero ? {} : { color: s.accent }) }}>
                          {s.value}<TrendBadge pct={s.trend} />
                        </div>
                        {s.sub && <div style={{ fontSize: 11.5, color: C.text, lineHeight: 1.35 }}>{s.sub}</div>}
                      </div>
                    ))}
                  </div>
                  {/* section divider */}
                  <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)', marginBottom:14 }} />
                </>
              )
            })()}

            {/* ═══════════════════════════════════════
                TOKENS VS HOURS ONLINE + MONTHLY GROWTH
            ═══════════════════════════════════════ */}
            {accessible.tips.length > 0 && <DashboardGrowthCharts tips={accessible.tips} sessions={sessions} tz={creatorTz} />}

            {/* ═══════════════════════════════════════
                YOUR NEXT BEST MOVE — Command Center
                Replaces Daily Brief with comprehensive strategic overview
            ═══════════════════════════════════════ */}
            <CommandCenter
              tz={creatorTz}
              analytics={analytics}
              isPro={isPro}
              firstName={profile?.display_name || null}
              nowActions={(() => {
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
                  const localHour = gl.current_hour ?? zonedHour(new Date(), creatorTz)
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
              onPlanStream={() => handleTabChange('planner')}
              onViewFans={() => handleTabChange('whales')}
              onSeePerformance={() => handleTabChange('platforms')}
              onUpgrade={(src) => openUpgradeModal(src)}
            />

            {/* ═══════════════════════════════════════
                PRO TEASER CARDS — Soft paywall signals for free users
            ═══════════════════════════════════════ */}
            {proTeasers.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                  {proTeasers.map((teaser, i) => (
                    <div
                      key={teaser.id}
                      style={{
                        ...glassCard,
                        borderRadius: 16,
                        padding: 18,
                        border: '1px solid rgba(236,72,153,0.4)',
                        background: 'linear-gradient(135deg, rgba(236,72,153,0.1), rgba(124,92,255,0.08))',
                        animation: `fadeUp 0.3s ease ${i * 0.08}s both`,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'rgba(236,72,153,0.6)'
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(236,72,153,0.15), rgba(124,92,255,0.12))'
                        e.currentTarget.style.transform = 'translateY(-2px)'
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(236,72,153,0.2)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'rgba(236,72,153,0.4)'
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(236,72,153,0.1), rgba(124,92,255,0.08))'
                        e.currentTarget.style.transform = ''
                        e.currentTarget.style.boxShadow = ''
                      }}
                      onClick={() => handleTabChange(teaser.tab)}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ fontSize: 24 }}>🔑</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.pink, textTransform: 'uppercase', letterSpacing: 0.5 }}>Upgrade to unlock</div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: C.white, marginBottom: 8 }}>{teaser.title}</div>
                      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 12 }}>{teaser.description}</div>
                      <div style={{ padding: 10, borderRadius: 9, background: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.25)', marginBottom: 12 }}>
                        <div style={{ fontSize: 12, color: C.pink, fontWeight: 600 }}>{teaser.requirement}</div>
                      </div>
                      <button
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: 'linear-gradient(135deg, #EC4899, #BE185D)',
                          border: 'none',
                          color: C.white,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'linear-gradient(135deg, #F472B6, #EC4899)'
                          e.currentTarget.style.transform = 'scale(1.02)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'linear-gradient(135deg, #EC4899, #BE185D)'
                          e.currentTarget.style.transform = ''
                        }}
                        onClick={(e) => { e.stopPropagation(); openUpgradeModal('pro_teaser_' + teaser.id) }}
                      >
                        {teaser.ctaLabel}
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)', margin:'24px 0' }} />
              </div>
            )}

            {/* ═══════════════════════════════════════
                3. WHAT'S WORKING — Strategy
                Platform performance + best time + best day merged
            ═══════════════════════════════════════ */}
            <div style={{ ...glassCard, borderRadius: 18, padding: 24, marginBottom: 28, animation: "fadeUp 0.3s ease 0.15s both" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#F59E0B,#10B981)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📊</div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.white }}>What's Working</div>
                    <div style={{ fontSize: 12, color: C.muted }}>Platform, time & session strategy from your data</div>
                  </div>
                </div>
              </div>

              {/* Platform ROI + Per-Platform Best Time (mandatory: always show platform context) */}
              {(() => {
                const fmtH = h => { if (h == null || isNaN(h)) return 'N/A'; const _lh=Math.round(((h%24)+24)%24); /* engine hours are already creator-local */ return _lh===0?'12 AM':_lh<12?`${_lh} AM`:_lh===12?'12 PM':`${_lh-12} PM` }
                const platColors = { Chaturbate: C.cyan, BongaCams: C.pink, MyFreeCams: C.gold }
                const allPlats = [...(analytics?.platforms || [])].sort((a,b) => b.totalUSD - a.totalUSD)
                if (!allPlats.length) return null
                return (
                  <div style={{ marginBottom: 18 }}>
                    {/* Platform ROI row: formula = total_earnings / total_hours */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Platform ROI ($/hr streamed)</div>
                    <div className="platform-roi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 18 }}>
                      {allPlats.map((p, i) => {
                        const roi = platformRoiMap[p.platform] ?? null
                        const bestTime = platformBestTimes[p.platform]
                        const col = platColors[p.platform] || C.blue
                        const isTop = i === 0
                        return (
                          <div key={i} style={{ padding: "14px 16px", borderRadius: 12, background: isTop ? `${col}12` : `${col}08`, border: `1px solid ${isTop ? col + '40' : col + '20'}`, transition: "transform 0.15s, box-shadow 0.15s", position: "relative" }}
                            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = `0 4px 16px ${col}20` }}
                            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "" }}>
                            {isTop && <div style={{ position: "absolute", top: 8, right: 8, fontSize: 9, padding: "2px 6px", borderRadius: 10, background: `${col}25`, color: col, fontWeight: 700 }}>TOP ROI</div>}
                            <div style={{ fontSize: 11, fontWeight: 700, color: col, marginBottom: 6 }}>{p.platform.replace('BongaCams','Bonga').replace('MyFreeCams','MFC')}</div>
                            <div style={{ fontSize: 22, fontWeight: 900, color: C.white, marginBottom: 2 }}>{roi !== null ? `$${(roi || 0).toFixed(2)}/hr` : '—'}</div>
                            <div style={{ fontSize: 11, color: C.muted, marginBottom: bestTime ? 8 : 0 }}>${(p.totalUSD || 0).toFixed(0)} total · {(p.hours || 0).toFixed(0)}h streamed</div>
                            {(() => {
                            const todayUTCName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][zonedDay(new Date(), creatorTz)] // creator-local day, matching engine bestHourByDay keys
                            const ptimes = analytics?.platformBestTimes?.[p.platform]
                            const todayHour = ptimes?.bestHourByDay?.[todayUTCName]
                            const bestDayEntry = ptimes?.bestDay
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                                {bestDayEntry && (
                                  <div style={{ padding: '5px 8px', borderRadius: 8, background: `${col}10`, border: `1px solid ${col}25`, fontSize: 11, color: col }}>
                                    Best day: <strong>{bestDayEntry.day}s</strong> ${(bestDayEntry.avg || 0).toFixed(0)} avg
                                  </div>
                                )}
                                {todayHour && (
                                  <div style={{ padding: '5px 8px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', fontSize: 11, color: '#10B981' }}>
                                    Today ({todayUTCName}): <strong>{fmtH(todayHour.hour)}</strong> ${(todayHour.avg || 0).toFixed(0)}/hr avg
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                          </div>
                        )
                      })}
                    </div>
                    {/* Best day — use the top per-platform figure so the number matches the platform cards above */}
                    {(() => {
                      const platTimes = analytics?.platformBestTimes || {}
                      let topPlat = null, topDay = null, topAvg = 0
                      Object.entries(platTimes).forEach(([plat, times]) => {
                        if (times?.bestDay && times.bestDay.avg > topAvg) {
                          topAvg = times.bestDay.avg
                          topDay = times.bestDay.day
                          topPlat = plat
                        }
                      })
                      if (!topPlat) return null
                      const platLabel = topPlat.replace('BongaCams','Bonga').replace('MyFreeCams','MFC')
                      return (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 0 }}>
                          <span style={{ fontSize: 16 }}>📅</span>
                          <div style={{ fontSize: 13, color: C.white }}>
                            <strong>{topDay}s on {platLabel}</strong> earn the most — <span style={{ color: C.gold }}>${topAvg.toFixed(0)} avg per session</span>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

              {/* Platform day heatmap */}
              {(() => {
                const UTC_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
                const LONG_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                // Values come from the engine (analytics.platformDayActivity):
                // creator-local weekdays/dates over the same plan-gated tips as
                // the platform totals beside it. Nothing is re-aggregated here.
                const activity = analytics?.platformDayActivity || {}
                const platDayAvg = {}
                Object.keys(activity).forEach(p => {
                  platDayAvg[p] = {}
                  UTC_DAYS.forEach((d, i) => { platDayAvg[p][d] = activity[p]?.[LONG_DAYS[i]]?.avgPerActiveDay || 0 })
                })
                const platList = Object.keys(platDayAvg)
                if (platList.length < 1) return null
                const todayShort = UTC_DAYS[zonedDay(new Date(), creatorTz)]
                const todayLong = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][zonedDay(new Date(), creatorTz)]
                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Platform by Day of Week</span>
                      <span style={{ fontSize: 11, color: C.muted, padding: "2px 8px", borderRadius: 20, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>avg $/active day</span>
                    </div>
                    <div className="heatmap-wrap" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "80px repeat(7, 1fr)", gap: 3, minWidth: 480 }}>
                      <div />
                      {UTC_DAYS.map(d => (
                        <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: d === todayShort ? C.cyan : C.muted, paddingBottom: 4 }}>{d}</div>
                      ))}
                      {platList.map(plat => {
                        const dayVals = UTC_DAYS.map(d => platDayAvg[plat][d] || 0)
                        const maxVal = Math.max(...dayVals, 0.01)
                        return [
                          <div key={plat + '_l'} style={{ fontSize: 10, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", paddingRight: 4, lineHeight: 1.3 }}>{plat.replace('BongaCams','Bonga').replace(/chaturbate/i,'CB').replace('MyFreeCams','MFC')}</div>,
                          ...UTC_DAYS.map(d => {
                            const val = platDayAvg[plat][d] || 0
                            const intensity = maxVal > 0 ? val / maxVal : 0
                            const isToday = d === todayShort
                            const bg = val === 0 ? "rgba(255,255,255,0.03)" : intensity < 0.25 ? "rgba(34,211,238,0.12)" : intensity < 0.5 ? "rgba(34,211,238,0.30)" : intensity < 0.75 ? "rgba(34,211,238,0.60)" : "rgba(34,211,238,0.90)"
                            return (
                              <div key={d} title={`${plat} ${d}: avg $${val.toFixed(2)}/day`}
                                onClick={() => { if (val > 0) { setChartDrillDay(d); handleTabChange("whales") } }}
                                style={{ height: 32, borderRadius: 5, background: bg, border: isToday ? "2px solid rgba(34,211,238,0.7)" : "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", cursor: val > 0 ? "pointer" : "default", transition: "all 0.15s", transform: "scale(1)" }}
                                onMouseEnter={e => { if (val > 0) { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 0 8px rgba(34,211,238,0.5)" } }}
                                onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "" }}>
                                {val > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: intensity > 0.45 ? "#fff" : C.muted }}>${val >= 100 ? Math.round(val) : val.toFixed(0)}</span>}
                              </div>
                            )
                          })
                        ]
                      })}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>Today ({todayLong}) highlighted in cyan. Darker = more earnings. Click any cell to filter Top Fans by that day. <span style={{ color: C.cyan }}>Click any cell to filter Top Fans by that day.</span></div>
                  </div>
                  </div>
                )
              })()}
            </div>

            {/* section divider */}
            <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)', margin:'4px 0 24px' }} />
            {/* ═══════════════════════════════════════
                4. YOUR TOP EARNERS
                A. Likely Online Now  B. Milestones  C. At Risk
            ═══════════════════════════════════════ */}
            {(() => {
              const currentUTCHourTE = zonedHour(new Date(), creatorTz) // creator-local
              const labelH = h => { const _lh=h; /* already creator-local */ return _lh===0?'12 AM':_lh<12?`${_lh} AM`:_lh===12?'12 PM':`${_lh-12} PM` }

              const likelyOnline = whales
                .filter(w => w.tipCount >= 3)
                .map(w => {
                  // w.tips is the fan's tips from the engine's plan-gated input —
                  // no fallback to raw (ungated) history.
                  const fanTips = w.tips || []
                  const hourCounts = {}
                  fanTips.forEach(t => { const h = zonedHour(t.date_time || t.dateRaw, creatorTz); hourCounts[h] = (hourCounts[h] || 0) + 1 })
                  const sorted = Object.entries(hourCounts).sort((a,b) => b[1]-a[1])
                  if (!sorted.length) return null
                  const peakHour = parseInt(sorted[0][0])
                  const hoursAway = (peakHour - currentUTCHourTE + 24) % 24
                  // peakFraction: share of this fan's tips that fall at their peak hour
                  const peakFraction = sorted[0][1] / fanTips.length
                  // proximityDecay: current hour vs peak hour (exact match = 1.0, 1h off = 0.65, 2h off = 0.35)
                  const proximityDecay = hoursAway === 0 ? 1.0 : hoursAway === 1 ? 0.65 : 0.35
                  // Scale by 200 so a fan with 40% tips at peak + exact match → 80%; 25% + 1h off → 33%
                  const confidence = Math.min(90, Math.max(25, Math.round(peakFraction * 200 * proximityDecay)))
                  return { ...w, peakHour, hoursAway, confidence, peakLabel: labelH(peakHour) }
                })
                .filter(Boolean)
                .filter(w => w.hoursAway <= 2 && w.confidence >= 35)
                .sort((a,b) => b.totalUSD - a.totalUSD)
                .slice(0, 3)

              // Deduplicate: a fan should only appear in one category (highest priority wins)
              // Priority: Likely Online > Close to Milestone > At Risk
              const seenUsernames = new Set(likelyOnline.map(w => w.username.toLowerCase()))

              const milestones = (whatsNextAlerts || [])
                .filter(a => a.type === 'milestone' && !seenUsernames.has((a.username || '').toLowerCase()))
                .slice(0, 3)
              milestones.forEach(a => seenUsernames.add((a.username || '').toLowerCase()))

              const atRisk = reengageList
                .filter(({ whale: w }) => !seenUsernames.has(w.username.toLowerCase()))
                .slice(0, 3)

              const hasAny = likelyOnline.length || milestones.length || atRisk.length
              if (!hasAny) return null

              const fanCard = (w, opts = {}) => (
                <div style={{ padding: "12px 14px", borderRadius: 12, background: opts.bg || "rgba(255,255,255,0.03)", border: opts.border || "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", transition: "transform 0.15s, box-shadow 0.15s", cursor: "default" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px) scale(1.01)"; e.currentTarget.style.boxShadow = opts.hoverGlow || "0 4px 16px rgba(255,255,255,0.06)" }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 160 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: opts.avatarBg || "rgba(34,211,238,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: opts.avatarColor || C.cyan, flexShrink: 0 }}>
                      {w.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>{w.username}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>
                      <span style={{ color: C.white, fontWeight: 600 }}>${w.totalUSD.toFixed(0)}</span> lifetime
                      {opts.sub ? ` · ${opts.sub}` : ''}
                      {w.tipCount > 1 && ` · ${w.tipCount} tips`}
                      {w.avgDaysBetweenTips && w.tipCount > 1 && <span style={{ color: w.churnRisk?.level === 'High' || w.churnRisk?.level === 'Critical' ? C.red : C.muted }}>{` · every ~${Math.round(w.avgDaysBetweenTips)}d`}</span>}
                      {` · ${w.platform}`}
                    </div>
                    </div>
                  </div>
                  {opts.badge && <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: opts.badgeBg, color: opts.badgeColor, fontWeight: 700, whiteSpace: "nowrap" }}>{opts.badge}</span>}
                  {opts.action && (
                    <button onClick={opts.action} style={{ padding: "6px 12px", borderRadius: 8, background: opts.btnBg || "linear-gradient(135deg,#22D3EE,#EC4899)", border: "none", color: C.white, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0, animation: opts.pulseBtn ? "pulse-msg 2.5s infinite" : "none" }}>
                      {opts.btnLabel || "💌"}
                    </button>
                  )}
                </div>
              )

              return (
                <div style={{ ...glassCard, borderRadius: 18, padding: 24, marginBottom: 28, animation: "fadeUp 0.3s ease 0.2s both" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#EC4899,#7C5CFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>👑</div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: C.white }}>Your Top Earners</div>
                      <div style={{ fontSize: 12, color: C.muted }}>Who's online, who's close to a milestone, who needs a message</div>
                    </div>
                  </div>

                  {/* A. Likely Online Now */}
                  {likelyOnline.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
                        Likely Online Now
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {likelyOnline.map((w, i) => fanCard(w, {
                          bg: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.22)", hoverGlow: "0 4px 16px rgba(16,185,129,0.15)",
                          avatarBg: "rgba(16,185,129,0.18)", avatarColor: C.green,
                          sub: `peaks at ${w.peakLabel}`,
                          badge: `${w.confidence}% likely`, badgeBg: "rgba(16,185,129,0.2)", badgeColor: C.green,
                          action: () => { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) },
                          btnBg: "none", pulseBtn: true
                        }))}
                      </div>
                    </div>
                  )}

                  {/* B. Close to Milestone */}
                  {milestones.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>💰 Close to Milestone</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {milestones.map((a, i) => {
                          const w = a.whale
                          if (!w) return null
                          return fanCard(w, {
                            bg: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.22)", hoverGlow: "0 4px 16px rgba(245,158,11,0.12)",
                            avatarBg: "rgba(245,158,11,0.18)", avatarColor: C.gold,
                            sub: a.message?.match(/\$[\d.]+ away/)?.[0] || '',
                            action: () => { if (a.whale) { setMessageTarget(a.whale); setMessageIndex(0); setMessageCopied(false) } },
                            btnBg: "linear-gradient(135deg,#F59E0B,#EC4899)", pulseBtn: false
                          })
                        })}
                      </div>
                    </div>
                  )}

                  {/* C. At Risk — Re-engage */}
                  {atRisk.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>⚠️ At Risk — Re-engage</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {atRisk.map(({ whale: w, days, urgency, msg }, i) => fanCard(w, {
                          bg: `${urgency}08`, border: `1px solid ${urgency}25`, hoverGlow: `0 4px 16px ${urgency}18`,
                          avatarBg: `${urgency}20`, avatarColor: urgency,
                          sub: `${days}d since last tip`,
                          badge: `${days}d ago`, badgeBg: `${urgency}20`, badgeColor: urgency,
                          action: () => { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) },
                          btnBg: `linear-gradient(135deg,${urgency},#EC4899)`, pulseBtn: i === 0,
                          btnLabel: "💌"
                        }))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* section divider */}
            <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)', margin:'4px 0 24px' }} />
            {/* ═══════════════════════════════════════
                5. YOU'RE LOSING MONEY — Risk / Loss + Missed Revenue
            ═══════════════════════════════════════ */}
            {(() => {
              // Only show a fan re-engagement warning if the model has actually
              // been online enough for the fan to have had a realistic chance to tip.
              // Rule: model must have ≥3 sessions in the last N days, where N = fan's
              // average tipping frequency. No-shows aren't "at risk" — we just weren't live.
              const hasStreamedEnough = (whale) => {
                if (!whale?.avgDaysBetweenTips) return true
                const windowDays = Math.max(7, Math.round(whale.avgDaysBetweenTips))
                const cutoff = Date.now() - windowDays * 86400000
                const sessionsInWindow = sessions.filter(s => new Date(s.startTime).getTime() >= cutoff).length
                return sessionsInWindow >= 3
              }
              const allAlerts = [
                ...(lossAlerts || []).filter(a =>
                  (a.type === 'fan_churn') ? hasStreamedEnough(a.whale) : true
                ),
                ...(alerts || []).filter(a =>
                  (a.type === 'churn_risk') ? hasStreamedEnough(a.whale) : true
                ).slice(0, 3)
              ].slice(0, 6)
              const missedEntries = Object.entries(missedRevenueByPlat)
                .filter(([,m]) => m.missedRevenue > 5)
                .sort((a,b) => b[1].missedRevenue - a[1].missedRevenue)
              if (!allAlerts.length && !missedEntries.length) return null
              const peakHourLabel = canonicalPeakLabel
              return (
                <div style={{ ...glassCard, borderRadius: 18, padding: 24, marginBottom: 28, border: "1px solid rgba(251,146,60,0.2)", animation: "fadeUp 0.3s ease 0.25s both" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(251,146,60,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🚨</div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: C.white }}>You're Losing Money</div>
                      <div style={{ fontSize: 12, color: C.muted }}>Inactivity, cold fans, missed windows</div>
                    </div>
                  </div>

                  {/* Missed Revenue — formula: (bestHourAvg - overallAvg) × sessionsNotAtBestHour */}
                  {missedEntries.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>💸 Missed Revenue (by streaming off-peak)</div>
                      {missedEntries.map(([plat, m], i) => (
                        <div key={i} style={{ padding: "12px 14px", borderRadius: 10, marginBottom: 8, background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.22)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 3 }}>
                                📉 {plat} — peak hour earns <span style={{ color: C.cyan }}>{m.multiplier || (m.bestHourAvg && m.overallAvg ? (m.bestHourAvg/m.overallAvg).toFixed(1) : "5")}x</span> your avg session. Shift more streams to {peakHourLabel} to add ~<span style={{ color: C.green }}>${Math.round((m.bestHourAvg||0) - (m.overallAvg||0))}/stream</span>
                              </div>
                              <div style={{ fontSize: 12, color: C.muted }}>
                                {m.sessionsNotAtBestHour} sessions ran off-peak · Best hour is {peakHourLabel} (${m.bestHourAvg.toFixed(0)} avg) vs your overall ${m.overallAvg.toFixed(0)} avg
                              </div>
                            </div>
                            <div style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: "rgba(251,146,60,0.2)", color: C.orange, fontWeight: 700, whiteSpace: "nowrap" }}>
                              Stream at {peakHourLabel}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {allAlerts.map((a, i) => (
                      <div key={i} className={`alert-enter alert-pulse-${a.severity === "critical" ? "critical" : "warning"} alert-row`} style={{ padding: "12px 14px", borderRadius: 10, background: a.severity === 'critical' ? "rgba(248,113,113,0.1)" : "rgba(251,146,60,0.08)", border: `1px solid ${a.severity === 'critical' ? 'rgba(248,113,113,0.25)' : 'rgba(251,146,60,0.2)'}`, animationDelay: `${i * 50}ms` }}>
                        <div style={{ fontSize: 13, color: C.white, marginBottom: 3 }}>{a.icon} {a.message}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>👉 {a.action}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* ═══════════════════════════════════════
                6. SMART INSIGHTS — scannable, lower priority
            ═══════════════════════════════════════ */}
            <div style={{ ...glassCard, borderRadius: 18, padding: 24, marginBottom: 28, animation: "fadeUp 0.3s ease 0.3s both" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(34,211,238,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>💡</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.white }}>Smart Insights</div>
                </div>

                {(() => {
                  // Build insights from data already in scope — no API call needed
                  const _ins = []

                  // 1. Peak hour insight
                  if (canonicalPeakLabel) {
                    const _pPlat = dailyBrief?.displayPlat || 'your top platform'
                    const _pAvg = dailyBrief?.displayAvg
                    _ins.push({
                      title: `Your peak window is ${canonicalPeakLabel} on ${_pPlat}`,
                      body: _pAvg > 0
                        ? `Sessions at this hour average $${_pAvg.toFixed(0)} — ${Math.round(_pAvg / Math.max(avgPerHour, 0.01) * 10) / 10}x your overall rate. Go live during this window to maximise earnings.`
                        : `This is when your fans are most active. Streaming at this time consistently will grow your peak-hour session count.`,
                      action: `Schedule your next stream around ${canonicalPeakLabel}`
                    })
                  }

                  // 2. Best platform insight
                  const _topPlatEntry = Object.entries(platformVelocity || {}).filter(([,v]) => v != null).sort((a,b) => b[1]-a[1])[0]
                  if (_topPlatEntry) {
                    const [_tp, _tv] = _topPlatEntry
                    const _tpLabel = _tp.replace('BongaCams','Bonga').replace('MyFreeCams','MFC').replace(/chaturbate/i,'Chaturbate')
                    _ins.push({
                      title: `${_tpLabel} is your highest-ROI platform at $${_tv.toFixed(2)}/hr`,
                      body: Object.keys(platformVelocity).length > 1
                        ? `Focus your high-effort streams here. Lower-ROI platforms can fill off-peak slots, but ${_tpLabel} should get your peak-hour time.`
                        : `Your sessions here average $${_tv.toFixed(2)}/hr. Consistent streaming builds compounding fan loyalty — each session raises your baseline.`,
                      action: `Prioritise ${_tpLabel} for peak-hour streams`
                    })
                  }

                  // 3. Session average vs top fan contribution
                  const _topWhale = whales?.[0]
                  if (_topWhale && _topWhale.totalUSD > 0) {
                    const _pct = totalRevenue > 0 ? Math.round((_topWhale.totalUSD / totalRevenue) * 100) : 0
                    _ins.push({
                      title: `${_topWhale.username} accounts for ${_pct}% of your lifetime revenue`,
                      body: _pct >= 30
                        ? `High fan concentration is a risk — if they churn your earnings drop sharply. Nurture 2–3 backup whales to reduce dependency.`
                        : `They've spent $${_topWhale.totalUSD.toFixed(0)} lifetime. A personalised message when they've been quiet for 7+ days typically brings them back.`,
                      action: _topWhale.daysSinceLastTip > 7 ? `Send ${_topWhale.username} a re-engage message now` : `Keep ${_topWhale.username} warm — they tipped recently`
                    })
                  } else if (avgPerHour > 0) {
                    // Fallback: session avg insight
                    const _sessAvg = sessions.length > 0 ? totalRevenue / sessions.length : 0
                    _ins.push({
                      title: `You average $${_sessAvg.toFixed(0)} per session at $${avgPerHour.toFixed(2)}/hr`,
                      body: `Sessions over 60 minutes earn disproportionately more — longer streams let tipping patterns compound. Aim for at least one 90-min session per week.`,
                      action: `Try a 90-min stream at your peak hour`
                    })
                  }

                  if (_ins.length === 0) return (
                    <div style={{ fontSize: 13, color: C.muted, padding: '12px 0' }}>Upload more session data to generate personalised insights.</div>
                  )

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {_ins.map((ins, i) => (
                        <div key={i} style={{ padding: "13px 16px", borderRadius: 10, background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.15)" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 4, lineHeight: 1.4 }}>{ins.title}</div>
                          <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55, marginBottom: 8 }}>{ins.body}</div>
                          <div style={{ fontSize: 11, color: C.cyan, fontWeight: 600 }}>👉 {ins.action}</div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>

            {/* Dependency risk + pre-tip behavior — kept, moved lower */}
            {dependencyRisk && dependencyRisk.level !== 'low' && (
              <div style={{ ...glassCard, borderRadius: 14, padding: 20, marginBottom: 20, border: `1px solid ${dependencyRisk.level === 'high' ? 'rgba(248,113,113,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: dependencyRisk.level === 'high' ? "rgba(248,113,113,0.15)" : "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                    {dependencyRisk.level === 'high' ? '🚨' : '⚠️'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 4 }}>Revenue Dependency Risk — {dependencyRisk.level === 'high' ? 'High' : 'Medium'}</div>
                    <div style={{ fontSize: 13, color: C.text, marginBottom: 10 }}>{dependencyRisk.message}</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {[
                        { label: "Top fan", value: `${dependencyRisk.top1Pct}%` },
                        { label: "Top 3 fans", value: `${dependencyRisk.top3Pct}%` },
                        { label: "Top 5 fans", value: `${dependencyRisk.top5Pct}%` },
                        { label: "Loss if #1 leaves", value: `$${dependencyRisk.lossIfTopFanLeaves}` },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.white }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {preTipBehavior && (
              <div style={{ ...glassCard, borderRadius: 14, padding: 20, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <div style={{ fontSize: 20 }}>🧠</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>Tip Behavior Patterns</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, textTransform: "uppercase" }}>Avg gap between tips</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.cyan }}>{preTipBehavior.avgGapMinutes} min</div>
                  </div>
                  {preTipBehavior.peakTippingWindow && (
                    <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, textTransform: "uppercase" }}>Peak tipping window</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: C.gold }}>{preTipBehavior.peakTippingWindow.label}</div>
                    </div>
                  )}
                </div>
                <div style={{ padding: "10px 14px", background: "rgba(236,72,153,0.06)", border: "1px solid rgba(236,72,153,0.2)", borderRadius: 9, fontSize: 13, color: C.text }}>
                  💡 {preTipBehavior.recommendation}
                </div>
                {preTipBehavior.clusteringDetected && (
                  <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 8, fontSize: 12, color: C.cyan }}>
                    🔥 Tip clustering detected — fans tip in bursts. Acknowledge tips publicly to trigger more.
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {activeTab === "platforms" && (
          <PlatformsIntelligence
            analytics={analytics}
            tips={accessible.tips}
            shows={accessible.shows}
            tz={creatorTz}
            isPro={isPro}
            onOpenPlanner={() => handleTabChange('planner')}
            onGoLive={() => handleTabChange('live')}
          />
        )}

        {activeTab === "subscription" && (
          <SubscriptionManager
            isPro={isPro}
            subscriptionData={null}
            onClose={() => handleTabChange('overview')}
          />
        )}

        {activeTab === "whales" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 2 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: C.white, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 20 }}>🐳</span> Fan Intelligence
                </h1>
                <span style={{ fontSize: 13, color: C.text }}>Who matters, who's moving, and who needs attention — ranked by real spend and behavior</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {chartDrillDay && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 10, background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.35)", fontSize: 12, color: C.cyan, fontWeight: 600 }}>
                    📅 {chartDrillDay}s only
                    <button onClick={() => setChartDrillDay(null)} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
                  </div>
                )}
                <button onClick={() => setFanSearchOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: C.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  🔍 Search Fan
                </button>
              </div>
            </div>

            {/* FILTERS — each pill group scrolls horizontally within itself on
                narrow screens instead of clipping options past the viewport edge */}
            <div style={{ display: "flex", gap: 10, marginTop: 14, marginBottom: 16, flexWrap: "wrap", maxWidth: "100%" }}>
              <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.03)", padding: 3, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
                {FAN_TIER_FILTERS.map(t => {
                  const count = t === "ALL" ? whales.length : whales.filter(w => w.tier === t).length
                  const active = whaleFilter === t
                  return (
                    <button key={t} className="tier-filter-btn" onClick={() => setWhaleFilter(t)}
                      style={{ padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", flexShrink: 0, whiteSpace: "nowrap", background: active ? "linear-gradient(135deg, #22D3EE, #EC4899)" : "transparent", color: active ? "#06101A" : C.text }}>
                      {FAN_TIER_FILTER_LABELS[t] || t}
                      <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, opacity: active ? 0.75 : 0.6 }}>{count}</span>
                    </button>
                  )
                })}
              </div>
              {allPlatforms.length > 1 && (
                <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.03)", padding: 3, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
                  {["ALL", ...allPlatforms].map(p => (
                    <button key={p} className="tier-filter-btn" onClick={() => setPlatformFilter(p)} style={{ padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", flexShrink: 0, whiteSpace: "nowrap", background: platformFilter === p ? "rgba(34,211,238,0.18)" : "transparent", color: platformFilter === p ? C.cyan : C.text }}>{p}</button>
                  ))}
                </div>
              )}
              {/* RISK SIGNALS TOGGLE — Pro: show only top spenders off their
                  own tipping pattern (isTopSpenderAtRisk). Free: flips on
                  visually and opens the Unlock Risk Signals modal. */}
              {(() => {
                const on = isPro ? riskOnly : showRiskUpgrade
                return (
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label="Risk signals: show only top spenders who have broken their usual tipping pattern"
                    className={`risk-toggle${on ? ' risk-toggle-on' : ''}`}
                    onClick={() => {
                      if (isPro) {
                        const next = !riskOnly
                        setRiskOnly(next)
                        track('risk_signals_toggle', { on: next })
                      } else {
                        track('upgrade_click', { source: 'risk_signals_toggle' })
                        gtmTrack('paywall_hit', { feature: 'risk_signals_toggle' })
                        setShowRiskUpgrade(true)
                      }
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 9, padding: "5px 14px 5px 6px", borderRadius: 100, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
                      background: on ? "linear-gradient(90deg, rgba(22,244,255,0.16), rgba(124,92,255,0.16), rgba(255,43,174,0.2))" : "rgba(255,255,255,0.03)",
                      border: on ? "1px solid rgba(255,43,174,0.6)" : "1px solid rgba(255,255,255,0.1)",
                      boxShadow: on ? "0 0 18px rgba(22,244,255,0.25), 0 0 26px rgba(255,43,174,0.28)" : "none",
                      color: on ? C.white : C.text, fontSize: 12, fontWeight: 800, transition: "all .25s ease",
                    }}>
                    <span aria-hidden="true" style={{ position: "relative", width: 34, height: 20, borderRadius: 100, flexShrink: 0, transition: "background .25s ease",
                      background: on ? "linear-gradient(90deg, #16F4FF 0%, #7C5CFF 48%, #FF2BAE 100%)" : "rgba(255,255,255,0.12)" }}>
                      <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .25s ease",
                        boxShadow: on ? "0 0 10px rgba(255,255,255,0.8)" : "0 1px 3px rgba(0,0,0,0.4)" }} />
                    </span>
                    🚨 Risk Signals
                    {!isPro && <span style={{ fontSize: 9, fontWeight: 800, color: C.gold, border: `1px solid ${C.gold}55`, borderRadius: 100, padding: "1px 6px" }}>PRO</span>}
                  </button>
                )
              })()}
            </div>

            {/* RISK CONTEXT BANNER(S) — surfaces Risk Signals Paused / Data
                Needs Updating per platform instead of silently mislabeling
                fans. Scoped to whichever platform(s) are currently in view. */}
            {(() => {
              const ctx = analytics?.platformRiskContext || {}
              const platformsInView = platformFilter === "ALL" ? allPlatforms : [platformFilter]
              const flagged = platformsInView
                .map(p => ctx[p])
                .filter(c => c && (c.riskSignalsPaused || c.dataNeedsUpdating))
              if (!flagged.length) return null
              // One combined notice instead of one card per platform. Same
              // per-platform flags as before; only the presentation changed.
              const paused = flagged.filter(c => c.riskSignalsPaused)
              const stale = flagged.filter(c => !c.riskSignalsPaused && c.dataNeedsUpdating)
              const joinNames = (arr) => arr.map(c => c.platform).join(', ')
              const onlyPaused = stale.length === 0
              return (
                <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: 12, color: C.text,
                  background: onlyPaused ? 'rgba(148,163,184,0.08)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${onlyPaused ? 'rgba(148,163,184,0.25)' : 'rgba(245,158,11,0.3)'}` }}>
                  {paused.length > 0 && (
                    <div>
                      <strong style={{ color: C.text }}>Risk Signals Paused — {joinNames(paused)}</strong>
                      <div style={{ marginTop: 2, color: C.muted }}>
                        You haven't had a meaningful stream {paused.length > 1 ? 'on these platforms' : 'here'} recently, so CamCash isn't labeling inactive fans as at risk.
                      </div>
                    </div>
                  )}
                  {stale.length > 0 && (
                    <div style={{ marginTop: paused.length > 0 ? 8 : 0 }}>
                      <strong style={{ color: C.gold }}>Data Needs Updating — {joinNames(stale)}</strong>
                      <div style={{ marginTop: 2, color: C.muted }}>
                        {stale.map(c => `${c.platform}: ${c.dataAgeDays ?? '?'} days old`).join(' · ')}. Current fan behavior may not be complete.
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* A. LEADERBOARD — "Who matters?" Ranked by totalUSD (already
                sorted descending upstream), using the shared tier/platform
                filters above. No invented scoring column. */}
            {filteredWhales.length === 0 ? (
              <div style={{ ...glassCard, borderRadius: 14, padding: 32, textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                <div style={{ fontSize: 15, color: C.text, fontWeight: 600, marginBottom: 4 }}>{riskOnly && isPro ? 'No top spenders are off their pattern right now' : 'No fans match this filter'}</div>
                <div style={{ fontSize: 12, color: C.text }}>{riskOnly && isPro ? 'Risk Signals will flag a Whale or Shark here when they break from their usual tipping rhythm.' : 'Try a different tier or clear the platform filter'}</div>
              </div>
            ) : (
              <div style={{ ...glassCard, borderRadius: 14, padding: 18, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.white }}>🏆 Leaderboard</div>
                  <span style={{ fontSize: 11, color: C.muted }}>Ranked by lifetime spend</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(showAllLeaderboard ? filteredWhales.slice(0, 25) : filteredWhales.slice(0, 5)).map((w, i) => (
                    <FanRow key={w.username + i} w={w} rank={i + 1}
                      onView={(e) => { whaleModalTriggerRef.current = e.currentTarget; setSelectedWhale(w) }}
                      onMessage={() => { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) }}
                      onNote={() => setNoteTarget(w.username)} />
                  ))}
                </div>
                {filteredWhales.length > 5 && (
                  <button onClick={() => setShowAllLeaderboard(v => !v)} style={{ marginTop: 12, width: "100%", padding: "8px 0", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: C.text, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {showAllLeaderboard ? "Show Less" : `Show More (${Math.min(filteredWhales.length, 25) - 5} more)`}
                  </button>
                )}
              </div>
            )}

            {/* PRO FAN INTELLIGENCE PREVIEW — one real fan from the
                creator's own data, selected by a 3-tier fallback using ONLY
                existing fields (no new formula/threshold):
                  1. Whale/Shark tier + behavioralState === 'At Risk'
                     (same evidence-gated bar used everywhere else)
                  2. Whale/Shark tier + trend.direction === 'down' AND
                     trend.confidence === 'Medium' (same calcFanTrend()
                     output AND the same confidence bar Trending Fans/
                     CamCash Noticed require -- a Low-confidence trend is
                     data the formula itself calls too thin, so it's not
                     eligible to feature here either)
                  3. top fan by totalUSD, neutral framing (no risk claim —
                     nothing here implies urgency that isn't supported)
                Scoped to the creator's primary platform (dailyBrief.
                displayPlat -- the existing "highest lifetime revenue"
                platform already computed for the BEST PLATFORM stat, not
                a new concept), falling back to all platforms if no fan
                qualifies there or no primary platform is established yet.
                Free: username + behavioralStateReason blurred, real
                platform/tier/totalUSD/tipCount/daysSinceLastTip visible,
                CTA reuses the existing openUpgradeModal() tracked flow.
                Pro: same slot, same selected fan, unblurred, opens the
                existing Fan Profile modal — no second profile UI. */}
            {(() => {
              const primaryPlatform = dailyBrief?.displayPlat || null
              const pool = primaryPlatform ? whales.filter(w => w.platform === primaryPlatform) : whales
              const selectFrom = (arr) => arr.filter(w => w.tier === 'Whale' || w.tier === 'Shark')
                .find(w => w.behavioralState === 'At Risk')
                || arr.filter(w => w.tier === 'Whale' || w.tier === 'Shark')
                  .sort((a, b) => b.totalUSD - a.totalUSD)
                  .find(w => w.trend?.direction === 'down' && w.trend?.confidence === 'Medium')
                || [...arr].sort((a, b) => b.totalUSD - a.totalUSD)[0]
              const featuredFan = (pool.length > 0 ? selectFrom(pool) : null) || selectFrom(whales)
              if (!featuredFan) return null

              const isAtRisk = featuredFan.behavioralState === 'At Risk'
              const isTrendingDown = !isAtRisk && featuredFan.trend?.direction === 'down' && featuredFan.trend?.confidence === 'Medium'
              const headline = isAtRisk ? 'A high-value fan has gone quiet'
                : isTrendingDown ? "This fan's recent activity has changed"
                : 'A closer look at your top fan'
              const tierColor = TIER_COLORS[featuredFan.tier] || C.cyan
              const accentColor = isAtRisk ? C.red : isTrendingDown ? C.gold : C.cyan

              if (!isPro) {
                return (
                  <div style={{
                    ...glassCard, borderRadius: 16, padding: 18, marginBottom: 20,
                    border: `1.5px solid ${accentColor}55`,
                    boxShadow: `0 0 24px ${accentColor}22`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: accentColor, textTransform: 'uppercase', letterSpacing: 0.6 }}>✦ CamCash Noticed</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: C.gold, border: `1px solid ${C.gold}55`, borderRadius: 100, padding: '2px 8px' }}>PRO</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 14 }}>{headline}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div aria-label="Fan identity locked" style={{ filter: 'blur(5px)', userSelect: 'none', color: C.white, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{featuredFan.username}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 100, background: `${tierColor}20`, border: `1px solid ${tierColor}50`, color: tierColor, fontSize: 10, fontWeight: 700 }}>{featuredFan.tier}</span>
                          <span style={{ fontSize: 11, color: C.muted }}>{featuredFan.platform}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 18 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: C.white }}>${featuredFan.totalUSD.toFixed(0)}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>spent</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: C.white }}>{featuredFan.tipCount}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>tips</div>
                        </div>
                      </div>
                    </div>
                    {featuredFan.daysSinceLastTip != null && (
                      <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>Last tip <span style={{ color: C.text, fontWeight: 600 }}>{featuredFan.daysSinceLastTip}d ago</span></div>
                    )}
                    {/* Only shown for isAtRisk: that's the one state where
                        behavioralStateReason is guaranteed to be a real,
                        evidence-based At-Risk conclusion. In the trending-
                        down or neutral-top-fan branches, behavioralStateReason
                        could just as easily be an unrelated "on schedule"
                        or "too early to assess" message -- rendering it here
                        would imply a locked insight that doesn't exist. */}
                    {isAtRisk && featuredFan.behavioralStateReason && (
                      <div aria-label="Deeper intelligence locked" style={{ marginTop: 12, padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ filter: 'blur(4px)', userSelect: 'none', fontSize: 12, color: C.text, lineHeight: 1.4 }}>{featuredFan.behavioralStateReason}</div>
                      </div>
                    )}
                    <button onClick={() => openUpgradeModal('fans_pro_preview')} style={{ marginTop: 14, width: '100%', padding: '10px 0', borderRadius: 9, background: `linear-gradient(135deg, ${C.cyan}, ${C.pink})`, border: 'none', color: '#06101A', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      Unlock Fan Intelligence →
                    </button>
                  </div>
                )
              }

              // Pro: same slot, same fan, unblurred — opens the existing
              // Fan Profile modal rather than a second profile UI.
              return (
                <button onClick={(e) => { whaleModalTriggerRef.current = e.currentTarget; setSelectedWhale(featuredFan) }}
                  style={{
                    ...glassCard, display: 'block', width: '100%', textAlign: 'left', borderRadius: 16, padding: 18, marginBottom: 20, cursor: 'pointer',
                    border: `1.5px solid ${accentColor}55`, boxShadow: `0 0 24px ${accentColor}22`,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: accentColor, textTransform: 'uppercase', letterSpacing: 0.6 }}>✦ CamCash Noticed</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 14 }}>{headline}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ color: C.white, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{featuredFan.username}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 100, background: `${tierColor}20`, border: `1px solid ${tierColor}50`, color: tierColor, fontSize: 10, fontWeight: 700 }}>{featuredFan.tier}</span>
                        <span style={{ fontSize: 11, color: C.muted }}>{featuredFan.platform}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 18 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: C.white }}>${featuredFan.totalUSD.toFixed(0)}</div>
                        <div style={{ fontSize: 10, color: C.muted }}>spent</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: C.white }}>{featuredFan.tipCount}</div>
                        <div style={{ fontSize: 10, color: C.muted }}>tips</div>
                      </div>
                    </div>
                  </div>
                  {featuredFan.daysSinceLastTip != null && (
                    <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>Last tip <span style={{ color: C.text, fontWeight: 600 }}>{featuredFan.daysSinceLastTip}d ago</span></div>
                  )}
                  {/* Same isAtRisk gate as the free variant above -- see
                      comment there. */}
                  {isAtRisk && featuredFan.behavioralStateReason && (
                    <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.4 }}>{featuredFan.behavioralStateReason}</div>
                    </div>
                  )}
                </button>
              )
            })()}

            {/* B. TRENDING FANS — "Who is moving?" Uses fan.trend.direction/
                label as already computed by calcFanTrend(). Confidence is NOT
                a label to attach after the fact -- calcFanTrend's own
                confidence field (Low = 4-7 tips, Medium = 8+) IS the existing
                minimum-data gate for this insight, so only Medium-confidence
                trends are eligible to be shown as a real signal here (same
                bar CamCash Noticed's "rising" bucket already used). A
                Low-confidence trend is data the formula itself has already
                marked too thin to call a pattern -- it's suppressed, not
                just styled smaller. No new threshold invented: this reuses
                calcFanTrend's own confidence classification. */}
            {(() => {
              const moving = filteredWhales.filter(w => w.trend?.confidence === 'Medium' && (w.trend.direction === 'up' || w.trend.direction === 'down')).slice(0, 5)
              if (moving.length === 0 && filteredWhales.length > 0) {
                return (
                  <div style={{ ...glassCard, borderRadius: 14, padding: 18, marginBottom: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.white, marginBottom: 6 }}>📈 Trending Fans</div>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Trend unavailable — more activity is needed to establish a reliable trend for your fans.</div>
                  </div>
                )
              }
              if (moving.length === 0) return null
              return (
                <div style={{ ...glassCard, borderRadius: 14, padding: 18, marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.white, marginBottom: 12 }}>📈 Trending Fans</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {moving.map((w, i) => {
                      const up = w.trend.direction === 'up'
                      const color = up ? C.green : C.red
                      return (
                        <div key={w.username + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14 }}>{up ? "🔼" : "🔽"}</span>
                          <div style={{ flex: "1 1 100px", minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: C.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.username}</div>
                            <div style={{ fontSize: 10, color: C.muted }}>{w.platform}</div>
                          </div>
                          <span style={{ padding: "2px 8px", borderRadius: 20, background: `${color}15`, border: `1px solid ${color}30`, fontSize: 11, fontWeight: 700, color }}>{w.trend.label}</span>
                          {typeof w.trend.pctChange === 'number' && (
                            <span style={{ fontSize: 11, fontWeight: 700, color }}>{w.trend.pctChange > 0 ? '+' : ''}{w.trend.pctChange.toFixed(0)}%</span>
                          )}
                          {w.trend.confidence && w.trend.confidence !== 'none' && (
                            <span style={{ fontSize: 10, color: C.muted }}>{w.trend.confidence} confidence</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* C. CAMCASH NOTICED — "What happened?" Fans-native feed built
                ONLY from already-gated fields: the same At-Risk gate used by
                the free-plan upsell card above (Whale/Shark tier +
                behavioralState === 'At Risk'), and Medium-confidence upward
                trend fans (the higher-confidence trend bucket). No new
                thresholds, no synthetic events. Renders nothing if empty. */}
            {(() => {
              const items = []
              const riskFans = [...filteredWhales]
                .filter(w => (w.tier === 'Whale' || w.tier === 'Shark') && w.behavioralState === 'At Risk')
                .sort((a, b) => b.totalUSD - a.totalUSD)
              riskFans.slice(0, 2).forEach(w => {
                items.push({
                  key: `risk-${w.username}`,
                  color: C.red,
                  icon: '🚨',
                  text: `${w.username} (${w.tier}, $${w.totalUSD.toFixed(0)} lifetime) is at risk — ${w.behavioralStateReason || 'their tipping pattern has broken from the norm'}.`,
                })
              })
              const risingFans = filteredWhales
                .filter(w => w.trend?.direction === 'up' && w.trend?.confidence === 'Medium')
                .slice(0, 2)
              risingFans.forEach(w => {
                items.push({
                  key: `up-${w.username}`,
                  color: C.green,
                  icon: '📈',
                  text: `${w.username} is ${w.trend.label.toLowerCase()}${typeof w.trend.pctChange === 'number' ? ` (${w.trend.pctChange > 0 ? '+' : ''}${w.trend.pctChange.toFixed(0)}%)` : ''} — Medium confidence.`,
                })
              })
              const shown = items.slice(0, 3)
              if (shown.length === 0) return null
              return (
                <div style={{ ...glassCard, borderRadius: 14, padding: 18, marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.white, marginBottom: 12 }}>👀 CamCash Noticed</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {shown.map(item => (
                      <div key={item.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 12px", borderRadius: 9, background: `${item.color}0d`, border: `1px solid ${item.color}25` }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>{item.icon}</span>
                        <span style={{ fontSize: 12, color: C.text, lineHeight: 1.4 }}>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* D. FAN INTELLIGENCE / COMPARISON — "What's happening across my
                fan base?" Pure aggregation of already-existing per-fan
                fields, grouped by platform. A plain CSS bar compares revenue
                by platform (no new charting library pulled in). */}
            {allPlatforms.length > 0 && (() => {
              const rows = allPlatforms.map(p => {
                const fansHere = whales.filter(w => w.platform === p)
                return {
                  platform: p,
                  fanCount: fansHere.length,
                  revenue: fansHere.reduce((s, w) => s + (w.totalUSD || 0), 0),
                  whaleCount: fansHere.filter(w => w.tier === 'Whale').length,
                  tipCount: fansHere.reduce((s, w) => s + (w.tipCount || 0), 0),
                }
              }).sort((a, b) => b.revenue - a.revenue)
              const maxRevenue = Math.max(1, ...rows.map(r => r.revenue))
              if (rows.length === 0) return null
              return (
                <div style={{ ...glassCard, borderRadius: 14, padding: 18, marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.white, marginBottom: 12 }}>📊 Fan Base by Platform</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {rows.map(r => (
                      <div key={r.platform}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6, marginBottom: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{r.platform}</span>
                          <span style={{ fontSize: 11, color: C.muted }}>{r.fanCount} fans · {r.whaleCount} whale · {r.tipCount} tips</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: C.gold }}>${r.revenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.round((r.revenue / maxRevenue) * 100)}%`, borderRadius: 3, background: "linear-gradient(90deg, #22D3EE, #EC4899)" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* E. FAN DIRECTORY — "Find any fan." Full filtered list, sharing
                the same whaleFilter/platformFilter state as the Leaderboard
                above (one shared filter, no duplicate pills). */}
            {filteredWhales.length > 0 && (
              <div style={{ ...glassCard, borderRadius: 14, padding: 18, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.white }}>📇 Fan Directory</div>
                  <span style={{ fontSize: 11, color: C.muted }}>{filteredWhales.length} fan{filteredWhales.length === 1 ? '' : 's'}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflowY: "auto" }}>
                  {filteredWhales.map((w, i) => (
                    <FanRow key={w.username + '-dir-' + i} w={w}
                      onView={(e) => { whaleModalTriggerRef.current = e.currentTarget; setSelectedWhale(w) }}
                      onMessage={() => { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) }}
                      onNote={() => setNoteTarget(w.username)} />
                  ))}
                </div>
              </div>
            )}

            {filteredWhales.length <= 3 && (
              <div style={{ ...glassCard, borderRadius: 14, padding: 20, textAlign: "center", border: "1px solid rgba(59,130,246,0.2)" }}>
                <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Upload more data to discover more fans • Pro unlocks full profiles & behavior patterns</div>
                <button onClick={() => openUpgradeModal("whales_empty")} style={{ padding: "8px 20px", borderRadius: 8, background: "linear-gradient(135deg,rgba(59,130,246,0.3),rgba(236,72,153,0.3))", border: "1px solid rgba(59,130,246,0.4)", color: C.white, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  🔓 See What Pro Unlocks
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "live" && (() => {
          // ── INLINE LIVE ENGINE (no external import needed) ────────────────

          const normalizeTip = (ev) => {
            const tokens = parseInt(ev.tokens) || 0
            const usd    = parseFloat(ev.usd) || 0
            const rate   = tokenRates[livePlatform] || 0.05
            let rev = 0, src = 'unknown', conf = 0
            if (usd > 0 && tokens > 0) {
              rev = usd; src = 'usd'; conf = 0.9
            } else if (usd > 0) {
              rev = usd; src = 'usd'; conf = 0.95
            } else if (tokens > 0) {
              rev = parseFloat((tokens * rate).toFixed(2)); src = 'tokens'; conf = 0.75
            }
            return { ...ev, normalizedRevenue: rev, sourceUsed: src, confidenceScore: conf, timestamp: ev.timestamp || new Date() }
          }

          const computeState = () => {
            if (!liveEvents.length || !liveStartTime) return null
            const nowMs   = Date.now()
            const startMs = new Date(liveStartTime).getTime()
            const elapsedMins = Math.max((nowMs - startMs) / 60000, 0.1)

            // ALL events — used for totals and the tip feed display
            let totalRevenue = 0, totalTokens = 0
            const tipperMap = {}
            // Per-tipper breakdown, further split by which platform each tip
            // came from (a fan can tip the same streamer on more than one
            // platform, e.g. while multistreaming) — kept separate from
            // tipperMap above so nothing that already reads tipperMap changes.
            const tipperPlatformMap = {}
            liveEvents.forEach(ev => {
              totalRevenue += ev.normalizedRevenue || 0
              totalTokens  += ev.tokens || 0
              tipperMap[ev.username] = (tipperMap[ev.username] || 0) + (ev.normalizedRevenue || 0)

              const platformKey = ev.platform || 'Unknown'
              if (!tipperPlatformMap[ev.username]) {
                tipperPlatformMap[ev.username] = { username: ev.username, totalRevenue: 0, totalTokens: 0, platforms: {} }
              }
              const t = tipperPlatformMap[ev.username]
              t.totalRevenue += ev.normalizedRevenue || 0
              t.totalTokens  += ev.tokens || 0
              t.platforms[platformKey] = {
                revenue: (t.platforms[platformKey]?.revenue || 0) + (ev.normalizedRevenue || 0),
                tokens:  (t.platforms[platformKey]?.tokens  || 0) + (ev.tokens || 0),
                tipCount: (t.platforms[platformKey]?.tipCount || 0) + 1,
              }
            })
            const tippers = Object.values(tipperPlatformMap)
              .map(t => ({
                ...t,
                totalRevenue: parseFloat(t.totalRevenue.toFixed(2)),
                platforms: Object.fromEntries(
                  Object.entries(t.platforms).map(([p, v]) => [p, { ...v, revenue: parseFloat(v.revenue.toFixed(2)) }])
                ),
              }))
              .sort((a, b) => b.totalRevenue - a.totalRevenue)

            // LIVE-ONLY events — used for time-sensitive coaching signals
            // Historical events must NEVER trigger pace/timing alerts
            const liveOnly = liveEvents.filter(e => !e._isHistory)
            const sortedLive = [...liveOnly].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            const lastLiveTip = sortedLive[0]
            const timeSinceLast = lastLiveTip
              ? parseFloat(((nowMs - new Date(lastLiveTip.timestamp).getTime()) / 60000).toFixed(1))
              : null

            const goalProgress = liveGoalTokens > 0
              ? Math.min(100, Math.round((totalTokens / liveGoalTokens) * 100))
              : 0

            const tpm = liveOnly.length > 0
              ? parseFloat((liveOnly.length / elapsedMins).toFixed(2))
              : 0
            const avgTip = liveOnly.length > 0
              ? parseFloat((liveOnly.reduce((s, e) => s + (e.normalizedRevenue||0), 0) / liveOnly.length).toFixed(2))
              : 0

            // Pace uses only live events split into first/second half of elapsed time
            const midMs = startMs + (nowMs - startMs) / 2
            const fh = liveOnly.filter(e => new Date(e.timestamp).getTime() <= midMs)
            const sh = liveOnly.filter(e => new Date(e.timestamp).getTime() > midMs)
            const hm = elapsedMins / 2
            const fUPM = hm > 0 ? fh.reduce((s, e) => s + (e.normalizedRevenue||0), 0) / hm : 0
            const sUPM = hm > 0 ? sh.reduce((s, e) => s + (e.normalizedRevenue||0), 0) / hm : 0

            let pace = 'unknown'
            if (liveOnly.length >= 3 && elapsedMins >= 5) {
              if (sUPM > fUPM * 1.15)      pace = 'above'
              else if (sUPM < fUPM * 0.75) pace = 'below'
              else                          pace = 'on_track'
            }
            const topEntry = Object.entries(tipperMap).sort((a, b) => b[1] - a[1])[0]
            const largestTip = liveOnly.length > 0
              ? parseFloat(Math.max(...liveOnly.map(e => e.normalizedRevenue || 0)).toFixed(2))
              : 0
            const uniqueTippersCount = Object.keys(tipperMap).length
            const top3Tippers = Object.entries(tipperMap)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([username, revenue]) => ({ username, revenue: parseFloat(revenue.toFixed(2)) }))
            return {
              totalRevenue:    parseFloat(totalRevenue.toFixed(2)),
              totalTokens,
              elapsedMins:     parseFloat(elapsedMins.toFixed(1)),
              tipsPerMinute:   tpm,
              avgTipValue:     avgTip,
              timeSinceLastTip: timeSinceLast,
              goalProgress,
              paceStatus:      pace,
              liveOnlyCount:   liveOnly.length,
              uniqueTippersCount,
              largestTip,
              topTipper:       topEntry ? { username: topEntry[0], revenue: parseFloat(topEntry[1].toFixed(2)) } : null,
              top3Tippers,
              firstHalfUPM:    parseFloat(fUPM.toFixed(3)),
              secondHalfUPM:   parseFloat(sUPM.toFixed(3)),
              currentUPM:      parseFloat((totalRevenue / elapsedMins).toFixed(3)),
              tippers,
            }
          }

          // Coaching cooldown helper — returns true if this alert can fire now.
          // Each key has its own cooldown window (in milliseconds).
          const canFireAlert = (key, cooldownMs) => {
            if (isHydratingHistory.current) return false
            const last = coachingCooldowns.current[key]
            if (!last || Date.now() - last > cooldownMs) {
              coachingCooldowns.current[key] = Date.now()
              return true
            }
            return false
          }

          // PRIORITY TIERS: CRITICAL → HIGH → MEDIUM → LOW → INFO
          // Only one alert per priority tier is shown at a time.
          // Cooldowns prevent the same signal from repeating within the window.
          const getAlerts = (state) => {
            if (!state || isHydratingHistory.current) return []
            if (!liveActive) return []

            const { timeSinceLastTip, paceStatus, goalProgress, topTipper,
                    totalRevenue, elapsedMins, liveOnlyCount } = state

            // Strategy-adjusted thresholds
            const deadAirCrit = liveStrategy === 'aggressive' ? 6 : 8
            const deadAirHigh = liveStrategy === 'aggressive' ? 4 : 5
            const goalPushPct = liveStrategy === 'aggressive' || liveStrategy === 'goal' ? 80 : 90

            const alerts = []

            // Helper: push to history log when an alert fires
            const logFired = (icon, text) => {
              firedAlertsLog.current.unshift({ icon, text, ts: Date.now() })
              if (firedAlertsLog.current.length > 20) firedAlertsLog.current.length = 20
            }

            // ── CRITICAL ─────────────────────────────────────────────────────────
            if (timeSinceLastTip !== null && timeSinceLastTip >= deadAirCrit) {
              if (canFireAlert('dead_air_critical', 3 * 60 * 1000)) {
                const text = liveStrategy === 'whale' && topTipper
                  ? `${Math.round(timeSinceLastTip)} min silence — address ${topTipper.username} directly NOW`
                  : `No tips in ${Math.round(timeSinceLastTip)} min — call out names NOW`
                alerts.push({ priority: 1, level: 'critical', icon: '🚨', text })
                logFired('🚨', text)
              }
            }
            if (goalProgress >= goalPushPct && goalProgress < 100) {
              if (canFireAlert('goal_push', 4 * 60 * 1000)) {
                const text = `${goalProgress}% to goal — push NOW, announce the reward`
                alerts.push({ priority: 1, level: 'critical', icon: '🎯', text })
                logFired('🎯', text)
              }
            }

            // ── HIGH ─────────────────────────────────────────────────────────────
            if (timeSinceLastTip !== null && timeSinceLastTip >= deadAirHigh && timeSinceLastTip < deadAirCrit) {
              if (canFireAlert('dead_air_high', 5 * 60 * 1000)) {
                const text = liveStrategy === 'engagement'
                  ? `${Math.round(timeSinceLastTip)} min quiet — drop a question or poll in chat now`
                  : liveStrategy === 'retention'
                  ? `${Math.round(timeSinceLastTip)} min since last tip — thank a viewer by name to re-engage`
                  : `${Math.round(timeSinceLastTip)} min silence — restart with a quick goal`
                alerts.push({ priority: 2, level: 'warning', icon: '⚠️', text })
                logFired('⚠️', text)
              }
            }
            if (paceStatus === 'below' && elapsedMins >= 8 && liveOnlyCount >= 3) {
              if (canFireAlert('pace_below', 5 * 60 * 1000)) {
                const text = liveStrategy === 'aggressive'
                  ? 'Pace slow — announce a limited-time exclusive offer right now'
                  : 'Pace dropping — activate toy or set a micro-goal'
                alerts.push({ priority: 2, level: 'warning', icon: '📉', text })
                logFired('📉', text)
              }
            }

            // ── Stream Fatigue ────────────────────────────────────────────────────
            if (elapsedMins > 75 && paceStatus === 'below' && liveOnlyCount >= 5) {
              if (canFireAlert('stream_fatigue', 15 * 60 * 1000)) {
                const text = 'Stream fatigue — try a new goal or content angle to reset room energy'
                alerts.push({ priority: 2, level: 'warning', icon: '😴', text })
                logFired('😴', text)
              }
            }

            // ── MEDIUM ────────────────────────────────────────────────────────────
            if (paceStatus === 'above' && elapsedMins >= 8 && liveOnlyCount >= 3) {
              if (canFireAlert('pace_above', 8 * 60 * 1000)) {
                const text = liveStrategy === 'aggressive'
                  ? 'Momentum is hot — raise your goal amount NOW while they are tipping'
                  : "Momentum building — don't break the energy"
                alerts.push({ priority: 3, level: 'success', icon: '🔥', text })
                logFired('🔥', text)
              }
            }
            if (goalProgress >= 100) {
              if (canFireAlert('goal_hit', 10 * 60 * 1000)) {
                const text = 'Goal hit! Set the next one immediately'
                alerts.push({ priority: 3, level: 'success', icon: '🎉', text })
                logFired('🎉', text)
              }
            }

            // ── Whale Proximity — regular tipper is overdue ───────────────────────
            if (liveOnlyCount >= 4 && liveStrategy !== 'engagement') {
              const nowMs = Date.now()
              const liveOnly = liveEvents.filter(e => !e._isHistory)
              const tipsByUser = {}
              for (const e of liveOnly) {
                if (!e.username) continue
                if (!tipsByUser[e.username]) tipsByUser[e.username] = []
                tipsByUser[e.username].push(new Date(e.timestamp).getTime())
              }
              let surfaced = false
              for (const [uname, times] of Object.entries(tipsByUser)) {
                if (surfaced || times.length < 2) continue
                const sorted = [...times].sort((a, b) => a - b)
                const gaps = []
                for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1])
                const avgGapMs = gaps.reduce((s, g) => s + g, 0) / gaps.length
                const sinceLastMs = nowMs - sorted[sorted.length - 1]
                if (avgGapMs > 15 * 60 * 1000) continue // skip infrequent tippers
                const ratio = sinceLastMs / avgGapMs
                if (ratio >= 1.3 && sinceLastMs > 2 * 60 * 1000) {
                  if (canFireAlert(`whale_prox_${uname}`, 6 * 60 * 1000)) {
                    const avgMins = Math.round(avgGapMs / 60000)
                    const sinceMins = Math.round(sinceLastMs / 60000)
                    const text = `${uname} tips every ~${avgMins} min — ${sinceMins} min since their last. Call them out!`
                    alerts.push({ priority: 3, level: 'info', icon: '🐋', text })
                    logFired('🐋', text)
                    surfaced = true
                  }
                }
              }
            }

            // ── INFO ──────────────────────────────────────────────────────────────
            if (topTipper && totalRevenue > 0 && topTipper.revenue / totalRevenue >= 0.45) {
              const key = `whale_dep_${topTipper.username}`
              if (canFireAlert(key, 10 * 60 * 1000)) {
                const text = `${topTipper.username} is ${Math.round(topTipper.revenue / totalRevenue * 100)}% of revenue — give them attention`
                alerts.push({ priority: 4, level: 'info', icon: '🐳', text })
                logFired('🐳', text)
              }
            }
            if (liveStrategy === 'engagement' && elapsedMins >= 5 && liveOnlyCount >= 1) {
              if (canFireAlert('engagement_tip', 7 * 60 * 1000)) {
                const text = 'Engagement mode: ask viewers a direct question to boost interaction'
                alerts.push({ priority: 4, level: 'info', icon: '💬', text })
                logFired('💬', text)
              }
            }
            if (liveStrategy === 'retention' && elapsedMins >= 10 && liveOnlyCount >= 2) {
              if (canFireAlert('retention_tip', 8 * 60 * 1000)) {
                const text = 'Retention mode: welcome regulars back by name — loyalty builds tip habits'
                alerts.push({ priority: 4, level: 'info', icon: '💜', text })
                logFired('💜', text)
              }
            }

            return alerts.sort((a, b) => a.priority - b.priority).slice(0, 4)
          }

          const getNextAction = (state) => {
            if (!state || !liveActive) return { text: 'Start your stream to get live coaching' }
            if (isHydratingHistory.current) return { text: 'Loading session data…' }

            const { timeSinceLastTip, paceStatus, goalProgress, topTipper,
                    totalRevenue, elapsedMins, liveOnlyCount } = state

            if (liveOnlyCount === 0)
              return { text: 'Waiting for your first tip this stream — set a goal to get things started.' }

            // ── Goal Focus ──────────────────────────────────────────────────────
            if (liveStrategy === 'goal') {
              if (goalProgress >= 100)
                return { text: 'Goal hit! Set the next one immediately — keep the momentum alive.' }
              if (goalProgress >= 75)
                return { text: `Announce your reward out loud — goal is at ${goalProgress}%. Tell chat exactly what happens when you hit it.` }
              return { text: `Keep mentioning the goal — you're at ${goalProgress}%. Every reminder drives more tips.` }
            }

            // ── Whale Focus ─────────────────────────────────────────────────────
            if (liveStrategy === 'whale') {
              if (topTipper && totalRevenue > 0 && topTipper.revenue / totalRevenue >= 0.3)
                return { text: `Focus on ${topTipper.username} — give them a VIP experience. That's your highest-value tipper right now.` }
              if (timeSinceLastTip !== null && timeSinceLastTip >= 4)
                return { text: 'Address your top tipper by name. VIP treatment keeps whales coming back.' }
              return { text: 'Whale mode: every tipper is a VIP. Personal attention creates repeat tips.' }
            }

            // ── Retention Focus ─────────────────────────────────────────────────
            if (liveStrategy === 'retention') {
              if (timeSinceLastTip !== null && timeSinceLastTip >= 5)
                return { text: 'Call out 3 viewer names right now — recognition keeps people in the room.' }
              if (topTipper)
                return { text: `Show ${topTipper.username} real appreciation — loyal fans tip again when they feel seen.` }
              return { text: 'Greet every viewer by name. Retention starts with acknowledgment.' }
            }

            // ── Engagement Focus ────────────────────────────────────────────────
            if (liveStrategy === 'engagement') {
              if (timeSinceLastTip !== null && timeSinceLastTip >= 4)
                return { text: 'Drop a poll: "50 tokens or 100 tokens?" — interaction restarts the tipping cycle.' }
              return { text: 'Ask viewers a yes/no question in chat. Engagement always leads to tips.' }
            }

            // ── Aggressive ──────────────────────────────────────────────────────
            if (liveStrategy === 'aggressive') {
              if (goalProgress >= 80)
                return { text: `${goalProgress}% to goal — announce the reward NOW. Be loud about what happens when you hit it.` }
              if (paceStatus === 'above')
                return { text: 'Momentum is high — raise your goal amount RIGHT NOW while the room is hot.' }
              if (timeSinceLastTip !== null && timeSinceLastTip >= 4)
                return { text: 'Push mode: "Next tip in 60 sec gets [reward]" — urgency creates action.' }
              return { text: 'Stay aggressive — set visible goals, announce rewards, push every 5 minutes.' }
            }

            // ── Balanced (default) ──────────────────────────────────────────────
            if (goalProgress >= 90 && goalProgress < 100)
              return { text: `Announce your reward out loud — goal is ${goalProgress}%. Tell chat exactly what happens when you hit it.` }
            if (timeSinceLastTip !== null && timeSinceLastTip >= 6)
              return { text: 'Say 3 names in chat right now. "I see [name] — tip to control what I do next."' }
            if (paceStatus === 'below' && elapsedMins >= 8)
              return { text: 'Set a small 50-token goal right now — micro-goals restart momentum when the room slows.' }
            if (topTipper && totalRevenue > 0 && topTipper.revenue / totalRevenue >= 0.4)
              return { text: `Thank ${topTipper.username} by name and offer them something exclusive for their next tip.` }
            if (elapsedMins < 15 && liveOnlyCount < 3)
              return { text: 'Set a 200-token opening goal and announce it. Early goals train the room to tip.' }
            return { text: 'Keep energy high — acknowledge every tipper by name. Recognition drives repeat tipping.' }
          }

          // Add tip handler
          const addTip = () => {
            const { username, tokens, usd } = liveTipInput
            if (!username && !tokens && !usd) return
            const raw = {
              username: username || 'anonymous',
              tokens: parseInt(tokens) || 0,
              usd: parseFloat(usd) || 0,
              timestamp: new Date(),
              platform: livePlatform,
            }
            const normalized = normalizeTip(raw)
            setLiveEvents(prev => [...prev, normalized])
            setLiveTipInput({ username: '', tokens: '', usd: '' })
          }

          // liveTick is referenced here so the 1-second interval drives re-renders
          // which updates elapsed time, tips/min, pace, coaching, and all alerts
          void liveTick
          const state = computeState()

          // ── INTELLIGENCE LAYER — all analytics computed here, never inline ──
          const roomHealth      = computeRoomHealth(state)
          // Memoize sessionPhase: only recalculate when key deps change (not on time progression)
          const sessionPhaseDeps = state?.paceStatus + '|' + Math.round((state?.elapsedMins ?? 0) * 2) / 2 + '|' + state?.liveOnlyCount + '|' + Math.round((state?.tipsPerMinute ?? 0) * 2) / 2
          let sessionPhase
          if (sessionPhaseCacheRef.current.deps === sessionPhaseDeps) {
            sessionPhase = sessionPhaseCacheRef.current.value
          } else {
            sessionPhase = detectSessionPhase(state, prevPhaseRef.current)
            sessionPhaseCacheRef.current = { value: sessionPhase, deps: sessionPhaseDeps }
          }
          const opportunityScore = computeOpportunityScore(state, roomHealth)
          // Memoize streamHealth: only recalculate when key deps change (not on time progression)
          const streamHealthDeps = state?.paceStatus + '|' + (roomHealth?.score ?? 0) + '|' + sessionPhase
          let streamHealth
          if (streamHealthCacheRef.current.deps === streamHealthDeps) {
            streamHealth = streamHealthCacheRef.current.value
          } else {
            // Round timeSinceLastTip to 0.5s increments to prevent oscillation
            const stateCopy = state ? { ...state, timeSinceLastTip: Math.round((state.timeSinceLastTip ?? 0) * 2) / 2 } : state
            streamHealth = computeStreamHealth(stateCopy, roomHealth, sessionPhase)
            streamHealthCacheRef.current = { value: streamHealth, deps: streamHealthDeps }
          }
          const velocity        = computeRevenueVelocity(state?.currentUPM ?? 0, sessions, state?.elapsedMins)
          const comparison      = computeLiveComparison(state, sessions)
          const goalStrategy    = getGoalStrategy(state, roomHealth)
          const recoveryActions = getRecoveryActions(sessionPhase)
          const phaseConfig     = PHASES[sessionPhase] || PHASES.STARTUP
          // Track phase transitions
          if (sessionPhase !== prevPhaseRef.current) {
            if (prevPhaseRef.current !== null) {
              phaseChangeLog.current.unshift({ phase: sessionPhase, prev: prevPhaseRef.current, icon: phaseConfig.icon, label: phaseConfig.label, ts: Date.now() })
              if (phaseChangeLog.current.length > 10) phaseChangeLog.current.length = 10
            }
            prevPhaseRef.current = sessionPhase
          }

          const alerts     = getAlerts(state)
          const nextAction = getNextAction(state)

          const PACE_CONFIG = {
            above:    { label: '🔥 Hot', color: C.green,  bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)' },
            on_track: { label: '✅ On Track', color: C.cyan, bg: 'rgba(34,211,238,0.1)', border: 'rgba(34,211,238,0.25)' },
            below:    { label: '📉 Slow', color: C.red,   bg: 'rgba(248,113,113,0.1)',  border: 'rgba(248,113,113,0.3)' },
            unknown:  { label: '⏳ Starting', color: C.muted, bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)' },
          }
          const ALERT_COLORS = { critical: C.red, warning: C.orange, success: C.green, info: C.cyan }
          const pace = PACE_CONFIG[state?.paceStatus || 'unknown']
          const inp2 = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px', color: C.white, fontSize: 13, outline: 'none', width: '100%' }

          // Build revenue history from last 8 live events for sparklines
          const revenueHistory = [...liveEvents]
            .filter(e => !e._isHistory)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .slice(-8)
            .map(e => e.normalizedRevenue || 0)

          return (
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
              <style>{`
                @keyframes cc-slide-in { from{opacity:0;transform:translateY(-8px);} to{opacity:1;transform:translateY(0);} }
                @keyframes cc-pulse { 0%,100%{opacity:1;} 50%{opacity:0.35;} }
                @keyframes cc-glow { 0%,100%{box-shadow:0 0 8px currentColor;} 50%{box-shadow:0 0 18px currentColor;} }
                @keyframes cc-bar { from{opacity:0.4;} to{opacity:1;} }
              `}</style>
              {/* ── COMPACT LIVE HEADER ─────────────────────────────── */}
              <div style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(4,8,18,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(168,85,247,0.15)', marginBottom: 16, borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                  {/* Left: LIVE badge + timer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: liveActive ? C.green : '#374151', boxShadow: liveActive ? `0 0 8px ${C.green}` : 'none', animation: liveActive ? 'cc-pulse 1.2s ease-in-out infinite' : 'none', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: liveActive ? C.green : C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                        {liveActive ? 'LIVE' : 'Ready'}
                      </span>
                    </div>
                    <span style={{ color: C.muted }}>|</span>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {liveEngine.serverSession?.stream_platform || livePlatform}
                    </span>
                    <span style={{ color: C.muted }}>|</span>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: C.cyan, fontWeight: 600 }}>
                      {liveActive && liveEngine.duration ? `${String(Math.floor(liveEngine.duration.active_duration_seconds / 60)).padStart(2, '0')}m ${String(liveEngine.duration.active_duration_seconds % 60).padStart(2, '0')}s` : '00m 00s'}
                    </span>
                    <span style={{ color: C.muted }}>|</span>
                    {[
                      { label: 'Ext', ok: liveEvents.some(e => e.sourceUsed === 'extension') },
                      { label: 'Sync', ok: liveActive },
                    ].map(({ label, ok }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: ok ? C.green : '#374151', boxShadow: ok ? `0 0 3px ${C.green}` : 'none' }} />
                        <span style={{ fontSize: 11, color: ok ? C.green : C.muted }}>{label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Right: Controls */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={liveEngine.serverSession?.stream_platform || livePlatform} disabled={!!liveEngine.serverSession} title={liveEngine.serverSession ? 'Platform of the running stream' : 'Platform to go live on'} onChange={e => setLivePlatform(e.target.value)} style={{ ...inp2, width: 'auto', padding: '5px 10px', fontSize: 11 }}>
                      {['Chaturbate','BongaCams','MyFreeCams'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <input type="number" value={liveGoalTokens || ''} onChange={e => setLiveGoalTokens(Number(e.target.value)||0)} placeholder="Goal" style={{ ...inp2, width: 100, padding: '5px 10px', fontSize: 11 }} />
                    <select value={liveStrategy} onChange={e => setLiveStrategy(e.target.value)} style={{ ...inp2, width: 'auto', padding: '5px 10px', fontSize: 11 }}>
                      <option value="balanced">⚖️</option>
                      <option value="aggressive">💰</option>
                      <option value="retention">🔄</option>
                      <option value="engagement">💬</option>
                      <option value="whale">🐋</option>
                      <option value="goal">🎯</option>
                    </select>
                    {!liveEngine.serverSession ? (
                      <button onClick={handleDashboardGoLive} disabled={liveEngine.actionPending || liveEngine.phase === 'loading'}
                        style={{ padding: '6px 14px', borderRadius: 6, background: 'linear-gradient(135deg, #10B981, #22D3EE)', border: 'none', color: C.white, fontWeight: 700, fontSize: 11, cursor: liveEngine.actionPending ? 'default' : 'pointer', opacity: liveEngine.actionPending ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                        {liveEngine.actionPending ? 'Starting…' : 'Go Live'}
                      </button>
                    ) : (
                      <>
                        {liveEngine.serverSession.status === 'live' && liveEngine.serverSession.live_substate === 'active' && (
                          <button onClick={liveEngine.pause} disabled={liveEngine.actionPending}
                            style={{ padding: '6px 14px', borderRadius: 6, background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', color: '#FBBF24', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Pause
                          </button>
                        )}
                        {liveEngine.serverSession.status === 'live' && liveEngine.serverSession.live_substate === 'paused' && (
                          <button onClick={liveEngine.resume} disabled={liveEngine.actionPending}
                            style={{ padding: '6px 14px', borderRadius: 6, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: C.green, fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Resume
                          </button>
                        )}
                        <button onClick={liveEngine.stop} disabled={liveEngine.actionPending || liveEngine.phase === 'justEnded'}
                          style={{ padding: '6px 14px', borderRadius: 6, background: 'rgba(248,113,113,0.2)', border: '1px solid rgba(248,113,113,0.5)', color: C.red, fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          End
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* ── PLAN ALLOWANCE + PRIVATE MODE (server session) ───────── */}
              <LiveModeAllowanceBar engine={liveEngine} />
              {liveEngine.actionError && (
                <div data-testid="dashboard-live-error" style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{liveEngine.actionError}</div>
              )}
              {liveEngine.serverSession?.status === 'live' && (
                <div style={{ marginBottom: 16 }}>
                  <PrivateShowControl engine={liveEngine} />
                </div>
              )}

              {/* ── KPI STRIP (Revenue | Tips | Tippers | Top Tip) ─────────────────────────────── */}
              {liveActive && state && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Revenue', value: `$${state.totalRevenue.toFixed(2)}`, color: C.green },
                    { label: 'Tips', value: state.liveOnlyCount.toString(), color: C.cyan },
                    { label: 'Unique Tippers', value: state.uniqueTippersCount.toString(), color: C.purple },
                    { label: 'Largest Tip', value: `$${state.largestTip.toFixed(2)}`, color: C.pink },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ flex: '0 1 auto', borderRadius: 8, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color }}>{value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Not started */}
              {!liveActive && !liveEvents.length && (
                <div style={{ ...glassCard, borderRadius: 20, padding: '64px 48px', textAlign: 'center', marginBottom: 24, background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(236,72,153,0.06), rgba(34,211,238,0.05))', backgroundSize: '300% 300%', animation: 'cc-bar 4s ease infinite alternate', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #a855f7, #ec4899, #22d3ee)', animation: 'cc-bar 2s ease infinite alternate' }} />
                  <div style={{ fontSize: 56, marginBottom: 16 }}>🔴</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.white, marginBottom: 10 }}>Live Command Center</div>
                  <div style={{ fontSize: 14, color: C.muted, maxWidth: 440, margin: '0 auto 28px', lineHeight: 1.75 }}>
                    Your AI coach watches the room in real time — tracking momentum, spotting opportunities, and telling you exactly what to do next to make more money.
                  </div>
                  <button onClick={handleDashboardGoLive} disabled={liveEngine.actionPending || liveEngine.phase === 'loading'}
                    style={{ padding: '13px 36px', borderRadius: 12, background: 'linear-gradient(135deg, #10B981, #22D3EE)', border: 'none', color: C.white, fontWeight: 800, fontSize: 16, cursor: 'pointer', boxShadow: '0 0 32px rgba(16,185,129,0.4)' }}>
                    ▶ Start Streaming
                  </button>
                </div>
              )}

              {(liveActive || liveEvents.length > 0) && (
                <div>
                  {/* ── AI COACH CENTERPIECE ────────────────────────────── */}
                  {(() => {
                    const topAlert = alerts[0]
                    const restAlerts = alerts.slice(1)
                    const urgencyMap = {
                      critical: { bg: 'rgba(248,113,113,0.09)', border: 'rgba(248,113,113,0.38)', badge: 'rgba(248,113,113,0.22)', badgeText: C.red, tag: '🚨 CRITICAL ACTION' },
                      warning:  { bg: 'rgba(245,158,11,0.09)',  border: 'rgba(245,158,11,0.38)',  badge: 'rgba(245,158,11,0.22)',  badgeText: C.gold, tag: '⚠️ ALERT' },
                      success:  { bg: 'rgba(16,185,129,0.09)',  border: 'rgba(16,185,129,0.38)',  badge: 'rgba(16,185,129,0.22)',  badgeText: C.green, tag: '🔥 MOMENTUM' },
                      info:     { bg: 'rgba(34,211,238,0.09)',  border: 'rgba(34,211,238,0.38)',  badge: 'rgba(34,211,238,0.22)',  badgeText: C.cyan, tag: '💡 INSIGHT' },
                    }
                    const uc = topAlert ? (urgencyMap[topAlert.level] || urgencyMap.info) : null
                    const defaultStyle = { bg: 'linear-gradient(135deg, rgba(236,72,153,0.1), rgba(124,92,255,0.1))', border: 'rgba(168,85,247,0.3)', badge: 'rgba(236,72,153,0.2)', badgeText: C.pink, tag: '⚡ DO THIS NOW' }
                    const style = uc || defaultStyle
                    return (
                      <div style={{ borderRadius: 16, padding: '26px 28px', marginBottom: 20, background: topAlert ? style.bg : defaultStyle.bg, border: `1px solid ${topAlert ? style.border : defaultStyle.border}`, boxShadow: topAlert?.level === 'critical' ? '0 0 32px rgba(248,113,113,0.12)' : 'none', animation: topAlert?.level === 'critical' ? 'cc-glow 2.5s ease-in-out infinite' : 'none', position: 'relative', overflow: 'hidden' }}>
                        {/* Animated gradient line at top */}
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #ec4899, #a855f7, #22d3ee)', backgroundSize: '200% 100%', animation: 'cc-bar 2s ease infinite alternate' }} />
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 260 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                              <div style={{ padding: '3px 10px', borderRadius: 6, background: topAlert ? style.badge : defaultStyle.badge, fontSize: 10, fontWeight: 800, color: topAlert ? style.badgeText : defaultStyle.badgeText, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                                {topAlert ? style.tag : defaultStyle.tag}
                              </div>
                              <div style={{ fontSize: 10, color: C.muted }}>AI Coach · {liveStrategy} mode</div>
                            </div>
                            <div style={{ fontSize: 19, fontWeight: 700, color: C.white, lineHeight: 1.65, marginBottom: topAlert && nextAction.text !== topAlert.text ? 12 : 0 }}>
                              {topAlert ? topAlert.text : nextAction.text}
                            </div>
                            {topAlert && nextAction.text !== topAlert.text && (
                              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 10 }}>
                                <span style={{ color: topAlert ? style.badgeText : C.pink, fontWeight: 700 }}>Next: </span>{nextAction.text}
                              </div>
                            )}
                          </div>
                          {liveActive && state && goalStrategy && (
                            <div style={{ minWidth: 170, padding: '14px 18px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Goal Push Probability</div>
                              <div style={{ fontSize: 30, fontWeight: 900, color: goalStrategy.probability >= 70 ? C.green : goalStrategy.probability >= 40 ? C.gold : C.red, marginBottom: 6 }}>{goalStrategy.probability}%</div>
                              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 8 }}>
                                <div style={{ height: '100%', width: `${goalStrategy.probability}%`, borderRadius: 2, background: goalStrategy.probability >= 70 ? `linear-gradient(90deg, ${C.green}, ${C.cyan})` : `linear-gradient(90deg, ${C.gold}, ${C.orange})`, transition: 'width 0.5s ease' }} />
                              </div>
                              <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.5 }}>{goalStrategy.suggestion}</div>
                            </div>
                          )}
                        </div>
                        {restAlerts.length > 0 && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                            {restAlerts.map((a, i) => (
                              <div key={i} style={{ flex: '1 1 200px', padding: '8px 12px', borderRadius: 9, background: `${ALERT_COLORS[a.level]}10`, border: `1px solid ${ALERT_COLORS[a.level]}28`, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: 14, flexShrink: 0 }}>{a.icon}</span>
                                <span style={{ fontSize: 12, color: ALERT_COLORS[a.level], fontWeight: 600, lineHeight: 1.4 }}>{a.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* ── MAIN GRID ─────────────────────────────────────────── */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: 20, marginBottom: 20 }}>

                    {/* LEFT */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                      {/* MONEY MOMENTUM — 2 stats */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                        {[
                          { label: 'Revenue', value: `$${state?.totalRevenue?.toFixed(2) || '0.00'}`, color: C.green, sub: null, showSparkline: true },
                          { label: 'Avg Tip', value: `$${state?.avgTipValue?.toFixed(2) || '0.00'}`, color: C.gold, sub: state?.topTipper ? `Top: ${state.topTipper.username}` : null, showSparkline: false },
                        ].map(({ label, value, color, sub, showSparkline }) => (
                          <div key={label} style={{ ...glassCard, borderRadius: 12, padding: '18px', transition: 'box-shadow 0.2s ease', cursor: 'default' }}
                            onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 20px ${color}28` }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}>
                            <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
                            {showSparkline && revenueHistory.length >= 2 && (() => {
                              const d = revenueHistory, w = 72, h = 28
                              const mx = Math.max(...d), mn = Math.min(...d), rng = mx - mn || 1
                              const pts = d.map((v, i) => `${(i/(d.length-1))*w},${h-((v-mn)/rng)*h}`).join(' ')
                              return <svg width={w} height={h} style={{ display:'block', overflow:'visible', marginTop: 4 }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
                            })()}
                            {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
                          </div>
                        ))}
                      </div>

                      {/* GOAL */}
                      <div style={{ ...glassCard, borderRadius: 12, padding: '14px 18px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Goal</div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: (state?.goalProgress || 0) >= 100 ? C.green : C.white }}>{state?.goalProgress || 0}%</div>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 6 }}>
                          <div style={{ height: '100%', width: `${Math.min(state?.goalProgress || 0, 100)}%`, borderRadius: 4, background: `linear-gradient(90deg, ${C.cyan}, ${C.pink})`, transition: 'width 0.5s ease' }} />
                        </div>
                        {liveGoalTokens > 0 && state && <div style={{ fontSize: 10, color: C.muted }}>{state.totalTokens} / {liveGoalTokens} tokens</div>}
                      </div>

                      {/* TIP INPUT — collapsible */}
                      {liveActive && (
                        <details style={{ ...glassCard, borderRadius: 12 }}>
                          <summary style={{ padding: '11px 16px', cursor: 'pointer', fontSize: 12, color: C.muted, userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14 }}>＋</span> Log a tip manually
                          </summary>
                          <div style={{ padding: '0 16px 14px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8 }}>
                              <input placeholder="Username" value={liveTipInput.username} onChange={e => setLiveTipInput(p => ({ ...p, username: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addTip()} style={inp2} />
                              <input type="number" placeholder="Tokens" value={liveTipInput.tokens} onChange={e => setLiveTipInput(p => ({ ...p, tokens: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addTip()} style={inp2} />
                              <input type="number" placeholder="USD" value={liveTipInput.usd} onChange={e => setLiveTipInput(p => ({ ...p, usd: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addTip()} style={inp2} />
                              <Button onClick={addTip} style={{ padding: '8px 16px', fontSize: 14, whiteSpace: 'nowrap' }}>+ Add</Button>
                            </div>
                          </div>
                        </details>
                      )}

                      {/* LIVE EVENT FEED */}
                      {liveEvents.length > 0 && (
                        <div style={{ ...glassCard, borderRadius: 12, padding: 16, flex: 1 }}>
                          <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
                            Live Event Feed
                            <span style={{ marginLeft: 8, color: C.dim, fontWeight: 400, textTransform: 'none', fontSize: 10, letterSpacing: 0 }}>— {liveEvents.filter(e => !e._isHistory).length} live tips</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 280, overflowY: 'auto' }}>
                            {[...liveEvents].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((ev, i) => {
                              const isFlash = ev._id && ev._id === flashTipId
                              const isNew = i === 0 && !ev._isHistory
                              const isBig = (ev.normalizedRevenue || 0) >= 5
                              return (
                                <div key={ev._id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderRadius: 9, background: isFlash ? 'rgba(168,85,247,0.18)' : isNew ? 'rgba(34,211,238,0.07)' : isBig ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.02)', border: isFlash ? '1px solid rgba(168,85,247,0.5)' : isNew ? '1px solid rgba(34,211,238,0.18)' : isBig ? '1px solid rgba(245,158,11,0.18)' : '1px solid rgba(255,255,255,0.04)', boxShadow: isFlash ? '0 0 16px rgba(168,85,247,0.25)' : 'none', transition: 'all 0.35s ease', opacity: ev._isHistory ? 0.55 : 1, animation: isNew ? 'cc-slide-in 0.35s ease' : 'none' }}>
                                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <span style={{ fontSize: 14 }}>{isBig ? '🐋' : '💰'}</span>
                                    <div>
                                      <span style={{ fontSize: 13, fontWeight: 700, color: isFlash ? '#c084fc' : C.white }}>{ev.username}</span>
                                      {ev._isHistory && <span style={{ fontSize: 9, color: C.dim, marginLeft: 6 }}>history</span>}
                                      {isFlash && <span style={{ fontSize: 10, color: '#c084fc', marginLeft: 8, fontWeight: 800 }}>NEW ✨</span>}
                                    </div>
                                    {ev.tokens > 0 && <span style={{ fontSize: 11, color: C.cyan }}>{ev.tokens}t</span>}
                                  </div>
                                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <span style={{ fontSize: 15, fontWeight: 800, color: isBig ? C.gold : C.green }}>${(ev.normalizedRevenue || 0).toFixed(2)}</span>
                                    <span style={{ fontSize: 9, color: C.muted }}>{new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* RIGHT */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>


                      {/* OPPORTUNITY SIGNALS */}
                      {liveActive && state && opportunityScore.signals.length > 0 && (
                        <div style={{ ...glassCard, borderRadius: 14, padding: '16px 18px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>Why These Alerts?</div>
                            <div style={{ padding: '2px 8px', borderRadius: 6, background: `${opportunityScore.color}18`, fontSize: 11, fontWeight: 800, color: opportunityScore.color }}>{opportunityScore.score}/100</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {opportunityScore.signals.map((sig, i) => (
                              <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                                <span style={{ color: opportunityScore.color, fontSize: 12, flexShrink: 0 }}>→</span>
                                <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{sig}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* EXTENSION STATUS */}
                      <div style={{ borderRadius: 12, padding: '14px 16px', background: liveEvents.some(e => e.sourceUsed === 'extension') ? 'rgba(16,185,129,0.07)' : 'rgba(124,92,255,0.07)', border: `1px solid ${liveEvents.some(e => e.sourceUsed === 'extension') ? 'rgba(16,185,129,0.22)' : 'rgba(124,92,255,0.2)'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: liveEvents.some(e => e.sourceUsed === 'extension') ? C.green : C.muted, boxShadow: liveEvents.some(e => e.sourceUsed === 'extension') ? `0 0 6px ${C.green}` : 'none' }} />
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>
                            {liveEvents.some(e => e.sourceUsed === 'extension') ? 'Extension Auto-Capturing' : 'Auto-capture tips'}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
                          {liveEvents.some(e => e.sourceUsed === 'extension')
                            ? `${liveEvents.filter(e => e.sourceUsed === 'extension').length} tips captured automatically`
                            : 'Install the CamCash Chrome extension — tips appear here automatically.'}
                        </div>
                        {!liveEvents.some(e => e.sourceUsed === 'extension') && (
                          <Button as="a" href="/extension" target="_blank" rel="noopener noreferrer" style={{ padding: '6px 14px', fontSize: 11 }}>📥 Get Extension →</Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Top 3 Tippers Leaderboard */}
                  {state?.top3Tippers && state.top3Tippers.length > 0 && (
                    <div style={{ ...glassCard, borderRadius: 14, padding: '16px 18px' }}>
                      <div style={{ fontSize: 9, color: C.purple, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, marginBottom: 12 }}>🏆 Top 3 Tippers</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {state.top3Tippers.map((tipper, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 10, borderBottom: idx < state.top3Tippers.length - 1 ? `1px solid rgba(255,255,255,0.06)` : 'none' }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: idx === 0 ? C.gold : idx === 1 ? C.cyan : C.muted, minWidth: 24 }}>#{idx + 1}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{tipper.username}</div>
                              <div style={{ fontSize: 10, color: C.muted }}>This session</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 13, fontWeight: 800, color: C.cyan }}>${tipper.revenue.toFixed(2)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          )
        })()}

        {activeTab === "sessions" && (
          <SessionsOverview
            tips={accessible.tips}
            shows={accessible.shows}
            paidSessions={accessible.paidSessions}
            isPro={isPro}
            primaryPlatform={freeUnlimitedPlatform}
            onPrimarySaved={(d) => setProfile(prev => ({ ...(prev || {}), ...d }))}
            onImport={() => handleTabChange('upload')}
            onStartLive={() => handleTabChange('live')}
            plannedStreams={plannedStreams}
            onOpenPlanner={() => handleTabChange('planner')}
            allTips={tips}
            allPaidSessions={paidSessions}
            windowStarts={accessible.windowStarts}
            tipsLoadComplete={dataComplete}
            tz={creatorTz}
            showsLoading={recentShows.loading}
            showsError={recentShows.error}
            live={liveEngine.phase === 'active' && liveEngine.duration
              ? { session: liveEngine.duration, privateInterval: liveEngine.privateInterval }
              : null}
          />
        )}

        {/* The legacy detailed breakdown below is no longer opened from the
            Sessions tab (replaced by the Session Details panel). Kept, not
            deleted, pending approval to remove it. */}
        {activeTab === "sessions" && sessions.length > 0 && showDetailedBreakdown && (() => {
          const displaySessions = meaningfulOnly
            ? (analytics?.meaningfulSessions || sessions)
            : (analytics?.allValidSessions   || sessions)

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
            const half = Math.floor(buckets.length / 2)
            const firstHalfUSD = buckets.slice(0, half).reduce((s, b) => s + b.usd, 0)
            const secondHalfUSD = buckets.slice(half).reduce((s, b) => s + b.usd, 0)
            const firstHalfPct = s.totalUSD > 0 ? Math.round((firstHalfUSD / s.totalUSD) * 100) : 0

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
                time: new Date(startMs + b.idx * 5 * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: creatorTz }),
              }))

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
            const revenuePerMin = parseFloat((s.totalUSD / durationMins).toFixed(3))

            // ── INSIGHTS ────────────────────────────────────────────
            const insights = []
            if (firstHalfPct >= 60)
              insights.push(`You earned ${firstHalfPct}% of your revenue in the first half of the stream`)
            if (firstHalfPct <= 35 && durationMins > 20)
              insights.push(`Your stream warmed up slowly — earnings picked up in the second half`)
            if (topTippers[0] && topTippers[0].pct >= 40)
              insights.push(`${topTippers[0].username} drove ${topTippers[0].pct}% of this session's revenue`)
            if (spikes.length > 0)
              insights.push(`Your biggest spike was at ${spikes[0].time} — $${spikes[0].usd} in 5 minutes`)
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
              recommendations.push(`You earned $${s.totalUSD} in ${Math.round(durationMins)} min. Extending to 45–60 min could 2x your earnings`)
            if (spikes.length >= 2)
              recommendations.push("Multiple spike moments detected — identify what triggered them and recreate it intentionally")
            if (revenuePerMin > 0 && revenuePerMin < 0.10)
              recommendations.push("Low revenue per minute — try setting a token goal every 15 min to maintain tipping momentum")
            if (performance === "high")
              recommendations.push("Replicate this stream: same time, same platform, similar energy — your data supports it")
            if (recommendations.length === 0)
              recommendations.push("Keep streaming consistently — more data helps us give you sharper recommendations")

            return {
              buckets, peakTime, peakBucket, firstHalfPct,
              topTippers, spikes, performance, revenuePerMin,
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
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: C.white, marginBottom: 4 }}>Session Breakdown (detailed)</h2>
                  <p style={{ fontSize: 13, color: C.muted }}>Timeline and coaching for each tip-based session. Estimated from tip timestamps.</p>
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

              {/* OVERVIEW STATS BAR */}
              {displaySessions.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
                  {[
                    { label: "Total Sessions", value: displaySessions.length, color: C.cyan },
                    { label: "Avg Earnings", value: `$${avgSession.toFixed(2)}`, color: C.green },
                    { label: "Best Session", value: `$${Math.max(...displaySessions.map(s => s.totalUSD)).toFixed(2)}`, color: C.gold },
                    { label: "Total Earned", value: `$${displaySessions.reduce((s,x) => s+x.totalUSD,0).toFixed(2)}`, color: C.pink },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ ...glassCard, borderRadius: 12, padding: "16px 18px" }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* SESSION CARDS */}
              {displaySessions.length === 0 && sessions.length > 0 && (
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
                const fmt = dt => new Date(dt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: creatorTz })

                return (
                  <div key={si} style={{ ...glassCard, borderRadius: 16, marginBottom: 24, overflow: "hidden" }}>

                    {/* SESSION HEADER */}
                    <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: C.white }}>
                            {new Date(s.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: creatorTz })}
                          </span>
                          <span style={{ fontSize: 13, color: C.muted }}>{fmt(s.startTime)} → {fmt(s.endTime)}</span>
                          <span style={{ fontSize: 12, color: C.muted }}>• {s.platform}</span>
                        </div>
                        <span style={{ padding: "3px 10px", borderRadius: 20, background: perf.bg, border: `1px solid ${perf.border}`, fontSize: 11, fontWeight: 700, color: perf.color }}>{perf.label}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: C.green }}>${s.totalUSD.toFixed(2)}</div>
                        <div style={{ fontSize: 12, color: C.muted }}>{Math.round(s.durationMinutes)} min • ${bd.revenuePerMin.toFixed(2)}/min</div>
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
                            {bd.spikes.length > 0 && <span style={{ fontSize: 9, color: C.gold }}>🔥 Peak at {bd.spikes[0].time}</span>}
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
                            <td style={{ padding: "12px 16px", color: C.white, fontSize: 12 }}>{new Date(t.date_time).toLocaleDateString(undefined, { timeZone: creatorTz })}</td>
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
              {isPro ? "Unlimited platforms • Auto-removes duplicates" : freePlatformLimitReached ? `${platformLimitMessage()} Auto-removes duplicates.` : `Free plan tracks up to ${FREE_PLATFORM_LIMIT} platforms. Auto-removes duplicates.`}
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: freePlatformLimitReached ? 16 : 32 }}>
              <a href="/blog/how-to-upload-csv-to-camcash" style={{ fontSize: 13, color: C.cyan, textDecoration: "none", fontWeight: 600 }}>📹 Watch the SOP: How to upload a CSV →</a>
              <a href="#csv-help" style={{ fontSize: 13, color: C.cyan, textDecoration: "none", fontWeight: 600 }}>❓ CSV help →</a>
            </div>
            {freePlatformLimitReached && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)", marginBottom: 16 }}>
                <span style={{ fontSize: 18 }}>🔒</span>
                <div style={{ flex: 1, fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>
                  You've reached the free plan's 3-platform limit. Upgrade to Pro for more platforms and full history on all of them.
                </div>
                <Button as="a" href="/pricing" onClick={() => gtmTrack('upgrade_to_pro_clicked', { source: 'platform_limit_banner' })} style={{ flexShrink: 0, padding: "8px 14px", fontSize: 12, whiteSpace: "nowrap" }}>Upgrade →</Button>
              </div>
            )}
            <div style={{ ...glassCard, borderRadius: 14, padding: 32, marginBottom: 16, position: "relative", overflow: "hidden" }}>
              {!['success', 'locked_preview'].includes(importStage) && (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "block" }}>Platform (optional — helps if auto-detect fails)</label>
                  <select value={uploadPlatform} onChange={e => setUploadPlatform(e.target.value)} disabled={uploading}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: C.white, fontSize: 14, outline: "none", opacity: uploading ? 0.6 : 1 }}>
                    <option value="">Auto-detect (recommended)</option>
                    {["Chaturbate", "BongaCams", "MyFreeCams"].map(p => {
                      const locked = freePlatformLimitReached && !allPlatforms.includes(p)
                      return <option key={p} value={p} disabled={locked}>{locked ? `🔒 ${p} — requires Pro` : p}</option>
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
                  <p style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>Supports Chaturbate, BongaCams, MyFreeCams</p>
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
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{lastUploadResult.skipped} were already saved from an earlier upload — nothing was lost</div>
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
                    {lastUploadResult.retry && (
                      <>
                        <Button data-testid="date-order-mdy" onClick={() => handleCSV(lastUploadResult.retry.file, lastUploadResult.retry.forcePlatform, 'MDY')} style={{ padding: "12px 24px", fontSize: 13 }}>Month first (MM/DD/YYYY)</Button>
                        <Button data-testid="date-order-dmy" onClick={() => handleCSV(lastUploadResult.retry.file, lastUploadResult.retry.forcePlatform, 'DMY')} style={{ padding: "12px 24px", fontSize: 13 }}>Day first (DD/MM/YYYY)</Button>
                      </>
                    )}
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
                      <Button as="a" href="/pricing" onClick={() => gtmTrack('upgrade_to_pro_clicked', { source: 'import_locked_preview' })} style={{ padding: "8px 16px", fontSize: 12.5 }}>Subscribe →</Button>
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
              {isPro ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.indigo }}>✦ Subscription active</span>
                  <span style={{ fontSize: 12, color: C.text }}>— track and compare unlimited platforms</span>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: C.text, lineHeight: 1.65, marginBottom: 16 }}>
                    The <strong style={{ color: C.white }}>free plan</strong> tracks up to <strong style={{ color: C.cyan }}>{FREE_PLATFORM_LIMIT} platforms</strong> with a rolling <strong style={{ color: C.cyan }}>31-day analysis window</strong> per platform. A <strong style={{ color: C.white }}>subscription</strong> unlocks full historical analysis and deeper insights into churn, re-engagement, and cross-platform trends.
                  </p>
                  <Button onClick={() => { gtmTrack('upgrade_to_pro_clicked', { source: 'plan_explainer' }); router.push('/pricing') }} style={{ padding: "12px 26px", fontSize: 13 }}>
                    View Plans & Subscribe →
                  </Button>
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
          const thisMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`
          const thisMonth = monthly.find(m => m.month === thisMonthKey)
          const thisMonthUSD = thisMonth?.usd || 0
          const goalPct = monthlyGoal > 0 ? Math.min(100, Math.round((thisMonthUSD / monthlyGoal) * 100)) : null
          const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth()+1, 0).getDate()
          const dayOfMonth = now.getUTCDate()
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
            <TitleGenerator C={C} glassCard={glassCard} analytics={analytics} tips={accessible.tips} sessions={sessions} whales={whales} creatorTz={creatorTz} />
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

        {activeTab === 'analytics' && <AnalyticsCharts analytics={analytics} tz={creatorTz} />}
        {activeTab === 'planner' && (
          _plannerLock.locked
            ? <div style={{ padding: '32px 0' }}>{user && <PlannedStreams userId={user.id} plans={plannedStreams} onChanged={loadPlannedStreams} defaultPlatform={freeUnlimitedPlatform || 'Chaturbate'} tz={creatorTz} />}<LockedInsightCard title="Stream Planner" description="Plan your schedule around your best earning windows." lockType="needs_data" requirement={_plannerLock.message} ctaLabel="Upload More Data" ctaAction={() => handleTabChange('upload')} /></div>
            : <StreamPlanner tips={analysisTips} isPro={isPro} tz={creatorTz} planned={user ? { userId: user.id, plans: plannedStreams, onChanged: loadPlannedStreams, defaultPlatform: freeUnlimitedPlatform || 'Chaturbate', tz: creatorTz } : null} />
        )}
        {activeTab === 'moneymap' && (
          _moneyMapLock.locked
            ? <div style={{ padding: '32px 0' }}><LockedInsightCard title="Money Map" description="See where and when your money comes from across sessions and platforms." lockType="needs_data" requirement={_moneyMapLock.message} ctaLabel="Upload More Data" ctaAction={() => handleTabChange('upload')} /></div>
            : <MoneyMap tips={analysisTips} isPro={isPro} tz={creatorTz} />
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
        const tierIcon = w.tier === 'Whale' ? '💎' : w.tier === 'Shark' ? '🦈' : w.tier === 'Regular' ? '⭐' : w.tier === 'Occasional' ? '🔄' : w.tier === 'New/Developing' ? '🌱' : '💤'
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
          const d = zonedDay(t.date_time, creatorTz)
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
                          { icon: "📅", label: "First tip", value: firstTip ? new Date(firstTip.date_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: creatorTz }) : "Not enough data yet" },
                          { icon: "📅", label: "Last tip", value: w.lastTipDate ? new Date(w.lastTipDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: creatorTz }) : "Not enough data yet", sub: daysSinceLastTip !== null ? `${daysSinceLastTip.toLocaleString()} days ago` : null },
                          { icon: "🕐", label: "Avg days between visits", value: w.avgDaysBetweenTips != null ? `Every ~${Math.round(w.avgDaysBetweenTips)} days` : "Not enough data yet" },
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
                          <span style={{ fontSize: 12, color: C.text }}>{new Date(t.date_time).toLocaleDateString(undefined, { timeZone: creatorTz })}</span>
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
                        <div style={{ fontSize: 12, color: C.text }}>{new Date(t.date_time).toLocaleDateString(undefined, { timeZone: creatorTz })} at {new Date(t.date_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: creatorTz })}</div>
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
                        { label: "First private session", value: fanPrivateSorted[0] ? new Date(fanPrivateSorted[0].date_time).toLocaleDateString(undefined, { timeZone: creatorTz }) : "Not enough data yet" },
                        { label: "Most recent private session", value: fanPrivateSorted[fanPrivateSorted.length - 1] ? new Date(fanPrivateSorted[fanPrivateSorted.length - 1].date_time).toLocaleDateString(undefined, { timeZone: creatorTz }) : "Not enough data yet" },
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
                          <div style={{ fontSize: 12, color: C.text }}>{s.session_type} · {new Date(s.date_time).toLocaleDateString(undefined, { timeZone: creatorTz })}</div>
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
                {whaleTips.length > 0 && (() => {
                  // Only canonical, already-gated fields -- no local formulas,
                  // no invented multipliers. "Likely to tip again" and
                  // "Monthly value" are each omitted (not fabricated) when
                  // the canonical analytics don't yet support them for this
                  // fan, rather than displaying an unsupported claim.
                  const hasEstablishedBaseline = w.behavioralState !== 'Insufficient Data' && w.behavioralState !== 'New/Developing'
                  const items = [
                    (hasEstablishedBaseline && w.expectedNextTip) ? { label: "📅 Likely to tip again", value: w.expectedNextTip, color: C.cyan } : null,
                    { label: "💸 Average tip", value: `$${w.avgTipSize.toFixed(2)}`, color: C.gold },
                    (w.lifetimeValue && w.lifetimeValue.monthly != null) ? { label: "📈 Monthly value", value: `$${w.lifetimeValue.monthly.toFixed(2)}${w.lifetimeValue.confidence === 'Low' ? ' · Low confidence' : ''}`, color: C.green } : null,
                  ].filter(Boolean)
                  if (items.length === 0) return null
                  return (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>📊 Fan Insights</div>
                      <div style={{ padding: 16, background: "rgba(255,255,255,0.04)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 10 }}>
                        {items.map(({ label, value, color }) => (
                          <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                            <div style={{ fontSize: 13, color: C.text }}>{label}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
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
      {/* UNLOCK RISK SIGNALS MODAL — opened by the Fans-tab Risk Signals
          toggle on free plans. Urgent header strip, calm body, real Pro
          features only (PRO_FAN_INTEL_FEATURES mirrors the pricing page). */}
      {showRiskUpgrade && (
        <div role="dialog" aria-modal="true" aria-labelledby="risk-upgrade-title" onClick={() => setShowRiskUpgrade(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(3,5,14,0.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", borderRadius: 26, padding: 1,
            background: "linear-gradient(135deg, rgba(22,244,255,0.9), rgba(124,92,255,0.5), rgba(255,43,174,0.9))",
            boxShadow: "-20px 0 70px rgba(22,244,255,0.18), 20px 0 70px rgba(255,43,174,0.22), 0 28px 90px rgba(0,0,0,0.55)" }}>
            <div style={{ borderRadius: 25, overflow: "hidden",
              background: "radial-gradient(circle at 12% 0%, rgba(22,244,255,0.14), transparent 40%), radial-gradient(circle at 92% 18%, rgba(255,43,174,0.16), transparent 42%), #080B1A" }}>
              {/* slightly urgent strip */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", background: "linear-gradient(90deg, rgba(255,43,174,0.22), rgba(248,113,113,0.12))", borderBottom: "1px solid rgba(255,43,174,0.3)" }}>
                <span className="risk-pulse-dot" aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF2BAE", boxShadow: "0 0 10px #FF2BAE", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FFD1EC" }}>Your top spenders aren't being watched</span>
              </div>
              <div style={{ padding: "26px 26px 22px" }}>
                <div style={{ textAlign: "center", marginBottom: 22 }}>
                  <h2 id="risk-upgrade-title" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, color: "#fff", margin: "0 0 10px" }}>
                    Unlock Risk Signals
                  </h2>
                  <p style={{ fontSize: 14, color: "#D7D9EA", lineHeight: 1.55, margin: 0 }}>
                    Risk Signals learn each top spender's personal tipping rhythm and tell you when one goes quiet, so you can reach out before they're gone.
                  </p>
                  <p style={{ fontSize: 12, color: "#8D93AA", lineHeight: 1.5, margin: "10px 0 0" }}>
                    Free plans only analyze 31 days on secondary platforms, which isn't enough history to read a fan's pattern reliably. And if you take a break from streaming, signals pause on their own.
                  </p>
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.cyan, marginBottom: 10 }}>
                  Fan intelligence in Pro
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
                  {PRO_FAN_INTEL_FEATURES.map(f => (
                    <div key={f.title} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 14px", borderRadius: 14, background: "rgba(13,17,38,0.72)", border: "1px solid rgba(255,255,255,0.09)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}>
                      <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1.2 }}>{f.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{f.title}</div>
                        <div style={{ fontSize: 12, color: "#8D93AA", lineHeight: 1.45, marginTop: 2 }}>{f.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  as="a"
                  href="/pricing"
                  onClick={() => gtmTrack('upgrade_to_pro_clicked', { source: 'risk_signals_modal' })}
                  style={{ width: "100%", padding: "15px", borderRadius: 18, fontSize: 16, marginBottom: 10, boxSizing: "border-box" }}>
                  Upgrade to Pro →
                </Button>
                <div style={{ textAlign: "center", fontSize: 12, color: "#8D93AA", marginBottom: 14 }}>$9.99/month or $99/year</div>
                <button onClick={() => setShowRiskUpgrade(false)} style={{ width: "100%", padding: "10px", borderRadius: 12, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "#8D93AA", fontSize: 13, cursor: "pointer" }}>
                  Maybe later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUpgradeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1002, padding: 20 }}>
          <div style={{ width: 480, background: "rgba(15,20,32,0.97)", backdropFilter: "blur(24px)", borderRadius: 24, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 0 80px rgba(59,130,246,0.2), 0 0 160px rgba(236,72,153,0.1)", overflow: "hidden" }}>
            <div style={{ height: 4, background: "linear-gradient(90deg, #3b82f6, #a855f7, #ec4899)" }} />
            <div style={{ padding: 36 }}>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🚀</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: C.white, marginBottom: 8 }}>Unlock Your Full Earning Potential</h2>
                <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>You're only seeing a preview of your data.<br/>Here's what's waiting for you inside:</p>
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
              <div style={{ textAlign: "center", padding: "12px 16px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 10, marginBottom: 24 }}>
                <div style={{ fontSize: 13, color: C.gold, fontWeight: 600 }}>💡 Most creators miss 30–60% of their earning potential without this</div>
              </div>
              {/* Subscriptions are live: send the creator to the pricing page
                  (real Stripe checkout) instead of the old "launching soon"
                  waitlist. The waitlist also sent the typed email address to
                  analytics; no personal data is tracked here. */}
              <Button
                as="a"
                href="/pricing"
                onClick={() => gtmTrack('upgrade_to_pro_clicked', { source: 'upgrade_modal' })}
                style={{ width: "100%", padding: "16px", borderRadius: 14, fontSize: 16, marginBottom: 12, boxSizing: "border-box" }}>
                See Pro Plans →
              </Button>
              <div style={{ textAlign: "center", fontSize: 12, color: C.muted, marginBottom: 20 }}>7-day free trial • $9.99/month or $99/year</div>
              <button onClick={() => setShowUpgradeModal(false)} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: C.muted, fontSize: 13, cursor: "pointer" }}>
                Maybe later
              </button>
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
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    name="camcash-fan-search"
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
                        <div style={{ fontSize: 11, color: C.muted }}>{w.platform} · {w.tipCount} tips · last {new Date(w.lastTipDate).toLocaleDateString(undefined, { timeZone: creatorTz })}</div>
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
        const bestDayLabel = analyticsbestDay?.day || null
        const platforms = [...new Set(tips.map(t => t.platform))].join(" & ")
        const oneTimerPct = whales.length > 0 ? Math.round((whales.filter(w => w.tipCount === 1).length / whales.length) * 100) : 0
        const cardLines = [
          `💰 Total Earned: $${totalEarnedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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

      <FeedbackButton />
      <ContextualFeedbackPopup
        user={user}
        readiness={dashboardReadiness}
        suppress={liveActive || activeTab === 'live'}
      />

      <SiteFooter variant="simple" />
    </div>
  )
}
