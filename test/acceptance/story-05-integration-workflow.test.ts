/**
 * Story 5: Integration Workflow — Call Activities, Data Objects, Annotations
 *
 * Covers: add_bpmn_element (CallActivity, DataObjectReference,
 * DataStoreReference, TextAnnotation, Group, IntermediateCatchEvent,
 * IntermediateThrowEvent), set_bpmn_call_activity_variables,
 * connect_bpmn_elements (association), set_bpmn_element_properties,
 * duplicate_bpmn_element, batch_bpmn_operations, bpmn_history,
 * layout_bpmn_diagram
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleAddElementChain,
  handleConnect,
  handleSetProperties,
  handleSetCallActivityVariables,
  handleBatchOperations,
  handleDuplicateElement,
  handleUndoChange,
  handleLayoutDiagram,
  handleExportBpmn,
  handleListElements,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, parseResult } from './helpers';

describe('Story 5: Integration Workflow — Call Activities, Data Objects, Annotations', () => {
  const s = {
    diagramId: '',
    startId: '',
    verifyIdentityId: '',
    forkGwId: '',
    creditCheckId: '',
    backgroundCheckId: '',
    joinGwId: '',
    finalReviewId: '',
    endId: '',
    appDataId: '',
    dbRefId: '',
    waitForCheckId: '',
    notifyManagerId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S5-Step01: Create base process', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'Customer Onboarding' }));
    s.diagramId = createRes.diagramId as string;

    // Build main flow: Start → VerifyIdentity → Fork → [CreditCheck, BackgroundCheck] → Join → FinalReview → End
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId: s.diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Application Received' },
          { elementType: 'bpmn:UserTask', name: 'Verify Identity' },
          { elementType: 'bpmn:ParallelGateway', name: 'Fork' },
        ],
      })
    );
    [s.startId, s.verifyIdentityId, s.forkGwId] = chainRes.elementIds as string[];

    // Parallel branch 1: Credit Check
    const creditRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Credit Check',
        afterElementId: s.forkGwId,
        autoConnect: false,
      })
    );
    s.creditCheckId = creditRes.elementId as string;
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.forkGwId,
      targetElementId: s.creditCheckId,
    });

    // Parallel branch 2: Background Check (CallActivity)
    const bgRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:CallActivity',
        name: 'Background Check',
        afterElementId: s.forkGwId,
        autoConnect: false,
      })
    );
    s.backgroundCheckId = bgRes.elementId as string;
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.forkGwId,
      targetElementId: s.backgroundCheckId,
    });

    // Join gateway
    const joinRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ParallelGateway',
        name: 'Join',
        afterElementId: s.creditCheckId,
        autoConnect: false,
      })
    );
    s.joinGwId = joinRes.elementId as string;
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.creditCheckId,
      targetElementId: s.joinGwId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.backgroundCheckId,
      targetElementId: s.joinGwId,
    });

    // Final review and end
    const finalRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Final Review',
        afterElementId: s.joinGwId,
      })
    );
    s.finalReviewId = finalRes.elementId as string;

    const endRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Onboarding Complete',
        afterElementId: s.finalReviewId,
      })
    );
    s.endId = endRes.elementId as string;

    await assertStep(s.diagramId, 'S5-Step01', {
      containsElements: [
        'Application Received',
        'Verify Identity',
        'Fork',
        'Credit Check',
        'Background Check',
        'Join',
        'Final Review',
        'Onboarding Complete',
      ],
      snapshotFile: 'story-05/step-01.bpmn',
    });
  });

  test('S5-Step02: Configure call activity', async () => {
    await handleSetProperties({
      diagramId: s.diagramId,
      elementId: s.backgroundCheckId,
      properties: {
        'camunda:calledElement': 'background-check-process',
        'camunda:calledElementBinding': 'latest',
      },
    });

    await handleSetCallActivityVariables({
      diagramId: s.diagramId,
      elementId: s.backgroundCheckId,
      inMappings: [{ source: 'applicantId', target: 'subjectId' }],
      outMappings: [{ source: 'checkResult', target: 'backgroundResult' }],
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('background-check-process');
    expect(xml).toContain('applicantId');
    expect(xml).toContain('backgroundResult');

    await assertStep(s.diagramId, 'S5-Step02', {
      snapshotFile: 'story-05/step-02.bpmn',
    });
  });

  test('S5-Step03: Add data objects and associations', async () => {
    // Data Object Reference
    const appDataRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:DataObjectReference',
        name: 'Application Data',
      })
    );
    s.appDataId = appDataRes.elementId as string;

    // Data Store Reference
    const dbRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:DataStoreReference',
        name: 'Customer Database',
      })
    );
    s.dbRefId = dbRes.elementId as string;

    // Connect Verify Identity → Application Data (data association)
    const da1Res = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.verifyIdentityId,
        targetElementId: s.appDataId,
      })
    );
    expect(da1Res.connectionId).toBeDefined();

    // Connect Customer Database → Final Review (data association)
    const da2Res = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.dbRefId,
        targetElementId: s.finalReviewId,
      })
    );
    expect(da2Res.connectionId).toBeDefined();

    await assertStep(s.diagramId, 'S5-Step03', {
      containsElements: ['Application Data', 'Customer Database'],
      snapshotFile: 'story-05/step-03.bpmn',
    });
  });

  test('S5-Step04: Add text annotation and group', async () => {
    // Text annotation
    const annotRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:TextAnnotation',
        name: 'SLA: 24h for identity verification',
      })
    );
    const annotId = annotRes.elementId as string;

    // Connect annotation to Verify Identity (association)
    const assocRes = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.verifyIdentityId,
        targetElementId: annotId,
      })
    );
    expect(assocRes.connectionId).toBeDefined();

    // Group element
    const groupRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:Group',
        name: 'Automated Checks',
      })
    );
    expect(groupRes.elementId).toBeDefined();

    await assertStep(s.diagramId, 'S5-Step04', {
      // TextAnnotation and Group don't expose names via businessObject.name
      // so we only verify the elements were created (annotId/groupRes checked above)
      snapshotFile: 'story-05/step-04.bpmn',
    });
  });

  test('S5-Step05: Add intermediate events', async () => {
    // Find flow between Credit Check and Join gateway
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const creditToJoinFlow = (listRes.elements as any[]).find(
      (e: any) =>
        e.type === 'bpmn:SequenceFlow' &&
        (e.sourceId ?? e.source?.id) === s.creditCheckId &&
        (e.targetId ?? e.target?.id) === s.joinGwId
    );
    expect(creditToJoinFlow).toBeDefined();

    // Insert IntermediateCatchEvent into that flow
    const waitRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateCatchEvent',
        name: 'Wait for External Check',
        flowId: creditToJoinFlow.id,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT2H' },
      })
    );
    s.waitForCheckId = waitRes.elementId as string;

    // Find flow between Join gateway and Final Review
    const listRes2 = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const joinToFinalFlow = (listRes2.elements as any[]).find(
      (e: any) =>
        e.type === 'bpmn:SequenceFlow' &&
        (e.sourceId ?? e.source?.id) === s.joinGwId &&
        (e.targetId ?? e.target?.id) === s.finalReviewId
    );
    expect(joinToFinalFlow).toBeDefined();

    // Insert IntermediateThrowEvent (Signal) into that flow
    const notifyRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:IntermediateThrowEvent',
        name: 'Notify Manager',
        flowId: joinToFinalFlow.id,
        eventDefinitionType: 'bpmn:SignalEventDefinition',
        signalRef: { id: 'Signal_ManagerNotification', name: 'ManagerNotification' },
      })
    );
    s.notifyManagerId = notifyRes.elementId as string;

    await assertStep(s.diagramId, 'S5-Step05', {
      containsElements: ['Wait for External Check', 'Notify Manager'],
      snapshotFile: 'story-05/step-05.bpmn',
    });
  });

  test('S5-Step06: Use batch operations to set properties', async () => {
    const batchRes = parseResult(
      await handleBatchOperations({
        diagramId: s.diagramId,
        operations: [
          {
            tool: 'set_bpmn_element_properties',
            args: {
              diagramId: s.diagramId,
              elementId: s.verifyIdentityId,
              properties: { 'camunda:assignee': 'id-verifier' },
            },
          },
          {
            tool: 'set_bpmn_element_properties',
            args: {
              diagramId: s.diagramId,
              elementId: s.finalReviewId,
              properties: { 'camunda:candidateGroups': 'senior-reviewers' },
            },
          },
          {
            tool: 'set_bpmn_element_properties',
            args: {
              diagramId: s.diagramId,
              elementId: s.creditCheckId,
              properties: {
                'camunda:type': 'external',
                'camunda:topic': 'credit-check',
              },
            },
          },
        ],
      })
    );
    expect(batchRes.success).toBe(true);
    expect(batchRes.succeeded).toBe(3);

    await assertStep(s.diagramId, 'S5-Step06', {
      snapshotFile: 'story-05/step-06.bpmn',
    });
  });

  test('S5-Step07: Duplicate element and undo', async () => {
    // Duplicate Credit Check
    const dupRes = parseResult(
      await handleDuplicateElement({
        diagramId: s.diagramId,
        elementId: s.creditCheckId,
      })
    );
    expect(dupRes.success).toBe(true);
    const dupId = dupRes.newElementId as string;
    expect(dupId).toBeDefined();

    // Undo the duplication
    const undoRes = parseResult(
      await handleUndoChange({
        diagramId: s.diagramId,
        steps: 1,
      })
    );
    expect(undoRes.success).toBe(true);

    // Verify the copy was removed (original still exists)
    await assertStep(s.diagramId, 'S5-Step07', {
      containsElements: ['Credit Check'],
      snapshotFile: 'story-05/step-07.bpmn',
    });
  });

  test('S5-Step08: Layout and export', async () => {
    await handleLayoutDiagram({ diagramId: s.diagramId });

    await assertStep(s.diagramId, 'S5-Step08', {
      snapshotFile: 'story-05/step-08.bpmn',
    });
  });
});
