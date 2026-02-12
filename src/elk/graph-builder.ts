/**
 * ELK graph construction from bpmn-js element registry.
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import type { BpmnElement } from '../bpmn-types';
import {
  ELK_LAYOUT_OPTIONS,
  CONTAINER_PADDING,
  PARTICIPANT_PADDING,
  PARTICIPANT_WITH_LANES_PADDING,
  DIVERSE_Y_THRESHOLD,
  ELK_HIGH_PRIORITY,
  BPMN_TASK_WIDTH,
  BPMN_TASK_HEIGHT,
  CENTER_FACTOR,
  CONTAINER_DEFAULT_WIDTH,
  CONTAINER_DEFAULT_HEIGHT,
  MAX_TRACE_DEPTH,
} from './constants';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';

/**
 * Build ELK child nodes and internal edges for a given container element.
 *
 * A "container" is any element whose children should be laid out together:
 * the root canvas element, a Participant (pool), or an expanded SubProcess.
 */
export function buildContainerGraph(
  allElements: BpmnElement[],
  container: BpmnElement,
  excludeIds?: Set<string>
): { children: ElkNode[]; edges: ElkExtendedEdge[]; hasDiverseY: boolean } {
  const childShapes = collectAndSortChildShapes(allElements, container, excludeIds);
  const hasDiverseY = detectDiverseYPositions(childShapes);

  const { children, nodeIds } = buildChildNodes(allElements, childShapes, excludeIds);
  if (children.length === 0) return { children, edges: [], hasDiverseY };

  const edges = buildEdges(allElements, container, childShapes, nodeIds);

  return { children, edges, hasDiverseY };
}

/**
 * Collect direct child shapes for a container, filtering out connections,
 * boundary events, infrastructure, artifacts, lanes, and excluded elements.
 * Sorted by DI Y-position to preserve imported diagram order.
 */
