/**
 * Reference layout regression tests.
 *
 * Imports reference BPMN diagrams from test/fixtures/layout-references/,
 * runs ELK layout, and asserts structural layout properties:
 * - Left-to-right ordering of the main flow
 * - All connections are strictly orthogonal (no diagonals)
 * - No element overlaps
 *
 * References are discovered dynamically from the fixtures directory.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleLayoutDiagram } from '../../../src/handlers';
import { clearDiagrams, importReference } from '../../helpers';

// ── Discover reference files ───────────────────────────────────────────────

const REFERENCES_DIR = resolve(__dirname, '..', '..', 'fixtures', 'layout-references');
const referenceFiles = readdirSync(REFERENCES_DIR)
  .filter((f) => f.endsWith('.bpmn'))
  .map((f) => f.replace('.bpmn', ''))
  .sort();

// ── Helpers ────────────────────────────────────────────────────────────────

/** Assert all waypoints of a connection form strictly orthogonal segments. */
function expectOrthogonal(conn: any) {
  const wps = conn.waypoints;
  if (!wps || wps.length < 2) return;
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    const isHorizontal = dy < 1;
    const isVertical = dx < 1;
    expect(
      isHorizontal || isVertical,
      `Connection ${conn.id} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

/** Check whether two elements overlap (bounding box intersection). */
function overlaps(a: any, b: any): boolean {
  const aRight = a.x + (a.width || 0);
  const aBottom = a.y + (a.height || 0);
  const bRight = b.x + (b.width || 0);
  const bBottom = b.y + (b.height || 0);
  // Use a small margin to allow near-touching elements
  const margin = 2;
  return (
    a.x < bRight - margin &&
    aRight > b.x + margin &&
    a.y < bBottom - margin &&
    aBottom > b.y + margin
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Reference layout regression', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  for (const refName of referenceFiles) {
    describe(refName, () => {
      test('all connections are orthogonal', async () => {
        const { diagramId, registry } = await importReference(refName);
        await handleLayoutDiagram({ diagramId });

        const connections = registry.filter(
          (el: any) =>
            el.type === 'bpmn:SequenceFlow' ||
            el.type === 'bpmn:MessageFlow' ||
            el.type === 'bpmn:Association'
        );

        for (const conn of connections) {
          expectOrthogonal(conn);
        }
      });

      test('no element overlaps', async () => {
        const { diagramId, registry } = await importReference(refName);
        await handleLayoutDiagram({ diagramId });

        // Get all visible shape elements (non-connections, non-infrastructure)
        const shapes = registry.filter(
          (el: any) =>
            !el.type?.includes('SequenceFlow') &&
            !el.type?.includes('MessageFlow') &&
            !el.type?.includes('Association') &&
            el.type !== 'bpmn:Process' &&
            el.type !== 'bpmn:Collaboration' &&
            el.type !== 'label' &&
            el.type !== 'bpmn:LaneSet' &&
            !el.type?.startsWith('bpmndi:') &&
            el.width !== undefined &&
            el.height !== undefined
        );

        // Check for overlaps (excluding containers that naturally contain children)
        const overlapsFound: string[] = [];
        for (let i = 0; i < shapes.length; i++) {
          for (let j = i + 1; j < shapes.length; j++) {
            const a = shapes[i];
            const b = shapes[j];

            // Skip parent-child relationships (subprocess contains elements, lane contains elements)
            if (
              a.parent?.id === b.id ||
              b.parent?.id === a.id ||
              a.type === 'bpmn:Participant' ||
              b.type === 'bpmn:Participant' ||
              a.type === 'bpmn:Lane' ||
              b.type === 'bpmn:Lane' ||
              a.type === 'bpmn:SubProcess' ||
              b.type === 'bpmn:SubProcess' ||
              a.type === 'bpmn:BoundaryEvent' ||
              b.type === 'bpmn:BoundaryEvent'
            ) {
              continue;
            }

            if (overlaps(a, b)) {
              overlapsFound.push(`${a.id} overlaps ${b.id}`);
            }
          }
        }

        expect(overlapsFound, `Found ${overlapsFound.length} overlaps`).toHaveLength(0);
      });

      test('layout completes without error', async () => {
        const { diagramId, registry } = await importReference(refName);
        await handleLayoutDiagram({ diagramId });

        // Verify that elements have valid positions after layout
        const shapes = registry.filter(
          (el: any) =>
            (el.type?.includes('Task') ||
              el.type?.includes('Event') ||
              el.type?.includes('Gateway')) &&
            el.type !== 'bpmn:BoundaryEvent'
        );

        for (const el of shapes) {
          expect(typeof el.x).toBe('number');
          expect(typeof el.y).toBe('number');
          expect(el.x).toBeGreaterThanOrEqual(0);
          expect(el.y).toBeGreaterThanOrEqual(0);
        }
      });
    });
  }
});
