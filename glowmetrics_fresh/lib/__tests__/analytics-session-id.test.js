// Analytics session IDs come from Web Crypto, not Math.random
// (CodeQL js/insecure-randomness), and stay compatible with what /api/track
// stores (session_id is truncated to 100 chars server-side).
import { generateSessionId } from '../analytics-client'

describe('generateSessionId', () => {
  const realCrypto = globalThis.crypto
  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true, writable: true })
    jest.restoreAllMocks()
  })

  test('uses crypto, never Math.random', () => {
    const mathSpy = jest.spyOn(Math, 'random')
    const id = generateSessionId()
    expect(mathSpy).not.toHaveBeenCalled()
    expect(id).toMatch(/^sess_[0-9a-f]{32}$/)
  })

  test('uses crypto.randomUUID when available', () => {
    const randomUUID = jest.fn(() => '123e4567-e89b-12d3-a456-426614174000')
    Object.defineProperty(globalThis, 'crypto', { value: { randomUUID }, configurable: true, writable: true })
    expect(generateSessionId()).toBe('sess_123e4567e89b12d3a456426614174000')
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })

  test('falls back to crypto.getRandomValues', () => {
    const getRandomValues = jest.fn((arr) => { arr.fill(171); return arr })
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues }, configurable: true, writable: true })
    expect(generateSessionId()).toBe('sess_' + 'ab'.repeat(16))
  })

  test('unique across 10,000 calls, prefixed, and within the 100-char column limit', () => {
    const ids = new Set()
    for (let i = 0; i < 10000; i++) ids.add(generateSessionId())
    expect(ids.size).toBe(10000)
    for (const id of ids) {
      expect(id.startsWith('sess_')).toBe(true)
      expect(id.length).toBeLessThanOrEqual(100)
    }
  })
})
