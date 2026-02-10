/**
 * Handler for list_bpmn_process_variables tool.
 *
 * Scans all elements in a diagram and extracts process variables from:
 * - Form fields (camunda:FormData → camunda:FormField)
 * - Input/output parameter mappings (camunda:InputOutput)
 * - Call activity variable mappings (camunda:In / camunda:Out)
 * - Condition expressions on sequence flows
 * - Camunda properties (assignee, candidateGroups, candidateUsers)
 * - Script tasks (camunda:resultVariable)
 * - Loop characteristics (collection, elementVariable)
 * - Execution/task listener scripts
 */

import { type ToolResult } from '../types';
import { requireDiagram, jsonResult, getVisibleElements, validateArgs } from './helpers';

export interface ListProcessVariablesArgs {
  diagramId: string;
}

interface VariableReference {
  name: string;
  /** How the variable is used: 'read', 'write', or 'read-write'. */
  access: 'read' | 'write' | 'read-write';
  /** Where this variable was found. */
  source: string;
  /** The element ID where this variable was found. */
  elementId: string;
  /** The element name (if any). */
  elementName?: string;
}

/**
 * Extract variable names referenced in a JUEL/UEL expression string.
 * Looks for `${...}` patterns and extracts identifier-like tokens.
 */
function extractExpressionVariables(expr: string): string[] {
  if (!expr || typeof expr !== 'string') return [];
  const vars: string[] = [];
  // Match ${...} expressions
  const exprPattern = /\$\{([^}]+)}/g;
  let match;
  while ((match = exprPattern.exec(expr)) !== null) {
    const body = match[1];
    // Extract identifiers (skip Java method calls, operators, literals)
    const identPattern = /\b([a-zA-Z_]\w*)\b/g;
    let idMatch;
    while ((idMatch = identPattern.exec(body)) !== null) {
      const id = idMatch[1];
      // Skip common JUEL keywords and built-in variables
      if (
        !JUEL_KEYWORDS.has(id) &&
        !id.startsWith('java') &&
        !id.startsWith('org') &&
        !id.startsWith('com')
      ) {
        vars.push(id);
      }
    }
  }
  return vars;
}

const JUEL_KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'empty',
  'not',
  'and',
  'or',
  'eq',
  'ne',
  'lt',
  'gt',
  'le',
  'ge',
  'div',
  'mod',
  'instanceof',
  'new',
  // Common built-in variables (execution context, not process variables)
  'execution',
  'task',
  'delegateTask',
  'externalTask',
  'connector',
  'cardinalityExpression',
  'loopCounter',
  'nrOfInstances',
  'nrOfActiveInstances',
  'nrOfCompletedInstances',
  // Common Java types/methods
  'String',
  'Integer',
  'Long',
  'Boolean',
  'Double',
  'Math',
  'System',
  'println',
  'toString',
  'equals',
  'getVariable',
  'setVariable',
  'hasVariable',
  'getVariableLocal',
  'setVariableLocal',
  'getName',
  'getValue',
  'size',
  'length',
  'isEmpty',
  'contains',
  'get',
  'put',
  'remove',
  'add',
]);

// ── Variable extraction from elements ──────────────────────────────────────

/** Context for extraction helpers. */
interface ExtractionContext {
  elementId: string;
  elementName?: string;
}

/** Extract variables from camunda:FormData extension elements. */
function extractFromFormData(ext: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  for (const field of ext.fields || []) {
    refs.push({ name: field.id, access: 'write', source: 'formField', ...ctx });
    if (field.defaultValue) {
      for (const v of extractExpressionVariables(field.defaultValue)) {
        refs.push({ name: v, access: 'read', source: 'formField.defaultValue', ...ctx });
      }
    }
  }
  return refs;
}

/** Extract variables from camunda:InputOutput extension elements. */
function extractFromInputOutput(ext: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  for (const param of ext.inputParameters || []) {
    refs.push({ name: param.name, access: 'write', source: 'inputParameter', ...ctx });
    if (param.value) {
      for (const v of extractExpressionVariables(param.value)) {
        refs.push({ name: v, access: 'read', source: 'inputParameter.expression', ...ctx });
      }
    }
  }
  for (const param of ext.outputParameters || []) {
    refs.push({ name: param.name, access: 'write', source: 'outputParameter', ...ctx });
    if (param.value) {
      for (const v of extractExpressionVariables(param.value)) {
        refs.push({ name: v, access: 'read', source: 'outputParameter.expression', ...ctx });
      }
    }
  }
  return refs;
}

/** Extract variables from camunda:In call activity mappings. */
function extractFromCallActivityIn(ext: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  if (ext.target) {
    refs.push({ name: ext.target, access: 'write', source: 'callActivity.in', ...ctx });
  }
  if (ext.source) {
    refs.push({ name: ext.source, access: 'read', source: 'callActivity.in', ...ctx });
  }
  if (ext.sourceExpression) {
    for (const v of extractExpressionVariables(ext.sourceExpression)) {
      refs.push({ name: v, access: 'read', source: 'callActivity.in.expression', ...ctx });
    }
  }
  return refs;
}

/** Extract variables from camunda:Out call activity mappings. */
function extractFromCallActivityOut(ext: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  if (ext.target) {
    refs.push({ name: ext.target, access: 'write', source: 'callActivity.out', ...ctx });
  }
  if (ext.source) {
    refs.push({ name: ext.source, access: 'read', source: 'callActivity.out', ...ctx });
  }
  if (ext.sourceExpression) {
    for (const v of extractExpressionVariables(ext.sourceExpression)) {
      refs.push({ name: v, access: 'read', source: 'callActivity.out.expression', ...ctx });
    }
  }
  return refs;
}

