import { describe, test, expect } from 'vitest';
import {
  rectsOverlap,
  rectsNearby,
  segmentIntersectsRect,
  getLabelCandidatePositions,
  scoreLabelPosition,
} from '../../../src/handlers/layout/labels/label-utils';

describe('label-utils', () => {
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

  describe('getLabelCandidatePositions', () => {
    test('returns 8 candidates (4 cardinal + 4 diagonal)', () => {
      const element = { x: 100, y: 100, width: 50, height: 50 };
      const candidates = getLabelCandidatePositions(element);
      expect(candidates).toHaveLength(8);
      const orientations = candidates.map((c) => c.orientation);
      expect(orientations).toContain('top');
      expect(orientations).toContain('bottom');
      expect(orientations).toContain('left');
      expect(orientations).toContain('right');
    });

    test('positions are offset from the element edges', () => {
      const element = { x: 100, y: 100, width: 50, height: 50 };
      const candidates = getLabelCandidatePositions(element);
      const top = candidates.find((c) => c.orientation === 'top')!;
      const bottom = candidates.find((c) => c.orientation === 'bottom')!;

      // Top label should be above element
      expect(top.rect.y + top.rect.height).toBeLessThanOrEqual(element.y);
      // Bottom label should be below element
      expect(bottom.rect.y).toBeGreaterThanOrEqual(element.y + element.height);
    });

    test('bottom label includes ELEMENT_LABEL_BOTTOM_EXTRA spacing', () => {
      const element = { x: 100, y: 100, width: 36, height: 36 };
      const candidates = getLabelCandidatePositions(element);
      const bottom = candidates.find((c) => c.orientation === 'bottom')!;

      // Bottom gap should be ELEMENT_LABEL_DISTANCE + ELEMENT_LABEL_BOTTOM_EXTRA = 15
      const actualGap = bottom.rect.y - (element.y + element.height);
      expect(actualGap).toBe(15); // 10 + 5
    });

    test('candidates have proper width and height', () => {
      const element = { x: 100, y: 100, width: 50, height: 50 };
      const candidates = getLabelCandidatePositions(element);
      for (const c of candidates) {
        expect(c.rect.width).toBe(90); // DEFAULT_LABEL_SIZE.width
        expect(c.rect.height).toBe(20); // DEFAULT_LABEL_SIZE.height
      }
    });
  });

  describe('scoreLabelPosition', () => {
    test('returns 0 for a position with no collisions', () => {
      const rect = { x: 0, y: 0, width: 90, height: 20 };
      const segments: [{ x: number; y: number }, { x: number; y: number }][] = [
        [
          { x: 500, y: 500 },
          { x: 600, y: 600 },
        ],
      ];
      expect(scoreLabelPosition(rect, segments, [])).toBe(0);
    });

    test('scores higher for positions that intersect connections', () => {
      const rect = { x: 0, y: 0, width: 100, height: 40 };
      const segments: [{ x: number; y: number }, { x: number; y: number }][] = [
        [
          { x: 50, y: -10 },
          { x: 50, y: 50 },
        ], // crosses through the rect
      ];
      const score = scoreLabelPosition(rect, segments, []);
      expect(score).toBeGreaterThan(0);
    });

    test('scores higher for positions that overlap other labels', () => {
      const rect = { x: 0, y: 0, width: 90, height: 20 };
      const otherLabels = [{ x: 10, y: 5, width: 90, height: 20 }];
      const score = scoreLabelPosition(rect, [], otherLabels);
      expect(score).toBeGreaterThan(0);
    });

    test('penalizes host overlap heavily for boundary events', () => {
      const rect = { x: 100, y: 100, width: 90, height: 20 };
      const hostRect = { x: 80, y: 80, width: 100, height: 80 };
      const score = scoreLabelPosition(rect, [], [], hostRect);
      expect(score).toBeGreaterThanOrEqual(10);
    });

    test('penalizes labels too close to shapes (proximity)', () => {
      const rect = { x: 0, y: 0, width: 90, height: 20 };
      // Shape is 5px to the right of the label — close but not overlapping
      const shapeRects = [{ x: 95, y: 0, width: 100, height: 80 }];
      const score = scoreLabelPosition(rect, [], [], undefined, shapeRects);
      expect(score).toBeGreaterThan(0); // proximity penalty
    });

    test('gives no proximity penalty when shapes are far away', () => {
      const rect = { x: 0, y: 0, width: 90, height: 20 };
      // Shape is 100px away — well beyond proximity margin
      const shapeRects = [{ x: 200, y: 0, width: 100, height: 80 }];
      const score = scoreLabelPosition(rect, [], [], undefined, shapeRects);
      expect(score).toBe(0);
    });
  });
});
