/* spike-vector/scene.js — Claude Design 벡터 오피스 렌더러 (Phase 0-A 스파이크)
 * 단일 패스 SVG 렌더: 전역 조명(좌상 고정)·연속 바닥·소프트 섀도 내장·글라스 파티션.
 * 브라우저(<script>)와 Node(require, resvg QA)에서 동일 사용.
 * 좌표: 미터. 월드 20 × 11.25m (lib/office2d.ts 정합). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpikeScene = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 투영 ──
  const K = 46, KZ = 41, W = 20, D = 11.25;
  const OX = D * K + 42, OY = 152;
  const VW = 1520, VH = 900;
  const px = (x, y) => OX + (x - y) * K;
  const py = (x, y, z) => OY + ((x + y) * K) / 2 - (z || 0) * KZ;
  const P = (x, y, z) => `${px(x, y).toFixed(1)},${py(x, y, z).toFixed(1)}`;

  // ── 팔레트 (플랫 프리미엄 벡터 — 웜 뉴트럴 + 블루 액센트) ──
  const PAL = {
    bg: '#20242e',
    floor0: '#ECE7DE', floor1: '#DDD6C9',
    grid: 'rgba(90,80,60,.05)',
    wallL: '#F2EEE7', wallLd: '#E3DED4',
    wallR: '#E8E2D8', wallRd: '#D9D2C5',
    wallCap: '#FBFAF7',
    wood0: '#CFA678', wood1: '#B98D5F', wood2: '#9E764E',
    white0: '#FBFAF7', white1: '#E9E6DF', white2: '#D8D4CA',
    dark0: '#454C59', dark1: '#383E4A', dark2: '#2C313B',
    accent: '#3B5BFE',
    sofa0: '#6C7BA8', sofa1: '#5A6890', sofa2: '#4A5578',
    leaf0: '#84AC72', leaf1: '#6D9660', leaf2: '#577E4C',
    pot: '#C88763',
    glass: 'rgba(178,203,224,.24)', glassEdge: 'rgba(255,255,255,.55)', glassPost: '#A9B4BE',
    skin: ['#E8B48F', '#C98E62', '#F0C9A5', '#A9764F'],
    hair: ['#3A2F28', '#141414', '#6B4A2F', '#4A4A55'],
    shirt: ['#5B74F5', '#4CA88C', '#D98A4E', '#8B6FC9', '#4B99C9', '#C96F86'],
  };

  const ZONES = {
    meeting: { tint: '#3B5BFE', label: 'BOARD ROOM' },
    lounge: { tint: '#E0A458', label: 'LOUNGE' },
    pantry: { tint: '#5EA69E', label: 'PANTRY' },
    focus: { tint: '#8B6FC9', label: 'FOCUS' },
  };

  // 셰이딩: 전역 조명 좌상 — top 최명, SW(좌하면) 중간, SE(우하면) 최암
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f > 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // ── SVG 조각 빌더 ──
  function poly(pts, fill, extra) {
    return `<polygon points="${pts}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
  }
  // 축정렬 육면체 3면 (탑/SW/SE)
  function box(x, y, w, d, z0, h, c, opt) {
    const o = opt || {};
    const t = shade(c, o.top !== undefined ? o.top : 0.16);
    const sw = shade(c, o.sw !== undefined ? o.sw : -0.06);
    const se = shade(c, o.se !== undefined ? o.se : -0.2);
    const z1 = z0 + h;
    let s = '';
    s += poly(`${P(x, y + d, z0)} ${P(x + w, y + d, z0)} ${P(x + w, y + d, z1)} ${P(x, y + d, z1)}`, sw);
    s += poly(`${P(x + w, y + d, z0)} ${P(x + w, y, z0)} ${P(x + w, y, z1)} ${P(x + w, y + d, z1)}`, se);
    s += poly(`${P(x, y, z1)} ${P(x + w, y, z1)} ${P(x + w, y + d, z1)} ${P(x, y + d, z1)}`, t);
    return s;
  }
  // 접지 소프트 섀도(전 모듈 내장 — §5-0-2)
  function shadow(cx, cy, rw, op) {
    return `<ellipse cx="${px(cx + 0.06, cy + 0.06).toFixed(1)}" cy="${py(cx + 0.06, cy + 0.06, 0).toFixed(1)}" rx="${(rw * K).toFixed(1)}" ry="${(rw * K * 0.5).toFixed(1)}" fill="rgba(40,34,24,${op || 0.13})" filter="url(#blur)"/>`;
  }
  function cylinder(x, y, r, z0, h, c) {
    const z1 = z0 + h;
    const cx = px(x, y), cyT = py(x, y, z1), cyB = py(x, y, z0);
    return `<path d="M ${cx - r * K} ${cyT} L ${cx - r * K} ${cyB} A ${r * K} ${r * K * 0.5} 0 0 0 ${cx + r * K} ${cyB} L ${cx + r * K} ${cyT}" fill="${shade(c, -0.12)}"/>` +
      `<ellipse cx="${cx}" cy="${cyT}" rx="${r * K}" ry="${r * K * 0.5}" fill="${shade(c, 0.14)}"/>`;
  }

  // ── 카탈로그 (시드 ~15종) — 각 모듈: {draw(item)->svg, key} ──

  function desk(it) {
    // 1.6×0.8 워크스테이션: 오크 상판+화이트 패널+랩탑(+점유 시 아바타는 별도 아이템)
    const { x, y } = it;
    let s = shadow(x + 0.8, y + 0.4, 1.05, 0.12);
    s += box(x + 0.08, y + 0.1, 0.14, 0.6, 0, 0.72, PAL.white1);         // 좌 패널
    s += box(x + 1.38, y + 0.1, 0.14, 0.6, 0, 0.72, PAL.white1);         // 우 패널
    s += box(x, y, 1.6, 0.8, 0.72, 0.05, PAL.wood0);                     // 상판
    // 랩탑 — 화면이 카메라 쪽(사람은 책상 앞 뒷모습) → 점유 시 스크린 글로우가 "근무 중"을 발신, 빈 좌석은 소등
    s += box(x + 0.58, y + 0.26, 0.44, 0.035, 0.77, 0.3, PAL.dark1, { se: -0.1 });
    if (it.on) {
      s += poly(`${P(x + 0.6, y + 0.3, 0.8)} ${P(x + 1.0, y + 0.3, 0.8)} ${P(x + 1.0, y + 0.3, 1.04)} ${P(x + 0.6, y + 0.3, 1.04)}`, 'url(#screenG)');
      s += `<line x1="${px(x + 0.64, y + 0.3)}" y1="${py(x + 0.64, y + 0.3, 0.99)}" x2="${px(x + 0.88, y + 0.3)}" y2="${py(x + 0.88, y + 0.3, 0.99)}" stroke="rgba(255,255,255,.75)" stroke-width="1.8"/>`;
      s += `<line x1="${px(x + 0.64, y + 0.3)}" y1="${py(x + 0.64, y + 0.3, 0.93)}" x2="${px(x + 0.96, y + 0.3)}" y2="${py(x + 0.96, y + 0.3, 0.93)}" stroke="rgba(255,255,255,.45)" stroke-width="1.8"/>`;
    } else {
      s += poly(`${P(x + 0.6, y + 0.3, 0.8)} ${P(x + 1.0, y + 0.3, 0.8)} ${P(x + 1.0, y + 0.3, 1.04)} ${P(x + 0.6, y + 0.3, 1.04)}`, '#525A68');
    }
    s += box(x + 0.58, y + 0.33, 0.44, 0.26, 0.77, 0.015, PAL.white2);   // 키보드부
    if (it.mug !== false) s += cylinder(x + 1.24, y + 0.56, 0.045, 0.77, 0.09, it.mugColor || '#C96F86');
    if (it.docs) s += box(x + 0.16, y + 0.5, 0.26, 0.2, 0.77, 0.012, PAL.white0);
    if (it.lamp) { // 데스크 램프 (클러터 — §5-0-5)
      s += `<line x1="${px(x + 0.3, y + 0.24)}" y1="${py(x + 0.3, y + 0.24, 0.77)}" x2="${px(x + 0.36, y + 0.28)}" y2="${py(x + 0.36, y + 0.28, 1.06)}" stroke="${PAL.dark1}" stroke-width="2.4" stroke-linecap="round"/>`;
      s += `<rect x="${px(x + 0.36, y + 0.28) - 8}" y="${py(x + 0.36, y + 0.28, 1.1)}" width="16" height="7" rx="3.5" fill="${PAL.dark0}"/>`;
      s += `<ellipse cx="${px(x + 0.36, y + 0.28)}" cy="${py(x + 0.36, y + 0.28, 1.02)}" rx="7" ry="3" fill="rgba(255,220,150,.5)" filter="url(#blur)"/>`;
    }
    return s;
  }

  function chair(it) { // 태스크 체어 — 스크린공간 라운드 실루엣(등받이가 모니터로 안 읽히게)
    const { x, y } = it;
    const cx = px(x, y), fy = py(x, y, 0);
    const c0 = it.light ? '#5D6675' : PAL.dark0, c1 = it.light ? '#4E5665' : PAL.dark1;
    let s = `<ellipse cx="${cx}" cy="${fy}" rx="13" ry="5.5" fill="rgba(40,34,24,.13)" filter="url(#blur)"/>`;
    s += `<path d="M ${cx - 11} ${fy - 2} L ${cx + 11} ${fy - 2} M ${cx} ${fy - 2} L ${cx} ${fy - 14}" stroke="${PAL.dark2}" stroke-width="2.4" stroke-linecap="round"/>`;
    s += `<rect x="${cx - 11}" y="${fy - 21}" width="22" height="8.5" rx="4.2" fill="${c0}"/>`;
    const bh = it.low ? 17 : 25, by = fy - (it.low ? 35 : 43);
    s += `<rect x="${cx - 9.5}" y="${by}" width="19" height="${bh}" rx="${it.low ? 6 : 8.5}" fill="${c1}"/>`;
    s += `<rect x="${cx - 9.5}" y="${by}" width="19" height="7" rx="3.5" fill="${shade(c1, 0.14)}"/>`;
    return s;
  }

  function meetingTable(it) {
    const { x, y } = it; // 3.0×1.2 오크 + 태스크체어 실루엣 6
    let s = shadow(x + 1.5, y + 0.6, 1.85, 0.13);
    for (let i = 0; i < 3; i++) s += chair({ x: x + 0.6 + i * 0.95, y: y - 0.42 });        // 북측(테이블 뒤)
    s += box(x + 0.25, y + 0.5, 0.2, 0.2, 0, 0.7, PAL.wood2);
    s += box(x + 2.55, y + 0.5, 0.2, 0.2, 0, 0.7, PAL.wood2);
    s += box(x, y, 3.0, 1.2, 0.7, 0.06, PAL.wood0);
    s += box(x + 1.25, y + 0.45, 0.5, 0.3, 0.76, 0.02, PAL.dark2); // 콘퍼런스 폰
    for (let i = 0; i < 3; i++) s += chair({ x: x + 0.6 + i * 0.95, y: y + 1.62 });        // 남측(테이블 앞)
    return s;
  }

  function sofa(it) {
    const { x, y } = it; // 2.2×0.95 라운지 소파
    let s = shadow(x + 1.1, y + 0.5, 1.4, 0.13);
    s += box(x, y, 2.2, 0.95, 0, 0.42, PAL.sofa1);                        // 베이스
    s += box(x, y, 2.2, 0.18, 0.42, 0.5, PAL.sofa2, { sw: -0.04 });      // 등받이
    s += box(x, y + 0.1, 0.2, 0.85, 0.42, 0.28, PAL.sofa2);              // 좌 팔걸이
    s += box(x + 2.0, y + 0.1, 0.2, 0.85, 0.42, 0.28, PAL.sofa2);        // 우 팔걸이
    s += box(x + 0.24, y + 0.24, 0.84, 0.68, 0.42, 0.1, PAL.sofa0);      // 쿠션 1
    s += box(x + 1.12, y + 0.24, 0.84, 0.68, 0.42, 0.1, PAL.sofa0);      // 쿠션 2
    return s;
  }

  function coffeeTable(it) {
    const { x, y } = it;
    return shadow(x, y, 0.55, 0.11) + cylinder(x, y, 0.42, 0, 0.36, PAL.wood1) +
      box(x - 0.16, y - 0.1, 0.3, 0.2, 0.37, 0.01, PAL.white0);
  }

  function rug(it) {
    const { x, y, w, d } = it;
    return poly(`${P(x, y, 0.005)} ${P(x + w, y, 0.005)} ${P(x + w, y + d, 0.005)} ${P(x, y + d, 0.005)}`, 'rgba(200,150,100,.14)') +
      poly(`${P(x + 0.12, y + 0.12, 0.006)} ${P(x + w - 0.12, y + 0.12, 0.006)} ${P(x + w - 0.12, y + d - 0.12, 0.006)} ${P(x + 0.12, y + d - 0.12, 0.006)}`, 'none', `stroke="rgba(160,110,70,.25)" stroke-width="1.5"`);
  }

  function plant(it) {
    const { x, y } = it; const big = it.size !== 's';
    const r = big ? 0.19 : 0.13, h = big ? 0.42 : 0.28;
    let s = shadow(x, y, big ? 0.42 : 0.3, 0.11);
    s += cylinder(x, y, r, 0, h, it.potColor || PAL.pot);
    const cx = px(x, y), cy = py(x, y, h + (big ? 0.5 : 0.3));
    const R = (big ? 0.44 : 0.28) * K;
    s += `<circle cx="${cx - R * 0.45}" cy="${cy + R * 0.28}" r="${R * 0.62}" fill="${PAL.leaf2}"/>`;
    s += `<circle cx="${cx + R * 0.5}" cy="${cy + R * 0.28}" r="${R * 0.66}" fill="${PAL.leaf1}"/>`;
    s += `<circle cx="${cx}" cy="${cy - R * 0.18}" r="${R * 0.72}" fill="${PAL.leaf0}"/>`;
    s += `<circle cx="${cx - R * 0.28}" cy="${cy + R * 0.05}" r="${R * 0.4}" fill="${shade(PAL.leaf0, 0.18)}"/>`;
    return s;
  }

  function shelf(it) {
    const { x, y } = it; // 1.8×0.4 로우 캐비닛 + 소품
    let s = shadow(x + 0.9, y + 0.2, 1.1, 0.12);
    s += box(x, y, 1.8, 0.4, 0, 0.78, PAL.white0);
    s += `<line x1="${px(x + 0.9, y + 0.4)}" y1="${py(x + 0.9, y + 0.4, 0.06)}" x2="${px(x + 0.9, y + 0.4)}" y2="${py(x + 0.9, y + 0.4, 0.72)}" stroke="${PAL.white2}" stroke-width="1.6"/>`;
    s += box(x + 0.15, y + 0.08, 0.24, 0.24, 0.78, 0.28, PAL.wood1);     // 소품: 북엔드
    s += box(x + 0.42, y + 0.08, 0.06, 0.24, 0.78, 0.34, PAL.accent);
    s += box(x + 0.5, y + 0.08, 0.06, 0.24, 0.78, 0.3, PAL.dark0);
    const pc = { x: x + 1.45, y: y + 0.2, size: 's', potColor: PAL.white2 };
    s += cylinder(pc.x, pc.y, 0.1, 0.78, 0.12, PAL.white2);
    s += `<circle cx="${px(pc.x, pc.y)}" cy="${py(pc.x, pc.y, 1.12)}" r="${0.16 * K}" fill="${PAL.leaf1}"/>`;
    return s;
  }

  function pantryCounter(it) {
    const { x, y } = it; // 벽부착 카운터 2.4×0.6 + 커피머신 + 스툴 2
    let s = shadow(x + 1.2, y + 0.3, 1.5, 0.12);
    s += box(x, y, 2.4, 0.6, 0, 0.88, PAL.wood1, { top: 0.22 });
    s += box(x + 0.25, y + 0.12, 0.4, 0.36, 0.88, 0.42, PAL.dark1);      // 커피머신
    s += `<circle cx="${px(x + 0.45, y + 0.5)}" cy="${py(x + 0.45, y + 0.5, 1.12)}" r="2.6" fill="#E05B4B"/>`;
    s += cylinder(x + 1.3, y + 0.3, 0.09, 0.88, 0.1, PAL.white0);
    s += cylinder(x + 1.55, y + 0.3, 0.09, 0.88, 0.1, PAL.white0);
    s += box(x + 1.9, y + 0.1, 0.34, 0.28, 0.88, 0.26, PAL.white1);      // 냅킨/바스켓
    return s;
  }
  function stool(it) {
    const { x, y } = it;
    return shadow(x, y, 0.24, 0.1) +
      `<line x1="${px(x, y)}" y1="${py(x, y, 0)}" x2="${px(x, y)}" y2="${py(x, y, 0.6)}" stroke="${PAL.dark2}" stroke-width="3"/>` +
      cylinder(x, y, 0.17, 0.6, 0.07, PAL.wood0);
  }

  function phoneBooth(it) {
    const { x, y } = it; // 1.0×1.0 부스 — 화이트 프레임 + 글라스 전면 (서버랙 느낌 금지)
    let s = shadow(x + 0.5, y + 0.5, 0.78, 0.14);
    s += box(x, y, 1.0, 1.0, 0, 1.95, PAL.white1, { top: 0.2, sw: -0.04, se: -0.14 });
    s += poly(`${P(x + 0.1, y + 1.0, 0.1)} ${P(x + 0.9, y + 1.0, 0.1)} ${P(x + 0.9, y + 1.0, 1.78)} ${P(x + 0.1, y + 1.0, 1.78)}`, 'rgba(140,170,196,.4)', `stroke="${PAL.glassEdge}" stroke-width="1.4"`);
    s += poly(`${P(x + 1.0, y + 0.12, 0.1)} ${P(x + 1.0, y + 0.88, 0.1)} ${P(x + 1.0, y + 0.88, 1.78)} ${P(x + 1.0, y + 0.12, 1.78)}`, 'rgba(120,150,176,.28)');
    const lx = px(x + 1.0, y + 0.5), ly = py(x + 1.0, y + 0.5, 1.9);
    s += `<circle cx="${lx}" cy="${ly}" r="3" fill="#69D08B"/>`;
    s += `<text x="${lx}" y="${ly + 14}" text-anchor="middle" font-family="'Segoe UI',system-ui,sans-serif" font-size="9" letter-spacing="1.5" font-weight="600" fill="${PAL.dark0}" opacity=".6">CALL</text>`;
    return s;
  }

  function whiteboard(it) { // 우측 벽(y=0) 부착
    const { x } = it; const w = it.w || 1.7;
    return poly(`${P(x, 0.02, 1.0)} ${P(x + w, 0.02, 1.0)} ${P(x + w, 0.02, 2.05)} ${P(x, 0.02, 2.05)}`, PAL.white0, `stroke="${PAL.white2}" stroke-width="2"`) +
      `<polyline points="${P(x + 0.2, 0.02, 1.75)} ${P(x + 0.7, 0.02, 1.75)}" stroke="${PAL.accent}" stroke-width="2.4" fill="none"/>` +
      `<polyline points="${P(x + 0.2, 0.02, 1.58)} ${P(x + 1.1, 0.02, 1.58)}" stroke="${PAL.white2}" stroke-width="2.4" fill="none"/>` +
      `<polyline points="${P(x + 0.2, 0.02, 1.41)} ${P(x + 0.9, 0.02, 1.41)}" stroke="#E0A458" stroke-width="2.4" fill="none"/>`;
  }

  function tv(it) { // 우측 벽 부착 대형 디스플레이
    const { x } = it; const w = it.w || 1.6;
    return poly(`${P(x, 0.02, 1.05)} ${P(x + w, 0.02, 1.05)} ${P(x + w, 0.02, 1.98)} ${P(x, 0.02, 1.98)}`, PAL.dark2, `stroke="${PAL.dark1}" stroke-width="3"`) +
      poly(`${P(x + 0.12, 0.02, 1.16)} ${P(x + w - 0.5, 0.02, 1.16)} ${P(x + w - 0.5, 0.02, 1.5)} ${P(x + 0.12, 0.02, 1.5)}`, 'rgba(91,116,245,.5)') +
      `<polyline points="${P(x + 0.12, 0.02, 1.68)} ${P(x + w - 0.8, 0.02, 1.68)}" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>` +
      `<polyline points="${P(x + 0.12, 0.02, 1.8)} ${P(x + w - 0.3, 0.02, 1.8)}" stroke="rgba(255,255,255,.2)" stroke-width="2" fill="none"/>`;
  }

  function artwork(it) { // 좌측 벽(x=0) 부착 액자
    const { y } = it; const w = it.w || 0.9;
    return poly(`${P(0.02, y + w, 1.25)} ${P(0.02, y, 1.25)} ${P(0.02, y, 1.95)} ${P(0.02, y + w, 1.95)}`, PAL.white0, `stroke="${PAL.wood2}" stroke-width="2.5"`) +
      `<circle cx="${px(0.02, y + w / 2)}" cy="${py(0.02, y + w / 2, 1.6)}" r="${0.16 * K}" fill="${it.c || PAL.accent}" opacity=".75"/>`;
  }

  // 글라스 파티션 세그먼트(깊이 정렬 참여)
  function glassSeg(it) {
    const { x0, y0, x1, y1 } = it; const H = 2.2;
    let s = poly(`${P(x0, y0, 0)} ${P(x1, y1, 0)} ${P(x1, y1, H)} ${P(x0, y0, H)}`, PAL.glass);
    s += `<line x1="${px(x0, y0)}" y1="${py(x0, y0, H)}" x2="${px(x1, y1)}" y2="${py(x1, y1, H)}" stroke="${PAL.glassEdge}" stroke-width="1.6"/>`;
    s += `<line x1="${px(x0, y0)}" y1="${py(x0, y0, 0)}" x2="${px(x0, y0)}" y2="${py(x0, y0, H)}" stroke="${PAL.glassPost}" stroke-width="2.2"/>`;
    s += `<line x1="${px(x1, y1)}" y1="${py(x1, y1, 0)}" x2="${px(x1, y1)}" y2="${py(x1, y1, H)}" stroke="${PAL.glassPost}" stroke-width="2.2"/>`;
    return s;
  }

  // ── 아바타: 스크린공간 라운드 빌보드 (Kumospace 방식 — 아이소 박스 아님) ──
  // 스틸 + 상태 포즈. 걷기 사이클 없음(글라이드는 HTML transform). 네임필은 오버레이 레이어(PILLS).
  let PILLS = [];
  function avatar(it) {
    const { x, y } = it;
    const v = it.variant || 0;
    const skin = PAL.skin[v % PAL.skin.length], hair = PAL.hair[v % PAL.hair.length], shirt = PAL.shirt[v % PAL.shirt.length];
    const cx = px(x, y), fy = py(x, y, 0);
    const state = it.state || 'stand';
    const flip = it.flip ? -1 : 1;
    let s = '';
    const gid = it.id ? ` id="${it.id}"` : '';
    const hairArc = (hx, hy, r) =>
      `<path d="M ${hx - r} ${hy + r * 0.15} A ${r} ${r} 0 0 1 ${hx + r} ${hy + r * 0.15} L ${hx + r * 0.82} ${hy - r * 0.05} A ${r * 0.86} ${r * 0.86} 0 0 0 ${hx - r * 0.55} ${hy - r * 0.28} Z" fill="${hair}" transform="rotate(${-6 * flip} ${hx} ${hy})"/>`;
    if (state === 'sit' || state === 'typing') {
      // 착석: 앵커=엉덩이 접지점. back=뒷모습(책상 앞 착석 — 머리는 헤어 풀커버), 정면 착석은 lap(허벅지) 표시
      const seatTop = (it.seatZ !== undefined ? it.seatZ : 0.42) * KZ;
      const ty = fy - seatTop;
      if (!it.back && it.lap !== false) s += `<rect x="${cx - 12}" y="${ty - 5}" width="24" height="10" rx="5" fill="${PAL.dark1}"/>`;
      s += `<rect x="${cx - 14}" y="${ty - 34}" width="28" height="36" rx="12" fill="${shirt}"/>`;
      s += `<rect x="${cx - 14}" y="${ty - 34}" width="9" height="36" rx="4.5" fill="rgba(255,255,255,.14)"/>`;
      const hy = ty - 44;
      if (it.back) {
        s += `<circle cx="${cx}" cy="${hy}" r="11" fill="${skin}"/>`;
        s += `<path d="M ${cx - 11} ${hy + 3} A 11 11 0 1 1 ${cx + 11} ${hy + 3} Z" fill="${hair}"/>`;
      } else {
        s += `<circle cx="${cx}" cy="${hy}" r="11" fill="${skin}"/>`;
        s += hairArc(cx, hy, 11);
      }
      if (state === 'typing') s += `<g opacity=".8"><rect x="${cx + 14}" y="${hy - 15}" width="25" height="12.5" rx="6.2" fill="#fff"/><circle cx="${cx + 21}" cy="${hy - 8.7}" r="1.6" fill="#8A93A6"/><circle cx="${cx + 26.5}" cy="${hy - 8.7}" r="1.6" fill="#8A93A6"/><circle cx="${cx + 32}" cy="${hy - 8.7}" r="1.6" fill="#8A93A6"/></g>`;
    } else {
      s += `<ellipse cx="${cx}" cy="${fy}" rx="15" ry="6.5" fill="rgba(40,34,24,.16)" filter="url(#blur)"/>`;
      s += `<rect x="${cx - 9}" y="${fy - 26}" width="8" height="26" rx="4" fill="${PAL.dark1}"/>`;
      s += `<rect x="${cx + 1}" y="${fy - 26}" width="8" height="26" rx="4" fill="${shade(PAL.dark1, -0.15)}"/>`;
      s += `<rect x="${cx - 14}" y="${fy - 62}" width="28" height="40" rx="12" fill="${shirt}"/>`;
      s += `<rect x="${cx - 14}" y="${fy - 62}" width="9" height="40" rx="4.5" fill="rgba(255,255,255,.14)"/>`;
      const hy = fy - 73;
      s += `<circle cx="${cx}" cy="${hy}" r="11.5" fill="${skin}"/>`;
      s += hairArc(cx, hy, 11.5);
      if (it.coffee) s += `<rect x="${cx + 12 * flip}" y="${fy - 46}" width="9" height="11" rx="2" fill="${PAL.white0}" stroke="rgba(0,0,0,.12)"/>`;
    }
    // 네임필은 최상위 오버레이로 (가구에 안 가리게 — 프로덕트 UI 요소)
    if (it.name) {
      const ny = fy + (state === 'stand' ? 10 : 12);
      const wpx = it.name.length * 13 + 34;
      PILLS.push(`<g${it.id ? ` id="${it.id}-pill"` : ''} font-family="'Segoe UI','Malgun Gothic',system-ui,sans-serif">` +
        `<rect x="${cx - wpx / 2}" y="${ny}" width="${wpx}" height="20" rx="10" fill="rgba(255,255,255,.94)" stroke="rgba(0,0,0,.07)"/>` +
        `<circle cx="${cx - wpx / 2 + 11}" cy="${ny + 10}" r="3.2" fill="${it.away ? '#E0A458' : '#34B26B'}"/>` +
        `<text x="${cx + 5}" y="${ny + 14.5}" text-anchor="middle" font-size="11.5" font-weight="500" fill="#333A45">${it.name}</text></g>`);
    }
    return `<g${gid}>${s}</g>`;
  }

  const CATALOG = { desk, chair, meetingTable, sofa, coffeeTable, rug, plant, shelf, pantryCounter, stool, phoneBooth, whiteboard, tv, artwork, glassSeg, avatar };

  // 깊이 키(우선 정렬): 기본 = 접지 기준점(x+y). 벽부착물은 뒤로.
  function depthKey(it) {
    if (it.k === 'whiteboard' || it.k === 'tv' || it.k === 'artwork') return -999;
    if (it.k === 'rug') return -500;
    if (it.dk !== undefined) return it.dk;
    const fx = it.x + (it.w || 0) / 2, fy = it.y + (it.d || 0) / 2;
    return fx + fy;
  }

  // ── 레이아웃 데이터 (이것만 바꾸면 다른 고객사 오피스 — §0 재현성) ──
  function deskCluster(x, y, occupants) {
    // 2연 데스크(마주보기 없음, 카메라 응시 배치): 사람은 데스크 뒤(작은 x+y)에 앉아 자연 가림
    const items = [];
    for (let i = 0; i < 2; i++) {
      const dx = x + i * 1.9;
      const occ = occupants && occupants[i];
      items.push({ k: 'desk', x: dx, y, w: 1.6, d: 0.8, on: !!occ, docs: i % 2 === 0, lamp: i === 0, mugColor: i % 2 ? '#4CA88C' : '#C96F86' });
      // 착석 문법: 사람은 책상 "앞"(카메라 쪽) 뒷모습, 의자 등받이가 사람 하반신을 덮어 턱인(tuck-in)
      if (occ) {
        items.push({ k: 'avatar', x: dx + 0.8, y: y + 1.02, back: true, state: occ.state || 'typing', variant: occ.v, name: occ.name, dk: dx + 0.8 + y + 1.05, away: occ.away });
        items.push({ k: 'chair', x: dx + 0.8, y: y + 1.1, low: true, dk: dx + 0.8 + y + 1.12 });
      } else {
        items.push({ k: 'chair', x: dx + 0.8, y: y + 0.95, light: true, dk: dx + 0.8 + y + 0.97 });
      }
    }
    return items;
  }

  const LAYOUTS = {};

  LAYOUTS[12] = function () {
    const items = [];
    // 워크존 데스크 클러스터 2열×2행 (12석 중 8석 표시 + α)
    items.push(...deskCluster(2.2, 3.0, [{ v: 0, name: '김지원' }, { v: 1, name: '이서준', state: 'sit' }]));
    items.push(...deskCluster(6.6, 3.0, [null, { v: 2, name: '박하늘' }]));
    items.push(...deskCluster(2.2, 5.6, [{ v: 3, name: '최민아' }, null]));
    items.push(...deskCluster(6.6, 5.6, [{ v: 4, name: '정다온' }, { v: 5, name: '한유진' }]));
    // 수납 + 화이트보드 + 액자 + 화분
    items.push({ k: 'shelf', x: 4.6, y: 0.35, w: 1.8, d: 0.4 });
    items.push({ k: 'whiteboard', x: 2.0, w: 1.7 });
    items.push({ k: 'artwork', y: 4.6, c: '#E0A458' });
    items.push({ k: 'artwork', y: 9.2, c: '#4CA88C', w: 0.7 });
    items.push({ k: 'plant', x: 0.75, y: 0.9, potColor: PAL.pot });
    items.push({ k: 'plant', x: 10.4, y: 0.7 });
    items.push({ k: 'plant', x: 13.9, y: 10.4 });
    items.push({ k: 'plant', x: 0.8, y: 10.3, size: 's' });
    // 미팅룸 (우상, 글라스)
    items.push({ k: 'zone', zone: 'meeting', x: 14.6, y: 0, w: 5.4, d: 4.6 });
    items.push({ k: 'meetingTable', x: 15.6, y: 1.7, w: 3, d: 1.2 });
    items.push({ k: 'tv', x: 16.2, w: 1.6 });
    items.push({ k: 'avatar', x: 17.15, y: 1.33, state: 'sit', lap: false, variant: 2, name: '오세림', dk: 18.4 });
    items.push({ k: 'avatar', x: 16.2, y: 3.34, state: 'sit', back: true, variant: 5, name: '서도윤', dk: 19.56 });
    items.push({ k: 'chair', x: 16.2, y: 3.42, dk: 19.64 });
    for (let yy = 0; yy < 4.6; yy += 1.15) items.push({ k: 'glassSeg', x0: 14.6, y0: yy, x1: 14.6, y1: Math.min(yy + 1.15, 4.6), dk: 14.6 + yy + 0.57 });
    for (let xx = 14.6; xx < 18.2; xx += 1.2) items.push({ k: 'glassSeg', x0: xx, y0: 4.6, x1: Math.min(xx + 1.2, 18.2), y1: 4.6, dk: xx + 0.6 + 4.6 }); // 도어 갭 18.2~
    // 라운지 (우하)
    items.push({ k: 'zone', zone: 'lounge', x: 14.2, y: 6.4, w: 5.8, d: 4.85 });
    items.push({ k: 'rug', x: 14.9, y: 7.1, w: 4.2, d: 3.2 });
    items.push({ k: 'sofa', x: 15.4, y: 7.0, w: 2.2, d: 0.95 });
    items.push({ k: 'coffeeTable', x: 16.6, y: 9.0 });
    items.push({ k: 'avatar', x: 16.2, y: 7.34, state: 'sit', seatZ: 0.52, variant: 1, name: '노아름', dk: 24.35 });
    items.push({ k: 'plant', x: 19.3, y: 6.9 });
    // 팬트리 (좌하 벽쪽)
    items.push({ k: 'zone', zone: 'pantry', x: 0.4, y: 8.3, w: 4.6, d: 2.6 });
    items.push({ k: 'pantryCounter', x: 0.7, y: 8.6, w: 2.4, d: 0.6 });
    items.push({ k: 'stool', x: 1.5, y: 9.9 });
    items.push({ k: 'stool', x: 2.3, y: 9.9 });
    items.push({ k: 'avatar', x: 3.6, y: 9.4, state: 'stand', variant: 0, name: '유가온', coffee: true, flip: true });
    // 폰부스 (중앙 상)
    items.push({ k: 'phoneBooth', x: 12.2, y: 0.5, w: 1.1, d: 1.1 });
    // 통로 워커(글라이드 데모 — HTML에서 이동)
    items.push({ k: 'avatar', x: 11.0, y: 7.6, state: 'stand', variant: 3, name: '강이현', id: 'walker', dk: 30 });
    return items;
  };

  LAYOUTS[24] = function () {
    const items = [];
    const occ = [
      [{ v: 0, name: '김지원' }, { v: 1, name: '이서준' }], [null, { v: 2, name: '박하늘', state: 'sit' }],
      [{ v: 3, name: '최민아' }, null], [{ v: 4, name: '정다온' }, { v: 5, name: '한유진' }],
      [null, { v: 0, name: '문채원' }], [{ v: 2, name: '임준호' }, null],
    ];
    let i = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      items.push(...deskCluster(1.9 + c * 4.4, 1.9 + r * 2.6, occ[i++ % occ.length]));
    }
    for (let r = 0; r < 2; r++) items.push(...deskCluster(10.6, 3.2 + r * 2.6, [null, null]));
    items.push({ k: 'whiteboard', x: 1.6, w: 1.7 });
    items.push({ k: 'artwork', y: 5.2, c: '#E0A458' });
    items.push({ k: 'plant', x: 0.75, y: 0.8 });
    items.push({ k: 'plant', x: 10.1, y: 0.7, size: 's' });
    items.push({ k: 'plant', x: 13.7, y: 10.5 });
    items.push({ k: 'zone', zone: 'meeting', x: 14.6, y: 0, w: 5.4, d: 4.6 });
    items.push({ k: 'meetingTable', x: 15.6, y: 1.7, w: 3, d: 1.2 });
    items.push({ k: 'tv', x: 16.2, w: 1.6 });
    items.push({ k: 'avatar', x: 17.15, y: 1.33, state: 'sit', lap: false, variant: 4, name: '오세림', dk: 18.4 });
    for (let yy = 0; yy < 4.6; yy += 1.15) items.push({ k: 'glassSeg', x0: 14.6, y0: yy, x1: 14.6, y1: Math.min(yy + 1.15, 4.6), dk: 14.6 + yy + 0.57 });
    for (let xx = 14.6; xx < 18.2; xx += 1.2) items.push({ k: 'glassSeg', x0: xx, y0: 4.6, x1: Math.min(xx + 1.2, 18.2), y1: 4.6, dk: xx + 0.6 + 4.6 });
    items.push({ k: 'zone', zone: 'lounge', x: 14.2, y: 6.4, w: 5.8, d: 4.85 });
    items.push({ k: 'rug', x: 14.9, y: 7.1, w: 4.2, d: 3.2 });
    items.push({ k: 'sofa', x: 15.4, y: 7.0, w: 2.2, d: 0.95 });
    items.push({ k: 'coffeeTable', x: 16.6, y: 9.0 });
    items.push({ k: 'plant', x: 19.3, y: 6.9 });
    items.push({ k: 'zone', zone: 'pantry', x: 0.4, y: 8.6, w: 4.6, d: 2.3 });
    items.push({ k: 'pantryCounter', x: 0.7, y: 8.9, w: 2.4, d: 0.6 });
    items.push({ k: 'stool', x: 1.5, y: 10.15 });
    items.push({ k: 'stool', x: 2.3, y: 10.15 });
    items.push({ k: 'avatar', x: 3.6, y: 9.7, state: 'stand', variant: 1, name: '유가온', coffee: true, flip: true });
    items.push({ k: 'phoneBooth', x: 12.4, y: 0.5, w: 1.1, d: 1.1 });
    items.push({ k: 'avatar', x: 9.0, y: 9.6, state: 'stand', variant: 3, name: '강이현', id: 'walker', dk: 30 });
    return items;
  };

  // ── 씬 전역 계층 ──
  function floorAndWalls() {
    let s = '';
    // 바닥 (연속면 + 비네트 + 1m 그리드)
    s += poly(`${P(0, 0, 0)} ${P(W, 0, 0)} ${P(W, D, 0)} ${P(0, D, 0)}`, 'url(#floorG)');
    for (let x = 1; x < W; x++) s += `<line x1="${px(x, 0)}" y1="${py(x, 0, 0)}" x2="${px(x, D)}" y2="${py(x, D, 0)}" stroke="${PAL.grid}" stroke-width="1"/>`;
    for (let y = 1; y < D; y++) s += `<line x1="${px(0, y)}" y1="${py(0, y, 0)}" x2="${px(W, y)}" y2="${py(W, y, 0)}" stroke="${PAL.grid}" stroke-width="1"/>`;
    // 벽 (좌: x=0, 우: y=0) + 캡
    const H = 2.55;
    s += poly(`${P(0, 0, 0)} ${P(0, D, 0)} ${P(0, D, H)} ${P(0, 0, H)}`, 'url(#wallLG)');
    s += poly(`${P(0, 0, 0)} ${P(W, 0, 0)} ${P(W, 0, H)} ${P(0, 0, H)}`, 'url(#wallRG)');
    s += `<line x1="${px(0, D)}" y1="${py(0, D, H)}" x2="${px(0, 0)}" y2="${py(0, 0, H)}" stroke="${PAL.wallCap}" stroke-width="3"/>`;
    s += `<line x1="${px(0, 0)}" y1="${py(0, 0, H)}" x2="${px(W, 0)}" y2="${py(W, 0, H)}" stroke="${PAL.wallCap}" stroke-width="3"/>`;
    // 창 (좌측 벽 3개) + 바닥 광 풀
    [[1.6, 3.4], [4.6, 6.4], [7.6, 9.4]].forEach(([y0, y1]) => {
      s += poly(`${P(0.02, y1, 0.85)} ${P(0.02, y0, 0.85)} ${P(0.02, y0, 2.25)} ${P(0.02, y1, 2.25)}`, 'url(#skyG)', `stroke="${PAL.white0}" stroke-width="3"`);
      s += `<line x1="${px(0.02, (y0 + y1) / 2)}" y1="${py(0.02, (y0 + y1) / 2, 0.85)}" x2="${px(0.02, (y0 + y1) / 2)}" y2="${py(0.02, (y0 + y1) / 2, 2.25)}" stroke="${PAL.white0}" stroke-width="2"/>`;
      s += poly(`${P(0.05, y1 + 0.3, 0.004)} ${P(0.05, y0 - 0.1, 0.004)} ${P(2.6, y0 + 0.5, 0.004)} ${P(2.6, y1 + 0.9, 0.004)}`, 'rgba(255,252,240,.28)', 'filter="url(#blur)"');
    });
    // 우측 벽 창 1개 (미팅룸 뒤)
    s += poly(`${P(18.6, 0.02, 0.85)} ${P(19.6, 0.02, 0.85)} ${P(19.6, 0.02, 2.25)} ${P(18.6, 0.02, 2.25)}`, 'url(#skyG)', `stroke="${PAL.white0}" stroke-width="3"`);
    // 베이스보드 AO (벽-바닥 접지 — §5-0-2)
    s += poly(`${P(0, 0, 0)} ${P(0, D, 0)} ${P(0.34, D, 0)} ${P(0.34, 0, 0)}`, 'url(#aoL)');
    s += poly(`${P(0, 0, 0)} ${P(W, 0, 0)} ${P(W, 0.34, 0)} ${P(0, 0.34, 0)}`, 'url(#aoR)');
    return s;
  }

  function zoneTint(it) {
    const z = ZONES[it.zone];
    const { x, y, w, d } = it;
    let s = poly(`${P(x, y, 0.002)} ${P(x + w, y, 0.002)} ${P(x + w, y + d, 0.002)} ${P(x, y + d, 0.002)}`, z.tint, 'opacity=".055"');
    s += `<text x="${px(x + w - 0.2, y + d - 0.2)}" y="${py(x + w - 0.2, y + d - 0.2, 0)}" text-anchor="end" font-family="'Segoe UI',system-ui,sans-serif" font-size="12.5" letter-spacing="2.5" font-weight="600" fill="${z.tint}" opacity=".38">${z.label}</text>`;
    return s;
  }

  const THEMES = {
    day: '',
    dusk: `<rect x="0" y="0" width="${VW}" height="${VH}" fill="#B4642E" opacity=".13" style="mix-blend-mode:multiply"/><rect x="0" y="0" width="${VW}" height="${VH}" fill="#FFD9A0" opacity=".08"/>`,
    night: `<rect x="0" y="0" width="${VW}" height="${VH}" fill="#1B2C52" opacity=".3" style="mix-blend-mode:multiply"/><rect x="0" y="0" width="${VW}" height="${VH}" fill="#2A3A66" opacity=".12"/>`,
  };

  function renderSVG(n, theme) {
    PILLS = [];
    const items = LAYOUTS[n]();
    const zones = items.filter(i => i.k === 'zone');
    const rest = items.filter(i => i.k !== 'zone').sort((a, b) => depthKey(a) - depthKey(b));
    let body = '';
    body += floorAndWalls();
    for (const z of zones) body += zoneTint(z);
    for (const it of rest) body += CATALOG[it.k](it);
    body += PILLS.join('');   // 네임필 오버레이 (가구 위)
    // 글로벌 그레이딩: 비네트 + 시간대 (§5-0-3)
    body += `<rect x="0" y="0" width="${VW}" height="${VH}" fill="url(#vignette)" pointer-events="none"/>`;
    body += THEMES[theme || 'day'] || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}">
<defs>
  <radialGradient id="floorG" cx="42%" cy="38%" r="75%">
    <stop offset="0%" stop-color="${PAL.floor0}"/><stop offset="100%" stop-color="${PAL.floor1}"/>
  </radialGradient>
  <linearGradient id="wallLG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${PAL.wallL}"/><stop offset="100%" stop-color="${PAL.wallLd}"/>
  </linearGradient>
  <linearGradient id="wallRG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${PAL.wallR}"/><stop offset="100%" stop-color="${PAL.wallRd}"/>
  </linearGradient>
  <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#C9DCEC"/><stop offset="100%" stop-color="#EAF2F7"/>
  </linearGradient>
  <linearGradient id="aoL" x1="0" y1="0" x2="1" y2="0.5">
    <stop offset="0%" stop-color="rgba(60,50,35,.14)"/><stop offset="100%" stop-color="rgba(60,50,35,0)"/>
  </linearGradient>
  <linearGradient id="aoR" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="rgba(60,50,35,.12)"/><stop offset="100%" stop-color="rgba(60,50,35,0)"/>
  </linearGradient>
  <radialGradient id="vignette" cx="50%" cy="46%" r="72%">
    <stop offset="62%" stop-color="rgba(25,28,40,0)"/><stop offset="100%" stop-color="rgba(25,28,40,.14)"/>
  </radialGradient>
  <linearGradient id="screenG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#D7E4FF"/><stop offset="100%" stop-color="#9FB8EF"/>
  </linearGradient>
  <filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
</defs>
<rect x="0" y="0" width="${VW}" height="${VH}" fill="${PAL.bg}"/>
${body}
</svg>`;
  }

  return { renderSVG, LAYOUTS, K, KZ, px, py, VW, VH };
});
