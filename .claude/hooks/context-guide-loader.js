#!/usr/bin/env node
/**
 * PreToolUse[Edit|Write] Hook: Context Guide Loader
 *
 * Automatically injects relevant Constitution/framework guides
 * when editing files, based on file extension and path analysis.
 *
 * Saves: ~1K-3K tokens per file edit (manual Constitution load eliminated)
 */

const path = require('path');
const {
  readStdin,
  outputContext,
  fileExists,
  readFile,
  getClaudeDir,
  getGlobalClaudeDir,
  extractKeySections,
  safeRun
} = require('./lib/utils');

// File extension/path → Constitution mapping
const CONSTITUTION_MAP = [
  {
    patterns: ['.tsx', '.jsx'],
    dirs: [],
    constitutions: ['nextjs/api-design.md', 'nextjs/auth.md', 'nextjs/api-routes.md'],
    label: 'Next.js / React'
  },
  {
    patterns: ['.ts', '.js'],
    dirs: ['app/', 'pages/', 'components/', 'src/'],
    constitutions: ['nextjs/api-design.md', 'nextjs/api-routes.md'],
    label: 'Next.js'
  },
  {
    patterns: ['.py'],
    dirs: ['api/', 'routers/', 'endpoints/', 'app/'],
    constitutions: ['fastapi/api-design.md', 'fastapi/auth.md', 'fastapi/dependencies.md', 'fastapi/dotenv.md'],
    label: 'FastAPI'
  },
  {
    patterns: ['.sql'],
    dirs: ['migration', 'supabase/', 'db/'],
    constitutions: ['supabase/rls.md', 'supabase/auth-integration.md'],
    label: 'Supabase / SQL'
  },
  {
    patterns: [],
    dirs: ['supabase/'],
    constitutions: ['supabase/rls.md', 'supabase/auth-integration.md'],
    label: 'Supabase'
  },
  {
    patterns: [],
    dirs: [],
    fileNames: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs'],
    constitutions: ['tailwind/v4-syntax.md'],
    label: 'Tailwind CSS'
  }
];

// Common constitutions applied to all edits
const COMMON_CONSTITUTIONS = ['common/uuid.md', 'common/seed-validation.md'];

function matchConstitutions(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const matched = new Set();
  const labels = [];

  for (const mapping of CONSTITUTION_MAP) {
    let isMatch = false;

    // Check file extension
    if (mapping.patterns.length > 0 && mapping.patterns.includes(ext)) {
      // If dirs specified, also check dir
      if (mapping.dirs.length > 0) {
        isMatch = mapping.dirs.some(d => normalizedPath.includes(d.toLowerCase()));
      } else {
        isMatch = true;
      }
    }

    // Check directory-only matches
    if (!isMatch && mapping.patterns.length === 0 && mapping.dirs.length > 0) {
      isMatch = mapping.dirs.some(d => normalizedPath.includes(d.toLowerCase()));
    }

    // Check specific file names
    if (!isMatch && mapping.fileNames) {
      isMatch = mapping.fileNames.includes(fileName);
    }

    if (isMatch) {
      for (const c of mapping.constitutions) {
        matched.add(c);
      }
      labels.push(mapping.label);
    }
  }

  return { constitutions: [...matched], labels };
}

function loadConstitutionContent(constitutionPath) {
  const claudeDir = getClaudeDir();
  const globalDir = getGlobalClaudeDir();

  const localPath = path.join(claudeDir, 'constitutions', constitutionPath);
  const globalPath = path.join(globalDir, 'constitutions', constitutionPath);
  const fullPath = fileExists(localPath) ? localPath : (fileExists(globalPath) ? globalPath : null);

  if (!fullPath) return null;

  const content = readFile(fullPath);
  if (!content) return null;

  // Extract key rules only (first 25 lines) to minimize token usage
  return extractKeySections(content, 25);
}

async function main() {
  const input = await readStdin();
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || '';

  if (!filePath) return;

  const { constitutions, labels } = matchConstitutions(filePath);

  if (constitutions.length === 0) return;

  const contextParts = [];
  contextParts.push(`## Constitution 가이드 (자동 로드: ${labels.join(', ')})\n`);

  let loaded = 0;
  for (const c of constitutions) {
    const content = loadConstitutionContent(c);
    if (content) {
      const name = path.basename(c, '.md');
      contextParts.push(`### ${name}`);
      contextParts.push(content);
      contextParts.push('');
      loaded++;
    }

    // Limit to 3 constitutions to avoid token bloat
    if (loaded >= 3) break;
  }

  if (loaded > 0) {
    outputContext(contextParts.join('\n'), 'PreToolUse');
  }
}

safeRun(main);
