import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage()
await p.goto('http://127.0.0.1:8088/', { waitUntil: 'networkidle' })
await p.waitForTimeout(300)
const chain = await p.evaluate(() => {
  const out = []
  let el = document.querySelector('[data-slot="sidebar-inset"]')
  while (el && el !== document.documentElement) {
    const c = getComputedStyle(el)
    out.push({ tag: el.tagName, slot: el.dataset.slot || el.id || '', bg: c.backgroundColor, bgImg: c.backgroundImage.slice(0, 40), z: c.zIndex, pos: c.position, isolation: c.isolation, opacity: c.opacity })
    el = el.parentElement
  }
  return out
})
console.log(JSON.stringify(chain, null, 1))
const r = await fetch('http://127.0.0.1:8088/patterns/cracked-earth-dark.svg')
console.log('svg http', r.status, r.headers.get('content-type'))
await b.close()
