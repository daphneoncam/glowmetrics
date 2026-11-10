import { fetchEntitlement, entitlementFromPlan } from '../entitlement'
import { tierHasPro, ENTITLEMENT_TIERS } from '../planLimits'

const rpcReturning = (result) => ({ rpc: jest.fn(async () => result) })

describe('tierHasPro', () => {
  test('trial grants exactly what Pro grants (D1); free grants nothing', () => {
    expect(tierHasPro('pro')).toBe(true)
    expect(tierHasPro('trial')).toBe(true)
    expect(tierHasPro('free')).toBe(false)
  })
  test('unknown / missing tiers never grant Pro', () => {
    for (const t of [undefined, null, '', 'PRO', 'unlimited', 'trialing', 'active']) {
      expect(tierHasPro(t)).toBe(false)
    }
  })
  test('tier list matches the database rule', () => {
    expect(ENTITLEMENT_TIERS).toEqual(['free', 'trial', 'pro'])
  })
})

describe('fetchEntitlement — server answer', () => {
  test('calls the caller-scoped RPC with no user id', async () => {
    const supabase = rpcReturning({ data: { tier: 'free', trial_ends_at: null }, error: null })
    await fetchEntitlement(supabase, { plan: 'free' })
    expect(supabase.rpc).toHaveBeenCalledWith('get_my_entitlement')
    expect(supabase.rpc.mock.calls[0]).toHaveLength(1)
  })

  test('running trial -> Pro features, trial end passed through', async () => {
    const end = '2026-11-17T00:00:00+00:00'
    const r = await fetchEntitlement(rpcReturning({ data: { tier: 'trial', trial_ends_at: end }, error: null }), { plan: 'free' })
    expect(r).toEqual({ tier: 'trial', isPro: true, trialEndsAt: end, source: 'server' })
  })

  test('server says free even though the plan column says pro -> free (server wins)', async () => {
    const r = await fetchEntitlement(rpcReturning({ data: { tier: 'free', trial_ends_at: null }, error: null }), { plan: 'pro' })
    expect(r).toEqual({ tier: 'free', isPro: false, trialEndsAt: null, source: 'server' })
  })

  test('paid Pro -> Pro, no trial date', async () => {
    const r = await fetchEntitlement(rpcReturning({ data: { tier: 'pro', trial_ends_at: '2026-01-01' }, error: null }), { plan: 'pro' })
    expect(r).toEqual({ tier: 'pro', isPro: true, trialEndsAt: null, source: 'server' })
  })
})

describe('fetchEntitlement — fallback keeps today\'s behaviour', () => {
  const cases = [
    ['RPC error (not deployed yet)', rpcReturning({ data: null, error: { code: 'PGRST202' } })],
    ['RPC throws (network)', { rpc: jest.fn(async () => { throw new Error('offline') }) }],
    ['unexpected tier value', rpcReturning({ data: { tier: 'enterprise' }, error: null })],
    ['empty payload', rpcReturning({ data: null, error: null })],
  ]
  test.each(cases)('%s: plan pro stays Pro', async (_label, supabase) => {
    expect(await fetchEntitlement(supabase, { plan: 'pro' })).toEqual({ tier: 'pro', isPro: true, trialEndsAt: null, source: 'fallback' })
  })
  test.each(cases)('%s: plan free stays Free', async (_label, supabase) => {
    expect(await fetchEntitlement(supabase, { plan: 'free' })).toEqual({ tier: 'free', isPro: false, trialEndsAt: null, source: 'fallback' })
  })

  test('fallback matches the previous inline dashboard check', () => {
    for (const plan of ['pro', 'unlimited', 'free', null, undefined, 'trialing']) {
      const before = plan === 'pro' || plan === 'unlimited'
      expect(entitlementFromPlan({ plan }).isPro).toBe(before)
    }
    expect(entitlementFromPlan(null).isPro).toBe(false)
  })
})
