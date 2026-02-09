/* eslint-disable max-lines */
/**
 * ELK-based layout engine for BPMN diagrams.
 *
 * Uses elkjs (Eclipse Layout Kernel) with the Sugiyama layered algorithm
 * to produce clean left-to-right layouts.  Handles flat processes,
 * collaborations with participants, and expanded subprocesses as compound
 * nodes.
 *
 * Boundary events are excluded from the ELK graph — they follow their
 * host element automatically when bpmn-js moves the host.
 *
 * Post-layout pipeline:
 * 1. ELK positions nodes → applyElkPositions()
 * 2. Snap same-layer elements to common Y → snapSameLayerElements()
 * 3. Apply ELK edge sections as waypoints → applyElkEdgeRoutes()
 */

import type { DiagramState } from './types';
import { STANDARD_BPMN_GAP } from './constants';
import type { ElkNode, ElkExtendedEdge, ElkEdgeSection, LayoutOptions } from 'elkjs';

// ── Constants ──────────────────────────────────────────────────────────────

/** Default ELK layout options tuned for BPMN diagrams. */
const ELK_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': String(STANDARD_BPMN_GAP),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(STANDARD_BPMN_GAP),
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
};

/**
 * Maximum Y-centre difference (in px) for two elements to be considered
 * "same row" during the post-ELK vertical alignment snap.
 */
const SAME_ROW_THRESHOLD = 20;

/** Padding inside compound containers (participants, expanded subprocesses). */
const CONTAINER_PADDING = '[top=50,left=20,bottom=20,right=20]';

/** Offset from origin so the diagram has comfortable breathing room. */
const ORIGIN_OFFSET_X = 150;
const ORIGIN_OFFSET_Y = 80;

// ── Helpers ────────────────────────────────────────────────────────────────

function isConnection(type: string): boolean {
  return (
    type.includes('SequenceFlow') || type.includes('MessageFlow') || type.includes('Association')
  );
}

function isInfrastructure(type: string): boolean {
  return (
    !type ||
    type === 'bpmn:Process' ||
    type === 'bpmn:Collaboration' ||
    type === 'label' ||
    type.includes('BPMNDiagram') ||
    type.includes('BPMNPlane')
  );
}

/** Check if an element type is an artifact (data object, data store, text annotation, group). */
function isArtifact(type: string): boolean {
  return (
    type === 'bpmn:TextAnnotation' ||
    type === 'bpmn:DataObjectReference' ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:Group'
  );
}

/** Check if an element type is a lane (excluded from ELK layout). */
function isLane(type: string): boolean {
  return type === 'bpmn:Lane' || type === 'bpmn:LaneSet';
}

// ── ELK graph building ─────────────────────────────────────────────────────

/**
 * Build ELK child nodes and internal edges for a given container element.
 *
 * A "container" is any element whose children should be laid out together:
 * the root canvas element, a Participant (pool), or an expanded SubProcess.
 */
