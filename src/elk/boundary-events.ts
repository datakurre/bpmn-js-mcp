/**
 * Boundary event repositioning — re-export barrel (J2).
 *
 * This file is the original monolithic boundary-events module, now split
 * into three focused modules for maintainability:
 *
 * - `boundary-save-restore.ts`  — snapshot save/restore (`BoundaryEventSnapshot`,
 *                                  `saveBoundaryEventData`, `restoreBoundaryEventData`)
 * - `boundary-positioning.ts`  — border detection, spreading, and repositioning
 *                                  (`repositionBoundaryEvents`, `detectCurrentBorder`)
 * - `boundary-chains.ts`       — exception chain identification and target repositioning
 *                                  (`identifyBoundaryExceptionChains`,
 *                                   `repositionBoundaryEventTargets`,
 *                                   `alignOffPathEndEventsToSecondRow`,
 *                                   `pushBoundaryTargetsBelowHappyPath`)
 *
 * This barrel re-exports everything for backward compatibility.  Prefer
 * importing from the specific sub-modules in new code.
 */

export type { BoundaryEventSnapshot } from './boundary-save-restore';
export { saveBoundaryEventData, restoreBoundaryEventData } from './boundary-save-restore';
export { repositionBoundaryEvents, detectCurrentBorder } from './boundary-positioning';
export {
  identifyBoundaryExceptionChains,
  identifyBoundaryLeafTargets,
  repositionBoundaryEventTargets,
  alignOffPathEndEventsToSecondRow,
  pushBoundaryTargetsBelowHappyPath,
} from './boundary-chains';
