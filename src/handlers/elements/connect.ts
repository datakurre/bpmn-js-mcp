/**
 * Handler for connect_bpmn_elements tool.
 *
 * Merges the former connect_bpmn_elements, create_bpmn_data_association,
 * and auto_connect_bpmn_elements tools into one.
 *
 * - Pair mode: sourceElementId + targetElementId (original connect)
 * - Chain mode: elementIds array (former auto_connect)
 * - Data associations: auto-detected when source/target is a data object/store
 */
// @mutating

import { type ToolResult } from '../../types';
import type { BpmnElement } from '../../bpmn-types';
import {
  elementNotFoundError,
  illegalCombinationError,
  semanticViolationError,
} from '../../errors';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateFlowId,
  validateArgs,
  fixConnectionId,
  buildElementCounts,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { handleLayoutDiagram } from '../layout/layout-diagram';

/** BPMN connection type constants. */
const BPMN_SEQUENCE_FLOW_TYPE = 'bpmn:SequenceFlow';
const BPMN_MESSAGE_FLOW_TYPE = 'bpmn:MessageFlow';
const BPMN_ASSOCIATION_TYPE = 'bpmn:Association';
const BPMN_FORMAL_EXPRESSION_TYPE = 'bpmn:FormalExpression';

export interface ConnectArgs {
  diagramId: string;
  sourceElementId?: string;
  targetElementId?: string;
  /** Ordered list of element IDs to connect sequentially (chain mode). */
  elementIds?: string[];
  label?: string;
  connectionType?: string;
  conditionExpression?: string;
  isDefault?: boolean;
  /** When true, run layout_bpmn_diagram automatically after connecting. Default: false. */
  autoLayout?: boolean;
}

/** Types that must be connected via bpmn:Association, not SequenceFlow. */
const ANNOTATION_TYPES = new Set(['bpmn:TextAnnotation', 'bpmn:Group']);

/** Types that must be connected via DataAssociation (not SequenceFlow). */
const DATA_TYPES = new Set(['bpmn:DataObjectReference', 'bpmn:DataStoreReference']);

/**
 * Walk up the parent chain to find the owning Participant (pool).
 * Returns undefined if the element is not inside a Participant.
 */
