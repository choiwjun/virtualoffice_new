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
  // seat 0.5×0.5×0.45 + 등받이(방향별)
  colorPrism(g, u, v, 0.5, 0.5, 0.45, PAL.charcoal);
  const b = 0.1;
  if (facing === 's') colorPrism(g, u, v, 0.5, b, 0.95, PAL.charcoalD); // 등받이 북쪽
  if (facing === 'n') colorPrism(g, u, v + 0.5 - b, 0.5, b, 0.95, PAL.charcoalD);
  if (facing === 'e') colorPrism(g, u, v, b, 0.5, 0.95, PAL.charcoalD);
  if (facing === 'w') colorPrism(g, u + 0.5 - b, v, b, 0.5, 0.95, PAL.charcoalD);
}

function monitor(g, u, v, wide = 0.62) {
  colorPrism(g, u, v, wide, 0.06, 0.42, '#3A4350');
  // 화면 글로우(SW면 위에 얹기)
  const a = iso(u, v + 0.06, 0.40);
  const b = iso(u + wide, v + 0.06, 0.40);
  const c = iso(u + wide, v + 0.06, 0.12);
  const d = iso(u, v + 0.06, 0.12);
  g.poly([a, b, c, d], PAL.screenGlow, { opacity: 0.85 });
}

function desk(g, u, v, w = 1.7, d = 0.8) {
  woodPrism(g, u, v, w, d, 0.72);
  return { u, v, w, d };
}

/** 워크스테이션 클러스터: 2×2 데스크 등맞댐 + 모니터 + 의자 4. */
function workCluster(g, u, v) {
  // 북쪽 열(모니터 남향, 의자 남쪽)
  desk(g, u, v, 1.7, 0.8);
  desk(g, u + 1.8, v, 1.7, 0.8);
  monitor(g, u + 0.5, v + 0.28);
  monitor(g, u + 2.3, v + 0.28);
  chair(g, u + 0.6, v + 1.0, 's');
  chair(g, u + 2.4, v + 1.0, 's');
  // 남쪽 열(북향)
  desk(g, u, v + 1.75, 1.7, 0.8);
  desk(g, u + 1.8, v + 1.75, 1.7, 0.8);
  monitor(g, u + 0.5, v + 2.0);
  monitor(g, u + 2.3, v + 2.0);
  chair(g, u + 0.6, v + 2.85, 'n');
  chair(g, u + 2.4, v + 2.85, 'n');
  return { u: u - 0.15, v: v - 0.15, w: 3.8, d: 3.6 };
}

function sofa(g, u, v, w, d, dir = 's') {
  colorPrism(g, u, v, w, d, 0.5, PAL.navy); // 베이스
  if (dir === 's') colorPrism(g, u, v, w, 0.22, 0.95, PAL.navyDark);
  if (dir === 'n') colorPrism(g, u, v + d - 0.22, w, 0.22, 0.95, PAL.navyDark);
  if (dir === 'e') colorPrism(g, u, v, 0.22, d, 0.95, PAL.navyDark);
  if (dir === 'w') colorPrism(g, u + w - 0.22, v, 0.22, d, 0.95, PAL.navyDark);
  // 팔걸이
  if (dir === 's' || dir === 'n') {
    colorPrism(g, u, v, 0.22, d, 0.72, PAL.navyLight);
    colorPrism(g, u + w - 0.22, v, 0.22, d, 0.72, PAL.navyLight);
  }
}

function plant(g, u, v, s = 1) {
  prism(g, u, v, 0.5 * s, 0.5 * s, 0.45 * s, { top: shade(PAL.pot, 1.1), left: PAL.pot, right: shade(PAL.pot, 0.82) });
  const c = iso(u + 0.25 * s, v + 0.25 * s, 0.5 * s);
  g.ellipse(c.x - 9 * s, c.y - 16 * s, 15 * s, 20 * s, PAL.plantD);
  g.ellipse(c.x + 10 * s, c.y - 20 * s, 16 * s, 23 * s, PAL.plant);
  g.ellipse(c.x, c.y - 32 * s, 13 * s, 21 * s, shade(PAL.plant, 1.12));
}

