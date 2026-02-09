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

import { type LayoutDiagramArgs, type ToolResult } from '../types';
import { requireDiagram, jsonResult, syncXml, getVisibleElements } from './helpers';
import { appendLintFeedback } from '../linter';
import { adjustDiagramLabels, adjustFlowLabels } from './adjust-labels';
import { elkLayout, elkLayoutSubset } from '../elk-layout';

export async function handleLayoutDiagram(args: LayoutDiagramArgs): Promise<ToolResult> {
  const { diagramId, direction, nodeSpacing, layerSpacing, scopeElementId, preserveHappyPath } =
    args;
  const elementIds = (args as any).elementIds as string[] | undefined;
  const gridSnap = (args as any).gridSnap as number | undefined;
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
    });
  }

  // Optional grid snapping after layout
  if (gridSnap && gridSnap > 0) {
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const modeling = diagram.modeler.get('modeling');
    const visibleElements = getVisibleElements(elementRegistry).filter(
      (el: any) =>
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association')
    );
    for (const el of visibleElements) {
      const snappedX = Math.round(el.x / gridSnap) * gridSnap;
      const snappedY = Math.round(el.y / gridSnap) * gridSnap;
      if (snappedX !== el.x || snappedY !== el.y) {
        modeling.moveElements([el], { x: snappedX - el.x, y: snappedY - el.y });
      }
    }
  }

  await syncXml(diagram);

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
    'Automatically arrange elements in a BPMN diagram using the ELK layered algorithm (Sugiyama), producing a clean left-to-right layout. Handles parallel branches, reconverging gateways, and nested containers. Use this after structural changes (adding gateways, splitting flows) to automatically clean up the layout. Supports partial re-layout via elementIds.',
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
        description: 'Spacing in pixels between nodes in the same layer (default: 50).',
      },
      layerSpacing: {
        type: 'number',
        description: 'Spacing in pixels between layers (default: 50).',
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
    },
    required: ['diagramId'],
  },
} as const;
