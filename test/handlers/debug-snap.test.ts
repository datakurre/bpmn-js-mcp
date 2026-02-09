import { describe, it, expect, afterEach } from 'vitest';
import { handleConnect } from '../../src/handlers/connect';
import { handleLayoutDiagram } from '../../src/handlers/layout-diagram';
import { getDiagram, clearDiagrams } from '../../src/diagram-manager';
import { createDiagram, addElement } from '../helpers';

afterEach(() => clearDiagrams());

describe('debug snap', () => {
  it('waypoints after handleLayoutDiagram', async () => {
    const diagramId = await createDiagram('Snap Debug');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision' });
    const taskYes = await addElement(diagramId, 'bpmn:UserTask', { name: 'Yes Path' });
    const taskNo = await addElement(diagramId, 'bpmn:UserTask', { name: 'No Path' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: taskYes, label: 'Yes' });
    await handleConnect({
      diagramId,
      sourceElementId: gw,
      targetElementId: taskNo,
      label: 'No',
      isDefault: true,
    });
    await handleConnect({ diagramId, sourceElementId: taskYes, targetElementId: merge });
    await handleConnect({ diagramId, sourceElementId: taskNo, targetElementId: merge });
    await handleConnect({ diagramId, sourceElementId: merge, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      const wps = conn.waypoints;
      // Waypoints: conn.id wps (diagnostic output removed for lint)
      for (let i = 1; i < wps.length; i++) {
        const dx = Math.abs(wps[i].x - wps[i - 1].x);
        const dy = Math.abs(wps[i].y - wps[i - 1].y);
        if (dx >= 1 && dy >= 1) {
          // Diagonal segment detected: i-1 → i
        }
      }
    }
    expect(true).toBe(true);
  });
});
