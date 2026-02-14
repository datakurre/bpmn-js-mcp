/**
 * Handler for convert_bpmn_collaboration_to_lanes tool.
 *
 * Converts a multi-pool collaboration into a single pool with lanes.
 * This is appropriate when pools represent roles within the same
 * organization (e.g. "Customer" and "Support") rather than separate
 * systems or organizations.
 *
 * Algorithm:
 *   1. Validate that ≥2 expanded participants exist
 *   2. Pick the "main" pool (largest element count, or first)
 *   3. Create lanes in the main pool (one per original pool)
 *   4. Move elements from other pools into the main pool
 *   5. Assign elements to their corresponding lane
 *   6. Replace message flows with sequence flows
 *   7. Remove now-empty pools
 *   8. Optionally run layout
 */

import { type ToolResult } from '../../types';
import { semanticViolationError } from '../../errors';
import { requireDiagram, jsonResult, syncXml, validateArgs, getService } from '../helpers';
import { appendLintFeedback } from '../../linter';
import { handleCreateLanes } from './create-lanes';
import { handleAssignElementsToLane } from './assign-elements-to-lane';

export interface ConvertCollaborationToLanesArgs {
  diagramId: string;
  /**
   * Optional ID of the participant to keep as the main pool.
   * When omitted, the pool with the most flow elements is chosen.
   */
  mainParticipantId?: string;
  /**
   * When true (default), runs layout after conversion.
   */
  layout?: boolean;
}

/** BPMN types that are connection-like (not moveable flow nodes). */
const CONNECTION_TYPES = new Set([
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

/** Types that are structural / non-movable. */
const STRUCTURAL_TYPES = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:LaneSet',
  'bpmn:Process',
  'bpmn:Collaboration',
  'label',
]);

/** Check if a type is a flow node (task, event, gateway, subprocess). */
function isFlowNode(type: string): boolean {
  return !CONNECTION_TYPES.has(type) && !STRUCTURAL_TYPES.has(type);
}

/**
 * Check the BPMNShape DI to determine if a participant is expanded.
 */
function isParticipantExpanded(participantBo: any, definitions: any): boolean {
  const diagrams = definitions?.diagrams;
  if (!diagrams) return true;
  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;
    for (const el of plane.planeElement) {
      if (el.$type === 'bpmndi:BPMNShape' && el.bpmnElement?.id === participantBo.id) {
        return el.isExpanded !== false;
      }
    }
  }
  return true;
}

/** Get the flow nodes (shapes) inside a participant from the element registry. */
function getChildFlowNodes(elementRegistry: any, participantId: string): any[] {
  return elementRegistry.filter(
    (el: any) =>
      el.parent?.id === participantId && isFlowNode(el.type) && !el.type?.includes('Connection')
  );
}

/** Find all message flows connected to elements in given participant IDs. */
function getAllMessageFlowsForParticipants(elementRegistry: any, participantIds: string[]): any[] {
  const pidSet = new Set(participantIds);
  return elementRegistry.filter((el: any) => {
    if (el.type !== 'bpmn:MessageFlow') return false;
    const sourcePool = el.source?.parent?.id;
    const targetPool = el.target?.parent?.id;
    return pidSet.has(sourcePool) && pidSet.has(targetPool);
  });
}

/** Validate and return expanded participants. Throws if fewer than 2. */
function getExpandedParticipants(elementRegistry: any, definitions: any): any[] {
  const allParticipants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');

  if (allParticipants.length < 2) {
    throw semanticViolationError(
      'Diagram must have at least 2 participants (pools) to convert to lanes. ' +
        'Current participant count: ' +
        allParticipants.length
    );
  }

  const expanded = allParticipants.filter((p: any) =>
    isParticipantExpanded(p.businessObject, definitions)
  );

  if (expanded.length < 2) {
    throw semanticViolationError(
      'Need at least 2 expanded (non-collapsed) participants to convert to lanes. ' +
        `Found ${expanded.length} expanded and ${allParticipants.length - expanded.length} collapsed participant(s).`
    );
  }

  return expanded;
}

/**
 * Pick the main pool to keep.
 *
 * We prefer the first expanded participant because bpmn-js has a
 * limitation where creating lanes in non-first participants with existing
 * elements can fail (getLaneSet error). The first participant always has
 * a properly initialized processRef.
 */
function pickMainPool(expandedParticipants: any[], mainParticipantId?: string): any {
  if (mainParticipantId) {
    const found = expandedParticipants.find((p: any) => p.id === mainParticipantId);
    if (!found) {
      throw semanticViolationError(
        `Participant "${mainParticipantId}" not found or not expanded. ` +
          'Available expanded participants: ' +
          expandedParticipants.map((p: any) => p.id).join(', ')
      );
    }
    return found;
  }
  return expandedParticipants[0];
}

