/**
 * Handler for auto_connect_bpmn_elements tool.
 *
 * Given a list of element IDs in sequence, create all connections in order.
 * Reduces N-1 separate `connect_bpmn_elements` calls to a single tool call.
 */

import { type AutoConnectArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, jsonResult, syncXml, generateFlowId, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';

export async function handleAutoConnect(args: AutoConnectArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementIds']);
  const { diagramId, elementIds } = args;

  if (!Array.isArray(elementIds) || elementIds.length < 2) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'elementIds must contain at least 2 element IDs to connect in sequence'
    );
  }

  const diagram = requireDiagram(diagramId);
  const modeling = diagram.modeler.get('modeling');
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

    const flowId = generateFlowId(
      elementRegistry,
      source.businessObject?.name,
      target.businessObject?.name
    );

    const connection = modeling.connect(source, target, {
      type: 'bpmn:SequenceFlow',
      id: flowId,
    });

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
    message: `Created ${connections.length} sequential connection(s) between ${elementIds.length} elements`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'auto_connect_bpmn_elements',
  description:
    'Connect a list of BPMN elements in sequence with a single call. Given element IDs [A, B, C], creates SequenceFlows A→B and B→C. Reduces N-1 separate connect_bpmn_elements calls to one.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description: 'Ordered list of element IDs to connect sequentially. Minimum 2 elements.',
      },
    },
    required: ['diagramId', 'elementIds'],
  },
} as const;
