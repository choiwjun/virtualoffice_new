#!/usr/bin/env node
/**
 * UserPromptSubmit Hook: Skill Router
 *
 * Analyzes user input to identify relevant skills and injects
 * their key context via additionalContext, eliminating manual skill lookup.
 *
 * Saves: ~1K-3K tokens per prompt (skill exploration round-trips eliminated)
 */

const path = require('path');
const {
  readStdin,
  outputContext,
  fileExists,
  readFile,
  getClaudeDir,
  getGlobalClaudeDir,
  parseFrontmatter,
  extractKeySections,
  safeRun
} = require('./lib/utils');

// Expanded skill definitions with Korean + English keywords (ported from skill_evaluator.py)
const SKILL_DEFINITIONS = {
  'socrates': {
    description: 'Use when starting a new project, defining requirements, or planning features. 소크라테스식 심층 기획.',
    keywords: ['요구사항', '기획', '기획서', '스펙', '명세서', '분석', '정리해', '계획', 'requirements', 'planning', 'spec', 'specification', '소크라테스'],
    priority: 10
  },
  'screen-spec': {
    description: '화면별 YAML v2.0 명세 생성',
    keywords: ['화면 명세', '스크린 스펙', '화면 설계', 'screen spec', 'YAML 명세', '화면별', '화면 정의'],
    priority: 9
  },
  'tasks-generator': {
    description: '화면 단위 + 연결점 검증 TASKS.md',
    keywords: ['태스크', 'TASKS.md', '태스크 생성', '작업 분해', 'tasks', 'task generation'],
    priority: 9
  },
  'project-bootstrap': {
    description: '에이전트 팀 + 풀스택 프로젝트 셋업',
    keywords: ['에이전트 팀', '팀 만들어', '팀 구성', '팀 생성', '프로젝트 셋업', '프로젝트 설정', 'agent team', 'create team', 'setup project', 'bootstrap'],
    priority: 10
  },
  'neurion': {
    description: 'AI + 사용자 공동 브레인스토밍',
    keywords: ['브레인스토밍', '아이디어', '뉴리온', 'brainstorm', 'ideation', 'neurion'],
    priority: 8
  },
  'odysseus': {
    description: '오디세우스 전략 오케스트레이터',
    keywords: ['오디세우스', 'odysseus', '전략', 'strategy', '정찰'],
    priority: 6
  },
  'eureka': {
    description: 'AI 재귀적 사고로 MVP 제안',
    keywords: ['유레카', 'MVP', '재귀적 사고', 'eureka', '아이디어 발견'],
    priority: 7
  },
  'desktop-bridge': {
    description: 'Desktop + CLI 하이브리드 워크플로우',
    keywords: ['데스크탑 브릿지', 'desktop bridge', '하이브리드', 'hybrid', 'publish', 'implement'],
    priority: 7
  },
  'auto-orchestrate': {
    description: '완전 자동화 개발 + Phase Checkpoint',
    keywords: ['오케스트레이트', '자동화', '자동 개발', 'orchestrate', 'auto orchestrate', '완전 자동화', '오토'],
    priority: 10
  },
  'ultra-thin-orchestrate': {
    description: '200개 태스크도 컴팩팅 없이 처리',
    keywords: ['울트라 씬', 'ultra thin', '대규모 태스크', '200개'],
    priority: 9
  },
  'ralph-loop': {
    description: '완료될 때까지 끝까지 반복',
    keywords: ['랄프', 'ralph', '반복', '끝까지', 'loop'],
    priority: 7
  },
  'trinity': {
    description: '五柱(眞善美孝永) 코드 품질 평가',
    keywords: ['트리니티', 'trinity', '품질 평가', '오주', '코드 품질'],
    priority: 7
  },
  'code-review': {
    description: 'Use when a task is complete, a feature is implemented, or before merging. 2-Stage Review (Spec Compliance → Code Quality).',
    keywords: ['리뷰', '검토', '코드 리뷰', '확인해', 'review', 'code review', 'check code'],
    priority: 7
  },
  'cogito': {
    description: '바이브코딩 코기토',
    keywords: ['코기토', 'cogito', '바이브코딩', '방법적 의심'],
    priority: 6
  },
  'vercel-review': {
    description: 'React/Next.js 성능 최적화',
    keywords: ['vercel', '버셀', 'next.js 성능', 'react 성능', '성능 최적화'],
    priority: 6
  },
  'verification-before-completion': {
    description: 'Use when claiming work is done, tests pass, or a fix works. Evidence before claims.',
    keywords: ['검증', '완료 전', 'verification', 'verify'],
    priority: 7
  },
  'systematic-debugging': {
    description: 'Use when encountering bugs, test failures, unexpected behavior, or flaky tests. 4-phase root cause analysis.',
    keywords: ['디버그', '디버깅', '버그', '에러', '오류', '고쳐', '수정해', 'debug', 'bug', 'error', 'fix', 'troubleshoot'],
    priority: 8
  },
  'powerqa': {
    description: '자동 QA 사이클링 (최대 5회)',
    keywords: ['QA', '품질 보증', 'powerqa', '자동 테스트'],
    priority: 7
  },
  'poietes': {
    description: '에로스 사이클 기반 기획 컨설팅',
    keywords: ['포이에시스', 'poietes', '에로스 기획', '결핍 기획'],
    priority: 6
  },
  'reverse': {
    description: '코드 → 명세 역추출',
    keywords: ['역추출', '리버스', 'reverse', '코드에서 명세', '역공학'],
    priority: 6
  },
  'sync': {
    description: '명세-코드 동기화 검증',
    keywords: ['동기화', '싱크', 'sync', '명세 코드'],
    priority: 6
  },
  'cost-router': {
    description: 'AI 비용 40-70% 절감',
    keywords: ['비용', '비용 절감', 'cost', 'cost router', '비용 라우터'],
    priority: 5
  },
  'token-optimizer': {
    description: '토큰 60-90% 절감 (출력 압축 + 에이전트 안전)',
    keywords: ['토큰', '토큰 절감', '토큰 최적화', '출력 압축', '출력 줄이기', 'token', 'token optimizer', '토큰 세이버'],
    priority: 5
  },
  'quality': {
    description: '멀티모드 품질 검증 (check/review/security/full)',
    keywords: ['품질', '검증해', '체크해', '리뷰해', '보안 검사', 'quality', 'check', 'lint', '린트'],
    priority: 6
  },
  'chrome-browser': {
    description: '브라우저 제어 및 테스트 자동화',
    keywords: ['브라우저', '크롬', 'chrome', 'browser', '웹 테스트'],
    priority: 6
  },
  'design-linker': {
    description: '목업 디자인 태스크 연결',
    keywords: ['디자인 링크', '목업', 'mockup', 'design linker', '디자인 연결'],
    priority: 6
  },
  'movin-design-system': {
    description: '다크모드 + 네온 강조색 디자인',
    keywords: ['무빙', 'movin', '다크모드', '네온', '디자인 시스템'],
    priority: 5
  },
  'paperfolio-design': {
    description: '클린 포트폴리오 디자인',
    keywords: ['페이퍼폴리오', 'paperfolio', '포트폴리오', 'portfolio', '클린 디자인'],
    priority: 5
  },
  'a2a': {
    description: '에이전트 간 통신 프로토콜',
    keywords: ['a2a', 'agent to agent', '에이전트 통신'],
    priority: 4
  },
  'reasoning': {
    description: 'CoT, ToT, ReAct 추론 기법',
    keywords: ['추론', 'reasoning', 'CoT', 'ToT', 'ReAct', 'chain of thought'],
    priority: 4
  },
  'reflection': {
    description: '자기 성찰 패턴',
    keywords: ['성찰', 'reflection', '자기 성찰', '반성'],
    priority: 4
  },
  'kongkong2': {
    description: 'Query Repetition 정확도 향상',
    keywords: ['콩콩', 'kongkong', 'query repetition', '정확도'],
    priority: 4
  },
  'fastapi-latest': {
    description: 'FastAPI 최신 패턴',
    keywords: ['fastapi', 'fast api', '파이썬 API'],
    priority: 5
  },
  'react-19': {
    description: 'React 19 훅 패턴',
    keywords: ['react 19', '리액트 19', 'react hooks'],
    priority: 5
  },
  'rag': {
    description: 'Context7 MCP 문서 검색',
    keywords: ['rag', '문서 검색', 'context7', '래그'],
    priority: 5
  },
  'goal-setting': {
    description: 'TASKS.md 기반 목표 관리',
    keywords: ['목표', '골 세팅', 'goal', 'goal setting'],
    priority: 4
  },
  'evaluation': {
    description: '품질 게이트 검사',
    keywords: ['평가', '품질 게이트', 'evaluation', 'quality gate'],
    priority: 4
  },
  'memory': {
    description: '세션 간 학습 지속',
    keywords: ['메모리', '기억', 'memory', '학습'],
    priority: 4
  },
  'guardrails': {
    description: '입출력 안전 검증',
    keywords: ['가드레일', 'guardrails', '안전', '검증'],
    priority: 4
  },
  'deep-research': {
    description: '5개 API 병렬 검색으로 종합 리서치',
    keywords: ['리서치', '조사', '검색', '찾아', '알아봐', '연구', '딥리서치', 'deep dive', 'research', 'search', 'investigate', 'deep research'],
    priority: 8
  },
  'commit': {
    description: 'Git 커밋 생성',
    keywords: ['커밋', '커밋해', '저장해', 'commit', 'save changes'],
    priority: 7
  },
  'test-automator': {
    description: '테스트 코드 자동 생성',
    keywords: ['테스트', '테스트 작성', '테스트 만들어', '단위 테스트', '통합 테스트', 'test', 'write test', 'unit test', 'integration test'],
    priority: 7
  },
  'documentation': {
    description: '문서화 작업',
    keywords: ['문서', '문서화', '문서 작성', 'README', '주석', 'document', 'documentation'],
    priority: 6
  },
  'refactor': {
    description: '코드 리팩토링',
    keywords: ['리팩토링', '리팩터', '개선', '정리', 'refactor', 'improve', 'clean up'],
    priority: 6
  },
  'python-pro': {
    description: 'Python 3.11+ 최적 패턴',
    keywords: ['python', '파이썬', 'python pro', '파이썬 프로'],
    priority: 5
  },
  'typescript-pro': {
    description: 'TypeScript 5.0+ 타입 안정성',
    keywords: ['typescript', '타입스크립트', 'typescript pro', 'ts pro'],
    priority: 5
  },
  'golang-pro': {
    description: 'Go 1.21+ 동시성 패턴',
    keywords: ['golang', '고랭', 'go pro', 'golang pro', 'go 언어'],
    priority: 5
  },
  'kubernetes-specialist': {
    description: 'K8s 배포 자동화',
    keywords: ['kubernetes', 'k8s', '쿠버네티스', 'kubectl', 'helm', '배포'],
    priority: 6
  },
  'terraform-engineer': {
    description: 'IaC 인프라 관리',
    keywords: ['terraform', '테라폼', 'IaC', '인프라', 'infrastructure'],
    priority: 6
  },
  'database-optimizer': {
    description: '쿼리 최적화 + 인덱싱',
    keywords: ['쿼리 최적화', 'database optimizer', 'DB 최적화', '인덱싱', 'slow query', '슬로우 쿼리'],
    priority: 6
  },
  'common-ground': {
    description: 'AI 가정 투명화 시스템',
    keywords: ['가정', '커먼그라운드', 'common ground', '가정 확인', '전제'],
    priority: 5
  },
  'the-fool': {
    description: '5가지 비판적 추론 모드',
    keywords: ['더 풀', 'the fool', '비판적', '비판', '악마의 변호인', '반론'],
    priority: 5
  },
  'eros': {
    description: '플라톤 향연 기반 결핍 인식 → 디오티마 사다리 → 창작',
    keywords: ['에로스', 'eros', '결핍 인식', '디오티마', '추상화 사다리', '던닝크루거', '결핍'],
    priority: 6
  },
  'packaging': {
    description: '스킬팩 ZIP 배포 패키징',
    keywords: ['패키징', '배포', 'packaging', 'ZIP', '패키지'],
    priority: 7
  },
  'spike': {
    description: '불확실 영역 탐색 + 프로토타이핑',
    keywords: ['스파이크', '탐색', '프로토타이핑', '실험', 'spike', 'prototype', '가능한지', 'POC'],
    priority: 8
  },
  'audit': {
    description: '보안/라이선스/GDPR 감사',
    keywords: ['감사', '보안 검사', 'OWASP', '라이선스', 'audit', 'compliance', '취약점', 'GDPR', '컴플라이언스'],
    priority: 7
  },
  'session-report': {
    description: '세션 종료 작업 리포트',
    keywords: ['세션 리포트', '작업 정리', 'session report', '세션 요약', '오늘 뭐했는지', '작업 리포트'],
    priority: 6
  }
};

