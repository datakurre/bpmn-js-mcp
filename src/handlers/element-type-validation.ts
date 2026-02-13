/**
 * Runtime validation for BPMN element types with "did you mean?" suggestions.
 *
 * Provides user-friendly error messages when an invalid elementType is passed
 * to add_bpmn_element or insert_bpmn_element, including case-insensitive
 * closest-match suggestions.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * All valid element types accepted by add_bpmn_element.
 * Kept in sync with the enum in add-element-schema.ts.
 */
export const ALLOWED_ELEMENT_TYPES = [
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
  'bpmn:SubProcess',
  'bpmn:TextAnnotation',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:Group',
  'bpmn:Participant',
  'bpmn:Lane',
] as const;

/**
 * Subset of element types accepted by insert_bpmn_element (no artifacts, pools, or lanes).
 */
export const INSERTABLE_ELEMENT_TYPES = [
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:SubProcess',
  'bpmn:StartEvent',
  'bpmn:EndEvent',
] as const;

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Find the closest matching element type(s) using case-insensitive comparison
 * and Levenshtein distance.
 */
function findClosestTypes(input: string, allowedTypes: readonly string[]): string[] {
  const inputLower = input.toLowerCase();

  // First try exact case-insensitive match
  const caseMatch = allowedTypes.filter((t) => t.toLowerCase() === inputLower);
  if (caseMatch.length > 0) return caseMatch;

  // Fall back to Levenshtein distance
  const scored = allowedTypes.map((t) => ({
    type: t,
    distance: levenshtein(inputLower, t.toLowerCase()),
  }));
  scored.sort((a, b) => a.distance - b.distance);

  const bestDistance = scored[0].distance;
  // Only suggest if distance is reasonable (< 50% of input length)
  const threshold = Math.max(3, Math.floor(input.length * 0.5));
  if (bestDistance > threshold) return [];

  return scored.filter((s) => s.distance === bestDistance).map((s) => s.type);
}

/**
 * Validate an element type string against the allowed types.
 * Throws an McpError with "did you mean?" suggestions for invalid types.
 */
export function validateElementType(
  elementType: string,
  allowedTypes: readonly string[] = ALLOWED_ELEMENT_TYPES
): void {
  if ((allowedTypes as readonly string[]).includes(elementType)) return;

  const suggestions = findClosestTypes(elementType, allowedTypes);
  const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';

  throw new McpError(
    ErrorCode.InvalidParams,
    `Invalid elementType "${elementType}".${suggestionText} Allowed values: ${allowedTypes.join(', ')}`
  );
}
