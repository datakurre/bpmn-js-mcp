/**
 * bpmnlint rules tests — quality, validation, and helpdesk rules.
 *
 * Merged from: new-validation-rules.test.ts, quality-rules.test.ts, todo-helpdesk-rules.test.ts
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleValidate as handleLintDiagram,
  handleSetEventDefinition,
  handleAddElement,
  handleCreateCollaboration,
  handleConnect,
  handleSetProperties,
  handleMoveElement,
  handleCreateLanes,
  handleAssignElementsToLane,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  clearDiagrams,
  connectAll,
  connect,
} from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('add_bpmn_elements argument validation', () => {
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
    ).rejects.toThrow(/operation requires/);
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

    // Create one connection via MCP tool
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
    // Create a second connection directly via modeler to bypass the dedup guard
    // (the guard prevents duplicates via handleConnect, so we test the lint rule separately)
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;
    modeling.connect(elementRegistry.get(start), elementRegistry.get(task));
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

describe('subprocess-expansion-issue rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when expanded subprocess is too small', async () => {
    const diagramId = await createDiagram('Subprocess Size Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'Small Sub' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, sub);
    await connect(diagramId, sub, end);

    // Resize the subprocess to be too small (below 300×180 thresholds)
    await handleMoveElement({
      diagramId,
      elementId: sub,
      width: 200,
      height: 100,
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/subprocess-expansion-issue': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/subprocess-expansion-issue');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('too small');
  });

  test('does not warn when expanded subprocess has adequate size', async () => {
    const diagramId = await createDiagram('Subprocess Size OK');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    // Default expanded subprocess is 350×200 — should be fine
    const sub = await addElement(diagramId, 'bpmn:SubProcess', { name: 'Normal Sub' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, sub);
    await connect(diagramId, sub, end);

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/subprocess-expansion-issue': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/subprocess-expansion-issue');
    expect(issues.length).toBe(0);
  });
});

describe('lane-overcrowding rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when lane has too many elements for its height', async () => {
    const diagramId = await createDiagram('Lane Overcrowding Test');

    // Create a collaboration with a pool
    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Pool', width: 1200, height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collResult.participantIds[0];

    // Create two lanes using addElement
    const laneA = await addElement(diagramId, 'bpmn:Lane', {
      name: 'Manager',
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:Lane', {
      name: 'Worker',
      participantId: poolId,
    });

    // Add many elements to the first lane
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review A', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review B', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review C', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review D', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review E', laneId: laneA });

    // Resize the first lane to be very small (100px)
    await handleMoveElement({
      diagramId,
      elementId: laneA,
      height: 100,
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/lane-overcrowding': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-overcrowding');
    // With 5 elements in a 100px lane, this should definitely fire
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('elements');
  });

  test('does not warn when lane has adequate height for elements', async () => {
    const diagramId = await createDiagram('Lane Adequate');

    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool', width: 1200, height: 600 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collResult.participantIds[0];

    const laneA = await addElement(diagramId, 'bpmn:Lane', {
      name: 'Team A',
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:Lane', {
      name: 'Team B',
      participantId: poolId,
    });

    // Just 2 elements in a lane
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1', laneId: laneA });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2', laneId: laneA });

    // Resize lane to be large enough (240+ for 2 elements)
    await handleMoveElement({
      diagramId,
      elementId: laneA,
      height: 300,
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/lane-overcrowding': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-overcrowding');
    expect(issues.length).toBe(0);
  });
});

describe('role-mismatch-with-lane rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when user task assignee does not match lane name', async () => {
    const diagramId = await createDiagram('Role Mismatch Test');

    // Create collaboration with a pool
    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Organization', width: 800, height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collResult.participantIds[0];

    // Create lanes
    const managerLane = await addElement(diagramId, 'bpmn:Lane', {
      name: 'Manager',
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:Lane', {
      name: 'Developer',
      participantId: poolId,
    });

    // Add a user task and assign to Manager lane
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review Code',
      laneId: managerLane,
    });

    // Set assignee to "finance" which doesn't match "Manager"
    await handleSetProperties({
      diagramId,
      elementId: task,
      properties: { 'camunda:assignee': 'finance_team' },
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/role-mismatch-with-lane': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/role-mismatch-with-lane');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('finance_team');
    expect(issues[0].message).toContain('Manager');
  });

  test('does not warn when assignee matches lane name', async () => {
    const diagramId = await createDiagram('Role Match Test');

    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Organization', width: 800, height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const poolId = collResult.participantIds[0];

    const managerLane = await addElement(diagramId, 'bpmn:Lane', {
      name: 'Manager',
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:Lane', {
      name: 'Developer',
      participantId: poolId,
    });

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Approve Request',
      laneId: managerLane,
    });

    // Set assignee that matches the lane name (fuzzy match)
    await handleSetProperties({
      diagramId,
      elementId: task,
      properties: { 'camunda:assignee': 'manager' },
    });

    const res = parseResult(
      await handleLintDiagram({
        diagramId,
        config: {
          extends: 'plugin:bpmn-mcp/recommended',
          rules: { 'bpmn-mcp/role-mismatch-with-lane': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/role-mismatch-with-lane');
    expect(issues.length).toBe(0);
  });
});

describe('TODO-helpdesk bpmnlint rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── lane-candidate-detection ─────────────────────────────────────────

  // ── lane-without-assignments ─────────────────────────────────────────

  describe('lane-without-assignments', () => {
    test('warns when user tasks in lanes lack role assignments', async () => {
      const diagramId = await createDiagram('No Assignments');
      const participant = await addElement(diagramId, 'bpmn:Participant', {
        name: 'Pool',
        x: 400,
        y: 300,
      });

      const lanesRes = parseResult(
        await handleCreateLanes({
          diagramId,
          participantId: participant,
          lanes: [{ name: 'Support' }, { name: 'Manager' }],
        })
      );
      const laneIds = lanesRes.laneIds as string[];

      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Handle Ticket',
        participantId: participant,
      });

      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [t1],
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/lane-without-assignments': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-without-assignments');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('no camunda:assignee');
    });

    test('does not fire when user tasks have assignees', async () => {
      const diagramId = await createDiagram('With Assignments');
      const participant = await addElement(diagramId, 'bpmn:Participant', {
        name: 'Pool',
        x: 400,
        y: 300,
      });

      const lanesRes = parseResult(
        await handleCreateLanes({
          diagramId,
          participantId: participant,
          lanes: [{ name: 'Support' }, { name: 'Manager' }],
        })
      );
      const laneIds = lanesRes.laneIds as string[];

      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Handle Ticket',
        participantId: participant,
      });

      await handleSetProperties({
        diagramId,
        elementId: t1,
        properties: { 'camunda:assignee': 'support-agent' },
      });

      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [t1],
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/lane-without-assignments': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-without-assignments');
      expect(issues.length).toBe(0);
    });
  });

  // ── collaboration-pattern-mismatch ───────────────────────────────────

  describe('collaboration-pattern-mismatch', () => {
    test('warns when expanded pool contains only message events', async () => {
      const diagramId = await createDiagram('Pattern Mismatch');

      const collab = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [{ name: 'Main Process' }, { name: 'External System' }],
        })
      );
      const [mainPool, extPool] = collab.participantIds;

      // Add real tasks to main pool
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        participantId: mainPool,
      });
      const task = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Process Order',
        participantId: mainPool,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Done',
        participantId: mainPool,
      });
      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      // Add only message events to external pool
      const extStart = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Receive',
        participantId: extPool,
      });
      const extEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Respond',
        participantId: extPool,
      });
      await connect(diagramId, extStart, extEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/collaboration-pattern-mismatch': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/collaboration-pattern-mismatch'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('only message events');
    });

    test('does not fire when both pools have tasks (via XML import)', async () => {
      // Use XML import to ensure processRef is properly set for both participants
      // (headless bpmn-js doesn't always populate processRef for second pool)
      const { handleImportXml } = await import('../../../src/handlers');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Customer" name="Customer" processRef="Process_Customer" />
    <bpmn:participant id="P_Supplier" name="Supplier" processRef="Process_Supplier" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Customer" isExecutable="true">
    <bpmn:userTask id="Task_PlaceOrder" name="Place Order" />
  </bpmn:process>
  <bpmn:process id="Process_Supplier" isExecutable="false">
    <bpmn:userTask id="Task_FulfillOrder" name="Fulfill Order" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Customer_di" bpmnElement="P_Customer" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_PlaceOrder_di" bpmnElement="Task_PlaceOrder">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_Supplier_di" bpmnElement="P_Supplier" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_FulfillOrder_di" bpmnElement="Task_FulfillOrder">
        <dc:Bounds x="200" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

      const importRes = parseResult(await handleImportXml({ xml }));
      const diagramId = importRes.diagramId;

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/collaboration-pattern-mismatch': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/collaboration-pattern-mismatch'
      );
      expect(issues.length).toBe(0);
    });

    test('does not fire when the message-only pool is collapsed', async () => {
      const diagramId = await createDiagram('Collapsed Pool');

      parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [{ name: 'Main Process' }, { name: 'External API', collapsed: true }],
        })
      );

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/collaboration-pattern-mismatch': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/collaboration-pattern-mismatch'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── long-message-flow-path ───────────────────────────────────────────
});
