import { describe, it, expect } from "vitest";
import {
  rectsOverlap,
  segmentIntersectsRect,
  getLabelCandidatePositions,
  scoreLabelPosition,
} from "../../src/handlers/label-utils";

describe("label-utils", () => {
  describe("rectsOverlap", () => {
    it("detects overlapping rectangles", () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 50, y: 40, width: 100, height: 80 };
      expect(rectsOverlap(a, b)).toBe(true);
    });

    it("detects non-overlapping rectangles (side by side)", () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 200, y: 0, width: 100, height: 80 };
      expect(rectsOverlap(a, b)).toBe(false);
    });

    it("detects non-overlapping rectangles (above/below)", () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 0, y: 100, width: 100, height: 80 };
      expect(rectsOverlap(a, b)).toBe(false);
    });

    it("detects touching but not overlapping rectangles", () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 100, y: 0, width: 100, height: 80 }; // exactly touching
      expect(rectsOverlap(a, b)).toBe(false);
    });

    it("detects contained rectangle", () => {
      const a = { x: 0, y: 0, width: 100, height: 80 };
      const b = { x: 10, y: 10, width: 20, height: 20 };
      expect(rectsOverlap(a, b)).toBe(true);
    });
  });

  describe("segmentIntersectsRect", () => {
    it("detects horizontal line crossing a rectangle", () => {
      const p1 = { x: 0, y: 40 };
      const p2 = { x: 200, y: 40 };
      const rect = { x: 50, y: 20, width: 100, height: 40 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(true);
    });

    it("detects vertical line crossing a rectangle", () => {
      const p1 = { x: 100, y: 0 };
      const p2 = { x: 100, y: 200 };
      const rect = { x: 50, y: 50, width: 100, height: 80 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(true);
    });

    it("detects line that misses the rectangle", () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      const rect = { x: 50, y: 50, width: 100, height: 80 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(false);
    });

    it("detects line entirely inside rectangle", () => {
      const p1 = { x: 60, y: 60 };
      const p2 = { x: 80, y: 70 };
      const rect = { x: 50, y: 50, width: 100, height: 80 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(true);
    });

    it("detects diagonal line crossing a rectangle", () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 200, y: 200 };
      const rect = { x: 50, y: 50, width: 100, height: 100 };
      expect(segmentIntersectsRect(p1, p2, rect)).toBe(true);
    });
  });

  describe("getLabelCandidatePositions", () => {
    it("returns 4 candidates (top, bottom, left, right)", () => {
      const element = { x: 100, y: 100, width: 50, height: 50 };
      const candidates = getLabelCandidatePositions(element);
      expect(candidates).toHaveLength(4);
      const orientations = candidates.map((c) => c.orientation);
      expect(orientations).toContain("top");
      expect(orientations).toContain("bottom");
      expect(orientations).toContain("left");
      expect(orientations).toContain("right");
    });

    it("positions are offset from the element edges", () => {
      const element = { x: 100, y: 100, width: 50, height: 50 };
      const candidates = getLabelCandidatePositions(element);
      const top = candidates.find((c) => c.orientation === "top")!;
      const bottom = candidates.find((c) => c.orientation === "bottom")!;

      // Top label should be above element
      expect(top.rect.y + top.rect.height).toBeLessThanOrEqual(element.y);
      // Bottom label should be below element
      expect(bottom.rect.y).toBeGreaterThanOrEqual(element.y + element.height);
    });

    it("candidates have proper width and height", () => {
      const element = { x: 100, y: 100, width: 50, height: 50 };
      const candidates = getLabelCandidatePositions(element);
      for (const c of candidates) {
        expect(c.rect.width).toBe(90); // DEFAULT_LABEL_SIZE.width
        expect(c.rect.height).toBe(20); // DEFAULT_LABEL_SIZE.height
      }
    });
  });

  describe("scoreLabelPosition", () => {
    it("returns 0 for a position with no collisions", () => {
      const rect = { x: 0, y: 0, width: 90, height: 20 };
      const segments: [{ x: number; y: number }, { x: number; y: number }][] = [
        [{ x: 500, y: 500 }, { x: 600, y: 600 }],
      ];
      expect(scoreLabelPosition(rect, segments, [])).toBe(0);
    });

    it("scores higher for positions that intersect connections", () => {
      const rect = { x: 0, y: 0, width: 100, height: 40 };
      const segments: [{ x: number; y: number }, { x: number; y: number }][] = [
        [{ x: 50, y: -10 }, { x: 50, y: 50 }], // crosses through the rect
      ];
      const score = scoreLabelPosition(rect, segments, []);
      expect(score).toBeGreaterThan(0);
    });

    it("scores higher for positions that overlap other labels", () => {
      const rect = { x: 0, y: 0, width: 90, height: 20 };
      const otherLabels = [{ x: 10, y: 5, width: 90, height: 20 }];
      const score = scoreLabelPosition(rect, [], otherLabels);
      expect(score).toBeGreaterThan(0);
    });

    it("penalizes host overlap heavily for boundary events", () => {
      const rect = { x: 100, y: 100, width: 90, height: 20 };
      const hostRect = { x: 80, y: 80, width: 100, height: 80 };
      const score = scoreLabelPosition(rect, [], [], hostRect);
      expect(score).toBeGreaterThanOrEqual(10);
    });
  });
});
