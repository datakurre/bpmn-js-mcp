import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLintDiagram,
  handleSetEventDefinition,
  handleAddElement,
  handleCreateCollaboration,
  handleConnect,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connectAll } from '../../helpers';

describe('add_bpmn_element argument validation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('rejects BoundaryEvent without hostElementId', async () => {
    const diagramId = await createDiagram('Test');
    await expect(
      handleAddElement({ diagramId, elementType: 'bpmn:BoundaryEvent' })
    ).rejects.toThrow(/hostElementId/);
  });

  test('rejects BoundaryEvent with afterElementId', async () => {
    const diagramId = await createDiagram('Test');
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: task,
        afterElementId: task,
      })
    ).rejects.toThrow(/afterElementId/);
  });

  test('rejects flowId combined with afterElementId', async () => {
    const diagramId = await createDiagram('Test');
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        flowId: 'Flow_1',
        afterElementId: 'Element_1',
      })
    ).rejects.toThrow(/flowId.*afterElementId|afterElementId.*flowId/);
  });

  test('rejects eventDefinitionType on non-event element', async () => {
    const diagramId = await createDiagram('Test');
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        eventDefinitionType: 'bpmn:TimerEventDefinition',
      })
    ).rejects.toThrow(/eventDefinitionType/);
  });

  test('allows valid BoundaryEvent with hostElementId', async () => {
    const diagramId = await createDiagram('Test');
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: task,
      })
    );
    expect(result.success).toBe(true);
  });
});

describe('create_bpmn_collaboration explicit participantId', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('uses explicit participantId when provided', async () => {
    const diagramId = await createDiagram('Collab Test');
    const result = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Customer', participantId: 'Pool_Customer' },
          { name: 'Service', participantId: 'Pool_Service', collapsed: true },
        ],
      })
    );
    expect(result.participantIds).toContain('Pool_Customer');
    expect(result.participantIds).toContain('Pool_Service');
  });

  test('rejects duplicate participantId', async () => {
    const diagramId = await createDiagram('Collab Test');
    await expect(
      handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool A', participantId: 'Pool_1' },
          { name: 'Pool B', participantId: 'Pool_1' },
        ],
      })
    ).rejects.toThrow(/already exists/);
  });

  test('falls back to generated ID when participantId omitted', async () => {
    const diagramId = await createDiagram('Collab Test');
    const result = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer Service' }, { name: 'Backend API', collapsed: true }],
      })
    );
    expect(result.participantIds).toHaveLength(2);
    expect(result.participantIds[0]).toContain('Participant');
  });
});

describe('duplicate-edges-same-waypoints lint rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns on duplicate sequence flows between same elements', async () => {
    const diagramId = await createDiagram('Duplicate Edges');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    // Create two connections between start and task
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/duplicate-edges-same-waypoints': 'error' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/duplicate-edges-same-waypoints'
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('Duplicate sequence flow');
  });

  test('no warning for single flow between elements', async () => {
    const diagramId = await createDiagram('Single Edge');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connectAll(diagramId, start, task, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/duplicate-edges-same-waypoints': 'error' },
        },
      })
    );

    const issues = res.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/duplicate-edges-same-waypoints'
    );
    expect(issues).toHaveLength(0);
  });
});

describe('unpaired-link-event lint rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns on unmatched link throw event', async () => {
    const diagramId = await createDiagram('Link Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const throwLink = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', {
      name: 'Go to page 2',
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connectAll(diagramId, start, throwLink, end);

    // Set link event definition
    await handleSetEventDefinition({
      diagramId,
      elementId: throwLink,
      eventDefinitionType: 'bpmn:LinkEventDefinition',
      properties: { name: 'Page2' },
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/unpaired-link-event': 'error' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/unpaired-link-event');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('no matching catch event');
  });

  test('no warning for properly paired link events', async () => {
    const diagramId = await createDiagram('Paired Link Test');

    // Throw side
    const start1 = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start 1' });
    const throwLink = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', {
      name: 'Go to page 2',
    });
    await connectAll(diagramId, start1, throwLink);

    // Catch side
    const catchLink = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', {
      name: 'From page 1',
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connectAll(diagramId, catchLink, end);

    // Set matching link event definitions
    await handleSetEventDefinition({
      diagramId,
      elementId: throwLink,
      eventDefinitionType: 'bpmn:LinkEventDefinition',
      properties: { name: 'Page2Link' },
    });
    await handleSetEventDefinition({
      diagramId,
      elementId: catchLink,
      eventDefinitionType: 'bpmn:LinkEventDefinition',
      properties: { name: 'Page2Link' },
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/unpaired-link-event': 'error' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/unpaired-link-event');
    expect(issues).toHaveLength(0);
  });
});
