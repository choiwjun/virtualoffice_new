import puppeteer from 'puppeteer';
import fs from 'fs';
const BASE = 'http://localhost:3000';
const OUT = '/out';
const t = { schemaVersion: 1, tool: 'puppeteer', startedAt: new Date().toISOString(), actions: [], assertions: [], api: [] };
const ts = () => new Date().toISOString();
const assert = (name, ok, detail = '') => { t.assertions.push({ type: 'assert', selector: 'body', name, status: ok ? 'passed' : 'failed', detail, timestamp: ts() }); console.log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) t.failed = true; };
const clickText = async (p, text) => { for (const btn of await p.$$('button')) { const x = await p.evaluate((e) => e.textContent, btn); if (x && x.includes(text) && !(await p.evaluate((e) => e.disabled, btn))) { await btn.click(); return true; } } return false; };
const bodyText = (p) => p.evaluate(() => document.body.innerText);

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1180, height: 800, deviceScaleFactor: 1 });
p.on('dialog', async (d) => { await d.accept(''); }); // confirm->OK, prompt->empty(no revised score/note)
p.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) t.api.push({ type: 'request', method: r.request().method(), url: u.replace('http://localhost:8090', ''), status: r.status(), timestamp: ts() }); });

async function login() {
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'password123');
  await p.click('button[type=submit]');
  await new Promise((r) => setTimeout(r, 4500));
}

try {
  await login();
  // 1) admin/kpi: compute + finalize one metric
  await p.goto(`${BASE}/admin/kpi`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await clickText(p, 'KPI 계산 실행');
  await new Promise((r) => setTimeout(r, 3500));
  const finalizeClicked = await clickText(p, '확정');
  await new Promise((r) => setTimeout(r, 2500));
  const finalizeOk = t.api.some((a) => a.url.includes('/finalize') && a.status === 200);
  assert('KPI finalize 200 (확정)', finalizeClicked && finalizeOk, JSON.stringify(t.api.filter((a) => a.url.includes('finalize'))));

  // 2) /kpi/objection: submit objection on finalized result
  await p.goto(`${BASE}/kpi/objection`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const objBody0 = await bodyText(p);
  assert('finalized result available for objection', !objBody0.includes('확정된 KPI 결과가 없습니다'));
  await clickText(p, '이의신청'); // opens modal
  await new Promise((r) => setTimeout(r, 800));
  const ta = await p.$('textarea');
  if (ta) await ta.type('결정론 계산 결과에 대해 근거를 들어 이의를 제기합니다. 관련 업무 산출물 반영 누락으로 판단됩니다.');
  await clickText(p, '접수');
  await new Promise((r) => setTimeout(r, 2500));
  const submitOk = t.api.some((a) => a.url.includes('/objections') && !a.url.includes('review') && a.method === 'POST' && a.status === 200);
  assert('objection submit POST 200 (none->submitted)', submitOk, JSON.stringify(t.api.filter((a) => a.url.includes('objections') && !a.url.includes('review'))));

  // 3) admin/kpi/objections: advance -> resolve
  await p.goto(`${BASE}/admin/kpi/objections`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3500));
  const aobjBody = await bodyText(p);
  assert('objection appears in admin review list', aobjBody.includes('접수됨') || aobjBody.includes('검토중'));
  await clickText(p, '검토 시작'); // advance submitted->reviewing
  await new Promise((r) => setTimeout(r, 2500));
  const advanceOk = t.api.some((a) => a.url.includes('/objections/review') && a.status === 200);
  assert('objection advance (submitted->reviewing) 200', advanceOk);
  await new Promise((r) => setTimeout(r, 800));
  await clickText(p, '처리 완료'); // resolve reviewing->resolved (dialogs auto-accepted empty)
  await new Promise((r) => setTimeout(r, 2500));
  const reviewCalls = t.api.filter((a) => a.url.includes('/objections/review') && a.status === 200);
  assert('objection resolve (reviewing->resolved) 200', reviewCalls.length >= 2, `review calls=${reviewCalls.length}`);
  const finalBody = await bodyText(p);
  assert('resolved state visible', finalBody.includes('처리완료') || finalBody.includes('resolved'));
  // dense screenshot of objection review list
  await p.evaluate(() => { const el = document.querySelector('main') || document.body; const r = document.createRange(); r.selectNodeContents(el); const g = window.getSelection(); g.removeAllRanges(); g.addRange(r); });
  await p.screenshot({ path: `${OUT}/g002-shot-objections.png`, clip: { x: 224, y: 60, width: 720, height: 320 } });
} catch (e) { t.error = String(e && e.stack || e); console.log('ERROR', t.error); }
t.endedAt = ts();
t.actions.push(...t.api);
fs.writeFileSync(`${OUT}/g002-objection-transcript.json`, JSON.stringify(t, null, 2));
console.log('APIHITS', JSON.stringify(t.api.map((a) => `${a.method} ${a.url.split('?')[0]} ${a.status}`)));
await b.close();
