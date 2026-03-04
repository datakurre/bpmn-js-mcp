/**
 * Rebuild-based layout engine.
 *
 * Phase 1: Topology Analyser — pure graph algorithms for analysis.
 * Phase 2: Rebuild Engine — core positioning algorithm.
 * Phase 3: Containers — subprocesses, pools, lanes.
 * Phase 4: Artifacts and labels — text annotations, data objects, label adjustment.
 */

// ── Flow graph extraction ──────────────────────────────────────────────────
export {
  type FlowNode,
  type FlowGraph,
  extractFlowGraph,
  extractFlowGraphFromElements,
  isFlowNode,
} from './topology';

// ── Back-edge detection and topological sort ─────────────────────────────────
export { detectBackEdges, getBackEdgeTargets } from './graph';
export { type LayeredNode, topologicalSort, groupByLayer } from './graph';

// ── Gateway fan-out and merge pattern detection ────────────────────────────
export { type GatewayPattern, detectGatewayPatterns } from './patterns';

// ── Container hierarchy ────────────────────────────────────────────────────
export {
  type ContainerNode,
  type ContainerHierarchy,
  buildContainerHierarchy,
  buildContainerHierarchyFromElements,
  getContainerRebuildOrder,
} from './container-layout';

// ── Boundary events and exception chains ───────────────────────────────────
export {
  type BoundaryEventInfo,
  identifyBoundaryEvents,
  identifyBoundaryEventsFromElements,
} from './boundary';

// ── Rebuild engine (Phase 2) ───────────────────────────────────────────────
export {
  type RebuildOptions,
  type RebuildResult,
  rebuildLayout,
  applyAllBackEdgeUShapes,
} from './engine';

// ── Container layout utilities (Phase 3) ───────────────────────────────────
export { moveElementTo } from './container-layout';

// ── Lane layout utilities (Phase 3) ────────────────────────────────────────
export {
  getLanesForParticipant,
  buildElementToLaneMap,
  applyLaneLayout,
  resizePoolToFit,
  syncBoundaryEventLanes,
} from './lane-layout';

// ── Artifact positioning and label adjustment (Phase 4) ────────────────────
export { positionArtifacts, adjustLabels } from './artifacts';
