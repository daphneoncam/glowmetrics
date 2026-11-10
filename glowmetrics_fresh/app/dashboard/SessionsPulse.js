"use client"
// Session Pulse — ONE grounded observation, chosen by a fixed priority over
// existing engine outputs (approved order, no new formulas):
//   1. a Live show running now (live engine state)
//   2. a finished Live show not yet viewed (isNew from /api/live/sessions/recent)
//   3. the latest session, when sessionVsTypical has a verified comparison
//   4. a recap of the latest session (low data)
// Zero sessions render the existing activation state instead (not here).
// Every value is passed in as a prop; this file only selects and formats.
//
// Layout (approved reference): insight left (~65%) — eyebrow, headline with
// the session's earnings, one evidence sentence, actions — and one integrated
// signal area right (~35%) — session identity, the verified comparison pill
// when one exists, and the session's own Earned / Tips / Unique Tippers.

import React from "react"
import { platformDisplayName } from "../../lib/constants"
import { fmtUsd, fmtDuration } from "./LatestShows"
import L from "./SessionsLuxury.module.css"

const cx = (...a) => a.filter(Boolean).join(" ")
const pName = (p) => platformDisplayName(p) || p
const day = (iso, tz) => new Date(iso).toLocaleString([], { timeZone: tz, weekday: "short", month: "short", day: "numeric" })
const unit = (e, n) => e.type === "private" ? (n === 1 ? "charge" : "charges") : (n === 1 ? "tip" : "tips")
const typeWord = (e) => e.type === "live" ? "Live show" : e.type === "free_chat" ? "free chat session" : e.type === "private" ? "private session" : "imported session"
const noun = (e) => e.type === "live" ? "show" : "session"
// Source tag beside the date (live shows are identified by "Last show").
const SOURCE = { free_chat: "Free chat", imported: "Imported", private: "Private" }

// Pure: pick the observation (exported for tests).
export function pickPulse({ running = null, history = [], vsById = new Map() }) {
  if (running) return { kind: "live_now", e: running }
  const fresh = history.find((e) => e.type === "live" && e.isNew)
  if (fresh) return { kind: "new_show", e: fresh }
  const latest = history[0]
  if (!latest) return null
  const vs = vsById.get(latest.id)
  if (vs) return { kind: "comparison", e: latest, vs }
  return { kind: "recap", e: latest, first: history.length === 1 }
}

// Duration shown beside the date. Live Mode: recorded show length ("~" when the
// engine marks it estimated). Tip-grouped sessions (free chat from the
// extension, or imported CSV): the first→last tip activity span, always marked
// "~… activity span" — never presented as stream time. Private charges and spans the
// engine cannot determine: no duration at all.
function durationText(e) {
  const mins = Number(e.durationMinutes) || 0
  if (e.type === "live") return mins > 0 ? `${e.durationEstimated ? "~" : ""}${fmtDuration(mins * 60)}${e.running ? " so far" : ""}` : null
  if ((e.type === "free_chat" || e.type === "imported") && !e.durationUnknown && mins > 0) return `~${fmtDuration(mins * 60)} activity span`
  return null
}

const PulseWave = () => (
  <svg className={L.pulseWave} width="34" height="24" viewBox="0 0 34 24" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="sxPulseWave" x1="0" y1="0" x2="34" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#22D3EE" /><stop offset=".5" stopColor="#7C5CFF" /><stop offset="1" stopColor="#EC4899" />
      </linearGradient>
    </defs>
    <path d="M1 13h6l3-7 5 15 4-17 4 13 2-4h8" stroke="url(#sxPulseWave)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const CamIcon = () => (
  <span className={L.pulseCam} aria-hidden="true">
    <svg width="34" height="26" viewBox="0 0 34 26" fill="none">
      <defs>
        <linearGradient id="sxPulseCam" x1="0" y1="0" x2="34" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A78BFA" /><stop offset="1" stopColor="#EC4899" />
        </linearGradient>
      </defs>
      <rect x="1" y="3" width="22" height="20" rx="5" fill="url(#sxPulseCam)" />
      <path d="M24 10.5 32 6v14l-8-4.5z" fill="url(#sxPulseCam)" />
    </svg>
  </span>
)
const CalIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h2M14 14h2M8 17h2" />
  </svg>
)

