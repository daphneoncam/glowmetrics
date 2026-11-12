import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyAdminToken, getAdminTokenFromCookieHeader } from '../../../../lib/adminAuth'

const TEST_EMAIL_PATTERNS = [
  'daphneoncam+test',
  'daphenoncam+testing',
  'camcashgrl+testing',
]

function isTestAccount(email) {
  if (!email) return false
  const e = email.toLowerCase()
  return TEST_EMAIL_PATTERNS.some(p => e.includes(p))
}

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function GET(req) {
  const token = getAdminTokenFromCookieHeader(req.headers.get('cookie'))
  if (!verifyAdminToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = sb()

  try {
    // Fetch all users
    const { data: { users }, error } = await client.auth.admin.listUsers({ perPage: 1000 })

    if (error) throw error

    // Filter out test accounts
    const realUsers = users.filter(u => !isTestAccount(u.email))

    // Group by day of week
    const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const signupsByDayOfWeek = {
      0: { day: 'Sunday',    count: 0 },
      1: { day: 'Monday',    count: 0 },
      2: { day: 'Tuesday',   count: 0 },
      3: { day: 'Wednesday', count: 0 },
      4: { day: 'Thursday',  count: 0 },
      5: { day: 'Friday',    count: 0 },
      6: { day: 'Saturday',  count: 0 },
    }

    // Count signups by day of week
    for (const user of realUsers) {
      const createdDate = new Date(user.created_at)
      const dayOfWeek = createdDate.getUTCDay() // 0 = Sunday, 6 = Saturday
      signupsByDayOfWeek[dayOfWeek].count++
    }

    // Convert to array and calculate percentages
    const data = Object.values(signupsByDayOfWeek).map(item => ({
      ...item,
      percentage: realUsers.length > 0 ? ((item.count / realUsers.length) * 100).toFixed(1) : 0
    }))

    // Calculate statistics
    const total = realUsers.length
    const average = (total / 7).toFixed(2)
    const max = Math.max(...data.map(d => d.count))
    const min = Math.min(...data.map(d => d.count))

    return NextResponse.json({
      data,
      stats: {
        totalSignups: total,
        averagePerDay: average,
        maxDay: data.find(d => d.count === max)?.day || 'N/A',
        maxCount: max,
        minDay: data.find(d => d.count === min)?.day || 'N/A',
        minCount: min,
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error in signups-by-dow:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch signups by day of week' },
      { status: 500 }
    )
  }
}
