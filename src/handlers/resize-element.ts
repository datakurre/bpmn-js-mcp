/**
 * Handler for resize_bpmn_element tool.
 *
 * Resizes an element (subprocess, participant, text annotation, etc.)
 * using the bpmn-js modeling API.
 */

import { type ToolResult } from '../types';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';

export interface ResizeElementArgs {
  diagramId: string;
  elementId: string;
  width: number;
  height: number;
}

export async function handleResizeElement(args: ResizeElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'width', 'height']);
  const { diagramId, elementId, width, height } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const element = requireElement(elementRegistry, elementId);

  // Calculate new bounds keeping the element's top-left position
  const newBounds = {
    x: element.x,
    y: element.y,
    width,
    height,
  };

  modeling.resizeShape(element, newBounds);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    newSize: { width, height },
    message: `Resized ${elementId} to ${width}×${height}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'resize_bpmn_element',
  description:
    'Resize an element (subprocess, participant, pool, text annotation, etc.) to the specified width and height. The top-left corner position is preserved.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to resize',
      },
      width: {
        type: 'number',
        description: 'New width in pixels',
      },
      height: {
        type: 'number',
        description: 'New height in pixels',
      },
    },
    required: ['diagramId', 'elementId', 'width', 'height'],
  },
} as const;
