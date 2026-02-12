import { describe, test, expect, beforeEach } from 'vitest';
import { handleExportBpmn as handleExportSubprocess } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

describe('export_bpmn — subprocess scope', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('rejects non-subprocess elements', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask');

    const res = await handleExportSubprocess({ diagramId, format: 'xml', elementId: taskId });
    expect(res.content[0].text).toContain('not a SubProcess or Participant');
  });

  test('exports a subprocess as XML', async () => {
    const diagramId = await createDiagram();

    // Add a subprocess with content
    const subId = await addElement(diagramId, 'bpmn:SubProcess', { name: 'MyProcess' });

    // Add elements inside the subprocess using the modeler directly
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const modeling = diagram.modeler.get('modeling');
    const elementFactory = diagram.modeler.get('elementFactory');

    const subElement = elementRegistry.get(subId);

    // Create start event inside subprocess
    const startShape = elementFactory.createShape({ type: 'bpmn:StartEvent' });
    modeling.createShape(startShape, { x: 200, y: 200 }, subElement);

    const { xml } = await diagram.modeler.saveXML({ format: true });
    diagram.xml = xml || '';

    const res = await handleExportSubprocess({ diagramId, format: 'xml', elementId: subId });
    // Should contain XML definitions
    expect(res.content[0].text).toContain('definitions');
  });

  test('reports empty subprocess', async () => {
    const diagramId = await createDiagram();
    const subId = await addElement(diagramId, 'bpmn:SubProcess', { name: 'Empty' });

    const res = await handleExportSubprocess({ diagramId, format: 'xml', elementId: subId });
    expect(res.content[0].text).toContain('no flow elements');
  });
});
