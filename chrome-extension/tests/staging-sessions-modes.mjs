// STAGING ONLY. Sessions tab adaptive layer: seeds five creators from
// glowmetrics_fresh/lib/sessions/__fixtures__/sessions-modes.json, opens the
// Sessions tab in a real browser, screenshots it, and checks every visible
// metric in the DOM against the raw-data values (hand-computed from the
// fixture rows; the same numbers are asserted against the helpers in
// lib/sessions/__tests__/sessions-modes-reconcile.test.js).
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { middayTimezone } from './midday-timezone.mjs';
import { assertStagingTargets } from './staging-guard.mjs';
const TEST_TZ = middayTimezone();

const URL_ = process.env.SUPABASE_STAGING_URL;
const SERVICE = process.env.SUPABASE_STAGING_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_STAGING_ANON_KEY;
const APP = process.env.CAMCASH_STAGING_BASE_URL;
const OUT = process.env.BROWSER_ARTIFACTS_DIR || path.resolve('browser-artifacts');
for (const [k, v] of Object.entries({ SUPABASE_STAGING_URL: URL_, SUPABASE_STAGING_SERVICE_ROLE_KEY: SERVICE, SUPABASE_STAGING_ANON_KEY: ANON, CAMCASH_STAGING_BASE_URL: APP })) {
  if (!v) { console.error(`❌ Missing ${k}`); process.exit(1); }
}
assertStagingTargets({ supabaseUrl: URL_, appBaseUrl: APP });
fs.mkdirSync(OUT, { recursive: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, '../../glowmetrics_fresh/lib/sessions/__fixtures__/sessions-modes.json'), 'utf8'));

let pass = 0, fail = 0;
const table = [];
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const NOW = Date.now();
const at = (daysAgo, hm) => {
  if (daysAgo === 0) return new Date(NOW - hm * 60000).toISOString();
  const d = new Date(NOW - daysAgo * 86400000);
  const [h, m] = hm.split(':').map(Number);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
};

// Raw-data expectations (DOM text), hand-computed from the fixture rows.
const EXPECT = {
  csvFree: {
    overall: {
      'overall-source': 'IMPORTED HISTORY', 'overall-total': '$69.00', 'overall-public': '$63.00', 'overall-private': '$6.00',
      'overall-tips': '11', 'overall-unique': '5', 'overall-meaningful': '5', 'overall-median': '$12.00',
      'overall-top-tipper': 'Ann', 'overall-largest': '$12.00',
      'perf-typical-median': '$12.00', 'perf-typical-count': '5', 'perf-typical-tips': '2', 'perf-audience-unique': '5',
      'perf-audience-top': 'Ann ($26.00), Ben ($13.00), Ola ($10.00)', 'perf-audience-share': '78%',
    },
    contains: { 'overall-history-note': 'last 31 days on every platform', 'perf-momentum': '1 more session needed for Recent Momentum' },
  },
  singleFree: {
    overall: {
      'overall-source': 'IMPORTED HISTORY', 'overall-total': '$140.00', 'overall-public': '$140.00', 'overall-private': '$0.00',
      'overall-tips': '14', 'overall-unique': '6', 'overall-meaningful': '7', 'overall-median': '$20.00',
      'overall-top-tipper': 'Ann', 'overall-largest': '$30.00',
      'perf-typical-median': '$20.00', 'perf-typical-count': '7', 'perf-momentum-delta': '↑ 133%',
      'perf-momentum-recent': '$23.33', 'perf-momentum-prior': '$10.00', 'perf-audience-unique': '6',
      'perf-audience-top': 'Ann ($86.00), Ben ($20.00), Cy ($10.00)', 'perf-audience-share': '83%',
    },
    contains: { 'overall-history-note': 'full history on Chaturbate' },
  },
  mixed: {
    today: {
      'today-total': '$13.00', 'today-public': '$13.00', 'today-private': '$0.00', 'today-tips': '3', 'today-unique': '3',
      'today-completed': '1', 'today-best-platform': 'Chaturbate',
    },
    todayContains: { 'today-streamed': '0m', 'today-by-platform': '$10.00' },
    overall: {
      'overall-source': 'LIVE + IMPORTED HISTORY', 'overall-total': '$38.00', 'overall-public': '$38.00', 'overall-tips': '7',
      'overall-unique': '6', 'overall-meaningful': '3', 'overall-median': '$10.00', 'overall-top-tipper': 'Ann', 'overall-largest': '$10.00',
    },
  },
  pro: {
    overall: {
      'overall-source': 'IMPORTED HISTORY', 'overall-total': '$65.00', 'overall-public': '$65.00', 'overall-tips': '8',
      'overall-unique': '4', 'overall-meaningful': '4', 'overall-median': '$12.50', 'overall-top-tipper': 'Ann', 'overall-largest': '$20.00',
      'perf-typical-median': '$12.50', 'perf-typical-count': '4', 'perf-audience-share': '88%',
    },
    contains: { 'overall-history-note': 'Full history on every platform' },
  },
  lightFree: {
    overall: { 'overall-source': 'IMPORTED HISTORY', 'overall-total': '$15.00', 'overall-tips': '2', 'overall-unique': '2', 'overall-meaningful': '1', 'overall-median': '$15.00' },
    contains: {
      'overall-private': 'No private earnings yet',
      'perf-typical': '2 more sessions needed for Typical Session',
      'perf-momentum': '5 more sessions needed for Recent Momentum',
    },
  },
  peakPro: {
    overall: { 'overall-total': '$52.50', 'overall-tips': '8', 'overall-unique': '4', 'overall-meaningful': '2', 'overall-median': '$26.25' },
  },
  noData: { contains: { 'sessions-activation': 'No performance data yet' }, present: ['activation-import', 'activation-live'], absent: ['today-stats', 'today-by-platform', 'session-history'] },
};