/** 유리벽 패널: (u0,v0)→(u1,v1) 세그먼트, 높이 h. */
function glassPanel(g, u0, v0, u1, v1, h = 2.2) {
  const a = iso(u0, v0, h);
  const b = iso(u1, v1, h);
  const c = iso(u1, v1, 0);
  const d = iso(u0, v0, 0);
  g.poly([a, b, c, d], PAL.glass, { stroke: PAL.glassEdge, sw: 1.5 });
  // 상단 프레임
  const a2 = iso(u0, v0, h - 0.06);
  const b2 = iso(u1, v1, h - 0.06);
  g.poly([a, b, b2, a2], PAL.glassEdge);
}

// ── 씬 조립 ──────────────────────────────────────────────────────────────────

function buildPlate() {
  const g = new Svg();
  const geom = { walkArea: [], rooms: [], obstacles: [], spawns: {}, meetingZones: [] };

  // 배경
  g.raw(`<rect width="${W}" height="${H}" fill="${PAL.bg}"/>`);

  // 바닥
  const F = [iso(0, 0), iso(FLOOR_U, 0), iso(FLOOR_U, FLOOR_V), iso(0, FLOOR_V)];
  g.poly(F, PAL.floor, { stroke: PAL.floorLine, sw: 2 });
  // 타일 라인
  for (let u = 1; u < FLOOR_U; u++) g.poly([iso(u, 0), iso(u, FLOOR_V)], 'none', { stroke: PAL.floorLine, sw: 1 });
  for (let v = 1; v < FLOOR_V; v++) g.poly([iso(0, v), iso(FLOOR_U, v)], 'none', { stroke: PAL.floorLine, sw: 1 });

  // 러그
  g.poly([iso(6.6, 0.6), iso(10.9, 0.6), iso(10.9, 3.4), iso(6.6, 3.4)].map((p) => p), PAL.rugSand, { opacity: 0.75 });
  g.poly([iso(1.0, 9.0), iso(4.0, 9.0), iso(4.0, 11.6), iso(1.0, 11.6)], PAL.rugNavy, { opacity: 0.5 });

  // ── 벽 (북서 u=0, 북동 v=0) ──
  // 북서벽(좌): v 0→12
  {
    const a = iso(0, 0, WALL_H), b = iso(0, FLOOR_V, WALL_H), c = iso(0, FLOOR_V, 0), d = iso(0, 0, 0);
    g.poly([a, b, c, d], PAL.wallFace, { stroke: PAL.outline, sw: 1 });
    // 창 3개
    for (const [v0, v1] of [[1.2, 3.6], [4.8, 7.2], [8.4, 10.8]]) {
      const wa = iso(0, v0, 2.15), wb = iso(0, v1, 2.15), wc = iso(0, v1, 0.85), wd = iso(0, v0, 0.85);
      g.poly([wa, wb, wc, wd], PAL.windowGlass, { stroke: PAL.windowFrame, sw: 2 });
    }
  }
  // 북동벽(우): u 0→18
  {
    const a = iso(0, 0, WALL_H), b = iso(FLOOR_U, 0, WALL_H), c = iso(FLOOR_U, 0, 0), d = iso(0, 0, 0);
    g.poly([a, b, c, d], PAL.wallSide, { stroke: PAL.outline, sw: 1 });
    for (const [u0, u1] of [[6.6, 9.4], [10.2, 11.6]]) {
      const wa = iso(u0, 0, 2.15), wb = iso(u1, 0, 2.15), wc = iso(u1, 0, 0.85), wd = iso(u0, 0, 0.85);
      g.poly([wa, wb, wc, wd], PAL.windowGlass, { stroke: PAL.windowFrame, sw: 2 });
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
  geom.obstacles.push(quadN(wa.u, wa.v, wa.u + wa.w, wa.v + wa.d));

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
  geom.obstacles.push(quadN(wb.u, wb.v, wb.u + wb.w, wb.v + wb.d));

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
