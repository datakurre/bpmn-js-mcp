/**
 * Handler core of add_bpmn_elements (ADR-032; routed via add-elements.ts).
 *
 * Creates a sequence of BPMN elements and (by default) connects them in
 * order (connect: 'chain', the default) or just adds them (connect: 'none'),
 * calling the single-element handler per entry. Formerly the add_bpmn_element_chain tool.
 */
// @mutating

import { type ToolResult } from '../../types';
import { missingRequiredError } from '../../errors';
import { requireDiagram, jsonResult, validateArgs, buildElementCounts } from '../helpers';
import { getService } from '../../bpmn-types';
import { appendLintFeedback } from '../../linter';
import { handleAddElement, type AddElementArgs } from './add-element';
import { handleLayoutDiagram } from '../layout/layout-diagram';
import {
  CHAIN_ELEMENT_TYPES,
  validateChainElements,
  hasOwnAnchor,
} from './add-element-chain-validation';

export { CHAIN_ELEMENT_TYPES };

/**
 * One entry of `elements`: the full single-element `add_bpmn_elements` parameter
 * set minus `diagramId`. An entry that sets its own anchor (hostElementId,
 * flowId, a handoff, copyFrom, afterElementId or explicit x/y) is placed there
 * instead of being chained after the previous element.
 */
export type AddElementChainItem = Omit<AddElementArgs, 'diagramId'>;

export interface AddElementChainArgs {
  diagramId: string;
  /** Array of elements to create in order. */
  elements: AddElementChainItem[];
  /**
   * 'chain' (default): connect each element to the previous one with a sequence flow.
   * 'none': just add the elements, connecting nothing (each is placed right of the previous
   * one, starting from afterElementId, unless it has an explicit x/y).
   */
  connect?: 'chain' | 'none';
  /** Optional: connect the first element after this existing element ID. */
  afterElementId?: string;
  /** Optional participant pool for all elements (can be overridden per-element). */
  participantId?: string;
  /** Optional lane for all elements (can be overridden per-element). */
  laneId?: string;
  /**
   * When true, run layout_bpmn_diagram automatically after the chain is built.
   * Defaults to true — chains connect elements, so layout is almost always desired.
   * Pass false to skip layout (e.g. when further elements will be added before layout).
   */
  autoLayout?: boolean;
}

/** Gateway types that require explicit branch wiring after chain creation. */
const GATEWAY_TYPES = new Set([
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
  'bpmn:ExclusiveGateway',
]);

/** Resolve the participantId of an anchor element (afterElementId). */
function resolveAnchorParticipantId(
  elementRegistry: ReturnType<typeof getService<'elementRegistry'>>,
  afterElementId: string | undefined,
  fallback: string | undefined
): string | undefined {
  if (!afterElementId) return fallback;
  const anchorEl = elementRegistry.get(afterElementId);
  if (!anchorEl) return fallback;
  let el: any = anchorEl;
  while (el && el.type !== 'bpmn:Participant') el = el.parent;
  return el?.type === 'bpmn:Participant' ? (el.id as string) : fallback;
}

/** Emit a cross-pool warning when an element targets a different pool than the previous. */
function detectCrossPoolTransition(
  el: AddElementChainArgs['elements'][number],
  defaultParticipantId: string | undefined,
  previousParticipantId: string | undefined,
  warnings: string[]
): string | undefined {
  const currentParticipantId = el.participantId || defaultParticipantId;
  if (
    currentParticipantId &&
    previousParticipantId &&
    currentParticipantId !== previousParticipantId
  ) {
    warnings.push(
      `Element "${el.name || el.elementType}" specifies participantId "${currentParticipantId}" but the previous element is in "${previousParticipantId}". ` +
        `AutoPlace does not support cross-pool placement — the element may have landed in the wrong pool. ` +
        `Use add_bpmn_elements with explicit x/y coordinates and participantId to place it correctly.`
    );
  }
  return currentParticipantId || previousParticipantId;
}

type CreatedEntry = {
  elementId: string;
  elementType: string;
  name?: string;
  connectionId?: string;
};
type UnconnectedEntry = { elementId: string; elementType: string; name?: string };
interface ChainLoopResult {
  createdElements: CreatedEntry[];
  unconnectedElements: UnconnectedEntry[];
  warnings: string[];
}

/**
 * Placement args for one entry. An entry with its own anchor/position is placed there.
 * Otherwise 'none' places it right of the previous element (or the afterElementId anchor)
 * without connecting, and 'chain' connects it after the previous element (not past a gateway).
 */
