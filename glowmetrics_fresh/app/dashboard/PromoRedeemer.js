"use client"
import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { track } from "../../lib/track"

// Redeems a promo link such as /dashboard?promo=THANKYOU14 (the "Pro trial"
// email's claim button) through the existing database function
// public.redeem_promo_code(), which grants promo Pro with an end date. The
// database decides everything (validity, limits, one promo per account,
// already-Pro accounts are refused); this component only passes the code and
// shows the result. If the visitor isn't signed in yet, the code is kept on
// this device and redeemed right after they sign in.

export const PENDING_KEY = "camcash_pending_promo"
const RESULT_KEY = "camcash_promo_result"

const MESSAGES = {
  already_redeemed: "You've already used a promo code on this account.",
  invalid_code: "That promo code isn't valid.",
  inactive_code: "That promo code is no longer active.",
  expired_code: "That promo code has expired.",
  code_exhausted: "That promo code has been fully claimed.",
  already_pro: "You already have Pro, so this code wasn't needed. Nothing was changed.",
}

export function reasonFrom(error) {
  const msg = String(error?.message || "")
  return Object.keys(MESSAGES).find((k) => msg.includes(k)) || (msg.includes("not_authenticated") ? "not_authenticated" : "unknown")
}

function cleanCode(raw) {
  const code = String(raw || "").trim().toUpperCase()
  return /^[A-Z0-9_-]{3,40}$/.test(code) ? code : null
}

const safe = (fn) => { try { return fn() } catch { return null } }

// Indirection so tests can observe the reload (jsdom cannot navigate).
export const page = { reload: () => window.location.reload() }

export default function PromoRedeemer() {
  const [notice, setNotice] = useState(null) // { tone: 'success'|'error', text }

  useEffect(() => {
    let cancelled = false

    // A result saved just before the reload that refreshes the plan.
    const saved = safe(() => sessionStorage.getItem(RESULT_KEY))
    if (saved) {
      safe(() => sessionStorage.removeItem(RESULT_KEY))
      const parsed = safe(() => JSON.parse(saved))
      if (parsed?.text) setNotice(parsed)
    }

    // Take ?promo= off the URL and keep it until it can be redeemed.
    const url = new URL(window.location.href)
    const fromUrl = cleanCode(url.searchParams.get("promo"))
    if (url.searchParams.has("promo")) {
      url.searchParams.delete("promo")
      window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash)
    }
    if (fromUrl) safe(() => localStorage.setItem(PENDING_KEY, fromUrl))

    const code = cleanCode(safe(() => localStorage.getItem(PENDING_KEY)))
    if (!code) return

    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) return // redeemed after sign-in

      track("promo_redeem_attempted", { code })
      const { data, error } = await supabase.rpc("redeem_promo_code", { p_code: code })
      if (cancelled) return

      if (error) {
        const reason = reasonFrom(error)
        if (reason === "not_authenticated") return // keep it for after sign-in
        if (reason !== "unknown") safe(() => localStorage.removeItem(PENDING_KEY))
        track("promo_redeem_failed", { code, reason })
        setNotice({ tone: "error", text: MESSAGES[reason] || "We couldn't apply that promo code right now. Please try the link again in a moment." })
        return
      }

      safe(() => localStorage.removeItem(PENDING_KEY))
      const days = data?.duration_days
      const until = data?.plan_expires_at ? new Date(data.plan_expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null
      track("promo_redeemed", { code, duration_days: days })
      const text = `🎉 You've got ${days ? `${days} days of ` : ""}CamCash Pro${until ? ` — free until ${until}` : ""}. No card needed; you'll go back to Free automatically after.`
      // Reload so every part of the dashboard picks up the Pro plan.
      safe(() => sessionStorage.setItem(RESULT_KEY, JSON.stringify({ tone: "success", text })))
      page.reload()
    })().catch(() => {})

    return () => { cancelled = true }
  }, [])

  if (!notice) return null
  const success = notice.tone === "success"
  return (
    <div role="status" data-testid="promo-notice" style={{
      position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 1100,
      maxWidth: 560, width: "calc(100% - 32px)", boxSizing: "border-box",
      display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", borderRadius: 14,
      background: "rgba(10,14,32,0.96)", backdropFilter: "blur(16px)",
      border: `1px solid ${success ? "rgba(22,244,255,0.45)" : "rgba(255,43,174,0.45)"}`,
      boxShadow: "0 10px 40px rgba(0,0,0,0.5)", color: "#F1F5F9", fontSize: 14, lineHeight: 1.5,
    }}>
      <div style={{ flex: 1 }}>{notice.text}</div>
      <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}
        style={{ background: "transparent", border: "none", color: "#8D93AA", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
    </div>
  )
}
