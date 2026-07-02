/**
 * fix-blocker.js — PreToolUse Hook (Edit|Write)
 *
 * Edit/Write 전에 learned-rules.json을 확인하여
 * 이전에 fix:로 수정한 패턴이 다시 나타나면 차단 (exit 2 → deny)
 */

const fs = require('fs');
const path = require('path');

try {
  const input = fs.readFileSync('/dev/stdin', 'utf8').trim();
  if (!input) process.exit(0);

  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }

  // Edit/Write의 new_string 또는 content 가져오기
  const newContent = data?.tool_input?.new_string ||
                     data?.tool_input?.content || '';
  const filePath = data?.tool_input?.file_path || '';

  if (!newContent || newContent.length < 5) process.exit(0);

  // learned-rules.json 읽기 (프로젝트 로컬)
  const rulesPath = path.join(process.cwd(), '.claude', 'learned-rules.json');
  let rules = [];
  try {
    rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  } catch {
    process.exit(0); // 규칙 파일 없으면 통과
  }

  if (rules.length === 0) process.exit(0);

  // 각 규칙의 패턴과 비교
  const violations = [];
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const badCode = pattern.bad_code;
      if (!badCode || badCode.length < 3) continue;

      // 빈 줄이나 너무 짧은 패턴은 스킵
      if (badCode.trim().length < 5) continue;

      // 주석이나 import문 같은 범용 패턴은 스킵
      if (/^(import |from |\/\/|#|\/\*|\*|require\()/.test(badCode.trim())) continue;

      // 새 코드에 나쁜 패턴이 포함되어 있는지 확인
      if (newContent.includes(badCode)) {
        violations.push({
          rule_id: rule.id,
          commit: rule.commit,
          bad_code: badCode,
          file_pattern: pattern.file_pattern
        });
      }
    }
  }

  if (violations.length === 0) process.exit(0);

  // 위반 발견 → deny (exit 2 아닌 JSON 응답으로)
  const denyMessage = violations.map(v =>
    `⛔ "${v.commit}" 에서 수정한 패턴 재발견: "${v.bad_code.slice(0, 60)}..."`
  ).join('\n');

  const response = {
    decision: 'deny',
    reason: `이전 fix: 커밋에서 제거한 코드 패턴이 다시 작성되려 합니다.\n\n${denyMessage}\n\n다른 방식으로 구현하세요.`
  };

  process.stdout.write(JSON.stringify(response));
  process.exit(0);

} catch (e) {
  process.exit(0);
}
