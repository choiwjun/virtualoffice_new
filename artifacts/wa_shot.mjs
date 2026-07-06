import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors','--use-gl=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--window-size=1280,800']});
const p=await b.newPage();await p.setViewport({width:1280,height:800});
const EXACT=["Continue","Save","Let's go","Let’s go","Jump in","Play","OK","Finish"];const EXCL=["Build your WOKA","Back to default WOKA","Randomize","Select Randomly"];
const cta=async()=>await p.evaluate((e,x)=>{const els=[...document.querySelectorAll('button,a,[role=button]')].filter(n=>n.offsetParent!==null);for(const n of els){const t=(n.textContent||'').trim();if(x.includes(t))continue;if(e.includes(t)){n.click();return t;}}return null;},EXACT,EXCL);
await p.goto('http://localhost:8090/',{waitUntil:'networkidle2',timeout:45000});await new Promise(r=>setTimeout(r,3000));
if(await p.$('input[name="email"]')){await p.type('input[name="email"]','alice@virtualoffice.local');await p.type('input[name="password"]','password123');await Promise.all([p.waitForNavigation({waitUntil:'networkidle2',timeout:45000}).catch(()=>{}),p.click('button')]);}
await new Promise(r=>setTimeout(r,4000));const nm=await p.$('input[type="text"]');if(nm)await nm.type('Alice');
for(let i=0;i<6;i++){await cta();await new Promise(r=>setTimeout(r,2600));}
await new Promise(r=>setTimeout(r,6000));await p.screenshot({path:'/out/g001v2-ingame.png'});await b.close();
