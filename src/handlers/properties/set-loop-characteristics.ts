/**
 * Handler for set_loop_characteristics tool.
 *
 * Sets loop characteristics on tasks for standard loops,
 * parallel multi-instance, and sequential multi-instance.
 */
// @mutating

import { type ToolResult } from '../../types';
import { typeMismatchError, invalidEnumError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

/** Build contextual hints for multi-instance loop characteristics. */
function buildLoopHints(
  loopType: string,
  options: { collection?: string; elementVariable?: string; completionCondition?: string }
): Array<{ tool: string; description: string }> {
  const hints: Array<{ tool: string; description: string }> = [];
  if (
    (loopType === 'parallel' || loopType === 'sequential') &&
    options.collection &&
    !options.elementVariable
  ) {
    hints.push({
      tool: 'set_bpmn_loop_characteristics',
      description:
        'Consider setting elementVariable to name the loop iteration variable (current item from the collection)',
    });
  }
  if (loopType === 'parallel' && !options.completionCondition) {
    hints.push({
      tool: 'set_bpmn_loop_characteristics',
      description:
        'Consider setting completionCondition to allow early completion (e.g. "${nrOfCompletedInstances >= 2}")',
    });
  }
  return hints;
}

/** Build a StandardLoopCharacteristics moddle element. */
function buildStandardLoop(
  moddle: any,
  options: { loopCondition?: string; loopMaximum?: number }
): any {
  const loopChar = moddle.create('bpmn:StandardLoopCharacteristics', {});
  if (options.loopCondition) {
    loopChar.loopCondition = moddle.create('bpmn:FormalExpression', {
      body: options.loopCondition,
    });
  }
  if (options.loopMaximum !== undefined) {
    loopChar.loopMaximum = options.loopMaximum;
  }
  return loopChar;
}

/** Build a MultiInstanceLoopCharacteristics moddle element. */
function buildMultiInstanceLoop(
  moddle: any,
  isSequential: boolean,
  options: {
    loopCardinality?: string;
    completionCondition?: string;
    collection?: string;
    elementVariable?: string;
  }
): any {
  const loopChar = moddle.create('bpmn:MultiInstanceLoopCharacteristics', {
    isSequential,
  });
  if (options.loopCardinality) {
    loopChar.loopCardinality = moddle.create('bpmn:FormalExpression', {
      body: options.loopCardinality,
    });
  }
  if (options.completionCondition) {
    loopChar.completionCondition = moddle.create('bpmn:FormalExpression', {
      body: options.completionCondition,
    });
  }
  if (options.collection) loopChar.collection = options.collection;
  if (options.elementVariable) loopChar.elementVariable = options.elementVariable;
  return loopChar;
}

export interface SetLoopCharacteristicsArgs {
  diagramId: string;
  elementId: string;
  loopType: 'none' | 'standard' | 'parallel' | 'sequential';
  loopCondition?: string;
  loopMaximum?: number;
  loopCardinality?: string;
  completionCondition?: string;
  collection?: string;
  elementVariable?: string;
}

/** Throws unless `effectiveType` is task-like, a SubProcess, or a CallActivity. */
export function assertLoopTarget(effectiveType: string, elementId: string): void {
  if (
    !effectiveType.includes('Task') &&
    effectiveType !== 'bpmn:SubProcess' &&
    effectiveType !== 'bpmn:CallActivity'
  ) {
    throw typeMismatchError(elementId, effectiveType, [
      'bpmn:Task',
      'bpmn:UserTask',
      'bpmn:ServiceTask',
      'bpmn:SubProcess',
      'bpmn:CallActivity',
    ]);
  }
}

export interface SetLoopCharacteristicsCoreResult {
  loopType: 'none' | 'standard' | 'parallel' | 'sequential';
  hints: Array<{ tool: string; description: string }>;
}

/**
 * Build and apply (or remove) loop characteristics. Synchronous — no XML
 * sync or lint feedback — so it is safe to call from within a command-stack
 * `preExecute` (see `applyPropertyUpdateItem` in `set-properties.ts`)
 * alongside other elements' updates, grouped into one undo step.
 */
export function applySetLoopCharacteristicsCore(
  diagram: ReturnType<typeof requireDiagram>,
  elementId: string,
  args: Omit<SetLoopCharacteristicsArgs, 'diagramId' | 'elementId'>
): SetLoopCharacteristicsCoreResult {
  const { loopType, ...options } = args;
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  assertLoopTarget(bo.$type, elementId);

  if (loopType === 'none') {
    modeling.updateProperties(element, { loopCharacteristics: undefined });
    return { loopType: 'none', hints: [] };
  }

  let loopChar: any;
  if (loopType === 'standard') {
    loopChar = buildStandardLoop(moddle, options);
  } else if (loopType === 'parallel' || loopType === 'sequential') {
    loopChar = buildMultiInstanceLoop(moddle, loopType === 'sequential', options);
  } else {
    throw invalidEnumError('loopType', loopType, ['none', 'standard', 'parallel', 'sequential']);
  }

  modeling.updateProperties(element, { loopCharacteristics: loopChar });

  return { loopType, hints: buildLoopHints(loopType, options) };
}

export async function handleSetLoopCharacteristics(
  args: SetLoopCharacteristicsArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'loopType']);
  const { diagramId, elementId } = args;
  const diagram = requireDiagram(diagramId);

  const { loopType, hints } = applySetLoopCharacteristicsCore(diagram, elementId, args);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    loopType,
    message:
      loopType === 'none'
        ? `Removed loop characteristics from ${elementId}`
        : `Set ${loopType} loop characteristics on ${elementId}`,
    ...(hints.length > 0 ? { nextSteps: hints } : {}),
  });
  return appendLintFeedback(result, diagram);
}

/** Shared loop-characteristics schema fragment (no diagramId/elementId). */
export const LOOP_CHARACTERISTICS_SCHEMA_PROPERTIES = {
  loopType: {
    type: 'string',
    enum: ['none', 'standard', 'parallel', 'sequential'],
    description:
      "Type of loop: 'none' (remove), 'standard' (loop marker), 'parallel' (parallel multi-instance |||), 'sequential' (sequential multi-instance \u2261)",
  },
  loopCondition: {
    type: 'string',
    description:
      "For standard loops: expression that is evaluated before each iteration (e.g. '${count < 10}')",
  },
  loopMaximum: {
    type: 'number',
    description: 'For standard loops: maximum number of iterations',
  },
  loopCardinality: {
    type: 'string',
    description: "For multi-instance: fixed number of instances (e.g. '3' or '${nrOfItems}')",
  },
  completionCondition: {
    type: 'string',
    description:
      "For multi-instance: expression to complete early (e.g. '${nrOfCompletedInstances >= 2}')",
  },
  collection: {
    type: 'string',
    description: 'For multi-instance (Camunda): collection/list variable to iterate over',
  },
  elementVariable: {
    type: 'string',
    description:
      'For multi-instance (Camunda): variable name for the current item in the collection',
  },
} as const;

export const TOOL_DEFINITION = {
  name: 'set_bpmn_loop_characteristics',
  description:
    "Set loop characteristics on tasks, subprocesses, or call activities. Supports standard loops, parallel multi-instance, and sequential multi-instance. Use loopType 'none' to remove loop markers.",
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the task/subprocess/call activity',
      },
      ...LOOP_CHARACTERISTICS_SCHEMA_PROPERTIES,
    },
    required: ['diagramId', 'elementId', 'loopType'],
  },
} as const;