async function makeUser(name, sc) {
  const email = `sessions-${name.toLowerCase()}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@staging.local`;
  const password = crypto.randomBytes(18).toString('hex');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`create ${name}: ${error.message}`);
  const id = data.user.id;
  const prof = { id, plan: sc.plan };
  if (sc.primary) { prof.primary_pro_platform = sc.primary; prof.streaming_platforms = [sc.primary]; }
  const { error: pErr } = await admin.from('profiles').upsert(prof);
  if (pErr) throw new Error(`profile ${name}: ${pErr.message}`);
  await admin.from('beta_users').insert({ user_id: id, email, onboarding_complete: true });
  // Staging's service role has no INSERT on tips (by design); seed as the
  // creator through RLS, exactly like the app's own browser writes.
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: sErr0 } = await client.auth.signInWithPassword({ email, password });
  if (sErr0) throw new Error(`sign in ${name}: ${sErr0.message}`);
  if (sc.tips.length) {
    const { error: tErr } = await client.from('tips').insert(sc.tips.map(([d, hm, platform, username, usd, source], i) => ({
      user_id: id, date_time: at(d, hm), platform, username, usd, tokens: 0,
      source, tip_ref: `sessions-modes-${name}-${i}-${id}`,
    })));
    if (tErr) throw new Error(`tips ${name}: ${tErr.message}`);
  }
  if (sc.paid.length) {
    const { error: sErr } = await client.from('paid_sessions').insert(sc.paid.map(([d, hm, platform, username, usd, session_type]) => ({
      user_id: id, date_time: at(d, hm), platform, username, username_lower: username.toLowerCase(), usd, usd_rounded: usd, tokens: 0, session_type,
    })));
    if (sErr) throw new Error(`paid ${name}: ${sErr.message}`);
  }
  if ((sc.plans || []).length) {
    const { error: plErr } = await admin.from('planned_streams').insert(sc.plans.map(([d, s, e, platform]) => ({ user_id: id, platform, start_at: at(d, s), end_at: at(d, e), source: 'manual' })));
    if (plErr) throw new Error(`plans ${name}: ${plErr.message}`);
  }
  // Persisted rows must equal the fixture exactly (no normalization, nothing dropped).
  const want = sc.tips.map(([d, hm, platform, username, usd, source]) => `${new Date(at(d, hm)).toISOString()}|${platform}|${username}|${Number(usd).toFixed(2)}|${source}`).sort();
  const { data: got, error: rErr } = await client.from('tips').select('date_time, platform, username, usd, source').eq('user_id', id);
  if (rErr) throw new Error(`read back ${name}: ${rErr.message}`);
  const have = (got || []).map((r) => `${new Date(r.date_time).toISOString()}|${r.platform}|${r.username}|${Number(r.usd).toFixed(2)}|${r.source}`).sort();
  const same = JSON.stringify(want) === JSON.stringify(have);
  check(`${name} · seeded ${want.length} tips persisted exactly as the fixture`, same, `\n  fixture: ${JSON.stringify(want)}\n  stored:  ${JSON.stringify(have)}`);
  if (sc.paid.length) {
    const wantP = sc.paid.map(([d, hm, platform, username, usd, t]) => `${new Date(at(d, hm)).toISOString()}|${platform}|${username}|${Number(usd).toFixed(2)}|${t}`).sort();
    const { data: gp } = await client.from('paid_sessions').select('date_time, platform, username, usd, session_type').eq('user_id', id);
    const haveP = (gp || []).map((r) => `${new Date(r.date_time).toISOString()}|${r.platform}|${r.username}|${Number(r.usd).toFixed(2)}|${r.session_type}`).sort();
    check(`${name} · seeded ${wantP.length} private rows persisted exactly`, JSON.stringify(wantP) === JSON.stringify(haveP), `\n  fixture: ${JSON.stringify(wantP)}\n  stored:  ${JSON.stringify(haveP)}`);
  }
  return { id, email, password, client };
}

