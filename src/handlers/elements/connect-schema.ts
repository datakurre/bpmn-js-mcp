/**
 * JSON Schema for the connect_bpmn_elements tool.
 *
 * Extracted from connect.ts to stay under max-lines.
 */

/** BPMN connection type constants (duplicated for schema use). */
const BPMN_SEQUENCE_FLOW_TYPE = 'bpmn:SequenceFlow';
const BPMN_MESSAGE_FLOW_TYPE = 'bpmn:MessageFlow';
const BPMN_ASSOCIATION_TYPE = 'bpmn:Association';

export const TOOL_DEFINITION = {
  name: 'connect_bpmn_elements',
  description:
    "Connect BPMN elements. Supports pair mode (sourceElementId + targetElementId) or chain mode (elementIds array for sequential connections). Auto-detects connection type: SequenceFlow for normal flow, MessageFlow for cross-pool, Association for text annotations, and DataAssociation for data objects/stores. Supports optional condition expressions for gateway branches and isDefault flag for gateway default flows. To modify an existing connection's label or condition after creation, use set_bpmn_element_properties with the connection's ID.",
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      sourceElementId: {
        type: 'string',
        description: 'The ID of the source element (pair mode)',
      },
      targetElementId: {
        type: 'string',
        description: 'The ID of the target element (pair mode)',
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description:
          'Ordered list of element IDs to connect sequentially (chain mode). When provided, sourceElementId and targetElementId are ignored.',
      },
      label: {
        type: 'string',
        description: 'Optional label for the connection',
      },
      connectionType: {
        type: 'string',
        enum: [BPMN_SEQUENCE_FLOW_TYPE, BPMN_MESSAGE_FLOW_TYPE, BPMN_ASSOCIATION_TYPE],
        description:
          'Type of connection (default: auto-detected). Usually not needed — the tool auto-detects the correct type.',
      },
      conditionExpression: {
        type: 'string',
        description:
          "Optional condition expression for sequence flows leaving gateways (e.g. '${approved == true}')",
      },
      isDefault: {
        type: 'boolean',
        description:
          "When connecting from an exclusive/inclusive gateway, set this flow as the gateway's default flow (taken when no condition matches).",
      },
      autoLayout: {
        type: 'boolean',
        default: false,
        description:
          'When true, run layout_bpmn_diagram automatically after connecting. ' +
          'Useful after the last connection in a sequence. Default: false.',
      },
    },
    required: ['diagramId'],
    oneOf: [
      {
        description: 'Pair mode: connect two specific elements',
        required: ['sourceElementId', 'targetElementId'],
      },
      {
        description: 'Chain mode: connect a sequence of elements',
        required: ['elementIds'],
      },
    ],
    examples: [
      {
        title: 'Connect two elements with a sequence flow',
        value: {
          diagramId: '<diagram-id>',
          sourceElementId: 'UserTask_Review',
          targetElementId: 'EndEvent_Done',
        },
      },
      {
        title: 'Connect a chain of elements sequentially',
        value: {
          diagramId: '<diagram-id>',
          elementIds: ['StartEvent_1', 'UserTask_Enter', 'Gateway_Valid', 'EndEvent_Done'],
        },
      },
      {
        title: 'Gateway branch with condition expression',
        value: {
          diagramId: '<diagram-id>',
          sourceElementId: 'Gateway_Approved',
          targetElementId: 'UserTask_Process',
          label: 'Yes',
          conditionExpression: '${approved == true}',
        },
      },
    ],
  },
} as const;
