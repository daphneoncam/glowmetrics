// popup.js - CamCash Live popup UI

// Must match background.js's SUPABASE_URL/SUPABASE_ANON exactly — this is
// where the login token itself is issued, and if it doesn't match the
// project background.js/the API talk to, every authenticated action fails
// with "unauthorized" even though login itself appears to succeed.
const SUPABASE_URL = 'https://hlsdlaibnayzbfflxclj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Acd117Nwly1W3AZW-hc2AQ_2jq0-rUw';

// DOM elements
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const guestBtn = document.getElementById('guest-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const tipsList = document.getElementById('tips-list');
const authError = document.getElementById('auth-error');
const statusPill = document.getElementById('status-pill');
const statusPillText = document.getElementById('status-pill-text');

const sessionLabel = document.getElementById('session-label');
const sessionTimerEl = document.getElementById('session-timer');
const sessionBtnRow = document.getElementById('session-btn-row');
const sessionResolutionPrompt = document.getElementById('session-resolution-prompt');

const statEarned = document.getElementById('stat-earned');
const statTokens = document.getElementById('stat-tokens');
const statTips = document.getElementById('stat-tips');
const statTop = document.getElementById('stat-top');

const coachMsgEl = document.getElementById('coach-msg');
const coachMetaEl = document.getElementById('coach-meta');
const coachActionsEl = document.getElementById('coach-actions');
const coachPerformedBtn = document.getElementById('coach-performed-btn');
const coachSkipBtn = document.getElementById('coach-skip-btn');

// On load
function init() {
  checkAuthState();
  loadTips();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function checkAuthState() {
  const stored = await getStoredAuth();
  if (stored.session && stored.user) {
    showDashboard(stored.user);
    chrome.runtime.sendMessage({ action: 'live_get_state' }, (res) => {
      if (chrome.runtime.lastError) return;
      updateLiveSession(res?.liveSession);
    });
    chrome.runtime.sendMessage({ action: 'get_state' }, (state) => {
      if (chrome.runtime.lastError || !state) return;
      updatePlanNotice(state.isPro);
      updateStats(state);
      updateCoach(state.coachingPrompt);
    });
  } else {
    showAuth();
  }
  updateStatus();
}

function showAuth() {
  authSection.style.display = 'block';
  dashboardSection.style.display = 'none';
  authError.style.display = 'none';
}

function showDashboard(user) {
  authSection.style.display = 'none';
  dashboardSection.style.display = 'block';
  userInfo.textContent = `✅ ${user.email}`;
}

// Login directly via Supabase
loginBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    showError('Email and password required');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email: email.toLowerCase().trim(), password })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      showError(data.error_description || data.message || 'Invalid credentials');
      return;
    }

    await chrome.storage.local.set({
      session: data.access_token,
      refresh_token: data.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        username: data.user.user_metadata?.username || data.user.email.split('@')[0]
      }
    });

    console.log('[Popup] Logged in via Supabase directly');
    chrome.runtime.sendMessage({ type: 'AUTH_CHANGED', authenticated: true });
    showDashboard(data.user);

  } catch (err) {
    console.error('Login error:', err);
    showError('Connection error: ' + err.message);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

// Guest mode
guestBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({
    session: null,
    user: { id: 'guest', email: 'guest@localhost', username: 'Guest' }
  });
  chrome.runtime.sendMessage({ type: 'AUTH_CHANGED', authenticated: false });
  showDashboard({ email: 'guest@localhost' });
});

// Logout
logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['session', 'refresh_token', 'user']);
  chrome.runtime.sendMessage({ type: 'AUTH_CHANGED', authenticated: false });
  showAuth();
  emailInput.value = '';
  passwordInput.value = '';
});

// Load and display tips — capped to the latest 3, matching the compact layout.
// (The underlying storage can hold more; #tips-list itself scrolls internally
// if ever more than 3 rows are shown, but the default view stays short.)
async function loadTips() {
  chrome.storage.local.get(null, (items) => {
    const tips = Object.values(items).filter(item => item && item.amount);

    if (tips.length === 0) {
      tipsList.innerHTML = '<div class="empty-state">No tips yet</div>';
      return;
    }

    tips.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    tipsList.innerHTML = tips.slice(0, 3).map(tip => `
      <div class="tip-item">
        <span class="tip-username">${escapeHtml(tip.username)}</span>
        <span class="tip-amount">${tip.amount}t</span>
        <span class="tip-time">${formatTime(tip.timestamp)}</span>
      </div>
    `).join('');
  });
}

// Update status badge (content-script reachability, unrelated to live session state)
function updateStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'PING' }, () => { void chrome.runtime.lastError; });
    }
  });
}

function getStoredAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['session', 'user'], (items) => {
      resolve({ session: items.session, user: items.user || null });
    });
  });
}

