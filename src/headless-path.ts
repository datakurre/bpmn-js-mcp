/**
 * SVG path `d` attribute parser for headless bounding box computation.
 *
 * Handles all SVG path commands (absolute and relative):
 * M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z
 *
 * Extracted from headless-bbox.ts to keep files within line limits.
 */

// ── Cursor state ───────────────────────────────────────────────────────────

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

// ── Command processors ────────────────────────────────────────────────────

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

/**
 * Process absolute 4-param bézier segments (Q and S commands).
 * Both Q (quadratic) and S (smooth cubic) consume (cp, endpoint) pairs
 * with identical bbox-tracking logic.
 */
function processAbs4Param(c: PathCursor, tokens: string[], start: number): number {
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

/**
 * Process relative 4-param bézier segments (q and s commands).
 * Both q (quadratic) and s (smooth cubic) consume (dcp, dendpoint) pairs
 * with identical bbox-tracking logic.
 */
function processRel4Param(c: PathCursor, tokens: string[], start: number): number {
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

/** Process absolute elliptical arc A (7 params per segment). */
function processAbsArc(c: PathCursor, tokens: string[], start: number): number {
  let pos = start;
  while (pos + 6 < tokens.length && hasNum(tokens, pos)) {
    const rx = Math.abs(Number(tokens[pos]));
    const ry = Math.abs(Number(tokens[pos + 1]));
    // Skip rotation (pos+2), large-arc-flag (pos+3), sweep-flag (pos+4)
    const endX = Number(tokens[pos + 5]);
    const endY = Number(tokens[pos + 6]);
    // Approximate bbox: extend by radii from both current position and endpoint
    trackPoint(c, c.curX - rx, c.curY - ry);
    trackPoint(c, c.curX + rx, c.curY + ry);
    trackPoint(c, endX - rx, endY - ry);
    trackPoint(c, endX + rx, endY + ry);
    c.curX = endX;
    c.curY = endY;
    trackPoint(c, c.curX, c.curY);
    pos += 7;
  }
  return pos;
}

/** Process relative elliptical arc a (7 params per segment). */
function processRelArc(c: PathCursor, tokens: string[], start: number): number {
  let pos = start;
  while (pos + 6 < tokens.length && hasNum(tokens, pos)) {
    const rx = Math.abs(Number(tokens[pos]));
    const ry = Math.abs(Number(tokens[pos + 1]));
    // Skip rotation (pos+2), large-arc-flag (pos+3), sweep-flag (pos+4)
    const endX = c.curX + Number(tokens[pos + 5]);
    const endY = c.curY + Number(tokens[pos + 6]);
    // Approximate bbox: extend by radii from both positions
    trackPoint(c, c.curX - rx, c.curY - ry);
    trackPoint(c, c.curX + rx, c.curY + ry);
    trackPoint(c, endX - rx, endY - ry);
    trackPoint(c, endX + rx, endY + ry);
    c.curX = endX;
    c.curY = endY;
    trackPoint(c, c.curX, c.curY);
    pos += 7;
  }
  return pos;
}

// ── Dispatch table ─────────────────────────────────────────────────────────

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
  S: processAbs4Param,
  s: processRel4Param,
  Q: processAbs4Param,
  q: processRel4Param,
  // T/t (smooth quadratic) consume (x, y) pairs — same bbox logic as L/l
  T: processAbsXY,
  t: processRelXY,
  A: processAbsArc,
  a: processRelArc,
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse an SVG path `d` attribute and compute its bounding box.
 * Handles M, L, H, V, C, S, Q, T, A, Z commands (absolute and relative).
 */
export function parseSvgPathBBox(d: string): {
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
