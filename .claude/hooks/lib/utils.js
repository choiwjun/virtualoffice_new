/**
 * Claude Labs Hook Utilities
 * Common functions shared across all hook scripts.
 */

const fs = require('fs');
const path = require('path');

/**
 * Read and parse JSON from stdin (Claude hook input).
 * Includes timeout to prevent hangs if stdin doesn't close.
 * @param {number} timeoutMs - Maximum time to wait for stdin (default: 3000ms)
 * @returns {Promise<object>} Parsed JSON object
 */
function readStdin(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;

    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { process.stdin.removeAllListeners(); } catch {}
      try { process.stdin.destroy(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => done({}), timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        done(data.trim() ? JSON.parse(data) : {});
      } catch {
        done({});
      }
    });
    process.stdin.on('error', () => done({}));
  });
}

/**
 * Output additionalContext for Claude hook system.
 * @param {string} context - The context string to inject
 * @param {string} [hookEventName='UserPromptSubmit'] - Hook event name (required by Claude Code spec)
 */
function outputContext(context, hookEventName = 'UserPromptSubmit') {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      additionalContext: context
    }
  };
  process.stdout.write(JSON.stringify(output));
}

/**
 * Output a permission decision (allow/deny/block).
 * @param {'allow'|'deny'|'block'} decision
 * @param {string} [reason]
 * @param {string} [hookEventName='PreToolUse'] - Hook event name (required by Claude Code spec)
 */
function outputDecision(decision, reason, hookEventName = 'PreToolUse') {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      decision
    }
  };
  if (reason) output.hookSpecificOutput.reason = reason;
  process.stdout.write(JSON.stringify(output));
}

/**
 * Output updatedInput to modify tool input.
 * @param {object} updatedInput - Modified tool input fields
 * @param {string} [additionalContext] - Optional additional context
 * @param {string} [hookEventName='PreToolUse'] - Hook event name (required by Claude Code spec)
 */
function outputUpdatedInput(updatedInput, additionalContext, hookEventName = 'PreToolUse') {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      updatedInput
    }
  };
  if (additionalContext) output.hookSpecificOutput.additionalContext = additionalContext;
  process.stdout.write(JSON.stringify(output));
}

/**
 * Check if a file exists.
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Read a file safely, returning empty string on error.
 * @param {string} filePath
 * @returns {string}
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Read only the tail of a file (last N bytes).
 * Efficient for large JSONL files where only recent entries matter.
 * @param {string} filePath
 * @param {number} maxBytes - Maximum bytes to read from end (default 64KB)
 * @returns {string}
 */
function readFileTail(filePath, maxBytes = 65536) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= maxBytes) {
      return fs.readFileSync(filePath, 'utf8');
    }
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    fs.readSync(fd, buffer, 0, maxBytes, stat.size - maxBytes);
    fs.closeSync(fd);
    const content = buffer.toString('utf8');
    // Drop first partial line (likely truncated)
    const firstNewline = content.indexOf('\n');
    return firstNewline >= 0 ? content.slice(firstNewline + 1) : content;
  } catch {
    return '';
  }
}

/**
 * Write JSON to a file, creating directories as needed.
 * @param {string} filePath
 * @param {object} data
 */
function writeJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Silently fail - hooks should not break the session
  }
}

/**
 * Read JSON from a file safely.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get the project directory (CLAUDE_PROJECT_DIR or cwd).
 * @returns {string}
 */
function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/**
 * Get the .claude directory path for the project.
 * @returns {string}
 */
function getClaudeDir() {
  return path.join(getProjectDir(), '.claude');
}

/**
 * Get the global .claude directory (~/.claude).
 * @returns {string}
 */
function getGlobalClaudeDir() {
  return path.join(require('os').homedir(), '.claude');
}

/**
 * Extract YAML frontmatter from a markdown file.
 * @param {string} content - Markdown content
 * @returns {{ frontmatter: object, body: string }}
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }
  const parts = content.split('---');
  if (parts.length < 3) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = {};
  const fmLines = parts[1].trim().split('\n');
  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }

  const body = parts.slice(2).join('---').trim();
  return { frontmatter, body };
}

/**
 * Extract the first N lines or first section of a markdown body.
 * @param {string} body - Markdown body
 * @param {number} maxLines - Maximum lines to extract
 * @returns {string}
 */
function extractKeySections(body, maxLines = 30) {
  const lines = body.split('\n');
  return lines.slice(0, maxLines).join('\n');
}

/**
 * Safely run a hook's main function.
 * Catches all errors, ensures process exits cleanly with code 0.
 * Hooks must NEVER crash or exit with non-zero code.
 * @param {Function} mainFn - Async main function to execute
 */
function safeRun(mainFn) {
  // Catch uncaught exceptions/rejections at process level
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));

  mainFn()
    .catch(() => {})
    .finally(() => {
      // Force exit after a short delay to allow stdout flush
      setTimeout(() => process.exit(0), 50);
    });
}

module.exports = {
  readStdin,
  outputContext,
  outputDecision,
  outputUpdatedInput,
  fileExists,
  readFile,
  readFileTail,
  writeJson,
  readJson,
  getProjectDir,
  getClaudeDir,
  getGlobalClaudeDir,
  parseFrontmatter,
  extractKeySections,
  safeRun
};
