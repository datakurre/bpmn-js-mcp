/**
 * Handler for delete_bpmn_element tool.
 *
 * Supports both single element deletion (elementId) and bulk deletion
 * (elementIds array) to avoid repeated round-trips.
 */

import { type DeleteElementArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, buildElementCounts } from './helpers';
import { appendLintFeedback } from '../linter';

export async function handleDeleteElement(args: DeleteElementArgs): Promise<ToolResult> {
  const { diagramId, elementId } = args;
  const elementIds = (args as any).elementIds as string[] | undefined;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  // Bulk deletion mode
  if (elementIds && Array.isArray(elementIds) && elementIds.length > 0) {
    const elements: any[] = [];
    const notFound: string[] = [];
    for (const id of elementIds) {
      const el = elementRegistry.get(id);
      if (el) {
        elements.push(el);
      } else {
        notFound.push(id);
      }
    }

    if (elements.length === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `None of the specified elements were found: ${elementIds.join(', ')}`
      );
    }

    modeling.removeElements(elements);
    await syncXml(diagram);

    const result = jsonResult({
      success: true,
      deletedCount: elements.length,
      deletedIds: elements.map((el: any) => el.id),
      ...(notFound.length > 0
        ? { notFound, warning: `${notFound.length} element(s) not found` }
        : {}),
      diagramCounts: buildElementCounts(elementRegistry),
      message: `Removed ${elements.length} element(s) from diagram`,
    });
    return appendLintFeedback(result, diagram);
  }

  // Single element deletion (backward compatible)
  if (!elementId) {
    throw new McpError(ErrorCode.InvalidParams, 'Either elementId or elementIds must be provided');
  }

  const element = requireElement(elementRegistry, elementId);
  modeling.removeElements([element]);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    diagramCounts: buildElementCounts(elementRegistry),
    message: `Removed element ${elementId} from diagram`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'delete_bpmn_element',
  description:
    'Remove one or more elements or connections from a BPMN diagram. ' +
    'Supports single deletion via elementId or bulk deletion via elementIds array.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element or connection to remove (single mode)',
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Array of element/connection IDs to remove in a single call (bulk mode). ' +
          'When provided, elementId is ignored.',
      },
    },
    required: ['diagramId'],
  },
} as const;