function buildContainerGraph(
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
      const nested = buildContainerGraph(allElements, shape);
      children.push({
        id: shape.id,
        width: shape.width || 300,
        height: shape.height || 200,
        children: nested.children,
        edges: nested.edges,
        layoutOptions: {
          ...ELK_LAYOUT_OPTIONS,
          'elk.padding': CONTAINER_PADDING,
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

  for (const conn of childConnections) {
    if (nodeIds.has(conn.source.id) && nodeIds.has(conn.target.id)) {
      edges.push({
        id: conn.id,
        sources: [conn.source.id],
        targets: [conn.target.id],
      });
    }
  }

  return { children, edges };
}

// ── Position application ───────────────────────────────────────────────────

/**
 * Recursively apply ELK layout results to bpmn-js elements.
 *
 * For top-level nodes, positions are absolute (parentAbsX/Y is the origin
 * offset).  For children of compound nodes, ELK positions are relative to
 * the parent, so we accumulate offsets as we recurse.
 */
function applyElkPositions(
  elementRegistry: any,
  modeling: any,
  elkNode: ElkNode,
  parentAbsX: number,
  parentAbsY: number
): void {
  if (!elkNode.children) return;

  for (const child of elkNode.children) {
    if (child.x === undefined || child.y === undefined) continue;

    const element = elementRegistry.get(child.id);
    if (!element) continue;

    const desiredX = parentAbsX + child.x;
    const desiredY = parentAbsY + child.y;
    const dx = desiredX - element.x;
    const dy = desiredY - element.y;

    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      modeling.moveElements([element], { x: dx, y: dy });
    }

    // Recurse for compound nodes (participants, expanded subprocesses)
    if (child.children && child.children.length > 0) {
      const updated = elementRegistry.get(child.id);
      if (updated) {
        applyElkPositions(elementRegistry, modeling, child, updated.x, updated.y);
      }
    }
  }
}

// ── Post-ELK vertical alignment snap ───────────────────────────────────────

/**
 * After ELK positions nodes, elements in the same ELK layer can have small
 * Y-centre offsets (5–10 px).  This pass groups elements by their x-position
 * range (same layer) and snaps near-aligned centres to a common Y.
 *
 * Must run BEFORE connection routing so that waypoints are computed from
 * the snapped positions.
 */
function snapSameLayerElements(elementRegistry: any, modeling: any): void {
  const shapes = elementRegistry.filter(
    (el: any) =>
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      el.type !== 'label'
  );

  if (shapes.length < 2) return;

  // Group by approximate x-centre (same ELK layer = same x column).
  // Elements within STANDARD_BPMN_GAP/2 of each other are in the same layer.
  const layerThreshold = STANDARD_BPMN_GAP / 2;
  const sorted = [...shapes].sort(
    (a: any, b: any) => a.x + (a.width || 0) / 2 - (b.x + (b.width || 0) / 2)
  );

  const layers: any[][] = [];
  let currentLayer: any[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevCx = currentLayer[0].x + (currentLayer[0].width || 0) / 2;
    const currCx = sorted[i].x + (sorted[i].width || 0) / 2;
    if (Math.abs(currCx - prevCx) <= layerThreshold) {
      currentLayer.push(sorted[i]);
    } else {
      layers.push(currentLayer);
      currentLayer = [sorted[i]];
    }
  }
  layers.push(currentLayer);

  // Within each layer, find groups of elements whose Y-centres are within
  // SAME_ROW_THRESHOLD — snap them to the median Y-centre.
  for (const layer of layers) {
    if (layer.length < 2) continue;

    const byY = [...layer].sort(
      (a: any, b: any) => a.y + (a.height || 0) / 2 - (b.y + (b.height || 0) / 2)
    );

    // Greedy grouping by Y-centre proximity
    const groups: any[][] = [];
    let group: any[] = [byY[0]];

    for (let i = 1; i < byY.length; i++) {
      const prevCy = group[group.length - 1].y + (group[group.length - 1].height || 0) / 2;
      const currCy = byY[i].y + (byY[i].height || 0) / 2;
      if (Math.abs(currCy - prevCy) <= SAME_ROW_THRESHOLD) {
        group.push(byY[i]);
      } else {
        groups.push(group);
        group = [byY[i]];
      }
    }
    groups.push(group);

    for (const g of groups) {
      if (g.length < 2) continue;

      // Snap to median centre-Y
      const centres = g.map((el: any) => el.y + (el.height || 0) / 2);
      centres.sort((a: number, b: number) => a - b);
      const medianCy = centres[Math.floor(centres.length / 2)];

      for (const el of g) {
        const cy = el.y + (el.height || 0) / 2;
        const dy = medianCy - cy;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
      }
    }
  }
}

// ── ELK edge section → waypoints ───────────────────────────────────────────

/**
 * Build a flat lookup of ELK edges (including nested containers) so we can
 * resolve edge sections by connection ID.
 */
function collectElkEdges(
  elkNode: ElkNode,
  parentAbsX: number,
  parentAbsY: number
): Map<string, { sections: ElkEdgeSection[]; offsetX: number; offsetY: number }> {
  const map = new Map<string, { sections: ElkEdgeSection[]; offsetX: number; offsetY: number }>();

  // Edges at this level
  const edges = (elkNode as any).edges as ElkExtendedEdge[] | undefined;
  if (edges) {
    for (const edge of edges) {
      if (edge.sections && edge.sections.length > 0) {
        map.set(edge.id, { sections: edge.sections, offsetX: parentAbsX, offsetY: parentAbsY });
      }
    }
  }

  // Recurse into children (compound nodes)
  if (elkNode.children) {
    for (const child of elkNode.children) {
      if (child.children && child.children.length > 0) {
        const childAbsX = parentAbsX + (child.x ?? 0);
        const childAbsY = parentAbsY + (child.y ?? 0);
        const nested = collectElkEdges(child, childAbsX, childAbsY);
        for (const [id, val] of nested) {
          map.set(id, val);
        }
      }
    }
  }

  return map;
}

/**
 * Build strictly orthogonal waypoints between two points.
 *
 * If the source and target share the same X or Y (within tolerance),
 * a straight horizontal/vertical segment is used.  Otherwise, an L-shaped
 * route is produced: horizontal first if the primary direction is
 * left-to-right, vertical first otherwise.
 */
function buildOrthogonalWaypoints(
  src: { x: number; y: number },
  tgt: { x: number; y: number }
): Array<{ x: number; y: number }> {
  const dx = Math.abs(tgt.x - src.x);
  const dy = Math.abs(tgt.y - src.y);

  // Nearly aligned — straight segment
  if (dx < 2) {
    return [
      { x: src.x, y: src.y },
      { x: src.x, y: tgt.y },
    ];
  }
  if (dy < 2) {
    return [
      { x: src.x, y: src.y },
      { x: tgt.x, y: src.y },
    ];
  }

  // L-shaped route: go horizontal from src, then vertical to tgt
  if (dx >= dy) {
    return [
      { x: src.x, y: src.y },
      { x: tgt.x, y: src.y },
      { x: tgt.x, y: tgt.y },
    ];
  }

  // Primarily vertical: go vertical first, then horizontal
  return [
    { x: src.x, y: src.y },
    { x: src.x, y: tgt.y },
    { x: tgt.x, y: tgt.y },
  ];
}

/**
 * Build a routed path for boundary event connections.
 *
 * Boundary events attach to tasks/subprocesses, and their outgoing flows
 * typically represent error/timeout recovery paths that should route around
 * the host element.  This produces a clean orthogonal path that exits
 * downward from the boundary event and then routes to the target.
 */
function buildBoundaryEventRoute(source: any, target: any): Array<{ x: number; y: number }> {
  const srcMid = { x: source.x + (source.width || 0) / 2, y: source.y + (source.height || 0) / 2 };
  const tgtMid = { x: target.x + (target.width || 0) / 2, y: target.y + (target.height || 0) / 2 };

  // If the boundary event has a host, route around it
  const host = source.host;
  if (!host) {
    return buildOrthogonalWaypoints(srcMid, tgtMid);
  }

  const hostBottom = host.y + (host.height || 0);
  const hostRight = host.x + (host.width || 0);

  // Determine exit direction: if boundary event is at bottom of host,
  // route downward; if at right, route rightward
  const isBottomAttached = Math.abs(srcMid.y - hostBottom) < 20;
  const isRightAttached = Math.abs(srcMid.x - hostRight) < 20;

  const clearance = STANDARD_BPMN_GAP / 2;

  if (isBottomAttached) {
    // Exit downward, then route horizontally to target
    const exitY = hostBottom + clearance;
    if (tgtMid.x > srcMid.x) {
      // Target is to the right — go down, then right, then to target
      return [
        { x: srcMid.x, y: srcMid.y },
        { x: srcMid.x, y: exitY },
        { x: tgtMid.x, y: exitY },
        { x: tgtMid.x, y: tgtMid.y },
      ];
    } else {
      // Target is to the left — go down, then left, then to target
      return [
        { x: srcMid.x, y: srcMid.y },
        { x: srcMid.x, y: exitY },
        { x: tgtMid.x, y: exitY },
        { x: tgtMid.x, y: tgtMid.y },
      ];
    }
  } else if (isRightAttached) {
    // Exit rightward, then route vertically to target
    const exitX = hostRight + clearance;
    return [
      { x: srcMid.x, y: srcMid.y },
      { x: exitX, y: srcMid.y },
      { x: exitX, y: tgtMid.y },
      { x: tgtMid.x, y: tgtMid.y },
    ];
  }

  // Fallback for other positions: exit downward
  const exitY = Math.max(hostBottom, srcMid.y) + clearance;
  return [
    { x: srcMid.x, y: srcMid.y },
    { x: srcMid.x, y: exitY },
    { x: tgtMid.x, y: exitY },
    { x: tgtMid.x, y: tgtMid.y },
  ];
}

/**
 * Build a routed path for cross-container message flows.
 *
 * Message flows between participants should use clean vertical routing
 * with a midpoint between the pools.
 */
function buildMessageFlowRoute(source: any, target: any): Array<{ x: number; y: number }> {
  const srcMid = { x: source.x + (source.width || 0) / 2, y: source.y + (source.height || 0) / 2 };
  const tgtMid = { x: target.x + (target.width || 0) / 2, y: target.y + (target.height || 0) / 2 };

  // If horizontally aligned (within tolerance), use a straight vertical line
  if (Math.abs(srcMid.x - tgtMid.x) < 20) {
    return [
      { x: srcMid.x, y: srcMid.y },
      { x: srcMid.x, y: tgtMid.y },
    ];
  }

  // Route: vertical to midpoint Y, horizontal to target X, vertical to target
  const midY = (srcMid.y + tgtMid.y) / 2;
  return [
    { x: srcMid.x, y: srcMid.y },
    { x: srcMid.x, y: midY },
    { x: tgtMid.x, y: midY },
    { x: tgtMid.x, y: tgtMid.y },
  ];
}

/**
 * Apply ELK-computed orthogonal edge routes directly as bpmn-js waypoints.
 *
 * ELK returns edge sections with startPoint, endPoint, and optional
 * bendPoints — all in coordinates relative to the parent container.
 * We convert to absolute diagram coordinates and set them via
 * `modeling.updateWaypoints()` which also updates the BPMN DI.
 *
 * For connections where ELK didn't produce sections (e.g. cross-container
 * message flows), we fall back to `modeling.layoutConnection()`.
 */
function applyElkEdgeRoutes(
  elementRegistry: any,
  modeling: any,
  elkResult: ElkNode,
  offsetX: number,
  offsetY: number
): void {
  const edgeLookup = collectElkEdges(elkResult, offsetX, offsetY);

  const allConnections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.source && el.target
  );

  for (const conn of allConnections) {
    const elkEdge = edgeLookup.get(conn.id);

    if (elkEdge && elkEdge.sections.length > 0) {
      // Use ELK's computed orthogonal route
      const section = elkEdge.sections[0];
      const ox = elkEdge.offsetX;
      const oy = elkEdge.offsetY;

      const waypoints: Array<{ x: number; y: number }> = [];
      waypoints.push({ x: ox + section.startPoint.x, y: oy + section.startPoint.y });
      if (section.bendPoints) {
        for (const bp of section.bendPoints) {
          waypoints.push({ x: ox + bp.x, y: oy + bp.y });
        }
      }
      waypoints.push({ x: ox + section.endPoint.x, y: oy + section.endPoint.y });

      // Snap near-horizontal/vertical segments to strict orthogonal.
      // ELK can produce small offsets (up to ~8 px) due to node-size rounding
      // and port placement, so we use a generous tolerance.
      for (let i = 1; i < waypoints.length; i++) {
        const prev = waypoints[i - 1];
        const curr = waypoints[i];
        if (Math.abs(curr.y - prev.y) < 8) {
          curr.y = prev.y;
        }
        if (Math.abs(curr.x - prev.x) < 8) {
          curr.x = prev.x;
        }
      }

      modeling.updateWaypoints(conn, waypoints);
    } else {
      // Fallback: use specialised routing for connections that ELK
      // didn't route (boundary events, cross-container flows).
      const src = conn.source;
      const tgt = conn.target;

      let waypoints: Array<{ x: number; y: number }>;

      if (src.type === 'bpmn:BoundaryEvent') {
        // Boundary event recovery flows — route around the host element
        waypoints = buildBoundaryEventRoute(src, tgt);
      } else if (conn.type === 'bpmn:MessageFlow') {
        // Cross-pool message flows — clean vertical routing
        waypoints = buildMessageFlowRoute(src, tgt);
      } else {
        // Generic fallback
        const srcMid = { x: src.x + (src.width || 0) / 2, y: src.y + (src.height || 0) / 2 };
        const tgtMid = { x: tgt.x + (tgt.width || 0) / 2, y: tgt.y + (tgt.height || 0) / 2 };
        waypoints = buildOrthogonalWaypoints(srcMid, tgtMid);
      }

      modeling.updateWaypoints(conn, waypoints);
    }
  }
}

// ── Post-layout artifact repositioning ─────────────────────────────────────

/** Default vertical offset (px) below the flow for data objects/stores. */
const ARTIFACT_BELOW_OFFSET = 80;
/** Default vertical offset (px) above the flow for text annotations. */
const ARTIFACT_ABOVE_OFFSET = 80;

/**
 * Find the flow element linked to an artifact via an association.
 */
function findLinkedFlowElement(artifact: any, associations: any[]): any {
  for (const assoc of associations) {
    if (assoc.source?.id === artifact.id && assoc.target && !isArtifact(assoc.target.type)) {
      return assoc.target;
    }
    if (assoc.target?.id === artifact.id && assoc.source && !isArtifact(assoc.source.type)) {
      return assoc.source;
    }
  }
  return null;
}

/**
 * Reposition artifact elements (DataObjectReference, DataStoreReference,
 * TextAnnotation) relative to their associated flow elements.
 *
 * Artifacts are excluded from the ELK graph, so they stay at their
 * original positions.  This pass moves them:
 * - TextAnnotations above their linked element (via Association)
 * - DataObjectReference / DataStoreReference below their linked element
 *
 * Handles complex cases:
 * - Multiple artifacts linked to the same element (horizontal spread)
 * - Horizontal overlap between artifacts on different elements
 * - Unlinked artifacts positioned below the flow bounding box
 */
// eslint-disable-next-line complexity, max-lines-per-function
function repositionArtifacts(elementRegistry: any, modeling: any): void {
  const artifacts = elementRegistry.filter((el: any) => isArtifact(el.type));
  if (artifacts.length === 0) return;

  const associations = elementRegistry.filter(
    (el: any) =>
      el.type === 'bpmn:Association' ||
      el.type === 'bpmn:DataInputAssociation' ||
      el.type === 'bpmn:DataOutputAssociation'
  );

  // Compute flow bounding box (for unlinked artifact fallback)
  const flowElements = elementRegistry.filter(
    (el: any) =>
      el.type &&
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      el.type !== 'label'
  );
  let flowMaxY = 200;
  let flowMinY = Infinity;
  let flowMinX = Infinity;
  let flowMaxX = -Infinity;
  for (const el of flowElements) {
    const bottom = el.y + (el.height || 0);
    const right = el.x + (el.width || 0);
    if (bottom > flowMaxY) flowMaxY = bottom;
    if (el.y < flowMinY) flowMinY = el.y;
    if (el.x < flowMinX) flowMinX = el.x;
    if (right > flowMaxX) flowMaxX = right;
  }
  if (flowMinY === Infinity) flowMinY = 80;
  if (flowMinX === Infinity) flowMinX = 150;

  // Group artifacts by their linked element to handle multiple artifacts per element
  const artifactsByLinkedElement = new Map<string, any[]>();
  const unlinkedArtifacts: any[] = [];

  for (const artifact of artifacts) {
    const linkedElement = findLinkedFlowElement(artifact, associations);
    if (linkedElement) {
      const group = artifactsByLinkedElement.get(linkedElement.id) || [];
      group.push(artifact);
      artifactsByLinkedElement.set(linkedElement.id, group);
    } else {
      unlinkedArtifacts.push(artifact);
    }
  }

  const occupiedRects: Array<{ x: number; y: number; w: number; h: number }> = [];

  // Position linked artifacts — spread horizontally when multiple share the same element
  for (const [linkedId, group] of artifactsByLinkedElement) {
    const linkedElement = elementRegistry.get(linkedId);
    if (!linkedElement) continue;

    const linkCx = linkedElement.x + (linkedElement.width || 0) / 2;
    const totalWidth = group.reduce((sum: number, a: any) => sum + (a.width || 100) + 20, -20);
    let startX = linkCx - totalWidth / 2;

    for (const artifact of group) {
      const w = artifact.width || 100;
      const h = artifact.height || 30;
      const isAnnotation = artifact.type === 'bpmn:TextAnnotation';

      const pos = {
        x: startX,
        y: isAnnotation
          ? linkedElement.y - h - ARTIFACT_ABOVE_OFFSET
          : linkedElement.y + (linkedElement.height || 0) + ARTIFACT_BELOW_OFFSET,
      };
      startX += w + 20;

      // Avoid overlap with previously placed artifacts (both vertical and horizontal)
      for (const rect of occupiedRects) {
        if (
          pos.x < rect.x + rect.w &&
          pos.x + w > rect.x &&
          pos.y < rect.y + rect.h &&
          pos.y + h > rect.y
        ) {
          // Try shifting horizontally first, then vertically
          const rightShift = rect.x + rect.w + 20;
          const vertShift = isAnnotation ? rect.y - h - 20 : rect.y + rect.h + 20;

          if (rightShift + w <= flowMaxX + 200) {
            pos.x = rightShift;
          } else {
            pos.y = vertShift;
          }
        }
      }

      const dx = pos.x - artifact.x;
      const dy = pos.y - artifact.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        modeling.moveElements([artifact], { x: dx, y: dy });
      }

      occupiedRects.push({ x: pos.x, y: pos.y, w, h });
    }
  }

  // Position unlinked artifacts outside the flow bounding box
  let unlinkedX = flowMinX;
  for (const artifact of unlinkedArtifacts) {
    const w = artifact.width || 100;
    const h = artifact.height || 30;
    const isAnnotation = artifact.type === 'bpmn:TextAnnotation';
    const pos = {
      x: unlinkedX,
      y: isAnnotation ? flowMinY - h - ARTIFACT_ABOVE_OFFSET : flowMaxY + ARTIFACT_BELOW_OFFSET,
    };

    // Avoid overlap
    for (const rect of occupiedRects) {
      if (
        pos.x < rect.x + rect.w &&
        pos.x + w > rect.x &&
        pos.y < rect.y + rect.h &&
        pos.y + h > rect.y
      ) {
        pos.y = isAnnotation ? rect.y - h - 20 : rect.y + rect.h + 20;
      }
    }

    const dx = pos.x - artifact.x;
    const dy = pos.y - artifact.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      modeling.moveElements([artifact], { x: dx, y: dy });
    }

    occupiedRects.push({ x: pos.x, y: pos.y, w, h });
    unlinkedX += w + 20;
  }
}

