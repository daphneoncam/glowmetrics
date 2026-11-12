// CamCash background service worker

const SUPABASE_URL  = 'https://hlsdlaibnayzbfflxclj.supabase.co';
const SUPABASE_ANON = 'sb_publishable_Acd117Nwly1W3AZW-hc2AQ_2jq0-rUw';
const API_BASE       = 'https://www.camcashgrl.com';

// Token→USD rates for the popup's local display only — the server (see
// app/api/live/tips/route.js) is the source of truth for what actually gets
// stored. Mirrors glowmetrics_fresh/lib/constants.js PLATFORM_TOKEN_RATES;
// this extension has no build step to import that file directly, so keep
// these two tables in sync by hand if a rate ever changes.
const TOKEN_RATES = { chaturbate: 0.05, bongacams: 0.025, myfreecams: 0.05, stripchat: 0.05, camsoda: 0.05 };

// ─── State ────────────────────────────────────────────────────────────────────
let session = null;
let whales = [];
let lastTipTs = null;
let sessionTips = [];
let sessionTokens = 0;
let sessionUsd = 0;
let topTipper = null;
let plan = 'free'; // 'free' | 'pro' | 'unlimited' — controls whether tips save to permanent history

// The single canonical coaching prompt, fetched from the shared
// server-persisted engine (GET /api/live/coaching) — this extension never
// computes its own coaching triggers anymore. null when nothing is
// currently active. Mirrors app/live/page.js's coachingPrompt state.
let coachingPrompt = null;

// restorePromise resolves once the initial restore() call completes.
// Tip sync always awaits this before trying to use session.
let restorePromise = null;

// ─── Live session state (official live_sessions row) ──────────────────────
// Distinct from `session` above (the auth session). `liveSession` mirrors
// whatever GET /api/live/session last returned — the extension never keeps
// its own independent timer/session record, per design.
let liveSession = null;
// Set true only while a content script has confirmed it's actively observing
// a supported broadcaster page (the same signal already used for the
// 'connected' message); cleared when that tab closes or navigates away.
// This is the best available "is this really the broadcast page" signal
// without inventing new detection rules on top of what content.js already does.
let broadcasterPageActive = false;
let broadcasterTabId = null;
let broadcasterPlatform = null;

// ─── Persistence ─────────────────────────────────────────────────────────────
async function save() {
  await chrome.storage.local.set({ _bg_whales: whales });
}

async function restore() {
  const data = await chrome.storage.local.get(['session', 'user', '_bg_whales']);
  whales = data._bg_whales || [];
  if (data.session && data.user) {
    const token = typeof data.session === 'string' ? data.session : data.session?.access_token;
    if (token) session = { access_token: token, user: data.user };
  } else {
    // FIX R1/R1b: Sign-out clears storage but wasn't clearing in-memory session.
    // Tips after sign-out would be credited to the old account if restored later.
    session = null;
  }
}

// ─── Supabase helpers (direct REST — no server hop, no CORS issues) ───────────
// SUPABASE_ANON is a publishable (sb_publishable_…) key, not a JWT — Supabase
// rejects it in the Authorization header, so only send that header when we
// have a user's access_token. Logged-out requests authenticate via apikey alone.
function sbHeaders(token) {
  const headers = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Prefer':        'return=minimal',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ─── Usage/install tracking ─────────────────────────────────────────────────
// Writes straight to analytics_events, the same table app/api/track/route.js
// (the website's tracker) writes to — one place for signup/import/extension
// events. Before login this inserts with user_id: null (allowed by the
// table's "user_id IS NULL" RLS policy); once signed in it's sent with the
// caller's own access_token so auth.uid() = user_id and RLS accepts it.
function logExtensionEvent(eventName, properties) {
  const token = session ? session.access_token : null;
  fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
    method: 'POST',
    headers: sbHeaders(token),
    body: JSON.stringify({
      user_id: session ? session.user.id : null,
      event_name: eventName,
      properties: { ...properties, extension_version: chrome.runtime.getManifest().version },
    }),
  }).catch(() => {});
}

