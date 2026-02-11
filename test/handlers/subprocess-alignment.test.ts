import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('vertical alignment inside expanded subprocesses (AS-2)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('elements inside an expanded subprocess align vertically', async () => {
    const diagramId = await createDiagram('Subprocess Alignment');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'Sub Process' });

    // Make the subprocess expanded by adding elements inside it
    // (elements added with afterElementId inside the subprocess scope)
    const subStart = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Sub Start',
      x: 200,
      y: 200,
    });
    const subTask = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Sub Task',
      x: 300,
      y: 200,
    });
    const subEnd = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Sub End',
      x: 400,
      y: 200,
    });

    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: sub });
    await handleConnect({ diagramId, sourceElementId: subStart, targetElementId: subTask });
    await handleConnect({ diagramId, sourceElementId: subTask, targetElementId: subEnd });
    await handleConnect({ diagramId, sourceElementId: sub, targetElementId: end });

    // Run layout
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // Verify elements are laid out left-to-right
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const endEl = reg.get(end);

    expect(startEl.x).toBeLessThan(endEl.x);
  });
});
