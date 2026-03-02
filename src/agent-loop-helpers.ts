/**
 * Utility helpers for agent-loop-cli.ts.
 * Extracted to keep the main CLI file within the max-lines ESLint limit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { ScenarioScore } from './eval/types';
import type { TokenUsage, ToolCallEntry } from './agent-loop-types';

// ---------------------------------------------------------------------------
// MCP server injection
// ---------------------------------------------------------------------------

/**
 * Write a temporary MCP config JSON that points to the local bpmn-js-mcp dist.
 * Returns the path to the written file.
 */
export function writeMcpConfig(repoDir: string): string {
  const distPath = path.join(repoDir, 'dist', 'index.js');
  const config = {
    mcpServers: {
      'bpmn-js-mcp': { type: 'stdio', command: 'node', args: [distPath] },
    },
  };
  const tmpPath = path.join(os.tmpdir(), `bpmn-mcp-config-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  return tmpPath;
}

// ---------------------------------------------------------------------------
// Session transcript parsing
// ---------------------------------------------------------------------------

/**
 * Parse a copilot --share markdown transcript to extract model, token usage,
 * and a list of tool calls.
 */
export function parseSessionTranscript(mdPath: string): {
  model: string;
  tokenUsage: TokenUsage;
  toolCalls: ToolCallEntry[];
} {
  let model = 'unknown';
  const tokenUsage: TokenUsage = {};
  const toolCalls: ToolCallEntry[] = [];

  if (!fs.existsSync(mdPath)) return { model, tokenUsage, toolCalls };

  const text = fs.readFileSync(mdPath, 'utf-8');

  const modelMatch = text.match(/\*{1,2}Model:\*{1,2}\s*([^\n]+)/i);
  if (modelMatch) model = modelMatch[1].trim();

  const inputMatch = text.match(/input_tokens[\s:]+([\d,]+)/i);
  const outputMatch = text.match(/output_tokens[\s:]+([\d,]+)/i);
  const cacheReadMatch = text.match(/cache_read(?:_input)?_tokens[\s:]+([\d,]+)/i);
  const cacheWriteMatch = text.match(/cache_creation(?:_input)?_tokens[\s:]+([\d,]+)/i);

  if (inputMatch) tokenUsage.inputTokens = parseInt(inputMatch[1].replace(/,/g, ''), 10);
  if (outputMatch) tokenUsage.outputTokens = parseInt(outputMatch[1].replace(/,/g, ''), 10);
  if (cacheReadMatch) {
    tokenUsage.cacheReadTokens = parseInt(cacheReadMatch[1].replace(/,/g, ''), 10);
  }
  if (cacheWriteMatch) {
    tokenUsage.cacheWriteTokens = parseInt(cacheWriteMatch[1].replace(/,/g, ''), 10);
  }

  const toolHeadingRe = /###\s+Tool:\s+`([^`]+)`/g;
  const toolInlineRe = /\*{1,2}Tool:\*{1,2}\s+`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = toolHeadingRe.exec(text)) !== null) {
    toolCalls.push({ tool: m[1], argsSummary: '', resultSummary: '' });
  }
  while ((m = toolInlineRe.exec(text)) !== null) {
    toolCalls.push({ tool: m[1], argsSummary: '', resultSummary: '' });
  }

  return { model, tokenUsage, toolCalls };
}

// ---------------------------------------------------------------------------
// SVG snapshot capture
// ---------------------------------------------------------------------------

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Copy per-scenario SVG artifacts into a destination directory for the audit.
 */
export function captureScenarioSvgs(
  scenarios: ScenarioScore[],
  destDir: string,
  label: 'baseline' | 'after'
): string[] {
  fs.mkdirSync(destDir, { recursive: true });
  const captured: string[] = [];
  for (const s of scenarios) {
    const svgSrc = s.artifacts?.svgPath;
    if (!svgSrc || !fs.existsSync(svgSrc)) continue;
    const dest = path.join(destDir, `${label}-${s.scenarioId}-${slug(s.name)}.svg`);
    fs.copyFileSync(svgSrc, dest);
    captured.push(dest);
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Copilot invocation
// ---------------------------------------------------------------------------

/**
 * Ask Copilot to directly edit files in the working tree (using its write
 * tools), then return the unified diff of what it changed (via `git diff HEAD`).
 *
 * The BPMN MCP server is injected via --additional-mcp-config so the model
 * can call create_bpmn_diagram, layout_bpmn_diagram, export_bpmn, etc.
 */
export function copilotRunEdits(opts: {
  prompt: string;
  repoDir: string;
  mcpConfigPath: string;
  transcriptPath: string;
  model?: string;
}): string {
  const { prompt, repoDir, mcpConfigPath, transcriptPath, model } = opts;
  // Deny commands that modify state or take too long; allow read-only shell
  const DENY_TOOL = '--deny-tool';
  const args = [
    '-p',
    prompt,
    '-s',
    '--no-ask-user',
    '--allow-all-tools',
    DENY_TOOL,
    'shell(npm:*)',
    DENY_TOOL,
    'shell(npx:*)',
    DENY_TOOL,
    'shell(git:*)',
    DENY_TOOL,
    'shell(node:*)',
    DENY_TOOL,
    'shell(make:*)',
    DENY_TOOL,
    'shell(rm:*)',
    DENY_TOOL,
    'shell(mv:*)',
    '--additional-mcp-config',
    `@${mcpConfigPath}`,
    '--share',
    transcriptPath,
    '--add-dir',
    repoDir,
    '--stream',
    'off',
  ];
  if (model) args.push('--model', model);

  spawnSync('copilot', args, { cwd: repoDir, env: { ...process.env }, stdio: 'inherit' });

  const res = spawnSync('git', ['diff', 'HEAD'], {
    cwd: repoDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return (res.stdout ?? '').trim();
}

// ---------------------------------------------------------------------------
// Diff validation
// ---------------------------------------------------------------------------

const ALLOWED_PREFIXES = [
  'src/',
  'test/',
  'docs/',
  'README.md',
  'TODO.md',
  'Makefile',
  'package.json',
  'esbuild.config.mjs',
  'tsconfig.json',
  'tsconfig.test.json',
  'vitest.config.ts',
  'eslint.config.mjs',
];

const FORBIDDEN_PREFIXES = ['dist/', 'node_modules/', '.git/'];

/** Eval files the agent must never edit (scores/scenarios are read-only). */
const PROTECTED_EVAL_FILES = [
  'src/eval/scenarios.ts',
  'src/eval/score.ts',
  'src/eval/run-eval.ts',
  'src/eval/types.ts',
  'src/eval/mcp-json.ts',
];

export function validateDiffPaths(diff: string) {
  const paths = new Set<string>();
  for (const l of diff
    .split(/\r?\n/)
    .filter((l) => l.startsWith('+++ b/') || l.startsWith('--- a/'))) {
    const p = l
      .replace(/^\+\+\+ b\//, '')
      .replace(/^--- a\//, '')
      .trim();
    if (p !== '/dev/null') paths.add(p);
  }
  for (const p of paths) {
    if (PROTECTED_EVAL_FILES.includes(p)) {
      throw new Error(`Diff touches protected eval file: ${p} (scenarios & scoring are read-only)`);
    }
    if (FORBIDDEN_PREFIXES.some((fx) => p.startsWith(fx))) {
      throw new Error(`Diff touches forbidden path: ${p}`);
    }
    if (!ALLOWED_PREFIXES.some((fx) => p === fx || p.startsWith(fx))) {
      throw new Error(`Diff touches disallowed path: ${p}`);
    }
  }
}
