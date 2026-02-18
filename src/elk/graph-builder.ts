/**
 * ELK graph construction from bpmn-js element registry.
 */

import type { ElkNode, ElkExtendedEdge, ElkPort } from 'elkjs';
import type { BpmnElement } from '../bpmn-types';
import {
  ELK_LAYOUT_OPTIONS,
  CONTAINER_PADDING,
  EVENT_SUBPROCESS_PADDING,
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

// ── BPMN element type constants ────────────────────────────────────────
const BPMN_START_EVENT = 'bpmn:StartEvent';
const BPMN_END_EVENT = 'bpmn:EndEvent';

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

  // Add ELK port constraints to split decision gateways for deterministic
  // branch ordering (happy-path exits EAST, off-path exits SOUTH).
  addGatewayPorts(children, edges, childShapes);

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
      // Exclude event subprocesses from main layout — they'll be positioned separately
      !(el.type === 'bpmn:SubProcess' && el.businessObject?.triggeredByEvent === true) &&
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

    // Only treat as a compound node if it has children AND is not a
    // collapsed subprocess.  Collapsed subprocesses have children on a
    // separate drill-down plane but should be laid out as simple nodes.
    const isCompound =
      hasChildren && (shape.type !== 'bpmn:SubProcess' || shape.isExpanded !== false);

    if (isCompound) {
      children.push(buildCompoundNode(allElements, shape, excludeIds));
    } else {
      const node: ElkNode = {
        id: shape.id,
        width: shape.width || BPMN_TASK_WIDTH,
        height: shape.height || BPMN_TASK_HEIGHT,
      };

      // Pin start events to the first layer. End events are naturally last in
      // the graph (no outgoing edges), so ELK places them last without an
      // explicit constraint. Pinning end events to LAST can conflict with
      // gateway SOUTH-port constraints — when an off-path branch leads to an
      // end event, the LAST constraint forces it into the main row's last
      // layer rather than letting the SOUTH port push it to the row below.
      if (shape.type === BPMN_START_EVENT) {
        node.layoutOptions = { 'elk.layered.layering.layerConstraint': 'FIRST' };
      }

      children.push(node);
    }
  }

  return { children, nodeIds };
}

/**
 * Build a compound ELK node (participant or expanded subprocess) by
 * recursing into buildContainerGraph.
 */
