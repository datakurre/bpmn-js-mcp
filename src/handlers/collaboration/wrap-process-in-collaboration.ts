/**
 * Handler for wrap_bpmn_process_in_collaboration tool.
 *
 * Migrates an existing process into a collaboration by wrapping it inside
 * a participant pool — without duplicating flow nodes.  This solves the
 * common failure mode where agents re-add elements when trying to create
 * a collaboration from an existing process.
 */

import { type ToolResult } from '../../types';
import { semanticViolationError } from '../../errors';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { ELEMENT_SIZES } from '../../constants';

export interface WrapProcessInCollaborationArgs {
  diagramId: string;
  /** Name for the main participant pool that wraps the existing process. */
  participantName: string;
  /** Optional additional collapsed (partner) pools. */
  additionalParticipants?: Array<{
    name: string;
    collapsed?: boolean;
  }>;
}

/** Height of a collapsed participant pool. */
const COLLAPSED_POOL_HEIGHT = 60;

/** BPMN participant type constant. */
const BPMN_PARTICIPANT = 'bpmn:Participant';

/** BPMN types that are excluded from the flow-node bounding box calculation. */
const EXCLUDED_TYPES = new Set([
  'bpmn:Process',
  'bpmn:Collaboration',
  'label',
  BPMN_PARTICIPANT,
  'bpmn:Lane',
  'bpmn:TextAnnotation',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:Group',
]);

/** Check if a type string contains any flow/association substring. */
function isFlowOrAssociation(type: string | undefined): boolean {
  if (!type) return false;
  return (
    type.includes('SequenceFlow') ||
    type.includes('MessageFlow') ||
    type.includes('Association') ||
    type.includes('DataAssociation')
  );
}

/** Find all visible flow nodes (tasks, events, gateways, subprocesses). */
function findFlowNodes(elementRegistry: any): any[] {
  return elementRegistry.filter(
    (el: any) => !EXCLUDED_TYPES.has(el.type) && !isFlowOrAssociation(el.type)
  );
}

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Compute the bounding box of a set of elements. */
function computeBoundingBox(nodes: any[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    if (nx < minX) minX = nx;
    if (ny < minY) minY = ny;
    if (nx + (node.width ?? 0) > maxX) maxX = nx + (node.width ?? 0);
    if (ny + (node.height ?? 0) > maxY) maxY = ny + (node.height ?? 0);
  }

  // Default pool size if no elements exist
  if (!isFinite(minX)) {
    return { minX: 100, minY: 100, maxX: 700, maxY: 350 };
  }
  return { minX, minY, maxX, maxY };
}

/** Create additional partner pools below the main pool. */
function createPartnerPools(
  diagram: any,
  additionalParticipants: Array<{ name: string; collapsed?: boolean }>,
  poolX: number,
  poolWidth: number,
  startY: number
): string[] {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const canvas = getService(diagram.modeler, 'canvas') as any;

  const ids: string[] = [];
  let currentY = startY;

  for (const p of additionalParticipants) {
    const pHeight =
      p.collapsed !== false ? COLLAPSED_POOL_HEIGHT : ELEMENT_SIZES.participant.height;
    const pId = generateDescriptiveId(elementRegistry, BPMN_PARTICIPANT, p.name);
    const pAttrs: Record<string, any> = { type: BPMN_PARTICIPANT, id: pId };
    if (p.collapsed !== false) pAttrs.isExpanded = false;

    const pShape = elementFactory.createShape(pAttrs);
    pShape.width = poolWidth;
    pShape.height = pHeight;

    const root = canvas.getRootElement();
    const pCreated = modeling.createShape(
      pShape,
      { x: poolX + poolWidth / 2, y: currentY + pHeight / 2 },
      root
    );
    modeling.updateProperties(pCreated, { name: p.name });
    if (p.collapsed !== false && pCreated.di) {
      (pCreated.di as any).isExpanded = false;
    }

    modeling.resizeShape(pCreated, {
      x: poolX,
      y: currentY,
      width: poolWidth,
      height: pHeight,
    });

    ids.push(pCreated.id);
    currentY += pHeight + 30;
  }

  return ids;
}

interface PoolDimensions {
  poolX: number;
  poolY: number;
  poolWidth: number;
  poolHeight: number;
}