// Fires at most once per calendar day per install — proof the extension is
// actually being opened/used by a signed-in account, not just sitting
// installed. Boot and AUTH_CHANGED are the only two places a valid `session`
// can newly become available, so those are the only call sites.
async function pingExtensionActive() {
  if (!session) return;
  const today = new Date().toISOString().slice(0, 10);
  const stored = await chrome.storage.local.get(['_last_active_ping']);
  if (stored._last_active_ping === today) return;
  await chrome.storage.local.set({ _last_active_ping: today });
  logExtensionEvent('extension_active', {});
}

// Fires once per real install/update — chrome.runtime.onInstalled guarantees
// this, unlike a page-load-based signal. Happens before any login, so this
// is always the anonymous (user_id: null) path.
chrome.runtime.onInstalled.addListener((details) => {
  logExtensionEvent(details.reason === 'update' ? 'extension_updated' : 'extension_installed', {
    reason: details.reason,
    previousVersion: details.previousVersion || null,
  });
});

// ─── Token refresh — called automatically when a 401 is returned ──────────────
async function refreshSession() {
  try {
    const data = await chrome.storage.local.get(['refresh_token']);
    if (!data.refresh_token) return false;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ refresh_token: data.refresh_token }),
    });
    if (!res.ok) return false;
    const tokenData = await res.json();
    if (!tokenData.access_token) return false;
    await chrome.storage.local.set({
      session: tokenData.access_token,
      refresh_token: tokenData.refresh_token || data.refresh_token,
    });
    if (session) session.access_token = tokenData.access_token;
    console.log('[CamCash] token refreshed');
    return true;
  } catch (e) {
    console.error('[CamCash] token refresh failed:', e.message);
    return false;
  }
}

// ─── Live session engine (official live_sessions row) ──────────────────────
// All calls go through /api/live/session/*, the same routes and RPCs the
// website uses — no separate/duplicate session logic here. A 401 triggers
// one refresh-and-retry, same pattern as syncTip below.
async function liveSessionCall(path, method, body) {
  await restorePromise;
  if (!session) return null;

  const doFetch = () => fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  try {
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) res = await doFetch();
    }
    if (!res.ok) {
      console.error('[CamCash] live session call failed:', path, res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('[CamCash] live session call error:', path, e.message);
    return null;
  }
}

// How fresh a 'starting' session has to be for the extension to auto-adopt
// it. This is the ONLY form of auto-start: the website's Start Stream
// button creates a live_sessions row in 'starting' status, and this is the
// extension picking up that explicit signal — never an old/stale session.
// Anything not in 'starting', or a 'starting' row older than this window
// (e.g. the website tab was closed before the extension ever connected),
// is left alone: it will time out on its own via the backend sweep rather
// than be silently adopted here.
const PENDING_START_FRESHNESS_MS = 2 * 60 * 1000;

// Called only when nothing is currently tracked locally (liveSession is
// null) — on boot, on auth change, and on the heartbeat alarm's "nothing
// tracked" branch. Deliberately does NOT resume an already-'live' or
// 'inactive_warning' session: an extension boot/restart must never silently
// revive a session it didn't just explicitly get told to start (this is
// what makes "extension restart -> no phantom live session" hold).
async function checkForPendingStart() {
  if (liveSession) return;
  const data = await liveSessionCall('/api/live/session', 'GET');
  const candidate = data?.session;
  if (!candidate || candidate.status !== 'starting') return;

  const ageMs = Date.now() - new Date(candidate.started_at).getTime();
  if (ageMs > PENDING_START_FRESHNESS_MS) return;

  // Validate: authenticated (session already required to get here),
  // session id is the one just discovered, status is genuinely 'starting'.
  // Accepting it means sending our own heartbeat immediately — this is what
  // the server treats as "the extension connected", flipping starting->live.
  liveSession = candidate;
  await sendExtensionHeartbeat();
  await fetchCoachingPrompt();
  broadcast({ action: 'state', state: getState() });
}

async function startLiveSession(platform) {
  const data = await liveSessionCall('/api/live/session/start', 'POST');
  if (data?.session) liveSession = data.session;
  broadcast({ action: 'state', state: getState() });
  return data;
}

async function pauseLiveSession() {
  const data = await liveSessionCall('/api/live/session/pause', 'POST');
  if (data?.session) liveSession = data.session;
  broadcast({ action: 'state', state: getState() });
  return data;
}

async function resumeLiveSession() {
  const data = await liveSessionCall('/api/live/session/resume', 'POST');
  if (data?.session) liveSession = data.session;
  broadcast({ action: 'state', state: getState() });
  return data;
}

