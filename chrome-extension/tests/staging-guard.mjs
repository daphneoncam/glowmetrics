// Production-isolation guard for the staging integration tests.
//
// These tests use a SERVICE-ROLE key to create, modify and delete rows, so
// they must never run against the production Supabase project or the
// production app. The old guards matched substrings
// (`includes('camcashgrl.com') && !includes('staging')`, /camcashgrl\.com/,
// exact string equality), which `https://www.camcashgrl.com/?staging`, a
// trailing slash, or upper case slipped past (CodeQL
// js/incomplete-url-substring-sanitization).
//
// This guard parses each URL and allowlists what the staging workflows really
// use (.github/workflows/phase2-staging-verification.yml):
//   - Supabase: https://<project-ref>.supabase.co, and the ref is not production
//   - App base: the app CI starts locally, http(s)://127.0.0.1 or localhost
// Everything else is rejected.

export const PRODUCTION_SUPABASE_REF = 'hlsdlaibnayzbfflxclj';

const SUPABASE_HOST = /^([a-z0-9]{20})\.supabase\.co$/;
const LOCAL_APP_HOSTS = new Set(['127.0.0.1', 'localhost']);

function parse(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is not set`);
  }
  try {
    return new URL(value.trim());
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
}

export function checkStagingSupabaseUrl(value) {
  const url = parse(value, 'SUPABASE_STAGING_URL');
  if (url.protocol !== 'https:') throw new Error('SUPABASE_STAGING_URL must use https');
  if (url.username || url.password) throw new Error('SUPABASE_STAGING_URL must not contain credentials');
  const host = url.hostname.toLowerCase(); // URL already lower-cases, kept explicit
  const match = SUPABASE_HOST.exec(host);
  if (!match) throw new Error('SUPABASE_STAGING_URL must be https://<project-ref>.supabase.co');
  if (match[1] === PRODUCTION_SUPABASE_REF) throw new Error('SUPABASE_STAGING_URL is the PRODUCTION Supabase project');
  return url.origin;
}

export function checkStagingAppUrl(value) {
  const url = parse(value, 'CAMCASH_STAGING_BASE_URL');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('CAMCASH_STAGING_BASE_URL must use http or https');
  if (url.username || url.password) throw new Error('CAMCASH_STAGING_BASE_URL must not contain credentials');
  if (!LOCAL_APP_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('CAMCASH_STAGING_BASE_URL must be the locally started app (http://127.0.0.1:<port> or http://localhost:<port>), never a deployed site');
  }
  return url.origin;
}

// Checks both targets; on failure prints a clear message and exits before
// any client is created. Returns the normalized origins.
export function assertStagingTargets({ supabaseUrl, appBaseUrl }) {
  try {
    return {
      supabaseUrl: checkStagingSupabaseUrl(supabaseUrl),
      appBaseUrl: checkStagingAppUrl(appBaseUrl),
    };
  } catch (err) {
    console.error(`❌ FATAL: refusing to run staging tests: ${err.message}`);
    process.exit(1);
  }
}
