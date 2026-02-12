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

// ── Proportional character width table (Arial) ─────────────────────────────

/**
 * Character width ratios relative to font size for Arial.
 *
 * These ratios were measured from the Arial font and represent the
 * advance width of each character as a fraction of the font's em size.
 * To get pixel width: `ratio * fontSize`.
 *
 * Coverage: ASCII printable range (32–126) plus common Unicode chars.
 * Characters not in the table fall back to `DEFAULT_CHAR_RATIO`.
 */
const DEFAULT_CHAR_RATIO = 0.55;

const ARIAL_CHAR_RATIOS: Record<string, number> = {
  // Whitespace and punctuation
  ' ': 0.278,
  '!': 0.278,
  '"': 0.355,
  '#': 0.556,
  $: 0.556,
  '%': 0.889,
  '&': 0.667,
  "'": 0.191,
  '(': 0.333,
  ')': 0.333,
  '*': 0.389,
  '+': 0.584,
  ',': 0.278,
  '-': 0.333,
  '.': 0.278,
  '/': 0.278,

  // Digits
  '0': 0.556,
  '1': 0.556,
  '2': 0.556,
  '3': 0.556,
  '4': 0.556,
  '5': 0.556,
  '6': 0.556,
  '7': 0.556,
  '8': 0.556,
  '9': 0.556,

  // Punctuation
  ':': 0.278,
  ';': 0.278,
  '<': 0.584,
  '=': 0.584,
  '>': 0.584,
  '?': 0.556,
  '@': 1.015,

  // Uppercase
  A: 0.667,
  B: 0.667,
  C: 0.722,
  D: 0.722,
  E: 0.667,
  F: 0.611,
  G: 0.778,
  H: 0.722,
  I: 0.278,
  J: 0.5,
  K: 0.667,
  L: 0.556,
  M: 0.833,
  N: 0.722,
  O: 0.778,
  P: 0.667,
  Q: 0.778,
  R: 0.722,
  S: 0.667,
  T: 0.611,
  U: 0.722,
  V: 0.667,
  W: 0.944,
  X: 0.667,
  Y: 0.667,
  Z: 0.611,

  // Brackets and special
  '[': 0.278,
  '\\': 0.278,
  ']': 0.278,
  '^': 0.469,
  _: 0.556,
  '`': 0.333,

  // Lowercase
  a: 0.556,
  b: 0.556,
  c: 0.5,
  d: 0.556,
  e: 0.556,
  f: 0.278,
  g: 0.556,
  h: 0.556,
  i: 0.222,
  j: 0.222,
  k: 0.5,
  l: 0.222,
  m: 0.833,
  n: 0.556,
  o: 0.556,
  p: 0.556,
  q: 0.556,
  r: 0.333,
  s: 0.5,
  t: 0.278,
  u: 0.556,
  v: 0.5,
  w: 0.722,
  x: 0.5,
  y: 0.5,
  z: 0.5,

  // Remaining ASCII
  '{': 0.334,
  '|': 0.26,
  '}': 0.334,
  '~': 0.584,
};

/**
 * Measure the pixel width of a string using proportional Arial metrics.
 * Falls back to the flat `AVG_CHAR_WIDTH` estimate if font size is unknown.
 */
function measureTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const ratio = ARIAL_CHAR_RATIOS[text[i]] ?? DEFAULT_CHAR_RATIO;
    width += ratio * fontSize;
  }
  return width;
}

/**
 * Extract font size in px from an SVG element's style attribute.
 * Returns undefined if not set or not parseable.
 */
function getFontSize(el: any): number | undefined {
  // tiny-svg sets CSS properties via node.style
  const styleAttr: string | undefined =
    el.style?.fontSize || el.style?.['font-size'] || el.getAttribute?.('font-size');
  if (!styleAttr) return undefined;
  const parsed = parseFloat(String(styleAttr));
  return isNaN(parsed) ? undefined : parsed;
}

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
 * its textContent and font metrics.  Returns { width, height } using
 * proportional character widths when fontSize is known.
 */