function planPlacement(
  el: AddElementChainItem,
  connect: 'chain' | 'none',
  previousId: string | undefined,
  postGateway: boolean
): Partial<AddElementArgs> {
  if (hasOwnAnchor(el) || !previousId) return {};
  if (connect === 'none') return { afterElementId: previousId, autoConnect: false };
  return postGateway ? {} : { afterElementId: previousId };
}

async function runChainLoop(
  args: AddElementChainArgs,
  initialPreviousId: string | undefined,
  initialParticipantId: string | undefined
): Promise<ChainLoopResult> {
  const createdElements: CreatedEntry[] = [];
  const unconnectedElements: UnconnectedEntry[] = [];
  const warnings: string[] = [];
  const connect = args.connect ?? 'chain';
  let previousId = initialPreviousId;
  let postGateway = false;
  let previousParticipantId = initialParticipantId;
  for (const el of args.elements) {
    const isGateway = GATEWAY_TYPES.has(el.elementType);
    const placement = planPlacement(el, connect, previousId, postGateway);
    const addResult = await handleAddElement({
      ...el,
      diagramId: args.diagramId,
      participantId: el.participantId || args.participantId,
      laneId: el.laneId || args.laneId,
      ...placement,
    });
    const parsed = JSON.parse(addResult.content[0].text!);
    createdElements.push({
      elementId: parsed.elementId,
      elementType: el.elementType,
      name: el.name,
      ...(parsed.connectionId ? { connectionId: parsed.connectionId } : {}),
    });
    previousParticipantId = detectCrossPoolTransition(
      el,
      args.participantId,
      previousParticipantId,
      warnings
    );
    if (postGateway && connect !== 'none') {
      unconnectedElements.push({
        elementId: parsed.elementId,
        elementType: el.elementType,
        name: el.name,
      });
    }
    if (isGateway && connect !== 'none') postGateway = true;
    previousId = parsed.elementId;
  }
  return { createdElements, unconnectedElements, warnings };
}

/**
 * Emit a warning when no afterElementId is specified but the diagram already
 * contains flow nodes — the new chain will be disconnected from them.
 */
function buildDisconnectedChainWarning(
  elementRegistry: ReturnType<typeof getService<'elementRegistry'>>,
  afterElementId: string | undefined
): string[] {
  if (afterElementId) return [];
  const existingNodes = elementRegistry
    .getAll()
    .filter((el: any) => CHAIN_ELEMENT_TYPES.has(el.type));
  if (existingNodes.length === 0) return [];
  const lastEl = existingNodes[existingNodes.length - 1];
  return [
    `No afterElementId specified — the chain will be disconnected from the existing ` +
      `${existingNodes.length} element(s) in the diagram. ` +
      `Specify afterElementId to attach the chain after an existing element ` +
      `(e.g. afterElementId: "${lastEl.id}").`,
  ];
}

/** Build lane-membership warnings and nextSteps for a chain without laneId. */
function buildLaneWarnings(
  elementRegistry: ReturnType<typeof getService<'elementRegistry'>>,
  effectiveParticipantId: string | undefined,
  args: AddElementChainArgs
): { warnings: string[]; nextSteps: Array<{ tool: string; description: string }> } {
  if (!effectiveParticipantId) return { warnings: [], nextSteps: [] };
  const hasTopLevelLaneId = !!args.laneId;
  const allElementsHaveLaneId = args.elements.every((el) => !!el.laneId);
  if (hasTopLevelLaneId || allElementsHaveLaneId) return { warnings: [], nextSteps: [] };
  const lanes = elementRegistry
    .getAll()
    .filter((el: any) => el.type === 'bpmn:Lane' && el.parent?.id === effectiveParticipantId);
  if (lanes.length === 0) return { warnings: [], nextSteps: [] };
  const laneList = lanes
    .map((l: any) => `${l.id} ("${l.businessObject?.name || 'unnamed'}")`)
    .join(', ');
  return {
    warnings: [
      `participantId "${effectiveParticipantId}" has lanes but no laneId was specified. ` +
        `Chain elements may be placed outside all lanes. ` +
        `Specify laneId on the chain or per element. Available lanes: ${laneList}`,
    ],
    nextSteps: [
      {
        tool: 'add_bpmn_elements',
        description:
          `Re-run with laneId set to one of the available lanes: ${laneList}. ` +
          `Available lanes are listed above.`,
      },
    ],
  };
}