async function stopLiveSession() {
  const data = await liveSessionCall('/api/live/session/stop', 'POST');
  // A stopped session is 'ended', not null — but there is nothing further
  // to act on, so this extension should stop tracking it as "the current
  // session" the same as if there were none at all (matches the popup no
  // longer treating a non-active/paused status as still-live).
  liveSession = null;
  broadcast({ action: 'state', state: getState() });
  return data;
}

async function resolveLiveSession(choice) {
  const data = await liveSessionCall('/api/live/session/resolve', 'POST', { choice });
  liveSession = data?.session || null;
  broadcast({ action: 'state', state: getState() });
  return data;
}

// Sent periodically (see the 'live_heartbeat' alarm below) while a session
// is unresolved. Proves the extension is on a confirmed broadcaster page —
// never sent as "detected" unless broadcasterPageActive is genuinely true.
async function sendExtensionHeartbeat() {
  if (!liveSession) return;
  const data = await liveSessionCall(
    '/api/live/session/extension-heartbeat', 'POST',
    { platform: broadcasterPlatform, broadcasterPageDetected: broadcasterPageActive }
  );
  // A null session here means the server no longer considers there to be
  // an unresolved session for this account (ended, or auto-resolved) —
  // stop tracking it so this heartbeat correctly stops firing on its own,
  // instead of retrying forever against a session that's already done.
  liveSession = data?.session || null;
}

// ─── Persistent tip queue ─────────────────────────────────────────────────────
// Every real tip is written to chrome.storage.local BEFORE any network send
// and only removed once the server confirms it, so tips survive network
// outages, server errors, and the service worker being stopped/restarted.
// Each item keeps the clientEventId and detectedAt assigned when content.js
// saw the tip; every retry resends those exact values and the server's
// idempotency check (persist_extension_tip) guarantees one row per event.
const TIP_QUEUE_KEY = '_tip_queue_v1';
const TIP_QUEUE_ALARM = 'tip_queue_flush';
const TIP_RETRY_DELAYS_MS = [1000, 2000, 5000, 15000, 30000, 60000, 120000, 300000];
const MAX_FAILED_TIPS_KEPT = 200;
const RECENT_EVENT_IDS_MAX = 1000;

let tipQueueChain = Promise.resolve();
let flushInProgress = false;
let flushAgain = false;
let flushTimer = null;
let flushPausedUntil = 0;
// Event ids already applied to the local popup/overlay stats, so a tip that
// content.js re-delivers (no ack the first time) isn't counted twice locally.
const recentEventIds = new Set();

function retryDelayMs(attempts) {
  return TIP_RETRY_DELAYS_MS[Math.min(attempts, TIP_RETRY_DELAYS_MS.length) - 1];
}

// Serializes every read-modify-write of the queue so an enqueue that lands
// mid-flush is never overwritten by a stale copy. Never await network inside.
function withTipQueue(mutate) {
  const run = tipQueueChain.then(async () => {
    const data = await chrome.storage.local.get([TIP_QUEUE_KEY]);
    const queue = Array.isArray(data[TIP_QUEUE_KEY]) ? data[TIP_QUEUE_KEY] : [];
    const result = await mutate(queue);
    await chrome.storage.local.set({ [TIP_QUEUE_KEY]: queue });
    return result;
  });
  // FIX R5: Don't silently ignore storage errors with empty catch.
  // Log them and re-throw so the caller can handle (retry with backoff, etc).
  tipQueueChain = run.catch((e) => {
    console.error('[CamCash] tip queue storage error:', e.message);
    throw e;
  });
  return run;
}

function rememberEventId(id) {
  recentEventIds.add(id);
  if (recentEventIds.size > RECENT_EVENT_IDS_MAX) {
    recentEventIds.delete(recentEventIds.values().next().value);
  }
}

function enqueueTip(payload, userId, displayKey) {
  return withTipQueue((queue) => {
    if (queue.some((i) => i.id === payload.clientEventId)) return false;
    const now = Date.now();
    queue.push({
      id: payload.clientEventId,
      // clientEventId + detectedAt (original timestamp) are immutable idempotency keys.
      // The CamCash account that captured the tip. It is only ever sent with
      // that account's token; another account signing in on this browser
      // waits instead of having this creator's earnings attributed to it.
      userId,
      payload,
      displayKey,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      lastAttemptAt: null,
      lastError: null,
    });
    return true;
  });
}