function collectAndSortChildShapes(
  allElements: BpmnElement[],
  container: BpmnElement,
  excludeIds?: Set<string>
): BpmnElement[] {
  const childShapes = allElements.filter(
    (el) =>
      el.parent === container &&
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      !isLane(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      !(excludeIds && excludeIds.has(el.id))
  );

  // Sort by DI Y-position (ascending = top-first) for ELK model order.
  childShapes.sort((a, b) => {
    const ay = a.y + (a.height || 0) / 2;
    const by = b.y + (b.height || 0) / 2;
    return ay - by;
  });

  return childShapes;
}

/**
 * Detect if elements have diverse DI Y-positions (imported BPMN).
 * Threshold of 100px distinguishes genuine imported DI layouts from
 * auto-positioned elements.
 */
function detectDiverseYPositions(childShapes: BpmnElement[]): boolean {
  if (childShapes.length === 0) return false;
  const yCentres = childShapes.map((s) => s.y + (s.height || 0) / 2);
  const minY = Math.min(...yCentres);
  const maxY = Math.max(...yCentres);
  return maxY - minY > DIVERSE_Y_THRESHOLD;
}

/**
 * Build ELK child nodes from child shapes, recursing into compound nodes
 * (participants, expanded subprocesses).
 */
function buildChildNodes(
  allElements: BpmnElement[],
  childShapes: BpmnElement[],
  excludeIds?: Set<string>
): { children: ElkNode[]; nodeIds: Set<string> } {
  const children: ElkNode[] = [];
  const nodeIds = new Set<string>();

  for (const shape of childShapes) {
    nodeIds.add(shape.id);

    const hasChildren = allElements.some(
      (el) =>
        el.parent === shape &&
        !isInfrastructure(el.type) &&
        !isConnection(el.type) &&
        el.type !== 'bpmn:BoundaryEvent'
    );

    if (hasChildren) {
      children.push(buildCompoundNode(allElements, shape, excludeIds));
    } else {
      children.push({
        id: shape.id,
        width: shape.width || BPMN_TASK_WIDTH,
        height: shape.height || BPMN_TASK_HEIGHT,
      });
    }
  }

  return { children, nodeIds };
}

/**
 * Build a compound ELK node (participant or expanded subprocess) by
 * recursing into buildContainerGraph.
 */
function buildCompoundNode(
  allElements: BpmnElement[],
  shape: BpmnElement,
  excludeIds?: Set<string>
): ElkNode {
  const isParticipant = shape.type === 'bpmn:Participant';
  const nested = buildContainerGraph(allElements, shape, excludeIds);

  let padding: string;
  if (isParticipant) {
    const hasLanes = allElements.some((el) => el.parent === shape && isLane(el.type));
    padding = hasLanes ? PARTICIPANT_WITH_LANES_PADDING : PARTICIPANT_PADDING;
  } else {
    padding = CONTAINER_PADDING;
  }

  return {
    id: shape.id,
    width: shape.width || CONTAINER_DEFAULT_WIDTH,
    height: shape.height || CONTAINER_DEFAULT_HEIGHT,
    children: nested.children,
    edges: nested.edges,
    layoutOptions: {
      ...ELK_LAYOUT_OPTIONS,
      'elk.padding': padding,
    },
  };
}

/**
 * Build ELK edges for internal connections, including back-edge detection,
 * decision gateway shortness priorities, synthetic ordering edges, and
 * boundary event proxy edges.
 */
function buildEdges(
  allElements: BpmnElement[],
  container: BpmnElement,
  childShapes: BpmnElement[],
  nodeIds: Set<string>
): ElkExtendedEdge[] {
  const edges: ElkExtendedEdge[] = [];

  // Connections whose source AND target are both in this container
  const childConnections = allElements.filter(
    (el) => el.parent === container && isConnection(el.type) && !!el.source && !!el.target
  );

  const internalConns = childConnections.filter(
    (c) => nodeIds.has(c.source!.id) && nodeIds.has(c.target!.id)
  );

  // Sort edges by target Y-position for DI order preservation
  internalConns.sort((a, b) => {
    if (a.source!.id !== b.source!.id) return 0;
    const aTargetY = a.target!.y + (a.target!.height || 0) * CENTER_FACTOR;
    const bTargetY = b.target!.y + (b.target!.height || 0) * CENTER_FACTOR;
    return aTargetY - bTargetY;
  });

  const backEdgeIds = detectBackEdges(internalConns, nodeIds);

  // Analyse decision gateways and outgoing edge counts
  const outgoingCount = new Map<string, number>();
  for (const conn of internalConns) {
    const srcId = conn.source!.id;
    outgoingCount.set(srcId, (outgoingCount.get(srcId) || 0) + 1);
  }

  const decisionGatewayIds = new Set<string>();
  const gatewayDefaults = new Map<string, string>();
  for (const shape of childShapes) {
    if (shape.type === 'bpmn:ExclusiveGateway' || shape.type === 'bpmn:InclusiveGateway') {
      decisionGatewayIds.add(shape.id);
      if (shape.businessObject?.default) {
        gatewayDefaults.set(shape.id, shape.businessObject.default.id);
      }
    }
  }

  const outgoingAdj = new Map<string, BpmnElement[]>();
  for (const conn of internalConns) {
    const list = outgoingAdj.get(conn.source!.id) || [];
    list.push(conn);
    outgoingAdj.set(conn.source!.id, list);
  }

  const shortBranchEdgeIds = detectShortBranches(
    gatewayDefaults,
    decisionGatewayIds,
    internalConns,
    outgoingAdj
  );

  // Build prioritised edges
  for (const conn of internalConns) {
    const edge: ElkExtendedEdge = {
      id: conn.id,
      sources: [conn.source!.id],
      targets: [conn.target!.id],
    };
    if (backEdgeIds.has(conn.id)) {
      edge.layoutOptions = { 'elk.priority': '0' };
    } else {
      const srcId = conn.source!.id;
      const isSplitDecisionGateway =
        decisionGatewayIds.has(srcId) && (outgoingCount.get(srcId) || 0) >= 2;
      if (isSplitDecisionGateway && !shortBranchEdgeIds.has(conn.id)) {
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

  addBoundaryProxyEdges(allElements, container, childConnections, nodeIds, edges);

  return edges;
}

/**
 * Add proxy edges for boundary event flows.
 * Boundary events are excluded from ELK nodes, but their outgoing flows
 * need to be represented so ELK positions the targets properly.
 */
function addBoundaryProxyEdges(
  allElements: BpmnElement[],
  container: BpmnElement,
  childConnections: BpmnElement[],
  nodeIds: Set<string>,
  edges: ElkExtendedEdge[]
): void {
  const boundaryEvents = allElements.filter(
    (el) => el.parent === container && el.type === 'bpmn:BoundaryEvent' && el.host
  );
  for (const be of boundaryEvents) {
    const hostId = be.host!.id;
    if (!nodeIds.has(hostId)) continue;

    const beOutgoing = childConnections.filter(
      (conn) => conn.source!.id === be.id && nodeIds.has(conn.target!.id)
    );
    for (const conn of beOutgoing) {
      edges.push({
        id: `__boundary_proxy__${conn.id}`,
        sources: [hostId],
        targets: [conn.target!.id],
      });
    }
  }
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
  internalConns: BpmnElement[],
  outgoingAdj: Map<string, BpmnElement[]>
): Set<string> {
  const BPMN_END_EVENT = 'bpmn:EndEvent';
  const shortBranchEdgeIds = new Set<string>();
  for (const [gwId, defaultFlowId] of gatewayDefaults) {
    if (!decisionGatewayIds.has(gwId)) continue;
    const defaultConn = internalConns.find((c) => c.id === defaultFlowId);
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
  internalConns: BpmnElement[],
  backEdgeIds: Set<string>,
  nodeIds: Set<string>,
  childShapes: BpmnElement[],
  outgoingAdj: Map<string, BpmnElement[]>,
  edges: ElkExtendedEdge[]
): void {
  for (const [gwId, defaultFlowId] of gatewayDefaults) {
    if (!shortBranchEdgeIds.has(defaultFlowId)) continue;

    const defaultConn = internalConns.find((c) => c.id === defaultFlowId);
    if (!defaultConn?.target) continue;
    const rejTargetId = defaultConn.target.id;
    if (!nodeIds.has(rejTargetId)) continue;

    // Find a non-default (happy-path) outgoing edge that leads to a gateway
    const happyEdge = internalConns.find(
      (c) =>
        c.source!.id === gwId &&
        c.id !== defaultFlowId &&
        !backEdgeIds.has(c.id) &&
        c.target &&
        nodeIds.has(c.target.id)
    );
    if (!happyEdge?.target) continue;
    const forkId = happyEdge.target.id;

    // Only add synthetic edges if the happy-path target is a gateway
    const forkShape = childShapes.find((s) => s.id === forkId);
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

    for (let step = 0; step < MAX_TRACE_DEPTH; step++) {
      traceVisited.add(traceId);
      const nextConns = (outgoingAdj.get(traceId) || []).filter(
        (c) => c.target && !traceVisited.has(c.target.id) && nodeIds.has(c.target.id)
      );
      if (nextConns.length === 0) break;

      const endConn = nextConns.find((c) => c.target!.type === 'bpmn:EndEvent');
      if (endConn) {
        predecessorOfEnd = traceId;
        break;
      }

      traceId = nextConns[0].target!.id;
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
function detectBackEdges(connections: BpmnElement[], nodeIds: Set<string>): Set<string> {
  const backEdges = new Set<string>();
  if (connections.length === 0) return backEdges;

  // Build adjacency list: source → [{ target, connId }]
  const adjacency = new Map<string, Array<{ target: string; connId: string }>>();
  const hasIncoming = new Set<string>();

  for (const conn of connections) {
    const srcId = conn.source!.id;
    const tgtId = conn.target!.id;
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
