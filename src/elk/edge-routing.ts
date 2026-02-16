/**
 * ELK edge routing barrel — re-exports from split modules.
 *
 * The edge routing logic is split into focused files:
 * - `edge-routing-helpers.ts` — shared utilities (deduplicateWaypoints, buildZShapeRoute)
 * - `edge-routing-core.ts`    — ELK edge section → bpmn-js waypoint conversion
 * - `edge-routing-simplify.ts` — gateway branch simplification, collinear cleanup
 * - `edge-routing-fix.ts`     — disconnected edge repair, endpoint snapping, off-row rebuild
 *
 * This barrel preserves backward compatibility for existing imports.
 */

export { deduplicateWaypoints, buildZShapeRoute } from './edge-routing-helpers';
export { applyElkEdgeRoutes } from './edge-routing-core';
export {
  simplifyGatewayBranchRoutes,
  simplifyCollinearWaypoints,
  removeMicroBends,
} from './edge-routing-simplify';
export {
  fixDisconnectedEdges,
  snapEndpointsToElementCentres,
  rebuildOffRowGatewayRoutes,
  separateOverlappingGatewayFlows,
  routeLoopbacksBelow,
} from './edge-routing-fix';

export { avoidElementIntersections } from './element-avoidance';
