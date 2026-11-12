"use client"

import { useEffect } from "react"
import { track as gtmTrack } from "../../lib/track"
import { PLATFORM_TOKEN_RATES } from "../../lib/constants"

/*
  CREATOR REPORT
  ------------------------------------------------------------
  Progressive report experience:

  EARLY DATA
  -> report is warming up
  -> real earnings/platform information still visible
  -> tells creator exactly what more data unlocks

  DEVELOPING DATA
  -> more insights become available
  -> contextual Pro previews appear after useful discoveries

  RICH DATA
  -> advanced opportunities become visible
  -> Pro becomes the deeper action layer

  IMPORTANT:
  This component intentionally does NOT create a second analytics engine.
  It reads values already calculated by analytics.js / existing dashboard
  analytics and only controls presentation, confidence states and conversion.
*/

// ------------------------------------------------------------
// PLATFORM DISPLAY NAMES
// ------------------------------------------------------------

const PLATFORM_DISPLAY_NAMES = Object.fromEntries(
  Object.keys(PLATFORM_TOKEN_RATES).map(name => [
    name.toLowerCase(),
    name,
  ])
)

const displayPlatform = (platform) =>
  (platform &&
    PLATFORM_DISPLAY_NAMES[String(platform).toLowerCase()]) ||
  platform ||
  "Unknown"

// ------------------------------------------------------------
// COLORS
// ------------------------------------------------------------

const C = {
  cyan: "#22D3EE",
  pink: "#EC4899",
  purple: "#A855F7",
  gold: "#F59E0B",
  green: "#10B981",
  red: "#F87171",
  blue: "#60A5FA",
  white: "#F1F5F9",
  muted: "#94A3B8",
  dim: "#64748B",
  card: "rgba(12,16,34,0.78)",
  card2: "rgba(15,20,32,0.72)",
  border: "rgba(255,255,255,0.09)",
}

// ------------------------------------------------------------
// FORMATTERS
// ------------------------------------------------------------

