// Real-browser pass of the post-show flow against STAGING (never production).
//
// A fresh staging creator signs in through the real landing-page form, goes
// live on /live, receives simultaneous multi-platform tips through the same
// API the extension uses, runs a private interval, stops the show, then the
// dashboard is checked in Chromium: NEW / just ended, totals, public/private,
// platform split, tip stats, durations, the "+$X from latest show" delta, and
// that acknowledgement clears NEW (persisted). Screenshots are written to
// BROWSER_ARTIFACTS_DIR. Expected values come from the persisted row.
//
// Run: node staging-browser-pass.mjs (needs the staging env vars below and
// the app running at CAMCASH_STAGING_BASE_URL).

import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { middayTimezone } from './midday-timezone.mjs';
import { assertStagingTargets } from './staging-guard.mjs';
const TEST_TZ = middayTimezone();

const STAGING_URL = process.env.SUPABASE_STAGING_URL;
const STAGING_ANON_KEY = process.env.SUPABASE_STAGING_ANON_KEY;
const STAGING_SERVICE_ROLE_KEY = process.env.SUPABASE_STAGING_SERVICE_ROLE_KEY;
const APP = process.env.CAMCASH_STAGING_BASE_URL;
const OUT = process.env.BROWSER_ARTIFACTS_DIR || path.resolve('browser-artifacts');

