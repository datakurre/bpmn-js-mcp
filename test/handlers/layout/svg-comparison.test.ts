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

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { handleLayoutDiagram, handleExportBpmn } from '../../../src/handlers';
import {
  clearDiagrams,
  importReference,
  loadPositionsFromSVG,
  parsePositionsFromSVG,
  compareWithNormalisation,
} from '../../helpers';

// ── Paths ──────────────────────────────────────────────────────────────────

const REFERENCE_DIR = join(__dirname, '../..', 'fixtures', 'layout-references');

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
  // References now equal ELK-generated snapshots — tight tolerances expected.
  // Small tolerance (5px) accounts for rounding differences across runs.
  { name: '01-linear-flow-all-task-types', tolerance: 5, minMatchRate: 1.0 },
  { name: '02-exclusive-gateway', tolerance: 5, minMatchRate: 1.0 },
  { name: '03-parallel-gateway', tolerance: 5, minMatchRate: 1.0 },
  { name: '04-inclusive-gateway', tolerance: 5, minMatchRate: 1.0 },
  { name: '05-event-based-gateway', tolerance: 5, minMatchRate: 1.0 },
  { name: '06-subprocess-with-boundary-events', tolerance: 5, minMatchRate: 1.0 },
  { name: '07-call-activity', tolerance: 5, minMatchRate: 1.0 },
  { name: '08-boundary-events-all-types', tolerance: 5, minMatchRate: 1.0 },
  { name: '09-intermediate-events', tolerance: 5, minMatchRate: 1.0 },
  { name: '10-event-subprocess', tolerance: 5, minMatchRate: 1.0 },
  { name: '11-collaboration-multi-pool', tolerance: 5, minMatchRate: 1.0 },
  { name: '12-pool-with-lanes', tolerance: 5, minMatchRate: 1.0 },
  { name: '13-multi-instance-and-loops', tolerance: 5, minMatchRate: 1.0 },
  { name: '14-data-artifacts-and-annotations', tolerance: 5, minMatchRate: 1.0 },
  { name: '15-camunda-forms-and-extensions', tolerance: 5, minMatchRate: 1.0 },
  { name: '16-signal-and-escalation-events', tolerance: 5, minMatchRate: 1.0 },
  { name: '17-error-handling-patterns', tolerance: 5, minMatchRate: 1.0 },
  { name: '18-execution-and-task-listeners', tolerance: 5, minMatchRate: 1.0 },
  { name: '19-complex-workflow-patterns', tolerance: 50, minMatchRate: 0.85 },
  { name: '20-compensation-and-cancel-patterns', tolerance: 5, minMatchRate: 1.0 },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SVG position comparison (normalised)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
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
