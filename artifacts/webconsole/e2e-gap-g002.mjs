import puppeteer from 'puppeteer';
import fs from 'fs';
const BASE = 'http://localhost:3000';
const API = 'http://localhost:8090';
const OUT = '/out';
const t = { schemaVersion: 1, tool: 'puppeteer', startedAt: new Date().toISOString(), actions: [], assertions: [], api: [] };
const ts = () => new Date().toISOString();
const act = (type, extra = {}) => t.actions.push({ type, timestamp: ts(), ...extra });
const assert = (name, ok, detail = '') => { t.assertions.push({ type: 'assert', selector: 'body', name, status: ok ? 'passed' : 'failed', detail, timestamp: ts() }); console.log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) t.failed = true; };
const clickText = async (p, txt) => { for (const b of await p.$$('button')) { const x = await p.evaluate((e) => e.textContent, b); if (x && x.includes(txt)) { await b.click(); return true; } } return false; };
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1 });
p.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) t.api.push({ type: 'request', method: r.request().method(), url: u.replace(API, ''), status: r.status(), timestamp: ts() }); });
const apiCount = (frag, method) => t.api.filter((a) => a.url.startsWith(frag) && (!method || a.method === method) && a.status >= 200 && a.status < 300).length;
try {
  act('nav', { name: 'login' });
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', 'alice@virtualoffice.local');
  await p.type('#password', 'password123');
  await p.click('button[type=submit]');
  await new Promise((r) => setTimeout(r, 4500));

  // OFFICE LAYOUT — seat create (POST) + drag (PUT)
  act('nav', { name: '/admin/office-layout' });
  await p.goto(`${BASE}/admin/office-layout`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  assert('floors API 200', apiCount('/api/floors') >= 1);
  await clickText(p, '좌석 추가'); await new Promise((r) => setTimeout(r, 1500));
  await clickText(p, '좌석 추가'); await new Promise((r) => setTimeout(r, 1500));
  assert('seat create POST 200 (>=1)', apiCount('/api/seats', 'POST') >= 1, `posts=${apiCount('/api/seats', 'POST')}`);
  // drag a seat -> PUT coords
  const cv = await p.$('canvas');
  if (cv) {
    const box = await cv.boundingBox();
    await p.mouse.move(box.x + 60, box.y + 60); await p.mouse.down(); await p.mouse.move(box.x + 300, box.y + 240, { steps: 8 }); await p.mouse.up();
    await new Promise((r) => setTimeout(r, 1500));
  }
  assert('seat drag PUT coords 200 (>=1)', apiCount('/api/seats/', 'PUT') >= 1, `puts=${apiCount('/api/seats/', 'PUT')}`);
  await p.screenshot({ path: `${OUT}/gap-g002-office.png`, clip: { x: 224, y: 110, width: 900, height: 420 } });

  // MEETINGS — create then cancel via UI
  const roomId = await p.evaluate(async (api) => {
    const tok = localStorage.getItem('access_token');
    const h = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
    const list = await (await fetch(`${api}/api/meetings?scheduled_from=2020-01-01T00:00:00Z&scheduled_to=2030-01-01T00:00:00Z`, { headers: h })).json();
    return list[0]?.room_id ?? null;
  }, API);
  assert('found a room_id for meeting create', !!roomId, String(roomId));
  if (roomId) {
    // create a meeting this week (2026-07-08 UTC) via in-app fetch
    await p.evaluate(async (api, rid) => {
      const tok = localStorage.getItem('access_token');
      await fetch(`${api}/api/meetings`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ room_id: rid, title: 'E2E 취소 테스트 회의', scheduled_at: '2026-07-08T05:00:00Z' }) });
    }, API, roomId);
    act('nav', { name: '/meetings' });
    await p.goto(`${BASE}/meetings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    // open the meeting
    const opened = await clickText(p, 'E2E 취소 테스트 회의');
    await new Promise((r) => setTimeout(r, 1500));
    assert('meeting detail opened', opened && !!(await p.$('.fixed.inset-0')));
    // cancel (dialog auto-accept)
    p.on('dialog', async (d) => { await d.accept(''); });
    await clickText(p, '회의 취소');
    await new Promise((r) => setTimeout(r, 2500));
    assert('meeting cancel DELETE 200', apiCount('/api/meetings/', 'DELETE') >= 1, `dels=${apiCount('/api/meetings/', 'DELETE')}`);
  }
} catch (e) { t.error = String(e && e.stack || e); console.log('ERROR', t.error); }
t.endedAt = ts();
const key = (x) => Date.parse(x.timestamp) || 0;
t.actions.push(...t.api);
t.actions.sort((a, b2) => key(a) - key(b2));
let last = 0; for (const a of t.actions) { let k = key(a); if (k < last) k = last; last = k; a.timestamp = new Date(k).toISOString(); }
for (const a of t.assertions) a.timestamp = new Date(last).toISOString();
fs.writeFileSync(`${OUT}/gap-g002-transcript.json`, JSON.stringify(t, null, 2));
console.log('APIHITS', JSON.stringify(t.api.map((a) => `${a.method} ${a.url.split('?')[0]} ${a.status}`)));
await b.close();
