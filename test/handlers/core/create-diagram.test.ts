import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateDiagram,
  handleExportBpmn,
  handleListElements,
  handleValidate as handleLintDiagram,
  dispatchToolCall,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('create_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns success with a diagramId', async () => {
    const res = parseResult(await handleCreateDiagram({}));
    expect(res.success).toBe(true);
    expect(res.diagramId).toMatch(/^diagram_/);
  });

  test('sets process name when provided', async () => {
    const diagramId = await createDiagram('My Process');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('My Process');
  });

  test('sets a meaningful process id based on the name', async () => {
    const diagramId = await createDiagram('Order Fulfillment');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('id="Process_Order_Fulfillment"');
    expect(xml).toContain('Order Fulfillment');
  });

  test('process id strips dashes and special characters', async () => {
    const diagramId = await createDiagram('Executable Process - Camunda 7 (no pool)');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    // Should not contain dashes or parentheses in the id attribute
    const idMatch = xml.match(/id="(Process_[^"]+)"/);
    expect(idMatch).not.toBeNull();
    const processId = idMatch![1];
    expect(processId).not.toMatch(/[-()]/);
    // Should only contain alphanumeric and underscores
    expect(processId).toMatch(/^Process_[a-zA-Z0-9_]+$/);
  });

  test('does not change process id when no name is provided', async () => {
    const diagramId = await createDiagram();
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('id="Process_1"');
  });

  test('sets camunda:historyTimeToLive on the process', async () => {
    const diagramId = await createDiagram('HTL Test');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:historyTimeToLive="P180D"');
  });

  test('historyTimeToLive is present even without a name', async () => {
    const diagramId = await createDiagram();
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:historyTimeToLive="P180D"');
  });

  test('lint does not warn about missing historyTimeToLive on new diagram', async () => {
    const diagramId = await createDiagram('Lint HTL Test');
    const lintRes = parseResult(await handleLintDiagram({ diagramId }));
    const htlIssues = (lintRes.issues || []).filter(
      (i: any) => i.rule && i.rule.includes('history-time-to-live')
    );
    expect(htlIssues).toEqual([]);
  });

  test('workflowContext single-organization recommends create_bpmn_participant with lanes', async () => {
    // Regression for TODO #9: single-org context should suggest lanes in one call
    const res = parseResult(
      await handleCreateDiagram({ workflowContext: 'single-organization', name: 'Order Process' })
    );
    expect(res.workflowContext).toBe('single-organization');
    expect(res.structureGuidance).toContain('lanes');
    // The step should recommend create_bpmn_participant (not create_bpmn_lanes as a follow-up)
    const participantStep = (res.nextSteps ?? []).find(
      (s: any) => s.tool === 'create_bpmn_participant'
    );
    expect(participantStep).toBeDefined();
    expect(participantStep.description).toContain('lanes');
    // Should discourage multiple expanded pools
    const guidance: string = res.structureGuidance ?? '';
    expect(guidance.toLowerCase()).toMatch(/one pool|single pool|one executable/);
  });

  // ── cloneFrom (merged from clone_bpmn_diagram) ────────────────────────────

  test('cloneFrom creates a copy with a new ID', async () => {
    const diagramId = await createDiagram('Original');
    await addElement(diagramId, 'bpmn:Task', { name: 'My Task' });

    const res = parseResult(await handleCreateDiagram({ cloneFrom: diagramId }));
    expect(res.success).toBe(true);
    expect(res.diagramId).not.toBe(diagramId);
    expect(res.clonedFrom).toBe(diagramId);

    // Cloned diagram should have the same elements
    const origList = parseResult(await handleListElements({ diagramId }));
    const cloneList = parseResult(await handleListElements({ diagramId: res.diagramId }));
    expect(cloneList.count).toBe(origList.count);
  });

  test('cloneFrom allows overriding the name', async () => {
    const diagramId = await createDiagram('Original');
    const res = parseResult(await handleCreateDiagram({ cloneFrom: diagramId, name: 'Clone' }));
    expect(res.name).toBe('Clone');
  });

  // ── xml/filePath import (folded from import_bpmn_xml, ADR-030) ───────────

  test('xml creates a diagram from inline BPMN XML', async () => {
    const source = await createDiagram('Source');
    await addElement(source, 'bpmn:Task', { name: 'Do it' });
    const sourceXml = (await handleExportBpmn({ format: 'xml', diagramId: source, skipLint: true }))
      .content[0].text as string;

    const res = parseResult(await handleCreateDiagram({ xml: sourceXml }));
    expect(res.success).toBe(true);
    expect(res.diagramId).toBeDefined();

    const list = parseResult(await handleListElements({ diagramId: res.diagramId }));
    expect(list.count).toBeGreaterThan(0);
  });

  test('filePath and xml are mutually exclusive with cloneFrom (cloneFrom wins)', async () => {
    const source = await createDiagram('Source');
    const res = parseResult(await handleCreateDiagram({ cloneFrom: source, xml: '<bogus/>' }));
    expect(res.success).toBe(true);
    expect(res.clonedFrom).toBe(source);
  });

  test('import_bpmn_xml is no longer a registered tool', async () => {
    await expect(dispatchToolCall('import_bpmn_xml', { xml: '<bogus/>' })).rejects.toThrow(
      /Unknown tool/
    );
  });

  test('create_bpmn_diagram is dispatchable with xml via dispatchToolCall', async () => {
    const source = await createDiagram('Source');
    const sourceXml = (await handleExportBpmn({ format: 'xml', diagramId: source, skipLint: true }))
      .content[0].text as string;
    const res = parseResult(await dispatchToolCall('create_bpmn_diagram', { xml: sourceXml }));
    expect(res.success).toBe(true);
    expect(res.diagramId).toBeDefined();
  });
});
