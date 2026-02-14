/**
 * Edge route repair and endpoint adjustment — barrel re-export.
 *
 * The logic previously in this single file has been split into focused modules:
 * - `edge-endpoint-fix.ts` — disconnected edge repair, endpoint centre-snap
 * - `edge-route-optimization.ts` — off-row gateway rebuilds, overlapping flow
 *   separation, loopback routing
 *
 * This barrel preserves backward compatibility for existing imports.
 */

export { fixDisconnectedEdges, snapEndpointsToElementCentres } from './edge-endpoint-fix';
export {
  rebuildOffRowGatewayRoutes,
  separateOverlappingGatewayFlows,
  routeLoopbacksBelow,
} from './edge-route-optimization';
