/**
 * JSON Schema for the layout_bpmn_diagram tool.
 *
 * Extracted from layout-diagram.ts to keep the handler logic under the
 * file-size lint limit.
 */

export const TOOL_DEFINITION = {
  name: 'layout_bpmn_diagram',
  description:
    'Automatically arrange elements in a BPMN diagram using bpmn-auto-layout, producing a clean left-to-right layout with orthogonal connections and placed labels. Handles parallel branches, reconverging gateways, loops, boundary events, subprocesses, pools, lanes, message flows, and artifacts. Use this after structural changes (adding gateways, splitting flows) to automatically clean up the layout. ' +
    'The whole layout is a single undo step in bpmn_history. ' +
    'Use dryRun to preview changes before applying them. ' +
    'Use labelsOnly: true to only adjust label positions without moving elements. ' +
    '**Partial layout:** pass scopeElementId to re-layout only one participant/subprocess, or elementIds to re-layout only a set of sibling elements (e.g. a newly added branch); the rest of the diagram is left unchanged and connections crossing the boundary are re-routed. ' +
    'Elements positioned with move_bpmn_element are pinned and keep their position until the next full layout.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      scopeElementId: {
        type: 'string',
        description:
          'Optional ID of a Participant or SubProcess to layout in isolation, leaving the rest of the diagram unchanged. The scope element keeps its top-left position but may be resized.',
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional IDs of flow elements to layout in isolation. All elements must share the same parent process or subprocess; boundary events follow their host task. The subset keeps its current top-left position. Cannot be combined with scopeElementId.',
      },
      gridSnap: {
        type: 'number',
        description:
          'Optional pixel grid snapping. Pass a number (e.g. 10) to snap element positions to a pixel grid after layout. Off by default.',
      },
      dryRun: {
        type: 'boolean',
        description:
          'When true, preview layout changes without applying them. Returns displacement statistics showing how many elements would move and by how much. Default: false.',
      },
      poolExpansion: {
        type: 'boolean',
        description:
          'Additionally run the pool/lane autosize pass after layout. ' +
          'The layout engine already sizes pools and lanes to fit their contents, so this is ' +
          'rarely needed. Default: false.',
      },
      labelsOnly: {
        type: 'boolean',
        description:
          'When true, only adjust labels without performing full layout. ' +
          'Useful for fixing label overlaps after importing diagrams or manual positioning.',
      },
      expandSubprocesses: {
        type: 'boolean',
        description:
          'When true, expand collapsed subprocesses that have internal flow-node ' +
          'children before running layout. Converts drill-down plane subprocesses ' +
          'to inline expanded subprocesses so the layout engine can arrange their ' +
          'children on the main plane. Default: false (preserve existing collapsed/expanded state).',
      },
      autosizeOnly: {
        type: 'boolean',
        description:
          'When true, only resize pools and lanes to fit their contents without running full layout. ' +
          'Accepts participantId to scope resizing to a single pool. Default: false.',
      },
      participantId: {
        type: 'string',
        description:
          'Optional. When autosizeOnly is true, scope pool resizing to this participant ID.',
      },
      verbose: {
        type: 'boolean',
        description:
          'When true, include full diagnostics: the non-orthogonal flow ID list, per-pool/lane ' +
          'sizing issues, cross-lane crossing flow IDs, the recomputed association ID list, and ' +
          'the full nextSteps list. Default: false — a compact summary with only actionable ' +
          'warnings and up to two nextSteps.',
      },
    },
    required: ['diagramId'],
  },
} as const;
