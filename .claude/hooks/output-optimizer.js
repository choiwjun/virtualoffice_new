#!/usr/bin/env node
/**
 * PostToolUse[Bash] Hook: Output Optimizer
 *
 * Tracks large command outputs and learns optimization patterns
 * across sessions. Self-contained — no external tools required.
 *
 * How it works:
 * 1. Measures Bash output size after execution
 * 2. Matches against known command patterns
 * 3. Records waste + suggests compressed alternatives
 * 4. Session-summary-saver includes stats for next session awareness
 */

const {
  readStdin,
  writeJson,
  readJson,
  getGlobalClaudeDir,
  safeRun
} = require('./lib/utils');

const path = require('path');

// Command patterns with safe (한글-safe) compression strategies
// Priority: tool options > tail/head > exit code (never grep for keywords)
const COMMAND_OPTIMIZATIONS = {
  'git diff': { compressed: 'git diff --stat', savings: '80%', safe: true },
  'git log': { compressed: 'git log --oneline -10', savings: '90%', safe: true },
  'git status': { compressed: 'git status --short', savings: '85%', safe: true },
  'pytest': { compressed: 'pytest --tb=short -q', savings: '94%', safe: true },
  'npm test': { compressed: 'npm test -- --reporter=dot 2>&1 | tail -20', savings: '90%', safe: true },
  'npm run build': { compressed: 'npm run build 2>&1 | tail -20', savings: '85%', safe: true },
  'cargo test': { compressed: 'cargo test -- --format terse 2>&1 | tail -20', savings: '90%', safe: true },
  'docker logs': { compressed: 'docker logs --tail 20', savings: '80%', safe: true },
  'docker ps': { compressed: 'docker ps --format "table {{.Names}}\\t{{.Status}}"', savings: '60%', safe: true },
  'terraform plan': { compressed: 'terraform plan 2>&1 | tail -20', savings: '70%', safe: true },
  'npm audit': { compressed: 'npm audit 2>&1 | tail -10', savings: '80%', safe: true },
  'pip-audit': { compressed: 'pip-audit 2>&1 | tail -10', savings: '75%', safe: true },
  'eslint': { compressed: 'eslint --format compact 2>&1 | head -20', savings: '75%', safe: true },
  'tsc': { compressed: 'tsc --noEmit 2>&1 | head -20', savings: '80%', safe: true }
};

// Threshold: ~3000 chars ≈ 750+ tokens
const LARGE_OUTPUT_THRESHOLD = 3000;

function detectCommand(command) {
  if (!command) return null;
  const cmdLower = command.toLowerCase().trim();

  for (const [pattern, info] of Object.entries(COMMAND_OPTIMIZATIONS)) {
    if (cmdLower.startsWith(pattern) || cmdLower.includes(pattern)) {
      return { pattern, ...info };
    }
  }
  return null;
}

async function main() {
  const input = await readStdin();
  const toolInput = input.tool_input || {};
  const toolOutput = input.tool_output || {};
  const command = toolInput.command || '';
  const output = toolOutput.stdout || toolOutput.content || '';

  if (!command || !output) return;

  const outputLength = output.length;
  if (outputLength < LARGE_OUTPUT_THRESHOLD) return;

  const detected = detectCommand(command);
  const estimatedTokens = Math.round(outputLength / 4);

  const record = {
    timestamp: new Date().toISOString(),
    command: command.substring(0, 200),
    outputLength,
    estimatedTokens,
    matched: detected ? detected.pattern : null,
    compressed: detected ? detected.compressed : 'command 2>&1 | tail -20',
    potentialSavings: detected ? detected.savings : '50-70%'
  };

  // Append to session optimization log
  const cacheDir = path.join(getGlobalClaudeDir(), 'cache');
  const logPath = path.join(cacheDir, 'output-optimization-log.json');

  let log = readJson(logPath) || { entries: [], sessionStats: {} };

  // Keep only last 50 entries
  if (log.entries.length >= 50) {
    log.entries = log.entries.slice(-25);
  }

  log.entries.push(record);

  // Update session stats
  const stats = log.sessionStats;
  stats.totalLargeOutputs = (stats.totalLargeOutputs || 0) + 1;
  stats.totalWastedTokens = (stats.totalWastedTokens || 0) + estimatedTokens;
  stats.lastUpdated = new Date().toISOString();

  // Track most frequent wasteful commands
  if (!stats.topWasteful) stats.topWasteful = {};
  const key = detected ? detected.pattern : 'unknown';
  stats.topWasteful[key] = (stats.topWasteful[key] || 0) + 1;

  writeJson(logPath, log);
}

safeRun(main);
