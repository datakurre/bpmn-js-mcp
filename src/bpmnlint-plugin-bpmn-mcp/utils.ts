/**
 * Shared utilities for bpmnlint rules.
 *
 * Every custom rule needs to check BPMN element types via `$instanceOf`
 * (when available on the moddle object) or fall back to `$type` string
 * comparison.  This module extracts that common helper so individual
 * rule files stay focused on their domain logic.
 */

/** BPMN moddle node — the subset of properties used by lint rules. */
export interface BpmnNode {
  readonly $type: string;
  readonly $instanceOf?: (type: string) => boolean;
  [key: string]: any;
}

/** bpmnlint reporter callback. */
export type Reporter = (node: BpmnNode, message: string) => void;

/**
 * Check whether a BPMN moddle node matches a given type string.
 *
 * Prefers `$instanceOf` (respects moddle type hierarchy) and falls
 * back to an exact `$type` string comparison when the method is absent.
 */
export const isType = (node: BpmnNode, type: string): boolean =>
  node.$instanceOf ? node.$instanceOf(type) : node.$type === type;
