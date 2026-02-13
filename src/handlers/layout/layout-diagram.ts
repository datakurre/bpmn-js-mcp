/**
 * Handler for layout_diagram tool.
 *
 * Uses elkjs (Eclipse Layout Kernel) with the Sugiyama layered algorithm
 * to produce clean left-to-right layouts.  Handles parallel branches,
 * reconverging gateways, and nested containers better than the previous
 * bpmn-auto-layout approach.
 *
 * Supports partial re-layout via `elementIds` — only the specified
 * elements and their inter-connections are arranged.
 */

import { type ToolResult } from '../../types';
import { requireDiagram, jsonResult, syncXml, getVisibleElements } from '../helpers';
import { appendLintFeedback, resetMutationCounter } from '../../linter';
import { adjustDiagramLabels, adjustFlowLabels } from './labels/adjust-labels';
import { elkLayout, elkLayoutSubset } from '../../elk/api';

export interface LayoutDiagramArgs {
  diagramId: string;
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  nodeSpacing?: number;
  layerSpacing?: number;
  scopeElementId?: string;
  preserveHappyPath?: boolean;
  compactness?: 'compact' | 'spacious';
  simplifyRoutes?: boolean;
  /** Optional list of element IDs for partial re-layout. */
  elementIds?: string[];
  /** Grid snap: boolean to enable/disable ELK grid snap, or number for pixel-level snapping. */
  gridSnap?: boolean | number;
}

/** Apply pixel-level grid snapping to all visible non-flow elements. */
function applyPixelGridSnap(diagram: any, pixelGridSnap: number): void {
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const visibleElements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:BoundaryEvent'
  );
  for (const el of visibleElements) {
    const snappedX = Math.round(el.x / pixelGridSnap) * pixelGridSnap;
    const snappedY = Math.round(el.y / pixelGridSnap) * pixelGridSnap;
    if (snappedX !== el.x || snappedY !== el.y) {
      modeling.moveElements([el], { x: snappedX - el.x, y: snappedY - el.y });
    }
  }
}

export async function handleLayoutDiagram(args: LayoutDiagramArgs): Promise<ToolResult> {
  const {
    diagramId,
    direction,
    nodeSpacing,
    layerSpacing,
    scopeElementId,
    preserveHappyPath,
    compactness,
    simplifyRoutes,
  } = args;
  const { elementIds } = args;
  const rawGridSnap = args.gridSnap;
  // gridSnap can be a boolean (enable/disable ELK grid snap pass)
  // or a number (pixel-level snapping after layout)
  const elkGridSnap = typeof rawGridSnap === 'boolean' ? rawGridSnap : undefined;
  const pixelGridSnap = typeof rawGridSnap === 'number' ? rawGridSnap : undefined;
  const diagram = requireDiagram(diagramId);

  let layoutResult: { crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> };

  if (elementIds && elementIds.length > 0) {
    // Partial re-layout: only specified elements
    layoutResult = await elkLayoutSubset(diagram, elementIds, {
      direction,
      nodeSpacing,
      layerSpacing,
    });
  } else {
    // Full or scoped layout
    layoutResult = await elkLayout(diagram, {
      direction,
      nodeSpacing,
      layerSpacing,
      scopeElementId,
      preserveHappyPath,
      gridSnap: elkGridSnap,
      compactness,
      simplifyRoutes,
    });
  }

  // Optional pixel-level grid snapping after layout
  if (pixelGridSnap && pixelGridSnap > 0) {
    applyPixelGridSnap(diagram, pixelGridSnap);
  }

  await syncXml(diagram);

  // Reset mutation counter since layout was just applied
  resetMutationCounter(diagram);

  const elementRegistry = diagram.modeler.get('elementRegistry');

  // Count laid-out elements for the response (exclude flows)
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  );

  // Adjust labels after layout
  const labelsMoved = await adjustDiagramLabels(diagram);
  const flowLabelsMoved = await adjustFlowLabels(diagram);

  const crossingCount = layoutResult.crossingFlows ?? 0;
  const crossingPairs = layoutResult.crossingFlowPairs ?? [];

  const result = jsonResult({
    success: true,
    elementCount: elementIds ? elementIds.length : elements.length,
    labelsMoved: labelsMoved + flowLabelsMoved,
    ...(crossingCount > 0
      ? {
          crossingFlows: crossingCount,
          crossingFlowPairs: crossingPairs,
          warning: `${crossingCount} crossing sequence flow(s) detected — consider restructuring the process`,
        }
      : {}),
    message: `Layout applied to diagram ${diagramId}${scopeElementId ? ` (scoped to ${scopeElementId})` : ''}${elementIds ? ` (${elementIds.length} elements)` : ''} — ${elementIds ? elementIds.length : elements.length} elements arranged`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'layout_bpmn_diagram',
  description:
    'Automatically arrange elements in a BPMN diagram using the ELK layered algorithm (Sugiyama), producing a clean left-to-right layout. Handles parallel branches, reconverging gateways, and nested containers. Use this after structural changes (adding gateways, splitting flows) to automatically clean up the layout. Supports partial re-layout via elementIds. ' +
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
    },
    required: ['diagramId'],
  },
} as const;
