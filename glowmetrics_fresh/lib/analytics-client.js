// Client-side analytics tracking utilities
// All events are sent to /api/track for centralized logging

let sessionId = null;
let sessionStartTime = null;
let lastActivityTime = null;
let currentPageStartTime = null;
let maxScrollDepth = 0;
// Volume guards (2026-11-06, when site-wide tracking was switched on):
// one 'input' and one 'page_exit' row per page view, scroll rows only when a
// new 25/50/75/100% milestone is reached, and init runs once per page load.
let initialized = false;
let inputTrackedThisPage = false;
let exitTrackedThisPage = false;
let lastScrollMilestone = 0;

// Initialize session on app load
export function initializeAnalytics() {
  if (typeof window === 'undefined') return;
  if (initialized) return;
  initialized = true;

  sessionId = generateSessionId();
  sessionStartTime = Date.now();
  lastActivityTime = Date.now();
  currentPageStartTime = Date.now();

  // Track session start
  let tz = 'UTC';
  if (typeof Intl !== 'undefined') {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved) tz = resolved;
  }
  trackEvent('session', {
    sessionId,
    deviceType: getDeviceType(),
    browser: getBrowserInfo(),
    os: getOSInfo(),
    utmSource: getUtmParam('utm_source'),
    utmMedium: getUtmParam('utm_medium'),
    utmCampaign: getUtmParam('utm_campaign'),
    utmContent: getUtmParam('utm_content'),
    utmTerm: getUtmParam('utm_term'),
    country: tz,
  });

  // Track page views
  trackPageView();

  // Setup engagement tracking
  setupEngagementTracking();
  setupClickTracking();
  setupScrollTracking();
  setupErrorTracking();
}

// ─── Core tracking function ─────────────────────────────────────────────────

export async function trackEvent(eventType, properties = {}, token = null) {
  if (typeof window === 'undefined') return;

  try {
    const body = {
      eventType,
      pageUrl: window.location.pathname,
      referrer: stripQuery(document.referrer),
      properties: {
        sessionId,
        ...properties,
      },
      ...(token && { token }),
    };

    // Fire and forget — don't block on analytics failures
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true, // Ensure it completes even if page unloads
    }).catch(() => {
      // Silently fail — analytics errors shouldn't break the app
    });
  } catch (err) {
    console.error('[analytics] Track error:', err);
  }
}

// ─── Page view tracking ─────────────────────────────────────────────────────

export function trackPageView() {
  if (typeof window === 'undefined') return;

  currentPageStartTime = Date.now();
  maxScrollDepth = 0;
  lastScrollMilestone = 0;
  inputTrackedThisPage = false;
  exitTrackedThisPage = false;

  trackEvent('engagement', {
    engagementType: 'page_view',
    pageTitle: document.title,
    deviceType: getDeviceType(),
    browser: getBrowserInfo(),
    os: getOSInfo(),
  });
}

// ─── Click tracking ────────────────────────────────────────────────────────

function setupClickTracking() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  document.addEventListener(
    'click',
    (e) => {
      const target = e.target.closest('a, button, [role="button"], [role="link"]');
      if (!target) return;

      trackEvent('click', {
        elementType: target.tagName.toLowerCase(),
        elementId: target.id,
        elementClass: typeof target.className === 'string' ? target.className.substring(0, 200) : null,
        elementSelector: generateSelector(target),
        buttonText: target.textContent?.trim().substring(0, 100),
        // Query strings are dropped: links can carry tokens or ids.
        linkHref: stripQuery(target.href || target.getAttribute('data-href')),
        sectionName: target.closest('[data-section]')?.getAttribute('data-section'),
        ctaName: target.getAttribute('data-cta'),
        clickX: e.clientX,
        clickY: e.clientY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        deviceType: getDeviceType(),
        sessionId,
      });
    },
    true
  );
}

export function trackClick(elementId, ctaName = null, sectionName = null) {
  const element = document.getElementById(elementId);
  if (!element) return;

  trackEvent('click', {
    elementId,
    elementSelector: generateSelector(element),
    elementType: element.tagName.toLowerCase(),
    buttonText: element.textContent?.trim().substring(0, 100),
    ctaName: ctaName || element.getAttribute('data-cta'),
    sectionName: sectionName || element.closest('[data-section]')?.getAttribute('data-section'),
    clickX: 0, // Manual tracking doesn't have coordinates
    clickY: 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    deviceType: getDeviceType(),
    sessionId,
  });
}

// ─── Scroll depth tracking ──────────────────────────────────────────────────

function setupScrollTracking() {
  if (typeof window === 'undefined') return;

  let scrollTimeout;
  window.addEventListener('scroll', () => {
    lastActivityTime = Date.now();
    clearTimeout(scrollTimeout);

    const scrollDepth = Math.round(
      ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100
    );
    maxScrollDepth = Math.min(100, Math.max(maxScrollDepth, scrollDepth));

    scrollTimeout = setTimeout(() => {
      const milestone = Math.floor(maxScrollDepth / 25) * 25;
      if (milestone <= lastScrollMilestone) return;
      lastScrollMilestone = milestone;
      trackEvent('engagement', {
        engagementType: 'scroll',
        scrollDepthPercent: milestone,
        sessionId,
      });
    }, 1000);
  });
}

