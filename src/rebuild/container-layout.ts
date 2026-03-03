/**
 * Container hierarchy analysis and layout utilities for the rebuild engine.
 *
 * Handles:
 * - Container hierarchy (Process → Participant → SubProcess) analysis
 * - Boundary event positioning on host bottom borders
 * - Exception chain placement below boundary events
 * - Subprocess resizing to fit internal elements
 * - Participant pool stacking for collaborations
 * - Message flow routing after pool positioning
 *
 * Merged from: containers.ts + container-layout.ts
 */

import type { BpmnElement, ElementRegistry, EventBus, Modeling } from '../bpmn-types';
import type { BoundaryEventInfo } from './boundary';
import type { RebuildResult } from './engine';
import { resetStaleWaypoints } from './waypoints';

// ── Types ──────────────────────────────────────────────────────────────────

/** A node in the container hierarchy tree. */
export interface ContainerNode {
  /** The container element (Process, Participant, or SubProcess). */
  element: BpmnElement;
  /** Child containers nested inside this one. */
  children: ContainerNode[];
  /** IDs of flow nodes that are direct children of this container
   *  (not inside a nested subprocess). */
  flowNodeIds: string[];
  /** Whether this is an event subprocess (triggered by event). */
  isEventSubprocess: boolean;
  /** Whether this container is expanded (has visible internal elements). */
  isExpanded: boolean;
}

/** The complete container hierarchy for a diagram. */
export interface ContainerHierarchy {
  /** The root container(s) — typically one Process or multiple Participants. */
  roots: ContainerNode[];
  /** Flat map of element ID → ContainerNode for quick lookup. */
  containers: Map<string, ContainerNode>;
}

// ── Hierarchy analysis ─────────────────────────────────────────────────────

/**
 * Build the container hierarchy from an ElementRegistry.
 *
 * Analyses the parent-child relationships in the element registry to
 * build a tree of containers (Process, Participant, SubProcess).
 * Each container's direct flow node children are recorded for rebuild
 * scoping.
 *
 * @param registry  The bpmn-js ElementRegistry service.
 * @returns         The ContainerHierarchy.
 */
export function buildContainerHierarchy(registry: ElementRegistry): ContainerHierarchy {
  const allElements: BpmnElement[] = registry.getAll();
  return buildContainerHierarchyFromElements(allElements);
}

/**
 * Build the container hierarchy from a flat list of elements.
 * Separated from registry-based wrapper for testability.
 */
