/**
 * Polyfill regression tests for src/headless-polyfills.ts.
 *
 * Exercises the SVG API polyfills that bpmn-js requires to run headlessly.
 * If a bpmn-js upgrade calls a previously-unpolyfilled API, one of these
 * tests will fail, surfacing the breakage before it silently corrupts diagrams.
 *
 * APIs under test (as documented in headless-polyfills.ts):
 *   - SVGMatrix (inverse, multiply, translate, scale)
 *   - SVGSVGElement.createSVGMatrix / createSVGTransform / createSVGTransformFromMatrix
 *   - SVGElement.getBBox
 *   - SVGElement.getScreenCTM / getCTM
 *   - SVGElement.getComputedTextLength
 *   - SVGElement.transform (baseVal / animVal with DOM attribute sync)
 *   - SVGElement.getTotalLength / getPointAtLength / isPointInStroke
 *   - CSS.escape
 *   - structuredClone (if not natively available)
 */

import { describe, test, expect } from 'vitest';
import { createHeadlessCanvas } from '../src/headless-canvas';

// Trigger lazy initialisation of the jsdom window + polyfills
createHeadlessCanvas();
const win = (global as any).window;

describe('headless polyfills', () => {
  describe('CSS.escape', () => {
    test('is defined on window', () => {
      expect(typeof win.CSS?.escape).toBe('function');
    });

    test('escapes special characters', () => {
      expect(win.CSS.escape('foo:bar')).toContain('\\');
    });
  });

  describe('structuredClone', () => {
    test('is defined on window', () => {
      expect(typeof win.structuredClone).toBe('function');
    });

    test('deep-clones an object', () => {
      const obj = { a: { b: 1 } };
      const clone = win.structuredClone(obj);
      expect(clone).toEqual(obj);
      expect(clone).not.toBe(obj);
      expect(clone.a).not.toBe(obj.a);
    });
  });

  describe('SVGMatrix', () => {
    test('is defined on window', () => {
      expect(typeof win.SVGMatrix).toBe('function');
    });

    test('creates an identity matrix', () => {
      const m = new win.SVGMatrix();
      expect(m.a).toBe(1);
      expect(m.b).toBe(0);
      expect(m.c).toBe(0);
      expect(m.d).toBe(1);
      expect(m.e).toBe(0);
      expect(m.f).toBe(0);
    });

    test('translate mutates in-place (bpmn-js dependency)', () => {
      const m = new win.SVGMatrix();
      const result = m.translate(10, 20);
      expect(result).toBe(m); // same object (mutation, not new instance)
      expect(m.e).toBe(10);
      expect(m.f).toBe(20);
    });

    test('scale mutates in-place (bpmn-js dependency)', () => {
      const m = new win.SVGMatrix();
      const result = m.scale(2);
      expect(result).toBe(m);
      expect(m.a).toBe(2);
      expect(m.d).toBe(2);
    });

    test('multiply returns a new matrix with correct values', () => {
      const a = new win.SVGMatrix();
      a.a = 2;
      a.d = 3;
      const b = new win.SVGMatrix();
      b.a = 4;
      b.d = 5;
      const result = a.multiply(b);
      // [2,0,0,3,0,0] × [4,0,0,5,0,0] = [8,0,0,15,0,0]
      expect(result.a).toBe(8);
      expect(result.d).toBe(15);
    });

    test('inverse of identity is identity', () => {
      const m = new win.SVGMatrix();
      const inv = m.inverse();
      expect(inv.a).toBeCloseTo(1);
      expect(inv.d).toBeCloseTo(1);
      expect(inv.e).toBeCloseTo(0);
      expect(inv.f).toBeCloseTo(0);
    });

    test('inverse of translate matrix is correct', () => {
      const m = new win.SVGMatrix();
      m.e = 10;
      m.f = 20;
      const inv = m.inverse();
      expect(inv.e).toBeCloseTo(-10);
      expect(inv.f).toBeCloseTo(-20);
    });
  });

  describe('SVGSVGElement factory methods', () => {
    let svg: any;

    test('SVGSVGElement exists in jsdom', () => {
      svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      win.document.body.appendChild(svg);
      expect(svg).toBeDefined();
    });

    test('createSVGMatrix returns an SVGMatrix-like object', () => {
      const svg2 = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      expect(typeof svg2.createSVGMatrix).toBe('function');
      const m = svg2.createSVGMatrix();
      expect(m).toBeDefined();
      expect(m.a).toBe(1);
    });

    test('createSVGTransform returns an object with setTranslate', () => {
      const svg2 = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      expect(typeof svg2.createSVGTransform).toBe('function');
      const t = svg2.createSVGTransform();
      expect(typeof t.setTranslate).toBe('function');
      t.setTranslate(5, 10);
      expect(t.matrix.e).toBe(5);
      expect(t.matrix.f).toBe(10);
    });

    test('createSVGTransformFromMatrix copies matrix values', () => {
      const svg2 = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      expect(typeof svg2.createSVGTransformFromMatrix).toBe('function');
      const m = new win.SVGMatrix();
      m.e = 7;
      m.f = 8;
      const t = svg2.createSVGTransformFromMatrix(m);
      expect(t.matrix.e).toBe(7);
      expect(t.matrix.f).toBe(8);
    });
  });

  describe('SVGElement methods', () => {
    let rect: any;

    test('getBBox returns a box-like object with numeric fields', () => {
      rect = win.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', '100');
      rect.setAttribute('height', '50');
      expect(typeof rect.getBBox).toBe('function');
      const box = rect.getBBox();
      expect(typeof box.x).toBe('number');
      expect(typeof box.y).toBe('number');
      expect(typeof box.width).toBe('number');
      expect(typeof box.height).toBe('number');
    });

    test('getScreenCTM returns an SVGMatrix-like object', () => {
      const el = win.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      expect(typeof el.getScreenCTM).toBe('function');
      const ctm = el.getScreenCTM();
      expect(ctm).toBeDefined();
      expect(typeof ctm.a).toBe('number');
    });

    test('getCTM returns an SVGMatrix-like object', () => {
      const el = win.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      expect(typeof el.getCTM).toBe('function');
      const ctm = el.getCTM();
      expect(ctm).toBeDefined();
    });

    test('getComputedTextLength returns a number', () => {
      const text = win.document.createElementNS('http://www.w3.org/2000/svg', 'text');
      expect(typeof text.getComputedTextLength).toBe('function');
      expect(typeof text.getComputedTextLength()).toBe('number');
    });

    test('getTotalLength is defined and returns a number', () => {
      const path = win.document.createElementNS('http://www.w3.org/2000/svg', 'path');
      expect(typeof path.getTotalLength).toBe('function');
      expect(typeof path.getTotalLength()).toBe('number');
    });

    test('getPointAtLength is defined and returns a point-like object', () => {
      const path = win.document.createElementNS('http://www.w3.org/2000/svg', 'path');
      expect(typeof path.getPointAtLength).toBe('function');
      const pt = path.getPointAtLength(0);
      expect(typeof pt.x).toBe('number');
      expect(typeof pt.y).toBe('number');
    });

    test('isPointInStroke is defined and returns a boolean', () => {
      const path = win.document.createElementNS('http://www.w3.org/2000/svg', 'path');
      expect(typeof path.isPointInStroke).toBe('function');
      expect(typeof path.isPointInStroke()).toBe('boolean');
    });
  });

  describe('SVGElement.transform (baseVal / animVal with DOM sync)', () => {
    test('transform property exists with baseVal', () => {
      const el = win.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      expect(el.transform).toBeDefined();
      expect(el.transform.baseVal).toBeDefined();
    });

    test('appendItem adds a transform and syncs the DOM attribute', () => {
      const el = win.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const t = svg.createSVGTransform();
      t.setTranslate(15, 25);

      el.transform.baseVal.appendItem(t);
      expect(el.transform.baseVal.numberOfItems).toBe(1);

      // DOM attribute should be synced
      const attr = el.getAttribute('transform');
      expect(attr).toContain('15');
      expect(attr).toContain('25');
    });

    test('clear removes all transforms and removes DOM attribute', () => {
      const el = win.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const t = svg.createSVGTransform();
      t.setTranslate(5, 5);
      el.transform.baseVal.appendItem(t);

      el.transform.baseVal.clear();
      expect(el.transform.baseVal.numberOfItems).toBe(0);
      expect(el.getAttribute('transform')).toBeNull();
    });

    test('consolidate merges multiple transforms into one', () => {
      const el = win.document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const t1 = svg.createSVGTransform();
      t1.setTranslate(10, 0);
      const t2 = svg.createSVGTransform();
      t2.setTranslate(0, 20);

      el.transform.baseVal.appendItem(t1);
      el.transform.baseVal.appendItem(t2);
      expect(el.transform.baseVal.numberOfItems).toBe(2);

      el.transform.baseVal.consolidate();
      expect(el.transform.baseVal.numberOfItems).toBe(1);
    });
  });
});