/** Extract variables from extension elements. */
function extractFromExtensions(bo: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  const extensionElements = bo.extensionElements?.values || [];
  for (const ext of extensionElements) {
    if (ext.$type === 'camunda:FormData') refs.push(...extractFromFormData(ext, ctx));
    else if (ext.$type === 'camunda:InputOutput') refs.push(...extractFromInputOutput(ext, ctx));
    else if (ext.$type === 'camunda:In') refs.push(...extractFromCallActivityIn(ext, ctx));
    else if (ext.$type === 'camunda:Out') refs.push(...extractFromCallActivityOut(ext, ctx));
  }
  return refs;
}

const CAMUNDA_EXPR_PROPS = [
  { attr: 'camunda:assignee', source: 'assignee' },
  { attr: 'camunda:candidateGroups', source: 'candidateGroups' },
  { attr: 'camunda:candidateUsers', source: 'candidateUsers' },
  { attr: 'camunda:dueDate', source: 'dueDate' },
  { attr: 'camunda:followUpDate', source: 'followUpDate' },
  { attr: 'camunda:priority', source: 'priority' },
];

/** Extract variables from Camunda expression properties on tasks. */
function extractFromCamundaProps(bo: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  for (const { attr, source } of CAMUNDA_EXPR_PROPS) {
    const shortKey = attr.replace('camunda:', '');
    const val = bo.$attrs?.[attr] ?? bo[shortKey];
    if (val && typeof val === 'string') {
      for (const v of extractExpressionVariables(val)) {
        refs.push({ name: v, access: 'read', source, ...ctx });
      }
    }
  }
  return refs;
}

/** Extract variables from loop characteristics. */
function extractFromLoopCharacteristics(
  loopChars: any,
  ctx: ExtractionContext
): VariableReference[] {
  const refs: VariableReference[] = [];
  const collection =
    loopChars.$attrs?.['camunda:collection'] ?? loopChars.collection ?? loopChars.campiCollection;
  if (collection && typeof collection === 'string') {
    if (collection.includes('${')) {
      for (const v of extractExpressionVariables(collection)) {
        refs.push({ name: v, access: 'read', source: 'loop.collection', ...ctx });
      }
    } else {
      refs.push({ name: collection, access: 'read', source: 'loop.collection', ...ctx });
    }
  }
  const elemVar = loopChars.$attrs?.['camunda:elementVariable'] ?? loopChars.elementVariable;
  if (elemVar && typeof elemVar === 'string') {
    refs.push({ name: elemVar, access: 'write', source: 'loop.elementVariable', ...ctx });
  }
  if (loopChars.completionCondition?.body) {
    for (const v of extractExpressionVariables(loopChars.completionCondition.body)) {
      refs.push({ name: v, access: 'read', source: 'loop.completionCondition', ...ctx });
    }
  }
  return refs;
}

function extractFromElement(el: any): VariableReference[] {
  const bo = el.businessObject;
  if (!bo) return [];

  const ctx: ExtractionContext = {
    elementId: el.id,
    elementName: bo.name || undefined,
  };

  const refs: VariableReference[] = [];

  refs.push(...extractFromExtensions(bo, ctx));
  refs.push(...extractFromCamundaProps(bo, ctx));

  const resultVar = bo.$attrs?.['camunda:resultVariable'] ?? bo.resultVariable;
  if (resultVar && typeof resultVar === 'string') {
    refs.push({ name: resultVar, access: 'write', source: 'scriptTask.resultVariable', ...ctx });
  }

  if (bo.conditionExpression?.body) {
    for (const v of extractExpressionVariables(bo.conditionExpression.body)) {
      refs.push({ name: v, access: 'read', source: 'conditionExpression', ...ctx });
    }
  }

  if (bo.loopCharacteristics) {
    refs.push(...extractFromLoopCharacteristics(bo.loopCharacteristics, ctx));
  }

  return refs;
}

export async function handleListProcessVariables(
  args: ListProcessVariablesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const allRefs: VariableReference[] = [];
  for (const el of allElements) {
    allRefs.push(...extractFromElement(el));
  }

  type VarEntry = {
    name: string;
    readBy: Array<{ elementId: string; elementName?: string; source: string }>;
    writtenBy: Array<{ elementId: string; elementName?: string; source: string }>;
  };
  const varMap = new Map<string, VarEntry>();

  for (const ref of allRefs) {
    if (!varMap.has(ref.name)) {
      varMap.set(ref.name, { name: ref.name, readBy: [], writtenBy: [] });
    }
    const entry = varMap.get(ref.name)!;
    const loc = { elementId: ref.elementId, elementName: ref.elementName, source: ref.source };
    const notIn = (arr: typeof entry.readBy) =>
      !arr.some((r) => r.elementId === loc.elementId && r.source === loc.source);

    if (ref.access === 'read' || ref.access === 'read-write') {
      if (notIn(entry.readBy)) entry.readBy.push(loc);
    }
    if (ref.access === 'write' || ref.access === 'read-write') {
      if (notIn(entry.writtenBy)) entry.writtenBy.push(loc);
    }
  }

  const variables = Array.from(varMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return jsonResult({
    success: true,
    variableCount: variables.length,
    referenceCount: allRefs.length,
    variables,
  });
}

export const TOOL_DEFINITION = {
  name: 'list_bpmn_process_variables',
  description:
    'List all process variables referenced in a BPMN diagram. Extracts variables from form fields, input/output parameter mappings, condition expressions, script result variables, loop characteristics, call activity variable mappings, and Camunda properties (assignee, candidateGroups, etc.). Returns each variable with its read/write access pattern and the elements that reference it.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
