/**
 * Custom bpmnlint rule: undefined-variable
 *
 * Warns when a process variable is read (in condition expressions, input
 * parameter expressions, assignee expressions, etc.) but never written
 * (by form fields, output parameters, result variables, etc.) within
 * the same process scope.
 *
 * Variables can be defined through:
 * - Form fields (camunda:FormData → camunda:FormField)
 * - Output parameters (camunda:InputOutput → camunda:OutputParameter)
 * - Script task result variables (camunda:resultVariable)
 * - Loop element variables (camunda:elementVariable)
 * - Call activity out-mappings (camunda:Out → target)
 *
 * Variables are read through:
 * - Condition expressions on sequence flows
 * - Input parameters with expressions (camunda:InputParameter)
 * - Camunda properties: assignee, candidateGroups, candidateUsers, etc.
 * - Form field default values with expressions
 * - Loop collection references
 * - Loop completion conditions
 */

import { isType } from '../utils';

/** Common JUEL keywords and built-in variables to ignore. */
const JUEL_BUILTINS = new Set([
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
  // Execution context variables (not process variables)
  'execution',
  'task',
  'delegateTask',
  'externalTask',
  'connector',
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

/** Camunda properties that may contain variable expressions. */
const CAMUNDA_EXPR_ATTRS = [
  'camunda:assignee',
  'camunda:candidateGroups',
  'camunda:candidateUsers',
  'camunda:dueDate',
  'camunda:followUpDate',
  'camunda:priority',
];

/**
 * Extract variable names from a JUEL/UEL expression string.
 * Looks for `${...}` patterns and extracts identifier-like tokens.
 */
function extractExpressionVars(expr: string): string[] {
  if (!expr || typeof expr !== 'string') return [];
  const vars: string[] = [];
  const exprPattern = /\$\{([^}]+)}/g;
  let match;
  while ((match = exprPattern.exec(expr)) !== null) {
    const body = match[1];
    const identPattern = /\b([a-zA-Z_]\w*)\b/g;
    let idMatch;
    while ((idMatch = identPattern.exec(body)) !== null) {
      const id = idMatch[1];
      if (
        !JUEL_BUILTINS.has(id) &&
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

interface VarRef {
  name: string;
  elementId: string;
  access: 'read' | 'write';
}

/** Push expression-read refs into the refs array. */
function pushExprReads(refs: VarRef[], expr: string, elementId: string): void {
  for (const v of extractExpressionVars(expr)) {
    refs.push({ name: v, elementId, access: 'read' });
  }
}

/** Extract variable references from camunda:FormData. */
function collectFromFormData(ext: any, elementId: string): VarRef[] {
  const refs: VarRef[] = [];
  for (const field of ext.fields || []) {
    if (field.id) refs.push({ name: field.id, elementId, access: 'write' });
    if (field.defaultValue) pushExprReads(refs, field.defaultValue, elementId);
  }
  return refs;
}

/** Extract variable references from camunda:InputOutput parameters. */
function collectFromInputOutput(ext: any, elementId: string): VarRef[] {
  const refs: VarRef[] = [];
  for (const param of ext.inputParameters || []) {
    if (param.name) refs.push({ name: param.name, elementId, access: 'write' });
    if (param.value) pushExprReads(refs, param.value, elementId);
  }
  for (const param of ext.outputParameters || []) {
    if (param.name) refs.push({ name: param.name, elementId, access: 'write' });
    if (param.value) pushExprReads(refs, param.value, elementId);
  }
  return refs;
}

/** Extract variable references from camunda:In / camunda:Out mappings. */
function collectFromCallActivityMapping(ext: any, elementId: string): VarRef[] {
  const refs: VarRef[] = [];
  const isOut = ext.$type === 'camunda:Out';
  if (ext.target) refs.push({ name: ext.target, elementId, access: isOut ? 'write' : 'write' });
  if (ext.source) refs.push({ name: ext.source, elementId, access: 'read' });
  if (ext.sourceExpression) pushExprReads(refs, ext.sourceExpression, elementId);
  return refs;
}

/** Extract variable references from extension elements. */
function collectFromExtensions(el: any): VarRef[] {
  const refs: VarRef[] = [];
  const exts = el.extensionElements?.values || [];
  for (const ext of exts) {
    switch (ext.$type) {
      case 'camunda:FormData':
        refs.push(...collectFromFormData(ext, el.id));
        break;
      case 'camunda:InputOutput':
        refs.push(...collectFromInputOutput(ext, el.id));
        break;
      case 'camunda:In':
      case 'camunda:Out':
        refs.push(...collectFromCallActivityMapping(ext, el.id));
        break;
    }
  }
  return refs;
}

/** Extract variable references from loop characteristics. */
function collectFromLoopCharacteristics(lc: any, elementId: string): VarRef[] {
  const refs: VarRef[] = [];
  const collection = lc.$attrs?.['camunda:collection'] ?? lc.collection;
  if (collection && typeof collection === 'string') {
    if (collection.includes('${')) {
      pushExprReads(refs, collection, elementId);
    } else {
      refs.push({ name: collection, elementId, access: 'read' });
    }
  }
  const elemVar = lc.$attrs?.['camunda:elementVariable'] ?? lc.elementVariable;
  if (elemVar && typeof elemVar === 'string') {
    refs.push({ name: elemVar, elementId, access: 'write' });
  }
  if (lc.completionCondition?.body) {
    pushExprReads(refs, lc.completionCondition.body, elementId);
  }
  return refs;
}

/** Collect all variable references from a single flow element. */
function collectVarsFromElement(el: any): VarRef[] {
  const refs: VarRef[] = [];
  const elementId = el.id;

  refs.push(...collectFromExtensions(el));

  // Script task result variable → write
  const resultVar = el.$attrs?.['camunda:resultVariable'] ?? el.resultVariable;
  if (resultVar && typeof resultVar === 'string') {
    refs.push({ name: resultVar, elementId, access: 'write' });
  }

  // Condition expression → read
  if (el.conditionExpression?.body) {
    pushExprReads(refs, el.conditionExpression.body, elementId);
  }

  // Camunda expression properties → read
  for (const attr of CAMUNDA_EXPR_ATTRS) {
    const shortKey = attr.replace('camunda:', '');
    const val = el.$attrs?.[attr] ?? el[shortKey];
    if (val && typeof val === 'string') {
      pushExprReads(refs, val, elementId);
    }
  }

  // Loop characteristics
  if (el.loopCharacteristics) {
    refs.push(...collectFromLoopCharacteristics(el.loopCharacteristics, elementId));
  }

  return refs;
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Only check at the process/subprocess level
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];
    if (flowElements.length === 0) return;

    // Collect all variable references across all flow elements
    const allRefs: VarRef[] = [];
    for (const el of flowElements) {
      allRefs.push(...collectVarsFromElement(el));
    }

    // Build sets of written and read variables
    const writtenVars = new Set<string>();
    for (const ref of allRefs) {
      if (ref.access === 'write') writtenVars.add(ref.name);
    }

    // Report variables that are read but never written
    // Group by variable name to avoid duplicate reports on the same element
    const reported = new Set<string>();
    for (const ref of allRefs) {
      if (ref.access !== 'read') continue;
      if (writtenVars.has(ref.name)) continue;
      // Deduplicate: only report once per variable per element
      const key = `${ref.elementId}:${ref.name}`;
      if (reported.has(key)) continue;
      reported.add(key);

      reporter.report(
        ref.elementId,
        `Variable "${ref.name}" is used but never defined in this process — ` +
          `ensure it is set by a form field, output parameter, result variable, or upstream process`
      );
    }
  }

  return { check };
}

export default ruleFactory;
