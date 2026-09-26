/**
 * SVG / CSS polyfills for running bpmn-js headlessly via jsdom.
 *
 * These polyfills provide the subset of browser SVG APIs that bpmn-js
 * and its dependencies (tiny-svg, diagram-js) require at runtime:
 * - CSS.escape, structuredClone
 * - SVGMatrix (2D affine matrix with inverse, multiply, translate, scale)
 * - SVGElement.getBBox (element-type-aware bounding box estimation)
 * - SVGElement.getScreenCTM, getComputedTextLength
 * - SVGElement.transform (baseVal / animVal with DOM attribute sync)
 * - SVGSVGElement.createSVGMatrix, createSVGTransform, createSVGTransformFromMatrix
 *
 * The getBBox/getComputedTextLength implementations live in `./headless-bbox.ts`.
 */

import { measureTextWidth, polyfillGetBBox, polyfillGetComputedTextLength } from './headless-bbox';

// ── SVGTransform polyfill ──────────────────────────────────────────────────

/** Create an SVGTransform-like object with real setTranslate/setScale/setRotate/setMatrix. */
function createSVGTransformObject(win: any) {
  return {
    type: 0,
    matrix: new win.SVGMatrix(),
    angle: 0,
    setTranslate(x: number, y: number) {
      this.matrix = new win.SVGMatrix();
      this.matrix.e = x;
      this.matrix.f = y;
      this.type = 2;
    },
    setScale(sx: number, sy: number) {
      this.matrix = new win.SVGMatrix();
      this.matrix.a = sx;
      this.matrix.d = sy;
      this.type = 3;
    },
    setRotate(angle: number, cx: number, cy: number) {
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      this.angle = angle;
      this.matrix = new win.SVGMatrix();
      this.matrix.a = cos;
      this.matrix.b = sin;
      this.matrix.c = -sin;
      this.matrix.d = cos;
      this.matrix.e = (1 - cos) * cx + sin * cy;
      this.matrix.f = -sin * cx + (1 - cos) * cy;
      this.type = 4;
    },
    setMatrix(m: any) {
      this.matrix = new win.SVGMatrix();
      this.matrix.a = m.a ?? 1;
      this.matrix.b = m.b ?? 0;
      this.matrix.c = m.c ?? 0;
      this.matrix.d = m.d ?? 1;
      this.matrix.e = m.e ?? 0;
      this.matrix.f = m.f ?? 0;
      this.type = 1;
    },
  };
}

// ── SVGTransformList polyfill ──────────────────────────────────────────────

/**
 * Serialize transform list items to a CSS transform string and set it
 * as the `transform` DOM attribute on the owning element.
 */
function syncTransformAttribute(list: any): void {
  const el = list._element;
  if (!el || !el.setAttribute) return;
  if (list._items.length === 0) {
    el.removeAttribute('transform');
    return;
  }
  const parts: string[] = [];
  for (const item of list._items) {
    const m = item.matrix;
    if (!m) continue;
    // Optimise: if it's a pure translate, use translate() syntax
    if (m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1) {
      parts.push(`translate(${m.e}, ${m.f})`);
    } else {
      parts.push(`matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`);
    }
  }
  el.setAttribute('transform', parts.join(' '));
}

/** Create an SVGTransformList-like object that syncs to the DOM attribute on mutation. */
function createTransformList(win: any, element: any) {
  return {
    numberOfItems: 0,
    _items: [] as any[],
    _element: element,
    consolidate() {
      if (this._items.length === 0) return null;
      // Multiply all transform matrices together
      let result = new win.SVGMatrix();
      for (const item of this._items) {
        if (item.matrix) {
          result = result.multiply(item.matrix);
        }
      }
      const consolidated = createSVGTransformObject(win);
      consolidated.setMatrix(result);
      this._items = [consolidated];
      this.numberOfItems = 1;
      syncTransformAttribute(this);
      return consolidated;
    },
    clear() {
      this._items = [];
      this.numberOfItems = 0;
      syncTransformAttribute(this);
    },
    initialize(newItem: any) {
      this._items = [newItem];
      this.numberOfItems = 1;
      syncTransformAttribute(this);
      return newItem;
    },
    getItem(index: number) {
      return this._items[index];
    },
    insertItemBefore(newItem: any, index: number) {
      this._items.splice(index, 0, newItem);
      this.numberOfItems = this._items.length;
      syncTransformAttribute(this);
      return newItem;
    },
    replaceItem(newItem: any, index: number) {
      this._items[index] = newItem;
      syncTransformAttribute(this);
      return newItem;
    },
    removeItem(index: number) {
      const item = this._items.splice(index, 1)[0];
      this.numberOfItems = this._items.length;
      syncTransformAttribute(this);
      return item;
    },
    appendItem(newItem: any) {
      this._items.push(newItem);
      this.numberOfItems = this._items.length;
      syncTransformAttribute(this);
      return newItem;
    },
    createSVGTransformFromMatrix(matrix: any) {
      const t = createSVGTransformObject(win);
      t.setMatrix(matrix);
      return t;
    },
  };
}

