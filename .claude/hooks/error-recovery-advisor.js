#!/usr/bin/env node
/**
 * PostToolUseFailure Hook: Error Recovery Advisor
 *
 * Analyzes tool failures and provides recovery suggestions
 * from an error knowledge base. Learns from new errors.
 *
 * Saves: ~1K tokens per failure (repeated retry attempts eliminated)
 */

const path = require('path');
const {
  readStdin,
  outputContext,
  readJson,
  writeJson,
  getGlobalClaudeDir,
  safeRun
} = require('./lib/utils');

// Built-in error patterns and recovery suggestions
const ERROR_KB = {
  // File operation errors
  'ENOENT': {
    category: 'File Not Found',
    suggestion: '파일이 존재하지 않습니다. Glob 도구로 올바른 경로를 확인하세요.'
  },
  'EACCES': {
    category: 'Permission Denied',
    suggestion: '파일 접근 권한이 없습니다. 파일 소유자와 권한을 확인하세요.'
  },
  'EISDIR': {
    category: 'Is Directory',
    suggestion: '디렉토리에 대해 파일 작업을 시도했습니다. 경로를 확인하세요.'
  },

  // Git errors
  'not a git repository': {
    category: 'Git',
    suggestion: '현재 디렉토리가 Git 저장소가 아닙니다. `git init` 또는 올바른 디렉토리로 이동하세요.'
  },
  'merge conflict': {
    category: 'Git Merge',
    suggestion: '병합 충돌이 발생했습니다. 충돌 파일을 수동으로 해결한 후 `git add` 하세요.'
  },
  'nothing to commit': {
    category: 'Git Commit',
    suggestion: '커밋할 변경사항이 없습니다. `git status`로 상태를 확인하세요.'
  },

  // Build errors
  'Module not found': {
    category: 'Import Error',
    suggestion: '모듈을 찾을 수 없습니다. `npm install` 또는 `pip install`로 의존성을 설치하세요.'
  },
  'Cannot find module': {
    category: 'Import Error',
    suggestion: '모듈을 찾을 수 없습니다. 패키지 설치 여부와 import 경로를 확인하세요.'
  },
  'SyntaxError': {
    category: 'Syntax',
    suggestion: '문법 에러입니다. 최근 편집한 파일의 괄호, 따옴표, 세미콜론을 확인하세요.'
  },
  'TypeError': {
    category: 'Type Error',
    suggestion: '타입 에러입니다. 변수의 타입과 함수 인자를 확인하세요.'
  },

  // Network errors
  'ECONNREFUSED': {
    category: 'Connection',
    suggestion: '서버 연결이 거부되었습니다. 서버가 실행 중인지 확인하세요.'
  },
  'ETIMEDOUT': {
    category: 'Timeout',
    suggestion: '연결 시간이 초과되었습니다. 네트워크 상태와 서버 URL을 확인하세요.'
  },

  // Python errors
  'IndentationError': {
    category: 'Python Indent',
    suggestion: '파이썬 들여쓰기 에러입니다. 탭과 스페이스 혼용을 확인하세요.'
  },
  'ImportError': {
    category: 'Python Import',
    suggestion: '파이썬 모듈 임포트 에러입니다. 가상환경 활성화와 패키지 설치를 확인하세요.'
  },

  // Docker errors
  'port is already allocated': {
    category: 'Docker Port',
    suggestion: '포트가 이미 사용 중입니다. `lsof -i :<port>` 로 확인 후 프로세스를 종료하세요.'
  },

  // Test errors
  'Test suite failed': {
    category: 'Test',
    suggestion: '테스트가 실패했습니다. 실패한 테스트의 assertion을 확인하고, 코드 변경사항과 비교하세요.'
  },
  'FAIL': {
    category: 'Test',
    suggestion: '테스트 실패. 에러 메시지의 expected vs received 값을 비교하세요.'
  }
};

function findMatchingError(errorMessage) {
  if (!errorMessage) return null;

  const errorLower = errorMessage.toLowerCase();

  // Search built-in KB
  for (const [pattern, info] of Object.entries(ERROR_KB)) {
    if (errorLower.includes(pattern.toLowerCase())) {
      return { ...info, pattern };
    }
  }

  // Search learned KB
  const learnedKB = loadLearnedKB();
  if (learnedKB) {
    for (const [pattern, info] of Object.entries(learnedKB)) {
      if (errorLower.includes(pattern.toLowerCase())) {
        return { ...info, pattern, learned: true };
      }
    }
  }

  return null;
}

function loadLearnedKB() {
  const kbPath = path.join(getGlobalClaudeDir(), 'cache', 'error-kb.json');
  return readJson(kbPath);
}

function saveToLearnedKB(errorKey, info) {
  const kbPath = path.join(getGlobalClaudeDir(), 'cache', 'error-kb.json');
  const kb = readJson(kbPath) || {};

  // Limit KB size to 100 entries
  const keys = Object.keys(kb);
  if (keys.length >= 100) {
    delete kb[keys[0]]; // Remove oldest
  }

  kb[errorKey] = {
    ...info,
    addedAt: new Date().toISOString()
  };

  writeJson(kbPath, kb);
}

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolError = input.tool_error || input.error || '';
  const toolInput = input.tool_input || {};

  if (!toolError) return;

  const errorStr = typeof toolError === 'string' ? toolError : JSON.stringify(toolError);
  const match = findMatchingError(errorStr);

  const contextParts = [];
  contextParts.push(`## 에러 복구 제안 (${toolName})\n`);

  if (match) {
    contextParts.push(`**카테고리**: ${match.category}`);
    contextParts.push(`**매칭 패턴**: ${match.pattern}`);
    contextParts.push(`**제안**: ${match.suggestion}`);
    if (match.learned) {
      contextParts.push(`*(학습된 에러 패턴)*`);
    }
  } else {
    // No match found - provide generic advice and learn the error
    contextParts.push('**알려지지 않은 에러 패턴**');
    contextParts.push('- 에러 메시지를 주의 깊게 읽으세요');
    contextParts.push('- 같은 명령을 재시도하지 말고 대안을 찾으세요');
    contextParts.push('- 관련 로그 파일을 확인하세요');

    // Extract a key error phrase for learning
    const errorKey = errorStr.substring(0, 50).replace(/[^a-zA-Z가-힣\s]/g, '').trim();
    if (errorKey.length > 5) {
      saveToLearnedKB(errorKey, {
        category: 'Learned',
        suggestion: `이전 세션에서 발생한 에러입니다. 원본 메시지: ${errorStr.substring(0, 200)}`,
        toolName
      });
    }
  }

  outputContext(contextParts.join('\n'), 'PostToolUse');
}

safeRun(main);
