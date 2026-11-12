import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { PLATFORM_TOKEN_RATES } from '@/lib/constants';
import { validateImportRows, describeProblems } from '@/lib/importValidation';

// See app/api/scan/preview/route.js for why this map exists — lib/constants.js
// keys rates by capitalized platform name, the scan payload uses lowercase ids.
const PLATFORM_LABELS = {
  chaturbate: 'Chaturbate',
  bongacams: 'BongaCams',
  myfreecams: 'MyFreeCams',
};

const ConfirmedRowSchema = z.object({
  username: z.string().min(1).max(200),
  tokens: z.number().int().positive(),
  timestamp: z.string().datetime(), // rows without a valid timestamp were already
                                     // routed to needsReview in the preview step and
                                     // should never reach this endpoint
  platform: z.enum(['chaturbate', 'bongacams', 'myfreecams']),
});

const ImportRequestSchema = z.object({
  rows: z.array(ConfirmedRowSchema).min(1).max(5000),
});

export async function POST(request) {
  // Same bearer-token auth as app/api/scan/preview/route.js — this route is
  // only ever called from the extension's background service worker, which
  // has no cookie session to send, so a cookie-based route client would
  // reject every real request. Validate the Supabase access token directly,
  // matching app/api/live/tips/route.js's existing pattern for this extension.
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'You need to sign in to continue.' }, { status: 401 });
  }

  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser(authHeader.substring(7));

  if (authError || !user) {
    return NextResponse.json({ error: 'You need to sign in to continue.' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = ImportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid import data.' }, { status: 400 });
  }

  // Re-derive usd server-side from the real per-platform rate — never trust
  // a client-supplied usd value, even one we returned to them in the preview
  // step ourselves. Recomputing here means a tampered payload can't change
  // the rate, only (at most) claim tips that didn't happen — the same trust
  // boundary the CSV paste import already accepts for user-submitted data.
  const tipsForRpc = parsed.data.rows.map((row) => {
    const platformLabel = PLATFORM_LABELS[row.platform];
    const rate = PLATFORM_TOKEN_RATES[platformLabel];
    return {
      user_id: user.id, // from the validated token, never from the client payload
      date_time: row.timestamp,
      platform: platformLabel,
      username: row.username,
      tip_type: 'Tip',
      tokens: row.tokens,
      usd: rate ? Math.round(row.tokens * rate * 100) / 100 : undefined,
      tip_note: '',
    };
  });

  // All-or-nothing validation BEFORE any write (same rules as /api/upload):
  // dates must be full and plausible, tokens whole numbers >= 1. (usd is
  // recomputed from tokens above, so it cannot be a misread balance.)
  const validation = validateImportRows(tipsForRpc.map((r) => ({ ...r, source_date: r.date_time })));
  if (!validation.ok) {
    return NextResponse.json({
      error: describeProblems(validation),
      code: 'import_validation_failed',
      problems: validation.problems,
      problemCount: validation.problemCount,
      rowsChecked: validation.rowsChecked,
      truncated: validation.truncated,
    }, { status: 422 });
  }

  // Writes go through the service-role client, same as app/api/live/tips/route.js —
  // insert_tips_dedup is SECURITY DEFINER and keys off the user_id embedded in
  // each row, so it doesn't need (and an extension caller can't easily provide)
  // a request-scoped RLS session.
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabaseAdmin.rpc('insert_tips_dedup', {
    tips: tipsForRpc,
    p_upload_id: null,
  });

  if (error) {
    // Sanitized — never return raw Postgres error text to the client
    return NextResponse.json({ error: 'Something went wrong saving your tips. Please try again.' }, { status: 500 });
  }

  if (data?.error) {
    // The RPC itself caught an internal error and returned it in its own
    // exception-handling branch — still sanitize before it reaches the client
    return NextResponse.json({ error: 'Something went wrong saving your tips. Please try again.' }, { status: 500 });
  }

  return NextResponse.json(
    { inserted: data?.inserted ?? 0, skipped: data?.skipped ?? 0, total: data?.total ?? tipsForRpc.length },
    { status: 200 }
  );
}
