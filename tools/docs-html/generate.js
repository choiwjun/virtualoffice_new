#!/usr/bin/env node
/*
 * md-to-html — docs/*.md → docs/_html/*.html 미러 생성기.
 *
 * 대상: docs/{planning(재귀), data-model, deployment, erp-integration, testing}의 모든 .md
 * 산출: docs/_html/<동일 경로>.html (다크 템플릿 + 좌측 TOC h1~h3)
 * 비대상: docs/_html/index.html·planning-report.html·virtual_office_* 팩(수제/외부 산출물) — 덮어쓰지 않음
 *
 * 사용:  cd tools/docs-html && npm install && npm run generate
 * marked 4.3.0 고정 — 렌더러가 문자열 인자 API(v5+ 토큰 API와 비호환)라 업그레이드 시 renderer 재작성 필요.
 */
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, '_html');
const DIRS = ['planning', 'data-model', 'deployment', 'erp-integration', 'testing'];
const TODAY = new Date().toISOString().slice(0, 10);

// 기존 미러(2026-07 세대)와 동일한 템플릿 — 변경 시 전 문서 재생성으로 일괄 적용된다.
const STYLE = `:root{--bg:#0f1115;--panel:#161922;--fg:#e6e9ef;--muted:#9aa3b2;--accent:#6ea8fe;--accent2:#7ee3c7;--border:#262b36;--code:#1b1f29;--th:#1d2230}
@media(prefers-color-scheme:light){:root{--bg:#f7f8fa;--panel:#fff;--fg:#1b2330;--muted:#5b6573;--accent:#2f6fed;--accent2:#0e9f6e;--border:#e3e7ee;--code:#f0f2f6;--th:#eef1f6}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Segoe UI",Roboto,sans-serif;line-height:1.7;font-size:16px}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
nav.toc{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;background:var(--panel);border-right:1px solid var(--border);padding:24px 18px}
nav.toc .brand{font-weight:800;font-size:15px;letter-spacing:.02em;color:var(--accent);margin-bottom:4px}
nav.toc .sub{font-size:12px;color:var(--muted);margin-bottom:18px}
nav.toc a{display:block;color:var(--muted);text-decoration:none;padding:3px 8px;border-radius:6px;font-size:13.5px;border-left:2px solid transparent}
nav.toc a:hover{color:var(--fg);background:rgba(110,168,254,.08)}
nav.toc a.lvl2{padding-left:18px}
nav.toc a.lvl3{padding-left:30px;font-size:12.5px}
nav.toc a.doc{font-weight:700;color:var(--fg);margin-top:14px}
main{padding:48px 56px;max-width:920px;margin:0 auto;width:100%;overflow-x:hidden}
main h1{font-size:30px;font-weight:800;margin:.2em 0 .6em;line-height:1.25}
main h2{font-size:22px;font-weight:750;margin:1.8em 0 .5em;padding-bottom:.3em;border-bottom:1px solid var(--border)}
main h3{font-size:18px;font-weight:700;margin:1.4em 0 .4em}
main h4{font-size:15.5px;font-weight:700;color:var(--muted);margin:1.2em 0 .3em}
main p{margin:.7em 0}
a{color:var(--accent)}
code{background:var(--code);padding:.12em .4em;border-radius:5px;font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:.88em}
pre.code{background:var(--code);border:1px solid var(--border);border-radius:10px;padding:16px 18px;overflow:auto;font-size:13px;line-height:1.55}
pre.code code{background:none;padding:0}
blockquote{margin:1em 0;padding:.6em 1.1em;border-left:3px solid var(--accent);background:rgba(110,168,254,.07);border-radius:0 8px 8px 0;color:var(--fg)}
ul,ol{padding-left:1.4em;margin:.6em 0}
li{margin:.25em 0}
li.task{list-style:none;margin-left:-1.2em}
li.task input{margin-right:.5em}
hr{border:none;border-top:1px solid var(--border);margin:2em 0}
.table-wrap{overflow-x:auto;margin:1em 0;border:1px solid var(--border);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{padding:9px 13px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{background:var(--th);font-weight:700;white-space:nowrap}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:rgba(110,168,254,.05)}
img{max-width:100%;border-radius:8px}
.doc-section{padding-top:8px}
.doc-section+.doc-section{margin-top:24px;border-top:2px dashed var(--border);padding-top:32px}
.meta-foot{margin-top:64px;padding-top:20px;border-top:1px solid var(--border);color:var(--muted);font-size:12.5px}
.idx-card{display:block;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin:10px 0;text-decoration:none;color:var(--fg);transition:.15s}
.idx-card:hover{border-color:var(--accent);transform:translateY(-1px)}
.idx-card .t{font-weight:700;font-size:15px}
.idx-card .p{color:var(--muted);font-size:13px;margin-top:3px}
.idx-group{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:24px 0 6px}
@media(max-width:860px){.layout{grid-template-columns:1fr}nav.toc{position:static;height:auto;border-right:none;border-bottom:1px solid var(--border)}main{padding:28px 20px}}`;

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function walkMd(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walkMd(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

function render(mdPath) {
  const rel = path.relative(DOCS, mdPath).replace(/\\/g, '/'); // planning/00-decisions.md
  const src = fs.readFileSync(mdPath, 'utf8');
  const toc = []; // {level, id, raw}

  const renderer = {
    heading(text, level, raw, slugger) {
      const id = slugger.slug(raw);
      if (level <= 3) toc.push({ level, id, raw });
      return `<h${level} id="${id}">${text}</h${level}>\n`;
    },
    table(header, body) {
      return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`;
    },
    code(code) {
      return `<pre class="code"><code>${escapeHtml(code)}</code></pre>\n`;
    },
    blockquote(quote) {
      // 단일 문단이면 <p> 래퍼 제거(기존 미러 관례)
      const inner = /^<p>[\s\S]*<\/p>\n?$/.test(quote) && !/<\/p>\s*<p>/.test(quote)
        ? quote.replace(/^<p>|<\/p>\n?$/g, '')
        : quote;
      return `<blockquote>${inner}</blockquote>\n`;
    },
    listitem(text, task) {
      return task ? `<li class="task">${text}</li>\n` : `<li>${text}</li>\n`;
    },
    checkbox(checked) {
      return `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
    },
    hr() {
      return '<hr>\n';
    },
  };
  marked.use({ gfm: true, renderer }); // 파일마다 새 renderer 클로저(toc 캡처)로 덮어쓴다

  const body = marked.parse(src);
  const h1 = toc.find((t) => t.level === 1);
  const title = escapeHtml(h1 ? h1.raw : path.basename(rel));
  const tocHtml = toc
    .map((t) => `<a class="lvl${t.level}" href="#${t.id}">${escapeHtml(t.raw)}</a>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${STYLE}
</style>
</head><body>
<div class="layout">
<nav class="toc"><div class="brand">${title}</div><div class="sub">${escapeHtml(path.basename(rel))}</div>${tocHtml}</nav>
<main>${body}<div class="meta-foot">원본: <code>${escapeHtml(path.basename(rel))}</code> · 자동 생성 ${TODAY} · md-to-html</div>
</main>
</div>

</body></html>`;

  const outPath = path.join(OUT, rel.replace(/\.md$/, '.html'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  return rel;
}

let count = 0;
for (const dir of DIRS) {
  const abs = path.join(DOCS, dir);
  if (!fs.existsSync(abs)) continue;
  for (const md of walkMd(abs)) {
    render(md);
    count++;
  }
}
console.log(`md-to-html: ${count}개 문서 재생성 → docs/_html/`);
