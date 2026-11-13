// Shared helpers for the LOCAL staging browser run. BASE is localhost only.
const BASE = 'http://127.0.0.1:3100'
if (!/^http:\/\/127\.0\.0\.1:/.test(BASE)) throw new Error('refusing: staging must be localhost')
const PASSWORD = 'Staging-Only-123!'

async function login(page, email) {
  await page.goto(BASE + '/landing', { waitUntil: 'networkidle' })
  await page.getByText('Log In', { exact: true }).first().click()
  await page.waitForTimeout(800)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('input[type="password"]').first().press('Enter')
  await page.waitForURL(/dashboard|onboarding/, { timeout: 30000 })
  await page.waitForLoadState('domcontentloaded')
}

module.exports = { BASE, login }
