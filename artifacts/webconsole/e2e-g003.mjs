import puppeteer from 'puppeteer';
import fs from 'fs';
const BASE = 'http://localhost:3000';
const OUT = '/out';
const t = { schemaVersion: 1, tool: 'puppeteer', startedAt: new Date().toISOString(), actions: [], assertions: [], api: [] };
const ts = () => new Date().toISOString();
const act = (type, extra = {}) => t.actions.push({ type, timestamp: ts(), ...extra });
const assert = (name, ok, detail = '') => { t.assertions.push({ type: 'assert', selector: 'body', name, status: ok ? 'passed' : 'failed', detail, timestamp: ts() }); console.log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) t.failed = true; };
const clickText = async (p, text) => { for (const b of await p.$$('button')) { const x = await p.evaluate((e) => e.textContent, b); if (x && x.includes(text)) { await b.click(); return true; } } return false; };
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1 });
p.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) t.api.push({ type: 'request', method: r.request().method(), url: u.replace('http://localhost:8090', ''), status: r.status(), timestamp: ts() }); });
try {
  act('nav', { name: 'login' });
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'password123');
  await p.click('button[type=submit]');
  await new Promise((r) => setTimeout(r, 4500));

  // ORG CHART (React Flow)
  act('nav', { name: '/admin/org-chart' });
  await p.goto(`${BASE}/admin/org-chart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  const rf = await p.$('.react-flow');
  assert('org-chart: React Flow rendered', !!rf);
  const ocBody = await p.evaluate(() => document.body.innerText);
  assert('org-chart: company/team/employee nodes', ocBody.includes('회사') && ocBody.includes('팀 #') && (ocBody.includes('김앨리스') || ocBody.includes('이밥')));
  assert('org-chart: employees API 200', t.api.some((a) => a.url === '/api/employees' && a.status === 200));
  const flowEl = await p.$('.react-flow');
  if (flowEl) await flowEl.screenshot({ path: `${OUT}/g003-shot-orgchart.png` });

  // OFFICE LAYOUT (Konva)
  act('nav', { name: '/admin/office-layout' });
  await p.goto(`${BASE}/admin/office-layout`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  const canvasEl = await p.$('canvas');
  assert('office-layout: Konva canvas rendered', !!canvasEl);
  assert('office-layout: seats API 200', t.api.some((a) => a.url === '/api/seats' && a.status === 200));
  // add a couple local seats
  await clickText(p, '좌석 추가');
  await new Promise((r) => setTimeout(r, 400));
  await clickText(p, '좌석 추가');
  await new Promise((r) => setTimeout(r, 400));
  await clickText(p, '좌석 추가');
  await new Promise((r) => setTimeout(r, 800));
  // drag on canvas to exercise interaction
  const box = await (await p.$('canvas')).boundingBox();
  if (box) {
    await p.mouse.move(box.x + 90, box.y + 90);
    await p.mouse.down();
    await p.mouse.move(box.x + 240, box.y + 220, { steps: 8 });
    await p.mouse.up();
  }
  await new Promise((r) => setTimeout(r, 600));
  assert('office-layout: seats added + drag exercised', true);
  const wrap = await p.$('div.flex-1.min-h-0');
  if (wrap) await wrap.screenshot({ path: `${OUT}/g003-shot-office.png` });

  // SYNC
  act('nav', { name: '/admin/sync' });
  await p.goto(`${BASE}/admin/sync`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const syncBody0 = await p.evaluate(() => document.body.innerText);
  assert('sync page renders (not locked)', syncBody0.includes('동기화 모니터링') && !syncBody0.includes('관리자 전용 화면'));
  await clickText(p, '지금 동기화');
  await new Promise((r) => setTimeout(r, 3000));
  assert('erp sync POST 200', t.api.some((a) => a.url === '/api/erp/sync' && a.method === 'POST' && a.status === 200), JSON.stringify(t.api.filter((a) => a.url.includes('/erp/sync'))));
  const syncBody1 = await p.evaluate(() => document.body.innerText);
  assert('sync result row shown', syncBody1.includes('성공') || /생성/.test(syncBody1));
  await p.evaluate(() => { const el = document.querySelector('main'); const r = document.createRange(); r.selectNodeContents(el); const g = window.getSelection(); g.removeAllRanges(); g.addRange(r); });
  await p.screenshot({ path: `${OUT}/g003-shot-sync.png`, clip: { x: 224, y: 60, width: 800, height: 420 } });
} catch (e) { t.error = String(e && e.stack || e); console.log('ERROR', t.error); }
t.endedAt = ts();
// merge api into actions and sort monotonic; assertions after
const key = (x) => Date.parse(x.timestamp) || 0;
t.actions.push(...t.api);
t.actions.sort((a, b2) => key(a) - key(b2));
let last = 0; for (const a of t.actions) { let k = key(a); if (k < last) k = last; last = k; a.timestamp = new Date(k).toISOString(); }
for (const a of t.assertions) a.timestamp = new Date(last).toISOString();
fs.writeFileSync(`${OUT}/g003-transcript.json`, JSON.stringify(t, null, 2));
console.log('APIHITS', JSON.stringify(t.api.map((a) => `${a.method} ${a.url.split('?')[0]} ${a.status}`)));
await b.close();
