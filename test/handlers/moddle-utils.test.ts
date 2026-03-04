/**
 * Unit tests for handlers/moddle-utils.ts
 *
 * Tests upsertExtensionElement, createBusinessObject, fixConnectionId,
 * and the resolveOrCreate* family of functions.
 *
 * Uses a real bpmn-js modeler fixture to exercise moddle correctly.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  upsertExtensionElement,
  createBusinessObject,
  fixConnectionId,
  resolveOrCreateError,
  resolveOrCreateMessage,
  resolveOrCreateSignal,
  resolveOrCreateEscalation,
} from '../../src/handlers/moddle-utils';
import { createDiagram, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import { getService } from '../../src/bpmn-types';

// ── Fixtures ───────────────────────────────────────────────────────────────

let diagramId: string;
let modeler: any;
let moddle: any;
let definitions: any;

beforeEach(async () => {
  diagramId = await createDiagram('moddle-utils-test');
  const diagram = getDiagram(diagramId)!;
  modeler = diagram.modeler;
  moddle = getService(modeler, 'moddle');
  // Get definitions via canvas root
  const canvas = getService(modeler, 'canvas');
  definitions = canvas.getRootElement()?.businessObject?.$parent;
});

afterEach(() => {
  clearDiagrams();
});

// ── createBusinessObject ───────────────────────────────────────────────────

describe('createBusinessObject', () => {
  test('creates a business object with the specified id', () => {
    const bo = createBusinessObject(modeler, 'bpmn:Task', 'Task_MyCustomId');
    expect(bo.$type).toBe('bpmn:Task');
    expect(bo.id).toBe('Task_MyCustomId');
  });

  test('creates a StartEvent business object', () => {
    const bo = createBusinessObject(modeler, 'bpmn:StartEvent', 'StartEvent_Begin');
    expect(bo.$type).toBe('bpmn:StartEvent');
    expect(bo.id).toBe('StartEvent_Begin');
  });

  test('creates distinct objects for distinct calls', () => {
    const bo1 = createBusinessObject(modeler, 'bpmn:Task', 'Task_A');
    const bo2 = createBusinessObject(modeler, 'bpmn:Task', 'Task_B');
    expect(bo1).not.toBe(bo2);
    expect(bo1.id).not.toBe(bo2.id);
  });
});

// ── fixConnectionId ────────────────────────────────────────────────────────

describe('fixConnectionId', () => {
  test('sets the business object id to the desired id', () => {
    const bo = { id: 'Flow_auto123' };
    const connection = { businessObject: bo };
    fixConnectionId(connection, 'Flow_MyLabel');
    expect(bo.id).toBe('Flow_MyLabel');
  });

  test('does nothing when the id already matches', () => {
    const bo = { id: 'Flow_Done' };
    const connection = { businessObject: bo };
    fixConnectionId(connection, 'Flow_Done');
    expect(bo.id).toBe('Flow_Done');
  });

  test('does nothing when businessObject is missing', () => {
    // Should not throw
    const connection = {} as any;
    expect(() => fixConnectionId(connection, 'Flow_X')).not.toThrow();
  });
});

// ── upsertExtensionElement ─────────────────────────────────────────────────

describe('upsertExtensionElement', () => {
  test('adds an extension element to a bo without extensionElements', async () => {
    const { handleAddElement } = await import('../../src/handlers');
    const result = JSON.parse(
      (
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:UserTask',
          name: 'Test Task',
        })
      ).content[0].text
    );
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = getService(diagram.modeler, 'elementRegistry');
    const element = elementRegistry.get(result.elementId);
    const modeling = getService(diagram.modeler, 'modeling');

    const formData = moddle.create('camunda:FormData', { fields: [] });
    upsertExtensionElement(
      moddle,
      element.businessObject,
      modeling,
      element,
      'camunda:FormData',
      formData
    );

    const exts = element.businessObject.extensionElements?.values ?? [];
    expect(exts.some((v: any) => v.$type === 'camunda:FormData')).toBe(true);
  });

  test('replaces an existing extension element of the same type', async () => {
    const { handleAddElement } = await import('../../src/handlers');
    const result = JSON.parse(
      (
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:UserTask',
          name: 'Test Task 2',
        })
      ).content[0].text
    );
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = getService(diagram.modeler, 'elementRegistry');
    const element = elementRegistry.get(result.elementId);
    const modeling = getService(diagram.modeler, 'modeling');

    // Add first FormData
    const fd1 = moddle.create('camunda:FormData', { fields: [] });
    upsertExtensionElement(
      moddle,
      element.businessObject,
      modeling,
      element,
      'camunda:FormData',
      fd1
    );
    // Add second FormData — should replace the first
    const fd2 = moddle.create('camunda:FormData', { fields: [] });
    upsertExtensionElement(
      moddle,
      element.businessObject,
      modeling,
      element,
      'camunda:FormData',
      fd2
    );

    const exts = element.businessObject.extensionElements?.values ?? [];
    const formDataEntries = exts.filter((v: any) => v.$type === 'camunda:FormData');
    expect(formDataEntries).toHaveLength(1);
    expect(formDataEntries[0]).toBe(fd2);
  });

  test('sets the $parent on the new extension element', async () => {
    const { handleAddElement } = await import('../../src/handlers');
    const result = JSON.parse(
      (
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:ServiceTask',
          name: 'My Service',
        })
      ).content[0].text
    );
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = getService(diagram.modeler, 'elementRegistry');
    const element = elementRegistry.get(result.elementId);
    const modeling = getService(diagram.modeler, 'modeling');

    const inputOutput = moddle.create('camunda:InputOutput', { inputParameters: [] });
    upsertExtensionElement(
      moddle,
      element.businessObject,
      modeling,
      element,
      'camunda:InputOutput',
      inputOutput
    );

    expect(inputOutput.$parent).toBeDefined();
    expect(inputOutput.$parent.$type).toBe('bpmn:ExtensionElements');
  });
});

// ── resolveOrCreateError ───────────────────────────────────────────────────

describe('resolveOrCreateError', () => {
  test('creates a new bpmn:Error when not found', () => {
    const err = resolveOrCreateError(moddle, definitions, {
      id: 'Error_NotFound',
      name: 'Not Found Error',
      errorCode: '404',
    });
    expect(err.$type).toBe('bpmn:Error');
    expect(err.id).toBe('Error_NotFound');
    expect(err.errorCode).toBe('404');
  });

  test('returns the same element on a second call with the same id', () => {
    const err1 = resolveOrCreateError(moddle, definitions, { id: 'Error_Dup' });
    const err2 = resolveOrCreateError(moddle, definitions, { id: 'Error_Dup' });
    expect(err1).toBe(err2);
  });

  test('adds the error to definitions.rootElements', () => {
    resolveOrCreateError(moddle, definitions, { id: 'Error_Root' });
    const found = definitions.rootElements.find(
      (re: any) => re.$type === 'bpmn:Error' && re.id === 'Error_Root'
    );
    expect(found).toBeDefined();
  });

  test('defaults name to the id when name is not provided', () => {
    const err = resolveOrCreateError(moddle, definitions, { id: 'Error_NoName' });
    expect(err.name).toBe('Error_NoName');
  });
});

// ── resolveOrCreateMessage ─────────────────────────────────────────────────

describe('resolveOrCreateMessage', () => {
  test('creates a new bpmn:Message', () => {
    const msg = resolveOrCreateMessage(moddle, definitions, {
      id: 'Msg_Order',
      name: 'OrderMessage',
    });
    expect(msg.$type).toBe('bpmn:Message');
    expect(msg.name).toBe('OrderMessage');
  });

  test('returns existing message on second call', () => {
    const msg1 = resolveOrCreateMessage(moddle, definitions, { id: 'Msg_Shared' });
    const msg2 = resolveOrCreateMessage(moddle, definitions, { id: 'Msg_Shared' });
    expect(msg1).toBe(msg2);
  });
});

// ── resolveOrCreateSignal ──────────────────────────────────────────────────

describe('resolveOrCreateSignal', () => {
  test('creates a new bpmn:Signal', () => {
    const sig = resolveOrCreateSignal(moddle, definitions, {
      id: 'Sig_Alert',
      name: 'AlertSignal',
    });
    expect(sig.$type).toBe('bpmn:Signal');
    expect(sig.name).toBe('AlertSignal');
  });

  test('returns existing signal on second call', () => {
    const sig1 = resolveOrCreateSignal(moddle, definitions, { id: 'Sig_X' });
    const sig2 = resolveOrCreateSignal(moddle, definitions, { id: 'Sig_X' });
    expect(sig1).toBe(sig2);
  });
});

// ── resolveOrCreateEscalation ──────────────────────────────────────────────

describe('resolveOrCreateEscalation', () => {
  test('creates a new bpmn:Escalation', () => {
    const esc = resolveOrCreateEscalation(moddle, definitions, {
      id: 'Esc_L2',
      name: 'Level2Escalation',
      escalationCode: 'L2',
    });
    expect(esc.$type).toBe('bpmn:Escalation');
    expect(esc.escalationCode).toBe('L2');
  });

  test('returns existing escalation on second call', () => {
    const esc1 = resolveOrCreateEscalation(moddle, definitions, { id: 'Esc_Y' });
    const esc2 = resolveOrCreateEscalation(moddle, definitions, { id: 'Esc_Y' });
    expect(esc1).toBe(esc2);
  });
});
