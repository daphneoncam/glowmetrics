// Same-site redirect targets only.
//
// A post-login `?to=` value goes into window.location.href. Unchecked, that
// lets anyone build a link that sends users to another site after sign-in
// (open redirect) or runs script via `javascript:` (CodeQL
// js/client-side-unvalidated-url-redirection). Only a path on this site is
// accepted, e.g. "/dashboard?tab=sessions". Anything else gets the fallback.
export function safeRedirectPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string') return fallback
  // Must be a single leading slash: "//evil.com" and "/\evil.com" are
  // protocol-relative URLs to another host in browsers.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  // Control characters (tabs/newlines are stripped by browsers, so
  // "/\t/evil.com" would become "//evil.com").
  if (/[\u0000-\u001F\u007F]/.test(value)) return fallback
  try {
    const base = 'https://same-site.invalid'
    const url = new URL(value, base)
    if (url.origin !== base) return fallback
    return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
}
