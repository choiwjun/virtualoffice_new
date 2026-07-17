/* MediaBar 상태 계측 — 클릭 후 aria-label 타임라인 + pageerror */
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const args = ['--use-fake-ui-for-media-capture', '--use-fake-device-for-media-capture'];
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', args }); } catch { browser = await chromium.launch({ args }); }
  const page = await (await browser.newContext({ viewport: { width: 1680, height: 1000 }, permissions: ['camera', 'microphone'] })).newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('livekit')) console.log('CON', m.type(), m.text().slice(0, 140)); });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('#email', 'alice@virtualoffice.local');
  await page.fill('#password', 'password123');
  await Promise.all([page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('img.vo-body', { timeout: 30000 });
  await page.locator('button:has-text("입장하기")').first().click();
  await page.waitForSelector('text=연결됨', { timeout: 30000 });
  console.log('connected; waiting 5s to settle');
  await sleep(5000);
  const labels = async () => page.$$eval('[role="toolbar"] button', (bs) => bs.map((b) => `${b.getAttribute('aria-label')}${b.disabled ? '(disabled)' : ''}`));
  console.log('before:', await labels());
  await page.locator('button[aria-label="마이크 음소거"]').click();
  for (let i = 0; i < 20; i++) { await sleep(1000); console.log(`t=${i + 1}s`, await labels()); if ((await labels()).some((l) => l.includes('마이크 켜짐'))) break; }
  await browser.close();
})().catch((e) => { console.error('[FAIL]', e.message?.split('\n')[0]); process.exit(1); });
