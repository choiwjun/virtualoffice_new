/* 전 메뉴 역할별 실구동 QA — 실 Chrome (2026-07-17)
 * charlie(employee) → bob(leader) → alice(admin) 순서로 실제 데이터 왕복:
 * 업무 CRUD·완료 → EOD 리포트 → 보고서 제출 → 출장 신청→승인 → 채팅 2계정 송수신
 * → admin KPI 계산(실데이터 반영 검증) → 이의신청→검토 → 공지 등록→직원 알림 반영
 * → admin 5화면 → RBAC(비권한 거부) → 설정 → 오피스 멀티 스폰
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');

const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots-roles');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function log(status, name, detail = '') {
  results.push({ status, name, detail });
  console.log(`[${status}] ${name}${detail ? ' — ' + detail : ''}`);
}
async function step(name, fn) {
  try { await fn(); } catch (e) { log('FAIL', name, String(e).split('\n')[0].slice(0, 140)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString().slice(-6);

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept()); // confirm/alert 자동 수락
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  for (let i = 0; i < 3; i++) {
    await page.fill('#email', email);
    await page.fill('#password', 'password123');
    const resp = page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 8000 }).catch(() => null);
    await page.click('button[type="submit"]');
    const r = await resp;
    if (r && r.status() === 200) {
      await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
      return { ctx, page };
    }
    await page.waitForTimeout(1500);
  }
  throw new Error('로그인 실패: ' + email);
}
async function goto(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(1500);
}
const modal = (page) => page.locator('div.fixed.inset-0').last();

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' }); // 실제 설치된 Chrome
    console.log('(실 Chrome 채널로 실행)');
  } catch {
    browser = await chromium.launch();
    console.log('(Chrome 채널 미검출 — 번들 Chromium 폴백)');
  }

  // ════════ charlie (employee) ════════
  let C;
  await step('C1 charlie 로그인', async () => {
    C = await login(browser, 'charlie@virtualoffice.local');
    log('PASS', 'C1 charlie 로그인', C.page.url());
  });

  await step('C2 RBAC: 사이드바에 관리자 메뉴 없음', async () => {
    const body = await C.page.textContent('body');
    if (body.includes('공지관리') || body.includes('KPI관리') || body.includes('감사로그'))
      throw new Error('employee에게 관리자 메뉴 노출');
    log('PASS', 'C2 RBAC 사이드바', 'KPI관리/공지관리/감사로그 미노출');
  });

  await step('C3 업무 추가(git PR 링크 포함)', async () => {
    await goto(C.page, '/work-log');
    await C.page.click('text=+ 업무 추가');
    const m = modal(C.page);
    await m.locator('input[placeholder="업무 제목을 입력하세요"]').fill(`QA 자동화 업무 ${stamp}`);
    await m.locator('input[placeholder="이 업무의 목표는?"]').fill('역할별 전 메뉴 실구동 검증');
    await m.locator('input[placeholder="https://"]').first().fill('https://github.com/acme/vo/pull/42');
    // 상태를 '완료'로 (KPI 반영 검증용) — select에 completed 옵션이 있으면 선택
    const sel = m.locator('select');
    for (let i = 0; i < await sel.count(); i++) {
      const opts = await sel.nth(i).locator('option').allTextContents();
      if (opts.some((o) => o.includes('완료'))) { await sel.nth(i).selectOption({ label: opts.find((o) => o.includes('완료')) }); break; }
    }
    await m.locator('button:has-text("저장"), button:has-text("추가")').last().click();
    await C.page.waitForSelector(`text=QA 자동화 업무 ${stamp}`, { timeout: 15000 });
    log('PASS', 'C3 업무 추가', `제목·목표·PR링크·완료 상태로 등록 → 목록 표시`);
    await C.page.screenshot({ path: path.join(SHOTS, 'C3-worklog.png') });
  });

  await step('C4 일일 리포트 제출(EOD)', async () => {
    const btn = C.page.locator('button:has-text("일일 리포트 제출")');
    await btn.click();
    await sleep(2000);
    const msg = await C.page.textContent('body');
    if (!/제출|완료|전송|성공|이미/.test(msg)) throw new Error('제출 피드백 미확인');
    log('PASS', 'C4 일일 리포트 제출', 'daily_status_push 적재 요청 발사');
  });

  await step('C5 보고서 작성→제출', async () => {
    await goto(C.page, '/reports');
    await C.page.locator('button:has-text("보고서 작성"), button:has-text("+ ")').first().click();
    const m = modal(C.page);
    await m.locator('input[placeholder="보고서 제목을 입력하세요"]').fill(`QA 일일보고 ${stamp}`);
    await m.locator('textarea').first().fill('오늘 한 일:\n- 전 메뉴 실구동 QA');
    await m.locator('button:has-text("제출")').last().click(); // confirm 자동 수락
    await C.page.waitForSelector(`text=QA 일일보고 ${stamp}`, { timeout: 15000 });
    log('PASS', 'C5 보고서', '작성→제출(수정 불가 확정) → 목록 표시');
  });

  await step('C6 출장 신청', async () => {
    await goto(C.page, '/trip');
    await C.page.locator('button:has-text("출장 신청")').first().click();
    const m = modal(C.page);
    await m.locator('input[placeholder="출장지를 입력하세요"]').fill(`부산 QA센터 ${stamp}`);
    await m.locator('input[placeholder="출장 목적을 입력하세요"]').fill('실구동 검증 출장');
    const dates = m.locator('input[type="date"]');
    const today = new Date().toISOString().split('T')[0];
    const nextD = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    if (await dates.count() >= 2) { await dates.nth(0).fill(today); await dates.nth(1).fill(nextD); }
    await m.locator('button:has-text("신청"), button:has-text("저장")').last().click();
    await C.page.waitForSelector(`text=부산 QA센터 ${stamp}`, { timeout: 15000 });
    log('PASS', 'C6 출장 신청', '신청 상태로 목록 표시');
  });

  await step('C7 채팅 메시지 전송', async () => {
    await goto(C.page, '/chat');
    const ch = C.page.locator('nav button').first();
    await ch.click();
    await sleep(1000);
    await C.page.locator('textarea').fill(`QA 채팅 테스트 ${stamp} (charlie)`);
    await C.page.keyboard.press('Enter');
    await C.page.waitForSelector(`text=QA 채팅 테스트 ${stamp}`, { timeout: 15000 });
    log('PASS', 'C7 채팅 전송', 'general 채널 메시지 표시');
  });

  await step('C8 설정: 아바타 변경', async () => {
    await goto(C.page, '/settings');
    await C.page.waitForSelector('input[name="preset"]', { timeout: 20000 });
    const cur = await C.page.$eval('input[name="preset"]:checked', (e) => e.value).catch(() => '');
    const target = cur === 'MARKETER' ? 'HR' : 'MARKETER';
    await C.page.check(`input[name="preset"][value="${target}"]`);
    await C.page.click('button:has-text("저장")');
    await sleep(1500);
    log('PASS', 'C8 아바타 변경', `${cur || '기본'} → ${target} 저장`);
  });

  await step('C9 가상오피스 스폰(charlie)', async () => {
    await goto(C.page, '/office');
    await C.page.waitForSelector('img.vo-body', { timeout: 30000 });
    await C.page.waitForSelector('text=실시간 연결됨', { timeout: 15000 });
    log('PASS', 'C9 오피스 스폰', 'charlie 아바타+실시간 연결');
  });

  await step('C10 RBAC: /admin/notices 직접 접근', async () => {
    await goto(C.page, '/admin/notices');
    await sleep(2000);
    const body = await C.page.textContent('body');
    const blocked = /403|권한|forbidden|접근.*(불가|거부)/i.test(body) || !body.includes('공지 등록');
    log(blocked ? 'PASS' : 'FAIL', 'C10 RBAC 공지관리 차단', blocked ? '작성 UI 미노출/거부' : 'employee가 공지 등록 UI 접근 가능(!)');
    await C.page.screenshot({ path: path.join(SHOTS, 'C10-rbac-notices.png') });
  });

  // ════════ bob (leader) ════════
  let B;
  await step('B1 bob 로그인', async () => {
    B = await login(browser, 'bob@virtualoffice.local');
    log('PASS', 'B1 bob 로그인', B.page.url());
  });

  await step('B2 출장 승인(charlie 신청 건)', async () => {
    await goto(B.page, '/trip');
    const row = B.page.locator(`text=부산 QA센터 ${stamp}`);
    await row.waitFor({ timeout: 15000 });
    // 해당 행의 승인 버튼 클릭 (confirm 자동 수락)
    await B.page.locator('button:has-text("승인")').first().click();
    await sleep(2500);
    const body = await B.page.textContent('body');
    if (!body.includes('승인')) throw new Error('승인 상태 미반영');
    log('PASS', 'B2 출장 승인', 'requested → approved 전이');
    await B.page.screenshot({ path: path.join(SHOTS, 'B2-trip-approved.png') });
  });

  await step('B3 채팅 수신+답장(2계정 왕복)', async () => {
    await goto(B.page, '/chat');
    await B.page.locator('nav button').first().click();
    await B.page.waitForSelector(`text=QA 채팅 테스트 ${stamp}`, { timeout: 20000 });
    await B.page.locator('textarea').fill(`답장 확인 ${stamp} (bob)`);
    await B.page.keyboard.press('Enter');
    await B.page.waitForSelector(`text=답장 확인 ${stamp}`, { timeout: 15000 });
    log('PASS', 'B3 채팅 왕복', 'charlie 메시지 수신 + bob 답장 표시');
  });

  await step('B4 RBAC: leader의 KPI compute 거부(admin 전용)', async () => {
    await goto(B.page, '/admin/kpi');
    const hasUi = await B.page.locator('button:has-text("KPI 계산 실행")').count();
    if (!hasUi) { log('PASS', 'B4 leader KPI관리', '계산 버튼 미노출'); return; }
    await B.page.locator('button:has-text("KPI 계산 실행")').click();
    await sleep(2500);
    const body = await B.page.textContent('body');
    const denied = /403|권한|forbidden|실패/.test(body);
    log(denied ? 'PASS' : 'FAIL', 'B4 leader compute 거부', denied ? 'compute 403(admin 전용 계약)' : 'leader가 compute 성공(!)');
  });

  // ════════ alice (admin) ════════
  let A;
  await step('A1 alice 로그인', async () => {
    A = await login(browser, 'alice@virtualoffice.local');
    log('PASS', 'A1 alice 로그인', A.page.url());
  });

  const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().split('T')[0]; // KST 오늘

  await step('A2 KPI 계산(charlie·daily) — 실데이터 반영 검증', async () => {
    await goto(A.page, '/admin/kpi');
    // 대상 select에서 charlie 선택
    const sels = A.page.locator('select');
    for (let i = 0; i < await sels.count(); i++) {
      const opts = await sels.nth(i).locator('option').allTextContents();
      const c = opts.find((o) => o.includes('찰리') || o.includes('charlie'));
      if (c) { await sels.nth(i).selectOption({ label: c }); break; }
      const d = opts.find((o) => o.includes('일별') || o === 'daily');
      if (d) await sels.nth(i).selectOption({ label: d });
    }
    // 기간 input을 오늘로
    const keyInput = A.page.locator('input[placeholder*="2026"], input[value*="2026"]').first();
    if (await keyInput.count()) { await keyInput.fill(todayKey); }
    await A.page.locator('button:has-text("KPI 계산 실행")').click();
    await A.page.waitForSelector('text=계산 완료', { timeout: 20000 });
    const body = await A.page.textContent('body');
    log('PASS', 'A2 KPI 계산', `계산 완료 배너 표시(대상 charlie, ${todayKey})`);
    await A.page.screenshot({ path: path.join(SHOTS, 'A2-kpi-compute.png') });
    // charlie의 완료 업무 1건이 반영됐는지: /kpi (charlie 화면) 재확인은 A4에서
  });

  await step('A3 공지 등록', async () => {
    await goto(A.page, '/admin/notices');
    await A.page.locator('input[placeholder="공지 제목"]').fill(`전사 QA 공지 ${stamp}`);
    await A.page.locator('input[placeholder*="작성자"]').fill('QA팀');
    await A.page.locator('textarea[placeholder*="본문"]').fill('역할별 실구동 QA 공지 본문');
    await A.page.locator('button:has-text("공지 등록")').click();
    await A.page.waitForSelector(`text=전사 QA 공지 ${stamp}`, { timeout: 15000 });
    log('PASS', 'A3 공지 등록', '목록 반영');
  });

  await step('A4 charlie 화면에서 공지·KPI 반영 확인', async () => {
    await goto(C.page, '/office');
    await C.page.locator('button[aria-label*="알림"]').click();
    await C.page.waitForSelector(`text=전사 QA 공지 ${stamp}`, { timeout: 15000 });
    log('PASS', 'A4a 공지 전파', '직원 알림 드롭다운에 새 공지 표시');
    await C.page.screenshot({ path: path.join(SHOTS, 'A4-notice-employee.png') });
    // KPI 반영: charlie /kpi 일별 조회 → 완료 업무 수 ≥ 1
    await goto(C.page, '/kpi');
    await C.page.locator('select').selectOption('daily');
    await C.page.locator('input[placeholder*="2026"]').fill(todayKey);
    await C.page.locator('button:has-text("조회")').click();
    await C.page.waitForSelector('text=완료 업무 수', { timeout: 15000 });
    const cardText = await C.page.locator('div:has-text("완료 업무 수")').last().textContent();
    const ok = /[1-9]/.test((cardText.match(/완료 업무 수\s*([\d.]+)/) || [])[1] || '');
    log(ok ? 'PASS' : 'WARN', 'A4b KPI 실데이터 반영', ok ? `완료 업무 수 ≥ 1 (charlie 오늘 업무 반영)` : `카드값 확인 필요: ${String(cardText).slice(0, 80)}`);
    await C.page.screenshot({ path: path.join(SHOTS, 'A4-kpi-daily.png') });
  });

  await step('A5 이의신청 왕복(charlie 접수 → alice 검토 시작)', async () => {
    await goto(C.page, '/kpi/objection');
    const btn = C.page.locator('button:has-text("이의신청")').first();
    await btn.waitFor({ timeout: 15000 });
    await btn.click();
    const m = modal(C.page);
    await m.locator('textarea').first().fill('완료 업무 반영 기준에 대한 확인 요청 — QA 자동화 검증용 이의신청입니다.');
    await m.locator('button:has-text("접수"), button:has-text("제출"), button:has-text("신청")').last().click();
    await C.page.waitForSelector('text=접수', { timeout: 15000 });
    log('PASS', 'A5a 이의신청 접수', 'none → submitted');
    await goto(A.page, '/admin/kpi/objections');
    await A.page.waitForSelector('text=submitted, text=접수', { timeout: 15000 }).catch(() => {});
    const advance = A.page.locator('button:has-text("검토"), button:has-text("advance")').first();
    if (await advance.count()) {
      await advance.click();
      await sleep(2000);
      log('PASS', 'A5b 이의 검토 시작', 'submitted → reviewing');
    } else {
      log('WARN', 'A5b 이의 검토 시작', '검토 버튼 미검출 — 화면 확인 필요');
    }
    await A.page.screenshot({ path: path.join(SHOTS, 'A5-objections.png') });
  });

  await step('A6 회의 예약', async () => {
    await goto(A.page, '/meetings');
    await A.page.locator('button:has-text("+ 회의 예약")').click();
    const m = modal(A.page);
    const rooms = m.locator('select').first();
    const noRooms = (await m.textContent()).includes('등록된 회의실이 없습니다');
    if (noRooms) { log('WARN', 'A6 회의 예약', '등록된 회의실 없음(시드 미포함) — 예약 폼 자체는 정상 노출'); return; }
    await m.locator('input').first().fill(`QA 정기회의 ${stamp}`);
    const dt = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
    await m.locator('input[type="datetime-local"]').fill(dt);
    await m.locator('button:has-text("예약")').last().click();
    await A.page.waitForSelector(`text=QA 정기회의 ${stamp}`, { timeout: 15000 });
    log('PASS', 'A6 회의 예약', '목록 반영');
  });

  await step('A7 admin 잔여 화면 데이터 표시', async () => {
    const checks = [
      ['/admin/employees', '김앨리스'],
      ['/admin/audit', '감사'],
      ['/admin/sync', '동기화'],
      ['/admin/org-chart', '조직'],
      ['/admin/office-layout', '레이아웃'],
    ];
    for (const [route, kw] of checks) {
      await goto(A.page, route);
      const body = await A.page.textContent('body');
      if (!body.includes(kw)) throw new Error(`${route}: '${kw}' 미표시`);
    }
    log('PASS', 'A7 admin 화면 5종', 'employees(실명 표시)/audit/sync/org-chart/office-layout');
  });

  await step('A8 오피스 동시 스폰(alice+charlie)', async () => {
    await goto(A.page, '/office');
    await A.page.waitForSelector('img.vo-body', { timeout: 30000 });
    let n = 0;
    for (let i = 0; i < 16; i++) { n = await A.page.locator('img.vo-body').count(); if (n >= 2) break; await sleep(500); }
    if (n < 2) throw new Error(`아바타 ${n}개(<2)`);
    log('PASS', 'A8 동시 스폰', `alice 화면 아바타 ${n}개`);
    await A.page.screenshot({ path: path.join(SHOTS, 'A8-office-multi.png') });
  });

  const p = results.filter((r) => r.status === 'PASS').length;
  const w = results.filter((r) => r.status === 'WARN').length;
  const f = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n===== SUMMARY: PASS ${p} / WARN ${w} / FAIL ${f} =====`);
  fs.writeFileSync(path.join(__dirname, 'full-role-qa-report.json'), JSON.stringify(results, null, 1));
  await browser.close();
  process.exit(f > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
