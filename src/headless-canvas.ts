/* eslint-disable max-lines */
/**
 * Headless browser environment for bpmn-js.
 *
 * Creates a jsdom instance with all SVG / CSS polyfills required to run the
 * bpmn-js browser bundle outside of a real browser.  The instance is lazily
 * initialised on first call and then reused.
 */

import { JSDOM } from 'jsdom';
import fs from 'fs';

let jsdomInstance: any;
let BpmnModelerCtor: any;

/** Ensure the jsdom instance + polyfills exist and return the canvas element. */
export function createHeadlessCanvas(): HTMLElement {
  if (!jsdomInstance) {
    const bpmnJsPath = require.resolve('bpmn-js/dist/bpmn-modeler.development.js');
    const bpmnJsBundle = fs.readFileSync(bpmnJsPath, 'utf-8');

    jsdomInstance = new JSDOM("<!DOCTYPE html><html><body><div id='canvas'></div></body></html>", {
      runScripts: 'outside-only',
    });

    applyPolyfills(jsdomInstance);

    // Execute the bpmn-js bundle inside jsdom
    jsdomInstance.window.eval(bpmnJsBundle);

    // Expose globals that bpmn-js expects at runtime
    (global as any).document = jsdomInstance.window.document;
    (global as any).window = jsdomInstance.window;

    BpmnModelerCtor = (jsdomInstance.window as any).BpmnJS;
  }

  return jsdomInstance.window.document.getElementById('canvas')!;
}

/** Return the lazily-loaded BpmnModeler constructor. */
export function getBpmnModeler(): any {
  if (!BpmnModelerCtor) {
    createHeadlessCanvas(); // triggers lazy init
  }
  return BpmnModelerCtor;
}

// ── Text metric constants ──────────────────────────────────────────────────

/** Approximate average character width in px for the default bpmn-js font. */
const AVG_CHAR_WIDTH = 7;
/** Approximate line height in px for the default bpmn-js font. */
const LINE_HEIGHT = 14;
/** Default line width for text wrapping estimation. */
const DEFAULT_WRAP_WIDTH = 90;

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

// ---------------------------------------------------------------------------
// Polyfills
// ---------------------------------------------------------------------------

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
// eslint-disable-next-line max-lines-per-function
function applySvgElementPolyfills(win: any): void {
  const SVGElement = win.SVGElement;
  const SVGGraphicsElement = win.SVGGraphicsElement;

  if (SVGElement && !SVGElement.prototype.getBBox) {
    // eslint-disable-next-line complexity
    SVGElement.prototype.getBBox = function () {
      // Content-aware sizing for text/tspan elements
      const tag = this.tagName?.toLowerCase();
      if (tag === 'text' || tag === 'tspan') {
        const text: string = this.textContent || '';
        const bbox = estimateTextBBox(text);
        return { x: 0, y: 0, width: bbox.width, height: bbox.height };
      }
      // Element-type-aware sizing for common SVG elements
      if (tag === 'rect') {
        const w = parseFloat(this.getAttribute('width')) || 100;
        const h = parseFloat(this.getAttribute('height')) || 80;
        const x = parseFloat(this.getAttribute('x')) || 0;
        const y = parseFloat(this.getAttribute('y')) || 0;
        return { x, y, width: w, height: h };
      }
      if (tag === 'circle') {
        const r = parseFloat(this.getAttribute('r')) || 18;
        const cx = parseFloat(this.getAttribute('cx')) || r;
        const cy = parseFloat(this.getAttribute('cy')) || r;
        return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
      }
      if (tag === 'ellipse') {
        const rx = parseFloat(this.getAttribute('rx')) || 50;
        const ry = parseFloat(this.getAttribute('ry')) || 30;
        const cx = parseFloat(this.getAttribute('cx')) || rx;
        const cy = parseFloat(this.getAttribute('cy')) || ry;
        return { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry };
      }
      if (tag === 'polygon' || tag === 'polyline') {
        const points: string = this.getAttribute('points') || '';
        return parseSvgPointsBBox(points);
      }
      if (tag === 'line') {
        const x1 = parseFloat(this.getAttribute('x1')) || 0;
        const y1 = parseFloat(this.getAttribute('y1')) || 0;
        const x2 = parseFloat(this.getAttribute('x2')) || 0;
        const y2 = parseFloat(this.getAttribute('y2')) || 0;
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
        const children = this.childNodes || [];
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
    };
  }

  if (SVGElement && !SVGElement.prototype.getComputedTextLength) {
    SVGElement.prototype.getComputedTextLength = function () {
      const text: string = this.textContent || '';
      return text.length * AVG_CHAR_WIDTH;
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
        const list = createTransformList();
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

/** Polyfill SVGSVGElement.createSVGMatrix and createSVGTransform. */
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
      return {
        type: 0,
        matrix: this.createSVGMatrix(),
        angle: 0,
        setMatrix() {},
        setTranslate() {},
        setScale() {},
        setRotate() {},
      };
    };
  }
}

function applyPolyfills(instance: any): void {
  const win = instance.window;
  applyGlobalPolyfills(win);
  applySvgElementPolyfills(win);
  applySvgSvgElementPolyfills(win);
}

function createTransformList() {
  return {
    numberOfItems: 0,
    _items: [] as any[],
    consolidate() {
      return null;
    },
    clear() {
      this._items = [];
      this.numberOfItems = 0;
    },
    initialize(newItem: any) {
      this._items = [newItem];
      this.numberOfItems = 1;
      return newItem;
    },
    getItem(index: number) {
      return this._items[index];
    },
    insertItemBefore(newItem: any, index: number) {
      this._items.splice(index, 0, newItem);
      this.numberOfItems = this._items.length;
      return newItem;
    },
    replaceItem(newItem: any, index: number) {
      this._items[index] = newItem;
      return newItem;
    },
    removeItem(index: number) {
      const item = this._items.splice(index, 1)[0];
      this.numberOfItems = this._items.length;
      return item;
    },
    appendItem(newItem: any) {
      this._items.push(newItem);
      this.numberOfItems = this._items.length;
      return newItem;
    },
    createSVGTransformFromMatrix(matrix: any) {
      return { type: 1, matrix, angle: 0 };
    },
  };
}
