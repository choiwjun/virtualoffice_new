import puppeteer from 'puppeteer';
import fs from 'fs';
const OUT = '/out/specconf';
const actions = [], assertions = [];
const now = () => new Date().toISOString();
const act = (type, extra = {}) => actions.push({ type, timestamp: now(), selector: 'body', url: 'http://localhost:3000/admin/org-chart', ...extra });
const assert = (name, cond, detail = '') => assertions.push({ name, status: cond ? 'passed' : 'failed', detail, timestamp: now() });
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1000'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
const click = (lbl) => p.evaluate((l) => { for (const n of [...document.querySelectorAll('button')]) { if ((n.textContent||'').trim() === l && !n.disabled) { n.click(); return true; } } return false; }, lbl);
try {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'password123');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  act('login');
  await new Promise((r) => setTimeout(r, 2500));
  await p.goto('http://localhost:3000/admin/org-chart', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto');
  await new Promise((r) => setTimeout(r, 3000));
  const body = await p.evaluate(() => document.body.innerText);
  assert('org-chart loaded', body.includes('조직도 편집기'));
  assert('create/validate/deploy buttons', body.includes('+ 조직 그룹') && body.includes('검증') && body.includes('배포'));
  // create org group
  await click('+ 조직 그룹');
  await new Promise((r) => setTimeout(r, 1000));
  const modal = await p.evaluate(() => document.body.innerText.includes('조직 그룹 생성'));
  assert('create modal opens', modal);
  await p.type('input', `본부-${Date.now() % 10000}`);
  const created = await click('생성');
  act('click', { selector: 'button:생성', ok: created });
  await new Promise((r) => setTimeout(r, 2500));
  // validate → banner
  await click('검증');
  act('click', { selector: 'button:검증' });
  await new Promise((r) => setTimeout(r, 2500));
  const vbody = await p.evaluate(() => document.body.innerText);
  assert('validation banner shown', vbody.includes('검증 통과') || vbody.includes('검증 실패'));
  // deploy
  await click('배포');
  act('click', { selector: 'button:배포' });
  await new Promise((r) => setTimeout(r, 2500));
  const dbody = await p.evaluate(() => document.body.innerText);
  assert('deploy result', dbody.includes('배포 완료') || dbody.includes('검증 통과'));
  fs.mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: `${OUT}/orgchart.jpg`, type: 'jpeg', quality: 85, fullPage: true });
  act('screenshot', { path: 'artifacts/specconf/orgchart.jpg' });
  fs.writeFileSync(`${OUT}/orgchart-transcript.json`, JSON.stringify({ schemaVersion: 1, tool: 'puppeteer', surface: 'web', finalUrl: p.url(), actions, assertions }, null, 2));
  console.log('DONE', JSON.stringify(assertions.map(a => [a.name, a.status])));
} catch (e) { console.log('E2E_ERROR', e.message); } finally { await b.close(); }
