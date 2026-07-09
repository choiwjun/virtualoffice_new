import pw from 'file:///C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright/index.js'; const { chromium } = pw;
const OUT = process.argv[2];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs=[]; page.on('pageerror',e=>errs.push('PE:'+e.message));
await page.goto('http://localhost:5174/', { waitUntil:'networkidle', timeout:30000 });
await page.waitForTimeout(3500);
const slider = page.locator('input[type=range]').first();
const min = Number(await slider.getAttribute('min') ?? 0);
const max = Number(await slider.getAttribute('max') ?? 100);
async function setV(frac,name){
  const v = min+(max-min)*frac;
  // React 제어 input: native value setter 사용해야 onChange 발화
  await slider.evaluate((el,val)=>{
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',{bubbles:true}));
  }, v);
  await page.waitForTimeout(1600);
  // 상단 우측 HUD 텍스트 읽기(Z값 확인)
  const hud = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,400));
  await page.screenshot({ path: `${OUT}/spike_${name}.png` });
  const z = (hud.match(/Z:\s*([\-0-9.]+)/)||[])[1];
  console.log(name,'Z='+z);
}
await setV(0.0,'front');
await setV(1.0,'behind');
await setV(0.5,'mid');
console.log('RANGE',min,max,'ERRORS',JSON.stringify(errs.slice(0,5)));
await browser.close();
