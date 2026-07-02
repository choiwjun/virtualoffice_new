#!/usr/bin/env node
/**
 * Stop Hook: Session Summary Saver
 *
 * Saves session summary on exit and blocks if there are pending TODOs.
 * Enables seamless session continuity by persisting key decisions and work state.
 *
 * Saves: ~3K-8K tokens in next session (re-explanation eliminated)
 */

const path = require('path');
const fs = require('fs');
const {
  readStdin,
  outputContext,
  fileExists,
  readFile,
  readFileTail,
  writeJson,
  readJson,
  getProjectDir,
  getClaudeDir,
  getGlobalClaudeDir,
  safeRun
} = require('./lib/utils');

/**
 * Parse a JSONL transcript file and extract recent messages.
 * Uses tail-read for large files (>100KB) to avoid memory/timeout issues.
 * @param {string} transcriptPath
 * @param {number} maxMessages - Max recent messages to parse
 * @returns {Array<object>}
 */
function parseTranscript(transcriptPath, maxMessages = 50) {
  if (!fileExists(transcriptPath)) return [];

  try {
    // Use tail-read: only last 64KB for large files
    const content = readFileTail(transcriptPath, 65536);
    const lines = content.trim().split('\n').filter(l => l.trim());

    // Take last N lines from the tail chunk
    const recent = lines.slice(-maxMessages);
    const messages = [];

    for (const line of recent) {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // Skip malformed/truncated lines
      }
    }

    return messages;
  } catch {
    return [];
  }
}

/**
 * Extract a summary from transcript messages.
 * Focuses on assistant tool_use and results to understand what was done.
 */
function extractSummary(messages) {
  const actions = [];
  const decisions = [];
  const filesModified = new Set();

  for (const msg of messages) {
    // Look for tool uses (files edited/written)
    if (msg.type === 'tool_use' || msg.tool_name) {
      const toolName = msg.tool_name || msg.name || '';
      const toolInput = msg.tool_input || msg.input || {};

      if (['Edit', 'Write'].includes(toolName) && toolInput.file_path) {
        filesModified.add(toolInput.file_path);
      }

      if (toolName === 'Bash' && toolInput.command) {
        const cmd = toolInput.command.substring(0, 100);
        if (cmd.includes('git commit')) {
          actions.push(`Git commit: ${cmd}`);
        }
      }
    }

    // Look for assistant content blocks with tool_use
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          const toolName = block.name || '';
          const input = block.input || {};
          if (['Edit', 'Write'].includes(toolName) && input.file_path) {
            filesModified.add(input.file_path);
          }
        }
      }
    }
  }

  return {
    summary: actions.length > 0 ? actions.join('\n') : '세션 활동 기록됨',
    filesModified: [...filesModified],
    lastDecisions: decisions,
    timestamp: new Date().toISOString()
  };
}

/**
 * Detect pending/in-progress tasks from the conversation.
 * Looks for TaskCreate/TaskUpdate patterns in the transcript.
 */
function detectPendingTodos(messages) {
  const todos = {};

  for (const msg of messages) {
    // Check for TaskCreate in assistant content
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name === 'TaskCreate') {
          const input = block.input || {};
          const id = `task_${Object.keys(todos).length + 1}`;
          todos[id] = {
            subject: input.subject || 'Unknown',
            status: 'pending'
          };
        }
        if (block.type === 'tool_use' && block.name === 'TaskUpdate') {
          const input = block.input || {};
          if (input.taskId && input.status) {
            // Find the task by ID pattern
            for (const key of Object.keys(todos)) {
              if (key.endsWith(input.taskId) || input.taskId === key) {
                todos[key].status = input.status;
              }
            }
          }
        }
      }
    }

    // Also check tool_result for task IDs
    if (msg.role === 'tool' && msg.content) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const taskMatch = content.match(/Task #(\d+) created/);
      if (taskMatch) {
        const id = `task_${taskMatch[1]}`;
        if (!todos[id]) {
          todos[id] = { subject: 'Task', status: 'pending' };
        }
      }
    }
  }

  // Return only pending/in_progress tasks
  const pending = [];
  for (const [id, task] of Object.entries(todos)) {
    if (task.status === 'pending' || task.status === 'in_progress') {
      pending.push(`${task.subject} (${task.status})`);
    }
  }

  return pending;
}

async function main() {
  const input = await readStdin();
  const transcriptPath = input.transcript_path || '';
  const projectDir = getProjectDir();
  const claudeDir = getClaudeDir();
  const globalClaudeDir = getGlobalClaudeDir();

  // Parse transcript
  const messages = parseTranscript(transcriptPath);

  // Extract summary
  const summary = extractSummary(messages);

  // Detect pending TODOs
  const pendingTodos = detectPendingTodos(messages);
  summary.pendingTodos = pendingTodos;

  // Save summary to memory
  const memoryDir = path.join(claudeDir, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  writeJson(path.join(memoryDir, 'last-session.json'), summary);

  // Also save to global for cross-project continuity
  const globalMemoryDir = path.join(globalClaudeDir, 'memory');
  if (!fs.existsSync(globalMemoryDir)) {
    fs.mkdirSync(globalMemoryDir, { recursive: true });
  }
  writeJson(path.join(globalMemoryDir, 'last-session.json'), summary);

  // NOTE: Stop hooks do NOT support hookSpecificOutput JSON.
  // Pending TODOs are persisted in last-session.json for next session load.
}

safeRun(main);
