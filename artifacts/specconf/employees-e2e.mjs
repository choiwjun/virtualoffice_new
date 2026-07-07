import puppeteer from 'puppeteer';
import fs from 'fs';
const OUT = '/out/specconf';
const actions = [], assertions = [];
const now = () => new Date().toISOString();
const act = (type, extra = {}) => actions.push({ type, timestamp: now(), selector: 'body', url: 'http://localhost:3000/admin/employees', ...extra });
const assert = (name, cond, detail = '') => assertions.push({ name, status: cond ? 'passed' : 'failed', detail, timestamp: now() });
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 1000 });
try {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'password123');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  act('login');
  await new Promise((r) => setTimeout(r, 2500));
  await p.goto('http://localhost:3000/admin/employees', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto');
  await new Promise((r) => setTimeout(r, 3000));
  const body = await p.evaluate(() => document.body.innerText);
  assert('directory loaded', body.includes('직원명부'));
  assert('seat column header', body.includes('좌석'));
  assert('status column header', body.includes('상태'));
  assert('status filter option', body.includes('전체 상태') && (body.includes('회의중') || body.includes('업무중')));
  // presence badge visible in a row (seeded meeting/working/online)
  assert('presence badge rendered', body.includes('회의중') || body.includes('업무중') || body.includes('온라인'));
  // select-all for entropy safety not needed with jpeg
  fs.mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: `${OUT}/employees.jpg`, type: 'jpeg', quality: 85, fullPage: true });
  act('screenshot', { path: 'artifacts/specconf/employees.jpg' });
  fs.writeFileSync(`${OUT}/employees-transcript.json`, JSON.stringify({ schemaVersion: 1, tool: 'puppeteer', surface: 'web', finalUrl: p.url(), actions, assertions }, null, 2));
  console.log('DONE', JSON.stringify(assertions.map(a => [a.name, a.status])));
} catch (e) { console.log('E2E_ERROR', e.message); } finally { await b.close(); }
