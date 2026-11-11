// Sessions + Platforms screenshots on LOCAL staging at 1440 and 390 px, with
// the on-screen text saved for reconciliation against the database.
const { chromium } = require('playwright')
const { BASE, login } = require('./pw_common')
const fs = require('fs')
const OUT = process.env.SHOTS_DIR || require('os').tmpdir() + '/camcash-staging-shots'
require('fs').mkdirSync(OUT, { recursive: true })
;(async () => {
  const browser = await chromium.launch()
  const report = {}
  for (const [label, viewport] of [['desktop1440', { width: 1440, height: 900 }], ['mobile390', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await login(page, 'staging-free@camcash.local') // the Log In link is in a collapsed menu on mobile
    await page.setViewportSize(viewport)
    for (const tab of ['sessions', 'platforms']) {
      await page.goto(`${BASE}/dashboard?tab=${tab}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(8000)
      await page.screenshot({ path: `${OUT}/${tab}_${label}.png`, fullPage: true })
      const text = await page.locator('body').innerText()
      report[`${tab}_${label}`] = text
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      report[`${tab}_${label}_hscroll`] = overflow
    }
    await ctx.close()
  }
  fs.writeFileSync(OUT + '/screen_text.json', JSON.stringify(report, null, 1))
  for (const k of Object.keys(report)) if (k.endsWith('_hscroll')) console.log(k, report[k])
  await browser.close()
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
