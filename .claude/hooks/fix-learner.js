/**
 * fix-learner.js — PostToolUse Hook (Bash)
 *
 * fix: 커밋 감지 → diff 분석 → 패턴 추출 → learned-rules.json에 추가
 * 다음부터 같은 실수를 PreToolUse에서 차단
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  // stdin에서 hook 데이터 읽기
  const input = fs.readFileSync('/dev/stdin', 'utf8').trim();
  if (!input) process.exit(0);

  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }

  // Bash 도구의 출력에서 git commit 감지
  const toolOutput = data?.tool_output || data?.output || '';
  const toolInput = data?.tool_input?.command || '';

  // fix: 커밋인지 확인
  const isFixCommit = /git commit.*-m.*["']fix[:(]/.test(toolInput) ||
                      /\[.*\] fix[:(]/.test(toolOutput);

  if (!isFixCommit) process.exit(0);

  // diff 가져오기
  let diff = '';
  try {
    diff = execSync('git diff HEAD~1 --unified=3 --no-color 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000
    });
  } catch { process.exit(0); }

  if (!diff || diff.length < 10) process.exit(0);

  // 패턴 추출: 삭제된 줄(-)과 추가된 줄(+) 분석
  const lines = diff.split('\n');
  const removed = [];
  const added = [];
  let currentFile = '';

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/b\/(.+)$/);
      if (match) currentFile = match[1];
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed.push({ file: currentFile, code: line.slice(1).trim() });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      added.push({ file: currentFile, code: line.slice(1).trim() });
    }
  }

  if (removed.length === 0) process.exit(0);

  // 커밋 메시지에서 설명 추출
  let commitMsg = '';
  try {
    commitMsg = execSync('git log -1 --format=%s 2>/dev/null', {
      encoding: 'utf8',
      timeout: 3000
    }).trim();
  } catch { /* ignore */ }

  // 규칙 생성
  const rule = {
    id: `fix-${Date.now()}`,
    timestamp: new Date().toISOString(),
    commit: commitMsg,
    patterns: removed.slice(0, 5).map(r => ({
      file_pattern: r.file,
      bad_code: r.code,
      description: `fix: 커밋에서 제거된 패턴`
    })),
    files: [...new Set(removed.map(r => r.file))],
    severity: 'block'
  };

  // learned-rules.json에 추가 (프로젝트 로컬)
  const rulesPath = path.join(process.cwd(), '.claude', 'learned-rules.json');
  let rules = [];
  try {
    rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  } catch { /* 새 파일 */ }

  // 중복 방지: 같은 커밋 메시지가 이미 있으면 스킵
  if (rules.some(r => r.commit === commitMsg)) process.exit(0);

  rules.push(rule);

  // 최대 50개 규칙 유지 (오래된 것 제거)
  if (rules.length > 50) rules = rules.slice(-50);

  // .claude/ 폴더 확인
  const claudeDir = path.join(process.cwd(), '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));

  // stderr로 학습 알림 (사용자에게 보이는 메시지)
  process.stderr.write(`\n📚 fix: 패턴 학습됨 — "${commitMsg}" → ${rule.patterns.length}개 규칙 추가\n`);

} catch (e) {
  // 훅 실패해도 세션 차단 금지
  process.exit(0);
}
