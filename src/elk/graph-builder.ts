/**
 * ELK graph construction from bpmn-js element registry.
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import { ELK_LAYOUT_OPTIONS, CONTAINER_PADDING, PARTICIPANT_PADDING } from './constants';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';

/**
 * Build ELK child nodes and internal edges for a given container element.
 *
 * A "container" is any element whose children should be laid out together:
 * the root canvas element, a Participant (pool), or an expanded SubProcess.
 */
export function buildContainerGraph(
  allElements: any[],
  container: any
): { children: ElkNode[]; edges: ElkExtendedEdge[] } {
  const children: ElkNode[] = [];
  const edges: ElkExtendedEdge[] = [];
  const nodeIds = new Set<string>();

  // Direct child shapes (skip connections, boundary events, infrastructure, artifacts, lanes)
  const childShapes = allElements.filter(
    (el: any) =>
      el.parent === container &&
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      !isLane(el.type) &&
      el.type !== 'bpmn:BoundaryEvent'
  );

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
      const nested = buildContainerGraph(allElements, shape);
      children.push({
        id: shape.id,
        width: shape.width || 300,
        height: shape.height || 200,
        children: nested.children,
        edges: nested.edges,
        layoutOptions: {
          ...ELK_LAYOUT_OPTIONS,
          'elk.padding': isParticipant ? PARTICIPANT_PADDING : CONTAINER_PADDING,
        },
      });
    } else {
      children.push({
        id: shape.id,
        width: shape.width || 100,
        height: shape.height || 80,
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
  const backEdgeIds = detectBackEdges(internalConns, nodeIds);

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
    }
    edges.push(edge);
  }

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

  return { children, edges };
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
