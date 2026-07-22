/* HORIZON scene v3 — Style A "Textured Top-down" (Kumospace-class plate)
   renderScene(layout, opts) — data-driven, procedural textures only (no external assets).
   opts: { canvas?, theme:'day'|'dusk'|'night', layers?:['floor','furniture','people','foreground','grade'], width?, height? }
   Light NW → all shadows SE. Returns { canvas, seats, lights }. */
(function (global) {
'use strict';
function mulberry32(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function shade(hex, f) { const c = hexRgb(hex); return 'rgb(' + c.map(x => clamp(Math.round(x * f), 0, 255)).join(',') + ')'; }
function alp(hex, a) { const c = hexRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
const FONT = "'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
const STATUS = { online: '#34B369', busy: '#E0524D', away: '#EFAF3C', meeting: '#7B6BC9' };
const GREENS = ['#3F6B3C', '#4C7F46', '#63975A', '#79AC68', '#2F5230'];
const KINDDOT = { work: '#3E6FB0', meeting: '#D9A441', lounge: '#C4553B', pantry: '#4C7F46', booth: '#7B6BC9', communal: '#2E3A55' };

function renderScene(layout, opts) {
  opts = opts || {};
  const theme = opts.theme || 'day';
  const L = opts.layers || ['floor', 'furniture', 'people', 'foreground', 'grade'];
  const has = n => L.indexOf(n) >= 0;
  const world = layout.world, room = layout.room;
  const canvas = opts.canvas || document.createElement('canvas');
  const dpr = opts.dpr == null ? 2 : opts.dpr;
  const S = Math.min((opts.width || 1920) / world.w, (opts.height || 1080) / world.h) * dpr;
  canvas.width = Math.round(world.w * S); canvas.height = Math.round(world.h * S);
  let ctx = canvas.getContext('2d');
  const M = m => m * S;
  let rng = mulberry32(hashStr(layout.id || 'horizon'));
  const isOcc = (x, y) => (layout.people || []).some(p => Math.hypot(p.x - x, p.y - y) < 0.62);
  const lights = [], seats = [];
  const WT = 0.22; // wall thickness

  // ---------- primitives ----------
  function rrPath(x, y, w, h, r) {
    r = Math.min(r || 0, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); rrPath(x, y, w, h, r); }
  function fillRR(x, y, w, h, r, fill, stroke, lw) {
    rr(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function lg(x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const s of stops) g.addColorStop(s[0], s[1]); return g; }
  // fast soft shadow: draw shape displaced off-canvas, show only its shadowBlur (device-space safe)
  function shadowed(color, blurPx, dxPx, dyPx, drawFn) {
    const D = 100000;
    ctx.save();
    const t = ctx.getTransform();
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e - D, t.f);
    ctx.shadowColor = color; ctx.shadowBlur = blurPx;
    ctx.shadowOffsetX = D + dxPx; ctx.shadowOffsetY = dyPx;
    drawFn(); ctx.restore();
  }
  function grV(x, y, w, h, c1, c2) { return lg(x, y, x, y + h, [[0, c1], [1, c2]]); }
  function grD(x, y, w, h, c1, c2) { return lg(x, y, x + w, y + h, [[0, c1], [1, c2]]); }
  function withT(mx, my, rotDeg, fn) { ctx.save(); ctx.translate(M(mx), M(my)); if (rotDeg) ctx.rotate(rotDeg * Math.PI / 180); fn(); ctx.restore(); }
  // soft SE shadow (light NW). lift 0..1.5 = perceived height
  // soft-shadow sprites: rendered once, stretched per use (shadowBlur per-shape is too slow at scale)
  const _shR = document.createElement('canvas'), _shE = document.createElement('canvas');
  (function () {
    _shR.width = _shR.height = 96;
    const g2 = _shR.getContext('2d');
    g2.shadowColor = 'rgb(66,54,40)'; g2.shadowBlur = 13; g2.shadowOffsetX = 200;
    g2.fillStyle = '#000'; g2.beginPath();
    if (g2.roundRect) g2.roundRect(24 - 200, 24, 48, 48, 12); else g2.rect(24 - 200, 24, 48, 48);
    g2.fill();
    _shE.width = _shE.height = 96;
    const g3 = _shE.getContext('2d');
    const rg = g3.createRadialGradient(48, 48, 0, 48, 48, 46);
    rg.addColorStop(0, 'rgba(66,54,40,1)'); rg.addColorStop(0.55, 'rgba(66,54,40,0.9)'); rg.addColorStop(1, 'rgba(66,54,40,0)');
    g3.fillStyle = rg; g3.beginPath(); g3.arc(48, 48, 46, 0, 7); g3.fill();
  })();
  function shRect(cx, cy, w, h, o) {
    o = o || {}; const lift = o.lift == null ? 0.8 : o.lift;
    const pad = M(0.055) * (1 + lift), dx = M(0.055) * lift * 2, dy = M(0.085) * lift * 2;
    ctx.save(); ctx.translate(M(cx) + dx, M(cy) + dy); if (o.rot) ctx.rotate(o.rot * Math.PI / 180);
    ctx.globalAlpha = (o.a == null ? 0.20 : o.a) * 1.12;
    ctx.drawImage(_shR, -M(w / 2) - pad, -M(h / 2) - pad, M(w) + pad * 2, M(h) + pad * 2);
    ctx.restore();
  }
  function shEll(cx, cy, rx, ry, o) {
    o = o || {}; const lift = o.lift == null ? 0.6 : o.lift;
    const pad = M(0.05) * (1 + lift), dx = M(0.05) * lift * 2, dy = M(0.08) * lift * 2;
    ctx.save(); ctx.globalAlpha = (o.a == null ? 0.18 : o.a) * 1.12;
    ctx.drawImage(_shE, M(cx - rx) - pad + dx, M(cy - ry) - pad + dy, M(rx) * 2 + pad * 2, M(ry) * 2 + pad * 2);
    ctx.restore();
  }
  function shCluster(cx, cy, w, h) {
    ctx.save(); ctx.globalAlpha = 0.13;
    ctx.drawImage(_shE, M(cx - w / 2 - 0.55), M(cy - h / 2 - 0.55) + M(0.05), M(w + 1.1), M(h + 1.1));
    ctx.restore();
  }

  // ---------- floor ----------
  function woodFloor(x, y, w, h) {
    ctx.save(); rr(M(x), M(y), M(w), M(h), 0); ctx.clip();
    ctx.fillStyle = '#CB9760'; ctx.fillRect(M(x), M(y), M(w), M(h));
    const rowH = 0.295; let ri = 0;
    for (let yy = y; yy < y + h; yy += rowH, ri++) {
      let xx = x - rng() * 1.9;
      while (xx < x + w) {
        const len = 1.15 + rng() * 1.25;
        const f = 0.90 + rng() * 0.17;
        ctx.fillStyle = shade('#CB9760', f);
        ctx.fillRect(M(xx), M(yy), M(len), M(rowH));
        ctx.fillStyle = 'rgba(255,238,205,0.09)';
        ctx.fillRect(M(xx), M(yy), M(len), M(rowH * 0.2));
        if (ri % 2 === 0) { // grain on alternate rows
          ctx.lineWidth = Math.max(0.7, M(0.008));
          const gy = M(yy + rowH * (0.45 + (rng() - 0.5) * 0.2));
          ctx.strokeStyle = 'rgba(104,68,34,0.14)';
          ctx.beginPath(); ctx.moveTo(M(xx + 0.04), gy);
          ctx.quadraticCurveTo(M(xx + len / 2), gy + (rng() - 0.5) * M(0.05), M(xx + len - 0.04), gy);
          ctx.stroke();
        }
        if (rng() < 0.055) { // knot
          ctx.fillStyle = 'rgba(96,62,30,0.25)';
          ctx.beginPath(); ctx.ellipse(M(xx + len * (0.2 + rng() * 0.6)), M(yy + rowH / 2), M(0.028), M(0.018), 0, 0, 7); ctx.fill();
        }
        // butt joint
        ctx.strokeStyle = 'rgba(92,58,28,0.22)'; ctx.lineWidth = Math.max(0.8, M(0.010));
        ctx.beginPath(); ctx.moveTo(M(xx + len), M(yy)); ctx.lineTo(M(xx + len), M(yy + rowH)); ctx.stroke();
        xx += len;
      }
      ctx.strokeStyle = 'rgba(92,58,28,0.26)'; ctx.lineWidth = Math.max(0.8, M(0.012));
      ctx.beginPath(); ctx.moveTo(M(x), M(yy)); ctx.lineTo(M(x + w), M(yy)); ctx.stroke();
    }
    // large-scale mottle + sheen
    for (let i = 0; i < 4; i++) {
      const gx = M(x + rng() * w), gy = M(y + rng() * h), gr = M(2.5 + rng() * 3);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      const warm = rng() > 0.5;
      g.addColorStop(0, warm ? 'rgba(255,226,180,0.07)' : 'rgba(90,60,30,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(M(x), M(y), M(w), M(h));
    }
    ctx.fillStyle = lg(M(x), M(y), M(x + w), M(y + h), [[0, 'rgba(255,246,226,0.13)'], [0.45, 'rgba(255,255,255,0)'], [1, 'rgba(80,54,26,0.08)']]);
    ctx.fillRect(M(x), M(y), M(w), M(h));
    ctx.restore();
  }
  function patchEdge(x, y, w, h, r) { // inset AO so patches sit in, not on
    ctx.save(); rr(M(x), M(y), M(w), M(h), M(r)); ctx.clip();
    const a2 = 'rgba(70,58,44,', e = 0.14;
    ctx.fillStyle = lg(0, M(y), 0, M(y + e), [[0, a2 + '0.12)'], [1, a2 + '0)']]); ctx.fillRect(M(x), M(y), M(w), M(e));
    ctx.fillStyle = lg(0, M(y + h), 0, M(y + h - e), [[0, a2 + '0.12)'], [1, a2 + '0)']]); ctx.fillRect(M(x), M(y + h - e), M(w), M(e));
    ctx.fillStyle = lg(M(x), 0, M(x + e), 0, [[0, a2 + '0.12)'], [1, a2 + '0)']]); ctx.fillRect(M(x), M(y), M(e), M(h));
    ctx.fillStyle = lg(M(x + w), 0, M(x + w - e), 0, [[0, a2 + '0.12)'], [1, a2 + '0)']]); ctx.fillRect(M(x + w - e), M(y), M(e), M(h));
    ctx.restore();
  }
  function tileFloor(x, y, w, h) {
    ctx.save(); rr(M(x), M(y), M(w), M(h), M(0.04)); ctx.clip();
    ctx.fillStyle = grD(M(x), M(y), M(w), M(h), '#EAE6DE', '#DDD8CE'); ctx.fillRect(M(x), M(y), M(w), M(h));
    ctx.strokeStyle = 'rgba(140,128,112,0.34)'; ctx.lineWidth = Math.max(0.8, M(0.008));
    for (let xx = x; xx <= x + w; xx += 0.62) { ctx.beginPath(); ctx.moveTo(M(xx), M(y)); ctx.lineTo(M(xx), M(y + h)); ctx.stroke(); }
    for (let yy = y; yy <= y + h; yy += 0.62) { ctx.beginPath(); ctx.moveTo(M(x), M(yy)); ctx.lineTo(M(x + w), M(yy)); ctx.stroke(); }
    const cols = ['rgba(196,85,59,0.35)', 'rgba(46,58,85,0.3)', 'rgba(160,150,130,0.4)', 'rgba(217,164,65,0.3)'];
    for (let i = 0; i < 340; i++) {
      ctx.fillStyle = cols[(rng() * cols.length) | 0];
      ctx.beginPath(); ctx.ellipse(M(x + rng() * w), M(y + rng() * h), M(0.012 + rng() * 0.014), M(0.008 + rng() * 0.012), rng() * 3, 0, 7); ctx.fill();
    }
    ctx.restore(); patchEdge(x, y, w, h, 0.04);
  }
  function carpetFloor(x, y, w, h) {
    ctx.save(); rr(M(x), M(y), M(w), M(h), M(0.04)); ctx.clip();
    ctx.fillStyle = grD(M(x), M(y), M(w), M(h), '#DCD9D2', '#CCC8BF'); ctx.fillRect(M(x), M(y), M(w), M(h));
    const cell = 0.155;
    const dark = new Path2D(), lite = new Path2D();
    let ci = 0;
    for (let yy = y; yy < y + h; yy += cell, ci++) {
      let cj = 0;
      for (let xx = x; xx < x + w; xx += cell, cj++) {
        const horiz = (ci + cj) % 2 === 0;
        for (let k = 1; k <= 2; k++) {
          const off = cell * k / 3;
          if (horiz) { dark.moveTo(M(xx + 0.015), M(yy + off)); dark.lineTo(M(xx + cell - 0.015), M(yy + off)); }
          else { lite.moveTo(M(xx + off), M(yy + 0.015)); lite.lineTo(M(xx + off), M(yy + cell - 0.015)); }
        }
      }
    }
    ctx.strokeStyle = 'rgba(110,102,90,0.15)'; ctx.lineWidth = Math.max(0.7, M(0.012)); ctx.stroke(dark);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = Math.max(0.7, M(0.012)); ctx.stroke(lite);
    for (let i = 0; i < 260; i++) { ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(100,92,80,0.08)'; ctx.fillRect(M(x + rng() * w), M(y + rng() * h), 1.2, 1.2); }
    ctx.restore(); patchEdge(x, y, w, h, 0.04);
  }
  function feltPatch(x, y, w, h) {
    fillRR(M(x), M(y), M(w), M(h), M(0.06), grD(M(x), M(y), M(w), M(h), '#52607C', '#414E68'));
    ctx.save(); rr(M(x), M(y), M(w), M(h), M(0.06)); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let xx = x + 0.09; xx < x + w; xx += 0.14) for (let yy = y + 0.09; yy < y + h; yy += 0.14) { ctx.beginPath(); ctx.arc(M(xx), M(yy), M(0.014), 0, 7); ctx.fill(); }
    ctx.restore(); patchEdge(x, y, w, h, 0.06);
  }

  // ---------- rugs ----------
  function rugOriental(cx, cy, w, h) {
    const x = cx - w / 2, y = cy - h / 2;
    shRect(cx, cy, w, h, { lift: 0.1, a: 0.13, r: 0.03 });
    fillRR(M(x), M(y), M(w), M(h), M(0.02), grD(M(x), M(y), M(w), M(h), '#A03B2E', '#8A3226'));
    ctx.save(); rr(M(x), M(y), M(w), M(h), M(0.02)); ctx.clip();
    for (let i = 0; i < 500; i++) { // worn mottle
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,214,170,0.05)' : 'rgba(60,18,12,0.06)';
      ctx.fillRect(M(x + rng() * w), M(y + rng() * h), M(0.05 + rng() * 0.07), M(0.028));
    }
    // pile: diagonal nap + directional sheen
    ctx.strokeStyle = 'rgba(255,235,210,0.05)'; ctx.lineWidth = Math.max(0.5, M(0.007));
    for (let dd = -h; dd < w; dd += 0.055) { ctx.beginPath(); ctx.moveTo(M(x + dd), M(y)); ctx.lineTo(M(x + dd + h * 0.6), M(y + h)); ctx.stroke(); }
    ctx.fillStyle = lg(M(x), M(y), M(x + w), M(y + h), [[0, 'rgba(255,240,220,0.10)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(40,10,6,0.10)']]);
    ctx.fillRect(M(x), M(y), M(w), M(h));
    const b1 = 0.16, b2 = 0.34;
    ctx.strokeStyle = '#6E2A20'; ctx.lineWidth = M(0.14); ctx.strokeRect(M(x + b1), M(y + b1), M(w - 2 * b1), M(h - 2 * b1));
    ctx.strokeStyle = '#D9A441'; ctx.lineWidth = M(0.028); ctx.strokeRect(M(x + b1 - 0.09), M(y + b1 - 0.09), M(w - 2 * b1 + 0.18), M(h - 2 * b1 + 0.18));
    ctx.strokeStyle = '#E8C98F'; ctx.lineWidth = M(0.022); ctx.strokeRect(M(x + b2), M(y + b2), M(w - 2 * b2), M(h - 2 * b2));
    // border guls
    ctx.fillStyle = 'rgba(233,201,143,0.85)';
    for (let gx = x + b1 + 0.2; gx < x + w - b1 - 0.15; gx += 0.42) {
      dia(gx, y + b1, 0.07); dia(gx, y + h - b1, 0.07);
    }
    for (let gy = y + b1 + 0.2; gy < y + h - b1 - 0.15; gy += 0.42) { dia(x + b1, gy, 0.07); dia(x + w - b1, gy, 0.07); }
    function dia(px, py, r) { ctx.beginPath(); ctx.moveTo(M(px), M(py - r)); ctx.lineTo(M(px + r), M(py)); ctx.lineTo(M(px), M(py + r)); ctx.lineTo(M(px - r), M(py)); ctx.closePath(); ctx.fill(); }
    // medallion
    const md = [[0.62, '#33415E'], [0.47, '#D9A441'], [0.34, '#8A3226'], [0.2, '#E8C98F']];
    for (const [r, c] of md) {
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(M(cx), M(cy - r)); ctx.lineTo(M(cx + r * 0.72), M(cy)); ctx.lineTo(M(cx), M(cy + r)); ctx.lineTo(M(cx - r * 0.72), M(cy)); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#33415E'; dia(cx - w / 2 + b2 + 0.24, cy - h / 2 + b2 + 0.24, 0.12); dia(cx + w / 2 - b2 - 0.24, cy - h / 2 + b2 + 0.24, 0.12);
    dia(cx - w / 2 + b2 + 0.24, cy + h / 2 - b2 - 0.24, 0.12); dia(cx + w / 2 - b2 - 0.24, cy + h / 2 - b2 - 0.24, 0.12);
    ctx.restore();
    // fringe (dense, alternating length)
    ctx.strokeStyle = 'rgba(240,230,210,0.8)'; ctx.lineWidth = Math.max(0.8, M(0.013));
    let fi = 0;
    for (let fy = y + 0.04; fy < y + h; fy += 0.05, fi++) {
      const fl = fi % 2 ? 0.085 : 0.062;
      ctx.beginPath(); ctx.moveTo(M(x - 0.005), M(fy)); ctx.lineTo(M(x - fl), M(fy + 0.006)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(M(x + w + 0.005), M(fy)); ctx.lineTo(M(x + w + fl), M(fy - 0.006)); ctx.stroke();
    }
  }
  function rugAbstract(cx, cy, w, h) {
    const x = cx - w / 2, y = cy - h / 2;
    shRect(cx, cy, w, h, { lift: 0.1, a: 0.13, r: 0.05 });
    fillRR(M(x), M(y), M(w), M(h), M(0.05), grD(M(x), M(y), M(w), M(h), '#EDE5D4', '#E0D6C2'));
    ctx.save(); rr(M(x), M(y), M(w), M(h), M(0.05)); ctx.clip();
    const pal = ['#3E6FB0', '#E3B23C', '#C4553B', '#2E3A55', '#7FA6C9', '#8A3226'];
    const rr2 = mulberry32(hashStr(layout.id + 'rug' + cx));
    for (let i = 0; i < 13; i++) {
      const c = pal[(rr2() * pal.length) | 0];
      const px = x + rr2() * w, py = y + rr2() * h, s = 0.25 + rr2() * 0.6;
      ctx.fillStyle = alp(c, 0.9);
      const k = rr2();
      if (k < 0.33) { ctx.beginPath(); ctx.arc(M(px), M(py), M(s * 0.45), 0, Math.PI * (1 + rr2())); ctx.lineTo(M(px), M(py)); ctx.closePath(); ctx.fill(); }
      else if (k < 0.66) { ctx.beginPath(); ctx.moveTo(M(px), M(py)); ctx.lineTo(M(px + s), M(py + s * 0.2)); ctx.lineTo(M(px + s * 0.25), M(py + s * 0.8)); ctx.closePath(); ctx.fill(); }
      else { ctx.save(); ctx.translate(M(px), M(py)); ctx.rotate(rr2() * 3); ctx.fillRect(-M(s / 2), -M(s * 0.16), M(s), M(s * 0.32)); ctx.restore(); }
    }
    for (let i = 0; i < 260; i++) { ctx.fillStyle = rr2() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(80,70,55,0.06)'; ctx.fillRect(M(x + rr2() * w), M(y + rr2() * h), 1.3, 1.3); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(60,55,45,0.35)'; ctx.lineWidth = M(0.02); rr(M(x), M(y), M(w), M(h), M(0.05)); ctx.stroke();
  }
  function rugRound(cx, cy, r, base) {
    base = base || '#C4553B';
    shEll(cx, cy, r, r, { lift: 0.08, a: 0.13 });
    const g = ctx.createRadialGradient(M(cx - r * 0.3), M(cy - r * 0.3), 0, M(cx), M(cy), M(r));
    g.addColorStop(0, shade(base, 1.12)); g.addColorStop(1, shade(base, 0.86));
    ctx.beginPath(); ctx.arc(M(cx), M(cy), M(r), 0, 7); ctx.fillStyle = g; ctx.fill();
    for (let rr3 = r - 0.16; rr3 > 0.14; rr3 -= 0.24) {
      ctx.strokeStyle = 'rgba(255,240,220,0.09)'; ctx.lineWidth = M(0.07);
      ctx.beginPath(); ctx.arc(M(cx), M(cy), M(rr3), 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(50,20,12,0.06)'; ctx.lineWidth = M(0.025);
      ctx.beginPath(); ctx.arc(M(cx), M(cy), M(rr3 - 0.07), 0, 7); ctx.stroke();
    }
    ctx.save(); ctx.beginPath(); ctx.arc(M(cx), M(cy), M(r), 0, 7); ctx.clip();
    for (let i = 0; i < 220; i++) { const a2 = rng() * 6.28, rd = Math.sqrt(rng()) * r; ctx.fillStyle = rng() > 0.5 ? 'rgba(255,225,200,0.06)' : 'rgba(40,15,8,0.06)'; ctx.fillRect(M(cx + Math.cos(a2) * rd), M(cy + Math.sin(a2) * rd), 1.4, 1.4); }
    ctx.restore();
  }

  // ---------- greenery ----------
  function leafRosette(s, kind, seed) {
    const cache = renderScene._leafCache = renderScene._leafCache || {};
    const bucket = (seed >>> 0) % 8;
    const key = kind + '|' + bucket + '|' + s.toFixed(2) + '|' + S.toFixed(1);
    let sp = cache[key];
    if (!sp) {
      if (Object.keys(cache).length > 40) for (const k in cache) delete cache[k];
      sp = document.createElement('canvas');
      const half = Math.max(6, Math.ceil(M(0.46 * s)));
      sp.width = sp.height = half * 2;
      const old = ctx; ctx = sp.getContext('2d');
      ctx.translate(half, half);
      leafRosetteDraw(s, kind, bucket * 7919 + 13);
      ctx = old; cache[key] = sp;
    }
    ctx.save(); ctx.rotate(((seed >>> 0) % 360) * 0.01745);
    ctx.drawImage(sp, -sp.width / 2, -sp.height / 2);
    ctx.restore();
  }
  function leafRosetteDraw(s, kind, seed) {
    const r2 = mulberry32(seed);
    const n = kind === 'fern' ? 15 : 10;
    const len = (kind === 'fern' ? 0.34 : 0.30) * s, wid = (kind === 'fern' ? 0.075 : 0.13) * s;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < n; i++) {
        const a2 = (i / n) * 6.283 + layer * 0.33 + r2() * 0.22;
        const ll = len * (layer ? 0.62 : 1) * (0.82 + r2() * 0.36);
        const col = GREENS[(r2() * GREENS.length) | 0];
        ctx.save(); ctx.rotate(a2);
        const g = lg(0, 0, M(ll), 0, [[0, shade(col, layer ? 1.15 : 0.72)], [1, shade(col, layer ? 1.35 : 1.02)]]);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(M(0.03 * s), 0);
        ctx.quadraticCurveTo(M(ll * 0.5), -M(wid * (layer ? 0.7 : 1)), M(ll), -M(0.008));
        ctx.quadraticCurveTo(M(ll * 0.5), M(wid * (layer ? 0.7 : 1)), M(0.03 * s), 0);
        ctx.closePath(); ctx.fill();
        if (!layer) {
          // two-tone fold: darker lower half
          ctx.fillStyle = 'rgba(18,38,14,0.15)';
          ctx.beginPath(); ctx.moveTo(M(0.03 * s), 0);
          ctx.quadraticCurveTo(M(ll * 0.5), M(wid), M(ll), M(0.008));
          ctx.quadraticCurveTo(M(ll * 0.55), M(wid * 0.28), M(0.03 * s), 0);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(20,42,18,0.30)'; ctx.lineWidth = Math.max(0.6, M(0.006));
          ctx.beginPath(); ctx.moveTo(M(0.05 * s), 0); ctx.lineTo(M(ll * 0.95), 0); ctx.stroke();
          if (s > 0.45) { // side veins
            ctx.strokeStyle = 'rgba(228,255,216,0.22)'; ctx.lineWidth = Math.max(0.5, M(0.005));
            for (let v = 1; v <= 3; v++) {
              const t = v / 4;
              ctx.beginPath(); ctx.moveTo(M(ll * t), 0); ctx.lineTo(M(ll * t + 0.05 * s), -M(wid * 0.5 * (1 - t)));
              ctx.moveTo(M(ll * t), 0); ctx.lineTo(M(ll * t + 0.05 * s), M(wid * 0.5 * (1 - t)));
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }
    }
    ctx.fillStyle = 'rgba(240,255,225,0.5)'; ctx.beginPath(); ctx.arc(-M(0.03 * s), -M(0.03 * s), M(0.025 * s), 0, 7); ctx.fill();
  }
  function plant(f) {
    const s = f.s || 1;
    shEll(f.x, f.y, 0.31 * s, 0.27 * s, { lift: 1.15, a: 0.15 });
    shEll(f.x, f.y, 0.19 * s, 0.19 * s, { lift: 0.5, a: 0.2 });
    withT(f.x, f.y, 0, () => {
      const pr = 0.17 * s;
      const g = ctx.createRadialGradient(-M(pr * 0.3), -M(pr * 0.3), 0, 0, 0, M(pr));
      g.addColorStop(0, '#C98B62'); g.addColorStop(1, '#9A6644');
      ctx.beginPath(); ctx.arc(0, 0, M(pr), 0, 7); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(60,35,20,0.4)'; ctx.lineWidth = M(0.02); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,232,200,0.45)'; ctx.lineWidth = Math.max(0.7, M(0.016)); // rim light
      ctx.beginPath(); ctx.arc(0, 0, M(pr * 0.93), 3.45, 5.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(60,32,16,0.35)'; ctx.lineWidth = Math.max(0.7, M(0.014));
      ctx.beginPath(); ctx.arc(0, 0, M(pr * 0.93), 0.5, 2.4); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, M(pr * 0.78), 0, 7); ctx.fillStyle = '#33261A'; ctx.fill();
      const sr2 = mulberry32(hashStr('soil' + f.x + f.y));
      for (let i = 0; i < 14; i++) { // soil crumbs
        const a3 = sr2() * 6.28, rd = Math.sqrt(sr2()) * pr * 0.68;
        ctx.fillStyle = sr2() > 0.5 ? 'rgba(96,68,40,0.8)' : 'rgba(22,15,8,0.7)';
        ctx.beginPath(); ctx.arc(Math.cos(a3) * M(rd), Math.sin(a3) * M(rd), M(0.011 + sr2() * 0.012), 0, 7); ctx.fill();
      }
      leafRosette(s, f.kind, hashStr(layout.id + f.x + ',' + f.y));
    });
  }
  function trough(f) {
    const len = f.len, d = 0.4;
    shRect(f.x, f.y, f.rot === 90 ? d : len, f.rot === 90 ? len : d, { lift: 0.5, a: 0.17, r: 0.05 });
    withT(f.x, f.y, f.rot || 0, () => {
      fillRR(-M(len / 2), -M(d / 2), M(len), M(d), M(0.045), grV(0, -M(d / 2), 0, M(d), '#B08355', '#96693F'), 'rgba(80,52,24,0.5)', Math.max(1, M(0.014)));
      fillRR(-M(len / 2 - 0.06), -M(d / 2 - 0.06), M(len - 0.12), M(d - 0.12), M(0.03), '#33261A');
      ctx.fillStyle = 'rgba(235,228,212,0.65)';
      for (let i = 0; i < len * 9; i++) ctx.fillRect(-M(len / 2 - 0.09) + rng() * M(len - 0.18), (rng() - 0.5) * M(d - 0.2), 1.6, 1.6);
    });
    const k = Math.max(2, Math.round(f.len / 0.55));
    for (let i = 0; i < k; i++) {
      const t = -f.len / 2 + 0.3 + i * ((f.len - 0.6) / Math.max(1, k - 1));
      const px = f.rot === 90 ? f.x : f.x + t, py = f.rot === 90 ? f.y + t : f.y;
      withT(px + (rng() - 0.5) * 0.05, py + (rng() - 0.5) * 0.05, 0, () => leafRosette(0.52 + rng() * 0.14, i % 2 ? 'fern' : 'monstera', hashStr('tr' + f.x + i)));
    }
  }
  function pebbles(f) {
    const r2 = mulberry32(hashStr('peb' + f.x));
    withT(f.x, f.y, 0, () => {
      ctx.beginPath(); // organic blob
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const a2 = i / n * 6.283, rad = M((f.w / 2) * (0.8 + r2() * 0.25));
        const px = Math.cos(a2) * rad, py = Math.sin(a2) * rad * (f.h / f.w);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = grD(-M(f.w / 2), -M(f.h / 2), M(f.w), M(f.h), '#E2DDD2', '#CFC9BB'); ctx.fill();
      ctx.strokeStyle = 'rgba(110,100,84,0.25)'; ctx.lineWidth = M(0.015); ctx.stroke();
      ctx.clip();
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = r2() > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(130,120,104,0.4)';
        ctx.beginPath(); ctx.ellipse((r2() - 0.5) * M(f.w), (r2() - 0.5) * M(f.h), M(0.016 + r2() * 0.02), M(0.012 + r2() * 0.014), r2() * 3, 0, 7); ctx.fill();
      }
    });
  }
  function rocks(f) {
    const spec = [[0, 0, 0.30, 0.24, 0.4], [0.38, 0.22, 0.20, 0.16, 1.2], [-0.3, 0.26, 0.15, 0.12, 2.2]];
    for (const [dx, dy, rx, ry, rot] of spec) {
      shEll(f.x + dx, f.y + dy, rx, ry, { lift: 0.7, a: 0.2 });
      ctx.save(); ctx.translate(M(f.x + dx), M(f.y + dy)); ctx.rotate(rot);
      const g = ctx.createRadialGradient(-M(rx * 0.35), -M(ry * 0.4), 0, 0, 0, M(rx));
      g.addColorStop(0, '#A8A49B'); g.addColorStop(1, '#6E6A62');
      ctx.beginPath(); ctx.ellipse(0, 0, M(rx), M(ry), 0, 0, 7); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(0.8, M(0.012));
      ctx.beginPath(); ctx.ellipse(-M(rx * 0.12), -M(ry * 0.14), M(rx * 0.8), M(ry * 0.78), 0, 3.6, 5.4); ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- seating ----------
  function taskChair(x, y, rot, color) {
    color = color || '#262C3A';
    shEll(x, y, 0.33, 0.33, { lift: 0.5, a: 0.16 });
    const cache = renderScene._chairCache = renderScene._chairCache || {};
    const key = color + '|' + S.toFixed(1);
    let sp = cache[key];
    if (!sp) {
      if (Object.keys(cache).length > 24) for (const k in cache) delete cache[k];
      sp = document.createElement('canvas');
      const px = Math.max(8, Math.ceil(M(1.0)));
      sp.width = px; sp.height = px;
      const old = ctx; ctx = sp.getContext('2d');
      ctx.translate(px / 2, px / 2);
      taskChairBody(color);
      ctx = old;
      cache[key] = sp;
    }
    withT(x, y, rot, () => ctx.drawImage(sp, -sp.width / 2, -sp.height / 2));
  }
  function taskChairBody(color) {
      // 5-star base: two-tone spokes + swivel casters
      for (let i = 0; i < 5; i++) {
        const a2 = i * 1.2566 + 0.628, ex = Math.cos(a2), ey = Math.sin(a2);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#1A1E27'; ctx.lineWidth = Math.max(1.2, M(0.036));
        ctx.beginPath(); ctx.moveTo(ex * M(0.05), ey * M(0.05)); ctx.lineTo(ex * M(0.295), ey * M(0.295)); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = Math.max(0.7, M(0.011));
        ctx.beginPath(); ctx.moveTo(ex * M(0.08) - M(0.009), ey * M(0.08) - M(0.013)); ctx.lineTo(ex * M(0.26) - M(0.009), ey * M(0.26) - M(0.013)); ctx.stroke();
        const px2 = ex * M(0.315), py2 = ey * M(0.315);
        ctx.fillStyle = '#111419'; ctx.beginPath(); ctx.ellipse(px2, py2, M(0.052), M(0.038), a2, 0, 7); ctx.fill();
        ctx.fillStyle = '#3E4553'; ctx.beginPath(); ctx.arc(px2 - M(0.010), py2 - M(0.012), M(0.021), 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(px2 - M(0.015), py2 - M(0.017), M(0.009), 0, 7); ctx.fill();
      }
      // gas lift (metal, 3-stop)
      let g = ctx.createRadialGradient(-M(0.016), -M(0.016), 0, 0, 0, M(0.06));
      g.addColorStop(0, '#C2C7D1'); g.addColorStop(0.55, '#7A8090'); g.addColorStop(1, '#353B48');
      ctx.beginPath(); ctx.arc(0, 0, M(0.055), 0, 7); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = Math.max(0.7, M(0.008)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(0.6, M(0.007));
      ctx.beginPath(); ctx.arc(-M(0.008), -M(0.008), M(0.032), 3.4, 5.2); ctx.stroke();
      // armrests: post + pad (top highlight)
      for (const sx of [-1, 1]) {
        fillRR(sx * M(0.255) - M(0.028), -M(0.10), M(0.056), M(0.22), M(0.028), '#1E222C');
        fillRR(sx * M(0.30) - M(0.045), -M(0.19), M(0.09), M(0.30), M(0.045),
          grD(sx * M(0.30) - M(0.045), -M(0.19), M(0.09), M(0.30), shade(color, 1.32), shade(color, 0.70)), 'rgba(0,0,0,0.28)', Math.max(0.7, M(0.008)));
        fillRR(sx * M(0.30) - M(0.030), -M(0.175), M(0.06), M(0.075), M(0.03), 'rgba(255,255,255,0.17)');
      }
      // seat: 4-stop radial + seam ring + bolster shading
      g = ctx.createRadialGradient(-M(0.07), -M(0.095), M(0.02), 0, M(0.012), M(0.31));
      g.addColorStop(0, shade(color, 1.44)); g.addColorStop(0.42, shade(color, 1.12)); g.addColorStop(0.78, shade(color, 0.92)); g.addColorStop(1, shade(color, 0.64));
      fillRR(-M(0.215), -M(0.185), M(0.43), M(0.42), M(0.14), g, shade(color, 0.48), Math.max(0.8, M(0.011)));
      ctx.strokeStyle = alp('#000000', 0.18); ctx.lineWidth = Math.max(0.7, M(0.009));
      rr(-M(0.155), -M(0.125), M(0.31), M(0.30), M(0.09)); ctx.stroke();
      ctx.strokeStyle = alp('#000000', 0.20); ctx.lineWidth = Math.max(0.7, M(0.009));
      ctx.beginPath(); ctx.moveTo(-M(0.135), M(0.045)); ctx.quadraticCurveTo(0, M(0.098), M(0.135), M(0.045)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.17)'; ctx.lineWidth = Math.max(0.7, M(0.011));
      ctx.beginPath(); ctx.moveTo(-M(0.12), M(0.19)); ctx.quadraticCurveTo(0, M(0.235), M(0.12), M(0.19)); ctx.stroke();
      // mesh back + weave + lumbar
      fillRR(-M(0.24), -M(0.335), M(0.48), M(0.17), M(0.08), grV(0, -M(0.335), 0, M(0.17), shade(color, 1.34), shade(color, 0.82)), shade(color, 0.46), Math.max(0.8, M(0.01)));
      ctx.save(); rr(-M(0.212), -M(0.315), M(0.424), M(0.128), M(0.06)); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.20)'; ctx.lineWidth = Math.max(0.5, M(0.006));
      for (let mx2 = -0.21; mx2 <= 0.22; mx2 += 0.030) { ctx.beginPath(); ctx.moveTo(M(mx2), -M(0.34)); ctx.lineTo(M(mx2), -M(0.18)); ctx.stroke(); }
      for (let my2 = -0.315; my2 <= -0.18; my2 += 0.030) { ctx.beginPath(); ctx.moveTo(-M(0.22), M(my2)); ctx.lineTo(M(0.22), M(my2)); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(-M(0.22), -M(0.295), M(0.44), M(0.032));
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = Math.max(0.8, M(0.014));
      ctx.beginPath(); ctx.moveTo(-M(0.165), -M(0.30)); ctx.quadraticCurveTo(0, -M(0.268), M(0.165), -M(0.30)); ctx.stroke();
      fillRR(-M(0.19), -M(0.218), M(0.38), M(0.034), M(0.017), alp('#000000', 0.20));
      // headrest
      fillRR(-M(0.135), -M(0.425), M(0.27), M(0.082), M(0.041), grV(0, -M(0.425), 0, M(0.082), shade(color, 1.42), shade(color, 0.90)), shade(color, 0.48), Math.max(0.7, M(0.008)));
      fillRR(-M(0.10), -M(0.413), M(0.20), M(0.027), M(0.013), 'rgba(255,255,255,0.22)');
  }
  function execChair(x, y, rot, color) { taskChair(x, y, rot, color || '#D9A441'); }
  function sideChair(x, y, rot, color) {
    color = color || '#23262E';
    shEll(x, y, 0.24, 0.24, { lift: 0.4, a: 0.15 });
    withT(x, y, rot, () => {
      ctx.fillStyle = '#1C1F26';
      for (const [lx, ly] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) { ctx.beginPath(); ctx.arc(M(lx), M(ly), M(0.028), 0, 7); ctx.fill(); }
      fillRR(-M(0.19), -M(0.17), M(0.38), M(0.38), M(0.10), grD(-M(0.19), -M(0.17), M(0.38), M(0.38), shade(color, 1.35), shade(color, 0.85)), shade(color, 0.5), Math.max(0.8, M(0.01)));
      fillRR(-M(0.20), -M(0.275), M(0.40), M(0.12), M(0.06), grV(0, -M(0.275), 0, M(0.12), shade(color, 1.45), shade(color, 0.95)));
    });
  }
  function bistroChair(x, y, rot) {
    shEll(x, y, 0.21, 0.21, { lift: 0.35, a: 0.14 });
    withT(x, y, rot, () => {
      ctx.fillStyle = '#14171E';
      for (const [lx, ly] of [[-0.13, -0.11], [0.13, -0.11], [-0.13, 0.13], [0.13, 0.13]]) { ctx.beginPath(); ctx.arc(M(lx), M(ly), M(0.022), 0, 7); ctx.fill(); }
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#161A23'; ctx.lineWidth = M(0.065);
      ctx.beginPath(); ctx.arc(0, -M(0.02), M(0.185), Math.PI * 1.16, Math.PI * 1.84); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = M(0.02);
      ctx.beginPath(); ctx.arc(0, -M(0.024), M(0.202), Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
      const g = ctx.createRadialGradient(-M(0.055), -M(0.055), 0, 0, 0, M(0.185));
      g.addColorStop(0, '#4A5262'); g.addColorStop(0.6, '#333A48'); g.addColorStop(1, '#1E222B');
      ctx.beginPath(); ctx.arc(0, 0, M(0.175), 0, 7); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#12151C'; ctx.lineWidth = Math.max(0.8, M(0.012)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = Math.max(0.7, M(0.012));
      ctx.beginPath(); ctx.arc(0, 0, M(0.125), 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      for (let i = 0; i < 8; i++) { const a2 = i * 0.785; ctx.beginPath(); ctx.arc(Math.cos(a2) * M(0.07), Math.sin(a2) * M(0.07), M(0.011), 0, 7); ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, 0, M(0.014), 0, 7); ctx.fill();
    });
  }
  function stool(x, y) {
    shEll(x, y, 0.17, 0.17, { lift: 0.4, a: 0.15 });
    const g = ctx.createRadialGradient(M(x - 0.05), M(y - 0.05), 0, M(x), M(y), M(0.17));
    g.addColorStop(0, '#E9B94F'); g.addColorStop(1, '#C08F2E');
    ctx.beginPath(); ctx.arc(M(x), M(y), M(0.165), 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,10,0.4)'; ctx.lineWidth = Math.max(0.8, M(0.012)); ctx.stroke();
  }
  function pouf(f) {
    shEll(f.x, f.y, 0.28, 0.28, { lift: 0.4, a: 0.16 });
    const c = f.color || '#3E6FB0';
    const g = ctx.createRadialGradient(M(f.x - 0.09), M(f.y - 0.09), 0, M(f.x), M(f.y), M(0.28));
    g.addColorStop(0, shade(c, 1.25)); g.addColorStop(1, shade(c, 0.8));
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.27), 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = alp('#000000', 0.10); ctx.lineWidth = Math.max(0.8, M(0.012));
    for (let i = 0; i < 4; i++) { const a2 = i * 1.5708 + 0.785; ctx.beginPath(); ctx.moveTo(M(f.x), M(f.y)); ctx.lineTo(M(f.x) + Math.cos(a2) * M(0.25), M(f.y) + Math.sin(a2) * M(0.25)); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = Math.max(0.7, M(0.012));
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.045), 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.028), 0, 7); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.26), 0, 7); ctx.clip(); // fabric weave
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = Math.max(0.5, M(0.006));
    for (let wx2 = -0.26; wx2 <= 0.26; wx2 += 0.042) { ctx.beginPath(); ctx.moveTo(M(f.x + wx2), M(f.y - 0.27)); ctx.lineTo(M(f.x + wx2), M(f.y + 0.27)); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    for (let wy2 = -0.26; wy2 <= 0.26; wy2 += 0.042) { ctx.beginPath(); ctx.moveTo(M(f.x - 0.27), M(f.y + wy2)); ctx.lineTo(M(f.x + 0.27), M(f.y + wy2)); ctx.stroke(); }
    ctx.restore();
  }
  function tubChair(f) {
    const c = f.color || '#C4553B';
    shEll(f.x, f.y, 0.37, 0.37, { lift: 0.6, a: 0.18 });
    withT(f.x, f.y, f.rot || 0, () => {
      ctx.lineCap = 'round';
      const st = Math.PI / 2 + 0.62, en = Math.PI / 2 - 0.62 + Math.PI * 2; // opening = front(+y)
      ctx.beginPath(); ctx.arc(0, 0, M(0.30), st, en);
      ctx.strokeStyle = shade(c, 0.92); ctx.lineWidth = M(0.155); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, M(0.352), st + 0.12, en - 0.12);
      ctx.strokeStyle = shade(c, 1.20); ctx.lineWidth = M(0.05); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, M(0.248), st + 0.18, en - 0.18);
      ctx.strokeStyle = shade(c, 0.72); ctx.lineWidth = M(0.045); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = M(0.032); // NW shell highlight
      ctx.beginPath(); ctx.arc(-M(0.008), -M(0.012), M(0.315), Math.PI * 1.08, Math.PI * 1.70); ctx.stroke();
      const g = ctx.createRadialGradient(-M(0.06), -M(0.05), 0, 0, M(0.02), M(0.24));
      g.addColorStop(0, shade(c, 1.30)); g.addColorStop(0.65, shade(c, 1.05)); g.addColorStop(1, shade(c, 0.80));
      ctx.beginPath(); ctx.arc(0, M(0.02), M(0.215), 0, 7); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = alp('#000000', 0.16); ctx.lineWidth = Math.max(0.7, M(0.01)); ctx.stroke();
      ctx.strokeStyle = alp('#FFFFFF', 0.30); ctx.lineWidth = Math.max(0.7, M(0.012));
      ctx.beginPath(); ctx.arc(0, M(0.02), M(0.162), 0, 7); ctx.stroke();
      ctx.strokeStyle = alp('#000000', 0.13); ctx.lineWidth = Math.max(0.6, M(0.009));
      ctx.beginPath(); ctx.moveTo(-M(0.10), M(0.125)); ctx.quadraticCurveTo(0, M(0.168), M(0.10), M(0.125)); ctx.stroke();
    });
  }
  function sofa(f) {
    const w = f.w, d = 0.95, c = f.color || '#E3B23C';
    shRect(f.x, f.y, w, d, { lift: 0.9, a: 0.22, r: 0.12, rot: f.rot });
    withT(f.x, f.y, f.rot || 0, () => {
      fillRR(-M(w / 2), -M(d / 2), M(w), M(d), M(0.10), shade(c, 0.8));
      // arms
      for (const sx of [-1, 1]) fillRR(sx > 0 ? M(w / 2 - 0.17) : -M(w / 2), -M(d / 2), M(0.17), M(d), M(0.085), grD(sx > 0 ? M(w / 2 - 0.17) : -M(w / 2), -M(d / 2), M(0.17), M(d), shade(c, 1.16), shade(c, 0.86)));
      // back (at -y)
      fillRR(-M(w / 2 - 0.15), -M(d / 2), M(w - 0.3), M(0.28), M(0.06), grV(0, -M(d / 2), 0, M(0.28), shade(c, 1.22), shade(c, 0.95)));
      // seat cushions: 4-stop + piping + front crease
      const n = w > 2 ? 3 : 2, cw = (w - 0.34 - 0.04 * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const cx0 = -w / 2 + 0.17 + i * (cw + 0.04);
        fillRR(M(cx0), -M(d / 2 - 0.30), M(cw), M(d - 0.42), M(0.07),
          lg(M(cx0), -M(d / 2 - 0.30), M(cx0 + cw), -M(d / 2 - 0.30) + M(d - 0.42),
            [[0, shade(c, 1.28)], [0.45, shade(c, 1.06)], [0.8, shade(c, 0.92)], [1, shade(c, 0.76)]]), alp('#000000', 0.12), Math.max(0.8, M(0.01)));
        ctx.strokeStyle = alp('#FFFFFF', 0.30); ctx.lineWidth = Math.max(0.7, M(0.012));
        rr(M(cx0 + 0.035), -M(d / 2 - 0.335), M(cw - 0.07), M(d - 0.49), M(0.05)); ctx.stroke();
        ctx.strokeStyle = alp('#000000', 0.10); ctx.lineWidth = Math.max(0.6, M(0.008));
        ctx.beginPath(); ctx.moveTo(M(cx0 + 0.05), M(d / 2 - 0.20)); ctx.quadraticCurveTo(M(cx0 + cw / 2), M(d / 2 - 0.155), M(cx0 + cw - 0.05), M(d / 2 - 0.20)); ctx.stroke();
      }
      // back seams + top piping + arm highlights + feet
      ctx.strokeStyle = alp('#000000', 0.16); ctx.lineWidth = Math.max(0.7, M(0.01));
      for (let i = 1; i < n; i++) { const sx2 = -w / 2 + 0.15 + i * ((w - 0.3) / n); ctx.beginPath(); ctx.moveTo(M(sx2), -M(d / 2 - 0.03)); ctx.lineTo(M(sx2), -M(d / 2 - 0.26)); ctx.stroke(); }
      ctx.strokeStyle = alp('#FFFFFF', 0.30); ctx.lineWidth = Math.max(0.7, M(0.012));
      ctx.beginPath(); ctx.moveTo(-M(w / 2 - 0.18), -M(d / 2 - 0.045)); ctx.lineTo(M(w / 2 - 0.18), -M(d / 2 - 0.045)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      for (const sx of [-1, 1]) { const ax2 = sx * M(w / 2 - 0.085); ctx.beginPath(); ctx.moveTo(ax2, -M(d / 2 - 0.04)); ctx.lineTo(ax2, M(d / 2 - 0.07)); ctx.stroke(); }
      for (const lx2 of [-w / 2 + 0.07, w / 2 - 0.07]) {
        ctx.fillStyle = '#5E452E'; ctx.beginPath(); ctx.ellipse(M(lx2), M(d / 2 + 0.012), M(0.036), M(0.02), 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.ellipse(M(lx2 - 0.008), M(d / 2 + 0.006), M(0.012), M(0.006), 0, 0, 7); ctx.fill();
      }
      // throw pillows
      const pc = ['#33415E', '#C4553B'];
      for (const [i, sx] of [[-1, 0], [1, 1]]) {
        ctx.save(); ctx.translate(M(i * (w / 2 - 0.34)), -M(d / 2 - 0.22)); ctx.rotate(i * 0.25);
        fillRR(-M(0.15), -M(0.13), M(0.30), M(0.26), M(0.05), grD(-M(0.15), -M(0.13), M(0.3), M(0.26), shade(pc[sx], 1.25), shade(pc[sx], 0.9)));
        ctx.restore();
      }
    });
  }

  // ---------- tables & work ----------
  function woodTop(x, y, w, h, r, base, grain) {
    fillRR(M(x), M(y), M(w), M(h), M(r), grD(M(x), M(y), M(w), M(h), shade(base, 1.14), shade(base, 0.9)), shade(base, 0.62), Math.max(1, M(0.014)));
    ctx.save(); rr(M(x), M(y), M(w), M(h), M(r)); ctx.clip();
    ctx.lineWidth = Math.max(0.7, M(0.007));
    for (let i = 0; i < (grain || 6); i++) {
      const gy = y + h * (i + 0.5) / (grain || 6);
      ctx.strokeStyle = i % 2 ? 'rgba(255,240,210,0.13)' : 'rgba(100,64,30,0.13)';
      ctx.beginPath(); ctx.moveTo(M(x + 0.05), M(gy)); ctx.quadraticCurveTo(M(x + w / 2), M(gy) + (rng() - 0.5) * M(0.06), M(x + w - 0.05), M(gy)); ctx.stroke();
    }
    ctx.fillStyle = lg(M(x), M(y), M(x + w), M(y + h), [[0, 'rgba(255,248,230,0.14)'], [1, 'rgba(70,45,20,0.05)']]);
    ctx.fillRect(M(x), M(y), M(w), M(h));
    ctx.restore();
    // edge bevel: TL light / BR shade
    rr(M(x + 0.016), M(y + 0.016), M(w - 0.032), M(h - 0.032), M(r)); 
    ctx.strokeStyle = 'rgba(255,246,224,0.30)'; ctx.lineWidth = Math.max(0.7, M(0.009)); ctx.stroke();
    rr(M(x + 0.004), M(y + 0.004), M(w), M(h), M(r));
    ctx.strokeStyle = 'rgba(58,36,16,0.22)'; ctx.lineWidth = Math.max(0.7, M(0.009)); ctx.stroke();
  }
  function laptop(x, y, rot) {
    withT(x, y, rot, () => {
      fillRR(-M(0.17), -M(0.115), M(0.34), M(0.115), M(0.015), grV(0, -M(0.115), 0, M(0.115), '#3A404D', '#20242E'));
      ctx.fillStyle = 'rgba(140,190,255,0.30)'; fillRR(-M(0.155), -M(0.10), M(0.31), M(0.085), M(0.01), 'rgba(120,170,235,0.35)');
      fillRR(-M(0.17), M(0.005), M(0.34), M(0.115), M(0.015), grV(0, 0, 0, M(0.115), '#D8D7D3', '#B9B8B3'));
      ctx.fillStyle = 'rgba(70,70,75,0.5)';
      for (let r2 = 0; r2 < 3; r2++) ctx.fillRect(-M(0.14), M(0.025 + r2 * 0.028), M(0.28), M(0.016));
    });
    lights.push({ x, y, r: 0.7, c: 'cool', a: 0.22 });
  }
  function panelMon(w, occ) {
    ctx.fillStyle = '#171B24'; ctx.beginPath(); ctx.ellipse(0, M(0.085), M(0.10), M(0.042), 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.ellipse(0, M(0.079), M(0.074), M(0.026), 0, 0, 7); ctx.fill();
    fillRR(-M(0.022), M(0.004), M(0.044), M(0.072), M(0.012), grD(-M(0.022), 0, M(0.044), M(0.072), '#3E4553', '#1E222C'));
    fillRR(-M(w / 2), -M(0.092), M(w), M(0.112), M(0.02), grV(0, -M(0.092), 0, M(0.112), '#242936', '#0C0F15'), 'rgba(255,255,255,0.14)', Math.max(0.8, M(0.008)));
    const sw2 = w - 0.045, sh2 = 0.052;
    ctx.save(); rr(-M(sw2 / 2), -M(0.078), M(sw2), M(sh2), M(0.008)); ctx.clip();
    if (occ) {
      ctx.fillStyle = lg(-M(sw2 / 2), 0, M(sw2 / 2), 0, [[0, '#2E5F9E'], [0.45, '#5D93D6'], [1, '#2A568F']]);
      ctx.fillRect(-M(sw2 / 2), -M(0.078), M(sw2), M(sh2));
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-M(sw2 / 2 - 0.02), -M(0.070), M(sw2 * 0.30), M(0.010));
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(-M(sw2 / 2 - 0.02), -M(0.053), M(sw2 * 0.55), M(0.007));
      ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fillRect(-M(sw2 / 2 - 0.02), -M(0.041), M(sw2 * 0.42), M(0.007));
      ctx.fillStyle = 'rgba(126,216,166,0.9)'; ctx.fillRect(M(sw2 / 2 - 0.095), -M(0.070), M(0.07), M(0.024));
    } else {
      ctx.fillStyle = lg(0, -M(0.078), 0, -M(0.026), [[0, '#1A1F29'], [1, '#10141C']]);
      ctx.fillRect(-M(sw2 / 2), -M(0.078), M(sw2), M(sh2));
    }
    // diagonal reflection streaks
    ctx.rotate(-0.5);
    ctx.fillStyle = occ ? 'rgba(255,255,255,0.14)' : 'rgba(160,190,230,0.08)';
    ctx.fillRect(-M(0.05), -M(0.3), M(0.045), M(0.6));
    ctx.fillStyle = occ ? 'rgba(255,255,255,0.07)' : 'rgba(160,190,230,0.04)';
    ctx.fillRect(M(0.012), -M(0.3), M(0.02), M(0.6));
    ctx.restore();
    ctx.fillStyle = occ ? '#7ED8A6' : 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.arc(M(w / 2 - 0.03), M(0.006), M(0.007), 0, 7); ctx.fill();
  }
  function seatKit(wx, wy, rot, seed, occ) {
    const r2 = mulberry32(seed);
    const matC = ['#2E3648', '#3D3630', '#54413A', '#2F3E3A'][(r2() * 4) | 0];
    const kbLight = r2() < 0.45;
    let variant;
    if (occ) variant = r2() < 0.38 ? 'dual' : r2() < 0.72 ? 'single' : 'laptop';
    else variant = r2() < 0.45 ? 'closed' : 'single';
    withT(wx, wy, rot, () => {
      if (variant !== 'closed') {
        fillRR(-M(0.27), -M(0.325), M(0.54), M(0.27), M(0.035), alp(matC, 0.92), 'rgba(0,0,0,0.12)', Math.max(0.7, M(0.007)));
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(-M(0.27), -M(0.325), M(0.54), M(0.05));
        const kc = kbLight ? '#D9D8D2' : '#262B36';
        fillRR(-M(0.165), -M(0.29), M(0.33), M(0.105), M(0.014), kc, kbLight ? 'rgba(120,120,115,0.5)' : 'rgba(0,0,0,0.4)', Math.max(0.7, M(0.007)));
        ctx.strokeStyle = kbLight ? 'rgba(90,90,88,0.4)' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = Math.max(0.6, M(0.006));
        for (let r3 = 1; r3 < 4; r3++) { const ky = -0.29 + r3 * 0.026; ctx.beginPath(); ctx.moveTo(-M(0.15), M(ky)); ctx.lineTo(M(0.15), M(ky)); ctx.stroke(); }
        ctx.beginPath(); ctx.ellipse(M(0.225), -M(0.235), M(0.026), M(0.038), 0, 0, 7);
        ctx.fillStyle = kbLight ? '#CFCEC8' : '#2E3440'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = Math.max(0.6, M(0.006)); ctx.stroke();
      }
      if (variant === 'dual') {
        ctx.save(); ctx.translate(-M(0.205), 0); ctx.rotate(0.10); panelMon(0.38, occ); ctx.restore();
        ctx.save(); ctx.translate(M(0.205), 0); ctx.rotate(-0.10); panelMon(0.38, occ); ctx.restore();
      } else if (variant === 'single') { panelMon(0.55, occ); }
      else if (variant === 'laptop') {
        fillRR(-M(0.16), -M(0.115), M(0.32), M(0.10), M(0.014), grV(0, -M(0.115), 0, M(0.10), '#3A404D', '#20242E'));
        const g = lg(-M(0.14), 0, M(0.14), 0, [[0, 'rgba(130,180,255,0.5)'], [1, 'rgba(170,215,255,0.68)']]);
        fillRR(-M(0.14), -M(0.10), M(0.28), M(0.07), M(0.01), occ ? g : '#1B2029');
        fillRR(-M(0.16), -M(0.005), M(0.32), M(0.105), M(0.014), grV(0, 0, 0, M(0.105), '#D8D7D3', '#B9B8B3'));
        ctx.fillStyle = 'rgba(70,70,75,0.5)';
        for (let r3 = 0; r3 < 3; r3++) ctx.fillRect(-M(0.13), M(0.012 + r3 * 0.026), M(0.26), M(0.014));
      } else {
        fillRR(-M(0.165), -M(0.14), M(0.33), M(0.225), M(0.025), grD(-M(0.165), -M(0.14), M(0.33), M(0.225), '#39404E', '#232833'), 'rgba(255,255,255,0.10)', Math.max(0.7, M(0.008)));
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(0, -M(0.028), M(0.02), 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(0.6, M(0.007));
        ctx.beginPath(); ctx.moveTo(-M(0.165), M(0.052)); ctx.lineTo(M(0.165), M(0.052)); ctx.stroke();
      }
      if (r2() < 0.5) {
        ctx.save(); ctx.translate(-M(0.44), M(0.02)); ctx.rotate((r2() - 0.5) * 0.8);
        ctx.strokeStyle = '#2A2E38'; ctx.lineWidth = M(0.024);
        ctx.beginPath(); ctx.arc(0, 0, M(0.065), 0.35, Math.PI - 0.35); ctx.stroke();
        ctx.fillStyle = '#3A404D';
        ctx.beginPath(); ctx.ellipse(-M(0.058), M(0.022), M(0.022), M(0.033), 0.5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(M(0.058), M(0.022), M(0.022), M(0.033), -0.5, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(-M(0.052), M(0.016), M(0.008), 0, 7); ctx.fill();
        ctx.restore();
      }
      const pool = ['mug', 'plant', 'note', 'phone', 'bottle'].sort(() => r2() - 0.5).slice(0, occ ? 2 : 1);
      let px = 0.46;
      for (const p of pool) {
        const fx = px, fy = -0.10 + (r2() - 0.5) * 0.1;
        if (p === 'mug') {
          ctx.beginPath(); ctx.arc(M(fx), M(fy), M(0.046), 0, 7); ctx.fillStyle = ['#C4553B', '#3E6FB0', '#E3B23C', '#4C7F46'][(r2() * 4) | 0]; ctx.fill();
          ctx.beginPath(); ctx.arc(M(fx), M(fy), M(0.028), 0, 7); ctx.fillStyle = '#5C3A22'; ctx.fill();
          ctx.strokeStyle = 'rgba(60,40,30,0.55)'; ctx.lineWidth = Math.max(0.8, M(0.013));
          ctx.beginPath(); ctx.arc(M(fx + 0.052), M(fy), M(0.018), -1.4, 1.4); ctx.stroke();
        } else if (p === 'plant') {
          withT(fx, fy, 0, () => { ctx.fillStyle = '#B47952'; ctx.beginPath(); ctx.arc(0, 0, M(0.045), 0, 7); ctx.fill(); leafRosette(0.2, 'fern', seed + 11); });
        } else if (p === 'note') {
          ctx.save(); ctx.translate(M(fx), M(fy)); ctx.rotate((r2() - 0.5) * 0.7);
          fillRR(-M(0.065), -M(0.085), M(0.13), M(0.17), M(0.008), '#F4F1E9', 'rgba(120,115,100,0.5)', Math.max(0.7, M(0.006)));
          ctx.strokeStyle = 'rgba(120,115,100,0.45)'; ctx.lineWidth = Math.max(0.6, M(0.006));
          for (let li = 0; li < 3; li++) { ctx.beginPath(); ctx.moveTo(-M(0.04), M(-0.045 + li * 0.038)); ctx.lineTo(M(0.04), M(-0.045 + li * 0.038)); ctx.stroke(); }
          ctx.restore();
        } else if (p === 'phone') {
          ctx.save(); ctx.translate(M(fx), M(fy)); ctx.rotate(0.3 + r2() * 0.5);
          fillRR(-M(0.032), -M(0.065), M(0.064), M(0.13), M(0.018), '#1A1E28', 'rgba(255,255,255,0.18)', Math.max(0.6, M(0.006)));
          ctx.restore();
        } else {
          fillRR(M(fx - 0.024), M(fy - 0.06), M(0.048), M(0.12), M(0.024), grV(0, M(fy - 0.06), 0, M(0.12), '#7FB8AE', '#4E8A80'), 'rgba(0,0,0,0.15)', Math.max(0.6, M(0.006)));
          ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(M(fx), M(fy - 0.038), M(0.014), 0, 7); ctx.fill();
        }
        px = -0.52;
      }
    });
    if (occ && variant !== 'closed') lights.push({ x: wx, y: wy, r: 0.75, c: 'cool', a: 0.24 });
  }
  function bench4(f) {
    const w = 2.9, d = 1.5, x = f.x, y = f.y;
    shCluster(x, y, w + 0.4, d + 1.6);
    const seatDefs = [[-0.725, -1, 0], [0.725, -1, 1], [-0.725, 1, 2], [0.725, 1, 3]];
    const occs = [];
    for (const [sx, sy, i] of seatDefs) {
      const cx = x + sx, cy = y + sy * (d / 2 + 0.42);
      const occ = isOcc(cx, cy); occs[i] = occ;
      const r2 = mulberry32(hashStr(layout.id + 'st' + x + '|' + y + '|' + i));
      const jr = (r2() - 0.5) * (occ ? 9 : 24);
      const tx = occ ? 0 : (r2() - 0.5) * 0.14;
      const ty = occ ? -0.05 * sy : (r2() - 0.3) * 0.12 * sy;
      taskChair(cx + tx, cy + ty, (sy < 0 ? 0 : 180) + jr);
      seats.push({ id: layout.id + '-ws-' + x + '-' + i, x: cx, y: cy, occupied: occ });
    }
    shRect(x, y, w, d, { lift: 0.85, a: 0.2, r: 0.06 });
    withT(x, y, 0, () => {
      fillRR(-M(w / 2), -M(d / 2), M(w), M(d), M(0.05), grD(-M(w / 2), -M(d / 2), M(w), M(d), '#F8F6F1', '#E6E3DC'), '#CFCBC2', Math.max(1, M(0.014)));
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = Math.max(0.8, M(0.012));
      ctx.beginPath(); ctx.moveTo(-M(w / 2 - 0.03), M(d / 2 - 0.02)); ctx.lineTo(-M(w / 2 - 0.03), -M(d / 2 - 0.02)); ctx.lineTo(M(w / 2 - 0.03), -M(d / 2 - 0.02)); ctx.stroke();
      fillRR(-M(w / 2 - 0.08), -M(0.045), M(w - 0.16), M(0.09), M(0.03), grV(0, -M(0.045), 0, M(0.09), '#3A486A', '#28344C'));
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(-M(w / 2 - 0.08), -M(0.045), M(w - 0.16), M(0.02));
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (let gx = -w / 2 + 0.25; gx < w / 2 - 0.2; gx += 0.18) { ctx.beginPath(); ctx.arc(M(gx), 0, M(0.012), 0, 7); ctx.fill(); }
      for (const gx of [-0.725, 0.725]) { ctx.beginPath(); ctx.arc(M(gx), 0, M(0.035), 0, 7); ctx.fillStyle = '#20242E'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = Math.max(0.6, M(0.007)); ctx.stroke(); }
    });
    for (const [sx, sy, i] of seatDefs) {
      seatKit(x + sx, y + sy * 0.34, sy < 0 ? 0 : 180, hashStr(layout.id + 'kit' + x + '|' + y + '|' + i), occs[i]);
    }
  }
  function meetingTable(f) {
    const w = f.w, h = f.h, n = f.seats || 8;
    const perSide = Math.max(1, Math.floor((n - 2) / 2));
    for (let i = 0; i < perSide; i++) {
      const t = (i + 0.5) / perSide, cx = f.x - w / 2 + w * t;
      execChair(cx, f.y - h / 2 - 0.42, (rng() - 0.5) * 14); execChair(cx, f.y + h / 2 + 0.42, 180 + (rng() - 0.5) * 14);
      seats.push({ id: layout.id + '-mt-N' + i, x: cx, y: f.y - h / 2 - 0.42 });
      seats.push({ id: layout.id + '-mt-S' + i, x: cx, y: f.y + h / 2 + 0.42 });
    }
    if (n - perSide * 2 >= 1) { execChair(f.x + w / 2 + 0.42, f.y, 270 + (rng() - 0.5) * 12); seats.push({ id: layout.id + '-mt-E', x: f.x + w / 2 + 0.42, y: f.y }); }
    if (n - perSide * 2 >= 2) { execChair(f.x - w / 2 - 0.42, f.y, 90 + (rng() - 0.5) * 12); seats.push({ id: layout.id + '-mt-W', x: f.x - w / 2 - 0.42, y: f.y }); }
    shCluster(f.x, f.y, w + 0.9, h + 0.9);
    shRect(f.x, f.y, w, h, { lift: 0.85, a: 0.2, r: 0.1 });
    woodTop(f.x - w / 2, f.y - h / 2, w, h, 0.09, '#B98A59', 7);
    withT(f.x, f.y, 0, () => {
      fillRR(-M(0.35), -M(0.055), M(0.7), M(0.11), M(0.05), 'rgba(32,40,58,0.85)');
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-M(0.3), -M(0.008), M(0.6), M(0.016));
      for (const dx of [-w / 2 + 0.45, w / 2 - 0.45]) { // note pads
        ctx.save(); ctx.translate(M(dx), 0); ctx.rotate((rng() - 0.5) * 0.4);
        fillRR(-M(0.09), -M(0.12), M(0.18), M(0.24), M(0.01), '#F4F1E9', 'rgba(120,115,100,0.4)', Math.max(0.7, M(0.007)));
        ctx.restore();
      }
    });
  }
  function diningTable(f) {
    const w = f.w, h = f.h;
    for (let i = 0; i < 3; i++) {
      const cx = f.x - w / 2 + w * ((i + 0.5) / 3);
      sideChair(cx, f.y - h / 2 - 0.4, (rng() - 0.5) * 12); sideChair(cx, f.y + h / 2 + 0.4, 180 + (rng() - 0.5) * 12);
      seats.push({ id: layout.id + '-dn-N' + i, x: cx, y: f.y - h / 2 - 0.4 });
      seats.push({ id: layout.id + '-dn-S' + i, x: cx, y: f.y + h / 2 + 0.4 });
    }
    shRect(f.x, f.y, w, h, { lift: 0.85, a: 0.22, r: 0.06 });
    woodTop(f.x - w / 2, f.y - h / 2, w, h, 0.05, '#6B4A33', 8);
    withT(f.x, f.y, 0, () => {
      fillRR(-M(0.5), -M(0.16), M(1.0), M(0.32), M(0.03), 'rgba(240,235,222,0.9)'); // runner
      withT(-0.25, 0, 0, () => leafRosette(0.3, 'fern', hashStr('din' + f.x)));
      ctx.beginPath(); ctx.arc(M(0.22), 0, M(0.07), 0, 7); ctx.fillStyle = '#C4553B'; ctx.fill(); // bowl
      ctx.beginPath(); ctx.arc(M(0.22), 0, M(0.045), 0, 7); ctx.fillStyle = '#E3B23C'; ctx.fill();
    });
  }
  function cafeTable(f) {
    for (const a2 of f.chairs || [0, 180]) {
      const rad = a2 * Math.PI / 180;
      bistroChair(f.x + Math.sin(rad) * 0.62, f.y - Math.cos(rad) * 0.62, a2 + (rng() - 0.5) * 16);
      seats.push({ id: layout.id + '-cf-' + f.x + '-' + a2, x: f.x + Math.sin(rad) * 0.62, y: f.y - Math.cos(rad) * 0.62 });
    }
    shEll(f.x, f.y, 0.42, 0.42, { lift: 0.7, a: 0.18 });
    const g = ctx.createRadialGradient(M(f.x - 0.14), M(f.y - 0.14), 0, M(f.x), M(f.y), M(0.42));
    g.addColorStop(0, shade('#C89A6B', 1.18)); g.addColorStop(1, shade('#C89A6B', 0.88));
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.41), 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = shade('#C89A6B', 0.6); ctx.lineWidth = Math.max(1, M(0.014)); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,215,0.4)'; ctx.lineWidth = Math.max(0.8, M(0.016)); // NW edge bevel
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.385), 3.5, 5.4); ctx.stroke();
    for (const gr2 of [0.30, 0.21, 0.13]) { // grain rings
      ctx.beginPath(); ctx.arc(M(f.x + 0.02), M(f.y + 0.01), M(gr2), 0, 7);
      ctx.strokeStyle = 'rgba(90,55,25,0.15)'; ctx.lineWidth = Math.max(0.7, M(0.009)); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(M(f.x - 0.1), M(f.y + 0.08), M(0.045), 0, 7); ctx.fillStyle = '#F4F1E9'; ctx.fill();
    ctx.beginPath(); ctx.arc(M(f.x - 0.1), M(f.y + 0.08), M(0.028), 0, 7); ctx.fillStyle = '#5C3A22'; ctx.fill();
    withT(f.x + 0.12, f.y - 0.06, 0, () => leafRosette(0.2, 'fern', hashStr('cafe' + f.x)));
  }
  function coffeeTable(f) {
    shEll(f.x, f.y, f.r + 0.03, f.r + 0.03, { lift: 0.5, a: 0.17 });
    const g = ctx.createRadialGradient(M(f.x - f.r * 0.3), M(f.y - f.r * 0.3), 0, M(f.x), M(f.y), M(f.r));
    g.addColorStop(0, '#8A6A4C'); g.addColorStop(1, '#6E5138');
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(f.r), 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(40,26,14,0.5)'; ctx.lineWidth = Math.max(1, M(0.014)); ctx.stroke();
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(f.r - 0.07), 0, 7); ctx.strokeStyle = 'rgba(255,240,220,0.2)'; ctx.lineWidth = Math.max(0.8, M(0.01)); ctx.stroke();
    withT(f.x, f.y, 12, () => {
      fillRR(-M(0.14), -M(0.10), M(0.28), M(0.20), M(0.02), '#F0EDE5', 'rgba(110,105,92,0.4)', Math.max(0.7, M(0.007)));
      fillRR(-M(0.10), -M(0.065), M(0.17), M(0.12), M(0.01), '#3E6FB0');
      fillRR(-M(0.07), -M(0.04), M(0.17), M(0.12), M(0.01), '#C4553B');
    });
    ctx.beginPath(); ctx.arc(M(f.x + f.r * 0.45), M(f.y - f.r * 0.35), M(0.05), 0, 7); ctx.fillStyle = '#D9D6CE'; ctx.fill();
  }
  function sideTable(f) {
    shEll(f.x, f.y, f.r + 0.02, f.r + 0.02, { lift: 0.5, a: 0.16 });
    const g = ctx.createRadialGradient(M(f.x - f.r * 0.3), M(f.y - f.r * 0.3), 0, M(f.x), M(f.y), M(f.r));
    g.addColorStop(0, '#3E4757'); g.addColorStop(1, '#2A3140');
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(f.r), 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = Math.max(0.8, M(0.01)); ctx.stroke();
    ctx.beginPath(); ctx.arc(M(f.x - 0.03), M(f.y + 0.02), M(0.045), 0, 7); ctx.fillStyle = '#E3B23C'; ctx.fill();
  }
  function lamp(f) {
    shEll(f.x, f.y, 0.1, 0.1, { lift: 1.4, a: 0.13 });
    const g = ctx.createRadialGradient(M(f.x), M(f.y), 0, M(f.x), M(f.y), M(0.27));
    g.addColorStop(0, 'rgba(255,214,150,0.55)'); g.addColorStop(0.7, 'rgba(244,196,120,0.35)'); g.addColorStop(1, 'rgba(244,196,120,0.05)');
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.27), 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.20), 0, 7); ctx.strokeStyle = 'rgba(120,88,40,0.45)'; ctx.lineWidth = Math.max(0.8, M(0.012)); ctx.stroke();
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.03), 0, 7); ctx.fillStyle = '#4A4038'; ctx.fill();
    lights.push({ x: f.x, y: f.y, r: 2.3, c: 'warm', a: 0.5 });
  }

  // ---------- pantry / misc ----------
  function counter(f) {
    const rot = { N: 0, E: 90, S: 180, W: 270 }[f.side || 'N'];
    shRect(f.x, f.y, f.side === 'W' || f.side === 'E' ? 0.62 : f.len, f.side === 'W' || f.side === 'E' ? f.len : 0.62, { lift: 0.7, a: 0.18, r: 0.04 });
    withT(f.x, f.y, rot, () => {
      const L2 = f.len, D = 0.62;
      // backsplash tile band (wall side)
      fillRR(-M(L2 / 2), -M(D / 2 + 0.15), M(L2), M(0.16), M(0.01), '#DCE4E6');
      ctx.save(); rr(-M(L2 / 2), -M(D / 2 + 0.15), M(L2), M(0.16), M(0.01)); ctx.clip();
      ctx.strokeStyle = 'rgba(120,140,145,0.4)'; ctx.lineWidth = Math.max(0.6, M(0.008));
      for (let tx = -L2 / 2; tx <= L2 / 2; tx += 0.16) { ctx.beginPath(); ctx.moveTo(M(tx), -M(D / 2 + 0.15)); ctx.lineTo(M(tx), -M(D / 2)); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(-M(L2 / 2), -M(D / 2 + 0.075)); ctx.lineTo(M(L2 / 2), -M(D / 2 + 0.075)); ctx.stroke();
      const r3 = mulberry32(hashStr('bs' + f.x));
      const tcols = ['rgba(126,178,190,0.5)', 'rgba(94,142,158,0.45)', 'rgba(180,205,210,0.55)'];
      for (let ti = 0; ti < (L2 / 0.16) * 2; ti++) {
        if (r3() < 0.42) {
          ctx.fillStyle = tcols[(r3() * 3) | 0];
          ctx.fillRect(M(-L2 / 2 + ((ti / 2) | 0) * 0.16) + 1, -M(D / 2 + (ti % 2 ? 0.15 : 0.075)) + 1, M(0.16) - 2, M(0.075) - 2);
        }
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(70,58,44,0.2)'; ctx.fillRect(-M(L2 / 2), -M(D / 2 + 0.008), M(L2), M(0.022));
      // body
      fillRR(-M(L2 / 2), -M(D / 2), M(L2), M(D), M(0.035), grV(0, -M(D / 2), 0, M(D), '#F2EFE9', '#DDD9D0'), '#C9C4BA', Math.max(1, M(0.012)));
      ctx.fillStyle = 'rgba(120,112,98,0.16)';
      for (let i = 1; i < Math.round(L2 / 0.6); i++) ctx.fillRect(-M(L2 / 2) + M(i * 0.6), M(D / 2 - 0.1), Math.max(0.8, M(0.008)), M(0.08));
      // sink
      const sk = -L2 / 2 + L2 * 0.24;
      fillRR(M(sk - 0.21), -M(0.16), M(0.42), M(0.32), M(0.05), grD(M(sk - 0.21), -M(0.16), M(0.42), M(0.32), '#D4D7DB', '#A9ADB4'), 'rgba(90,95,102,0.6)', Math.max(0.8, M(0.01)));
      fillRR(M(sk - 0.17), -M(0.12), M(0.34), M(0.24), M(0.04), grD(M(sk - 0.17), -M(0.12), M(0.34), M(0.24), '#878C94', '#B9BEC5'));
      ctx.strokeStyle = 'rgba(58,63,70,0.55)'; ctx.lineWidth = Math.max(0.7, M(0.009));
      rr(M(sk - 0.17), -M(0.12), M(0.34), M(0.24), M(0.04)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(0.6, M(0.008));
      ctx.beginPath(); ctx.moveTo(M(sk - 0.15), -M(0.10)); ctx.lineTo(M(sk + 0.13), -M(0.10)); ctx.stroke();
      ctx.beginPath(); ctx.arc(M(sk), 0, M(0.032), 0, 7); ctx.fillStyle = '#43474E'; ctx.fill();
      ctx.beginPath(); ctx.arc(M(sk), 0, M(0.018), 0, 7); ctx.fillStyle = '#2A2D33'; ctx.fill();
      ctx.beginPath(); ctx.arc(M(sk), -M(0.19), M(0.028), 0, 7); ctx.fillStyle = '#D4D8DD'; ctx.fill();
      ctx.strokeStyle = 'rgba(70,75,82,0.6)'; ctx.lineWidth = Math.max(0.6, M(0.007)); ctx.stroke();
      ctx.strokeStyle = '#8E939B'; ctx.lineWidth = M(0.032);
      ctx.beginPath(); ctx.moveTo(M(sk), -M(0.19)); ctx.quadraticCurveTo(M(sk + 0.09), -M(0.19), M(sk + 0.09), -M(0.08)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(0.6, M(0.010));
      ctx.beginPath(); ctx.moveTo(M(sk + 0.005), -M(0.198)); ctx.quadraticCurveTo(M(sk + 0.082), -M(0.198), M(sk + 0.082), -M(0.12)); ctx.stroke();
      // coffee machine v2
      const em = -L2 / 2 + L2 * 0.56;
      fillRR(M(em - 0.16), -M(0.18), M(0.32), M(0.36), M(0.03), grV(0, -M(0.18), 0, M(0.36), '#333947', '#1E222C'), 'rgba(255,255,255,0.12)', Math.max(0.8, M(0.008)));
      // body curvature: left spec band + right core shadow
      fillRR(M(em - 0.135), -M(0.17), M(0.05), M(0.34), M(0.02), 'rgba(255,255,255,0.13)');
      fillRR(M(em + 0.09), -M(0.17), M(0.055), M(0.34), M(0.02), 'rgba(0,0,0,0.22)');
      // group head (metal)
      const gh = ctx.createRadialGradient(M(em - 0.012), -M(0.012), 0, M(em), 0, M(0.045));
      gh.addColorStop(0, '#D8DCE2'); gh.addColorStop(0.6, '#9AA0AB'); gh.addColorStop(1, '#5A606C');
      ctx.beginPath(); ctx.arc(M(em), -M(0.005), M(0.04), 0, 7); ctx.fillStyle = gh; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(0.6, M(0.007)); ctx.stroke();
      fillRR(M(em - 0.13), -M(0.155), M(0.26), M(0.07), M(0.012), '#454E63');
      const btns = [[-0.09, '#7ED8A6'], [-0.03, '#E0A458'], [0.03, '#8FB0FF']];
      for (const [bx, bc] of btns) { ctx.beginPath(); ctx.arc(M(em + bx), -M(0.045), M(0.014), 0, 7); ctx.fillStyle = bc; ctx.fill(); }
      fillRR(M(em + 0.075), -M(0.062), M(0.07), M(0.034), M(0.008), 'rgba(190,210,230,0.4)');
      fillRR(M(em - 0.05), M(0.002), M(0.10), M(0.055), M(0.01), '#B9BDC4');
      ctx.fillStyle = '#8E939B'; ctx.fillRect(M(em - 0.018), M(0.052), M(0.036), M(0.022));
      fillRR(M(em - 0.11), M(0.085), M(0.22), M(0.075), M(0.012), grV(0, M(0.085), 0, M(0.075), '#4A5162', '#2A303C'));
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = Math.max(0.6, M(0.006));
      for (let gi = -0.085; gi <= 0.085; gi += 0.028) { ctx.beginPath(); ctx.moveTo(M(em + gi), M(0.095)); ctx.lineTo(M(em + gi), M(0.15)); ctx.stroke(); }
      for (const [dx, dy] of [[0.185, 0.10], [0.23, 0.05]]) { ctx.beginPath(); ctx.arc(M(em + dx), M(dy), M(0.026), 0, 7); ctx.fillStyle = '#F0EDE5'; ctx.fill(); ctx.strokeStyle = 'rgba(120,115,100,0.4)'; ctx.lineWidth = Math.max(0.6, M(0.006)); ctx.stroke(); }
      ctx.strokeStyle = '#AEB3BB'; ctx.lineWidth = Math.max(0.8, M(0.014));
      ctx.beginPath(); ctx.moveTo(M(em - 0.16), -M(0.02)); ctx.quadraticCurveTo(M(em - 0.21), M(0.02), M(em - 0.19), M(0.07)); ctx.stroke();
      // kettle + mugs + board
      ctx.beginPath(); ctx.arc(M(-L2 / 2 + L2 * 0.74), -M(0.03), M(0.075), 0, 7); ctx.fillStyle = grD(0, 0, M(0.1), M(0.1), '#D8DBDF', '#A7ABB2'); ctx.fill();
      const mg = -L2 / 2 + L2 * 0.86;
      for (const [dx, dy, c] of [[0, -0.07, '#C4553B'], [0.08, 0.02, '#3E6FB0'], [-0.05, 0.05, '#E3B23C']]) { ctx.beginPath(); ctx.arc(M(mg + dx), M(dy), M(0.038), 0, 7); ctx.fillStyle = c; ctx.fill(); }
      ctx.save(); ctx.translate(M(-L2 / 2 + L2 * 0.4), M(0.05)); ctx.rotate(0.3);
      fillRR(-M(0.1), -M(0.07), M(0.2), M(0.14), M(0.03), '#B98A59', 'rgba(80,50,20,0.4)', Math.max(0.7, M(0.007)));
      ctx.restore();
    });
    lights.push({ x: f.x, y: f.y, r: 1.4, c: 'warm', a: 0.3 });
  }
  function fridge(f) {
    shRect(f.x, f.y, 0.72, 0.78, { lift: 1.2, a: 0.24, r: 0.06, rot: f.rot });
    withT(f.x, f.y, f.rot || 0, () => {
      fillRR(-M(0.36), -M(0.39), M(0.72), M(0.78), M(0.06), grV(0, -M(0.39), 0, M(0.78), '#DBDEE2', '#B4B8BE'), '#8E939B', Math.max(1, M(0.012)));
      fillRR(-M(0.30), -M(0.36), M(0.09), M(0.72), M(0.045), 'rgba(255,255,255,0.35)'); // door curvature spec
      fillRR(M(0.20), -M(0.36), M(0.12), M(0.72), M(0.045), 'rgba(70,76,86,0.14)');
      ctx.strokeStyle = 'rgba(90,95,102,0.6)'; ctx.lineWidth = Math.max(0.8, M(0.01));
      ctx.beginPath(); ctx.moveTo(-M(0.36), 0); ctx.lineTo(M(0.36), 0); ctx.stroke();
      ctx.fillStyle = '#6E737B';
      fillRR(-M(0.30), -M(0.10), M(0.24), M(0.045), M(0.02), '#6E737B');
      fillRR(-M(0.30), M(0.06), M(0.24), M(0.045), M(0.02), '#6E737B');
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(-M(0.36), -M(0.39), M(0.72), M(0.03));
    });
  }
  function waterCooler(f) {
    shEll(f.x, f.y, 0.19, 0.19, { lift: 1.0, a: 0.2 });
    fillRR(M(f.x - 0.17), M(f.y - 0.17), M(0.34), M(0.34), M(0.05), grD(M(f.x - 0.17), M(f.y - 0.17), M(0.34), M(0.34), '#F2F0EA', '#CFCCC3'), '#B4B0A6', Math.max(0.8, M(0.01)));
    const g = ctx.createRadialGradient(M(f.x - 0.05), M(f.y - 0.05), 0, M(f.x), M(f.y), M(0.14));
    g.addColorStop(0, 'rgba(190,225,245,0.95)'); g.addColorStop(1, 'rgba(120,175,210,0.9)');
    ctx.beginPath(); ctx.arc(M(f.x), M(f.y), M(0.135), 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = Math.max(0.8, M(0.014));
    ctx.beginPath(); ctx.arc(M(f.x - 0.02), M(f.y - 0.02), M(0.09), 3.4, 4.6); ctx.stroke();
  }
  function credenza(f) {
    shRect(f.x, f.y, f.rot === 90 ? 0.5 : f.len, f.rot === 90 ? f.len : 0.5, { lift: 0.7, a: 0.18, r: 0.04 });
    withT(f.x, f.y, f.rot || 0, () => {
      woodTop(-f.len / 2, -0.25, f.len, 0.5, 0.04, '#8A6A4C', 4);
      ctx.strokeStyle = 'rgba(60,40,20,0.3)'; ctx.lineWidth = Math.max(0.8, M(0.01));
      for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-M(f.len / 2) + M(i * f.len / 3), -M(0.25)); ctx.lineTo(-M(f.len / 2) + M(i * f.len / 3), M(0.25)); ctx.stroke(); }
      fillRR(-M(f.len / 2 + -0.12), -M(0.13), M(0.2), M(0.26), M(0.01), '#33415E'); // books
      fillRR(-M(f.len / 2 - 0.34), -M(0.10), M(0.16), M(0.2), M(0.01), '#C4553B');
      withT(f.len / 4, 0, 0, () => leafRosette(0.32, 'monstera', hashStr('cred' + f.x)));
      ctx.beginPath(); ctx.arc(M(f.len / 2 - 0.3), M(0.02), M(0.07), 0, 7); ctx.fillStyle = '#D9D6CE'; ctx.fill();
    });
  }
  function consoleUnit(f) {
    shRect(f.x, f.y, f.rot === 90 ? 0.5 : f.len, f.rot === 90 ? f.len : 0.5, { lift: 0.7, a: 0.18, r: 0.04 });
    withT(f.x, f.y, f.rot || 0, () => {
      fillRR(-M(f.len / 2), -M(0.25), M(f.len), M(0.5), M(0.04), grV(0, -M(0.25), 0, M(0.5), '#F4F2ED', '#DEDAD1'), '#C6C1B7', Math.max(1, M(0.012)));
      fillRR(-M(0.42), -M(0.18), M(0.42), M(0.36), M(0.04), grV(0, -M(0.18), 0, M(0.36), '#3A404D', '#242832'), 'rgba(255,255,255,0.12)', Math.max(0.8, M(0.008)));
      ctx.fillStyle = '#F4F1E9'; ctx.fillRect(-M(0.36), -M(0.02), M(0.30), M(0.04));
      fillRR(M(0.12), -M(0.14), M(0.22), M(0.28), M(0.01), '#F4F1E9', 'rgba(120,115,100,0.4)', Math.max(0.7, M(0.007)));
      fillRR(M(0.14), -M(0.12), M(0.22), M(0.28), M(0.01), 'rgba(244,241,233,0.8)');
    });
  }
  function tv(f) {
    withT(f.x, f.y, f.rot || 0, () => {
      shadowed('rgba(40,40,50,0.35)', M(0.06), 0, M(0.03), () => fillRR(-M(f.len / 2), 0, M(f.len), M(0.12), M(0.02), '#000'));
      fillRR(-M(f.len / 2), -M(0.085), M(f.len), M(0.17), M(0.02), grV(0, -M(0.085), 0, M(0.17), '#2A2F3B', '#10131B'), 'rgba(255,255,255,0.14)', Math.max(0.8, M(0.01)));
      const sw = f.len - 0.14;
      fillRR(-M(sw / 2), -M(0.062), M(sw), M(0.095), M(0.012), lg(-M(sw / 2), 0, M(sw / 2), 0, [[0, '#17324E'], [1, '#0F2338']]));
      const bars = 7, bw = sw / (bars * 1.9);
      for (let i = 0; i < bars; i++) {
        const bx = -sw / 2 + 0.06 + i * (sw - 0.12) / bars;
        const bh = 0.028 + ((i * 37) % 5) * 0.011;
        ctx.fillStyle = i % 2 ? 'rgba(126,216,166,0.85)' : 'rgba(143,176,255,0.85)';
        ctx.fillRect(M(bx), M(0.028 - bh), M(bw), M(bh));
      }
      ctx.strokeStyle = 'rgba(240,200,120,0.9)'; ctx.lineWidth = Math.max(0.7, M(0.01));
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const lx = -sw / 2 + 0.05 + i * (sw - 0.1) / 6, ly = -0.022 - ((i * 53) % 4) * 0.008;
        if (i) ctx.lineTo(M(lx), M(ly)); else ctx.moveTo(M(lx), M(ly));
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-M(sw / 2 - 0.04), -M(0.052), M(sw * 0.22), M(0.008));
    });
    lights.push({ x: f.x, y: f.y, r: 1.1, c: 'cool', a: 0.28 });
  }
  function doormat(f) {
    fillRR(M(f.x - f.w / 2), M(f.y - f.h / 2), M(f.w), M(f.h), M(0.03), grD(M(f.x - f.w / 2), M(f.y - f.h / 2), M(f.w), M(f.h), '#9A9184', '#7E766A'), 'rgba(70,64,54,0.5)', Math.max(0.8, M(0.01)));
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = Math.max(0.7, M(0.008));
    for (let i = 1; i < 6; i++) { const yy = f.y - f.h / 2 + i * f.h / 6; ctx.beginPath(); ctx.moveTo(M(f.x - f.w / 2 + 0.05), M(yy)); ctx.lineTo(M(f.x + f.w / 2 - 0.05), M(yy)); ctx.stroke(); }
  }

  // ---------- glass / walls ----------
  function glassSeg(x1, y1, x2, y2, gap) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const segs = [];
    if (gap) { segs.push([0, gap.at]); segs.push([gap.at + gap.w, len]); } else segs.push([0, len]);
    for (const [a2, b2] of segs) {
      if (b2 - a2 < 0.05) continue;
      const ax = x1 + ux * a2, ay = y1 + uy * a2, bx = x1 + ux * b2, by = y1 + uy * b2;
      // cast shadow
      shadowed('rgba(50,55,70,0.2)', M(0.09), M(0.05), M(0.08), () => {
        ctx.strokeStyle = '#000'; ctx.lineWidth = M(0.09);
        ctx.beginPath(); ctx.moveTo(M(ax), M(ay)); ctx.lineTo(M(bx), M(by)); ctx.stroke();
      });
      // glass band
      ctx.strokeStyle = 'rgba(182,214,229,0.5)'; ctx.lineWidth = M(0.1); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(M(ax), M(ay)); ctx.lineTo(M(bx), M(by)); ctx.stroke();
      ctx.strokeStyle = 'rgba(74,98,114,0.85)'; ctx.lineWidth = Math.max(1, M(0.016));
      for (const s2 of [-1, 1]) { ctx.beginPath(); ctx.moveTo(M(ax) + nx * M(0.05) * s2, M(ay) + ny * M(0.05) * s2); ctx.lineTo(M(bx) + nx * M(0.05) * s2, M(by) + ny * M(0.05) * s2); ctx.stroke(); }
      // mullions
      ctx.strokeStyle = 'rgba(60,80,95,0.9)'; ctx.lineWidth = Math.max(1, M(0.02));
      for (let t = 0; t <= b2 - a2 + 0.01; t += 1.15) {
        const mx = ax + ux * t, my = ay + uy * t;
        ctx.beginPath(); ctx.moveTo(M(mx) + nx * M(0.06), M(my) + ny * M(0.06)); ctx.lineTo(M(mx) - nx * M(0.06), M(my) - ny * M(0.06)); ctx.stroke();
      }
      // specular streaks
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(0.8, M(0.022)); ctx.setLineDash([M(0.9), M(0.55)]);
      ctx.beginPath(); ctx.moveTo(M(ax) + nx * M(0.02) - M(0.01), M(ay) + ny * M(0.02) - M(0.015)); ctx.lineTo(M(bx) + nx * M(0.02) - M(0.01), M(by) + ny * M(0.02) - M(0.015)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = Math.max(0.7, M(0.013)); ctx.setLineDash([M(0.4), M(0.85)]); ctx.lineDashOffset = M(0.55);
      ctx.beginPath(); ctx.moveTo(M(ax) - nx * M(0.016) - M(0.008), M(ay) - ny * M(0.016) - M(0.012)); ctx.lineTo(M(bx) - nx * M(0.016) - M(0.008), M(by) - ny * M(0.016) - M(0.012)); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    if (gap) { // door swing
      const hx = x1 + ux * gap.at, hy = y1 + uy * gap.at;
      ctx.strokeStyle = 'rgba(100,92,80,0.5)'; ctx.lineWidth = Math.max(1, M(0.02));
      ctx.beginPath(); ctx.moveTo(M(hx), M(hy)); ctx.lineTo(M(hx) + nx * M(gap.w), M(hy) + ny * M(gap.w)); ctx.stroke();
      ctx.strokeStyle = 'rgba(100,92,80,0.3)'; ctx.setLineDash([M(0.06), M(0.06)]);
      ctx.beginPath(); ctx.arc(M(hx), M(hy), M(gap.w), Math.atan2(ny, nx), Math.atan2(uy, ux), false); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  function zoneGlass(z) {
    if (!z.glass) return;
    for (const side of z.glass) {
      let x1, y1, x2, y2;
      if (side === 'N') { x1 = z.x; y1 = z.y; x2 = z.x + z.w; y2 = z.y; }
      else if (side === 'S') { x1 = z.x; y1 = z.y + z.h; x2 = z.x + z.w; y2 = z.y + z.h; }
      else if (side === 'W') { x1 = z.x; y1 = z.y; x2 = z.x; y2 = z.y + z.h; }
      else { x1 = z.x + z.w; y1 = z.y; x2 = z.x + z.w; y2 = z.y + z.h; }
      const gap = (z.door && z.door.side === side) ? { at: z.door.at, w: z.door.w } : null;
      glassSeg(x1, y1, x2, y2, gap);
    }
  }
  function walls() {
    const R2 = room;
    // band
    ctx.save();
    ctx.beginPath();
    rrPath(M(R2.x - WT), M(R2.y - WT), M(R2.w + 2 * WT), M(R2.h + 2 * WT), M(0.08));
    rrPath(M(R2.x), M(R2.y), M(R2.w), M(R2.h), 0.001);
    ctx.clip('evenodd');
    ctx.fillStyle = grD(M(R2.x - WT), M(R2.y - WT), M(R2.w + 2 * WT), M(R2.h + 2 * WT), '#867E71', '#6F675B');
    ctx.fillRect(M(R2.x - WT - 0.1), M(R2.y - WT - 0.1), M(R2.w + 2 * WT + 0.2), M(R2.h + 2 * WT + 0.2));
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(M(R2.x - WT), M(R2.y - WT), M(R2.w + 2 * WT), M(0.05));
    ctx.fillRect(M(R2.x - WT), M(R2.y - WT), M(0.05), M(R2.h + 2 * WT));
    // windows
    for (const wd of layout.windows || []) {
      const horiz = wd.side === 'N' || wd.side === 'S';
      const wx = horiz ? wd.a : (wd.side === 'W' ? R2.x - WT : R2.x + R2.w);
      const wy = horiz ? (wd.side === 'N' ? R2.y - WT : R2.y + R2.h) : wd.a;
      const ww = horiz ? wd.b - wd.a : WT, wh = horiz ? WT : wd.b - wd.a;
      ctx.fillStyle = '#9C9486'; ctx.fillRect(M(wx), M(wy), M(ww), M(wh));
      const gx = horiz ? wx : wx + WT / 2 - 0.055, gy = horiz ? wy + WT / 2 - 0.055 : wy;
      const gw = horiz ? ww : 0.11, gh = horiz ? 0.11 : wh;
      ctx.fillStyle = lg(M(gx), M(gy), M(gx + (horiz ? 0 : gw)), M(gy + (horiz ? gh : 0)), [[0, '#CFE4EF'], [1, '#A5C4D6']]);
      ctx.fillRect(M(gx), M(gy), M(gw), M(gh));
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      if (horiz) ctx.fillRect(M(gx + 0.05), M(gy + 0.015), M(gw - 0.1), M(0.022)); else ctx.fillRect(M(gx + 0.015), M(gy + 0.05), M(0.022), M(gh - 0.1));
      ctx.strokeStyle = 'rgba(90,84,74,0.7)'; ctx.lineWidth = Math.max(0.8, M(0.012));
      const mid = horiz ? (wd.a + wd.b) / 2 : (wd.a + wd.b) / 2;
      if (horiz) { ctx.beginPath(); ctx.moveTo(M(mid), M(gy)); ctx.lineTo(M(mid), M(gy + gh)); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(M(gx), M(mid)); ctx.lineTo(M(gx + gw), M(mid)); ctx.stroke(); }
    }
    // entry opening
    const e = layout.entry;
    if (e) {
      const horiz = e.side === 'N' || e.side === 'S';
      const ex = horiz ? e.a : (e.side === 'W' ? R2.x - WT : R2.x + R2.w);
      const ey = horiz ? (e.side === 'N' ? R2.y - WT : R2.y + R2.h) : e.a;
      ctx.fillStyle = '#C89A6B';
      ctx.fillRect(M(ex), M(ey), M(horiz ? e.b - e.a : WT), M(horiz ? WT : e.b - e.a));
      ctx.fillStyle = 'rgba(70,50,25,0.3)';
      ctx.fillRect(M(ex), M(ey), M(horiz ? e.b - e.a : 0.04), M(horiz ? 0.04 : e.b - e.a));
    }
    ctx.restore();
    // door leaves (drawn inside room)
    if (e && (e.side === 'S' || e.side === 'N')) {
      const mid = (e.a + e.b) / 2, leaf = (e.b - e.a) / 2, ey = e.side === 'S' ? room.y + room.h : room.y;
      const dir = e.side === 'S' ? -1 : 1;
      ctx.strokeStyle = 'rgba(150,105,63,0.9)'; ctx.lineWidth = M(0.05);
      ctx.beginPath(); ctx.moveTo(M(e.a), M(ey)); ctx.lineTo(M(e.a + leaf * 0.35), M(ey + dir * leaf * 0.93)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(M(e.b), M(ey)); ctx.lineTo(M(e.b - leaf * 0.35), M(ey + dir * leaf * 0.93)); ctx.stroke();
      ctx.strokeStyle = 'rgba(100,92,80,0.25)'; ctx.setLineDash([M(0.06), M(0.06)]);
      ctx.beginPath(); ctx.arc(M(e.a), M(ey), M(leaf), e.side === 'S' ? -1.57 : 0.6, e.side === 'S' ? -0.6 : 1.57); ctx.stroke();
      ctx.beginPath(); ctx.arc(M(e.b), M(ey), M(leaf), e.side === 'S' ? -2.54 : 1.57, e.side === 'S' ? -1.57 : 2.54); ctx.stroke();
      ctx.setLineDash([]);
    }
    // inner AO + corners + daylight pools
    ctx.save(); rr(M(R2.x), M(R2.y), M(R2.w), M(R2.h), 0.001); ctx.clip();
    const aoc = 'rgba(66,54,40,', ae = 0.3;
    ctx.fillStyle = lg(0, M(R2.y), 0, M(R2.y + ae), [[0, aoc + '0.14)'], [1, aoc + '0)']]); ctx.fillRect(M(R2.x), M(R2.y), M(R2.w), M(ae));
    ctx.fillStyle = lg(0, M(R2.y + R2.h), 0, M(R2.y + R2.h - ae), [[0, aoc + '0.14)'], [1, aoc + '0)']]); ctx.fillRect(M(R2.x), M(R2.y + R2.h - ae), M(R2.w), M(ae));
    ctx.fillStyle = lg(M(R2.x), 0, M(R2.x + ae), 0, [[0, aoc + '0.14)'], [1, aoc + '0)']]); ctx.fillRect(M(R2.x), M(R2.y), M(ae), M(R2.h));
    ctx.fillStyle = lg(M(R2.x + R2.w), 0, M(R2.x + R2.w - ae), 0, [[0, aoc + '0.14)'], [1, aoc + '0)']]); ctx.fillRect(M(R2.x + R2.w - ae), M(R2.y), M(ae), M(R2.h));
    for (const [cx2, cy2] of [[R2.x, R2.y], [R2.x + R2.w, R2.y], [R2.x, R2.y + R2.h], [R2.x + R2.w, R2.y + R2.h]]) {
      const g = ctx.createRadialGradient(M(cx2), M(cy2), 0, M(cx2), M(cy2), M(1.05));
      g.addColorStop(0, 'rgba(58,48,36,0.16)'); g.addColorStop(1, 'rgba(58,48,36,0)');
      ctx.fillStyle = g; ctx.fillRect(M(cx2 - 1.05), M(cy2 - 1.05), M(2.1), M(2.1));
    }
    const pool0 = null; // pools moved to daylightPools()
    ctx.restore();
  }
  function daylightPools() {
    const R2 = room;
    ctx.save(); rr(M(R2.x), M(R2.y), M(R2.w), M(R2.h), 0.001); ctx.clip();
    const pool = theme === 'night' ? ['168,196,255', 0.05] : theme === 'dusk' ? ['255,196,140', 0.10] : ['255,246,224', 0.13];
    for (const wd of layout.windows || []) {
      const a2 = wd.a + 0.12, b2 = wd.b - 0.12, len = 1.75, sk2 = 0.5;
      ctx.beginPath();
      if (wd.side === 'N') { const yy = R2.y; ctx.moveTo(M(a2), M(yy)); ctx.lineTo(M(b2), M(yy)); ctx.lineTo(M(b2 + sk2), M(yy + len)); ctx.lineTo(M(a2 + sk2), M(yy + len)); ctx.fillStyle = lg(0, M(yy), 0, M(yy + len), [[0, 'rgba(' + pool[0] + ',' + pool[1] + ')'], [1, 'rgba(' + pool[0] + ',0)']]); }
      else if (wd.side === 'S') { const yy = R2.y + R2.h; ctx.moveTo(M(a2), M(yy)); ctx.lineTo(M(b2), M(yy)); ctx.lineTo(M(b2 + sk2), M(yy - len)); ctx.lineTo(M(a2 + sk2), M(yy - len)); ctx.fillStyle = lg(0, M(yy), 0, M(yy - len), [[0, 'rgba(' + pool[0] + ',' + (pool[1] * 0.8) + ')'], [1, 'rgba(' + pool[0] + ',0)']]); }
      else if (wd.side === 'W') { const xx = R2.x; ctx.moveTo(M(xx), M(a2)); ctx.lineTo(M(xx), M(b2)); ctx.lineTo(M(xx + len), M(b2 + sk2)); ctx.lineTo(M(xx + len), M(a2 + sk2)); ctx.fillStyle = lg(M(xx), 0, M(xx + len), 0, [[0, 'rgba(' + pool[0] + ',' + pool[1] + ')'], [1, 'rgba(' + pool[0] + ',0)']]); }
      else { const xx = R2.x + R2.w; ctx.moveTo(M(xx), M(a2)); ctx.lineTo(M(xx), M(b2)); ctx.lineTo(M(xx - len), M(b2 + sk2)); ctx.lineTo(M(xx - len), M(a2 + sk2)); ctx.fillStyle = lg(M(xx), 0, M(xx - len), 0, [[0, 'rgba(' + pool[0] + ',' + (pool[1] * 0.8) + ')'], [1, 'rgba(' + pool[0] + ',0)']]); }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- people ----------
  function person(p) {
    const T = 0.58, x = p.x, y = p.y;
    const h2 = hashStr(p.name) % 360;
    shadowed('rgba(40,34,26,0.35)', M(0.08), M(0.03), M(0.055), () => fillRR(M(x - T / 2), M(y - T / 2), M(T), M(T), M(0.16), '#000'));
    // ring
    fillRR(M(x - T / 2 - 0.035), M(y - T / 2 - 0.035), M(T + 0.07), M(T + 0.07), M(0.19), 'hsl(' + h2 + ',46%,88%)', 'rgba(30,36,50,0.35)', Math.max(1, M(0.012)));
    // photo tile (initials fallback — 실서비스: 사용자 사진)
    ctx.save(); rr(M(x - T / 2), M(y - T / 2), M(T), M(T), M(0.15)); ctx.clip();
    ctx.fillStyle = lg(M(x - T / 2), M(y - T / 2), M(x + T / 2), M(y + T / 2), [[0, 'hsl(' + h2 + ',52%,58%)'], [1, 'hsl(' + ((h2 + 46) % 360) + ',56%,38%)']]);
    ctx.fillRect(M(x - T / 2), M(y - T / 2), M(T), M(T));
    const rg = ctx.createRadialGradient(M(x - T * 0.22), M(y - T * 0.24), 0, M(x), M(y), M(T * 0.75));
    rg.addColorStop(0, 'rgba(255,255,255,0.30)'); rg.addColorStop(0.55, 'rgba(255,255,255,0)'); rg.addColorStop(1, 'rgba(20,16,40,0.28)');
    ctx.fillStyle = rg; ctx.fillRect(M(x - T / 2), M(y - T / 2), M(T), M(T));
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '700 ' + M(0.21) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ini = p.name.length >= 3 ? p.name.slice(1) : p.name.slice(0, 2);
    ctx.fillText(ini, M(x), M(y + 0.01));
    ctx.restore();
    // status dot
    const sc = STATUS[p.status] || STATUS.online;
    ctx.beginPath(); ctx.arc(M(x + T / 2 - 0.06), M(y + T / 2 - 0.06), M(0.085), 0, 7);
    ctx.fillStyle = sc; ctx.fill(); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1.2, M(0.024)); ctx.stroke();
    // name pill
    ctx.font = '600 ' + Math.max(10, M(0.125)) + 'px ' + FONT;
    const tw = ctx.measureText(p.name).width, ph = Math.max(15, M(0.20)), pw = tw + ph * 1.1;
    const py = M(y + T / 2 + 0.16);
    shadowed('rgba(30,25,18,0.3)', M(0.06), 1, 2, () => fillRR(M(x) - pw / 2, py - ph / 2, pw, ph, ph / 2, '#000'));
    fillRR(M(x) - pw / 2, py - ph / 2, pw, ph, ph / 2, 'rgba(22,27,39,0.88)', 'rgba(255,255,255,0.22)', 1);
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.name, M(x), py + 0.5);
  }
  function zoneLabel(z) {
    const lx = z.lx != null ? z.lx : z.x + z.w / 2, ly = z.ly != null ? z.ly : z.y + 0.34;
    ctx.font = '700 ' + Math.max(11, M(0.135)) + 'px ' + FONT;
    const tw = ctx.measureText(z.label).width, ph = Math.max(17, M(0.24)), pw = tw + ph * 1.7;
    shadowed('rgba(40,36,28,0.32)', M(0.07), 1, 2.5, () => fillRR(M(lx) - pw / 2, M(ly) - ph / 2, pw, ph, ph / 2, '#000'));
    fillRR(M(lx) - pw / 2, M(ly) - ph / 2, pw, ph, ph / 2, 'rgba(253,252,249,0.95)', 'rgba(120,112,98,0.35)', 1);
    ctx.fillStyle = KINDDOT[z.kind] || '#3E6FB0';
    ctx.beginPath(); ctx.arc(M(lx) - pw / 2 + ph * 0.52, M(ly), ph * 0.17, 0, 7); ctx.fill();
    ctx.fillStyle = '#3E4453'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(z.label, M(lx) - pw / 2 + ph * 0.92, M(ly) + 0.5);
  }

  // ---------- booth ----------
  function booth(f) {
    const x0 = f.x - f.w / 2, y0 = f.y - f.h / 2;
    feltPatch(x0 + 0.06, y0 + 0.06, f.w - 0.12, f.h - 0.12);
    // shelf desk along S
    withT(f.x, f.y + f.h / 2 - 0.26, 0, () => {
      fillRR(-M(f.w / 2 - 0.14), -M(0.13), M(f.w - 0.28), M(0.26), M(0.03), grV(0, -M(0.13), 0, M(0.26), '#C8A276', '#AD8354'), 'rgba(90,60,30,0.4)', Math.max(0.8, M(0.01)));
    });
    laptop(f.x + 0.08, f.y + f.h / 2 - 0.27, 0);
    stool(f.x - 0.05, f.y + f.h / 2 - 0.62);
    withT(x0 + 0.22, y0 + 0.24, 0, () => leafRosette(0.3, 'fern', hashStr('booth' + f.x)));
    const gap = { at: (f.w - 0.62) / 2, w: 0.62 };
    glassSeg(x0, y0, x0 + f.w, y0, f.door === 'N' ? gap : null);
    glassSeg(x0 + f.w, y0, x0 + f.w, y0 + f.h, f.door === 'E' ? gap : null);
    glassSeg(x0, y0 + f.h, x0 + f.w, y0 + f.h, f.door === 'S' ? gap : null);
    glassSeg(x0, y0, x0, y0 + f.h, f.door === 'W' ? gap : null);
    lights.push({ x: f.x, y: f.y, r: 1.0, c: 'warm', a: 0.42 });
    seats.push({ id: layout.id + '-booth-' + f.x, x: f.x - 0.05, y: f.y + f.h / 2 - 0.62 });
  }

  // ---------- v3.1 props ----------
  const SIDEROT = { N: 0, E: 90, S: 180, W: 270 };
  function whiteboard(f) {
    withT(f.x, f.y, SIDEROT[f.side || 'N'], () => {
      shadowed('rgba(50,42,32,0.26)', M(0.07), M(0.03), M(0.05), () => fillRR(-M(f.len / 2), -M(0.05), M(f.len), M(0.14), M(0.02), '#000'));
      fillRR(-M(f.len / 2 + 0.03), -M(0.075), M(f.len + 0.06), M(0.15), M(0.02), '#AEB3BB');
      fillRR(-M(f.len / 2), -M(0.06), M(f.len), M(0.12), M(0.012), grD(-M(f.len / 2), -M(0.06), M(f.len), M(0.12), '#FDFDFB', '#EDEEEA'));
      const cols = ['#3E6FB0', '#C4553B', '#2E3A55'];
      const r2 = mulberry32(hashStr('wb' + f.x));
      for (let s2 = 0; s2 < 3; s2++) {
        ctx.strokeStyle = alp(cols[s2], 0.75); ctx.lineWidth = Math.max(0.7, M(0.011));
        ctx.beginPath();
        let lx = -f.len / 2 + 0.1 + s2 * f.len * 0.28;
        ctx.moveTo(M(lx), M(-0.02 + r2() * 0.03));
        for (let k = 0; k < 3; k++) { lx += 0.06 + r2() * 0.07; ctx.lineTo(M(lx), M(-0.038 + r2() * 0.075)); }
        ctx.stroke();
      }
      ctx.fillStyle = '#E3B23C'; ctx.fillRect(M(f.len * 0.5 - 0.20), -M(0.038), M(0.05), M(0.05));
      ctx.fillStyle = '#7ED8A6'; ctx.fillRect(M(f.len * 0.5 - 0.13), -M(0.028), M(0.05), M(0.05));
      fillRR(-M(f.len * 0.3), M(0.075), M(f.len * 0.6), M(0.035), M(0.015), '#8E939B');
      for (const [mx2, mc] of [[-0.1, '#C4553B'], [0, '#2E3A55'], [0.1, '#3E6FB0']]) fillRR(M(mx2 - 0.045), M(0.078), M(0.09), M(0.022), M(0.01), mc);
    });
  }
  function art(f) {
    withT(f.x, f.y, SIDEROT[f.side || 'N'], () => {
      shadowed('rgba(50,42,32,0.28)', M(0.06), M(0.025), M(0.045), () => fillRR(-M(0.26), -M(0.20), M(0.52), M(0.40), M(0.015), '#000'));
      fillRR(-M(0.28), -M(0.22), M(0.56), M(0.44), M(0.015), grD(-M(0.28), -M(0.22), M(0.56), M(0.44), '#8A6A4C', '#6E5138'));
      fillRR(-M(0.24), -M(0.18), M(0.48), M(0.36), M(0.005), '#F6F3EC');
      ctx.save(); rr(-M(0.195), -M(0.135), M(0.39), M(0.27), 0.001); ctx.clip();
      const v = f.variant || 'lines';
      if (v === 'sunset') {
        ctx.fillStyle = lg(0, -M(0.135), 0, M(0.135), [[0, '#F2C094'], [0.55, '#DE8A5E'], [1, '#8A5468']]); ctx.fillRect(-M(0.195), -M(0.135), M(0.39), M(0.27));
        ctx.fillStyle = '#F6E3B8'; ctx.beginPath(); ctx.arc(M(0.04), -M(0.01), M(0.055), 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(90,60,80,0.8)'; ctx.fillRect(-M(0.195), M(0.06), M(0.39), M(0.075));
      } else if (v === 'botanic') {
        ctx.fillStyle = '#EFE9DA'; ctx.fillRect(-M(0.195), -M(0.135), M(0.39), M(0.27));
        ctx.save(); ctx.translate(0, M(0.02)); leafRosette(0.5, 'monstera', hashStr('art' + f.x)); ctx.restore();
      } else {
        ctx.fillStyle = '#F0EBE0'; ctx.fillRect(-M(0.195), -M(0.135), M(0.39), M(0.27));
        const lc = ['#C4553B', '#2E3A55', '#D9A441'];
        for (let i = 0; i < 3; i++) { ctx.strokeStyle = lc[i]; ctx.lineWidth = M(0.02 + i * 0.008); ctx.beginPath(); ctx.arc(M(-0.06 + i * 0.07), M(0.09), M(0.13 + i * 0.035), Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
      }
      ctx.restore();
    });
  }
  function bookshelf(f) {
    const depth = 0.36;
    shRect(f.x, f.y, f.rot === 90 ? depth : f.len, f.rot === 90 ? f.len : depth, { lift: 1.1, a: 0.22, r: 0.04 });
    withT(f.x, f.y, f.rot || 0, () => {
      fillRR(-M(f.len / 2), -M(depth / 2), M(f.len), M(depth), M(0.03), grV(0, -M(depth / 2), 0, M(depth), '#9A7350', '#7C5A3C'), 'rgba(70,45,22,0.55)', Math.max(1, M(0.014)));
      fillRR(-M(f.len / 2 - 0.04), -M(depth / 2 - 0.05), M(f.len - 0.08), M(depth - 0.10), M(0.015), '#4A3826');
      const r2 = mulberry32(hashStr('bk' + f.x + f.y));
      const cols = ['#C4553B', '#2E3A55', '#D9A441', '#4C7F46', '#8A3226', '#3E6FB0', '#EFE9DA'];
      let bx = -f.len / 2 + 0.07;
      while (bx < f.len / 2 - 0.2) {
        const bw = 0.035 + r2() * 0.035, bh = depth - 0.14 - r2() * 0.06;
        ctx.fillStyle = cols[(r2() * cols.length) | 0];
        ctx.save(); ctx.translate(M(bx + bw / 2), 0); ctx.rotate((r2() - 0.5) * 0.09);
        ctx.fillRect(-M(bw / 2), -M(bh / 2), M(bw), M(bh));
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(-M(bw / 2), -M(bh / 2), M(bw), M(0.025));
        ctx.restore();
        bx += bw + 0.012;
        if (r2() < 0.14) bx += 0.08;
      }
      ctx.save(); ctx.translate(M(f.len / 2 - 0.11), 0); leafRosette(0.24, 'fern', hashStr('bkp' + f.x)); ctx.restore();
    });
  }
  function printer(f) {
    shRect(f.x, f.y, 0.62, 0.52, { lift: 0.8, a: 0.2, r: 0.05 });
    withT(f.x, f.y, f.rot || 0, () => {
      fillRR(-M(0.31), -M(0.26), M(0.62), M(0.52), M(0.045), grV(0, -M(0.26), 0, M(0.52), '#F4F2ED', '#DBD7CE'), '#C2BDB3', Math.max(1, M(0.012)));
      fillRR(-M(0.22), -M(0.19), M(0.44), M(0.32), M(0.035), grV(0, -M(0.19), 0, M(0.32), '#4A5162', '#2E3440'), 'rgba(255,255,255,0.12)', Math.max(0.8, M(0.008)));
      fillRR(-M(0.15), -M(0.145), M(0.30), M(0.06), M(0.012), '#20242E');
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(-M(0.22), -M(0.19), M(0.44), M(0.03));
      fillRR(-M(0.13), -M(0.02), M(0.26), M(0.07), M(0.01), '#F6F4EF');
      ctx.strokeStyle = 'rgba(120,115,100,0.4)'; ctx.lineWidth = Math.max(0.6, M(0.006));
      ctx.beginPath(); ctx.moveTo(-M(0.11), M(0.012)); ctx.lineTo(M(0.11), M(0.012)); ctx.stroke();
      ctx.fillStyle = '#7ED8A6'; ctx.beginPath(); ctx.arc(M(0.16), M(0.075), M(0.013), 0, 7); ctx.fill();
      ctx.save(); ctx.translate(M(0.20), M(0.185)); ctx.rotate(0.12);
      fillRR(-M(0.075), -M(0.05), M(0.15), M(0.10), M(0.004), '#FBFAF6', 'rgba(120,115,100,0.45)', Math.max(0.6, M(0.006)));
      ctx.restore();
    });
    shEll(f.x - 0.42, f.y + 0.14, 0.1, 0.1, { lift: 0.6, a: 0.16 });
    ctx.beginPath(); ctx.arc(M(f.x - 0.42), M(f.y + 0.14), M(0.09), 0, 7);
    ctx.fillStyle = grD(M(f.x - 0.5), M(f.y), M(0.18), M(0.18), '#7FA6C9', '#54759B'); ctx.fill();
    ctx.strokeStyle = 'rgba(30,40,60,0.4)'; ctx.lineWidth = Math.max(0.8, M(0.01)); ctx.stroke();
    ctx.beginPath(); ctx.arc(M(f.x - 0.42), M(f.y + 0.14), M(0.055), 0, 7); ctx.fillStyle = 'rgba(20,26,40,0.5)'; ctx.fill();
  }
  function coatrack(f) {
    shEll(f.x, f.y, 0.3, 0.3, { lift: 1.3, a: 0.18 });
    withT(f.x, f.y, 0, () => {
      ctx.strokeStyle = '#5A4632'; ctx.lineWidth = Math.max(1, M(0.022));
      for (let i = 0; i < 5; i++) { const a2 = i * 1.2566 + 0.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a2) * M(0.20), Math.sin(a2) * M(0.20)); ctx.stroke(); }
      const coats = [[0.10, -0.06, '#33415E', 0.4], [-0.11, 0.08, '#8A3226', 2.2]];
      for (const [dx, dy, cc, ra] of coats) {
        ctx.save(); ctx.translate(M(dx), M(dy)); ctx.rotate(ra);
        const g = ctx.createRadialGradient(-M(0.04), -M(0.04), 0, 0, 0, M(0.17));
        g.addColorStop(0, shade(cc, 1.3)); g.addColorStop(1, shade(cc, 0.85));
        ctx.beginPath(); ctx.moveTo(-M(0.14), 0);
        ctx.quadraticCurveTo(-M(0.10), -M(0.13), M(0.02), -M(0.11));
        ctx.quadraticCurveTo(M(0.15), -M(0.08), M(0.13), M(0.04));
        ctx.quadraticCurveTo(M(0.10), M(0.13), -M(0.04), M(0.12));
        ctx.quadraticCurveTo(-M(0.14), M(0.10), -M(0.14), 0);
        ctx.closePath(); ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = alp('#000000', 0.15); ctx.lineWidth = Math.max(0.7, M(0.009)); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(0.6, M(0.008)); // fold hint
        ctx.beginPath(); ctx.moveTo(-M(0.08), -M(0.04)); ctx.quadraticCurveTo(0, -M(0.02), M(0.06), -M(0.06)); ctx.stroke();
        ctx.restore();
      }
      for (let i = 0; i < 5; i++) { // hook caps above coats
        const a2 = i * 1.2566 + 0.4;
        ctx.fillStyle = '#8A6A4C'; ctx.beginPath(); ctx.arc(Math.cos(a2) * M(0.205), Math.sin(a2) * M(0.205), M(0.024), 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(Math.cos(a2) * M(0.205) - M(0.007), Math.sin(a2) * M(0.205) - M(0.009), M(0.009), 0, 7); ctx.fill();
      }
      const cg = ctx.createRadialGradient(-M(0.012), -M(0.012), 0, 0, 0, M(0.05));
      cg.addColorStop(0, '#C8A87E'); cg.addColorStop(1, '#7C5A3C');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, M(0.048), 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(50,32,16,0.5)'; ctx.lineWidth = Math.max(0.7, M(0.008)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(-M(0.008), -M(0.008), M(0.028), 3.4, 5.4); ctx.stroke();
    });
  }
  function signProp(f) {
    const label = f.text || 'ZONE';
    ctx.font = '700 ' + Math.max(8, M(0.095)) + 'px ' + FONT;
    const tw = ctx.measureText(label).width, ph = Math.max(12, M(0.17)), pw = tw + ph * 1.0;
    shadowed('rgba(30,25,18,0.32)', M(0.05), 1, 2, () => fillRR(M(f.x) - pw / 2, M(f.y) - ph / 2, pw, ph, M(0.03), '#000'));
    fillRR(M(f.x) - pw / 2, M(f.y) - ph / 2, pw, ph, M(0.03), grV(0, M(f.y) - ph / 2, 0, ph, '#3A486A', '#26314A'), 'rgba(255,255,255,0.25)', Math.max(0.8, M(0.01)));
    ctx.fillStyle = '#EAF0FF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, M(f.x), M(f.y) + 0.5);
  }
  function shelfProp(f) {
    withT(f.x, f.y, SIDEROT[f.side || 'N'], () => {
      shadowed('rgba(50,42,32,0.24)', M(0.06), M(0.025), M(0.045), () => fillRR(-M(f.len / 2), -M(0.11), M(f.len), M(0.24), M(0.02), '#000'));
      woodTop(-f.len / 2, -0.13, f.len, 0.26, 0.025, '#A87B50', 3);
      const r2 = mulberry32(hashStr('sh' + f.x));
      let sx = -f.len / 2 + 0.1;
      while (sx < f.len / 2 - 0.08) {
        const kind = r2();
        if (kind < 0.55) {
          ctx.beginPath(); ctx.arc(M(sx), M(-0.01 + r2() * 0.03), M(0.042), 0, 7);
          ctx.fillStyle = ['#C4553B', '#3E6FB0', '#E3B23C', '#F0EDE5', '#4C7F46'][(r2() * 5) | 0]; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = Math.max(0.6, M(0.007)); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(M(sx - 0.012), M(-0.02), M(0.012), 0, 7); ctx.fill();
          sx += 0.115;
        } else if (kind < 0.8) {
          fillRR(M(sx - 0.038), -M(0.055), M(0.076), M(0.11), M(0.02), 'rgba(200,220,225,0.75)', 'rgba(110,130,140,0.5)', Math.max(0.6, M(0.007)));
          ctx.fillStyle = '#8A6A4C'; ctx.fillRect(M(sx - 0.038), -M(0.02), M(0.076), M(0.04));
          sx += 0.13;
        } else {
          ctx.beginPath(); ctx.arc(M(sx), 0, M(0.055), 0, 7); ctx.fillStyle = '#F0EDE5'; ctx.fill();
          ctx.strokeStyle = 'rgba(120,115,100,0.45)'; ctx.lineWidth = Math.max(0.6, M(0.007)); ctx.stroke();
          ctx.beginPath(); ctx.arc(M(sx), 0, M(0.035), 0, 7); ctx.stroke();
          sx += 0.15;
        }
      }
    });
  }

  function chairProp(f) {
    const k = f.kind || 'task';
    if (k === 'stool') stool(f.x, f.y);
    else if (k === 'bistro') bistroChair(f.x, f.y, f.rot || 0);
    else if (k === 'side') sideChair(f.x, f.y, f.rot || 0, f.color);
    else taskChair(f.x, f.y, f.rot || 0, k === 'exec' ? (f.color || '#D9A441') : f.color);
  }

  // ---------- grade ----------
  function grade() {
    const W2 = canvas.width, H2 = canvas.height;
    function overlay(mode, color, a) { ctx.save(); ctx.globalCompositeOperation = mode; ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(0, 0, W2, H2); ctx.restore(); }
    function lightsPass(k) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      for (const li of lights) {
        const col = li.c === 'cool' ? '160,200,255' : '255,196,120';
        const g = ctx.createRadialGradient(M(li.x), M(li.y), 0, M(li.x), M(li.y), M(li.r));
        g.addColorStop(0, 'rgba(' + col + ',' + (li.a * k) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
        ctx.fillStyle = g; ctx.fillRect(M(li.x - li.r), M(li.y - li.r), M(li.r * 2), M(li.r * 2));
      }
      ctx.restore();
    }
    function vign(a, color) {
      const g = ctx.createRadialGradient(W2 / 2, H2 / 2, Math.min(W2, H2) * 0.42, W2 / 2, H2 / 2, Math.max(W2, H2) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, alp(color, a));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H2);
    }
    if (theme === 'dusk') {
      overlay('multiply', '#E2B489', 0.30); overlay('soft-light', '#C97A46', 0.28);
      lightsPass(0.55); vign(0.24, '#3A2718');
    } else if (theme === 'night') {
      overlay('multiply', '#42507C', 0.62); overlay('multiply', '#232C49', 0.34);
      lightsPass(1); vign(0.4, '#0B1020');
    } else {
      overlay('soft-light', '#FFF3DC', 0.12); vign(0.13, '#4A3B28');
    }
  }

  // ---------- compose ----------
  const PAINT = {
    rug: f => f.style === 'oriental' ? rugOriental(f.x, f.y, f.w, f.h) : f.style === 'abstract' ? rugAbstract(f.x, f.y, f.w, f.h) : rugRound(f.x, f.y, f.r, f.base),
    plant, trough, pebbles, rocks, bench4, meetingTable, diningTable, cafeTable,
    sofa, tubChair, pouf, coffeeTable, sideTable, lamp, counter, fridge, waterCooler,
    credenza, console: consoleUnit, tv, booth, doormat,
    whiteboard, art, bookshelf, printer, coatrack, sign: signProp, shelf: shelfProp, chair: chairProp
  };
  // FLOOR (theme-independent part cached per layout+size; daylight pools applied per theme)
  if (has('floor')) {
    if (room.w > 0) {
      renderScene._floorCache = renderScene._floorCache || {};
      const fkey = (layout.id || '') + '|' + canvas.width + 'x' + canvas.height;
      let fc = renderScene._floorCache[fkey];
      if (!fc) {
        const keys = Object.keys(renderScene._floorCache);
        if (keys.length > 5) delete renderScene._floorCache[keys[0]];
        fc = document.createElement('canvas'); fc.width = canvas.width; fc.height = canvas.height;
        const old = ctx; ctx = fc.getContext('2d');
        ctx.fillStyle = grD(0, 0, fc.width, fc.height, '#EBE7E0', '#DDD8CF');
        ctx.fillRect(0, 0, fc.width, fc.height);
        shadowed('rgba(60,50,38,0.28)', M(0.2), M(0.08), M(0.13), () => // plate slab shadow
          fillRR(M(room.x - WT), M(room.y - WT), M(room.w + 2 * WT), M(room.h + 2 * WT), M(0.1), '#000'));
        woodFloor(room.x, room.y, room.w, room.h);
        for (const z of layout.zones || []) {
          if (z.floor === 'tile') tileFloor(z.x, z.y, z.w, z.h);
          else if (z.floor === 'carpet') carpetFloor(z.x, z.y, z.w, z.h);
        }
        for (const f of layout.furniture || []) if (f.t === 'rug') PAINT.rug(f);
        walls();
        for (const z of layout.zones || []) zoneGlass(z);
        ctx = old;
        renderScene._floorCache[fkey] = fc;
      }
      ctx.drawImage(fc, 0, 0);
      daylightPools();
    } else {
      for (const f of layout.furniture || []) if (f.t === 'rug') PAINT.rug(f);
    }
  }
  rng = mulberry32(hashStr((layout.id || 'horizon') + '|furn')); // furniture stream independent of floor cache state
  // FURNITURE
  if (has('furniture')) for (const f of layout.furniture || []) { if (f.t !== 'rug') (PAINT[f.t] || (() => {}))(f); }
  // PEOPLE
  if (has('people')) for (const p of layout.people || []) person(p);
  // FOREGROUND (labels)
  if (has('foreground')) for (const z of layout.zones || []) if (z.label) zoneLabel(z);
  // GRADE
  if (has('grade')) grade();
  return { canvas, seats, lights };
}
/* ---------- Asset catalog + hero sheet (QA/검수용 보조 진입점) ---------- */
const ASSET_CATALOG = [
  { id: 'task-chair', label: '태스크 체어', w: 1.7, h: 1.75, furn: [{ t: 'chair', kind: 'task', x: 0.83, y: 0.95, rot: 14 }] },
  { id: 'exec-chair', label: '회의 체어', w: 1.7, h: 1.75, furn: [{ t: 'chair', kind: 'exec', x: 0.83, y: 0.95, rot: -10 }] },
  { id: 'bistro-set', label: '비스트로 체어 · 스툴', w: 2.0, h: 1.3, furn: [{ t: 'chair', kind: 'bistro', x: 0.55, y: 0.68, rot: 20 }, { t: 'chair', kind: 'side', x: 1.15, y: 0.66, rot: -12 }, { t: 'chair', kind: 'stool', x: 1.68, y: 0.64 }] },
  { id: 'bench4', label: '워크벤치 · 4석', w: 5.6, h: 3.9, furn: [{ t: 'bench4', x: 2.8, y: 1.95 }], people: [{ name: 'a', x: 2.075, y: 0.78 }, { name: 'b', x: 3.525, y: 3.12 }] },
  { id: 'meeting-8', label: '회의 테이블 · 8석', w: 5.6, h: 3.4, furn: [{ t: 'meetingTable', x: 2.8, y: 1.7, w: 3.3, h: 1.15, seats: 8 }] },
  { id: 'dining', label: '다이닝 테이블 · 6석', w: 4.4, h: 2.7, furn: [{ t: 'diningTable', x: 2.2, y: 1.35, w: 2.7, h: 1.05 }] },
  { id: 'cafe-table', label: '카페 테이블', w: 2.4, h: 2.4, furn: [{ t: 'cafeTable', x: 1.2, y: 1.25, chairs: [65, 240] }] },
  { id: 'sofa', label: '3인 소파', w: 3.6, h: 2.1, furn: [{ t: 'sofa', x: 1.8, y: 1.0, w: 2.5, rot: 0, color: '#E3B23C' }] },
  { id: 'tub-chair', label: '턴 체어', w: 1.8, h: 1.8, furn: [{ t: 'tubChair', x: 0.9, y: 0.92, rot: 40, color: '#C4553B' }] },
  { id: 'pouf', label: '푸프', w: 1.3, h: 1.3, furn: [{ t: 'pouf', x: 0.63, y: 0.63, color: '#3E6FB0' }] },
  { id: 'coffee-table', label: '커피 테이블', w: 1.5, h: 1.5, furn: [{ t: 'coffeeTable', x: 0.73, y: 0.73, r: 0.42 }] },
  { id: 'side-lamp', label: '사이드 테이블 · 램프', w: 1.7, h: 1.3, furn: [{ t: 'sideTable', x: 0.6, y: 0.72, r: 0.22 }, { t: 'lamp', x: 1.2, y: 0.55 }] },
  { id: 'plant-monstera', label: '몬스테라 화분', w: 1.7, h: 1.7, furn: [{ t: 'plant', x: 0.83, y: 0.85, s: 1.15, kind: 'monstera' }] },
  { id: 'plant-fern', label: '펀 화분', w: 1.5, h: 1.5, furn: [{ t: 'plant', x: 0.73, y: 0.75, s: 0.95, kind: 'fern' }] },
  { id: 'trough', label: '플랜터 트로프', w: 3.8, h: 1.3, furn: [{ t: 'trough', x: 1.9, y: 0.62, len: 3.0, rot: 0 }] },
  { id: 'rug-oriental', label: '오리엔탈 러그', w: 5.0, h: 3.6, furn: [{ t: 'rug', style: 'oriental', x: 2.5, y: 1.8, w: 4.6, h: 3.2 }] },
  { id: 'rug-round', label: '라운드 러그', w: 2.7, h: 2.7, furn: [{ t: 'rug', style: 'round', x: 1.35, y: 1.35, r: 1.05, base: '#C4553B' }] },
  { id: 'rug-abstract', label: '애브스트랙트 러그', w: 4.0, h: 2.9, furn: [{ t: 'rug', style: 'abstract', x: 2.0, y: 1.45, w: 3.5, h: 2.3 }] },
  { id: 'counter', label: '팬트리 카운터', w: 3.5, h: 1.8, furn: [{ t: 'counter', x: 1.75, y: 1.05, len: 2.8, side: 'N' }] },
  { id: 'fridge', label: '냉장고', w: 1.5, h: 1.5, furn: [{ t: 'fridge', x: 0.73, y: 0.75, rot: 0 }] },
  { id: 'cooler', label: '워터쿨러', w: 1.2, h: 1.2, furn: [{ t: 'waterCooler', x: 0.58, y: 0.6 }] },
  { id: 'credenza', label: '크레덴자', w: 2.7, h: 1.2, furn: [{ t: 'credenza', x: 1.35, y: 0.6, len: 2.0, rot: 0 }] },
  { id: 'console-tv', label: '미디어 콘솔 · TV', w: 2.5, h: 1.7, furn: [{ t: 'console', x: 1.25, y: 1.05, len: 1.7, rot: 0 }, { t: 'tv', x: 1.25, y: 0.42, len: 1.7, rot: 0 }] },
  { id: 'booth', label: '폰부스', w: 2.4, h: 2.5, furn: [{ t: 'booth', x: 1.2, y: 1.25, w: 1.5, h: 1.6, door: 'N' }] },
  { id: 'whiteboard', label: '화이트보드', w: 2.7, h: 1.1, furn: [{ t: 'whiteboard', x: 1.35, y: 0.5, len: 2.1, side: 'N' }] },
  { id: 'art-set', label: '벽 액자 3종', w: 2.6, h: 1.0, furn: [{ t: 'art', x: 0.5, y: 0.5, side: 'N', variant: 'sunset' }, { t: 'art', x: 1.3, y: 0.5, side: 'N', variant: 'botanic' }, { t: 'art', x: 2.1, y: 0.5, side: 'N', variant: 'lines' }] },
  { id: 'bookshelf', label: '북셸프', w: 2.0, h: 1.1, furn: [{ t: 'bookshelf', x: 1.0, y: 0.55, len: 1.5, rot: 0 }] },
  { id: 'printer', label: '프린터 스테이션', w: 1.8, h: 1.5, furn: [{ t: 'printer', x: 1.0, y: 0.72 }] },
  { id: 'coatrack', label: '코트랙', w: 1.3, h: 1.3, furn: [{ t: 'coatrack', x: 0.63, y: 0.63 }] },
  { id: 'shelf', label: '오픈 선반', w: 2.0, h: 1.0, furn: [{ t: 'shelf', x: 1.0, y: 0.5, len: 1.5, side: 'N' }] },
  { id: 'pebble-garden', label: '페블 가든', w: 2.6, h: 2.2, furn: [{ t: 'pebbles', x: 1.25, y: 1.15, w: 1.8, h: 1.6 }, { t: 'rocks', x: 1.15, y: 1.1 }, { t: 'plant', x: 1.95, y: 0.55, s: 0.85, kind: 'monstera' }] },
  { id: 'doormat', label: '도어매트', w: 2.0, h: 0.9, furn: [{ t: 'doormat', x: 1.0, y: 0.45, w: 1.5, h: 0.45 }] }
];
function renderAssetSheet(canvas, opts) {
  opts = opts || {};
  const theme = opts.theme || 'day', dpr = opts.dpr == null ? 2 : opts.dpr;
  const cols = opts.columns || 5, tile = opts.tile || 330, gap = 18, pad = 26, labelH = 42;
  const items = opts.items || (opts.ids ? ASSET_CATALOG.filter(a => opts.ids.indexOf(a.id) >= 0) : ASSET_CATALOG);
  const rows = Math.ceil(items.length / cols);
  const cssW = pad * 2 + cols * tile + (cols - 1) * gap;
  const cssH = pad * 2 + rows * (tile + labelH) + (rows - 1) * gap;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  function rrG(x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  g.fillStyle = '#EFEAE1'; g.fillRect(0, 0, cssW, cssH);
  const vg = g.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.3, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
  vg.addColorStop(0, 'rgba(255,255,255,0.25)'); vg.addColorStop(1, 'rgba(120,104,84,0.15)');
  g.fillStyle = vg; g.fillRect(0, 0, cssW, cssH);
  const map = [];
  function paintTile(it, i) {
    const x0 = pad + (i % cols) * (tile + gap), y0 = pad + ((i / cols) | 0) * (tile + labelH + gap);
    g.save();
    g.shadowColor = 'rgba(66,54,40,0.28)'; g.shadowBlur = 12; g.shadowOffsetY = 4;
    g.fillStyle = '#FDFCF9'; rrG(x0, y0, tile, tile + labelH, 12); g.fill();
    g.restore();
    g.save(); rrG(x0, y0, tile, tile, 12); g.clip();
    const fg = g.createLinearGradient(x0, y0, x0 + tile, y0 + tile);
    fg.addColorStop(0, '#F7F4EE'); fg.addColorStop(1, '#EBE6DB');
    g.fillStyle = fg; g.fillRect(x0, y0, tile, tile);
    g.restore();
    const sc = document.createElement('canvas');
    const layout = { id: 'sheet-' + it.id, world: { w: it.w, h: it.h }, room: { x: 0, y: 0, w: 0, h: 0 }, zones: [], windows: [], furniture: it.furn, people: it.people || [] };
    renderScene(layout, { canvas: sc, theme, layers: ['floor', 'furniture'], width: tile - 18, height: tile - 18, dpr });
    const dw = sc.width / dpr, dh = sc.height / dpr;
    g.drawImage(sc, x0 + (tile - dw) / 2, y0 + (tile - dh) / 2, dw, dh);
    g.fillStyle = 'rgba(120,108,90,0.18)'; g.fillRect(x0 + 14, y0 + tile - 0.5, tile - 28, 1);
    g.font = '700 15px ' + FONT; g.fillStyle = '#3E4453'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(it.label, x0 + 16, y0 + tile + labelH / 2);
    g.font = '500 11px ' + FONT; g.fillStyle = '#9A917F'; g.textAlign = 'right';
    g.fillText(it.id, x0 + tile - 14, y0 + tile + labelH / 2 + 1);
    map.push({ id: it.id, label: it.label, x: x0 * dpr, y: y0 * dpr, w: tile * dpr, h: (tile + labelH) * dpr });
  }
  if (opts.chunked) {
    let i = 0;
    (function step() {
      if (opts.shouldContinue && !opts.shouldContinue()) return; // superseded
      const t0 = performance.now();
      while (i < items.length && performance.now() - t0 < 120) {
        try { paintTile(items[i], i); }
        catch (e) { console.error('[sheet:' + items[i].id + ']', e && e.message); }
        i++;
      }
      if (i < items.length) setTimeout(step, 30);
      else if (opts.onDone) opts.onDone(map);
    })();
  } else {
    items.forEach(paintTile);
  }
  return { canvas, map, count: items.length };
}
global.HorizonSceneV3 = { renderScene, renderAssetSheet, ASSET_CATALOG, VERSION: '3.2.0' };
})(typeof window !== 'undefined' ? window : globalThis);
