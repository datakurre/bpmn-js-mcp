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
  getService,
} from './helpers';
import { appendLintFeedback } from '../linter';

/** Default offset from the original element when duplicating. */
const DUPLICATE_OFFSET = { x: 50, y: 50 };

/** Types that cannot be duplicated via this tool. */
const NON_DUPLICATABLE = new Set(['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Participant']);

/** Copy name and camunda:* extension attributes from an original business object. */
function buildCopyProperties(bo: any, copyName: string): Record<string, any> {
  const props: Record<string, any> = {};
  if (copyName) props.name = copyName;
  if (bo?.$attrs) {
    for (const [key, value] of Object.entries(bo.$attrs)) {
      if (key.startsWith('camunda:')) props[key] = value;
    }
  }
  return props;
}

export async function handleDuplicateElement(args: DuplicateElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, offsetX = DUPLICATE_OFFSET.x, offsetY = DUPLICATE_OFFSET.y } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = getService(diagram.modeler, 'modeling');
  const elementFactory = getService(diagram.modeler, 'elementFactory');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const original = requireElement(elementRegistry, elementId);

  const originalType: string = original.type || original.businessObject?.$type;
  const originalName: string = original.businessObject?.name || '';

  if (NON_DUPLICATABLE.has(originalType)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Cannot duplicate ${originalType} — use create_bpmn_collaboration for pools`
    );
  }

  const copyName = originalName ? `${originalName} (copy)` : '';
  const descriptiveId = generateDescriptiveId(elementRegistry, originalType, copyName || undefined);
  const shape = elementFactory.createShape({ type: originalType, id: descriptiveId });

  const newX = original.x + (original.width || 0) / 2 + offsetX;
  const newY = original.y + (original.height || 0) / 2 + offsetY;

  const parent = original.parent;
  if (!parent) {
    throw new McpError(ErrorCode.InternalError, 'Original element has no parent');
  }

  const createdElement = modeling.createShape(shape, { x: newX, y: newY }, parent);

  const propsToSet = buildCopyProperties(original.businessObject, copyName);
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
