import { createSupabaseRouteClient } from '../../../lib/supabase-server'

export async function POST(request) {
  try {
    const supabase = createSupabaseRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    const body = await request.json()
    const { event_name, properties = {}, session_id, url } = body

    if (!event_name || typeof event_name !== 'string' || event_name.length > 100) {
      return new Response('Invalid event_name', { status: 400 })
    }
    if (typeof properties !== 'object' || properties === null || JSON.stringify(properties).length > 5000) {
      return new Response('Invalid properties', { status: 400 })
    }

    await supabase.from('analytics_events').insert({
      user_id: user?.id ?? null,
      session_id,
      event_name,
      properties,
      url,
    })

    return new Response('ok', { status: 200 })
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 })
  }
}
