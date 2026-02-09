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

import { type ConnectArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateFlowId,
  validateArgs,
  fixConnectionId,
  buildElementCounts,
} from './helpers';
import { appendLintFeedback } from '../linter';

/** Types that must be connected via bpmn:Association, not SequenceFlow. */
const ANNOTATION_TYPES = new Set(['bpmn:TextAnnotation', 'bpmn:Group']);

/** Types that must be connected via DataAssociation (not SequenceFlow). */
const DATA_TYPES = new Set(['bpmn:DataObjectReference', 'bpmn:DataStoreReference']);

/**
 * Walk up the parent chain to find the owning Participant (pool).
 * Returns undefined if the element is not inside a Participant.
 */
function findParentParticipant(element: any): any {
  let current = element;
  while (current) {
    if (current.type === 'bpmn:Participant') return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Validate source/target types and auto-detect or correct connectionType.
 * Returns the resolved connectionType and an optional auto-correction hint.
 */
// eslint-disable-next-line complexity
function resolveConnectionType(
  sourceType: string,
  targetType: string,
  requestedType: string | undefined,
  source?: any,
  target?: any
): { connectionType: string; autoHint?: string } {
  // Data objects/stores → auto-detect DataInputAssociation / DataOutputAssociation
  if (DATA_TYPES.has(sourceType) || DATA_TYPES.has(targetType)) {
    // Let bpmn-js handle data association type detection
    return {
      connectionType: '__data_association__',
      autoHint:
        `Connection type auto-detected as DataAssociation ` +
        `(${DATA_TYPES.has(sourceType) ? sourceType : targetType} involved).`,
    };
  }

  // TextAnnotation / Group → auto-correct to Association
  if (!requestedType || requestedType === 'bpmn:SequenceFlow') {
    if (ANNOTATION_TYPES.has(sourceType) || ANNOTATION_TYPES.has(targetType)) {
      return {
        connectionType: 'bpmn:Association',
        autoHint:
          `Connection type auto-corrected to bpmn:Association ` +
          `(${ANNOTATION_TYPES.has(sourceType) ? sourceType : targetType} ` +
          `requires Association, not SequenceFlow).`,
      };
    }
  }

  // Cross-pool detection: auto-correct SequenceFlow → MessageFlow
  if (source && target) {
    const sourceParticipant = findParentParticipant(source);
    const targetParticipant = findParentParticipant(target);
    const crossPool =
      sourceParticipant && targetParticipant && sourceParticipant.id !== targetParticipant.id;

    if (crossPool && (!requestedType || requestedType === 'bpmn:SequenceFlow')) {
      return {
        connectionType: 'bpmn:MessageFlow',
        autoHint:
          `Connection type auto-corrected to bpmn:MessageFlow ` +
          `(source and target are in different participants: ` +
          `${sourceParticipant.businessObject?.name || sourceParticipant.id} / ` +
          `${targetParticipant.businessObject?.name || targetParticipant.id}).`,
      };
    }

    // Validate: MessageFlow must connect elements in different pools
    if (requestedType === 'bpmn:MessageFlow') {
      if (!crossPool) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `bpmn:MessageFlow requires source and target to be in different participants (pools). ` +
            `Both elements are in the same participant. Use bpmn:SequenceFlow for intra-pool connections.`
        );
      }
    }
  }

  return { connectionType: requestedType || 'bpmn:SequenceFlow' };
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
  const modeling = diagram.modeler.get('modeling');

  if (label) {
    modeling.updateProperties(connection, { name: label });
  }

  if (conditionExpression && connectionType === 'bpmn:SequenceFlow') {
    const moddle = diagram.modeler.get('moddle');
    const condExpr = moddle.create('bpmn:FormalExpression', { body: conditionExpression });
    modeling.updateProperties(connection, { conditionExpression: condExpr });
  }

  if (isDefault && connectionType === 'bpmn:SequenceFlow') {
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
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

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
  const elementIds = (args as any).elementIds as string[] | undefined;
  const sourceElementId = args.sourceElementId;
  const targetElementId = args.targetElementId;

  // Determine mode: chain or pair
  if (elementIds && Array.isArray(elementIds)) {
    if (elementIds.length < 2) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'elementIds must contain at least 2 element IDs to connect in sequence'
      );
    }
    return handleChainConnect(diagramId, elementIds);
  }

  // Pair mode requires sourceElementId + targetElementId
  validateArgs(args, ['diagramId', 'sourceElementId', 'targetElementId']);
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');

  const source = elementRegistry.get(sourceElementId);
  const target = elementRegistry.get(targetElementId);
  if (!source) {
    throw new McpError(ErrorCode.InvalidRequest, `Source element not found: ${sourceElementId}`);
  }
  if (!target) {
    throw new McpError(ErrorCode.InvalidRequest, `Target element not found: ${targetElementId}`);
  }

  const { connection, connectionType, autoHint } = connectPair(diagram, source, target, {
    connectionType: args.connectionType,
    label,
    conditionExpression,
    isDefault,
  });

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    connectionId: connection.id,
    connectionType,
    isDefault: isDefault || false,
    diagramCounts: buildElementCounts(elementRegistry),
    message: `Connected ${sourceElementId} to ${targetElementId}`,
    ...(autoHint ? { hint: autoHint } : {}),
  });
  return appendLintFeedback(result, diagram);
}

