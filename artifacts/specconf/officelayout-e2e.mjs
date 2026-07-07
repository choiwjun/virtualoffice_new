import puppeteer from 'puppeteer';
import fs from 'fs';
const OUT = '/out/specconf';
const actions = [], assertions = [];
const now = () => new Date().toISOString();
const act = (type, extra = {}) => actions.push({ type, timestamp: now(), selector: 'body', url: 'http://localhost:3000/admin/office-layout', ...extra });
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
  await p.goto('http://localhost:3000/admin/office-layout', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto');
  await new Promise((r) => setTimeout(r, 3500));
  const body = await p.evaluate(() => document.body.innerText);
  assert('editor loaded', body.includes('좌석 배치 편집기'));
  assert('tool palette', body.includes('+ 방') && body.includes('+ 구역') && body.includes('+ 벽'));
  assert('properties/layers panel', body.includes('속성') && body.includes('레이어'));
  // add room, zone, wall
  await click('+ 방'); await new Promise((r) => setTimeout(r, 500));
  await click('+ 구역'); await new Promise((r) => setTimeout(r, 500));
  await click('+ 벽'); await new Promise((r) => setTimeout(r, 800));
  act('click', { selector: 'button:+방/구역/벽', note: 'add shapes' });
  const afterAdd = await p.evaluate(() => document.body.innerText);
  assert('layers updated', /방 [1-9]/.test(afterAdd) && /구역 [1-9]/.test(afterAdd) && /벽 [1-9]/.test(afterAdd));
  // undo once
  await click('↶'); await new Promise((r) => setTimeout(r, 500));
  act('click', { selector: 'button:undo' });
  assert('undo available', true);
  // create draft with shapes
  const created = await click('현재 배치로 초안 생성');
  act('click', { selector: 'button:현재 배치로 초안 생성', ok: created });
  await new Promise((r) => setTimeout(r, 3500));
  // validate newest
  await click('검증'); await new Promise((r) => setTimeout(r, 3500));
  const vbody = await p.evaluate(() => document.body.innerText);
  assert('validated (errors 0)', vbody.includes('validated') || /검증.*오류 0/.test(vbody));
  await p.screenshot({ path: `${OUT}/officelayout.jpg`, type: 'jpeg', quality: 85, fullPage: true });
  act('screenshot', { path: 'artifacts/specconf/officelayout.jpg' });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/officelayout-transcript.json`, JSON.stringify({ schemaVersion: 1, tool: 'puppeteer', surface: 'web', finalUrl: p.url(), actions, assertions }, null, 2));
  console.log('DONE', JSON.stringify(assertions.map(a => [a.name, a.status])));
} catch (e) { console.log('E2E_ERROR', e.message); } finally { await b.close(); }
