#!/usr/bin/env node
/**
 * PreToolUse[Task] Hook: Agent Context Injector
 *
 * Injects relevant context into subagent prompts when Task tool is called,
 * eliminating repeated instructions in every agent call.
 *
 * Saves: ~500 tokens per Task call
 */

const path = require('path');
const {
  readStdin,
  outputUpdatedInput,
  fileExists,
  readFile,
  readJson,
  getClaudeDir,
  getGlobalClaudeDir,
  safeRun
} = require('./lib/utils');

// Agent-specific context rules
const AGENT_CONTEXT_RULES = {
  // Implementation agents get coding preferences
  'backend-specialist': { loadPrefs: true, loadConstitutions: ['fastapi'] },
  'frontend-specialist': { loadPrefs: true, loadConstitutions: ['nextjs', 'tailwind'] },
  'database-specialist': { loadPrefs: true, loadConstitutions: ['supabase'] },
  '3d-engine-specialist': { loadPrefs: true },

  // Test/Security agents get project rules
  'test-specialist': { loadPrefs: true, patterns: ['kongkong2'] },
  'security-specialist': { loadPrefs: true },

  // Analysis agents get project context
  'architecture-analyst': { loadSessionContext: true },
  'requirements-analyst': { loadSessionContext: true },
  'impact-analyzer': { loadSessionContext: true },

  // Execution agents get common rules
  'orchestrator': { loadPrefs: true, patterns: ['kongkong2'] },
  // task-executor는 폐기됨 (서브에이전트 중첩 불가 - 2026-02-15)
  'task-planner': { loadSessionContext: true },
  'dependency-resolver': { loadSessionContext: true },

  // Documentation
  'docs-specialist': { loadPrefs: true }
};

// Common rules injected for all agents
const COMMON_AGENT_RULES = [
  '- Context7 MCP를 활용하여 최신 라이브러리 문서를 확인하세요.',
  '- Query Repetition 패턴: 중요한 쿼리는 핵심 키워드를 반복하여 정확도를 높이세요.'
];

function loadPreferences() {
  const claudeDir = getClaudeDir();
  const globalDir = getGlobalClaudeDir();

  const localPath = path.join(claudeDir, 'memory', 'preferences.md');
  const globalPath = path.join(globalDir, 'memory', 'preferences.md');
  const prefsPath = fileExists(localPath) ? localPath : (fileExists(globalPath) ? globalPath : null);

  if (!prefsPath) return '';
  const content = readFile(prefsPath);
  return content ? content.split('\n').slice(0, 20).join('\n') : '';
}

function loadSessionContext() {
  const globalDir = getGlobalClaudeDir();
  const ctx = readJson(path.join(globalDir, 'cache', 'session_context.json'));
  if (!ctx) return '';

  const parts = [];
  if (ctx.projectName) parts.push(`프로젝트: ${ctx.projectName}`);
  if (ctx.techStack && ctx.techStack.length > 0) parts.push(`기술 스택: ${ctx.techStack.join(', ')}`);
  return parts.join('\n');
}

function loadPatternContext(patterns) {
  const claudeDir = getClaudeDir();
  const globalDir = getGlobalClaudeDir();
  const parts = [];

  for (const pattern of patterns) {
    const localPath = path.join(claudeDir, 'skills', pattern, 'SKILL.md');
    const globalPath = path.join(globalDir, 'skills', pattern, 'SKILL.md');
    const skillPath = fileExists(localPath) ? localPath : (fileExists(globalPath) ? globalPath : null);

    if (skillPath) {
      const content = readFile(skillPath);
      // Extract just the description line from frontmatter
      const descMatch = content.match(/description:\s*(.+)/);
      if (descMatch) {
        parts.push(`- ${pattern}: ${descMatch[1].trim()}`);
      }
    }
  }

  return parts.join('\n');
}

async function main() {
  const input = await readStdin();
  const toolInput = input.tool_input || {};
  const agentType = toolInput.subagent_type || '';
  const originalPrompt = toolInput.prompt || '';

  if (!agentType || !originalPrompt) return;

  const rules = AGENT_CONTEXT_RULES[agentType];
  const contextParts = [];

  // Add common rules
  contextParts.push(...COMMON_AGENT_RULES);

  if (rules) {
    // Load preferences if needed
    if (rules.loadPrefs) {
      const prefs = loadPreferences();
      if (prefs) {
        contextParts.push(`\n## 프로젝트 코딩 규칙\n${prefs}`);
      }
    }

    // Load session context if needed
    if (rules.loadSessionContext) {
      const ctx = loadSessionContext();
      if (ctx) {
        contextParts.push(`\n## 프로젝트 컨텍스트\n${ctx}`);
      }
    }

    // Load pattern references if needed
    if (rules.patterns && rules.patterns.length > 0) {
      const patterns = loadPatternContext(rules.patterns);
      if (patterns) {
        contextParts.push(`\n## 적용 패턴\n${patterns}`);
      }
    }
  }

  if (contextParts.length === 0) return;

  // Append context to the agent prompt
  const injectedContext = `\n\n---\n## 자동 주입 컨텍스트\n${contextParts.join('\n')}`;
  const updatedPrompt = originalPrompt + injectedContext;

  // ⚠️ updatedInput은 도구 입력 전체를 대체한다 — 원본 필드(description·subagent_type 등)를
  // 반드시 보존하고 prompt만 덮어쓴다. {prompt}만 반환하면 Agent 필수 필드 description이
  // 사라져 "required parameter `description` is missing" 스키마 오류가 난다.
  outputUpdatedInput({ ...toolInput, prompt: updatedPrompt });
}

safeRun(main);
