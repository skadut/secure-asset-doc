import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:8088/', { waitUntil: 'networkidle' }); await p.waitForTimeout(400)
const info = await p.evaluate(() => ({
  bodyBg: getComputedStyle(document.body).backgroundColor,
  htmlBg: getComputedStyle(document.documentElement).backgroundColor,
  pageGround: getComputedStyle(document.documentElement).getPropertyValue('--page-ground'),
  pagePattern: getComputedStyle(document.documentElement).getPropertyValue('--page-pattern'),
  pseudoZ: getComputedStyle(document.body, '::before').zIndex,
  pseudoBgImg: getComputedStyle(document.body, '::before').backgroundImage.slice(0, 70),
  pseudoBgColor: getComputedStyle(document.body, '::before').backgroundColor,
  bodyPosition: getComputedStyle(document.body).position,
  bodyZ: getComputedStyle(document.body).zIndex,
  rootHasBg: getComputedStyle(document.querySelector('#root') ?? document.body).backgroundColor,
}))
console.log(JSON.stringify(info, null, 1))
const clip = { x: 260, y: 560, width: 1160, height: 130 } // gap area below cards, dark
const withLayer = await p.screenshot({ clip })
await p.addStyleTag({ content: 'body::before{display:none !important}' })
await p.waitForTimeout(150)
const withoutLayer = await p.screenshot({ clip })
const stats = await p.evaluate(async ({ a, b }) => {
  const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u })
  const toPix = async (u) => { const i = await load(u); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height).data }
  return null
}, { a: 0, b: 0 })
// pixel variance via Node-side PNG decoding is unavailable; use sharp-free approach: compare raw buffers
console.log('buffers differ:', Buffer.compare(withLayer, withoutLayer) !== 0, 'bytes', withLayer.length, withoutLayer.length)
await p.screenshot({ path: '.verification/dark-gap-with-layer.png', clip })
await browser.close()
