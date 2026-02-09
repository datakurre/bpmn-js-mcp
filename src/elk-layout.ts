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
 * 2. Resize compound nodes to ELK-computed sizes → resizeCompoundNodes()
 * 3. Fix stranded boundary events → repositionBoundaryEvents()
 * 4. Snap same-layer elements to common Y → snapSameLayerElements()
 * 5. Grid snap pass (uniform columns + vertical spacing) → gridSnapPass()
 * 6. Reposition artifacts → repositionArtifacts()
 * 7. Apply ELK edge sections as waypoints → applyElkEdgeRoutes()
 * 7.5. Route branch connections through inter-column channels → routeBranchConnectionsThroughChannels()
 * 8. Final orthogonal snap → snapAllConnectionsOrthogonal()
 * 9. Detect crossing flows → detectCrossingFlows()
 */

import type { DiagramState } from './types';
import { ELK_LAYER_SPACING, ELK_NODE_SPACING, ELK_EDGE_NODE_SPACING } from './constants';
import type { ElkNode, ElkExtendedEdge, ElkEdgeSection, LayoutOptions } from 'elkjs';

// ── Constants ──────────────────────────────────────────────────────────────

/** Default ELK layout options tuned for BPMN diagrams. */
const ELK_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': String(ELK_NODE_SPACING),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(ELK_LAYER_SPACING),
  'elk.spacing.edgeNode': String(ELK_EDGE_NODE_SPACING),
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
};

/**
 * Maximum Y-centre difference (in px) for two elements to be considered
 * "same row" during the post-ELK vertical alignment snap.
 */
const SAME_ROW_THRESHOLD = 20;

/** Padding inside compound containers (expanded subprocesses). */
const CONTAINER_PADDING = '[top=50,left=20,bottom=20,right=20]';

/** Padding inside participant pools — extra left for the ~30px bpmn-js label band. */
const PARTICIPANT_PADDING = '[top=50,left=50,bottom=20,right=20]';

/** Offset from origin so the diagram has comfortable breathing room. */
const ORIGIN_OFFSET_X = 180;
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

    const desiredX = Math.round(parentAbsX + child.x);
    const desiredY = Math.round(parentAbsY + child.y);
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

// ── Post-ELK compound node resize ──────────────────────────────────────────

/**
 * Resize compound nodes (participants, expanded subprocesses) to match
 * ELK-computed dimensions.
 *
 * ELK computes proper width/height for compound children based on their
 * contents + padding.  `applyElkPositions` only applies x/y, so this
 * separate pass applies the size.  Must run AFTER applyElkPositions so
 * that the element's current x/y is already correct.
 */
function resizeCompoundNodes(elementRegistry: any, modeling: any, elkNode: ElkNode): void {
  if (!elkNode.children) return;

  for (const child of elkNode.children) {
    // Only resize compound nodes (those with children in the ELK result)
    if (!child.children || child.children.length === 0) continue;
    if (child.width === undefined || child.height === undefined) continue;

    const element = elementRegistry.get(child.id);
    if (!element) continue;

    const desiredW = Math.round(child.width);
    const desiredH = Math.round(child.height);

    // Only resize if significantly different from current size
    if (Math.abs(element.width - desiredW) > 5 || Math.abs(element.height - desiredH) > 5) {
      modeling.resizeShape(element, {
        x: element.x,
        y: element.y,
        width: desiredW,
        height: desiredH,
      });
    }

    // Recurse for nested compound nodes (expanded subprocesses inside participants)
    resizeCompoundNodes(elementRegistry, modeling, child);
  }
}

// ── Post-layout boundary event repositioning ───────────────────────────────

/**
 * Fix boundary event positions after layout.
 *
 * Boundary events are excluded from the ELK graph and should follow their
 * host when `modeling.moveElements` moves it.  In headless (jsdom) mode,
 * the automatic follow may not work correctly, leaving boundary events
 * stranded at their original positions.
 *
 * This pass checks each boundary event and moves it to a valid position
 * on its host's border if it's too far away.
 */
