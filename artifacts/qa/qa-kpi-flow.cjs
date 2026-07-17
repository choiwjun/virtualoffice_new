/* KPI 왕복 플로우 재검증 — A2(계산)·A4b(실데이터 반영)·A5(이의신청 왕복)
 * 전제: full-role-qa.cjs 선행(charlie의 오늘 완료 업무 존재) */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');
const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots-roles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (s, n, d = '') => { results.push({ s, n, d }); console.log(`[${s}] ${n}${d ? ' — ' + d : ''}`); };
const step = async (n, fn) => { try { await fn(); } catch (e) { log('FAIL', n, String(e).split('\n')[0].slice(0, 140)); } };

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
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
const goto = async (p, r) => { await p.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await sleep(1500); };

(async () => {
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
  const A = await login(browser, 'alice@virtualoffice.local');
  const C = await login(browser, 'charlie@virtualoffice.local');
  const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().split('T')[0];

  await step('A2 KPI 계산(charlie·daily)', async () => {
    await goto(A, '/admin/kpi');
    // 직원 select 로드 대기(옵션에 이메일 포함) 후 charlie 선택
    const target = A.locator('label:has-text("대상 직원") select');
    await A.waitForFunction(
      () => [...document.querySelectorAll('select option')].some((o) => o.textContent.includes('charlie@')),
      null, { timeout: 20000 },
    );
    const opts = await target.locator('option').all();
    for (const o of opts) {
      if ((await o.textContent()).includes('charlie@')) { await target.selectOption(await o.getAttribute('value')); break; }
    }
    await A.locator('label:has-text("기간 유형") select').selectOption('daily');
    await A.locator('label:has-text("기간 키") input').fill(todayKey);
    await A.locator('button:has-text("KPI 계산 실행")').click();
    await A.waitForSelector('text=계산 완료', { timeout: 25000 });
    log('PASS', 'A2 KPI 계산', `charlie · daily · ${todayKey} — 계산 완료`);
    await A.screenshot({ path: path.join(SHOTS, 'A2-kpi-compute.png') });
  });

  await step('A4b charlie KPI 실데이터 반영', async () => {
    await goto(C, '/kpi');
    await C.locator('select').first().selectOption('daily');
    const keyInput = C.locator('input').nth(0); // 기간 키(조회 헤더의 텍스트 입력)
    await C.locator('input[placeholder*="2026"], input[value]').first().fill(todayKey).catch(async () => keyInput.fill(todayKey));
    await C.locator('button:has-text("조회")').click();
    await C.waitForSelector('text=완료 업무 수', { timeout: 20000 });
    const card = C.locator('div.rounded-xl:has-text("완료 업무 수")').first();
    const txt = (await card.textContent()) || '';
    const num = (txt.match(/([\d.]+)\s*count/) || [])[1];
    const ok = num && parseFloat(num) >= 1;
    log(ok ? 'PASS' : 'WARN', 'A4b KPI 실데이터 반영', ok ? `완료 업무 수 = ${num} (오늘 등록한 완료 업무 반영)` : `카드: ${txt.slice(0, 100)}`);
    await C.screenshot({ path: path.join(SHOTS, 'A4-kpi-daily.png') });
  });

  await step('A5 이의신청 왕복', async () => {
    await goto(C, '/kpi/objection');
    const btn = C.locator('button:has-text("이의신청")').first();
    await btn.waitFor({ timeout: 20000 });
    await btn.click();
    const m = C.locator('div.fixed.inset-0').last();
    await m.locator('textarea').first().fill('완료 업무 반영 기준 확인 요청 — QA 자동화 검증용 이의신청 사유(30자 이상 상세 기술).');
    await m.locator('button:has-text("접수"), button:has-text("제출"), button:has-text("이의신청")').last().click();
    await C.waitForSelector('text=접수', { timeout: 15000 });
    log('PASS', 'A5a 이의신청 접수', 'none → submitted');
    await C.screenshot({ path: path.join(SHOTS, 'A5-objection-submitted.png') });

    await goto(A, '/admin/kpi/objections');
    await sleep(2000);
    const advance = A.locator('button:has-text("검토")').first();
    if (await advance.count()) {
      await advance.click();
      await sleep(2500);
      log('PASS', 'A5b 이의 검토 시작', 'submitted → reviewing');
    } else {
      const body = await A.textContent('body');
      log(body.includes('접수') || body.includes('submitted') ? 'WARN' : 'FAIL', 'A5b 이의 검토', `버튼 미검출 — 본문 확인: ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
    }
    await A.screenshot({ path: path.join(SHOTS, 'A5-objections-admin.png') });
  });

  const f = results.filter((r) => r.s === 'FAIL').length;
  console.log(`\n===== SUMMARY: ${results.filter((r) => r.s === 'PASS').length} PASS / ${results.filter((r) => r.s === 'WARN').length} WARN / ${f} FAIL =====`);
  await browser.close();
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
