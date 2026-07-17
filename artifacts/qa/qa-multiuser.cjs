/* 다중 계정 동시접속 종합 QA (사용자 요구: 가상사무실 상호표시·동시 화상·채팅·KPI 실측).
 * alice(admin)/bob(leader)/charlie(employee) 동시 로그인 → 각 기능 실클릭 검증. */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const API = 'http://127.0.0.1:8000';
const SHOTS = path.join(__dirname, 'shots-roles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const log = (s, n, d = '') => { R.push({ s, n }); console.log(`[${s}] ${n}${d ? ' — ' + d : ''}`); };
const step = async (n, fn) => { try { await fn(); } catch (e) { log('FAIL', n, String(e).split('\n')[0].slice(0, 170)); } };

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 980 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  for (let i = 0; i < 3; i++) {
    await page.fill('#email', email); await page.fill('#password', 'password123');
    const resp = page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 8000 }).catch(() => null);
    await page.click('button[type="submit"]');
    if ((await resp)?.status() === 200) { await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }); return page; }
    await sleep(1500);
  }
  throw new Error('login fail ' + email);
}
const goOffice = async (p) => { await p.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await p.waitForSelector('.vo-body', { timeout: 30000 }).catch(() => {}); };
const rosterOnline = async (p) => {
  const t = await p.textContent('body');
  const m = t.match(/(\d+)\s*명\s*온라인/);
  return m ? parseInt(m[1], 10) : -1;
};

(async () => {
  const args = ['--use-fake-ui-for-media-capture', '--use-fake-device-for-media-capture'];
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', args }); } catch { browser = await chromium.launch({ args }); }

  const A = await login(browser, 'alice@virtualoffice.local');
  const B = await login(browser, 'bob@virtualoffice.local');
  const C = await login(browser, 'charlie@virtualoffice.local');
  log('PASS', '3계정 동시 로그인', 'alice/bob/charlie');

  // ── 1. 동시 접속 + 상호 프레즌스 ──────────────────────────────
  await step('P1 3명 동시 /office 접속 + 상호 표시', async () => {
    await goOffice(A); await goOffice(B); await goOffice(C);
    await sleep(6000); // 프레즌스 브로드캐스트 안정화
    const [ao, bo, co] = [await rosterOnline(A), await rosterOnline(B), await rosterOnline(C)];
    // 각 클라 뷰포트 아바타 수(자신 포함)
    const av = await A.locator('.vo-body').count();
    log(ao >= 3 || av >= 3 ? 'PASS' : 'WARN', 'P1 상호 프레즌스', `온라인: alice=${ao} bob=${bo} charlie=${co} · alice뷰 아바타=${av}`);
    await A.screenshot({ path: path.join(SHOTS, 'MU-1-presence-alice.png') });
  });

  // ── 2. 동시 화상회의 (alice+bob 같은 회의 입장) ────────────────
  await step('P2 동시 회의 연결(alice+bob)', async () => {
    const joinBtn = (p) => p.locator('button:has-text("입장하기")').first();
    await joinBtn(A).click({ timeout: 8000 });
    await joinBtn(B).click({ timeout: 8000 });
    await A.waitForSelector('text=연결됨', { timeout: 30000 });
    await B.waitForSelector('text=연결됨', { timeout: 30000 });
    log('PASS', 'P2 양쪽 LiveKit 연결', 'alice·bob 모두 회의 연결됨');
    // 서버 참석자 수
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@virtualoffice.local', password: 'password123' }) });
    const tok = (await r.json()).access_token;
    const ms = await (await fetch(`${API}/api/meetings`, { headers: { Authorization: 'Bearer ' + tok } })).json();
    const pc = ms[0]?.participant_count;
    log(pc >= 2 ? 'PASS' : 'WARN', 'P2b 참석자 수', `participant_count=${pc}`);
  });

  await step('P3 카메라/마이크 발행(양쪽)', async () => {
    for (const [nm, p] of [['alice', A], ['bob', B]]) {
      await p.locator('button[aria-label="마이크 음소거"]').click({ timeout: 8000 }).catch(() => {});
      await p.locator('button[aria-label="카메라 꺼짐"]').click({ timeout: 8000 }).catch(() => {});
    }
    await sleep(2500);
    const aMic = await A.locator('button[aria-label="마이크 켜짐"]').count();
    const aCam = await A.locator('button[aria-label="카메라 켜짐"]').count();
    log(aMic && aCam ? 'PASS' : 'WARN', 'P3 트랙 발행', `alice mic=${!!aMic} cam=${!!aCam}`);
  });

  await step('P4 화상 표시(비디오 타일) 확인', async () => {
    await sleep(2000);
    const aVid = await A.locator('video').count();
    const bVid = await B.locator('video').count();
    // 동시 화상이면 자기/상대 비디오 <video>가 있어야 함
    log(aVid >= 1 ? 'PASS' : 'FAIL', 'P4 비디오 렌더', `alice <video>=${aVid}, bob <video>=${bVid} (0이면 화상 미표시 결함)`);
    await A.screenshot({ path: path.join(SHOTS, 'MU-2-meeting-alice.png') });
  });

  // ── 3. 채팅 (alice 전송 → bob/charlie 수신) ────────────────────
  await step('P5 채팅 실시간 송수신', async () => {
    const stamp = 'QA채팅' + Date.now().toString().slice(-5);
    await A.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await sleep(1500);
    await A.locator('nav button:has-text("전체")').first().click({ timeout: 8000 });
    await sleep(800);
    await A.locator('textarea').first().fill(stamp);
    await A.locator('button:has-text("전송")').click();
    await A.waitForSelector(`text=${stamp}`, { timeout: 10000 });
    log('PASS', 'P5a alice 전송', stamp);
    // bob 수신(폴링 4s)
    await B.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await sleep(1500);
    await B.locator('nav button:has-text("전체")').first().click({ timeout: 8000 });
    await B.waitForSelector(`text=${stamp}`, { timeout: 12000 });
    log('PASS', 'P5b bob 수신', '전체 채널에서 alice 메시지 확인');
    await B.screenshot({ path: path.join(SHOTS, 'MU-3-chat-bob.png') });
  });

  // ── 4. KPI 연동 ───────────────────────────────────────────────
  await step('P6 KPI 화면/데이터', async () => {
    await C.goto(`${BASE}/kpi`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await sleep(2000);
    const body = await C.textContent('body');
    const ok = /KPI|평가|점수|완료 업무|지표/.test(body);
    log(ok ? 'PASS' : 'WARN', 'P6 KPI 페이지', ok ? 'KPI 지표 화면 렌더' : '지표 미검출');
    await C.screenshot({ path: path.join(SHOTS, 'MU-4-kpi-charlie.png') });
  });

  const f = R.filter((r) => r.s === 'FAIL').length, w = R.filter((r) => r.s === 'WARN').length, p = R.filter((r) => r.s === 'PASS').length;
  console.log(`\n===== 종합: ${p} PASS / ${w} WARN / ${f} FAIL =====`);
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
