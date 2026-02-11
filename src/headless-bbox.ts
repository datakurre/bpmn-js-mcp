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

// ── Path d-attribute parsing ───────────────────────────────────────────────

/** Mutable state carried through path command processing. */
interface PathCursor {
  curX: number;
  curY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Update path bounds with a point. */
function trackPoint(c: PathCursor, x: number, y: number): void {
  if (x < c.minX) c.minX = x;
  if (y < c.minY) c.minY = y;
  if (x > c.maxX) c.maxX = x;
  if (y > c.maxY) c.maxY = y;
}

/** Check whether the next token is a number. */
function hasNum(tokens: string[], i: number): boolean {
  return i < tokens.length && !isNaN(Number(tokens[i]));
}

/** Process absolute M/L — pairs of (x, y). */
function processAbsXY(c: PathCursor, tokens: string[], start: number): number {
  let pos = start;
  while (hasNum(tokens, pos)) {
    c.curX = Number(tokens[pos]);
    c.curY = Number(tokens[pos + 1]);
    trackPoint(c, c.curX, c.curY);
    pos += 2;
  }
  return pos;
}

/** Process relative m/l — pairs of (dx, dy). */
function processRelXY(c: PathCursor, tokens: string[], start: number): number {
  let pos = start;
  while (hasNum(tokens, pos)) {
    c.curX += Number(tokens[pos]);
    c.curY += Number(tokens[pos + 1]);
    trackPoint(c, c.curX, c.curY);
    pos += 2;
  }
  return pos;
}

/** Process H/h, V/v — single-axis commands. */
function processAxis(
  c: PathCursor,
  tokens: string[],
  start: number,
  axis: 'x' | 'y',
  relative: boolean
): number {
  let pos = start;
  while (hasNum(tokens, pos)) {
    const val = Number(tokens[pos]);
    if (axis === 'x') {
      c.curX = relative ? c.curX + val : val;
    } else {
      c.curY = relative ? c.curY + val : val;
    }
    trackPoint(c, c.curX, c.curY);
    pos += 1;
  }
  return pos;
}

/** Process absolute cubic bézier C (6 params per segment). */
function processAbsCubic(c: PathCursor, tokens: string[], start: number): number {
  let pos = start;
  while (pos + 5 < tokens.length && hasNum(tokens, pos)) {
    trackPoint(c, Number(tokens[pos]), Number(tokens[pos + 1]));
    trackPoint(c, Number(tokens[pos + 2]), Number(tokens[pos + 3]));
    c.curX = Number(tokens[pos + 4]);
    c.curY = Number(tokens[pos + 5]);
    trackPoint(c, c.curX, c.curY);
    pos += 6;
  }
  return pos;
}

/** Process relative cubic bézier c (6 params per segment). */
function processRelCubic(c: PathCursor, tokens: string[], start: number): number {
  let pos = start;
  while (pos + 5 < tokens.length && hasNum(tokens, pos)) {
    trackPoint(c, c.curX + Number(tokens[pos]), c.curY + Number(tokens[pos + 1]));
    trackPoint(c, c.curX + Number(tokens[pos + 2]), c.curY + Number(tokens[pos + 3]));
    c.curX += Number(tokens[pos + 4]);
    c.curY += Number(tokens[pos + 5]);
    trackPoint(c, c.curX, c.curY);
    pos += 6;
  }
  return pos;
}

/** Process absolute quadratic bézier Q (4 params per segment). */
function processAbsQuad(c: PathCursor, tokens: string[], start: number): number {
  let pos = start;
  while (pos + 3 < tokens.length && hasNum(tokens, pos)) {
    trackPoint(c, Number(tokens[pos]), Number(tokens[pos + 1]));
    c.curX = Number(tokens[pos + 2]);
    c.curY = Number(tokens[pos + 3]);
    trackPoint(c, c.curX, c.curY);
    pos += 4;
  }
  return pos;
}

/** Process relative quadratic bézier q (4 params per segment). */
function processRelQuad(c: PathCursor, tokens: string[], start: number): number {
  let pos = start;
  while (pos + 3 < tokens.length && hasNum(tokens, pos)) {
    trackPoint(c, c.curX + Number(tokens[pos]), c.curY + Number(tokens[pos + 1]));
    c.curX += Number(tokens[pos + 2]);
    c.curY += Number(tokens[pos + 3]);
    trackPoint(c, c.curX, c.curY);
    pos += 4;
  }
  return pos;
}

/** Dispatch table mapping SVG path commands to processors. */
type CmdProcessor = (c: PathCursor, tokens: string[], i: number) => number;

const PATH_COMMANDS: Record<string, CmdProcessor> = {
  M: processAbsXY,
  L: processAbsXY,
  m: processRelXY,
  l: processRelXY,
  H: (c, t, i) => processAxis(c, t, i, 'x', false),
  h: (c, t, i) => processAxis(c, t, i, 'x', true),
  V: (c, t, i) => processAxis(c, t, i, 'y', false),
  v: (c, t, i) => processAxis(c, t, i, 'y', true),
  C: processAbsCubic,
  c: processRelCubic,
  Q: processAbsQuad,
  q: processRelQuad,
};

/**
 * Parse an SVG path `d` attribute and compute its bounding box.
 * Handles M, L, H, V, C, Q, Z commands (absolute and relative).
 */
function parseSvgPathBBox(d: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (!d) return { x: 0, y: 0, width: 0, height: 0 };

  const tokens = d.match(/[a-zA-Z]|-?\d+\.?\d*(?:e[+-]?\d+)?/g);
  if (!tokens) return { x: 0, y: 0, width: 0, height: 0 };

  const c: PathCursor = {
    curX: 0,
    curY: 0,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    const processor = PATH_COMMANDS[cmd];
    if (processor) {
      i = processor(c, tokens, i);
    } else if (cmd !== 'Z' && cmd !== 'z') {
      // Skip unknown commands and consume trailing numbers
      while (hasNum(tokens, i)) i++;
    }
  }

  if (c.minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: c.minX, y: c.minY, width: c.maxX - c.minX || 1, height: c.maxY - c.minY || 1 };
}

// ── getBBox polyfill ───────────────────────────────────────────────────────

/** Default fallback bbox when element type is unknown or empty. */
const FALLBACK_BBOX = { x: 0, y: 0, width: 100, height: 80 };

/** getBBox for text/tspan elements. */
function bboxText(el: any): { x: number; y: number; width: number; height: number } {
  const text: string = el.textContent || '';
  const bbox = estimateTextBBox(text);
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
 * Estimate computed text length based on character count.
 */
export function polyfillGetComputedTextLength(element: any): number {
  const text: string = element.textContent || '';
  return text.length * AVG_CHAR_WIDTH;
}
