import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TL = JSON.parse(fs.readFileSync('timeline.json','utf8'));
const times = process.argv.slice(2).map(Number);
fs.mkdirSync('preview',{recursive:true});
const b = await puppeteer.launch({executablePath:CHROME, headless:true, userDataDir:path.resolve('./.chrome-profile'),
  args:['--no-sandbox','--disable-gpu','--hide-scrollbars','--force-color-profile=srgb','--font-render-hinting=none']});
const p = await b.newPage();
await p.setViewport({width:TL.width,height:TL.height,deviceScaleFactor:1});
await p.goto('file://'+path.resolve('index.html'),{waitUntil:'load'});
await p.waitForFunction('window.__ready===true');
for (const t of times){
  await p.evaluate(x=>window.seek(x*1000), t);
  await p.screenshot({path:`preview/t${String(t).replace('.','_')}.png`});
}
await b.close(); console.log('ok', times.join(', '));
