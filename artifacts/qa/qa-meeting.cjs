/* A6 재검증 — 회의실 시드 후 회의 예약 실구동 */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
  const page = await (await browser.newContext({ viewport: { width: 1680, height: 1000 } })).newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('#email', 'alice@virtualoffice.local');
  await page.fill('#password', 'password123');
  await Promise.all([page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/meetings`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(1500);
  await page.locator('button:has-text("+ 회의 예약")').click();
  const m = page.locator('div.fixed.inset-0').last();
  const stamp = Date.now().toString().slice(-6);
  await m.locator('input').first().fill(`QA 정기회의 ${stamp}`);
  await m.locator('select').first().selectOption({ index: 0 }); // Board Room
  const dt = new Date(Date.now() + 3600000);
  const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await m.locator('input[type="datetime-local"]').fill(local);
  await m.locator('button:has-text("예약")').last().click();
  await page.waitForSelector(`text=QA 정기회의 ${stamp}`, { timeout: 15000 });
  console.log('[PASS] A6 회의 예약 — Board Room 예약 → 목록 반영');
  await page.screenshot({ path: path.join(__dirname, 'shots-roles', 'A6-meeting.png') });
  await browser.close();
})().catch((e) => { console.error('[FAIL] A6', e.message?.split('\n')[0]); process.exit(1); });
