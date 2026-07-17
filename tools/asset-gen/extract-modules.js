/* extract-modules.js — 모듈 카탈로그 추출기 (18-설계 M0)
 *
 * horizon-scene.js 아이템 meta(type/variant/ob/seat)를 이용해:
 *   1) 스프라이트를 모듈 타입×변형으로 그룹화 — 변형당 대표(canonical) 스프라이트 1장
 *   2) catalog.json: modules(변형·앵커오프셋·baseline·footprint_m) + instances(현 배치)
 *   3) QA 게이트: [배경+개별크롭(현행)] vs [배경+대표 스프라이트 재합성] 픽셀 diff < 1%
 *
 * 산출: frontend/public/office2d/modules/{catalog.json, sprites/*.webp}
 *      out/modules-recompose-qa.webp (재합성 육안본)
 * 실행: node extract-modules.js  (Windows 전역 playwright — node.exe)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wj941/AppData/Roaming/npm/node_modules/playwright');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'ai-plate/incoming/horizon-scene.js');
const OUT = path.join(ROOT, '..', '..', 'frontend', 'public', 'office2d', 'modules');
const SCENE_M = [20, (941 / 1672) * 20];
const DIFF_GATE_PCT = 1.0;

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function writeRetry(file, buf) {
  for (let t = 0; t < 8; t++) {
    try { fs.writeFileSync(file, buf); return; } catch (e) { sleep(200 + t * 250); }
  }
  throw new Error('write failed: ' + file);
}
const keyOf = (m) => m.variant ? `${m.type}__${m.variant}` : m.type;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  await page.addScriptTag({ path: SRC });

  // ── 1) 레이어 캡처 + bbox/baseline 산출(캔버스는 window._L에 보존) ──
  const layers = await page.evaluate(() => {
    window._L = window.renderHorizonLayers();
    const out = [];
    for (const L of window._L) {
      const c = L.canvas;
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let minX = c.width, maxX = -1, minY = c.height, maxY = -1, solid = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const a = img[(y * c.width + x) * 4 + 3];
        if (a > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        if (a > 140 && y > solid) solid = y;
      }
      if (maxX < 0) continue;
      const pad = 3;
      out.push({
        name: L.name, meta: L.meta,
        x: Math.max(0, minX - pad), y: Math.max(0, minY - pad),
        x1: Math.min(c.width, maxX + pad), y1: Math.min(c.height, maxY + pad),
        solid: solid >= 0 ? solid : maxY, W: c.width, H: c.height,
      });
    }
    return out;
  });

  const geo = await page.evaluate(() => window.HORIZON_GEO);
  const bg = layers.find((l) => l.name === 'background');
  const sprites = layers.filter((l) => l.name !== 'background');
  const untagged = sprites.filter((s) => !s.meta || !s.meta.type || s.meta.type === 'misc');
  if (untagged.length) throw new Error('meta 미태깅 스프라이트: ' + untagged.map((s) => s.name).join(','));

  // ── 2) 카탈로그: 변형별 대표 = 첫 인스턴스, 오프셋은 정수 px ──
  const modules = {}; const instances = []; const canonical = new Map();
  for (const s of sprites) {
    const m = s.meta; const key = keyOf(m);
    const anchorPx = [Math.round(m.anchor[0] * s.W), Math.round(m.anchor[1] * s.H)];
    if (!canonical.has(key)) {
      canonical.set(key, s);
      const t = (modules[m.type] ||= { variants: {}, footprint_m: null });
      t.variants[m.variant || 'default'] = {
        src: `sprites/${key}.webp`,
        w: s.x1 - s.x, h: s.y1 - s.y,
        offset: [s.x - anchorPx[0], s.y - anchorPx[1]],           // px, 앵커 기준
        baselineDy: +(s.solid / s.H - m.anchor[1]).toFixed(5),     // 정규 — z = anchorY + baselineDy
      };
      if (m.ob && !t.footprint_m) {
        t.footprint_m = geo.OB[m.ob[0]].map(([nx, ny]) => [
          +((nx - m.anchor[0]) * SCENE_M[0]).toFixed(3),
          +((ny - m.anchor[1]) * SCENE_M[1]).toFixed(3),
        ]);
      }
    }
    instances.push({
      id: s.name, module: m.type, variant: m.variant || 'default',
      anchor: [+m.anchor[0].toFixed(5), +m.anchor[1].toFixed(5)],
      z: +(s.solid / s.H).toFixed(5),
      ...(m.ob ? { ob: m.ob } : {}), ...(m.seat != null ? { seat: m.seat } : {}),
    });
  }

  // ── 3) QA 게이트: 현행 합성 vs 대표 스프라이트 재합성 픽셀 diff ──
  const placements = instances.map((inst) => {
    const c = canonical.get(inst.variant !== 'default' ? `${inst.module}__${inst.variant}` : inst.module);
    const v = modules[inst.module].variants[inst.variant];
    return {
      ownName: inst.id,
      srcName: c.name, sx: c.x, sy: c.y, sw: c.x1 - c.x, sh: c.y1 - c.y,
      dx: Math.round(inst.anchor[0] * c.W) + v.offset[0],
      dy: Math.round(inst.anchor[1] * c.H) + v.offset[1],
    };
  });
  const qa = await page.evaluate(([placements, bgName]) => {
    const byName = new Map(window._L.map((L) => [L.name, L.canvas]));
    const bgc = byName.get(bgName);
    const mk = () => { const c = document.createElement('canvas'); c.width = bgc.width; c.height = bgc.height; return c; };
    const ref = mk(), mod = mk();
    const rx = ref.getContext('2d'), mx = mod.getContext('2d');
    rx.drawImage(bgc, 0, 0); mx.drawImage(bgc, 0, 0);
    for (const p of placements) {
      rx.drawImage(byName.get(p.ownName), 0, 0);                          // 현행: 자기 레이어 그대로
      mx.drawImage(byName.get(p.srcName), p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.sw, p.sh); // 대표 재배치
    }
    const a = rx.getImageData(0, 0, ref.width, ref.height).data;
    const b = mx.getImageData(0, 0, mod.width, mod.height).data;
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) > 12 || Math.abs(a[i + 1] - b[i + 1]) > 12 || Math.abs(a[i + 2] - b[i + 2]) > 12) diff++;
    }
    return { diffPct: (diff / (a.length / 4)) * 100, recompose: mod.toDataURL('image/webp', 0.9) };
  }, [placements, bg.name]);

  // ── 4) 산출물 기록 ──
  fs.mkdirSync(path.join(OUT, 'sprites'), { recursive: true });
  let total = 0;
  for (const [key, s] of canonical) {
    const data = await page.evaluate(([name, x, y, w, h]) => {
      const c = window._L.find((L) => L.name === name).canvas;
      const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
      cc.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
      return cc.toDataURL('image/webp', 0.92);
    }, [s.name, s.x, s.y, s.x1 - s.x, s.y1 - s.y]);
    const buf = Buffer.from(data.split(',')[1], 'base64');
    total += buf.length;
    writeRetry(path.join(OUT, 'sprites', `${key}.webp`), buf);
  }
  const catalog = {
    version: 1,
    plate: { w: bg.W, h: bg.H, scene_m: [+SCENE_M[0].toFixed(3), +SCENE_M[1].toFixed(3)] },
    background: '/office2d/layers/background.webp',
    modules, instances,
  };
  writeRetry(path.join(OUT, 'catalog.json'), Buffer.from(JSON.stringify(catalog, null, 1)));
  writeRetry(path.join(ROOT, 'out', 'modules-recompose-qa.webp'), Buffer.from(qa.recompose.split(',')[1], 'base64'));
  await browser.close();

  const nVariants = Object.values(modules).reduce((n, t) => n + Object.keys(t.variants).length, 0);
  console.log(`modules: 타입 ${Object.keys(modules).length} × 변형 ${nVariants} (대표 ${canonical.size}장, ${(total / 1024 / 1024).toFixed(2)}MB) / 인스턴스 ${instances.length}`);
  console.log(`recompose diff: ${qa.diffPct.toFixed(3)}% (게이트 < ${DIFF_GATE_PCT}%) → ${qa.diffPct < DIFF_GATE_PCT ? 'PASS' : 'FAIL'}`);
  if (qa.diffPct >= DIFF_GATE_PCT) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
