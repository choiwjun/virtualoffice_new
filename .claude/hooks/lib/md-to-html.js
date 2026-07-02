/**
 * md-to-html.js - 의존성 없는 순수 Node Markdown -> 구조적 HTML 변환기
 *
 * 용도: docs/ 밑 설계 문서(.md)를 사람이 보기 좋은 깔끔한 HTML로 렌더.
 * - docs-html-renderer 훅(PostToolUse)과 socrates 등 스킬이 공용으로 사용.
 * - 외부 패키지 0 (hook 환경에서 의존성 설치 불가). fs/path만 사용.
 * - ```mermaid 코드펜스는 mermaid.js(CDN, graceful fallback)로 다이어그램 렌더.
 *
 * CLI:
 *   node md-to-html.js <input.md> [output.html]      # 단일 파일
 *   node md-to-html.js --dir <docsDir> [--out <dir>] # 디렉터리 일괄 + index.html
 *   node md-to-html.js --bundle <docsDir> <out.html> [--title "제목"]  # 여러 md를 1개 리포트로
 *   node md-to-html.js --index <htmlDir>             # index.html만 재생성
 */

'use strict';
const fs = require('fs');
const path = require('path');

// 코드 스팬 보호용 센티넬 (런타임 null - 본문 텍스트와 절대 충돌 안 함, 소스는 순수 ASCII)
const SENT = String.fromCharCode(0);

// ───────────────────────── inline ─────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text) {
  // 코드 스팬을 먼저 placeholder로 보호 (내부 마크업 무시)
  const codes = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push('<code>' + escapeHtml(c) + '</code>');
    return SENT + (codes.length - 1) + SENT;
  });
  t = escapeHtml(t);
  // 이미지 ![alt](src)
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
    (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
  // 링크 [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
    (_, txt, url) => `<a href="${url}">${txt}</a>`);
  // 굵게 **x** / __x__
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
       .replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // 기울임 *x* / _x_
  t = t.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
       .replace(/(^|[^_])_([^_\s][^_]*?)_/g, '$1<em>$2</em>');
  // 취소선 ~~x~~
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // 코드 스팬 복원
  t = t.replace(new RegExp(SENT + '(\\d+)' + SENT, 'g'), (_, i) => codes[+i]);
  return t;
}

function slugify(text, used) {
  let base = text.toLowerCase().trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w가-힣\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'section';
  let slug = base, n = 1;
  while (used.has(slug)) slug = base + '-' + (++n);
  used.add(slug);
  return slug;
}

// ───────────────────────── block parser ─────────────────────────
function stripFrontmatter(md) {
  if (!md.startsWith('---')) return { meta: null, body: md };
  const end = md.indexOf('\n---', 3);
  if (end < 0) return { meta: null, body: md };
  const fm = md.slice(3, end).trim();
  const body = md.slice(md.indexOf('\n', end + 1) + 1);
  return { meta: fm, body };
}

