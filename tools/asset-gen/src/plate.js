/**
 * plate.js — 오픈 플랜 베이스 씬 (시안 §1 "오픈 플랜 베이스" + §2 공간 모듈 6종).
 *
 * 모듈: Reception / Workstation×2 / Meeting(보드룸+글라스룸) / Lounge / Pantry / Phone Booth.
 * 지오메트리(보행·방·장애물·스폰)를 그림과 같은 소스에서 산출 — buildPlate()가
 * {svg, geometry}를 반환한다. geometry는 정규(0~1) 스크린 좌표.
 */

'use strict';

const { W, H, iso, PAL, Svg, prism, shade, woodPrism, colorPrism, dropShadow } = require('./core');

const norm = (p) => ({ x: +(p.x / W).toFixed(4), y: +(p.y / H).toFixed(4) });
const quadN = (u0, v0, u1, v1) => [iso(u0, v0), iso(u1, v0), iso(u1, v1), iso(u0, v1)].map(norm);

// 방 크기 (월드 m)
const FLOOR_U = 18;
const FLOOR_V = 12;
const WALL_H = 2.55;

// ── 가구 유닛 ────────────────────────────────────────────────────────────────

function chair(g, u, v, facing = 's') {
  // 오피스 태스크 체어: 스타베이스 + 기둥 + 시트 쿠션 + 등받이(방향별)
  const cx = u + 0.25;
  const cyv = v + 0.25;
  const base = iso(cx, cyv, 0);
  g.ellipse(base.x, base.y + 2, 0.36 * 51, 0.17 * 51, g.softShadowFill());
  g.ellipse(base.x, base.y, 0.26 * 51, 0.115 * 51, '#33373E'); // 스타베이스
  g.ellipse(base.x, base.y - 1.5, 0.19 * 51, 0.083 * 51, '#4E545E');
  g.line(iso(cx, cyv, 0.03), iso(cx, cyv, 0.3), '#3A3E46', 4); // 가스리프트 기둥
  // 시트 쿠션(도톰·밝은 톤) + 상면 하이라이트
  colorPrism(g, u, v, 0.5, 0.5, 0.15, '#61686F', { z0: 0.31, noShadow: true });
  const sc = iso(cx, cyv, 0.46);
  g.ellipse(sc.x - 3, sc.y - 1, 0.15 * 51, 0.065 * 51, 'rgba(255,255,255,0.2)');
  // 등받이(하이백 + 요추 스티치 라인)
  const b = 0.11;
  const back = (bu, bv, bw, bd) => {
    colorPrism(g, bu, bv, bw, bd, 0.62, PAL.charcoalD, { z0: 0.44, noShadow: true });
    const m0 = iso(bu + bw / 2, bv + bd, 0.6);
    const m1 = iso(bu + bw / 2, bv + bd, 0.94);
    g.line(m0, m1, 'rgba(255,255,255,0.14)', 2);
  };
  if (facing === 's') back(u + 0.01, v, 0.48, b);
  if (facing === 'n') back(u + 0.01, v + 0.5 - b, 0.48, b);
  if (facing === 'e') back(u, v + 0.01, b, 0.48);
  if (facing === 'w') back(u + 0.5 - b, v + 0.01, b, 0.48);
}

function monitor(g, u, v, wide = 0.62, deskTop = 0.72) {
  // 책상 상판(z=deskTop) 위에서 시작 — z0 없이 그리면 바닥부터 그려져 화면상 우하단으로 밀려 보인다.
  colorPrism(g, u, v, wide, 0.06, 0.42, '#3A4350', { z0: deskTop, noShadow: true });
  // 화면 글로우(SW면 위에 얹기)
  const a = iso(u, v + 0.06, deskTop + 0.40);
  const b = iso(u + wide, v + 0.06, deskTop + 0.40);
  const c = iso(u + wide, v + 0.06, deskTop + 0.12);
  const d = iso(u, v + 0.06, deskTop + 0.12);
  g.poly([a, b, c, d], PAL.screenGlow, { opacity: 0.85 });
}

