/**
 * @jest-environment node
 */
// Founder notification emails (lib/notifications/founder.js): sent directly by
// the server (no HTTP hop) and every interpolated value is HTML-escaped.
const mockSend = jest.fn(async () => ({ id: 'em_1' }))
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }))
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: () => ({ select: () => ({ schema: async () => ({ count: 42 }) }) }) })),
}))

import { escapeHtml, buildSignupEmail, buildUploadEmail, sendSignupNotification, sendUploadNotification } from '../notifications/founder'

beforeEach(() => { mockSend.mockClear(); global.fetch = jest.fn() })

test('escapeHtml escapes every HTML-significant character', () => {
  expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
})

test('signup email escapes an attacker-shaped email address', async () => {
  const { html, subject } = await buildSignupEmail({ email: '<img src=x onerror=alert(1)>@x.com', created_at: '2026-11-18T12:00:00Z' })
  expect(subject).toBe('🆕 New CamCash Signup')
  expect(html).not.toContain('<img src=x')
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;@x.com')
  expect(html).toContain('New CamCash Signup')
  expect(html).toContain('42')
})

test('upload email escapes platform, email, user id and keeps the tip count', () => {
  const { html, subject } = buildUploadEmail({
    email: 'model@example.com',
    platform: '<script>alert(1)</script>',
    tip_count: 1234,
    user_id: '"><a href="https://evil.example">',
  })
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<a href="https://evil.example">')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).toContain('model@example.com')
  expect(html).toContain('1,234')
  expect(subject).toBe('📁 New CSV Upload — <script>alert(1)</script>') // plain-text header, not HTML
})

test('upload email keeps the original fallbacks for missing values', () => {
  const { html, subject } = buildUploadEmail({})
  expect(subject).toBe('📁 New CSV Upload — Unknown')
  expect(html).toContain('New CSV Upload — Unknown')
  expect(html).toContain('—')
})

test('send functions go straight to Resend: no HTTP request to any app origin', async () => {
  await sendSignupNotification({ email: 'a@b.co', created_at: '2026-11-18T12:00:00Z' })
  await sendUploadNotification({ email: 'a@b.co', platform: 'Chaturbate', tip_count: 3, user_id: 'u1' })
  expect(global.fetch).not.toHaveBeenCalled()
  expect(mockSend).toHaveBeenCalledTimes(2)
  for (const [arg] of mockSend.mock.calls) {
    expect(arg.from).toBe('CamCash Notifications <notifications@camcashgrl.com>')
    expect(arg.to).toBe('daphneoncam@gmail.com')
  }
})
