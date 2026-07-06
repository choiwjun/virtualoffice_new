import puppeteer from 'puppeteer';
import fs from 'fs';
const BASE = 'http://localhost:3000';
const OUT = '/out';
const t = { schemaVersion: 1, tool: 'puppeteer', startedAt: new Date().toISOString(), actions: [], assertions: [], api: [] };
const ts = () => new Date().toISOString();
const act = (type, extra = {}) => { t.actions.push({ type, timestamp: ts(), ...extra }); };
const assert = (name, ok, detail = '') => { t.assertions.push({ type: 'assert', selector: 'body', name, status: ok ? 'passed' : 'failed', detail, timestamp: ts() }); console.log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) t.failed = true; };
const selAll = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = document.createRange(); r.selectNodeContents(el); const g = window.getSelection(); g.removeAllRanges(); g.addRange(r); return true; }, sel);

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1180, height: 800, deviceScaleFactor: 1 });
p.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) t.api.push({ type: 'request', method: r.request().method(), url: u.replace('http://localhost:8090', ''), status: r.status(), timestamp: ts() }); });

try {
  act('nav', { name: 'login' });
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'password123');
  await p.click('button[type=submit]');
  await new Promise((r) => setTimeout(r, 4500));

  // ADMIN KPI: compute
  act('nav', { name: '/admin/kpi' });
  await p.goto(`${BASE}/admin/kpi`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const kpiBody = await p.evaluate(() => document.body.innerText);
  assert('admin/kpi renders (not locked)', kpiBody.includes('KPI 관리') && !kpiBody.includes('관리자 전용 화면'));
  // click compute
  const btns = await p.$$('button');
  for (const btn of btns) { const txt = await p.evaluate((e) => e.textContent, btn); if (txt && txt.includes('KPI 계산 실행')) { act('click', { selector: 'button:compute' }); await btn.click(); break; } }
  await new Promise((r) => setTimeout(r, 4000));
  const afterCompute = await p.evaluate(() => document.body.innerText);
  const computed = t.api.some((a) => a.url.includes('/kpi-results/compute') && a.status === 200);
  assert('compute POST 200', computed, JSON.stringify(t.api.filter((a) => a.url.includes('compute'))));
  assert('metric rows shown (협업 종합 or 분기 종합)', afterCompute.includes('협업 종합 점수') || afterCompute.includes('분기 종합 점수') || afterCompute.includes('완료 업무 수'));
  await selAll(p, 'table');
  const tbl = await p.$('table');
  if (tbl) await tbl.screenshot({ path: `${OUT}/g002-shot-adminkpi-table.png` });

  // MY KPI
  act('nav', { name: '/kpi' });
  await p.goto(`${BASE}/kpi`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const myKpi = await p.evaluate(() => document.body.innerText);
  assert('my /kpi renders', myKpi.includes('내 KPI'));
  const gotResults = t.api.some((a) => a.url.startsWith('/api/kpi-results?') && a.status === 200);
  assert('my kpi list GET 200', gotResults);

  // MEETINGS
  act('nav', { name: '/meetings' });
  await p.goto(`${BASE}/meetings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const mt = await p.evaluate(() => document.body.innerText);
  assert('/meetings renders', mt.includes('회의 / 회의록') || mt.includes('회의'));
  assert('meetings GET 200', t.api.some((a) => a.url.startsWith('/api/meetings') && a.status === 200));
  // open create modal
  for (const btn of await p.$$('button')) { const txt = await p.evaluate((e) => e.textContent, btn); if (txt && txt.includes('회의 예약')) { await btn.click(); break; } }
  await new Promise((r) => setTimeout(r, 1000));
  const modalOpen = await p.$('.fixed.inset-0');
  assert('meeting create modal opens', !!modalOpen);
  if (modalOpen) { await selAll(p, '.fixed.inset-0 > div'); const card = await p.$('.fixed.inset-0 > div'); if (card) await card.screenshot({ path: `${OUT}/g002-shot-meeting-modal.png` }); }

  // OBJECTION (employee view route)
  act('nav', { name: '/kpi/objection' });
  await p.goto(`${BASE}/kpi/objection`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const obj = await p.evaluate(() => document.body.innerText);
  assert('/kpi/objection renders', obj.includes('KPI 이의신청'));

  // ADMIN OBJECTIONS
  act('nav', { name: '/admin/kpi/objections' });
  await p.goto(`${BASE}/admin/kpi/objections`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  const aobj = await p.evaluate(() => document.body.innerText);
  assert('/admin/kpi/objections renders (not locked)', aobj.includes('이의신청 재검토') && !aobj.includes('관리자 전용 화면'));
} catch (e) {
  t.error = String(e && e.stack || e);
  console.log('ERROR', t.error);
}
t.endedAt = ts();
t.actions.push(...t.api);
fs.writeFileSync(`${OUT}/g002-transcript.json`, JSON.stringify(t, null, 2));
console.log('APIHITS', JSON.stringify(t.api.map((a) => `${a.method} ${a.url} ${a.status}`)));
await b.close();
