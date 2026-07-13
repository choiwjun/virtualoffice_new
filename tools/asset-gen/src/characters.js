/**
 * characters.js — 8직군 캐릭터 스프라이트 생성 (시안 §4, 17-spec §3).
 *
 * 계약: 캔버스 220×460(0.478 종횡비), 발 기준점 = (110, 445) bottom-center.
 * 우향(→) 기준 1방향 — 좌향은 엔진이 scaleX(-1) 플립. 플레이트와 동일 팔레트/외곽선.
 * idle 6프레임(호흡·바운스), walk 8프레임(다리·팔 스윙 + 바운스).
 */

'use strict';

const FRAME_W = 220;
const FRAME_H = 460;
const FOOT_X = 110;
const FOOT_Y = 445;

const OUTLINE = 'rgba(70,62,50,0.4)';

// ── 8직군 정의 (시안 §4 매핑) ────────────────────────────────────────────────
const CHARACTERS = [
  { id: 'CEO', label: 'CEO', gender: 'm', skin: '#E8B98F', hair: '#3C3835', hairStyle: 'short', top: '#33415E', topDark: '#273248', shirt: '#FAFAF7', bottom: '#2B3650', shoe: '#26221E', tie: '#B04A3E' },
  { id: 'MANAGER', label: '매니저', gender: 'f', skin: '#F0C49B', hair: '#6B4A32', hairStyle: 'bob', top: '#4A4F58', topDark: '#3A3E46', shirt: '#EFEDE6', bottom: '#3A3E46', shoe: '#2A2622' },
  { id: 'DEVELOPER', label: '개발자', gender: 'm', skin: '#E3AE85', hair: '#2E2A26', hairStyle: 'messy', top: '#5E8F5A', topDark: '#4A7347', shirt: '#DDE5DA', bottom: '#4A5361', shoe: '#3A3E46', hood: true },
  { id: 'DESIGNER', label: '디자이너', gender: 'f', skin: '#F2CBA4', hair: '#3A2E28', hairStyle: 'long', top: '#EFE9DC', topDark: '#DCD3C0', shirt: '#EFE9DC', bottom: '#C9A24B', shoe: '#5A4632', skirt: true },
  { id: 'SALES', label: '영업', gender: 'm', skin: '#E8B98F', hair: '#5A422F', hairStyle: 'side', top: '#7FA6C9', topDark: '#6890B5', shirt: '#FAFAF7', bottom: '#3E4A5C', shoe: '#2A2622', tie: '#33415E' },
  { id: 'HR', label: '인사', gender: 'f', skin: '#EEC29B', hair: '#2E2A26', hairStyle: 'ponytail', top: '#D9CBB2', topDark: '#C6B79C', shirt: '#F6F3EC', bottom: '#4A4F58', shoe: '#3A3229' },
  { id: 'MARKETER', label: '마케터', gender: 'f', skin: '#F0C49B', hair: '#7A5238', hairStyle: 'wavy', top: '#D98A7A', topDark: '#C47765', shirt: '#F6EDE8', bottom: '#3D4A66', shoe: '#33291F' },
  { id: 'INTERN', label: '인턴', gender: 'm', skin: '#E3AE85', hair: '#4A3A2C', hairStyle: 'tousled', top: '#5C7A99', topDark: '#4A6684', shirt: '#EDEAE3', bottom: '#5A5148', shoe: '#8A8378' },
];

function rrect(x, y, w, h, r, fill, extra = '') {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r}" fill="${fill}" stroke="${OUTLINE}" stroke-width="1.5" ${extra}/>`;
}

function ellipse(cx, cy, rx, ry, fill, extra = '') {
  return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${OUTLINE}" stroke-width="1.5" ${extra}/>`;
}

