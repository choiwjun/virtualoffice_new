import puppeteer from 'puppeteer';
import fs from 'fs';
const OUT = '/out/specconf';
const actions = [], assertions = [];
const now = () => new Date().toISOString();
const act = (type, extra = {}) => actions.push({ type, timestamp: now(), selector: 'body', url: 'http://localhost:3000/meetings', ...extra });
const assert = (name, cond, detail = '') => assertions.push({ name, status: cond ? 'passed' : 'failed', detail, timestamp: now() });
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1000'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 1100 });
const click = (lbl) => p.evaluate((l) => { for (const n of [...document.querySelectorAll('button')]) { if ((n.textContent||'').trim().includes(l) && !n.disabled) { n.click(); return true; } } return false; }, lbl);
try {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'bob@virtualoffice.local');
  await p.type('#password', 'password123');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  act('login');
  await new Promise((r) => setTimeout(r, 2500));
  await p.goto('http://localhost:3000/meetings', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto');
  await new Promise((r) => setTimeout(r, 3000));
  const body = await p.evaluate(() => document.body.innerText);
  assert('meetings loaded', body.includes('회의 / 회의록'));
  assert('calendar tabs', body.includes('오늘') && body.includes('이번 주') && body.includes('이번 달'));
  assert('date-grouped list', /\d{4}\.|\d{1,2}\./.test(body) || body.includes('스프린트'));
  // open action dashboard
  const dashOpen = await click('액션 대시보드');
  act('click', { selector: 'button:액션 대시보드', ok: dashOpen });
  await new Promise((r) => setTimeout(r, 3500));
  const dbody = await p.evaluate(() => document.body.innerText);
  assert('action dashboard opened', dbody.includes('액션 아이템 대시보드'));
  assert('action items aggregated', dbody.includes('캘린더 뷰 검증') || dbody.includes('액션 대시보드 구현'));
  // open a meeting → open minute modal to verify notes + 액션 아이템 fields
  await p.evaluate(() => { const btns=[...document.querySelectorAll('button')].filter(n=>n.textContent.includes('스프린트')||n.textContent.includes('디자인')); if(btns[0]) btns[0].click(); });
  await new Promise((r) => setTimeout(r, 2000));
  const opened = await click('작성');
  await new Promise((r) => setTimeout(r, 1500));
  const mbody = await p.evaluate(() => document.body.innerText);
  assert('minute modal notes + action fields', mbody.includes('노트') && mbody.includes('액션 아이템'));
  fs.mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: `${OUT}/meetings.jpg`, type: 'jpeg', quality: 85, fullPage: true });
  act('screenshot', { path: 'artifacts/specconf/meetings.jpg' });
  fs.writeFileSync(`${OUT}/meetings-transcript.json`, JSON.stringify({ schemaVersion: 1, tool: 'puppeteer', surface: 'web', finalUrl: p.url(), actions, assertions }, null, 2));
  console.log('DONE', JSON.stringify(assertions.map(a => [a.name, a.status])));
} catch (e) { console.log('E2E_ERROR', e.message); } finally { await b.close(); }
