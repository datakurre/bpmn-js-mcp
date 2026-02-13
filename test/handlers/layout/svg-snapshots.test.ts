/**
 * SVG snapshot generation for visual regression.
 *
 * Imports reference BPMN diagrams from test/fixtures/layout-references/,
 * runs ELK layout, and exports SVGs to `test/fixtures/layout-snapshots/`.
 * These serve as visual regression baselines — reviewers can open them
 * in a browser to see the actual layout engine output for the gold-standard
 * reference diagrams.
 *
 * Run with: npx vitest run test/handlers/svg-snapshots.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { handleLayoutDiagram, handleExportBpmn } from '../../../src/handlers';
import { clearDiagrams, importReference } from '../../helpers';

const SNAPSHOT_DIR = join(__dirname, '../..', 'fixtures', 'layout-snapshots');

function ensureDir() {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

async function exportSvg(diagramId: string): Promise<string> {
  const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
  const text = res.content[0].text;
  return text;
}

async function exportXml(diagramId: string): Promise<string> {
  const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
  return res.content[0].text;
}

function writeSvg(name: string, svg: string) {
  ensureDir();
  writeFileSync(join(SNAPSHOT_DIR, `${name}.svg`), svg);
}

function writeBpmn(name: string, xml: string) {
  ensureDir();
  writeFileSync(join(SNAPSHOT_DIR, `${name}.bpmn`), xml);
}

// ── Reference BPMN names ───────────────────────────────────────────────────

const REFERENCES = [
  '01-linear-flow',
  '02-exclusive-gateway',
  '03-parallel-fork-join',
  '04-nested-subprocess',
  '05-collaboration',
  '06-boundary-events',
  '07-complex-workflow',
  '08-collaboration-collapsed',
  '09-complex-workflow',
  '10-pool-with-lanes',
];

// ── Test fixtures ──────────────────────────────────────────────────────────

describe('SVG snapshot generation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
    clearDiagrams();
  });

  for (const refName of REFERENCES) {
    test(refName, async () => {
      const { diagramId } = await importReference(refName);
      await handleLayoutDiagram({ diagramId });
      const svg = await exportSvg(diagramId);
      const xml = await exportXml(diagramId);
      expect(svg).toContain('<svg');
      expect(xml).toContain('<bpmn:definitions');
      writeSvg(refName, svg);
      writeBpmn(refName, xml);
    });
  }
});