async function signIn(page, u) {
  await page.goto(`${APP}/landing`, { waitUntil: 'networkidle' });
  const pw = page.locator('input[type="password"][placeholder="Password"]:visible').first();
  for (let i = 0; i < 120 && !(await pw.count()); i++) {
    if (i > 0 && i % 30 === 0) await page.goto(`${APP}/landing`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.getByRole('button', { name: 'Log In', exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  const form = page.locator('form', { has: pw }).first();
  await form.locator('input[type="email"]').fill(u.email);
  await pw.fill(u.password);
  await pw.press('Enter');
  await page.waitForURL(/\/dashboard/);
}

async function domCheck(page, name, scope, exact = {}, contains = {}) {
  for (const [id, want] of Object.entries(exact)) {
    const el = page.getByTestId(id).first();
    const got = (await el.count()) ? (await el.textContent()).trim() : '(missing)';
    table.push({ scenario: name, scope, metric: id, raw: want, dom: got });
    check(`${name} · ${id} = ${want}`, got === want, `DOM shows ${got}`);
  }
  for (const [id, want] of Object.entries(contains)) {
    const el = page.getByTestId(id).first();
    const got = (await el.count()) ? (await el.textContent()).trim() : '(missing)';
    table.push({ scenario: name, scope, metric: id, raw: `contains "${want}"`, dom: got.slice(0, 80) });
    check(`${name} · ${id} contains "${want}"`, got.includes(want), `DOM shows ${got}`);
  }
}

async function main() {
  const users = [];
  let browser;
  try {
    const launch = { headless: true, args: ['--no-sandbox'] };
    if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
    browser = await chromium.launch(launch);
    for (const [name, sc] of Object.entries(fixture.scenarios)) {
      console.log(`\n${name}`);
      const u = await makeUser(name, sc); users.push(u);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: TEST_TZ });
      const page = await ctx.newPage(); page.setDefaultTimeout(120_000);
      await signIn(page, u);
      await page.locator('text="Free Chat Sessions" >> visible=true').first().click();
      await page.getByTestId('sessions-overview').waitFor({ state: 'visible' });
      await page.waitForTimeout(2500);
      const e = EXPECT[name];
      const body = await page.getByTestId('sessions-overview').textContent();
      if (e.today) await domCheck(page, name, 'Today', e.today, e.todayContains || {});
      for (const id of e.present || []) check(`${name} · ${id} shown`, (await page.getByTestId(id).count()) > 0);
      for (const id of e.absent || []) check(`${name} · ${id} not shown`, (await page.getByTestId(id).count()) === 0);
      if (name === 'noData') await domCheck(page, name, 'Activation', {}, e.contains);
      if (name === 'mixed') {
        check('mixed · Today is the default scope', (await page.getByTestId('today-stats').count()) > 0);
        check('mixed · streamed time is Live-only; tip span labeled estimate', /est\. tip activity \(not stream time\)/.test(await page.getByTestId('today-streamed').locator('xpath=..').textContent()));
        await page.getByTestId('sessions-overview').screenshot({ path: path.join(OUT, `sessions-mixed-today.png`) });
        await page.getByTestId('scope-overall').locator('button').first().click().catch(async () => page.getByTestId('scope-overall').click());
        await page.getByTestId('overall-stats').waitFor({ state: 'visible' });
      }
      if (e.overall) await domCheck(page, name, 'Overall', e.overall, e.contains || {});
      if (name !== 'noData' && name !== 'mixed') {
        check(`${name} · CSV view has no $/hr, stream time, Best Day or Best Time`, !/\/hr|per hour|Streamed Time|Best Day|Best Time/i.test(body), body.match(/\/hr|per hour|Streamed Time|Best Day|Best Time/i)?.[0]);
        check(`${name} · no Today/range controls for imported-only data`, (await page.getByTestId('range-1').count()) === 0 && (await page.getByTestId('scope-switch').count()) === 0);
        check(`${name} · Session Performance cards replace platform comparison`, (await page.getByTestId('session-performance').count()) > 0 && (await page.getByTestId('today-by-platform').count()) === 0);
      }
      await page.getByTestId('sessions-overview').screenshot({ path: path.join(OUT, `sessions-${name}${name === 'mixed' ? '-overall' : ''}.png`) });
      if (name === 'csvFree') {
        // Selected session = newest meaningful one: Chaturbate, Ann $10 @20:00 + Ben $5 @20:40 (raw fixture rows).
        const tabClick = async (id) => { const t = page.getByTestId(id); await t.locator('button').first().click().catch(async () => t.click()); };
        await tabClick('details-tab-timeline');
        await page.getByTestId('buckets').waitFor({ state: 'visible' });
        await domCheck(page, name, 'Timeline', { 'buckets-span-label': 'Earning activity span', 'buckets-span': '~40m' }, {});
        const rows = await page.getByTestId('bucket-row').allTextContents();
        check(`${name} · Timeline has 4 ten-minute buckets (40 min span)`, rows.length === 4, JSON.stringify(rows));
        check(`${name} · first bucket $10.00 from Ann, last bucket $5.00 from Ben`, /\$10\.00.*Ann \$10\.00/.test(rows[0] || '') && /\$5\.00.*Ben \$5\.00/.test(rows[3] || ''), JSON.stringify(rows));
        check(`${name} · no peak share claimed with only 2 earning buckets`, (await page.getByTestId('buckets-peak').count()) === 0);
        await page.getByTestId('session-details').screenshot({ path: path.join(OUT, 'sessions-details-timeline.png') });
        await tabClick('details-tab-fans');
        await page.getByTestId('fan-drivers').waitFor({ state: 'visible' });
        const fans = await page.getByTestId('fan-driver').allTextContents();
        check(`${name} · Fans ranked by session USD: Ann then Ben`, fans.length === 2 && fans[0].startsWith('1Ann') && fans[1].startsWith('2Ben'), JSON.stringify(fans));
        check(`${name} · Ann $10.00, 67% of session, Returning`, /\$10\.00/.test(fans[0]) && /67% of session/.test(fans[0]) && /RETURNING/.test(fans[0]), fans[0]);
        check(`${name} · Ben $5.00, 33% of session, Returning`, /\$5\.00/.test(fans[1]) && /33% of session/.test(fans[1]) && /RETURNING/.test(fans[1]), fans[1]);
        await page.getByTestId('session-details').screenshot({ path: path.join(OUT, 'sessions-details-fans.png') });
      }
      if (name === 'csvFree') {
        // Plan 19:30–22:00 UTC on the day of the newest session (first tip 20:00 UTC).
        const tabClick = async (id) => { const t = page.getByTestId(id); await t.locator('button').first().click().catch(async () => t.click()); };
        await tabClick('details-tab-schedule');
        await page.getByTestId('schedule').waitFor({ state: 'visible' });
        await domCheck(page, name, 'Schedule', { 'schedule-badge': 'ACTIVITY AFTER PLANNED START', 'schedule-text': 'Activity began inside your planned window, 30 min after your planned start.' }, {});
        check(`${name} · Schedule never says the stream started (imported)`, !/Started/.test(await page.getByTestId('schedule').textContent()));
        await page.getByTestId('session-details').screenshot({ path: path.join(OUT, 'sessions-details-schedule-imported.png') });
      }
      if (name === 'singleFree' || name === 'peakPro') {
        const tabClick = async (id) => { const t = page.getByTestId(id); await t.locator('button').first().click().catch(async () => t.click()); };
        await tabClick('details-tab-schedule');
        await page.getByTestId('schedule').waitFor({ state: 'visible' });
        const want = name === 'singleFree' ? 'NO SAVED PLAN' : 'UNSCHEDULED';
        await domCheck(page, name, 'Schedule', { 'schedule-badge': want }, {});
        await page.getByTestId('session-details').screenshot({ path: path.join(OUT, `sessions-details-schedule-${want === 'NO SAVED PLAN' ? 'no-plan' : 'unscheduled'}.png`) });
        await tabClick('details-tab-overview');
      }
      if (name === 'peakPro') {
        // Newest session (raw rows): 20:00 Ann 4, 20:05 Ben 2, 20:12 Ben 12, 20:14 Cy 9, 20:31 Ann 12, 20:45 Dee 3.5 = $42.50 over 45 min.
        const tabClick = async (id) => { const t = page.getByTestId(id); await t.locator('button').first().click().catch(async () => t.click()); };
        await tabClick('details-tab-timeline');
        await page.getByTestId('buckets').waitFor({ state: 'visible' });
        const rows = await page.getByTestId('bucket-row').allTextContents();
        check(`${name} · 5 ten-minute buckets for a 45-minute span`, rows.length === 5, JSON.stringify(rows));
        const peak = (await page.getByTestId('buckets-peak').count()) ? await page.getByTestId('buckets-peak').textContent() : '';
        check(`${name} · peak bucket = $21.00, 49% of session earnings`, /49%/.test(peak) && /\$21\.00/.test(peak), peak);
        table.push({ scenario: name, scope: 'Timeline', metric: 'buckets-peak', raw: 'contains "49%" and "$21.00"', dom: peak.slice(0, 80) });
        await page.getByTestId('session-details').screenshot({ path: path.join(OUT, 'sessions-details-peak.png') });
        await tabClick('details-tab-fans');
        await page.getByTestId('fan-drivers').waitFor({ state: 'visible' });
        const fans = await page.getByTestId('fan-driver').allTextContents();
        const want = [['Ann', '$16.00', '38%', 'RETURNING'], ['Ben', '$14.00', '33%', 'NEW'], ['Cy', '$9.00', '21%', 'NEW'], ['Dee', '$3.50', '8%', 'NEW']];
        check(`${name} · 4 fans ranked by session USD`, fans.length === 4, JSON.stringify(fans));
        want.forEach(([u, usd, pct, status], i) => {
          const f = fans[i] || '';
          const ok = f.startsWith(`${i + 1}${u}`) && f.includes(usd) && f.includes(`${pct} of session`) && f.includes(status) && !(status === 'NEW' && f.includes('RETURNING'));
          check(`${name} · fan ${i + 1}: ${u} ${usd} ${pct} ${status}`, ok, f);
          table.push({ scenario: name, scope: 'Fans', metric: `fan ${i + 1}`, raw: `${u} ${usd} ${pct} ${status}`, dom: ok ? `${u} ${usd} ${pct} ${status}` : f.slice(0, 80) });
        });
        await page.getByTestId('session-details').screenshot({ path: path.join(OUT, 'sessions-details-fans-new-returning.png') });
      }
      if (name === 'singleFree') {
        // 7 Chaturbate imported sessions: 30, 20, 20, 10 (newest first) then 10, 10, 40.
        const marks = await page.locator('[data-testid^="row-vs-"]').allTextContents();
        check(`${name} · newest session marked ▲ +100% vs typical (30 vs median 15 of the other 6)`, marks[0] === '▲ +100%vs typical', JSON.stringify(marks));
        check(`${name} · second session ▲ +33% vs typical (20 vs median 15)`, marks[1] === '▲ +33%vs typical', JSON.stringify(marks));
        check(`${name} · fourth session ▼ -50% vs typical (10 vs median 20)`, marks[3] === '▼ -50%vs typical', JSON.stringify(marks));
        table.push({ scenario: name, scope: 'Recent Sessions', metric: 'row vs typical (rows 1,2,4)', raw: '▲ +100% | ▲ +33% | ▼ -50%', dom: [marks[0], marks[1], marks[3]].join(' | ') });
      }
      await ctx.close();
    }
    // planned_streams: browser users keep history honest.
    console.log('\nplanned_streams security (browser user, proven from the database)');
    const [ua, ub] = users;
    const future = new Date(Date.now() + 3 * 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 3 * 86400000 + 7200000).toISOString();
    const pastStart = new Date(Date.now() - 2 * 86400000).toISOString();
    const pastEnd = new Date(Date.now() - 2 * 86400000 + 7200000).toISOString();
    let r = await ua.client.from('planned_streams').insert({ user_id: ua.id, platform: 'Chaturbate', start_at: pastStart, end_at: pastEnd }).select();
    check('Back-dated plan (start in the past) is refused', !!r.error, JSON.stringify(r.data));
    r = await ua.client.from('planned_streams').insert({ user_id: ua.id, platform: 'Chaturbate', start_at: future, end_at: futureEnd }).select();
    check('Future plan can be saved', !r.error && r.data?.length === 1, r.error?.message);
    const futureId = r.data?.[0]?.id;
    r = await ua.client.from('planned_streams').update({ end_at: new Date(Date.now() + 3 * 86400000 + 3600000).toISOString() }).eq('id', futureId).select();
    check('Future plan can be edited', !r.error && r.data?.length === 1, r.error?.message);
    const { data: seededPast } = await admin.from('planned_streams').select('id, start_at, end_at').eq('user_id', ua.id).lt('start_at', new Date().toISOString()).limit(1);
    const pastId = seededPast?.[0]?.id;
    r = await ua.client.from('planned_streams').update({ start_at: new Date(Date.now() - 2 * 86400000).toISOString() }).eq('id', pastId).select();
    const pastAfter = (await admin.from('planned_streams').select('start_at').eq('id', pastId).single()).data;
    check('Past plan cannot be edited (DB unchanged)', (!!r.error || (r.data || []).length === 0) && pastAfter?.start_at === seededPast?.[0]?.start_at, JSON.stringify({ r: r.data, pastAfter }));
    r = await ua.client.from('planned_streams').update({ start_at: future }).eq('id', pastId).select();
    check('Past plan cannot be moved into the future either', (!!r.error || (r.data || []).length === 0));
    r = await ua.client.from('planned_streams').delete().eq('id', pastId).select();
    check('Past plan cannot be deleted (still in DB)', (await admin.from('planned_streams').select('id').eq('id', pastId)).data?.length === 1, JSON.stringify(r));
    r = await ub.client.from('planned_streams').select('id').eq('user_id', ua.id);
    check("Another creator's plans are invisible", (r.data || []).length === 0, JSON.stringify(r.data));
    r = await ub.client.from('planned_streams').insert({ user_id: ua.id, platform: 'Chaturbate', start_at: future, end_at: futureEnd }).select();
    check("Cannot create a plan for another creator", !!r.error);
    r = await ua.client.from('planned_streams').delete().eq('id', futureId).select();
    check('Future plan can be deleted', !r.error && (await admin.from('planned_streams').select('id').eq('id', futureId)).data?.length === 0, r.error?.message);
  } catch (err) {
    fail++;
    console.error('❌ Unhandled error:', err.message);
  } finally {
    if (browser) await browser.close();
    for (const u of users) {
      await admin.from('planned_streams').delete().eq('user_id', u.id);
      await u.client.from('tips').delete().eq('user_id', u.id);
      await u.client.from('paid_sessions').delete().eq('user_id', u.id);
      await admin.from('tips').delete().eq('user_id', u.id);
      await admin.from('beta_users').delete().eq('user_id', u.id);
      await admin.from('profiles').delete().eq('id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  console.log('\nRECONCILIATION (scenario | scope | metric | raw | DOM)');
  for (const r of table) console.log(`${r.raw === r.dom || r.dom.includes(String(r.raw).replace(/^contains "|"$/g, '')) ? 'OK ' : 'BAD'} | ${r.scenario} | ${r.scope} | ${r.metric} | ${r.raw} | ${r.dom}`);
  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
