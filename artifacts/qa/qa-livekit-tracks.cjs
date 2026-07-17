/* 카메라/마이크 실 트랙 발행 검증 — aria-label 정밀 토글 + 상태 플립 확인 */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const args = ['--use-fake-ui-for-media-capture', '--use-fake-device-for-media-capture'];
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', args }); } catch { browser = await chromium.launch({ args }); }
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 140)); });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('#email', 'alice@virtualoffice.local');
  await page.fill('#password', 'password123');
  await Promise.all([page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('img.vo-body', { timeout: 30000 });
  await page.locator('button:has-text("입장하기")').first().click();
  await page.waitForSelector('text=연결됨', { timeout: 30000 });
  console.log('[PASS] LiveKit 연결');

  // 마이크: '마이크 음소거'(off) → 클릭 → '마이크 켜짐'
  await page.locator('button[aria-label="마이크 음소거"]').click();
  await page.waitForSelector('button[aria-label="마이크 켜짐"]', { timeout: 15000 });
  console.log('[PASS] 마이크 켜짐 — 오디오 트랙 발행(클라 상태 플립)');

  // 카메라: '카메라 꺼짐'(off) → 클릭 → '카메라 켜짐'
  await page.locator('button[aria-label="카메라 꺼짐"]').click();
  await page.waitForSelector('button[aria-label="카메라 켜짐"]', { timeout: 15000 });
  console.log('[PASS] 카메라 켜짐 — 비디오 트랙 발행(클라 상태 플립)');
  await sleep(3000);
  await page.screenshot({ path: path.join(__dirname, 'shots-roles', 'V6-tracks-on.png') });
  await browser.close();
})().catch((e) => { console.error('[FAIL]', e.message?.split('\n')[0]); process.exit(1); });