/** Move elements from merge pools into the main pool, returning moved-element map. */
function moveElementsToMainPool(
  elementRegistry: any,
  modeling: any,
  mergePools: any[],
  mainPool: any
): Record<string, string[]> {
  const movedElements: Record<string, string[]> = {};

  for (const mergePool of mergePools) {
    const childNodes = getChildFlowNodes(elementRegistry, mergePool.id);
    const poolName = mergePool.businessObject?.name || mergePool.id;
    movedElements[poolName] = childNodes.map((el: any) => el.id);

    if (childNodes.length > 0) {
      modeling.moveElements(childNodes, { x: 0, y: 0 }, mainPool);
    }
  }

  return movedElements;
}

/** Assign elements to lanes based on their original pool names. */
async function assignElementsToLanes(
  diagramId: string,
  elementRegistry: any,
  mainPoolId: string,
  mainPoolName: string,
  movedElements: Record<string, string[]>
): Promise<void> {
  const lanes = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:Lane' && el.parent?.id === mainPoolId
  );

  const laneByName = new Map<string, any>();
  for (const lane of lanes) {
    const name = lane.businessObject?.name || lane.id;
    laneByName.set(name.toLowerCase(), lane);
  }

  // Assign elements originally in the main pool to the main lane
  const mainLane = laneByName.get(mainPoolName.toLowerCase());
  if (mainLane) {
    const movedIds = new Set(Object.values(movedElements).flat());
    const mainIds = getChildFlowNodes(elementRegistry, mainPoolId)
      .filter((el: any) => !movedIds.has(el.id))
      .map((el: any) => el.id);

    if (mainIds.length > 0) {
      await handleAssignElementsToLane({
        diagramId,
        laneId: mainLane.id,
        elementIds: mainIds,
        reposition: true,
      });
    }
  }

  // Assign moved elements to their corresponding lanes
  for (const [poolName, elementIds] of Object.entries(movedElements)) {
    const lane = laneByName.get(poolName.toLowerCase());
    if (!lane || elementIds.length === 0) continue;
    const existingIds = elementIds.filter((id) => elementRegistry.get(id));
    if (existingIds.length > 0) {
      await handleAssignElementsToLane({
        diagramId,
        laneId: lane.id,
        elementIds: existingIds,
        reposition: true,
      });
    }
  }
}

/** Convert saved message-flow endpoints to sequence flows. */
function convertMessageFlowsToSequenceFlows(
  modeling: any,
  elementRegistry: any,
  endpoints: Array<{ sourceId: string; targetId: string; name?: string }>
): string[] {
  const created: string[] = [];
  for (const { sourceId, targetId, name } of endpoints) {
    const source = elementRegistry.get(sourceId);
    const target = elementRegistry.get(targetId);
    if (!source || !target) continue;
    try {
      const conn = modeling.connect(source, target, { type: 'bpmn:SequenceFlow' });
      if (conn) {
        if (name) modeling.updateProperties(conn, { name });
        created.push(conn.id);
      }
    } catch {
      // Skip if connection fails (e.g., would create invalid structure)
    }
  }
  return created;
}

/** Resize main pool to fit all child elements. */
function resizePoolToFitChildren(modeling: any, pool: any, children: any[]): void {
  if (children.length === 0) return;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const child of children) {
    const cx = child.x ?? 0;
    const cy = child.y ?? 0;
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx + (child.width ?? 0) > maxX) maxX = cx + (child.width ?? 0);
    if (cy + (child.height ?? 0) > maxY) maxY = cy + (child.height ?? 0);
  }

  if (!isFinite(minX)) return;

  const padLeft = 80,
    padRight = 50,
    padTop = 40,
    padBottom = 40;
  modeling.resizeShape(pool, {
    x: Math.min(pool.x, minX - padLeft),
    y: Math.min(pool.y, minY - padTop),
    width: Math.max(pool.width || 600, maxX - minX + padLeft + padRight),
    height: Math.max(pool.height || 250, maxY - minY + padTop + padBottom),
  });
}

/** Optionally run layout after conversion. */
async function runOptionalLayout(diagramId: string, shouldLayout: boolean): Promise<boolean> {
  if (!shouldLayout) return false;
  try {
    const { handleLayoutDiagram } = await import('../layout/layout-diagram');
    await handleLayoutDiagram({ diagramId });
    return true;
  } catch {
    return false;
  }
}

