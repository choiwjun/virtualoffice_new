/* E2E: 편집기에서 방/구역/벽 추가 → 초안생성 → 검증 → 배포 → 가상사무실에 배치 반영 확인.
 * 좌석배치대로 '구조'(방/벽/구역)까지 오피스에 렌더되는지 실증. (2026-07-17) */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots-roles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (s, n, d = '') => { out.push({ s, n }); console.log(`[${s}] ${n}${d ? ' — ' + d : ''}`); };
const step = async (n, fn) => { try { await fn(); } catch (e) { log('FAIL', n, String(e).split('\n')[0].slice(0, 180)); } };

async function structure() {
  const login = await fetch('http://127.0.0.1:8000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@virtualoffice.local', password: 'password123' }) });
  const tok = (await login.json()).access_token;
  const r = await fetch('http://127.0.0.1:8000/api/office-layouts/deployed/structure', { headers: { Authorization: 'Bearer ' + tok } });
  return r.json();
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

  await step('E1 편집기 로드 + 방/구역/벽 추가', async () => {
    await page.goto(`${BASE}/admin/office-layout`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await sleep(1200);
    await page.click('button:has-text("+ 방")');
    await page.click('button:has-text("+ 구역")');
    await page.click('button:has-text("+ 벽")');
    await sleep(400);
    const layer = await page.textContent('body');
    if (!/방 1 \/ 구역 1 \/ 벽 1/.test(layer)) throw new Error('레이어 카운트 방1/구역1/벽1 아님');
    log('PASS', 'E1 방/구역/벽 추가', '레이어 방1·구역1·벽1');
  });

  await step('E2 초안 생성', async () => {
    await page.click('button:has-text("현재 배치로 초안 생성")');
    await page.waitForSelector('text=초안 생성됨', { timeout: 15000 });
    log('PASS', 'E2 초안 생성', '스키마-유효 draft');
  });

  await step('E3 검증(오류 0)', async () => {
    await page.click('table button:has-text("검증")');
    await page.waitForFunction(() => /검증: \w+ \(오류 \d/.test(document.body.textContent || ''), { timeout: 15000 });
    const t = await page.textContent('body');
    const m = t.match(/검증: (\w+) \(오류 (\d+)/);
    if (!m) throw new Error('검증 토스트 파싱 실패');
    if (m[2] !== '0') throw new Error(`검증 오류 ${m[2]}건 (status=${m[1]})`);
    log('PASS', 'E3 검증', `${m[1]} · 오류 0`);
  });

  await step('E4 배포', async () => {
    await page.waitForSelector('table :text("validated")', { timeout: 10000 });
    const btn = page.locator('table button:has-text("배포")').first();
    await btn.click();
    await page.waitForSelector('text=배포 완료', { timeout: 15000 });
    log('PASS', 'E4 배포', 'deployed');
  });

  await step('E5 구조 API deployed=true', async () => {
    const s = await structure();
    if (!s.deployed) throw new Error('structure.deployed=false (배포 미반영)');
    if (!(s.rooms.length >= 1 && s.zones.length >= 1 && s.walls.length >= 1)) throw new Error(`구조 개수 부족 rooms=${s.rooms.length} zones=${s.zones.length} walls=${s.walls.length}`);
    // 미터 범위 확인(좌석과 동일 좌표계)
    const r0 = s.rooms[0];
    log('PASS', 'E5 구조 API', `deployed=true rooms=${s.rooms.length} zones=${s.zones.length} walls=${s.walls.length}, room0=(${r0.x},${r0.y},${r0.w}x${r0.h})m`);
  });

  await step('E6 가상사무실에 배치 반영 렌더', async () => {
    await page.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(3000);
    const body = await page.textContent('body');
    const hasBadge = /배포된 좌석배치 반영/.test(body);
    const hasRoom = /회의실 1/.test(body);
    if (!hasBadge) throw new Error('배포 반영 배지 미표시(벡터 플로어 미렌더)');
    if (!hasRoom) throw new Error('방 라벨(회의실 1) 미표시');
    log('PASS', 'E6 오피스 반영', '배포 배지 + 방 라벨 렌더');
    await page.screenshot({ path: path.join(SHOTS, 'E6-layout-reflected.png') });
  });

  const f = out.filter((r) => r.s === 'FAIL').length;
  console.log(`\n===== SUMMARY: ${out.filter((r) => r.s === 'PASS').length} PASS / ${f} FAIL =====`);
  await browser.close();
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
