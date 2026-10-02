/**
 * JSON Schema for the create_bpmn_lanes tool.
 *
 * Extracted from create-lanes.ts to stay within lint line limits.
 */

export const TOOL_DEFINITION = {
  name: 'create_bpmn_lanes',
  description:
    'Create lanes (swimlanes) within a participant pool. Creates a bpmn:LaneSet with ' +
    'the specified lanes, dividing the pool height evenly (or using explicit heights). ' +
    'Lanes represent roles or departments within a single organization/process. ' +
    'Use lanes for role separation within one pool; use separate pools (participants) ' +
    'for separate organizations with message flows. Requires at least 2 lanes when ' +
    'defined manually. Alternatively, use distributeStrategy to auto-generate lanes: ' +
    '"by-type" groups elements into Human Tasks vs Automated Tasks lanes; "manual" uses ' +
    'elementIds in each lane definition to assign elements explicitly. ' +
    'Use assignments ([{ laneId, elementIds }]) to assign existing elements to existing lanes, ' +
    'or strategy (role-based | balance | minimize-crossings, with dryRun/validate) to ' +
    'redistribute elements across existing lanes. These forms are mutually exclusive. ' +
    'Use mergeFrom to convert a multi-pool collaboration into a single pool with lanes ' +
    '(elements are moved, message flows become sequence flows).',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participantId: {
        type: 'string',
        description:
          'The ID of the participant (pool) to add lanes to (required unless using assignments or strategy)',
      },
      lanes: {
        type: 'array',
        description:
          'Lane definitions (at least 2). Optional when distributeStrategy is "by-type" ' +
          '(lanes are auto-generated from element types).',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Lane name (typically a role or department)' },
            height: {
              type: 'number',
              description:
                'Optional lane height in pixels. If omitted, the pool height is divided evenly among lanes without explicit heights.',
            },
            elementIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Element IDs to assign to this lane (used with distributeStrategy "manual").',
            },
          },
          required: ['name'],
        },
        minItems: 2,
      },
      autoDistribute: {
        type: 'boolean',
        description:
          'When true, automatically assigns existing elements in the participant to the ' +
          'created lanes based on matching lane names to element roles (camunda:assignee ' +
          'or camunda:candidateGroups, case-insensitive). Elements without role matches ' +
          'fall back to type-based grouping (human tasks vs automated tasks). ' +
          'Flow-control elements (gateways, events) are assigned to their most-connected ' +
          "neighbor's lane. Run layout_bpmn_diagram afterwards for clean positioning.",
      },
      distributeStrategy: {
        type: 'string',
        enum: ['by-type', 'manual'],
        description:
          'Auto-generate and distribute elements to lanes. "by-type": auto-creates lanes ' +
          'based on element types (Human Tasks, Automated Tasks). "manual": uses elementIds ' +
          'in each lane definition to assign elements. When omitted, lanes are created without distribution.',
      },
      mergeFrom: {
        type: 'string',
        description:
          'Convert a multi-pool collaboration into lanes within a single pool. ' +
          'Provide the ID of the participant to keep as the main pool. ' +
          'Other expanded pools become lanes, elements are moved, and message flows are converted to sequence flows.',
      },
      assignments: {
        type: 'array',
        description:
          'Assign existing elements to existing lanes (participantId and lane creation not needed).',
        items: {
          type: 'object',
          properties: {
            laneId: { type: 'string', description: 'Target lane ID' },
            elementIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
          required: ['laneId', 'elementIds'],
        },
        minItems: 1,
      },
      strategy: {
        type: 'string',
        enum: ['role-based', 'balance', 'minimize-crossings'],
        description:
          'Redistribute elements across EXISTING lanes (participantId optional, auto-detected); ' +
          'unlike distributeStrategy, it never creates lanes. ' +
          "'role-based' matches assignee/candidateGroups to lane names; 'balance' spreads " +
          "elements evenly; 'minimize-crossings' minimizes cross-lane flows.",
      },
      dryRun: {
        type: 'boolean',
        description: 'With strategy: return the redistribution plan without applying changes.',
      },
      validate: {
        type: 'boolean',
        description: 'With strategy: run lane validation before and after redistribution.',
      },
      reposition: {
        type: 'boolean',
        description:
          'With assignments/strategy (default true): move elements vertically into their lane.',
      },
      layout: {
        type: 'boolean',
        description: 'When true (default), runs layout after mergeFrom conversion.',
      },
    },
    required: ['diagramId'],
  },
} as const;