for (const [k, v] of Object.entries({ SUPABASE_STAGING_URL: STAGING_URL, SUPABASE_STAGING_ANON_KEY: STAGING_ANON_KEY, SUPABASE_STAGING_SERVICE_ROLE_KEY: STAGING_SERVICE_ROLE_KEY, CAMCASH_STAGING_BASE_URL: APP })) {
  if (!v) { console.error(`❌ Missing ${k}`); process.exit(1); }
}
assertStagingTargets({ supabaseUrl: STAGING_URL, appBaseUrl: APP });
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const shot = async (page, name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${path.basename(file)}`);
};
const usd = (v) => `$${(Number(v) || 0).toFixed(2)}`;
const fmtDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
};

const admin = createClient(STAGING_URL, STAGING_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The landing page is client-rendered: wait until React has hydrated the
// auth form (the Log In tab switches the password placeholder) before typing.
async function signIn(page, email, password) {
  await page.goto(`${APP}/landing`, { waitUntil: 'networkidle' });
  const pwInLogin = page.locator('input[type="password"][placeholder="Password"]:visible').first();
  // Up to ~2 min: a cold `next dev` compile of /landing can exceed 30s on a
  // slow runner. Each click gets 5s (not the page's 120s default, which let
  // one blocked click eat the whole budget); reload every 30 tries.
  for (let i = 0; i < 120 && !(await pwInLogin.count()); i++) {
    if (i > 0 && i % 30 === 0) await page.goto(`${APP}/landing`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.getByRole('button', { name: 'Log In', exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  await pwInLogin.waitFor({ state: 'visible', timeout: 10_000 });
  const form = page.locator('form', { has: pwInLogin }).first();
  await form.locator('input[type="email"]').fill(email);
  await pwInLogin.fill(password);
  await pwInLogin.press('Enter');
}

async function main() {
  // ── staging creator: Pro, onboarded ──────────────────────────────────────
  const email = `browser-pass-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@staging.local`;
  const password = crypto.randomBytes(18).toString('hex');
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error(`create user: ${createErr.message}`);
  const userId = created.user.id;
  let browser;
  let ext;
  try {
    const { error: pErr } = await admin.from('profiles').upsert({ id: userId, plan: 'pro' });
    if (pErr) throw new Error(`profile: ${pErr.message}`);
    const { error: bErr } = await admin.from('beta_users').insert({ user_id: userId, email, onboarding_complete: true });
    if (bErr) throw new Error(`beta_users: ${bErr.message}`);

    // Extension-side token for posting tips through /api/live/tips.
    ext = createClient(STAGING_URL, STAGING_ANON_KEY, { auth: { persistSession: false } });
    const { data: extAuth, error: extErr } = await ext.auth.signInWithPassword({ email, password });
    if (extErr) throw new Error(`extension sign-in: ${extErr.message}`);
    const extToken = extAuth.session.access_token;

    const startMs = Date.now();

    const launch = { headless: true, args: ['--no-sandbox'] };
    if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
    browser = await chromium.launch(launch);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: TEST_TZ });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

    // ── sign in through the real landing form ───────────────────────────────
    console.log('\nStep 1: Sign in');
    await signIn(page, email, password);
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 120_000 });
    check('Signed in through the landing form', /\/dashboard|\/onboarding/.test(page.url()), page.url());

    // ── go live ─────────────────────────────────────────────────────────────
    console.log('\nStep 2: Go Live');
    await page.goto(`${APP}/live`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Start Streaming/ }).first().click();
    await page.getByRole('button', { name: /Pause/ }).first().waitFor({ state: 'visible' });
    const { data: running } = await admin.from('live_sessions').select('id,status,live_substate').eq('user_id', userId)
      .in('status', ['starting', 'live', 'inactive_warning', 'ending']).maybeSingle();
    check('Show is live (live/active)', running?.status === 'live' && running?.live_substate === 'active', JSON.stringify(running));
    await shot(page, '01-live-show-running');
    const sessionId = running?.id;

    // ── simultaneous multi-platform tips (the extension's API path) ─────────
    console.log('\nStep 3: Multi-platform tips');
    const at = new Date().toISOString();
    const tips = [
      { username: 'BrowserAlice', amount: 100, platform: 'chaturbate' }, // $5.00
      { username: 'BrowserBob', amount: 100, platform: 'bongacams' },    // $2.50
      { username: 'BrowserAlice', amount: 60, platform: 'myfreecams' },  // $3.00
    ];
    const responses = await Promise.all(tips.map((t) => fetch(`${APP}/api/live/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${extToken}` },
      body: JSON.stringify({ ...t, clientEventId: crypto.randomUUID(), detectedAt: at }),
    }).then((r) => r.json())));
    check('Three simultaneous tips accepted', responses.every((r) => r.success === true && r.duplicate === false), JSON.stringify(responses));

    // ── Sessions while live: the LIVE NOW hero takes the top ────────────────
    console.log('\nStep 3b: Sessions — LIVE NOW hero');
    await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.locator('text="Free Chat Sessions" >> visible=true').first().click();
    const liveHero = page.getByTestId('hero-live');
    await liveHero.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-testid="details-total"]')?.textContent?.trim() === '$10.50', null, { timeout: 60_000 }).catch(() => {});
    check('LIVE NOW chip in the Today hero', /LIVE NOW/.test((await liveHero.textContent()) || ''));
    check('Running show leads Recent Sessions', (await page.getByTestId('session-history').locator('[data-testid^="history-"]').first().getAttribute('data-testid')) === `history-running:${sessionId}`);
    check('Running show details = public tips this session ($10.50)', ((await page.getByTestId('details-total').textContent()) || '').trim() === '$10.50', await page.getByTestId('details-total').textContent());
    await shot(page, '02b-sessions-live-now');
    // Leave the dashboard on Command Center: it remembers the last tab, and
    // Sessions auto-acknowledges a NEW show after 3s, which would clear the
    // overview delta checked in Step 6 before the test sees it.
    await page.locator('text="Command Center" >> visible=true').first().click();
    await page.waitForTimeout(500);
    await page.goto(`${APP}/live`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Pause/ }).first().waitFor({ state: 'visible' });

    // ── private interval with a known rate ──────────────────────────────────
    console.log('\nStep 4: Private show');
    await page.getByTestId('private-rate').fill('6');
    await page.getByTestId('private-start').click();
    await page.getByTestId('private-end').waitFor({ state: 'visible' });
    await shot(page, '02-live-private-running');
    await page.waitForTimeout(5000);
    await page.getByTestId('private-end').click();
    await page.getByTestId('private-start').waitFor({ state: 'visible' });
    const { data: intervals } = await admin.from('live_private_intervals').select('*').eq('live_session_id', sessionId);
    check('Private interval closed with earnings', intervals?.length === 1 && intervals[0].ended_at && Number(intervals[0].estimated_earnings_usd) > 0, JSON.stringify(intervals));

    // ── stop ────────────────────────────────────────────────────────────────
    console.log('\nStep 5: Stop');
    await page.getByRole('button', { name: /End$/ }).first().click();
    await page.waitForTimeout(1500);
    await shot(page, '03-live-show-stopped');
    const { data: row } = await admin.from('live_sessions').select('*').eq('id', sessionId).single();
    check('Show finalized', row?.status === 'ended' && !!row?.finalized_at, JSON.stringify({ status: row?.status, finalized_at: row?.finalized_at }));

    // ── earlier today, before the show: a free-chat session (extension tips,
    // no Live show running) and one imported private session. Sent after Stop
    // with their earlier detection times, so the Live page's go-live flow is
    // untouched and no tip falls inside the show's window. ─────────────────
    console.log('\nStep 5b: Free chat + imported private earlier today');
    const freeChat = [
      { username: 'FreeCara', amount: 200, platform: 'bongacams', detectedAt: new Date(startMs - 50 * 60000).toISOString() }, // $5.00
      { username: 'FreeDan', amount: 100, platform: 'bongacams', detectedAt: new Date(startMs - 10 * 60000).toISOString() },  // $2.50
    ];
    const fcRes = [];
    for (const t of freeChat) {
      fcRes.push(await fetch(`${APP}/api/live/tips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${extToken}` },
        body: JSON.stringify({ ...t, clientEventId: crypto.randomUUID() }),
      }).then((r) => r.json()));
    }
    check('Free-chat tips accepted with no show running', fcRes.every((r) => r.success === true && !r.live_session_id), JSON.stringify(fcRes));
    const { error: paidErr } = await ext.from('paid_sessions').insert({
      user_id: userId, date_time: new Date(startMs - 30 * 60000).toISOString(), platform: 'bongacams',
      username: 'PrivFay', username_lower: 'privfay', session_type: 'private', tokens: 400, usd: 10, usd_rounded: 10,
    });
    check('Imported private session seeded (own-row RLS)', !paidErr, paidErr?.message);
    const FREE_CHAT_USD = 7.5, PAID_USD = 10;


    // ── dashboard overview: KPI delta ───────────────────────────────────────
    console.log('\nStep 6: Dashboard overview');
    await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' });
    const deltaLabel = page.getByTestId('latest-show-delta-label');
    await deltaLabel.waitFor({ state: 'visible' });
    const expectedDelta = `+${usd(row.final_total_usd)} from latest show`;
    check('Overview shows the latest-show delta', (await deltaLabel.textContent()).trim() === expectedDelta, `${await deltaLabel.textContent()} vs ${expectedDelta}`);
    await shot(page, '04-dashboard-overview-delta');

    // ── Sessions: the finished show, NEW, every value ───────────────────────
    console.log('\nStep 7: Sessions — finished show');
    await page.locator('text="Free Chat Sessions" >> visible=true').first().click();
    const liveRow = page.getByTestId(`history-live:${sessionId}`);
    await liveRow.waitFor({ state: 'visible' });
    // Checked first: viewing Sessions for 3s acknowledges the show.
    check('Marked NEW / just ended (row)', (await liveRow.getByTestId('row-new-badge').count()) === 1 && /JUST ENDED/.test((await liveRow.textContent()) || ''));
    await shot(page, '05-dashboard-sessions-new-show');
    await page.locator('.sx-md').screenshot({ path: path.join(OUT, '05e-master-detail-selected.png') });
    console.log('📸 05e-master-detail-selected.png');
    const breakdown = row.final_platform_breakdown || {};
    const history = page.getByTestId('session-history');
    check('Finished show is first in Recent Sessions and selected',
      (await history.locator('[data-testid^="history-"]').first().getAttribute('data-testid')) === `history-live:${sessionId}` && (await liveRow.getAttribute('aria-pressed')) === 'true');
    check('No "No sessions yet" while a finalized show exists', (await page.getByTestId('history-empty').count()) === 0);
    check('No separate Latest live shows area', (await page.getByTestId('latest-shows').count()) === 0);
    check('No detailed-breakdown section on Sessions', (await page.locator('text=Session Breakdown (detailed)').count()) === 0);
    const statVal = async (id) => ((await page.getByTestId(id).textContent()) || '').trim();
    // Session Details = the persisted show row.
    check('Details total = show total', (await statVal('details-total')) === usd(row.final_total_usd), await statVal('details-total'));
    check('Details public = $10.50', (await statVal('details-public')) === usd(row.final_public_usd) && usd(row.final_public_usd) === '$10.50', await statVal('details-public'));
    check('Details private = closed interval earnings', (await statVal('details-private')) === usd(row.final_private_usd) && usd(row.final_private_usd) === usd(intervals[0].estimated_earnings_usd), await statVal('details-private'));
    check('Total = public + private', Math.round(Number(row.final_total_usd) * 100) === Math.round(Number(row.final_public_usd) * 100) + Math.round(Number(row.final_private_usd) * 100));
    check('Details tips 3', (await statVal('details-tips')) === '3', await statVal('details-tips'));
    // BrowserAlice on Chaturbate and on MyFreeCams are two different fans.
    check('Details unique tippers 3 (no cross-platform merge)', (await statVal('details-unique')) === '3', await statVal('details-unique'));
    check('Details top tipper BrowserAlice', (await statVal('details-top')) === 'BrowserAlice', await statVal('details-top'));
    check('Details largest tip $5.00', (await statVal('details-largest')) === '$5.00', await statVal('details-largest'));
    check('Details duration matches the saved show', (await statVal('details-duration')) === fmtDuration(row.final_duration_seconds), `${await statVal('details-duration')} vs ${row.final_duration_seconds}s`);
    check('Details private time matches the saved show', (await statVal('details-private-time')) === fmtDuration(row.final_private_seconds), `${await statVal('details-private-time')} vs ${row.final_private_seconds}s`);
    check('Earnings timeline rendered from real data', (await page.getByTestId('details-timeline').count()) === 1);
    for (const [pf, expectUsd] of [['chaturbate', '$5.00'], ['bongacams', '$2.50'], ['myfreecams', '$3.00']]) {
      check(`Saved platform split ${pf} ${expectUsd}`, usd(breakdown[pf]?.usd) === expectUsd, JSON.stringify(breakdown[pf]));
    }
    // Today so far = the show + earlier free chat + imported private, once each.
    const expPublic = Number(row.final_public_usd) + FREE_CHAT_USD;
    const expPrivate = Number(row.final_private_usd) + PAID_USD;
    check('Today public = show public + free chat', (await statVal('today-public')) === usd(expPublic), await statVal('today-public'));
    check('Today private = show private + imported private', (await statVal('today-private')) === usd(expPrivate), await statVal('today-private'));
    check('Today total = public + private', (await statVal('today-total')) === usd(expPublic + expPrivate), await statVal('today-total'));
    check('Today tips 5', (await statVal('today-tips')) === '5', await statVal('today-tips'));
    check('Today unique tippers 5 (per platform)', (await statVal('today-unique')) === '5', await statVal('today-unique'));
    check('Today completed sessions 2 (show + 40-min free chat)', (await statVal('today-completed')) === '2', await statVal('today-completed'));
    check('Best platform is BongaCams', (await statVal('today-best-platform')) === 'BongaCams', await statVal('today-best-platform'));
    check('BongaCams card marked BEST TODAY', (await page.getByTestId('today-platform-bongacams').getByTestId('best-platform-badge').count()) === 1);
    check("Strongest signal shown", /BongaCams is leading today with \d+% of your earnings\./.test((await page.getByTestId('today-signal').textContent()) || ''));
    const header = await page.locator('text=Total Earned').first().locator('xpath=..').textContent();
    check('Header Total Earned includes private', (header || '').includes(usd(expPublic + expPrivate)), header);
    for (const pf of ['bongacams', 'chaturbate', 'myfreecams']) {
      check(`Platform card ${pf}`, (await page.getByTestId(`today-platform-${pf}`).count()) === 1);
    }
    await page.getByTestId('filter-type-free_chat').locator('button').click();
    check('Free Chat filter hides the Live show', (await page.getByTestId(`history-live:${sessionId}`).count()) === 0);
    check('Free Chat filter shows the earlier free-chat session', (await page.getByTestId('type-badge-free_chat').count()) === 1);
    await shot(page, '05c-sessions-filter-free-chat');
    await page.getByTestId('filter-type-private').locator('button').click();
    check('Private filter shows the imported private session', (await page.getByTestId('type-badge-private').count()) === 1);
    await shot(page, '05d-sessions-filter-private');
    await page.getByTestId('filter-type-all').locator('button').click();
    await shot(page, '05b-dashboard-sessions-today');

    // ── acknowledgement clears NEW, and it persists ─────────────────────────
    console.log('\nStep 8: Acknowledgement');
    await page.waitForTimeout(5000); // Sessions on screen > 3s counts as viewed
    const { data: seen } = await admin.from('live_sessions').select('dashboard_seen_at').eq('id', sessionId).single();
    check('Viewing Sessions stored dashboard_seen_at', !!seen?.dashboard_seen_at);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('text="Free Chat Sessions" >> visible=true').first().click();
    await page.getByTestId(`history-live:${sessionId}`).waitFor({ state: 'visible' });
    check('NEW badge gone after reload', (await page.getByTestId(`history-live:${sessionId}`).getByTestId('row-new-badge').count()) === 0);
    await shot(page, '06-dashboard-sessions-acknowledged');
    await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    check('Overview delta gone after acknowledgement', (await page.getByTestId('latest-show-delta').count()) === 0);
    await shot(page, '07-dashboard-overview-after-ack');

    const second = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: TEST_TZ });
    const p2 = await second.newPage();
    p2.setDefaultTimeout(120_000);
    await signIn(p2, email, password);
    await p2.waitForURL(/\/dashboard/);
    await p2.locator('text="Free Chat Sessions" >> visible=true').first().click();
    await p2.getByTestId(`history-live:${sessionId}`).waitFor({ state: 'visible' });
    check('Second browser (device) shows it as already seen', (await p2.getByTestId(`history-live:${sessionId}`).getByTestId('row-new-badge').count()) === 0);
    await p2.screenshot({ path: path.join(OUT, '08-second-device-sessions.png'), fullPage: true });
    console.log('📸 08-second-device-sessions.png');
  } catch (e) {
    fail++;
    console.error('❌ Unhandled error:', e.message);
    try {
      const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : [];
      for (const [i, pg] of pages.entries()) await pg.screenshot({ path: path.join(OUT, `zz-failure-${i}.png`), fullPage: true });
    } catch (_) {}
  } finally {
    if (browser) await browser.close();
    if (ext) await ext.from('paid_sessions').delete().eq('user_id', userId);
    await admin.from('beta_users').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('id', userId);
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    console.log(delErr ? `⚠ cleanup: ${delErr.message}` : `🧹 deleted staging user ${userId}`);
  }

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
