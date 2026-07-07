import puppeteer from 'puppeteer';
import fs from 'fs';
const OUT = '/out/specconf';
const actions = [], assertions = [];
const now = () => new Date().toISOString();
const act = (type, extra = {}) => actions.push({ type, timestamp: now(), selector: 'body', url: 'http://localhost:3000/admin/kpi', ...extra });
const assert = (name, cond, detail = '') => assertions.push({ name, status: cond ? 'passed' : 'failed', detail, timestamp: now() });
const clickText = (lbl) => null;
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
  await p.goto('http://localhost:3000/admin/kpi', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto');
  await new Promise((r) => setTimeout(r, 2500));
  // set period key to seeded quarter and load
  await click('조회');
  await new Promise((r) => setTimeout(r, 2500));
  const body = await p.evaluate(() => document.body.innerText);
  assert('kpi page loaded', body.includes('KPI 관리'));
  assert('tab navigation', body.includes('지표 상세') && body.includes('팀 랭킹'));
  assert('ai-draft panel', body.includes('AI 평가 초안'));
  assert('progress column', body.includes('진행도'));
  assert('erp push button', body.includes('내보내기'));
  // switch to ranking tab
  const rank = await click('팀 랭킹');
  act('click', { selector: 'button:팀 랭킹', ok: rank });
  await new Promise((r) => setTimeout(r, 2500));
  const rbody = await p.evaluate(() => document.body.innerText);
  assert('team ranking rendered', rbody.includes('팀 랭킹 (종합점수)'));
  // back to detail for screenshot
  await click('지표 상세');
  await new Promise((r) => setTimeout(r, 1500));
  fs.mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: `${OUT}/kpi.jpg`, type: 'jpeg', quality: 85, fullPage: true });
  act('screenshot', { path: 'artifacts/specconf/kpi.jpg' });
  fs.writeFileSync(`${OUT}/kpi-transcript.json`, JSON.stringify({ schemaVersion: 1, tool: 'puppeteer', surface: 'web', finalUrl: p.url(), actions, assertions }, null, 2));
  console.log('DONE', JSON.stringify(assertions.map(a => [a.name, a.status])));
} catch (e) { console.log('E2E_ERROR', e.message); } finally { await b.close(); }
