/**
 * Manages the in-memory store of BPMN diagrams and exposes helpers
 * for creating / retrieving / importing diagrams.
 */

import { randomBytes } from 'node:crypto';
import { type DiagramState } from './types';
import { createHeadlessCanvas, getBpmnModeler } from './headless-canvas';
import camundaModdle from 'camunda-bpmn-moddle/resources/camunda.json';

/** Default BPMN XML used when creating a brand-new diagram. */
export const INITIAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="P180D">
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

// ── Diagram store ──────────────────────────────────────────────────────────

/**
 * Hard upper bound on the number of concurrently held diagrams.
 *
 * Each DiagramState holds a full bpmn-js modeler (jsdom document + canvas),
 * so unbounded growth would exhaust memory in long-running sessions.
 * When the limit is reached, `storeDiagram` evicts the oldest diagram (FIFO)
 * before inserting the new one.
 *
 * Override with the `BPMN_MCP_MAX_DIAGRAMS` environment variable.
 */
export const MAX_DIAGRAMS: number = (() => {
  const env = process.env['BPMN_MCP_MAX_DIAGRAMS'];
  const parsed = env ? Number.parseInt(env, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
})();

const diagrams = new Map<string, DiagramState>();

/** Reverse index: modeler instance → diagram ID. Avoids O(n) lookups in linter. */
const modelerToDiagramId = new WeakMap<object, string>();

export function getDiagram(id: string): DiagramState | undefined {
  return diagrams.get(id);
}

export function storeDiagram(id: string, state: DiagramState): void {
  // If this is a new diagram (not an update) and we're at the limit, evict oldest.
  if (!diagrams.has(id) && diagrams.size >= MAX_DIAGRAMS) {
    const oldest = diagrams.keys().next().value;
    if (oldest !== undefined) {
      const oldState = diagrams.get(oldest);
      if (oldState?.modeler) modelerToDiagramId.delete(oldState.modeler);
      diagrams.delete(oldest);
      console.error(
        `[diagram-manager] diagram limit (${MAX_DIAGRAMS}) reached — evicted oldest diagram "${oldest}".`
      );
    }
  }
  diagrams.set(id, state);
  if (state.modeler) {
    modelerToDiagramId.set(state.modeler, id);
  }
}

export function deleteDiagram(id: string): boolean {
  const state = diagrams.get(id);
  if (state?.modeler) {
    modelerToDiagramId.delete(state.modeler);
  }
  return diagrams.delete(id);
}

export function getAllDiagrams(): Map<string, DiagramState> {
  return diagrams;
}

/**
 * O(1) reverse lookup: find the diagram ID for a DiagramState.
 * Falls back to O(n) scan if the WeakMap entry is missing.
 */
export function getDiagramId(diagram: DiagramState): string | undefined {
  if (diagram.modeler) {
    const id = modelerToDiagramId.get(diagram.modeler);
    if (id !== undefined) return id;
  }
  // Fallback: linear scan (should not happen in normal operation)
  for (const [id, state] of diagrams) {
    if (state === diagram) return id;
  }
  return undefined;
}

export function generateDiagramId(): string {
  return `diagram_${Date.now()}_${randomBytes(6).toString('hex')}`;
}

/** Visible for testing – wipe all diagrams. */
export function clearDiagrams(): void {
  diagrams.clear();
}

// ── Modeler helpers ────────────────────────────────────────────────────────

/** Shared moddle-extensions option used by every modeler instance. */
const moddleExtensions = { camunda: camundaModdle };

/** Create a fresh BpmnModeler initialised with the default blank diagram. */
export async function createModeler(): Promise<any> {
  const container = createHeadlessCanvas();
  const BpmnModeler = getBpmnModeler();
  const modeler = new BpmnModeler({ container, moddleExtensions });
  await modeler.importXML(INITIAL_XML);
  return modeler;
}

/** Create a BpmnModeler and import the supplied XML into it. */
export async function createModelerFromXml(xml: string): Promise<any> {
  const container = createHeadlessCanvas();
  const BpmnModeler = getBpmnModeler();
  const modeler = new BpmnModeler({ container, moddleExtensions });
  await modeler.importXML(xml);
  return modeler;
}
