// Staging Integration Smoke Test for Phase 2 Live Mode
//
// This test exercises the REAL extension→API→database flow end-to-end:
// - Creates a temporary staging Auth user
// - Starts/manages a live session through the API
// - POSTs tips to /api/live/tips with real authentication
// - Verifies database state (tips + live_tips rows)
// - Tests idempotency, pauses, resumes, and finalization
// - Validates final metrics
//
// Run with: npm run test:staging
// Requires staging env vars; refuses to run against production.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { assertStagingTargets } from './staging-guard.mjs';

// ─── Configuration ──────────────────────────────────────────────────────────

const STAGING_URL = process.env.SUPABASE_STAGING_URL;
const STAGING_ANON_KEY = process.env.SUPABASE_STAGING_ANON_KEY;
const STAGING_SERVICE_ROLE_KEY = process.env.SUPABASE_STAGING_SERVICE_ROLE_KEY;
const API_BASE = process.env.CAMCASH_STAGING_BASE_URL;

// Required env vars with validation
const missingEnv = [
  { name: 'SUPABASE_STAGING_URL', value: STAGING_URL },
  { name: 'SUPABASE_STAGING_ANON_KEY', value: STAGING_ANON_KEY },
  { name: 'SUPABASE_STAGING_SERVICE_ROLE_KEY', value: STAGING_SERVICE_ROLE_KEY },
  { name: 'CAMCASH_STAGING_BASE_URL', value: API_BASE },
].filter(({ value }) => !value);

if (missingEnv.length > 0) {
  console.error('❌ Missing required staging credentials:');
  missingEnv.forEach(({ name }) => console.error(`   ${name}`));
  process.exit(1);
}

// Production safety checks: parsed-URL allowlist (see staging-guard.mjs).
// Exits before any Supabase client is created if either target is not staging.
assertStagingTargets({ supabaseUrl: STAGING_URL, appBaseUrl: API_BASE });

// ─── Logging & Assertions ──────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function pass(msg) {
  passCount++;
  console.log(`✅ ${msg}`);
}

function fail(msg) {
  failCount++;
  console.error(`❌ ${msg}`);
}

function assert(cond, msg) {
  if (cond) { pass(msg); }
  else { fail(msg); }
}

function deepEqual(a, b, msg) {
  const eq = JSON.stringify(a) === JSON.stringify(b);
  if (eq) { pass(msg); }
  else { fail(`${msg} | Expected: ${JSON.stringify(b)}, Got: ${JSON.stringify(a)}`); }
}

// ─── Test State ────────────────────────────────────────────────────────────

let tempUser = null;
let otherUser = null;
let liveSession = null;
let firstTipId = null;
let secondTipId = null;
let firstClientEventId = null;
let secondClientEventId = null;

// ─── Supabase Clients ──────────────────────────────────────────────────────

const anonClient = createClient(STAGING_URL, STAGING_ANON_KEY);
const adminClient = createClient(STAGING_URL, STAGING_SERVICE_ROLE_KEY);

// ─── Helper Functions ──────────────────────────────────────────────────────

function generateUUID() {
  return crypto.randomUUID();
}

// Fixed so stale fixtures can be found and removed; the staging-only helper
// RPCs (staging-only/smoke-test-helpers.sql) refuse any other id.
const SMOKE_TEST_USER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

// Deletes live-session fixtures for the fixed test user, children first:
// live_tips and live_session_pauses reference live_sessions without cascade.
// Canonical tips are removed by the auth-user delete (tips.user_id is
// ON DELETE CASCADE), so service_role needs no access to public.tips.
async function deleteSessionFixtures(userId) {
  const errors = [];
  for (const table of ['live_tips', 'live_session_pauses', 'live_sessions']) {
    const { error } = await adminClient.from(table).delete().eq('user_id', userId);
    if (error) errors.push(`${table}: ${error.message}`);
  }
  const { error: profileErr } = await adminClient.from('profiles').delete().eq('id', userId);
  if (profileErr) errors.push(`profiles: ${profileErr.message}`);
  return errors;
}

async function remainingTipsCount(userId) {
  const { data, error } = await adminClient.rpc('staging_smoke_list_tips', { p_user_id: userId });
  if (error) throw new Error(`staging_smoke_list_tips failed: ${error.message}`);
  return (data || []).length;
}

// Removes leftovers from an earlier run that died before its own cleanup.
// Only ever touches the fixed smoke-test user.
async function preRunCleanup() {
  const errors = await deleteSessionFixtures(SMOKE_TEST_USER_ID);
  if (errors.length > 0) throw new Error(`Pre-run fixture cleanup failed: ${errors.join('; ')}`);
  const { error: delErr } = await adminClient.auth.admin.deleteUser(SMOKE_TEST_USER_ID);
  if (delErr && delErr.status !== 404) throw new Error(`Pre-run auth user cleanup failed: ${delErr.message}`);
  const leftover = await remainingTipsCount(SMOKE_TEST_USER_ID);
  if (leftover !== 0) throw new Error(`Pre-run cleanup left ${leftover} canonical tips rows`);
  pass('Pre-run cleanup: no stale fixtures for fixed test user');
}

