// Post-login ?to= redirects must stay on this site (lib/safe-redirect.js,
// used by app/preview-login).
import { safeRedirectPath } from '../safe-redirect'

describe('safeRedirectPath', () => {
  test.each([
    ['/dashboard', '/dashboard'],
    ['/dashboard?tab=sessions', '/dashboard?tab=sessions'],
    ['/live#tips', '/live#tips'],
    ['/onboarding/chaturbate', '/onboarding/chaturbate'],
  ])('keeps same-site path %p', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected)
  })

  test.each([
    null,
    undefined,
    '',
    'dashboard',
    'https://evil.example/',
    'http://evil.example',
    '//evil.example',
    '//evil.example/dashboard',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://www.camcashgrl.com.evil.example/',
  ])('rejects %p and uses /dashboard', (input) => {
    expect(safeRedirectPath(input)).toBe('/dashboard')
  })

  test('custom fallback', () => {
    expect(safeRedirectPath('//evil.example', '/landing')).toBe('/landing')
  })
})
