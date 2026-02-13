/**
 * Barrel re-export from focused test utility modules.
 *
 * Core diagram utilities (used by ~100 test files) are in `utils/diagram.ts`.
 * Layout comparison, SVG parsing, and BPMN XML comparison are in `utils/layout-comparison.ts`.
 *
 * New tests should import directly from `./utils/diagram` or `./utils/layout-comparison`.
 * This barrel exists for backwards compatibility.
 */

// Core diagram helpers (used by the majority of tests)
export {
  parseResult,
  createDiagram,
  addElement,
  connect,
  connectAll,
  exportXml,
  getRegistry,
  createSimpleProcess,
  clearDiagrams,
  importReference,
  importAndLayout,
} from './utils/diagram';

// Layout comparison helpers (used by ~7 layout regression tests)
export {
  type RefPosition,
  loadReferencePositions,
  type PositionDelta,
  comparePositions,
  type NormalisedDelta,
  compareWithNormalisation,
  type SvgPosition,
  parsePositionsFromSVG,
  loadPositionsFromSVG,
  normaliseBpmnXml,
  extractProcessXml,
  extractBpmnPositions,
  compareBpmnPositions,
  loadReferenceBpmn,
} from './utils/layout-comparison';
