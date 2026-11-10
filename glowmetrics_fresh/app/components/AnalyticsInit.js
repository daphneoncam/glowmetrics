'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { initializeAnalytics, trackPageView } from '../../lib/analytics-client'

// Switches on the site-wide first-party tracker in lib/analytics-client.js
// (visit, page views, clicks on links/buttons, scroll milestones, time on
// page, client errors), which was written but never initialised, so
// click_events / engagement_events / user_sessions stayed empty. It records
// no typed values and drops query strings from URLs.
export default function AnalyticsInit() {
  const pathname = usePathname()
  const firstPath = useRef(null)

  useEffect(() => {
    try { initializeAnalytics() } catch {}
  }, [])

  // initializeAnalytics() records the first page view; later client-side
  // navigations record their own.
  useEffect(() => {
    if (firstPath.current === null) {
      firstPath.current = pathname
      return
    }
    try { trackPageView() } catch {}
  }, [pathname])

  return null
}
