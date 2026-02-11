/**
 * Headless browser environment for bpmn-js.
 *
 * Creates a jsdom instance with all SVG / CSS polyfills required to run the
 * bpmn-js browser bundle outside of a real browser.  The instance is lazily
 * initialised on first call and then reused.
 *
 * Polyfill implementations live in `./headless-polyfills.ts`.
 */

import { JSDOM } from 'jsdom';
import fs from 'fs';
import { applyPolyfills } from './headless-polyfills';

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
