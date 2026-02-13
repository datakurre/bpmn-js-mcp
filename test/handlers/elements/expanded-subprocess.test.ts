import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement, handleSetProperties } from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams, addElement, exportXml } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('add_bpmn_element — expanded subprocess', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('add_bpmn_element with isExpanded', () => {
    test('creates expanded subprocess by default (no separate plane)', async () => {
      const diagramId = await createDiagram();

      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:SubProcess',
          name: 'My Subprocess',
        })
      );
      expect(res.success).toBe(true);

      // The exported XML should have isExpanded="true" on the BPMNShape
      const xml = await exportXml(diagramId);
      expect(xml).toContain('isExpanded="true"');

      // Should NOT have a separate BPMNDiagram for the subprocess
      const diagramCount = (xml.match(/bpmndi:BPMNDiagram/g) || []).length;
      // Opening + closing tags = 2 per diagram. Main diagram only = 2.
      expect(diagramCount).toBe(2); // one BPMNDiagram with opening and closing tag
    });

    test('creates expanded subprocess with isExpanded=true', async () => {
      const diagramId = await createDiagram();

      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:SubProcess',
          name: 'Expanded',
          isExpanded: true,
        } as any)
      );
      expect(res.success).toBe(true);

      const xml = await exportXml(diagramId);
      expect(xml).toContain('isExpanded="true"');

      // Expanded subprocess: shape should be large (350x200)
      const diagram = getDiagram(diagramId)!;
      const registry = diagram.modeler.get('elementRegistry') as any;
      const el = registry.get(res.elementId);
      expect(el.width).toBe(350);
      expect(el.height).toBe(200);
    });

    test('creates collapsed subprocess with isExpanded=false (separate plane)', async () => {
      const diagramId = await createDiagram();

      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:SubProcess',
          name: 'Collapsed',
          isExpanded: false,
        } as any)
      );
      expect(res.success).toBe(true);

      const xml = await exportXml(diagramId);

      // Should have a separate BPMNDiagram for the collapsed subprocess plane
      const diagramCount = (xml.match(/<bpmndi:BPMNDiagram /g) || []).length;
      expect(diagramCount).toBe(2); // main + subprocess plane

      // Collapsed subprocess: shape should be small (100x80)
      const diagram = getDiagram(diagramId)!;
      const registry = diagram.modeler.get('elementRegistry') as any;
      const el = registry.get(res.elementId);
      expect(el.width).toBe(100);
      expect(el.height).toBe(80);
    });

    test('expanded subprocess has no separate BPMNPlane for subprocess', async () => {
      const diagramId = await createDiagram();

      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:SubProcess',
          name: 'Inline Sub',
        })
      );

      const xml = await exportXml(diagramId);

      // Only one BPMNDiagram element (the main one)
      const diagramCount = (xml.match(/<bpmndi:BPMNDiagram /g) || []).length;
      expect(diagramCount).toBe(1);

      // The subprocess should NOT have a separate BPMNPlane pointing to it
      expect(xml).not.toContain(`bpmnElement="${res.elementId}" />`);
    });
  });

  describe('set_bpmn_element_properties with isExpanded', () => {
    test('toggles expanded subprocess to collapsed via set_properties', async () => {
      const diagramId = await createDiagram();

      // Create expanded subprocess
      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:SubProcess',
          name: 'Toggle Me',
        })
      );
      const subId = res.elementId;

      // Verify it starts expanded
      let xml = await exportXml(diagramId);
      expect(xml).toContain('isExpanded="true"');
      let diagCount = (xml.match(/<bpmndi:BPMNDiagram /g) || []).length;
      expect(diagCount).toBe(1);

      // Toggle to collapsed
      const setRes = parseResult(
        await handleSetProperties({
          diagramId,
          elementId: subId,
          properties: { isExpanded: false },
        })
      );
      expect(setRes.success).toBe(true);

      // Now should have separate plane and collapsed shape
      xml = await exportXml(diagramId);
      diagCount = (xml.match(/<bpmndi:BPMNDiagram /g) || []).length;
      expect(diagCount).toBe(2); // main + collapsed subprocess plane
    });

    test('setting isExpanded on non-SubProcess is ignored gracefully', async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

      // Should not throw, just set it normally
      const res = parseResult(
        await handleSetProperties({
          diagramId,
          elementId: taskId,
          properties: { isExpanded: true, name: 'Updated' },
        })
      );
      expect(res.success).toBe(true);
    });
  });
});
