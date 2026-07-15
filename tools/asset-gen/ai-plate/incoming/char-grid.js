/* <char-grid> — 8 chars x 3 states QA preview grid for horizon-characters.js */
(function () {
  class CharGrid extends HTMLElement {
    connectedCallback() {
      if (this._init) return; this._init = true;
      const s = document.createElement('script');
      s.src = new URL('horizon-characters.js', document.baseURI).href;
      s.onload = () => this.build();
      document.head.appendChild(s);
    }
    build() {
      const CHARS = window.HORIZON_CHARS, STATES = window.HORIZON_STATES;
      this.style.cssText = 'display:block;';
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:28px;';
      this.cells = [];
      for (const state of Object.keys(STATES)) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:14px;align-items:flex-end;';
        const tag = document.createElement('div');
        tag.style.cssText = 'writing-mode:vertical-rl;transform:rotate(180deg);font:600 12px system-ui;color:#8A8071;letter-spacing:2px;text-transform:uppercase;padding-bottom:26px;';
        tag.textContent = state + ' · ' + STATES[state].frames + 'f @' + STATES[state].fps + 'fps';
        row.appendChild(tag);
        for (const id of CHARS) {
          const cell = document.createElement('div');
          cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';
          const cv = document.createElement('canvas');
          cv.width = 220; cv.height = 460;
          cv.style.cssText = 'width:110px;height:230px;border-radius:8px;' +
            'background:repeating-conic-gradient(#E4DFD4 0% 25%, #EDEAE3 0% 50%) 0 0/20px 20px;';
          const lab = document.createElement('div');
          lab.style.cssText = 'font:600 11px system-ui;color:#6E6555;letter-spacing:1px;';
          lab.textContent = id;
          cell.appendChild(cv); cell.appendChild(lab); row.appendChild(cell);
          this.cells.push({ cv, ctx: cv.getContext('2d'), id, state, last: -1 });
        }
        wrap.appendChild(row);
      }
      this.appendChild(wrap);
      const tick = () => {
        const t = performance.now() / 1000;
        for (const c of this.cells) {
          const S = STATES[c.state];
          const f = Math.floor(t * S.fps) % S.frames;
          if (f !== c.last) {
            c.last = f;
            c.ctx.clearRect(0, 0, 220, 460);
            window.drawCharFrame(c.ctx, c.id, c.state, f);
          }
        }
        this._raf = requestAnimationFrame(tick);
      };
      tick();
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); }
  }
  if (!customElements.get('char-grid')) customElements.define('char-grid', CharGrid);
})();