// One send attempt. 401 gets one token refresh + immediate resend; after
// that it stays retryable (the user may sign in again). 408/425/429/5xx and
// network errors are retryable; any other 4xx is a permanent rejection.
async function postQueuedTip(payload, expectedUserId) {
  // queuedMs is measured on this browser's clock alone (detection -> now),
  // so the server can place a delayed tip in time without trusting our clock.
  const doPost = () => fetch(`${API_BASE}/api/live/tips`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      ...payload,
      queuedMs: Math.max(0, Date.now() - (Date.parse(payload.detectedAt) || Date.now())),
    }),
  });

  let res;
  try {
    res = await doPost();
    if (res.status === 401) {
      const refreshed = await refreshSession();
      // Only resend if the refreshed session is still the capturing account.
      if (refreshed && session?.user?.id === expectedUserId) res = await doPost();
      else return { outcome: 'retry', reason: 'account mismatch or refresh failed' };
    }
  } catch (e) {
    return { outcome: 'retry', offline: true, reason: `network: ${e.message}` };
  }

  if (res.ok) {
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (data?.success) return { outcome: 'synced', data };
    return { outcome: 'retry', reason: 'unexpected response body' };
  }

  const status = res.status;
  let detail = '';
  try { detail = (await res.text()).slice(0, 200); } catch (_) {}
  if (status === 401 || status === 408 || status === 425 || status === 429 || status >= 500) {
    return { outcome: 'retry', rateLimited: status === 429, reason: `HTTP ${status}` };
  }
  return { outcome: 'failed', reason: `HTTP ${status}: ${detail}` };
}

async function markDisplayRecordSynced(displayKey, data) {
  if (!displayKey) return;
  const stored = await chrome.storage.local.get([displayKey]);
  if (!stored[displayKey]) return;
  await chrome.storage.local.set({
    [displayKey]: { ...stored[displayKey], synced: true, savedToHistory: !!data?.savedToHistory },
  });
}

function pruneFailedTips(queue) {
  const failed = queue.filter((i) => i.status === 'failed');
  if (failed.length <= MAX_FAILED_TIPS_KEPT) return;
  const drop = new Set(failed.sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, failed.length - MAX_FAILED_TIPS_KEPT).map((i) => i.id));
  for (let i = queue.length - 1; i >= 0; i--) if (drop.has(queue[i].id)) queue.splice(i, 1);
}

async function flushTipQueue() {
  if (flushInProgress) { flushAgain = true; return; }
  flushInProgress = true;
  try {
    do {
      flushAgain = false;
      await restorePromise;
      const userId = session?.user?.id;
      if (!userId || Date.now() < flushPausedUntil) break;

      let due = [];
      try {
        due = await withTipQueue((queue) => {
          const now = Date.now();
          // FIX R3: Backward clock step could stall the queue forever.
          // If nextAttemptAt is in the future by > 1 hour, reset it (likely a clock issue).
          for (const item of queue) {
            if (item.status === 'pending' && item.nextAttemptAt > now + 3600000) {
              item.nextAttemptAt = now;
            }
          }
          return queue
            .filter((i) => i.status === 'pending' && i.userId === userId && i.nextAttemptAt <= now)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((i) => ({ id: i.id, payload: i.payload, displayKey: i.displayKey, userId: i.userId }));
        });
      } catch (e) {
        // FIX R5: Storage error — don't loop immediately. Pause for 5s backoff.
        console.error('[CamCash] flush paused due to storage error:', e.message);
        flushPausedUntil = Date.now() + 5000;
        break;
      }

      for (const item of due) {
        // The signed-in account may have changed since this flush started.
        if (session?.user?.id !== item.userId) break;
        const result = await postQueuedTip(item.payload, item.userId);
        let nextAttemptAt = 0;
        try {
          await withTipQueue((queue) => {
            const idx = queue.findIndex((i) => i.id === item.id);
            if (idx === -1) return;
            const cur = queue[idx];
            cur.attempts += 1;
            cur.lastAttemptAt = Date.now();
            if (result.outcome === 'synced') { queue.splice(idx, 1); return; }
            cur.lastError = result.reason;
            if (result.outcome === 'failed') {
              cur.status = 'failed';
              console.error('[CamCash] tip permanently rejected:', item.id, result.reason);
              pruneFailedTips(queue);
              return;
            }
            cur.nextAttemptAt = Date.now() + retryDelayMs(cur.attempts);
            nextAttemptAt = cur.nextAttemptAt;
          });
        } catch (e) {
          // FIX R5: Storage error mid-flush — pause and retry this tip later.
          console.error('[CamCash] storage error updating queue:', e.message);
          flushPausedUntil = Date.now() + 5000;
          break;
        }
        if (result.outcome === 'synced') await markDisplayRecordSynced(item.displayKey, result.data);
        // Offline or rate-limited: everything else would fail the same way,
        // so hold the whole queue until this item's retry time.
        if (result.offline || result.rateLimited) { flushPausedUntil = nextAttemptAt; break; }
      }
    } while (flushAgain);
  } finally {
    flushInProgress = false;
    await scheduleTipQueueFlush();
  }
}

