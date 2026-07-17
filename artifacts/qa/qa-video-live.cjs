/* 동시 화상 실증: alice+bob 회의 입장 → alice 카메라 ON → alice 자기타일 + bob이 보는
 * alice 원격타일에 실제 비디오 프레임(videoWidth>0)이 흐르는지 확인. */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots-roles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ['camera', 'microphone'] });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await p.fill('#email', email); await p.fill('#password', 'password123');
  await Promise.all([p.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), p.click('button[type="submit"]')]);
  await p.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.vo-body', { timeout: 30000 }).catch(() => {});
  return p;
}
// 화면 내 최대 videoWidth (프레임 수신 증거)
const maxVideoW = (p) => p.evaluate(() => Math.max(0, ...[...document.querySelectorAll('video')].map((v) => v.videoWidth || 0)));

(async () => {
  const args = ['--use-fake-ui-for-media-capture', '--use-fake-device-for-media-capture'];
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', args }); } catch { browser = await chromium.launch({ args }); }
  const A = await login(browser, 'alice@virtualoffice.local');
  const B = await login(browser, 'bob@virtualoffice.local');

  await A.locator('button:has-text("입장하기")').first().click({ timeout: 8000 });
  await B.locator('button:has-text("입장하기")').first().click({ timeout: 8000 });
  await A.waitForSelector('text=연결됨', { timeout: 30000 });
  await B.waitForSelector('text=연결됨', { timeout: 30000 });
  console.log('[PASS] 양쪽 회의 연결');
  await sleep(1500);

  // alice 카메라 ON (1회 클릭 후 발행 대기 — 재클릭은 토글이라 금지)
  let camOn = false;
  await A.locator('button[aria-label="카메라 꺼짐"]').click({ timeout: 6000 }).catch(() => {});
  try { await A.waitForSelector('button[aria-label="카메라 켜짐"]', { timeout: 12000 }); camOn = true; } catch {}
  console.log(camOn ? '[PASS] alice 카메라 ON' : '[WARN] alice 카메라 토글 미확인');
  await sleep(5000); // 트랙 발행 + 원격 구독 + 프레임 안정화

  const aw = await maxVideoW(A);
  const bw = await maxVideoW(B);
  console.log(`[${aw > 0 ? 'PASS' : 'FAIL'}] alice 자기 영상 videoWidth=${aw}`);
  console.log(`[${bw > 0 ? 'PASS' : 'FAIL'}] bob이 보는 원격 영상 videoWidth=${bw} (동시 화상 = bob이 alice 카메라 수신)`);
  await A.screenshot({ path: path.join(SHOTS, 'V-live-alice.png') });
  await B.screenshot({ path: path.join(SHOTS, 'V-live-bob.png') });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
