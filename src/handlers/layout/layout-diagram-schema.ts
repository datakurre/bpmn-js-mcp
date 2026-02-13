/**
 * JSON Schema for the layout_bpmn_diagram tool.
 *
 * Extracted from layout-diagram.ts to keep the handler logic under the
 * file-size lint limit.
 */

export const TOOL_DEFINITION = {
  name: 'layout_bpmn_diagram',
  description:
    'Automatically arrange elements in a BPMN diagram using the ELK layered algorithm (Sugiyama), producing a clean left-to-right layout. Handles parallel branches, reconverging gateways, and nested containers. Use this after structural changes (adding gateways, splitting flows) to automatically clean up the layout. Supports partial re-layout via elementIds. ' +
    'Use dryRun to preview changes before applying them. ' +
    "Use layoutStrategy 'deterministic' for trivial diagrams (linear chains, single split-merge) for faster, predictable layout. " +
    '**When NOT to use full layout:** If the diagram has carefully positioned elements, custom label placements, or boundary events, full re-layout may reposition them destructively. In such cases, prefer: (1) adjust_bpmn_labels for label cleanup only, (2) move_bpmn_element for targeted repositioning, (3) scopeElementId parameter to re-layout only one participant/subprocess, or (4) elementIds parameter for partial re-layout of specific elements.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      direction: {
        type: 'string',
        enum: ['RIGHT', 'DOWN', 'LEFT', 'UP'],
        description:
          'Layout direction. RIGHT = left-to-right (default), DOWN = top-to-bottom, LEFT = right-to-left, UP = bottom-to-top.',
      },
      nodeSpacing: {
        type: 'number',
        description: 'Spacing in pixels between nodes in the same layer (default: 80).',
      },
      layerSpacing: {
        type: 'number',
        description: 'Spacing in pixels between layers (default: 100).',
      },
      scopeElementId: {
        type: 'string',
        description:
          'Optional ID of a Participant or SubProcess to layout in isolation, leaving the rest of the diagram unchanged.',
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of element IDs for partial re-layout. Only these elements and their inter-connections are arranged, leaving the rest of the diagram unchanged.',
      },
      gridSnap: {
        type: 'number',
        description:
          'Optional grid size in pixels to snap element positions to after layout (e.g. 10). Reduces near-overlaps and improves visual consistency. Off by default.',
      },
      preserveHappyPath: {
        type: 'boolean',
        description:
          'When true (default), detects the main path (start→end via default flows) and pins it to a single row. Set to false to let ELK freely arrange all branches.',
      },
      compactness: {
        type: 'string',
        enum: ['compact', 'spacious'],
        description:
          "Layout compactness preset. 'compact' uses tighter spacing (nodeSpacing=40, layerSpacing=50). 'spacious' uses generous spacing (nodeSpacing=80, layerSpacing=100). Explicit nodeSpacing/layerSpacing values override compactness presets. Default uses balanced spacing (nodeSpacing=50, layerSpacing=60).",
      },
      simplifyRoutes: {
        type: 'boolean',
        description:
          "When true (default), simplifies gateway branch routes to clean L/Z-shaped paths. Set to false to preserve ELK's original crossing-minimised routing for complex diagrams.",
      },
      dryRun: {
        type: 'boolean',
        description:
          'When true, preview layout changes without applying them. Returns displacement statistics showing how many elements would move and by how much. Default: false.',
      },
      layoutStrategy: {
        type: 'string',
        enum: ['full', 'deterministic'],
        description:
          "Layout algorithm strategy: 'full' = full ELK Sugiyama layered layout (default), " +
          "'deterministic' = simplified, predictable layout for trivial diagrams (linear chains, single split-merge); " +
          "falls back to 'full' if the diagram is too complex.",
      },
      laneStrategy: {
        type: 'string',
        enum: ['preserve', 'optimize'],
        description:
          "Lane layout strategy: 'preserve' = keep elements in their current lanes (default), " +
          "'optimize' = reorder lanes to minimize cross-lane flows.",
      },
    },
    required: ['diagramId'],
  },
} as const;
