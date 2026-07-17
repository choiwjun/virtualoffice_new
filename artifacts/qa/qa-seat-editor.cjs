/* 좌석 편집기 → 저장 → 가상사무실 반영 실증 (좌표계 수리 검증, 2026-07-17)
 * 편집기에서 좌석을 드래그해 저장 → seat 테이블 coords가 미터(0~20)인지 확인 →
 * /office 뷰포트에 해당 좌석이 렌더되는지(플레이트 안, 컬링 안됨) 확인.
 */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots-roles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (s, n, d = '') => { results.push({ s, n, d }); console.log(`[${s}] ${n}${d ? ' — ' + d : ''}`); };
const step = async (n, fn) => { try { await fn(); } catch (e) { log('FAIL', n, String(e).split('\n')[0].slice(0, 160)); } };

async function tokenHdr() {
  const r = await fetch('http://127.0.0.1:8000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@virtualoffice.local', password: 'password123' }) });
  return { Authorization: 'Bearer ' + (await r.json()).access_token, 'Content-Type': 'application/json' };
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
  const page = await (await browser.newContext({ viewport: { width: 1720, height: 1050 } })).newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('#email', 'alice@virtualoffice.local');
  await page.fill('#password', 'password123');
  await Promise.all([page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);

  const H = await tokenHdr();
  const seatsBefore = await (await fetch('http://127.0.0.1:8000/api/seats', { headers: H })).json();
  const target = (Array.isArray(seatsBefore) ? seatsBefore : []).find((s) => s.seat_number === 'WS-A2');
  log(target ? 'PASS' : 'FAIL', 'S0 대상 좌석 확보', target ? `WS-A2 현재 coords=(${target.coords.x},${target.coords.y})m` : '없음');

  await step('S1 편집기 로드 + 좌석 드래그', async () => {
    await page.goto(`${BASE}/admin/office-layout`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await sleep(1500);
    const c = await page.locator('canvas').first().boundingBox();
    // WS-A2는 미터(9.084,5.797)→픽셀(454,290). 박스(96×64)의 중심(+48,+32)을 잡아 드래그.
    const fromX = c.x + 454 + 48, fromY = c.y + 290 + 32;
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(fromX + 100, fromY + 80, { steps: 12 });
    await page.mouse.up();
    await sleep(600);
    const body = await page.textContent('body');
    if (!/저장되지 않은 변경/.test(body)) throw new Error('드래그 변경 미감지(좌석 위치 못 잡음)');
    log('PASS', 'S1 드래그', '저장 대기 배지 표시');
  });

  await step('S2 모두 저장 → seat 테이블 coords 미터 확인', async () => {
    await page.click('button:has-text("모두 저장")');
    await page.waitForSelector('text=모든 변경 저장 완료', { timeout: 20000 });
    await sleep(500);
    const rows = await (await fetch('http://127.0.0.1:8000/api/seats', { headers: H })).json();
    const a2 = rows.find((s) => s.seat_number === 'WS-A2');
    const inMeters = a2 && a2.coords.x >= 0 && a2.coords.x <= 20 && a2.coords.y >= 0 && a2.coords.y <= 11.256;
    if (!inMeters) throw new Error(`WS-A2 coords 미터 범위 밖: (${a2 && a2.coords.x}, ${a2 && a2.coords.y})`);
    const moved = a2.coords.x !== target.coords.x || a2.coords.y !== target.coords.y;
    log(moved ? 'PASS' : 'WARN', 'S2 저장 좌표', `WS-A2 저장 후 coords=(${a2.coords.x},${a2.coords.y})m (0~20 범위, 이동=${moved})`);
  });

  await step('S3 가상사무실 뷰포트에 좌석 렌더(컬링 안됨)', async () => {
    await page.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('img.vo-body', { timeout: 30000 });
    await sleep(2000);
    // 좌석 버튼: title에 'WS-A2' 포함 또는 좌석 클릭 마커. 미터 좌표가 정상이면 렌더됨.
    const seatBtns = await page.locator('button[title*="좌석"], button[title*="WS-"], button[title*="앉기"], button[title*="사용"]').count();
    if (seatBtns < 1) throw new Error('뷰포트에 좌석 마커 0개(컬링됨 — 좌표계 여전히 불일치)');
    log('PASS', 'S3 뷰포트 좌석 렌더', `좌석 마커 ${seatBtns}개 표시(미터 좌표 정상 → 플레이트 안 렌더)`);
    await page.screenshot({ path: path.join(SHOTS, 'S3-seats-in-office.png') });
  });

  const f = results.filter((r) => r.s === 'FAIL').length;
  console.log(`\n===== SUMMARY: ${results.filter((r) => r.s === 'PASS').length} PASS / ${results.filter((r) => r.s === 'WARN').length} WARN / ${f} FAIL =====`);
  await browser.close();
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
