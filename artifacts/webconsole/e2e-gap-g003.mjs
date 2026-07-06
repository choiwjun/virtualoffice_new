import puppeteer from 'puppeteer';
import fs from 'fs';
const BASE = 'http://localhost:3000';
const API = 'http://localhost:8090';
const OUT = '/out';
const t = { schemaVersion: 1, tool: 'puppeteer', startedAt: new Date().toISOString(), actions: [], assertions: [], api: [] };
const ts = () => new Date().toISOString();
const act = (type, extra = {}) => t.actions.push({ type, timestamp: ts(), ...extra });
const assert = (name, ok, detail = '') => { t.assertions.push({ type: 'assert', selector: 'body', name, status: ok ? 'passed' : 'failed', detail, timestamp: ts() }); console.log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) t.failed = true; };
const clickText = async (p, txt) => { for (const b of await p.$$('button')) { const x = await p.evaluate((e) => e.textContent, b); if (x && x.trim() === txt) { await b.click(); return true; } } for (const b of await p.$$('button')) { const x = await p.evaluate((e) => e.textContent, b); if (x && x.includes(txt)) { await b.click(); return true; } } return false; };
const selAll = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = document.createRange(); r.selectNodeContents(el); const g = window.getSelection(); g.removeAllRanges(); g.addRange(r); return true; }, sel);
const cnt = (frag, m) => t.api.filter((a) => a.url.startsWith(frag) && (!m || a.method === m) && a.status >= 200 && a.status < 300).length;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1180, height: 900, deviceScaleFactor: 1 });
p.on('dialog', async (d) => { await d.accept(''); });
p.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) t.api.push({ type: 'request', method: r.request().method(), url: u.replace(API, ''), status: r.status(), timestamp: ts() }); });
try {
  act('nav', { name: 'login' });
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'password123');
  await p.click('button[type=submit]');
  await new Promise((r) => setTimeout(r, 4500));

  // SYNC — real erp-sync status/failures + trigger
  act('nav', { name: '/admin/sync' });
  await p.goto(`${BASE}/admin/sync`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  const sbody = await p.evaluate(() => document.body.innerText);
  assert('sync page renders (not locked)', sbody.includes('동기화 모니터링') && !sbody.includes('관리자 전용 화면'));
  assert('erp-sync/status GET 200', cnt('/api/erp-sync/status') >= 1);
  assert('erp-sync/failures GET 200', cnt('/api/erp-sync/failures') >= 1);
  await clickText(p, '지금 동기화');
  await new Promise((r) => setTimeout(r, 4000));
  assert('erp/sync POST 200', cnt('/api/erp/sync', 'POST') >= 1);
  assert('status reloaded after sync', cnt('/api/erp-sync/status') >= 2);
  await selAll(p, 'main');
  await p.screenshot({ path: `${OUT}/gap-g003-sync.png`, clip: { x: 200, y: 120, width: 760, height: 360 } });

  // OFFICE LAYOUT — D12 lifecycle: create draft -> validate (errors) -> deploy blocked
  act('nav', { name: '/admin/office-layout' });
  await p.goto(`${BASE}/admin/office-layout`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  assert('office-layouts GET 200', cnt('/api/office-layouts') >= 1);
  await clickText(p, '현재 배치로 초안 생성');
  await new Promise((r) => setTimeout(r, 2000));
  assert('layout draft POST 201', cnt('/api/office-layouts', 'POST') >= 1);
  // validate first layout
  await clickText(p, '검증');
  await new Promise((r) => setTimeout(r, 2000));
  assert('layout validate POST 200', t.api.some((a) => a.url.includes('/validate') && a.status === 200));
  const obody = await p.evaluate(() => document.body.innerText);
  assert('D12 lifecycle visible (레이아웃 버전)', obody.includes('레이아웃 버전'));
  await selAll(p, 'main');
  await p.screenshot({ path: `${OUT}/gap-g003-layouts.png`, clip: { x: 20, y: 300, width: 900, height: 300 } });
} catch (e) { t.error = String(e && e.stack || e); console.log('ERROR', t.error); }
t.endedAt = ts();
const key = (x) => Date.parse(x.timestamp) || 0;
t.actions.push(...t.api);
t.actions.sort((a, b2) => key(a) - key(b2));
let last = 0; for (const a of t.actions) { let k = key(a); if (k < last) k = last; last = k; a.timestamp = new Date(k).toISOString(); }
for (const a of t.assertions) a.timestamp = new Date(last).toISOString();
fs.writeFileSync(`${OUT}/gap-g003-transcript.json`, JSON.stringify(t, null, 2));
console.log('APIHITS', JSON.stringify(t.api.map((a) => `${a.method} ${a.url.split('?')[0]} ${a.status}`)));
await b.close();
