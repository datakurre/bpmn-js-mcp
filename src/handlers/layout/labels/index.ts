/**
 * Label adjustment and positioning utilities.
 *
 * Co-locates all label-related code: geometry helpers (label-utils),
 * element label adjustment (adjust-labels), flow label adjustment
 * (adjust-flow-labels), and the MCP tool handler (adjust-labels-handler).
 */

// Re-export handler and tool definition
export {
  handleAdjustLabels,
  TOOL_DEFINITION,
  type AdjustLabelsArgs,
} from './adjust-labels-handler';

// Re-export adjustment functions used by layout-diagram and others
export { adjustDiagramLabels, adjustElementLabel, adjustFlowLabels } from './adjust-labels';

// Re-export geometry utilities used by tests and internal consumers
export {
  type Point,
  type Rect,
  type LabelOrientation,
  type LabelCandidate,
  getLabelRect,
  rectsOverlap,
  rectsNearby,
  segmentIntersectsRect,
  getLabelCandidatePositions,
  scoreLabelPosition,
} from './label-utils';
