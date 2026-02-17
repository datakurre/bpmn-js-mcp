/**
 * Core test utilities for diagram creation, element manipulation, and teardown.
 * Used by the majority of test files.
 */
import {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleExportBpmn,
  handleImportXml,
  handleLayoutDiagram,
} from '../../src/handlers';
import { clearDiagrams, getDiagram } from '../../src/diagram-manager';
import { resolve } from 'node:path';

export function parseResult(result: any) {
  return JSON.parse(result.content[0].text);
}

export async function createDiagram(name?: string) {
  return parseResult(await handleCreateDiagram({ name })).diagramId as string;
}

export async function addElement(
  diagramId: string,
  elementType: string,
  opts: Record<string, any> = {}
) {
  return parseResult(await handleAddElement({ diagramId, elementType, ...opts }))
    .elementId as string;
}

/** Connect two elements by ID. Returns the connection ID. */
export async function connect(
  diagramId: string,
  sourceId: string,
  targetId: string,
  opts: Record<string, any> = {}
) {
  return parseResult(
    await handleConnect({
      diagramId,
      sourceElementId: sourceId,
      targetElementId: targetId,
      ...opts,
    })
  ).connectionId as string;
}

/** Connect a chain of elements in sequence. Returns array of connection IDs. */
export async function connectAll(diagramId: string, ...ids: string[]) {
  const result = parseResult(await handleConnect({ diagramId, elementIds: ids } as any));
  return (result.connections as Array<{ connectionId: string }>).map((c) => c.connectionId);
}

/** Export diagram XML (skipping lint). Returns raw XML string. */
export async function exportXml(diagramId: string) {
  return (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0].text;
}

/** Get the elementRegistry for a diagram. */
export function getRegistry(diagramId: string) {
  return getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
}

/** Build a minimal Start → Task → End process. Returns element IDs. */
export async function createSimpleProcess(
  diagramId: string,
  opts?: { taskType?: string; taskName?: string }
) {
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const task = await addElement(diagramId, opts?.taskType || 'bpmn:UserTask', {
    name: opts?.taskName || 'Task',
  });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
  await connect(diagramId, start, task);
  await connect(diagramId, task, end);
  return { start, task, end };
}

export { clearDiagrams };

// ── Reference BPMN helpers ─────────────────────────────────────────────────

const REFERENCES_DIR = resolve(__dirname, '..', 'fixtures', 'layout-references');

/**
 * Import a reference BPMN by short name (e.g. '01-linear-flow', '06-boundary-events').
 * Returns the diagramId and the elementRegistry.
 */
export async function importReference(name: string) {
  const filePath = resolve(REFERENCES_DIR, `${name}.bpmn`);
  const result = parseResult(await handleImportXml({ filePath }));
  const diagramId = result.diagramId as string;
  const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
  return { diagramId, registry };
}

/**
 * Import a reference BPMN, run ELK layout, and return the registry.
 * Convenience for tests that need layout results against a reference.
 */
export async function importAndLayout(name: string) {
  const { diagramId, registry } = await importReference(name);
  await handleLayoutDiagram({ diagramId });
  // Re-fetch registry after layout (same object, but clearer intent)
  return { diagramId, registry };
}