async function createTempAuthUser() {
  const RUN_ID = new Date().getTime().toString().slice(-6);
  const tempEmail = `smoke-${RUN_ID}-${crypto.randomBytes(4).toString('hex')}@staging.local`;
  const tempPassword = crypto.randomBytes(24).toString('hex');

  try {
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      id: SMOKE_TEST_USER_ID,
      email: tempEmail,
      password: tempPassword,
      email_confirm: true
    });

    if (createErr) throw new Error(`Failed to create temp auth user: ${createErr.message}`);
    // Live Mode is Pro-only (check_live_mode_pro_entitlement).
    const { error: profileErr } = await adminClient
      .from('profiles').upsert({ id: created.user.id, plan: 'pro' });
    if (profileErr) throw new Error(`Failed to grant Pro to temp user: ${profileErr.message}`);
    return { userId: created.user.id, email: tempEmail, password: tempPassword };
  } catch (e) {
    fail(`Create temp auth user: ${e.message}`);
    throw e;
  }
}

async function signInTempUser(email, password) {
  try {
    const { data: { session }, error: signInErr } = await anonClient.auth.signInWithPassword({
      email,
      password
    });
    if (signInErr) throw new Error(`Failed to sign in: ${signInErr.message}`);
    return session.access_token;
  } catch (e) {
    fail(`Sign in temp user: ${e.message}`);
    throw e;
  }
}

// Second creator for the cross-user check; random id, never whitelisted.
async function createRandomAuthUser() {
  const email = `smoke-other-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@staging.local`;
  const password = crypto.randomBytes(24).toString('hex');
  const { data, error } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`Failed to create second auth user: ${error.message}`);
  return { userId: data.user.id, email, password };
}