const fmtUsd = (value, decimals = 0) => {
  const n = Number(value) || 0

  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

const fmtHour = (hour) => {
  if (hour == null) return null

  const n = parseInt(hour, 10)

  if (Number.isNaN(n)) return null

  if (n === 0) return "12 AM"
  if (n < 12) return `${n} AM`
  if (n === 12) return "12 PM"

  return `${n - 12} PM`
}

const fmtNumber = (value) =>
  Number(value || 0).toLocaleString()

const formatDuration = (minutes) => {
  const m = Math.round(Number(minutes) || 0)

  if (m <= 0) return "0m"

  const hours = Math.floor(m / 60)
  const remainder = m % 60

  if (!hours) return `${remainder}m`

  return remainder
    ? `${hours}h ${remainder}m`
    : `${hours}h`
}

// ------------------------------------------------------------
// STAT CARD
// ------------------------------------------------------------

const STAT_ACCENTS = [
  { accent: "#F472B6", glow: "rgba(244,114,182,0.12)" },
  { accent: "#22D3EE", glow: "rgba(34,211,238,0.12)" },
  { accent: "#A78BFA", glow: "rgba(167,139,250,0.12)" },
  { accent: "#FBBF24", glow: "rgba(251,191,36,0.12)" },
]

function StatCard({
  icon,
  label,
  value,
  sub,
  index = 0,
  status = null,
}) {
  const style = STAT_ACCENTS[index % STAT_ACCENTS.length]

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        minWidth: 0,
        borderRadius: 16,
        padding: "15px 16px",
        background: C.card2,
        border: `1px solid ${C.border}`,
        backdropFilter: "blur(20px)",
        animation: `fadeUp 0.3s ease ${index * 0.05}s both`,
        boxShadow: `0 10px 35px ${style.glow}`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg,${style.accent}90,${style.accent}10)`,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 7,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: C.muted,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
          }}
        >
          {label}
        </span>

        <span style={{ fontSize: 16, opacity: 0.8 }}>
          {icon}
        </span>
      </div>

      <div
        style={{
          fontSize: "clamp(18px, 2vw, 23px)",
          lineHeight: 1.15,
          fontWeight: 900,
          color: status === "warming" ? C.muted : style.accent,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>

      {sub && (
        <div
          style={{
            marginTop: 5,
            fontSize: 11,
            lineHeight: 1.45,
            color: C.dim,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// SECTION HEADER
// ------------------------------------------------------------

function SectionHeader({
  eyebrow,
  title,
  description,
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      {eyebrow && (
        <div
          style={{
            marginBottom: 4,
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: C.cyan,
          }}
        >
          {eyebrow}
        </div>
      )}

      <div
        style={{
          fontSize: 16,
          fontWeight: 850,
          color: C.white,
        }}
      >
        {title}
      </div>

      {description && (
        <div
          style={{
            marginTop: 4,
            maxWidth: 680,
            fontSize: 12,
            lineHeight: 1.55,
            color: C.muted,
          }}
        >
          {description}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// PRO CTA
// ------------------------------------------------------------

function ProButton({
  children,
  onClick,
  source = "creator_report",
  compact = false,
}) {
  return (
    <button
      onClick={() => {
        try {
          gtmTrack("creator_report_upgrade_click", { source })
        } catch (_) {}

        onClick?.()
      }}
      style={{
        border: "1px solid rgba(236,72,153,0.25)",
        borderRadius: compact ? 9 : 11,
        padding: compact ? "8px 13px" : "10px 17px",
        cursor: "pointer",
        fontSize: compact ? 11 : 12,
        fontWeight: 850,
        color: "#fff",
        background:
          "linear-gradient(90deg,#EC4899,#A855F7)",
        boxShadow: "0 8px 25px rgba(236,72,153,0.18)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  )
}

// ------------------------------------------------------------
// WARMING / CALIBRATION HEADER
// ------------------------------------------------------------

function CalibrationCard({
  tipsCount,
  sessionCount,
  platformCount,
  isPro,
  onImport,
  hasBestWindow,
  hourlyRateUnlocked,
}) {
  /*
    These are product-progress milestones, not analytics formulas.

    The hourly-rate milestone mirrors the existing dashboard's actual
    eligibility messaging: 3 eligible sessions + 60 tracked minutes.
  */

  const tipReady = tipsCount >= 10
  const sessionReady = sessionCount >= 2
  const timingReady = Boolean(hasBestWindow)
  const hourlyReady = Boolean(hourlyRateUnlocked)

  const milestones = [
    {
      label: "Earnings",
      ready: tipsCount > 0,
    },
    {
      label: "Session patterns",
      ready: sessionReady,
    },
    {
      label: "Timing patterns",
      ready: timingReady,
    },
    {
      label: "$/hour confidence",
      ready: hourlyReady,
    },
  ]

  const completed = milestones.filter(m => m.ready).length

  const calibration = Math.round(
    (completed / milestones.length) * 100
  )

  let headline = "Your Creator Report is warming up"
  let subhead =
    "CamCash is learning your earning patterns. Keep importing history and the report will become more precise."

  if (completed >= 4) {
    headline = "🔥 Creator Report is fully calibrated"
    subhead =
      "You have enough history for CamCash to surface your strongest patterns. Pro can take those patterns deeper."
  } else if (completed >= 3) {
    headline = "📈 Your report just got smarter"
    subhead =
      "CamCash has enough history to identify several meaningful patterns in your streams."
  } else if (completed >= 2) {
    headline = "🔮 Your report is finding patterns"
    subhead =
      "You've given CamCash enough history to start identifying repeatable behavior."
  }

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        marginBottom: 18,
        borderRadius: 20,
        padding: "18px 20px",
        background:
          "linear-gradient(135deg,rgba(34,211,238,0.08),rgba(168,85,247,0.07),rgba(236,72,153,0.05))",
        border: "1px solid rgba(34,211,238,0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{
              marginBottom: 5,
              fontSize: 16,
              fontWeight: 900,
              color: C.white,
            }}
          >
            {headline}
          </div>

          <div
            style={{
              maxWidth: 680,
              fontSize: 12,
              lineHeight: 1.55,
              color: C.muted,
            }}
          >
            {subhead}
          </div>
        </div>

        <div
          style={{
            minWidth: 115,
            textAlign: "right",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: C.muted,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
            }}
          >
            Report calibration
          </div>

          <div
            style={{
              marginTop: 2,
              fontSize: 24,
              fontWeight: 950,
              color: calibration >= 75 ? C.green : C.cyan,
            }}
          >
            {calibration}%
          </div>
        </div>
      </div>

      <div
        style={{
          height: 6,
          marginTop: 15,
          overflow: "hidden",
          borderRadius: 99,
          background: "rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            width: `${Math.max(calibration, 7)}%`,
            height: "100%",
            borderRadius: 99,
            background:
              "linear-gradient(90deg,#22D3EE,#A855F7,#EC4899)",
            transition: "width 0.5s ease",
          }}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(145px,1fr))",
          gap: 8,
          marginTop: 13,
        }}
      >
        {milestones.map((milestone) => (
          <div
            key={milestone.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 9px",
              borderRadius: 9,
              background: milestone.ready
                ? "rgba(16,185,129,0.07)"
                : "rgba(255,255,255,0.025)",
              border: `1px solid ${
                milestone.ready
                  ? "rgba(16,185,129,0.18)"
                  : "rgba(255,255,255,0.06)"
              }`,
            }}
          >
            <span style={{ fontSize: 12 }}>
              {milestone.ready ? "✓" : "○"}
            </span>

            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: milestone.ready
                  ? C.green
                  : C.muted,
              }}
            >
              {milestone.label}
            </span>
          </div>
        ))}
      </div>

      {!isPro && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 15,
            paddingTop: 13,
            borderTop: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: C.muted,
            }}
          >
            {tipReady
              ? "Your basic report is active. Keep importing to improve pattern confidence."
              : `Import ${Math.max(1, 10 - tipsCount)} more tip${10 - tipsCount === 1 ? "" : "s"} to unlock more basic report signals.`}
          </div>

          <button
            onClick={onImport}
            style={{
              border: "1px solid rgba(34,211,238,0.2)",
              borderRadius: 9,
              padding: "8px 13px",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 800,
              color: C.cyan,
              background: "rgba(34,211,238,0.07)",
            }}
          >
            Import More History
          </button>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// PLATFORM CARDS
// ------------------------------------------------------------

function PlatformCards({
  platforms,
  tips,
  isPro,
  onUpgrade,
}) {
  const actualPlatforms =
    Array.isArray(platforms) && platforms.length
      ? platforms
      : []

  const tipPlatforms = [
    ...new Set(
      tips
        .map(t => t?.platform)
        .filter(Boolean)
    ),
  ]

  const names = [
    ...new Set([
      ...actualPlatforms.map(p => p?.platform),
      ...tipPlatforms,
    ]),
  ].filter(Boolean)

  if (!names.length) {
    return (
      <div
        style={{
          padding: 18,
          borderRadius: 14,
          border: `1px dashed ${C.border}`,
          background: "rgba(255,255,255,0.02)",
          color: C.muted,
          fontSize: 12,
        }}
      >
        Import your first platform history and CamCash will start
        building your platform report here.
      </div>
    )
  }

  const normalized = names.map(name => {
    const existing = actualPlatforms.find(
      p =>
        String(p?.platform || "").toLowerCase() ===
        String(name).toLowerCase()
    )

    const platformTips = tips.filter(
      t =>
        String(t?.platform || "").toLowerCase() ===
        String(name).toLowerCase()
    )

    const totalUSD =
      existing?.totalUSD ??
      platformTips.reduce(
        (sum, t) => sum + (Number(t?.usd) || 0),
        0
      )

    const tipCount =
      existing?.tipCount ??
      existing?.tips ??
      platformTips.length

    const sessions =
      existing?.sessions ??
      0

    const hours =
      existing?.hours ??
      0

    const usdPerHour =
      existing?.usdPerHour ??
      0

    return {
      platform: name,
      totalUSD,
      tipCount,
      sessions,
      hours,
      usdPerHour,
    }
  })

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(205px,1fr))",
        gap: 10,
      }}
    >
      {normalized.map((platform, index) => (
        <div
          key={platform.platform}
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 15,
            padding: "14px 15px",
            background: C.card2,
            border: `1px solid ${C.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 850,
                color: C.white,
              }}
            >
              {displayPlatform(platform.platform)}
            </div>

            <div
              style={{
                padding: "3px 7px",
                borderRadius: 20,
                fontSize: 9,
                fontWeight: 800,
                color: C.green,
                background: "rgba(16,185,129,0.08)",
                border:
                  "1px solid rgba(16,185,129,0.16)",
              }}
            >
              SYNCED
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              fontSize: 21,
              fontWeight: 900,
              color: index === 0 ? C.cyan : C.white,
            }}
          >
            {fmtUsd(platform.totalUSD, 2)}
          </div>

          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: C.dim,
            }}
          >
            {fmtNumber(platform.tipCount)} tips
            {platform.sessions
              ? ` · ${platform.sessions} sessions`
              : ""}
          </div>

          <div
            style={{
              marginTop: 11,
              paddingTop: 9,
              borderTop:
                "1px solid rgba(255,255,255,0.06)",
              fontSize: 10,
              color: C.muted,
            }}
          >
            {platform.usdPerHour > 0
              ? `${fmtUsd(platform.usdPerHour)}/hr`
              : "Building hourly history"}
          </div>

          {normalized.length > 1 && !isPro && index > 0 && (
            <div
              style={{
                marginTop: 9,
                padding: "7px 8px",
                borderRadius: 8,
                background: "rgba(168,85,247,0.06)",
                border:
                  "1px solid rgba(168,85,247,0.16)",
                fontSize: 10,
                lineHeight: 1.45,
                color: C.muted,
              }}
            >
              🔒 Pro compares this platform against
              your other platforms by timing and
              profitability.
            </div>
          )}
        </div>
      ))}

      {!isPro && normalized.length === 1 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            borderRadius: 15,
            padding: 15,
            background:
              "linear-gradient(135deg,rgba(168,85,247,0.06),rgba(236,72,153,0.04))",
            border:
              "1px solid rgba(168,85,247,0.17)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 850,
              color: C.white,
            }}
          >
            🌐 Add another platform
          </div>

          <div
            style={{
              marginTop: 5,
              fontSize: 10,
              lineHeight: 1.5,
              color: C.muted,
            }}
          >
            Your first platform is mapped. Pro
            unlocks deeper cross-platform intelligence
            when you have multiple sources.
          </div>

          <div style={{ marginTop: 10 }}>
            <ProButton
              compact
              source="creator_report_multi_platform"
              onClick={onUpgrade}
            >
              See Multi-Platform Pro
            </ProButton>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// INSIGHT STATE CARD
