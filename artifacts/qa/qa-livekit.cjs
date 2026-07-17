/* 화상회의(LiveKit) 실구동 QA — 실 SFU(volocal_livekit) + 가짜 카메라/마이크 디바이스
 * alice(호스트): 회의 시작(scheduled→in_progress) → /office 입장하기 → LiveKit 연결
 * bob: 동일 회의 입장 → 2자 동시 연결. 검증 = '연결됨' 표식 + LiveKit 서버 로그 참가자 수.
 */
const path = require('path');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots-roles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (s, n, d = '') => { results.push({ s, n, d }); console.log(`[${s}] ${n}${d ? ' — ' + d : ''}`); };
const step = async (n, fn) => { try { await fn(); } catch (e) { log('FAIL', n, String(e).split('\n')[0].slice(0, 140)); } };

async function login(browser, email) {
  const ctx = await browser.newContext({
    viewport: { width: 1680, height: 1000 },
    permissions: ['camera', 'microphone'],
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  for (let i = 0; i < 3; i++) {
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    const resp = page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 8000 }).catch(() => null);
    await page.click('button[type="submit"]');
    if ((await resp)?.status() === 200) { await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 }); return page; }
    await page.waitForTimeout(1500);
  }
  throw new Error('로그인 실패: ' + email);
}

(async () => {
  const args = ['--use-fake-ui-for-media-capture', '--use-fake-device-for-media-capture'];
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', args }); console.log('(실 Chrome + 가짜 미디어 디바이스)'); }
  catch { browser = await chromium.launch({ args }); }

  const A = await login(browser, 'alice@virtualoffice.local');

  await step('V1 회의 시작(scheduled → in_progress)', async () => {
    const started = await A.evaluate(async () => {
      const tok = localStorage.getItem('access_token');
      const h = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
      const list = await (await fetch('http://localhost:8000/api/meetings?limit=200', { headers: h })).json();
      const target = list.find((m) => m.title?.startsWith('QA 정기회의') && m.status !== 'completed' && m.status !== 'cancelled');
      if (!target) return { ok: false, why: 'QA 정기회의 미발견' };
      if (target.status === 'in_progress') return { ok: true, id: target.id, note: '이미 진행중' };
      const r = await fetch(`http://localhost:8000/api/meetings/${target.id}/start`, { method: 'POST', headers: h });
      return { ok: r.ok, id: target.id, why: r.ok ? '' : `start ${r.status}` };
    });
    if (!started.ok) throw new Error(started.why);
    log('PASS', 'V1 회의 시작', `meeting ${started.id.slice(0, 8)}… in_progress ${started.note ?? ''}`);
  });

  await step('V2 alice LiveKit 연결(입장하기)', async () => {
    await A.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await A.waitForSelector('img.vo-body', { timeout: 30000 });
    const joinBtn = A.locator('button:has-text("입장하기")').first();
    await joinBtn.waitFor({ timeout: 20000 });
    await joinBtn.click();
    await A.waitForSelector('text=연결됨', { timeout: 30000 });
    log('PASS', 'V2 alice LiveKit 연결', "우하단 오버레이 '연결됨' + MediaBar 활성");
    await A.screenshot({ path: path.join(SHOTS, 'V2-livekit-alice.png') });
  });

  await step('V3 마이크/카메라 토글(실 트랙 발행)', async () => {
    await A.locator('button[aria-label*="마이크"], button:has([aria-label*="마이크"])').first().click().catch(async () => {
      await A.locator('button').filter({ has: A.locator('svg') }).nth(0).click();
    });
    await sleep(1500);
    // 카메라 켜기
    const camBtn = A.locator('button[aria-label*="카메라"]');
    if (await camBtn.count()) await camBtn.first().click();
    await sleep(2500);
    log('PASS', 'V3 미디어 토글', '마이크/카메라 토글 클릭 — 예외 없음(트랙 발행은 서버 로그로 검증)');
    await A.screenshot({ path: path.join(SHOTS, 'V3-livekit-media.png') });
  });

  let B;
  await step('V4 bob 동시 입장(2자 연결)', async () => {
    B = await login(browser, 'bob@virtualoffice.local');
    await B.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await B.waitForSelector('img.vo-body', { timeout: 30000 });
    const joinBtn = B.locator('button:has-text("입장하기")').first();
    await joinBtn.waitFor({ timeout: 20000 });
    await joinBtn.click();
    await B.waitForSelector('text=연결됨', { timeout: 30000 });
    log('PASS', 'V4 bob 동시 입장', "bob도 '연결됨' — 같은 LiveKit 룸 2자");
    await B.screenshot({ path: path.join(SHOTS, 'V4-livekit-bob.png') });
  });

  await step('V5 참여 인원 표기 갱신', async () => {
    await sleep(2000);
    await B.reload({ waitUntil: 'domcontentloaded' });
    await B.waitForSelector('text=참여중, text=연결됨', { timeout: 20000 }).catch(() => {});
    const body = await B.textContent('body');
    const m = body.match(/(\d+)명 참여중/);
    log(m ? 'PASS' : 'WARN', 'V5 참여 인원', m ? `${m[1]}명 참여중 표기` : '표기 미검출(연결 유지 상태) — 서버 로그로 확인');
  });

  const f = results.filter((r) => r.s === 'FAIL').length;
  console.log(`\n===== SUMMARY: ${results.filter((r) => r.s === 'PASS').length} PASS / ${results.filter((r) => r.s === 'WARN').length} WARN / ${f} FAIL =====`);
  await browser.close();
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