function mdToBlocks(md) {
  const { body } = stripFrontmatter(md);
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const usedSlugs = new Set();
  let i = 0;
  let title = null;
  let mermaidCount = 0;

  const flushPara = (buf) => {
    if (buf.length) out.push('<p>' + renderInline(buf.join(' ')) + '</p>');
  };

  let para = [];
  while (i < lines.length) {
    let line = lines[i];

    // fenced code
    const fence = line.match(/^(\s*)(```|~~~)(.*)$/);
    if (fence) {
      flushPara(para); para = [];
      const marker = fence[2];
      const lang = (fence[3] || '').trim().split(/\s+/)[0];
      const code = [];
      i++;
      while (i < lines.length && !lines[i].match(new RegExp('^\\s*' + marker))) {
        code.push(lines[i]); i++;
      }
      i++; // skip closing fence
      if (lang === 'mermaid') {
        mermaidCount++;
        out.push('<div class="mermaid">' + escapeHtml(code.join('\n')) + '</div>');
      } else {
        out.push('<pre class="code' + (lang ? ' lang-' + lang : '') +
          '"><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
      }
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(para); para = [];
      const level = h[1].length;
      const raw = h[2].replace(/\s+#+\s*$/, '');
      const inline = renderInline(raw);
      const id = slugify(raw, usedSlugs);
      if (level <= 3) headings.push({ level, text: raw.replace(/<[^>]+>/g, ''), id });
      if (!title && level === 1) title = raw.replace(/[*_`]/g, '');
      out.push(`<h${level} id="${id}">${inline}</h${level}>`);
      i++; continue;
    }

    // hr
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushPara(para); para = [];
      out.push('<hr>'); i++; continue;
    }

    // table (header | --- | rows)
    if (line.includes('|') && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara(para); para = [];
      const splitRow = (r) => {
        let s = r.trim().replace(/^\|/, '').replace(/\|$/, '');
        const cells = []; let cur = ''; let esc = false;
        for (const ch of s) {
          if (esc) { cur += ch; esc = false; }
          else if (ch === '\\') esc = true;
          else if (ch === '|') { cells.push(cur); cur = ''; }
          else cur += ch;
        }
        cells.push(cur);
        return cells.map(c => c.trim());
      };
      const aligns = splitRow(lines[i + 1]).map(c => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i])); i++;
      }
      let tbl = '<div class="table-wrap"><table><thead><tr>';
      head.forEach((c, k) => {
        tbl += `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${renderInline(c)}</th>`;
      });
      tbl += '</tr></thead><tbody>';
      for (const row of rows) {
        tbl += '<tr>';
        head.forEach((_, k) => {
          tbl += `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${renderInline(row[k] || '')}</td>`;
        });
        tbl += '</tr>';
      }
      tbl += '</tbody></table></div>';
      out.push(tbl);
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      flushPara(para); para = [];
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, '')); i++;
      }
      out.push('<blockquote>' + renderInline(q.join(' ')) + '</blockquote>');
      continue;
    }

    // list (ul/ol) with simple nesting by indent
    const listM = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (listM) {
      flushPara(para); para = [];
      out.push(parseList(lines, { i }, setI => { i = setI; }));
      continue;
    }

    // blank
    if (line.trim() === '') { flushPara(para); para = []; i++; continue; }

    // paragraph accumulation
    para.push(line.trim());
    i++;
  }
  flushPara(para);

  return { html: out.join('\n'), headings, title, mermaidCount };
}

// 들여쓰기 기반 단순 중첩 리스트 파서
function parseList(lines, ref, setBack) {
  let i = ref.i;
  const baseIndent = (lines[i].match(/^(\s*)/)[1] || '').length;
  const ordered = /^\s*\d+[.)]/.test(lines[i]);
  let html = ordered ? '<ol>' : '<ul>';
  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m) {
      if (lines[i].trim() === '') { i++; continue; }
      break;
    }
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // 중첩 - 마지막 li 안에 하위 리스트
      const sub = parseList(lines, { i }, ni => { i = ni; });
      html = html.replace(/<\/li>$/, sub + '</li>');
      continue;
    }
    // task list checkbox
    let content = m[3];
    let cb = '';
    const taskM = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (taskM) {
      cb = `<input type="checkbox" disabled${/[xX]/.test(taskM[1]) ? ' checked' : ''}> `;
      content = taskM[2];
    }
    html += '<li' + (cb ? ' class="task"' : '') + '>' + cb + renderInline(content) + '</li>';
    i++;
  }
  html += ordered ? '</ol>' : '</ul>';
  setBack(i);
  return html;
}

// ───────────────────────── document shell ─────────────────────────
const CSS = `
:root{--bg:#0f1115;--panel:#161922;--fg:#e6e9ef;--muted:#9aa3b2;--accent:#6ea8fe;--accent2:#7ee3c7;--border:#262b36;--code:#1b1f29;--th:#1d2230}
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
@media(max-width:860px){.layout{grid-template-columns:1fr}nav.toc{position:static;height:auto;border-right:none;border-bottom:1px solid var(--border)}main{padding:28px 20px}}
`;