function desk(g, u, v, w = 1.7, d = 0.8) {
  // 다리 4개 + 모데스티 패널(북측 가림판) + 얇은 상판 — 상판 윗면은 기존 계약대로 z=0.72.
  dropShadow(g, u, v, w, d);
  const legW = 0.08;
  for (const [lu, lv] of [
    [u + 0.06, v + 0.06],
    [u + w - 0.14, v + 0.06],
    [u + 0.06, v + d - 0.14],
    [u + w - 0.14, v + d - 0.14],
  ]) {
    colorPrism(g, lu, lv, legW, legW, 0.63, '#8A6F4D', { noShadow: true, flat: true });
  }
  // 모데스티 패널 — 데스크가 워크스테이션으로 읽히게 시각적 무게 부여
  colorPrism(g, u + 0.1, v + 0.28, w - 0.2, 0.07, 0.5, '#B99A73', { z0: 0.1, noShadow: true });
  woodPrism(g, u, v, w, d, 0.09, { z0: 0.63, noShadow: true });
  return { u, v, w, d };
}

/** 데스크 위 소품(키보드·마우스·머그·서류) — variant로 배치 변형. */
function deskProps(g, u, v, variant = 0) {
  const TOP = 0.72;
  // 키보드(모니터 앞) + 마우스
  colorPrism(g, u + 0.56, v + 0.5, 0.44, 0.15, 0.025, '#DAD7CE', { z0: TOP, noShadow: true, flat: true });
  const mouse = iso(u + 1.12, v + 0.56, TOP + 0.02);
  g.ellipse(mouse.x, mouse.y, 3.4, 2.2, '#C9C5BA');
  if (variant % 2 === 0) {
    // 머그(몸통 + 림 + 커피)
    const m = iso(u + 1.42, v + 0.28, TOP);
    const mugCol = variant % 4 === 0 ? '#B04A3E' : '#33415E';
    g.raw(`<rect x="${(m.x - 3.6).toFixed(1)}" y="${(m.y - 8).toFixed(1)}" width="7.2" height="7" rx="1.5" fill="${mugCol}"/>`);
    g.ellipse(m.x, m.y - 8, 3.6, 1.9, shade(mugCol, 1.18));
    g.ellipse(m.x, m.y - 8, 2.5, 1.25, '#3A2A1A');
  } else {
    // 서류 뭉치
    const p0 = iso(u + 0.16, v + 0.2, TOP + 0.015);
    const p1 = iso(u + 0.48, v + 0.2, TOP + 0.015);
    const p2 = iso(u + 0.48, v + 0.45, TOP + 0.015);
    const p3 = iso(u + 0.16, v + 0.45, TOP + 0.015);
    g.poly([p0, p1, p2, p3], '#F6F3EA', { stroke: 'rgba(70,62,50,0.25)', sw: 0.8 });
    g.line({ x: (p0.x + p3.x) / 2 + 2, y: (p0.y + p3.y) / 2 }, { x: (p1.x + p2.x) / 2 - 2, y: (p1.y + p2.y) / 2 }, 'rgba(70,62,50,0.18)', 0.8);
  }
}

