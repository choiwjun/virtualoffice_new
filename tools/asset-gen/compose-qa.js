// 합성 QA: 플레이트 + 캐릭터 3인(스폰 위치, 엔진 스케일) — 비율·톤 검증용
'use strict';
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { buildPlate } = require('./src/plate');
const { CHARACTERS, buildFrame } = require('./src/characters');

const { svg: plateSvg, geometry } = buildPlate();
const inner = plateSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const W = 1672, H = 941;
const frac = (ny) => (0.088 + (0.102 - 0.088) * Math.min(1, Math.max(0, (ny - 0.18) / (0.95 - 0.18))));

function place(ch, state, f, nx, ny) {
  const hpx = frac(ny) * H;         // 엔진 표시 높이
  const scale = hpx / 460;
  const w = 220 * scale;
  const x = nx * W - w / 2;
  const y = ny * H - 445 * scale;   // 발 기준점
  const body = buildFrame(ch, state, f).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${scale.toFixed(4)})">${body}</g>`;
}
const s = geometry.spawns;
const chars = [
  place(CHARACTERS[0], 'idle', 0, s.lobby.x, s.lobby.y),
  place(CHARACTERS[2], 'walk', 2, s.work.x, s.work.y),
  place(CHARACTERS[3], 'idle', 0, s.cafe.x, s.cafe.y),
  place(CHARACTERS[5], 'walk', 6, s.meeting.x, s.meeting.y),
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${inner}${chars.join('')}</svg>`;
fs.writeFileSync(path.join(__dirname, 'out', 'composite-qa.png'), new Resvg(svg, { fitTo: { mode: 'width', value: 836 } }).render().asPng());
console.log('out/composite-qa.png');
