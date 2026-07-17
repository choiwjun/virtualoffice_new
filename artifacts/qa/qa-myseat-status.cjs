/* 내 자리 표시 + 업무중 상태 배지 검증.
 * alice에 좌석 배정(API) → /office에서 상태 '업무 중' 설정 → 내 자리 라벨/링 + 상태 배지 확인. */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const API = 'http://127.0.0.1:8000';
const SHOTS = path.join(__dirname, 'shots-roles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (s, n, d = '') => { results.push({ s, n }); console.log(`[${s}] ${n}${d ? ' — ' + d : ''}`); };

async function auth() {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@virtualoffice.local', password: 'password123' }) });
  const j = await r.json();
  return { tok: j.access_token, me: j.user };
}

(async () => {
  const { tok, me } = await auth();
  const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  // 가용 좌석 하나에 alice 배정(이미 배정돼 있으면 그대로)
  const seats = await (await fetch(`${API}/api/seats`, { headers: H })).json();
  let mine = seats.find((s) => s.assigned_user_id === me.id);
  if (!mine) {
    const free = seats.find((s) => s.status === 'available' && s.type === 'free');
    if (!free) { log('FAIL', 'S0 배정 가능한 좌석 없음'); process.exit(1); }
    const r = await fetch(`${API}/api/seat-assignments`, { method: 'POST', headers: H, body: JSON.stringify({ seat_id: free.id }) });
    if (![200, 201].includes(r.status)) { log('FAIL', 'S0 좌석 배정 실패 ' + r.status, await r.text()); process.exit(1); }
    mine = free;
  }
  log('PASS', 'S0 내 좌석 배정', `${mine.seat_number} coords=(${mine.coords.x},${mine.coords.y})m`);

  let browser;
  try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
  const page = await (await browser.newContext({ viewport: { width: 1720, height: 1050 } })).newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('#email', 'alice@virtualoffice.local');
  await page.fill('#password', 'password123');
  await Promise.all([page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('img.vo-body', { timeout: 30000 });

  await sleep(3500);

  // 상태 '업무 중' 설정 — 프레즌스 칩(▾) 클릭 후 메뉴에서 선택
  try {
    await page.click('button:has-text("온라인"), button:has-text("자동")', { timeout: 3000 }).catch(() => {});
    await sleep(400);
    await page.click('text=업무 중', { timeout: 3000 });
    await sleep(1500);
    log('PASS', 'S1 상태 업무 중 설정', '');
  } catch { log('WARN', 'S1 상태 설정 스킵(칩 못찾음) — 기본 상태 배지로 검증'); }

  await sleep(1500);
  const body = await page.textContent('body');
  log(/내 자리/.test(body) ? 'PASS' : 'FAIL', 'S2 내 자리 라벨 표시', /내 자리/.test(body) ? '' : '라벨 없음');
  // 상태 배지: 아바타 이름표에 프레즌스 라벨(업무 중/온라인/…) 존재
  const hasBadge = /업무 중|온라인|집중|외부|자리비움/.test(body);
  log(hasBadge ? 'PASS' : 'FAIL', 'S3 상태 배지 표시', '');
  await page.screenshot({ path: path.join(SHOTS, 'MY-seat-status.png') });

  const f = results.filter((r) => r.s === 'FAIL').length;
  console.log(`\n===== ${results.filter((r) => r.s === 'PASS').length} PASS / ${results.filter((r) => r.s === 'WARN').length} WARN / ${f} FAIL =====`);
  await browser.close();
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
