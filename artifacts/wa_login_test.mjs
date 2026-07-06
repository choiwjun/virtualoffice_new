import puppeteer from 'puppeteer';
const log=[];
const L=(...a)=>{const s=a.join(' ');log.push(s);console.log(s);};
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors']});
const p=await b.newPage();
await p.setViewport({width:1280,height:800});
try{
  await p.goto('http://localhost:8090/',{waitUntil:'networkidle2',timeout:45000});
  await new Promise(r=>setTimeout(r,4000));
  L('landing url:',p.url());
  await p.screenshot({path:'/out/01-landing.png'});
  // WA may show a "let's go" / name entry, or redirect to OIDC. Look for OIDC form or a login button.
  const html=await p.content();
  const onOidc=p.url().includes('/oidc/authorize');
  L('on oidc authorize page:',onOidc);
  if(!onOidc){
    // try to find a login/connect button that triggers OIDC
    const btns=await p.$$eval('button,a',els=>els.map(e=>e.textContent?.trim()).filter(Boolean).slice(0,25));
    L('buttons/links:',JSON.stringify(btns));
  }
  // If on OIDC form, fill it
  const emailField=await p.$('input[name="email"]');
  if(emailField){
    L('OIDC login form present -> filling alice');
    await p.type('input[name="email"]','alice@virtualoffice.local');
    await p.type('input[name="password"]','password123');
    await p.screenshot({path:'/out/02-login-form.png'});
    await Promise.all([p.waitForNavigation({waitUntil:'networkidle2',timeout:45000}).catch(()=>{}),p.click('button[type="submit"],button')]);
    await new Promise(r=>setTimeout(r,6000));
    L('after login url:',p.url());
    await p.screenshot({path:'/out/03-after-login.png'});
  }
  L('RESULT_OK');
}catch(e){L('ERROR:',e.message);await p.screenshot({path:'/out/99-error.png'}).catch(()=>{});}
import fs from 'fs';fs.writeFileSync('/out/transcript.txt',log.join('\n'));
await b.close();
