/**
 * @jest-environment node
 */
// Trusted origins for server-built redirects (lib/site-url.js). The request's
// Host / X-Forwarded-Host must never decide where users are sent.
import { getTrustedBaseUrl, getTrustedOrigin, CANONICAL_SITE_URL } from '../site-url'

const ENV_KEYS = ['VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'NODE_ENV']
const saved = {}
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

// What a route handler sees when the client forges Host / X-Forwarded-Host.
const reqAt = (url) => ({ url, headers: { get: () => null } })

describe('getTrustedBaseUrl', () => {
  test('production is the canonical site', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_URL = 'glowmetrics-abc123.vercel.app'
    expect(getTrustedBaseUrl()).toBe('https://www.camcashgrl.com')
    expect(CANONICAL_SITE_URL).toBe('https://www.camcashgrl.com')
  })
  test('preview uses the deployment URL Vercel sets', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_URL = 'glowmetrics-abc123-team.vercel.app'
    expect(getTrustedBaseUrl()).toBe('https://glowmetrics-abc123-team.vercel.app')
  })
  test('a VERCEL_URL that is not a vercel.app host is ignored', () => {
    process.env.VERCEL_ENV = 'preview'
    for (const v of ['evil.com', 'evil.com/x.vercel.app', 'a.vercel.app.evil.com', 'user@x.vercel.app']) {
      process.env.VERCEL_URL = v
      expect(getTrustedBaseUrl()).toBe('http://localhost:3000')
    }
  })
  test('local development', () => {
    expect(getTrustedBaseUrl()).toBe('http://localhost:3000')
  })
})

describe('getTrustedOrigin', () => {
  test('production: keeps www and apex (session cookies are host-scoped)', () => {
    process.env.VERCEL_ENV = 'production'
    expect(getTrustedOrigin(reqAt('https://www.camcashgrl.com/api/auth/callback?code=x'))).toBe('https://www.camcashgrl.com')
    expect(getTrustedOrigin(reqAt('https://camcashgrl.com/api/auth/callback'))).toBe('https://camcashgrl.com')
    expect(getTrustedOrigin(reqAt('https://WWW.CamCashGrl.com/x'))).toBe('https://www.camcashgrl.com')
  })

  test.each([
    'https://evil.example/api/auth/callback',
    'https://www.camcashgrl.com.evil.example/',
    'https://evilcamcashgrl.com/',
    'https://attacker.vercel.app/',
    'http://www.camcashgrl.com/',          // downgrade to http
    'https://www.camcashgrl.com:8443/',    // unexpected port
    'http://localhost:3000/',              // localhost is not trusted in production
    'not a url',
    undefined,
  ])('production: forged origin %p falls back to the canonical site', (url) => {
    process.env.VERCEL_ENV = 'production'
    process.env.NODE_ENV = 'production'
    expect(getTrustedOrigin(reqAt(url))).toBe('https://www.camcashgrl.com')
  })

  test('preview: keeps the deployment and branch URLs, rejects other vercel.app hosts', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_URL = 'glowmetrics-abc123-team.vercel.app'
    process.env.VERCEL_BRANCH_URL = 'glowmetrics-git-feature-team.vercel.app'
    expect(getTrustedOrigin(reqAt('https://glowmetrics-git-feature-team.vercel.app/api/auth/callback'))).toBe('https://glowmetrics-git-feature-team.vercel.app')
    expect(getTrustedOrigin(reqAt('https://glowmetrics-abc123-team.vercel.app/api/auth/callback'))).toBe('https://glowmetrics-abc123-team.vercel.app')
    expect(getTrustedOrigin(reqAt('https://attacker-site.vercel.app/api/auth/callback'))).toBe('https://glowmetrics-abc123-team.vercel.app')
    expect(getTrustedOrigin(reqAt('https://evil.example/api/auth/callback'))).toBe('https://glowmetrics-abc123-team.vercel.app')
  })

  test('local development keeps localhost / 127.0.0.1 with their port', () => {
    process.env.NODE_ENV = 'development'
    expect(getTrustedOrigin(reqAt('http://localhost:3000/api/auth/callback'))).toBe('http://localhost:3000')
    expect(getTrustedOrigin(reqAt('http://127.0.0.1:3001/api/auth/callback'))).toBe('http://127.0.0.1:3001')
    expect(getTrustedOrigin(reqAt('https://evil.example/api/auth/callback'))).toBe('http://localhost:3000')
  })
})
