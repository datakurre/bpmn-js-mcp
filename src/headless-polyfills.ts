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

import { polyfillGetBBox, polyfillGetComputedTextLength } from './headless-bbox';

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

/** Apply all SVG/CSS polyfills to a jsdom instance's window. */
export function applyPolyfills(instance: any): void {
  const win = instance.window;
  applyGlobalPolyfills(win);
  applySvgElementPolyfills(win);
  applySvgSvgElementPolyfills(win);
}
