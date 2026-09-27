/**
 * Tests for root-element-helpers: resolveOrCreateError, resolveOrCreateMessage,
 * resolveOrCreateSignal, resolveOrCreateEscalation.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resolveOrCreateError,
  resolveOrCreateMessage,
  resolveOrCreateSignal,
  resolveOrCreateEscalation,
} from '../../../src/handlers/moddle-utils';
import { createDiagram, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

function getRootElementContext(diagramId: string) {
  const diagram = getDiagram(diagramId)!;
  const moddle = diagram.modeler.get('moddle');
  const modeling = diagram.modeler.get('modeling');
  const canvas = diagram.modeler.get('canvas');
  const rootElement = canvas.getRootElement();
  const definitions = rootElement.businessObject.$parent;
  return { moddle, modeling, rootElement, definitions };
}

describe('root-element-helpers', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('resolveOrCreateError', () => {
    test('creates a new bpmn:Error element', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const error = resolveOrCreateError(moddle, modeling, rootElement, definitions, {
        id: 'Error_1',
        name: 'ValidationError',
        errorCode: 'ERR_001',
      });

      expect(error).toBeDefined();
      expect(error.id).toBe('Error_1');
      expect(error.name).toBe('ValidationError');
      expect(error.errorCode).toBe('ERR_001');
    });

    test('returns existing error if ID matches', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const error1 = resolveOrCreateError(moddle, modeling, rootElement, definitions, {
        id: 'Error_1',
        name: 'First',
      });
      const error2 = resolveOrCreateError(moddle, modeling, rootElement, definitions, {
        id: 'Error_1',
        name: 'Second',
      });

      expect(error1).toBe(error2); // Same object
      expect(error1.name).toBe('First'); // Original name preserved
    });

    test('defaults name to ID when not provided', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const error = resolveOrCreateError(moddle, modeling, rootElement, definitions, {
        id: 'Error_NoName',
      });
      expect(error.name).toBe('Error_NoName');
    });

    test('is undoable via the command stack', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);
      const commandStack = getDiagram(id)!.modeler.get('commandStack') as any;

      resolveOrCreateError(moddle, modeling, rootElement, definitions, { id: 'Error_Undo' });
      expect(definitions.rootElements.some((re: any) => re.id === 'Error_Undo')).toBe(true);

      commandStack.undo();
      expect(definitions.rootElements.some((re: any) => re.id === 'Error_Undo')).toBe(false);
    });
  });

  describe('resolveOrCreateMessage', () => {
    test('creates a new bpmn:Message element', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const message = resolveOrCreateMessage(moddle, modeling, rootElement, definitions, {
        id: 'Message_1',
        name: 'OrderReceived',
      });

      expect(message).toBeDefined();
      expect(message.id).toBe('Message_1');
      expect(message.name).toBe('OrderReceived');
    });

    test('returns existing message if ID matches', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const msg1 = resolveOrCreateMessage(moddle, modeling, rootElement, definitions, {
        id: 'Message_1',
        name: 'First',
      });
      const msg2 = resolveOrCreateMessage(moddle, modeling, rootElement, definitions, {
        id: 'Message_1',
        name: 'Different',
      });

      expect(msg1).toBe(msg2);
    });
  });

  describe('resolveOrCreateSignal', () => {
    test('creates a new bpmn:Signal element', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const signal = resolveOrCreateSignal(moddle, modeling, rootElement, definitions, {
        id: 'Signal_1',
        name: 'Alert',
      });

      expect(signal).toBeDefined();
      expect(signal.id).toBe('Signal_1');
      expect(signal.name).toBe('Alert');
    });

    test('returns existing signal if ID matches', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const sig1 = resolveOrCreateSignal(moddle, modeling, rootElement, definitions, {
        id: 'Signal_1',
        name: 'First',
      });
      const sig2 = resolveOrCreateSignal(moddle, modeling, rootElement, definitions, {
        id: 'Signal_1',
      });

      expect(sig1).toBe(sig2);
    });
  });

  describe('resolveOrCreateEscalation', () => {
    test('creates a new bpmn:Escalation element', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const esc = resolveOrCreateEscalation(moddle, modeling, rootElement, definitions, {
        id: 'Escalation_1',
        name: 'HighPriority',
        escalationCode: 'ESC_001',
      });

      expect(esc).toBeDefined();
      expect(esc.id).toBe('Escalation_1');
      expect(esc.name).toBe('HighPriority');
      expect(esc.escalationCode).toBe('ESC_001');
    });

    test('returns existing escalation if ID matches', async () => {
      const id = await createDiagram();
      const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

      const esc1 = resolveOrCreateEscalation(moddle, modeling, rootElement, definitions, {
        id: 'Escalation_1',
        name: 'First',
      });
      const esc2 = resolveOrCreateEscalation(moddle, modeling, rootElement, definitions, {
        id: 'Escalation_1',
      });

      expect(esc1).toBe(esc2);
    });
  });

  test('initializes rootElements if undefined', async () => {
    const id = await createDiagram();
    const { moddle, modeling, rootElement, definitions } = getRootElementContext(id);

    // Temporarily remove rootElements
    const saved = definitions.rootElements;
    definitions.rootElements = undefined;

    const error = resolveOrCreateError(moddle, modeling, rootElement, definitions, {
      id: 'Error_Init',
    });
    expect(error).toBeDefined();
    expect(definitions.rootElements).toBeDefined();
    expect(definitions.rootElements).toContain(error);

    // Restore
    definitions.rootElements = saved;
  });
});