/** 워크스테이션 클러스터: 2×2 데스크 등맞댐 + 모니터 + 의자 4. */
function workCluster(g, u, v) {
  // 모니터를 데스크(1.7×0.8) 상판 정중앙에 — u: (1.7-0.62)/2, v: (0.8-0.06)/2
  const MU = (1.7 - 0.62) / 2;
  const MV = (0.8 - 0.06) / 2;
  // 북쪽 열(모니터 남향, 의자 남쪽)
  desk(g, u, v, 1.7, 0.8);
  desk(g, u + 1.8, v, 1.7, 0.8);
  monitor(g, u + MU, v + MV);
  monitor(g, u + 1.8 + MU, v + MV);
  deskProps(g, u, v, 0);
  deskProps(g, u + 1.8, v, 1);
  chair(g, u + 0.6, v + 1.0, 's');
  chair(g, u + 2.4, v + 1.0, 's');
  // 남쪽 열(북향)
  desk(g, u, v + 1.75, 1.7, 0.8);
  desk(g, u + 1.8, v + 1.75, 1.7, 0.8);
  monitor(g, u + MU, v + 1.75 + MV);
  monitor(g, u + 1.8 + MU, v + 1.75 + MV);
  deskProps(g, u, v + 1.75, 2);
  deskProps(g, u + 1.8, v + 1.75, 3);
  chair(g, u + 0.6, v + 2.85, 'n');
  chair(g, u + 2.4, v + 2.85, 'n');
  // 좌석 앵커(의자 중심, 정규 스크린 좌표) — DB seat 시드의 단일 소스(시안 §6).
  const seatAt = (cu, cv) => norm(iso(cu + 0.25, cv + 0.25));
  const seats = [
    seatAt(u + 0.6, v + 1.0),
    seatAt(u + 2.4, v + 1.0),
    seatAt(u + 0.6, v + 2.85),
    seatAt(u + 2.4, v + 2.85),
  ];
  // 충돌은 책상 단위 4개 — 클러스터 전체 bbox로 잡으면 책상 사이 통로(의자 열)가
  // 화면상 비어 보이는데도 전부 이동 불가가 된다. 의자는 보행 가능(좌석 접근 경로).
  const M = 0.05;
  const obstacles = [
    quadN(u - M, v - M, u + 1.7 + M, v + 0.8 + M),
    quadN(u + 1.8 - M, v - M, u + 3.5 + M, v + 0.8 + M),
    quadN(u - M, v + 1.75 - M, u + 1.7 + M, v + 2.55 + M),
    quadN(u + 1.8 - M, v + 1.75 - M, u + 3.5 + M, v + 2.55 + M),
  ];
  return { u: u - 0.15, v: v - 0.15, w: 3.8, d: 3.6, seats, obstacles };
}

function sofa(g, u, v, w, d, dir = 's') {
  colorPrism(g, u, v, w, d, 0.5, PAL.navy); // 베이스
  if (dir === 's') colorPrism(g, u, v, w, 0.22, 0.95, PAL.navyDark, { noShadow: true });
  if (dir === 'n') colorPrism(g, u, v + d - 0.22, w, 0.22, 0.95, PAL.navyDark, { noShadow: true });
  if (dir === 'e') colorPrism(g, u, v, 0.22, d, 0.95, PAL.navyDark, { noShadow: true });
  if (dir === 'w') colorPrism(g, u + w - 0.22, v, 0.22, d, 0.95, PAL.navyDark, { noShadow: true });
  // 팔걸이
  if (dir === 's' || dir === 'n') {
    colorPrism(g, u, v, 0.22, d, 0.72, PAL.navyLight, { noShadow: true });
    colorPrism(g, u + w - 0.22, v, 0.22, d, 0.72, PAL.navyLight, { noShadow: true });
    // 좌면 쿠션 분할선 + 하이라이트(패브릭 질감)
    const seatV = dir === 's' ? v + 0.28 : v + 0.06;
    const seatD = d - 0.34;
    const n = Math.max(2, Math.round((w - 0.44) / 1.0));
    for (let i = 1; i < n; i++) {
      const cu = u + 0.22 + ((w - 0.44) * i) / n;
      g.line(iso(cu, seatV, 0.5), iso(cu, seatV + seatD, 0.5), 'rgba(15,22,38,0.45)', 1.5);
    }
    for (let i = 0; i < n; i++) {
      const cu = u + 0.22 + ((w - 0.44) * (i + 0.5)) / n;
      const hc = iso(cu, seatV + seatD / 2, 0.52);
      g.ellipse(hc.x, hc.y, 0.26 * 51, 0.09 * 51, 'rgba(255,255,255,0.07)');
    }
  }
}

