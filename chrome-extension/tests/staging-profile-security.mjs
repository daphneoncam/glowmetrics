// STAGING ONLY. Browser-style attack tests for migration
// 20261010_lock_profile_entitlements.sql and /api/profile/primary-platform.
//
// Every attack is made exactly as a browser would make it — supabase-js with
// the anon key and the attacker's own login token — and every outcome is
// proven by re-reading the row with the service role afterwards (not just by
// an HTTP error). Also checks the legitimate paths still work and that the
// Free/Pro UI follows the database entitlement.
//
// Run: node staging-profile-security.mjs (needs the staging env vars and the
// app at CAMCASH_STAGING_BASE_URL).

import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { assertStagingTargets } from './staging-guard.mjs';

const URL_ = process.env.SUPABASE_STAGING_URL;
const ANON = process.env.SUPABASE_STAGING_ANON_KEY;
const SERVICE = process.env.SUPABASE_STAGING_SERVICE_ROLE_KEY;
const APP = process.env.CAMCASH_STAGING_BASE_URL;
const OUT = process.env.BROWSER_ARTIFACTS_DIR || path.resolve('browser-artifacts');
for (const [k, v] of Object.entries({ SUPABASE_STAGING_URL: URL_, SUPABASE_STAGING_ANON_KEY: ANON, SUPABASE_STAGING_SERVICE_ROLE_KEY: SERVICE, CAMCASH_STAGING_BASE_URL: APP })) {
  if (!v) { console.error(`❌ Missing ${k}`); process.exit(1); }
}
assertStagingTargets({ supabaseUrl: URL_, appBaseUrl: APP });
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const row = async (id) => (await admin.from('profiles').select('*').eq('id', id).single()).data;

