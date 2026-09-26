/**
 * Handler for list_bpmn_diagrams tool.
 *
 * Merged tool that handles both listing all diagrams and summarizing
 * a specific diagram. When diagramId is provided, returns a detailed
 * summary; when omitted, lists all diagrams.
 */
// @readonly

import { type ToolResult } from '../../types';
import { getAllDiagrams } from '../../diagram-manager';
import { jsonResult, getVisibleElements, getService } from '../helpers';
import { handleSummarizeDiagram } from './summarize-diagram';
import { handleDiffDiagrams } from './diff-diagrams';

export async function handleListDiagrams(args?: any): Promise<ToolResult> {
  // If both diagramId and compareWith are provided, return a diff
  if (args?.diagramId && args?.compareWith) {
    return handleDiffDiagrams({ diagramIdA: args.diagramId, diagramIdB: args.compareWith });
  }

  // If diagramId is provided, delegate to summarize handler
  if (args?.diagramId) {
    return handleSummarizeDiagram(args);
  }

  const diagrams = getAllDiagrams();
  const list: any[] = [];

  for (const [id, state] of diagrams) {
    const elementRegistry = getService(state.modeler, 'elementRegistry');
    const elements = getVisibleElements(elementRegistry);
    list.push({
      id,
      name: state.name || '(unnamed)',
      elementCount: elements.length,
      draftMode: state.draftMode ?? false,
    });
  }

  return jsonResult({
    success: true,
    diagrams: list,
    count: list.length,
  });
}

export const TOOL_DEFINITION = {
  name: 'list_bpmn_diagrams',
  description:
    'List all diagrams or get a detailed summary of one. ' +
    'When called without diagramId, lists all diagrams in memory with their IDs, names, and element counts. ' +
    'When diagramId is provided, returns a lightweight summary: process name, element counts by type, ' +
    'participant/lane names, named elements, and connectivity stats. ' +
    'When both diagramId and compareWith are provided, returns a structured diff between the two diagrams ' +
    '(additions, removals, and changes).',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description:
          'Optional. When provided, returns a detailed summary of this specific diagram instead of listing all diagrams.',
      },
      compareWith: {
        type: 'string',
        description:
          'Optional. When provided alongside diagramId, returns a structured diff between diagramId (base) and compareWith (changed).',
      },
    },
  },
} as const;