// ------------------------------------------------------------

function InsightState({
  icon,
  title,
  state,
  children,
  footer,
  onImport,
}) {
  const isWarming = state === "warming"

  return (
    <div
      style={{
        minHeight: 118,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 15,
        borderRadius: 15,
        background: isWarming
          ? "rgba(255,255,255,0.025)"
          : "rgba(16,185,129,0.045)",
        border: `1px solid ${
          isWarming
            ? "rgba(255,255,255,0.07)"
            : "rgba(16,185,129,0.15)"
        }`,
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 16 }}>{icon}</span>

          <span
            style={{
              fontSize: 10,
              fontWeight: 850,
              color: C.muted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {title}
          </span>

          <span
            style={{
              marginLeft: "auto",
              padding: "3px 6px",
              borderRadius: 20,
              fontSize: 8,
              fontWeight: 900,
              color: isWarming ? C.gold : C.green,
              background: isWarming
                ? "rgba(245,158,11,0.08)"
                : "rgba(16,185,129,0.08)",
            }}
          >
            {isWarming ? "WARMING UP" : "READY"}
          </span>
        </div>

        <div
          style={{
            marginTop: 11,
            fontSize: 13,
            lineHeight: 1.5,
            color: isWarming ? C.muted : C.white,
          }}
        >
          {children}
        </div>
      </div>

      {footer && (
        <div
          style={{
            marginTop: 10,
            fontSize: 10,
            color: C.dim,
          }}
        >
          {footer}
        </div>
      )}

      {isWarming && onImport && (
        <button
          onClick={onImport}
          style={{
            alignSelf: "flex-start",
            marginTop: 9,
            padding: "6px 9px",
            borderRadius: 7,
            cursor: "pointer",
            border:
              "1px solid rgba(34,211,238,0.14)",
            color: C.cyan,
            background: "rgba(34,211,238,0.05)",
            fontSize: 9,
            fontWeight: 800,
          }}
        >
          Import more history →
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// PRO PREVIEW
// ------------------------------------------------------------

function ProPreview({
  icon = "🔒",
  eyebrow = "PRO INSIGHT",
  title,
  description,
  preview,
  onUpgrade,
  source = "creator_report_pro_preview",
}) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 16,
        padding: 17,
        background:
          "linear-gradient(135deg,rgba(168,85,247,0.07),rgba(236,72,153,0.055))",
        border:
          "1px solid rgba(168,85,247,0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
            borderRadius: 10,
            background: "rgba(168,85,247,0.10)",
            border:
              "1px solid rgba(168,85,247,0.18)",
            fontSize: 16,
          }}
        >
          {icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 900,
              color: C.purple,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </div>

          <div
            style={{
              marginTop: 3,
              fontSize: 13,
              fontWeight: 850,
              color: C.white,
            }}
          >
            {title}
          </div>

          {description && (
            <div
              style={{
                marginTop: 5,
                fontSize: 11,
                lineHeight: 1.5,
                color: C.muted,
              }}
            >
              {description}
            </div>
          )}

          {preview && (
            <div
              style={{
                marginTop: 10,
                padding: "9px 10px",
                borderRadius: 9,
                background:
                  "rgba(0,0,0,0.15)",
                border:
                  "1px solid rgba(255,255,255,0.05)",
                fontSize: 11,
                lineHeight: 1.5,
                color: C.white,
              }}
            >
              {preview}
            </div>
          )}

          <div style={{ marginTop: 11 }}>
            <ProButton
              compact
              source={source}
              onClick={onUpgrade}
            >
              Unlock with Pro →
            </ProButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// LOCKED ACTION
// ------------------------------------------------------------

function LockedAction({
  icon = "🔒",
  title,
  description,
  onUpgrade,
  source,
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "11px 12px",
        borderRadius: 11,
        background: "rgba(168,85,247,0.045)",
        border:
          "1px solid rgba(168,85,247,0.12)",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 auto",
          borderRadius: 8,
          background: "rgba(168,85,247,0.08)",
          fontSize: 13,
        }}
      >
        {icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: C.white,
          }}
        >
          {title}
        </div>

        {description && (
          <div
            style={{
              marginTop: 2,
              fontSize: 10,
              lineHeight: 1.4,
              color: C.muted,
            }}
          >
            {description}
          </div>
        )}
      </div>

      <ProButton
        compact
        source={source}
        onClick={onUpgrade}
      >
        Reveal
      </ProButton>
    </div>
  )
}

// ------------------------------------------------------------
// MAIN COMPONENT
// ------------------------------------------------------------

export default function CreatorReport({
  analytics,
  tips = [],
  isPro = false,
  onUpgrade,
  engineInsights = null,
}) {
  const safeAnalytics = analytics || {}

  // ----------------------------------------------------------
  // EXISTING ANALYTICS — READ ONLY
  // ----------------------------------------------------------

  const totalUSD = safeAnalytics.totalUSD || 0

  const meaningfulSessionCount =
    safeAnalytics.meaningfulSessionCount || 0

  const sessions =
    safeAnalytics.sessions || []

  const topTippers =
    safeAnalytics.topTippers || []

  const platforms =
    safeAnalytics.platforms || []

  const insights =
    safeAnalytics.insights || []

  const nextMoves =
    safeAnalytics.nextMoves || []

  const monthlyData =
    safeAnalytics.monthlyData || []

  const topPlatform =
    safeAnalytics.bestPlatformByRate || null

  const canonicalBestWindow =
    safeAnalytics.canonicalBestTimes?.bestWindow || null

  const hourlyRate =
    safeAnalytics.estimatedHourlyRate || 0

  const hourlyRateSessionCount =
    safeAnalytics.hourlyRateSessionCount || 0

  const hourlyRateTotalMinutes =
    safeAnalytics.hourlyRateTotalMinutes || 0

  // Existing dashboard uses these fields to determine whether
  // hourly rate is actually eligible.
  const hourlyRateUnlocked =
    hourlyRateSessionCount >= 3 &&
    hourlyRateTotalMinutes >= 60

  const latestMonth =
    monthlyData.length
      ? monthlyData[monthlyData.length - 1]
      : null

  const monthGrowthPct =
    latestMonth?.growthPct ?? null

  const topSupporter =
    topTippers[0] || null

  // Existing advanced analytics fields.
  // Canonical missed-revenue (lib/analytics/missedRevenue.js). This read was
  // `safeAnalytics.missedRevenueByPlatform`, a key that no longer exists —
  // the legacy field was replaced by missedRevenue.cumulative_by_platform,
  // so this section resolved to {} on every account and the revenue-leak
  // card could never render.
  const missedRevenueByPlatform =
    safeAnalytics.missedRevenue?.cumulative_by_platform || {}

  const returningVsNew =
    safeAnalytics.returningVsNew || null

  // ----------------------------------------------------------
  // SQL ENGINE INSIGHTS — get_user_insights (read only)
  // ----------------------------------------------------------
  // This prop was passed into the report but never read, which stranded the
  // ENTIRE insight feed the SQL engine generates on every dashboard load —
  // including the three observational insights that 20260820_free_tier_sees_
  // observational_insights.sql deliberately unlocked for free accounts. That
  // migration's whole point was that a free creator with real history should
  // see the product understand her data; with no consumer, none of them
  // reached anyone.
  //
  // Nothing is recomputed or re-ranked here. The engine already applies plan
  // scoping server-side (free receives only session_length / dropoff / trend;
  // Pro additionally receives go_live_now / wait / platform) and already
  // orders the array. This renders what it returns, in the order it returns.
  const engineFeed = Array.isArray(engineInsights?.insights)
    ? engineInsights.insights.filter(i => i?.title)
    : []

  // Counts only what is actually withheld from this caller — the engine sets
  // it that way, so the "more with Pro" copy stays honest instead of
  // counting insights the creator can already see above.
  const engineLockedCount = !isPro
    ? (engineInsights?.insights_locked_count || 0)
    : 0

  // impact -> the report's existing palette. Unknown impacts fall back to
  // cyan rather than being dropped, so a new engine rule still renders.
  const engineImpactColor = (impact) =>
    impact === "critical" ? C.pink
      : impact === "warning" ? C.gold
        : impact === "positive" ? C.green
          : impact === "high" ? C.purple
            : C.cyan

  const topFanDependency =
    safeAnalytics.topFanDependency || null

  // ----------------------------------------------------------
  // DATA STATE
  // ----------------------------------------------------------

  const tipCount = tips.length

  const platformCount = [
    ...new Set(
      tips
        .map(t => t?.platform)
        .filter(Boolean)
    ),
  ].length

  const hasEnoughBasicData =
    tipCount > 0

  const hasEnoughSessions =
    meaningfulSessionCount >= 2

  const hasBestWindow =
    Boolean(canonicalBestWindow)

  const hasRichData =
    tipCount >= 100 &&
    meaningfulSessionCount >= 5

  // We intentionally don't use a hard "no data" return.
  // The report should always look complete.
  const reportState =
    hasRichData
      ? "rich"
      : hasEnoughSessions
        ? "developing"
        : "warming"

  // ----------------------------------------------------------
  // INSIGHT STATES
  // ----------------------------------------------------------

  const bestDayReady =
    Boolean(canonicalBestWindow?.localDay)

  const bestTimeReady =
    Boolean(canonicalBestWindow?.localHour != null)

  const bestDayText =
    bestDayReady
      ? canonicalBestWindow.localDay
      : "More history needed"

  const bestTimeText =
    bestTimeReady
      ? fmtHour(canonicalBestWindow.localHour)
      : "Warming up"

  // ----------------------------------------------------------
  // CONTEXTUAL INSIGHTS
  // ----------------------------------------------------------

  const warningInsight =
    insights.find(i => i?.icon === "📉") ||
    null

  const opportunityInsight =
    insights.find(i => i && i !== warningInsight) ||
    null

  const positiveInsight =
    opportunityInsight ||
    insights[0] ||
    null

  // The canonical engine deliberately produces NO cumulative dollar total —
  // rate gap x off-window hours implies a counterfactual the data cannot
  // support (91% of lifetime earnings on the regression fixture). See the
  // long-form rationale in lib/analytics/missedRevenue.js.
  //
  // So this card reports what IS measured: the largest per-platform RATE GAP
  // in $/hour between that platform's best window and its typical hour. The
  // previous code read `missedRevenue`/`usd`/`amount` off each entry — none
  // of which the canonical shape carries — and would have invented a dollar
  // total even if they had existed.
  const revenueLeakEntries = Object.entries(
    missedRevenueByPlatform || {}
  ).filter(([, v]) => Number(v?.rateGapUsdPerHour || 0) > 0)

  const largestRevenueLeak =
    revenueLeakEntries.length
      ? revenueLeakEntries.sort(
          (a, b) =>
            Number(b[1]?.rateGapUsdPerHour || 0) -
            Number(a[1]?.rateGapUsdPerHour || 0)
        )[0]
      : null

  const largestRevenueLeakPlatform = largestRevenueLeak?.[0] || null

  const largestRevenueLeakRate =
    largestRevenueLeak
      ? Number(largestRevenueLeak[1]?.rateGapUsdPerHour || 0)
      : 0

  // ----------------------------------------------------------
  // TRACKING
  // ----------------------------------------------------------

  const track = (name, props) => {
    try {
      gtmTrack(name, props)
    } catch (_) {}
  }

  useEffect(() => {
    track("creator_report_viewed", {
      reportState,
      tipCount,
      meaningfulSessionCount,
      platformCount,
      isPro,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----------------------------------------------------------
  // IMPORT HANDLER
  // ----------------------------------------------------------

  const handleImport = () => {
    track("creator_report_import_more_click", {
      reportState,
      tipCount,
      meaningfulSessionCount,
    })

    /*
      CreatorReport currently doesn't receive a navigation callback.
      Dispatch a lightweight browser event so the dashboard can optionally
      listen later without breaking the current component API.

      If the dashboard doesn't listen, nothing happens.
      The button still remains safe.
    */
    try {
      window.dispatchEvent(
        new CustomEvent("camcash:creator-report-import")
      )
    } catch (_) {}
  }

  // ----------------------------------------------------------
  // UPGRADE HANDLER
  // ----------------------------------------------------------

  const handleUpgrade = (source = "creator_report") => {
    track("creator_report_upgrade_click", {
      source,
      reportState,
      tipCount,
      meaningfulSessionCount,
      platformCount,
    })

    onUpgrade?.()
  }

  // ----------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------

  return (
    <div>
      {/* ======================================================
          HEADER
      ====================================================== */}

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 15,
          marginBottom: 17,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: C.white,
              }}
            >
              🧾 Your Creator Report
            </div>

            <div
              style={{
                padding: "4px 7px",
                borderRadius: 20,
                fontSize: 8,
                fontWeight: 900,
                color:
                  reportState === "rich"
                    ? C.green
                    : reportState === "developing"
                      ? C.cyan
                      : C.gold,
                background:
                  reportState === "rich"
                    ? "rgba(16,185,129,0.08)"
                    : reportState === "developing"
                      ? "rgba(34,211,238,0.08)"
                      : "rgba(245,158,11,0.08)",
              }}
            >
              {reportState === "rich"
                ? "HIGH SIGNAL"
                : reportState === "developing"
                  ? "DEVELOPING"
                  : "EARLY SIGNAL"}
            </div>
          </div>

          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: C.muted,
            }}
          >
            Your numbers become more useful as CamCash
            gets more history to work with.
          </div>
        </div>

        {!isPro && (
          <ProButton
            source="creator_report_header"
            onClick={() =>
              handleUpgrade("creator_report_header")
            }
          >
            Unlock Creator Pro
          </ProButton>
        )}
      </div>

      {/* ======================================================
          CALIBRATION
      ====================================================== */}

      <CalibrationCard
        tipsCount={tipCount}
        sessionCount={meaningfulSessionCount}
        platformCount={platformCount}
        isPro={isPro}
        onImport={handleImport}
        hasBestWindow={hasBestWindow}
        hourlyRateUnlocked={hourlyRateUnlocked}
      />

      {/* ======================================================
          CORE NUMBERS
      ====================================================== */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(175px,1fr))",
          gap: 11,
          marginBottom: 19,
        }}
      >
        <StatCard
          index={0}
          icon="💰"
          label="Total Earnings"
          value={fmtUsd(totalUSD)}
          sub={
            monthGrowthPct !== null
              ? `${monthGrowthPct >= 0 ? "↑" : "↓"} ${Math.abs(monthGrowthPct)}% vs last month`
              : `${fmtNumber(tipCount)} tips tracked`
          }
        />

        <StatCard
          index={1}
          icon="⏱️"
          label="Avg $/Hour"
          value={
            hourlyRateUnlocked && hourlyRate > 0
              ? fmtUsd(hourlyRate)
              : "Warming up"
          }
          sub={
            hourlyRateUnlocked
              ? `Based on ${hourlyRateSessionCount} eligible sessions`
              : `Needs 3 eligible sessions + 60m tracked`
          }
          status={
            hourlyRateUnlocked
              ? null
              : "warming"
          }
        />

        <StatCard
          index={2}
          icon="📅"
          label="Best Streaming Day"
          value={bestDayText}
          sub={
            bestDayReady
              ? `${canonicalBestWindow.sessionCount || 0} qualifying sessions`
              : "More variance required to isolate your peak day"
          }
          status={
            bestDayReady
              ? null
              : "warming"
          }
        />

        <StatCard
          index={3}
          icon="⏰"
          label="Best Streaming Time"
          value={bestTimeText}
          sub={
            bestTimeReady
              ? `${fmtUsd(canonicalBestWindow.medianUsdPerHour || 0)}/hr median`
              : "More session history needed"
          }
          status={
            bestTimeReady
              ? null
              : "warming"
          }
        />

        <StatCard
          index={0}
          icon="👑"
          label="Top Supporter"
          value={
            topSupporter?.username ||
            "Building fan history"
          }
          sub={
            topSupporter
              ? `${fmtUsd(topSupporter.usd || topSupporter.totalUSD || 0, 2)} lifetime`
              : `${fmtNumber(tipCount)} tips imported`
          }
        />

        <StatCard
          index={1}
          icon="🎯"
          label="Top Platform"
          value={
            topPlatform
              ? displayPlatform(topPlatform.platform)
              : platformCount
                ? displayPlatform(
                    tips.find(t => t?.platform)?.platform
                  )
                : "Waiting for data"
          }
          sub={
            topPlatform
              ? `${fmtUsd(topPlatform.usdPerHour || 0)}/hr`
              : platformCount
                ? "Building platform performance"
                : "Import platform history"
          }
        />
      </div>

      {/* ======================================================
          PLATFORM INTELLIGENCE
      ====================================================== */}

      <div
        style={{
          marginBottom: 19,
          borderRadius: 18,
          padding: "17px 18px",
          background: C.card,
          border: `1px solid ${C.border}`,
        }}
      >
        <SectionHeader
          eyebrow="Your data by platform"
          title="🌐 Platform Performance"
          description="Each platform builds its own history as you import it. Pro adds deeper cross-platform analysis."
        />

        <PlatformCards
          platforms={platforms}
          tips={tips}
          isPro={isPro}
          onUpgrade={() =>
            handleUpgrade("creator_report_multi_platform")
          }
        />
      </div>

      {/* ======================================================
          WHAT YOUR DATA IS SAYING
      ====================================================== */}

      <div
        style={{
          marginBottom: 19,
          borderRadius: 18,
          padding: "17px 18px",
          background: C.card,
          border: `1px solid ${C.border}`,
        }}
      >
        <SectionHeader
          eyebrow="Free insights"
          title="📊 What Your Data Is Saying"
          description="These insights become more reliable as your history grows."
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(235px,1fr))",
            gap: 10,
          }}
        >
          <InsightState
            icon="📅"
            title="Best Day"
            state={
              bestDayReady
                ? "ready"
                : "warming"
            }
            onImport={handleImport}
          >
            {bestDayReady
              ? `Your strongest day so far is ${canonicalBestWindow.localDay}.`
              : "More variance is needed before CamCash can confidently isolate your strongest day."}
          </InsightState>

          <InsightState
            icon="⏰"
            title="Best Time"
            state={
              bestTimeReady
                ? "ready"
                : "warming"
            }
            onImport={handleImport}
          >
            {bestTimeReady
              ? `Your strongest window currently centers around ${fmtHour(canonicalBestWindow.localHour)}.`
              : "CamCash is still collecting enough session history to identify a reliable timing pattern."}
          </InsightState>

          <InsightState
            icon="💡"
            title="Opportunity"
            state={
              positiveInsight
                ? "ready"
                : "warming"
            }
            onImport={handleImport}
          >
            {positiveInsight?.text ||
              "As more sessions arrive, CamCash will surface patterns worth acting on."}
          </InsightState>

          <InsightState
            icon="⚠️"
            title="Worth Watching"
            state={
              warningInsight
                ? "ready"
                : "warming"
            }
            onImport={handleImport}
          >
            {warningInsight?.text ||
              (tipCount > 0
                ? "No major warning has been detected in the current history."
                : "Import more history and CamCash will begin checking for performance warnings.")}
          </InsightState>
        </div>
      </div>

      {/* ======================================================
          "WE FOUND SOMETHING"
      ====================================================== */}

      {positiveInsight && (
        <div
          style={{
            marginBottom: 19,
            padding: "16px 18px",
            borderRadius: 17,
            background:
              "linear-gradient(135deg,rgba(16,185,129,0.08),rgba(34,211,238,0.04))",
            border:
              "1px solid rgba(16,185,129,0.18)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 900,
              color: C.green,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
            }}
          >
            🔎 CamCash found something
          </div>

          <div
            style={{
              marginTop: 5,
              fontSize: 14,
              lineHeight: 1.6,
              color: C.white,
            }}
          >
            {positiveInsight.text}
          </div>

          {!isPro && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 12,
                paddingTop: 11,
                borderTop:
                  "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  lineHeight: 1.5,
                  color: C.muted,
                }}
              >
                Pro can turn this pattern into a
                specific next-stream action.
              </div>

              <ProButton
                compact
                source="creator_report_pattern_found"
                onClick={() =>
                  handleUpgrade(
                    "creator_report_pattern_found"
                  )
                }
              >
                Show Me What To Do →
              </ProButton>
            </div>
          )}
        </div>
      )}

      {/* ======================================================
          WHAT YOUR HISTORY SHOWS — SQL engine insight feed
          Rendered straight from get_user_insights. Plan scoping and
          ordering are applied server-side; this adds no logic of its own.
      ====================================================== */}

      {engineFeed.length > 0 && (
        <div style={{ marginBottom: 19 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 900,
              color: C.cyan,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 10,
            }}
          >
            What your history shows
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {engineFeed.map((insight, i) => {
              const accent = engineImpactColor(insight.impact)
              return (
                <div
                  key={`${insight.type || "insight"}-${i}`}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 15,
                    background: C.card2,
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${accent}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 800,
                      lineHeight: 1.45,
                      color: C.white,
                    }}
                  >
                    {insight.title}
                  </div>

                  {insight.body && (
                    <div
                      style={{
                        marginTop: 5,
                        fontSize: 12.5,
                        lineHeight: 1.55,
                        color: C.muted,
                      }}
                    >
                      {insight.body}
                    </div>
                  )}

                  {insight.action && (
                    <div
                      style={{
                        marginTop: 9,
                        fontSize: 12,
                        lineHeight: 1.5,
                        fontWeight: 600,
                        color: accent,
                      }}
                    >
                      → {insight.action}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {engineLockedCount > 0 && (
            <div
              style={{
                marginTop: 11,
                padding: "12px 16px",
                borderRadius: 15,
                background: "rgba(168,85,247,0.06)",
                border: "1px solid rgba(168,85,247,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: C.muted,
                }}
              >
                {engineLockedCount === 1
                  ? "1 more insight is ready from this data — it tells you what to do next."
                  : `${engineLockedCount} more insights are ready from this data — they tell you what to do next.`}
              </div>

              <ProButton
                compact
                source="creator_report_engine_insights"
                onClick={() =>
                  handleUpgrade("creator_report_engine_insights")
                }
              >
                Unlock These →
              </ProButton>
            </div>
          )}
        </div>
      )}

      {/* ======================================================
          REVENUE OPPORTUNITY
      ====================================================== */}

      {largestRevenueLeakRate > 0 ? (
        <ProPreview
          icon="⚡"
          eyebrow="Revenue opportunity"
          title={`Your best ${displayPlatform(largestRevenueLeakPlatform)} window earns ${fmtUsd(largestRevenueLeakRate, 2)}/hr more than your typical hour`}
          description={`Measured as the gap between that platform's best-window median hourly rate and its overall median — not a projected total.`}
          preview={`🔒 Pro shows which window that is, how many hours you streamed outside it, and what to change first.`}
          source="creator_report_revenue_opportunity"
          onUpgrade={() =>
            handleUpgrade(
              "creator_report_revenue_opportunity"
            )
          }
        />
      ) : (
        !isPro &&
        hasRichData && (
          <ProPreview
            icon="⚡"
            eyebrow="Advanced opportunity analysis"
            title="Your history is rich enough for deeper opportunity analysis"
            description="You have enough historical sessions for CamCash to go beyond basic reporting."
            preview="🔒 Pro adds deeper platform, timing and revenue-opportunity analysis."
            source="creator_report_advanced_opportunity"
            onUpgrade={() =>
              handleUpgrade(
                "creator_report_advanced_opportunity"
              )
            }
          />
        )
      )}

      {/* ======================================================
          FAN / VIP INTELLIGENCE
      ====================================================== */}

      <div
        style={{
          marginTop: 19,
          marginBottom: 19,
          borderRadius: 18,
          padding: "17px 18px",
          background: C.card,
          border: `1px solid ${C.border}`,
        }}
      >
        <SectionHeader
          eyebrow="Supporter intelligence"
          title="👑 Your Highest-Value Supporters"
          description="Your top supporter is available in Free. Pro goes deeper into who needs attention."
        />

        {topSupporter ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(235px,1fr))",
              gap: 10,
            }}
          >
            <div
              style={{
                padding: 14,
                borderRadius: 13,
                background:
                  "rgba(245,158,11,0.06)",
                border:
                  "1px solid rgba(245,158,11,0.16)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  color: C.gold,
                  textTransform: "uppercase",
                }}
              >
                👑 Top supporter
              </div>

              <div
                style={{
                  marginTop: 7,
                  fontSize: 15,
                  fontWeight: 850,
                  color: C.white,
                }}
              >
                {topSupporter.username}
              </div>

              <div
                style={{
                  marginTop: 3,
                  fontSize: 12,
                  color: C.muted,
                }}
              >
                {fmtUsd(
                  topSupporter.usd ||
                    topSupporter.totalUSD ||
                    0,
                  2
                )} lifetime
              </div>
            </div>

            {!isPro ? (
              <ProPreview
                icon="👑"
                eyebrow="VIP intelligence"
                title="Find supporters who are cooling off"
                description="Your top spender is only part of the picture."
                preview="🔒 Pro can surface deeper supporter patterns and help identify who deserves attention next."
                source="creator_report_vip"
                onUpgrade={() =>
                  handleUpgrade(
                    "creator_report_vip"
                  )
                }
              />
            ) : (
              <div
                style={{
                  padding: 14,
                  borderRadius: 13,
                  background:
                    "rgba(16,185,129,0.05)",
                  border:
                    "1px solid rgba(16,185,129,0.14)",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    color: C.green,
                    textTransform: "uppercase",
                  }}
                >
                  VIP signals
                </div>

                <div
                  style={{
                    marginTop: 7,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: C.muted,
                  }}
                >
                  {topFanDependency
                    ? "Your supporter-dependency analytics are available from your existing data."
                    : returningVsNew
                      ? "Returning-vs-new supporter data is available."
                      : "Keep importing history to strengthen supporter signals."}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              padding: 15,
              borderRadius: 12,
              background:
                "rgba(255,255,255,0.025)",
              border:
                "1px dashed rgba(255,255,255,0.08)",
              fontSize: 11,
              color: C.muted,
            }}
          >
            Keep importing tips and CamCash will
            start building your supporter intelligence.
          </div>
        )}
      </div>

      {/* ======================================================
          RECOMMENDED ACTIONS
      ====================================================== */}

      <div
        style={{
          borderRadius: 18,
          padding: "17px 18px",
          background: C.card,
          border: `1px solid ${C.border}`,
        }}
      >
        <SectionHeader
          eyebrow="Your next move"
          title="🎯 Recommended For Your Next Stream"
          description={
            isPro
              ? "These recommendations are based on your existing analytics."
              : "Free shows you the first useful action. Pro unlocks the deeper action layer."
          }
        />

        {nextMoves.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 9,
            }}
          >
            {nextMoves
              .slice(0, 3)
              .map((move, index) => {
                const unlocked =
                  isPro || index === 0

                if (unlocked) {
                  return (
                    <div
                      key={index}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 11,
                        padding: "11px 12px",
                        borderRadius: 11,
                        background:
                          "rgba(16,185,129,0.045)",
                        border:
                          "1px solid rgba(16,185,129,0.13)",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>
                        {move.icon || "🎯"}
                      </span>

                      <div
                        style={{
                          flex: 1,
                          fontSize: 12,
                          lineHeight: 1.55,
                          color: C.white,
                        }}
                      >
                        {move.text}
                      </div>
                    </div>
                  )
                }

                return (
                  <LockedAction
                    key={index}
                    icon={move.icon || "🔒"}
                    title={
                      index === 1
                        ? "Reveal your next personalized action"
                        : "Reveal your advanced next-stream action"
                    }
                    description={
                      index === 1
                        ? "Pro turns your history into a specific recommendation."
                        : "Unlock the remaining recommendation from your data."
                    }
                    source={
                      index === 1
                        ? "creator_report_action_2"
                        : "creator_report_action_3"
                    }
                    onUpgrade={() =>
                      handleUpgrade(
                        index === 1
                          ? "creator_report_action_2"
                          : "creator_report_action_3"
                      )
                    }
                  />
                )
              })}
          </div>
        ) : (
          <div
            style={{
              padding: 14,
              borderRadius: 11,
              background:
                "rgba(255,255,255,0.025)",
              border:
                "1px dashed rgba(255,255,255,0.07)",
              fontSize: 11,
              lineHeight: 1.5,
              color: C.muted,
            }}
          >
            Your recommendation engine is warming up.
            Import more session history and CamCash will
            have more patterns to work with.
          </div>
        )}

        {!isPro && nextMoves.length > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 14,
              padding: "12px 13px",
              borderRadius: 12,
              background:
                "linear-gradient(90deg,rgba(236,72,153,0.07),rgba(168,85,247,0.07))",
              border:
                "1px solid rgba(236,72,153,0.14)",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 850,
                  color: C.white,
                }}
              >
                Want the full action plan?
              </div>

              <div
                style={{
                  marginTop: 3,
                  fontSize: 10,
                  color: C.muted,
                }}
              >
                Unlock the remaining recommendations
                generated from your history.
              </div>
            </div>

            <ProButton
              compact
              source="creator_report_recommended_actions"
              onClick={() =>
                handleUpgrade(
                  "creator_report_recommended_actions"
                )
              }
            >
              Unlock All Actions →
            </ProButton>
          </div>
        )}
      </div>

      {/* ======================================================
          "WHAT SHOULD I DO TONIGHT?"
      ====================================================== */}

      {!isPro && (
        <div
          style={{
            marginTop: 19,
            borderRadius: 18,
            padding: "17px 18px",
            background:
              "linear-gradient(135deg,rgba(34,211,238,0.06),rgba(168,85,247,0.07),rgba(236,72,153,0.06))",
            border:
              "1px solid rgba(34,211,238,0.14)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 900,
              color: C.cyan,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
            }}
          >
            🎯 Before your next stream
          </div>

          <div
            style={{
              marginTop: 5,
              fontSize: 15,
              fontWeight: 850,
              color: C.white,
            }}
          >
            Want CamCash to build your next-stream plan?
          </div>

          <div
            style={{
              marginTop: 5,
              maxWidth: 650,
              fontSize: 11,
              lineHeight: 1.55,
              color: C.muted,
            }}
          >
            Pro can combine your historical timing,
            platform performance and supporter signals
            into a personalized action plan instead of
            leaving you to interpret the numbers yourself.
          </div>

          <div style={{ marginTop: 12 }}>
            <ProButton
              source="creator_report_next_stream_plan"
              onClick={() =>
                handleUpgrade(
                  "creator_report_next_stream_plan"
                )
              }
            >
              Build My Next-Stream Plan →
            </ProButton>
          </div>
        </div>
      )}

      {/* ======================================================
          POWER USER CONVERSION
      ====================================================== */}

      {!isPro && hasRichData && (
        <div
          style={{
            marginTop: 19,
            padding: "19px 20px",
            borderRadius: 19,
            textAlign: "center",
            background:
              "linear-gradient(135deg,rgba(236,72,153,0.09),rgba(168,85,247,0.09))",
            border:
              "1px solid rgba(236,72,153,0.19)",
          }}
        >
          <div style={{ fontSize: 21 }}>
            🚀
          </div>

          <div
            style={{
              marginTop: 5,
              fontSize: 17,
              fontWeight: 900,
              color: C.white,
            }}
          >
            You've given CamCash enough data to go deeper.
          </div>

          <div
            style={{
              maxWidth: 580,
              margin: "6px auto 0",
              fontSize: 11,
              lineHeight: 1.55,
              color: C.muted,
            }}
          >
            {fmtNumber(tipCount)} tips ·{" "}
            {fmtNumber(meaningfulSessionCount)} sessions
            {platformCount
              ? ` · ${platformCount} platform${platformCount === 1 ? "" : "s"}`
              : ""}
            . Your history is now rich enough for
            advanced intelligence beyond the basic report.
          </div>

          <div style={{ marginTop: 13 }}>
            <ProButton
              source="creator_report_power_user"
              onClick={() =>
                handleUpgrade(
                  "creator_report_power_user"
                )
              }
            >
              Unlock Creator Pro →
            </ProButton>
          </div>
        </div>
      )}
    </div>
  )
}
