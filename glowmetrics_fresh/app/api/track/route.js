import { createSupabaseRouteClient } from '../../../lib/supabase-server'

export async function POST(request) {
  try {
    const supabase = createSupabaseRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    const body = await request.json()
    const { event_name, properties = {}, session_id, url } = body

    if (!event_name) return new Response('Missing event_name', { status: 400 })

    const { error } = await supabase.from('analytics_events').insert({
      user_id: user?.id ?? null,
      session_id,
      event_name,
      properties,
      url,
    })

    if (error) {
      console.error('analytics_events insert failed:', error.message)
      return new Response('Error: ' + error.message, { status: 500 })
    }

    return new Response('ok', { status: 200 })
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 })
  }
}
