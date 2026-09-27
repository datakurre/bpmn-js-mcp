/**
 * Batch (`moves[]`) form of move_bpmn_element.
 *
 * Split out of move-element.ts to keep that file under the project's
 * max-lines budget — see ADR-026 (set_bpmn_element_properties) for the
 * general design this mirrors: pre-validate every item before mutating
 * anything, then apply the whole batch inside one command-stack `preExecute`
 * so it undoes/redoes as a single step.
 */
// @mutating

import { type ToolResult } from '../../types';
import type { Modeling, ElementRegistry } from '../../bpmn-types';
import { illegalCombinationError, typeMismatchError, semanticViolationError } from '../../errors';
import { requireDiagram, requireElement, jsonResult, syncXml, getService } from '../helpers';
import { appendLintFeedback } from '../../linter';
import { applyMoveItemCore, type MoveItem, type MoveItemResult } from './move-element';

interface BatchMoveContext {
  diagram: ReturnType<typeof requireDiagram>;
  elementRegistry: ElementRegistry;
  modeling: Modeling;
  items: MoveItem[];
  results: MoveItemResult[];
  error?: Error;
}

const BATCH_MOVE_COMMAND = 'bpmn-mcp.applyElementMoves';

/**
 * Register (once per modeler) the compound command that applies every
 * `moves[]` item inside one `preExecute` call, so the command stack groups
 * them (plus this wrapper command itself) under a single id — the whole
 * batch undoes/redoes as one step, the same technique `set-properties.ts`
 * and `auto-layout.ts` use. `preExecute` never throws (see ADR-026 for why);
 * an item failure is stashed on `ctx.error` and unwound by the caller.
 */
function ensureBatchMoveCommand(modeler: any): void {
  const commandStack = getService(modeler, 'commandStack') as any;
  if (commandStack._getHandler?.(BATCH_MOVE_COMMAND)) return;

  commandStack.registerHandler(BATCH_MOVE_COMMAND, function ApplyElementMovesHandler(this: any) {
    this.preExecute = (ctx: BatchMoveContext) => {
      try {
        for (const item of ctx.items) {
          ctx.results.push(applyMoveItemCore(ctx.diagram, ctx.elementRegistry, ctx.modeling, item));
        }
      } catch (err) {
        ctx.error = err as Error;
      }
    };
    this.execute = () => [];
    this.revert = () => [];
  });
}

/** Validate one `moves[]` item without mutating anything. */
function preValidateMoveItem(
  elementRegistry: ElementRegistry,
  item: MoveItem,
  index: number
): void {
  const label = `moves[${index}] (elementId: ${item.elementId})`;
  const hasMove = item.x !== undefined || item.y !== undefined;
  const hasResize = item.width !== undefined || item.height !== undefined;
  const hasLane = item.laneId !== undefined;

  if (!hasMove && !hasResize && !hasLane) {
    throw semanticViolationError(
      `${label}: at least one of x/y, width/height, or laneId must be provided`
    );
  }

  try {
    requireElement(elementRegistry, item.elementId);
    if (hasLane) {
      const lane = requireElement(elementRegistry, item.laneId!);
      if (lane.type !== 'bpmn:Lane') {
        throw typeMismatchError(item.laneId!, lane.type, ['bpmn:Lane']);
      }
    }
  } catch (err) {
    throw semanticViolationError(`${label}: ${(err as Error).message}`);
  }
}

export async function handleMoveElementBatch(
  diagramId: string,
  moves: MoveItem[]
): Promise<ToolResult> {
  if (!Array.isArray(moves) || moves.length === 0) {
    throw illegalCombinationError('moves must be a non-empty array', ['moves']);
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');

  moves.forEach((item, index) => preValidateMoveItem(elementRegistry, item, index));

  const commandStack = getService(diagram.modeler, 'commandStack') as any;
  const startIdx = commandStack._stackIdx ?? 0;
  ensureBatchMoveCommand(diagram.modeler);

  const ctx: BatchMoveContext = { diagram, elementRegistry, modeling, items: moves, results: [] };
  commandStack.execute(BATCH_MOVE_COMMAND, ctx);

  if (ctx.error) {
    while ((commandStack._stackIdx ?? 0) > startIdx && commandStack.canUndo()) {
      commandStack.undo();
    }
    throw semanticViolationError(
      `Batch move failed: ${ctx.error.message}. No changes were applied.`
    );
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    moved: ctx.results.map(({ elementId, actions }) => ({ elementId, actions })),
    message: `Moved/resized ${ctx.results.length} element(s)`,
    nextSteps: [
      {
        tool: 'layout_bpmn_diagram',
        description: 'Re-layout the diagram to adjust connections after the moves.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}
