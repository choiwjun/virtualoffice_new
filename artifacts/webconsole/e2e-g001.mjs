import puppeteer from 'puppeteer';
import fs from 'fs';

const BASE = 'http://localhost:3000';
const OUT = '/out';
const transcript = { startedAt: new Date().toISOString(), steps: [], api: [], console: [], asserts: [] };
const step = (name, extra = {}) => { transcript.steps.push({ t: new Date().toISOString(), name, ...extra }); console.log('STEP', name, JSON.stringify(extra)); };
const assert = (name, ok, detail = '') => { transcript.asserts.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) transcript.failed = true; };

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
p.on('console', (m) => transcript.console.push({ type: m.type(), text: m.text().slice(0, 300) }));
p.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) transcript.api.push({ method: r.request().method(), url: u.replace('http://localhost:8090', ''), status: r.status() }); });

try {
  // 1) LOGIN page
  step('goto /login');
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#email', { timeout: 15000 });
  assert('login form renders', !!(await p.$('#email')) && !!(await p.$('#password')));

  // 1b) wrong password -> error
  step('wrong password attempt');
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'wrongpass');
  await p.click('button[type=submit]');
  await new Promise((r) => setTimeout(r, 2500));
  const errText = await p.evaluate(() => document.body.innerText);
  assert('wrong password shows error', /오류|만료|다시/.test(errText), errText.match(/이메일 또는 비밀번호 오류/)?.[0] || '(no match)');
  await p.screenshot({ path: `${OUT}/g001-01-login-error.png` });

  // 2) correct login
  step('correct login');
  await p.evaluate(() => { document.querySelector('#email').value = ''; document.querySelector('#password').value = ''; });
  await p.click('#email', { clickCount: 3 }); await p.type('#email', 'alice@virtualoffice.local');
  await p.click('#password', { clickCount: 3 }); await p.type('#password', 'password123');
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    p.click('button[type=submit]'),
  ]);
  await new Promise((r) => setTimeout(r, 3000));
  const url1 = p.url();
  step('after login', { url: url1 });
  assert('redirected to /admin/employees', url1.includes('/admin/employees'), url1);

  // 3) employees directory
  await p.waitForSelector('table, [data-testid], .grid', { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const empBody = await p.evaluate(() => document.body.innerText);
  assert('employees: 김앨리스 present', empBody.includes('김앨리스'));
  assert('employees: 이밥 present', empBody.includes('이밥'));
  assert('employees: 박찰리 present', empBody.includes('박찰리'));
  assert('sidebar shows admin menus (조직도)', empBody.includes('조직도') && empBody.includes('KPI 관리'));
  await p.screenshot({ path: `${OUT}/g001-02-employees.png`, fullPage: false });

  // 3b) search filter
  const searchSel = await p.$('input[type=text], input[type=search], input[placeholder]');
  if (searchSel) { await searchSel.type('앨리스'); await new Promise((r) => setTimeout(r, 800)); const afterSearch = await p.evaluate(() => document.body.innerText); assert('search filters to 김앨리스', afterSearch.includes('김앨리스')); await p.screenshot({ path: `${OUT}/g001-03-employees-search.png` }); }

  // 4) work-log
  step('goto /work-log');
  await p.goto(`${BASE}/work-log`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  await new Promise((r) => setTimeout(r, 2500));
  const url2 = p.url();
  assert('work-log reachable (not bounced to login)', url2.includes('/work-log'), url2);
  const wlBody = await p.evaluate(() => document.body.innerText);
  assert('work-log renders content', wlBody.length > 100 && !/404|not found/i.test(wlBody), `len=${wlBody.length}`);
  await p.screenshot({ path: `${OUT}/g001-04-worklog.png`, fullPage: false });
} catch (e) {
  transcript.error = String(e && e.stack || e);
  console.log('ERROR', transcript.error);
  await p.screenshot({ path: `${OUT}/g001-error.png` }).catch(() => {});
}

transcript.endedAt = new Date().toISOString();
fs.writeFileSync(`${OUT}/g001-transcript.json`, JSON.stringify(transcript, null, 2));
console.log('APIHITS', JSON.stringify(transcript.api));
await b.close();
