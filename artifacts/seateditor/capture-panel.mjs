import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 900 });
await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 45000 });
await p.waitForSelector('#email', { timeout: 20000 });
await p.type('#email', 'alice@virtualoffice.local');
await p.type('#password', 'password123');
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
await new Promise((r) => setTimeout(r, 2500));
await p.goto('http://localhost:3000/admin/office-layout', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((r) => setTimeout(r, 3000));
const click = (lbl) => p.evaluate((l) => { for (const n of [...document.querySelectorAll('button,a')]) { if ((n.textContent||'').includes(l) && !n.disabled) { n.click(); return true; } } return false; }, lbl);
await click('현재 배치로 초안 생성');
await new Promise((r) => setTimeout(r, 3000));
await click('검증');
await new Promise((r) => setTimeout(r, 3000));
// element screenshot of the layout-version panel (dense: colored status badges + buttons + rows)
const panel = await p.evaluateHandle(() => {
  const els = [...document.querySelectorAll('div')];
  return els.find((n) => (n.textContent || '').includes('레이아웃 버전') && n.querySelector('table'));
});
if (false) {
  await panel.asElement().screenshot({ path: '/out/seateditor/office-layout-validated.png' });
  console.log('PANEL_SHOT_OK');
} else {
  await p.screenshot({ path: '/out/seateditor/office-layout-validated.png' });
  console.log('FULL_SHOT_FALLBACK');
}
await b.close();
