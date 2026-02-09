/**
 * Tests for the multiple-expanded-pools bpmnlint rule.
 *
 * Verifies that the rule warns when a collaboration has more than one
 * expanded pool (Camunda 7 / Operaton constraint: only one pool can
 * be deployed and executed).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
  handleValidate,
} from '../../src/handlers';
import { handleSetEventDefinition } from '../../src/handlers/set-event-definition';
import { parseResult, createDiagram, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('bpmnlint multiple-expanded-pools', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  it('warns when multiple pools are expanded', async () => {
    const diagramId = await createDiagram();

    // Create a collaboration with two expanded pools (default)
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Process' },
          { name: 'External System' },
        ],
      })
    );

    expect(collab.participantIds).toHaveLength(2);

    // Validate — should warn about multiple expanded pools
    const res = parseResult(await handleValidate({ diagramId }));

    const issues = res.issues?.filter(
      (issue: any) => issue.rule === 'bpmn-mcp/multiple-expanded-pools'
    ) ?? [];

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('expanded pools found');
    expect(issues[0].message).toContain('Main Process');
    expect(issues[0].message).toContain('External System');
  });

  it('does not warn when only one pool is expanded and the other is collapsed', async () => {
    const diagramId = await createDiagram();

    // Create a collaboration with one expanded pool and one collapsed pool
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Process' },
          { name: 'Payment Gateway', collapsed: true },
        ],
      })
    );

    expect(collab.participantIds).toHaveLength(2);

    // The collapsed pool should have a small height
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const collapsedPool = reg.get(collab.participantIds[1]);
    expect(collapsedPool.height).toBeLessThan(100); // collapsed height is ~60px

    // Validate — should NOT have the multiple-expanded-pools warning
    const res = parseResult(await handleValidate({ diagramId }));

    const issues = res.issues?.filter(
      (issue: any) => issue.rule === 'bpmn-mcp/multiple-expanded-pools'
    ) ?? [];

    expect(issues.length).toBe(0);
  });

  it('supports message flows to collapsed pools', async () => {
    const diagramId = await createDiagram();

    // Create collaboration: one expanded, one collapsed
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Order Process' },
          { name: 'Payment Service', collapsed: true },
        ],
      })
    );

    const mainPool = collab.participantIds[0];
    const collapsedPool = collab.participantIds[1];

    // Build a process in the main pool
    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Received',
        participantId: mainPool,
      })
    );
    const sendPayment = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:IntermediateThrowEvent',
        name: 'Request Payment',
        participantId: mainPool,
      })
    );
    await handleSetEventDefinition({
      diagramId,
      elementId: sendPayment.elementId,
      eventDefinitionType: 'bpmn:MessageEventDefinition',
      messageRef: { id: 'Msg_PayReq', name: 'PaymentRequest' },
    });
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        participantId: mainPool,
      })
    );
    await handleConnect({
      diagramId,
      elementIds: [start.elementId, sendPayment.elementId, end.elementId],
    });

    // Message flow from the main pool element to the collapsed pool participant
    await handleConnect({
      diagramId,
      sourceElementId: sendPayment.elementId,
      targetElementId: collapsedPool,
      connectionType: 'bpmn:MessageFlow',
    });

    // Validate — should NOT have multiple-expanded-pools warning
    const res = parseResult(await handleValidate({ diagramId }));
    const poolIssues = res.issues?.filter(
      (issue: any) => issue.rule === 'bpmn-mcp/multiple-expanded-pools'
    ) ?? [];
    expect(poolIssues.length).toBe(0);
  });
});
