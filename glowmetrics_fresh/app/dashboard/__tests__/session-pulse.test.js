/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SessionsPulse, { pickPulse } from '../SessionsPulse'

// Minimal history entries shaped like buildSessionHistory() output.
const live = (id, start, extra = {}) => ({ id, type: 'live', startTime: start, endTime: start, totalUSD: 25, tipCount: 6, uniqueTippers: 3, platforms: ['Chaturbate'], durationMinutes: 60, ...extra })
const freeChat = (id, start, extra = {}) => ({ id, type: 'free_chat', startTime: start, endTime: start, totalUSD: 10, tipCount: 2, uniqueTippers: 2, platforms: ['Chaturbate'], durationMinutes: 45, ...extra })
const priv = (id, start, extra = {}) => ({ id, type: 'private', startTime: start, endTime: start, totalUSD: 30.3, chargeCount: 1, uniqueTippers: 1, platforms: ['bongacams'], durationMinutes: null, ...extra })

describe('pickPulse selection', () => {
  test('a running show wins over everything', () => {
    const running = { id: 'run', type: 'live', startTime: '2026-03-29T20:00:00Z', totalUSD: 4, platforms: ['Chaturbate'] }
    const r = pickPulse({ running, history: [priv('p', '2026-03-30T10:00:00Z'), live('s', '2026-03-28T20:00:00Z')] })
    expect(r.kind).toBe('live_now')
    expect(r.e).toBe(running)
  })

  test('a newly finished persisted show wins over older sessions', () => {
    const fresh = live('f', '2026-03-27T20:00:00Z', { isNew: true })
    const r = pickPulse({ history: [freeChat('c', '2026-03-28T20:00:00Z'), fresh] })
    expect(r.kind).toBe('new_show')
    expect(r.e.id).toBe('f')
  })

  test('a standalone private charge is never selected as a show or session when a session exists', () => {
    const r = pickPulse({ history: [priv('p', '2026-03-29T10:00:00Z'), freeChat('c', '2026-03-20T20:00:00Z')] })
    expect(r.kind).toBe('recap')
    expect(r.e.type).toBe('free_chat')
    expect(r.e.id).toBe('c')
  })

  test('a newer private charge is named separately and does not change the selected session', () => {
    const r = pickPulse({ history: [priv('p', '2026-03-29T10:00:00Z'), freeChat('c', '2026-03-20T20:00:00Z')] })
    expect(r.laterPrivate.id).toBe('p')
    expect(r.e.id).toBe('c')
  })

  test('with only a private charge, the private activity is the selected observation', () => {
    const r = pickPulse({ history: [priv('p', '2026-03-29T10:00:00Z')] })
    expect(r.kind).toBe('private')
    expect(r.e.id).toBe('p')
  })

  test('comparison: picks the latest session that has a valid comparison, not only the newest one', () => {
    const newest = freeChat('n', '2026-03-28T20:00:00Z')
    const older = live('o', '2026-03-20T20:00:00Z')
    const vs = { outcome: 'above', deltaPct: 12, medianUSD: 20, sessions: 4 }
    const r = pickPulse({ history: [newest, older], vsById: new Map([['o', vs]]) })
    expect(r.kind).toBe('comparison')
    expect(r.e.id).toBe('o')
  })

  test('private activity newer than a comparison-backed session is still named separately', () => {
    const vs = { outcome: 'below', deltaPct: 5, medianUSD: 20, sessions: 4 }
    const r = pickPulse({ history: [priv('p', '2026-03-29T10:00:00Z'), live('o', '2026-03-20T20:00:00Z')], vsById: new Map([['o', vs]]) })
    expect(r.kind).toBe('comparison')
    expect(r.laterPrivate.id).toBe('p')
  })

  test('nothing to show: null', () => {
    expect(pickPulse({ history: [] })).toBeNull()
  })
})

describe('SessionsPulse rendering', () => {
  const renderPulse = (pick, onOpen = jest.fn()) => render(<SessionsPulse pick={pick} tz="UTC" onOpen={onOpen} />)

  test('unrecognized platform shows "Platform not recorded", never a raw "unknown"', () => {
    const e = priv('p', '2026-03-29T10:00:00Z', { platforms: ['unknown'] })
    renderPulse({ kind: 'private', e })
    expect(screen.getByTestId('pulse-platform').textContent).toBe('Platform not recorded')
    expect(document.body.textContent).not.toMatch(/\bunknown\b/)
  })

  test('missing platform shows "Platform not recorded"', () => {
    const e = priv('p', '2026-03-29T10:00:00Z', { platforms: [] })
    renderPulse({ kind: 'private', e })
    expect(screen.getByTestId('pulse-platform').textContent).toBe('Platform not recorded')
  })

  test('legacy and casing variants resolve to canonical names', () => {
    renderPulse({ kind: 'private', e: priv('p', '2026-03-29T10:00:00Z', { platforms: ['bongacams'] }) })
    expect(screen.getByTestId('pulse-platform').textContent).toBe('BongaCams')
  })

  test('legacy short code "bc" resolves to BongaCams', () => {
    renderPulse({ kind: 'private', e: priv('p', '2026-03-29T10:00:00Z', { platforms: ['BC'] }) })
    expect(screen.getByTestId('pulse-platform').textContent).toBe('BongaCams')
  })

  test('standalone private charge uses private-activity wording, not session wording', () => {
    renderPulse({ kind: 'private', e: priv('p', '2026-03-29T10:00:00Z') })
    expect(screen.getByTestId('session-pulse').getAttribute('data-kind')).toBe('private')
    expect(screen.getByText(/Your latest private activity brought in/)).toBeTruthy()
    expect(screen.getByText(/Not counted as a show or session/)).toBeTruthy()
    expect(screen.getByTestId('pulse-amount').textContent).toBe('$30.30')
  })

  test('a newer private charge is stated separately beside a selected session', () => {
    const pick = pickPulse({ history: [priv('p', '2026-03-29T10:00:00Z'), freeChat('c', '2026-03-20T20:00:00Z')] })
    renderPulse(pick)
    expect(screen.getByTestId('pulse-sentence').textContent).toMatch(/Separate private activity came later: \$30\.30/)
  })

  test('CTA opens the record that the pick selected', () => {
    const onOpen = jest.fn()
    const e = freeChat('c', '2026-03-20T20:00:00Z')
    renderPulse({ kind: 'recap', e, first: false }, onOpen)
    fireEvent.click(screen.getByTestId('pulse-action'))
    expect(onOpen).toHaveBeenCalledWith('c')
  })

  test('private CTA opens the private record', () => {
    const onOpen = jest.fn()
    renderPulse({ kind: 'private', e: priv('p', '2026-03-29T10:00:00Z') }, onOpen)
    fireEvent.click(screen.getByTestId('pulse-action'))
    expect(onOpen).toHaveBeenCalledWith('p')
  })

  test('the headline amount is not repeated as an earnings stat', () => {
    renderPulse({ kind: 'recap', e: freeChat('c', '2026-03-20T20:00:00Z'), first: false })
    expect(screen.queryByTestId('pulse-earned')).toBeNull()
    expect(screen.getByTestId('pulse-count')).toBeTruthy()
    expect(screen.getByTestId('pulse-fans')).toBeTruthy()
  })
})
