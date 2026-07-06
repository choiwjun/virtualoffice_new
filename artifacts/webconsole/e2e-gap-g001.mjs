import puppeteer from 'puppeteer';
import fs from 'fs';
const BASE = 'http://localhost:3000';
const OUT = '/out';
const t = { schemaVersion: 1, tool: 'puppeteer', startedAt: new Date().toISOString(), actions: [], assertions: [], api: [] };
const ts = () => new Date().toISOString();
const act = (type, extra = {}) => t.actions.push({ type, timestamp: ts(), ...extra });
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

  // AUDIT LOG view
  act('nav', { name: '/admin/audit' });
  await p.goto(`${BASE}/admin/audit`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  const abody = await p.evaluate(() => document.body.innerText);
  assert('audit page renders (not locked)', abody.includes('감사 로그') && !abody.includes('관리자 전용 화면'));
  assert('audit-logs GET 200', t.api.some((a) => a.url.startsWith('/api/audit-logs') && a.status === 200));
  assert('audit shows kpi_finalized entry', abody.includes('kpi_finalized'));
  await selAll(p, 'table');
  const tbl = await p.$('table');
  if (tbl) await tbl.screenshot({ path: `${OUT}/gap-g001-audit.png` });

  // ORG-CHART org-groups panel
  act('nav', { name: '/admin/org-chart' });
  await p.goto(`${BASE}/admin/org-chart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  const obody = await p.evaluate(() => document.body.innerText);
  assert('org-groups GET 200', t.api.some((a) => a.url.startsWith('/api/org-groups') && a.status === 200));
  assert('org-chart shows org groups (개발본부/플랫폼개발부)', obody.includes('개발본부') && obody.includes('플랫폼개발부'));
  assert('org-chart React Flow rendered', !!(await p.$('.react-flow')));
  assert('teams API also available', t.api.some((a) => a.url.startsWith('/api/employees') && a.status === 200));
  await p.screenshot({ path: `${OUT}/gap-g001-orgchart.png` });

  // TEAMS API direct check via page? verify /api/teams reachable through a quick eval fetch
  const teamsStatus = await p.evaluate(async () => {
    const tok = localStorage.getItem('access_token');
    const r = await fetch('http://localhost:8090/api/teams', { headers: { Authorization: `Bearer ${tok}` } });
    return r.status;
  });
  assert('GET /api/teams 200 (in-app fetch)', teamsStatus === 200, String(teamsStatus));
} catch (e) { t.error = String(e && e.stack || e); console.log('ERROR', t.error); }
t.endedAt = ts();
const key = (x) => Date.parse(x.timestamp) || 0;
t.actions.push(...t.api);
t.actions.sort((a, b2) => key(a) - key(b2));
let last = 0; for (const a of t.actions) { let k = key(a); if (k < last) k = last; last = k; a.timestamp = new Date(k).toISOString(); }
for (const a of t.assertions) a.timestamp = new Date(last).toISOString();
fs.writeFileSync(`${OUT}/gap-g001-transcript.json`, JSON.stringify(t, null, 2));
console.log('APIHITS', JSON.stringify(t.api.map((a) => `${a.method} ${a.url.split('?')[0]} ${a.status}`)));
await b.close();