/**
 * Chain mode: connect a list of elements sequentially (former auto_connect).
 */
async function handleChainConnect(diagramId: string, elementIds: string[]): Promise<ToolResult> {
  if (elementIds.length < 2) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'elementIds must contain at least 2 element IDs to connect in sequence'
    );
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const connections: Array<{ connectionId: string; source: string; target: string }> = [];

  for (let i = 0; i < elementIds.length - 1; i++) {
    const sourceId = elementIds[i];
    const targetId = elementIds[i + 1];

    const source = elementRegistry.get(sourceId);
    const target = elementRegistry.get(targetId);

    if (!source) {
      throw new McpError(ErrorCode.InvalidRequest, `Element not found: ${sourceId}`);
    }
    if (!target) {
      throw new McpError(ErrorCode.InvalidRequest, `Element not found: ${targetId}`);
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

export const TOOL_DEFINITION = {
  name: 'connect_bpmn_elements',
  description:
    "Connect BPMN elements. Supports pair mode (sourceElementId + targetElementId) or chain mode (elementIds array for sequential connections). Auto-detects connection type: SequenceFlow for normal flow, MessageFlow for cross-pool, Association for text annotations, and DataAssociation for data objects/stores. Supports optional condition expressions for gateway branches and isDefault flag for gateway default flows. To modify an existing connection's label or condition after creation, use set_bpmn_element_properties with the connection's ID.",
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      sourceElementId: {
        type: 'string',
        description: 'The ID of the source element (pair mode)',
      },
      targetElementId: {
        type: 'string',
        description: 'The ID of the target element (pair mode)',
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description:
          'Ordered list of element IDs to connect sequentially (chain mode). When provided, sourceElementId and targetElementId are ignored.',
      },
      label: {
        type: 'string',
        description: 'Optional label for the connection',
      },
      connectionType: {
        type: 'string',
        enum: ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association'],
        description:
          'Type of connection (default: auto-detected). Usually not needed — the tool auto-detects the correct type.',
      },
      conditionExpression: {
        type: 'string',
        description:
          "Optional condition expression for sequence flows leaving gateways (e.g. '${approved == true}')",
      },
      isDefault: {
        type: 'boolean',
        description:
          "When connecting from an exclusive/inclusive gateway, set this flow as the gateway's default flow (taken when no condition matches).",
      },
    },
    required: ['diagramId'],
  },
} as const;