// ─── Engagement tracking (time on page, etc.) ───────────────────────────────

function setupEngagementTracking() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Track focus/blur for time on page
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      trackTimeOnPage();
    }
  });

  window.addEventListener('beforeunload', () => {
    trackTimeOnPage();
  });

  // Periodic check for engagement metrics
  setInterval(() => {
    lastActivityTime = Date.now();
  }, 30000); // Every 30 seconds

  // Track user input (typing, focus, etc.)
  document.addEventListener(
    'input',
    () => {
      lastActivityTime = Date.now();
      // Never the typed value — only that the visitor typed on this page.
      if (inputTrackedThisPage) return;
      inputTrackedThisPage = true;
      trackEvent('engagement', {
        engagementType: 'input',
        sessionId,
      });
    },
    true
  );
}

function trackTimeOnPage() {
  if (!currentPageStartTime) return;
  if (exitTrackedThisPage) return;
  exitTrackedThisPage = true;
  const timeOnPageSeconds = Math.round((Date.now() - currentPageStartTime) / 1000);

  trackEvent('engagement', {
    engagementType: 'page_exit',
    timeOnPageSeconds,
    scrollDepthPercent: maxScrollDepth,
    sessionId,
  });
}

// ─── Error tracking ────────────────────────────────────────────────────────

function setupErrorTracking() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    trackEvent('error', {
      errorType: 'uncaught_error',
      errorMessage: event.message,
      errorStack: event.filename + ':' + event.lineno + ':' + event.colno,
      severity: 'high',
      source: 'client',
      sessionId,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    trackEvent('error', {
      errorType: 'unhandled_rejection',
      errorMessage: String(event.reason),
      severity: 'medium',
      source: 'client',
      sessionId,
    });
  });
}

// ─── Trial tracking ─────────────────────────────────────────────────────────

export function trackTrialEvent(eventType, properties = {}, token = null) {
  trackEvent('free_trial', {
    eventType,
    ...properties,
    sessionId,
  }, token);
}

// ─── Checkout tracking ──────────────────────────────────────────────────────

export function trackCheckoutEvent(status, properties = {}, token = null) {
  trackEvent('checkout', {
    status,
    sessionId,
    ...properties,
  }, token);
}

// ─── CSV upload tracking ────────────────────────────────────────────────────

export function trackCSVUpload(status, properties = {}, token = null) {
  trackEvent('csv_upload', {
    status,
    sessionId,
    ...properties,
  }, token);
}

// ─── API call tracking (called from API routes) ────────────────────────────

export function trackApiCall(endpoint, method, statusCode, responseTimeMs, error = null) {
  trackEvent('api_call', {
    endpoint,
    method,
    statusCode,
    responseTimeMs,
    errorMessage: error?.message,
    sessionId,
  });
}

// ─── Tip tracking ───────────────────────────────────────────────────────────

export function trackTip(properties = {}, token = null) {
  trackEvent('tip', {
    sessionId,
    ...properties,
  }, token);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripQuery(url) {
  if (!url || typeof url !== 'string') return null;
  return url.split(/[?#]/)[0].substring(0, 500);
}

function generateSessionId() {
  return 'sess_' + Math.random().toString(36).substr(2, 9);
}

function getDeviceType() {
  if (typeof window === 'undefined') return 'unknown';
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

function getBrowserInfo() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (ua.indexOf('Firefox') > -1) return 'Firefox';
  if (ua.indexOf('Chrome') > -1) return 'Chrome';
  if (ua.indexOf('Safari') > -1) return 'Safari';
  if (ua.indexOf('Edge') > -1) return 'Edge';
  return 'Unknown';
}

function getOSInfo() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (ua.indexOf('Windows') > -1) return 'Windows';
  if (ua.indexOf('Mac') > -1) return 'macOS';
  if (ua.indexOf('Linux') > -1) return 'Linux';
  if (ua.indexOf('Android') > -1) return 'Android';
  if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) return 'iOS';
  return 'Unknown';
}

function getUtmParam(param) {
  if (typeof window === 'undefined') return null;
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(param);
}

function generateSelector(element) {
  if (!element) return '';
  const parts = [];
  let el = element;

  while (el && el.tagName) {
    let selector = el.tagName.toLowerCase();
    if (el.id) {
      selector += '#' + el.id;
      parts.unshift(selector);
      break;
    } else {
      if (typeof el.className === 'string' && el.className.trim()) {
        selector += '.' + el.className.trim().split(/\s+/).join('.');
      }
      parts.unshift(selector);
      el = el.parentElement;
    }
  }

  return parts.join(' > ').substring(0, 200);
}

export const Analytics = {
  initializeAnalytics,
  trackEvent,
  trackPageView,
  trackClick,
  trackTrialEvent,
  trackCheckoutEvent,
  trackCSVUpload,
  trackApiCall,
  trackTip,
  getSessionId: () => sessionId,
};
