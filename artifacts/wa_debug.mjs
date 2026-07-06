import puppeteer from 'puppeteer';import fs from 'fs';
const log=[];const L=(...a)=>{const s=a.join(' ');log.push(s);};
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors','--use-gl=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--window-size=1280,800']});
const p=await b.newPage();await p.setViewport({width:1280,height:800});
p.on('console',m=>L('C['+m.type()+']:',m.text().slice(0,200)));
p.on('pageerror',e=>L('PAGEERR:',String(e).slice(0,240)));
p.on('requestfailed',r=>{const u=r.url();if(/presence|api\/wa/.test(u))L('REQFAIL:',u.slice(0,80),r.failure()?.errorText);});
p.on('requestfinished',async r=>{const u=r.url();if(/presence\.js|api\/wa\/presence/.test(u)){let st='';try{st=(await r.response())?.status();}catch(e){}L('NET:',r.method(),u.slice(0,90),'->',st);}});
const EXACT=["Continue","Save","Let's go","Let’s go","Jump in","Play","OK","Finish"];const EXCL=["Build your WOKA","Back to default WOKA","Randomize","Select Randomly"];
const clickCTA=async()=>await p.evaluate((e,x)=>{const els=[...document.querySelectorAll('button,a,[role=button]')].filter(n=>n.offsetParent!==null);for(const n of els){const t=(n.textContent||'').trim();if(x.includes(t))continue;if(e.includes(t)){n.click();return t;}}return null;},EXACT,EXCL);
try{
  await p.goto('http://localhost:8090/',{waitUntil:'networkidle2',timeout:45000});await new Promise(r=>setTimeout(r,3000));
  if(await p.$('input[name="email"]')){await p.type('input[name="email"]','alice@virtualoffice.local');await p.type('input[name="password"]','password123');await Promise.all([p.waitForNavigation({waitUntil:'networkidle2',timeout:45000}).catch(()=>{}),p.click('button')]);}
  await new Promise(r=>setTimeout(r,4000));const nm=await p.$('input[type="text"]');if(nm)await nm.type('Alice');
  for(let i=0;i<8;i++){await clickCTA();await new Promise(r=>setTimeout(r,2600));}
  // wait long for presence.js WA.onInit -> connect POST
  await new Promise(r=>setTimeout(r,15000));
  L('final url:',p.url());
}catch(e){L('ERR:',e.message);}
fs.writeFileSync('/out/zone-debug.txt',log.join('\n'));await b.close();
