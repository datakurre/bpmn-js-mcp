/**
 * Per-diagram SVG comparison test.
 *
 * For each of the 8 reference diagrams:
 * 1. Imports the reference BPMN
 * 2. Runs ELK layout
 * 3. Exports SVG
 * 4. Parses element positions from both reference and generated SVGs
 * 5. Normalises away uniform origin offset
 * 6. Reports remaining deltas
 *
 * Run with: npx vitest run test/handlers/svg-comparison.test.ts
 */

import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import { handleLayoutDiagram, handleExportBpmn } from '../../src/handlers';
import {
  clearDiagrams,
  importReference,
  loadPositionsFromSVG,
  parsePositionsFromSVG,
  compareWithNormalisation,
} from '../helpers';

// ── Paths ──────────────────────────────────────────────────────────────────

const REFERENCE_DIR = join(__dirname, '..', 'fixtures', 'layout-references');

// ── Helpers ────────────────────────────────────────────────────────────────

async function exportSvgString(diagramId: string): Promise<string> {
  const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
  return res.content[0].text;
}

function logNormalisedMismatches(
  name: string,
  result: ReturnType<typeof compareWithNormalisation>
) {
  const { originOffset, deltas, mismatches, matchRate } = result;
  console.error(`\n── SVG comparison: ${name} ──`);
  console.error(
    `  Origin offset: Δx=${originOffset.dx.toFixed(0)}, Δy=${originOffset.dy.toFixed(0)}`
  );
  console.error(
    `  Match rate: ${(matchRate * 100).toFixed(1)}% (${deltas.length - mismatches.length}/${deltas.length})`
  );
  if (mismatches.length > 0) {
    console.error(`  Mismatches (${mismatches.length}):`);
    for (const m of mismatches) {
      console.error(
        `    ${m.elementId}: ref(${m.refX},${m.refY}) gen(${m.genX},${m.genY}) normalised Δ(${m.dx.toFixed(0)},${m.dy.toFixed(0)})`
      );
    }
  }
}

// ── Reference diagram configs ──────────────────────────────────────────────

interface DiagramConfig {
  name: string;
  tolerance: number;
  /** Minimum acceptable match rate (0-1). 0 = tracking only, 1 = exact. */
  minMatchRate: number;
}

const DIAGRAMS: DiagramConfig[] = [
  // Category 1: Uniform offset only — 100% match rate achieved
  { name: '01-linear-flow', tolerance: 20, minMatchRate: 1.0 },
  { name: '04-nested-subprocess', tolerance: 20, minMatchRate: 1.0 },
  { name: '06-boundary-events', tolerance: 20, minMatchRate: 1.0 },

  // Category 2: Spacing differences — 100% match rate achieved
  { name: '02-exclusive-gateway', tolerance: 30, minMatchRate: 1.0 },
  { name: '05-collaboration', tolerance: 40, minMatchRate: 1.0 },
  { name: '08-collaboration-collapsed', tolerance: 30, minMatchRate: 1.0 },

  // Category 3: Branch ordering — 100% match rate achieved
  { name: '03-parallel-fork-join', tolerance: 30, minMatchRate: 1.0 },

  // Category 4: Complex structural — 100% match rate achieved
  { name: '07-complex-workflow', tolerance: 50, minMatchRate: 1.0 },

  // Category 5: Conference Registration — complex with boundary events, dual parallel branches
  { name: '09-complex-workflow', tolerance: 50, minMatchRate: 0.85 },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SVG position comparison (normalised)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterAll(() => {
    clearDiagrams();
  });

  for (const config of DIAGRAMS) {
    describe(config.name, () => {
      test('reference SVG has parseable positions', () => {
        const refPath = join(REFERENCE_DIR, `${config.name}.svg`);
        const refPositions = loadPositionsFromSVG(refPath);
        expect(refPositions.size).toBeGreaterThan(0);
      });

      test(`normalised positions within ${config.tolerance}px tolerance`, async () => {
        // Import and layout
        const { diagramId } = await importReference(config.name);
        await handleLayoutDiagram({ diagramId });
        const genSvg = await exportSvgString(diagramId);

        // Parse positions from both SVGs
        const refPath = join(REFERENCE_DIR, `${config.name}.svg`);
        const refPositions = loadPositionsFromSVG(refPath);
        const genPositions = parsePositionsFromSVG(genSvg);

        expect(refPositions.size).toBeGreaterThan(0);
        expect(genPositions.size).toBeGreaterThan(0);

        // Compare with normalisation
        const result = compareWithNormalisation(refPositions, genPositions, config.tolerance);
        logNormalisedMismatches(config.name, result);

        // Assert minimum match rate
        expect(
          result.matchRate,
          `Match rate ${(result.matchRate * 100).toFixed(1)}% below minimum ${(config.minMatchRate * 100).toFixed(1)}%`
        ).toBeGreaterThanOrEqual(config.minMatchRate);
      });
    });
  }
});