// ── Post-routing orthogonal snap ───────────────────────────────────────────

/**
 * Tolerance (px) for snapping near-orthogonal segments to strict orthogonal.
 * Covers ELK rounding offsets and gateway port placement differences.
 */
const ORTHO_SNAP_TOLERANCE = 15;

/**
 * Final pass: snap all connection waypoints to strict orthogonal segments.
 *
 * After ELK routing + fallback routing, some segments may have small
 * X or Y offsets (< ORTHO_SNAP_TOLERANCE) that appear diagonal.
 * This pass snaps the smaller delta to zero, making each segment
 * strictly horizontal or vertical.
 *
 * Uses `modeling.updateWaypoints` to record changes on the command stack.
 */
function snapAllConnectionsOrthogonal(elementRegistry: any, modeling: any): void {
  const allConnections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.waypoints && el.waypoints.length >= 2
  );

  for (const conn of allConnections) {
    const wps: Array<{ x: number; y: number }> = conn.waypoints;
    let changed = false;

    // Build snapped copy of waypoints
    const snapped = wps.map((wp: { x: number; y: number }) => ({ x: wp.x, y: wp.y }));

    for (let i = 1; i < snapped.length; i++) {
      const prev = snapped[i - 1];
      const curr = snapped[i];
      const dx = Math.abs(curr.x - prev.x);
      const dy = Math.abs(curr.y - prev.y);

      // Skip already-orthogonal or truly diagonal segments (both deltas large)
      if (dx < 1 || dy < 1) continue;
      if (dx >= ORTHO_SNAP_TOLERANCE && dy >= ORTHO_SNAP_TOLERANCE) continue;

      // Snap the smaller delta to zero
      if (dx <= dy) {
        curr.x = prev.x;
      } else {
        curr.y = prev.y;
      }
      changed = true;
    }

    if (changed) {
      modeling.updateWaypoints(conn, snapped);
    }
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

/** Optional parameters for ELK layout. */
export interface ElkLayoutOptions {
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  nodeSpacing?: number;
  layerSpacing?: number;
  /** Restrict layout to a specific subprocess or participant (scope). */
  scopeElementId?: string;
}

/**
 * Run ELK layered layout on a BPMN diagram.
 *
 * Uses the Sugiyama layered algorithm (via elkjs) to produce clean
 * left-to-right layouts with proper handling of parallel branches,
 * reconverging gateways, and nested containers.
 *
 * Pipeline:
 * 1. Build ELK graph from bpmn-js element registry
 * 2. Run ELK layout (node positions + edge routes)
 * 3. Apply node positions via `modeling.moveElements`
 * 4. Snap same-layer elements to common Y (vertical alignment)
 * 5. Apply ELK edge sections as connection waypoints (bypasses
 *    bpmn-js ManhattanLayout entirely for ELK-routed edges)
 * 6. Detect crossing flows and report count
 */
export async function elkLayout(
  diagram: DiagramState,
  options?: ElkLayoutOptions
): Promise<{ crossingFlows?: number }> {
  // Dynamic import — elkjs is externalized in esbuild
  const ELK = (await import('elkjs')).default;
  const elk = new ELK();

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const canvas = diagram.modeler.get('canvas');

  // Determine the layout root: scoped to a specific element, or the whole diagram
  let rootElement: any;
  if (options?.scopeElementId) {
    const scopeEl = elementRegistry.get(options.scopeElementId);
    if (!scopeEl) {
      throw new Error(`Scope element not found: ${options.scopeElementId}`);
    }
    if (scopeEl.type !== 'bpmn:Participant' && scopeEl.type !== 'bpmn:SubProcess') {
      throw new Error(`Scope element must be a Participant or SubProcess, got: ${scopeEl.type}`);
    }
    rootElement = scopeEl;
  } else {
    rootElement = canvas.getRootElement();
  }

  const allElements: any[] = elementRegistry.getAll();
  const { children, edges } = buildContainerGraph(allElements, rootElement);

  if (children.length === 0) return {};

  // Merge user-provided options with defaults
  const layoutOptions: LayoutOptions = { ...ELK_LAYOUT_OPTIONS };
  if (options?.direction) {
    layoutOptions['elk.direction'] = options.direction;
  }
  if (options?.nodeSpacing !== undefined) {
    layoutOptions['elk.spacing.nodeNode'] = String(options.nodeSpacing);
  }
  if (options?.layerSpacing !== undefined) {
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(options.layerSpacing);
  }

  // Happy-path emphasis: prioritise the default/first-connected branch as the
  // straight-through flow by fixing its layer-sweep priority.  ELK's
  // LAYER_SWEEP crossing minimization can be guided via port constraints
  // and model order — we use thoroughness to get better results.
  layoutOptions['elk.layered.crossingMinimization.thoroughness'] = '30';
  // Use model order for node ordering — first-connected branches stay central
  layoutOptions['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions,
    children,
    edges,
  };

  const result = await elk.layout(elkGraph);

  // For scoped layout, compute the offset from the scope element's position
  let offsetX: number;
  let offsetY: number;
  if (options?.scopeElementId) {
    const scopeEl = elementRegistry.get(options.scopeElementId);
    offsetX = scopeEl.x;
    offsetY = scopeEl.y;
  } else {
    offsetX = ORIGIN_OFFSET_X;
    offsetY = ORIGIN_OFFSET_Y;
  }

  // Step 1: Apply ELK-computed node positions
  applyElkPositions(elementRegistry, modeling, result, offsetX, offsetY);

  // Step 2: Snap same-layer elements to common Y (fixes 5–10 px offsets)
  snapSameLayerElements(elementRegistry, modeling);

  // Step 3: Reposition artifacts (data objects, data stores, annotations)
  // outside the main flow — they were excluded from the ELK graph.
  repositionArtifacts(elementRegistry, modeling);

  // Step 4: Apply ELK edge routes as waypoints (orthogonal, no diagonals).
  // Uses ELK's own edge sections instead of bpmn-js ManhattanLayout,
  // eliminating diagonals, S-curves, and gateway routing interference.
  applyElkEdgeRoutes(elementRegistry, modeling, result, offsetX, offsetY);

  // Step 5: Final orthogonal snap pass on ALL connections.
  // Catches residual near-diagonal segments from ELK rounding or fallback routing.
  snapAllConnectionsOrthogonal(elementRegistry, modeling);

  // Step 6: Detect crossing sequence flows for diagnostics
  const crossingFlows = detectCrossingFlows(elementRegistry);

  return { crossingFlows };
}

// ── Partial (subset) layout ────────────────────────────────────────────────

/**
 * Run ELK layered layout on a subset of elements in a BPMN diagram.
 *
 * Builds a sub-graph from the specified element IDs and their
 * inter-connections, runs ELK layout on that sub-graph, and applies
 * positions back — leaving all other elements untouched.
 */
// eslint-disable-next-line complexity
export async function elkLayoutSubset(
  diagram: DiagramState,
  elementIds: string[],
  options?: Omit<ElkLayoutOptions, 'scopeElementId'>
): Promise<{ crossingFlows?: number }> {
  const ELK = (await import('elkjs')).default;
  const elk = new ELK();

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');

  const idSet = new Set(elementIds);

  // Collect shapes from the element registry
  const shapes: any[] = [];
  for (const id of elementIds) {
    const el = elementRegistry.get(id);
    if (el && !isConnection(el.type) && !isInfrastructure(el.type)) {
      shapes.push(el);
    }
  }

  if (shapes.length === 0) return {};

  // Build ELK children nodes
  const children: ElkNode[] = shapes.map((s: any) => ({
    id: s.id,
    width: s.width || 100,
    height: s.height || 80,
  }));

  // Find inter-connections between the specified elements
  const allElements: any[] = elementRegistry.getAll();
  const edges: ElkExtendedEdge[] = [];
  for (const el of allElements) {
    if (
      isConnection(el.type) &&
      el.source &&
      el.target &&
      idSet.has(el.source.id) &&
      idSet.has(el.target.id)
    ) {
      edges.push({
        id: el.id,
        sources: [el.source.id],
        targets: [el.target.id],
      });
    }
  }

  // Build ELK layout options
  const layoutOptions: LayoutOptions = { ...ELK_LAYOUT_OPTIONS };
  if (options?.direction) {
    layoutOptions['elk.direction'] = options.direction;
  }
  if (options?.nodeSpacing !== undefined) {
    layoutOptions['elk.spacing.nodeNode'] = String(options.nodeSpacing);
  }
  if (options?.layerSpacing !== undefined) {
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(options.layerSpacing);
  }

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions,
    children,
    edges,
  };

  const result = await elk.layout(elkGraph);

  // Use the minimum existing position as offset origin so elements
  // stay roughly in the same area of the canvas
  let minX = Infinity;
  let minY = Infinity;
  for (const s of shapes) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
  }
  const offsetX = minX;
  const offsetY = minY;

  // Apply positions
  applyElkPositions(elementRegistry, modeling, result, offsetX, offsetY);

  // Apply edge routes for the subset connections
  applyElkEdgeRoutes(elementRegistry, modeling, result, offsetX, offsetY);

  return {};
}

// ── Post-layout crossing flow detection ────────────────────────────────────

/**
 * Test whether two line segments intersect (excluding shared endpoints).
 * Uses the cross-product orientation test.
 */
function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number }
): boolean {
  function cross(
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

/**
 * Detect crossing sequence flows after layout.
 *
 * Checks all pairs of connections for segment intersections and returns
 * the count of crossing pairs.
 */
function detectCrossingFlows(elementRegistry: any): number {
  const connections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.waypoints && el.waypoints.length >= 2
  );

  let crossings = 0;

  for (let i = 0; i < connections.length; i++) {
    for (let j = i + 1; j < connections.length; j++) {
      const wpsA = connections[i].waypoints;
      const wpsB = connections[j].waypoints;

      let found = false;
      for (let a = 0; a < wpsA.length - 1 && !found; a++) {
        for (let b = 0; b < wpsB.length - 1 && !found; b++) {
          if (segmentsIntersect(wpsA[a], wpsA[a + 1], wpsB[b], wpsB[b + 1])) {
            crossings++;
            found = true;
          }
        }
      }
    }
  }

  return crossings;
}