function clientForToken(token) {
  return createClient(STAGING_URL, STAGING_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function deleteTempAuthUser(userId) {
  try {
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.warn(`⚠ Could not delete auth user ${userId}: ${deleteErr.message}`);
    } else {
      pass(`Cleanup: Deleted auth user ${userId}`);
    }
  } catch (e) {
    console.warn(`⚠ Exception deleting auth user ${userId}: ${e.message}`);
  }
}

async function cleanupUserData(userId) {
  try {
    const errors = await deleteSessionFixtures(userId);
    if (errors.length > 0) {
      fail(`Cleanup: Failed to delete test data for user ${userId}: ${errors.join('; ')}`);
    } else {
      pass(`Cleanup: Deleted live_tips, pauses, sessions for user ${userId}`);
    }
  } catch (e) {
    fail(`Cleanup: exception deleting test data for user ${userId}: ${e.message}`);
  }
}

// Run after the auth user is deleted: its cascade must have removed the tips rows.
async function verifyTipsCleaned(userId) {
  try {
    const leftover = await remainingTipsCount(userId);
    assert(leftover === 0, `Cleanup: canonical tips rows removed (remaining: ${leftover})`);
  } catch (e) {
    fail(`Cleanup: could not verify tips removal: ${e.message}`);
  }
}

async function postTip(accessToken, username, tokens, platform, clientEventId, detectedAt) {
  const body = {
    username,
    amount: tokens,
    platform,
    clientEventId,
    detectedAt,
  };

  try {
    const res = await fetch(`${API_BASE}/api/live/tips`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      fail(`POST /api/live/tips failed: ${res.status} ${JSON.stringify(data)}`);
      return null;
    }
    return data;
  } catch (e) {
    fail(`POST /api/live/tips error: ${e.message}`);
    return null;
  }
}

// Website heartbeat: production's start creates a 'starting' session; the
// first heartbeat moves it to 'live' + live_substate 'active'.
async function sendWebsiteHeartbeat(accessToken) {
  try {
    const res = await fetch(`${API_BASE}/api/live/session/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      fail(`POST /api/live/session/heartbeat failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.session ?? null;
  } catch (e) {
    fail(`Heartbeat error: ${e.message}`);
    return null;
  }
}

async function readLiveTip(userId, clientEventId) {
  const { data, error } = await adminClient
    .from('live_tips').select('id, live_session_id, client_event_id')
    .eq('user_id', userId).eq('client_event_id', clientEventId);
  if (error) throw new Error(`Read live_tips failed: ${error.message}`);
  return data || [];
}

async function api(method, path, accessToken, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, ok: res.ok, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cents = (v) => Math.round(Number(v) * 100);

async function startLiveSession(accessToken) {
  try {
    const res = await fetch(`${API_BASE}/api/live/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      fail(`POST /api/live/session/start failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.session) {
      fail(`POST /api/live/session/start returned no session: ${JSON.stringify(data)}`);
      return null;
    }
    return data.session;
  } catch (e) {
    fail(`Start live session error: ${e.message}`);
    return null;
  }
}

async function pauseLiveSession(accessToken) {
  try {
    const res = await fetch(`${API_BASE}/api/live/session/pause`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      fail(`POST /api/live/session/pause failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.session) {
      fail(`POST /api/live/session/pause returned no session: ${JSON.stringify(data)}`);
      return null;
    }
    return data.session;
  } catch (e) {
    fail(`Pause live session error: ${e.message}`);
    return null;
  }
}

async function resumeLiveSession(accessToken) {
  try {
    const res = await fetch(`${API_BASE}/api/live/session/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      fail(`POST /api/live/session/resume failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.session) {
      fail(`POST /api/live/session/resume returned no session: ${JSON.stringify(data)}`);
      return null;
    }
    return data.session;
  } catch (e) {
    fail(`Resume live session error: ${e.message}`);
    return null;
  }
}

async function stopLiveSession(accessToken) {
  try {
    const res = await fetch(`${API_BASE}/api/live/session/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      fail(`POST /api/live/session/stop failed: ${res.status}`);
      return null;
    }
    // Full body, so callers can check both `session` and `alreadyStopped`.
    return await res.json();
  } catch (e) {
    fail(`Stop live session error: ${e.message}`);
    return null;
  }
}

async function queryLiveTips(userId) {
  try {
    const { data, error } = await adminClient
      .from('live_tips')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data || [];
  } catch (e) {
    fail(`Query live_tips error: ${e.message}`);
    return [];
  }
}

// Canonical tips are read through the staging-only helper; service_role has
// no SELECT on public.tips and must not be given one.
async function queryTips(userId) {
  try {
    const { data, error } = await adminClient.rpc('staging_smoke_list_tips', { p_user_id: userId });

    if (error) throw error;
    return data || [];
  } catch (e) {
    fail(`Query tips error: ${e.message}`);
    return [];
  }
}

// ─── Smoke Test Main ────────────────────────────────────────────────────────

async function runSmokeTest() {
  console.log('🌫️  Phase 2 Live Mode Staging Smoke Test');
  console.log(`   API Base: ${API_BASE}`);
  console.log(`   Running ${new Date().toISOString()}\n`);

  try {
    console.log('Step 0: Pre-run cleanup of stale fixtures');
    await preRunCleanup();

    // Step 1: Create temporary staging Auth user
    console.log('\nStep 1: Create temporary staging Auth user');
    tempUser = await createTempAuthUser();
    assert(tempUser && tempUser.userId, 'Temp user created with userId');

    // Step 2: Sign in and get access token
    console.log('\nStep 2: Sign in temp user');
    const accessToken = await signInTempUser(tempUser.email, tempUser.password);
    assert(accessToken, 'Access token obtained');

    // Step 3: Start live session
    console.log('\nStep 3: Start live session');
    liveSession = await startLiveSession(accessToken);
    assert(liveSession && liveSession.id, 'Live session created');
    if (!liveSession) throw new Error('Cannot continue without a live session');
    assert(liveSession.status === 'starting', `New session status is 'starting', got '${liveSession.status}'`);
    const wentLive = await sendWebsiteHeartbeat(accessToken);
    assert(
      wentLive && wentLive.id === liveSession.id && wentLive.status === 'live' && wentLive.live_substate === 'active',
      `First heartbeat moves it to live/active, got ${wentLive?.status}/${wentLive?.live_substate}`
    );

    // One running session per creator: a second live row must be refused
    // by live_sessions_one_running_per_user (any of starting/live/
    // inactive_warning/ending).
    const { data: dupRow, error: dupErr } = await adminClient
      .from('live_sessions')
      .insert({ user_id: tempUser.userId, status: 'live', live_substate: 'active', stream_platform: 'Chaturbate' })
      .select('id');
    assert(dupErr?.code === '23505', `Second running session for the same creator is rejected (23505), got ${dupErr ? dupErr.code : 'inserted ' + JSON.stringify(dupRow)}`);

    // Step 4: POST first tip (real event, not test)
    // Use Chaturbate ($0.05/token) so USD calculation is deterministic
    console.log('\nStep 4: POST first tip');
    firstClientEventId = generateUUID();
    const detectedAt1 = new Date().toISOString();
    const tipResponse1 = await postTip(accessToken, 'tipper_alice', 1000, 'chaturbate', firstClientEventId, detectedAt1);
    assert(tipResponse1 && tipResponse1.success === true, 'First tip POST succeeded');
    assert(tipResponse1.duplicate === false, 'First tip is not a duplicate');
    const tip1Rows = await readLiveTip(tempUser.userId, firstClientEventId);
    assert(tip1Rows.length === 1, `live_tips row saved with clientEventId ${firstClientEventId}`);
    assert(tip1Rows[0]?.live_session_id === liveSession.id, `First tip attached to session ${liveSession.id}, got ${tip1Rows[0]?.live_session_id}`);

    // Step 5: Verify exactly one live_tips + one tips row
    console.log('\nStep 5: Verify database state after first tip');
    const liveTips1 = await queryLiveTips(tempUser.userId);
    assert(liveTips1.length === 1, `Exactly 1 live_tips row, got ${liveTips1.length}`);
    const tips1 = await queryTips(tempUser.userId);
    assert(tips1.length === 1, `Exactly 1 canonical tips row, got ${tips1.length}`);
    assert(
      tips1.length === 1 && tips1[0].client_event_id === firstClientEventId,
      `Canonical tips row carries clientEventId ${firstClientEventId}`
    );

    // Step 6: Retry same clientEventId (duplicate detection)
    console.log('\nStep 6: Test idempotency - retry same clientEventId');
    const tipResponse1Retry = await postTip(accessToken, 'tipper_alice', 1000, 'chaturbate', firstClientEventId, detectedAt1);
    assert(tipResponse1Retry && tipResponse1Retry.success === true, 'Duplicate POST succeeded');
    assert(tipResponse1Retry.duplicate === true, 'Duplicate flag set to true');
    const liveTips1After = await queryLiveTips(tempUser.userId);
    assert(liveTips1After.length === 1, `Still exactly 1 live_tips row after duplicate, got ${liveTips1After.length}`);
    const tips1After = await queryTips(tempUser.userId);
    assert(tips1After.length === 1, `Still exactly 1 tips row after duplicate, got ${tips1After.length}`);

    // Step 7: Pause session
    console.log('\nStep 7: Pause live session');
    const pausedSession = await pauseLiveSession(accessToken);
    assert(
      pausedSession && pausedSession.status === 'live' && pausedSession.live_substate === 'paused',
      `Session paused (live/paused), got ${pausedSession?.status}/${pausedSession?.live_substate}`
    );

    // Step 8: Send second tip while paused
    console.log('\nStep 8: POST second tip while paused');
    secondClientEventId = generateUUID();
    const detectedAt2 = new Date().toISOString();
    const tipResponse2 = await postTip(accessToken, 'tipper_bob', 500, 'chaturbate', secondClientEventId, detectedAt2);
    assert(tipResponse2 && tipResponse2.success === true, 'Second tip POST succeeded');
    const tip2Rows = await readLiveTip(tempUser.userId, secondClientEventId);
    assert(tip2Rows[0]?.live_session_id === liveSession.id, `Tip sent while paused attached to the same session, got ${tip2Rows[0]?.live_session_id}`);

    // Step 9: Verify two tips now in database
    console.log('\nStep 9: Verify both tips in database');
    const liveTips2 = await queryLiveTips(tempUser.userId);
    assert(liveTips2.length === 2, `Exactly 2 live_tips rows, got ${liveTips2.length}`);
    const tips2 = await queryTips(tempUser.userId);
    assert(tips2.length === 2, `Exactly 2 canonical tips rows, got ${tips2.length}`);
    const tipEventIds = tips2.map((t) => t.client_event_id).sort();
    deepEqual(tipEventIds, [firstClientEventId, secondClientEventId].sort(), 'Canonical tips rows are exactly the two sent clientEventIds');

    // Step 10: Resume session
    console.log('\nStep 10: Resume live session');
    const resumedSession = await resumeLiveSession(accessToken);
    assert(
      resumedSession && resumedSession.status === 'live' && resumedSession.live_substate === 'active',
      `Session resumed (live/active), got ${resumedSession?.status}/${resumedSession?.live_substate}`
    );

    // Step 11: Stop (finalize) session through the real API route
    console.log('\nStep 11: Stop (finalize) live session');
    const stopBody1 = await stopLiveSession(accessToken);
    const stoppedSession = stopBody1?.session ?? null;
    assert(stoppedSession && stoppedSession.id === liveSession.id, `Stop returned the same session ${liveSession.id}`);
    if (!stoppedSession) throw new Error('Cannot verify finalization without a stopped session');
    assert(stopBody1.alreadyStopped === false, `First Stop reports alreadyStopped=false, got ${stopBody1.alreadyStopped}`);
    assert(stoppedSession.status === 'ended', `Session finalized, status: ${stoppedSession.status}`);
    assert(stoppedSession.paused_at === null, `paused_at cleared, got ${stoppedSession.paused_at}`);
    assert(stoppedSession.is_active === false, `is_active=false, got ${stoppedSession.is_active}`);
    assert(stoppedSession.session_resolution_type === 'normal_stop', `session_resolution_type='normal_stop', got ${stoppedSession.session_resolution_type}`);

    // Step 12: Verify final metrics reflect both tips
    // tipper_alice 1000 tokens × $0.05 = $50; tipper_bob 500 × $0.05 = $25.
    console.log('\nStep 12: Verify final metrics');
    const fm = stoppedSession;
    assert(fm.final_tip_count === 2, `Final tip count: 2, got ${fm.final_tip_count}`);
    assert(fm.final_total_usd === 75, `Final USD (1000×0.05 + 500×0.05 = 50 + 25 = 75), got ${fm.final_total_usd}`);
    assert(fm.final_unique_tippers === 2, `Final unique tippers: 2, got ${fm.final_unique_tippers}`);
    assert(fm.final_tokens === 1500, `Final tokens: 1500, got ${fm.final_tokens}`);
    assert(fm.final_top_tipper_username === 'tipper_alice', `Top tipper: tipper_alice, got ${fm.final_top_tipper_username}`);
    assert(fm.final_top_tipper_usd === 50, `Top tipper USD: 50, got ${fm.final_top_tipper_usd}`);
    assert(fm.final_largest_tip_usd === 50, `Largest tip USD: 50, got ${fm.final_largest_tip_usd}`);
    assert(fm.final_avg_tip_usd === 37.5, `Average tip USD: 37.5, got ${fm.final_avg_tip_usd}`);
    assert(typeof fm.finalized_at === 'string' && fm.finalized_at.length > 0, `finalized_at set, got ${fm.finalized_at}`);
    assert(fm.finalized_at === fm.ended_at, `finalized_at equals ended_at (one authoritative end time): ${fm.finalized_at} vs ${fm.ended_at}`);

    const elapsedSec = Math.round((new Date(fm.ended_at).getTime() - new Date(fm.started_at).getTime()) / 1000);
    const expectedDuration = Math.max(0, elapsedSec - fm.total_paused_seconds);
    assert(
      Number.isInteger(fm.final_duration_seconds) && Math.abs(fm.final_duration_seconds - expectedDuration) <= 1,
      `final_duration_seconds excludes paused time: expected ~${expectedDuration} (elapsed ${elapsedSec}s − paused ${fm.total_paused_seconds}s), got ${fm.final_duration_seconds}`
    );
    if (fm.final_duration_seconds > 0) {
      const expectedPerHour = Math.round((75 / fm.final_duration_seconds) * 3600 * 100) / 100;
      assert(
        typeof fm.final_usd_per_hour === 'number' && Math.abs(fm.final_usd_per_hour - expectedPerHour) <= 0.01,
        `final_usd_per_hour: expected ${expectedPerHour}, got ${fm.final_usd_per_hour}`
      );
    } else {
      assert(fm.final_usd_per_hour === null, `final_usd_per_hour is null for zero duration, got ${fm.final_usd_per_hour}`);
    }

    const METRIC_KEYS = [
      'final_tip_count', 'final_total_usd', 'final_tokens', 'final_unique_tippers',
      'final_top_tipper_username', 'final_top_tipper_usd', 'final_largest_tip_usd',
      'final_avg_tip_usd', 'final_usd_per_hour', 'final_duration_seconds',
      'finalized_at', 'ended_at', 'total_paused_seconds', 'status',
    ];
    const firstMetrics = Object.fromEntries(METRIC_KEYS.map((k) => [k, fm[k]]));

    // Step 13: Call Stop again (idempotency)
    console.log('\nStep 13: Stop again (idempotency check)');
    const stopBody2 = await stopLiveSession(accessToken);
    const stoppedSessionAgain = stopBody2?.session ?? null;
    assert(stopBody2 && stopBody2.alreadyStopped === true, `Repeated Stop reports alreadyStopped=true, got ${stopBody2?.alreadyStopped}`);
    assert(stoppedSessionAgain && stoppedSessionAgain.id === liveSession.id, `Repeated Stop returns the same session ${liveSession.id}, got ${stoppedSessionAgain?.id}`);
    assert(stoppedSessionAgain?.status === 'ended', `Session still ended, status: ${stoppedSessionAgain?.status}`);

    // Step 14: Every metric must be present on the first Stop before
    // "unchanged" means anything (null === null must not count as a pass).
    console.log('\nStep 14: Verify all metrics unchanged on second stop');
    const mustBePresent = METRIC_KEYS.filter((k) => !(k === 'final_usd_per_hour' && fm.final_duration_seconds === 0));
    const missing = mustBePresent.filter((k) => firstMetrics[k] === null || firstMetrics[k] === undefined);
    assert(missing.length === 0, `First Stop returned every final value (missing: ${missing.join(', ') || 'none'})`);
    if (missing.length === 0 && stoppedSessionAgain) {
      for (const key of METRIC_KEYS) {
        deepEqual(stoppedSessionAgain[key], firstMetrics[key], `${key} unchanged on repeated Stop`);
      }
    } else {
      fail('Skipped unchanged-metric comparison: first Stop values incomplete or repeated Stop returned no session');
    }

    // Step 15: The persisted row (not just the API response) holds the same values
    console.log('\nStep 15: Verify persisted live_sessions row and pause history');
    const { data: dbRow, error: dbRowErr } = await adminClient
      .from('live_sessions')
      .select(METRIC_KEYS.join(','))
      .eq('id', liveSession.id)
      .single();
    assert(!dbRowErr && dbRow, `Read persisted live_sessions row${dbRowErr ? `: ${dbRowErr.message}` : ''}`);
    if (dbRow) {
      for (const key of METRIC_KEYS) {
        // timestamps may be formatted differently between RPC and table reads
        const a = key.endsWith('_at') && dbRow[key] ? new Date(dbRow[key]).getTime() : dbRow[key];
        const b = key.endsWith('_at') && firstMetrics[key] ? new Date(firstMetrics[key]).getTime() : firstMetrics[key];
        deepEqual(a, b, `Persisted ${key} matches Stop response`);
      }
    }
    const { data: pauseRows, error: pauseErr } = await adminClient
      .from('live_session_pauses')
      .select('id,resumed_at,pause_duration_seconds')
      .eq('session_id', liveSession.id);
    assert(!pauseErr && Array.isArray(pauseRows) && pauseRows.length >= 1, `Pause history recorded (${pauseRows?.length ?? 0} rows)${pauseErr ? `: ${pauseErr.message}` : ''}`);
    assert(
      Array.isArray(pauseRows) && pauseRows.every((p) => p.resumed_at !== null && p.pause_duration_seconds !== null),
      'Every pause history row is closed after Stop'
    );

    // Step 16: Another creator must not be able to re-finalize this session.
    // _finalize_live_session_metrics runs with the caller's rights, so
    // live_sessions RLS hides other creators' rows from it.
    console.log('\nStep 16: Cross-user finalization is rejected');
    const RECALC_KEYS = [...METRIC_KEYS, 'last_heartbeat_at', 'updated_at'].filter((k, i, a) => a.indexOf(k) === i);
    const readSessionRow = async () => {
      const { data, error } = await adminClient
        .from('live_sessions').select('*').eq('id', liveSession.id).single();
      if (error) throw new Error(`Read live_sessions row failed: ${error.message}`);
      return data;
    };
    const before = await readSessionRow();

    otherUser = await createRandomAuthUser();
    const otherToken = await signInTempUser(otherUser.email, otherUser.password);
    const otherClient = clientForToken(otherToken);

    const { data: crossData, error: crossErr } = await otherClient.rpc('_finalize_live_session_metrics', { p_session_id: liveSession.id });
    assert(!crossErr && !crossData?.id, `Other user gets no row back (${crossErr ? crossErr.code : 'no error'}, id=${crossData?.id ?? null})`);

    const { data: missingData, error: missingErr } = await otherClient.rpc('_finalize_live_session_metrics', { p_session_id: generateUUID() });
    assert(
      !crossErr && !missingErr && JSON.stringify(crossData) === JSON.stringify(missingData),
      'Response is identical to a nonexistent session (no id leak)'
    );

    // Fresh client: the shared anonClient carries whichever user signed in last.
    const pureAnon = createClient(STAGING_URL, STAGING_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: anonErr } = await pureAnon.rpc('_finalize_live_session_metrics', { p_session_id: liveSession.id });
    assert(anonErr && anonErr.code === '42501', `Anonymous caller is refused with 42501, got ${anonErr ? anonErr.code : 'no error'}`);

    const afterCross = await readSessionRow();
    for (const key of RECALC_KEYS) {
      if (!(key in before)) continue;
      deepEqual(afterCross[key], before[key], `${key} untouched by other-user/anon calls`);
    }

    // Positive control: the owner can re-finalize, and values do not move.
    const { data: ownData, error: ownErr } = await clientForToken(accessToken).rpc('_finalize_live_session_metrics', { p_session_id: liveSession.id });
    assert(!ownErr && ownData?.id === liveSession.id, `Owner may re-finalize own session${ownErr ? `: ${ownErr.code} ${ownErr.message}` : ''}`);
    const afterOwn = await readSessionRow();
    for (const key of METRIC_KEYS) {
      deepEqual(afterOwn[key], before[key], `${key} unchanged after owner re-finalization`);
    }

    // Step 17: simultaneous tips from three platforms, two of them identical
    // in username/amount/timestamp. Each keeps its own platform end to end.
    console.log('\nStep 17: Simultaneous multi-platform tips keep their platform in API and DB');
    const mpAt = new Date().toISOString();
    const mpTips = [
      { platform: 'chaturbate', username: 'MultiFan', tokens: 200, id: generateUUID() },
      { platform: 'myfreecams', username: 'MultiFan', tokens: 200, id: generateUUID() },
      { platform: 'bongacams', username: 'MultiFan', tokens: 200, id: generateUUID() },
    ];
    const mpResponses = await Promise.all(mpTips.map((t) => postTip(accessToken, t.username, t.tokens, t.platform, t.id, mpAt)));
    assert(mpResponses.every((r) => r && r.success === true && r.duplicate === false), 'All three simultaneous tips accepted as new events');
    for (const t of mpTips) {
      const rows = await readLiveTip(tempUser.userId, t.id);
      const { data: lt } = await adminClient.from('live_tips').select('platform').eq('client_event_id', t.id);
      assert(rows.length === 1 && lt?.[0]?.platform === t.platform, `live_tips row for ${t.platform} keeps platform ${t.platform}, got ${lt?.[0]?.platform}`);
    }
    const canonical = await queryTips(tempUser.userId);
    for (const t of mpTips) {
      const c = canonical.filter((r) => r.client_event_id === t.id);
      assert(c.length === 1 && c[0].platform === t.platform, `canonical tips row for ${t.platform} keeps platform ${t.platform}, got ${c[0]?.platform}`);
    }
    const sameKey = canonical.filter((r) => r.username === 'MultiFan' && r.tokens === 200 && ['chaturbate', 'myfreecams'].includes(r.platform));
    assert(sameKey.length === 2, `Same fan/amount/time on Chaturbate and MyFreeCams both stored (${sameKey.length} rows)`);

    // ── Post-show reconciliation ─────────────────────────────────────────────
    const firstShowId = liveSession.id;

    // Step 18: a second show with simultaneous multi-platform tips and two
    // private intervals; Stop while the second private is still open.
    console.log('\nStep 18: Second show — multi-platform tips, two private intervals, Stop while private');
    const show2 = await startLiveSession(accessToken);
    assert(show2 && show2.id && show2.id !== firstShowId, `Second show started (${show2?.id})`);
    if (!show2) throw new Error('Cannot continue without a second show');
    const live2 = await sendWebsiteHeartbeat(accessToken);
    assert(live2?.status === 'live', `Second show is live, got ${live2?.status}`);
    const s2At = new Date().toISOString();
    const s2Tips = [
      { platform: 'chaturbate', username: 'S2Alice', tokens: 100, id: generateUUID() }, // $5.00
      { platform: 'bongacams', username: 'S2Bob', tokens: 100, id: generateUUID() },    // $2.50
      { platform: 'myfreecams', username: 'S2Alice', tokens: 60, id: generateUUID() },  // $3.00
    ];
    const s2Res = await Promise.all(s2Tips.map((t) => postTip(accessToken, t.username, t.tokens, t.platform, t.id, s2At)));
    assert(s2Res.every((r) => r?.success === true && r.duplicate === false), 'Three simultaneous multi-platform tips accepted');

    const p1 = await api('POST', '/api/live/session/private/start', accessToken, { ratePerMinute: 6 });
    assert(p1.ok && p1.data?.privateInterval?.id, `Private #1 started (${p1.status})`);
    const p1Again = await api('POST', '/api/live/session/private/start', accessToken, { ratePerMinute: 99 });
    assert(p1Again.data?.privateInterval?.id === p1.data?.privateInterval?.id, 'Repeated Start Private returns the open interval');
    const stillLive = await api('GET', '/api/live/session', accessToken);
    assert(stillLive.data?.session?.status === 'live' && stillLive.data?.privateInterval?.id === p1.data?.privateInterval?.id,
      'Starting private does not pause or end the show, and the open interval is reported');
    await sleep(1500);
    const p1End = await api('POST', '/api/live/session/private/end', accessToken);
    const p1Row = p1End.data?.privateInterval;
    const p1Secs = p1Row ? (Date.parse(p1Row.ended_at) - Date.parse(p1Row.started_at)) / 1000 : NaN;
    assert(p1Row && p1Row.ended_at && cents(p1Row.estimated_earnings_usd) === Math.round(6 * p1Secs / 60 * 100),
      `Private #1 closed at $6/min × ${p1Secs}s = ${p1Row?.estimated_earnings_usd}`);
    const p2 = await api('POST', '/api/live/session/private/start', accessToken, { ratePerMinute: 3 });
    assert(p2.ok && p2.data?.privateInterval?.id && p2.data.privateInterval.id !== p1Row?.id, 'Private #2 started in the same show');
    await sleep(1000);

    const stop2 = await stopLiveSession(accessToken);
    const sum2 = stop2?.summary;
    assert(stop2 && stop2.alreadyStopped === false && sum2?.id === show2.id, 'Stop returned the second show summary');
    const { data: s2Row } = await adminClient.from('live_sessions').select('*').eq('id', show2.id).single();
    const { data: s2Intervals } = await adminClient.from('live_private_intervals').select('*').eq('live_session_id', show2.id).order('started_at');
    assert(s2Intervals?.length === 2 && s2Intervals.every((i) => i.ended_at), `Both private intervals closed (${s2Intervals?.length})`);
    assert(s2Intervals?.[1] && Date.parse(s2Intervals[1].ended_at) === Date.parse(s2Row.ended_at),
      `Open private interval closed at the show's ended_at (${s2Intervals?.[1]?.ended_at} vs ${s2Row?.ended_at})`);
    const p2Secs = (Date.parse(s2Intervals[1].ended_at) - Date.parse(s2Intervals[1].started_at)) / 1000;
    assert(cents(s2Intervals[1].estimated_earnings_usd) === Math.round(3 * p2Secs / 60 * 100), `Private #2 earnings = $3/min × ${p2Secs}s`);

    // Step 19: every displayed value equals the persisted data, recomputed independently.
    console.log('\nStep 19: Show summary equals persisted DB values');
    const { data: s2Canon } = await adminClient.rpc('staging_smoke_list_session_tips', { p_user_id: tempUser.userId, p_live_session_id: show2.id });
    const pubCents = (s2Canon || []).reduce((a, t) => a + cents(t.usd), 0);
    const privCents = s2Intervals.reduce((a, i) => a + cents(i.estimated_earnings_usd), 0);
    assert(s2Canon?.length === 3 && pubCents === 1050, `Canonical tips for show 2: 3 rows, $10.50 (got ${s2Canon?.length}, ${pubCents / 100})`);
    assert(cents(sum2.publicUsd) === pubCents, `Public earnings ${sum2.publicUsd} = canonical tips ${pubCents / 100}`);
    assert(cents(sum2.privateUsd) === privCents, `Private earnings ${sum2.privateUsd} = sum of intervals ${privCents / 100}`);
    assert(cents(sum2.totalUsd) === pubCents + privCents, `Total ${sum2.totalUsd} = public + private`);
    assert(cents(s2Row.final_total_usd) === cents(sum2.totalUsd) && cents(s2Row.final_public_usd) === pubCents && cents(s2Row.final_private_usd) === privCents,
      'Summary matches the finalized live_sessions row');
    const byPf = Object.fromEntries((sum2.platformRevenue || []).map((p) => [p.platform, p]));
    assert(cents(byPf.chaturbate?.usd) === 500 && cents(byPf.bongacams?.usd) === 250 && cents(byPf.myfreecams?.usd) === 300,
      `Platform revenue CB $5.00 / BC $2.50 / MFC $3.00, got ${JSON.stringify(sum2.platformRevenue)}`);
    // S2Alice on Chaturbate and on MyFreeCams are two different fans (platform:username).
    assert(sum2.tipCount === 3 && sum2.uniqueTippers === 3, `3 tips, 3 unique tippers (got ${sum2.tipCount}, ${sum2.uniqueTippers})`);
    assert(sum2.topTipper?.username === 'S2Alice' && cents(sum2.topTipper?.usd) === 500, `Top tipper S2Alice $5.00 (Chaturbate only), got ${JSON.stringify(sum2.topTipper)}`);
    assert(cents(sum2.largestTipUsd) === 500, `Largest tip $5.00, got ${sum2.largestTipUsd}`);
    assert(sum2.durationSeconds === s2Row.final_duration_seconds && sum2.privateSeconds === s2Row.final_private_seconds,
      'Duration and private duration match the row');
    assert(sum2.privateIntervals.length === 2, 'Both private intervals listed in the summary');

    // Step 20: repeated Stop and refreshes never duplicate a show or its earnings.
    console.log('\nStep 20: Repeated Stop / refresh do not duplicate');
    const stop2Again = await stopLiveSession(accessToken);
    assert(stop2Again?.alreadyStopped === true && stop2Again.summary?.id === show2.id && cents(stop2Again.summary.totalUsd) === cents(sum2.totalUsd),
      'Repeated Stop returns the same show with the same total');
    const r1 = await api('GET', '/api/live/sessions/recent', accessToken);
    const r2 = await api('GET', '/api/live/sessions/recent', accessToken);
    assert(r1.ok && JSON.stringify(r1.data) === JSON.stringify(r2.data), 'Two refreshes return identical shows');
    const ids = (r1.data?.shows || []).map((x) => x.id);
    assert(ids.length === 2 && new Set(ids).size === 2 && ids[0] === show2.id && ids[1] === firstShowId,
      `Exactly two distinct shows, newest first (${JSON.stringify(ids)})`);

    // Step 21: a delayed tip reconciles into the correct finalized show.
    console.log('\nStep 21: Delayed tip updates the correct finalized show');
    const show1Before = r1.data.shows.find((x) => x.id === firstShowId);
    const midShow2 = new Date((Date.parse(s2Row.started_at) + Date.parse(s2Row.ended_at)) / 2).toISOString();
    const late = await postTip(accessToken, 'LateFan', 40, 'chaturbate', generateUUID(), midShow2); // $2.00
    assert(late?.success === true, 'Delayed tip accepted');
    const r3 = await api('GET', '/api/live/sessions/recent', accessToken);
    const s2After = r3.data?.shows?.find((x) => x.id === show2.id);
    const s1After = r3.data?.shows?.find((x) => x.id === firstShowId);
    assert(cents(s2After?.totalUsd) === cents(sum2.totalUsd) + 200 && cents(s2After?.publicUsd) === pubCents + 200 && s2After?.tipCount === 4,
      `Show 2 total +$2.00 → ${s2After?.totalUsd}`);
    assert(JSON.stringify(s1After) === JSON.stringify(show1Before), 'Show 1 unchanged by the delayed tip');

    // Step 22-23: NEW per account; acknowledgement persists across devices.
    console.log('\nStep 22: NEW appears for unacknowledged shows; acknowledgement persists across devices');
    assert(s2After?.isNew === true && s1After?.isNew === true, 'Both finalized shows start as NEW');
    const ack2 = await api('POST', '/api/live/sessions/acknowledge', accessToken, { sessionIds: [show2.id] });
    assert(ack2.ok && ack2.data?.acknowledged?.[0]?.id === show2.id, 'Acknowledged show 2 (device 1)');
    const device2Token = await signInTempUser(tempUser.email, tempUser.password);
    assert(device2Token && device2Token !== accessToken, 'Signed in on a second device');
    const d2 = await api('GET', '/api/live/sessions/recent', device2Token);
    const d2s2 = d2.data?.shows?.find((x) => x.id === show2.id);
    const d2s1 = d2.data?.shows?.find((x) => x.id === firstShowId);
    assert(d2s2?.isNew === false && d2s1?.isNew === true, 'Second device: show 2 already seen, show 1 still NEW');
    const ackAgain = await api('POST', '/api/live/sessions/acknowledge', device2Token, { sessionIds: [show2.id] });
    assert(ackAgain.data?.acknowledged?.[0]?.seenAt === ack2.data?.acknowledged?.[0]?.seenAt, 'Re-acknowledging keeps the first seen time');
    await api('POST', '/api/live/sessions/acknowledge', device2Token, { sessionIds: [firstShowId] });
    const d1 = await api('GET', '/api/live/sessions/recent', accessToken);
    assert((d1.data?.shows || []).every((x) => x.isNew === false), 'Device 1 sees both acknowledged');

    // Step 24: two completed shows stay two sessions with their own totals.
    console.log('\nStep 24: Two shows are two distinct sessions, never combined');
    const finalShows = d1.data?.shows || [];
    assert(finalShows.length === 2, `Two shows (${finalShows.length})`);
    assert(cents(finalShows[1].totalUsd) === 7500, `Show 1 still $75.00 (${finalShows[1]?.totalUsd})`);
    assert(cents(finalShows[0].totalUsd) === cents(s2After.totalUsd), `Show 2 keeps its own total (${finalShows[0]?.totalUsd})`);

  } catch (e) {
    fail(`Unhandled error: ${e.message}`);
    console.error(e);
  } finally {
    // Always cleanup, even on failure
    console.log('\n📝 Cleanup');
    if (tempUser) {
      await cleanupUserData(tempUser.userId);
      await deleteTempAuthUser(tempUser.userId);
      await verifyTipsCleaned(tempUser.userId);
    }
    if (otherUser) {
      await deleteTempAuthUser(otherUser.userId);
    }
  }

  // Report results
  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log('='.repeat(60));

  process.exit(failCount > 0 ? 1 : 0);
}

// Run the test
runSmokeTest().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
