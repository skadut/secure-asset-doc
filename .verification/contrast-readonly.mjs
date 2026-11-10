import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import fs from 'node:fs'
const OUT = '.verification'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const lin = c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }
const lum = rgb => .2126 * lin(rgb[0]) + .7152 * lin(rgb[1]) + .0722 * lin(rgb[2])
const contrast = (a,b) => { const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
const parseRgb = s => { const m=s.match(/[\d.]+/g).map(Number); return m.slice(0,3) }
const out={}
for (const [scheme, mode, width] of [['light','desktop',1440],['dark','desktop',1440],['light','mobile',375],['dark','mobile',375]]) {
 const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:scheme}); const p=await ctx.newPage()
 await p.goto('http://127.0.0.1:8088/',{waitUntil:'networkidle'})
 if(mode==='mobile'){await p.locator('[data-slot="sidebar-trigger"]').click();await p.waitForSelector('[data-mobile="true"]',{state:'visible'});await p.waitForTimeout(450)}
 const scopes=mode==='mobile'?'[data-mobile="true"]':'[data-slot="sidebar-inner"]'
 const reports={}
 for(const text of ['Assets','Documents']){
  const btn=p.locator(`${scopes} [data-sidebar="menu-button"]`).filter({hasText:text}).first()
  await btn.waitFor({state:'visible'})
  // The actual nav button inherits the foreground token. Save a screenshot with only its text transparent to sample surface pixels.
  const states=['default','hover','active']
  for(const state of states){
   if(state==='hover') await btn.hover()
   if(state==='active') await btn.evaluate(el=>el.setAttribute('data-active','true'))
   const dims=await btn.evaluate(el=>{const r=el.getBoundingClientRect();const label=[...el.querySelectorAll('span')].find(n=>n.textContent.trim()===el.textContent.trim())||el; const lr=label.getBoundingClientRect();return {btn:{x:r.x,y:r.y,w:r.width,h:r.height},label:{x:lr.x,y:lr.y,w:lr.width,h:lr.height},fg:getComputedStyle(label).color,buttonFg:getComputedStyle(el).color, text:el.innerText}})
   const surfacePath=`${OUT}/contrast-surface-${mode}-${scheme}-${text}-${state}.png`
   await btn.evaluate(el=>{el.dataset.contrastProbe='1'})
   await p.addStyleTag({content:'[data-contrast-probe="1"]{color:transparent!important}[data-contrast-probe="1"] *{color:transparent!important}'})
   await p.screenshot({path:surfacePath,clip:{x:dims.label.x,y:dims.label.y,width:Math.max(1,dims.label.w),height:Math.max(1,dims.label.h)}})
   await btn.evaluate(el=>delete el.dataset.contrastProbe)
   const rgba=await p.evaluate(color=>{const c=document.createElement('canvas').getContext('2d');c.fillStyle=color;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data]},dims.fg)
   const fg=rgba.slice(0,3)
   const png=PNG.sync.read(fs.readFileSync(surfacePath));let min=Infinity,max=0;let bgMin=null,bgMax=null
   for(let i=0;i<png.data.length;i+=4){const bg=[png.data[i],png.data[i+1],png.data[i+2]];const r=contrast(fg,bg);if(r<min){min=r;bgMin=bg}if(r>max){max=r;bgMax=bg}}
   reports[`${text}-${state}`]={computedFg:dims.fg,fgRgb:fg,rawSurfacePixelMin:bgMin,rawSurfacePixelMax:bgMax,worstContrast:+min.toFixed(2),pass:min>=4.5,surfaceScreenshot:surfacePath}
   if(state==='active') await btn.evaluate(el=>el.removeAttribute('data-active'))
   if(state==='hover') await p.mouse.move(1,1)
  }
 }
 out[`${mode}-${scheme}`]=reports
 await ctx.close()
}
console.log(JSON.stringify(out,null,1))
await browser.close()