function findParentParticipant(element: BpmnElement): BpmnElement | undefined {
  let current: BpmnElement | undefined = element;
  while (current) {
    if (current.type === 'bpmn:Participant') return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Check whether source and target are in different pools (cross-pool).
 * Returns the resolved type + hint, or undefined to keep resolving.
 */
function resolveCrossPool(
  source: any,
  target: any,
  requestedType: string | undefined
): { connectionType: string; autoHint?: string } | undefined {
  const sourceParticipant = findParentParticipant(source);
  const targetParticipant = findParentParticipant(target);
  const crossPool =
    sourceParticipant && targetParticipant && sourceParticipant.id !== targetParticipant.id;

  if (crossPool && (!requestedType || requestedType === BPMN_SEQUENCE_FLOW_TYPE)) {
    return {
      connectionType: BPMN_MESSAGE_FLOW_TYPE,
      autoHint:
        `Connection type auto-corrected to bpmn:MessageFlow ` +
        `(source and target are in different participants: ` +
        `${sourceParticipant.businessObject?.name || sourceParticipant.id} / ` +
        `${targetParticipant.businessObject?.name || targetParticipant.id}).`,
    };
  }

  if (requestedType === BPMN_MESSAGE_FLOW_TYPE && !crossPool) {
    throw semanticViolationError(
      `bpmn:MessageFlow requires source and target to be in different participants (pools). ` +
        `Both elements are in the same participant. Use bpmn:SequenceFlow for intra-pool connections.`
    );
  }

  return undefined;
}

/**
 * Validate source/target types and auto-detect or correct connectionType.
 * Returns the resolved connectionType and an optional auto-correction hint.
 */
function resolveConnectionType(
  sourceType: string,
  targetType: string,
  requestedType: string | undefined,
  source?: any,
  target?: any
): { connectionType: string; autoHint?: string } {
  // Data objects/stores → auto-detect DataInputAssociation / DataOutputAssociation
  if (DATA_TYPES.has(sourceType) || DATA_TYPES.has(targetType)) {
    return {
      connectionType: '__data_association__',
      autoHint:
        `Connection type auto-detected as DataAssociation ` +
        `(${DATA_TYPES.has(sourceType) ? sourceType : targetType} involved).`,
    };
  }

  // TextAnnotation / Group → auto-correct to Association
  if (!requestedType || requestedType === BPMN_SEQUENCE_FLOW_TYPE) {
    if (ANNOTATION_TYPES.has(sourceType) || ANNOTATION_TYPES.has(targetType)) {
      return {
        connectionType: BPMN_ASSOCIATION_TYPE,
        autoHint:
          `Connection type auto-corrected to bpmn:Association ` +
          `(${ANNOTATION_TYPES.has(sourceType) ? sourceType : targetType} ` +
          `requires Association, not SequenceFlow).`,
      };
    }
  }

  // Cross-pool detection
  if (source && target) {
    const crossPoolResult = resolveCrossPool(source, target, requestedType);
    if (crossPoolResult) return crossPoolResult;
  }

  return { connectionType: requestedType || BPMN_SEQUENCE_FLOW_TYPE };
}

/**
 * Apply post-creation properties (label, condition, default flow).
 */
function applyConnectionProperties(
  diagram: ReturnType<typeof requireDiagram>,
  connection: any,
  source: any,
  sourceType: string,
  connectionType: string,
  label?: string,
  conditionExpression?: string,
  isDefault?: boolean
): void {
  const modeling = getService(diagram.modeler, 'modeling');

  if (label) {
    modeling.updateProperties(connection, { name: label });
  }

  if (conditionExpression && connectionType === BPMN_SEQUENCE_FLOW_TYPE) {
    const moddle = getService(diagram.modeler, 'moddle');
    const condExpr = moddle.create(BPMN_FORMAL_EXPRESSION_TYPE, { body: conditionExpression });
    modeling.updateProperties(connection, { conditionExpression: condExpr });
  }

  if (isDefault && connectionType === BPMN_SEQUENCE_FLOW_TYPE) {
    if (sourceType.includes('ExclusiveGateway') || sourceType.includes('InclusiveGateway')) {
      modeling.updateModdleProperties(source, source.businessObject, {
        default: connection.businessObject,
      });
    }
  }
}

/**
 * Connect a single pair of elements. Used by both pair mode and chain mode.
 */
function connectPair(
  diagram: ReturnType<typeof requireDiagram>,
  source: any,
  target: any,
  opts: {
    connectionType?: string;
    label?: string;
    conditionExpression?: string;
    isDefault?: boolean;
  }
): { connection: any; connectionType: string; autoHint?: string } {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const sourceType: string = source.type || source.businessObject?.$type || '';
  const targetType: string = target.type || target.businessObject?.$type || '';

  const { connectionType, autoHint } = resolveConnectionType(
    sourceType,
    targetType,
    opts.connectionType,
    source,
    target
  );

  let connection: any;
  if (connectionType === '__data_association__') {
    // Data association — let bpmn-js auto-detect direction
    connection = modeling.connect(source, target);
  } else {
    const flowId = generateFlowId(
      elementRegistry,
      source.businessObject?.name,
      target.businessObject?.name,
      opts.label
    );
    connection = modeling.connect(source, target, { type: connectionType, id: flowId });
    fixConnectionId(connection, flowId);
  }

  if (connectionType !== '__data_association__') {
    applyConnectionProperties(
      diagram,
      connection,
      source,
      sourceType,
      connectionType,
      opts.label,
      opts.conditionExpression,
      opts.isDefault
    );
  }

  const actualType =
    connectionType === '__data_association__'
      ? connection.type || connection.businessObject?.$type || 'DataAssociation'
      : connectionType;

  return { connection, connectionType: actualType, autoHint };
}

export async function handleConnect(args: ConnectArgs): Promise<ToolResult> {
  const { diagramId, label, conditionExpression, isDefault } = args;
  const { elementIds, sourceElementId, targetElementId } = args;

  // Determine mode: chain or pair
  if (elementIds && Array.isArray(elementIds)) {
    if (elementIds.length < 2) {
      throw illegalCombinationError(
        'elementIds must contain at least 2 element IDs to connect in sequence',
        ['elementIds']
      );
    }
    return handleChainConnect(diagramId, elementIds);
  }

  // Pair mode requires sourceElementId + targetElementId
  validateArgs(args, ['diagramId', 'sourceElementId', 'targetElementId']);
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const source = elementRegistry.get(sourceElementId!);
  const target = elementRegistry.get(targetElementId!);
  if (!source) {
    throw elementNotFoundError(sourceElementId!);
  }
  if (!target) {
    throw elementNotFoundError(targetElementId!);
  }

  const { connection, connectionType, autoHint } = connectPair(diagram, source, target, {
    connectionType: args.connectionType,
    label,
    conditionExpression,
    isDefault,
  });

  await syncXml(diagram);

  if (args.autoLayout) {
    await handleLayoutDiagram({ diagramId });
  }

  const result = jsonResult({
    success: true,
    connectionId: connection.id,
    connectionType,
    isDefault: isDefault || false,
    diagramCounts: buildElementCounts(elementRegistry),
    message: `Connected ${sourceElementId} to ${targetElementId}`,
    ...(autoHint ? { hint: autoHint } : {}),
    nextSteps: [
      {
        tool: 'layout_bpmn_diagram',
        description:
          'Arrange elements automatically after connecting — especially useful after multiple connections',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

/**
 * Chain mode: connect a list of elements sequentially (former auto_connect).
 */
async function handleChainConnect(diagramId: string, elementIds: string[]): Promise<ToolResult> {
  if (elementIds.length < 2) {
    throw illegalCombinationError(
      'elementIds must contain at least 2 element IDs to connect in sequence',
      ['elementIds']
    );
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const connections: Array<{ connectionId: string; source: string; target: string }> = [];

  for (let i = 0; i < elementIds.length - 1; i++) {
    const sourceId = elementIds[i];
    const targetId = elementIds[i + 1];

    const source = elementRegistry.get(sourceId);
    const target = elementRegistry.get(targetId);

    if (!source) {
      throw elementNotFoundError(sourceId);
    }
    if (!target) {
      throw elementNotFoundError(targetId);
    }

    const { connection } = connectPair(diagram, source, target, {});

    connections.push({
      connectionId: connection.id,
      source: sourceId,
      target: targetId,
    });
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    connectionsCreated: connections.length,
    connections,
    diagramCounts: buildElementCounts(elementRegistry),
    message: `Created ${connections.length} sequential connection(s) between ${elementIds.length} elements`,
    nextSteps: [
      {
        tool: 'layout_bpmn_diagram',
        description:
          'Arrange elements automatically after connecting — especially useful after multiple connections',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

// Backward-compatible aliases
export const handleAutoConnect = handleConnect;
export function handleCreateDataAssociation(args: any): Promise<ToolResult> {
  return handleConnect({
    diagramId: args.diagramId,
    sourceElementId: args.sourceElementId,
    targetElementId: args.targetElementId,
  });
}

// Schema extracted to connect-schema.ts to stay under max-lines.
export { TOOL_DEFINITION } from './connect-schema';
