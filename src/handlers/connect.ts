/**
 * Handler for connect_bpmn_elements tool.
 */

import { type ConnectArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, jsonResult, syncXml, generateFlowId, validateArgs } from './helpers';
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
function resolveConnectionType(
  sourceType: string,
  targetType: string,
  requestedType: string | undefined,
  source?: any,
  target?: any
): { connectionType: string; autoHint?: string } {
  // Data objects/stores must use create_bpmn_data_association
  if (DATA_TYPES.has(sourceType) || DATA_TYPES.has(targetType)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Cannot create a SequenceFlow to/from ${DATA_TYPES.has(sourceType) ? sourceType : targetType}. ` +
        `Use the create_bpmn_data_association tool instead.`
    );
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
      source.businessObject.default = connection.businessObject;
    }
  }
}

export async function handleConnect(args: ConnectArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'sourceElementId', 'targetElementId']);
  const { diagramId, sourceElementId, targetElementId, label, conditionExpression, isDefault } =
    args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const source = elementRegistry.get(sourceElementId);
  const target = elementRegistry.get(targetElementId);
  if (!source) {
    throw new McpError(ErrorCode.InvalidRequest, `Source element not found: ${sourceElementId}`);
  }
  if (!target) {
    throw new McpError(ErrorCode.InvalidRequest, `Target element not found: ${targetElementId}`);
  }

  const sourceType: string = source.type || source.businessObject?.$type || '';
  const targetType: string = target.type || target.businessObject?.$type || '';

  const { connectionType, autoHint } = resolveConnectionType(
    sourceType,
    targetType,
    args.connectionType,
    source,
    target
  );

  const flowId = generateFlowId(
    elementRegistry,
    source.businessObject?.name,
    target.businessObject?.name,
    label
  );
  const connection = modeling.connect(source, target, { type: connectionType, id: flowId });

  applyConnectionProperties(
    diagram,
    connection,
    source,
    sourceType,
    connectionType,
    label,
    conditionExpression,
    isDefault
  );

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    connectionId: connection.id,
    connectionType,
    isDefault: isDefault || false,
    message: `Connected ${sourceElementId} to ${targetElementId}`,
    ...(autoHint ? { hint: autoHint } : {}),
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'connect_bpmn_elements',
  description:
    "Connect two BPMN elements with a sequence flow, message flow, or association. Supports optional condition expressions for gateway branches. Supports isDefault flag to mark a flow as the gateway's default flow. Generates descriptive flow IDs based on element names or labels.",
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      sourceElementId: {
        type: 'string',
        description: 'The ID of the source element',
      },
      targetElementId: {
        type: 'string',
        description: 'The ID of the target element',
      },
      label: {
        type: 'string',
        description: 'Optional label for the connection',
      },
      connectionType: {
        type: 'string',
        enum: ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association'],
        description: 'Type of connection (default: bpmn:SequenceFlow)',
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
    required: ['diagramId', 'sourceElementId', 'targetElementId'],
  },
} as const;