function plant(g, u, v, s = 1) {
  prism(g, u, v, 0.5 * s, 0.5 * s, 0.45 * s, { top: shade(PAL.pot, 1.1), left: PAL.pot, right: shade(PAL.pot, 0.82) });
  const c = iso(u + 0.25 * s, v + 0.25 * s, 0.45 * s);
  // 흙 + 화분 림
  g.ellipse(c.x, c.y, 10.5 * s, 5 * s, '#5A4633');
  // 잎 클러스터(뒤 어두운 톤 → 앞 밝은 톤, 하이라이트)
  g.ellipse(c.x - 10 * s, c.y - 14 * s, 13 * s, 17 * s, shade(PAL.plantD, 0.9));
  g.ellipse(c.x + 11 * s, c.y - 12 * s, 12 * s, 16 * s, PAL.plantD);
  g.ellipse(c.x + 6 * s, c.y - 26 * s, 14 * s, 19 * s, PAL.plant);
  g.ellipse(c.x - 6 * s, c.y - 30 * s, 12 * s, 17 * s, shade(PAL.plant, 1.1));
  g.ellipse(c.x - 10 * s, c.y - 34 * s, 5 * s, 7 * s, 'rgba(255,255,255,0.18)');
  // 줄기 힌트
  g.line({ x: c.x, y: c.y - 2 * s }, { x: c.x - 3 * s, y: c.y - 18 * s }, '#4C6B3F', 1.6 * s);
  g.line({ x: c.x, y: c.y - 2 * s }, { x: c.x + 5 * s, y: c.y - 14 * s }, '#4C6B3F', 1.4 * s);
}

/** 유리벽 패널: (u0,v0)→(u1,v1) 세그먼트, 높이 h. 그라데이션 + 멀리언 + 사선 반사. */
function glassPanel(g, u0, v0, u1, v1, h = 2.2) {
  const a = iso(u0, v0, h);
  const b = iso(u1, v1, h);
  const c = iso(u1, v1, 0);
  const d = iso(u0, v0, 0);
  const fill = g.gradient('rgba(196,224,240,0.52)', 'rgba(178,212,232,0.14)', 'v');
  g.poly([a, b, c, d], fill, { stroke: PAL.glassEdge, sw: 1.5 });
  // 사선 반사 스트릭
  const len = Math.hypot(u1 - u0, v1 - v0);
  if (len > 0.9) {
    const t1 = 0.18;
    const t2 = 0.34;
    const p = (t, z) => iso(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, z);
    g.poly([p(t1, h * 0.92), p(t2, h * 0.92), p(t2 - 0.1, h * 0.1), p(t1 - 0.1, h * 0.1)], 'rgba(255,255,255,0.16)');
  }
  // 멀리언(세로 프레임 분할)
  const div = Math.max(1, Math.round(len / 1.2));
  for (let i = 1; i < div; i++) {
    const t = i / div;
    g.line(iso(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, h - 0.05), iso(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, 0), PAL.glassEdge, 1.4);
  }
  // 상·하단 프레임
  const a2 = iso(u0, v0, h - 0.07);
  const b2 = iso(u1, v1, h - 0.07);
  g.poly([a, b, b2, a2], '#8FA8BA');
  const c2 = iso(u1, v1, 0.06);
  const d2 = iso(u0, v0, 0.06);
  g.poly([d2, c2, c, d], '#8FA8BA');
}

// ── 씬 조립 ──────────────────────────────────────────────────────────────────

