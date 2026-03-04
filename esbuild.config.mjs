import { build, context } from 'esbuild';

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/index.ts', 'src/eval-cli.ts', 'src/agent-loop-cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outdir: 'dist',
  entryNames: '[name]',
  external: ['jsdom', 'bpmn-js', 'bpmn-auto-layout', 'bpmnlint', 'bpmnlint-plugin-camunda-compat'],
  banner: {
    js: '#!/usr/bin/env node',
  },
};

const isWatch = process.argv.includes('--watch');

if (isWatch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await build(config);
}