// setTimeout handles near-term retries while the worker is alive; the
// alarm is the backstop that wakes a stopped worker to keep retrying.
async function scheduleTipQueueFlush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const userId = session?.user?.id;
  const stored = await chrome.storage.local.get([TIP_QUEUE_KEY]);
  // Only the signed-in account's own tips are flushable now; others wait.
  const pending = (stored[TIP_QUEUE_KEY] || []).filter((i) => i.status === 'pending' && i.userId === userId);
  if (!userId || pending.length === 0) {
    chrome.alarms.clear(TIP_QUEUE_ALARM);
    return;
  }
  const nextAt = Math.max(Math.min(...pending.map((i) => i.nextAttemptAt)), flushPausedUntil);
  flushTimer = setTimeout(() => { flushTipQueue(); }, Math.max(0, nextAt - Date.now()));
  chrome.alarms.create(TIP_QUEUE_ALARM, { periodInMinutes: 0.5 });
}

async function handleTipMessage(msg) {
  const { username, tokens, platform, isTest, broadcaster_username } = msg;
  const clientEventId = msg.clientEventId || crypto.randomUUID();
  const detectedAt = msg.detectedAt || new Date().toISOString();
  const detectedMs = Date.parse(detectedAt) || Date.now();
  const displayKey = `tip_${detectedMs}_${clientEventId.slice(0, 8)}`;
  const tipRecord  = { username, amount: tokens, platform, timestamp: detectedAt, synced: false, savedToHistory: false };

  // A re-delivery of an event already shown locally skips the local stats
  // but still goes through enqueue below (the queue itself dedups by id).
  if (!recentEventIds.has(clientEventId)) {
    rememberEventId(clientEventId);
    lastTipTs = detectedMs;
    const usd = parseFloat((tokens * (TOKEN_RATES[platform] || 0.05)).toFixed(2));
    const tip = { username, tokens, usd, platform, ts: lastTipTs };

    sessionTips.unshift(tip);
    if (sessionTips.length > 100) sessionTips.length = 100;
    sessionTokens += tokens;
    sessionUsd    += usd;
    // Tokens are worth different amounts per platform; rank by USD.
    if (!topTipper || usd > topTipper.usd) topTipper = tip;

    chrome.storage.local.set({ [displayKey]: tipRecord });
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items).filter(k => k.startsWith('tip_')).sort().reverse();
      if (keys.length > 100) chrome.storage.local.remove(keys.slice(100));
    });

    broadcast({ action: 'state', state: getState() });
    broadcastOverlay();
  }

  // The popup's Test Tip: the server acknowledges it without saving
  // anything, so it is sent once and never queued.
  if (isTest) {
    syncTip({ username, tokens, platform, timestamp: detectedAt, isTest, broadcaster_username }).then((result) => {
      chrome.storage.local.set({ [displayKey]: { ...tipRecord, synced: true, savedToHistory: !!result?.savedToHistory } });
    });
    return { queued: false, test: true };
  }

  await restorePromise;
  if (!session?.user?.id) return { queued: false, reason: 'signed_out' };

  const payload = {
    username,
    amount: parseInt(tokens, 10),
    platform: platform ? platform.toLowerCase() : 'extension',
    clientEventId,
    detectedAt,
    // Legacy field name the server also accepts; same detection time.
    timestamp: detectedAt,
    broadcaster_username,
  };
  const added = await enqueueTip(payload, session.user.id, displayKey);
  flushTipQueue();
  return { queued: true, duplicate: !added };
}

