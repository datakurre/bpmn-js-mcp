import { describe, test, expect } from 'vitest';
import {
  rectsOverlap,
  rectsNearby,
  segmentIntersectsRect,
  getTakenConnectionAlignments,
} from '../src/geometry';

describe('geometry', () => {
  describe('rectsOverlap', () => {
    test('detects overlapping rectangles', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 50, y: 40, width: 100, height: 80 };
      expect(rectsOverlap(a, b)).toBe(true);
    });

    test('detects non-overlapping rectangles (side by side)', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 200, y: 0, width: 100, height: 80 };
      expect(rectsOverlap(a, b)).toBe(false);
    });

    test('detects non-overlapping rectangles (above/below)', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 0, y: 100, width: 100, height: 80 };
      expect(rectsOverlap(a, b)).toBe(false);
    });

    test('detects touching but not overlapping rectangles', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 100, y: 0, width: 100, height: 80 }; // exactly touching
      expect(rectsOverlap(a, b)).toBe(false);
    });

    test('detects contained rectangle', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 10, y: 10, width: 20, height: 20 };
      expect(rectsOverlap(a, b)).toBe(true);
    });
  });

  describe('rectsNearby', () => {
    test('detects rects within margin distance', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 105, y: 0, width: 100, height: 80 }; // 5px gap
      expect(rectsNearby(a, b, 10)).toBe(true);
    });

    test('returns false when rects are beyond margin', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 200, y: 0, width: 100, height: 80 }; // 100px gap
      expect(rectsNearby(a, b, 10)).toBe(false);
    });

    test('returns true for overlapping rects', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 50, y: 40, width: 100, height: 80 };
      expect(rectsNearby(a, b, 10)).toBe(true);
    });

    test('detects vertical proximity', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 0, y: 85, width: 100, height: 80 }; // 5px vertical gap
      expect(rectsNearby(a, b, 10)).toBe(true);
    });

    test('returns false for rects beyond margin diagonally', () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 120, y: 100, width: 100, height: 80 };
      expect(rectsNearby(a, b, 10)).toBe(false);
    });
  });

  describe('segmentIntersectsRect', () => {
    test('detects horizontal line crossing a rectangle', () => {
      const p1 = { x: 0, y: 40 };
      const p2 = { x: 200, y: 40 };
      const rect = { x: 50, y: 20, width: 100, height: 40 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(true);
    });

    test('detects vertical line crossing a rectangle', () => {
      const p1 = { x: 100, y: 0 };
      const p2 = { x: 100, y: 200 };
      const rect = { x: 50, y: 50, width: 100, height: 80 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(true);
    });

    test('detects line that misses the rectangle', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      const rect = { x: 50, y: 50, width: 100, height: 80 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(false);
    });

    test('detects line entirely inside rectangle', () => {
      const p1 = { x: 60, y: 60 };
      const p2 = { x: 80, y: 70 };
      const rect = { x: 50, y: 50, width: 100, height: 80 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(true);
    });

    test('detects diagonal line crossing a rectangle', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 200, y: 200 };
      const rect = { x: 50, y: 50, width: 100, height: 100 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(true);
    });
  });
});

// ── getTakenConnectionAlignments ───────────────────────────────────────────

