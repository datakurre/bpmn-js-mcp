/**
 * ELK graph construction from bpmn-js element registry.
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import {
  ELK_LAYOUT_OPTIONS,
  CONTAINER_PADDING,
  PARTICIPANT_PADDING,
  PARTICIPANT_WITH_LANES_PADDING,
  DIVERSE_Y_THRESHOLD,
  ELK_HIGH_PRIORITY,
  BPMN_TASK_WIDTH,
  BPMN_TASK_HEIGHT,
  BPMN_EVENT_SIZE as _BPMN_EVENT_SIZE,
  GATEWAY_UPPER_SPLIT_FACTOR as _GATEWAY_UPPER_SPLIT_FACTOR,
  GATEWAY_MID_FACTOR as _GATEWAY_MID_FACTOR,
  CENTER_FACTOR,
  CONTAINER_DEFAULT_WIDTH,
  CONTAINER_DEFAULT_HEIGHT,
} from './constants';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';

/**
 * Build ELK child nodes and internal edges for a given container element.
 *
 * A "container" is any element whose children should be laid out together:
 * the root canvas element, a Participant (pool), or an expanded SubProcess.
 */
export function buildContainerGraph(
  allElements: any[],
  container: any,
  excludeIds?: Set<string>
): { children: ElkNode[]; edges: ElkExtendedEdge[]; hasDiverseY: boolean } {
  const children: ElkNode[] = [];
  const edges: ElkExtendedEdge[] = [];
  const nodeIds = new Set<string>();

  // Direct child shapes (skip connections, boundary events, infrastructure, artifacts, lanes,
  // and boundary-only leaf targets that are excluded from the ELK graph)
  const childShapes = allElements.filter(
    (el: any) =>
      el.parent === container &&
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      !isLane(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      !(excludeIds && excludeIds.has(el.id))
  );

  // Sort child shapes by their DI Y-position (ascending = top-first).
  // When importing a BPMN with DI coordinates, bpmn-js sets element.y from
  // the DI before ELK runs.  By sorting children by Y, we tell ELK's
  // NODES_AND_EDGES model order strategy to preserve the imported diagram's
  // vertical arrangement.  For newly created diagrams without DI, all
  // elements start at similar Y positions, so the sort is a no-op.
  childShapes.sort((a: any, b: any) => {
    const ay = a.y + (a.height || 0) / 2;
    const by = b.y + (b.height || 0) / 2;
    return ay - by;
  });

  // Detect if elements have diverse DI Y-positions (imported BPMN).
  // If so, force node model order to prevent crossing minimisation from
  // reordering branches away from the DI-based Y-position sort above.
  // For programmatically created diagrams (all at same Y), skip this so
  // ELK's crossing minimiser can freely optimise branch placement.
  // Threshold of 100px distinguishes genuine imported DI layouts
  // (which typically span hundreds of pixels) from auto-positioned
  // elements (which cluster within ~80-100px of each other).
  const yCentres = childShapes.map((s: any) => s.y + (s.height || 0) / 2);
  const minY = Math.min(...yCentres);
  const maxY = Math.max(...yCentres);
  const hasDiverseY = maxY - minY > DIVERSE_Y_THRESHOLD;

  for (const shape of childShapes) {
    nodeIds.add(shape.id);

    // Check if this shape is a container with layoutable children
    const hasChildren = allElements.some(
      (el: any) =>
        el.parent === shape &&
        !isInfrastructure(el.type) &&
        !isConnection(el.type) &&
        el.type !== 'bpmn:BoundaryEvent'
    );

    if (hasChildren) {
      // Compound node — recurse
      const isParticipant = shape.type === 'bpmn:Participant';
      const nested = buildContainerGraph(allElements, shape, excludeIds);

      // Determine padding: participants with lanes need extra left padding
      // to account for the lane label band (~30px) in addition to the pool
      // label band (~30px).
      let padding: string;
      if (isParticipant) {
        const hasLanes = allElements.some((el: any) => el.parent === shape && isLane(el.type));
        padding = hasLanes ? PARTICIPANT_WITH_LANES_PADDING : PARTICIPANT_PADDING;
      } else {
        padding = CONTAINER_PADDING;
      }

      children.push({
        id: shape.id,
        width: shape.width || CONTAINER_DEFAULT_WIDTH,
        height: shape.height || CONTAINER_DEFAULT_HEIGHT,
        children: nested.children,
        edges: nested.edges,
        layoutOptions: {
          ...ELK_LAYOUT_OPTIONS,
          'elk.padding': padding,
        },
      });
    } else {
      children.push({
        id: shape.id,
        width: shape.width || BPMN_TASK_WIDTH,
        height: shape.height || BPMN_TASK_HEIGHT,
      });
    }
  }

  // Connections whose source AND target are both in this container
  const childConnections = allElements.filter(
    (el: any) => el.parent === container && isConnection(el.type) && el.source && el.target
  );

  // Detect back-edges (loop-back flows) using DFS so we can tag them
  // with low priority.  This helps ELK's cycle breaker reverse the
  // correct edges, preserving left-to-right directionality for the main
  // path.
  const internalConns = childConnections.filter(
    (c: any) => nodeIds.has(c.source.id) && nodeIds.has(c.target.id)
  );

  // Sort edges from split gateways by target's current Y-position (DI order).
  // When importing a BPMN with DI coordinates, bpmn-js sets element.y from the
  // DI before ELK runs.  By sorting edges by target Y, we tell ELK's
  // NODES_AND_EDGES model order strategy to place branches in the same vertical
  // order as the imported diagram's DI coordinates.
  // For newly created diagrams (no DI), all targets start at the same Y,
  // so the sort is a no-op — original behaviour preserved.
  internalConns.sort((a: any, b: any) => {
    if (a.source.id !== b.source.id) return 0;
    const aTargetY = a.target.y + (a.target.height || 0) * CENTER_FACTOR;
    const bTargetY = b.target.y + (b.target.height || 0) * CENTER_FACTOR;
    return aTargetY - bTargetY;
  });

  const backEdgeIds = detectBackEdges(internalConns, nodeIds);

  // Count outgoing edges per source to identify split gateways (≥2 outgoing).
  // Edges from split gateways are tagged with high shortness priority so
  // ELK's NETWORK_SIMPLEX layering places all targets in the same column.
  const outgoingCount = new Map<string, number>();
  for (const conn of internalConns) {
    const srcId = conn.source.id;
    outgoingCount.set(srcId, (outgoingCount.get(srcId) || 0) + 1);
  }

  // Build a map of node IDs → element types for decision gateways.
  // Exclusive and inclusive gateways benefit from shortness priority to
  // keep their branch targets in the same ELK layer.  Parallel gateways
  // are excluded — ELK already handles them well, and the shortness hint
  // can interfere with crossing minimisation for many-branch fork-joins.
  const decisionGatewayIds = new Set<string>();
  // Also track gateway default flows for short-branch detection.
  const gatewayDefaults = new Map<string, string>();
  for (const shape of childShapes) {
    if (shape.type === 'bpmn:ExclusiveGateway' || shape.type === 'bpmn:InclusiveGateway') {
      decisionGatewayIds.add(shape.id);
      if (shape.businessObject?.default) {
        gatewayDefaults.set(shape.id, shape.businessObject.default.id);
      }
    }
  }

  // Build outgoing adjacency for short-branch detection.
  const outgoingAdj = new Map<string, any[]>();
  for (const conn of internalConns) {
    const list = outgoingAdj.get(conn.source.id) || [];
    list.push(conn);
    outgoingAdj.set(conn.source.id, list);
  }

  const shortBranchEdgeIds = detectShortBranches(
    gatewayDefaults,
    decisionGatewayIds,
    internalConns,
    outgoingAdj
  );

  for (const conn of internalConns) {
    const edge: ElkExtendedEdge = {
      id: conn.id,
      sources: [conn.source.id],
      targets: [conn.target.id],
    };
    if (backEdgeIds.has(conn.id)) {
      edge.layoutOptions = {
        'elk.priority': '0',
      };
    } else {
      const srcId = conn.source.id;
      const isSplitDecisionGateway =
        decisionGatewayIds.has(srcId) && (outgoingCount.get(srcId) || 0) >= 2;
      if (isSplitDecisionGateway && !shortBranchEdgeIds.has(conn.id)) {
        // High shortness priority encourages NETWORK_SIMPLEX to place
        // all targets of a split gateway in the same layer (column).
        // Skip for short rejection branches (default flows that reach
        // an end event within ≤2 hops) to avoid pulling the rejection
        // target into the same layer as the main branch.
        edge.layoutOptions = {
          ...edge.layoutOptions,
          'elk.priority.shortness': ELK_HIGH_PRIORITY,
        };
      }
    }
    edges.push(edge);
  }

  addSyntheticOrderingEdges(
    gatewayDefaults,
    shortBranchEdgeIds,
    internalConns,
    backEdgeIds,
    nodeIds,
    childShapes,
    outgoingAdj,
    edges
  );

  // Include proxy edges for boundary event flows.
  // Boundary events are excluded from ELK nodes, but their outgoing flows
  // need to be represented so ELK positions the targets properly (e.g.
  // error end events, recovery tasks).  We use the boundary event's host
  // as the proxy source, with a synthetic edge ID to avoid conflicts with
  // the actual connection's edge routing.
  const boundaryEvents = allElements.filter(
    (el: any) => el.parent === container && el.type === 'bpmn:BoundaryEvent' && el.host
  );
  for (const be of boundaryEvents) {
    const hostId = be.host.id;
    if (!nodeIds.has(hostId)) continue;

    // Find outgoing flows from this boundary event
    const beOutgoing = childConnections.filter(
      (conn: any) => conn.source.id === be.id && nodeIds.has(conn.target.id)
    );
    for (const conn of beOutgoing) {
      edges.push({
        id: `__boundary_proxy__${conn.id}`,
        sources: [hostId],
        targets: [conn.target.id],
      });
    }
  }

  return { children, edges, hasDiverseY };
}

/**
 * Detect short rejection branches: from a decision gateway, if the
 * default (rejection) flow reaches an end event within ≤2 hops,
 * its edge ID is returned.  This prevents ELK from pulling the
 * rejection target into the same layer as the main branch target.
 */
function detectShortBranches(
  gatewayDefaults: Map<string, string>,
  decisionGatewayIds: Set<string>,
  internalConns: any[],
  outgoingAdj: Map<string, any[]>
): Set<string> {
  const BPMN_END_EVENT = 'bpmn:EndEvent';
  const shortBranchEdgeIds = new Set<string>();
  for (const [gwId, defaultFlowId] of gatewayDefaults) {
    if (!decisionGatewayIds.has(gwId)) continue;
    const defaultConn = internalConns.find((c: any) => c.id === defaultFlowId);
    if (!defaultConn) continue;
    let current = defaultConn.target;
    let hops = 1;
    let reachesEnd = current?.type === BPMN_END_EVENT;
    while (!reachesEnd && hops < 2 && current) {
      const nextConns = outgoingAdj.get(current.id);
      if (!nextConns || nextConns.length !== 1) break;
      current = nextConns[0].target;
      hops++;
      reachesEnd = current?.type === BPMN_END_EVENT;
    }
    if (reachesEnd) {
      shortBranchEdgeIds.add(defaultFlowId);
    }
  }
  return shortBranchEdgeIds;
}

/**
 * Add synthetic ordering edges for short rejection branches.
 *
 * When an exclusive gateway has a short rejection branch (≤2 hops to
 * end event) alongside a happy-path branch to a fork gateway, synthetic
 * edges ensure proper layer assignment so ELK doesn't collapse the
 * rejection branch into the fork gateway's layer.
 */
function addSyntheticOrderingEdges(
  gatewayDefaults: Map<string, string>,
  shortBranchEdgeIds: Set<string>,
  internalConns: any[],
  backEdgeIds: Set<string>,
  nodeIds: Set<string>,
  childShapes: any[],
  outgoingAdj: Map<string, any[]>,
  edges: ElkExtendedEdge[]
): void {
  for (const [gwId, defaultFlowId] of gatewayDefaults) {
    if (!shortBranchEdgeIds.has(defaultFlowId)) continue;

    const defaultConn = internalConns.find((c: any) => c.id === defaultFlowId);
    if (!defaultConn?.target) continue;
    const rejTargetId = defaultConn.target.id;
    if (!nodeIds.has(rejTargetId)) continue;

    // Find a non-default (happy-path) outgoing edge that leads to a gateway
    const happyEdge = internalConns.find(
      (c: any) =>
        c.source.id === gwId &&
        c.id !== defaultFlowId &&
        !backEdgeIds.has(c.id) &&
        c.target &&
        nodeIds.has(c.target.id)
    );
    if (!happyEdge?.target) continue;
    const forkId = happyEdge.target.id;

    // Only add synthetic edges if the happy-path target is a gateway
    const forkShape = childShapes.find((s: any) => s.id === forkId);
    if (!forkShape?.type?.includes('Gateway')) continue;

    // Synthetic edge 1: Fork → rejection target
    edges.push({
      id: `__align_rej_task__${defaultFlowId}`,
      sources: [forkId],
      targets: [rejTargetId],
      layoutOptions: { 'elk.priority.shortness': ELK_HIGH_PRIORITY },
    });

    // Find the rejection end event (follow forward from rejection target)
    let rejEndEventId: string | null = null;
    if (defaultConn.target.type === 'bpmn:EndEvent') {
      rejEndEventId = rejTargetId;
    } else {
      const rejOutConns = outgoingAdj.get(rejTargetId);
      if (rejOutConns?.length === 1 && rejOutConns[0].target?.type === 'bpmn:EndEvent') {
        rejEndEventId = rejOutConns[0].target.id;
      }
    }
    if (!rejEndEventId || !nodeIds.has(rejEndEventId)) continue;

    // Trace happy path from fork to find predecessor of end event
    let traceId = forkId;
    let predecessorOfEnd: string | null = null;
    const traceVisited = new Set<string>([gwId]);

    for (let step = 0; step < 15; step++) {
      traceVisited.add(traceId);
      const nextConns = (outgoingAdj.get(traceId) || []).filter(
        (c: any) => c.target && !traceVisited.has(c.target.id) && nodeIds.has(c.target.id)
      );
      if (nextConns.length === 0) break;

      const endConn = nextConns.find((c: any) => c.target.type === 'bpmn:EndEvent');
      if (endConn) {
        predecessorOfEnd = traceId;
        break;
      }

      traceId = nextConns[0].target.id;
    }

    if (predecessorOfEnd && predecessorOfEnd !== rejEndEventId) {
      edges.push({
        id: `__align_rej_end__${defaultFlowId}`,
        sources: [predecessorOfEnd],
        targets: [rejEndEventId],
        layoutOptions: { 'elk.priority.shortness': ELK_HIGH_PRIORITY },
      });
    }
  }
}

/**
 * Detect back-edges (cycle-causing edges) in a set of connections using DFS.
 *
 * A back-edge is an edge from a node to one of its ancestors in the DFS
 * tree.  These are the edges that create cycles in the graph.  By
 * identifying them, we can tag them with low priority so ELK's cycle
 * breaker reverses these specific edges rather than arbitrary ones,
 * preserving left-to-right directionality for the main (forward) path.
 *
 * The DFS starts from "source" nodes (those with no incoming edges among
 * the given connections), ensuring the DFS tree follows the natural
 * forward flow direction.  This makes back-edge detection robust
 * regardless of element insertion order.
 *
 * @returns Set of connection IDs that are back-edges.
 */
function detectBackEdges(connections: any[], nodeIds: Set<string>): Set<string> {
  const backEdges = new Set<string>();
  if (connections.length === 0) return backEdges;

  // Build adjacency list: source → [{ target, connId }]
  const adjacency = new Map<string, Array<{ target: string; connId: string }>>();
  const hasIncoming = new Set<string>();

  for (const conn of connections) {
    const srcId = conn.source.id;
    const tgtId = conn.target.id;
    if (!adjacency.has(srcId)) adjacency.set(srcId, []);
    adjacency.get(srcId)!.push({ target: tgtId, connId: conn.id });
    hasIncoming.add(tgtId);
  }

  // DFS state: 0 = unvisited, 1 = in-progress (on stack), 2 = done
  const state = new Map<string, number>();
  for (const nodeId of nodeIds) {
    state.set(nodeId, 0);
  }

  function dfs(nodeId: string): void {
    state.set(nodeId, 1); // in-progress

    const neighbors = adjacency.get(nodeId) || [];
    for (const { target, connId } of neighbors) {
      const targetState = state.get(target);
      if (targetState === 1) {
        // Target is an ancestor on the current DFS path → back-edge
        backEdges.add(connId);
      } else if (targetState === 0) {
        dfs(target);
      }
    }

    state.set(nodeId, 2); // done
  }

  // Start DFS from source nodes (no incoming edges) first.
  // This ensures the DFS tree follows the natural forward flow,
  // making loop-back edges the ones detected as back-edges.
  const sourceNodes = [...nodeIds].filter((id) => !hasIncoming.has(id));

  for (const nodeId of sourceNodes) {
    if (state.get(nodeId) === 0) {
      dfs(nodeId);
    }
  }

  // Then process any remaining unvisited nodes (disconnected components)
  for (const nodeId of nodeIds) {
    if (state.get(nodeId) === 0) {
      dfs(nodeId);
    }
  }

  return backEdges;
}
