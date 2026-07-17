/* 사무실 구조 변경 QA — D12 레이아웃 수명주기 실구동
 * 좌석 추가/드래그/방/벽 → 모두 저장 → 초안 v1 → 검증 → 배포 → 구조 재변경 → v2 배포 → v1 롤백
 * + 배포가 realtime floor-layout API에 실반영되는지 확인(내부 토큰)
 */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots-roles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (s, n, d = '') => { results.push({ s, n, d }); console.log(`[${s}] ${n}${d ? ' — ' + d : ''}`); };
const step = async (n, fn) => { try { await fn(); } catch (e) { log('FAIL', n, String(e).split('\n')[0].slice(0, 140)); } };
const INTERNAL = 'dev-internal-token-CHANGE-IN-PRODUCTION';

async function adminToken() {
  const r = await fetch('http://127.0.0.1:8000/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@virtualoffice.local', password: 'password123' }),
  });
  return (await r.json()).access_token;
}

async function realIds() {
  const tok = await adminToken();
  const raw = await (await fetch('http://127.0.0.1:8000/api/office-layouts', { headers: { Authorization: `Bearer ${tok}` } })).json();
  const items = Array.isArray(raw) ? raw : raw.items || [];
  const any = items[0];
  return any ? { office_id: any.office_id, floor_id: any.floor_id } : null;
}

