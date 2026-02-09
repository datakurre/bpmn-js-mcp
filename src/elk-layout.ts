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
const SAME_ROW_THRESHOLD = 15;

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

  // Direct child shapes (skip connections, boundary events, infrastructure)
  const childShapes = allElements.filter(
    (el: any) =>
      el.parent === container &&
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
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

      // Snap near-horizontal/vertical segments to strict orthogonal
      for (let i = 1; i < waypoints.length; i++) {
        const prev = waypoints[i - 1];
        const curr = waypoints[i];
        if (Math.abs(curr.y - prev.y) < 2) {
          curr.y = prev.y;
        }
        if (Math.abs(curr.x - prev.x) < 2) {
          curr.x = prev.x;
        }
      }

      modeling.updateWaypoints(conn, waypoints);
    } else {
      // Fallback: use bpmn-js ManhattanLayout for connections ELK didn't route
      const src = conn.source;
      const tgt = conn.target;
      const srcMid = { x: src.x + (src.width || 0) / 2, y: src.y + (src.height || 0) / 2 };
      const tgtMid = { x: tgt.x + (tgt.width || 0) / 2, y: tgt.y + (tgt.height || 0) / 2 };

      conn.waypoints = [srcMid, tgtMid];
      modeling.layoutConnection(conn, {
        connectionStart: srcMid,
        connectionEnd: tgtMid,
      });
    }
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

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
 */
export async function elkLayout(diagram: DiagramState): Promise<void> {
  // Dynamic import — elkjs is externalized in esbuild
  const ELK = (await import('elkjs')).default;
  const elk = new ELK();

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const canvas = diagram.modeler.get('canvas');
  const rootElement = canvas.getRootElement();

  const allElements: any[] = elementRegistry.getAll();
  const { children, edges } = buildContainerGraph(allElements, rootElement);

  if (children.length === 0) return;

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children,
    edges,
  };

  const result = await elk.layout(elkGraph);

  // Step 1: Apply ELK-computed node positions
  applyElkPositions(elementRegistry, modeling, result, ORIGIN_OFFSET_X, ORIGIN_OFFSET_Y);

  // Step 2: Snap same-layer elements to common Y (fixes 5–10 px offsets)
  snapSameLayerElements(elementRegistry, modeling);

  // Step 3: Apply ELK edge routes as waypoints (orthogonal, no diagonals).
  // Uses ELK's own edge sections instead of bpmn-js ManhattanLayout,
  // eliminating diagonals, S-curves, and gateway routing interference.
  applyElkEdgeRoutes(elementRegistry, modeling, result, ORIGIN_OFFSET_X, ORIGIN_OFFSET_Y);
}