export default function SessionsPulse({ pick, tz, topFan = null, hourly = null, onOpen, onImport = null, onPlan = null }) {
  if (!pick) return null
  const { kind, e } = pick
  const platforms = (e.platforms || []).map(pName).join(" + ")
  const count = e.type === "private" ? (e.chargeCount ?? e.tipCount ?? 0) : (e.tipCount || 0)
  const fans = e.uniqueTippers || 0
  const dur = durationText(e)

  // Headline: the session's own earnings (the verified value the insight is about).
  let lead, sentence, badge = null, sideLabel, action
  if (kind === "live_now") {
    lead = "You're live and have earned"
    sentence = `Live on ${platforms} · ${count} ${unit(e, count)} from ${fans} ${fans === 1 ? "fan" : "fans"} so far. Updates as tips arrive.`
    badge = { tone: "live", value: "LIVE", label: "Live Mode" }
    sideLabel = "Live now"
    action = { label: "View show", onClick: () => onOpen(e.id) }
  } else if (kind === "new_show") {
    lead = "Your last show earned"
    sentence = `Recorded by Live Mode on ${platforms}${topFan ? ` · ${topFan.username} was your top contributor` : ""}.`
    if (hourly != null) badge = { tone: "neutral", value: `${fmtUsd(hourly)}/hr`, label: "verified rate" }
    sideLabel = "Last show"
    action = { label: "Review show", onClick: () => onOpen(e.id) }
  } else if (kind === "comparison") {
    const { vs } = pick
    lead = `Your last ${noun(e)} earned`
    const rel = vs.outcome === "above" ? `${Math.abs(vs.deltaPct)}% higher than` : vs.outcome === "below" ? `${Math.abs(vs.deltaPct)}% lower than` : "in line with"
    sentence = `That's ${rel} your typical ${typeWord(e)} on ${platforms}: ${fmtUsd(e.totalUSD)} vs your median ${fmtUsd(vs.medianUSD)} across ${vs.sessions} comparable sessions.`
    badge = vs.outcome === "par"
      ? { tone: "neutral", value: "On par", label: "vs. your typical" }
      : { tone: vs.outcome === "above" ? "up" : "down", value: `${vs.deltaPct > 0 ? "+" : ""}${vs.deltaPct}%`, label: "vs. your typical" }
    sideLabel = e.type === "live" ? "Last show" : "Last session"
    action = { label: e.type === "live" ? "View show" : "View session", onClick: () => onOpen(e.id) }
  } else {
    lead = pick.first ? "Your first recorded session earned" : `Your last ${noun(e)} earned`
    const src = e.type === "live" ? "Recorded by Live Mode on" : e.type === "private" ? "Private charges on" : e.type === "free_chat" ? "Free chat on" : "Reconstructed from imported transactions on"
    sentence = `${src} ${platforms}: ${count} ${unit(e, count)} from ${fans} ${fans === 1 ? "fan" : "fans"}.`
    sideLabel = pick.first ? "First session" : e.type === "live" ? "Last show" : "Last session"
    action = { label: e.type === "live" ? "Review show" : "View session", onClick: () => onOpen(e.id) }
  }
  // A first non-Live session invites more history (low data); View session
  // moves to the second action. Otherwise the second action is the existing
  // Stream Planner, when the page provides it.
  let second = onPlan ? { label: "Plan next show", onClick: onPlan, icon: <CalIcon /> } : null
  if (kind === "recap" && pick.first && e.type !== "live" && onImport) {
    second = { label: action.label, onClick: action.onClick, icon: null }
    action = { label: "Import more history", onClick: onImport }
  }
  const meta = [day(e.startTime, tz), dur, SOURCE[e.type] || null].filter(Boolean).join(" · ")

  return (
    <section data-testid="session-pulse" data-kind={kind} className={L.pulseCard} aria-label="Session Pulse">
      <div className={L.pulseInsight}>
        <div className={L.pulseEyebrow}><PulseWave /><span>Session Pulse</span></div>
        <h2 className={L.pulseHeadline}>{lead} <span data-testid="pulse-amount" className={cx(L.pulseAmount, L.money)}>{fmtUsd(e.totalUSD)}</span></h2>
        <p data-testid="pulse-sentence" className={L.pulseSentence}>{sentence}</p>
        <div className={L.pulseActions}>
          <button data-testid="pulse-action" onClick={action.onClick} className={L.pulsePrimary}>{action.label} <span aria-hidden="true">→</span></button>
          {second && <button data-testid="pulse-second" onClick={second.onClick} className={L.pulseSecondary}>{second.icon}{second.label}</button>}
        </div>
      </div>
      <div data-testid="pulse-signal-area" className={L.pulseSide}>
        <div className={L.pulseSideTop}>
          <CamIcon />
          <div className={L.pulseIdentity}>
            <div className={L.pulseSideLabel}>{sideLabel}</div>
            <div data-testid="pulse-platform" className={L.pulsePlatform}>{platforms}</div>
            <div data-testid="pulse-meta" className={L.pulseMeta}>{meta}</div>
          </div>
          {badge && (
            <div data-testid="pulse-badge" data-tone={badge.tone} className={cx(L.pulseBadge, L[`pulseBadge_${badge.tone}`])}>
              <div className={L.pulseBadgeValue}>
                {badge.tone === "up" && <span aria-hidden="true">↑ </span>}
                {badge.tone === "down" && <span aria-hidden="true">↓ </span>}
                {badge.tone === "live" && <span className={L.pulseLiveDot} aria-hidden="true" />}
                <span data-testid="pulse-signal">{badge.value}</span>
              </div>
              <div className={L.pulseBadgeLabel}>{badge.label}</div>
            </div>
          )}
        </div>
        <div className={L.pulseStats}>
          <div className={L.pulseStat}><div data-testid={badge ? "pulse-earned" : "pulse-signal"} className={cx(L.pulseStatValue, L.money)}>{fmtUsd(e.totalUSD)}</div><div className={L.pulseStatLabel}>{kind === "live_now" ? "Earned so far" : "Earned"}</div></div>
          <div className={L.pulseStat}><div data-testid="pulse-count" className={cx(L.pulseStatValue, L.money)}>{count}</div><div className={L.pulseStatLabel}>{e.type === "private" ? (count === 1 ? "Charge" : "Charges") : (count === 1 ? "Tip" : "Tips")}</div></div>
          <div className={L.pulseStat}><div data-testid="pulse-fans" className={cx(L.pulseStatValue, L.money)}>{fans}</div><div className={L.pulseStatLabel}>{fans === 1 ? "Unique Tipper" : "Unique Tippers"}</div></div>
        </div>
      </div>
    </section>
  )
}
