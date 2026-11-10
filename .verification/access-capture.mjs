import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { chromium } = require('playwright')
const { PNG } = require('pngjs')

globalThis.require = require
const BASE = 'http://127.0.0.1:8088'
const OUT = path.resolve('.verification')
const password = process.env.DEMO_USER_PASSWORD
if (!password) throw new Error('DEMO_USER_PASSWORD is missing')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []

async function capture(username, route, filename, { dark = false, grants = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' })
  const page = await context.newPage()
  const login = await context.request.post(`${BASE}/api/login`, {
    headers: { Origin: BASE },
    data: { username, password },
  })
  if (!login.ok()) throw new Error(`Login failed for ${username}: HTTP ${login.status()}`)
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  if (await page.getByText('Unable to load data', { exact: false }).count()) throw new Error(`Unable to load data for ${username} at ${route}`)
  await page.waitForFunction(() => document.body.innerText.trim().length > 100)
  if (grants) {
    const panel = page.getByText('Access grants', { exact: true })
    await panel.waitFor({ state: 'visible', timeout: 10000 })
    await panel.scrollIntoViewIfNeeded()
    await page.waitForTimeout(250)
  } else if (route === '/documents' && !await page.locator('table tbody tr').count()) {
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 0, { timeout: 10000 })
  }
  if (dark) {
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      localStorage.setItem('vite-ui-theme', 'dark')
    })
    await page.waitForTimeout(400)
  }
  const dest = path.join(OUT, filename)
  await page.screenshot({ path: dest, fullPage: false })
  const bytes = fs.statSync(dest).size
  const png = PNG.sync.read(fs.readFileSync(dest))
  let spread = 0
  for (let i = 0; i < png.data.length; i += 4) spread += png.data[i] + png.data[i + 1] + png.data[i + 2]
  if (bytes <= 20 * 1024 || spread === 0) throw new Error(`Screenshot validation failed: ${filename}`)
  const visibleText = await page.locator('body').innerText()
  if (visibleText.includes('Unable to load data')) throw new Error(`Error screen captured: ${filename}`)
  results.push({ filename, bytes, username, route, theme: dark ? 'dark' : 'light' })
  await context.close()
}

try {
  await capture('ahmad.zaelani', '/documents', 'access-list-prajurit-dua.png')
  await capture('hendra.wiratama', '/documents', 'access-list-jenderal-tni.png')
  await capture('bagus.hartanto', '/documents/DOC-0017', 'access-detail-doc0017-prajurit-satu.png')
  await capture('hendra.wiratama', '/documents/DOC-0017', 'access-grants-panel-jenderal-tni.png', { grants: true })
  await capture('hendra.wiratama', '/documents', 'access-list-jenderal-tni-dark.png', { dark: true })
  process.stdout.write(JSON.stringify(results, null, 2) + '\n')
} finally {
  await browser.close()
}
