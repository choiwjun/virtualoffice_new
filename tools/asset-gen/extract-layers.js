/* horizon-scene.js 레이어 캡처 → frontend/public/office2d/layers/ (배경+가구 스프라이트 WebP + manifest)
 *
 * 사용: node extract-layers.js   (Playwright 전역 설치 필요)
 * 산출: layers/background.webp, layers/sprites/<name>.webp, layers/manifest.json
 *   manifest 좌표는 플레이트 정규(0~1). z = 스프라이트 바닥 접점(불투명 최저 y) 정규값
 *   — 뷰포트가 아바타와 동일 규칙(zIndex = z·10000)으로 합성해 상호 가림을 만든다.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'ai-plate/incoming/horizon-scene.js');
const OUT = path.join(ROOT, '..', '..', 'frontend', 'public', 'office2d', 'layers');

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function writeRetry(file, buf) {
  for (let t = 0; t < 8; t++) {
    try { fs.writeFileSync(file, buf); return; } catch (e) { sleep(200 + t * 250); }
  }
  throw new Error('write failed: ' + file);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  await page.addScriptTag({ path: SRC });

  const layers = await page.evaluate(() => {
    const Ls = window.renderHorizonLayers();
    const out = [];
    for (const L of Ls) {
      const c = L.canvas;
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      let minX = c.width, maxX = -1, minY = c.height, maxY = -1, solidMaxY = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const a = img[(y * c.width + x) * 4 + 3];
          if (a > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          if (a > 140 && y > solidMaxY) solidMaxY = y;
        }
      }
      if (maxX < 0) continue; // 빈 레이어 스킵
      if (L.name === 'background') {
        out.push({ name: L.name, x: 0, y: 0, w: c.width, h: c.height, z: null, data: c.toDataURL('image/webp', 0.92) });
        continue;
      }
      const pad = 3;
      const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
      const x1 = Math.min(c.width, maxX + pad), y1 = Math.min(c.height, maxY + pad);
      const cw = x1 - x0, ch = y1 - y0;
      const cc = document.createElement('canvas');
      cc.width = cw; cc.height = ch;
      cc.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
      out.push({
        name: L.name, x: x0, y: y0, w: cw, h: ch,
        z: (solidMaxY >= 0 ? solidMaxY : maxY) / c.height,
        data: cc.toDataURL('image/webp', 0.92),
        full: { W: c.width, H: c.height },
      });
    }
    return out;
  });

  fs.mkdirSync(path.join(OUT, 'sprites'), { recursive: true });
  const manifest = [];
  let total = 0;
  for (const L of layers) {
    const buf = Buffer.from(L.data.split(',')[1], 'base64');
    total += buf.length;
    if (L.name === 'background') {
      writeRetry(path.join(OUT, 'background.webp'), buf);
      continue;
    }
    const file = `sprites/${L.name}.webp`;
    writeRetry(path.join(OUT, file), buf);
    manifest.push({
      src: file,
      x: +(L.x / L.full.W).toFixed(5),
      y: +(L.y / L.full.H).toFixed(5),
      w: +(L.w / L.full.W).toFixed(5),
      h: +(L.h / L.full.H).toFixed(5),
      z: +L.z.toFixed(5),
    });
  }
  writeRetry(path.join(OUT, 'manifest.json'), Buffer.from(JSON.stringify({ version: 1, sprites: manifest }, null, 1)));
  await browser.close();
  console.log(`layers: 배경 1 + 스프라이트 ${manifest.length}장, 총 ${(total / 1024 / 1024).toFixed(2)}MB → ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
