import puppeteer from 'puppeteer';import fs from 'fs';
const log=[];const L=(...a)=>{const s=a.join(' ');log.push(s);console.log(s);};
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors','--use-gl=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--window-size=1280,800']});
const p=await b.newPage();await p.setViewport({width:1280,height:800});
p.on('console',m=>{const t=m.text();if(/presence|zone|working|meeting|focus|connect/i.test(t))L('CONSOLE:',t.slice(0,150));});
p.on('requestfinished',r=>{const u=r.url();if(/presence\.js|\/api\/wa\/presence/.test(u))L('NET:',r.request().method(),u.split('/').slice(-2).join('/'),'->',r.response()?.status());});
// exact-CTA click, excluding WOKA builder toggles
const EXACT=["Continue","Save","Let's go","Let’s go","Jump in","Play","OK","Finish","시작","계속","저장","입장","확인"];
const EXCL=["Build your WOKA","Back to default WOKA","Randomize","Select Randomly","Edit"];
const clickCTA=async()=>{return await p.evaluate((exact,excl)=>{const els=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>e.offsetParent!==null);for(const e of els){const t=(e.textContent||'').trim();if(excl.includes(t))continue;if(exact.includes(t)){e.click();return t;}}return null;},EXACT,EXCL);};
try{
  await p.goto('http://localhost:8090/',{waitUntil:'networkidle2',timeout:45000});
  await new Promise(r=>setTimeout(r,3000));
  if(await p.$('input[name="email"]')){await p.type('input[name="email"]','alice@virtualoffice.local');await p.type('input[name="password"]','password123');await Promise.all([p.waitForNavigation({waitUntil:'networkidle2',timeout:45000}).catch(()=>{}),p.click('button')]);L('logged in');}
  await new Promise(r=>setTimeout(r,4000));
  const nm=await p.$('input[type="text"]'); if(nm){await nm.type('Alice');}
  for(let i=0;i<14;i++){const c=await clickCTA();L('onboard',i,'cta=',c);await new Promise(r=>setTimeout(r,2600));}
  await new Promise(r=>setTimeout(r,8000));
  await p.screenshot({path:'/out/zone-00-ingame.png'});
  L('in-game url:',p.url());
  await p.bringToFront();await new Promise(r=>setTimeout(r,3000));
  const dirs=['ArrowDown','ArrowDown','ArrowDown','ArrowRight','ArrowRight','ArrowDown','ArrowLeft','ArrowDown','ArrowLeft','ArrowDown'];
  for(const k of dirs){await p.keyboard.down(k);await new Promise(r=>setTimeout(r,1100));await p.keyboard.up(k);await new Promise(r=>setTimeout(r,300));}
  await new Promise(r=>setTimeout(r,3000));await p.screenshot({path:'/out/zone-01-moved.png'});L('RESULT_OK');
}catch(e){L('ERROR:',e.message);await p.screenshot({path:'/out/zone-99-error.png'}).catch(()=>{});}
fs.writeFileSync('/out/zone-transcript.txt',log.join('\n'));await b.close();
