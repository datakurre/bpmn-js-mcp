/**
 * Handler for set_bpmn_connection_waypoints tool.
 *
 * Allows manual control over sequence flow and message flow waypoints.
 * Useful for deterministic routing of loopbacks, cross-lane handoffs,
 * and other special cases where the auto-router produces suboptimal paths.
 */
// @mutating

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface SetConnectionWaypointsArgs {
  diagramId: string;
  connectionId: string;
  waypoints: Array<{ x: number; y: number }>;
}

const CONNECTION_TYPES = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association']);

export async function handleSetConnectionWaypoints(
  args: SetConnectionWaypointsArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'connectionId', 'waypoints']);
  const { diagramId, connectionId, waypoints } = args;

  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return jsonResult({
      success: false,
      error: 'waypoints must be an array of at least 2 points (start and end).',
    });
  }

  // Validate each waypoint has x and y
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (typeof wp.x !== 'number' || typeof wp.y !== 'number') {
      return jsonResult({
        success: false,
        error: `waypoints[${i}] must have numeric x and y properties.`,
      });
    }
  }

  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const connection = requireElement(elementRegistry, connectionId);
  const connType = connection.type || connection.businessObject?.$type || '';

  if (!CONNECTION_TYPES.has(connType)) {
    return jsonResult({
      success: false,
      error:
        `Element "${connectionId}" is not a connection (got: ${connType}). ` +
        'set_bpmn_connection_waypoints only works with SequenceFlow, MessageFlow, or Association.',
    });
  }

  const oldWaypoints = (connection.waypoints || []).map((wp: any) => ({
    x: wp.x,
    y: wp.y,
  }));

  // Use modeling.updateWaypoints to update through the command stack (undoable)
  modeling.updateWaypoints(connection, waypoints);

  // Mark this connection as pinned so subsequent layouts preserve its waypoints.
  // The pin is cleared when the user runs a full layout_bpmn_diagram (without
  // elementIds or scopeElementId), matching the behaviour of pinned elements.
  if (!diagram.pinnedConnections) diagram.pinnedConnections = new Set();
  diagram.pinnedConnections.add(connectionId);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    connectionId,
    connectionType: connType,
    sourceName: connection.source?.businessObject?.name || connection.source?.id,
    targetName: connection.target?.businessObject?.name || connection.target?.id,
    previousWaypoints: oldWaypoints,
    newWaypoints: waypoints,
    waypointCount: waypoints.length,
    pinned: true,
    note: 'Waypoints pinned — layout_bpmn_diagram (full) will preserve these waypoints and clear the pin.',
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_connection_waypoints',
  description:
    'Set custom waypoints on a sequence flow, message flow, or association. ' +
    'Enables deterministic, clean routing for special cases like loopbacks, ' +
    'cross-lane handoffs, or message flows where the auto-router produces suboptimal paths. ' +
    'Waypoints must include at least the start and end points. ' +
    'Use list_bpmn_elements to see current waypoints of connections.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      connectionId: {
        type: 'string',
        description: 'The ID of the connection (sequence flow, message flow, or association)',
      },
      waypoints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate' },
            y: { type: 'number', description: 'Y coordinate' },
          },
          required: ['x', 'y'],
        },
        minItems: 2,
        description:
          'Ordered array of waypoints defining the connection path. ' +
          'Must include at least 2 points (start and end). ' +
          'For orthogonal routing, use 4+ waypoints to create L-shaped or U-shaped paths.',
      },
    },
    required: ['diagramId', 'connectionId', 'waypoints'],
    examples: [
      {
        title: 'Set a straight horizontal connection',
        value: {
          diagramId: '<diagram-id>',
          connectionId: 'Flow_ApproveToEnd',
          waypoints: [
            { x: 350, y: 200 },
            { x: 500, y: 200 },
          ],
        },
      },
      {
        title: 'Set a U-shaped loopback below the main path',
        value: {
          diagramId: '<diagram-id>',
          connectionId: 'Flow_No',
          waypoints: [
            { x: 400, y: 230 },
            { x: 400, y: 350 },
            { x: 200, y: 350 },
            { x: 200, y: 230 },
          ],
        },
      },
    ],
  },
} as const;
