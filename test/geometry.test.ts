import { describe, test, expect } from 'vitest';
import { rectsOverlap, rectsNearby, segmentIntersectsRect } from './utils/geometry';

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
