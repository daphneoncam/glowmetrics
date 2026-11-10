/**
 * @jest-environment node
 */
const { sendEmail, getUserEmail, formatTrialDate, EMAIL_FROM } = require('../sendEmail')

const logs = []
const supabase = {
  from: () => ({ insert: async (row) => { logs.push(row); return { error: null } } }),
  auth: { admin: { getUserById: jest.fn() } },
}

beforeEach(() => { logs.length = 0; process.env.RESEND_API_KEY = 're_test' })

test('sends from CamCash and logs pending then sent', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'em_1' }) }))
  expect(await sendEmail(supabase, 'x', 'a@b.org', 'S', 'T')).toBe(true)
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).from).toBe(EMAIL_FROM)
  expect(EMAIL_FROM).toBe('CamCash <noreply@camcashgrl.com>')
  expect(logs.map((l) => l.status)).toEqual(['pending', 'sent'])
})

test('Resend rejection is logged as failed and returns false', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 422, json: async () => ({ message: 'bad' }) }))
  expect(await sendEmail(supabase, 'x', 'a@b.org', 'S', 'T')).toBe(false)
  expect(logs[1]).toMatchObject({ status: 'failed', error_message: 'bad' })
})

test('missing API key fails without calling Resend', async () => {
  delete process.env.RESEND_API_KEY
  global.fetch = jest.fn()
  expect(await sendEmail(supabase, 'x', 'a@b.org', 'S', 'T')).toBe(false)
  expect(global.fetch).not.toHaveBeenCalled()
})

test('getUserEmail reads the auth user, null on error', async () => {
  supabase.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: { email: 'c@d.org' } }, error: null })
  expect(await getUserEmail(supabase, 'u1')).toBe('c@d.org')
  supabase.auth.admin.getUserById.mockResolvedValueOnce({ data: null, error: { message: 'nope' } })
  expect(await getUserEmail(supabase, 'u2')).toBeNull()
})

test('formatTrialDate is a stable UTC date', () => {
  expect(formatTrialDate('2026-11-09T23:30:00Z')).toBe('November 9, 2026')
  expect(formatTrialDate('garbage')).toBe('soon')
})
