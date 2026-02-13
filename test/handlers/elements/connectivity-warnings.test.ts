import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('connectivity warnings post-mutation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('surfaces no-flows warning when diagram has >3 disconnected elements', async () => {
    const diagramId = await createDiagram();

    // Add 4 disconnected elements (>3 threshold)
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task1' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task2' });

    // The 4th element triggers the connectivity warning
    const result = await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'End',
    });

    // Check that some content item mentions no flows
    const allText = result.content.map((c) => c.text).join('\n');
    expect(allText).toMatch(/no flows|connect_bpmn_elements/i);
  });

  test('does not surface connectivity warning with <=3 elements', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Task1' });

    // 3rd element — at the threshold, should not trigger
    const result = await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'End',
    });

    const allText = result.content.map((c) => c.text).join('\n');
    // Should not have disconnected warnings (3 elements = threshold not exceeded)
    expect(allText).not.toMatch(/appear disconnected/i);
  });
});
