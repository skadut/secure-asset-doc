import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:8088'
const OUT = '.verification'
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = {}

for (const [label, w, h, scheme, scope] of [
  ['desktop-light', 1440, 900, 'light', 'desktop'],
  ['desktop-dark', 1440, 900, 'dark', 'desktop'],
  ['mobile-light', 375, 812, 'light', 'mobile'],
  ['mobile-dark', 375, 812, 'dark', 'mobile'],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  if (scope === 'mobile') {
    await page.locator('[data-slot="sidebar-trigger"]').first().click()
    await page.waitForSelector('[data-mobile="true"]', { state: 'visible' })
    await page.waitForTimeout(500)
  } else {
    await page.waitForTimeout(300)
  }

  // read-only: visible label nodes, computed fg from the actual text node's element, plus its box
  const items = await page.evaluate((sc) => {
    const root = sc === 'mobile' ? document.querySelector('[data-mobile="true"]') : document.querySelector('[data-slot="sidebar-inner"]')
    const buttons = [...root.querySelectorAll('[data-sidebar="menu-button"]')].filter(b => b.offsetParent !== null)
    const pick = (b) => {
      const label = [...b.querySelectorAll('span,div')].find(n => n.childNodes.length && [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) || b
      const cs = getComputedStyle(label)
      const r = label.getBoundingClientRect()
      return { text: label.textContent.trim().slice(0, 30), fg: cs.color, x: r.left, y: r.top, w: r.width, h: r.height, active: b.getAttribute('data-active') }
    }
    const def = buttons.find(b => b.getAttribute('data-active') !== 'true')
    const act = buttons.find(b => b.getAttribute('data-active') === 'true')
    return { def: def && pick(def), active: act && pick(act) }
  }, scope)

  const out = {}
  for (const k of ['def', 'active']) {
    const it = items[k]
    if (!it) { out[k] = null; continue }
    // hide only the label text for sampling, sample the composited surface under its box
    await page.evaluate(({ x, y }) => {
      const cand = [...document.querySelectorAll('[data-sidebar="menu-button"] span, [data-sidebar="menu-button"] div')].find(n => { const r = n.getBoundingClientRect(); return Math.abs(r.left - x) < 1.5 && Math.abs(r.top - y) < 1.5 })
      if (cand) { cand.dataset.probeHide = '1' }
    }, { x: it.x, y: it.y })
    await page.addStyleTag({ content: '[data-probe-hide="1"]{color:transparent !important}' })
    await page.waitForTimeout(80)
    const path = `${OUT}/contrast-${label}-${k}.png`
    await page.screenshot({ path, clip: { x: it.x, y: it.y, width: Math.max(1, it.w), height: Math.max(1, it.h) } })
    await page.evaluate(() => document.querySelectorAll('[data-probe-hide]').forEach(e => delete e.dataset.probeHide))
    // resolve fg to rgb by painting it into a probe square on the same page
    const fgRgb = await page.evaluate((c) => {
      let n = document.getElementById('__cp'); if (!n) { n = document.createElement('div'); n.id = '__cp'; n.style.cssText = 'position:fixed;left:0;top:0;width:4px;height:4px;z-index:2147483647'; document.body.appendChild(n) }
      n.style.backgroundColor = c; return getComputedStyle(n).backgroundColor
    }, it.fg)
    const pickPx = (c) => { const m = c.match(/[\d.]+/g).map(Number); return m.slice(0, 3) }
    const fg = await page.evaluate((color) => { const d = document.createElement('div'); d.style.cssText = `position:fixed;left:0;top:0;width:2px;height:2px;background:${color};z-index:2147483647`; document.body.appendChild(d); const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); const result = getComputedStyle(d).color; d.remove(); return result }, it.fg).then(pickPx)
    const png = PNG.sync.read(fs.readFileSync(path))
    let worst = Infinity
    for (let i = 0; i < png.data.length; i += 4) {
      const r = ratio(fg, [png.data[i], png.data[i + 1], png.data[i + 2]])
      if (r < worst) worst = r
    }
    out[k] = { text: it.text, fgComputed: it.fg, fgRgb: fg, worstRatio: +worst.toFixed(2), pass: worst >= 4.5, png: path }
  }
  results[label] = out
  await ctx.close()
}
console.log(JSON.stringify(results, null, 1))
await browser.close()
