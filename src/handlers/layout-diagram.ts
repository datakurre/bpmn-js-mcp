/**
 * Handler for layout_diagram tool.
 *
 * Uses elkjs (Eclipse Layout Kernel) with the Sugiyama layered algorithm
 * to produce clean left-to-right layouts.  Handles parallel branches,
 * reconverging gateways, and nested containers better than the previous
 * bpmn-auto-layout approach.
 */

import { type LayoutDiagramArgs, type ToolResult } from '../types';
import { requireDiagram, jsonResult, syncXml, getVisibleElements } from './helpers';
import { appendLintFeedback } from '../linter';
import { adjustDiagramLabels, adjustFlowLabels } from './adjust-labels';
import { elkLayout } from '../elk-layout';

export async function handleLayoutDiagram(args: LayoutDiagramArgs): Promise<ToolResult> {
  const { diagramId, direction, nodeSpacing, layerSpacing, scopeElementId } = args;
  const diagram = requireDiagram(diagramId);

  // Run ELK layered layout directly on the modeler (no XML round-trip)
  const layoutResult = await elkLayout(diagram, {
    direction,
    nodeSpacing,
    layerSpacing,
    scopeElementId,
  });
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

  const result = jsonResult({
    success: true,
    elementCount: elements.length,
    labelsMoved: labelsMoved + flowLabelsMoved,
    ...(layoutResult.crossingFlows ? { crossingFlows: layoutResult.crossingFlows } : {}),
    ...(layoutResult.crossingFlows
      ? {
          warning: `${layoutResult.crossingFlows} crossing sequence flow(s) detected — consider restructuring the process`,
        }
      : {}),
    message: `Layout applied to diagram ${diagramId}${scopeElementId ? ` (scoped to ${scopeElementId})` : ''} — ${elements.length} elements arranged`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'layout_bpmn_diagram',
  description:
    'Automatically arrange all elements in a BPMN diagram using the ELK layered algorithm (Sugiyama), producing a clean left-to-right layout. Handles parallel branches, reconverging gateways, and nested containers. Use this after structural changes (adding gateways, splitting flows) to automatically clean up the layout. Detects and reports crossing sequence flows.',
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
    },
    required: ['diagramId'],
  },
} as const;
