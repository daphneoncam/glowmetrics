'use client'

const fired = new Set()

export function track(event, params = {}) {
  try {
    if (typeof window === 'undefined') return
    if (process.env.NODE_ENV === 'development') {
      console.log('[Track]', event, params)
    }
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push({ event, ...params })
    if (typeof window.gtag === 'function') {
      window.gtag('event', event, params)
    }
  } catch (e) {}
}

export function trackOnce(event, params = {}) {
  if (fired.has(event)) return
  fired.add(event)
  track(event, params)
}

export function setUserProps(props = {}) {
  try {
    if (typeof window === 'undefined') return
    if (typeof window.gtag === 'function') {
      window.gtag('set', 'user_properties', props)
    }
  } catch (e) {}
}

export function getSource() {
  if (typeof window === 'undefined') return 'direct'
  const p = new URLSearchParams(window.location.search)
  return p.get('utm_source') ||
    (document.referrer
      ? (() => { try { return new URL(document.referrer).hostname } catch { return 'referral' } })()
      : 'direct')
}

export const T = {
  signupCtaClicked:      (page)          => track('signup_cta_clicked',       { page_path: page, traffic_source: getSource() }),
  signupStarted:         (page)          => trackOnce('signup_started',        { source_page: page, traffic_source: getSource() }),
  signupCompleted:       (page)          => track('signup_completed',          { signup_method: 'email', source_page: page, traffic_source: getSource() }),
  csvUploadStarted:      ()              => trackOnce('csv_upload_started',    { file_type: 'csv' }),
  csvUploadCompleted:    (rows, ms)      => track('csv_upload_completed',      { file_type: 'csv', rows_imported: rows || 0, import_duration: ms || 0 }),
  csvUploadFailed:       (err)           => track('csv_upload_failed',         { error_type: err || 'unknown' }),
  extensionInstallStart: ()              => trackOnce('extension_install_started', { browser: 'chrome' }),
  dashboardFirstView:    (method, plat)  => trackOnce('dashboard_first_view', { onboarding_method: method, platform: plat }),
  dashboardPopulated:    (plat, count)   => trackOnce('dashboard_populated',  { platform: plat, earnings_records_count: count }),
  dashboardSession:      (platCount)     => trackOnce('dashboard_session_started', { platform_count: platCount }),
  paywallViewed:         (feature)       => track('paywall_viewed',            { feature_name: feature }),
  upgradeClicked:        (feature)       => track('upgrade_clicked',           { feature_name: feature }),
  purchase:              (params = {})   => track('purchase', params),
}

export function captureAttribution() {
  try {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('camcash_attribution')) return // first touch wins
    const p = new URLSearchParams(window.location.search)
    const utm_source   = p.get('utm_source')   || null
    const utm_medium   = p.get('utm_medium')   || null
    const utm_campaign = p.get('utm_campaign') || null
    const utm_content  = p.get('utm_content')  || null
    const utm_term     = p.get('utm_term')     || null
    const ref = document.referrer || null
    localStorage.setItem('camcash_attribution', JSON.stringify({
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      referrer: ref,
      landing_page: window.location.pathname,
      captured_at: new Date().toISOString(),
    }))
  } catch {}
}

export default T