// ── Polyfill application ───────────────────────────────────────────────────

/** Polyfill CSS.escape, structuredClone, and SVGMatrix on the jsdom window. */
function applyGlobalPolyfills(win: any): void {
  win.CSS = {
    escape: (str: string) => str.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&'),
  };

  if (!win.structuredClone) {
    win.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
  }

  win.SVGMatrix = function () {
    return {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      inverse() {
        // 2D affine matrix inverse: [a b e; c d f; 0 0 1]
        const det = this.a * this.d - this.b * this.c;
        if (Math.abs(det) < 1e-10) {
          // Singular matrix — return identity as fallback
          const m = new win.SVGMatrix();
          return m;
        }
        const m = new win.SVGMatrix();
        m.a = this.d / det;
        m.b = -this.b / det;
        m.c = -this.c / det;
        m.d = this.a / det;
        m.e = (this.c * this.f - this.d * this.e) / det;
        m.f = (this.b * this.e - this.a * this.f) / det;
        return m;
      },
      multiply(other: any) {
        // 2D affine matrix multiplication
        const m = new win.SVGMatrix();
        m.a = this.a * other.a + this.b * other.c;
        m.b = this.a * other.b + this.b * other.d;
        m.c = this.c * other.a + this.d * other.c;
        m.d = this.c * other.b + this.d * other.d;
        m.e = this.a * other.e + this.b * other.f + this.e;
        m.f = this.c * other.e + this.d * other.f + this.f;
        return m;
      },
      // WARNING: translate() and scale() mutate in-place, which diverges
      // from the browser SVG spec (should return a new matrix). bpmn-js /
      // diagram-js rely on this mutation behaviour in their transform
      // consolidation code paths, so do NOT change to return new instances.
      translate(x: number, y: number) {
        this.e += x;
        this.f += y;
        return this;
      },
      scale(s: number) {
        this.a *= s;
        this.d *= s;
        return this;
      },
    };
  };
}

/**
 * Polyfill SVG path API methods used by CroppingConnectionDocking,
 * DetachEventBehavior, and ManhattanLayout.
 *
 * D1-2 / D5-2 / D6-2: These methods are called on <path> elements in
 * bpmn-js internals.  jsdom does not implement them.  The stubs return
 * neutral values that let the callers continue without crashing:
 *   - getTotalLength(): returns 0 (no path length)
 *   - getPointAtLength(): returns the origin point (0,0)
 *   - isPointInStroke(): returns false (point is not in stroke)
 *
 * NOTE: In practice, getCroppedWaypoints(), layoutConnection(), and
 * moveElements([boundaryEvent]) all work correctly headlessly without
 * these stubs (confirmed by D1-1, D5-1, D6-1 spike tests).  These stubs
 * provide a safety net for any additional code paths that may reach
 * these methods.
 */
function applySvgPathPolyfills(win: any): void {
  const SVGElement = win.SVGElement;
  if (!SVGElement) return;

  if (!SVGElement.prototype.getTotalLength) {
    SVGElement.prototype.getTotalLength = function (): number {
      return 0;
    };
  }

  if (!SVGElement.prototype.getPointAtLength) {
    SVGElement.prototype.getPointAtLength = function (_len: number): DOMPoint {
      // Return a minimal SVGPoint-like object at the origin
      return {
        x: 0,
        y: 0,
        z: 0,
        w: 1,
        matrixTransform: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      } as unknown as DOMPoint;
    };
  }

  if (!SVGElement.prototype.isPointInStroke) {
    SVGElement.prototype.isPointInStroke = function (_point?: DOMPointInit): boolean {
      return false;
    };
  }
}

