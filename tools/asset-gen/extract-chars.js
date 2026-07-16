/* horizon-characters.js → 208프레임(idle6+walk8+sit6+typing6 × 8직군) 추출 + 자동 QA + 콘택트시트 (Playwright headless) */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');

const ROOT = 'C:/Users/wj941/OneDrive/바탕 화면/jproject/vituraloffice_new/tools/asset-gen';
const SRC = path.join(ROOT, 'ai-plate/incoming/horizon-characters.js');
const OUT = path.join(ROOT, 'out/chars-v2');
const CHARS = ['CEO', 'MANAGER', 'DEVELOPER', 'DESIGNER', 'SALES', 'HR', 'MARKETER', 'INTERN'];
const STATES = { idle: 6, walk: 8, sit: 6, typing: 6 };

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
  await page.setContent('<canvas id="c" width="220" height="460"></canvas>');
  await page.addScriptTag({ path: SRC });
  const has = await page.evaluate(() => typeof window.drawCharFrame === 'function');
  if (!has) throw new Error('window.drawCharFrame 미정의');

  const issues = [];
  for (const id of CHARS) {
    fs.mkdirSync(path.join(OUT, id), { recursive: true });
    for (const [state, n] of Object.entries(STATES)) {
      for (let f = 0; f < n; f++) {
        const r = await page.evaluate(([id, state, f]) => {
          const c = document.getElementById('c');
          const ctx = c.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, 220, 460);
          window.drawCharFrame(ctx, id, state, f);
          const img = ctx.getImageData(0, 0, 220, 460).data;
          let minX = 220, maxX = 0, minY = 460, maxY = 0, solidMaxY = 0;
          for (let y = 0; y < 460; y++) {
            for (let x = 0; x < 220; x++) {
              const a = img[(y * 220 + x) * 4 + 3];
              if (a > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
              if (a > 160) { if (y > solidMaxY) solidMaxY = y; }
            }
          }
          const corner = img[3] + img[(459 * 220 + 219) * 4 + 3];
          return { dataUrl: c.toDataURL('image/png'), minX, maxX, minY, maxY, solidMaxY, corner };
        }, [id, state, f]);
        // QA: 코너 투명, 콘텐츠 존재, 발(불투명 최저점) 445±14, 좌우 캔버스 내
        if (r.corner !== 0) issues.push(`${id}/${state}_${f}: 배경 불투명`);
        if (r.maxX - r.minX < 40 || r.maxY - r.minY < 120) issues.push(`${id}/${state}_${f}: 콘텐츠 부족 bbox=(${r.minX},${r.minY})-(${r.maxX},${r.maxY})`);
        if (Math.abs(r.solidMaxY - 445) > 14) issues.push(`${id}/${state}_${f}: 발 기준점 이탈 solidMaxY=${r.solidMaxY}`);
        const buf = Buffer.from(r.dataUrl.split(',')[1], 'base64');
        writeRetry(path.join(OUT, id, `${state}_${String(f).padStart(2, '0')}.png`), buf);
      }
    }
    console.log('extracted', id);
  }

  // 콘택트시트: 8직군 × [idle0, walk0, walk2, walk4, walk6, sit0, typing0, typing3]
  const sheet = await page.evaluate((CHARS) => {
    const cells = [['idle', 0], ['walk', 0], ['walk', 2], ['walk', 4], ['walk', 6], ['sit', 0], ['typing', 0], ['typing', 3]];
    const c = document.createElement('canvas');
    c.width = 220 * CHARS.length; c.height = 460 * cells.length;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#EDEAE3'; ctx.fillRect(0, 0, c.width, c.height);
    CHARS.forEach((id, ci) => {
      cells.forEach(([st, f], ri) => {
        ctx.save(); ctx.translate(ci * 220, ri * 460);
        window.drawCharFrame(ctx, id, st, f);
        ctx.restore();
      });
      ctx.fillStyle = '#4A4F58'; ctx.font = '700 22px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(id, ci * 220 + 110, 30);
    });
    return c.toDataURL('image/png');
  }, CHARS);
  writeRetry(path.join(OUT, 'chars-v2-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));

  await browser.close();
  console.log('QA issues:', issues.length === 0 ? 'NONE' : '\n' + issues.join('\n'));
  console.log('done → ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