function showError(message) {
  authError.textContent = '❌ ' + message;
  authError.style.display = 'block';
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

setInterval(loadTips, 5000);

// ─── Stats + coach (single card each — no duplication) ─────────────────────
function updateStats(state) {
  statEarned.textContent = '$' + (state.usd || 0).toFixed(2);
  statTokens.textContent = (state.tokens || 0).toLocaleString();
  statTips.textContent = (state.tips || []).length;
  statTop.textContent = state.topTipper ? state.topTipper.username : '—';
}

// prompt is the single canonical coaching_events row shared with the
// website and the on-page overlay (see background.js's coachingPrompt) —
// never a locally-generated message. null when nothing is currently active.
let currentCoachingPromptId = null;
function updateCoach(prompt) {
  currentCoachingPromptId = prompt?.id || null;
  if (prompt) {
    coachMsgEl.textContent = prompt.message || prompt.compact_message || prompt.title;
    const mins = Math.max(0, Math.round((Date.now() - new Date(prompt.shown_at).getTime()) / 60000));
    coachMetaEl.textContent = mins === 0 ? 'just now' : `${mins}m ago`;
    coachActionsEl.style.display = 'flex';
  } else {
    coachMsgEl.textContent = 'Coaching tips will appear during your stream';
    coachMetaEl.textContent = '';
    coachActionsEl.style.display = 'none';
  }
}

function respondToCoach(status) {
  if (!currentCoachingPromptId) return;
  const eventId = currentCoachingPromptId;
  coachActionsEl.style.display = 'none'; // optimistic — background's next state broadcast is canonical
  chrome.runtime.sendMessage({ action: 'coaching_respond', eventId, status }, () => {
    if (chrome.runtime.lastError) return;
  });
}
coachPerformedBtn.addEventListener('click', () => respondToCoach('performed'));
coachSkipBtn.addEventListener('click', () => respondToCoach('skipped'));

// Listen for coaching + state broadcasts from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'state' && msg.state) {
    updateCoach(msg.state.coachingPrompt);
    updatePlanNotice(msg.state.isPro);
    updateStats(msg.state);
    updateLiveSession(msg.state.liveSession);
    loadTips();
  }
  if (msg.action === 'platform_limit_reached') {
    const limitAlert = document.getElementById('platform-limit-alert');
    if (limitAlert) {
      limitAlert.innerHTML = `🔒 Tips on ${msg.platform} aren't being saved — free plan tracks 1 platform. <a href="https://www.camcashgrl.com/pricing" target="_blank" style="color:#a78bfa;">Upgrade →</a>`;
      limitAlert.style.display = 'block';
    }
  }
});

// Free plan: live coaching + tip feed always work, but tips aren't saved to
// permanent dashboard history unless the account is on a paid plan.
function updatePlanNotice(isPro) {
  const el = document.getElementById('plan-notice');
  if (!el) return;
  el.style.display = isPro ? 'none' : 'block';
}

// Test tip button
document.getElementById('test-tip-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    action: 'tip',
    username: 'TestTipper',
    tokens: 50,
    platform: 'chaturbate',
    isTest: true,
  }, () => {
    loadTips();
  });
});

// ─── Live session controls ──────────────────────────────────────────────────
// Mirrors the same live_sessions row the website uses — no separate timer or
// session record kept here. `_liveSession` is the last server response;
// `_liveSessionFetchedAtMs` anchors the 1s ticker so the displayed timer
// advances smoothly between actual server responses without ever being the
// source of truth itself (shapeLiveSession()'s active_duration_seconds is).
let _liveSession = null;
let _liveSessionFetchedAtMs = 0;
let _liveActionPending = false;

function updateLiveSession(session) {
  _liveSession = session || null;
  _liveSessionFetchedAtMs = Date.now();
  renderLiveSession();
  renderStatusPill();
}

function setStatusPill(cls, text) {
  statusPill.className = `status-pill ${cls}`;
  statusPillText.textContent = text;
}

function renderStatusPill() {
  if (!_liveSession) { setStatusPill('status-offline', 'OFFLINE'); return; }
  if (_liveSession.status === 'starting') { setStatusPill('status-paused', 'STARTING'); return; }
  if (_liveSession.status === 'inactive_warning') { setStatusPill('status-attention', 'NEEDS ATTENTION'); return; }
  if (_liveSession.live_substate === 'paused') { setStatusPill('status-paused', 'PAUSED'); return; }
  setStatusPill('status-live', 'LIVE');
}

