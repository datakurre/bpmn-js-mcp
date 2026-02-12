import { build, context } from 'esbuild';

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node16',
  format: 'cjs',
  outfile: 'dist/index.js',
  external: [
    'jsdom',
    'bpmn-js',
    'bpmn-auto-layout',
    'elkjs',
    'bpmnlint',
    'bpmnlint-plugin-camunda-compat',
  ],
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
