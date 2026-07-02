#!/usr/bin/env node
/**
 * SessionStart Hook: Session Memory Loader
 *
 * Loads memory files and project context at session start,
 * injecting them via additionalContext to eliminate manual Read() calls.
 *
 * Saves: ~2K-5K tokens per session (3-5 Read() calls eliminated)
 */

const path = require('path');
const fs = require('fs');
const {
  readStdin,
  outputContext,
  fileExists,
  readFile,
  writeJson,
  getProjectDir,
  getClaudeDir,
  getGlobalClaudeDir,
  safeRun
} = require('./lib/utils');

// Tech stack markers (ported from session_init.py)
const TECH_MARKERS = {
  'package.json': 'Node.js',
  'next.config.js': 'Next.js',
  'next.config.ts': 'Next.js',
  'next.config.mjs': 'Next.js',
  'requirements.txt': 'Python',
  'pyproject.toml': 'Python',
  'Cargo.toml': 'Rust',
  'go.mod': 'Go',
  'Gemfile': 'Ruby',
  'Package.swift': 'Swift',
  'docker-compose.yml': 'Docker',
  'docker-compose.yaml': 'Docker',
  'tsconfig.json': 'TypeScript',
  'tailwind.config.js': 'Tailwind CSS',
  'tailwind.config.ts': 'Tailwind CSS',
  'supabase/config.toml': 'Supabase'
};

// Memory files to load (in priority order)
const MEMORY_FILES = [
  { name: 'user-profile.md', label: '사용자 프로필' },
  { name: 'project.md', label: '프로젝트 메모리' },
  { name: 'preferences.md', label: '사용자 선호' },
  { name: 'last-session.json', label: '이전 세션 요약' }
];

function detectTechStack(projectDir) {
  const stack = [];
  for (const [marker, tech] of Object.entries(TECH_MARKERS)) {
    if (fileExists(path.join(projectDir, marker))) {
      if (!stack.includes(tech)) {
        stack.push(tech);
      }
    }
  }
  return stack;
}

function detectAgents(claudeDir) {
  const agentsDir = path.join(claudeDir, 'agents');
  if (!fileExists(agentsDir)) return [];
  try {
    return fs.readdirSync(agentsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
  } catch {
    return [];
  }
}

function loadMemoryFiles(claudeDir, globalClaudeDir) {
  const sections = [];

  for (const { name, label } of MEMORY_FILES) {
    // Check project-level first, then global
    const localPath = path.join(claudeDir, 'memory', name);
    const globalPath = path.join(globalClaudeDir, 'memory', name);
    const filePath = fileExists(localPath) ? localPath : (fileExists(globalPath) ? globalPath : null);

    if (!filePath) continue;

    if (name.endsWith('.json')) {
      try {
        const data = JSON.parse(readFile(filePath));
        if (name === 'last-session.json' && data.summary) {
          sections.push(`### ${label}\n${data.summary}`);
          if (data.pendingTodos && data.pendingTodos.length > 0) {
            sections.push(`**미완료 TODO**: ${data.pendingTodos.join(', ')}`);
          }
          if (data.lastDecisions && data.lastDecisions.length > 0) {
            sections.push(`**주요 결정**: ${data.lastDecisions.join(', ')}`);
          }
        }
      } catch {
        // Skip invalid JSON
      }
    } else {
      const content = readFile(filePath);
      if (content.trim()) {
        // Limit each memory file to first 50 lines to avoid token bloat
        const trimmed = content.split('\n').slice(0, 50).join('\n');
        sections.push(`### ${label}\n${trimmed}`);
      }
    }
  }

  return sections;
}

async function main() {
  const input = await readStdin();
  const projectDir = getProjectDir();
  const claudeDir = getClaudeDir();
  const globalClaudeDir = getGlobalClaudeDir();
  const projectName = path.basename(projectDir);

  const contextParts = [];
  contextParts.push(`## 세션 메모리 (자동 로드됨)\n`);
  contextParts.push(`**프로젝트**: ${projectName}`);

  // Detect tech stack
  const techStack = detectTechStack(projectDir);
  if (techStack.length > 0) {
    contextParts.push(`**기술 스택**: ${techStack.join(', ')}`);
  }

  // Detect agents
  const agents = detectAgents(claudeDir);
  if (agents.length > 0) {
    contextParts.push(`**에이전트**: ${agents.length}개 (${agents.slice(0, 5).join(', ')}${agents.length > 5 ? '...' : ''})`);
  }

  // Check for CLAUDE.md
  if (fileExists(path.join(projectDir, 'CLAUDE.md'))) {
    contextParts.push(`**CLAUDE.md**: 존재함`);
  }

  // Load memory files
  const memorySections = loadMemoryFiles(claudeDir, globalClaudeDir);
  if (memorySections.length > 0) {
    contextParts.push('');
    contextParts.push(...memorySections);
  }

  // Cache session context for other hooks
  const sessionContext = {
    projectName,
    projectDir,
    techStack,
    agents,
    hasClaude: fileExists(path.join(projectDir, 'CLAUDE.md')),
    initializedAt: new Date().toISOString()
  };

  const cacheDir = path.join(globalClaudeDir, 'cache');
  writeJson(path.join(cacheDir, 'session_context.json'), sessionContext);

  // NOTE: SessionStart hooks do NOT support hookSpecificOutput JSON in Claude Code.
  // Context is delivered via cache file (session_context.json) instead.
  // Other hooks can read this cache file for session context.
}

safeRun(main);
