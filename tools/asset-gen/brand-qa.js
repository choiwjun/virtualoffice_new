/* 브랜드 파라미터 QA — ACME/NOVA 배경 1장씩 out/에 저장 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'ai-plate/incoming/horizon-scene.js');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  await page.addScriptTag({ path: SRC });
  for (const brand of ['ACME', 'NOVA']) {
    const data = await page.evaluate((b) => {
      const Ls = window.renderHorizonLayers(b);
      const bg = Ls.find((L) => L.name === 'background');
      return bg.canvas.toDataURL('image/webp', 0.9);
    }, brand);
    fs.writeFileSync(path.join(__dirname, 'out', `brand-${brand.toLowerCase()}-qa.webp`), Buffer.from(data.split(',')[1], 'base64'));
    console.log('rendered', brand);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
