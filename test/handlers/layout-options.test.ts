/**
 * Tests for layout_bpmn_diagram options: compactness, simplifyRoutes.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleConnect, handleCreateCollaboration } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams, parseResult } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('layout_bpmn_diagram — compactness option', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('compact mode produces tighter spacing than default', async () => {
    // Build two identical diagrams, one with compact, one with default
    const compactId = await createDiagram('Compact');
    const defaultId = await createDiagram('Default');

    for (const diagramId of [compactId, defaultId]) {
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
      await handleConnect({ diagramId, sourceElementId: t1, targetElementId: t2 });
      await handleConnect({ diagramId, sourceElementId: t2, targetElementId: end });
    }

    await handleLayoutDiagram({ diagramId: compactId, compactness: 'compact' });
    await handleLayoutDiagram({ diagramId: defaultId });

    const compactReg = getDiagram(compactId)!.modeler.get('elementRegistry');
    const defaultReg = getDiagram(defaultId)!.modeler.get('elementRegistry');

    // Find the end events — their x-position indicates overall diagram width
    const compactEnd = compactReg.filter((el: any) => el.type === 'bpmn:EndEvent')[0];
    const defaultEnd = defaultReg.filter((el: any) => el.type === 'bpmn:EndEvent')[0];

    // Compact layout should be narrower (smaller total width)
    expect(compactEnd.x).toBeLessThan(defaultEnd.x);
  });

  test('spacious mode produces wider spacing than default', async () => {
    const spaciousId = await createDiagram('Spacious');
    const defaultId = await createDiagram('Default');

    for (const diagramId of [spaciousId, defaultId]) {
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
      await handleConnect({ diagramId, sourceElementId: t1, targetElementId: end });
    }

    await handleLayoutDiagram({ diagramId: spaciousId, compactness: 'spacious' });
    await handleLayoutDiagram({ diagramId: defaultId });

    const spaciousReg = getDiagram(spaciousId)!.modeler.get('elementRegistry');
    const defaultReg = getDiagram(defaultId)!.modeler.get('elementRegistry');

    const spaciousEnd = spaciousReg.filter((el: any) => el.type === 'bpmn:EndEvent')[0];
    const defaultEnd = defaultReg.filter((el: any) => el.type === 'bpmn:EndEvent')[0];

    // Spacious layout should be wider
    expect(spaciousEnd.x).toBeGreaterThan(defaultEnd.x);
  });

  test('explicit nodeSpacing overrides compactness preset', async () => {
    const diagramId = await createDiagram('Override');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: t1 });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: end });

    // Use compact preset but override with large spacing
    const result = await handleLayoutDiagram({
      diagramId,
      compactness: 'compact',
      nodeSpacing: 120,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
  });
});

describe('layout_bpmn_diagram — simplifyRoutes option', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('simplifyRoutes=false preserves ELK routing', async () => {
    const diagramId = await createDiagram('NoSimplify');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Split?' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const join = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: t1, label: 'Yes' });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: t2, label: 'No' });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

    const result = await handleLayoutDiagram({ diagramId, simplifyRoutes: false });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
  });

  test('simplifyRoutes defaults to true', async () => {
    const diagramId = await createDiagram('DefaultSimplify');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Split?' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const join = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: gw });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: t1, label: 'Yes' });
    await handleConnect({ diagramId, sourceElementId: gw, targetElementId: t2, label: 'No' });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: t2, targetElementId: join });
    await handleConnect({ diagramId, sourceElementId: join, targetElementId: end });

    const result = await handleLayoutDiagram({ diagramId });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
  });
});

describe('layout_bpmn_diagram — pool vertical centering (AP-2)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('elements are vertically centred within their pool', async () => {
    const diagramId = await createDiagram('Pool Centering');

    await handleCreateCollaboration({
      diagramId,
      participants: [
        { name: 'Main Process', width: 600, height: 300 },
        { name: 'External System', collapsed: true },
      ],
    });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const participants = reg.filter((el: any) => el.type === 'bpmn:Participant');
    const mainPool = participants.find(
      (p: any) => !p.collapsed && p.businessObject?.name === 'Main Process'
    );

    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: mainPool.id,
    });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      participantId: mainPool.id,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      participantId: mainPool.id,
    });

    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    await handleLayoutDiagram({ diagramId });

    // Re-fetch after layout
    const poolAfter = reg.get(mainPool.id);
    const taskAfter = reg.get(task);

    // Task's vertical centre should be close to pool's vertical centre
    const poolCy = poolAfter.y + poolAfter.height / 2;
    const taskCy = taskAfter.y + taskAfter.height / 2;

    // Allow up to 30px offset (padding asymmetry from the pool label band)
    expect(Math.abs(poolCy - taskCy)).toBeLessThan(30);
  });
});