/** A connected chain with a gateway defers layout; only connected chains auto-layout at all. */
function planLayout(
  args: AddElementChainArgs,
  connected: boolean
): { chainHasGateway: boolean; shouldLayout: boolean } {
  const chainHasGateway =
    connected && args.elements.some((el) => GATEWAY_TYPES.has(el.elementType));
  return {
    chainHasGateway,
    // Layout would discard explicit anchors/positions, so it is off by default when any entry sets one.
    shouldLayout:
      (args.autoLayout ?? !args.elements.some(hasOwnAnchor)) && connected && !chainHasGateway,
  };
}

export async function handleAddElementChain(args: AddElementChainArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elements']);
  const { diagramId, elements, afterElementId } = args;
  if (!Array.isArray(elements) || elements.length === 0) throw missingRequiredError(['elements']);

  const diagram = requireDiagram(diagramId);
  validateChainElements(elements, afterElementId, diagram, (args.connect ?? 'chain') === 'chain');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // Check for disconnected chain BEFORE running the loop (state must be pre-mutation)
  const connected = (args.connect ?? 'chain') === 'chain';
  const preWarnings = connected
    ? buildDisconnectedChainWarning(elementRegistry, afterElementId)
    : [];

  const initialParticipantId = resolveAnchorParticipantId(
    elementRegistry,
    afterElementId,
    args.participantId
  );

  const { createdElements, unconnectedElements, warnings } = await runChainLoop(
    args,
    afterElementId,
    initialParticipantId
  );

  // Prepend disconnected-chain warning (collected before mutation)
  warnings.unshift(...preWarnings);

  // Build lane warnings and next steps
  const laneResult = buildLaneWarnings(elementRegistry, initialParticipantId, args);
  warnings.push(...laneResult.warnings);
  const laneNextStep = laneResult.nextSteps;

  const { chainHasGateway, shouldLayout } = planLayout(args, connected);
  if (shouldLayout) await handleLayoutDiagram({ diagramId });

  // Collect connection IDs created in this chain that have no condition expression.
  // These need explicit branch wiring (conditionExpression or isDefault) when the
  // chain contains a gateway.
  const unconditionedFlowIds = chainHasGateway
    ? createdElements.filter((e) => e.connectionId).map((e) => e.connectionId as string)
    : undefined;

  const deferredLayoutNote = chainHasGateway
    ? 'Chain contains a gateway — elements after it were NOT auto-connected to avoid wrong sequential wiring. ' +
      'Check the connectionIds map in this response first: flows from elements BEFORE the gateway were already ' +
      'created and must NOT be re-created with connect_bpmn_elements (that call will be silently skipped). ' +
      'Use connect_bpmn_elements ONLY for new branch flows originating FROM the gateway. ' +
      'Mark exactly one outgoing branch as the default with isDefault: true in connect_bpmn_elements, ' +
      'and add conditionExpression to all other branches. ' +
      (unconditionedFlowIds && unconditionedFlowIds.length > 0
        ? `These flow IDs already exist but have NO conditionExpression and are NOT marked as default — ` +
          `call set_bpmn_element_properties on each: [${unconditionedFlowIds.join(', ')}]. `
        : '') +
      'Then run layout_bpmn_diagram after all branches are wired.' +
      (unconnectedElements.length > 0
        ? ` Unconnected element IDs: ${unconnectedElements.map((e) => e.elementId).join(', ')}.`
        : '')
    : undefined;

  const nextSteps = laneNextStep.length > 0 ? laneNextStep : undefined;

  const result = jsonResult({
    success: true,
    elementIds: createdElements.map((e) => e.elementId),
    elements: createdElements,
    elementCount: createdElements.length,
    connectionIds: Object.fromEntries(
      createdElements
        .filter((e) => e.connectionId)
        .map((e) => [e.elementId, e.connectionId as string])
    ),
    message: `Created chain of ${createdElements.length} elements: ${createdElements.map((e) => e.name || e.elementType).join(' → ')}`,
    diagramCounts: buildElementCounts(elementRegistry),
    ...(shouldLayout ? { autoLayoutApplied: true } : {}),
    ...(deferredLayoutNote ? { deferredLayout: true, note: deferredLayoutNote } : {}),
    ...(unconditionedFlowIds !== undefined ? { unconditionedFlowIds } : {}),
    ...(unconnectedElements.length > 0 ? { unconnectedElements } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(nextSteps ? { nextSteps } : {}),
  });
  return appendLintFeedback(result, diagram);
}