export function buildCompoundNode(
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
    // Use reduced padding for event subprocesses (triggeredByEvent=true)
    const isEventSubprocess =
      shape.type === 'bpmn:SubProcess' && shape.businessObject?.triggeredByEvent === true;
    padding = isEventSubprocess ? EVENT_SUBPROCESS_PADDING : CONTAINER_PADDING;
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

  // Re-order edges from the same gateway so the happy-path (non-default,
  // positive-labelled) edge comes first in model order.  ELK's LAYER_SWEEP
  // uses model order to assign vertical positions — first edge target tends
  // to stay on the main row.
  reorderGatewayEdgesForHappyPath(internalConns, childShapes);

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
    if (defaultConn.target.type === BPMN_END_EVENT) {
      rejEndEventId = rejTargetId;
    } else {
      const rejOutConns = outgoingAdj.get(rejTargetId);
      if (rejOutConns?.length === 1 && rejOutConns[0].target?.type === BPMN_END_EVENT) {
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

      const endConn = nextConns.find((c) => c.target!.type === BPMN_END_EVENT);
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

// ── Gateway port constraints ────────────────────────────────────────────

/**
 * Detect "balanced diamond" gateways: all outgoing branches from a split
 * gateway converge to the SAME immediate merge gateway within 1 hop
 * (split → task/event → merge).  For these, port constraints cause ELK to
 * assign the branches to different layers; without constraints, ELK
 * correctly places both tasks in the same layer.
 *
 * Returns a Set of gateway IDs that are balanced diamonds.
 */
function detectBalancedDiamonds(gwIds: Set<string>, edges: ElkExtendedEdge[]): Set<string> {
  const balancedDiamonds = new Set<string>();

  // Build adjacency: for each real edge, map source→targets and target←sources
  const outAdj = new Map<string, string[]>(); // nodeId → [targetId]
  const inAdj = new Map<string, string[]>(); // nodeId → [sourceId]
  for (const edge of edges) {
    if (edge.id.startsWith('__')) continue;
    const src = edge.sources[0];
    const tgt = edge.targets[0];
    if (!src || !tgt) continue;
    if (!outAdj.has(src)) outAdj.set(src, []);
    outAdj.get(src)!.push(tgt);
    if (!inAdj.has(tgt)) inAdj.set(tgt, []);
    inAdj.get(tgt)!.push(src);
  }

  for (const gwId of gwIds) {
    const directTargets = outAdj.get(gwId) || [];
    if (directTargets.length < 2) continue;

    // For each direct target, find where it flows next (1-hop)
    const mergeTargets = new Set<string>();
    for (const branchNode of directTargets) {
      const nextNodes = outAdj.get(branchNode) || [];
      for (const n of nextNodes) mergeTargets.add(n);
    }

    // Balanced diamond: all branches converge to the SAME single merge node
    if (mergeTargets.size !== 1) continue;
    const [mergeId] = mergeTargets;

    // Every direct target of the split gateway must flow into the merge node
    const allConverge = directTargets.every((branchNode) => {
      const nextNodes = outAdj.get(branchNode) || [];
      return nextNodes.includes(mergeId);
    });

    if (allConverge) {
      balancedDiamonds.add(gwId);
    }
  }

  return balancedDiamonds;
}

/**
 * Add ELK port constraints to split decision gateways (exclusive/inclusive
 * with ≥2 outgoing edges) for deterministic branch ordering.
 *
 * Off-path edges exit via SOUTH ports, pushing their targets below the
 * happy-path branch.  The happy-path edge (i=0) has no explicit port —
 * it exits the gateway naturally to the EAST in LTR layout.
 *
 * Exception: "balanced diamond" gateways (all branches converge to the same
 * immediate merge gateway within 1 hop) are skipped — port constraints cause
 * ELK to place branches in different layers for these patterns, while no
 * constraints correctly places them in the same layer.
 *
 * Mutates `children` (adds ports to gateway nodes) and `edges` (updates
 * source references to port IDs).
 */
function addGatewayPorts(
  children: ElkNode[],
  edges: ElkExtendedEdge[],
  childShapes: BpmnElement[]
): void {
  const nodeMap = new Map<string, ElkNode>();
  for (const child of children) {
    nodeMap.set(child.id, child);
  }

  // Identify exclusive/inclusive gateway shapes
  const gwIds = new Set<string>();
  for (const shape of childShapes) {
    if (shape.type === 'bpmn:ExclusiveGateway' || shape.type === 'bpmn:InclusiveGateway') {
      gwIds.add(shape.id);
    }
  }
  if (gwIds.size === 0) return;

  // Detect balanced diamond patterns — skip port constraints for these.
  const balancedDiamonds = detectBalancedDiamonds(gwIds, edges);

  // Group real (non-synthetic) outgoing edges by gateway source.
  // Edges are in happy-path-first order from reorderGatewayEdgesForHappyPath.
  const gwOutgoing = new Map<string, ElkExtendedEdge[]>();
  for (const edge of edges) {
    if (edge.id.startsWith('__')) continue;
    const srcId = edge.sources[0];
    if (gwIds.has(srcId)) {
      const list = gwOutgoing.get(srcId) || [];
      list.push(edge);
      gwOutgoing.set(srcId, list);
    }
  }

  for (const [gwId, outEdges] of gwOutgoing) {
    if (outEdges.length < 2) continue;
    const node = nodeMap.get(gwId);
    if (!node) continue;

    // Skip port constraints for balanced diamonds — ELK places both branches
    // in the same layer without constraints, which is the correct behavior.
    if (balancedDiamonds.has(gwId)) continue;

    // Happy-path edge (i=0) gets no explicit port — it exits the gateway
    // naturally to the EAST in LTR layout.  Off-path edges (i≥1) get SOUTH
    // ports so ELK routes them downward.
    const ports: ElkPort[] = [];
    for (let i = 0; i < outEdges.length; i++) {
      if (i === 0) continue; // Happy path: no port constraint, natural east exit
      const portId = `${gwId}__port_${i}`;
      ports.push({
        id: portId,
        width: 1,
        height: 1,
        layoutOptions: {
          'elk.port.side': 'SOUTH',
          'elk.port.index': String(i),
        },
      });
      outEdges[i].sources = [portId];
    }

    if (ports.length === 0) continue; // Only happy-path edge, no south ports needed

    node.ports = (node.ports || []).concat(ports);
    node.layoutOptions = {
      ...node.layoutOptions,
      'elk.portConstraints': 'FIXED_SIDE',
    };
  }
}

// ── Positive label regex (matches happy-path condition names) ───────────

const POSITIVE_LABELS =
  /^(yes|approved|ok|true|success|valid|accept|accepted|completed|done|correct|passed)$/i;

/**
 * Re-order edges from gateway sources so the happy-path edge (non-default,
 * positive-labelled) comes first in model order.  ELK's LAYER_SWEEP uses
 * model order to determine vertical positions — the first edge's target
 * tends to stay on the main row.
 *
 * Mutates `internalConns` in-place.
 */
function reorderGatewayEdgesForHappyPath(
  internalConns: BpmnElement[],
  childShapes: BpmnElement[]
): void {
  // Collect gateway IDs (exclusive/inclusive) with their default flows
  const gatewayDefaults = new Map<string, string>();
  const gatewayIds = new Set<string>();
  for (const shape of childShapes) {
    if (shape.type === 'bpmn:ExclusiveGateway' || shape.type === 'bpmn:InclusiveGateway') {
      gatewayIds.add(shape.id);
      if (shape.businessObject?.default) {
        gatewayDefaults.set(shape.id, shape.businessObject.default.id);
      }
    }
  }

  if (gatewayIds.size === 0) return;

  // Group edges by gateway source
  const groups = new Map<string, { start: number; end: number }>();
  for (let i = 0; i < internalConns.length; i++) {
    const srcId = internalConns[i].source!.id;
    if (!gatewayIds.has(srcId)) continue;
    const existing = groups.get(srcId);
    if (existing) {
      existing.end = i + 1;
    } else {
      groups.set(srcId, { start: i, end: i + 1 });
    }
  }

  for (const [gwId, { start, end }] of groups) {
    if (end - start < 2) continue;

    const slice = internalConns.slice(start, end);
    const defaultFlowId = gatewayDefaults.get(gwId);

    // Sort: happy-path first (non-default, positive label), then others,
    // default flow last.
    slice.sort((a, b) => {
      const aScore = edgeHappyScore(a, defaultFlowId);
      const bScore = edgeHappyScore(b, defaultFlowId);
      return aScore - bScore; // lower score = higher priority (comes first)
    });

    // Write back
    for (let i = 0; i < slice.length; i++) {
      internalConns[start + i] = slice[i];
    }
  }
}

/**
 * Compute a sort score for a gateway outgoing edge.
 * Lower = more likely happy path.
 *  0 = positive-labelled and non-default
 *  1 = non-default, non-positive
 *  2 = default flow
 */
function edgeHappyScore(conn: BpmnElement, defaultFlowId?: string): number {
  if (defaultFlowId && conn.id === defaultFlowId) return 2;
  const name = conn.businessObject?.name?.trim();
  if (name && POSITIVE_LABELS.test(name)) return 0;
  return 1;
}
