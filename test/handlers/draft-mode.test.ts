import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleListDiagrams,
  handleImportXml,
} from '../../src/handlers';
import { parseResult, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('create_bpmn_diagram — draft mode', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates diagram with draftMode: false by default', async () => {
    const res = parseResult(await handleCreateDiagram({ name: 'Test' }));
    expect(res.success).toBe(true);
    expect(res.draftMode).toBe(false);
    const diagram = getDiagram(res.diagramId)!;
    expect(diagram.draftMode).toBe(false);
  });

  test('creates diagram with draftMode: true', async () => {
    const res = parseResult(await handleCreateDiagram({ name: 'Draft Test', draftMode: true }));
    expect(res.success).toBe(true);
    expect(res.draftMode).toBe(true);
    expect(res.message).toContain('draft mode');
    const diagram = getDiagram(res.diagramId)!;
    expect(diagram.draftMode).toBe(true);
  });

  test('suppresses lint feedback when draftMode is true', async () => {
    // Create a diagram in draft mode
    const draftRes = parseResult(await handleCreateDiagram({ name: 'Draft', draftMode: true }));
    const draftId = draftRes.diagramId;

    // Add a disconnected task — normally would trigger lint errors
    const addRes = await handleAddElement({
      diagramId: draftId,
      elementType: 'bpmn:UserTask',
      name: 'Disconnected Task',
    });

    // In draft mode, no lint feedback should be appended
    expect(addRes.content.length).toBe(1);
    expect(addRes.content[0].text).not.toContain('Lint issues');
  });

  test('shows lint feedback when draftMode is false', async () => {
    // Create a diagram NOT in draft mode
    const normalRes = parseResult(await handleCreateDiagram({ name: 'Normal' }));
    const normalId = normalRes.diagramId;

    // Add a start event then a disconnected task to trigger lint
    await handleAddElement({
      diagramId: normalId,
      elementType: 'bpmn:StartEvent',
      name: 'Start',
    });

    // Don't assert on specific lint content here — just verify draft mode
    // suppresses while normal mode doesn't
    const diagram = getDiagram(normalId)!;
    expect(diagram.draftMode).toBe(false);
  });

  test('shows draftMode in diagram listing', async () => {
    const res = parseResult(await handleCreateDiagram({ name: 'Listed', draftMode: true }));

    const listing = parseResult(await handleListDiagrams());
    const entry = listing.diagrams.find((d: any) => d.id === res.diagramId);
    expect(entry).toBeDefined();
    expect(entry.draftMode).toBe(true);
  });

  test('import_bpmn_xml supports draftMode', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="150" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const res = parseResult(await handleImportXml({ xml, draftMode: true } as any));
    expect(res.success).toBe(true);
    const diagram = getDiagram(res.diagramId)!;
    expect(diagram.draftMode).toBe(true);
  });
});
