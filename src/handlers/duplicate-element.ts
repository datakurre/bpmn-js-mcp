/**
 * Handler for duplicate_bpmn_element tool.
 *
 * Copies an element with its properties and places it at an offset position.
 */

import { type DuplicateElementArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
} from './helpers';
import { appendLintFeedback } from '../linter';

/** Default offset from the original element when duplicating. */
const DUPLICATE_OFFSET = { x: 50, y: 50 };

// eslint-disable-next-line complexity
export async function handleDuplicateElement(args: DuplicateElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, offsetX = DUPLICATE_OFFSET.x, offsetY = DUPLICATE_OFFSET.y } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementFactory = diagram.modeler.get('elementFactory');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const original = requireElement(elementRegistry, elementId);

  const originalType: string = original.type || original.businessObject?.$type;
  const originalName: string = original.businessObject?.name || '';

  // Don't allow duplicating infrastructure elements
  if (
    originalType === 'bpmn:Process' ||
    originalType === 'bpmn:Collaboration' ||
    originalType === 'bpmn:Participant'
  ) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Cannot duplicate ${originalType} — use create_bpmn_collaboration for pools`
    );
  }

  // Generate a descriptive ID for the copy
  const copyName = originalName ? `${originalName} (copy)` : '';
  const descriptiveId = generateDescriptiveId(elementRegistry, originalType, copyName || undefined);

  // Create the new shape
  const shape = elementFactory.createShape({ type: originalType, id: descriptiveId });

  // Position relative to original
  const newX = original.x + (original.width || 0) / 2 + offsetX;
  const newY = original.y + (original.height || 0) / 2 + offsetY;

  // Find the parent container
  const parent = original.parent;
  if (!parent) {
    throw new McpError(ErrorCode.InternalError, 'Original element has no parent');
  }

  const createdElement = modeling.createShape(shape, { x: newX, y: newY }, parent);

  // Copy common properties from the original business object
  const propsToSet: Record<string, any> = {};
  if (originalName) {
    propsToSet.name = copyName;
  }
  // Copy camunda extension attributes
  const bo = original.businessObject;
  if (bo?.$attrs) {
    const camundaAttrs = Object.entries(bo.$attrs).filter(([key]) => key.startsWith('camunda:'));
    for (const [key, value] of camundaAttrs) {
      propsToSet[key] = value;
    }
  }

  if (Object.keys(propsToSet).length > 0) {
    modeling.updateProperties(createdElement, propsToSet);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    originalElementId: elementId,
    newElementId: createdElement.id,
    elementType: originalType,
    name: copyName || undefined,
    position: { x: newX, y: newY },
    message: `Duplicated ${originalType} '${originalName || elementId}' → ${createdElement.id}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'duplicate_bpmn_element',
  description:
    'Duplicate an existing BPMN element within the same diagram. Copies the element type, name, and camunda properties, placing the copy at an offset from the original. Connections are not copied.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      elementId: {
        type: 'string',
        description: 'The ID of the element to duplicate',
      },
      offsetX: {
        type: 'number',
        description: 'Horizontal offset from the original (default: 50)',
      },
      offsetY: {
        type: 'number',
        description: 'Vertical offset from the original (default: 50)',
      },
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
