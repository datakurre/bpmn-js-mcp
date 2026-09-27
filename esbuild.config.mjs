import { build, context } from 'esbuild';

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outdir: 'dist',
  entryNames: '[name]',
  external: [
    'bpmn-js',
    'bpmn-auto-layout',
    'bpmn-to-image',
    'bpmnlint',
    'bpmnlint-plugin-camunda-compat',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
};

/**
 * Browser bundle for the MCP Apps diagram viewer (issue #11 / ADR-025):
 * `@modelcontextprotocol/ext-apps`'s View-side `App`/`PostMessageTransport`,
 * self-contained (no `external`), inlined as a <script> into the
 * `ui://bpmn-diagram-viewer` resource by `src/mcp-apps/resource.ts`.
 */
const mcpAppsViewerConfig = {
  entryPoints: ['src/mcp-apps/viewer-entry.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outdir: 'dist',
  entryNames: 'mcp-apps-viewer-bundle',
};

const isWatch = process.argv.includes('--watch');

if (isWatch) {
  const ctx = await context(config);
  const mcpAppsCtx = await context(mcpAppsViewerConfig);
  await Promise.all([ctx.watch(), mcpAppsCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await build(config);
  await build(mcpAppsViewerConfig);
}
