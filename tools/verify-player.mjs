import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const puppeteer=require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const chromePath=process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(repo, 'ui');
const pcm=Buffer.alloc(44100*2*5); const wav=Buffer.alloc(44+pcm.length); wav.write('RIFF',0);wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(44100*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44); const wavUrl='data:audio/wav;base64,'+wav.toString('base64');
const tracks = Array.from({length: 40}, (_, i) => ({name:`Fixture Track ${String(i+1).padStart(2,'0')} — Long Title Demo`, url:wavUrl, lrcUrl:`fixture-lrc-${i+1}`, mode:'Local', dur:215, group:'Fixture', pic:i===0?'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"%3E%3Crect width="400" height="400" fill="%23537d96"/%3E%3Ccircle cx="200" cy="200" r="130" fill="%23c99aaf"/%3E%3C/svg%3E':''}));
const server = http.createServer((req,res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname==='/favicon.ico') {res.statusCode=204;res.end();return;}
  if (u.pathname.includes('/widget/api/lrc/load')) { const name=u.searchParams.get('name')||'';const trackNo=(/Fixture Track (\d+)/.exec(name)||[])[1]||'01';const delay=trackNo==='01'?1100:20;setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,lrc:Array.from({length:100},(_,i)=>`[00:00.${String(i).padStart(2,'0')}]Track ${trackNo} lyric line ${i+1}`).join('\n')}));},delay);return; }
  if (u.pathname.includes('/widget/api/playlist')) { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ok:true,tracks})); return; }
  if (u.pathname.includes('/widget/api')) { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ok:true,tracks:[],results:[],playlist:[]})); return; }
  if (u.pathname.includes('/api/apps/hanako-audio-player/ui/_build.json')) {res.setHeader('content-type','application/json');res.end(JSON.stringify({build:'1003131538'}));return;}
  if (u.pathname.startsWith('/api/apps/hanako-audio-player/')) {res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));return;}
  const f = path.join(ui, decodeURIComponent(u.pathname === '/' ? 'index.html' : u.pathname));
  if (!f.startsWith(ui) || !fs.existsSync(f)) { res.statusCode=404; res.end('not found'); return; }
  res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html');
  fs.createReadStream(f).pipe(res);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const baseURL=`http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({executablePath:chromePath,headless:true,args:['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage();
const errors=[];
page.on('pageerror', e => errors.push(String(e)));
page.on('requestfailed',r=>errors.push('request '+r.url()+' '+r.failure()?.errorText));
page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url())});
page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
await page.evaluateOnNewDocument(() => {
  const light = { '--bg':'#F8F4ED','--bg-card':'#FFFDF7','--surface':'#F2EDE3','--text':'#2A2622','--text-muted':'#6B6158','--text-light':'#6B6158','--accent':'#537D96','--border':'#D8CFBE' };
  const dark = { '--bg':'#34424B','--bg-card':'#414D56','--surface':'#414D56','--text':'#E1EAF0','--text-muted':'#9FB1BC','--text-light':'#9FB1BC','--accent':'#C99AAF','--border':'#596670' };
  window.__fixtureTheme = (mode='light') => { const vars=mode==='dark'?dark:light; Object.entries(vars).forEach(([k,v])=>document.documentElement.style.setProperty(k,v)); };
});
const shots = [
  ['long-card-light',465,930,'light',false], ['tall-card-light',585,1172,'light',false],
  ['wide-window-light',1040,780,'light',true], ['wide-window-dark',1040,780,'dark',true],
  ['short-card',531,451,'light',false], ['large-type-no-lyrics',560,616,'light',false]
];
const report={shots:[],dynamic:{},runtimeErrors:errors};
for (const [name,width,height,theme,detached] of shots) {
  await page.setViewport({width,height,deviceScaleFactor:1});
  await page.goto(`${baseURL}/${detached?'standalone.html':'index.html'}`,{waitUntil:'domcontentloaded'});
  await page.evaluate(t=>window.__fixtureTheme(t),theme);
  await new Promise(r=>setTimeout(r,300));
  await page.evaluate(()=>{localStorage.removeItem('hana_audio_play_lock');const x=document.querySelector('.pl-item[data-i="0"]');if(x)x.click();});
  await page.evaluate(name=>{if(name==='short-card'){const q=document.getElementById('queuePageToggle');if(q)q.click();}else if(name==='large-type-no-lyrics'){document.body.style.fontSize='22px';const b=document.querySelector('.mode-caps .mc[data-m="0"]');if(b)b.click();}else if(name.startsWith('wide-window')){const q=document.getElementById('drawerToggle');if(q)q.click();}else{const b=document.querySelector('.mode-caps .mc[data-m="1"]');if(b)b.click();}},name);
  await new Promise(r=>setTimeout(r,1400));
  await page.screenshot({path:path.join(repo,'docs/design-proposals/implementation-screenshots',`${name}.png`)});
  report.shots.push({name,width,height,theme,mode:detached?'detached fixture route':'card fixture route',bodyClass:await page.$eval('body',e=>e.className),root:await page.$eval('.player-container',e=>({w:e.clientWidth,h:e.clientHeight,classes:e.className})),headerVisible:await page.$eval('.header',e=>e.getBoundingClientRect().height>0)});
}
await page.setViewport({width:465,height:930});
await page.goto(`${baseURL}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,400));
report.dynamic=await page.evaluate(async(wavUrl)=>{
  const root=document.querySelector('.player-container');
  const queue=document.querySelector('.pl-body');
  const lyrics=document.querySelector('.lyric-body');
  const originalTop=queue.scrollTop;
  localStorage.removeItem('hana_audio_play_lock');const x=document.querySelector('.pl-item[data-i="0"]');if(x)x.click();
  const mc=document.querySelector('.mode-caps .mc[data-m="1"]');if(mc)mc.click();
  await new Promise(r=>setTimeout(r,1100));
  const audio=document.getElementById('audio'); if(audio){try{audio.play().catch(()=>{});}catch(e){}}
  const start=queue.scrollTop;
  queue.scrollTop=queue.scrollHeight;
  const bottom=queue.scrollTop;
  let lyricTicks=0; const lyricsObserver=new MutationObserver(()=>lyricTicks++); lyricsObserver.observe(lyrics,{subtree:true,attributes:true,attributeFilter:['class']});
  for(let i=0;i<80;i++){if(audio){try{audio.currentTime=(i%100)*0.01;audio.dispatchEvent(new Event('timeupdate'));}catch(e){}}queue.scrollTop=Math.max(0,bottom-(79-i)*2);await new Promise(r=>setTimeout(r,3));}
  lyricsObserver.disconnect();
  return {audioPaused:audio&&audio.paused,audioDuration:audio&&audio.duration,audioTime:audio&&audio.currentTime,lyricLineCount:lyrics.querySelectorAll('.lyric-line').length,activeLyrics:lyrics.querySelectorAll('.lyric-line.current').length,tracks:document.querySelectorAll('.pl-item').length,queueStart:start,queueBottom:bottom,queueAtBottom:queue.scrollTop>=bottom-2,lyricTicks,lyricOwnScroll:lyrics.scrollHeight>=lyrics.clientHeight,queueScrollTop:queue.scrollTop,rootClasses:root.className,controlPresent:!!document.querySelector('.controls-section')};
},wavUrl);
const shortPage=await browser.newPage();
await shortPage.setViewport({width:531,height:451,deviceScaleFactor:1});
await shortPage.goto(`${baseURL}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,400));
report.shortCard=await shortPage.evaluate(async()=>{
  localStorage.removeItem('hana_audio_play_lock');
  const item=document.querySelector('.pl-item[data-i="0"]');if(item)item.click();
  const audio=document.getElementById('audio');if(audio){try{audio.play().catch(()=>{});}catch(e){}}
  const queueButton=document.getElementById('queuePageToggle');if(queueButton)queueButton.click();
  const before=audio&&audio.currentTime;
  for(let i=0;i<20;i++){
    if(queueButton)queueButton.click();
    const search=document.querySelector('.nav-tab[data-tab="search"]');if(search)search.click();
    const list=document.querySelector('.nav-tab[data-tab="playlist"]');if(list)list.click();
    if(queueButton)queueButton.click();
    await new Promise(r=>setTimeout(r,30));
  }
  return {height:document.querySelector('.player-container').clientHeight,tracks:document.querySelectorAll('.pl-item').length,cycles:20,queuePageOpen:document.querySelector('.player-container').classList.contains('queue-page-open'),audioPaused:audio&&audio.paused,audioTimeBefore:before,audioTimeAfter:audio&&audio.currentTime,audioContinues:!!(audio&&!audio.paused&&audio.currentTime>before),controlsPresent:!!document.querySelector('.controls-section')};
});
await shortPage.close();
const racePage=await browser.newPage();
await racePage.setViewport({width:465,height:930,deviceScaleFactor:1});
await racePage.goto(`${baseURL}/index.html`,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,400));
report.lyricRace=await racePage.evaluate(async()=>{
  localStorage.removeItem('hana_audio_play_lock');
  const first=document.querySelector('.pl-item[data-i="0"]');if(first)first.click();
  await new Promise(r=>setTimeout(r,850));
  const second=document.querySelector('.pl-item[data-i="1"]');if(second)second.click();
  await new Promise(r=>setTimeout(r,1400));
  const text=document.querySelector('.lyric-body').innerText;
  return {currentTrack:document.getElementById('trackName').textContent,lyricsShowNewTrack:text.includes('Track 02 lyric'),lyricsShowStaleTrack:text.includes('Track 01 lyric')};
});
await racePage.close();
report.runtimeErrors=errors;
fs.writeFileSync(path.join(repo,'docs/design-proposals/implementation-screenshots/verification.json'),JSON.stringify(report,null,2));
await page.close(); await browser.close(); server.closeAllConnections(); server.close();
console.log(JSON.stringify(report,null,2)); process.exit(0);