function repositionBoundaryEvents(elementRegistry: any, modeling: any): void {
  const boundaryEvents = elementRegistry.filter((el: any) => el.type === 'bpmn:BoundaryEvent');

  for (const be of boundaryEvents) {
    const host = be.host;
    if (!host) continue;

    const beW = be.width || 36;
    const beH = be.height || 36;
    const beCx = be.x + beW / 2;
    const beCy = be.y + beH / 2;

    // Check if the boundary event center is within reasonable distance of the host
    const hostRight = host.x + (host.width || 100);
    const hostBottom = host.y + (host.height || 80);
    const tolerance = 60;

    const isNearHost =
      beCx >= host.x - tolerance &&
      beCx <= hostRight + tolerance &&
      beCy >= host.y - tolerance &&
      beCy <= hostBottom + tolerance;

    if (!isNearHost) {
      // Move boundary event to the bottom edge of the host, offset to the right
      const targetCx = host.x + (host.width || 100) * 0.67;
      const targetCy = hostBottom;
      const dx = targetCx - beCx;
      const dy = targetCy - beCy;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        modeling.moveElements([be], { x: dx, y: dy });
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
  // Elements within ELK_LAYER_SPACING/2 of each other are in the same layer.
  const layerThreshold = ELK_LAYER_SPACING / 2;
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
      waypoints.push({
        x: Math.round(ox + section.startPoint.x),
        y: Math.round(oy + section.startPoint.y),
      });
      if (section.bendPoints) {
        for (const bp of section.bendPoints) {
          waypoints.push({ x: Math.round(ox + bp.x), y: Math.round(oy + bp.y) });
        }
      }
      waypoints.push({
        x: Math.round(ox + section.endPoint.x),
        y: Math.round(oy + section.endPoint.y),
      });

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

      // Deduplicate consecutive identical waypoints (e.g. redundant bend points)
      const deduped = [waypoints[0]];
      for (let i = 1; i < waypoints.length; i++) {
        const prev = deduped[deduped.length - 1];
        if (prev.x !== waypoints[i].x || prev.y !== waypoints[i].y) {
          deduped.push(waypoints[i]);
        }
      }

      modeling.updateWaypoints(conn, deduped);
    } else {
      // Fallback: use bpmn-js built-in connection layout for connections
      // that ELK didn't route (boundary events, cross-container flows).
      // This delegates to bpmn-js ManhattanLayout which produces clean
      // orthogonal paths that respect element boundaries.
      const src = conn.source;
      const tgt = conn.target;

      if (src.type === 'bpmn:BoundaryEvent' || conn.type === 'bpmn:MessageFlow') {
        // Let bpmn-js handle routing for boundary events and message flows
        // — its ManhattanLayout knows about element boundaries and pool gaps.
        modeling.layoutConnection(conn);
      } else {
        // Generic fallback for other unrouted connections
        const srcMid = { x: src.x + (src.width || 0) / 2, y: src.y + (src.height || 0) / 2 };
        const tgtMid = { x: tgt.x + (tgt.width || 0) / 2, y: tgt.y + (tgt.height || 0) / 2 };
        const waypoints = buildOrthogonalWaypoints(srcMid, tgtMid);

        // Round and deduplicate fallback waypoints
        const rounded = waypoints.map((wp) => ({ x: Math.round(wp.x), y: Math.round(wp.y) }));
        const dedupedFallback = [rounded[0]];
        for (let i = 1; i < rounded.length; i++) {
          const prev = dedupedFallback[dedupedFallback.length - 1];
          if (prev.x !== rounded[i].x || prev.y !== rounded[i].y) {
            dedupedFallback.push(rounded[i]);
          }
        }
        if (dedupedFallback.length >= 2) {
          modeling.updateWaypoints(conn, dedupedFallback);
        }
      }
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

// ── Post-routing channel routing for gateway branches ──────────────────────

/**
 * Re-route vertical segments of gateway branch connections through the
 * midpoint of the inter-column gap (the "channel").
 *
 * After ELK edge routing + grid snap, connections exiting a gateway to a
 * branch element on a different row may place their vertical segment very
 * close to the gateway edge.  This pass finds such connections and shifts
 * the vertical segment's X to the midpoint between the source and target
 * columns, replicating bpmn-auto-layout's channel-routing aesthetic.
 *
 * When multiple connections from the same gateway need channel routing,
 * their vertical segments are spread evenly across the channel width to
 * prevent overlaps and crossing flows.
 *
 * Only applies to connections where the source OR target is a gateway and
 * the waypoints include a vertical segment that could be moved to a channel.
 */
function routeBranchConnectionsThroughChannels(
  elementRegistry: any,
  modeling: any,
  container?: any
): void {
  const layers = detectLayers(elementRegistry, container);
  if (layers.length < 2) return;

  // Build a map from element ID → layer index for fast lookup
  const elementToLayer = new Map<string, number>();
  for (let i = 0; i < layers.length; i++) {
    for (const el of layers[i].elements) {
      elementToLayer.set(el.id, i);
    }
  }

  const allConnections = elementRegistry.filter(
    (el: any) =>
      el.type === 'bpmn:SequenceFlow' &&
      el.source &&
      el.target &&
      el.waypoints &&
      el.waypoints.length >= 3
  );

  // Build a count of outgoing sequence flows per gateway (to identify splits)
  const gwOutgoingCount = new Map<string, number>();
  for (const conn of allConnections) {
    if (conn.source?.type?.includes('Gateway')) {
      gwOutgoingCount.set(conn.source.id, (gwOutgoingCount.get(conn.source.id) || 0) + 1);
    }
  }

  // Count how many outgoing connections from each split gateway go to
  // a different row. We only apply channel routing for gateways with
  // exactly 2 off-row branches (the common exclusive gateway pattern).
  // For larger fan-outs, ELK already handles routing well.
  const gwOffRowCount = new Map<string, number>();
  for (const conn of allConnections) {
    const src = conn.source;
    if (!src.type?.includes('Gateway')) continue;
    if ((gwOutgoingCount.get(src.id) || 0) < 2) continue;

    const srcLayer = elementToLayer.get(src.id);
    const tgtLayer = elementToLayer.get(conn.target?.id);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer === tgtLayer) continue;

    gwOffRowCount.set(src.id, (gwOffRowCount.get(src.id) || 0) + 1);
  }

  // Group connections by source gateway for coordinated channel allocation.
  // Only include connections from split gateways (≥2 outgoing flows) to
  // avoid routing join→next connections through the channel, which can
  // interfere with incoming branch connections.
  const gwGroups = new Map<
    string,
    Array<{
      conn: any;
      channelAfterLayer: number;
      vertSegIndex: number;
    }>
  >();

  for (const conn of allConnections) {
    const src = conn.source;
    const tgt = conn.target;

    // Only process connections where source is a gateway going to a different row
    const srcIsGw = src.type?.includes('Gateway');
    if (!srcIsGw) continue;

    // Only process split gateways (≥2 outgoing flows), not join→next flows
    if ((gwOutgoingCount.get(src.id) || 0) < 2) continue;

    // Skip gateways with more than 2 off-row branches — ELK handles
    // multi-branch fan-outs well; channel routing can cause crossings.
    if ((gwOffRowCount.get(src.id) || 0) > 2) continue;

    const srcLayer = elementToLayer.get(src.id);
    const tgtLayer = elementToLayer.get(tgt.id);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer === tgtLayer) continue;

    const minLayer = Math.min(srcLayer, tgtLayer);
    const maxLayer = Math.max(srcLayer, tgtLayer);
    const channelAfterLayer = srcLayer < tgtLayer ? minLayer : maxLayer - 1;
    if (channelAfterLayer < 0 || channelAfterLayer >= layers.length - 1) continue;

    // Find the first vertical segment near the gateway
    const wps: Array<{ x: number; y: number }> = conn.waypoints;
    const gwCx = src.x + (src.width || 0) / 2;
    let vertSegIdx = -1;
    for (let i = 0; i < wps.length - 1; i++) {
      const curr = wps[i];
      const next = wps[i + 1];
      const dx = Math.abs(curr.x - next.x);
      const dy = Math.abs(curr.y - next.y);
      if (dx < 2 && dy > 5 && Math.abs(curr.x - gwCx) < 40) {
        vertSegIdx = i;
        break;
      }
    }

    if (vertSegIdx < 0) continue;

    const key = `${src.id}:${channelAfterLayer}`;
    const group = gwGroups.get(key) || [];
    group.push({ conn, channelAfterLayer, vertSegIndex: vertSegIdx });
    gwGroups.set(key, group);
  }

  // Process each gateway group: spread vertical segments across the channel.
  // Only apply to gateways with at most 2 branch connections needing routing.
  // For larger fan-outs (3+ branches), ELK already spaces port positions well
  // and moving vertical segments can cause crossings with join-side connections.
  for (const [, group] of gwGroups) {
    if (group.length > 2) continue; // Skip large fan-outs

    const { channelAfterLayer } = group[0];
    const leftColRight = layers[channelAfterLayer].maxRight;
    const rightColLeft = layers[channelAfterLayer + 1].minX;
    const channelMid = (leftColRight + rightColLeft) / 2;
    const channelWidth = rightColLeft - leftColRight;

    // Skip if channel is too narrow for meaningful routing
    if (channelWidth < 30) continue;

    // For a single connection, use the channel midpoint.
    // For multiple connections, spread them evenly but keep them within
    // the middle 60% of the channel to maintain clearance from columns.
    const margin = channelWidth * 0.2;
    const usableLeft = leftColRight + margin;
    const usableRight = rightColLeft - margin;
    const usableWidth = usableRight - usableLeft;

    // Sort group by target Y so vertical segments don't cross each other
    group.sort((a, b) => {
      const aY = a.conn.target.y + (a.conn.target.height || 0) / 2;
      const bY = b.conn.target.y + (b.conn.target.height || 0) / 2;
      return aY - bY;
    });

    for (let gi = 0; gi < group.length; gi++) {
      const { conn, vertSegIndex } = group[gi];
      let channelX: number;
      if (group.length === 1) {
        channelX = channelMid;
      } else {
        // Spread evenly across usable channel width
        channelX = usableLeft + (usableWidth * gi) / (group.length - 1);
      }
      channelX = Math.round(channelX);

      const wps: Array<{ x: number; y: number }> = conn.waypoints;
      const currX = wps[vertSegIndex].x;
      if (Math.abs(currX - channelX) <= 5) continue;

      // Verify the move doesn't place the vertical segment outside the
      // channel (between the source right edge and target left edge)
      const srcRight = conn.source.x + (conn.source.width || 0);
      const tgtLeft = conn.target.x;
      if (channelX <= srcRight || channelX >= tgtLeft) continue;

      const newWps = wps.map((wp: { x: number; y: number }) => ({ x: wp.x, y: wp.y }));
      newWps[vertSegIndex].x = channelX;
      newWps[vertSegIndex + 1].x = channelX;
      modeling.updateWaypoints(conn, newWps);
    }
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

// ── Happy path detection ───────────────────────────────────────────────────

/**
 * Detect the "happy path" — the main flow from a start event to an end
 * event, following default flows at gateways (or the first outgoing flow
 * when no default is set).
 *
 * Returns a Set of connection (edge) IDs that form the happy path.
 */
function detectHappyPath(allElements: any[]): Set<string> {
  const happyEdgeIds = new Set<string>();

  // Find start events (entry points)
  const startEvents = allElements.filter(
    (el: any) => el.type === 'bpmn:StartEvent' && !isInfrastructure(el.type)
  );
  if (startEvents.length === 0) return happyEdgeIds;

  // Build adjacency: node → outgoing connections
  const outgoing = new Map<string, any[]>();
  for (const el of allElements) {
    if (isConnection(el.type) && el.source && el.target) {
      const list = outgoing.get(el.source.id) || [];
      list.push(el);
      outgoing.set(el.source.id, list);
    }
  }

  // Build a map of gateway default flows (gateway businessObject.default)
  const gatewayDefaults = new Map<string, string>();
  for (const el of allElements) {
    if (el.type?.includes('Gateway') && el.businessObject?.default) {
      gatewayDefaults.set(el.id, el.businessObject.default.id);
    }
  }

  // Walk from each start event, following default/first flows
  const visited = new Set<string>();
  for (const start of startEvents) {
    let current = start;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);

      const connections = outgoing.get(current.id);
      if (!connections || connections.length === 0) break;

      // Pick the preferred outgoing connection:
      // 1. Gateway with default flow → follow the default
      // 2. Otherwise → follow the first connection
      let chosen: any;
      const defaultFlowId = gatewayDefaults.get(current.id);
      if (defaultFlowId) {
        chosen = connections.find((c: any) => c.id === defaultFlowId);
      }
      if (!chosen) {
        chosen = connections[0];
      }

      happyEdgeIds.add(chosen.id);
      current = chosen.target;
    }
  }

  return happyEdgeIds;
}

// ── Post-ELK grid snap pass ───────────────────────────────────────────────

/**
 * Detected layer: a group of elements sharing approximately the same
 * x-centre, representing one ELK column.
 */
interface GridLayer {
  /** Elements in this layer. */
  elements: any[];
  /** Leftmost x of any element in the layer. */
  minX: number;
  /** Rightmost edge (x + width) of any element in the layer. */
  maxRight: number;
  /** Maximum element width in this layer. */
  maxWidth: number;
}

/**
 * Detect discrete layers (columns) from element x-positions.
 *
 * After ELK positioning and snapSameLayerElements(), elements in the
 * same ELK layer share approximately the same x-centre.  This function
 * groups them into discrete layers by clustering x-centres.
 *
 * Only considers direct children of the given container (or the root
 * process when no container is given).  This prevents mixing elements
 * from different nesting levels (e.g. subprocess internals with top-level
 * elements), which would cause cascading moves via modeling.moveElements.
 */
function detectLayers(elementRegistry: any, container?: any): GridLayer[] {
  // When no container is specified, find the root process element so we
  // only include its direct children — not children of subprocesses.
  let parentFilter: any = container;
  if (!parentFilter) {
    parentFilter = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  }
  // If no root found (shouldn't happen), fall back to including all elements
  if (!parentFilter) {
    const shapes = elementRegistry.filter(
      (el: any) =>
        !isInfrastructure(el.type) &&
        !isConnection(el.type) &&
        !isArtifact(el.type) &&
        !isLane(el.type) &&
        el.type !== 'bpmn:BoundaryEvent' &&
        el.type !== 'label' &&
        el.type !== 'bpmn:Participant'
    );
    return shapes.length === 0 ? [] : clusterIntoLayers(shapes);
  }

  const shapes = elementRegistry.filter(
    (el: any) =>
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      !isLane(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      el.type !== 'label' &&
      el.type !== 'bpmn:Participant' &&
      el.parent === parentFilter
  );

  return shapes.length === 0 ? [] : clusterIntoLayers(shapes);
}

/** Cluster shapes into layers by x-centre proximity. */
function clusterIntoLayers(shapes: any[]): GridLayer[] {
  // Sort by x-centre
  const sorted = [...shapes].sort(
    (a: any, b: any) => a.x + (a.width || 0) / 2 - (b.x + (b.width || 0) / 2)
  );

  // Cluster into layers: elements within layerThreshold of the first
  // element in the current cluster are in the same layer.
  const layerThreshold = ELK_LAYER_SPACING / 2;
  const layers: GridLayer[] = [];
  let currentGroup: any[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevCx = currentGroup[0].x + (currentGroup[0].width || 0) / 2;
    const currCx = sorted[i].x + (sorted[i].width || 0) / 2;
    if (Math.abs(currCx - prevCx) <= layerThreshold) {
      currentGroup.push(sorted[i]);
    } else {
      layers.push(buildLayer(currentGroup));
      currentGroup = [sorted[i]];
    }
  }
  layers.push(buildLayer(currentGroup));

  return layers;
}

function buildLayer(elements: any[]): GridLayer {
  let minX = Infinity;
  let maxRight = -Infinity;
  let maxWidth = 0;
  for (const el of elements) {
    const x = el.x;
    const right = x + (el.width || 0);
    const w = el.width || 0;
    if (x < minX) minX = x;
    if (right > maxRight) maxRight = right;
    if (w > maxWidth) maxWidth = w;
  }
  return { elements, minX, maxRight, maxWidth };
}

/**
 * Post-ELK grid snap pass.
 *
 * Quantises node coordinates to a virtual grid after ELK positioning,
 * combining ELK's optimal topology with bpmn-auto-layout's visual
 * regularity.
 *
 * Steps:
 * 1. Detect discrete layers (columns) from element x-positions.
 * 2. Snap layers to uniform x-columns with consistent gap.
 * 3. Distribute elements uniformly within each layer (vertical).
 * 4. Centre gateways on their connected branches.
 * 5. Preserve happy-path row (pin happy-path elements, distribute others).
 */
function gridSnapPass(
  elementRegistry: any,
  modeling: any,
  happyPathEdgeIds?: Set<string>,
  container?: any
): void {
  const layers = detectLayers(elementRegistry, container);
  if (layers.length < 2) return;

  // Determine happy-path element IDs from the happy-path edges
  const happyPathNodeIds = new Set<string>();
  if (happyPathEdgeIds && happyPathEdgeIds.size > 0) {
    const allElements: any[] = elementRegistry.getAll();
    for (const el of allElements) {
      if (isConnection(el.type) && happyPathEdgeIds.has(el.id)) {
        if (el.source) happyPathNodeIds.add(el.source.id);
        if (el.target) happyPathNodeIds.add(el.target.id);
      }
    }
  }

  // ── Step 1: Snap layers to uniform x-columns ──
  // Compute uniform column x-positions: each layer starts at
  // previous_layer_right_edge + gap.
  const gap = ELK_LAYER_SPACING;
  let columnX = layers[0].minX; // First layer stays at its current position

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];

    if (i > 0) {
      // Uniform column x = previous layer right edge + gap
      columnX = layers[i - 1].maxRight + gap;
    }

    // Centre each element in the column based on the max width
    for (const el of layer.elements) {
      const elW = el.width || 0;
      const desiredX = columnX + (layer.maxWidth - elW) / 2;
      const dx = Math.round(desiredX) - el.x;
      if (Math.abs(dx) > 0.5) {
        modeling.moveElements([el], { x: dx, y: 0 });
      }
    }

    // Update layer bounds after moving
    let newMinX = Infinity;
    let newMaxRight = -Infinity;
    for (const el of layer.elements) {
      const updated = elementRegistry.get(el.id);
      if (updated.x < newMinX) newMinX = updated.x;
      const right = updated.x + (updated.width || 0);
      if (right > newMaxRight) newMaxRight = right;
    }
    layers[i] = { ...layer, minX: newMinX, maxRight: newMaxRight };
  }

  // ── Step 2: Uniform vertical spacing within layers ──
  const nodeSpacing = ELK_NODE_SPACING;

  for (const layer of layers) {
    if (layer.elements.length < 2) continue;

    // Sort by current Y
    const sorted = [...layer.elements].sort((a: any, b: any) => a.y - b.y);

    // Identify happy-path elements in this layer
    const happyEls = sorted.filter((el: any) => happyPathNodeIds.has(el.id));
    const nonHappyEls = sorted.filter((el: any) => !happyPathNodeIds.has(el.id));

    // If there's a happy-path element, pin it and distribute others around it
    if (happyEls.length > 0 && nonHappyEls.length > 0) {
      // Pin the first happy-path element's Y as the reference
      const pinnedY = happyEls[0].y + (happyEls[0].height || 0) / 2;

      // Sort non-happy elements into above and below the pinned element
      const above = nonHappyEls.filter((el: any) => el.y + (el.height || 0) / 2 < pinnedY);
      const below = nonHappyEls.filter((el: any) => el.y + (el.height || 0) / 2 >= pinnedY);

      // Distribute above elements upward from the pinned position
      let nextY = pinnedY - (happyEls[0].height || 0) / 2 - nodeSpacing;
      for (let i = above.length - 1; i >= 0; i--) {
        const el = above[i];
        const elH = el.height || 0;
        const desiredY = nextY - elH;
        const dy = Math.round(desiredY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        nextY = desiredY - nodeSpacing;
      }

      // Distribute below elements downward from the pinned position
      nextY = pinnedY + (happyEls[0].height || 0) / 2 + nodeSpacing;
      for (const el of below) {
        const desiredY = nextY;
        const dy = Math.round(desiredY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        nextY = desiredY + (el.height || 0) + nodeSpacing;
      }
    } else {
      // No happy path — just distribute uniformly
      // Compute the vertical centre of the group
      const totalHeight = sorted.reduce((sum: number, el: any) => sum + (el.height || 0), 0);
      const totalGaps = (sorted.length - 1) * nodeSpacing;
      const groupHeight = totalHeight + totalGaps;
      const currentCentreY =
        (sorted[0].y + sorted[sorted.length - 1].y + (sorted[sorted.length - 1].height || 0)) / 2;
      let startY = currentCentreY - groupHeight / 2;

      for (const el of sorted) {
        const dy = Math.round(startY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        startY += (el.height || 0) + nodeSpacing;
      }
    }
  }

  // ── Step 3: Centre gateways on their connected branches ──
  // Skip gateways that are on the happy path to preserve straightness.
  centreGatewaysOnBranches(elementRegistry, modeling, happyPathNodeIds);
}

/**
 * After grid snapping, re-centre gateways vertically to the midpoint
 * of their connected elements.  This matches bpmn-auto-layout's behaviour
 * where split/join gateways sit at the visual centre of their branches.
 *
 * Skips gateways on the happy path to avoid breaking row alignment.
 */
function centreGatewaysOnBranches(
  elementRegistry: any,
  modeling: any,
  happyPathNodeIds: Set<string>
): void {
  const gateways = elementRegistry.filter((el: any) => el.type?.includes('Gateway'));

  for (const gw of gateways) {
    // Skip gateways on the happy path to preserve row alignment
    if (happyPathNodeIds.has(gw.id)) continue;

    // Collect all directly connected elements (via outgoing + incoming flows)
    const connectedYs: number[] = [];
    const allElements: any[] = elementRegistry.getAll();

    for (const el of allElements) {
      if (!isConnection(el.type)) continue;
      if (el.source?.id === gw.id && el.target) {
        connectedYs.push(el.target.y + (el.target.height || 0) / 2);
      }
      if (el.target?.id === gw.id && el.source) {
        connectedYs.push(el.source.y + (el.source.height || 0) / 2);
      }
    }

    if (connectedYs.length < 2) continue;

    const minY = Math.min(...connectedYs);
    const maxY = Math.max(...connectedYs);
    const midY = (minY + maxY) / 2;
    const gwCy = gw.y + (gw.height || 0) / 2;

    const dy = Math.round(midY - gwCy);
    if (Math.abs(dy) > 2) {
      modeling.moveElements([gw], { x: 0, y: dy });
    }
  }
}

/**
 * Recursively run gridSnapPass inside expanded subprocesses.
 *
 * Expanded subprocesses are compound nodes whose children are laid out
 * by ELK internally.  The grid snap pass must run separately within each
 * expanded subprocess (scoped to its direct children) to avoid mixing
 * nesting levels.
 */
function gridSnapExpandedSubprocesses(
  elementRegistry: any,
  modeling: any,
  happyPathEdgeIds?: Set<string>,
  container?: any
): void {
  // Find expanded subprocesses that are direct children of the given container
  const parentFilter =
    container ||
    elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  if (!parentFilter) return;

  const expandedSubs = elementRegistry.filter(
    (el: any) =>
      el.type === 'bpmn:SubProcess' &&
      el.parent === parentFilter &&
      // Only expanded subprocesses (those with layoutable children)
      elementRegistry.filter(
        (child: any) =>
          child.parent === el &&
          !isInfrastructure(child.type) &&
          !isConnection(child.type) &&
          child.type !== 'bpmn:BoundaryEvent'
      ).length > 0
  );

  for (const sub of expandedSubs) {
    gridSnapPass(elementRegistry, modeling, happyPathEdgeIds, sub);
    // Recurse into nested subprocesses
    gridSnapExpandedSubprocesses(elementRegistry, modeling, happyPathEdgeIds, sub);
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
  /** Pin the main (happy) path to a single row for visual clarity. */
  preserveHappyPath?: boolean;
  /**
   * Enable post-ELK grid snap pass (default: true).
   * When true, quantises node positions to a virtual grid for visual
   * regularity matching bpmn-auto-layout's aesthetic.
   * When false, preserves pure ELK positioning.
   */
  gridSnap?: boolean;
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
 * 5. Post-ELK grid snap pass (uniform columns + vertical spacing)
 * 6. Apply ELK edge sections as connection waypoints (bypasses
 *    bpmn-js ManhattanLayout entirely for ELK-routed edges)
 * 7. Route branch connections through inter-column channels
 * 8. Detect crossing flows and report count
 */
export async function elkLayout(
  diagram: DiagramState,
  options?: ElkLayoutOptions
): Promise<{ crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> }> {
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

  // When preserveHappyPath is enabled (default: true), detect the main path
  // and tag its edges with high straightness priority so ELK keeps them in
  // a single row.
  const shouldPreserveHappyPath = options?.preserveHappyPath !== false;
  let happyPathEdgeIds: Set<string> | undefined;
  if (shouldPreserveHappyPath) {
    happyPathEdgeIds = detectHappyPath(allElements);
    if (happyPathEdgeIds.size > 0) {
      for (const edge of edges) {
        if (happyPathEdgeIds.has(edge.id)) {
          edge.layoutOptions = {
            'elk.priority.straightness': '10',
            'elk.priority.direction': '10',
          };
        }
      }
    }
  }

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

  // Step 2: Resize compound nodes (participants, expanded subprocesses)
  // to match ELK-computed dimensions.  Must be AFTER applyElkPositions
  // so that x/y are already correct.
  resizeCompoundNodes(elementRegistry, modeling, result);

  // Step 3: Fix boundary event positions.  They are excluded from the
  // ELK graph and should follow their host via moveElements, but
  // headless mode may leave them stranded.
  repositionBoundaryEvents(elementRegistry, modeling);

  // Step 4: Snap same-layer elements to common Y (fixes 5–10 px offsets)
  snapSameLayerElements(elementRegistry, modeling);

  // Step 5: Post-ELK grid snap pass — quantises node positions to a
  // virtual grid for visual regularity.  Runs independently within each
  // participant for collaboration diagrams, and recursively for expanded
  // subprocesses.
  const shouldGridSnap = options?.gridSnap !== false;
  if (shouldGridSnap) {
    // For collaborations, run grid snap within each participant
    const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
    if (participants.length > 0) {
      for (const participant of participants) {
        gridSnapPass(elementRegistry, modeling, happyPathEdgeIds, participant);
        // Also run within expanded subprocesses inside this participant
        gridSnapExpandedSubprocesses(elementRegistry, modeling, happyPathEdgeIds, participant);
      }
    } else {
      gridSnapPass(elementRegistry, modeling, happyPathEdgeIds);
      // Also run within expanded subprocesses at the root level
      gridSnapExpandedSubprocesses(elementRegistry, modeling, happyPathEdgeIds);
    }
  }

  // Step 6: Reposition artifacts (data objects, data stores, annotations)
  // outside the main flow — they were excluded from the ELK graph.
  repositionArtifacts(elementRegistry, modeling);

  // Step 7: Apply ELK edge routes as waypoints (orthogonal, no diagonals).
  // Uses ELK's own edge sections instead of bpmn-js ManhattanLayout,
  // eliminating diagonals, S-curves, and gateway routing interference.
  applyElkEdgeRoutes(elementRegistry, modeling, result, offsetX, offsetY);

  // Step 7.5: Route gateway branch connections through inter-column channels.
  // Shifts vertical segments to the midpoint between columns rather than
  // hugging the gateway edge, matching bpmn-auto-layout's channel routing.
  if (shouldGridSnap) {
    const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
    if (participants.length > 0) {
      for (const participant of participants) {
        routeBranchConnectionsThroughChannels(elementRegistry, modeling, participant);
      }
    } else {
      routeBranchConnectionsThroughChannels(elementRegistry, modeling);
    }
  }

  // Step 8: Final orthogonal snap pass on ALL connections.
  // Catches residual near-diagonal segments from ELK rounding or fallback routing.
  snapAllConnectionsOrthogonal(elementRegistry, modeling);

  // Step 9: Detect crossing sequence flows for diagnostics
  const crossingFlowsResult = detectCrossingFlows(elementRegistry);

  return {
    crossingFlows: crossingFlowsResult.count,
    crossingFlowPairs: crossingFlowsResult.pairs,
  };
}

// ── Partial (subset) layout ────────────────────────────────────────────────

/**
 * Run ELK layered layout on a subset of elements in a BPMN diagram.
 *
 * Builds a sub-graph from the specified element IDs and their
 * inter-connections, runs ELK layout on that sub-graph, and applies
 * positions back — leaving all other elements untouched.
 *
 * Enhancements:
 * - Detects if selected elements share a common participant/subprocess
 *   and uses it as the layout scope (respecting container boundaries).
 * - Includes nearby artifacts (data objects, annotations) linked to
 *   selected elements via associations as pinned (fixed-position) context.
 */
// eslint-disable-next-line complexity
export async function elkLayoutSubset(
  diagram: DiagramState,
  elementIds: string[],
  options?: Omit<ElkLayoutOptions, 'scopeElementId'>
): Promise<{ crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> }> {
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

  // Detect if all selected elements share a common container (participant
  // or subprocess).  If so, constrain the layout offset to that container's
  // boundaries so elements don't escape their pool.
  let sharedContainer: any = null;
  if (shapes.length > 1) {
    const parents = shapes
      .map((s: any) => s.parent)
      .filter((p: any) => p && (p.type === 'bpmn:Participant' || p.type === 'bpmn:SubProcess'));
    if (parents.length === shapes.length) {
      const firstParentId = parents[0].id;
      if (parents.every((p: any) => p.id === firstParentId)) {
        sharedContainer = parents[0];
      }
    }
  }

  // Include artifacts linked to selected elements via associations.
  // These are added as fixed-position nodes so ELK routes around them.
  const allElements: any[] = elementRegistry.getAll();
  const associations = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:Association' ||
        el.type === 'bpmn:DataInputAssociation' ||
        el.type === 'bpmn:DataOutputAssociation') &&
      el.source &&
      el.target
  );

  const linkedArtifactIds = new Set<string>();
  for (const assoc of associations) {
    if (idSet.has(assoc.source.id) && isArtifact(assoc.target.type)) {
      linkedArtifactIds.add(assoc.target.id);
    }
    if (idSet.has(assoc.target.id) && isArtifact(assoc.source.type)) {
      linkedArtifactIds.add(assoc.source.id);
    }
  }

  // Build ELK children nodes
  const children: ElkNode[] = shapes.map((s: any) => ({
    id: s.id,
    width: s.width || 100,
    height: s.height || 80,
  }));

  // Add linked artifacts as pinned ELK nodes (fixed position) so the
  // layout respects their presence but doesn't move them.
  for (const artId of linkedArtifactIds) {
    if (idSet.has(artId)) continue; // already in the subset
    const art = elementRegistry.get(artId);
    if (!art) continue;
    children.push({
      id: art.id,
      width: art.width || 100,
      height: art.height || 30,
      layoutOptions: {
        'elk.position': `(${art.x}, ${art.y})`,
        'org.eclipse.elk.noLayout': 'true',
      },
    });
  }
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

  // Use the container origin as offset when elements share a container,
  // otherwise use the minimum existing position so elements stay roughly
  // in the same area of the canvas.
  let minX = Infinity;
  let minY = Infinity;
  if (sharedContainer) {
    // Offset inside the container with padding
    minX = sharedContainer.x + 20;
    minY = sharedContainer.y + 50;
  } else {
    for (const s of shapes) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
    }
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

/** Result of crossing flow detection: count + pairs of crossing flow IDs. */
export interface CrossingFlowsResult {
  count: number;
  pairs: Array<[string, string]>;
}

/**
 * Detect crossing sequence flows after layout.
 *
 * Checks all pairs of connections for segment intersections and returns
 * the count of crossing pairs along with their IDs.
 */
function detectCrossingFlows(elementRegistry: any): CrossingFlowsResult {
  const connections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.waypoints && el.waypoints.length >= 2
  );

  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < connections.length; i++) {
    for (let j = i + 1; j < connections.length; j++) {
      const wpsA = connections[i].waypoints;
      const wpsB = connections[j].waypoints;

      let found = false;
      for (let a = 0; a < wpsA.length - 1 && !found; a++) {
        for (let b = 0; b < wpsB.length - 1 && !found; b++) {
          if (segmentsIntersect(wpsA[a], wpsA[a + 1], wpsB[b], wpsB[b + 1])) {
            pairs.push([connections[i].id, connections[j].id]);
            found = true;
          }
        }
      }
    }
  }

  return { count: pairs.length, pairs };
}
