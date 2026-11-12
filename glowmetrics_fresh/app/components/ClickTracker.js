'use client'

import { useEffect } from 'react'
import { track } from '../../lib/track'

// Elements considered "interesting" to attribute a click to, in priority order.
const TARGET_SELECTOR = [
  'button',
  'a',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'select',
  '[data-track-label]',
  '[data-testid]',
].join(',')

// Never log element text — it can contain fan usernames, tip amounts, or
// other private business data. Only structural identifiers are captured.
function describeClickTarget(el) {
  if (!el) return null

  return {
    tag: el.tagName?.toLowerCase() || null,
    id: el.id || null,
    trackLabel: el.getAttribute?.('data-track-label') || null,
    testId: el.getAttribute?.('data-testid') || null,
    role: el.getAttribute?.('role') || null,
    ariaLabel: el.getAttribute?.('aria-label') || null,
    type: el.getAttribute?.('type') || null,
    // First class only, and only if it looks like a stable utility/component
    // class rather than a dynamically generated hash.
    className: (typeof el.className === 'string' && el.className.trim().split(/\s+/)[0]) || null,
    // Path only — never the full href, which could carry query params/tokens.
    hrefPath: el.tagName === 'A' && el.href ? safePathname(el.href) : null,
  }
}

function safePathname(href) {
  try {
    return new URL(href, window.location.origin).pathname
  } catch {
    return null
  }
}

export default function ClickTracker() {
  useEffect(() => {
    function handleClick(event) {
      const el = event.target?.closest?.(TARGET_SELECTOR)
      const descriptor = describeClickTarget(el) || describeClickTarget(event.target)
      if (!descriptor) return

      track('click', {
        ...descriptor,
        path: window.location.pathname,
      })
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  return null
}
