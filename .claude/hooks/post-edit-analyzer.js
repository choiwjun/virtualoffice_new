#!/usr/bin/env node
/**
 * PostToolUse[Write|Edit] Hook: Post-Edit Analyzer
 *
 * Detects dangerous patterns in modified code and injects warnings
 * via additionalContext. Catches security issues and bad practices early.
 *
 * Saves: manual code review calls reduced
 */

const path = require('path');
const {
  readStdin,
  outputContext,
  fileExists,
  readFile,
  safeRun
} = require('./lib/utils');

// Dangerous patterns to detect
const DANGEROUS_PATTERNS = [
  { pattern: /eval\s*\(/, label: 'eval() 사용', severity: 'HIGH', message: 'eval()은 코드 인젝션 취약점을 유발합니다. 대안을 사용하세요.' },
  { pattern: /innerHTML\s*=/, label: 'innerHTML 직접 할당', severity: 'HIGH', message: 'innerHTML은 XSS 취약점을 유발합니다. textContent 또는 sanitization을 사용하세요.' },
  { pattern: /dangerouslySetInnerHTML/, label: 'dangerouslySetInnerHTML', severity: 'MEDIUM', message: 'XSS 위험. DOMPurify 등으로 sanitize하세요.' },
  { pattern: /document\.write\s*\(/, label: 'document.write()', severity: 'HIGH', message: 'document.write()는 보안 및 성능 문제를 유발합니다.' },
  { pattern: /(API_KEY|SECRET_KEY|PASSWORD|PRIVATE_KEY)\s*=\s*['"][^'"]+['"]/, label: '하드코딩된 시크릿', severity: 'CRITICAL', message: '시크릿이 하드코딩되어 있습니다! 환경변수를 사용하세요.' },
  { pattern: /console\.(log|debug|info)\s*\(/, label: 'console.log 잔류', severity: 'LOW', message: '프로덕션 코드에서 console.log를 제거하세요.' },
  { pattern: /TODO|FIXME|HACK|XXX/, label: 'TODO/FIXME 주석', severity: 'INFO', message: 'TODO/FIXME 주석이 있습니다. 처리 여부를 확인하세요.' },
  { pattern: /SELECT\s+\*\s+FROM/i, label: 'SELECT * 쿼리', severity: 'MEDIUM', message: 'SELECT *는 성능 문제를 유발합니다. 필요한 컬럼만 선택하세요.' },
  { pattern: /exec\s*\(|subprocess\.call\s*\(.*shell\s*=\s*True/, label: '쉘 명령 실행', severity: 'HIGH', message: '쉘 명령 실행은 커맨드 인젝션 위험이 있습니다.' },
  { pattern: /\.env[^.]/, label: '.env 파일 참조', severity: 'MEDIUM', message: '.env 파일이 코드에 참조되고 있습니다. gitignore에 포함되었는지 확인하세요.' }
];

// File types to skip analysis
const SKIP_EXTENSIONS = ['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.lock', '.svg', '.png', '.jpg', '.gif'];

async function main() {
  const input = await readStdin();
  const toolInput = input.tool_input || {};
  const toolResult = input.tool_result || {};
  const filePath = toolInput.file_path || '';

  if (!filePath) return;

  // Skip non-code files
  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.includes(ext)) return;

  // Read the modified file
  if (!fileExists(filePath)) return;
  const content = readFile(filePath);
  if (!content) return;

  // Analyze for dangerous patterns
  const findings = [];

  for (const { pattern, label, severity, message } of DANGEROUS_PATTERNS) {
    const matches = content.match(new RegExp(pattern.source, pattern.flags + 'g'));
    if (matches) {
      findings.push({
        label,
        severity,
        message,
        count: matches.length
      });
    }
  }

  if (findings.length === 0) return;

  // Sort by severity
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  findings.sort((a, b) => (severityOrder[a.severity] || 5) - (severityOrder[b.severity] || 5));

  const contextParts = [];
  contextParts.push(`## 코드 패턴 경고 (${path.basename(filePath)})\n`);

  for (const f of findings) {
    const icon = f.severity === 'CRITICAL' ? '🚨' :
                 f.severity === 'HIGH' ? '⚠️' :
                 f.severity === 'MEDIUM' ? '⚡' :
                 f.severity === 'LOW' ? '💡' : 'ℹ️';
    contextParts.push(`${icon} **[${f.severity}] ${f.label}** (${f.count}건)`);
    contextParts.push(`   ${f.message}`);
  }

  outputContext(contextParts.join('\n'), 'PostToolUse');
}

safeRun(main);
