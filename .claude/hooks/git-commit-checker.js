#!/usr/bin/env node
/**
 * PreToolUse[Bash] Hook: Git Commit Checker
 *
 * Validates git commit commands for message quality
 * and prevents bad commits. Integrates defense_in_depth logic.
 *
 * Saves: bad commit fix round-trips eliminated
 */

const {
  readStdin,
  outputDecision,
  outputContext,
  safeRun
} = require('./lib/utils');

// Dangerous command patterns (ported from defense_in_depth.py)
const DANGEROUS_COMMANDS = {
  CRITICAL: [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf *',
    'sudo rm',
    'mkfs',
    'dd if=',
    '> /dev/',
    'chmod -R 777 /'
  ],
  DANGEROUS: [
    'git reset --hard',
    'git clean -fd',
    'git push --force',
    'git push -f',
    'drop database',
    'drop table',
    'truncate',
    'docker system prune -a'
  ]
};

// Bad commit message patterns
const BAD_COMMIT_PATTERNS = [
  { pattern: /^(fix|update|change|wip|test|asdf|temp)$/i, reason: '커밋 메시지가 너무 짧고 모호합니다' },
  { pattern: /^.{1,5}$/i, reason: '커밋 메시지가 5자 미만입니다' },
  { pattern: /^(aaa|bbb|xxx|zzz|123|abc)/i, reason: '의미 없는 커밋 메시지입니다' }
];

function analyzeCommand(command) {
  const cmdLower = command.toLowerCase();

  // Check critical commands
  for (const pattern of DANGEROUS_COMMANDS.CRITICAL) {
    if (cmdLower.includes(pattern.toLowerCase())) {
      return { level: 'CRITICAL', pattern };
    }
  }

  // Check dangerous commands
  for (const pattern of DANGEROUS_COMMANDS.DANGEROUS) {
    if (cmdLower.includes(pattern.toLowerCase())) {
      return { level: 'DANGEROUS', pattern };
    }
  }

  return { level: 'SAFE', pattern: '' };
}

function extractCommitMessage(command) {
  // Match -m "message" or -m 'message'
  const singleQuote = command.match(/-m\s+'([^']+)'/);
  if (singleQuote) return singleQuote[1];

  const doubleQuote = command.match(/-m\s+"([^"]+)"/);
  if (doubleQuote) return doubleQuote[1];

  // Match heredoc pattern: -m "$(cat <<'EOF'\nmessage\nEOF\n)"
  const heredocMatch = command.match(/cat\s*<<['"]?EOF['"]?\n([\s\S]*?)\nEOF/);
  if (heredocMatch) return heredocMatch[1].trim();

  return null;
}

function validateCommitMessage(message) {
  if (!message) return { valid: true, reason: '' };

  const trimmed = message.trim().split('\n')[0]; // First line only

  for (const { pattern, reason } of BAD_COMMIT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason };
    }
  }

  return { valid: true, reason: '' };
}

async function main() {
  const input = await readStdin();
  const toolInput = input.tool_input || {};
  const command = toolInput.command || '';

  if (!command) return;

  // 1. Check for dangerous commands
  const { level, pattern } = analyzeCommand(command);

  if (level === 'CRITICAL') {
    outputDecision('deny', `🚨 CRITICAL 명령 감지: "${pattern}". 이 명령은 실행할 수 없습니다.`);
    return;
  }

  if (level === 'DANGEROUS') {
    outputContext(`⚠️ **위험 명령 감지**: "${pattern}"\n이 명령은 되돌리기 어려울 수 있습니다. 신중하게 진행하세요.`, 'PreToolUse');
    return;
  }

  // 2. Check git commit message quality
  if (command.includes('git commit')) {
    const message = extractCommitMessage(command);
    const { valid, reason } = validateCommitMessage(message);

    if (!valid) {
      outputDecision('deny', `커밋 메시지 품질 불량: ${reason}. 더 설명적인 메시지를 작성하세요.`);
      return;
    }
  }

  // No issues - allow (empty output)
}

safeRun(main);
