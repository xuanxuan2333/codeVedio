import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';

const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FF=process.env.FFMPEG;
const out=path.resolve(process.argv[2] || 'samples/html.mp4');
const FPS=30, DUR=5, frames=FPS*DUR;
const profile=path.resolve(`./.chrome-${process.pid}`);

const b=await puppeteer.launch({executablePath:CHROME, headless:true, userDataDir:profile,
  args:['--no-sandbox','--disable-gpu','--hide-scrollbars','--force-color-profile=srgb']});
const p=await b.newPage();
await p.setViewport({width:1280,height:720,deviceScaleFactor:1});
await p.goto('file://'+path.resolve('sample/index.html'),{waitUntil:'load'});
await p.waitForFunction('window.__ready===true');

const ff=spawn(FF,['-y','-loglevel','error','-f','image2pipe','-c:v','mjpeg','-framerate',String(FPS),'-i','-',
  '-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',out],
  {stdio:['pipe','inherit','inherit']});
const write=buf=>new Promise((res,rej)=>ff.stdin.write(buf,e=>e?rej(e):res()));
for(let i=0;i<frames;i++){
  await p.evaluate(t=>window.seek(t), i*1000/FPS);
  await write(await p.screenshot({type:'jpeg',quality:95}));
}
ff.stdin.end(); await once(ff,'close'); await b.close();
fs.rmSync(profile,{recursive:true,force:true});
console.log('ok',out);
