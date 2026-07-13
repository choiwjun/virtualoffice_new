/**
 * core.js — 2.5D 아이소 에셋 생성기 코어 (D30, 17-asset-rework-spec).
 *
 * 원칙: 에셋(그림)과 지오메트리(충돌·방 폴리곤)를 같은 소스에서 산출 —
 * 시안 §6 "개발 메타데이터" 사상. 여기 정의된 팔레트·투영이 톤/시점 정합의 정본.
 */

'use strict';

// ── 캔버스 (17-spec: 1672:941 비율 고정) ─────────────────────────────────────
const W = 1672;
const H = 941;

// ── 아이소 투영 (2:1) ────────────────────────────────────────────────────────
// 월드: u(→ 화면 우하), v(→ 화면 좌하), z(높이). 단위 = 1m.
// 플로어 18×12m → 화면폭 (18+12)*TILE ≤ W-여백. TILE=51 → 1530px, 좌우 여백 ~71px.
const TILE = 51;
const ORIGIN = { x: 683, y: 148 }; // 방 북쪽 코너 — 플로어가 캔버스에 꽉 차게 센터링

function iso(u, v, z = 0) {
  return {
    x: ORIGIN.x + (u - v) * TILE,
    y: ORIGIN.y + (u + v) * TILE * 0.5 - z * TILE * 0.82,
  };
}

const pt = (p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
const pts = (arr) => arr.map(pt).join(' ');

// ── 팔레트 (시안 톤 — 밝은 우드 + 네이비 + 웜그레이) ────────────────────────
const PAL = {
  bg: '#EDEAE3',
  floor: '#E6E1D7',
  floorLine: '#DAD4C7',
  rugNavy: '#3D4A66',
  rugSand: '#D9CBB2',
  wallFace: '#F4F1EA',
  wallSide: '#E3DED4',
  wallTop: '#FBF9F4',
  baseboard: '#C9C2B4',
  windowGlass: '#CBE0EE',
  windowFrame: '#AEB9C2',
  wood: '#CDA97E',
  woodTop: '#DBBC93',
  woodDark: '#A9885F',
  white: '#FAFAF7',
  whiteSide: '#E8E6E0',
  navy: '#33415E',
  navyLight: '#46577A',
  navyDark: '#273248',
  charcoal: '#4A4F58',
  charcoalD: '#3A3E46',
  glass: 'rgba(178,212,232,0.38)',
  glassEdge: '#9FB6C8',
  plant: '#6FA268',
  plantDark: '#5785522',
  plantD: '#578552',
  pot: '#B9B2A4',
  screen: '#2E3A4E',
  screenGlow: '#BFD8F2',
  accent: '#2E7BFF',
  shadow: 'rgba(60,55,45,0.18)',
  outline: 'rgba(70,62,50,0.35)',
};

// ── SVG 조립 ─────────────────────────────────────────────────────────────────
class Svg {
  constructor() {
    this.parts = [];
  }
  add(s) {
    this.parts.push(s);
    return this;
  }
  poly(points, fill, opts = {}) {
    const o = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.sw ?? 1}"` : '';
    const op = opts.opacity != null ? ` opacity="${opts.opacity}"` : '';
    this.add(`<polygon points="${pts(points)}" fill="${fill}"${o}${op}/>`);
    return this;
  }
  ellipse(cx, cy, rx, ry, fill, opacity) {
    const op = opacity != null ? ` opacity="${opacity}"` : '';
    this.add(`<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx}" ry="${ry}" fill="${fill}"${op}/>`);
    return this;
  }
  text(x, y, str, size, fill, opts = {}) {
    const w = opts.weight ?? 700;
    const ls = opts.spacing ? ` letter-spacing="${opts.spacing}"` : '';
    const tr = opts.transform ? ` transform="${opts.transform}"` : '';
    this.add(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="middle"${ls}${tr}>${str}</text>`,
    );
    return this;
  }
  raw(s) {
    return this.add(s);
  }
  toString(w = W, h = H) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${this.parts.join('\n')}</svg>`;
  }
}

// ── 프리미티브 ───────────────────────────────────────────────────────────────

/** 바닥 다이아 셀 채움용 폴리곤. */
function floorQuad(u0, v0, u1, v1) {
  return [iso(u0, v0), iso(u1, v0), iso(u1, v1), iso(u0, v1)];
}

/** 그림자 (바닥 타원). */
function dropShadow(g, u, v, w, d) {
  const c = iso(u + w / 2, v + d / 2);
  g.ellipse(c.x, c.y + 3, (w + d) * TILE * 0.42, (w + d) * TILE * 0.17, PAL.shadow);
}

/**
 * 아이소 직육면체 — 상판/좌면(SW)/우면(SE) 3톤.
 * colors: {top, left, right} 미지정 시 base에서 파생.
 */
function prism(g, u, v, w, d, h, colors, opts = {}) {
  const { top, left, right } = colors;
  const A = iso(u, v, h); // 북
  const B = iso(u + w, v, h); // 동
  const C = iso(u + w, v + d, h); // 남
  const D = iso(u, v + d, h); // 서
  const Cg = iso(u + w, v + d, 0);
  const Dg = iso(u, v + d, 0);
  const Bg = iso(u + w, v, 0);
  if (!opts.noShadow) dropShadow(g, u, v, w, d);
  g.poly([D, C, Cg, Dg], left, { stroke: PAL.outline, sw: 1 }); // SW면
  g.poly([C, B, Bg, Cg], right, { stroke: PAL.outline, sw: 1 }); // SE면
  g.poly([A, B, C, D], top, { stroke: PAL.outline, sw: 1 }); // 상판
  return { A, B, C, D };
}

function shade(hex, f) {
  // hex #rrggbb 밝기 조정 f(0.8=어둡게, 1.1=밝게)
  const n = parseInt(hex.slice(1), 16);
  const ch = (sh) => Math.max(0, Math.min(255, Math.round(((n >> sh) & 255) * f)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

function woodPrism(g, u, v, w, d, h) {
  return prism(g, u, v, w, d, h, { top: PAL.woodTop, left: PAL.wood, right: PAL.woodDark });
}

function colorPrism(g, u, v, w, d, h, base) {
  return prism(g, u, v, w, d, h, { top: shade(base, 1.14), left: base, right: shade(base, 0.8) });
}

module.exports = { W, H, TILE, ORIGIN, iso, pt, pts, PAL, Svg, floorQuad, dropShadow, prism, shade, woodPrism, colorPrism };
