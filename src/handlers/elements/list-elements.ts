/**
 * Handler for list_bpmn_elements tool.
 *
 * When no filters are given, returns all elements (backward-compatible).
 * Optional filters (namePattern, elementType, property) allow searching
 * within the same tool — merges the former search_bpmn_elements tool.
 */
// @readonly

import { type ToolResult } from '../../types';
import { LARGE_LIST_COUNT } from '../../constants';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  getVisibleElements,
  validateArgs,
  getService,
} from '../helpers';
import { buildElementDetail } from './get-properties';

export interface ListElementsArgs {
  diagramId: string;
  namePattern?: string;
  elementType?: string;
  property?: { key: string; value?: string };
  /** Force the full element list even when it's large enough to be summarized. Default: false. */
  inline?: boolean;
  /**
   * Inspect these specific elements in full detail instead of listing/filtering.
   * Equivalent to the former get_bpmn_element_properties tool, extended to several
   * elements at once. When provided, all other filters are ignored.
   */
  elementIds?: string[];
}

/** Count elements by type, for the summary shown in place of a large list. */
function buildElementTypeSummary(elements: any[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const el of elements) {
    counts[el.type] = (counts[el.type] || 0) + 1;
  }
  return counts;
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
  const { diagramId, namePattern, elementType, property, inline = false, elementIds } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // Inspect mode: full detail for specific elements (former get_bpmn_element_properties).
  if (elementIds && elementIds.length > 0) {
    const details = elementIds.map((id) => buildElementDetail(requireElement(elementRegistry, id)));
    return jsonResult({ success: true, elements: details, count: details.length });
  }

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

  // Beyond the threshold, an unfiltered listing is summarized to a
  // resource_link instead of inlining the full array — pass inline: true
  // to force it. Filtered queries are already a narrowed, deliberate ask,
  // so they always return in full regardless of size.
  if (!hasFilters && !inline && elements.length > LARGE_LIST_COUNT) {
    const resourceUri = `bpmn://diagram/${diagramId}/elements`;
    const result = jsonResult({
      success: true,
      count: elements.length,
      summaryByType: buildElementTypeSummary(elements),
      resource: resourceUri,
      message:
        `Diagram has ${elements.length} elements — returning a type-count summary instead ` +
        `of the full list. Read ${resourceUri} for the complete list, or pass inline: true.`,
    });
    result.content.push({
      type: 'resource_link',
      uri: resourceUri,
      name: `Elements (${elements.length})`,
      mimeType: 'application/json',
      description: `Full element list for a large diagram (${elements.length} elements).`,
    });
    return result;
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
    'List elements in a BPMN diagram with their types, names, positions, connections, and properties. Supports optional filters to search by name pattern, element type, or property value. When no filters are given, returns all elements — unless the diagram is large, in which case an unfiltered call returns a type-count summary plus a bpmn://diagram/{id}/elements resource_link instead (pass inline: true to force the full list). ' +
    'Pass elementIds to inspect specific elements in full detail (all properties, extension elements, connections, event definitions) instead — ignores the other filters, one or several elements per call.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Inspect these specific elements in full detail instead of listing/filtering.',
      },
      inline: {
        type: 'boolean',
        description:
          'Force the full element list even for a large, unfiltered diagram that would otherwise be summarized. Default: false.',
      },
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
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      count: { type: 'number' },
    },
    required: ['success'],
    additionalProperties: true,
  },
} as const;
