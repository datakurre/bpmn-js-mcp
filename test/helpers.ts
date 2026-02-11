import {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleExportBpmn,
} from '../src/handlers';
import { clearDiagrams, getDiagram } from '../src/diagram-manager';

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
