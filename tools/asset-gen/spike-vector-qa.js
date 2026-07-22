// spike-vector QA — scene.js를 resvg로 래스터라이즈해 육안 검증 PNG 생성
// 사용: node spike-vector-qa.js [12|24] [day|dusk|night]
const path = require('path');
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');
const scene = require(path.join(__dirname, '..', '..', 'frontend', 'public', 'spike-vector', 'scene.js'));

const n = parseInt(process.argv[2] || '12', 10);
const theme = process.argv[3] || 'day';
const svg = scene.renderSVG(n, theme);
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1520 },
  font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
});
const png = resvg.render().asPng();
const out = path.join(__dirname, 'out', `spike-vector-${n}-${theme}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('WROTE', out, png.length, 'bytes');
