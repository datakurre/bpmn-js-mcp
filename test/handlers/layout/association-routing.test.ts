import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  getRegistry,
} from '../../helpers';
import { handleConnect } from '../../../src/handlers/elements/connect';

describe('association routing — E3', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('text annotation association gets straight-line waypoints after layout', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Process Order' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const annotation = await addElement(diagramId, 'bpmn:TextAnnotation', { name: 'Note' });

    // Connect flow
    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    // Create association from task to annotation
    const assocResult = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: task,
        targetElementId: annotation,
        connectionType: 'bpmn:Association',
      })
    );
    const assocId = assocResult.connectionId as string;

    // Run layout
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Check that the association has exactly 2 waypoints (straight line)
    const registry = getRegistry(diagramId);
    const assoc = registry.get(assocId);
    expect(assoc).toBeDefined();
    expect(assoc.waypoints).toBeDefined();
    expect(assoc.waypoints.length).toBe(2);
  });

  test('data object association gets straight-line waypoints after layout', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const dataObj = await addElement(diagramId, 'bpmn:DataObjectReference', { name: 'Data' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    const assocResult = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: task,
        targetElementId: dataObj,
        connectionType: 'bpmn:Association',
      })
    );
    const assocId = assocResult.connectionId as string;

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const registry = getRegistry(diagramId);
    const assoc = registry.get(assocId);
    expect(assoc).toBeDefined();
    expect(assoc.waypoints).toBeDefined();
    // Straight-line: exactly 2 waypoints
    expect(assoc.waypoints.length).toBe(2);
  });

  test('association waypoints connect centres of source and target after layout', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    const annotation = await addElement(diagramId, 'bpmn:TextAnnotation', { name: 'Note' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);
    const assocResult = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: task,
        targetElementId: annotation,
        connectionType: 'bpmn:Association',
      })
    );
    const assocId = assocResult.connectionId as string;

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const assoc = registry.get(assocId);
    const taskEl = registry.get(task);
    const annotEl = registry.get(annotation);

    // Verify straight-line: exactly 2 waypoints
    expect(assoc.waypoints.length).toBe(2);

    // Waypoints should be close to the elements (within element half-width of centres)
    // First waypoint should be near the task
    const taskCx = taskEl.x + taskEl.width / 2;
    const taskHalfDiag = Math.sqrt((taskEl.width / 2) ** 2 + (taskEl.height / 2) ** 2);
    const wp0dist = Math.sqrt(
      (assoc.waypoints[0].x - taskCx) ** 2 +
        (assoc.waypoints[0].y - (taskEl.y + taskEl.height / 2)) ** 2
    );
    expect(wp0dist).toBeLessThan(taskHalfDiag + 10);

    // Second waypoint should be near the annotation
    const annotCx = annotEl.x + (annotEl.width || 0) / 2;
    const annotCy = annotEl.y + (annotEl.height || 0) / 2;
    const wp1dist = Math.sqrt(
      (assoc.waypoints[1].x - annotCx) ** 2 + (assoc.waypoints[1].y - annotCy) ** 2
    );
    expect(wp1dist).toBeLessThan(Math.max(annotEl.width || 100, annotEl.height || 50) + 10);
  });
});