function buildPlate() {
  const g = new Svg();
  const geom = { walkArea: [], rooms: [], obstacles: [], spawns: {}, meetingZones: [], seats: [] };

  // 배경
  g.raw(`<rect width="${W}" height="${H}" fill="${PAL.bg}"/>`);

  // 바닥
  const F = [iso(0, 0), iso(FLOOR_U, 0), iso(FLOOR_U, FLOOR_V), iso(0, FLOOR_V)];
  g.poly(F, PAL.floor, { stroke: PAL.floorLine, sw: 2 });
  // 투톤 타일(2×2 체커, 저대비) — 재질감
  for (let tu = 0; tu < FLOOR_U; tu += 2) {
    for (let tv = 0; tv < FLOOR_V; tv += 2) {
      if (((tu + tv) / 2) % 2 === 0) continue;
      g.poly([iso(tu, tv), iso(tu + 2, tv), iso(tu + 2, tv + 2), iso(tu, tv + 2)], 'rgba(120,105,80,0.045)');
    }
  }
  // 타일 라인
  for (let u = 1; u < FLOOR_U; u++) g.poly([iso(u, 0), iso(u, FLOOR_V)], 'none', { stroke: PAL.floorLine, sw: 1 });
  for (let v = 1; v < FLOOR_V; v++) g.poly([iso(0, v), iso(FLOOR_U, v)], 'none', { stroke: PAL.floorLine, sw: 1 });

  // 러그(보더 + 이너 톤)
  const rug = (u0, v0, u1, v1, base, opacity) => {
    g.poly([iso(u0, v0), iso(u1, v0), iso(u1, v1), iso(u0, v1)], base, { opacity });
    g.poly([iso(u0 + 0.15, v0 + 0.15), iso(u1 - 0.15, v0 + 0.15), iso(u1 - 0.15, v1 - 0.15), iso(u0 + 0.15, v1 - 0.15)], 'none', {
      stroke: 'rgba(255,255,255,0.35)',
      sw: 1.2,
    });
  };
  rug(6.6, 0.6, 10.9, 3.4, PAL.rugSand, 0.75);
  rug(1.0, 9.0, 4.0, 11.6, PAL.rugNavy, 0.5);

  // ── 벽 (북서 u=0, 북동 v=0) ──
  // 창문(하늘 그라데이션 + 멀리언 + 창턱)
  const skyFill = () => g.gradient('#D9EBF7', '#B7D4E8', 'v');
  const windowOn = (isoAt, s0, s1) => {
    const wa = isoAt(s0, 2.15);
    const wb = isoAt(s1, 2.15);
    const wc = isoAt(s1, 0.85);
    const wd = isoAt(s0, 0.85);
    g.poly([wa, wb, wc, wd], skyFill(), { stroke: PAL.windowFrame, sw: 2.5 });
    // 구름 힌트
    const mx = (wa.x + wc.x) / 2;
    const my = (wa.y + wc.y) / 2;
    g.ellipse(mx - 12, my - 8, 11, 3.5, 'rgba(255,255,255,0.55)');
    g.ellipse(mx + 10, my + 2, 8, 2.8, 'rgba(255,255,255,0.4)');
    // 멀리언(중앙 분할) + 창턱
    const t = 0.5;
    g.line(isoAt(s0 + (s1 - s0) * t, 2.15), isoAt(s0 + (s1 - s0) * t, 0.85), PAL.windowFrame, 2);
    g.line(isoAt(s0, 1.5), isoAt(s1, 1.5), PAL.windowFrame, 1.5);
    g.line(isoAt(s0 - 0.05, 0.82), isoAt(s1 + 0.05, 0.82), '#FFFFFF', 3);
  };
  // 북서벽(좌): v 0→12
  {
    const a = iso(0, 0, WALL_H), b = iso(0, FLOOR_V, WALL_H), c = iso(0, FLOOR_V, 0), d = iso(0, 0, 0);
    g.poly([a, b, c, d], g.gradient('#F8F5EF', '#EAE5DA', 'v'), { stroke: PAL.outline, sw: 1 });
    for (const [v0, v1] of [[1.2, 3.6], [4.8, 7.2], [8.4, 10.8]]) {
      windowOn((s, z) => iso(0, s, z), v0, v1);
    }
    // 월아트 액자 2점(창 사이)
    for (const [av, aw, col] of [[4.05, 0.5, '#B04A3E'], [7.65, 0.55, '#3D4A66']]) {
      const fa = iso(0, av, 1.95), fb = iso(0, av + aw, 1.95), fc = iso(0, av + aw, 1.3), fd = iso(0, av, 1.3);
      g.poly([fa, fb, fc, fd], '#F4F1E8', { stroke: '#8A7A5E', sw: 2 });
      const ia = iso(0, av + 0.08, 1.85), ib = iso(0, av + aw - 0.08, 1.85), ic = iso(0, av + aw - 0.08, 1.4), id2 = iso(0, av + 0.08, 1.4);
      g.poly([ia, ib, ic, id2], col, { opacity: 0.75 });
    }
  }
  // 북동벽(우): u 0→18
  {
    const a = iso(0, 0, WALL_H), b = iso(FLOOR_U, 0, WALL_H), c = iso(FLOOR_U, 0, 0), d = iso(0, 0, 0);
    g.poly([a, b, c, d], g.gradient('#EBE6DB', '#DDD7CA', 'v'), { stroke: PAL.outline, sw: 1 });
    for (const [u0, u1] of [[6.6, 9.4], [10.2, 11.6]]) {
      windowOn((s, z) => iso(s, 0, z), u0, u1);
    }
    // 리셉션 브랜드 월(우드 패널 + 로고)
    const p0 = 1.4, p1 = 5.6;
    const ba = iso(p0, 0, 2.3), bb = iso(p1, 0, 2.3), bc = iso(p1, 0, 0), bd = iso(p0, 0, 0);
    g.poly([ba, bb, bc, bd], PAL.wood, { stroke: PAL.outline, sw: 1 });
    // 벽면(NE, v=0)은 화면에서 x+1 당 y+0.5 기울기 — translate 후 skewY로 벽에 밀착
    const mid = iso(3.5, 0, 1.5);
    g.raw(`<g transform="translate(${mid.x.toFixed(1)},${mid.y.toFixed(1)}) skewY(26.57)">` +
      `<text x="0" y="0" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="${PAL.white}" text-anchor="middle" letter-spacing="7">HORIZON</text></g>`);
    // 보드룸 TV
    const t0 = 13.4, t1 = 15.9;
    const ta = iso(t0, 0, 2.05), tb = iso(t1, 0, 2.05), tc = iso(t1, 0, 1.0), td = iso(t0, 0, 1.0);
    g.poly([ta, tb, tc, td], PAL.screen, { stroke: '#222', sw: 2 });
  }

  // 걸레받이
  g.poly([iso(0, 0, 0.16), iso(0, FLOOR_V, 0.16), iso(0, FLOOR_V, 0), iso(0, 0, 0)], PAL.baseboard);
  g.poly([iso(0, 0, 0.16), iso(FLOOR_U, 0, 0.16), iso(FLOOR_U, 0, 0), iso(0, 0, 0)], shade(PAL.baseboard, 0.92));

  // ── Reception (u 1.5~5.5, v 0.4~3) ──
  colorPrism(g, 2.15, 1.05, 2.7, 0.95, 1.0, '#E9E5DA'); // 카운터 본체(화이트)
  woodPrism(g, 2.08, 1.92, 2.84, 0.14, 1.06); // 우드 전면 패널
  plant(g, 1.0, 0.5, 0.9);
  plant(g, 5.0, 0.6, 0.9);
  geom.rooms.push({ id: 'reception', label: 'Reception', polygon: quadN(1.2, 0.2, 5.8, 3.2) });
  geom.obstacles.push(quadN(2.1, 1.0, 4.9, 2.05)); // 데스크

  // ── Lounge (u 6.6~10.9, v 0.5~3.4) ──
  sofa(g, 6.9, 0.8, 2.4, 1.0, 's');
  sofa(g, 6.9, 2.5, 2.4, 0.9, 'n');
  woodPrism(g, 9.7, 1.6, 1.0, 0.8, 0.42); // 커피 테이블
  plant(g, 10.4, 0.5, 0.8);
  geom.rooms.push({ id: 'lounge', label: 'Lounge', polygon: quadN(6.5, 0.3, 11.0, 3.5) });
  geom.obstacles.push(quadN(6.8, 0.7, 9.4, 1.9)); // 소파 북
  geom.obstacles.push(quadN(6.8, 2.4, 9.4, 3.5)); // 소파 남
  geom.obstacles.push(quadN(9.6, 1.5, 10.8, 2.5)); // 테이블

  // ── Boardroom (유리, u 12~17.4, v 0.3~4.4) ──
  g.poly([iso(12.5, 0.6), iso(17.1, 0.6), iso(17.1, 4.0), iso(12.5, 4.0)], '#D6D0C2', { opacity: 0.8 }); // 러그
  woodPrism(g, 13.1, 1.4, 3.4, 1.3, 0.75); // 롱테이블
  for (let i = 0; i < 4; i++) chair(g, 13.3 + i * 0.85, 0.65, 's');
  for (let i = 0; i < 4; i++) chair(g, 13.3 + i * 0.85, 2.95, 'n');
  // 유리벽: 좌측(u=12, v 0.3→4.4) + 전면(v=4.4, u 12→17.4, 문 15.2~16.2 개방)
  glassPanel(g, 12, 0.3, 12, 4.4);
  glassPanel(g, 12, 4.4, 15.0, 4.4);
  glassPanel(g, 16.2, 4.4, 17.4, 4.4);
  geom.rooms.push({ id: 'boardroom', label: 'Board Room', polygon: quadN(12.1, 0.2, 17.4, 4.4) });
  geom.meetingZones.push({ roomId: 'boardroom', polygon: quadN(12.1, 0.2, 17.4, 4.4), capacity: 8 });
  geom.obstacles.push(quadN(13.0, 1.3, 16.6, 2.8)); // 테이블
  geom.obstacles.push(quadN(11.9, 0.2, 12.15, 4.4)); // 유리 좌
  geom.obstacles.push(quadN(12.0, 4.3, 15.0, 4.5)); // 유리 전면(문 왼쪽)
  geom.obstacles.push(quadN(16.2, 4.3, 17.4, 4.5)); // 유리 전면(문 오른쪽)

  // ── Workstation A (u 4.5~8.3, v 4.4~8.0) ──
  const wa = workCluster(g, 4.7, 4.6);
  wa.obstacles.forEach((o) => geom.obstacles.push(o));
  wa.seats.forEach((p, i) => geom.seats.push({ seatNumber: `WS-A${i + 1}`, x: p.x, y: p.y }));

  // ── Glass meeting 4인 (u 13.2~16.8, v 6.2~9.2) ──
  woodPrism(g, 14.2, 7.0, 1.6, 1.3, 0.75);
  chair(g, 14.5, 6.3, 's');
  chair(g, 15.2, 6.3, 's');
  chair(g, 14.5, 8.45, 'n');
  chair(g, 15.2, 8.45, 'n');
  glassPanel(g, 13.2, 6.2, 16.8, 6.2); // 북면
  glassPanel(g, 13.2, 6.2, 13.2, 9.2); // 좌면
  glassPanel(g, 13.2, 9.2, 14.4, 9.2); // 전면 좌(문 14.4~15.6 개방)
  glassPanel(g, 15.6, 9.2, 16.8, 9.2);
  geom.rooms.push({ id: 'meeting-a', label: 'Meeting Room', polygon: quadN(13.2, 6.2, 16.8, 9.2) });
  geom.meetingZones.push({ roomId: 'meeting-a', polygon: quadN(13.2, 6.2, 16.8, 9.2), capacity: 4 });
  geom.obstacles.push(quadN(14.1, 6.9, 15.9, 8.4)); // 테이블
  geom.obstacles.push(quadN(13.1, 6.1, 16.9, 6.35)); // 유리 북
  geom.obstacles.push(quadN(13.1, 6.2, 13.35, 9.2)); // 유리 좌
  geom.obstacles.push(quadN(13.2, 9.1, 14.4, 9.35)); // 유리 전면 좌
  geom.obstacles.push(quadN(15.6, 9.1, 16.8, 9.35)); // 유리 전면 우

  // ── Pantry (u 0.6~3.8, v 5.4~8.6) ──
  colorPrism(g, 1.2, 6.0, 2.2, 0.9, 0.95, '#DDD8CC'); // 아일랜드
  woodPrism(g, 1.2, 6.0, 2.2, 0.9, 1.0 - 0.955); // 상판 살짝
  for (let i = 0; i < 3; i++) colorPrism(g, 1.45 + i * 0.7, 7.15, 0.42, 0.42, 0.62, PAL.wood); // 스툴
  colorPrism(g, 0.15, 5.6, 0.35, 2.4, 1.9, '#C9C2B2'); // 벽선반
  geom.rooms.push({ id: 'pantry', label: 'Pantry', polygon: quadN(0.4, 5.3, 4.0, 8.8) });
  geom.obstacles.push(quadN(1.1, 5.9, 3.5, 7.7)); // 아일랜드+스툴
  geom.obstacles.push(quadN(0.1, 5.5, 0.6, 8.1)); // 선반

  // ── Workstation B (u 8.9~12.7, v 7.0~10.6) ──
  const wb = workCluster(g, 9.1, 7.2);
  wb.obstacles.forEach((o) => geom.obstacles.push(o));
  wb.seats.forEach((p, i) => geom.seats.push({ seatNumber: `WS-B${i + 1}`, x: p.x, y: p.y }));

  // ── Cafe (u 1.0~4.0, v 9.0~11.6) ──
  colorPrism(g, 2.5, 10.3, 0.28, 0.28, 0.7, PAL.woodDark); // 기둥
  {
    const c = iso(2.65, 10.45, 0.72);
    g.ellipse(c.x, c.y + 2, 0.9 * 51, 0.9 * 51 * 0.5, PAL.shadow); // 근사 그림자
    g.ellipse(c.x, c.y, 0.85 * 51, 0.85 * 51 * 0.5, PAL.woodTop); // 원탁 상판
    g.raw(`<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="${(0.85 * 51).toFixed(1)}" ry="${(0.85 * 51 * 0.5).toFixed(1)}" fill="none" stroke="rgba(70,62,50,0.35)"/>`);
  }
  chair(g, 1.35, 10.05, 'e');
  chair(g, 3.45, 10.05, 'w');
  chair(g, 2.35, 11.15, 'n');
  geom.rooms.push({ id: 'cafe', label: 'Cafe', polygon: quadN(0.9, 8.9, 4.2, 11.7) });
  geom.obstacles.push(quadN(2.0, 9.8, 3.3, 11.0));

  // ── Phone booth (u 16.5~17.9, v 9.9~11.7) ──
  colorPrism(g, 16.6, 10.0, 1.2, 0.15, 2.25, PAL.charcoalD); // 뒷판
  glassPanel(g, 16.6, 10.15, 16.6, 11.6, 2.25); // 좌면 유리
  glassPanel(g, 17.8, 10.15, 17.8, 11.6, 2.25); // 우면 유리
  colorPrism(g, 16.85, 10.5, 0.7, 0.45, 0.72, PAL.wood); // 내부 카운터
  geom.rooms.push({ id: 'booth', label: 'Phone Booth', polygon: quadN(16.5, 9.9, 17.9, 11.7) });
  geom.obstacles.push(quadN(16.5, 9.9, 17.9, 10.25)); // 뒷판
  geom.obstacles.push(quadN(16.45, 10.0, 16.7, 11.6)); // 좌 유리
  geom.obstacles.push(quadN(17.75, 10.0, 18.0, 11.6)); // 우 유리

  // 프리스탠딩 플랜트
  plant(g, 11.4, 4.6);
  plant(g, 0.6, 3.9, 0.9);
  plant(g, 17.3, 5.3);
  plant(g, 5.6, 10.9, 0.9);
  plant(g, 8.3, 11.2, 0.85);

  // ── 지오메트리: 보행영역·스폰 ──
  geom.walkArea = quadN(0.35, 0.35, FLOOR_U - 0.35, FLOOR_V - 0.35);
  geom.spawns = {
    lobby: norm(iso(4.2, 3.9)),
    work: norm(iso(8.6, 5.9)),
    meeting: norm(iso(15.6, 5.3)),
    cafe: norm(iso(4.8, 9.6)),
  };

  return { svg: g.toString(), geometry: geom };
}

module.exports = { buildPlate };
