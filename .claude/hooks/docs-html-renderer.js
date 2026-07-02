#!/usr/bin/env node
/**
 * PostToolUse[Write|Edit] Hook: Docs HTML Renderer
 *
 * docs/ 하위에 .md 설계 문서가 작성/수정되면, 사람이 보기 좋은 구조적 HTML을
 * docs/_html/ 미러로 조용히 생성하고 index.html을 갱신한다.
 *
 * - 비차단: 항상 조용히 종료(출력 없음). 세션 흐름 방해 X.
 * - 대상: 프로젝트 docs/ 하위 *.md 만. _html/ 산출물·node_modules·전역 스킬 문서는 제외.
 * - 변환기: ./lib/md-to-html.js (의존성 0). mermaid 코드펜스는 HTML에서 다이어그램 렌더.
 *
 * Saves: md를 직접 읽는 불편 → 브라우저로 깔끔히 열람.
 */

const path = require('path');
const fs = require('fs');
const { readStdin, fileExists, safeRun, getProjectDir } = require('./lib/utils');

async function main() {
  const input = await readStdin();
  const toolInput = input.tool_input || {};
  let filePath = toolInput.file_path || '';
  if (!filePath) return;

  // .md 만
  if (!filePath.toLowerCase().endsWith('.md')) return;

  // 절대경로 정규화
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(getProjectDir(), filePath);
  }

  // 경로 정규화 후 세그먼트 검사
  const norm = filePath.split(path.sep);
  // _html 산출물 자체이거나 node_modules면 무시
  if (norm.includes('_html') || norm.includes('node_modules')) return;
  // 전역 스킬/홈 .claude 문서는 렌더하지 않음 (프로젝트 docs만)
  if (norm.includes('.claude') || norm.includes('.agents')) return;

  // docs/ 세그먼트 탐색 → docs 루트 결정
  const docsIdx = norm.lastIndexOf('docs');
  if (docsIdx < 0) return;
  const docsRoot = norm.slice(0, docsIdx + 1).join(path.sep);
  if (!fileExists(filePath)) return;

  // 변환기 로드 (실패해도 조용히 종료)
  let conv;
  try { conv = require('./lib/md-to-html.js'); } catch { return; }

  const outDir = path.join(docsRoot, '_html');
  const rel = path.relative(docsRoot, filePath).replace(/\.md$/i, '.html');
  const htmlPath = path.join(outDir, rel);

  try {
    conv.renderFile(filePath, htmlPath);
    // index.html 재생성 (docs 전체 스캔)
    try { conv.renderDir(docsRoot, outDir); } catch { /* index 실패는 무시, 단일 렌더는 성공 */ }
  } catch {
    // 렌더 실패는 조용히 무시 — 훅은 세션을 막지 않는다
    return;
  }
  // 출력 없음(조용). 링크 안내는 스킬(socrates 등)이 담당.
}

safeRun(main);
