/**
 * Handler for add_bpmn_elements tool.
 *
 * Merges the former add_bpmn_element (single-element case) and
 * add_bpmn_element_chain (batch/sequential case) into one tool — see
 * ADR-031. `elements` is always an array (a single element is an array of
 * one); `connect` picks 'chain' (default, auto-connect consecutive elements
 * — delegates to handleAddElementChain) or 'none' (add every element
 * independently — delegates to handleAddElement per item, no injected
 * afterElementId).
 */
// @mutating

import { type ToolResult } from '../../types';
import { missingRequiredError } from '../../errors';
import { validateArgs, requireDiagram, jsonResult, buildElementCounts } from '../helpers';
import { getService } from '../../bpmn-types';
import { appendLintFeedback } from '../../linter';
import { handleAddElement, type AddElementArgs } from './add-element';
import { handleAddElementChain, type AddElementChainItem } from './add-element-chain';
import { handleLayoutDiagram } from '../layout/layout-diagram';

export type AddElementItem = Omit<AddElementArgs, 'diagramId'>;

export interface AddElementsArgs {
  diagramId: string;
  /** Elements to add. A single element is an array of one. */
  elements: AddElementItem[];
  /** 'chain' (default): auto-connect consecutive elements. 'none': add each independently. */
  connect?: 'chain' | 'none';
  /** connect: 'chain' only — connect the first element after this existing element. */
  afterElementId?: string;
  /** Default participant pool for all elements (overridable per element). */
  participantId?: string;
  /** Default lane for all elements (overridable per element). */
  laneId?: string;
  /** Run layout_bpmn_diagram automatically after adding. Default: true for 'chain', false for 'none'. */
  autoLayout?: boolean;
}

/** connect: 'none' — add each element independently, no auto-connection between them. */
async function handleAddElementsIndependent(args: AddElementsArgs): Promise<ToolResult> {
  const { diagramId, elements } = args;
  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const created: Array<{ elementId: string; elementType: string; name?: string }> = [];
  for (const el of elements) {
    const addResult = await handleAddElement({
      diagramId,
      ...el,
      participantId: el.participantId || args.participantId,
      laneId: el.laneId || args.laneId,
    });
    const parsed = JSON.parse(addResult.content[0].text!);
    created.push({ elementId: parsed.elementId, elementType: el.elementType, name: el.name });
  }

  if (args.autoLayout) await handleLayoutDiagram({ diagramId });

  const result = jsonResult({
    success: true,
    elementIds: created.map((e) => e.elementId),
    elements: created,
    elementCount: created.length,
    message: `Added ${created.length} element(s) independently (connect: none)`,
    diagramCounts: buildElementCounts(elementRegistry),
    ...(args.autoLayout ? { autoLayoutApplied: true } : {}),
  });
  return appendLintFeedback(result, diagram);
}

export async function handleAddElements(args: AddElementsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elements']);
  if (!Array.isArray(args.elements) || args.elements.length === 0) {
    throw missingRequiredError(['elements']);
  }

  if (args.connect === 'none') {
    return handleAddElementsIndependent(args);
  }

  // connect: 'chain' (default)
  return handleAddElementChain({
    diagramId: args.diagramId,
    elements: args.elements as AddElementChainItem[],
    afterElementId: args.afterElementId,
    participantId: args.participantId,
    laneId: args.laneId,
    autoLayout: args.autoLayout,
  });
}

// Schema extracted to add-elements-schema.ts to stay under max-lines.
export { TOOL_DEFINITION } from './add-elements-schema';