function shade(hex, f) {
  if (hex.startsWith('rgba')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (sh) => Math.max(0, Math.min(255, Math.round(((n >> sh) & 255) * f)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** 회전 그룹 (pivot 기준 rotate deg). */
function limb(px, py, deg, inner) {
  return `<g transform="rotate(${deg.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})">${inner}</g>`;
}

/**
 * 프레임 1장. state: 'idle'|'walk', f: 프레임 인덱스.
 * 리그(우향 3/4): 다리→뒷팔→몸통→머리→앞팔 순서로 페인팅.
 */
function buildFrame(ch, state, f) {
  const parts = [];
  const isWalk = state === 'walk';
  const phase = isWalk ? (f / 8) * Math.PI * 2 : (f / 6) * Math.PI * 2;

  // 애니 파라미터
  const legAmp = isWalk ? 26 : 0;
  const armAmp = isWalk ? 22 : 3;
  const bob = isWalk ? 5 * Math.abs(Math.sin(phase)) : 2 * Math.sin(phase);
  const breath = isWalk ? 0 : 1.5 * Math.sin(phase);

  // 신체 치수
  const hipY = FOOT_Y - 150 - bob; // 골반
  const legLen = 148;
  const torsoH = ch.gender === 'f' ? 128 : 136;
  const torsoW = ch.gender === 'f' ? 62 : 72;
  const shoulderY = hipY - torsoH;
  const headR = 36;
  const headCx = FOOT_X + 8; // 3/4 시선 — 약간 전방
  const headCy = shoulderY - headR + 6 - breath * 0.6;

  // 그림자
  parts.push(`<ellipse cx="${FOOT_X}" cy="${FOOT_Y + 6}" rx="52" ry="12" fill="rgba(60,55,45,0.22)"/>`);

  const legW = 24;
  const legSwing = legAmp * Math.sin(phase);
  const shoe = (fill) => `<ellipse cx="0" cy="0" rx="17" ry="9" fill="${fill}" stroke="${OUTLINE}" stroke-width="1.5"/>`;

  function leg(offsetX, deg, dark) {
    const px = FOOT_X + offsetX;
    const col = dark ? shade(ch.bottom, 0.78) : ch.bottom;
    const shoeCol = dark ? shade(ch.shoe, 0.8) : ch.shoe;
    const inner =
      rrect(px - legW / 2, hipY, legW, legLen, 11, col) +
      `<g transform="translate(${px + 4} ${hipY + legLen + 2})">${shoe(shoeCol)}</g>`;
    return limb(px, hipY + 6, deg, inner);
  }
  // 뒷다리(어두움) → 앞다리
  parts.push(leg(-9, -legSwing, true));

  // 뒷팔
  const armW = 19;
  const armLen = 118;
  function arm(offsetX, deg, dark) {
    const px = FOOT_X + offsetX;
    const col = dark ? shade(ch.top, 0.78) : ch.top;
    const handCol = dark ? shade(ch.skin, 0.85) : ch.skin;
    const inner =
      rrect(px - armW / 2, shoulderY + 12, armW, armLen, 9, col) +
      ellipse(px, shoulderY + 12 + armLen + 4, 10, 10, handCol);
    return limb(px, shoulderY + 18, deg, inner);
  }
  parts.push(arm(-torsoW / 2 + 4, armAmp * Math.sin(phase), true));

  // 몸통 (스커트 변형 포함)
  const tx = FOOT_X - torsoW / 2;
  if (ch.skirt) {
    // 스커트: 골반 아래 사다리꼴
    parts.push(
      `<path d="M ${tx + 6} ${hipY - 6} L ${tx + torsoW - 6} ${hipY - 6} L ${tx + torsoW + 6} ${hipY + 52} L ${tx - 6} ${hipY + 52} Z" fill="${ch.bottom}" stroke="${OUTLINE}" stroke-width="1.5"/>`,
    );
  }
  parts.push(rrect(tx, shoulderY, torsoW, torsoH + (ch.skirt ? -2 : 6), 20, ch.top));
  // 상의 셰이딩(우측면)
  parts.push(`<rect x="${(tx + torsoW * 0.62).toFixed(1)}" y="${shoulderY + 4}" width="${(torsoW * 0.34).toFixed(1)}" height="${torsoH - 10}" rx="14" fill="${ch.topDark}" opacity="0.55"/>`);
  // 셔츠 브이넥/후드
  if (ch.hood) {
    parts.push(`<path d="M ${FOOT_X - 20} ${shoulderY + 2} Q ${FOOT_X + 6} ${shoulderY + 26} ${FOOT_X + 30} ${shoulderY + 2} L ${FOOT_X + 22} ${shoulderY - 8} Q ${FOOT_X + 5} ${shoulderY + 8} ${FOOT_X - 12} ${shoulderY - 8} Z" fill="${shade(ch.top, 0.85)}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
  } else {
    parts.push(`<path d="M ${FOOT_X - 12} ${shoulderY + 2} L ${FOOT_X + 8} ${shoulderY + 30} L ${FOOT_X + 26} ${shoulderY + 2} Z" fill="${ch.shirt}" stroke="${OUTLINE}" stroke-width="1.2"/>`);
  }
  if (ch.tie) {
    parts.push(`<path d="M ${FOOT_X + 6} ${shoulderY + 14} l 7 -5 l 5 34 l -9 10 l -6 -12 Z" fill="${ch.tie}"/>`);
  }

  // 머리 + 헤어
  parts.push(ellipse(headCx, headCy, headR, headR + 2, ch.skin));
  // 귀
  parts.push(ellipse(headCx - headR + 4, headCy + 4, 7, 9, ch.skin));
  const H = ch.hair;
  switch (ch.hairStyle) {
    case 'short':
      parts.push(`<path d="M ${headCx - headR} ${headCy - 4} Q ${headCx - headR + 6} ${headCy - headR - 12} ${headCx + 6} ${headCy - headR - 8} Q ${headCx + headR} ${headCy - headR - 2} ${headCx + headR - 2} ${headCy - 10} Q ${headCx + 10} ${headCy - headR + 2} ${headCx - headR + 8} ${headCy - 12} Z" fill="${H}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      break;
    case 'side':
      parts.push(`<path d="M ${headCx - headR} ${headCy - 2} Q ${headCx - headR} ${headCy - headR - 10} ${headCx + 10} ${headCy - headR - 6} Q ${headCx + headR + 2} ${headCy - headR} ${headCx + headR - 4} ${headCy - 14} Q ${headCx} ${headCy - headR + 6} ${headCx - headR + 6} ${headCy - 8} Z" fill="${H}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      break;
    case 'messy':
      parts.push(`<path d="M ${headCx - headR - 2} ${headCy - 2} q -3 -16 8 -20 q 2 -12 14 -12 q 6 -8 16 -5 q 12 -3 16 7 q 10 3 7 15 q 4 8 -2 13 q -4 -10 -14 -12 q -8 -8 -20 -6 q -16 0 -25 20 Z" fill="${H}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      break;
    case 'tousled':
      parts.push(`<path d="M ${headCx - headR - 1} ${headCy - 4} q -2 -15 9 -19 q 3 -11 15 -11 q 7 -9 17 -4 q 11 -3 14 8 q 9 4 6 16 q 3 7 -3 11 q -5 -9 -15 -10 q -9 -7 -19 -5 q -15 1 -24 14 Z" fill="${H}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      break;
    case 'bob':
      parts.push(`<path d="M ${headCx - headR - 5} ${headCy + 16} Q ${headCx - headR - 8} ${headCy - headR - 6} ${headCx + 6} ${headCy - headR - 8} Q ${headCx + headR + 6} ${headCy - headR - 2} ${headCx + headR + 3} ${headCy + 14} L ${headCx + headR - 6} ${headCy + 12} Q ${headCx + headR - 8} ${headCy - 16} ${headCx + 2} ${headCy - 20} Q ${headCx - headR + 4} ${headCy - 16} ${headCx - headR + 5} ${headCy + 14} Z" fill="${H}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      break;
    case 'ponytail':
      parts.push(`<path d="M ${headCx - headR - 2} ${headCy} Q ${headCx - headR} ${headCy - headR - 8} ${headCx + 8} ${headCy - headR - 6} Q ${headCx + headR + 2} ${headCy - headR} ${headCx + headR - 2} ${headCy - 8} Q ${headCx} ${headCy - headR + 4} ${headCx - headR + 6} ${headCy - 8} Z" fill="${H}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      parts.push(`<path d="M ${headCx - headR + 2} ${headCy - 14} q -22 6 -18 40 q 2 12 10 16 q -4 -28 12 -44 Z" fill="${shade(H, 0.9)}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      break;
    case 'long':
      parts.push(`<path d="M ${headCx - headR - 6} ${headCy + 52} Q ${headCx - headR - 12} ${headCy - headR - 4} ${headCx + 4} ${headCy - headR - 10} Q ${headCx + headR + 8} ${headCy - headR - 2} ${headCx + headR + 4} ${headCy + 48} L ${headCx + headR - 8} ${headCy + 44} Q ${headCx + headR - 6} ${headCy - 12} ${headCx} ${headCy - 20} Q ${headCx - headR + 6} ${headCy - 12} ${headCx - headR + 6} ${headCy + 46} Z" fill="${H}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      break;
    case 'wavy':
      parts.push(`<path d="M ${headCx - headR - 6} ${headCy + 34} Q ${headCx - headR - 12} ${headCy + 14} ${headCx - headR - 6} ${headCy - 8} Q ${headCx - headR - 4} ${headCy - headR - 8} ${headCx + 6} ${headCy - headR - 9} Q ${headCx + headR + 6} ${headCy - headR - 2} ${headCx + headR + 5} ${headCy + 10} Q ${headCx + headR + 10} ${headCy + 24} ${headCx + headR} ${headCy + 34} L ${headCx + headR - 9} ${headCy + 28} Q ${headCx + headR - 6} ${headCy - 12} ${headCx + 2} ${headCy - 19} Q ${headCx - headR + 6} ${headCy - 13} ${headCx - headR + 6} ${headCy + 26} Z" fill="${H}" stroke="${OUTLINE}" stroke-width="1.5"/>`);
      break;
  }
  // 눈(우향 시선) + 입
  parts.push(`<circle cx="${headCx + 16}" cy="${headCy + 2}" r="3.4" fill="#3A332C"/>`);
  parts.push(`<circle cx="${headCx - 4}" cy="${headCy + 2}" r="3.4" fill="#3A332C"/>`);
  parts.push(`<path d="M ${headCx + 2} ${headCy + 16} q 6 5 12 0" stroke="#8A6A55" stroke-width="2" fill="none" stroke-linecap="round"/>`);

  // 앞다리·앞팔 (몸 앞)
  parts.push(leg(11, legSwing, false));
  parts.push(arm(torsoW / 2 - 2, -armAmp * Math.sin(phase), false));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME_W} ${FRAME_H}">${parts.join('\n')}</svg>`;
}

/** QA 콘택트시트: 8캐릭터 × [idle0, walk0, walk2, walk4, walk6]. */
function buildContactSheet() {
  const cols = CHARACTERS.length;
  const cells = [['idle', 0], ['walk', 0], ['walk', 2], ['walk', 4], ['walk', 6]];
  const cw = FRAME_W;
  const chh = FRAME_H;
  const parts = [`<rect width="${cols * cw}" height="${cells.length * chh}" fill="#EDEAE3"/>`];
  CHARACTERS.forEach((c, ci) => {
    cells.forEach(([st, f], ri) => {
      const inner = buildFrame(c, st, f)
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>$/, '');
      parts.push(`<g transform="translate(${ci * cw},${ri * chh})">${inner}</g>`);
    });
    parts.push(`<text x="${ci * cw + cw / 2}" y="30" font-family="Arial" font-size="22" font-weight="700" fill="#4A4F58" text-anchor="middle">${c.id}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * cw} ${cells.length * chh}">${parts.join('\n')}</svg>`;
}

module.exports = { CHARACTERS, buildFrame, buildContactSheet, FRAME_W, FRAME_H };