const MERMAID_SNIPPET = `
<script type="module">
try{
  const m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  m.default.initialize({startOnLoad:true, theme: dark?'dark':'default', securityLevel:'loose'});
}catch(e){
  document.querySelectorAll('.mermaid').forEach(el=>{
    const pre=document.createElement('pre');pre.className='code';
    pre.textContent=el.textContent;el.replaceWith(pre);
  });
}
</script>`;

function tocHtml(headings, brand, sub) {
  let h = `<div class="brand">${escapeHtml(brand || '설계 문서')}</div>`;
  if (sub) h += `<div class="sub">${escapeHtml(sub)}</div>`;
  for (const x of headings) {
    h += `<a class="lvl${x.level}${x.doc ? ' doc' : ''}" href="#${x.id}">${escapeHtml(x.text)}</a>`;
  }
  return h;
}

function htmlDocument({ title, bodyHtml, headings, hasMermaid, brand, sub, footer }) {
  const safeTitle = escapeHtml(title || '설계 문서');
  return `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${CSS}</style>
</head><body>
<div class="layout">
<nav class="toc">${tocHtml(headings, brand || safeTitle, sub)}</nav>
<main>${bodyHtml}
<div class="meta-foot">${footer || ''}</div>
</main>
</div>
${hasMermaid ? MERMAID_SNIPPET : ''}
</body></html>`;
}

function nowStamp() {
  // 이식성: 환경변수 우선, 없으면 렌더 시점 날짜(산출물 메타에만 사용)
  return process.env.CLABS_DOC_DATE || new Date().toISOString().slice(0, 10);
}

// ───────────────────────── public API ─────────────────────────
function renderFile(mdPath, htmlPath) {
  const md = fs.readFileSync(mdPath, 'utf8');
  const { html, headings, title, mermaidCount } = mdToBlocks(md);
  const doc = htmlDocument({
    title: title || path.basename(mdPath, '.md'),
    bodyHtml: html, headings, hasMermaid: mermaidCount > 0,
    sub: path.basename(mdPath),
    footer: `원본: <code>${escapeHtml(path.basename(mdPath))}</code> · 자동 생성 ${nowStamp()} · md-to-html`
  });
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, doc, 'utf8');
  return htmlPath;
}

function listMd(dir) {
  const result = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === '_html' || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.toLowerCase().endsWith('.md')) result.push(full);
    }
  };
  walk(dir);
  return result.sort();
}

