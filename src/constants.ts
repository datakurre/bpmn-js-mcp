/**
 * Centralised magic numbers and element-size constants.
 *
 * Keeps layout-related values in one place so changes propagate
 * consistently across all handlers that do positioning / spacing.
 */

/** Standard edge-to-edge gap in pixels between BPMN elements. */
export const STANDARD_BPMN_GAP = 50;

/**
 * ELK-specific spacing constants.
 *
 * Tuned to match bpmn-js's built-in auto-place spacing (~58px average
 * edge-to-edge gaps, ~110px vertical branch separation).  Kept separate
 * from STANDARD_BPMN_GAP which is used for auto-positioning in
 * add-element.ts and connection routing fallbacks.
 */
export const ELK_LAYER_SPACING = 60;
export const ELK_NODE_SPACING = 50;
export const ELK_EDGE_NODE_SPACING = 15;

/**
 * Default element sizes used for layout calculations.
 *
 * These mirror the bpmn-js defaults for each element category.
 */
export const ELEMENT_SIZES: Readonly<Record<string, { width: number; height: number }>> = {
  task: { width: 100, height: 80 },
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 },
  subprocess: { width: 350, height: 200 },
  participant: { width: 600, height: 250 },
  textAnnotation: { width: 100, height: 30 },
  dataObject: { width: 36, height: 50 },
  dataStore: { width: 50, height: 50 },
  group: { width: 300, height: 200 },
  default: { width: 100, height: 80 },
};

/** Look up the default size for a given BPMN element type string. */
// ── Label positioning constants ────────────────────────────────────────────

/** Distance between element edge and external label. */
export const ELEMENT_LABEL_DISTANCE = 10;

/**
 * Extra distance for labels placed below events.
 * Start/End event labels placed at the default gap look vertically
 * too close, so we add extra spacing for the bottom position.
 */
export const ELEMENT_LABEL_BOTTOM_EXTRA = 5;

/** Default external label dimensions (matches bpmn-js). */
export const DEFAULT_LABEL_SIZE = { width: 90, height: 20 };

/** Preferred label position priority (customizable). */
export const LABEL_POSITION_PRIORITY: readonly ('top' | 'bottom' | 'left' | 'right')[] = [
  'top',
  'bottom',
  'left',
  'right',
];

/** Indent offset for flow (connection) labels from midpoint (matches bpmn-js). */
export const FLOW_LABEL_INDENT = 15;

/**
 * Proximity margin (px) for label-to-shape distance scoring.
 * Labels within this distance of a shape receive a proximity penalty
 * even when they don't overlap, improving readability.
 */
export const LABEL_SHAPE_PROXIMITY_MARGIN = 10;

// ── Element size helpers ───────────────────────────────────────────────────

export function getElementSize(elementType: string): { width: number; height: number } {
  if (elementType.includes('Gateway')) return ELEMENT_SIZES.gateway;
  if (elementType.includes('Event')) return ELEMENT_SIZES.event;
  if (elementType === 'bpmn:SubProcess') return ELEMENT_SIZES.subprocess;
  if (elementType === 'bpmn:Participant') return ELEMENT_SIZES.participant;
  if (elementType === 'bpmn:TextAnnotation') return ELEMENT_SIZES.textAnnotation;
  if (elementType === 'bpmn:DataObjectReference') return ELEMENT_SIZES.dataObject;
  if (elementType === 'bpmn:DataStoreReference') return ELEMENT_SIZES.dataStore;
  if (elementType === 'bpmn:Group') return ELEMENT_SIZES.group;
  if (elementType.includes('Task') || elementType === 'bpmn:CallActivity') {
    return ELEMENT_SIZES.task;
  }
  return ELEMENT_SIZES.default;
}
