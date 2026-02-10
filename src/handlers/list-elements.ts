/**
 * Handler for list_bpmn_elements tool.
 *
 * When no filters are given, returns all elements (backward-compatible).
 * Optional filters (namePattern, elementType, property) allow searching
 * within the same tool — merges the former search_bpmn_elements tool.
 */

import { type ToolResult } from '../types';
import { requireDiagram, jsonResult, getVisibleElements, validateArgs } from './helpers';

export interface ListElementsArgs {
  diagramId: string;
  namePattern?: string;
  elementType?: string;
  property?: { key: string; value?: string };
}

/** Extract camunda:* attributes from a business object, if any. */
function extractCamundaAttrs(bo: any): Record<string, any> | undefined {
  if (!bo?.$attrs) return undefined;
  const attrs: Record<string, any> = {};
  for (const [key, value] of Object.entries(bo.$attrs)) {
    if (key.startsWith('camunda:')) attrs[key] = value;
  }
  if (Object.keys(attrs).length === 0) return undefined;
  return attrs;
}

/** Convert a registry element to a serialisable list entry. */
function mapElementToEntry(el: any): Record<string, any> {
  const entry: Record<string, any> = {
    id: el.id,
    type: el.type,
    name: el.businessObject?.name || '(unnamed)',
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
  };

  if (el.type === 'bpmn:BoundaryEvent') {
    const hostId = el.host?.id || el.businessObject?.attachedToRef?.id;
    if (hostId) entry.attachedToRef = hostId;
  }

  if (el.incoming?.length) entry.incoming = el.incoming.map((c: any) => c.id);
  if (el.outgoing?.length) entry.outgoing = el.outgoing.map((c: any) => c.id);

  if (el.source) entry.sourceId = el.source.id;
  if (el.target) entry.targetId = el.target.id;
  if (el.waypoints && el.waypoints.length > 0) {
    entry.waypoints = el.waypoints.map((wp: any) => ({ x: wp.x, y: wp.y }));
  }

  const camundaAttrs = extractCamundaAttrs(el.businessObject);
  if (camundaAttrs) entry.camundaProperties = camundaAttrs;

  return entry;
}

/** Filter elements by a property key/value constraint. */
function filterByProperty(elements: any[], property: { key: string; value?: string }): any[] {
  return elements.filter((el: any) => {
    const bo = el.businessObject;
    if (!bo) return false;

    const key = property.key;
    let val: any;
    if (key.startsWith('camunda:')) {
      val = bo.$attrs?.[key] ?? bo[key];
    } else {
      val = bo[key];
    }

    if (val === undefined) return false;
    if (property.value === undefined) return true;
    return String(val) === property.value;
  });
}

export async function handleListElements(args: ListElementsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId, namePattern, elementType, property } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  let elements = getVisibleElements(elementRegistry);

  const hasFilters = !!(namePattern || elementType || property);

  // Filter by element type
  if (elementType) {
    elements = elements.filter((el: any) => el.type === elementType);
  }

  // Filter by name pattern (case-insensitive regex)
  if (namePattern) {
    const regex = new RegExp(namePattern, 'i');
    elements = elements.filter((el: any) => regex.test(el.businessObject?.name || ''));
  }

  // Filter by property key/value
  if (property) {
    elements = filterByProperty(elements, property);
  }

  const elementList = elements.map(mapElementToEntry);

  return jsonResult({
    success: true,
    elements: elementList,
    count: elementList.length,
    ...(hasFilters
      ? {
          filters: {
            ...(namePattern ? { namePattern } : {}),
            ...(elementType ? { elementType } : {}),
            ...(property ? { property } : {}),
          },
        }
      : {}),
  });
}

export const TOOL_DEFINITION = {
  name: 'list_bpmn_elements',
  description:
    'List elements in a BPMN diagram with their types, names, positions, connections, and properties. Supports optional filters to search by name pattern, element type, or property value. When no filters are given, returns all elements.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      namePattern: {
        type: 'string',
        description:
          'Regular expression pattern to match against element names (case-insensitive). Only matching elements are returned.',
      },
      elementType: {
        type: 'string',
        description:
          "BPMN element type to filter by (e.g. 'bpmn:UserTask', 'bpmn:ExclusiveGateway')",
      },
      property: {
        type: 'object',
        description: 'Filter by a specific property key and optional value',
        properties: {
          key: {
            type: 'string',
            description: "Property key to check (e.g. 'camunda:assignee', 'isExecutable')",
          },
          value: {
            type: 'string',
            description: 'Expected property value (omit to check key existence only)',
          },
        },
        required: ['key'],
      },
    },
    required: ['diagramId'],
  },
} as const;
