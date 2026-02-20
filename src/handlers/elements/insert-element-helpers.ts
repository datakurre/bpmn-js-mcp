/**
 * Helpers for the insert_bpmn_element handler.
 *
 * Split out to keep insert-element.ts within the max-lines limit.
 */

import { STANDARD_BPMN_GAP } from '../../constants';
import {
  buildElementCounts,
  getVisibleElements,
  generateFlowId,
  fixConnectionId,
} from '../helpers';
import { getTypeSpecificHints } from '../hints';
import { resizeParentContainers, collectDownstreamElements } from './add-element-helpers';
import { buildZShapeRoute } from '../../elk/edge-routing-helpers';
import { adjustElementLabel } from '../layout/labels/adjust-labels';

/**
 * Detect elements that overlap with the newly inserted element.
 * Returns overlapping elements.
 */
export function detectOverlaps(elementRegistry: any, inserted: any): any[] {
  const elements = elementRegistry.filter(
    (el: any) =>
      el.id !== inserted.id &&
      el.type &&
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.type !== 'bpmn:Process' &&
      el.type !== 'bpmn:Collaboration' &&
      el.type !== 'label' &&
      !el.type.includes('BPMNDiagram') &&
      !el.type.includes('BPMNPlane') &&
      el.parent !== inserted &&
      inserted.parent !== el
  );

  const ix = inserted.x ?? 0;
  const iy = inserted.y ?? 0;
  const iw = inserted.width ?? 0;
  const ih = inserted.height ?? 0;

  return elements.filter((el: any) => {
    const ex = el.x ?? 0;
    const ey = el.y ?? 0;
    const ew = el.width ?? 0;
    const eh = el.height ?? 0;
    return ix < ex + ew && ix + iw > ex && iy < ey + eh && iy + ih > ey;
  });
}

/**
 * Resolve overlaps by shifting overlapping elements vertically.
 */
export function resolveInsertionOverlaps(
  modeling: any,
  _elementRegistry: any,
  inserted: any,
  overlapping: any[]
): void {
  const iy = inserted.y ?? 0;
  const ih = inserted.height ?? 0;
  const insertedBottom = iy + ih;

  for (const el of overlapping) {
    const ey = el.y ?? 0;
    const overlap = insertedBottom - ey + STANDARD_BPMN_GAP;
    if (overlap > 0) {
      modeling.moveElements([el], { x: 0, y: overlap });
      if (el.attachers) {
        for (const attacher of el.attachers) {
          modeling.moveElements([attacher], { x: 0, y: overlap });
        }
      }
    }
  }
}

/** Build the JSON result for the insert operation. */
export function buildInsertResult(opts: {
  createdElement: any;
  elementType: string;
  elementName?: string;
  midX: number;
  midY: number;
  flowId: string;
  conn1: any;
  conn2: any;
  sourceId: string;
  targetId: string;
  shiftApplied: number;
  overlaps: any[];
  flowLabel?: string;
  elementRegistry: any;
  laneId?: string;
}): Record<string, any> {
  const data: Record<string, any> = {
    success: true,
    elementId: opts.createdElement.id,
    elementType: opts.elementType,
    name: opts.elementName,
    position: { x: opts.midX, y: opts.midY },
    ...(opts.laneId ? { laneId: opts.laneId } : {}),
    replacedFlowId: opts.flowId,
    newFlows: [
      { flowId: opts.conn1.id, source: opts.sourceId, target: opts.createdElement.id },
      { flowId: opts.conn2.id, source: opts.createdElement.id, target: opts.targetId },
    ],
    diagramCounts: buildElementCounts(opts.elementRegistry),
    message: `Inserted ${opts.elementType}${opts.elementName ? ` "${opts.elementName}"` : ''} between ${opts.sourceId} and ${opts.targetId}`,
    ...getTypeSpecificHints(opts.elementType),
  };
  // C1-6: Removed the unconditional layout_bpmn_diagram next-step hint.
  // Incremental insert now handles element shift, reconnection, and label
  // adjustment inline (C1-1/C1-2/C1-4), so a full re-layout is not always
  // required.  Callers may still run layout_bpmn_diagram for complex diagrams
  // where ELK produces cleaner routes than the incremental approach.
  if (opts.shiftApplied > 0) {
    data.shiftApplied = opts.shiftApplied;
    data.shiftNote = 'Downstream elements shifted right to make space';
  }
  if (opts.overlaps.length > 0) {
    data.overlapResolution = `Resolved ${opts.overlaps.length} overlap(s) by shifting elements: ${opts.overlaps.map((el: any) => el.id).join(', ')}`;
  }
  if (opts.flowLabel) {
    data.note = `Original flow label "${opts.flowLabel}" was removed`;
  }
  return data;
}

/** Shift downstream elements right when there isn't enough horizontal space.
 *
 * C1-1: Uses a BFS walk from `startElement` (the insertion target) along
 * outgoing sequence flows instead of shifting ALL elements at x >= tgtLeft.
 * This prevents unrelated parallel branches from being displaced when an
 * element is inserted on only one branch of a split gateway.
 */
