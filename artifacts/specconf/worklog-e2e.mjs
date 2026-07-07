import puppeteer from 'puppeteer';
import fs from 'fs';
const OUT = '/out/specconf';
const actions = [], assertions = [];
const now = () => new Date().toISOString();
const act = (type, extra = {}) => actions.push({ type, timestamp: now(), selector: 'body', ...extra });
const assert = (name, cond, detail = '') => assertions.push({ name, status: cond ? 'passed' : 'failed', detail, timestamp: now() });
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'] });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 1700 });
const clickText = (lbl) => p.evaluate((l) => { for (const n of [...document.querySelectorAll('button,a')]) { if ((n.textContent||'').includes(l) && !n.disabled) { n.click(); return true; } } return false; }, lbl);
try {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'charlie@virtualoffice.local');
  await p.type('#password', 'password123');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  act('login');
  await new Promise((r) => setTimeout(r, 2500));
  await p.goto('http://localhost:3000/work-log', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto', { selector: 'a[href=/work-log]' });
  await new Promise((r) => setTimeout(r, 3000));
  const body = await p.evaluate(() => document.body.innerText);
  assert('work-log loaded', body.includes('업무기록') || body.includes('업무 요약') || body.includes('일일 상태 리포트'));
  assert('daily-status-form present', body.includes('일일 상태 리포트') && body.includes('블로커'));
  // fill daily report textareas
  const areas = await p.$$('textarea');
  assert('4 report textareas', areas.length >= 4, `found ${areas.length} textareas`);
  if (areas.length >= 4) {
    await areas[0].type('스펙 정합 작업');
    await areas[1].type('work-log 일일리포트');
    await areas[2].type('없음');
    await areas[3].type('E2E 검증');
    act('type', { selector: 'textarea', note: 'daily report fields' });
  }
  const submitted = await clickText('일일 리포트 제출');
  act('click', { selector: 'button:일일 리포트 제출', ok: submitted });
  assert('submit clickable', submitted);
  await new Promise((r) => setTimeout(r, 3000));
  const after = await p.evaluate(() => document.body.innerText);
  assert('queued confirmation', after.includes('큐잉') || after.includes('✅'));
  assert('progress/report elements', after.includes('완료율') || after.includes('카테고리'));
  await p.evaluate(() => { const s = window.getSelection(); const r = document.createRange(); r.selectNodeContents(document.body); s.removeAllRanges(); s.addRange(r); });
  await new Promise((r) => setTimeout(r, 400));
  fs.mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: `${OUT}/worklog.jpg`, type: 'jpeg', quality: 85, fullPage: true });
  act('screenshot', { path: 'artifacts/specconf/worklog.jpg' });
  fs.writeFileSync(`${OUT}/worklog-transcript.json`, JSON.stringify({ schemaVersion: 1, tool: 'puppeteer', surface: 'web', finalUrl: p.url(), actions, assertions }, null, 2));
  console.log('DONE', JSON.stringify(assertions.map(a => [a.name, a.status])));
} catch (e) { console.log('E2E_ERROR', e.message); } finally { await b.close(); }