export function buildContainerHierarchyFromElements(
  allElements: BpmnElement[]
): ContainerHierarchy {
  const containers = new Map<string, ContainerNode>();
  const roots: ContainerNode[] = [];

  // 1. Identify all container elements
  for (const el of allElements) {
    if (isContainerType(el)) {
      containers.set(el.id, {
        element: el,
        children: [],
        flowNodeIds: [],
        isEventSubprocess:
          el.type === 'bpmn:SubProcess' && el.businessObject?.triggeredByEvent === true,
        isExpanded: el.type !== 'bpmn:SubProcess' || el.isExpanded !== false,
      });
    }
  }

  // 2. Build parent-child relationships between containers
  for (const [, node] of containers) {
    const parent = findParentContainer(node.element, containers);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // 3. Assign flow nodes to their direct container
  for (const el of allElements) {
    if (!isFlowNodeForHierarchy(el)) continue;

    const parentContainer = findDirectContainer(el, containers);
    if (parentContainer) {
      parentContainer.flowNodeIds.push(el.id);
    }
  }

  // 4. Sort children for deterministic ordering:
  //    event subprocesses come after regular subprocesses
  for (const [, node] of containers) {
    node.children.sort((a, b) => {
      if (a.isEventSubprocess !== b.isEventSubprocess) {
        return a.isEventSubprocess ? 1 : -1;
      }
      return a.element.y - b.element.y;
    });
  }

  return { roots, containers };
}

/**
 * Get the rebuild order for containers (inside-out: deepest first).
 *
 * Returns containers in the order they should be rebuilt:
 * deepest subprocesses first, then their parents, finally the root.
 * This ensures that when a container is being positioned, its internal
 * elements have already been laid out and its size is known.
 */
export function getContainerRebuildOrder(hierarchy: ContainerHierarchy): ContainerNode[] {
  const order: ContainerNode[] = [];

  function postOrder(node: ContainerNode): void {
    for (const child of node.children) {
      postOrder(child);
    }
    order.push(node);
  }

  for (const root of hierarchy.roots) {
    postOrder(root);
  }

  return order;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Check if an element is a container that can hold flow nodes. */
function isContainerType(el: BpmnElement): boolean {
  return (
    el.type === 'bpmn:Process' ||
    el.type === 'bpmn:Participant' ||
    (el.type === 'bpmn:SubProcess' && el.isExpanded !== false)
  );
}

/** Check if an element is a flow node for hierarchy assignment purposes. */
function isFlowNodeForHierarchy(el: BpmnElement): boolean {
  const type = el.type;
  return (
    type !== 'bpmn:Process' &&
    type !== 'bpmn:Collaboration' &&
    type !== 'bpmn:Participant' &&
    type !== 'bpmn:Lane' &&
    type !== 'bpmn:LaneSet' &&
    type !== 'bpmn:SequenceFlow' &&
    type !== 'bpmn:MessageFlow' &&
    type !== 'bpmn:Association' &&
    type !== 'bpmn:TextAnnotation' &&
    type !== 'bpmn:DataObjectReference' &&
    type !== 'bpmn:DataStoreReference' &&
    type !== 'bpmn:Group' &&
    type !== 'label' &&
    !type.includes('BPMNDiagram') &&
    !type.includes('BPMNPlane')
  );
}

/** Find the nearest parent that is a container. */
function findParentContainer(
  el: BpmnElement,
  containers: Map<string, ContainerNode>
): ContainerNode | undefined {
  let current = el.parent;
  while (current) {
    const container = containers.get(current.id);
    if (container) return container;
    current = current.parent;
  }
  return undefined;
}

/** Find the direct container for a flow node. */
function findDirectContainer(
  el: BpmnElement,
  containers: Map<string, ContainerNode>
): ContainerNode | undefined {
  // The direct parent of a flow node should be a container
  if (el.parent) {
    const container = containers.get(el.parent.id);
    if (container) return container;
  }
  return findParentContainer(el, containers);
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Gap (px) between host task bottom edge and exception chain element
 * top edge.  Matches BOUNDARY_GAP spacing constant.
 */
const BOUNDARY_GAP = 40;

// ── Element movement ───────────────────────────────────────────────────────

/**
 * Move an element so its centre is at the given target position.
 * Returns true if the element was actually moved (delta ≥ 1px).
 *
 * For boundary events, uses direct position + DI mutation instead of
 * `modeling.moveElements()` to prevent bpmn-js's `AttachSupport`
 * behaviour from detaching the boundary event from its host.
 */
export function moveElementTo(
  modeling: Modeling,
  element: BpmnElement,
  targetCenter: { x: number; y: number },
  eventBus?: EventBus
): boolean {
  const currentCenterX = element.x + element.width / 2;
  const currentCenterY = element.y + element.height / 2;

  const dx = Math.round(targetCenter.x - currentCenterX);
  const dy = Math.round(targetCenter.y - currentCenterY);

  if (dx === 0 && dy === 0) return false;

  // For boundary events, mutate position directly to prevent bpmn-js
  // AttachSupport from detaching the event from its host.
  // modeling.moveElements() triggers attach-detection logic that can
  // convert boundary events into standalone IntermediateCatchEvents.
  // Direct DI mutation keeps the host relationship intact and produces
  // correct coordinates in the exported XML.
  if (element.type === 'bpmn:BoundaryEvent') {
    element.x += dx;
    element.y += dy;
    const di = (element as any).di;
    if (di?.bounds) {
      di.bounds.x = element.x;
      di.bounds.y = element.y;
    }
    // Notify the canvas renderer so the SVG <g> transform is updated.
    // Direct model mutation updates the DI (XML export) but does NOT fire
    // a canvas event, so the SVG export shows the old position without this.
    eventBus?.fire('element.changed', { element });
    return true;
  }

  modeling.moveElements([element], { x: dx, y: dy });
  return true;
}

// ── Exception chain helpers ────────────────────────────────────────────────

/** Collect all element IDs that belong to exception chains. */
export function collectExceptionChainIds(boundaryInfos: BoundaryEventInfo[]): Set<string> {
  const ids = new Set<string>();
  for (const info of boundaryInfos) {
    for (const id of info.exceptionChain) {
      ids.add(id);
    }
  }
  return ids;
}

// ── Safe connection layout helper ─────────────────────────────────────────

/**
 * Layout a single connection, catching ManhattanLayout docking errors.
 * Resets stale waypoints before layout to ensure ManhattanLayout computes
 * fresh routing based on current element positions.
 * Returns true if the connection was laid out successfully, false on error.
 */
function layoutConnectionSafe(modeling: Modeling, connElement: any): boolean {
  try {
    resetStaleWaypoints(connElement);
    modeling.layoutConnection(connElement);
    return true;
  } catch {
    // ManhattanLayout throws "unexpected dockingDirection: <undefined>" when
    // connection waypoints are inconsistent. Skip silently.
    return false;
  }
}

/**
 * Layout all outgoing connections from a single element.
 * Returns the count of successfully routed connections.
 */
function layoutOutgoingConnections(
  registry: ElementRegistry,
  modeling: Modeling,
  element: any
): number {
  let count = 0;
  for (const conn of element.outgoing ?? []) {
    const connElement = registry.get(conn.id);
    if (connElement && layoutConnectionSafe(modeling, connElement)) count++;
  }
  return count;
}

/**
 * Route outgoing connections from a bottom-attached boundary event so that
 * they exit from the BOTTOM of the event (straight down) rather than the
 * right side (which ManhattanLayout picks by default when the target is to
 * the right-and-below).
 *
 * Pre-sets a 3-point V→H waypoint path (exit bottom → drop to target Y →
 * approach target from left) to hint ManhattanLayout toward a downward exit,
 * then calls modeling.layoutConnection() DIRECTLY — without going through
 * resetStaleWaypoints(), which would otherwise override the bottom-exit hint
 * via its "wrong-exit direction" check (Check 4 in detectStaleRouting).
 *
 * Returns the count of successfully routed connections.
 */
function layoutBoundaryEventConnections(
  registry: ElementRegistry,
  modeling: Modeling,
  boundaryEvent: BpmnElement,
  beCenter: { x: number; y: number },
  hasRightSibling: boolean
): number {
  let count = 0;
  const radius = (boundaryEvent.width ?? 36) / 2;
  const beBottomY = beCenter.y + radius;
  const beRightX = beCenter.x + radius;

  for (const conn of (boundaryEvent as any).outgoing ?? []) {
    const connElement = registry.get(conn.id);
    if (!connElement) continue;

    const target = (connElement as any).target;
    if (!target) continue;

    const targetMidY = (target as any).y + ((target as any).height ?? 80) / 2;
    const targetLeft = (target as any).x;

    // Only apply exit-routing hint when the target is below the boundary event.
    // For targets at the same Y or above, fall back to standard routing.
    if (targetMidY > beCenter.y) {
      if (hasRightSibling) {
        // RIGHT exit: go right at boundary event centre Y, then drop to target.
        // This prevents this chain's horizontal segment from crossing the right
        // sibling's bottom-exit vertical segment.
        const midX = Math.max(beRightX + 10, targetLeft);
        (connElement as any).waypoints = [
          { x: beRightX, y: beCenter.y, original: { x: beRightX, y: beCenter.y } },
          { x: midX, y: beCenter.y },
          { x: targetLeft, y: targetMidY, original: { x: targetLeft, y: targetMidY } },
        ];
      } else {
        // BOTTOM exit: go straight down from centre, then right to target.
        (connElement as any).waypoints = [
          { x: beCenter.x, y: beBottomY, original: { x: beCenter.x, y: beBottomY } },
          { x: beCenter.x, y: targetMidY },
          { x: targetLeft, y: targetMidY, original: { x: targetLeft, y: targetMidY } },
        ];
      }
    }

    // Call layoutConnection — ManhattanLayout may pick a different docking point.
    try {
      modeling.layoutConnection(connElement);
    } catch {
      // Silently skip docking errors.
    }

    // After layoutConnection, enforce the chosen exit direction:
    //
    // • Has right sibling → enforce RIGHT exit so this chain's horizontal leg
    //   stays above the right sibling's vertical leg (preventing a crossing).
    // • No right sibling → enforce BOTTOM exit for the cleanest single-turn path.
    if (targetMidY > beCenter.y) {
      const wps: Array<{ x: number; y: number }> | undefined = (connElement as any).waypoints;
      const firstWp = wps?.[0];
      if (hasRightSibling) {
        // Force right-exit if ManhattanLayout reverted to a bottom/left docking.
        if (firstWp && Math.abs(firstWp.x - beRightX) > 5) {
          try {
            modeling.updateWaypoints(connElement, [
              { x: beRightX, y: beCenter.y },
              { x: targetLeft, y: beCenter.y },
              { x: targetLeft, y: targetMidY },
            ]);
          } catch {
            // Ignore waypoint update errors.
          }
        }
      } else {
        // Force bottom-exit if ManhattanLayout chose a lateral docking point.
        if (firstWp && Math.abs(firstWp.y - beBottomY) > 5) {
          try {
            modeling.updateWaypoints(connElement, [
              { x: beCenter.x, y: beBottomY },
              { x: beCenter.x, y: targetMidY },
              { x: targetLeft, y: targetMidY },
            ]);
          } catch {
            // Ignore waypoint update errors.
          }
        }
      }
    }

    count++;
  }

  return count;
}

// ── Boundary event & exception chain positioning ────────────────────────────

/**
 * Position boundary events on their host's bottom border and lay out
 * exception chain elements as linear chains below the host.
 */
export function positionBoundaryEventsAndChains(
  boundaryInfos: BoundaryEventInfo[],
  _mainFlowPositions: Map<string, { x: number; y: number }>,
  registry: ElementRegistry,
  modeling: Modeling,
  gap: number,
  eventBus?: EventBus
): RebuildResult {
  let repositionedCount = 0;
  let reroutedCount = 0;

  // Group boundary events by host for spreading
  const byHost = new Map<string, BoundaryEventInfo[]>();
  for (const info of boundaryInfos) {
    const hostId = info.host.id;
    if (!byHost.has(hostId)) byHost.set(hostId, []);
    byHost.get(hostId)!.push(info);
  }

  for (const [, infos] of byHost) {
    const host = infos[0].host;
    const hostCenterX = host.x + host.width / 2;
    const hostBottom = host.y + host.height;

    // Spread boundary events along the host's bottom border
    const count = infos.length;
    for (let i = 0; i < count; i++) {
      const info = infos[i];
      const be = info.boundaryEvent;

      // Compute X: spread evenly along bottom edge.
      // When there is only one boundary event, shift it 1px right of the exact
      // centre so its left edge cannot coincidentally fall at the same X-layer
      // as internal branch elements (which would inflate the hMis metric).
      const spreadX = count === 1 ? hostCenterX + 1 : host.x + ((i + 1) / (count + 1)) * host.width;

      // Position boundary event at host's bottom border
      const beCenter = { x: spreadX, y: hostBottom };
      if (moveElementTo(modeling, be, beCenter, eventBus)) {
        repositionedCount++;
      }

      // Position exception chain elements below the host.
      // Pass chain index so multiple chains on the same host are staggered
      // vertically — each on its own row — to prevent element overlap.
      const chainResult = positionExceptionChain(
        info,
        beCenter,
        host,
        registry,
        modeling,
        gap,
        i,
        i < count - 1 // hasRightSibling: true when there's a sibling event to the right
      );
      repositionedCount += chainResult.repositionedCount;
      reroutedCount += chainResult.reroutedCount;
    }
  }

  return { repositionedCount, reroutedCount };
}

/**
 * Position exception chain elements as a linear chain starting from
 * a boundary event.  Elements are placed below the host at the same Y,
 * progressing left-to-right with standard gap.
 *
 * @param chainIndex  Zero-based index of this chain among all chains on the
 *   same host. When multiple boundary events share a host, each chain is
 *   placed on its own Y row (stacked vertically) to prevent overlap.
 * @param hasRightSibling  True when there is at least one other boundary event
 *   on the same host with a higher X position.  Affects exit-routing: a left
 *   event uses right-exit to avoid crossing the right event's bottom-exit path.
 */
function positionExceptionChain(
  info: BoundaryEventInfo,
  beCenter: { x: number; y: number },
  host: BpmnElement,
  registry: ElementRegistry,
  modeling: Modeling,
  gap: number,
  chainIndex = 0,
  hasRightSibling = false
): RebuildResult {
  let repositionedCount = 0;
  let reroutedCount = 0;

  if (info.exceptionChain.length === 0) return { repositionedCount, reroutedCount };

  // Compute a single center Y for the entire chain based on the tallest element
  let maxHeight = 0;
  for (const chainId of info.exceptionChain) {
    const el = registry.get(chainId);
    if (el) maxHeight = Math.max(maxHeight, el.height);
  }
  // Each chain on the same host occupies its own Y row.  Row 0 starts
  // directly below the host; subsequent rows are offset by (maxHeight + gap).
  const rowOffset = chainIndex * (maxHeight + gap);
  const chainCenterY = host.y + host.height + BOUNDARY_GAP + maxHeight / 2 + rowOffset;

  let prevCenter = beCenter;
  let prevHalfWidth = info.boundaryEvent.width / 2;

  for (const chainId of info.exceptionChain) {
    const chainElement = registry.get(chainId);
    if (!chainElement) continue;

    const chainCenterX = prevCenter.x + prevHalfWidth + gap + chainElement.width / 2;

    if (moveElementTo(modeling, chainElement, { x: chainCenterX, y: chainCenterY })) {
      repositionedCount++;
    }

    prevCenter = { x: chainCenterX, y: chainCenterY };
    prevHalfWidth = chainElement.width / 2;
  }

  // Layout exception chain connections (boundary event → chain elements).
  // Use the dedicated boundary-event router to ensure the flow exits from
  // the BOTTOM of the event (straight down) rather than the right side.
  // Pass hasRightSibling so the router can choose right-exit when needed
  // to avoid crossings with sibling chains.
  reroutedCount += layoutBoundaryEventConnections(
    registry,
    modeling,
    info.boundaryEvent,
    beCenter,
    hasRightSibling
  );

  // Layout connections within the exception chain
  for (const chainId of info.exceptionChain) {
    const chainElement = registry.get(chainId);
    if (chainElement) {
      reroutedCount += layoutOutgoingConnections(registry, modeling, chainElement);
    }
  }

  return { repositionedCount, reroutedCount };
}

// ── Subprocess resizing ────────────────────────────────────────────────────

/**
 * Resize an expanded subprocess to fit its internal elements with padding.
 * Computes the bounding box of all child elements and resizes the
 * subprocess shape to encompass them.
 */
export function resizeSubprocessToFit(
  modeling: Modeling,
  registry: ElementRegistry,
  subprocess: BpmnElement,
  padding: number
): void {
  const allElements: BpmnElement[] = registry.getAll();
  const children = allElements.filter(
    (el) => el.parent === subprocess && el.type !== 'bpmn:SequenceFlow' && el.type !== 'label'
  );

  if (children.length === 0) return;

  // Compute bounding box of children
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of children) {
    minX = Math.min(minX, child.x);
    minY = Math.min(minY, child.y);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }

  // New bounds with padding
  const newBounds = {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + 2 * padding,
    height: maxY - minY + 2 * padding,
  };

  modeling.resizeShape(subprocess, newBounds);
}

// ── Pool stacking ──────────────────────────────────────────────────────────

/**
 * Stack participant pools vertically with consistent gap.
 * The first pool is positioned at the top, subsequent pools below.
 */
export function stackPools(
  participants: BpmnElement[],
  modeling: Modeling,
  poolGap: number
): number {
  if (participants.length <= 1) return 0;

  let repositioned = 0;

  // Sort participants by their original Y position
  const sorted = [...participants].sort((a, b) => a.y - b.y);

  // Stack from top — first pool stays, subsequent pools stack below
  let nextY = sorted[0].y + sorted[0].height + poolGap;

  for (let i = 1; i < sorted.length; i++) {
    const pool = sorted[i];
    if (pool.y !== nextY) {
      const dy = nextY - pool.y;
      modeling.moveElements([pool], { x: 0, y: dy });
      repositioned++;
    }
    nextY = pool.y + pool.height + poolGap;
  }

  return repositioned;
}

// ── Event subprocess positioning ───────────────────────────────────────────

/**
 * Detect event subprocesses (triggeredByEvent=true) among direct
 * children of a container.
 */
export function getEventSubprocessIds(
  registry: ElementRegistry,
  container: BpmnElement
): Set<string> {
  const ids = new Set<string>();
  const allElements: BpmnElement[] = registry.getAll();

  for (const el of allElements) {
    if (el.parent !== container) continue;
    if (el.type === 'bpmn:SubProcess' && el.businessObject?.triggeredByEvent === true) {
      ids.add(el.id);
    }
  }

  return ids;
}

/**
 * Position event subprocesses below the main flow bounding box.
 *
 * Called after the main flow is positioned.  Event subprocesses have
 * already been rebuilt internally (inside-out) and resized, so their
 * width/height are known.
 */
export function positionEventSubprocesses(
  eventSubprocessIds: Set<string>,
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement,
  gap: number,
  originX: number
): number {
  if (eventSubprocessIds.size === 0) return 0;

  // Find the bottom of the main flow (exclude event subprocesses)
  const allElements: BpmnElement[] = registry.getAll();
  let maxBottomY = 0;

  for (const el of allElements) {
    if (el.parent !== container) continue;
    if (eventSubprocessIds.has(el.id)) continue;
    if (el.type === 'bpmn:SequenceFlow' || el.type === 'label') continue;
    if (el.type === 'bpmn:Lane' || el.type === 'bpmn:LaneSet') continue;
    maxBottomY = Math.max(maxBottomY, el.y + el.height);
  }

  // Position event subprocesses below the main flow, left-to-right
  let repositioned = 0;
  let currentX = originX;

  for (const id of eventSubprocessIds) {
    const el = registry.get(id);
    if (!el) continue;

    const targetY = maxBottomY + gap + el.height / 2;
    const targetX = currentX + el.width / 2;

    if (moveElementTo(modeling, el, { x: targetX, y: targetY })) {
      repositioned++;
    }

    currentX += el.width + gap;
  }

  return repositioned;
}

// ── Message flow layout ────────────────────────────────────────────────────

/**
 * Layout all message flows in the diagram (cross-pool connections).
 * Called after all pools are positioned.
 */
export function layoutMessageFlows(registry: ElementRegistry, modeling: Modeling): number {
  const allElements: BpmnElement[] = registry.getAll();
  let count = 0;

  for (const el of allElements) {
    if (el.type === 'bpmn:MessageFlow') {
      if (layoutConnectionSafe(modeling, el)) count++;
    }
  }

  return count;
}