export function shiftIfNeeded(
  elementRegistry: any,
  modeling: any,
  srcRight: number,
  tgtLeft: number,
  requiredSpace: number,
  sourceId: string,
  startElement?: any
): number {
  const availableSpace = tgtLeft - srcRight;
  if (availableSpace >= requiredSpace) return 0;

  const shiftAmount = requiredSpace - availableSpace;

  // C1-1: BFS from startElement following outgoing SequenceFlows.
  // Only elements reachable downstream from the insertion target are shifted,
  // so parallel branches on other paths remain untouched.
  if (startElement) {
    const toShift = collectDownstreamElements(elementRegistry, startElement, sourceId);
    if (toShift.length > 0) modeling.moveElements(toShift, { x: shiftAmount, y: 0 });
    resizeParentContainers(elementRegistry, modeling);
    return shiftAmount;
  }

  // Fallback: original X-threshold approach (used when startElement is unknown)
  const toShift = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.id !== sourceId &&
      el.x >= tgtLeft
  );
  if (toShift.length > 0) modeling.moveElements(toShift, { x: shiftAmount, y: 0 });
  resizeParentContainers(elementRegistry, modeling);
  return shiftAmount;
}

/** Reconnect source→newElement→target with new sequence flows. */
export function reconnectThroughElement(
  modeling: any,
  elementRegistry: any,
  source: any,
  createdElement: any,
  target: any,
  elementName: string | undefined,
  flowCondition: any
): { conn1: any; conn2: any } {
  const flowId1 = generateFlowId(elementRegistry, source?.businessObject?.name, elementName);
  const conn1 = modeling.connect(source, createdElement, {
    type: 'bpmn:SequenceFlow',
    id: flowId1,
  });
  fixConnectionId(conn1, flowId1);
  if (flowCondition) {
    modeling.updateProperties(conn1, { conditionExpression: flowCondition });
  }

  const flowId2 = generateFlowId(elementRegistry, elementName, target?.businessObject?.name);
  const conn2 = modeling.connect(createdElement, target, {
    type: 'bpmn:SequenceFlow',
    id: flowId2,
  });
  fixConnectionId(conn2, flowId2);
  return { conn1, conn2 };
}

/**
 * C1-3: Set clean orthogonal waypoints on the two sequence flows created by
 * `reconnectThroughElement`.  Uses straight 2-point horizontal waypoints when
 * source and inserted are on the same Y row, or Z-shaped 4-point waypoints
 * when they are on different rows.
 *
 * Non-fatal: if waypoint update fails (e.g. element not yet fully positioned),
 * bpmn-js default routing is kept as a fallback.
 */
export function setInsertWaypoints(
  modeling: any,
  source: any,
  inserted: any,
  target: any,
  conn1: any,
  conn2: any,
  alignmentTolerance: number
): void {
  const srcRight = Math.round(source.x + (source.width || 0));
  const srcCy = Math.round(source.y + (source.height || 0) / 2);
  const insLeft = Math.round(inserted.x);
  const insRight = Math.round(inserted.x + (inserted.width || 0));
  const insCy = Math.round(inserted.y + (inserted.height || 0) / 2);
  const tgtLeft = Math.round(target.x);
  const tgtCy = Math.round(target.y + (target.height || 0) / 2);

  // conn1: source → inserted
  if (Math.abs(srcCy - insCy) <= alignmentTolerance) {
    modeling.updateWaypoints(conn1, [
      { x: srcRight, y: srcCy },
      { x: insLeft, y: srcCy },
    ]);
  } else {
    modeling.updateWaypoints(conn1, buildZShapeRoute(srcRight, srcCy, insLeft, insCy));
  }

  // conn2: inserted → target
  if (Math.abs(insCy - tgtCy) <= alignmentTolerance) {
    modeling.updateWaypoints(conn2, [
      { x: insRight, y: insCy },
      { x: tgtLeft, y: insCy },
    ]);
  } else {
    modeling.updateWaypoints(conn2, buildZShapeRoute(insRight, insCy, tgtLeft, tgtCy));
  }
}

/**
 * Post-insert cleanup: overlap resolution, C1-3 waypoints, and C1-4 label adjustment.
 * Extracted to keep `handleInsertElement` within the max-lines limit.
 */
export async function postInsertCleanup(opts: {
  modeling: any;
  elementRegistry: any;
  diagram: any;
  source: any;
  inserted: any;
  target: any;
  conn1: any;
  conn2: any;
  alignmentTolerance: number;
}): Promise<any[]> {
  const { modeling, elementRegistry, diagram, source, inserted, target, conn1, conn2 } = opts;

  // C1-3: Set clean orthogonal waypoints on the new connections
  try {
    setInsertWaypoints(modeling, source, inserted, target, conn1, conn2, opts.alignmentTolerance);
  } catch {
    // Non-fatal — bpmn-js default routing used as fallback
  }

  const overlaps = detectOverlaps(elementRegistry, inserted);
  if (overlaps.length > 0) {
    resolveInsertionOverlaps(modeling, elementRegistry, inserted, overlaps);
  }

  // C1-4: Adjust labels on the new connections and the inserted element.
  try {
    await adjustElementLabel(diagram, inserted.id);
    await adjustElementLabel(diagram, conn1.id);
    await adjustElementLabel(diagram, conn2.id);
  } catch {
    // Ignore label adjustment errors (e.g. element has no label)
  }

  return overlaps;
}
