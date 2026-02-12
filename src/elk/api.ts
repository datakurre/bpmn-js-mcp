/**
 * Public API for the ELK-based layout engine.
 *
 * This module defines the stable public surface of the `src/elk/` module.
 * External consumers (handlers, tests) should import from here rather
 * than reaching into internal implementation files.
 *
 * @see ADR-003 for rationale on using elkjs over bpmn-auto-layout.
 */

export { elkLayout, elkLayoutSubset } from './index';
export type { ElkLayoutOptions, CrossingFlowsResult, GridLayer } from './types';
