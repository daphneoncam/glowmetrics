/**
 * Dashboard upgrade tracking: the sidebar "Upgrade to Pro" button and the
 * "Pro plan active" subscription badge are tracked; the upgrade modal sends
 * creators to /pricing (live checkout) and no longer collects/tracks emails.
 */
const fs = require('fs')
const path = require('path')
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('../../../lib/track', () => ({ track: jest.fn() }))
const { track } = require('../../../lib/track')
const Sidebar = require('../Sidebar').default

const base = { activeTab: 'overview', user: { email: 'a@b.c' }, onSignOut: () => {} }
beforeEach(() => jest.clearAllMocks())

test('free user: Upgrade to Pro click is tracked with source sidebar', () => {
  render(<Sidebar {...base} onTabChange={() => {}} isPro={false} />)
  const btn = screen.getAllByTestId('sidebar-upgrade')[0]
  btn.addEventListener('click', (e) => e.preventDefault())
  expect(btn).toHaveAttribute('href', '/pricing')
  fireEvent.click(btn)
  expect(track).toHaveBeenCalledWith('upgrade_to_pro_clicked', { source: 'sidebar' })
})

test('pro user: subscription badge click is tracked and still opens the subscription tab', () => {
  const onTabChange = jest.fn()
  render(<Sidebar {...base} onTabChange={onTabChange} isPro />)
  fireEvent.click(screen.getAllByTestId('subscription-badge')[0])
  expect(track).toHaveBeenCalledWith('subscription_badge_clicked', { plan_state: 'pro_active' })
  expect(onTabChange).toHaveBeenCalledWith('subscription')
})

describe('dashboard page source contract', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'page.js'), 'utf8')

  test('upgrade modal links to /pricing and no longer runs the email waitlist', () => {
    expect(src).toContain("gtmTrack('upgrade_to_pro_clicked', { source: 'upgrade_modal' })")
    expect(src).not.toContain('early_access_signup')
    expect(src).not.toContain('Launching soon')
    expect(src).not.toMatch(/track\([^)]*email/)
  })

  test('every dashboard link to /pricing is tracked with a distinct source', () => {
    for (const source of ['platform_limit_banner', 'import_locked_preview', 'plan_explainer', 'upgrade_modal']) {
      expect(src).toContain(`gtmTrack('upgrade_to_pro_clicked', { source: '${source}' })`)
    }
  })
})
