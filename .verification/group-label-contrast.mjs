import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import fs from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r,g,b]) => .2126*lin(r)+.7152*lin(g)+.0722*lin(b)
const contrast = (a,b) => { const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
const result={}
for (const [name, scheme, width, mobile] of [['desktop-light','light',1440,false],['desktop-dark','dark',1440,false],['sheet-light','light',375,true],['sheet-dark','dark',375,true]]) {
 const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:scheme}); const page=await ctx.newPage()
 await page.goto('http://127.0.0.1:8088/',{waitUntil:'networkidle'})
 if(mobile){await page.locator('[data-slot="sidebar-trigger"]').click();await page.waitForSelector('[data-mobile="true"]',{state:'visible'});await page.waitForTimeout(500)}
 const root=mobile?'[data-mobile="true"]':'[data-slot="sidebar-inner"]'
 const label=page.locator(`${root} [data-sidebar="group-label"]`).filter({hasText:'Inventory'}).first()
 const info=await label.evaluate(el=>{const r=el.getBoundingClientRect();const c=getComputedStyle(el);return {text:el.innerText.trim(),color:c.color,opacity:c.opacity,rect:{x:r.x,y:r.y,w:r.width,h:r.height}}})
 await label.evaluate(el=>el.dataset.hideText='1')
 await page.addStyleTag({content:'[data-hide-text="1"]{color:transparent!important}'})
 await page.waitForTimeout(80)
 const path=`.verification/group-label-surface-${name}.png`
 await page.screenshot({path,clip:{x:info.rect.x,y:info.rect.y,width:info.rect.w,height:info.rect.h}})
 await label.evaluate(el=>delete el.dataset.hideText)
 const png=PNG.sync.read(fs.readFileSync(path))
 const fgRgba=await page.evaluate(color=>{const c=document.createElement('canvas').getContext('2d');c.clearRect(0,0,1,1);c.fillStyle=color;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data]},info.color)
 const a=fgRgba[3]/255, fg=fgRgba.slice(0,3)
 let worst=Infinity, worstBg, compositeFg
 for(let i=0;i<png.data.length;i+=4){const bg=[png.data[i],png.data[i+1],png.data[i+2]];const comp=fg.map((v,j)=>Math.round(v*a+bg[j]*(1-a)));const r=contrast(comp,bg);if(r<worst){worst=r;worstBg=bg;compositeFg=comp}}
 result[name]={text:info.text,computed:info.color,cssOpacity:Number(info.opacity),fgRGB:fg,alpha:+a.toFixed(3),worstBgRGB:worstBg,compositedFgRGB:compositeFg,ratio:+worst.toFixed(2),passAA:worst>=4.5,screenshot:path}
 await ctx.close()
}
console.log(JSON.stringify(result,null,1));await browser.close()
