// Trusted base URL for server-built redirects and links.
//
// Never use the incoming request's origin (req.url, Host, X-Forwarded-Host)
// unchecked: those come from the client, and using them for redirects or
// server-side requests lets an attacker choose the destination (CodeQL
// js/request-forgery, open redirect). Only server-controlled configuration is
// trusted:
//   - production (VERCEL_ENV=production) -> the canonical site, the same
//     address lib/email/sendEmail.js SITE_URL and the sitemap use
//   - Vercel preview/staging -> https://<VERCEL_URL>, which Vercel itself sets
//     to the deployment's own hostname
//   - local development / tests -> http://localhost:3000
export const CANONICAL_SITE_URL = 'https://www.camcashgrl.com'

const PRODUCTION_HOSTS = ['www.camcashgrl.com', 'camcashgrl.com']
const VERCEL_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i

function vercelHost(name) {
  const v = process.env[name]
  return v && VERCEL_HOST.test(v) ? v.toLowerCase() : null
}

export function getTrustedBaseUrl() {
  if (process.env.VERCEL_ENV === 'production') return CANONICAL_SITE_URL
  const deployment = vercelHost('VERCEL_URL')
  if (deployment) return `https://${deployment}`
  return 'http://localhost:3000'
}

// Hostnames this deployment legitimately serves, from server-set config only.
function allowedHosts() {
  const hosts = new Set(PRODUCTION_HOSTS)
  for (const name of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const h = vercelHost(name)
    if (h) hosts.add(h)
  }
  return hosts
}

// Origin to use for a redirect back to this site. Keeps the request's own
// origin when its host is one this deployment serves (so the Supabase session
// cookies just set on that host stay valid after the redirect, e.g. a preview
// branch URL or the apex domain), otherwise falls back to getTrustedBaseUrl().
// An attacker-supplied Host / X-Forwarded-Host can therefore never become the
// redirect destination.
export function getTrustedOrigin(req) {
  let url
  try { url = new URL(req?.url) } catch { return getTrustedBaseUrl() }

  const host = url.hostname.toLowerCase()
  const isLocal = process.env.VERCEL_ENV !== 'production' && process.env.NODE_ENV !== 'production'
    && (host === 'localhost' || host === '127.0.0.1')

  if (isLocal && (url.protocol === 'http:' || url.protocol === 'https:')) return url.origin
  if (url.protocol === 'https:' && !url.port && allowedHosts().has(host)) return `https://${host}`
  return getTrustedBaseUrl()
}
