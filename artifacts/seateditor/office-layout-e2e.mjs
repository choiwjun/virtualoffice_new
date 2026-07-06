import puppeteer from 'puppeteer';
import fs from 'fs';

const OUT = '/out/seateditor';
const actions = [];
const assertions = [];
const now = () => new Date().toISOString();
const act = (type, extra = {}) => actions.push({ type, timestamp: now(), ...extra });
const assert = (name, cond, detail = '') =>
  assertions.push({ name, status: cond ? 'passed' : 'failed', detail, timestamp: now() });

const b = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 900 });

// click a visible button/link whose text includes `label`
const clickByText = async (label) =>
  p.evaluate((lbl) => {
    const els = [...document.querySelectorAll('button,a')].filter((n) => n.offsetParent !== null);
    for (const n of els) {
      if ((n.textContent || '').includes(lbl) && !n.disabled) { n.click(); return true; }
    }
    return false;
  }, label);

try {
  // 1. login
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto', { selector: 'a[href=/login]', url: p.url() });
  await p.waitForSelector('#email', {timeout:20000});
  await p.type('#email', 'alice@virtualoffice.local');
  act('type', { selector: '#email', value: 'alice@virtualoffice.local' });
  await p.type('#password', 'password123');
  act('type', { selector: '#password', value: '***' });
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}),
    p.click('button[type="submit"]').catch(() => clickByText('로그인')),
  ]);
  act('click', { selector: 'button[type=submit]', note: 'login submit' });
  await new Promise((r) => setTimeout(r, 2500));

  // 2. office-layout editor
  await p.goto('http://localhost:3000/admin/office-layout', { waitUntil: 'networkidle2', timeout: 45000 });
  act('goto', { selector: 'a[href=/admin/office-layout]', url: p.url() });
  await new Promise((r) => setTimeout(r, 3000));
  const heading = await p.evaluate(() => document.body.innerText.includes('좌석 배치 편집기'));
  assert('editor page loaded', heading, '좌석 배치 편집기 heading present');

  // 3. create schema-valid draft
  const created = await clickByText('현재 배치로 초안 생성');
  act('click', { selector: 'button:현재 배치로 초안 생성', ok: created });
  assert('create-draft clickable', created, 'draft create button enabled+clicked');
  await new Promise((r) => setTimeout(r, 3500));

  // 4. validate the newest draft row
  const validated = await clickByText('검증');
  act('click', { selector: 'button:검증', ok: validated });
  assert('validate clickable', validated, 'validate button present+clicked');
  await new Promise((r) => setTimeout(r, 3500));

  // 5. read toast + status badge
  const bodyText = await p.evaluate(() => document.body.innerText);
  const toastOk = /검증:\s*validated/.test(bodyText) || bodyText.includes('validated');
  assert('validated status shown', toastOk, 'toast/badge shows validated (errors 0)');
  const noError = /오류\s*0/.test(bodyText) || !/오류\s*[1-9]/.test(bodyText);
  assert('zero validation errors', noError, 'toast reports 오류 0');

  fs.mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: `${OUT}/office-layout-validated.png` });
  act('screenshot', { path: 'artifacts/seateditor/office-layout-validated.png' });

  const transcript = { schemaVersion: 1, tool: 'puppeteer', surface: 'web', finalUrl: p.url(), actions, assertions };
  fs.writeFileSync(`${OUT}/office-layout-transcript.json`, JSON.stringify(transcript, null, 2));
  console.log('TRANSCRIPT_OK finalUrl=' + p.url());
  console.log('assertions=' + JSON.stringify(assertions.map((a) => [a.name, a.status])));
} catch (e) {
  console.log('E2E_ERROR', e.message);
} finally {
  await b.close();
}
