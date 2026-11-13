// Upload fixture files through the real dashboard UI on LOCAL staging.
// Usage: node pw_upload.js <email> <platform> <file> [<file> ...]
const { chromium } = require('playwright')
const { BASE, login } = require('./pw_common')
const OUT = process.env.SHOTS_DIR || require('os').tmpdir() + '/camcash-staging-shots'
require('fs').mkdirSync(OUT, { recursive: true })
const [email, platform, ...files] = process.argv.slice(2)
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await login(page, email)
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  for (const f of files) {
    await page.getByText('Import CSV', { exact: true }).first().click()
    await page.waitForTimeout(1500)
    // Back to the picker if a previous result panel is showing.
    const again = page.getByText('Import another CSV', { exact: true })
    if (await again.count()) { await again.first().click(); await page.waitForTimeout(800) }
    await page.selectOption('select', platform)
    const resp = page.waitForResponse((r) => r.url().endsWith('/api/upload') && r.request().method() === 'POST', { timeout: 60000 })
    await page.locator('input[type=file]').first().setInputFiles(require('path').join(__dirname, '..', 'fixtures', f))
    const r = await resp
    const body = await r.json().catch(() => ({}))
    await page.waitForTimeout(2500)
    const name = f.replace(/\W+/g, '_')
    await page.screenshot({ path: `${OUT}/upload_${name}.png` })
    const panel = await page.locator('main').innerText().catch(() => '')
    const pick = ({ inserted, skipped, total, totalUsd, rejectedRows, unresolvedUsdRows, rejectedRowsWarning, unresolvedUsdWarning, error, code }) =>
      ({ inserted, skipped, total, totalUsd, rejectedRows, unresolvedUsdRows, rejectedRowsWarning, unresolvedUsdWarning, error, code })
    console.log(JSON.stringify({ file: f, status: r.status(), api: pick(body), screenWarning: (panel.match(/⚠️[^\n]*/g) || []) }))
  }
  await browser.close()
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
