/**
 * Headless getBBox polyfill for SVG elements.
 *
 * Provides element-type-aware bounding box estimation for the subset of
 * SVG elements that bpmn-js uses: text/tspan, rect, circle, ellipse,
 * polygon/polyline, line, and container elements (g, svg).
 *
 * Also provides getComputedTextLength estimation based on character count.
 */

// ── Text metric constants ──────────────────────────────────────────────────

/** Approximate average character width in px for the default bpmn-js font. */
export const AVG_CHAR_WIDTH = 7;
/** Approximate line height in px for the default bpmn-js font. */
const LINE_HEIGHT = 14;
/** Default line width for text wrapping estimation. */
const DEFAULT_WRAP_WIDTH = 90;

// ── Geometry helpers ───────────────────────────────────────────────────────

/**
 * Parse an SVG points attribute (e.g. "10,20 30,40 50,60") and compute
 * the bounding box.
 */
function parseSvgPointsBBox(points: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const coords = points
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (coords.length < 2 || coords.some(isNaN)) {
    return { x: 0, y: 0, width: 100, height: 80 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < coords.length - 1; i += 2) {
    const px = coords[i];
    const py = coords[i + 1];
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX || 1,
    height: maxY - minY || 1,
  };
}

/**
 * Estimate bounding box dimensions for a text/tspan SVG element based on
 * its textContent.  Returns { width, height } proportional to character
 * count and line breaks.
 */
function estimateTextBBox(textContent: string): { width: number; height: number } {
  if (!textContent || textContent.trim().length === 0) {
    return { width: 0, height: 0 };
  }
  const lines = textContent.split('\n');
  const maxLineLen = Math.max(...lines.map((l) => l.length));
  const rawWidth = maxLineLen * AVG_CHAR_WIDTH;

  // Simulate wrapping: if text is wider than the default wrap width,
  // estimate wrapped line count
  if (rawWidth > DEFAULT_WRAP_WIDTH) {
    const charsPerLine = Math.floor(DEFAULT_WRAP_WIDTH / AVG_CHAR_WIDTH);
    let wrappedLines = 0;
    for (const line of lines) {
      wrappedLines += Math.max(1, Math.ceil(line.length / charsPerLine));
    }
    return { width: DEFAULT_WRAP_WIDTH, height: wrappedLines * LINE_HEIGHT };
  }

  return { width: rawWidth, height: lines.length * LINE_HEIGHT };
}

// ── getBBox polyfill ───────────────────────────────────────────────────────

/**
 * Element-type-aware bounding box estimation.
 * Handles text/tspan, rect, circle, ellipse, polygon, polyline, line,
 * and container elements (g, svg).
 */
// eslint-disable-next-line complexity
export function polyfillGetBBox(element: any): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const tag = element.tagName?.toLowerCase();
  if (tag === 'text' || tag === 'tspan') {
    const text: string = element.textContent || '';
    const bbox = estimateTextBBox(text);
    return { x: 0, y: 0, width: bbox.width, height: bbox.height };
  }
  if (tag === 'rect') {
    const w = parseFloat(element.getAttribute('width')) || 100;
    const h = parseFloat(element.getAttribute('height')) || 80;
    const x = parseFloat(element.getAttribute('x')) || 0;
    const y = parseFloat(element.getAttribute('y')) || 0;
    return { x, y, width: w, height: h };
  }
  if (tag === 'circle') {
    const r = parseFloat(element.getAttribute('r')) || 18;
    const cx = parseFloat(element.getAttribute('cx')) || r;
    const cy = parseFloat(element.getAttribute('cy')) || r;
    return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
  }
  if (tag === 'ellipse') {
    const rx = parseFloat(element.getAttribute('rx')) || 50;
    const ry = parseFloat(element.getAttribute('ry')) || 30;
    const cx = parseFloat(element.getAttribute('cx')) || rx;
    const cy = parseFloat(element.getAttribute('cy')) || ry;
    return { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry };
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const points: string = element.getAttribute('points') || '';
    return parseSvgPointsBBox(points);
  }
  if (tag === 'line') {
    const x1 = parseFloat(element.getAttribute('x1')) || 0;
    const y1 = parseFloat(element.getAttribute('y1')) || 0;
    const x2 = parseFloat(element.getAttribute('x2')) || 0;
    const y2 = parseFloat(element.getAttribute('y2')) || 0;
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    return {
      x: minX,
      y: minY,
      width: Math.abs(x2 - x1) || 1,
      height: Math.abs(y2 - y1) || 1,
    };
  }
  if (tag === 'g' || tag === 'svg') {
    // Container elements: try to compute from children or fall back
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const children = element.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.getBBox) {
        try {
          const cb = child.getBBox();
          if (cb.width > 0 || cb.height > 0) {
            if (cb.x < minX) minX = cb.x;
            if (cb.y < minY) minY = cb.y;
            if (cb.x + cb.width > maxX) maxX = cb.x + cb.width;
            if (cb.y + cb.height > maxY) maxY = cb.y + cb.height;
          }
        } catch {
          // skip
        }
      }
    }
    if (minX !== Infinity) {
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    return { x: 0, y: 0, width: 100, height: 80 };
  }
  // Fallback for path and other elements
  return { x: 0, y: 0, width: 100, height: 80 };
}

/**
 * Estimate computed text length based on character count.
 */
export function polyfillGetComputedTextLength(element: any): number {
  const text: string = element.textContent || '';
  return text.length * AVG_CHAR_WIDTH;
}
