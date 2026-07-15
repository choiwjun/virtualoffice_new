/* HORIZON office scene — 2:1 dimetric, geometry derived from layout.json */
(function () {
  const W = 1672, H = 941, SS = 2;
  // Floor diamond from walkArea (exact contract)
  const A = { x: 0.4085 * W, y: 0.1762 * H };
  const B = { x: 0.9362 * W, y: 0.6451 * H };
  const D = { x: 0.0638 * W, y: 0.4825 * H };
  const U = { x: B.x - A.x, y: B.y - A.y };
  const V = { x: D.x - A.x, y: D.y - A.y };
  const ZPX = 48;                 // px per meter of height
  const MU = 1 / 20;              // u per meter (canvas width = 20 m)
  const MV = MU * Math.hypot(U.x, U.y) / Math.hypot(V.x, V.y);
  const DET = U.x * V.y - U.y * V.x;
  function P(u, v, z) { z = z || 0; return [A.x + u * U.x + v * V.x, A.y + u * U.y + v * V.y - z * ZPX]; }
  function uvOf(nx, ny) {
    const px = nx * W - A.x, py = ny * H - A.y;
    return { u: (px * V.y - py * V.x) / DET, v: (U.x * py - U.y * px) / DET };
  }
  // ---- layout.json obstacles (verbatim) ----
  const OB = [
    [[0.442,0.2413],[0.5275,0.3172],[0.4954,0.3456],[0.41,0.2697]],
    [[0.5946,0.3605],[0.6739,0.431],[0.6373,0.4635],[0.558,0.393]],
    [[0.5427,0.4066],[0.622,0.477],[0.5885,0.5069],[0.5092,0.4364]],
    [[0.6556,0.4581],[0.6922,0.4906],[0.6617,0.5177],[0.6251,0.4852]],
    [[0.7654,0.5448],[0.8752,0.6423],[0.8294,0.683],[0.7196,0.5854]],
    [[0.7654,0.4852],[0.773,0.492],[0.6449,0.6058],[0.6373,0.599]],
    [[0.6434,0.599],[0.7349,0.6803],[0.7288,0.6857],[0.6373,0.6044]],
    [[0.7715,0.7128],[0.8081,0.7453],[0.802,0.7507],[0.7654,0.7182]],
    [[0.4115,0.4066],[0.4664,0.4554],[0.439,0.4798],[0.3841,0.431]],
    [[0.4664,0.4554],[0.5214,0.5041],[0.4939,0.5285],[0.439,0.4798]],
    [[0.3582,0.454],[0.4131,0.5028],[0.3856,0.5272],[0.3307,0.4784]],
    [[0.4131,0.5028],[0.468,0.5516],[0.4405,0.576],[0.3856,0.5272]],
    [[0.6281,0.7264],[0.683,0.7751],[0.6373,0.8158],[0.5824,0.767]],
    [[0.622,0.6776],[0.7379,0.7806],[0.7303,0.7873],[0.6144,0.6844]],
    [[0.619,0.6803],[0.6266,0.6871],[0.5351,0.7684],[0.5275,0.7616]],
    [[0.5336,0.7616],[0.5702,0.7941],[0.5625,0.8009],[0.5259,0.7684]],
    [[0.6068,0.8266],[0.6434,0.8591],[0.6357,0.8659],[0.5991,0.8334]],
    [[0.2621,0.347],[0.3353,0.412],[0.2804,0.4608],[0.2072,0.3957]],
    [[0.2438,0.309],[0.259,0.3226],[0.1797,0.393],[0.1645,0.3795]],
    [[0.4664,0.5963],[0.5214,0.6451],[0.4939,0.6694],[0.439,0.6207]],
    [[0.5214,0.6451],[0.5763,0.6938],[0.5488,0.7182],[0.4939,0.6694]],
    [[0.4131,0.6437],[0.468,0.6925],[0.4405,0.7169],[0.3856,0.6681]],
    [[0.468,0.6925],[0.5229,0.7413],[0.4954,0.7656],[0.4405,0.7169]],
    [[0.1706,0.477],[0.2102,0.5123],[0.1736,0.5448],[0.0791,0.4987]].slice(0,3).concat([[0.134,0.5096]]),
    [[0.6098,0.8727],[0.6525,0.9106],[0.6418,0.9201],[0.5991,0.8822]],
    [[0.6052,0.874],[0.6129,0.8808],[0.5641,0.9242],[0.5564,0.9174]],
    [[0.6449,0.9093],[0.6525,0.916],[0.6037,0.9594],[0.5961,0.9526]]
  ];
  // fix cafe polygon (exact from layout.json)
  OB[23] = [[0.1706,0.477],[0.2102,0.5123],[0.1736,0.5448],[0.134,0.5096]];
  const SEATS = [
    [0.3993,0.4662],[0.4542,0.515],[0.3429,0.5163],[0.3978,0.5651],
    [0.4542,0.6559],[0.5092,0.7047],[0.3978,0.706],[0.4527,0.7548]
  ];
  const PLANTS = [
    [0.432,0.224,0.55],[0.556,0.291,0.55],[0.729,0.452,0.46],[0.617,0.595,0.46],
    [0.248,0.615,0.5],[0.325,0.702,0.44],[0.760,0.833,0.46]
  ];
  function rectOf(poly) {
    let u0 = 9, v0 = 9, u1 = -9, v1 = -9;
    for (const p of poly) { const q = uvOf(p[0], p[1]); u0 = Math.min(u0, q.u); v0 = Math.min(v0, q.v); u1 = Math.max(u1, q.u); v1 = Math.max(v1, q.v); }
    return { u0, v0, u1, v1, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, du: u1 - u0, dv: v1 - v0 };
  }
  const R = OB.map(rectOf);

  // ---- color helpers ----
  function hx(c) {
    if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    const m2 = c.match(/(\d+)\D+(\d+)\D+(\d+)/); return [+m2[1], +m2[2], +m2[3]];
  }
  function sh(c, f) { const [r, g, b] = hx(c); const m = x => Math.max(0, Math.min(255, Math.round(x * f))); return `rgb(${m(r)},${m(g)},${m(b)})`; }
  const WOOD = '#CDA97E', NAVY = '#33415E', FLOOR = '#E6E1D7', BG = '#EDEAE3', FAB = '#3A486A';

  function poly(ctx, pts, fill, stroke, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function grad(ctx, p0, p1, c0, c1) { const g = ctx.createLinearGradient(p0[0], p0[1], p1[0], p1[1]); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; }
  function box(ctx, u0, v0, u1, v1, z0, z1, base, o) {
    o = o || {};
    const top = [P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)];
    const left = [P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z1), P(u0, v1, z1)];
    const right = [P(u1, v0, z0), P(u1, v1, z0), P(u1, v1, z1), P(u1, v0, z1)];
    const rr = o.r || 0;
    poly(ctx, left, grad(ctx, P(u0, v1, z1), P(u0, v1, z0), sh(base, .99), sh(base, .90)), rr ? sh(base, .9) : null, rr);
    poly(ctx, right, grad(ctx, P(u1, v0, z1), P(u1, v1, z0), sh(base, .83), sh(base, .73)), rr ? sh(base, .74) : null, rr);
    poly(ctx, top, grad(ctx, top[0], top[2], sh(base, o.topHi || 1.12), sh(base, o.topLo || 1.02)), rr ? sh(base, 1.08) : null, rr);
    return top;
  }
  function shadow(ctx, u0, v0, u1, v1, h, a) {
    ctx.save(); ctx.filter = 'blur(6px)';
    const dx = 7 + h * 5, dy = 4 + h * 2.4;
    const pts = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)].map(p => [p[0] + dx, p[1] + dy]);
    poly(ctx, pts, `rgba(92,80,60,${a != null ? a : 0.16})`);
    ctx.restore();
    ctx.save(); ctx.filter = 'blur(2.5px)';
    poly(ctx, [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)].map(p => [p[0] + 1.5, p[1] + 1]), 'rgba(80,70,52,0.17)');
    ctx.restore();
  }
  function woodGrain(ctx, u0, v0, u1, v1, z, n) {
    ctx.save();
    const pts = [P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)];
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();
    ctx.lineWidth = 0.8;
    for (let i = 0; i < (n || 7); i++) {
      const t = (i + 0.5 + Math.sin(i * 7.3) * 0.25) / (n || 7);
      const v = v0 + (v1 - v0) * t;
      const a = P(u0, v + (v1 - v0) * 0.02 * Math.sin(i * 3), z), b = P(u1, v - (v1 - v0) * 0.02 * Math.sin(i * 5), z);
      ctx.strokeStyle = i % 3 === 2 ? 'rgba(255,244,220,0.20)' : 'rgba(112,80,44,0.14)';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + Math.sin(i * 2.1) * 2, b[0], b[1]); ctx.stroke();
    }
    // soft daylight sheen
    poly(ctx, pts, grad(ctx, pts[0], pts[2], 'rgba(255,250,238,0.16)', 'rgba(70,50,25,0.05)'));
    ctx.restore();
  }
  function ell(ctx, u, v, rm, z, fill, sq) {
    const c = P(u, v, z || 0); const rx = rm * MU * U.x * (sq || 1);
    ctx.beginPath(); ctx.ellipse(c[0], c[1], rx, rx * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  }

  // ================== furniture ==================
  function legs(ctx, r, h, base) {
    const iu = MU * 0.12, iv = MV * 0.12, s = MU * 0.09, sv = MV * 0.09;
    [[r.u0 + iu, r.v0 + iv], [r.u1 - iu - s, r.v0 + iv], [r.u0 + iu, r.v1 - iv - sv], [r.u1 - iu - s, r.v1 - iv - sv]]
      .forEach(([u, v]) => box(ctx, u, v, u + s, v + sv, 0, h, base));
  }
  function tableWood(ctx, r, h) {
    ell(ctx, r.cu, r.cv, Math.min(r.du / MU, r.dv / MV) * 0.42, 0.001, 'rgba(70,60,45,0.14)');
    legs(ctx, r, h - 0.06, sh(WOOD, 0.62));
    box(ctx, r.u0, r.v0, r.u1, r.v1, h - 0.07, h, WOOD, { r: 1.5 });
    woodGrain(ctx, r.u0, r.v0, r.u1, r.v1, h, 8);
    poly(ctx, [P(r.u0, r.v0, h), P(r.u1, r.v0, h), P(r.u1, r.v1, h), P(r.u0, r.v1, h)], null, 'rgba(255,244,222,0.30)', 1);
  }
  function officeChair(ctx, cu, cv, back) {
    const s = MU * 0.26, sv = MV * 0.26;
    ell(ctx, cu, cv, 0.34, 0.002, 'rgba(58,52,42,0.24)');
    const c0 = P(cu, cv, 0.03);
    ctx.strokeStyle = '#4A5160'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + i * Math.PI * 2 / 5;
      const ex = c0[0] + Math.cos(ang) * 10, ey = c0[1] + Math.sin(ang) * 5;
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = '#31363E'; ctx.beginPath(); ctx.ellipse(ex, ey + 1.6, 1.8, 1.1, 0, 0, 7); ctx.fill();
    }
    ctx.lineCap = 'butt';
    box(ctx, cu - s * 0.13, cv - sv * 0.13, cu + s * 0.13, cv + sv * 0.13, 0.06, 0.38, '#454C5B');
    box(ctx, cu - s, cv - sv, cu + s, cv + sv, 0.40, 0.52, FAB, { r: 2.5 });
    ell(ctx, cu - MU * 0.04, cv - MV * 0.04, 0.15, 0.523, 'rgba(255,255,255,0.09)');
    const t = 0.26, aw = 0.07, ah0 = 0.52, ah1 = 0.70;
    if (back === 'v-' || back === 'v+') {
      box(ctx, cu - s, cv - sv * 0.55, cu - s + MU * aw, cv + sv * 0.55, ah0, ah1, '#3A4150');
      box(ctx, cu + s - MU * aw, cv - sv * 0.55, cu + s, cv + sv * 0.55, ah0, ah1, '#3A4150');
    } else {
      box(ctx, cu - s * 0.55, cv - sv, cu + s * 0.55, cv - sv + MV * aw, ah0, ah1, '#3A4150');
      box(ctx, cu - s * 0.55, cv + sv - MV * aw, cu + s * 0.55, cv + sv, ah0, ah1, '#3A4150');
    }
    if (back === 'v-') box(ctx, cu - s * 0.92, cv - sv, cu + s * 0.92, cv - sv + MV * t, 0.52, 1.06, sh(FAB, 0.94), { r: 2.5 });
    else if (back === 'v+') box(ctx, cu - s * 0.92, cv + sv - MV * t, cu + s * 0.92, cv + sv, 0.52, 1.06, sh(FAB, 0.94), { r: 2.5 });
    else if (back === 'u-') box(ctx, cu - s, cv - sv * 0.92, cu - s + MU * t, cv + sv * 0.92, 0.52, 1.06, sh(FAB, 0.94), { r: 2.5 });
    else box(ctx, cu + s - MU * t, cv - sv * 0.92, cu + s, cv + sv * 0.92, 0.52, 1.06, sh(FAB, 0.94), { r: 2.5 });
  }
  function monitor(ctx, cu, cv, face) {
    // slab facing +v (viewer lower-left)
    box(ctx, cu - MU * 0.09, cv - MV * 0.06, cu + MU * 0.09, cv + MV * 0.06, 0.74, 0.78, '#39404E');
    const w = MU * 0.34, d = MV * 0.028;
    const z0 = 0.82, z1 = 1.24;
    box(ctx, cu - MU * 0.02, cv - d, cu + MU * 0.02, cv + d, 0.74, z0, '#2A303C');
    const u0 = cu - w, u1 = cu + w, vv = cv;
    // panel
    poly(ctx, [P(u0, vv, z0), P(u1, vv, z0), P(u1, vv, z1), P(u0, vv, z1)], '#232936');
    const scr = [P(u0 + MU * 0.02, vv, z0 + 0.03), P(u1 - MU * 0.02, vv, z0 + 0.03), P(u1 - MU * 0.02, vv, z1 - 0.03), P(u0 + MU * 0.02, vv, z1 - 0.03)];
    poly(ctx, scr, grad(ctx, scr[3], scr[1], '#46587A', '#161C28'));
    poly(ctx, [scr[3], [scr[3][0] + 14, scr[3][1] + 7], [scr[0][0] + 8, scr[0][1] - 4], scr[0]], 'rgba(255,255,255,0.10)');
  }
  function laptop(ctx, cu, cv) {
    box(ctx, cu - MU * 0.14, cv - MV * 0.10, cu + MU * 0.14, cv + MV * 0.10, 0.74, 0.755, '#8B93A3');
    poly(ctx, [P(cu - MU * 0.14, cv - MV * 0.10, 0.755), P(cu + MU * 0.14, cv - MV * 0.10, 0.755), P(cu + MU * 0.14, cv - MV * 0.10, 0.97), P(cu - MU * 0.14, cv - MV * 0.10, 0.97)], '#2B3242');
  }
  function paper(ctx, cu, cv) {
    poly(ctx, [P(cu - MU * 0.1, cv - MV * 0.07, 0.745), P(cu + MU * 0.1, cv - MV * 0.07, 0.745), P(cu + MU * 0.1, cv + MV * 0.07, 0.745), P(cu - MU * 0.1, cv + MV * 0.07, 0.745)], 'rgba(250,248,242,0.96)');
  }
  function mug(ctx, cu, cv, c) {
    const p = P(cu, cv, 0.74);
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(p[0], p[1] - 4, 3.4, 1.9, 0, 0, 7); ctx.fill();
    ctx.fillRect(p[0] - 3.4, p[1] - 4, 6.8, 4);
    ctx.beginPath(); ctx.ellipse(p[0], p[1], 3.4, 1.9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(p[0], p[1] - 4, 2.2, 1.1, 0, 0, 7); ctx.fill();
  }
  function desk(ctx, r, seat) {
    shadow(ctx, r.u0, r.v0, r.u1, r.v1, 0.74);
    const chairSide = seat.v > r.v1 ? 'v+' : seat.v < r.v0 ? 'v-' : seat.u > r.u1 ? 'u+' : 'u-';
    tableWood(ctx, r, 0.74);
    // desk privacy screen on far edge
    const fv = chairSide === 'v+' ? r.v0 + MV * 0.04 : r.v1 - MV * 0.07;
    poly(ctx, [P(r.u0 + MU * 0.1, fv, 0.74), P(r.u1 - MU * 0.1, fv, 0.74), P(r.u1 - MU * 0.1, fv, 1.05), P(r.u0 + MU * 0.1, fv, 1.05)], 'rgba(174,196,214,0.45)');
    monitor(ctx, r.cu - MU * 0.18, chairSide === 'v+' ? r.v0 + MV * 0.28 : r.v1 - MV * 0.28, chairSide);
    const kv = chairSide === 'v+' ? r.v0 + MV * 0.52 : r.v1 - MV * 0.52;
    box(ctx, r.cu - MU * 0.31, kv - MV * 0.055, r.cu - MU * 0.05, kv + MV * 0.055, 0.74, 0.752, '#D9D6CC');
    ctx.strokeStyle = 'rgba(90,85,70,0.35)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(...P(r.cu - MU * 0.29, kv, 0.752)); ctx.lineTo(...P(r.cu - MU * 0.07, kv, 0.752)); ctx.stroke();
    laptop(ctx, r.cu + MU * 0.32, r.cv + MV * 0.05);
    paper(ctx, r.u0 + MU * 0.22, r.cv + MV * 0.18);
    mug(ctx, r.u1 - MU * 0.16, r.v0 + MV * 0.22, (r.cu * 31 % 2) > 1 ? '#A8442F' : sh(NAVY, 1.1));
    // 의자는 별도 아이템으로 분리(레이어 오클루전: 책상+의자 그룹이면 baseline이
    // 의자 앞모서리가 되어 착석/근접 아바타가 통째로 깔린다)
  }
  function deskChairSide(r, seat) {
    return seat.v > r.v1 ? 'v+' : seat.v < r.v0 ? 'v-' : seat.u > r.u1 ? 'u+' : 'u-';
  }
  function sofa(ctx, r, backAt) {
    shadow(ctx, r.u0, r.v0, r.u1, r.v1, 0.75, 0.20);
    box(ctx, r.u0, r.v0, r.u1, r.v1, 0.10, 0.44, '#3D4C6D', { r: 2.5 });
    const bd = MV * 0.32, arm = MU * 0.22;
    // seat cushions
    const su0 = r.u0 + arm, su1 = r.u1 - arm;
    const cv0 = backAt === 'v-' ? r.v0 + bd : r.v0 + MV * 0.06, cv1 = backAt === 'v-' ? r.v1 - MV * 0.06 : r.v1 - bd;
    const mid = (su0 + su1) / 2;
    box(ctx, su0 + MU * 0.02, cv0, mid - MU * 0.015, cv1, 0.44, 0.58, '#46577A', { r: 3 });
    box(ctx, mid + MU * 0.015, cv0, su1 - MU * 0.02, cv1, 0.44, 0.58, '#46577A', { r: 3 });
    // back
    if (backAt === 'v-') box(ctx, r.u0, r.v0, r.u1, r.v0 + bd, 0.44, 0.98, '#425275', { r: 3 });
    else box(ctx, r.u0, r.v1 - bd, r.u1, r.v1, 0.44, 0.98, '#425275', { r: 3 });
    // arms
    box(ctx, r.u0, r.v0, r.u0 + arm, r.v1, 0.44, 0.72, '#41506F', { r: 3 });
    box(ctx, r.u1 - arm, r.v0, r.u1, r.v1, 0.44, 0.72, '#41506F', { r: 3 });
    const pv0 = backAt === 'v-' ? r.v0 + bd : r.v1 - bd - MV * 0.22;
    box(ctx, r.u0 + arm + MU * 0.03, pv0, r.u0 + arm + MU * 0.30, pv0 + MV * 0.22, 0.50, 0.84, '#5A6C93', { r: 3 });
    box(ctx, r.u1 - arm - MU * 0.30, pv0, r.u1 - arm - MU * 0.03, pv0 + MV * 0.22, 0.50, 0.80, '#C9A87A', { r: 3 });
  }
  function glassWall(ctx, r) {
    const alongU = r.du * (U.x * 20) > r.dv * 20 / MV * MU * U.x ? r.du / MU > r.dv / MV : false;
    const isU = (r.du / MU) > (r.dv / MV);
    const h = 2.55;
    let a, b;
    if (isU) { const vc = r.cv; a = [r.u0, vc]; b = [r.u1, vc]; } else { const uc = r.cu; a = [uc, r.v0]; b = [uc, r.v1]; }
    ctx.save(); ctx.filter = 'blur(5px)';
    const ra = P(a[0], a[1], 0), rb = P(b[0], b[1], 0);
    poly(ctx, [[ra[0] + 2, ra[1] + 2], [rb[0] + 2, rb[1] + 2], [rb[0] + 9, rb[1] + 15], [ra[0] + 9, ra[1] + 15]], 'rgba(196,212,228,0.20)');
    ctx.restore();
    // floor track
    poly(ctx, [P(a[0], a[1], 0), P(b[0], b[1], 0), [P(b[0], b[1], 0)[0] + 1.5, P(b[0], b[1], 0)[1] + 1.5], [P(a[0], a[1], 0)[0] + 1.5, P(a[0], a[1], 0)[1] + 1.5]], 'rgba(90,100,110,0.55)');
    const q = [P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], h), P(a[0], a[1], h)];
    poly(ctx, q, grad(ctx, q[3], q[1], 'rgba(205,226,242,0.30)', 'rgba(168,196,218,0.16)'));
    // sheen streak
    ctx.save(); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();
    const mx = (q[0][0] + q[1][0]) / 2, w = Math.abs(q[1][0] - q[0][0]);
    poly(ctx, [[mx - w * 0.30, q[2][1] - 4], [mx - w * 0.14, q[2][1] - 4], [mx - w * 0.34, q[0][1] + 6], [mx - w * 0.50, q[0][1] + 6]], 'rgba(255,255,255,0.14)');
    poly(ctx, [[mx + w * 0.10, q[2][1] - 4], [mx + w * 0.16, q[2][1] - 4], [mx - w * 0.04, q[0][1] + 6], [mx - w * 0.10, q[0][1] + 6]], 'rgba(255,255,255,0.09)');
    ctx.restore();
    // top + edge rails and posts
    ctx.strokeStyle = 'rgba(122,140,152,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(q[3][0], q[3][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,168,180,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[3][0], q[3][1]); ctx.moveTo(q[1][0], q[1][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.stroke();
    const ps = 0.05;
    [[a[0], a[1]], [b[0], b[1]]].forEach(([u, v]) => box(ctx, u - MU * ps, v - MV * ps, u + MU * ps, v + MV * ps, 0, h, '#6E7B86'));
  }
  function plant(ctx, nx, ny, s) {
    const q = uvOf(nx, ny), u = q.u, v = q.v;
    const pw = MU * 0.5 * s * 2, pv = MV * 0.5 * s * 2;
    ell(ctx, u, v, 0.5 * s * 1.3, 0.002, 'rgba(70,62,48,0.22)');
    box(ctx, u - pw / 2, v - pv / 2, u + pw / 2, v + pv / 2, 0, 0.5 * s + 0.12, '#B9B2A4', { r: 1.5 });
    box(ctx, u - pw / 2 - MU * 0.025, v - pv / 2 - MV * 0.025, u + pw / 2 + MU * 0.025, v + pv / 2 + MV * 0.025, 0.5 * s, 0.5 * s + 0.13, '#C6BFB0', { r: 1.5 });
    ell(ctx, u, v, 0.42 * s, 0.5 * s + 0.132, '#4C3D2C');
    const tb = P(u, v, 0.5 * s + 0.1), tt = P(u, v, 1.15 * s + 0.4);
    ctx.strokeStyle = '#6E5236'; ctx.lineWidth = 2.6 * s + 0.8;
    ctx.beginPath(); ctx.moveTo(tb[0], tb[1]); ctx.quadraticCurveTo(tb[0] + 3, (tb[1] + tt[1]) / 2, tt[0] - 1, tt[1]); ctx.stroke();
    const c = P(u, v, 0.62 * s + 0.9 * s);
    const rr = 30 * s * 1.5;
    const blobs = [[0, 6, rr], [-rr * 0.5, rr * 0.35, rr * 0.62], [rr * 0.5, rr * 0.3, rr * 0.58], [-rr * 0.15, -rr * 0.5, rr * 0.55], [rr * 0.22, -rr * 0.28, rr * 0.5]];
    for (const [ox, oy, r0] of blobs) {
      const g = ctx.createRadialGradient(c[0] + ox - r0 * 0.4, c[1] + oy - r0 * 0.5, r0 * 0.1, c[0] + ox, c[1] + oy, r0);
      g.addColorStop(0, '#8FBF77'); g.addColorStop(0.55, '#6A9E58'); g.addColorStop(1, '#4A7A40');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0] + ox, c[1] + oy, r0, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,235,0.14)'; ctx.beginPath(); ctx.arc(c[0] - rr * 0.35, c[1] - rr * 0.42, rr * 0.42, 0, 7); ctx.fill();
    for (let i = 0; i < 16; i++) {
      const aa = Math.sin(i * 12.9898 + u * 78.233) * 43758.5453, fr = aa - Math.floor(aa);
      const bb = Math.sin(i * 4.898 + v * 39.425) * 23421.631, fr2 = bb - Math.floor(bb);
      const ang = fr * Math.PI * 2, rad = rr * (0.25 + fr2 * 0.72);
      const lx = c[0] + Math.cos(ang) * rad, ly = c[1] + Math.sin(ang) * rad * 0.85;
      ctx.fillStyle = fr2 > 0.5 ? 'rgba(210,235,180,0.35)' : 'rgba(30,58,26,0.30)';
      ctx.beginPath(); ctx.ellipse(lx, ly, 2.6, 1.6, ang, 0, 7); ctx.fill();
    }
  }
  function cubeStool(ctx, u, v, s) {
    const a = MU * s / 2, b = MV * s / 2;
    shadow(ctx, u - a, v - b, u + a, v + b, 0.45, 0.14);
    box(ctx, u - a, v - b, u + a, v + b, 0, 0.46, sh(WOOD, 1.02), { r: 1.5 });
    woodGrain(ctx, u - a, v - b, u + a, v + b, 0.46, 3);
  }
  function loungeChair(ctx, u, v, back) {
    const a = MU * 0.34, b = MV * 0.34;
    ell(ctx, u, v, 0.42, 0.002, 'rgba(60,55,45,0.24)');
    box(ctx, u - a, v - b, u + a, v + b, 0.06, 0.4, '#414F6E', { r: 3 });
    const t = 0.24;
    if (back === 'u-') box(ctx, u - a, v - b, u - a + MU * t, v + b, 0.4, 0.82, '#3A4763', { r: 3 });
    else if (back === 'u+') box(ctx, u + a - MU * t, v - b, u + a, v + b, 0.4, 0.82, '#3A4763', { r: 3 });
    else if (back === 'v-') box(ctx, u - a, v - b, u + a, v - b + MV * t, 0.4, 0.82, '#3A4763', { r: 3 });
    else box(ctx, u - a, v + b - MV * t, u + a, v + b, 0.4, 0.82, '#3A4763', { r: 3 });
  }

  // ================== scene ==================
  function drawScene(ctx, opts) {
    // 레이어 캡처 모드(opts.capture): ctx를 레이어별 캔버스로 스위칭하며 그린다.
    // 아이템 클로저들이 이 함수 스코프의 ctx 바인딩을 캡처하므로 재할당이 곧 리타깃.
    const cap = opts.capture || null;
    if (cap) ctx = cap.background();
    else ctx.save();
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

    // soft drop shadow under the whole slab
    ctx.save(); ctx.filter = 'blur(26px)';
    poly(ctx, [P(0, 0), P(1, 0), P(1, 1), P(0, 1)].map(p => [p[0] + 4, p[1] + 16]), 'rgba(105,95,75,0.22)');
    ctx.restore();

    // ---- floor ----
    const F = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
    poly(ctx, F, grad(ctx, P(0, 0.2), P(1, 1), '#EAE5DA', '#DDD6C7'));
    // radial daylight from upper-left
    const lg = ctx.createRadialGradient(...P(0.18, 0.35), 60, ...P(0.3, 0.4), 900);
    lg.addColorStop(0, 'rgba(255,252,242,0.30)'); lg.addColorStop(1, 'rgba(120,105,80,0.10)');
    ctx.save(); ctx.beginPath(); ctx.moveTo(F[0][0], F[0][1]); F.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();
    ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    // tile grid (2m)
    ctx.strokeStyle = 'rgba(118,104,82,0.10)'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { const t = i * MU * 2; const a = P(t, 0), b = P(t, 1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    for (let i = 1; i * MV * 2 < 1; i++) { const t = i * MV * 2; const a = P(0, t), b = P(1, t); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let i = 1; i < 10; i++) { const t = i * MU * 2; const a = P(t, 0), b = P(t, 1); ctx.beginPath(); ctx.moveTo(a[0] + 0.8, a[1] + 0.8); ctx.lineTo(b[0] + 0.8, b[1] + 0.8); ctx.stroke(); }
    for (let i = 0; i < 10; i++) for (let j = 0; j < 7; j++) {
      if ((i + j) % 2) continue;
      const tu0 = i * MU * 2, tv0 = j * MV * 2;
      if (tv0 >= 1) continue;
      poly(ctx, [P(tu0, tv0), P(Math.min(tu0 + MU * 2, 1), tv0), P(Math.min(tu0 + MU * 2, 1), Math.min(tv0 + MV * 2, 1)), P(tu0, Math.min(tv0 + MV * 2, 1))], 'rgba(255,255,255,0.03)');
    }
    ctx.save(); ctx.filter = 'blur(9px)';
    [[0.06, 0.24], [0.30, 0.48], [0.72, 0.90]].forEach(([w0, w1]) => {
      poly(ctx, [P(0.015, w0 + 0.02), P(0.17, w0 + 0.05), P(0.17, w1 + 0.01), P(0.015, w1 - 0.015)], 'rgba(255,250,232,0.17)');
    });
    [[0.42, 0.55], [0.60, 0.73]].forEach(([w0, w1]) => {
      poly(ctx, [P(w0 + 0.015, 0.012), P(w1 - 0.01, 0.012), P(w1 + 0.02, 0.13), P(w0 + 0.05, 0.13)], 'rgba(255,250,232,0.14)');
    });
    ctx.restore();
    // AO along walls
    poly(ctx, [P(0, 0), P(1, 0), P(1, MV * 0.9), P(0, MV * 0.9)], grad(ctx, P(0.5, 0), P(0.5, MV * 0.9), 'rgba(95,85,65,0.20)', 'rgba(95,85,65,0)'));
    poly(ctx, [P(0, 0), P(0, 1), P(MU * 0.9, 1), P(MU * 0.9, 0)], grad(ctx, P(0, 0.5), P(MU * 0.9, 0.5), 'rgba(95,85,65,0.20)', 'rgba(95,85,65,0)'));
    ctx.restore();

    // ---- building walls ----
    const WH = 3.1, T = 0.16;
    // NE wall (v = 0)
    const neq = [P(0, 0, 0), P(1, 0, 0), P(1, 0, WH), P(0, 0, WH)];
    poly(ctx, neq, grad(ctx, neq[3], neq[1], '#E3DDD1', '#CFC7B8'));
    poly(ctx, [P(0, 0, 0), P(1, 0, 0), P(1, 0, 0.35), P(0, 0, 0.35)], grad(ctx, P(0.5, 0, 0.35), P(0.5, 0, 0), 'rgba(0,0,0,0)', 'rgba(85,75,58,0.16)'));
    poly(ctx, [P(0, 0, 0), P(1, 0, 0), P(1, 0, 0.12), P(0, 0, 0.12)], 'rgba(148,136,112,0.35)');
    poly(ctx, [P(0, 0, WH), P(1, 0, WH), P(1, -MV * T, WH), P(0, -MV * T, WH)], '#F1ECE2');
    poly(ctx, [P(1, 0, 0), P(1, -MV * T, 0), P(1, -MV * T, WH), P(1, 0, WH)], '#C6BDAD');
    // NW wall (u = 0)
    const nwq = [P(0, 0, 0), P(0, 1, 0), P(0, 1, WH), P(0, 0, WH)];
    poly(ctx, nwq, grad(ctx, nwq[3], nwq[1], '#EFEADE', '#DAD3C4'));
    poly(ctx, [P(0, 0, 0), P(0, 1, 0), P(0, 1, 0.35), P(0, 0, 0.35)], grad(ctx, P(0, 0.5, 0.35), P(0, 0.5, 0), 'rgba(0,0,0,0)', 'rgba(85,75,58,0.14)'));
    poly(ctx, [P(0, 0, 0), P(0, 1, 0), P(0, 1, 0.12), P(0, 0, 0.12)], 'rgba(160,150,128,0.30)');
    poly(ctx, [P(0, 0, WH), P(0, 1, WH), P(-MU * T, 1, WH), P(-MU * T, 0, WH)], '#F5F1E8');
    poly(ctx, [P(0, 1, 0), P(-MU * T, 1, 0), P(-MU * T, 1, WH), P(0, 1, WH)], '#E8E2D5');
    // corner seam
    ctx.strokeStyle = 'rgba(120,108,88,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(...P(0, 0, 0)); ctx.lineTo(...P(0, 0, WH)); ctx.stroke();
    poly(ctx, [P(0, 0, 0), P(0.05, 0, 0), P(0.05, 0, WH), P(0, 0, WH)], grad(ctx, P(0, 0, 0), P(0.05, 0, 0), 'rgba(90,78,58,0.14)', 'rgba(90,78,58,0)'));
    poly(ctx, [P(0, 0, 0), P(0, 0.05, 0), P(0, 0.05, WH), P(0, 0, WH)], grad(ctx, P(0, 0, 0), P(0, 0.05, 0), 'rgba(90,78,58,0.12)', 'rgba(90,78,58,0)'));

    // windows helper
    function windowNW(v0, v1) {
      const z0 = 0.95, z1 = 2.55;
      poly(ctx, [P(0, v0, z0 - 0.05), P(0, v1, z0 - 0.05), P(0, v1, z1 + 0.05), P(0, v0, z1 + 0.05)], '#F4F1E9');
      const q = [P(0, v0, z0), P(0, v1, z0), P(0, v1, z1), P(0, v0, z1)];
      poly(ctx, q, grad(ctx, q[3], q[1], '#C5DAEA', '#E9F2F7'));
      ctx.save(); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.ellipse(q[0][0] + (q[1][0] - q[0][0]) * 0.35, q[3][1] + 18, 26, 7, -0.15, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(q[0][0] + (q[1][0] - q[0][0]) * 0.7, q[3][1] + 34, 18, 5, -0.15, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#F4F1E9'; ctx.lineWidth = 2.5;
      const vm = (v0 + v1) / 2, zm = (z0 + z1) / 2;
      ctx.beginPath(); ctx.moveTo(...P(0, vm, z0)); ctx.lineTo(...P(0, vm, z1)); ctx.moveTo(...P(0, v0, zm)); ctx.lineTo(...P(0, v1, zm)); ctx.stroke();
      poly(ctx, [P(0, v0, z0), P(0, v1, z0), P(0, v1, z0 - 0.02), [P(0, v0, z0)[0] + 3, P(0, v0, z0 - 0.02)[1] + 2]], 'rgba(90,80,60,0.18)');
    }
    function windowNE(u0, u1) {
      const z0 = 0.95, z1 = 2.55;
      poly(ctx, [P(u0, 0, z0 - 0.05), P(u1, 0, z0 - 0.05), P(u1, 0, z1 + 0.05), P(u0, 0, z1 + 0.05)], '#EFEBE1');
      const q = [P(u0, 0, z0), P(u1, 0, z0), P(u1, 0, z1), P(u0, 0, z1)];
      poly(ctx, q, grad(ctx, q[3], q[1], '#BFD5E7', '#E2EEF5'));
      ctx.save(); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.ellipse(q[0][0] + (q[1][0] - q[0][0]) * 0.4, q[3][1] + 20, 24, 6, 0.15, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#EFEBE1'; ctx.lineWidth = 2.5;
      const um = (u0 + u1) / 2, zm = (z0 + z1) / 2;
      ctx.beginPath(); ctx.moveTo(...P(um, 0, z0)); ctx.lineTo(...P(um, 0, z1)); ctx.moveTo(...P(u0, 0, zm)); ctx.lineTo(...P(u1, 0, zm)); ctx.stroke();
    }
    windowNW(0.06, 0.24); windowNW(0.30, 0.48); windowNW(0.72, 0.90);
    windowNE(0.42, 0.55); windowNE(0.60, 0.73);
    // small art frames on NW wall
    function frame(v0, v1, art) {
      const z0 = 1.55, z1 = 2.05;
      poly(ctx, [P(0, v0, z0), P(0, v1, z0), P(0, v1, z1), P(0, v0, z1)], '#FAF7F0');
      poly(ctx, [P(0, v0 + 0.006, z0 + 0.08), P(0, v1 - 0.006, z0 + 0.08), P(0, v1 - 0.006, z1 - 0.08), P(0, v0 + 0.006, z1 - 0.08)], art);
      poly(ctx, [P(0, v0, z0), P(0, v1, z0), [P(0, v1, z0)[0] + 2, P(0, v1, z0)[1] + 3], [P(0, v0, z0)[0] + 2, P(0, v0, z0)[1] + 3]], 'rgba(80,70,52,0.20)');
    }
    frame(0.255, 0.29, '#A65043'); frame(0.52, 0.555, '#3E4E6E');

    // ---- brand wall (NE, behind reception) ----
    (function brand() {
      const u0 = 0.105, u1 = 0.318, z0 = 0.25, z1 = 2.92;
      const q = [P(u0, 0, z0), P(u1, 0, z0), P(u1, 0, z1), P(u0, 0, z1)];
      poly(ctx, q, grad(ctx, q[3], q[1], '#C79A67', '#A87C4A'));
      // vertical slats
      ctx.save(); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();
      for (let i = 0; i <= 30; i++) {
        const uu = u0 + (u1 - u0) * i / 30;
        ctx.strokeStyle = i % 2 ? 'rgba(70,45,18,0.28)' : 'rgba(255,230,190,0.14)'; ctx.lineWidth = i % 2 ? 1.6 : 0.8;
        ctx.beginPath(); ctx.moveTo(...P(uu, 0, z0)); ctx.lineTo(...P(uu, 0, z1)); ctx.stroke();
      }
      poly(ctx, q, grad(ctx, q[3], q[2], 'rgba(255,244,222,0.18)', 'rgba(60,40,15,0.16)'));
      poly(ctx, [P(u0, 0, z0), P(u1, 0, z0), P(u1, 0, z0 + 0.55), P(u0, 0, z0 + 0.55)], grad(ctx, P(u0, 0, z0), P(u0, 0, z0 + 0.55), 'rgba(255,232,190,0.30)', 'rgba(255,232,190,0)'));
      ctx.restore();
      // side + top edge
      poly(ctx, [P(u1, 0, z0), [P(u1, 0, z0)[0] + 3, P(u1, 0, z0)[1] + 1.5], [P(u1, 0, z1)[0] + 3, P(u1, 0, z1)[1] + 1.5], P(u1, 0, z1)], '#8E683C');
      // HORIZON lettering on wall plane
      const ex = { x: U.x / Math.hypot(U.x, U.y), y: U.y / Math.hypot(U.x, U.y) };
      const base = P(u0 + 0.018, 0, 2.05);
      ctx.setTransform(SS * ex.x, SS * ex.y, 0, SS, SS * base[0], SS * base[1]);
      const word = 'HORIZON';
      ctx.font = '700 34px "Avenir Next","Trebuchet MS",system-ui,sans-serif';
      let x = 0; const adv = [];
      for (const ch of word) { adv.push(x); x += ctx.measureText(ch).width + 14; }
      const total = x - 14, avail = (u1 - u0 - 0.036) * Math.hypot(U.x, U.y);
      const sc = avail / total;
      for (let i = 0; i < word.length; i++) {
        const cx = adv[i] * sc;
        ctx.save(); ctx.translate(cx, 0); ctx.scale(sc, sc);
        ctx.fillStyle = 'rgba(60,38,12,0.45)'; ctx.fillText(word[i], 1.6, 2);
        ctx.fillStyle = '#F5EFE3'; ctx.fillText(word[i], 0, 0);
        ctx.restore();
      }
      ctx.setTransform(SS, 0, 0, SS, 0, 0);
    })();

    // ---- boardroom TV on NE wall ----
    (function tv() {
      const u0 = 0.765, u1 = 0.905, z0 = 1.32, z1 = 2.18;
      poly(ctx, [P(u0 - 0.004, 0, z0 - 0.04), P(u1 + 0.004, 0, z0 - 0.04), P(u1 + 0.004, 0, z1 + 0.04), P(u0 - 0.004, 0, z1 + 0.04)], '#1E242E');
      const q = [P(u0, 0, z0), P(u1, 0, z0), P(u1, 0, z1), P(u0, 0, z1)];
      poly(ctx, q, grad(ctx, q[3], q[1], '#2E3A4E', '#131820'));
      poly(ctx, [q[3], [q[3][0] + 30, q[3][1] + 15], [q[0][0] + 16, q[0][1] - 8], q[0]], 'rgba(255,255,255,0.07)');
    })();

    // ---- grey partition leaning on NW wall (obstacle 18) ----
    (function part() {
      const r = R[18];
      shadow(ctx, 0, r.v0, MU * 0.3, r.v1, 2.0, 0.13);
      const h = 2.25, uu = Math.max(r.u1, MU * 0.22);
      const q = [P(uu, r.v0, 0), P(uu, r.v1, 0), P(uu, r.v1, h), P(uu, r.v0, h)];
      box(ctx, 0, r.v0, uu, r.v1, 0, h, '#BFB9AC');
      poly(ctx, q, grad(ctx, q[3], q[1], '#CCC6B9', '#B3AC9E'));
    })();

    // ================= furniture (painter passes) =================
    // shadows already per-item. BACK glass first:
    glassWall(ctx, R[5]);            // boardroom back-left
    glassWall(ctx, R[13]);           // meeting back-right
    glassWall(ctx, R[14]);           // meeting back-left
    // phone booth back + left
    (function boothBack() {
      const r = R[24];
      shadow(ctx, r.u0, r.v0, r.u1, r.v1, 2.2, 0.2);
      box(ctx, r.u0, r.v0, r.u1, r.v1, 0, 2.3, sh(WOOD, 0.9), { r: 1 });
      // slats on visible left face
      ctx.strokeStyle = 'rgba(70,45,18,0.25)'; ctx.lineWidth = 1.2;
      for (let i = 1; i < 10; i++) {
        const uu = r.u0 + (r.u1 - r.u0) * i / 10;
        ctx.beginPath(); ctx.moveTo(...P(uu, r.v1, 0)); ctx.lineTo(...P(uu, r.v1, 2.3)); ctx.stroke();
      }
    })();
    glassWall(ctx, R[25]);           // booth left

    const items = [];
    let itemSeq = 0;
    // flat=true 항목(러그 등 바닥 평면)은 레이어 캡처 시 배경에 흡수 — 아바타를 가리면 안 됨.
    // 입체 가구의 깊이 키(baseline)는 캡처 후 픽셀(불투명 최저점=바닥 접점)에서 자동 산출.
    const add = (cu, cv, fn, flat) => items.push({ d: cu + cv, fn, flat: !!flat, name: `item-${itemSeq++}` });

    // reception
    add(R[0].cu, R[0].cv, () => {
      const r = R[0];
      shadow(ctx, r.u0, r.v0, r.u1, r.v1, 1.05);
      box(ctx, r.u0, r.v0, r.u1, r.v1, 0, 1.02, WOOD, { r: 1.5 });
      ctx.strokeStyle = 'rgba(94,62,26,0.18)'; ctx.lineWidth = 1.1;
      for (let i = 1; i < 14; i++) {
        const uu = r.u0 + (r.u1 - r.u0) * i / 14;
        ctx.beginPath(); ctx.moveTo(...P(uu, r.v1, 0.05)); ctx.lineTo(...P(uu, r.v1, 0.98)); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,240,215,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(...P(r.u0, r.v1, 0.55)); ctx.lineTo(...P(r.u1, r.v1, 0.55)); ctx.stroke();
      box(ctx, r.u0 - MU * 0.05, r.v0 - MV * 0.05, r.u1 + MU * 0.05, r.v1 + MV * 0.05, 1.02, 1.12, '#F2EFE8', { r: 1.5 });
    });
    // lounge rug + sofas + coffee table
    add(R[1].cu - 0.02, R[1].cv - 0.02, () => {
      const u0 = Math.min(R[1].u0, R[2].u0) - MU * 0.5, v0 = Math.min(R[1].v0, R[2].v0) - MV * 0.4;
      const u1 = Math.max(R[1].u1, R[2].u1) + MU * 0.5, v1 = Math.max(R[1].v1, R[2].v1) + MV * 0.5;
      poly(ctx, [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], 'rgba(222,210,186,0.85)');
      poly(ctx, [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], null, 'rgba(150,132,100,0.35)', 1.5);
    }, true);
    add(R[1].cu, R[1].cv, () => sofa(ctx, R[1], 'v-'));
    add(R[2].cu, R[2].cv, () => sofa(ctx, R[2], 'v+'));
    add(R[3].cu, R[3].cv, () => {
      const r = R[3];
      shadow(ctx, r.u0, r.v0, r.u1, r.v1, 0.42, 0.15);
      legs(ctx, r, 0.36, sh(WOOD, 0.6));
      box(ctx, r.u0, r.v0, r.u1, r.v1, 0.36, 0.42, WOOD, { r: 1.5 });
      woodGrain(ctx, r.u0, r.v0, r.u1, r.v1, 0.42, 4);
      ell(ctx, r.cu, r.cv - MV * 0.1, 0.16, 0.435, '#2E3A54');
    });
    // boardroom table + 8 chairs — 의자를 개별 아이템으로(오클루전 baseline 정밀화)
    (function boardroom() {
      const r = R[4];
      for (let i = 0; i < 3; i++) {
        const uu = r.u0 + (r.du) * (i + 0.5) / 3;
        add(uu, r.v0 - MV * 0.42, () => officeChair(ctx, uu, r.v0 - MV * 0.42, 'v-'));
      }
      add(r.u0 - MU * 0.42, r.cv, () => officeChair(ctx, r.u0 - MU * 0.42, r.cv, 'u-'));
      add(r.cu, r.cv, () => {
        shadow(ctx, r.u0, r.v0, r.u1, r.v1, 0.76);
        tableWood(ctx, r, 0.74);
        paper(ctx, r.cu - MU * 0.3, r.cv); paper(ctx, r.cu + MU * 0.35, r.cv + MV * 0.1);
        ell(ctx, r.cu, r.cv - MV * 0.12, 0.13, 0.745, '#39445C');
      });
      for (let i = 0; i < 3; i++) {
        const uu = r.u0 + (r.du) * (i + 0.5) / 3;
        add(uu, r.v1 + MV * 0.42, () => officeChair(ctx, uu, r.v1 + MV * 0.42, 'v+'));
      }
      add(r.u1 + MU * 0.42, r.cv, () => officeChair(ctx, r.u1 + MU * 0.42, r.cv, 'u+'));
    })();
    // workstations
    [[8, 0], [9, 1], [10, 2], [11, 3], [19, 4], [20, 5], [21, 6], [22, 7]].forEach(([oi, si]) => {
      const r = R[oi], s = uvOf(SEATS[si][0], SEATS[si][1]);
      add(r.cu, r.cv, () => desk(ctx, r, s));
      add(s.u, s.v, () => officeChair(ctx, s.u, s.v, deskChairSide(r, s)));
    });
    // meeting table + 4 chairs — 의자 개별 아이템
    (function meeting() {
      const r = R[12];
      for (const t of [0.28, 0.72]) {
        add(r.u0 + r.du * t, r.v0 - MV * 0.4, () => officeChair(ctx, r.u0 + r.du * t, r.v0 - MV * 0.4, 'v-'));
      }
      add(r.cu, r.cv, () => {
        shadow(ctx, r.u0, r.v0, r.u1, r.v1, 0.75);
        tableWood(ctx, r, 0.74);
        paper(ctx, r.cu, r.cv - MV * 0.05);
      });
      for (const t of [0.28, 0.72]) {
        add(r.u0 + r.du * t, r.v1 + MV * 0.4, () => officeChair(ctx, r.u0 + r.du * t, r.v1 + MV * 0.4, 'v+'));
      }
    })();
    // pantry island: bench + table + stools
    add(R[17].cu, R[17].cv, () => {
      const r = R[17];
      shadow(ctx, r.u0, r.v0, r.u1, r.v1, 0.9, 0.14);
      // white bench along back
      box(ctx, r.u0, r.v0, r.u1, r.v0 + r.dv * 0.30, 0, 0.48, '#F0EDE4', { r: 1.5 });
      box(ctx, r.u0 + r.du * 0.08, r.v0 + r.dv * 0.05, r.u0 + r.du * 0.22, r.v0 + r.dv * 0.24, 0.48, 0.92, '#2E3440', { r: 1.5 });
      ell(ctx, r.u0 + r.du * 0.15, r.v0 + r.dv * 0.14, 0.06, 0.925, 'rgba(255,255,255,0.25)');
      box(ctx, r.u0 + r.du * 0.30, r.v0 + r.dv * 0.08, r.u0 + r.du * 0.38, r.v0 + r.dv * 0.20, 0.48, 0.74, '#C7C2B5', { r: 1.5 });
      // long wood table
      const tv0 = r.v0 + r.dv * 0.36, tv1 = r.v0 + r.dv * 0.66;
      legs(ctx, { u0: r.u0 + MU * 0.1, v0: tv0, u1: r.u1 - MU * 0.1, v1: tv1 }, 0.68, sh(WOOD, 0.62));
      box(ctx, r.u0 + MU * 0.1, tv0, r.u1 - MU * 0.1, tv1, 0.68, 0.75, WOOD, { r: 1.5 });
      woodGrain(ctx, r.u0 + MU * 0.1, tv0, r.u1 - MU * 0.1, tv1, 0.75, 6);
      ell(ctx, r.cu + MU * 0.5, (tv0 + tv1) / 2, 0.12, 0.755, '#A8442F');
      // stools in front
      for (let i = 0; i < 3; i++) cubeStool(ctx, r.u0 + r.du * (0.2 + 0.3 * i), r.v0 + r.dv * 0.86, 0.5);
    });
    // cafe: rug + round table + lounge chairs
    add(R[23].cu - 0.03, R[23].cv - 0.03, () => {
      const r = R[23];
      const mu0 = r.cu - MU * 1.85, mv0 = r.cv - MV * 1.5, mu1 = r.cu + MU * 1.85, mv1 = r.cv + MV * 1.55;
      poly(ctx, [P(mu0, mv0), P(mu1, mv0), P(mu1, mv1), P(mu0, mv1)], 'rgba(148,160,178,0.55)');
      poly(ctx, [P(mu0 + MU * 0.12, mv0 + MV * 0.12), P(mu1 - MU * 0.12, mv0 + MV * 0.12), P(mu1 - MU * 0.12, mv1 - MV * 0.12), P(mu0 + MU * 0.12, mv1 - MV * 0.12)], null, 'rgba(255,255,255,0.35)', 1.2);
    }, true);
    add(R[23].cu - 0.028, R[23].cv + 0.012, () => loungeChair(ctx, R[23].cu - MU * 1.15, R[23].cv + MV * 0.25, 'u-'));
    add(R[23].cu - 0.015, R[23].cv - 0.045, () => loungeChair(ctx, R[23].cu + MU * 0.1, R[23].cv - MV * 1.1, 'v-'));
    add(R[23].cu, R[23].cv, () => {
      const r = R[23];
      const rad = Math.min(r.du / MU, r.dv / MV) * 0.44;
      ell(ctx, r.cu, r.cv, rad * 1.15, 0.002, 'rgba(60,52,40,0.22)');
      // pedestal
      box(ctx, r.cu - MU * 0.07, r.cv - MV * 0.07, r.cu + MU * 0.07, r.cv + MV * 0.07, 0, 0.68, sh(WOOD, 0.62));
      // top disc
      const c0 = P(r.cu, r.cv, 0.68), c1 = P(r.cu, r.cv, 0.74);
      const rx = rad * MU * U.x;
      ctx.fillStyle = sh(WOOD, 0.82);
      ctx.beginPath(); ctx.ellipse(c0[0], c0[1], rx, rx / 2, 0, 0, Math.PI); ctx.lineTo(c1[0] - rx, c1[1]); ctx.ellipse(c1[0], c1[1], rx, rx / 2, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
      const g = ctx.createLinearGradient(c1[0] - rx, c1[1], c1[0] + rx, c1[1]);
      g.addColorStop(0, sh(WOOD, 1.14)); g.addColorStop(1, sh(WOOD, 0.96));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(c1[0], c1[1], rx, rx / 2, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,250,235,0.25)'; ctx.beginPath(); ctx.ellipse(c1[0] - rx * 0.3, c1[1] - rx * 0.12, rx * 0.4, rx * 0.16, -0.3, 0, 7); ctx.fill();
      mug(ctx, r.cu - MU * 0.12, r.cv, '#A8442F');
    });
    add(R[23].cu + 0.028, R[23].cv + 0.04, () => loungeChair(ctx, R[23].cu + MU * 1.0, R[23].cv + MV * 0.9, 'u+'));
    // phone booth interior
    add(R[24].cu + 0.01, R[24].cv + 0.04, () => {
      const bc = { u: (R[24].u0 + R[26].u1) / 2, v: (R[24].v1 + 0.06 + R[24].v1) / 2 };
      ctx.save(); ctx.filter = 'blur(7px)';
      ell(ctx, R[24].cu, R[24].v1 + MV * 0.6, 0.75, 0.003, 'rgba(255,238,205,0.22)');
      ctx.restore();
      cubeStool(ctx, R[24].cu, R[24].v1 + MV * 0.55, 0.48);
      // acoustic panel
      box(ctx, R[24].u1 - MU * 0.5, R[24].v1 + MV * 0.15, R[24].u1 - MU * 0.1, R[24].v1 + MV * 0.5, 0, 0.92, '#3D4C6D', { r: 1.5 });
    });
    // plants
    PLANTS.forEach(([x, y, s]) => { const q = uvOf(x, y); add(q.u, q.v, () => plant(ctx, x, y, s)); });

    items.sort((a, b) => a.d - b.d).forEach(it => {
      if (cap) ctx = it.flat ? cap.background() : cap.layer(it.name);
      it.fn();
    });

    // FRONT glass (after contents)
    const frontGlass = [['glass-board-a', R[6]], ['glass-board-b', R[7]], ['glass-meet-a', R[15]], ['glass-meet-b', R[16]], ['glass-booth', R[26]]];
    for (const [gname, gr] of frontGlass) {
      if (cap) ctx = cap.layer(gname);
      glassWall(ctx, gr); // door gap preserved
    }

    if (!cap) applyGrade(ctx.canvas, opts.grain);

    // ---- QA overlay ----
    if (!cap && opts.overlay) {
      ctx.lineWidth = 1.5;
      OB.forEach(p => {
        ctx.strokeStyle = '#2E7BFF'; ctx.fillStyle = 'rgba(46,123,255,0.10)';
        ctx.beginPath(); ctx.moveTo(p[0][0] * W, p[0][1] * H);
        p.slice(1).forEach(q => ctx.lineTo(q[0] * W, q[1] * H)); ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(176,74,62,0.9)';
      const wa = [[0.4085, 0.1762], [0.9362, 0.6451], [0.5915, 0.9513], [0.0638, 0.4825]];
      ctx.beginPath(); ctx.moveTo(wa[0][0] * W, wa[0][1] * H); wa.slice(1).forEach(q => ctx.lineTo(q[0] * W, q[1] * H)); ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      SEATS.forEach(([x, y]) => { ctx.fillStyle = '#B04A3E'; ctx.beginPath(); ctx.arc(x * W, y * H, 4, 0, 7); ctx.fill(); });
    }
    if (!cap) ctx.restore();
  }

  /** 톤 그레이드(소프트라이트) + 비네트 — 콘텐츠 알파 마스크 적용(투명 영역 오염 방지). */
  function applyGrade(canvas, grain) {
    const Wp = canvas.width, Hp = canvas.height;
    const mk = () => { const c = document.createElement('canvas'); c.width = Wp; c.height = Hp; return c; };
    const cx2 = canvas.getContext('2d');
    // soft-light 톤
    const gcan = mk(); const gx = gcan.getContext('2d');
    const lg = gx.createLinearGradient(0, 0, Wp, Hp);
    lg.addColorStop(0, 'rgba(255,238,208,0.34)'); lg.addColorStop(1, 'rgba(50,68,102,0.30)');
    gx.fillStyle = lg; gx.fillRect(0, 0, Wp, Hp);
    gx.globalCompositeOperation = 'destination-in'; gx.drawImage(canvas, 0, 0);
    cx2.save(); cx2.setTransform(1, 0, 0, 1, 0, 0); cx2.globalCompositeOperation = 'soft-light'; cx2.drawImage(gcan, 0, 0); cx2.restore();
    // 비네트
    const vcan = mk(); const vx = vcan.getContext('2d');
    const vg = vx.createRadialGradient(Wp / 2, Hp / 2, Hp * 0.35, Wp / 2, Hp / 2, Hp * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(80,68,50,0.08)');
    vx.fillStyle = vg; vx.fillRect(0, 0, Wp, Hp);
    vx.globalCompositeOperation = 'destination-in'; vx.drawImage(canvas, 0, 0);
    cx2.save(); cx2.setTransform(1, 0, 0, 1, 0, 0); cx2.drawImage(vcan, 0, 0); cx2.restore();
    // 그레인(배경 전용 권장)
    if (grain) {
      const nc = mk(); nc.width = nc.height = 160;
      const nx = nc.getContext('2d'); const id = nx.createImageData(160, 160);
      for (let i = 0; i < id.data.length; i += 4) { const v = 118 + Math.random() * 20 | 0; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      nx.putImageData(id, 0, 0);
      cx2.save(); cx2.setTransform(1, 0, 0, 1, 0, 0); cx2.globalAlpha = 0.05; cx2.globalCompositeOperation = 'overlay';
      cx2.fillStyle = cx2.createPattern(nc, 'repeat'); cx2.fillRect(0, 0, Wp, Hp); cx2.restore();
    }
  }

  /** 레이어 캡처: 배경 1장 + 입체 가구/전면유리 스프라이트 캔버스 목록 반환. */
  window.renderHorizonLayers = function () {
    const layers = [];
    let bg = null;
    const mkLayer = (name) => {
      const c = document.createElement('canvas');
      c.width = W * SS; c.height = H * SS;
      const x = c.getContext('2d');
      x.setTransform(SS, 0, 0, SS, 0, 0);
      layers.push({ name, canvas: c });
      return x;
    };
    const cap = {
      background() {
        if (!bg) bg = mkLayer('background');
        return bg;
      },
      layer(name) {
        return mkLayer(name);
      },
    };
    drawScene(null, { capture: cap, grain: false, overlay: false });
    for (const L of layers) applyGrade(L.canvas, false);
    return layers;
  };

  class HorizonScene extends HTMLElement {
    static get observedAttributes() { return ['overlay', 'grain']; }
    connectedCallback() {
      if (!this.canvas) {
        this.style.display = 'block';
        this.canvas = document.createElement('canvas');
        this.canvas.width = W * SS; this.canvas.height = H * SS;
        this.canvas.style.cssText = 'display:block;width:100%;height:auto;';
        this.appendChild(this.canvas);
      }
      this.render();
    }
    attributeChangedCallback() { if (this.canvas) this.render(); }
    render() {
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(SS, 0, 0, SS, 0, 0);
      drawScene(ctx, {
        overlay: this.getAttribute('overlay') === 'true',
        grain: this.getAttribute('grain') !== 'false'
      });
    }
  }
  if (!customElements.get('horizon-scene')) customElements.define('horizon-scene', HorizonScene);
})();