// 여러 md를 1개 구조적 리포트로 (socrates 기획 결과용)
function bundle(mdPaths, outPath, title) {
  const headings = [];
  const sections = [];
  const usedSlugs = new Set();
  let anyMermaid = false;
  for (const mp of mdPaths) {
    const md = fs.readFileSync(mp, 'utf8');
    const parsed = mdToBlocks(md);
    if (parsed.mermaidCount) anyMermaid = true;
    const docTitle = parsed.title || path.basename(mp, '.md');
    let sid = docTitle.toLowerCase().replace(/[^\w가-힣]+/g, '-').replace(/^-|-$/g, '') || 'doc';
    let base = sid, n = 1; while (usedSlugs.has(sid)) sid = base + '-' + (++n); usedSlugs.add(sid);
    headings.push({ level: 1, text: docTitle, id: sid, doc: true });
    for (const hd of parsed.headings) if (hd.level === 2) headings.push({ level: 2, text: hd.text, id: hd.id });
    sections.push(`<section class="doc-section" id="${sid}">\n${parsed.html}\n</section>`);
  }
  const doc = htmlDocument({
    title: title || '기획 리포트',
    brand: title || '기획 리포트',
    sub: `${mdPaths.length}개 문서 · ${nowStamp()}`,
    bodyHtml: sections.join('\n'),
    headings, hasMermaid: anyMermaid,
    footer: `통합 리포트 · 원본 ${mdPaths.length}개 md · 자동 생성 ${nowStamp()}`
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, doc, 'utf8');
  return outPath;
}

// docs 디렉터리 -> _html 미러 일괄 렌더 + index.html
function renderDir(docsDir, outDir) {
  outDir = outDir || path.join(docsDir, '_html');
  const mds = listMd(docsDir);
  const entries = [];
  for (const mp of mds) {
    const rel = path.relative(docsDir, mp).replace(/\.md$/i, '.html');
    const out = path.join(outDir, rel);
    renderFile(mp, out);
    entries.push({ rel, src: path.relative(docsDir, mp) });
  }
  buildIndex(outDir, entries, docsDir);
  return { count: mds.length, outDir };
}

function buildIndex(outDir, entries, docsDir) {
  if (!entries) {
    // 디렉터리에서 기존 html 수집
    entries = [];
    const walk = (d, baseRel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'index.html') continue;
        const full = path.join(d, e.name);
        const rel = path.posix.join(baseRel, e.name);
        if (e.isDirectory()) walk(full, rel);
        else if (e.name.endsWith('.html')) entries.push({ rel, src: rel.replace(/\.html$/, '.md') });
      }
    };
    if (fs.existsSync(outDir)) walk(outDir, '');
  }
  // 폴더별 그룹핑
  const groups = {};
  for (const e of entries) {
    const g = path.dirname(e.rel) === '.' ? '(루트)' : path.dirname(e.rel);
    (groups[g] = groups[g] || []).push(e);
  }
  let body = '<h1>설계 문서 인덱스</h1><p>docs 하위 Markdown 문서를 구조적 HTML로 자동 렌더한 목록입니다.</p>';
  const tocH = [];
  for (const g of Object.keys(groups).sort()) {
    const gid = slugify(g, new Set());
    body += `<div class="idx-group" id="g-${gid}">${escapeHtml(g)}</div>`;
    tocH.push({ level: 1, text: g, id: 'g-' + gid, doc: true });
    for (const e of groups[g].sort((a, b) => a.rel.localeCompare(b.rel))) {
      const name = path.basename(e.rel, '.html');
      const href = e.rel.split(path.sep).join('/');
      const src = e.src.split(path.sep).join('/');
      body += `<a class="idx-card" href="./${href}"><div class="t">${escapeHtml(name)}</div><div class="p">${escapeHtml(src)}</div></a>`;
    }
  }
  const doc = htmlDocument({
    title: '설계 문서 인덱스', brand: '📐 설계 문서', sub: (docsDir ? path.basename(docsDir) : 'docs') + ' · ' + nowStamp(),
    bodyHtml: body, headings: tocH, hasMermaid: false,
    footer: `총 ${entries.length}개 문서 · 자동 생성 ${nowStamp()}`
  });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), doc, 'utf8');
  return path.join(outDir, 'index.html');
}

module.exports = { renderFile, renderDir, bundle, buildIndex, mdToBlocks, listMd };

// ───────────────────────── CLI ─────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  try {
    if (argv[0] === '--dir') {
      const dir = argv[1];
      const outIdx = argv.indexOf('--out');
      const out = outIdx >= 0 ? argv[outIdx + 1] : null;
      const r = renderDir(dir, out);
      console.log(`rendered ${r.count} docs -> ${r.outDir}/ (+ index.html)`);
    } else if (argv[0] === '--bundle') {
      const dir = argv[1], out = argv[2];
      const tIdx = argv.indexOf('--title');
      const title = tIdx >= 0 ? argv[tIdx + 1] : null;
      const mds = listMd(dir);
      bundle(mds, out, title);
      console.log(`bundled ${mds.length} docs -> ${out}`);
    } else if (argv[0] === '--index') {
      const out = buildIndex(argv[1]);
      console.log(`index -> ${out}`);
    } else if (argv[0]) {
      const inp = argv[0];
      const out = argv[1] || inp.replace(/\.md$/i, '.html');
      renderFile(inp, out);
      console.log(`rendered -> ${out}`);
    } else {
      console.log('usage: md-to-html.js <in.md> [out.html] | --dir <docsDir> [--out <dir>] | --bundle <docsDir> <out.html> [--title T] | --index <htmlDir>');
    }
  } catch (e) {
    console.error('md-to-html error:', e.message);
    process.exit(1);
  }
}
