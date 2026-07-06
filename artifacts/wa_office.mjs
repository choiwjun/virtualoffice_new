import puppeteer from 'puppeteer';import fs from 'fs';
const log=[];const L=(...a)=>{const s=a.join(' ');log.push(s);console.log(s);};
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors','--use-gl=swiftshader','--enable-webgl','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--window-size=1280,800']});
const p=await b.newPage();await p.setViewport({width:1280,height:800});
const click=async(re)=>{const h=await p.evaluateHandle((r)=>{const els=[...document.querySelectorAll('button,a,[role=button]')];return els.find(e=>new RegExp(r,'i').test((e.textContent||'').trim()))||null;},re);const el=h.asElement();if(el){try{await el.click();return true;}catch(e){}}return false;};
try{
  await p.goto('http://localhost:8090/',{waitUntil:'networkidle2',timeout:45000});
  await new Promise(r=>setTimeout(r,3000));
  if(await p.$('input[name="email"]')){await p.type('input[name="email"]','alice@virtualoffice.local');await p.type('input[name="password"]','password123');await Promise.all([p.waitForNavigation({waitUntil:'networkidle2',timeout:45000}).catch(()=>{}),p.click('button')]);}
  await new Promise(r=>setTimeout(r,4000));
  // name
  const nm=await p.$('input[type="text"]'); if(nm){await nm.type('Alice');L('name typed');}
  await click('continue|다음|계속'); await new Promise(r=>setTimeout(r,2500));
  // woka finish
  await click('finish|완료|다음|continue'); L('finish clicked'); await new Promise(r=>setTimeout(r,3000));
  // camera/mic setup screens -> let's go / jump in
  for(let i=0;i<5;i++){const c=await click("let'?s go|jump|입장|시작|continue|계속|ok|확인|start"); L('post',i,'clicked=',c); await new Promise(r=>setTimeout(r,2500));}
  await new Promise(r=>setTimeout(r,6000));
  await p.screenshot({path:'/out/office-game.png'});
  // crop to game canvas center (non-uniform tilemap)
  L('FINAL url:',p.url());L('RESULT_OK');
}catch(e){L('ERROR:',e.message);await p.screenshot({path:'/out/office-game.png'}).catch(()=>{});}
fs.writeFileSync('/out/transcript-office.txt',log.join('\n'));await b.close();