// ─── Tip sync (Test Tip only) ─────────────────────────────────────────────────
// Real tips go through the persistent queue above. This single-attempt path
// is only used for the popup's Test Tip, which the server never saves.
async function syncTip({ username, tokens, platform, timestamp, isTest, broadcaster_username }) {
  await restorePromise;
  if (!session) return;

  const body = JSON.stringify({
    username,
    amount:    parseInt(tokens, 10),
    platform:  platform ? platform.toLowerCase() : 'extension',
    timestamp: timestamp || new Date().toISOString(),
    isTest,
    broadcaster_username,  // SECURITY FIX #285: Include room owner for verification
  });

  const doPost = () => fetch(`${API_BASE}/api/live/tips`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body,
  });

  try {
    let res = await doPost();
    // If token expired, refresh once and retry
    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) res = await doPost();
    }
    if (!res.ok) {
      const err = await res.text();
      console.error('[CamCash] tip sync failed:', res.status, err);
      return { savedToHistory: false };
    }
    const data = await res.json();
    return { savedToHistory: !!data.savedToHistory };
  } catch (e) {
    console.error('[CamCash] sync failed:', e.message);
    return { savedToHistory: false };
  }
}

// ─── Plan loading — determines whether tips save to permanent history ────────
async function loadPlan() {
  await restorePromise;
  if (!session) { plan = 'free'; return; }
  try {
    const doFetch = () => fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=plan&id=eq.${session.user.id}`,
      { headers: sbHeaders(session.access_token) }
    );
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) res = await doFetch();
    }
    if (!res.ok) return;
    const rows = await res.json();
    plan = rows?.[0]?.plan || 'free';
  } catch (_) {}
}

// ─── Whale loading — reads historical tips directly from Supabase ─────────────
async function loadWhales() {
  await restorePromise;
  if (!session) return;
  try {
    const doFetch = () => fetch(
      `${SUPABASE_URL}/rest/v1/tips?select=username,tokens&user_id=eq.${session.user.id}&order=date_time.desc&limit=200`,
      { headers: sbHeaders(session.access_token) }
    );
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) res = await doFetch();
    }
    if (!res.ok) return;
    const tips = await res.json();

    const totals = {};
    for (const t of tips || []) {
      if (!t.username) continue;
      totals[t.username] = (totals[t.username] || 0) + (t.tokens || 0);
    }
    whales = Object.entries(totals)
      .filter(([, tok]) => tok >= 100)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50)
      .map(([username, tokens]) => ({ username, tokens }));
    await save();
  } catch (_) {}
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function logout() {
  session = null;
  whales = [];
  coachingPrompt = null;
  sessionTips = [];
  sessionTokens = 0;
  sessionUsd = 0;
  topTipper = null;
  lastTipTs = null;
  liveSession = null;
  broadcasterPageActive = false;
  broadcasterTabId = null;
  // Unsent tips survive sign-out (each stays tagged to its own account and
  // is only sent again once that same account signs back in).
  await withTipQueue(() => chrome.storage.local.clear());
  chrome.alarms.clearAll();
}

// ─── Coaching ─────────────────────────────────────────────────────────────────
// No local trigger logic here anymore — every coaching prompt is evaluated
// server-side (lib/coaching/triggers.js in the website repo) and fetched
// through the same GET /api/live/coaching endpoint the website polls, so
// this extension always shows the exact same canonical prompt, never one
// it computed independently. reuses liveSessionCall(), the same
// auth+refresh+error handling every other /api/live/* call here already
// goes through.
async function fetchCoachingPrompt() {
  if (!liveSession) { coachingPrompt = null; return; }
  const data = await liveSessionCall('/api/live/coaching', 'GET');
  coachingPrompt = data?.prompt || null;
  broadcast({ action: 'state', state: getState() });
  broadcastOverlay();
}

// Shared by popup and the on-page overlay against the same coaching_events
// row — whichever surface the user responds on updates the one canonical
// record; the other surface converges on its next fetchCoachingPrompt().
async function respondToCoachingPrompt(eventId, status) {
  const data = await liveSessionCall('/api/live/coaching/respond', 'POST', { eventId, status });
  if (data?.event?.action_status && data.event.action_status !== 'unmarked' && coachingPrompt?.id === eventId) {
    coachingPrompt = null;
  }
  broadcast({ action: 'state', state: getState() });
  broadcastOverlay();
  return data;
}

// ─── Alarms ───────────────────────────────────────────────────────────────────
function scheduleAlarms() {
  // whale_refresh keeps loading the historical top-tippers list even though
  // nothing currently triggers off it — kept for the deferred room-entry
  // whale-notification restoration (see the 'entered' handler below), so
  // that data is already warm whenever that phase gets built.
  chrome.alarms.create('whale_refresh', { periodInMinutes: 10 });
  // chrome.alarms has a 1-minute minimum period — coarser than the website's
  // 15s coaching poll, but that's fine for time-based triggers (dead air,
  // stream fatigue), which are themselves measured in minutes. The
  // coaching prompt fetch below piggybacks on this same alarm rather than
  // its own — one fewer moving part, and it's already the natural "is
  // there anything new" pulse for an unresolved session.
  chrome.alarms.create('live_heartbeat', { periodInMinutes: 1 });
}

// If the tab we were treating as the active broadcaster page closes, the
// extension must stop claiming the page is detected — never keep reporting
// a stale "true" once the tab is gone.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === broadcasterTabId) {
    broadcasterTabId = null;
    broadcasterPageActive = false;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TIP_QUEUE_ALARM) { await flushTipQueue(); return; }
  if (alarm.name === 'whale_refresh') { await loadWhales(); await loadPlan(); }
  if (alarm.name === 'live_heartbeat') {
    // FIX R4: Await restorePromise so on cold start we have current session state,
    // not stale. Otherwise heartbeat on restart reads old session or null.
    await restorePromise;
    if (session) {
      if (liveSession) {
        await sendExtensionHeartbeat();
        await fetchCoachingPrompt();
      } else {
        // No session currently tracked here — check whether a fresh,
        // explicit Start Stream just happened on another surface (the
        // website). Bounded to PENDING_START_FRESHNESS_MS so this never
        // silently adopts an old/stale session (see checkForPendingStart).
        await checkForPendingStart();
      }
    }
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getState() {
  return {
    authed: !!session, user: session?.user || null,
    tips: sessionTips.slice(0, 20), tokens: sessionTokens,
    usd: sessionUsd, topTipper, coachingPrompt,
    whales: whales.slice(0, 10), connected: true,
    plan, isPro: plan === 'pro' || plan === 'unlimited',
    liveSession, broadcasterPageActive,
  };
}

function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }

// Send overlay state to all active cam-site tabs
async function broadcastOverlay() {
  const overlayMsg = { action: 'overlay_state', state: getState() };
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://chaturbate.com/*',
      'https://*.chaturbate.com/*',
      'https://bongacams.com/*',
      'https://*.bongacams.com/*',
      'https://myfreecams.com/*',
      'https://*.myfreecams.com/*',
    ]});
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, overlayMsg).catch(() => {});
    }
  } catch (_) {}
}

function isWhale(u) { return whales.some(w => w.username.toLowerCase() === u.toLowerCase()); }
function getWhale(u) { return whales.find(w => w.username.toLowerCase() === u.toLowerCase()); }

// ─── Token history scan ─────────────────────────────────────────────────────
// Triggered by the "Scan Token History" button in the overlay/popup.
// Flow: ask the content script to read the on-page table → send the parsed
// rows to /api/scan/preview for server-side validation/normalization →
// return the preview payload to whoever asked (popup or overlay) for the
// user to review. Nothing gets written to `tips` from this function —
// import only happens after explicit user confirmation via a separate
// 'confirm_token_scan' action, which calls /api/scan/import.
async function scanTokenHistory() {
  await restorePromise;
  if (!session) return { ok: false, error: 'Not signed in.' };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: 'No active tab found.' };

  let scanResult;
  try {
    scanResult = await chrome.tabs.sendMessage(tab.id, { action: 'run_token_scan' });
  } catch (e) {
    return { ok: false, error: 'Could not reach the page. Make sure you\'re on your Chaturbate token history page.' };
  }
  if (!scanResult?.ok) return scanResult || { ok: false, error: 'Scan failed.' };

  try {
    const res = await fetch(`${API_BASE}/api/scan/preview`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ platform: 'chaturbate', rows: scanResult.rows }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Server rejected the scan: ${err}` };
    }
    const preview = await res.json();
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: 'Could not reach CamCash to validate the scan.' };
  }
}

