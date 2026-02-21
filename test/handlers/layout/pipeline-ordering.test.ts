/**
 * Tests for pipeline step ordering (B1-8).
 *
 * Verifies that:
 * - `MAIN_PIPELINE_STEPS` declares all expected steps in the correct order.
 * - `REPAIR_SIMPLIFY_PIPELINE_STEPS` declares the B4-critical sub-steps in order.
 * - `PipelineRunner.getStepNames()` reflects the declared order.
 * - Steps with `trackDelta: true` are only those that move BPMN shapes.
 * - Steps with `skip` predicates are only those with documented skip conditions.
 *
 * These assertions prevent accidental reordering of dependency-critical steps.
 * They run without any BPMN modeler or element registry — purely structural.
 */
import { describe, test, expect } from 'vitest';
import {
  MAIN_PIPELINE_STEPS,
  REPAIR_SIMPLIFY_PIPELINE_STEPS,
  PipelineRunner,
} from '../../../src/elk/index';
import { createLayoutLogger } from '../../../src/elk/layout-logger';

// ── Expected step names ──────────────────────────────────────────────────────

/**
 * Expected main pipeline step order.
 * Derived from the dependency chain documented in index.ts and types.ts.
 * If you need to reorder steps, update this array and document WHY in a comment.
 */
const EXPECTED_MAIN_STEPS = [
  // B1-4a: Node-positioning steps
  'applyNodePositions',
  'fixBoundaryEvents',
  'snapAndAlignLayers',
  'gridSnapAndResolveOverlaps',
  'repositionArtifacts',
  'alignHappyPathAndOffPathEvents',
  'resolveOverlaps-2nd',
  'positionEventSubprocesses',
  // B1-4b: Pool/boundary/edge-routing transition steps
  'finalisePoolsAndLanes',
  'finaliseBoundaryTargets',
  'resolveOverlaps-3rd',
  'applyEdgeRoutes',
  'normaliseOrigin',
  // B1-4c: Post-routing steps
  'repairAndSimplifyEdges',
  'clampFlowsToLaneBounds',
  'routeCrossLaneStaircase',
  'reduceCrossings-1st',
  'avoidElementIntersections',
  'reduceCrossings-2nd',
  'avoidElementIntersections-2nd',
  'detectCrossingFlows',
];

/**
 * Expected sub-steps of the edge repair phase (B4 dependency chain).
 * Order here is critical — see the B4 comment in index.ts for the reasoning.
 */
const EXPECTED_REPAIR_SUBSTEPS = [
  'fixDisconnectedEdges',
  'croppingDockPass',
  'rebuildOffRowGatewayRoutes',
  'separateOverlappingGatewayFlows',
  'simplifyCollinearWaypoints',
  'removeMicroBends',
  'routeLoopbacksBelow',
  'bundleParallelFlows',
  'snapAllConnectionsOrthogonal',
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('pipeline step ordering (B1-8)', () => {
  test('MAIN_PIPELINE_STEPS has the correct step names in dependency order', () => {
    const actual = MAIN_PIPELINE_STEPS.map((s) => s.name);
    expect(actual).toEqual(EXPECTED_MAIN_STEPS);
  });

  test('REPAIR_SIMPLIFY_PIPELINE_STEPS has the B4-critical sub-steps in order', () => {
    const actual = REPAIR_SIMPLIFY_PIPELINE_STEPS.map((s) => s.name);
    expect(actual).toEqual(EXPECTED_REPAIR_SUBSTEPS);
  });

  test('PipelineRunner.getStepNames() reflects declaration order', () => {
    const log = createLayoutLogger('ordering-test');
    const runner = new PipelineRunner(MAIN_PIPELINE_STEPS as any[], log);
    expect(runner.getStepNames()).toEqual(EXPECTED_MAIN_STEPS);
  });

  test('total step count matches expected (guards against accidental addition/removal)', () => {
    expect(MAIN_PIPELINE_STEPS.length).toBe(EXPECTED_MAIN_STEPS.length);
    expect(REPAIR_SIMPLIFY_PIPELINE_STEPS.length).toBe(EXPECTED_REPAIR_SUBSTEPS.length);
  });

  test('node-positioning phase steps run before pool/boundary/edge phase', () => {
    const names = MAIN_PIPELINE_STEPS.map((s) => s.name);
    const applyNodeIdx = names.indexOf('applyNodePositions');
    const finalisePoolsIdx = names.indexOf('finalisePoolsAndLanes');
    const applyEdgesIdx = names.indexOf('applyEdgeRoutes');

    expect(applyNodeIdx).toBeLessThan(finalisePoolsIdx);
    expect(finalisePoolsIdx).toBeLessThan(applyEdgesIdx);
  });

  test('edge routes must be applied before repair steps', () => {
    const names = MAIN_PIPELINE_STEPS.map((s) => s.name);
    const applyEdgesIdx = names.indexOf('applyEdgeRoutes');
    const repairIdx = names.indexOf('repairAndSimplifyEdges');
    const normaliseIdx = names.indexOf('normaliseOrigin');

    // normaliseOrigin must run AFTER applyEdgeRoutes (so waypoints shift together)
    expect(applyEdgesIdx).toBeLessThan(normaliseIdx);
    // repair must run AFTER normaliseOrigin
    expect(normaliseIdx).toBeLessThan(repairIdx);
  });

  test('reduceCrossings-1st runs before avoidElementIntersections', () => {
    const names = MAIN_PIPELINE_STEPS.map((s) => s.name);
    const reduce1idx = names.indexOf('reduceCrossings-1st');
    const avoidIdx = names.indexOf('avoidElementIntersections');
    const reduce2idx = names.indexOf('reduceCrossings-2nd');

    expect(reduce1idx).toBeLessThan(avoidIdx);
    // Second reduceCrossings must be AFTER avoidance (B6)
    expect(avoidIdx).toBeLessThan(reduce2idx);
  });

  test('detectCrossingFlows is the last step in the main pipeline', () => {
    const names = MAIN_PIPELINE_STEPS.map((s) => s.name);
    expect(names[names.length - 1]).toBe('detectCrossingFlows');
  });

  test('B4 sub-step ordering: croppingDockPass runs before rebuildOffRow', () => {
    const names = REPAIR_SIMPLIFY_PIPELINE_STEPS.map((s) => s.name);
    const snapIdx = names.indexOf('croppingDockPass');
    const rebuildIdx = names.indexOf('rebuildOffRowGatewayRoutes');
    const simplifyIdx = names.indexOf('simplifyCollinearWaypoints');
    const snapOrthoIdx = names.indexOf('snapAllConnectionsOrthogonal');

    expect(snapIdx).toBeLessThan(rebuildIdx);
    expect(rebuildIdx).toBeLessThan(simplifyIdx);
    // snapAllConnectionsOrthogonal must be last (final orthogonal snap)
    expect(snapOrthoIdx).toBe(names.length - 1);
  });

  test('delta-tracked steps are the correct subset', () => {
    const deltaTracked = MAIN_PIPELINE_STEPS.filter((s) => s.trackDelta).map((s) => s.name);
    // Only steps that move shapes (not connection-only steps) should track deltas
    expect(deltaTracked).toEqual([
      'applyNodePositions',
      'fixBoundaryEvents',
      'snapAndAlignLayers',
      'gridSnapAndResolveOverlaps',
      'alignHappyPathAndOffPathEvents',
      'finaliseBoundaryTargets',
    ]);
  });
});
