/**
 * Unit tests for handlers/id-generation.ts
 *
 * Tests generateDescriptiveId and generateFlowId without needing a
 * real bpmn-js modeler — a simple object with a get() method suffices
 * as the elementRegistry mock.
 */
import { describe, test, expect } from 'vitest';
import { generateDescriptiveId, generateFlowId } from '../../src/handlers/id-generation';

/** Minimal elementRegistry mock — starts empty; can add "occupied" IDs. */
function makeRegistry(existing: string[] = []): any {
  const occupied = new Set(existing);
  return {
    get: (id: string) => (occupied.has(id) ? {} : undefined),
    add: (id: string) => occupied.add(id),
  };
}

// ── generateDescriptiveId ──────────────────────────────────────────────────

describe('generateDescriptiveId', () => {
  test('produces a 2-part ID for a named element', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:UserTask', 'Enter Name');
    expect(id).toBe('UserTask_EnterName');
  });

  test('PascalCases multi-word names', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:ServiceTask', 'send invoice to customer');
    expect(id).toBe('ServiceTask_SendInvoiceToCustomer');
  });

  test('uses prefix UserTask for bpmn:UserTask', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:UserTask', 'Approve');
    expect(id).toMatch(/^UserTask_/);
  });

  test('uses prefix ServiceTask for bpmn:ServiceTask', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:ServiceTask', 'Call API');
    expect(id).toMatch(/^ServiceTask_/);
  });

  test('uses prefix Gateway for all gateway types', () => {
    const registry = makeRegistry();
    expect(generateDescriptiveId(registry, 'bpmn:ExclusiveGateway', 'Check')).toMatch(/^Gateway_/);
    expect(generateDescriptiveId(registry, 'bpmn:ParallelGateway', 'Fork')).toMatch(/^Gateway_/);
    expect(generateDescriptiveId(registry, 'bpmn:InclusiveGateway', 'Merge')).toMatch(/^Gateway_/);
  });

  test('uses prefix StartEvent / EndEvent for start/end events', () => {
    const registry = makeRegistry();
    expect(generateDescriptiveId(registry, 'bpmn:StartEvent', 'Begin')).toMatch(/^StartEvent_/);
    expect(generateDescriptiveId(registry, 'bpmn:EndEvent', 'Done')).toMatch(/^EndEvent_/);
  });

  test('falls back to 3-part ID on collision', () => {
    const registry = makeRegistry(['UserTask_Approve']);
    const id = generateDescriptiveId(registry, 'bpmn:UserTask', 'Approve');
    // Should be 3-part: UserTask_<random>_Approve
    expect(id).toMatch(/^UserTask_[a-z0-9]{7}_Approve$/);
  });

  test('generates a random 2-part ID for unnamed elements', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:StartEvent');
    // Should be StartEvent_<7-char-random>
    expect(id).toMatch(/^StartEvent_[a-z0-9]{7}$/);
  });

  test('is unique across consecutive calls for unnamed elements', () => {
    const registry = makeRegistry();
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(generateDescriptiveId(registry, 'bpmn:Task'));
    }
    // With 36^7 possibilities, collisions should be extremely rare
    expect(ids.size).toBeGreaterThan(1);
  });

  test('strips non-alphanumeric chars from names', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:Task', 'Check #1 & Do!');
    // Non-alphanum chars are stripped; remaining words are PascalCased
    expect(id).toMatch(/^Task_[A-Za-z0-9]+$/);
  });

  test('merges single-letter words from hyphenated names (e.g. E-mail)', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:Task', 'Send E-mail');
    // "E" and "mail" should merge to "Email"
    expect(id).toBe('Task_SendEmail');
  });

  test('handles empty name like no name (falls back to random)', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:Task', '');
    expect(id).toMatch(/^Task_[a-z0-9]{7}$/);
  });

  test('uses Annotation prefix for bpmn:TextAnnotation', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:TextAnnotation', 'Note');
    expect(id).toMatch(/^Annotation_/);
  });

  test('uses SubProcess prefix for bpmn:SubProcess', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:SubProcess', 'Order Processing');
    expect(id).toBe('SubProcess_OrderProcessing');
  });

  test('uses CallActivity prefix for bpmn:CallActivity', () => {
    const registry = makeRegistry();
    const id = generateDescriptiveId(registry, 'bpmn:CallActivity', 'Run Sub');
    expect(id).toBe('CallActivity_RunSub');
  });
});

// ── generateFlowId ─────────────────────────────────────────────────────────

describe('generateFlowId', () => {
  test('produces a 2-part ID from a label', () => {
    const registry = makeRegistry();
    const id = generateFlowId(registry, undefined, undefined, 'Approved');
    expect(id).toBe('Flow_Approved');
  });

  test('produces a compound ID from source+target names', () => {
    const registry = makeRegistry();
    const id = generateFlowId(registry, 'Start', 'Review', undefined);
    expect(id).toBe('Flow_Start_to_Review');
  });

  test('prefers label over source+target names', () => {
    const registry = makeRegistry();
    const id = generateFlowId(registry, 'Start', 'End', 'Happy path');
    expect(id).toBe('Flow_HappyPath');
  });

  test('generates random 2-part ID when no names or label provided', () => {
    const registry = makeRegistry();
    const id = generateFlowId(registry, undefined, undefined, undefined);
    expect(id).toMatch(/^Flow_[a-z0-9]{7}$/);
  });

  test('falls back to 3-part ID on label collision', () => {
    const registry = makeRegistry(['Flow_Approved']);
    const id = generateFlowId(registry, undefined, undefined, 'Approved');
    expect(id).toMatch(/^Flow_[a-z0-9]{7}_Approved$/);
  });

  test('falls back to 3-part ID on source+target collision', () => {
    const registry = makeRegistry(['Flow_Start_to_Review']);
    const id = generateFlowId(registry, 'Start', 'Review', undefined);
    expect(id).toMatch(/^Flow_[a-z0-9]{7}_Start_to_Review$/);
  });

  test('always starts with Flow_', () => {
    const registry = makeRegistry();
    expect(generateFlowId(registry, 'A', 'B')).toMatch(/^Flow_/);
    expect(generateFlowId(registry)).toMatch(/^Flow_/);
    expect(generateFlowId(registry, undefined, undefined, 'done')).toMatch(/^Flow_/);
  });
});
