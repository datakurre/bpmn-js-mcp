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

const diagrams = new Map<string, DiagramState>();

export function getDiagram(id: string): DiagramState | undefined {
  return diagrams.get(id);
}

export function storeDiagram(id: string, state: DiagramState): void {
  diagrams.set(id, state);
}

export function deleteDiagram(id: string): boolean {
  return diagrams.delete(id);
}

export function getAllDiagrams(): Map<string, DiagramState> {
  return diagrams;
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
