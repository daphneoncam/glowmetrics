// Regression tests for staging-guard.mjs: staging tests (which use a
// service-role key to write and delete rows) must never reach production.
// Run: node staging-guard.test.mjs
import assert from 'node:assert/strict';
import { checkStagingSupabaseUrl, checkStagingAppUrl, PRODUCTION_SUPABASE_REF } from './staging-guard.mjs';

const STAGING_REF = 'abcdefghijklmnopqrst'; // fake 20-char ref, not production
let passed = 0;
let failed = 0;

function check(name, fn) {
  try { fn(); passed++; console.log(`✅ ${name}`); } catch (e) { failed++; console.error(`❌ ${name}: ${e.message}`); }
}
const rejects = (fn, value) => assert.throws(() => fn(value), undefined, `should reject ${value}`);

// ── Supabase URL ────────────────────────────────────────────────────────────
check('accepts the staging Supabase project', () => {
  assert.equal(checkStagingSupabaseUrl(`https://${STAGING_REF}.supabase.co`), `https://${STAGING_REF}.supabase.co`);
  assert.equal(checkStagingSupabaseUrl(`https://${STAGING_REF}.supabase.co/`), `https://${STAGING_REF}.supabase.co`);
});

for (const bad of [
  `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
  `https://${PRODUCTION_SUPABASE_REF}.supabase.co/`,              // trailing slash beat the old === check
  `HTTPS://${PRODUCTION_SUPABASE_REF.toUpperCase()}.SUPABASE.CO/`, // upper case beat the old === check
  `https://${PRODUCTION_SUPABASE_REF}.supabase.co:443/rest/v1`,
  `https://${PRODUCTION_SUPABASE_REF}.supabase.co?x=1`,
  `http://${STAGING_REF}.supabase.co`,                            // not https
  `https://${STAGING_REF}.supabase.co.evil.io`,                   // lookalike suffix
  `https://evil.io/${STAGING_REF}.supabase.co`,
  `https://${STAGING_REF}.supabase.co@evil.io`,                   // userinfo trick
  `https://user:pw@${STAGING_REF}.supabase.co`,
  `https://x.${STAGING_REF}.supabase.co`,
  `https://www.camcashgrl.com`,
  'javascript:alert(1)',
  'ftp://example.com',
  'not a url',
  '',
  undefined,
]) {
  check(`rejects Supabase URL ${JSON.stringify(bad)}`, () => rejects(checkStagingSupabaseUrl, bad));
}

// ── App base URL ────────────────────────────────────────────────────────────
check('accepts the locally started app used by every staging workflow', () => {
  assert.equal(checkStagingAppUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(checkStagingAppUrl('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(checkStagingAppUrl('https://localhost:3443'), 'https://localhost:3443');
});

for (const bad of [
  'https://www.camcashgrl.com',
  'https://www.camcashgrl.com/?staging',          // beat the old includes('staging') check
  'https://camcashgrl.com/staging',
  'https://staging.camcashgrl.com',               // deployed site, not the CI-local app
  'https://staging.camcashgrl.com.attacker.com',
  'https://camcashgrl.com.evil.io',
  'https://WWW.CAMCASHGRL.COM',
  'https://127.0.0.1@camcashgrl.com',             // userinfo trick: host is camcashgrl.com
  'http://localhost@camcashgrl.com:3000',
  'http://127.0.0.1.nip.io:3000',
  'http://localhost.evil.io:3000',
  'https://glowmetrics-ggsb.vercel.app',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'ftp://127.0.0.1',
  '',
  undefined,
]) {
  check(`rejects app URL ${JSON.stringify(bad)}`, () => rejects(checkStagingAppUrl, bad));
}

console.log(`\nstaging-guard: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
