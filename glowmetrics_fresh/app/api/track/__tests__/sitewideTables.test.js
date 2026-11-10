/**
 * @jest-environment node
 */
// click_events / engagement_events / user_sessions have no browser INSERT
// policy, so they are written with the service role. user_id must come only
// from the verified session, never from the request body.
const adminInserts = []
const userInserts = []
let mockUser = null

jest.mock('../../../../lib/supabase-server', () => ({
  createSupabaseRouteClient: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
    from: (table) => ({ insert: async (row) => { userInserts.push({ table, row }); return { error: null } } }),
  }),
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({ insert: async (row) => { adminInserts.push({ table, row }); return { error: null } } }),
  }),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
global.Response = { json: (body, init) => ({ body, status: init?.status || 200 }) }
const { POST } = require('../route')
const req = (body) => ({ json: async () => body })

beforeEach(() => { adminInserts.length = 0; userInserts.length = 0; mockUser = null })

test('click is written with the service role and the session user id', async () => {
  mockUser = { id: 'real-user' }
  const res = await POST(req({ eventType: 'click', pageUrl: '/pricing', properties: { buttonText: 'Choose Monthly', userId: 'someone-else', clickX: 10.6 } }))
  expect(res.body.success).toBe(true)
  expect(userInserts).toHaveLength(0)
  expect(adminInserts[0].table).toBe('click_events')
  expect(adminInserts[0].row).toMatchObject({ user_id: 'real-user', page_path: '/pricing', button_text: 'Choose Monthly', click_x: 11 })
})

test('anonymous visitor rows have a null user id', async () => {
  await POST(req({ eventType: 'engagement', pageUrl: '/', properties: { engagementType: 'page_view' } }))
  expect(adminInserts[0]).toMatchObject({ table: 'engagement_events', row: { user_id: null, event_type: 'page_view' } })
})

test('session rows land in user_sessions; long strings are truncated', async () => {
  await POST(req({ eventType: 'session', properties: { sessionId: 's1', utmSource: 'x'.repeat(1000) } }))
  expect(adminInserts[0].table).toBe('user_sessions')
  expect(adminInserts[0].row.session_id).toBe('s1')
  expect(adminInserts[0].row.utm_source).toHaveLength(200)
})

test('funnel events (lib/track.js) still go to analytics_events via the user client', async () => {
  await POST(req({ event_name: 'pricing_page_viewed', properties: {}, url: '/pricing' }))
  expect(userInserts[0].table).toBe('analytics_events')
  expect(adminInserts).toHaveLength(0)
})