function normalizeText(text) {
  return text.toLowerCase().trim();
}

function calculateScore(prompt, keywords) {
  const normalized = normalizeText(prompt);
  let score = 0;
  const matched = [];

  for (const keyword of keywords) {
    const kw = normalizeText(keyword);
    if (normalized.includes(kw)) {
      matched.push(keyword);
      score += kw.length * 2;
    } else {
      // Partial word match
      const words = kw.split(' ');
      for (const word of words) {
        if (word.length > 1 && normalized.includes(word)) {
          matched.push(keyword + '(partial)');
          score += word.length;
          break;
        }
      }
    }
  }

  return { score, matched };
}

function findMatchingSkills(prompt, maxResults = 2) {
  const results = [];

  for (const [name, def] of Object.entries(SKILL_DEFINITIONS)) {
    const { score, matched } = calculateScore(prompt, def.keywords);
    if (score > 0) {
      const finalScore = score * (1 + def.priority / 10);
      results.push({ name, score: finalScore, matched, description: def.description });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

function loadSkillContext(skillName) {
  const claudeDir = getClaudeDir();
  const globalDir = getGlobalClaudeDir();

  // Try project-level, then global
  const localPath = path.join(claudeDir, 'skills', skillName, 'SKILL.md');
  const globalPath = path.join(globalDir, 'skills', skillName, 'SKILL.md');
  const skillPath = fileExists(localPath) ? localPath : (fileExists(globalPath) ? globalPath : null);

  if (!skillPath) return null;

  const content = readFile(skillPath);
  if (!content) return null;

  const { frontmatter, body } = parseFrontmatter(content);

  // Extract only the first key section (up to 30 lines) to minimize token usage
  const keySections = extractKeySections(body, 30);

  return {
    name: frontmatter.name || skillName,
    description: frontmatter.description || '',
    context: keySections
  };
}

async function main() {
  const input = await readStdin();
  const userPrompt = input.user_prompt || input.prompt || '';

  if (!userPrompt.trim()) return;

  // Skip if prompt starts with / (already a skill invocation)
  if (userPrompt.trim().startsWith('/')) return;

  const matches = findMatchingSkills(userPrompt);
  if (matches.length === 0) return;

  const contextParts = [];
  contextParts.push('## 관련 스킬 감지 (자동)\n');

  for (const match of matches) {
    const skillData = loadSkillContext(match.name);
    if (skillData) {
      contextParts.push(`### /${match.name} - ${match.description}`);
      contextParts.push(`> 매칭 키워드: ${match.matched.slice(0, 3).join(', ')}`);
      contextParts.push('');
      contextParts.push(skillData.context);
      contextParts.push('');
    } else {
      // Just provide the description if SKILL.md not found
      contextParts.push(`### /${match.name} - ${match.description}`);
      contextParts.push('');
    }
  }

  outputContext(contextParts.join('\n'));
}

safeRun(main);
