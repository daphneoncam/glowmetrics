// STAGING ONLY. Real-browser proof for the onboarding restore fix: a creator
// who leaves onboarding before finishing and reopens it gets their saved
// platforms (stored as canonical names) and stored primary back, and merely
// reopening writes nothing and never calls the primary-platform route.
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
const row = async (id) => (await admin.from('profiles').select('primary_pro_platform, streaming_platforms').eq('id', id).single()).data;

async function makeUser(label) {
  const email = `restore-${label}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@staging.local`;
  const password = crypto.randomBytes(18).toString('hex');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`create ${label}: ${error.message}`);
  const id = data.user.id;
  await admin.from('profiles').upsert({ id, plan: 'free' });
  await admin.from('beta_users').insert({ user_id: id, email, onboarding_complete: false });
  return { id, email, password };
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
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

// Records every profile write and primary-route call the page makes.
function watchWrites(page) {
  const log = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/profile/primary-platform')) log.push(`route ${req.method()}`);
    else if (u.includes('/rest/v1/profiles') && req.method() !== 'GET' && req.method() !== 'HEAD') log.push(`profiles ${req.method()}`);
  });
  return log;
}

// Leave onboarding, reopen it, and verify the restored state with zero writes.
async function reopenAndVerify(page, log, label, expectPrimary, expectCount) {
  await page.goto(`${APP}/landing`, { waitUntil: 'networkidle' });
  log.length = 0;
  await page.goto(`${APP}/onboarding`, { waitUntil: 'networkidle' });
  const primaryText = page.getByText(new RegExp(`Primary platform: ${expectPrimary}`)).first();
  await primaryText.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  check(`${label}: reopened onboarding shows "Primary platform: ${expectPrimary}"`, (await primaryText.count()) > 0);
  const cont = page.getByRole('button', { name: new RegExp(`Continue with ${expectCount} platform${expectCount === 1 ? '' : 's'}`) });
  check(`${label}: all ${expectCount} selected platform(s) restored`, (await cont.count()) > 0);
  await page.waitForTimeout(2000);
  check(`${label}: restoring made no profile write and no primary-route call`, log.length === 0, JSON.stringify(log));
  await page.screenshot({ path: path.join(OUT, `restore-${label.replace(/\W+/g, '-').toLowerCase()}.png`) });
}

async function main() {
  const users = [];
  let browser;
  try {
    const launch = { headless: true, args: ['--no-sandbox'] };
    if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
    browser = await chromium.launch(launch);

    // A. Real flow: choose MyFreeCams, BongaCams, Chaturbate → Continue → leave → reopen.
    {
      const u = await makeUser('flow'); users.push(u);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await ctx.newPage(); page.setDefaultTimeout(120_000);
      const log = watchWrites(page);
      await signIn(page, u);
      if (!/\/onboarding/.test(page.url())) await page.goto(`${APP}/onboarding`, { waitUntil: 'networkidle' });
      for (const name of ['MyFreeCams', 'BongaCams', 'Chaturbate']) await page.getByText(name, { exact: true }).first().click();
      const cont = page.getByRole('button', { name: /Continue with 3 platforms/ });
      await cont.click();
      await cont.waitFor({ state: 'detached' }).catch(() => {});
      const before = await row(u.id);
      console.log(`  DB after choosing: primary=${before.primary_pro_platform} list=${JSON.stringify(before.streaming_platforms)}`);
      check('Flow: choice saved (primary MyFreeCams, saved order kept)', before.primary_pro_platform === 'MyFreeCams' && before.streaming_platforms?.join() === 'MyFreeCams,BongaCams,Chaturbate', JSON.stringify(before));
      await reopenAndVerify(page, log, 'Flow multi-platform', 'MyFreeCams', 3);
      const after = await row(u.id);
      check('Flow: DB unchanged by reopening', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
      await ctx.close();
    }

    // B–E. Saved by an earlier visit (stored canonical names), then reopened.
    const cases = [
      ['BongaCams only', ['BongaCams'], null, 'BongaCams', 1],
      ['Chaturbate only', ['Chaturbate'], null, 'Chaturbate', 1],
      ['MyFreeCams only', ['MyFreeCams'], null, 'MyFreeCams', 1],
      ['Saved order with stored primary not first', ['BongaCams', 'MyFreeCams', 'Chaturbate'], 'Chaturbate', 'Chaturbate', 3],
    ];
    for (const [label, list, primary, expectPrimary, n] of cases) {
      const u = await makeUser(label.split(' ')[0].toLowerCase()); users.push(u);
      const { error } = await admin.from('profiles').update({ streaming_platforms: list, primary_pro_platform: primary }).eq('id', u.id);
      if (error) throw new Error(`seed ${label}: ${error.message}`);
      const before = await row(u.id);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await ctx.newPage(); page.setDefaultTimeout(120_000);
      const log = watchWrites(page);
      await signIn(page, u);
      await reopenAndVerify(page, log, label, expectPrimary, n);
      const after = await row(u.id);
      check(`${label}: DB unchanged (primary=${after.primary_pro_platform}, list=${after.streaming_platforms?.join()})`, JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }));
      await ctx.close();
    }
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
