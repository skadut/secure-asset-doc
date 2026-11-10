import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto('http://127.0.0.1:8088/', { waitUntil: 'networkidle' })
for (const m of ['print', 'forced']) {
  if (m === 'print') await p.emulateMedia({ media: 'print' }); else await p.emulateMedia({ forcedColors: 'active' })
  await p.waitForTimeout(200)
  console.log(m, JSON.stringify(await p.evaluate(() => {
    const el = document.querySelector('[data-slot="sidebar-inner"]')
    const c = getComputedStyle(el)
    const rules = []
    for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) { const walk = (rr, ctx) => { if (rr.cssText && rr.cssText.includes('backdrop-filter') && rr.selectorText && el.matches(rr.selectorText)) rules.push((ctx||'') + rr.selectorText + ' => ' + rr.style.getPropertyValue('backdrop-filter') + ' ' + rr.style.getPropertyPriority('backdrop-filter')); if (rr.cssRules) for (const x of rr.cssRules) walk(x, (ctx||'') + (rr.conditionText || rr.name || '') + ' > ') }; walk(r) } } catch (e) {} }
    return { backdrop: c.backdropFilter, bg: c.backgroundColor, rules }
  })))
}
await b.close()
