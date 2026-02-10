/**
 * Handler for summarize_bpmn_diagram tool.
 *
 * Returns a lightweight summary of a diagram: process name, element
 * counts by type, participant/lane names, and connectivity stats.
 * Useful for AI callers to orient before making changes.
 */

import { type ToolResult } from '../types';
import { requireDiagram, jsonResult, getVisibleElements, validateArgs } from './helpers';

export interface SummarizeDiagramArgs {
  diagramId: string;
}

/** Classify a flow element as disconnected (missing expected connections). */
function isDisconnected(el: any): boolean {
  const hasIncoming = el.incoming && el.incoming.length > 0;
  const hasOutgoing = el.outgoing && el.outgoing.length > 0;
  if (el.type === 'bpmn:StartEvent') return !hasOutgoing;
  if (el.type === 'bpmn:EndEvent') return !hasIncoming;
  if (
    el.type === 'bpmn:TextAnnotation' ||
    el.type === 'bpmn:DataObjectReference' ||
    el.type === 'bpmn:DataStoreReference' ||
    el.type === 'bpmn:Group'
  ) {
    return false;
  }
  return !hasIncoming && !hasOutgoing;
}

const CONNECTION_TYPES = new Set([
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

const CONTAINER_TYPES = new Set(['bpmn:Participant', 'bpmn:Lane']);

/** Check if an element is a connection or container (not a flow element). */
function isConnectionOrContainer(type: string): boolean {
  return CONNECTION_TYPES.has(type) || CONTAINER_TYPES.has(type);
}

export async function handleSummarizeDiagram(args: SummarizeDiagramArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  // Element counts by type
  const typeCounts: Record<string, number> = {};
  for (const el of allElements) {
    const t = el.type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  // Process name
  const processes = elementRegistry.filter((el: any) => el.type === 'bpmn:Process');
  const processNames = processes.map((p: any) => p.businessObject?.name || p.id).filter(Boolean);

  // Participants (pools)
  const participants = allElements.filter((el: any) => el.type === 'bpmn:Participant');
  const participantInfo = participants.map((p: any) => ({
    id: p.id,
    name: p.businessObject?.name || '(unnamed)',
  }));

  // Lanes
  const lanes = allElements.filter((el: any) => el.type === 'bpmn:Lane');
  const laneInfo = lanes.map((l: any) => ({
    id: l.id,
    name: l.businessObject?.name || '(unnamed)',
  }));

  // Connections
  const flows = allElements.filter((el: any) => CONNECTION_TYPES.has(el.type));

  // Flow elements (tasks, events, gateways — excluding connections, pools, lanes)
  const flowElements = allElements.filter((el: any) => !isConnectionOrContainer(el.type));

  // Disconnected elements (no incoming or outgoing)
  const disconnected = flowElements.filter(isDisconnected);

  // Named elements
  const namedElements = flowElements
    .filter((el: any) => el.businessObject?.name)
    .map((el: any) => ({
      id: el.id,
      type: el.type,
      name: el.businessObject.name,
    }));

  return jsonResult({
    success: true,
    diagramName: diagram.name || processNames[0] || '(unnamed)',
    draftMode: diagram.draftMode ?? false,
    processNames,
    participants: participantInfo.length > 0 ? participantInfo : undefined,
    lanes: laneInfo.length > 0 ? laneInfo : undefined,
    elementCounts: typeCounts,
    totalElements: allElements.length,
    flowElementCount: flowElements.length,
    connectionCount: flows.length,
    disconnectedCount: disconnected.length,
    namedElements,
    ...(disconnected.length > 0
      ? {
          disconnectedElements: disconnected.map((el: any) => ({
            id: el.id,
            type: el.type,
            name: el.businessObject?.name || '(unnamed)',
          })),
        }
      : {}),
  });
}

export const TOOL_DEFINITION = {
  name: 'summarize_bpmn_diagram',
  description:
    'Get a lightweight summary of a BPMN diagram: process name, element counts by type, ' +
    'participant/lane names, named elements, and connectivity stats. Useful for orienting ' +
    'before making changes — avoids the overhead of listing every element with full details.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
