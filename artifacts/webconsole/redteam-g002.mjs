import puppeteer from 'puppeteer';
import fs from 'fs';
const BASE = 'http://localhost:3000';
const OUT = '/out';
const t = { schemaVersion: 1, tool: 'puppeteer', actions: [{ type: 'nav', name: 'charlie-login', timestamp: new Date().toISOString() }], assertions: [] };
const ts = () => new Date().toISOString();
const assert = (n, ok, d = '') => { t.assertions.push({ type: 'assert', selector: 'body', name: n, status: ok ? 'passed' : 'failed', detail: d, timestamp: ts() }); console.log(ok ? 'PASS' : 'FAIL', n, d); if (!ok) t.failed = true; };
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 720, deviceScaleFactor: 1 });
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'charlie@virtualoffice.local'); // role: employee
  await p.type('#password', 'password123');
  await p.click('button[type=submit]');
  await new Promise((r) => setTimeout(r, 4500));
  // employee hitting admin KPI -> locked
  await p.goto(`${BASE}/admin/kpi`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const a = await p.evaluate(() => document.body.innerText);
  assert('employee blocked from /admin/kpi (관리자 전용)', a.includes('관리자 전용 화면'), a.slice(0, 80));
  await p.goto(`${BASE}/admin/kpi/objections`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const c = await p.evaluate(() => document.body.innerText);
  assert('employee blocked from /admin/kpi/objections', c.includes('관리자 전용 화면'), c.slice(0, 80));
  // employee CAN see own /kpi
  await p.goto(`${BASE}/kpi`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
  const k = await p.evaluate(() => document.body.innerText);
  assert('employee can access own /kpi', k.includes('내 KPI'));
} catch (e) { t.error = String(e); console.log('ERROR', String(e).slice(0, 200)); }
fs.writeFileSync(`${OUT}/g002-redteam-transcript.json`, JSON.stringify(t, null, 2));
await b.close();
