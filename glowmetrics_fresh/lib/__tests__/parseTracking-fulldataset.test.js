/**
 * logParseAttempt must send the FULL dataset (the database function caps and
 * fingerprints it), not a 500-character prefix.
 */
jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn().mockResolvedValue({ data: 'id', error: null }) } }))
import { supabase } from '../supabase'
import { logParseAttempt, analyzeFormat } from '../parseTracking'

test('sends the whole paste to log_paste_parse_attempt', async () => {
  const raw = ['Date,Member,Tokens', ...Array.from({ length: 400 }, (_, i) => `18.06.2026 14:${String(i % 60).padStart(2, '0')},fan${i},${i + 1}`)].join('\n')
  expect(raw.length).toBeGreaterThan(5000)
  await logParseAttempt({
    userId: 'u1', source: 'onboarding', attemptedPlatform: 'BongaCams', rawText: raw,
    formatAnalysis: analyzeFormat(raw), parseSuccess: false, errorReason: 'x',
  })
  expect(supabase.rpc).toHaveBeenCalledTimes(1)
  const [fn, args] = supabase.rpc.mock.calls[0]
  expect(fn).toBe('log_paste_parse_attempt')
  expect(args.p_raw_text).toBe(raw)
  expect(args.p_user_id).toBe('u1')
})
