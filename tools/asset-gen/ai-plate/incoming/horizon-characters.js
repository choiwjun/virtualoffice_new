/* HORIZON parametric character renderer v2
 * window.drawCharFrame(ctx, charId, state, frameIndex)
 * 220x460, transparent bg, feet anchor (110,445), facing right.
 * idle 6f @6fps | walk 8f @10fps (heel-strike gait) | sit 6f @4fps (typing, no furniture)
 */
(function () {
  const CHARS = {
    CEO:       { gender: 'm', skin: '#E8B98F', hair: '#3C3835', style: 'crop',     top: '#33415E', bottom: '#2B3650', shirt: '#F4F1E9', tie: '#B04A3E', suit: true, pocketSq: true },
    MANAGER:   { gender: 'f', skin: '#F0C49B', hair: '#6B4A32', style: 'sleekbob', top: '#4A4F58', bottom: '#3A3E46', inner: '#EFE9DC', suit: true },
    DEVELOPER: { gender: 'm', skin: '#E3AE85', hair: '#curly'.replace('#curly','curly'), top: '#5E8F5A', bottom: '#4A5361', hoodie: true, sneaker: true, sole: '#E8E4DA', shoes: '#33302A', hair: '#2E2A26' },
    DESIGNER:  { gender: 'f', skin: '#F2CBA4', hair: '#3A2E28', style: 'curtain',  top: '#EFE9DC', bottom: '#C9A24B', skirt: true, earring: '#C9A24B' },
    SALES:     { gender: 'm', skin: '#E8B98F', hair: '#5A422F', style: 'sidepart', top: '#7FA6C9', bottom: '#3E4A5C', shirt: '#F4F1E9', tie: '#33415E', shacket: true },
    HR:        { gender: 'f', skin: '#EEC29B', hair: '#2E2A26', style: 'lowpony',  top: '#D9CBB2', bottom: '#4A4F58', inner: '#F2EDE2', cardigan: true },
    MARKETER:  { gender: 'f', skin: '#F0C49B', hair: '#7A5238', style: 'lob',      top: '#D98A7A', bottom: '#3D4A66', earring: '#EFE9DC' },
    INTERN:    { gender: 'm', skin: '#E3AE85', hair: '#4A3A2C', style: 'fluff',    top: '#5C7A99', bottom: '#5A5148', shoes: '#8A8378', sneaker: true, sole: '#EFE9DC' }
  };
  CHARS.DEVELOPER.style = 'curly';
  const STATES = { idle: { frames: 6, fps: 6 }, walk: { frames: 8, fps: 10 }, sit: { frames: 6, fps: 4 } };

  function hx3(c) {
    if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    const m = c.match(/(\d+)\D+(\d+)\D+(\d+)/); return [+m[1], +m[2], +m[3]];
  }
  function sh(c, f) { const [r, g, b] = hx3(c); const m = x => Math.max(0, Math.min(255, Math.round(x * f))); return `rgb(${m(r)},${m(g)},${m(b)})`; }
  function grad(ctx, x0, y0, x1, y1, c0, c1) { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; }
  const FK = (a, ang, len) => ({ x: a.x + Math.sin(ang) * len, y: a.y + Math.cos(ang) * len });
  const mx0 = (x) => Math.max(0, x);

  // ---------------- pose ----------------
  function pose(state, f) {
    const F = STATES[state].frames;
    const p = ((f % F) + F) % F / F * Math.PI * 2;
    const o = { p, bob: 0, sway: 0, lean: 0, breath: 0, hipY: 280, hipX: 110, sit: false, tail: 0, shTwist: 0 };
    const legs = {}, arms = {};
    if (state === 'idle') {
      o.breath = Math.sin(p); o.bob = 1.0 * Math.sin(p); o.sway = 1.2 * Math.sin(p); o.lean = 0.010 * Math.sin(p);
      o.tail = 2 * Math.sin(p);
      legs.near = { thigh: 0.04, bend: 0.08, pitch: 0 }; legs.far = { thigh: -0.06, bend: 0.07, pitch: 0 };
      arms.near = { upper: 0.06 + 0.045 * Math.sin(p), bend: 0.22 };
      arms.far = { upper: -0.05 - 0.045 * Math.sin(p), bend: 0.20 };
    } else if (state === 'walk') {
      // heel-strike gait, smooth C1 curves so 8 samples read evenly (no hitch)
      // 접지 보상(통합 패치): 최대 보폭에서 다리 기하 단축만큼 골반 하강 — 없으면 두 발이 뜬다.
      // 보폭 A=0.40으로 낙차 자체를 축소(몸통 바운스 22px→13px, 정상 보행 근사) — 22px는 떨림으로 보임.
      o.bob = 1.4 * (1 - Math.cos(2 * p)) - 1.2 + 10.5 * Math.sin(p) * Math.sin(p); o.lean = 0.075; o.tail = 5 * Math.sin(p);
      o.shTwist = 1.8 * Math.sin(p);
      const A = 0.40;
      const mk = ph => {
        const s = Math.sin(ph);
        const thigh = A * s;
        const swing = mx0(Math.sin(ph - 4.6));
        const bend = 0.07 + 1.05 * swing;
        const pitch = -7 * Math.sin(ph);
        return { thigh, bend, pitch };
      };
      legs.near = mk(p); legs.far = mk(p + Math.PI);
      const S = 0.36;
      arms.near = { upper: -S * Math.sin(p), bend: Math.max(0.16, 0.40 - 0.20 * Math.sin(p)) };
      arms.far = { upper: S * Math.sin(p), bend: Math.max(0.16, 0.40 + 0.20 * Math.sin(p)) };
    } else { // sit
      o.sit = true; o.breath = Math.sin(p); o.bob = 0.9 * Math.sin(p);
      o.hipY = 356; o.hipX = 96; o.lean = 0.11; o.tail = 1.6 * Math.sin(p);
    }
    return { o, legs, arms };
  }

  // ---------------- limbs ----------------
  function limbStroke(ctx, a, b, c, w1, w2, col, far) {
    const base = far ? sh(col, 0.74) : col;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = base;
    ctx.lineWidth = w1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = w2; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    if (!far) {
      ctx.strokeStyle = 'rgba(255,250,238,0.16)'; ctx.lineWidth = w1 * 0.3;
      ctx.beginPath(); ctx.moveTo(a.x - 2, a.y - 1); ctx.lineTo(b.x - 2, b.y - 1); ctx.stroke();
      ctx.strokeStyle = 'rgba(52,40,28,0.10)'; ctx.lineWidth = w2 * 0.3;
      ctx.beginPath(); ctx.moveTo(b.x + 2, b.y + 1); ctx.lineTo(c.x + 2, c.y + 1); ctx.stroke();
    }
  }
  function shoe(ctx, ankle, C, far, pitch) {
    const col = C.shoes || (C.gender === 'f' ? '#453E35' : '#38322C');
    const up = far ? sh(col, 0.75) : col;
    ctx.save();
    ctx.translate(ankle.x, ankle.y);
    ctx.rotate((pitch || 0) * Math.PI / 180);
    if (C.sneaker) {
      const sole = far ? sh(C.sole, 0.8) : C.sole;
      ctx.fillStyle = up;
      ctx.beginPath();
      ctx.moveTo(-7, -4);
      ctx.quadraticCurveTo(-9, 3, -6, 5);
      ctx.lineTo(15, 5);
      ctx.quadraticCurveTo(19, 5, 18, 1);
      ctx.quadraticCurveTo(16, -3, 7, -4.5);
      ctx.quadraticCurveTo(0, -6, -7, -4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = sole;
      ctx.beginPath();
      ctx.moveTo(-8, 4); ctx.lineTo(18.5, 4);
      ctx.quadraticCurveTo(20, 6, 18, 8.5);
      ctx.lineTo(-6, 8.5);
      ctx.quadraticCurveTo(-9, 7, -8, 4);
      ctx.closePath(); ctx.fill();
      if (!far) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-2, -1); ctx.lineTo(6, -2.5); ctx.stroke(); }
    } else {
      // slim loafer / flat
      ctx.fillStyle = up;
      ctx.beginPath();
      ctx.moveTo(-6.5, -3.5);
      ctx.quadraticCurveTo(-8.5, 4, -4, 7);
      ctx.lineTo(13, 7);
      ctx.quadraticCurveTo(19.5, 7, 18.5, 3.5);
      ctx.quadraticCurveTo(17, 0.5, 8, -1.5);
      ctx.quadraticCurveTo(0, -4.5, -6.5, -3.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = far ? sh('#241F1A', 0.9) : '#241F1A';
      ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(18, 6); ctx.lineTo(17.5, 8.2); ctx.lineTo(-5, 8.2); ctx.closePath(); ctx.fill();
      if (!far) { ctx.fillStyle = 'rgba(255,250,238,0.22)'; ctx.beginPath(); ctx.ellipse(2, -0.5, 4.5, 1.6, -0.2, 0, 7); ctx.fill(); }
    }
    ctx.restore();
  }
  function hand(ctx, w, skin, far) {
    ctx.fillStyle = far ? sh(skin, 0.82) : skin;
    ctx.beginPath(); ctx.arc(w.x, w.y, 5.8, 0, 7); ctx.fill();
    if (!far) { ctx.fillStyle = 'rgba(255,250,238,0.22)'; ctx.beginPath(); ctx.arc(w.x - 1.4, w.y - 1.4, 2.3, 0, 7); ctx.fill(); }
  }
  function drawLeg(ctx, C, hip, L, far, sit) {
    const isSkin = !!C.skirt;
    const col = isSkin ? C.skin : C.bottom;
    let knee, ankle, pitch = 0;
    if (sit) {
      knee = { x: hip.x + 68, y: hip.y + 5 };
      ankle = { x: knee.x - 5, y: 432 };
    } else {
      knee = FK(hip, L.thigh, 82);
      ankle = FK(knee, L.thigh - L.bend, 74);
      if (ankle.y > 436) ankle.y = 436;
      pitch = L.pitch || 0;
    }
    // tapered: thigh wide, calf slimmer, cuff
    limbStroke(ctx, hip, knee, ankle, isSkin ? 12.5 : 16, isSkin ? 9.5 : 11.5, col, far);
    if (!isSkin && !far) {
      ctx.strokeStyle = sh(col, 0.72); ctx.lineWidth = 1.2;
      const t = 0.86, cx2 = knee.x + (ankle.x - knee.x) * t, cy2 = knee.y + (ankle.y - knee.y) * t;
      ctx.beginPath(); ctx.moveTo(cx2 - 5, cy2); ctx.lineTo(cx2 + 5, cy2); ctx.stroke();
    }
    shoe(ctx, ankle, C, far, pitch);
  }
  function drawArm(ctx, C, shoulder, A, far, sit, typing, skin) {
    let elbow, wrist;
    if (sit) {
      elbow = FK(shoulder, 0.52, 56);
      wrist = { x: elbow.x + 42, y: elbow.y - 13 + 1.8 * Math.sin(typing * 2.5 + (far ? Math.PI : 0)) };
    } else {
      elbow = FK(shoulder, A.upper, 58);
      wrist = FK(elbow, A.upper + A.bend, 52);
    }
    limbStroke(ctx, shoulder, elbow, wrist, 12.5, 10, C.top, far);
    hand(ctx, wrist, skin, far);
  }

  // ---------------- torso ----------------
  function drawTorso(ctx, C, o, shX, shY, hipX, hipY) {
    const m = C.gender === 'm';
    const shw = m ? 23.5 : 20, hw = m ? 16 : 17.5;
    const waY = shY + 64, waW = m ? 16.5 : 13.5;
    const hemY = hipY + (C.hoodie ? 18 : C.suit || C.cardigan || C.shacket ? 13 : 6);
    ctx.beginPath();
    ctx.moveTo(shX - shw, shY + 9);
    ctx.quadraticCurveTo(shX - shw + 1, shY - 3, shX - shw + 11, shY - 5.5);
    ctx.lineTo(shX + shw - 11, shY - 5.5);
    ctx.quadraticCurveTo(shX + shw - 1, shY - 3, shX + shw, shY + 9);
    ctx.quadraticCurveTo(shX + waW + 3, waY, hipX + hw, hemY - 8);
    ctx.quadraticCurveTo(hipX + hw + 1, hemY, hipX + hw - 4, hemY);
    ctx.lineTo(hipX - hw + 4, hemY);
    ctx.quadraticCurveTo(hipX - hw - 1, hemY, hipX - hw, hemY - 8);
    ctx.quadraticCurveTo(shX - waW - 3, waY, shX - shw, shY + 9);
    ctx.closePath();
    ctx.fillStyle = grad(ctx, shX - shw, shY, hipX + hw, hemY, sh(C.top, 1.09), sh(C.top, 0.82));
    ctx.fill();
    ctx.strokeStyle = sh(C.top, 0.74); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(shX + shw - 3, shY + 15); ctx.quadraticCurveTo(shX + waW + 1, waY, hipX + hw - 4, hemY - 6); ctx.stroke();
    // shoulder seams
    ctx.beginPath(); ctx.moveTo(shX - shw + 10, shY - 4); ctx.lineTo(shX - shw + 6, shY + 8); ctx.stroke();
    // neckline skin
    ctx.fillStyle = sh(C.skin, 0.92);
    ctx.beginPath(); ctx.ellipse(shX + 2, shY - 3, 7, 4.5, 0, 0, 7); ctx.fill();

    if (C.suit || C.cardigan) {
      const inner = C.inner || C.shirt || '#F4F1E9';
      ctx.fillStyle = inner;
      ctx.beginPath(); ctx.moveTo(shX - 6, shY - 4); ctx.lineTo(shX + 10, shY - 4);
      ctx.lineTo(shX + 3.5, shY + (C.cardigan ? 58 : 46)); ctx.closePath(); ctx.fill();
      // slim lapels
      ctx.strokeStyle = sh(C.top, 0.68); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(shX - 6, shY - 3); ctx.lineTo(shX + 1.5, shY + 26); ctx.lineTo(shX + 1, hemY - 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(shX + 10, shY - 3); ctx.lineTo(shX + 4.5, shY + 26); ctx.stroke();
      if (C.suit && m) {
        // shirt collar points
        ctx.fillStyle = C.shirt || '#F4F1E9';
        ctx.beginPath(); ctx.moveTo(shX - 4, shY - 4); ctx.lineTo(shX + 1, shY + 3); ctx.lineTo(shX + 2, shY - 4); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(shX + 8, shY - 4); ctx.lineTo(shX + 3.5, shY + 3); ctx.lineTo(shX + 2.5, shY - 4); ctx.closePath(); ctx.fill();
      }
      if (C.pocketSq) { ctx.fillStyle = '#F4F1E9'; ctx.fillRect(shX - 14, shY + 20, 5, 3); }
      if (C.cardigan) {
        ctx.fillStyle = sh(C.top, 0.66);
        [26, 38, 50].forEach(dy => { ctx.beginPath(); ctx.arc(shX + 2.8, shY + dy, 1.3, 0, 7); ctx.fill(); });
      }
    }
    if (C.tie) {
      ctx.fillStyle = C.tie;
      ctx.beginPath(); ctx.moveTo(shX + 2, shY + 1);
      ctx.lineTo(shX + 6, shY + 12); ctx.lineTo(shX + 2.5, shY + 38) ; ctx.lineTo(shX - 1.5, shY + 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = sh(C.tie, 1.16);
      ctx.beginPath(); ctx.moveTo(shX - 1, shY - 1); ctx.lineTo(shX + 5, shY - 1); ctx.lineTo(shX + 4, shY + 4); ctx.lineTo(shX, shY + 4); ctx.closePath(); ctx.fill();
    }
    if (C.shacket) {
      // shirt-jacket: open front + patch pockets
      ctx.strokeStyle = sh(C.top, 0.7); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(shX + 1, shY + 4); ctx.lineTo(shX + 0.5, hemY - 8); ctx.stroke();
      ctx.strokeStyle = sh(C.top, 0.76); ctx.lineWidth = 1;
      ctx.strokeRect(shX - 15, waY + 6, 9, 10);
      ctx.strokeRect(shX + 7, waY + 6, 9, 10);
    }
    if (C.hoodie) {
      // modern oversized hood behind neck
      ctx.fillStyle = sh(C.top, 0.80);
      ctx.beginPath(); ctx.moveTo(shX - shw + 2, shY + 6);
      ctx.quadraticCurveTo(shX - shw - 6, shY - 16, shX - 6, shY - 17);
      ctx.quadraticCurveTo(shX + 6, shY - 15, shX + 5, shY - 2);
      ctx.quadraticCurveTo(shX - 2, shY + 5, shX - shw + 2, shY + 6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = sh(C.top, 1.18); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(shX - shw + 4, shY + 5); ctx.quadraticCurveTo(shX - 2, shY + 10, shX + 5, shY + 0.5); ctx.stroke();
      // drawstrings
      ctx.strokeStyle = '#EFE9DC'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(shX - 1, shY + 8); ctx.lineTo(shX - 3, shY + 30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(shX + 7, shY + 8); ctx.lineTo(shX + 7, shY + 27); ctx.stroke();
      // kangaroo pocket + ribbed hem
      ctx.strokeStyle = sh(C.top, 0.70); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(hipX - 12, hemY - 24); ctx.quadraticCurveTo(hipX, hemY - 16, hipX + 12, hemY - 24); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hipX - hw + 3, hemY - 5); ctx.lineTo(hipX + hw - 3, hemY - 5); ctx.stroke();
    }
    if (!C.suit && !C.hoodie && !C.cardigan && !C.tie && !C.shacket) {
      ctx.strokeStyle = sh(C.top, 0.74); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(shX + 2, shY - 2, 8, 0.35, Math.PI - 0.35); ctx.stroke();
      if (C.skirt) { ctx.strokeStyle = sh(C.top, 0.8); ctx.beginPath(); ctx.moveTo(shX - waW, waY + 10); ctx.lineTo(shX + waW, waY + 10); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(255,250,238,0.08)';
    ctx.beginPath(); ctx.ellipse(shX - shw / 2, shY + 18, 8, 20, 0.25, 0, 7); ctx.fill();
  }

  function drawPelvis(ctx, C, hipX, hipY, sit) {
    const w = C.gender === 'm' ? 15.5 : 17.5;
    ctx.fillStyle = grad(ctx, hipX - w, hipY - 12, hipX + w, hipY + 16, sh(C.bottom, 1.04), sh(C.bottom, 0.8));
    ctx.beginPath();
    if (sit) {
      ctx.moveTo(hipX - w, hipY - 14); ctx.lineTo(hipX + w + 6, hipY - 12);
      ctx.quadraticCurveTo(hipX + w + 10, hipY + 10, hipX + w, hipY + 14);
      ctx.lineTo(hipX - w + 2, hipY + 16);
      ctx.quadraticCurveTo(hipX - w - 4, hipY + 8, hipX - w, hipY - 14);
    } else {
      ctx.moveTo(hipX - w, hipY - 14); ctx.lineTo(hipX + w, hipY - 14);
      ctx.quadraticCurveTo(hipX + w + 3, hipY + 6, hipX + w - 3, hipY + 14);
      ctx.lineTo(hipX - w + 3, hipY + 14);
      ctx.quadraticCurveTo(hipX - w - 3, hipY + 6, hipX - w, hipY - 14);
    }
    ctx.closePath(); ctx.fill();
  }

  function drawSkirt(ctx, C, o, hipX, hipY) {
    const swing = o.sit ? 0 : (o.tail || 0) * 0.55;
    ctx.fillStyle = grad(ctx, hipX - 20, hipY - 16, hipX + 24, hipY + 54, sh(C.bottom, 1.06), sh(C.bottom, 0.78));
    ctx.beginPath();
    if (o.sit) {
      ctx.moveTo(hipX - 19, hipY - 16);
      ctx.lineTo(hipX + 14, hipY - 16);
      ctx.quadraticCurveTo(hipX + 58, hipY - 12, hipX + 62, hipY + 4);
      ctx.quadraticCurveTo(hipX + 62, hipY + 18, hipX + 50, hipY + 18);
      ctx.lineTo(hipX - 12, hipY + 20);
      ctx.quadraticCurveTo(hipX - 22, hipY + 12, hipX - 19, hipY - 16);
    } else {
      ctx.moveTo(hipX - 16.5, hipY - 16);
      ctx.lineTo(hipX + 16.5, hipY - 16);
      ctx.quadraticCurveTo(hipX + 23 + swing, hipY + 34, hipX + 21 + swing, hipY + 52);
      ctx.quadraticCurveTo(hipX + swing * 0.5, hipY + 58, hipX - 21 + swing, hipY + 52);
      ctx.quadraticCurveTo(hipX - 23 + swing, hipY + 34, hipX - 16.5, hipY - 16);
    }
    ctx.closePath(); ctx.fill();
    // waistband + drape
    ctx.strokeStyle = sh(C.bottom, 0.72); ctx.lineWidth = 1.4;
    if (!o.sit) { ctx.beginPath(); ctx.moveTo(hipX - 16, hipY - 12); ctx.lineTo(hipX + 16, hipY - 12); ctx.stroke(); }
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hipX - 7, hipY - 8); ctx.quadraticCurveTo(hipX - 9 + swing * 0.4, hipY + 22, hipX - 12 + swing, hipY + 48); ctx.stroke();
  }

  // ---------------- head & hair ----------------
  function hairBack(ctx, C, hx, hy, tail) {
    const h = C.hair, st = C.style;
    if (st === 'curtain' || st === 'lob') {
      ctx.fillStyle = sh(h, 0.84);
      ctx.beginPath();
      ctx.moveTo(hx - 24, hy - 24);
      ctx.quadraticCurveTo(hx - 36 - tail * 0.4, hy + 16, hx - 30 - tail, hy + (st === 'lob' ? 52 : 68));
      if (st === 'lob') {
        ctx.quadraticCurveTo(hx - 26 - tail, hy + 62, hx - 18 - tail * 0.6, hy + 56);
        ctx.quadraticCurveTo(hx - 12, hy + 62, hx - 4, hy + 54);
      } else {
        ctx.quadraticCurveTo(hx - 14 - tail * 0.5, hy + 78, hx - 2, hy + 62);
      }
      ctx.quadraticCurveTo(hx + 6, hy + 28, hx + 8, hy - 12);
      ctx.closePath(); ctx.fill();
    } else if (st === 'lowpony') {
      // low sleek tail from nape
      ctx.strokeStyle = sh(h, 0.9); ctx.lineCap = 'round';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(hx - 18, hy + 12);
      ctx.quadraticCurveTo(hx - 30 - tail, hy + 28, hx - 26 - tail * 1.8, hy + 52);
      ctx.stroke();
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(hx - 26 - tail * 1.8, hy + 52);
      ctx.quadraticCurveTo(hx - 24 - tail * 2.2, hy + 62, hx - 28 - tail * 2.4, hy + 68);
      ctx.stroke();
      // band
      ctx.strokeStyle = '#B9A98C'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx - 21, hy + 13); ctx.lineTo(hx - 16, hy + 9); ctx.stroke();
    }
  }
  function head(ctx, C, hx, hy, sit) {
    const gx = sit ? 1.4 : 0, gy = sit ? 1.6 : 0;
    // ear
    ctx.fillStyle = sh(C.skin, 0.88);
    ctx.beginPath(); ctx.ellipse(hx - 18, hy + 6, 4.5, 6, -0.08, 0, 7); ctx.fill();
    if (C.earring) { ctx.fillStyle = C.earring; ctx.beginPath(); ctx.arc(hx - 19, hy + 12.5, 1.6, 0, 7); ctx.fill(); }
    // skull + tapered jaw
    ctx.fillStyle = grad(ctx, hx - 24, hy - 28, hx + 20, hy + 26, sh(C.skin, 1.06), sh(C.skin, 0.88));
    ctx.beginPath();
    ctx.moveTo(hx - 24, hy - 4);
    ctx.quadraticCurveTo(hx - 25, hy - 30, hx + 1, hy - 30);
    ctx.quadraticCurveTo(hx + 24, hy - 29, hx + 24, hy - 2);
    ctx.quadraticCurveTo(hx + 24, hy + 14, hx + 13, hy + 24);
    ctx.quadraticCurveTo(hx + 5, hy + 29, hx - 4, hy + 26);
    ctx.quadraticCurveTo(hx - 22, hy + 18, hx - 24, hy - 4);
    ctx.closePath(); ctx.fill();
    // face
    const f = C.gender === 'f';
    const ex1 = hx + 5 + gx, ex2 = hx + 18.5 + gx, ey = hy + 3 + gy;
    ctx.fillStyle = '#33302A';
    ctx.beginPath(); ctx.ellipse(ex1, ey, 1.9, f ? 3.0 : 2.6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex2, ey, 1.9, f ? 3.0 : 2.6, 0, 0, 7); ctx.fill();
    if (f) { // lash hint
      ctx.strokeStyle = 'rgba(51,48,42,0.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ex1 - 2.4, ey - 2.6); ctx.lineTo(ex1 + 2.2, ey - 3.0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex2 - 2.4, ey - 3.0); ctx.lineTo(ex2 + 2.2, ey - 2.6); ctx.stroke();
    }
    // brows
    ctx.strokeStyle = 'rgba(46,42,38,0.75)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ex1 - 3, ey - 8); ctx.quadraticCurveTo(ex1, ey - 9.5, ex1 + 3, ey - 8.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex2 - 3, ey - 8.6); ctx.quadraticCurveTo(ex2, ey - 9.5, ex2 + 3, ey - 8); ctx.stroke();
    // nose hint
    ctx.strokeStyle = 'rgba(150,100,70,0.45)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(hx + 12 + gx * 0.5, hy + 7 + gy * 0.5); ctx.lineTo(hx + 13.5 + gx * 0.5, hy + 10 + gy * 0.5); ctx.stroke();
    // soft mouth
    ctx.strokeStyle = 'rgba(140,80,60,0.75)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hx + 9 + gx, hy + 16 + gy * 0.6); ctx.quadraticCurveTo(hx + 12.5 + gx, hy + 17.6 + gy * 0.6, hx + 16 + gx, hy + 16.2 + gy * 0.6); ctx.stroke();
    if (f) { ctx.fillStyle = 'rgba(220,130,110,0.13)'; ctx.beginPath(); ctx.ellipse(hx + 18, hy + 11, 3.2, 2, 0, 0, 7); ctx.fill(); }
  }
  function hairFront(ctx, C, hx, hy) {
    const h = C.hair, st = C.style;
    const g = grad(ctx, hx - 26, hy - 36, hx + 22, hy + 2, sh(h, 1.14), sh(h, 0.84));
    ctx.fillStyle = g;
    ctx.beginPath();
    if (st === 'crop') {
      // clean modern crop, crisp front edge, tight sides
      ctx.moveTo(hx - 24.5, hy + 1);
      ctx.quadraticCurveTo(hx - 27, hy - 26, hx - 6, hy - 32.5);
      ctx.quadraticCurveTo(hx + 14, hy - 34, hx + 22, hy - 22);
      ctx.quadraticCurveTo(hx + 24.5, hy - 15, hx + 23.5, hy - 11);
      ctx.lineTo(hx + 20, hy - 13);
      ctx.quadraticCurveTo(hx + 20, hy - 20, hx + 8, hy - 22);
      ctx.quadraticCurveTo(hx - 8, hy - 23, hx - 16, hy - 17);
      ctx.quadraticCurveTo(hx - 21, hy - 12, hx - 21.5, hy + 1);
      ctx.closePath();
    } else if (st === 'sidepart') {
      // sleek side part with sweep
      ctx.moveTo(hx - 24.5, hy + 2);
      ctx.quadraticCurveTo(hx - 28, hy - 27, hx - 4, hy - 33);
      ctx.quadraticCurveTo(hx + 18, hy - 35, hx + 23.5, hy - 20);
      ctx.quadraticCurveTo(hx + 25, hy - 13, hx + 23, hy - 9);
      ctx.quadraticCurveTo(hx + 21, hy - 18, hx + 6, hy - 20.5);
      ctx.lineTo(hx + 4, hy - 24);
      ctx.quadraticCurveTo(hx - 14, hy - 24, hx - 19, hy - 14);
      ctx.quadraticCurveTo(hx - 22, hy - 8, hx - 21.5, hy + 2);
      ctx.closePath();
    } else if (st === 'curly') {
      // textured curly top, tight sides
      ctx.moveTo(hx - 24, hy + 1);
      ctx.quadraticCurveTo(hx - 28, hy - 22, hx - 15, hy - 29);
      ctx.arc(hx - 7, hy - 31, 7, Math.PI * 0.9, Math.PI * 1.85);
      ctx.arc(hx + 6, hy - 33, 7.5, Math.PI * 1.05, Math.PI * 1.98);
      ctx.arc(hx + 17, hy - 27, 7, Math.PI * 1.2, Math.PI * 0.1);
      ctx.quadraticCurveTo(hx + 24, hy - 16, hx + 22, hy - 9);
      ctx.quadraticCurveTo(hx + 19, hy - 17, hx + 8, hy - 20);
      ctx.quadraticCurveTo(hx - 10, hy - 22, hx - 18, hy - 14);
      ctx.quadraticCurveTo(hx - 21.5, hy - 9, hx - 21, hy + 1);
      ctx.closePath();
    } else if (st === 'fluff') {
      // tousled curtain fringe
      ctx.moveTo(hx - 24.5, hy + 2);
      ctx.quadraticCurveTo(hx - 29, hy - 25, hx - 8, hy - 33);
      ctx.quadraticCurveTo(hx + 12, hy - 36, hx + 21, hy - 25);
      ctx.quadraticCurveTo(hx + 25, hy - 17, hx + 23.5, hy - 8);
      ctx.quadraticCurveTo(hx + 22, hy - 14, hx + 16, hy - 17);
      ctx.quadraticCurveTo(hx + 17, hy - 11, hx + 13, hy - 8);
      ctx.quadraticCurveTo(hx + 12, hy - 16, hx + 3, hy - 19);
      ctx.quadraticCurveTo(hx - 12, hy - 21, hx - 18, hy - 13);
      ctx.quadraticCurveTo(hx - 21.5, hy - 8, hx - 21.5, hy + 2);
      ctx.closePath();
    } else if (st === 'sleekbob') {
      // chin-length sleek bob, front longer (A-line)
      ctx.moveTo(hx - 28, hy + 20);
      ctx.quadraticCurveTo(hx - 32, hy - 22, hx - 4, hy - 32.5);
      ctx.quadraticCurveTo(hx + 23, hy - 31, hx + 24.5, hy - 6);
      ctx.quadraticCurveTo(hx + 25.5, hy + 8, hx + 21.5, hy + 21);
      ctx.quadraticCurveTo(hx + 19, hy + 22, hx + 17.5, hy + 20);
      ctx.quadraticCurveTo(hx + 20, hy + 6, hx + 17, hy - 8);
      ctx.quadraticCurveTo(hx + 4, hy - 18, hx - 11, hy - 13);
      ctx.quadraticCurveTo(hx - 20, hy - 9, hx - 20.5, hy + 6);
      ctx.quadraticCurveTo(hx - 21, hy + 16, hx - 28, hy + 20);
      ctx.closePath();
    } else if (st === 'lowpony') {
      // sleek pulled-back crown
      ctx.moveTo(hx - 24, hy + 8);
      ctx.quadraticCurveTo(hx - 28, hy - 24, hx - 2, hy - 31.5);
      ctx.quadraticCurveTo(hx + 22, hy - 30, hx + 23.5, hy - 8);
      ctx.quadraticCurveTo(hx + 18, hy - 18, hx + 4, hy - 20);
      ctx.quadraticCurveTo(hx - 14, hy - 20.5, hx - 19.5, hy - 8);
      ctx.quadraticCurveTo(hx - 21, hy + 2, hx - 24, hy + 8);
      ctx.closePath();
    } else if (st === 'curtain') {
      // middle-part curtain, face-framing strand
      ctx.moveTo(hx - 27, hy + 14);
      ctx.quadraticCurveTo(hx - 32, hy - 24, hx - 4, hy - 33);
      ctx.quadraticCurveTo(hx + 23, hy - 32, hx + 25, hy - 6);
      ctx.quadraticCurveTo(hx + 25.5, hy + 4, hx + 22, hy + 14);
      ctx.quadraticCurveTo(hx + 19.5, hy + 15, hx + 18.5, hy + 12);
      ctx.quadraticCurveTo(hx + 21, hy - 2, hx + 14, hy - 14);
      ctx.quadraticCurveTo(hx + 12.5, hy - 17.5, hx + 10, hy - 19);
      ctx.quadraticCurveTo(hx + 2, hy - 23, hx - 8, hy - 19);
      ctx.quadraticCurveTo(hx - 18, hy - 14, hx - 20, hy - 2);
      ctx.quadraticCurveTo(hx - 21.5, hy + 8, hx - 27, hy + 14);
      ctx.closePath();
    } else { // lob — layered waves to jaw
      ctx.moveTo(hx - 27.5, hy + 18);
      ctx.quadraticCurveTo(hx - 32, hy - 23, hx - 4, hy - 32.5);
      ctx.quadraticCurveTo(hx + 23, hy - 31, hx + 24.5, hy - 5);
      ctx.quadraticCurveTo(hx + 26, hy + 6, hx + 22, hy + 17);
      ctx.quadraticCurveTo(hx + 18.5, hy + 19, hx + 17, hy + 15);
      ctx.quadraticCurveTo(hx + 20.5, hy + 5, hx + 16.5, hy - 9);
      ctx.quadraticCurveTo(hx + 4, hy - 19, hx - 10, hy - 14);
      ctx.quadraticCurveTo(hx - 19.5, hy - 9, hx - 20, hy + 4);
      ctx.quadraticCurveTo(hx - 21, hy + 13, hx - 27.5, hy + 18);
      ctx.closePath();
    }
    ctx.fill();
    // part line / shine
    ctx.strokeStyle = 'rgba(255,248,232,0.30)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(hx - 3, hy - 14, 18, -2.35, -1.55); ctx.stroke();
    if (st === 'sidepart') { ctx.strokeStyle = sh(h, 0.7); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx + 4, hy - 24); ctx.lineTo(hx + 7, hy - 30); ctx.stroke(); }
    if (st === 'curtain') { ctx.strokeStyle = sh(h, 0.72); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx + 1, hy - 23); ctx.lineTo(hx + 1, hy - 31); ctx.stroke(); }
  }

  // ---------------- main ----------------
  function drawCharFrame(ctx, charId, state, frameIndex) {
    const key = String(charId).toUpperCase();
    const C = CHARS[key];
    const st = STATES[state] ? state : 'idle';
    if (!C) { console.warn('[horizon-characters] unknown charId:', charId); return; }
    const { o, legs, arms } = pose(st, frameIndex | 0);

    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const pelvisY = o.hipY + o.bob;
    const pelvisX = o.hipX + o.sway * 0.4;
    const shY = pelvisY - 110 - 1.6 * o.breath;
    const shX = pelvisX + o.sway * 0.6 + o.lean * 55 + o.shTwist * 0;
    const hy = shY - 46 - 0.6 * o.breath;
    const hxx = shX + o.lean * 42 + 3;

    // ground shadow
    const swd = o.sit ? 44 : st === 'walk' ? 40 + 9 * Math.abs(Math.sin(o.p)) : 42;
    const scx = o.sit ? pelvisX + 34 : 110 + o.sway * 0.3;
    const g = ctx.createRadialGradient(scx, 447, 2, scx, 447, swd);
    g.addColorStop(0, 'rgba(60,55,45,0.22)'); g.addColorStop(0.7, 'rgba(60,55,45,0.13)'); g.addColorStop(1, 'rgba(60,55,45,0)');
    ctx.save(); ctx.translate(scx, 447); ctx.scale(1, 0.28); ctx.translate(-scx, -447);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(scx, 447, swd, 0, 7); ctx.fill();
    ctx.restore();

    hairBack(ctx, C, hxx, hy, o.tail);
    drawArm(ctx, C, { x: shX - 15 - o.shTwist, y: shY + 8 }, arms.far, true, o.sit, o.p, C.skin);
    drawLeg(ctx, C, { x: pelvisX - 6, y: pelvisY }, legs.far, true, o.sit);
    if (!C.skirt) drawPelvis(ctx, C, pelvisX, pelvisY, o.sit);
    drawTorso(ctx, C, o, shX, shY, pelvisX, pelvisY);
    drawLeg(ctx, C, { x: pelvisX + 6, y: pelvisY }, legs.near, false, o.sit);
    if (C.skirt) drawSkirt(ctx, C, o, pelvisX, pelvisY - 2);
    drawArm(ctx, C, { x: shX + 15 + o.shTwist, y: shY + 6 }, arms.near, false, o.sit, o.p + 0.9, C.skin);
    // neck
    ctx.strokeStyle = C.skin; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(shX + 2, shY - 2); ctx.lineTo(hxx - 1, hy + 22); ctx.stroke();
    head(ctx, C, hxx, hy, o.sit);
    hairFront(ctx, C, hxx, hy);
    ctx.restore();
  }

  window.drawCharFrame = drawCharFrame;
  window.HORIZON_CHARS = Object.keys(CHARS);
  window.HORIZON_CHAR_SPECS = CHARS;
  window.HORIZON_STATES = STATES;
})();
