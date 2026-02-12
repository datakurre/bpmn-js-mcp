/**
 * Post-ELK grid snap — expanded subprocess recursion.
 *
 * Recursively applies gridSnapPass inside expanded subprocesses
 * to handle nested compound nodes.
 */

import { isConnection, isInfrastructure } from './helpers';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { gridSnapPass } from './grid-snap-core';

/**
 * Recursively run gridSnapPass inside expanded subprocesses.
 *
 * Expanded subprocesses are compound nodes whose children are laid out
 * by ELK internally.  The grid snap pass must run separately within each
 * expanded subprocess (scoped to its direct children) to avoid mixing
 * nesting levels.
 */
export function gridSnapExpandedSubprocesses(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  happyPathEdgeIds?: Set<string>,
  container?: BpmnElement,
  baseLayerSpacing?: number
): void {
  // Find expanded subprocesses that are direct children of the given container
  const parentFilter =
    container ||
    elementRegistry.filter(
      (el) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  if (!parentFilter) return;

  const expandedSubs = elementRegistry.filter(
    (el) =>
      el.type === 'bpmn:SubProcess' &&
      el.parent === parentFilter &&
      // Only expanded subprocesses (those with layoutable children)
      elementRegistry.filter(
        (child) =>
          child.parent === el &&
          !isInfrastructure(child.type) &&
          !isConnection(child.type) &&
          child.type !== 'bpmn:BoundaryEvent'
      ).length > 0
  );

  for (const sub of expandedSubs) {
    gridSnapPass(elementRegistry, modeling, happyPathEdgeIds, sub, baseLayerSpacing);
    // Recurse into nested subprocesses
    gridSnapExpandedSubprocesses(
      elementRegistry,
      modeling,
      happyPathEdgeIds,
      sub,
      baseLayerSpacing
    );
  }
}
