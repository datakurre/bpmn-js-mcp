/**
 * Handler for set_loop_characteristics tool.
 *
 * Sets loop characteristics on tasks for standard loops,
 * parallel multi-instance, and sequential multi-instance.
 */

import { type ToolResult } from '../../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from '../helpers';
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

export async function handleSetLoopCharacteristics(
  args: SetLoopCharacteristicsArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'loopType']);
  const { diagramId, elementId, loopType, ...options } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const moddle = diagram.modeler.get('moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Verify element is a task-like type
  if (
    !bo.$type.includes('Task') &&
    bo.$type !== 'bpmn:SubProcess' &&
    bo.$type !== 'bpmn:CallActivity'
  ) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Loop characteristics can only be set on tasks, subprocesses, or call activities (got ${bo.$type})`
    );
  }

  let loopChar: any;

  if (loopType === 'none') {
    // Remove loop characteristics
    modeling.updateProperties(element, { loopCharacteristics: undefined });
    await syncXml(diagram);

    const result = jsonResult({
      success: true,
      elementId,
      loopType: 'none',
      message: `Removed loop characteristics from ${elementId}`,
    });
    return appendLintFeedback(result, diagram);
  }

  if (loopType === 'standard') {
    loopChar = buildStandardLoop(moddle, options);
  } else if (loopType === 'parallel' || loopType === 'sequential') {
    loopChar = buildMultiInstanceLoop(moddle, loopType === 'sequential', options);
  } else {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Invalid loopType: ${loopType}. Must be 'none', 'standard', 'parallel', or 'sequential'.`
    );
  }

  modeling.updateProperties(element, { loopCharacteristics: loopChar });
  await syncXml(diagram);

  const hints = buildLoopHints(loopType, options);

  const result = jsonResult({
    success: true,
    elementId,
    loopType,
    message: `Set ${loopType} loop characteristics on ${elementId}`,
    ...(hints.length > 0 ? { nextSteps: hints } : {}),
  });
  return appendLintFeedback(result, diagram);
}

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
    },
    required: ['diagramId', 'elementId', 'loopType'],
    examples: [
      {
        title: 'Parallel multi-instance over a collection',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'UserTask_ApproveItem',
          loopType: 'parallel',
          collection: 'orderItems',
          elementVariable: 'item',
        },
      },
      {
        title: 'Sequential multi-instance with early completion',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'ServiceTask_RetryCall',
          loopType: 'sequential',
          loopCardinality: '3',
          completionCondition: '${success == true}',
        },
      },
    ],
  },
} as const;
