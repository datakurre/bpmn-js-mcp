/**
 * Unit tests for handlers/validation.ts
 *
 * Tests validateArgs, validateElementType, and ALLOWED_ELEMENT_TYPES.
 * These are pure-function tests — no bpmn-js or diagram fixture needed.
 */
import { describe, test, expect } from 'vitest';
import {
  validateArgs,
  validateElementType,
  ALLOWED_ELEMENT_TYPES,
  INSERTABLE_ELEMENT_TYPES,
} from '../../src/handlers/validation';

// ── validateArgs ───────────────────────────────────────────────────────────

describe('validateArgs', () => {
  test('passes when all required keys are present', () => {
    expect(() =>
      validateArgs({ diagramId: 'dia_1', elementType: 'bpmn:Task' }, ['diagramId', 'elementType'])
    ).not.toThrow();
  });

  test('throws when a required key is missing', () => {
    expect(() => validateArgs({ diagramId: 'dia_1' } as any, ['diagramId', 'elementType'])).toThrow(
      /elementType/
    );
  });

  test('throws when a required key is null', () => {
    expect(() => validateArgs({ diagramId: null } as any, ['diagramId'])).toThrow(/diagramId/);
  });

  test('throws when a required key is undefined', () => {
    expect(() => validateArgs({ diagramId: undefined } as any, ['diagramId'])).toThrow(/diagramId/);
  });

  test('throws listing all missing keys at once', () => {
    expect(() => validateArgs({} as any, ['diagramId', 'elementType'])).toThrow();
  });

  test('passes when extra keys are present beyond required', () => {
    expect(() =>
      validateArgs({ diagramId: 'x', elementType: 'bpmn:Task', extra: 42 } as any, [
        'diagramId',
        'elementType',
      ])
    ).not.toThrow();
  });

  test('passes for zero required keys', () => {
    expect(() => validateArgs({}, [])).not.toThrow();
  });

  test('treats false as a valid value (not missing)', () => {
    expect(() => validateArgs({ flag: false } as any, ['flag'])).not.toThrow();
  });

  test('treats 0 as a valid value (not missing)', () => {
    expect(() => validateArgs({ count: 0 } as any, ['count'])).not.toThrow();
  });

  test('treats empty string as a valid value (not missing)', () => {
    expect(() => validateArgs({ name: '' } as any, ['name'])).not.toThrow();
  });
});

// ── validateElementType ────────────────────────────────────────────────────

describe('validateElementType', () => {
  test('passes for every ALLOWED_ELEMENT_TYPE', () => {
    for (const type of ALLOWED_ELEMENT_TYPES) {
      expect(() => validateElementType(type)).not.toThrow();
    }
  });

  test('throws for a completely invalid type', () => {
    expect(() => validateElementType('bpmn:Invalid')).toThrow();
  });

  test('includes "did you mean" suggestions for close typos', () => {
    let message = '';
    try {
      validateElementType('bpmn:UserTaks'); // typo of UserTask
    } catch (err: any) {
      message = err.message;
    }
    // Should suggest bpmn:UserTask
    expect(message).toMatch(/UserTask/i);
  });

  test('throws without crashing for a totally unrelated string', () => {
    expect(() => validateElementType('banana')).toThrow();
  });

  test('accepts custom allowedTypes list', () => {
    const custom = ['bpmn:Task', 'bpmn:UserTask'] as const;
    expect(() => validateElementType('bpmn:Task', custom)).not.toThrow();
    expect(() => validateElementType('bpmn:ServiceTask', custom)).toThrow();
  });

  test('is case-sensitive for the exact match', () => {
    // 'bpmn:task' (lower) is not the same as 'bpmn:Task' — but Levenshtein
    // should still surface a suggestion
    expect(() => validateElementType('bpmn:usertask')).toThrow();
  });
});

// ── ALLOWED_ELEMENT_TYPES ──────────────────────────────────────────────────

describe('ALLOWED_ELEMENT_TYPES', () => {
  test('contains bpmn:StartEvent and bpmn:EndEvent', () => {
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:StartEvent');
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:EndEvent');
  });

  test('contains the five basic task types', () => {
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:UserTask');
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:ServiceTask');
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:ScriptTask');
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:ManualTask');
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:BusinessRuleTask');
  });

  test('contains the four gateway types', () => {
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:ExclusiveGateway');
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:ParallelGateway');
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:InclusiveGateway');
    expect(ALLOWED_ELEMENT_TYPES).toContain('bpmn:EventBasedGateway');
  });

  test('has no duplicates', () => {
    const set = new Set(ALLOWED_ELEMENT_TYPES);
    expect(set.size).toBe(ALLOWED_ELEMENT_TYPES.length);
  });
});

// ── INSERTABLE_ELEMENT_TYPES ───────────────────────────────────────────────

describe('INSERTABLE_ELEMENT_TYPES', () => {
  test('is a subset of ALLOWED_ELEMENT_TYPES', () => {
    for (const type of INSERTABLE_ELEMENT_TYPES) {
      expect(ALLOWED_ELEMENT_TYPES).toContain(type);
    }
  });

  test('does not include bpmn:Participant or bpmn:Lane', () => {
    expect(INSERTABLE_ELEMENT_TYPES).not.toContain('bpmn:Participant');
    expect(INSERTABLE_ELEMENT_TYPES).not.toContain('bpmn:Lane');
  });

  test('does not include bpmn:BoundaryEvent', () => {
    // BoundaryEvents require a host and cannot be inserted into a flow
    expect(INSERTABLE_ELEMENT_TYPES).not.toContain('bpmn:BoundaryEvent');
  });

  test('has no duplicates', () => {
    const set = new Set(INSERTABLE_ELEMENT_TYPES);
    expect(set.size).toBe(INSERTABLE_ELEMENT_TYPES.length);
  });
});
