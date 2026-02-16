/**
 * Post-ELK grid snap pass — barrel re-exports.
 *
 * The grid snap logic is split across three files:
 * - `grid-snap-core.ts` — detectLayers, gridSnapPass, layer clustering
 * - `grid-snap-alignment.ts` — gateway centering, branch symmetry, happy-path alignment
 * - `grid-snap-subprocess.ts` — recursive subprocess grid snapping
 *
 * This barrel re-exports all public functions for backward compatibility.
 */

export { detectLayers, gridSnapPass } from './grid-snap-core';
export {
  centreGatewaysOnBranches,
  symmetriseGatewayBranches,
  alignBoundarySubFlowEndEvents,
  alignOffPathEndEvents,
  alignHappyPath,
  pinHappyPathBranches,
} from './grid-snap-alignment';
export { gridSnapExpandedSubprocesses } from './grid-snap-subprocess';