/** Compute main pool dimensions from element bounding box. */
function computePoolDimensions(bbox: BoundingBox): PoolDimensions {
  const paddingLeft = 80; // Extra for pool header
  const paddingRight = 50;
  const paddingTop = 40;
  const paddingBottom = 40;
  return {
    poolX: bbox.minX - paddingLeft,
    poolY: bbox.minY - paddingTop,
    poolWidth: Math.max(
      ELEMENT_SIZES.participant.width,
      bbox.maxX - bbox.minX + paddingLeft + paddingRight
    ),
    poolHeight: Math.max(
      ELEMENT_SIZES.participant.height,
      bbox.maxY - bbox.minY + paddingTop + paddingBottom
    ),
  };
}

/** Create the main participant shape wrapping the existing process. */
function createMainParticipant(
  diagram: any,
  participantName: string,
  dims: PoolDimensions
): string {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const canvas = getService(diagram.modeler, 'canvas') as any;

  const mainPoolId = generateDescriptiveId(elementRegistry, BPMN_PARTICIPANT, participantName);
  const shape = elementFactory.createShape({ type: BPMN_PARTICIPANT, id: mainPoolId });
  shape.width = dims.poolWidth;
  shape.height = dims.poolHeight;

  const created = modeling.createShape(
    shape,
    { x: dims.poolX + dims.poolWidth / 2, y: dims.poolY + dims.poolHeight / 2 },
    canvas.getRootElement()
  );
  modeling.updateProperties(created, { name: participantName });

  const participant = elementRegistry.get(created.id) || created;
  modeling.resizeShape(participant, {
    x: dims.poolX,
    y: dims.poolY,
    width: dims.poolWidth,
    height: dims.poolHeight,
  });
  return participant.id;
}

export async function handleWrapProcessInCollaboration(
  args: WrapProcessInCollaborationArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'participantName']);
  const { diagramId, participantName, additionalParticipants = [] } = args;

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // Check that this is a plain process (no collaboration yet)
  const existing = elementRegistry.filter((el: any) => el.type === BPMN_PARTICIPANT);
  if (existing.length > 0) {
    throw semanticViolationError(
      'Diagram already contains participants. Use create_bpmn_collaboration for adding more pools, ' +
        'or delete existing participants first.'
    );
  }

  const flowNodes = findFlowNodes(elementRegistry);
  const dims = computePoolDimensions(computeBoundingBox(flowNodes));

  const mainId = createMainParticipant(diagram, participantName, dims);
  const createdIds = [mainId];

  // Add additional partner pools below
  if (additionalParticipants.length > 0) {
    const partnerIds = createPartnerPools(
      diagram,
      additionalParticipants,
      dims.poolX,
      dims.poolWidth,
      dims.poolY + dims.poolHeight + 30
    );
    createdIds.push(...partnerIds);
  }

  await syncXml(diagram);

  const hasPartners = additionalParticipants.length > 0;
  const result = jsonResult({
    success: true,
    participantIds: createdIds,
    mainParticipantId: mainId,
    message:
      `Wrapped existing process in collaboration. Main pool: "${participantName}" (${mainId}).` +
      (hasPartners ? ` Added ${additionalParticipants.length} additional participant(s).` : ''),
    existingElementCount: flowNodes.length,
    nextSteps: [
      ...(hasPartners
        ? [
            {
              tool: 'connect_bpmn_elements',
              description:
                'Create message flows between the main pool elements and collapsed partner pools',
            },
          ]
        : []),
      {
        tool: 'create_bpmn_lanes',
        description: 'Add lanes (swimlanes) to the main participant pool for role separation',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'wrap_bpmn_process_in_collaboration',
  description:
    'Migrate an existing process into a collaboration by wrapping it in a participant pool. ' +
    'This preserves all existing flow nodes and connections — no elements are duplicated. ' +
    'Optionally adds collapsed partner pools for message flow documentation. ' +
    'Use this instead of manually creating a collaboration when you already have a process ' +
    'with tasks and flows. The diagram must not already contain participants.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participantName: {
        type: 'string',
        description: 'Name for the main participant pool that wraps the existing process',
      },
      additionalParticipants: {
        type: 'array',
        description:
          'Optional additional participant pools (typically collapsed partner pools for message flow documentation)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Participant/pool name' },
            collapsed: {
              type: 'boolean',
              description:
                'If true (default), creates a collapsed pool. Set to false for an expanded pool.',
            },
          },
          required: ['name'],
        },
      },
    },
    required: ['diagramId', 'participantName'],
  },
} as const;
