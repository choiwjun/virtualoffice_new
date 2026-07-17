/* 읽기 전용: /office 뷰포트에 좌석이 몇 개 렌더되는지 확인(stale 좌표 수리 후 10개 기대). */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
  const page = await (await browser.newContext({ viewport: { width: 1720, height: 1050 } })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('#email', 'alice@virtualoffice.local');
  await page.fill('#password', 'password123');
  await Promise.all([page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);

  const seats = await page.evaluate(async () => (await (await fetch('/api/seats')).json()).length).catch(() => -1);
  await page.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('img.vo-body', { timeout: 30000 });
  await sleep(2500);
  const markers = await page.locator('button[title*="좌석"], button[title*="WS-"], button[title*="A-"], button[title*="앉기"], button[title*="사용"]').count();
  await page.screenshot({ path: path.join(__dirname, 'shots-roles', 'S4-all-seats-render.png') });
  console.log(`API seats=${seats}, 뷰포트 좌석 마커=${markers}`);
  console.log(markers >= seats && seats > 0 ? `[PASS] 전 좌석 렌더(${markers}/${seats})` : `[CHECK] 렌더 ${markers} / API ${seats}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
