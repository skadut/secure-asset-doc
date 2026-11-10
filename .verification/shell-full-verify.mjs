import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const BASE = 'http://127.0.0.1:8088'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { glass: {}, contrast: {}, keyboard: {}, bg: {}, print: {}, errors: [] }
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`1440/${scheme}: ${m.text()}`) })
  page.on('pageerror', e => report.errors.push(`1440/${scheme} pageerror: ${e.message}`))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  report.glass[`1440-${scheme}`] = await page.evaluate(() => {
    const c = getComputedStyle(document.querySelector('[data-slot="sidebar-inner"]'))
    return { bg: c.backgroundColor, backdrop: c.backdropFilter, supportsBackdrop: CSS.supports('backdrop-filter', 'blur(1px)'), pseudoBefore: getComputedStyle(document.body, '::before').backgroundImage.slice(0, 60), insetBgImage: getComputedStyle(document.querySelector('[data-slot="sidebar-inset"]')).backgroundImage }
  })
  await page.screenshot({ path: `.verification/shell-glass-1440-${scheme}.png` })
  const nav = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-sidebar="menu-button"]')]
    const pick = selector => { const el = buttons.find(x => selector(x)); if (!el) return null; const c = getComputedStyle(el); return { fg: c.color, bg: c.backgroundColor } }
    return { def: pick(x => x.getAttribute('data-active') !== 'true'), active: pick(x => x.getAttribute('data-active') === 'true') }
  })
  report.contrast[scheme] = nav
  await ctx.close()
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme })
  const m = await mctx.newPage(); await m.goto(BASE + '/', { waitUntil: 'networkidle' })
  await m.locator('[data-slot="sidebar-trigger"]').first().click(); await m.waitForSelector('[data-mobile="true"]', { state: 'visible' }); await m.waitForTimeout(600)
  report.glass[`375-${scheme}-sheet`] = await m.evaluate(() => { const c = getComputedStyle(document.querySelector('[data-mobile="true"]')); return { bg: c.backgroundColor, backdrop: c.backdropFilter } })
  await m.screenshot({ path: `.verification/shell-glass-375-${scheme}.png` }); await mctx.close()
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  await p.locator('header button[aria-keyshortcuts]').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
  const input = p.locator('[cmdk-input]').first(); report.keyboard.searchInputH = (await input.boundingBox())?.height
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); report.keyboard.searchClosedOnEscape = (await p.locator('[cmdk-input]').count()) === 0
  await p.locator('button[aria-label^="Open profile menu"]').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(300); report.keyboard.menuOpen = await p.locator('[role="menu"]').count()
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); report.keyboard.menuClosedOnEscape = (await p.locator('[role="menu"]').count()) === 0
  report.keyboard.focusRings = {}
  for (const sel of ['[data-slot="sidebar-trigger"]', 'header button[aria-keyshortcuts]', 'label.ui-switch input', 'button[aria-label="Open theme settings"]']) {
    await p.locator(sel).first().focus(); const state = await p.evaluate(s => { const c = getComputedStyle(document.querySelector(s)); return { outline: c.outlineStyle + ' ' + c.outlineWidth, boxShadow: c.boxShadow.slice(0, 80) } }, sel); report.keyboard.focusRings[sel] = state
  }
  await ctx.close()
}
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } }); const p = await ctx.newPage(); await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.locator('[data-slot="sidebar-trigger"]').first().click(); await p.waitForSelector('[data-mobile="true"]', { state: 'visible' }); await p.keyboard.press('Escape'); await p.waitForTimeout(400); report.keyboard.sheetClosedOnEscape = (await p.locator('[data-mobile="true"]').count()) === 0; await ctx.close()
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' }); const p = await ctx.newPage(); await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(400)
  report.bg.layers = await p.evaluate(() => { const b = getComputedStyle(document.body, '::before'); const s = document.querySelector('[data-slot="sidebar-inset"]'); return { pos: b.position, zIndex: b.zIndex, pointerEvents: b.pointerEvents, img: b.backgroundImage.slice(0, 60), insetPattern: getComputedStyle(s).backgroundImage, insetBg: getComputedStyle(s).backgroundColor } })
  const region = { x: 1100, y: 120, width: 200, height: 120 }; const expanded = await p.screenshot({ clip: region })
  report.bg.toggle5x = await p.evaluate(async () => { const trigger = document.querySelector('[data-slot="sidebar-trigger"]'); const frames = []; let last = performance.now(); const wait = ms => new Promise(resolve => { const end = performance.now() + ms; const tick = t => { frames.push(t - last); last = t; if (performance.now() < end) requestAnimationFrame(tick); else resolve() }; requestAnimationFrame(tick) }); for (let i=0;i<5;i++) { trigger.click(); await wait(350) }; const d=frames.slice(1); return {frames:d.length,dropped16:d.filter(x=>x>16.7).length,dropped33:d.filter(x=>x>33).length,longest:Math.max(...d).toFixed(1)} })
  const collapsed = await p.screenshot({ clip: region }); report.bg.regionIdenticalBytes = Buffer.compare(expanded, collapsed) === 0; report.bg.regionPngBytes = { expanded: expanded.length, collapsed: collapsed.length }; await ctx.close()
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  for (const media of ['print', 'forced-colors']) { if (media === 'print') await p.emulateMedia({ media: 'print' }); else await p.emulateMedia({ forcedColors: 'active' }); await p.waitForTimeout(200); report.print[media] = await p.evaluate(() => ({ pseudoDisplay: getComputedStyle(document.body, '::before').display, insetImg: getComputedStyle(document.querySelector('[data-slot="sidebar-inset"]')).backgroundImage, backdrop: getComputedStyle(document.querySelector('[data-slot="sidebar-inner"]')).backdropFilter })) }
  await ctx.close()
}
console.log(JSON.stringify(report, null, 1)); await browser.close()
