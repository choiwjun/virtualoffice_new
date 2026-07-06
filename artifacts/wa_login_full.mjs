import puppeteer from 'puppeteer';
import fs from 'fs';
const log=[];const L=(...a)=>{const s=a.join(' ');log.push(s);console.log(s);};
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors','--use-gl=swiftshader','--enable-webgl','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--window-size=1280,800']});
const p=await b.newPage();await p.setViewport({width:1280,height:800});
const clickByText=async(re)=>{const h=await p.evaluateHandle((r)=>{const els=[...document.querySelectorAll('button,a,[role=button]')];return els.find(e=>new RegExp(r,'i').test(e.textContent||''))||null;},re.source||re);const el=h.asElement();if(el){await el.click();return true;}return false;};
try{
  await p.goto('http://localhost:8090/',{waitUntil:'networkidle2',timeout:45000});
  await new Promise(r=>setTimeout(r,3000));
  if(await p.$('input[name="email"]')){
    await p.type('input[name="email"]','alice@virtualoffice.local');
    await p.type('input[name="password"]','password123');
    await Promise.all([p.waitForNavigation({waitUntil:'networkidle2',timeout:45000}).catch(()=>{}),p.click('button[type="submit"],button')]);
    L('logged in ->',p.url());
  }
  await new Promise(r=>setTimeout(r,4000));
  // onboarding click-through: name entry, woka, camera, let's go
  for(let i=0;i<8;i++){
    const name=await p.$('input[type="text"]');
    if(name){try{await name.type('Alice');}catch(e){}}
    const clicked = await clickByText(/continue|다음|let'?s go|시작|입장|jump|ok|확인|enable|allow|계속/i) ;
    L('step',i,'clicked=',clicked,'url=',p.url());
    await new Promise(r=>setTimeout(r,2500));
    await p.screenshot({path:`/out/step-${i}.png`});
  }
  await new Promise(r=>setTimeout(r,4000));
  await p.screenshot({path:'/out/office-final.png'});
  L('FINAL url:',p.url());L('RESULT_OK');
}catch(e){L('ERROR:',e.message);}
fs.writeFileSync('/out/transcript-full.txt',log.join('\n'));
await b.close();