async function makeUser(label, plan, onboardingComplete = true) {
  const email = `sec-${label}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@staging.local`;
  const password = crypto.randomBytes(18).toString('hex');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`create ${label}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from('profiles').upsert({ id, plan });
  if (pErr) throw new Error(`profile ${label}: ${pErr.message}`);
  await admin.from('beta_users').insert({ user_id: id, email, onboarding_complete: onboardingComplete });
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`sign in ${label}: ${sErr.message}`);
  return { id, email, password, client, token: s.session.access_token };
}
const choose = (token, platform) => fetch(`${APP}/api/profile/primary-platform`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ platform }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

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
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

async function main() {
  const users = [];
  let browser;
  try {
    const free = await makeUser('free', 'free'); users.push(free);
    const pro = await makeUser('pro', 'pro'); users.push(pro);
    const racer = await makeUser('racer', 'free'); users.push(racer);
    const onb = await makeUser('onboard', 'free', false); users.push(onb);

    console.log('\nMust fail (browser-style, proven from the database)');
    let r = await free.client.from('profiles').update({ plan: 'pro' }).eq('id', free.id).select();
    check('Free user cannot set plan=pro', !!r.error, JSON.stringify(r.data));
    check('  DB: plan still free', (await row(free.id)).plan === 'free');

    r = await free.client.from('profiles').update({ subscription_status: 'active', stripe_subscription_id: 'sub_fake', trial_ends_at: new Date(Date.now() + 365 * 864e5).toISOString(), plan_expires_at: new Date(Date.now() + 3650 * 864e5).toISOString() }).eq('id', free.id).select();
    check('Free user cannot set subscription/trial/expiry fields', !!r.error);
    const afterSub = await row(free.id);
    check('  DB: subscription/trial/expiry untouched', afterSub.subscription_status !== 'active' && afterSub.stripe_subscription_id == null && afterSub.trial_ends_at == null && afterSub.plan_expires_at == null, JSON.stringify(afterSub));

    r = await free.client.from('profiles').update({ stripe_customer_id: 'cus_someone_else' }).eq('id', free.id).select();
    check('Free user cannot set stripe_customer_id', !!r.error);
    check('  DB: stripe_customer_id untouched', (await row(free.id)).stripe_customer_id == null);

    r = await free.client.from('subscriptions').insert({ user_id: free.id, status: 'active', plan_type: 'pro' }).select();
    check('Free user cannot insert a subscriptions row', !!r.error);
    check('  DB: no subscriptions row', ((await admin.from('subscriptions').select('id').eq('user_id', free.id)).data || []).length === 0);

    r = await free.client.from('profiles').update({ utm_source: 'hijack', plan: 'free' }).eq('id', pro.id).select();
    check("Free user cannot edit another user's profile", !!r.error || (r.data || []).length === 0);
    const proRow = await row(pro.id);
    check('  DB: other user untouched and still Pro', proRow.utm_source == null && proRow.plan === 'pro', JSON.stringify(proRow));

    console.log('\nMust succeed (legitimate browser edits)');
    r = await free.client.from('profiles').update({ utm_source: 'newsletter', attributed_at: new Date().toISOString() }).eq('id', free.id).select();
    check('Signup attribution (UTM) update still works', !r.error && (await row(free.id)).utm_source === 'newsletter', r.error?.message);
    r = await free.client.from('profiles').upsert({ id: free.id, streaming_platforms: ['chaturbate', 'bongacams'] }, { onConflict: 'id' }).select();
    check('Onboarding platform-list save (upsert, no primary) works', !r.error, r.error?.message);
    check('  DB: platform list saved, primary still NULL', (await row(free.id)).streaming_platforms?.join() === 'Chaturbate,BongaCams' && (await row(free.id)).primary_pro_platform == null, JSON.stringify(await row(free.id)));
    r = await free.client.from('profiles').update({ chaturbate_username: 'sec_cb_user', broadcaster_type: 'female' }).eq('id', free.id).select();
    check('Chaturbate username / broadcaster_type edit works', !r.error && (await row(free.id)).chaturbate_username === 'sec_cb_user', r.error?.message);

    console.log('\nPrimary NULL: browser cannot make the first permanent choice');
    r = await free.client.from('profiles').update({ primary_pro_platform: 'chaturbate' }).eq('id', free.id).select();
    check('Direct browser first-time primary write (update) → denied', !!r.error && /permission denied/i.test(r.error.message), JSON.stringify(r.error || r.data));
    check('  DB: primary still NULL', (await row(free.id)).primary_pro_platform == null);
    r = await free.client.from('profiles').upsert({ id: free.id, streaming_platforms: ['chaturbate'], primary_pro_platform: 'chaturbate' }, { onConflict: 'id' }).select();
    check('Direct browser first-time primary write (onboarding-style upsert) → denied', !!r.error, JSON.stringify(r.data));
    check('  DB: primary still NULL, list unchanged', (await row(free.id)).primary_pro_platform == null && (await row(free.id)).streaming_platforms?.join() === 'Chaturbate,BongaCams');
    r = await free.client.from('profiles').update({ streaming_platforms: ['bongacams', 'chaturbate'] }).eq('id', free.id).select();
    check('Platform-list reorder with no primary works', !r.error, r.error?.message);
    check('  DB: reorder did NOT create a primary', (await row(free.id)).primary_pro_platform == null && (await row(free.id)).streaming_platforms?.[0] === 'BongaCams', JSON.stringify(await row(free.id)));

    console.log('\nPrimary platform route (only path to the permanent primary)');
    check('Unauthenticated → 401', (await choose(null, 'bongacams')).status === 401);
    check('Invalid platform → 400', (await choose(free.token, 'stripchat')).status === 400);
    const first = await choose(free.token, 'chaturbate');
    check('API first choice → 200', first.status === 200, JSON.stringify(first));
    check('  DB: primary = Chaturbate', (await row(free.id)).primary_pro_platform === 'Chaturbate', JSON.stringify(await row(free.id)));
    const again = await choose(free.token, 'bongacams');
    check('API second choice → 409', again.status === 409, JSON.stringify(again));
    check('  DB: primary still Chaturbate', (await row(free.id)).primary_pro_platform === 'Chaturbate');

    console.log('\nPrimary set: browser cannot change or clear it');
    r = await free.client.from('profiles').update({ primary_pro_platform: 'BongaCams' }).eq('id', free.id).select();
    check('Direct browser primary change → denied', !!r.error);
    r = await free.client.from('profiles').update({ primary_pro_platform: null }).eq('id', free.id).select();
    check('Direct browser primary clear → denied', !!r.error);
    r = await free.client.from('profiles').update({ streaming_platforms: ['bongacams', 'myfreecams', 'chaturbate'] }).eq('id', free.id).select();
    check('Platform-list reorder with primary set works', !r.error, r.error?.message);
    const afterReorder = await row(free.id);
    check('  DB: primary unchanged by reorder; list stored exactly as sent', afterReorder.primary_pro_platform === 'Chaturbate' && afterReorder.streaming_platforms?.join() === 'BongaCams,MyFreeCams,Chaturbate', JSON.stringify(afterReorder));

    console.log('\nStripe checkout write path');
    r = await admin.from('profiles').update({ stripe_customer_id: 'cus_staging_test' }).eq('id', pro.id).select();
    check('Server role (as used by /api/stripe/checkout) can save stripe_customer_id', !r.error && (await row(pro.id)).stripe_customer_id === 'cus_staging_test', r.error?.message);

    const [a, b] = await Promise.all([choose(racer.token, 'chaturbate'), choose(racer.token, 'myfreecams')]);
    const statuses = [a.status, b.status].sort();
    check('Simultaneous API choices → exactly one 200, one 409', statuses[0] === 200 && statuses[1] === 409, JSON.stringify([a, b]));
    const winner = a.status === 200 ? 'Chaturbate' : 'MyFreeCams';
    check('  DB: primary is the winning request only', (await row(racer.id)).primary_pro_platform === winner, JSON.stringify(await row(racer.id)));

    console.log('\nEntitlement in the UI');
    const launch = { headless: true, args: ['--no-sandbox'] };
    if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
    browser = await chromium.launch(launch);
    for (const [u, expectPro] of [[free, false], [pro, true]]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(120_000);
      await signIn(page, u);
      const marker = page.locator(`text=${expectPro ? 'Pro plan active' : 'Upgrade to Pro'}`).first();
      await marker.waitFor({ state: 'visible' }).catch(() => {});
      check(`${expectPro ? 'Pro' : 'Free (after attacks)'} account sees ${expectPro ? 'Pro' : 'Free'} UI`, (await marker.count()) > 0);
      await page.screenshot({ path: path.join(OUT, `sec-${expectPro ? 'pro' : 'free'}-dashboard.png`), fullPage: false });
      await ctx.close();
    }

    console.log('\nReal-browser onboarding: platform list + primary via route, with a failed first attempt');
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(120_000);
      const routeCalls = [];
      let failNext = true;
      await page.route('**/api/profile/primary-platform', async (route) => {
        routeCalls.push(route.request().postDataJSON());
        if (failNext) { failNext = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Could not save your primary platform.' }) }); }
        return route.continue();
      });
      await signIn(page, onb);
      if (!/\/onboarding/.test(page.url())) await page.goto(`${APP}/onboarding`, { waitUntil: 'networkidle' });
      await page.getByText('BongaCams', { exact: true }).first().click();
      await page.getByText('Chaturbate', { exact: true }).first().click();
      const cont = page.getByRole('button', { name: /Continue with 2 platforms/ });
      await cont.click();
      const err = page.getByTestId('primary-save-error');
      await err.waitFor({ state: 'visible' }).catch(() => {});
      check('Failed first route attempt shows a visible retryable error', (await err.count()) > 0 && /retry/i.test(await err.innerText()));
      check('  Onboarding stays on the platform step', await cont.isVisible());
      let r0 = await row(onb.id);
      check('  DB: platform list saved, primary still NULL after the failed attempt', r0.streaming_platforms?.join() === 'BongaCams,Chaturbate' && r0.primary_pro_platform == null, JSON.stringify({ sp: r0.streaming_platforms, p: r0.primary_pro_platform }));
      await page.screenshot({ path: path.join(OUT, 'sec-onboarding-retry-error.png') });
      await cont.click();
      await cont.waitFor({ state: 'detached' }).catch(() => {});
      check('Retry succeeds and onboarding proceeds past the platform step', !(await cont.isVisible().catch(() => false)) && (await err.count()) === 0);
      await page.screenshot({ path: path.join(OUT, 'sec-onboarding-after-retry.png') });
      check('  Route called exactly twice, both with the selected primary', routeCalls.length === 2 && routeCalls.every((b) => b?.platform === 'bongacams'), JSON.stringify(routeCalls));
      r0 = await row(onb.id);
      check('  DB: exactly one permanent primary = BongaCams; list = BongaCams,Chaturbate', r0.primary_pro_platform === 'BongaCams' && r0.streaming_platforms?.join() === 'BongaCams,Chaturbate', JSON.stringify({ sp: r0.streaming_platforms, p: r0.primary_pro_platform }));
      console.log(`  DB after flow: primary_pro_platform=${r0.primary_pro_platform} streaming_platforms=${JSON.stringify(r0.streaming_platforms)} plan=${r0.plan}`);
      // Reload: the chosen primary persists (read back by the app after a full reload).
      await admin.from('beta_users').update({ onboarding_complete: true }).eq('user_id', onb.id);
      await page.goto(`${APP}/dashboard`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('text="Free Chat Sessions" >> visible=true').first().click().catch(() => {});
      const ctl = page.getByTestId('primary-platform-control').first();
      await ctl.waitFor({ state: 'visible' }).catch(() => {});
      check('After reload the app shows the permanent primary (Primary: BongaCams)', (await ctl.count()) > 0 && /Primary:\s*BongaCams/.test(await ctl.innerText()), (await ctl.count()) ? await ctl.innerText() : 'control not found');
      await page.screenshot({ path: path.join(OUT, 'sec-onboarding-reload-dashboard.png') });
      check('  DB: still exactly that primary after reload', (await row(onb.id)).primary_pro_platform === 'BongaCams');
      await ctx.close();
    }
    check('DB: Free account still free at the end', (await row(free.id)).plan === 'free');
    check('DB: Pro account still pro at the end', (await row(pro.id)).plan === 'pro');
  } catch (e) {
    fail++;
    console.error('❌ Unhandled error:', e.message);
  } finally {
    if (browser) await browser.close();
    for (const u of users) {
      await admin.from('beta_users').delete().eq('user_id', u.id);
      await admin.from('profiles').delete().eq('id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
