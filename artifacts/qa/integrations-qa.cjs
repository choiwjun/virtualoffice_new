/* D31 외부 계정 연동 실화면 QA — /kpi 연동 섹션 + 실 GitHub API 검증 */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('#email', 'alice@virtualoffice.local');
  await page.fill('#password', 'password123');
  await Promise.all([page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);

  await page.goto(`${BASE}/kpi`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('text=외부 계정 연동', { timeout: 30000 });
  console.log('[PASS] 연동 섹션 노출');

  // 기연동 정리(멱등 재실행)
  const disc = page.locator('button:has-text("연동 해제")');
  while (await disc.count()) { await disc.first().click(); await page.waitForTimeout(800); }

  // GitHub 실계정 연동 (실 GitHub API 검증 + 활동 수집)
  await page.fill('input[placeholder*="GitHub 사용자명"]', 'octocat');
  await page.locator('button:has-text("연동")').first().click();
  await page.waitForSelector('text=연동됨 · 검증완료', { timeout: 30000 });
  console.log('[PASS] GitHub 실검증 연동(octocat)');
  const activity = await page.locator('text=최근 공개 이벤트').first().textContent().catch(() => null);
  console.log(activity ? `[PASS] 활동 요약 표시 — ${activity.trim()}` : '[WARN] 활동 요약 미표시(이벤트 0건 계정일 수 있음)');

  // 존재하지 않는 계정 → 검증 거부 (Figma 카드가 아니라 새 브라우저 흐름 대신 해제→재시도)
  await page.locator('button:has-text("동기화")').first().click();
  await page.waitForTimeout(2000);
  console.log('[PASS] 동기화 재실행 예외 없음');

  await page.screenshot({ path: path.join(__dirname, 'shots', '10-integrations.png'), fullPage: true });

  // 오류 계정 거부 확인: 해제 후 없는 계정 시도
  await page.locator('button:has-text("연동 해제")').first().click();
  await page.waitForSelector('input[placeholder*="GitHub 사용자명"]', { timeout: 10000 });
  await page.fill('input[placeholder*="GitHub 사용자명"]', 'no-such-user-xx-991238x');
  await page.locator('button:has-text("연동")').first().click();
  await page.waitForSelector('text=찾을 수 없습니다', { timeout: 30000 });
  console.log('[PASS] 없는 계정 검증 거부(400 메시지 표기)');

  // 재연동(원상 복구) — 실사용 데모 상태 유지
  await page.fill('input[placeholder*="GitHub 사용자명"]', 'octocat');
  await page.locator('button:has-text("연동")').first().click();
  await page.waitForSelector('text=연동됨 · 검증완료', { timeout: 30000 });

  console.log(`console errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log('  [console]', e));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