function estimateTextBBox(
  textContent: string,
  fontSize?: number
): { width: number; height: number } {
  if (!textContent || textContent.trim().length === 0) {
    return { width: 0, height: 0 };
  }
  const lines = textContent.split('\n');

  // Use proportional measurement when font size is known
  const lineWidths = fontSize
    ? lines.map((l) => measureTextWidth(l, fontSize))
    : lines.map((l) => l.length * AVG_CHAR_WIDTH);
  const rawWidth = Math.max(...lineWidths);

  const lineHeight = fontSize ? Math.round(fontSize * 1.2) : LINE_HEIGHT;

  // Simulate wrapping: if text is wider than the default wrap width,
  // estimate wrapped line count
  if (rawWidth > DEFAULT_WRAP_WIDTH) {
    if (fontSize) {
      // Proportional wrapping: estimate chars-per-line based on average char width
      const totalChars = lines.reduce((sum, l) => sum + l.length, 0);
      const avgCharWidth = rawWidth / Math.max(1, totalChars / lines.length);
      const charsPerLine = Math.floor(DEFAULT_WRAP_WIDTH / avgCharWidth);
      let wrappedLines = 0;
      for (const line of lines) {
        wrappedLines += Math.max(1, Math.ceil(line.length / Math.max(1, charsPerLine)));
      }
      return { width: DEFAULT_WRAP_WIDTH, height: wrappedLines * lineHeight };
    }
    const charsPerLine = Math.floor(DEFAULT_WRAP_WIDTH / AVG_CHAR_WIDTH);
    let wrappedLines = 0;
    for (const line of lines) {
      wrappedLines += Math.max(1, Math.ceil(line.length / charsPerLine));
    }
    return { width: DEFAULT_WRAP_WIDTH, height: wrappedLines * lineHeight };
  }

  return { width: rawWidth, height: lines.length * lineHeight };
}

// ── Transform parsing ──────────────────────────────────────────────────────

/**
 * Parse a CSS/SVG `transform` attribute and extract the translation offsets.
 * Handles `translate(x, y)`, `translate(x)`, and `matrix(a,b,c,d,e,f)`.
 * Returns `{ tx, ty }` — the effective translation components.
 */
function parseTransformTranslation(attr: string | null): { tx: number; ty: number } {
  if (!attr) return { tx: 0, ty: 0 };

  // Try translate(x, y) or translate(x)
  const translateMatch = attr.match(/translate\(\s*([^,)]+)(?:[\s,]+([^)]*))?\)/);
  if (translateMatch) {
    const tx = parseFloat(translateMatch[1]) || 0;
    const ty = parseFloat(translateMatch[2] || '0') || 0;
    return { tx, ty };
  }

  // Try matrix(a, b, c, d, e, f) — e and f are translation
  const matrixMatch = attr.match(
    /matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/
  );
  if (matrixMatch) {
    const tx = parseFloat(matrixMatch[5]) || 0;
    const ty = parseFloat(matrixMatch[6]) || 0;
    return { tx, ty };
  }

  return { tx: 0, ty: 0 };
}

import { parseSvgPathBBox } from './headless-path';

// ── getBBox polyfill ───────────────────────────────────────────────────────

/** Default fallback bbox when element type is unknown or empty. */
const FALLBACK_BBOX = { x: 0, y: 0, width: 100, height: 80 };

/** getBBox for text/tspan elements. */
function bboxText(el: any): { x: number; y: number; width: number; height: number } {
  const text: string = el.textContent || '';
  const fontSize = getFontSize(el);
  const bbox = estimateTextBBox(text, fontSize);
  const x = parseFloat(el.getAttribute?.('x')) || 0;
  const y = parseFloat(el.getAttribute?.('y')) || 0;
  return { x, y: y - bbox.height, width: bbox.width, height: bbox.height };
}