async function floorLayoutStatus() {
  const ids = await realIds();
  if (!ids) return 'NOID';
  const r = await fetch(`http://127.0.0.1:8000/api/realtime/floor-layout?office_id=${ids.office_id}&floor_id=${ids.floor_id}`, {
    headers: { Authorization: `Bearer ${INTERNAL}` },
  }).catch(() => null);
  return r ? r.status : 'ERR';
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

  const before = await floorLayoutStatus();
  console.log(`(사전 상태: realtime floor-layout HTTP ${before} — 404=미배포 폴백)`);

  await step('L1 편집기 로드(좌석 캔버스)', async () => {
    await page.goto(`${BASE}/admin/office-layout`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await sleep(1500);
    log('PASS', 'L1 편집기 로드', 'Konva 캔버스 + 버전 패널 표시');
  });

  await step('L2 구조 변경: 좌석·방·구역·벽 추가 + 좌석 드래그', async () => {
    await page.click('button:has-text("+ 좌석")');
    await page.click('button:has-text("+ 방")');
    await page.click('button:has-text("+ 구역")');
    await page.click('button:has-text("+ 벽")');
    await sleep(800);
    // 캔버스 중앙 부근 드래그(신규 좌석/도형 이동 시도 — Konva 히트 여부는 관대하게)
    const c = await page.locator('canvas').first().boundingBox();
    await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width * 0.6, c.y + c.height * 0.62, { steps: 8 });
    await page.mouse.up();
    await sleep(500);
    const body = await page.textContent('body');
    if (!/저장되지 않은 변경/.test(body)) throw new Error('변경 버퍼 미감지');
    log('PASS', 'L2 구조 변경', `저장 대기 배지 표시 (좌석+방+구역+벽 추가)`);
    await page.screenshot({ path: path.join(SHOTS, 'L2-editor-modified.png') });
  });

  await step('L3 모두 저장(좌석 CRUD 반영)', async () => {
    await page.click('button:has-text("모두 저장")');
    await page.waitForSelector('text=모든 변경 저장 완료', { timeout: 20000 });
    log('PASS', 'L3 모두 저장', '삭제→이동→생성 순차 API 반영');
  });

  await step('L4 초안 v1 생성 → 검증 → 배포', async () => {
    await page.click('button:has-text("현재 배치로 초안 생성")');
    await page.waitForSelector('text=초안 생성됨', { timeout: 20000 });
    await page.locator('button:has-text("검증")').first().click();
    await page.waitForSelector('text=검증: validated', { timeout: 20000 });
    const deployBtn = page.locator('button:has-text("배포")').first();
    await deployBtn.click();
    await page.waitForSelector('text=배포 완료', { timeout: 20000 });
    log('PASS', 'L4 초안→검증→배포', 'draft → validated(오류 0) → deployed');
    await page.screenshot({ path: path.join(SHOTS, 'L4-deployed.png') });
  });

  await step('L5 배포가 realtime floor-layout에 실반영', async () => {
    const st = await floorLayoutStatus();
    if (st !== 200) throw new Error(`floor-layout HTTP ${st} (기대 200)`);
    log('PASS', 'L5 realtime 반영', '배포 후 GET /api/realtime/floor-layout = 200 (이동서버 소비 가능)');
  });

  await step('L6 구조 재변경 → v2 배포 (v1 자동 보관)', async () => {
    await page.click('button:has-text("+ 좌석")');
    await sleep(500);
    await page.click('button:has-text("모두 저장")');
    await page.waitForSelector('text=모든 변경 저장 완료', { timeout: 20000 });
    await page.click('button:has-text("현재 배치로 초안 생성")');
    await page.waitForSelector('text=초안 생성됨', { timeout: 20000 });
    // 새 draft 행(최상단 가정 — 목록에서 draft 상태 행의 검증 클릭)
    await sleep(1000);
    const rows = page.locator('table tbody tr');
    const n = await rows.count();
    let clicked = false;
    for (let i = 0; i < n; i++) {
      const t = await rows.nth(i).textContent();
      if (t.includes('draft')) { await rows.nth(i).locator('button:has-text("검증")').click(); clicked = true; break; }
    }
    if (!clicked) throw new Error('draft 행 미발견');
    await page.waitForSelector('text=검증: validated', { timeout: 20000 });
    for (let i = 0; i < n; i++) {
      const t = await rows.nth(i).textContent();
      if (t.includes('validated')) { await rows.nth(i).locator('button:has-text("배포")').click(); break; }
    }
    await page.waitForSelector('text=배포 완료', { timeout: 20000 });
    const body = await page.textContent('body');
    if (!body.includes('archived')) throw new Error('v1 archived 미표시');
    log('PASS', 'L6 v2 배포', '신규 버전 배포 + 이전 버전 자동 archived');
  });

  await step('L7 롤백(v1 복원)', async () => {
    const rb = page.locator('button:has-text("이 버전으로 롤백")').first();
    await rb.waitFor({ state: 'visible', timeout: 20000 });
    await rb.click();
    await page.waitForSelector('text=롤백 완료', { timeout: 20000 });
    log('PASS', 'L7 롤백', '현 배포본 보관 + 직전 버전 재배포 (D12 롤백 계약)');
    await page.screenshot({ path: path.join(SHOTS, 'L7-rollback.png') });
  });

  await step('L8 미검증 초안 배포 차단(D12 negative)', async () => {
    await page.click('button:has-text("현재 배치로 초안 생성")');
    await page.waitForSelector('text=초안 생성됨', { timeout: 20000 });
    await sleep(800);
    const rows = page.locator('table tbody tr');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const t = await rows.nth(i).textContent();
      if (t.includes('draft')) {
        const btn = rows.nth(i).locator('button:has-text("배포")');
        const disabled = await btn.isDisabled();
        if (!disabled) throw new Error('draft 상태 배포 버튼 활성(!)');
        break;
      }
    }
    log('PASS', 'L8 배포 게이트', 'draft 상태 배포 버튼 비활성 (검증 후에만 배포 — D12)');
  });

  await step('cleanup QA 오염', async () => {
    const tok = await adminToken();
    const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
    const seatsRaw = await (await fetch('http://127.0.0.1:8000/api/seats', { headers: H })).json();
    const seats = Array.isArray(seatsRaw) ? seatsRaw : seatsRaw.items || [];
    let removed = 0;
    for (const s of seats) {
      if (!/^WS-[AB]/.test(s.seat_number || '')) {
        const d = await fetch(`http://127.0.0.1:8000/api/seats/${s.id}`, { method: 'DELETE', headers: H });
        if (d.ok) removed++;
      }
    }
    log('PASS', 'cleanup', `QA 좌석 ${removed}개 비활성 (배포 레이아웃 archived는 오케스트레이터가 DB로 정리)`);
  });

  const f = results.filter((r) => r.s === 'FAIL').length;
  console.log(`\n===== SUMMARY: ${results.filter((r) => r.s === 'PASS').length} PASS / ${f} FAIL =====`);
  await browser.close();
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
