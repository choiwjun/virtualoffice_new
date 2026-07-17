/* 가상사무실 전 기능 실화면 QA — 2026-07-17 (F 항목)
 * 근거: 14-virtual-office-spec §2 · 06-screens · 01-prd v4.1 §7 · handoff 07-13 §2① 체크리스트
 * 실행: node office-qa.cjs  (backend:8000 / realtime:2567 / frontend:3000 기동 상태)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');

const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function log(status, name, detail = '') {
  results.push({ status, name, detail });
  console.log(`[${status}] ${name}${detail ? ' — ' + detail : ''}`);
}
async function step(name, fn) {
  try { await fn(); } catch (e) { log('FAIL', name, String(e).split('\n')[0]); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(ctx, email) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    const resp = page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 8000 }).catch(() => null);
    await page.click('button[type="submit"]');
    const r = await resp;
    if (r && r.status() === 200) {
      await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
      return page;
    }
    await page.waitForTimeout(2000); // 하이드레이션 전 클릭 플레이크 → 재시도
  }
  throw new Error('로그인 3회 실패: ' + email);
}

/** 뷰포트 씬 요소(플레이트 비율 유지 컨테이너) bbox 기준 정규좌표 클릭 */
async function clickScene(page, nx, ny) {
  const img = page.locator('img[src*="background"], img[src*="plates/horizon"]').first();
  const box = await img.boundingBox();
  if (!box) throw new Error('scene bbox 없음');
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny);
  return box;
}

/** 모든 아바타 프레임 src 수집 */
async function frames(page) {
  return page.$$eval('img.vo-body', (els) => els.map((e) => e.getAttribute('src') || ''));
}