/** getBBox for rect elements. */
function bboxRect(el: any): { x: number; y: number; width: number; height: number } {
  return {
    x: parseFloat(el.getAttribute('x')) || 0,
    y: parseFloat(el.getAttribute('y')) || 0,
    width: parseFloat(el.getAttribute('width')) || 100,
    height: parseFloat(el.getAttribute('height')) || 80,
  };
}

/** getBBox for circle elements. */
function bboxCircle(el: any): { x: number; y: number; width: number; height: number } {
  const r = parseFloat(el.getAttribute('r')) || 18;
  const cx = parseFloat(el.getAttribute('cx')) || r;
  const cy = parseFloat(el.getAttribute('cy')) || r;
  return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
}

/** getBBox for ellipse elements. */
function bboxEllipse(el: any): { x: number; y: number; width: number; height: number } {
  const rx = parseFloat(el.getAttribute('rx')) || 50;
  const ry = parseFloat(el.getAttribute('ry')) || 30;
  const cx = parseFloat(el.getAttribute('cx')) || rx;
  const cy = parseFloat(el.getAttribute('cy')) || ry;
  return { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry };
}

/** getBBox for line elements. */
function bboxLine(el: any): { x: number; y: number; width: number; height: number } {
  const x1 = parseFloat(el.getAttribute('x1')) || 0;
  const y1 = parseFloat(el.getAttribute('y1')) || 0;
  const x2 = parseFloat(el.getAttribute('x2')) || 0;
  const y2 = parseFloat(el.getAttribute('y2')) || 0;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1) || 1,
    height: Math.abs(y2 - y1) || 1,
  };
}

/** getBBox for path elements (parsed from d attribute). */
function bboxPath(el: any): { x: number; y: number; width: number; height: number } {
  const d: string = el.getAttribute?.('d') || '';
  if (d) {
    const pathBBox = parseSvgPathBBox(d);
    if (pathBBox.width > 0 || pathBBox.height > 0) return pathBBox;
  }
  return FALLBACK_BBOX;
}

/** getBBox for container elements (g, svg) — union of children with transforms. */
function bboxContainer(el: any): { x: number; y: number; width: number; height: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const children = el.childNodes || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child.getBBox) continue;
    try {
      const cb = child.getBBox();
      if (cb.width <= 0 && cb.height <= 0) continue;
      const { tx, ty } = parseTransformTranslation(child.getAttribute?.('transform') || null);
      const cx = cb.x + tx;
      const cy = cb.y + ty;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx + cb.width > maxX) maxX = cx + cb.width;
      if (cy + cb.height > maxY) maxY = cy + cb.height;
    } catch {
      // skip
    }
  }
  if (minX !== Infinity) {
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return FALLBACK_BBOX;
}

/** Tag → bbox handler dispatch table. */
const BBOX_HANDLERS: Record<
  string,
  (el: any) => { x: number; y: number; width: number; height: number }
> = {
  text: bboxText,
  tspan: bboxText,
  rect: bboxRect,
  circle: bboxCircle,
  ellipse: bboxEllipse,
  polygon: (el) => parseSvgPointsBBox(el.getAttribute('points') || ''),
  polyline: (el) => parseSvgPointsBBox(el.getAttribute('points') || ''),
  line: bboxLine,
  path: bboxPath,
  g: bboxContainer,
  svg: bboxContainer,
};

/**
 * Element-type-aware bounding box estimation.
 * Handles text/tspan, rect, circle, ellipse, polygon/polyline, line,
 * path, and container elements (g, svg).
 */
export function polyfillGetBBox(element: any): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const tag = element.tagName?.toLowerCase();
  const handler = tag ? BBOX_HANDLERS[tag] : undefined;
  return handler ? handler(element) : FALLBACK_BBOX;
}

/**
 * Estimate computed text length using proportional character widths.
 */
export function polyfillGetComputedTextLength(element: any): number {
  const text: string = element.textContent || '';
  const fontSize = getFontSize(element);
  if (fontSize) {
    return measureTextWidth(text, fontSize);
  }
  return text.length * AVG_CHAR_WIDTH;
}
