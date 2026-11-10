import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:8088'
const OUT = '.verification'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const R = { errors: [] }

const newPage = async (w, h, scheme = 'light') => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') R.errors.push(`${w}/${scheme}: ${m.text()}`) })
  page.on('pageerror', e => R.errors.push(`${w}/${scheme} pageerror: ${e.message}`))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  return { ctx, page }
}

// ---- luminance / contrast helpers (WCAG 2.x) ----
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const parseRgb = s => { const m = s?.match(/rgba?\(([^)]+)\)/); return m ? m[1].split(',').slice(0, 3).map(Number) : null }
const rgbFor = async (page, color) => {
  await page.evaluate(c => { let n = document.getElementById('__color_probe'); if (!n) { n = document.createElement('div'); n.id = '__color_probe'; n.style.cssText = 'position:fixed;left:0;top:0;width:16px;height:16px;z-index:2147483647'; document.body.appendChild(n) } n.style.backgroundColor = c }, color)
  const path = `${OUT}/color-probe.png`; await page.screenshot({ path, clip: { x: 4, y: 4, width: 4, height: 4 } })
  const png = PNG.sync.read(fs.readFileSync(path)); return [png.data[0], png.data[1], png.data[2]]
}

// ---- 1. single layer, stacking, text above pattern ----
{
  const { ctx, page } = await newPage(1440, 900, 'light')
  R.layer = await page.evaluate(() => {
    const b = getComputedStyle(document.body, '::before')
    const inset = document.querySelector('[data-slot="sidebar-inset"]')
    const root = document.getElementById('root')
    return {
      pseudo: { position: b.position, zIndex: b.zIndex, pointerEvents: b.pointerEvents, backgroundImage: b.backgroundImage.slice(0, 60), inset: '0' },
      rootZ: getComputedStyle(root).zIndex, rootPos: getComputedStyle(root).position,
      insetPattern: getComputedStyle(inset).backgroundImage,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      patternLayers: [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).backgroundImage.includes('cracked-earth')).length,
    }
  })
  // elementFromPoint over real text and controls: must return the element, not the pattern
  R.hit = await page.evaluate(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return { sel, hitInside: !!hit && (el === hit || el.contains(hit)) } }
    return [pick('[data-slot="sidebar-trigger"]'), pick('h1'), pick('header button[aria-keyshortcuts]')]
  })
  // pure background region: empty canvas gap between cards on the right, far from sidebar edge and content
  const region = { x: 1100, y: 120, width: 200, height: 40 }
  R.bgRegionPng = `${OUT}/bg-region-open.png`
  await page.screenshot({ path: R.bgRegionPng, clip: region })
  // text above pattern: screenshot a text run and check it has pure text ink
  await page.screenshot({ path: `${OUT}/text-above-pattern-1440.png`, clip: { x: 272, y: 95, width: 300, height: 40 } })
  R.openBgPng = { region, path: R.bgRegionPng }
  // collapse sidebar, screenshot same region
  await page.locator('[data-slot="sidebar-trigger"]').first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/bg-region-collapsed.png`, clip: region })
  await ctx.close()
}

// pixel diff of background region before/after collapse
{
  const a = PNG.sync.read(fs.readFileSync(`${OUT}/bg-region-open.png`))
  const b = PNG.sync.read(fs.readFileSync(`${OUT}/bg-region-collapsed.png`))
  let diff = 0, n = a.width * a.height
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
    if (d > 0) diff++
  }
  let minV = 255, maxV = 0
  for (let i = 0; i < a.data.length; i += 4) { const v = a.data[i]; if (v < minV) minV = v; if (v > maxV) maxV = v }
  R.bgPixels = { pixels: n, differingPixels: diff, fractionDiffering: +(diff / n).toFixed(4), patternLumaRangeInRegion: [minV, maxV] }
}

// ---- 2. contrast on real composited pixels ----
// sample the backdrop by hiding the nav text and reading pixels under its box
const contrastFor = async (page, scope) => {
  const rows = await page.evaluate((sc) => {
    const root = sc === 'mobile' ? document.querySelector('[data-mobile="true"]') : document.querySelector('[data-slot="sidebar-inner"]')
    const items = [...root.querySelectorAll('[data-sidebar="menu-button"]')]
    const sample = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, fg: getComputedStyle(el).color } }
    const d = items.find(x => x.getAttribute('data-active') !== 'true')
    const a = items.find(x => x.getAttribute('data-active') === 'true')
    return { def: d && sample(d), active: a && sample(a) }
  }, scope)
  return rows
}

const contrastRun = async (w, h, scheme, scope) => {
  const { ctx, page } = await newPage(w, h, scheme)
  if (scope === 'mobile') { await page.locator('[data-slot="sidebar-trigger"]').first().click(); await page.waitForSelector('[data-mobile="true"]', { state: 'visible' }); await page.waitForTimeout(500) }
  const info = await contrastFor(page, scope)
  const out = {}
  for (const k of ['def', 'active']) {
    const it = info[k]; if (!it) continue
    // hide only the text of the item to sample the composited surface under it
    const surface = `${OUT}/surf-${scope}-${scheme}-${k}.png`
    // hide only this item's text (transparent color), screenshot the composited surface under it
    await page.evaluate(({ x, y }) => {
      const el = [...document.querySelectorAll('[data-sidebar="menu-button"]')].find(e => { const r = e.getBoundingClientRect(); return Math.abs(r.left - x) < 1 && Math.abs(r.top - y) < 1 })
      if (el) { el.dataset.probeHide = '1'; el.style.setProperty('--probe', '1') }
    }, { x: it.x, y: it.y })
    await page.addStyleTag({ content: `[data-probe-hide="1"] *, [data-probe-hide="1"]{color:transparent !important}` })
    await page.waitForTimeout(80)
    await page.screenshot({ path: surface, clip: { x: it.x + 2, y: it.y + 2, width: Math.max(1, it.w - 4), height: Math.max(1, it.h - 4) } })
    await page.evaluate(() => { document.querySelectorAll('[data-probe-hide]').forEach(e => { delete e.dataset.probeHide; e.style.removeProperty('--probe') }) })
    const png = PNG.sync.read(fs.readFileSync(surface))
    // normalize the computed fg color (rgb/oklch) to rgb via a probe span
    const fgArr = await rgbFor(page, it.fg)
    let worst = Infinity
    for (let i = 0; i < png.data.length; i += 4) {
      const bg = [png.data[i], png.data[i + 1], png.data[i + 2]]
      const r = ratio(fgArr, bg); if (r < worst) worst = r
    }
    out[k] = { fg: fgArr, worstRatio: +worst.toFixed(2), pass: worst >= 4.5 }
  }
  await ctx.close()
  return out
}
R.contrast = {}
for (const scheme of ['light', 'dark']) {
  R.contrast[`desktop-${scheme}`] = await contrastRun(1440, 900, scheme, 'desktop')
  R.contrast[`mobile-${scheme}`] = await contrastRun(375, 812, scheme, 'mobile')
}

// ---- 3. keyboard focus, escape, search height ----
{
  const { ctx, page } = await newPage(1440, 900, 'light')
  R.keyboard = { focusRing: {} }
  const targets = {
    sidebarTrigger: '[data-slot="sidebar-trigger"]',
    search: 'header button[aria-keyshortcuts]',
    themeSwitch: 'label.ui-switch input',
    avatar: 'button[aria-label^="Open profile menu"]',
  }
  for (const [name, sel] of Object.entries(targets)) {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.locator(sel).first().focus()
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    R.keyboard.focusRing[name] = await page.evaluate((s) => {
      const el = document.querySelector(s); const c = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return { visible: el === document.activeElement, outline: c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor, boxShadow: c.boxShadow.slice(0, 60), w: Math.round(rect.width), h: Math.round(rect.height) }
    }, sel)
  }
  // search dialog height and escape
  await page.locator(targets.search).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
  R.keyboard.searchInputHeight = Math.round((await page.locator('[cmdk-input]').first().boundingBox()).height)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  R.keyboard.searchClosedOnEscape = (await page.locator('[cmdk-input]').count()) === 0
  // profile menu escape
  await page.locator(targets.avatar).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
  R.keyboard.menuOpened = (await page.locator('[role="menu"]').count()) > 0
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  R.keyboard.menuClosedOnEscape = (await page.locator('[role="menu"]').count()) === 0
  await ctx.close()
}
{
  const { ctx, page } = await newPage(375, 812, 'light')
  await page.locator('[data-slot="sidebar-trigger"]').first().click()
  await page.waitForSelector('[data-mobile="true"]', { state: 'visible' }); await page.waitForTimeout(500)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  R.keyboard.sheetClosedOnEscape = (await page.locator('[data-mobile="true"]').count()) === 0
  await ctx.close()
}

// ---- 4. frame timing, 5 toggles ----
{
  const { ctx, page } = await newPage(1440, 900, 'light')
  R.frames = await page.evaluate(async () => {
    const trigger = document.querySelector('[data-slot="sidebar-trigger"]')
    const deltas = []
    let last = performance.now()
    const run = (ms) => new Promise((res) => { const end = performance.now() + ms; const tick = (t) => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else res() }; requestAnimationFrame(tick) })
    for (let i = 0; i < 5; i++) { trigger.click(); await run(400) }
    const d = deltas.slice(1)
    return { frames: d.length, over16_7: d.filter(x => x > 16.7).length, over33: d.filter(x => x > 33).length, longestMs: +Math.max(...d).toFixed(1) }
  })
  await ctx.close()
}

// ---- 5. print / forced-colors ----
{
  const { ctx, page } = await newPage(1440, 900, 'light')
  R.print = {}
  for (const mode of ['print', 'forced']) {
    if (mode === 'print') await page.emulateMedia({ media: 'print' }); else await page.emulateMedia({ forcedColors: 'active' })
    await page.waitForTimeout(200)
    R.print[mode] = await page.evaluate(() => {
      const inner = document.querySelector('[data-slot="sidebar-inner"]')
      const c = getComputedStyle(inner)
      return { backdrop: c.backdropFilter, bg: c.backgroundColor, pseudoDisplay: getComputedStyle(document.body, '::before').display, insetImg: getComputedStyle(document.querySelector('[data-slot="sidebar-inset"]')).backgroundImage }
    })
  }
  await ctx.close()
}

// ---- glass screenshots ----
for (const scheme of ['light', 'dark']) {
  const { ctx, page } = await newPage(1440, 900, scheme)
  await page.screenshot({ path: `${OUT}/shell-glass-1440-${scheme}.png` })
  await ctx.close()
  const m = await newPage(375, 812, scheme)
  await m.page.locator('[data-slot="sidebar-trigger"]').first().click()
  await m.page.waitForSelector('[data-mobile="true"]', { state: 'visible' }); await m.page.waitForTimeout(500)
  await m.page.screenshot({ path: `${OUT}/shell-glass-375-${scheme}.png` })
  await m.ctx.close()
}

console.log(JSON.stringify(R, null, 1))
await browser.close()