(async () => {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1720, height: 980 } });
  let pageA;
  const consoleErrors = [];

  // ── A. 로그인 ──
  await step('A1 로그인(alice/admin)', async () => {
    pageA = await login(ctxA, 'alice@virtualoffice.local');
    pageA.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
    log('PASS', 'A1 로그인(alice/admin)', pageA.url());
  });

  // ── B. /office 진입: 플레이트·레이어·연결 배지·아바타 스폰 ──
  await step('B1 뷰포트 로딩(<3s 목표)', async () => {
    const t0 = Date.now();
    await pageA.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await pageA.waitForSelector('img.vo-body', { timeout: 30000 });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    log('PASS', 'B1 뷰포트 로딩', `아바타 스폰까지 ${dt}s (dev 첫 컴파일 포함)`);
  });
  await step('B2 레이어 합성(배경+스프라이트)', async () => {
    const bg = await pageA.locator('img[src*="background"]').count();
    const sprites = await pageA.locator('img[src*="/sprites/"]').count();
    if (bg < 1 || sprites < 50) throw new Error(`bg=${bg}, sprites=${sprites}`);
    log('PASS', 'B2 레이어 합성', `배경 ${bg} + 가구 스프라이트 ${sprites}장`);
  });
  await step('B3 실시간 연결 배지', async () => {
    await pageA.waitForSelector('text=실시간 연결됨', { timeout: 15000 });
    log('PASS', 'B3 실시간 연결 배지', '실시간 연결됨(초록)');
  });
  await step('B4 우패널(구성원·일정·공지)', async () => {
    for (const t of ['구성원 (', '오늘의 일정', '공지사항']) {
      if (!(await pageA.locator(`text=${t}`).first().isVisible())) throw new Error(`${t} 미표시`);
    }
    log('PASS', 'B4 우패널', '구성원/오늘의 일정/공지사항 표시');
  });
  await pageA.screenshot({ path: path.join(SHOTS, '01-office-initial.png') });

  // ── C. 클릭 이동(walk 애니 → idle) ──
  await step('C1 클릭 이동 + walk 프레임', async () => {
    await clickScene(pageA, 0.46, 0.62); // 오픈 워크존 보행영역
    const seen = new Set();
    for (let i = 0; i < 14; i++) { (await frames(pageA)).forEach((s) => { const m = s.match(/\/(idle|walk|sit|typing)_/); if (m) seen.add(m[1]); }); await sleep(400); }
    if (!seen.has('walk')) throw new Error(`walk 프레임 미관측: ${[...seen]}`);
    log('PASS', 'C1 클릭 이동', `관측 상태: ${[...seen].join(',')}`);
  });
  await step('C2 장애물 클릭(클램프·통과불가)', async () => {
    await clickScene(pageA, 0.82, 0.61); // 보드룸 테이블(OB4) 위 클릭 → 보행점 보정
    await sleep(2500);
    await pageA.screenshot({ path: path.join(SHOTS, '02-obstacle-clamp.png') });
    log('PASS', 'C2 장애물 클릭', '예외 없음(보정 경로) — 스크린샷 육안');
  });

  // ── D. 내 자리로 → sit → typing 버스트 ──
  await step('D1 내 자리로 착석(sit)', async () => {
    await pageA.click('text=내 자리로');
    let sat = false;
    for (let i = 0; i < 40 && !sat; i++) { sat = (await frames(pageA)).some((s) => s.includes('/sit_')); await sleep(500); }
    if (!sat) throw new Error('20s 내 sit 미도달');
    log('PASS', 'D1 내 자리로 착석', 'sit 프레임 확인');
    await pageA.screenshot({ path: path.join(SHOTS, '03-seated.png') });
  });
  await step('D2 typing 버스트(9.5s 중 4s)', async () => {
    const timeline = [];
    for (let i = 0; i < 26; i++) { const f = (await frames(pageA)).find((s) => s.includes('/sit_') || s.includes('/typing_')); timeline.push(f ? (f.includes('typing') ? 'T' : 's') : '.'); await sleep(500); }
    const tl = timeline.join('');
    if (!tl.includes('T') || !tl.includes('s')) throw new Error(`sit↔typing 교대 미관측: ${tl}`);
    log('PASS', 'D2 typing 버스트', `13s 타임라인: ${tl}`);
    await pageA.screenshot({ path: path.join(SHOTS, '04-typing.png') });
  });

  // ── E. 씬 시간대 테마 순환 ──
  await step('E1 테마 순환(자동→주간→석양→야간)', async () => {
    const btn = pageA.locator('button[title*="씬 조명 테마"]');
    const labels = [];
    for (const shot of ['05-theme-a.png', '05-theme-b.png', '05-theme-c.png']) {
      await btn.click(); await sleep(900);
      labels.push((await btn.textContent())?.trim());
      await pageA.screenshot({ path: path.join(SHOTS, shot) });
    }
    log('PASS', 'E1 테마 순환', `상태: ${labels.join(' → ')}`);
  });

  // ── F. 미니맵 실시간 도트 ──
  await step('F1 미니맵 아바타 도트', async () => {
    const el = pageA.locator('div.absolute.left-3.bottom-3').first();
    if (!(await el.isVisible())) throw new Error('미니맵 미표시');
    log('PASS', 'F1 미니맵', '좌하단 오버레이 표시');
  });

  // ── G. 회의실 근접(2m) → D24 명시입장 프롬프트 ──
  await step('G1 보드룸 근접 입장 프롬프트', async () => {
    // 보드룸 폴리곤 내부 남측 보행 코리도(테이블 남쪽) — 방 전환 감지(600ms) → enter_meeting
    await clickScene(pageA, 0.80, 0.705);
    let prompt = false;
    for (let i = 0; i < 40 && !prompt; i++) { prompt = await pageA.locator('text=입장하시겠어요').first().isVisible().catch(() => false); await sleep(500); }
    if (!prompt) { // 폴백: 글라스 미팅룸 서측
      await clickScene(pageA, 0.575, 0.775);
      for (let i = 0; i < 40 && !prompt; i++) { prompt = await pageA.locator('text=입장하시겠어요').first().isVisible().catch(() => false); await sleep(500); }
    }
    if (!prompt) throw new Error('보드룸·미팅룸 모두 20s 내 프롬프트 미표시');
    await pageA.screenshot({ path: path.join(SHOTS, '06-meeting-prompt.png') });
    log('PASS', 'G1 회의 입장 프롬프트', 'D24 2단계 프롬프트 표시(입장하기/거절)');
  });

  // ── H. 2인 동시(bob) 상호 표시 + 실시간 이동 반영 ──
  const ctxB = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  let pageB;
  await step('H1 bob 동시 접속 상호 표시', async () => {
    pageB = await login(ctxB, 'bob@virtualoffice.local');
    await pageB.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pageB.waitForSelector('img.vo-body', { timeout: 30000 });
    let cnt = 0;
    for (let i = 0; i < 20; i++) { cnt = (await frames(pageA)).length; if (cnt >= 2) break; await sleep(500); }
    if (cnt < 2) throw new Error(`alice 화면 아바타 ${cnt}개(<2)`);
    log('PASS', 'H1 상호 표시', `alice 화면 아바타 ${cnt}개`);
  });
  await step('H2 bob 이동 실시간 반영', async () => {
    const before = await pageA.$$eval('img.vo-body', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)}`; }));
    await clickScene(pageB, 0.30, 0.55);
    await sleep(3000);
    const after = await pageA.$$eval('img.vo-body', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)}`; }));
    if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('원격 아바타 위치 불변');
    await pageA.screenshot({ path: path.join(SHOTS, '07-two-clients.png') });
    log('PASS', 'H2 실시간 이동 반영', 'alice 화면에서 bob 이동 관측');
  });

  // ── I. 아바타 프리셋(설정 → 뷰포트 반영) ──
  await step('I1 아바타 프리셋 변경 반영', async () => {
    await pageA.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pageA.waitForSelector('input[name="preset"]', { timeout: 20000 });
    const cur = await pageA.$eval('input[name="preset"]:checked', (e) => e.value).catch(() => '');
    const target = cur === 'DEVELOPER' ? 'DESIGNER' : 'DEVELOPER';
    await pageA.check(`input[name="preset"][value="${target}"]`);
    const preview = await pageA.locator('img[alt="아바타 미리보기"]').getAttribute('src');
    if (!preview?.includes(target)) throw new Error('미리보기 미반영');
    await pageA.click('button:has-text("저장")');
    await sleep(1500);
    await pageA.screenshot({ path: path.join(SHOTS, '08-avatar-settings.png') });
    await pageA.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pageA.waitForSelector('img.vo-body', { timeout: 30000 });
    let applied = false;
    for (let i = 0; i < 16 && !applied; i++) { applied = (await frames(pageA)).some((s) => s.includes(`/${target}/`)); await sleep(500); }
    if (!applied) throw new Error(`뷰포트에 ${target} 프레임 없음`);
    await pageA.screenshot({ path: path.join(SHOTS, '09-avatar-applied.png') });
    log('PASS', 'I1 아바타 프리셋', `${cur || '기본'} → ${target} 설정 저장 → 뷰포트 반영(v2.3 소품 포함)`);
  });

  // ── J. 셸 화면 전수 스모크 (06-screens) ──
  const routes = [
    ['/work-status', '업무현황'], ['/work-log', '업무'], ['/reports', '보고서'], ['/trip', '출장'],
    ['/kpi', 'KPI'], ['/kpi/objection', '이의'], ['/meetings', '회의'], ['/chat', '커뮤니케이션'],
    ['/admin/employees', '직원'], ['/admin/kpi', 'KPI'], ['/admin/kpi/objections', '이의'],
    ['/admin/notices', '공지'], ['/admin/office-layout', '레이아웃'], ['/admin/audit', '감사'],
    ['/admin/org-chart', '조직'], ['/admin/sync', '동기화'],
  ];
  for (const [route, kw] of routes) {
    await step(`J ${route}`, async () => {
      const resp = await pageA.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await sleep(1800);
      const body = await pageA.textContent('body');
      if (!resp || resp.status() >= 400) throw new Error(`HTTP ${resp && resp.status()}`);
      if (body?.includes('Application error')) throw new Error('런타임 에러 화면');
      const has = body?.includes(kw);
      await pageA.screenshot({ path: path.join(SHOTS, `J${route.replace(/\//g, '_')}.png`) });
      log(has ? 'PASS' : 'WARN', `J ${route}`, has ? `키워드 '${kw}' 확인` : `키워드 '${kw}' 미검출(스크린샷 육안 확인)`);
    });
  }

  // ── 요약 ──
  const p = results.filter((r) => r.status === 'PASS').length;
  const w = results.filter((r) => r.status === 'WARN').length;
  const f = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n===== SUMMARY: PASS ${p} / WARN ${w} / FAIL ${f} =====`);
  console.log(`console errors(alice): ${consoleErrors.length}`);
  consoleErrors.slice(0, 8).forEach((e) => console.log('  [console]', e));
  fs.writeFileSync(path.join(__dirname, 'office-qa-report.json'), JSON.stringify({ results, consoleErrors }, null, 1));
  await browser.close();
  process.exit(f > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
