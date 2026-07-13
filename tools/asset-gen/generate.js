/**
 * generate.js — 에셋 생성 CLI (D30, 17-asset-rework-spec).
 *
 *   node generate.js plate            → out/plate-preview.png(836px, QA용) + out/layout.json
 *   node generate.js plate --final    → ../../frontend/public/office2d/plates/horizon.png (3344px @2x)
 *   node generate.js chars            → out/chars-sheet.png (콘택트시트 QA용)
 *   node generate.js chars --final    → ../../frontend/public/office2d/characters/{ID}/{state}_{nn}.png
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const OUT = path.join(__dirname, 'out');
const PUB = path.join(__dirname, '..', '..', 'frontend', 'public', 'office2d');

function renderPng(svg, widthPx) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: widthPx } });
  return r.render().asPng();
}

function main() {
  const mode = process.argv[2] || 'plate';
  const final = process.argv.includes('--final');
  fs.mkdirSync(OUT, { recursive: true });

  if (mode === 'plate' || mode === 'all') {
    const { buildPlate } = require('./src/plate');
    const { svg, geometry } = buildPlate();
    fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(geometry, null, 2));
    fs.writeFileSync(path.join(OUT, 'plate.svg'), svg);
    if (final) {
      fs.mkdirSync(path.join(PUB, 'plates'), { recursive: true });
      fs.writeFileSync(path.join(PUB, 'plates', 'horizon.png'), renderPng(svg, 3344));
      console.log('plate → frontend/public/office2d/plates/horizon.png (3344px)');
    } else {
      fs.writeFileSync(path.join(OUT, 'plate-preview.png'), renderPng(svg, 836));
      console.log('plate → out/plate-preview.png (836px) + out/layout.json');
    }
  }

  if (mode === 'chars' || mode === 'all') {
    const { CHARACTERS, buildFrame, buildContactSheet } = require('./src/characters');
    if (final) {
      for (const ch of CHARACTERS) {
        const dir = path.join(PUB, 'characters', ch.id);
        fs.mkdirSync(dir, { recursive: true });
        for (const state of ['idle', 'walk']) {
          const n = state === 'idle' ? 6 : 8;
          for (let f = 0; f < n; f++) {
            const svg = buildFrame(ch, state, f);
            fs.writeFileSync(path.join(dir, `${state}_${String(f).padStart(2, '0')}.png`), renderPng(svg, 220));
          }
        }
        console.log(`chars → ${ch.id} (idle 6 + walk 8)`);
      }
    } else {
      fs.writeFileSync(path.join(OUT, 'chars-sheet.png'), renderPng(buildContactSheet(), 1400));
      console.log('chars → out/chars-sheet.png');
    }
  }
}

main();
