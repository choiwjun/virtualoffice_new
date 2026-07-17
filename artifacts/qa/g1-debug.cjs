/* G1 디버그 — 보드룸 진입 시 아바타 위치·WS meeting_entry 메시지 추적 */
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1720, height: 980 } });
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      const s = typeof f.payload === 'string' ? f.payload : f.payload.toString('latin1');
      if (s.includes('meeting')) console.log('WS<-', JSON.stringify(s.slice(0, 160)));
    });
    ws.on('framesent', (f) => {
      const s = typeof f.payload === 'string' ? f.payload : f.payload.toString('latin1');
      if (s.includes('meeting') || s.includes('enter')) console.log('WS->', JSON.stringify(s.slice(0, 120)));
    });
  });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('#email', 'alice@virtualoffice.local');
  await page.fill('#password', 'password123');
  await Promise.all([page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('img.vo-body', { timeout: 30000 });
  await page.waitForSelector('text=실시간 연결됨', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const scene = page.locator('img[src*="background"]').first();
  const box = await scene.boundingBox();
  console.log('scene box', JSON.stringify(box));
  // 보드룸 남측 코리도 클릭
  await page.mouse.click(box.x + box.width * 0.80, box.y + box.height * 0.705);
  for (let i = 0; i < 26; i++) {
    const pos = await page.$$eval('img.vo-body', (els) =>
      els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height }; }));
    const sb = await scene.boundingBox();
    const norm = pos.map((p) => `(${((p.x - sb.x) / sb.width).toFixed(3)},${((p.y - sb.y) / sb.height).toFixed(3)})`);
    const prompt = await page.locator('text=입장하시겠어요').first().isVisible().catch(() => false);
    console.log(`t=${i}s avatars=${norm.join(' ')} prompt=${prompt}`);
    if (prompt) break;
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: __dirname + '/shots/g1-debug.png' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