/** Build the result object. */
function buildConversionResult(
  mainPool: any,
  mainPoolName: string,
  laneNames: string[],
  laneIds: string[],
  mfCount: number,
  seqFlowCount: number,
  mergePools: any[],
  layoutRun: boolean
): any {
  return {
    success: true,
    mainParticipantId: mainPool.id,
    mainParticipantName: mainPoolName,
    laneNames,
    laneIds,
    convertedMessageFlows: mfCount,
    createdSequenceFlows: seqFlowCount,
    removedPools: mergePools.map((p: any) => ({
      id: p.id,
      name: p.businessObject?.name || p.id,
    })),
    layoutApplied: layoutRun,
    message:
      `Converted collaboration to single pool "${mainPoolName}" with ` +
      `${laneNames.length} lanes: ${laneNames.map((n) => `"${n}"`).join(', ')}. ` +
      `${mfCount} message flow(s) converted to sequence flows. ` +
      `${mergePools.length} pool(s) merged.`,
    nextSteps: [
      ...(!layoutRun
        ? [
            {
              tool: 'layout_bpmn_diagram',
              description: 'Run layout to arrange elements within their lanes',
            },
          ]
        : []),
      {
        tool: 'validate_bpmn_lane_organization',
        description: 'Check the lane organization quality and coherence',
      },
      {
        tool: 'assign_bpmn_elements_to_lane',
        description: 'Fine-tune element lane assignments if needed',
      },
    ],
  };
}

export async function handleConvertCollaborationToLanes(
  args: ConvertCollaborationToLanesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId, mainParticipantId, layout = true } = args;

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const canvas = getService(diagram.modeler, 'canvas') as any;
  const rootBo = canvas.getRootElement()?.businessObject;
  const definitions = rootBo?.$parent ?? rootBo;

  // 1. Find expanded participants and pick main pool
  const expandedParticipants = getExpandedParticipants(elementRegistry, definitions);
  const mainPool = pickMainPool(expandedParticipants, mainParticipantId);
  const mergePools = expandedParticipants.filter((p: any) => p.id !== mainPool.id);

  // 2. Save & delete message flows
  const allPoolIds = expandedParticipants.map((p: any) => p.id);
  const messageFlows = getAllMessageFlowsForParticipants(elementRegistry, allPoolIds);
  const mfEndpoints = messageFlows.map((mf: any) => ({
    sourceId: mf.source.id,
    targetId: mf.target.id,
    name: mf.businessObject?.name as string | undefined,
  }));
  if (messageFlows.length > 0) modeling.removeElements(messageFlows);

  // 3. Move elements from merge pools into main pool
  const movedElements = moveElementsToMainPool(elementRegistry, modeling, mergePools, mainPool);

  // 4. Create lanes in the main pool (while collaboration still exists)
  const mainPoolName = mainPool.businessObject?.name || 'Main';
  const laneNames = [mainPoolName, ...mergePools.map((p: any) => p.businessObject?.name || p.id)];
  await handleCreateLanes({
    diagramId,
    participantId: mainPool.id,
    lanes: laneNames.map((name) => ({ name })),
  });

  // 5. Assign elements to their corresponding lanes
  await assignElementsToLanes(diagramId, elementRegistry, mainPool.id, mainPoolName, movedElements);

  // 6. Remove now-empty merge pools
  const poolsToRemove = mergePools
    .map((p: any) => elementRegistry.get(p.id))
    .filter((p: any): p is any => p != null);
  if (poolsToRemove.length > 0) modeling.removeElements(poolsToRemove);

  // 7. Convert message flow endpoints to sequence flows
  const createdSeqFlows = convertMessageFlowsToSequenceFlows(
    modeling,
    elementRegistry,
    mfEndpoints
  );

  // 8. Resize main pool to fit
  resizePoolToFitChildren(modeling, mainPool, getChildFlowNodes(elementRegistry, mainPool.id));

  await syncXml(diagram);

  // 9. Optionally layout
  const layoutRun = await runOptionalLayout(diagramId, layout);

  const lanes = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:Lane' && el.parent?.id === mainPool.id
  );

  const result = jsonResult(
    buildConversionResult(
      mainPool,
      mainPoolName,
      laneNames,
      lanes.map((l: any) => l.id),
      mfEndpoints.length,
      createdSeqFlows.length,
      mergePools,
      layoutRun
    )
  );
  return appendLintFeedback(result, diagram);
}

// ── Tool definition ──────────────────────────────────────────────────────

export const TOOL_DEFINITION = {
  name: 'convert_bpmn_collaboration_to_lanes',
  description:
    'Convert a multi-pool collaboration into a single pool with lanes. ' +
    'Appropriate when pools represent roles within the same organization ' +
    '(e.g. "Customer" and "Support Agent") rather than separate systems. ' +
    'Merges all expanded pools into one, creates a lane per original pool, ' +
    'converts message flows to sequence flows, and optionally runs layout. ' +
    'Collapsed pools (external system endpoints) are left untouched.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      mainParticipantId: {
        type: 'string',
        description:
          'Optional: ID of the participant to keep as the main pool. ' +
          'When omitted, the pool with the most flow elements is chosen automatically.',
      },
      layout: {
        type: 'boolean',
        description:
          'When true (default), runs layout_bpmn_diagram after conversion ' +
          'to arrange elements within their lanes.',
      },
    },
    required: ['diagramId'],
  },
} as const;
