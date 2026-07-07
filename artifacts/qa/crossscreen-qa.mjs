import puppeteer from 'puppeteer';
import fs from 'fs';
const OUT = '/out/qa';
const results = [];
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1000'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
async function login(email) {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 45000 });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.type('#email', email);
  await p.type('#password', 'password123');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 2000));
}
async function check(route, markers, shot) {
  await p.goto(`http://localhost:3000${route}`, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2800));
  const body = await p.evaluate(() => document.body.innerText);
  const missing = markers.filter((m) => !body.includes(m));
  fs.mkdirSync(OUT, { recursive: true });
  if (shot) await p.screenshot({ path: `${OUT}/${shot}.jpg`, type: 'jpeg', quality: 80, fullPage: true });
  results.push({ route, ok: missing.length === 0, missing });
}
try {
  fs.mkdirSync(OUT, { recursive: true });
  await login('alice@virtualoffice.local');
  await check('/work-log', ['일일 상태 리포트', '블로커', '완료율'], 'qa-worklog');
  await check('/admin/employees', ['직원명부', '좌석', '전체 상태'], 'qa-employees');
  await check('/admin/kpi', ['KPI 관리', '지표 상세', '팀 랭킹', '내보내기'], 'qa-kpi');
  await check('/kpi', ['KPI'], null);
  await check('/meetings', ['회의', '액션 대시보드', '이번 주'], 'qa-meetings');
  await check('/admin/sync', ['동기화 모니터링', '전송 작업 상태'], 'qa-sync');
  await check('/admin/office-layout', ['좌석 배치 편집기', '+ 방', '+ 구역', '+ 벽', '속성', '레이어'], 'qa-officelayout');
  await check('/admin/org-chart', ['조직도 편집기', '+ 조직 그룹', '검증', '배포'], 'qa-orgchart');
  fs.writeFileSync(`${OUT}/crossscreen-report.json`, JSON.stringify({ schemaVersion: 1, tool: 'puppeteer', surface: 'web', results, pageErrors: errors }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log('QA_DONE pass=' + results.filter((r) => r.ok).length + '/' + results.length + ' pageErrors=' + errors.length);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.route}${r.ok ? '' : ' missing=' + JSON.stringify(r.missing)}`);
} catch (e) { console.log('QA_ERROR', e.message); } finally { await b.close(); }
