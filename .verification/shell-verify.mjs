import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:8088'
const out = {}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
for (const scheme of ['light', 'dark']) for (const [w, h] of [[1440, 900], [375, 812], [320, 640]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') errors.push(`${w}/${scheme} console: ${m.text()}`) })
  page.on('pageerror', e => errors.push(`${w}/${scheme} pageerror: ${e.message}`))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const box = async (sel) => {
    const el = page.locator(sel).first()
    if (!(await el.count())) return null
    const b = await el.boundingBox()
    return b && { w: Math.round(b.width), h: Math.round(b.height) }
  }
  const row = {
    url: page.url(),
    sidebarTrigger: await box('[data-slot="sidebar-trigger"]'),
    search: await box('header button[aria-keyshortcuts]'),
    themeLabel: await box('label.ui-switch'),
    themeSettings: await box('button[aria-label="Open theme settings"]'),
    avatar: await box('button[aria-label^="Open profile menu"]'),
    hOverflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  }
  out[`${w}-${scheme}`] = row
  await page.screenshot({ path: `.verification/shell-targets-${w}-${scheme}.png` })
  await ctx.close()
}
console.log(JSON.stringify(out, null, 1))
console.log('ERRORS', JSON.stringify(errors.slice(0, 20), null, 1))
await browser.close()