/** Polyfill SVGElement methods: getBBox, getScreenCTM, getComputedTextLength, transform. */
function applySvgElementPolyfills(win: any): void {
  const SVGElement = win.SVGElement;
  const SVGGraphicsElement = win.SVGGraphicsElement;

  if (SVGElement && !SVGElement.prototype.getBBox) {
    SVGElement.prototype.getBBox = function () {
      return polyfillGetBBox(this);
    };
  }

  if (SVGElement && !SVGElement.prototype.getComputedTextLength) {
    SVGElement.prototype.getComputedTextLength = function () {
      return polyfillGetComputedTextLength(this);
    };
  }

  if (SVGElement && !SVGElement.prototype.getScreenCTM) {
    SVGElement.prototype.getScreenCTM = function () {
      return new win.SVGMatrix();
    };
  }

  // getCTM is used by AutoPlace via Canvas.scrollToElement → Canvas.scroll.
  if (SVGElement && !SVGElement.prototype.getCTM) {
    SVGElement.prototype.getCTM = function () {
      return new win.SVGMatrix();
    };
  }

  const transformProp = {
    get(this: any): any {
      if (!this._transform) {
        const list = createTransformList(win, this);
        this._transform = { baseVal: list, animVal: list };
      }
      return this._transform;
    },
  };

  if (SVGGraphicsElement) {
    Object.defineProperty(SVGGraphicsElement.prototype, 'transform', transformProp);
  }
  if (SVGElement) {
    Object.defineProperty(SVGElement.prototype, 'transform', transformProp);
  }
}

/** Polyfill SVGSVGElement.createSVGMatrix, createSVGTransform, createSVGTransformFromMatrix. */
function applySvgSvgElementPolyfills(win: any): void {
  const SVGSVGElement = win.SVGSVGElement;
  if (!SVGSVGElement) return;

  if (!SVGSVGElement.prototype.createSVGMatrix) {
    SVGSVGElement.prototype.createSVGMatrix = function () {
      return new win.SVGMatrix();
    };
  }
  if (!SVGSVGElement.prototype.createSVGTransform) {
    SVGSVGElement.prototype.createSVGTransform = function () {
      return createSVGTransformObject(win);
    };
  }
  if (!SVGSVGElement.prototype.createSVGTransformFromMatrix) {
    SVGSVGElement.prototype.createSVGTransformFromMatrix = function (matrix: any) {
      const t = createSVGTransformObject(win);
      t.setMatrix(matrix);
      return t;
    };
  }
}

// ── Canvas text measurement polyfill ───────────────────────────────────────

/** Default font size (px) when a canvas font string has no px size. */
const DEFAULT_CANVAS_FONT_SIZE = 12;

/**
 * Minimal `CanvasRenderingContext2D` for text measurement.
 *
 * diagram-js ≥ 15.2 measures label text with `canvas.measureText()` instead
 * of SVG `getBBox()`.  jsdom has no canvas implementation, so without this
 * every label measures 0px wide.  Widths use the same proportional Arial
 * metrics as the `getBBox` polyfill; line height is 1.2 × font size.
 */
function createTextMeasureContext(): Record<string, any> {
  return {
    font: `${DEFAULT_CANVAS_FONT_SIZE}px sans-serif`,
    letterSpacing: '0px',
    measureText(this: { font: string }, text: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(this.font);
      const fontSize = match ? Number.parseFloat(match[1]) : DEFAULT_CANVAS_FONT_SIZE;
      const lineHeight = Math.round(fontSize * 1.2);
      return {
        width: measureTextWidth(String(text), fontSize),
        fontBoundingBoxAscent: lineHeight * 0.8,
        fontBoundingBoxDescent: lineHeight * 0.2,
        actualBoundingBoxAscent: lineHeight * 0.8,
        actualBoundingBoxDescent: lineHeight * 0.2,
      };
    },
  };
}

function applyCanvasPolyfills(win: any): void {
  win.HTMLCanvasElement.prototype.getContext = function (type: string) {
    return type === '2d' ? createTextMeasureContext() : null;
  };
}

/** Apply all SVG/CSS polyfills to a jsdom instance's window. */
export function applyPolyfills(instance: any): void {
  const win = instance.window;
  applyGlobalPolyfills(win);
  applyCanvasPolyfills(win);
  applySvgPathPolyfills(win);
  applySvgElementPolyfills(win);
  applySvgSvgElementPolyfills(win);
}