describe('getTakenConnectionAlignments', () => {
  /**
   * Helper to build a minimal connection stub.
   */
  function makeFlow(
    sourceId: string | undefined,
    targetId: string | undefined,
    waypoints: Array<{ x: number; y: number }>
  ) {
    return {
      type: 'bpmn:SequenceFlow',
      source: sourceId !== undefined ? { id: sourceId } : undefined,
      target: targetId !== undefined ? { id: targetId } : undefined,
      waypoints,
    };
  }

  test('returns empty set when element has no connections', () => {
    const element = { x: 100, y: 100, width: 100, height: 80, id: 'task1' };
    const result = getTakenConnectionAlignments(element, []);
    expect(result.size).toBe(0);
  });

  test('returns empty set when connections are not sequence flows', () => {
    const element = { x: 100, y: 100, width: 100, height: 80, id: 'task1' };
    const annotation = {
      type: 'bpmn:Association',
      source: { id: 'task1' },
      target: { id: 'note1' },
      waypoints: [
        { x: 200, y: 140 },
        { x: 300, y: 140 },
      ],
    };
    const result = getTakenConnectionAlignments(element, [annotation]);
    expect(result.size).toBe(0);
  });

  test('incoming flow from the left marks left as taken', () => {
    // Element center at (250, 140). Incoming flow docks at the left edge (x=200, y=140).
    const element = { x: 200, y: 100, width: 100, height: 80, id: 'task1' };
    // midX = 250, midY = 140
    const flow = makeFlow('other', 'task1', [
      { x: 100, y: 140 }, // source end
      { x: 200, y: 140 }, // target end — on left edge; dx = 200-250 = -50 → 'left'
    ]);
    const result = getTakenConnectionAlignments(element, [flow]);
    expect(result.has('left')).toBe(true);
    expect(result.has('right')).toBe(false);
    expect(result.has('top')).toBe(false);
    expect(result.has('bottom')).toBe(false);
  });

  test('outgoing flow to the right marks right as taken', () => {
    // Element center at (150, 140). Outgoing flow exits from right edge (x=200, y=140).
    const element = { x: 100, y: 100, width: 100, height: 80, id: 'task1' };
    // midX = 150, midY = 140
    const flow = makeFlow('task1', 'other', [
      { x: 200, y: 140 }, // source end — on right edge; dx = 200-150 = +50 → 'right'
      { x: 350, y: 140 }, // target end
    ]);
    const result = getTakenConnectionAlignments(element, [flow]);
    expect(result.has('right')).toBe(true);
    expect(result.has('left')).toBe(false);
  });

  test('incoming flow from below marks bottom as taken', () => {
    // Element at (100,100) size 100x80, center at (150, 140).
    // Incoming connection docks at bottom edge: last wp at (150, 180).
    // dy = 180 - 140 = +40 > |dx=0| → 'bottom'.
    const element = { x: 100, y: 100, width: 100, height: 80, id: 'task1' };
    const flow = makeFlow('other', 'task1', [
      { x: 150, y: 300 },
      { x: 150, y: 180 }, // last waypoint at bottom edge
    ]);
    const result = getTakenConnectionAlignments(element, [flow]);
    expect(result.has('bottom')).toBe(true);
    expect(result.has('top')).toBe(false);
  });

  test('outgoing flow going upward marks top as taken', () => {
    // Element center at (150, 140). Outgoing flow exits from top (x=150, y=100).
    // dy = 100 - 140 = -40 < 0, |dy| > |dx=0| → 'top'.
    const element = { x: 100, y: 100, width: 100, height: 80, id: 'task1' };
    const flow = makeFlow('task1', 'other', [
      { x: 150, y: 100 }, // first waypoint at top edge
      { x: 150, y: 0 },
    ]);
    const result = getTakenConnectionAlignments(element, [flow]);
    expect(result.has('top')).toBe(true);
    expect(result.has('bottom')).toBe(false);
  });

  test('multiple connections accumulate multiple alignments', () => {
    const element = { x: 100, y: 100, width: 100, height: 80, id: 'task1' };
    // midX = 150, midY = 140
    const incomingLeft = makeFlow('src1', 'task1', [
      { x: 0, y: 140 },
      { x: 100, y: 140 }, // left edge
    ]);
    const outgoingRight = makeFlow('task1', 'tgt1', [
      { x: 200, y: 140 }, // right edge
      { x: 350, y: 140 },
    ]);
    const result = getTakenConnectionAlignments(element, [incomingLeft, outgoingRight]);
    expect(result.has('left')).toBe(true);
    expect(result.has('right')).toBe(true);
    expect(result.has('top')).toBe(false);
    expect(result.has('bottom')).toBe(false);
  });

  test('ignores flows not connected to the element', () => {
    const element = { x: 100, y: 100, width: 100, height: 80, id: 'task1' };
    const unrelatedFlow = makeFlow('other1', 'other2', [
      { x: 400, y: 200 },
      { x: 500, y: 200 },
    ]);
    const result = getTakenConnectionAlignments(element, [unrelatedFlow]);
    expect(result.size).toBe(0);
  });

  test('handles message flows as well as sequence flows', () => {
    const element = { x: 100, y: 100, width: 100, height: 80, id: 'task1' };
    const msgFlow = {
      type: 'bpmn:MessageFlow',
      source: { id: 'task1' },
      target: { id: 'other' },
      waypoints: [
        { x: 200, y: 140 },
        { x: 350, y: 140 },
      ],
    };
    const result = getTakenConnectionAlignments(element, [msgFlow]);
    expect(result.has('right')).toBe(true);
  });
});
