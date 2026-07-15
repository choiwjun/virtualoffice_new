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
    this.defs = [];
    this._gradCache = new Map();
    this._gradSeq = 0;
  }
  add(s) {
    this.parts.push(s);
    return this;
  }
  def(s) {
    this.defs.push(s);
    return this;
  }
  /**
   * 선형 그라데이션 fill url — 색상쌍·방향별 캐시.
   * dir: 'v'(위→아래) | 'h'(좌→우) | 'd'(좌상→우하, 방향광용).
   */
  gradient(c1, c2, dir = 'v') {
    const key = `${c1}|${c2}|${dir}`;
    if (this._gradCache.has(key)) return this._gradCache.get(key);
    const id = `g${this._gradSeq++}`;
    const [x1, y1, x2, y2] = dir === 'h' ? [0, 0, 1, 0] : dir === 'd' ? [0, 0, 1, 1] : [0, 0, 0, 1];
    this.def(
      `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
        `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`,
    );
    const url = `url(#${id})`;
    this._gradCache.set(key, url);
    return url;
  }
  /** 소프트 섀도 라디얼(공유 1개) — ellipse fill로 사용. */
  softShadowFill() {
    if (!this._softShadow) {
      this.def(
        `<radialGradient id="softsh"><stop offset="0" stop-color="rgba(55,50,42,0.34)"/>` +
          `<stop offset="0.7" stop-color="rgba(55,50,42,0.16)"/><stop offset="1" stop-color="rgba(55,50,42,0)"/></radialGradient>`,
      );
      this._softShadow = 'url(#softsh)';
    }
    return this._softShadow;
  }
  poly(points, fill, opts = {}) {
    const o = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.sw ?? 1}"` : '';
    const op = opts.opacity != null ? ` opacity="${opts.opacity}"` : '';
    this.add(`<polygon points="${pts(points)}" fill="${fill}"${o}${op}/>`);
    return this;
  }
  /** 선분 스트로크(질감·디테일 라인용). */
  line(a, b, stroke, sw = 1, opacity) {
    const op = opacity != null ? ` opacity="${opacity}"` : '';
    this.add(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${stroke}" stroke-width="${sw}"${op} stroke-linecap="round"/>`);
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
    const defs = this.defs.length > 0 ? `<defs>${this.defs.join('\n')}</defs>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs}${this.parts.join('\n')}</svg>`;
  }
}

// ── 프리미티브 ───────────────────────────────────────────────────────────────

/** 바닥 다이아 셀 채움용 폴리곤. */
function floorQuad(u0, v0, u1, v1) {
  return [iso(u0, v0), iso(u1, v0), iso(u1, v1), iso(u0, v1)];
}

/** 그림자 (바닥 타원) — 소프트 라디얼. */
function dropShadow(g, u, v, w, d) {
  const c = iso(u + w / 2, v + d / 2);
  g.ellipse(c.x, c.y + 3, (w + d) * TILE * 0.46, (w + d) * TILE * 0.19, g.softShadowFill());
}

/**
 * 아이소 직육면체 — 상판/좌면(SW)/우면(SE) 3톤 + 방향광(NW광) 그라데이션.
 * colors: {top, left, right} 미지정 시 base에서 파생.
 * opts.z0: 바닥 오프셋(m) — 책상 위 소품처럼 지면이 아닌 높이에서 시작할 때.
 * opts.flat: true면 그라데이션 없이 단색(작은 소품용).
 */
function prism(g, u, v, w, d, h, colors, opts = {}) {
  const { top, left, right } = colors;
  const z0 = opts.z0 ?? 0;
  const A = iso(u, v, z0 + h); // 북
  const B = iso(u + w, v, z0 + h); // 동
  const C = iso(u + w, v + d, z0 + h); // 남
  const D = iso(u, v + d, z0 + h); // 서
  const Cg = iso(u + w, v + d, z0);
  const Dg = iso(u, v + d, z0);
  const Bg = iso(u + w, v, z0);
  if (!opts.noShadow && z0 === 0) dropShadow(g, u, v, w, d);
  const fTop = opts.flat ? top : g.gradient(shade(top, 1.05), shade(top, 0.96), 'd');
  const fLeft = opts.flat ? left : g.gradient(shade(left, 1.03), shade(left, 0.86), 'v');
  const fRight = opts.flat ? right : g.gradient(shade(right, 0.97), shade(right, 0.8), 'v');
  g.poly([D, C, Cg, Dg], fLeft, { stroke: PAL.outline, sw: 1 }); // SW면
  g.poly([C, B, Bg, Cg], fRight, { stroke: PAL.outline, sw: 1 }); // SE면
  g.poly([A, B, C, D], fTop, { stroke: PAL.outline, sw: 1 }); // 상판
  // 상판 NW 모서리 하이라이트(광원 방향 엣지 캐치)
  if (!opts.flat && h >= 0.3 && w >= 0.3 && d >= 0.3) {
    g.line(A, B, 'rgba(255,255,255,0.35)', 1.2);
    g.line(A, D, 'rgba(255,255,255,0.22)', 1.2);
  }
  return { A, B, C, D };
}

function shade(hex, f) {
  // hex #rrggbb 밝기 조정 f(0.8=어둡게, 1.1=밝게)
  const n = parseInt(hex.slice(1), 16);
  const ch = (sh) => Math.max(0, Math.min(255, Math.round(((n >> sh) & 255) * f)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

function woodPrism(g, u, v, w, d, h, opts = {}) {
  const r = prism(g, u, v, w, d, h, { top: PAL.woodTop, left: PAL.wood, right: PAL.woodDark }, opts);
  // 우드그레인: 상판에 u방향 결 라인(저대비) — 폭이 좁으면 생략.
  if (d >= 0.4 && w >= 0.6) {
    const z = (opts.z0 ?? 0) + h;
    const lines = Math.max(2, Math.floor(d / 0.28));
    for (let i = 1; i <= lines; i++) {
      const t = (i / (lines + 1)) * d;
      const a = iso(u + 0.06, v + t, z);
      const b = iso(u + w - 0.06, v + t + (i % 2 === 0 ? 0.04 : -0.03), z);
      g.line(a, b, 'rgba(120,90,55,0.14)', 1);
    }
  }
  return r;
}

function colorPrism(g, u, v, w, d, h, base) {
  return prism(g, u, v, w, d, h, { top: shade(base, 1.14), left: base, right: shade(base, 0.8) });
}

module.exports = { W, H, TILE, ORIGIN, iso, pt, pts, PAL, Svg, floorQuad, dropShadow, prism, shade, woodPrism, colorPrism };
