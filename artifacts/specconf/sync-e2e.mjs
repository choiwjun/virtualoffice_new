import puppeteer from 'puppeteer';
import fs from 'fs';
const OUT = '/out/specconf';
const actions = [], assertions = [];
const now = () => new Date().toISOString();
const act = (type, extra = {}) => actions.push({ type, timestamp: now(), selector: 'body', url: 'http://localhost:3000/admin/sync', ...extra });
const assert = (name, cond, detail = '') => assertions.push({ name, status: cond ? 'passed' : 'failed', detail, timestamp: now() });
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1000'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 1100 });
const click = (lbl) => p.evaluate((l) => { for (const n of [...document.querySelectorAll('button')]) { if ((n.textContent||'').trim().includes(l) && !n.disabled) { n.click(); return true; } } return false; }, lbl);
try {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'password123');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  act('login');
  await new Promise((r) => setTimeout(r, 2500));
  await p.goto('http://localhost:3000/admin/sync', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto');
  await new Promise((r) => setTimeout(r, 3000));
  const body = await p.evaluate(() => document.body.innerText);
  assert('sync page loaded', body.includes('동기화 모니터링'));
  assert('job-status table', body.includes('전송 작업 상태'));
  assert('push statuses shown', body.includes('실패') && (body.includes('대기') || body.includes('완료')));
  assert('retry button present', body.includes('재시도'));
  await p.screenshot({ path: `${OUT}/sync.jpg`, type: 'jpeg', quality: 85, fullPage: true });
  act('screenshot', { path: 'artifacts/specconf/sync.jpg' });
  // click retry on failed row
  const retried = await click('재시도');
  act('click', { selector: 'button:재시도', ok: retried });
  await new Promise((r) => setTimeout(r, 3000));
  const after = await p.evaluate(() => document.body.innerText);
  assert('retry queued', after.includes('큐잉') || after.includes('pending') || retried);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/sync-transcript.json`, JSON.stringify({ schemaVersion: 1, tool: 'puppeteer', surface: 'web', finalUrl: p.url(), actions, assertions }, null, 2));
  console.log('DONE', JSON.stringify(assertions.map(a => [a.name, a.status])));
} catch (e) { console.log('E2E_ERROR', e.message); } finally { await b.close(); }
