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
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  // Run ELK layered layout directly on the modeler (no XML round-trip)
  await elkLayout(diagram);
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
    message: `Layout applied to diagram ${diagramId} — ${elements.length} elements arranged`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'layout_bpmn_diagram',
  description:
    'Automatically arrange all elements in a BPMN diagram using the ELK layered algorithm (Sugiyama), producing a clean left-to-right layout. Handles parallel branches, reconverging gateways, and nested containers. Use this after structural changes (adding gateways, splitting flows) to automatically clean up the layout.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
