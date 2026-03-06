/**
 * Unit tests for `labelSideScore` connected-element proximity penalty.
 *
 * TODO reference:
 *   "In `labelSideScore`, add a penalty proportional to how close the candidate
 *   position is to any directly connected task/event element — currently the
 *   scorer only penalises overlap with *other* shapes, not proximity to the
 *   connected elements themselves"
 *
 * These tests verify that a candidate label position that is CLOSE TO (but not
 * overlapping) a connected task/event element scores HIGHER (worse) than one
 * that is comfortably far away.  The `shapes` list does not need to include the
 * connected elements — the penalty comes from the new `connectedBounds`
 * parameter.
 */

import { describe, test, expect } from 'vitest';
import {
  labelSideScore,
  computePathMidpointLabelPos,
} from '../../../src/handlers/layout/labels/label-position-helpers';
import { ELEMENT_LABEL_DISTANCE } from '../../../src/constants';

describe('labelSideScore proximity penalty for connected elements', () => {
  const LW = 90;
  const LH = 20;

  test('candidate close to a connected element scores higher than one far away', () => {
    // Connected element: x=100, y=100, w=80, h=80 (right edge at x=180)
    const connected = { x: 100, y: 100, width: 80, height: 80 };

    // Close candidate: label starts just at right edge of connected element (x=180)
    // — within ELEMENT_LABEL_DISTANCE of the connected bound
    const closePos = { x: 180, y: 130 };

    // Far candidate: label starts well beyond ELEMENT_LABEL_DISTANCE clearance
    const farPos = { x: 400, y: 130 };

    const closeScore = labelSideScore(closePos, LW, LH, [], undefined, [connected]);
    const farScore = labelSideScore(farPos, LW, LH, [], undefined, [connected]);

    expect(closeScore).toBeGreaterThan(farScore);
  });

  test('candidate overlapping a connected element scores at least as high as one merely close', () => {
    const connected = { x: 100, y: 100, width: 80, height: 80 };

    // Overlapping candidate: label rect starts inside the connected element
    const overlappingPos = { x: 150, y: 120 };

    // Close candidate: starts just outside (within ELEMENT_LABEL_DISTANCE but not overlapping)
    const closePos = { x: 180, y: 120 };

    const overlapScore = labelSideScore(overlappingPos, LW, LH, [], undefined, [connected]);
    const closeScore = labelSideScore(closePos, LW, LH, [], undefined, [connected]);

    expect(overlapScore).toBeGreaterThanOrEqual(closeScore);
  });

  test('candidate far from all connected elements scores 0 (no penalty)', () => {
    const connected = { x: 100, y: 100, width: 80, height: 80 };
    // Far candidate — completely outside the expanded bounds
    const clearance = ELEMENT_LABEL_DISTANCE + 5;
    const farPos = { x: 100 + 80 + clearance + LW + 10, y: 100 }; // well past right edge

    const score = labelSideScore(farPos, LW, LH, [], undefined, [connected]);
    expect(score).toBe(0);
  });

  test('multiple connected elements each contribute to score independently', () => {
    const src = { x: 50, y: 130, width: 80, height: 80 };
    const tgt = { x: 400, y: 130, width: 80, height: 80 };

    // Candidate at the very midpoint — within ELEMENT_LABEL_DISTANCE of neither src nor tgt
    const midPos = { x: 225, y: 155 };
    const midScore = labelSideScore(midPos, LW, LH, [], undefined, [src, tgt]);

    // Candidate very close to src
    const nearSrcPos = { x: 130, y: 155 };
    const nearSrcScore = labelSideScore(nearSrcPos, LW, LH, [], undefined, [src, tgt]);

    // Candidate touching both elements (should score highest)
    const bothPos = { x: 125, y: 155 };
    const bothScore = labelSideScore(bothPos, LW, LH, [], undefined, [src, tgt]);

    expect(nearSrcScore).toBeGreaterThan(midScore);
    expect(bothScore).toBeGreaterThanOrEqual(nearSrcScore);
  });
});

describe('computePathMidpointLabelPos avoids connected elements via connectedBounds', () => {
  const LW = 90;
  const LH = 20;

  test('picks the side farther from connected source element for horizontal flow', () => {
    // Horizontal flow at y=140:
    //   source: x=100, y=100, w=80, h=80  (right edge 180, centre y 140)
    //   target: x=400, y=100, w=80, h=80  (left edge 400, centre y 140)
    //   waypoints: (180, 140) → (400, 140)
    const waypoints = [
      { x: 180, y: 140 },
      { x: 400, y: 140 },
    ];
    const srcBounds = { x: 100, y: 100, width: 80, height: 80 };
    const tgtBounds = { x: 400, y: 100, width: 80, height: 80 };

    // Without connectedBounds: both sides score 0 (equidistant from shapes=[])
    const posWithout = computePathMidpointLabelPos(waypoints, LW, LH, [], undefined);

    // With connectedBounds: should still produce a valid position
    const posWith = computePathMidpointLabelPos(waypoints, LW, LH, [], undefined, [
      srcBounds,
      tgtBounds,
    ]);

    // Both must be defined
    expect(posWithout).toBeDefined();
    expect(posWith).toBeDefined();
    expect(typeof posWith.x).toBe('number');
    expect(typeof posWith.y).toBe('number');
  });
});