function fmtDuration(secs) {
  // Clamped to 24h: a real session timer is never anywhere close to this,
  // so a value beyond it means something upstream computed against a bad
  // timestamp (e.g. a missing field defaulting to epoch) — display a safe
  // placeholder instead of an absurd number of hours.
  const raw = Math.max(0, Math.floor(secs || 0));
  const s = raw > 86400 ? 0 : raw;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

function liveButton(label, cls, onClick) {
  const btn = document.createElement('button');
  btn.className = `session-btn ${cls}`;
  btn.textContent = label;
  btn.disabled = _liveActionPending;
  btn.onclick = onClick;
  return btn;
}

function callLiveAction(action, extra, btn) {
  if (_liveActionPending) return;
  _liveActionPending = true;
  if (btn) btn.disabled = true;
  // If the background script's reply never arrives — the message port can
  // close early on a dropped connection, a stale/reloading service worker,
  // or a network failure — sendMessage's callback silently never fires.
  // Without this timeout, _liveActionPending would stay true forever, and
  // since liveButton() reads it at render time, every button created from
  // then on would be silently disabled with no visible error at all. This
  // guarantees the UI recovers on its own a few seconds later regardless.
  let settled = false;
  const failSafe = setTimeout(() => {
    if (settled) return;
    settled = true;
    _liveActionPending = false;
    renderLiveSession();
  }, 5000);
  chrome.runtime.sendMessage({ action, ...extra }, (res) => {
    if (settled) return;
    settled = true;
    clearTimeout(failSafe);
    _liveActionPending = false;
    updateLiveSession(res?.session ?? null);
  });
}

function renderLiveSession() {
  sessionBtnRow.innerHTML = '';
  sessionResolutionPrompt.style.display = 'none';

  if (!_liveSession) {
    sessionLabel.textContent = '';
    sessionTimerEl.textContent = '';
    sessionBtnRow.appendChild(liveButton('▶ Start Stream', 'session-btn-start', () => {
      callLiveAction('live_start', { platform: 'chaturbate' }, sessionBtnRow.firstChild);
    }));
    return;
  }

  if (_liveSession.status === 'starting') {
    sessionLabel.textContent = 'STARTING';
    sessionTimerEl.textContent = '';
    sessionBtnRow.appendChild(liveButton('Cancel', 'session-btn-stop', (e) => callLiveAction('live_stop', {}, e.target)));
    return;
  }

  if (_liveSession.status === 'inactive_warning') {
    sessionLabel.textContent = '';
    sessionTimerEl.textContent = '';
    sessionResolutionPrompt.style.display = 'block';
    sessionResolutionPrompt.textContent = "We couldn't confirm you were still broadcasting. Still live?";
    sessionBtnRow.appendChild(liveButton('Still Live', 'session-btn-resume', (e) => callLiveAction('live_resolve', { choice: 'still_live' }, e.target)));
    sessionBtnRow.appendChild(liveButton('Stream Ended', 'session-btn-stop', (e) => callLiveAction('live_resolve', { choice: 'ended' }, e.target)));
    return;
  }

  // Only 'live' (active or paused substate) has further actions. Anything
  // else ('ended', 'ending', or anything unrecognized) means there's
  // nothing left to act on — fall back to idle (Start Stream) instead of
  // defaulting to the live button set, which previously showed Pause/Stop
  // even after a session had actually ended.
  if (_liveSession.status !== 'live') {
    _liveSession = null;
    sessionLabel.textContent = '';
    sessionTimerEl.textContent = '';
    sessionBtnRow.appendChild(liveButton('▶ Start Stream', 'session-btn-start', () => {
      callLiveAction('live_start', { platform: 'chaturbate' }, sessionBtnRow.firstChild);
    }));
    return;
  }

  const elapsedSinceFetch = (Date.now() - _liveSessionFetchedAtMs) / 1000;
  const liveSecs = _liveSession.live_substate === 'active'
    ? (_liveSession.active_duration_seconds || 0) + elapsedSinceFetch
    : (_liveSession.active_duration_seconds || 0);

  if (_liveSession.live_substate === 'paused') {
    sessionLabel.textContent = 'PAUSED';
    sessionTimerEl.textContent = fmtDuration(liveSecs);
    sessionBtnRow.appendChild(liveButton('▶ Resume', 'session-btn-resume', (e) => callLiveAction('live_resume', {}, e.target)));
    sessionBtnRow.appendChild(liveButton('⏹ Stop', 'session-btn-stop', (e) => callLiveAction('live_stop', {}, e.target)));
  } else {
    sessionLabel.textContent = 'LIVE';
    sessionTimerEl.textContent = fmtDuration(liveSecs);
    sessionBtnRow.appendChild(liveButton('⏸ Pause', 'session-btn-pause', (e) => callLiveAction('live_pause', {}, e.target)));
    sessionBtnRow.appendChild(liveButton('⏹ Stop', 'session-btn-stop', (e) => callLiveAction('live_stop', {}, e.target)));
  }
}

setInterval(() => { if (_liveSession && _liveSession.status === 'live' && _liveSession.live_substate === 'active') renderLiveSession(); }, 1000);
