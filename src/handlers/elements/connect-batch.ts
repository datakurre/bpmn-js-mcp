/**
 * Batch (`connections[]`) form of connect_bpmn_elements.
 *
 * Split out of connect.ts to keep that file under the project's max-lines
 * budget — mirrors move-element-batch.ts / ADR-026: pre-validate every item
 * before mutating anything, then apply the whole batch inside one
 * command-stack `preExecute` so it undoes/redoes as a single step. Lets a
 * gateway's branches (each with its own condition, and a default flow) be
 * created in one call instead of one connect_bpmn_elements call per branch.
 */
// @mutating

import { type ToolResult } from '../../types';
import type { ElementRegistry } from '../../bpmn-types';
import { illegalCombinationError, semanticViolationError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  buildElementCounts,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { handleLayoutDiagram } from '../layout/layout-diagram';
import {
  connectPair,
  findDuplicateFlowId,
  detectImplicitMergeWarning,
  buildPairConnectHints,
  type ConnectionItem,
} from './connect';

interface ConnectionItemResult {
  sourceElementId: string;
  targetElementId: string;
  connectionId: string;
  connectionType: string;
  skipped?: boolean;
  warning?: string;
}

interface BatchConnectContext {
  diagram: ReturnType<typeof requireDiagram>;
  elementRegistry: ElementRegistry;
  items: ConnectionItem[];
  results: ConnectionItemResult[];
  hints: Set<string>;
  error?: Error;
}

const BATCH_CONNECT_COMMAND = 'bpmn-mcp.applyElementConnections';

/**
 * Register (once per modeler) the compound command that applies every
 * `connections[]` item inside one `preExecute` call, so the whole batch
 * undoes/redoes as one step — the same technique move-element-batch.ts and
 * set-properties.ts use. `preExecute` never throws (see ADR-026 for why): an
 * item failure is stashed on `ctx.error` and unwound by the caller.
 */
function ensureBatchConnectCommand(modeler: any): void {
  const commandStack = getService(modeler, 'commandStack') as any;
  if (commandStack._getHandler?.(BATCH_CONNECT_COMMAND)) return;

  commandStack.registerHandler(
    BATCH_CONNECT_COMMAND,
    function ApplyElementConnectionsHandler(this: any) {
      this.preExecute = (ctx: BatchConnectContext) => {
        try {
          for (const item of ctx.items) {
            ctx.results.push(applyConnectionItemCore(ctx.diagram, ctx.elementRegistry, item, ctx));
          }
        } catch (err) {
          ctx.error = err as Error;
        }
      };
      this.execute = () => [];
      this.revert = () => [];
    }
  );
}

/** Validate one `connections[]` item without mutating anything. */
function preValidateConnectionItem(
  elementRegistry: ElementRegistry,
  item: ConnectionItem,
  index: number
): void {
  const label = `connections[${index}]`;
  if (!item.sourceElementId || !item.targetElementId) {
    throw illegalCombinationError(`${label}: sourceElementId and targetElementId are required`, [
      'sourceElementId',
      'targetElementId',
    ]);
  }

  let source;
  try {
    source = requireElement(elementRegistry, item.sourceElementId);
    requireElement(elementRegistry, item.targetElementId);
  } catch (err) {
    throw semanticViolationError(`${label}: ${(err as Error).message}`);
  }

  const sourceType: string = source.type || source.businessObject?.$type || '';
  if (sourceType === 'bpmn:EndEvent') {
    throw semanticViolationError(
      `${label}: Cannot connect from ${item.sourceElementId} — bpmn:EndEvent is a flow sink and ` +
        `must not have outgoing sequence flows. Use a different element as the source, or replace ` +
        `the EndEvent with an IntermediateThrowEvent if the flow should continue.`
    );
  }
}

/**
 * Apply one `connections[]` item: dedup guard, then create + configure the
 * connection via the same `connectPair` pair mode uses. Synchronous — no XML
 * sync, no lint — so it is safe to call from within a command-stack
 * `preExecute` alongside other items, grouped into one undo step.
 */
function applyConnectionItemCore(
  diagram: ReturnType<typeof requireDiagram>,
  elementRegistry: ElementRegistry,
  item: ConnectionItem,
  ctx: BatchConnectContext
): ConnectionItemResult {
  const { sourceElementId, targetElementId } = item;
  const source = requireElement(elementRegistry, sourceElementId);
  const target = requireElement(elementRegistry, targetElementId);

  const existingId = findDuplicateFlowId(source, target);
  if (existingId) {
    return {
      sourceElementId,
      targetElementId,
      connectionId: existingId,
      connectionType: 'bpmn:SequenceFlow',
      skipped: true,
      warning:
        `Skipped: a sequence flow already exists from ${sourceElementId} to ${targetElementId} ` +
        `(connection ID: ${existingId}).`,
    };
  }

  const sourceType: string = source.type || source.businessObject?.$type || '';
  const { connection, connectionType, autoHint } = connectPair(diagram, source, target, {
    connectionType: item.connectionType,
    label: item.label,
    conditionExpression: item.conditionExpression,
    isDefault: item.isDefault,
  });

  const { hints, defaultConditionWarning } = buildPairConnectHints(
    autoHint,
    item.isDefault,
    item.conditionExpression,
    sourceType,
    source
  );
  hints.forEach((h) => ctx.hints.add(h));
  const implicitMergeWarning = detectImplicitMergeWarning(target, connection.id);

  return {
    sourceElementId,
    targetElementId,
    connectionId: connection.id,
    connectionType,
    ...(implicitMergeWarning || defaultConditionWarning
      ? { warning: implicitMergeWarning || defaultConditionWarning }
      : {}),
  };
}

export async function handleConnectBatch(
  diagramId: string,
  connections: ConnectionItem[],
  autoLayout?: boolean
): Promise<ToolResult> {
  if (!Array.isArray(connections) || connections.length === 0) {
    throw illegalCombinationError('connections must be a non-empty array', ['connections']);
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  connections.forEach((item, index) => preValidateConnectionItem(elementRegistry, item, index));

  const commandStack = getService(diagram.modeler, 'commandStack') as any;
  const startIdx = commandStack._stackIdx ?? 0;
  ensureBatchConnectCommand(diagram.modeler);

  const ctx: BatchConnectContext = {
    diagram,
    elementRegistry,
    items: connections,
    results: [],
    hints: new Set(),
  };
  commandStack.execute(BATCH_CONNECT_COMMAND, ctx);

  if (ctx.error) {
    while ((commandStack._stackIdx ?? 0) > startIdx && commandStack.canUndo()) {
      commandStack.undo();
    }
    throw semanticViolationError(
      `Batch connect failed: ${ctx.error.message}. No changes were applied.`
    );
  }

  await syncXml(diagram);
  if (autoLayout) await handleLayoutDiagram({ diagramId });

  const createdCount = ctx.results.filter((r) => !r.skipped).length;
  const result = jsonResult({
    success: true,
    connections: ctx.results,
    diagramCounts: buildElementCounts(elementRegistry),
    message: `Created ${createdCount} connection(s) (${ctx.results.length - createdCount} skipped as duplicates)`,
    ...(ctx.hints.size > 0 ? { hint: [...ctx.hints].join('\n\n') } : {}),
    nextSteps: [
      {
        tool: 'layout_bpmn_diagram',
        description: 'Auto-arrange after connecting — recommended for multiple connections.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}