// Takes the exact "inbound" rows the user already saw and approved in the
// preview modal — nothing is re-fetched from the page at confirm time, so
// what the user reviewed is exactly what gets sent for import.
async function confirmTokenImport(rows) {
  await restorePromise;
  if (!session) return { ok: false, error: 'Not signed in.' };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: 'Nothing to import.' };
  try {
    const res = await fetch(`${API_BASE}/api/scan/import`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ rows }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Import failed: ${err}` };
    }
    const result = await res.json();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: 'Could not reach CamCash to complete the import.' };
  }
}

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {

  if (msg.action === 'get_state') { reply(getState()); return false; }

  if (msg.action === 'scan_token_history') {
    scanTokenHistory().then(reply);
    return true;
  }

  if (msg.action === 'confirm_token_import') {
    confirmTokenImport(msg.rows).then(reply);
    return true;
  }

  if (msg.action === 'logout') {
    logout().then(() => reply({ ok: true }));
    return true;
  }

  if (msg.action === 'tip') {
    // Replies only after the tip is persisted to the queue — content.js
    // resends the same event until it gets this reply.
    handleTipMessage(msg).then(reply, (e) => {
      // Not persisted: reply with nothing so content.js resends this event.
      console.error('[CamCash] could not queue tip:', e.message);
      reply();
    });
    return true;
  }

  if (msg.action === 'entered') {
    // FOLLOW-UP (deferred, not this phase): this used to independently fire
    // a native "🐋 Whale Alert!" OS notification + a popup banner whenever
    // a historically-known big spender entered the room — a genuinely
    // different signal from whale_prox/whale_dep (which are both
    // tip-based, current-session triggers from the shared coaching
    // engine). Restoring a native notification for room-entry requires
    // persisting 'entered' events server-side first (they're currently
    // extension-local only) and adding that as a real 10th trigger —
    // deliberately out of scope this phase. isWhale()/loadWhales() are
    // left in place so that data is ready whenever this gets built.
    return false;
  }

  if (msg.action === 'connected') {
    // A content script confirmed it successfully attached to a supported
    // broadcaster page's chat — the same real signal already used for the
    // overlay, now also feeding the extension heartbeat's page-detected flag.
    if (_sender.tab?.id) {
      broadcasterTabId = _sender.tab.id;
      broadcasterPageActive = true;
      broadcasterPlatform = msg.platform || broadcasterPlatform;
    }
    broadcast({ action: 'state', state: getState() });
    broadcastOverlay();
    return false;
  }

  if (msg.action === 'live_start') {
    startLiveSession(msg.platform).then(reply);
    return true;
  }
  if (msg.action === 'live_pause') {
    pauseLiveSession().then(reply);
    return true;
  }
  if (msg.action === 'live_resume') {
    resumeLiveSession().then(reply);
    return true;
  }
  if (msg.action === 'live_stop') {
    stopLiveSession().then(reply);
    return true;
  }
  if (msg.action === 'live_resolve') {
    resolveLiveSession(msg.choice).then(reply);
    return true;
  }
  if (msg.action === 'live_get_state') {
    reply({ liveSession, broadcasterPageActive });
    return false;
  }
  if (msg.action === 'coaching_respond') {
    respondToCoachingPrompt(msg.eventId, msg.status).then(reply);
    return true;
  }

  if (msg.type === 'AUTH_CHANGED') {
    restorePromise = restore().then(() => {
      if (session) { loadWhales(); loadPlan(); checkForPendingStart(); scheduleAlarms(); pingExtensionActive(); flushTipQueue(); }
      else { plan = 'free'; liveSession = null; chrome.alarms.clearAll(); }
    });
    return false;
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
// Never resumes an already-'live' session on its own — see
// checkForPendingStart(). A genuine browser/extension restart mid-session
// intentionally does not silently continue tracking; the backend sweep
// (10 min -> inactive_warning, 20 min -> auto-ended) is what protects a
// session that's now unreachable from every surface. Any tips still in the
// persistent queue are resent from here.
restorePromise = restore().then(() => {
  if (session) { loadWhales(); loadPlan(); checkForPendingStart(); scheduleAlarms(); pingExtensionActive(); flushTipQueue(); }
});
