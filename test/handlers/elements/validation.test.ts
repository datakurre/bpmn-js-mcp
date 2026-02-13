/**
 * Tests for validateArgs from src/handlers/validation.ts.
 */

import { describe, test, expect } from 'vitest';
import { validateArgs } from '../../../src/handlers/validation';

describe('validateArgs', () => {
  test('passes when all required keys present', () => {
    expect(() =>
      validateArgs({ diagramId: 'abc', elementId: 'xyz' }, ['diagramId', 'elementId'])
    ).not.toThrow();
  });

  test('throws for missing key', () => {
    expect(() => validateArgs({ diagramId: 'abc' } as any, ['diagramId', 'elementId'])).toThrow(
      /Missing required.*elementId/
    );
  });

  test('throws for null value', () => {
    expect(() =>
      validateArgs({ diagramId: 'abc', elementId: null } as any, ['diagramId', 'elementId'])
    ).toThrow(/Missing required.*elementId/);
  });

  test('throws for undefined value', () => {
    expect(() =>
      validateArgs({ diagramId: 'abc', elementId: undefined } as any, ['diagramId', 'elementId'])
    ).toThrow(/Missing required.*elementId/);
  });

  test('throws listing all missing keys', () => {
    expect(() => validateArgs({} as any, ['diagramId', 'elementId'])).toThrow(
      /diagramId.*elementId/
    );
  });

  test('allows optional keys to be missing', () => {
    expect(() =>
      validateArgs({ diagramId: 'abc', name: undefined } as any, ['diagramId'])
    ).not.toThrow();
  });

  test('accepts falsy but non-null/undefined values', () => {
    expect(() =>
      validateArgs({ diagramId: '', count: 0, flag: false } as any, ['diagramId', 'count', 'flag'])
    ).not.toThrow();
  });
});
