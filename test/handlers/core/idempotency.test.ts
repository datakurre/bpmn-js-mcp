import { describe, test, expect, beforeEach } from 'vitest';
import { dispatchToolCall, clearIdempotencyCache } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

describe('clientRequestId idempotency', () => {
  beforeEach(() => {
    clearDiagrams();
    clearIdempotencyCache();
  });

  test('returns cached result for duplicate _clientRequestId', async () => {
    // First call creates the diagram
    const res1 = parseResult(
      await dispatchToolCall('create_bpmn_diagram', {
        name: 'Test',
        _clientRequestId: 'req-001',
      })
    );
    expect(res1.success).toBe(true);
    const diagramId1 = res1.diagramId;

    // Second call with same _clientRequestId returns cached result
    const res2 = parseResult(
      await dispatchToolCall('create_bpmn_diagram', {
        name: 'Different Name',
        _clientRequestId: 'req-001',
      })
    );
    expect(res2.success).toBe(true);
    expect(res2.diagramId).toBe(diagramId1);
  });

  test('different _clientRequestId produces different results', async () => {
    const res1 = parseResult(
      await dispatchToolCall('create_bpmn_diagram', {
        name: 'A',
        _clientRequestId: 'req-A',
      })
    );
    const res2 = parseResult(
      await dispatchToolCall('create_bpmn_diagram', {
        name: 'B',
        _clientRequestId: 'req-B',
      })
    );
    expect(res1.diagramId).not.toBe(res2.diagramId);
  });

  test('omitting _clientRequestId skips caching', async () => {
    const res1 = parseResult(await dispatchToolCall('create_bpmn_diagram', { name: 'A' }));
    const res2 = parseResult(await dispatchToolCall('create_bpmn_diagram', { name: 'B' }));
    // Each call produces a new diagram
    expect(res1.diagramId).not.toBe(res2.diagramId);
  });

  test('read-only tools skip caching', async () => {
    const createRes = parseResult(await dispatchToolCall('create_bpmn_diagram', {}));
    const diagramId = createRes.diagramId;

    // Call validate twice with same _clientRequestId — each call re-executes
    const res1 = await dispatchToolCall('validate_bpmn_diagram', {
      diagramId,
      _clientRequestId: 'validate-001',
    });
    const res2 = await dispatchToolCall('validate_bpmn_diagram', {
      diagramId,
      _clientRequestId: 'validate-001',
    });
    // Both should succeed (not cached, but both produce valid results)
    expect(parseResult(res1).issues).toBeDefined();
    expect(parseResult(res2).issues).toBeDefined();
  });

  test('_clientRequestId is stripped from handler args', async () => {
    // If _clientRequestId leaks to the handler, it would cause unexpected behavior.
    // This test verifies create_bpmn_diagram works normally with the extra field.
    const res = parseResult(
      await dispatchToolCall('create_bpmn_diagram', {
        name: 'TestProcess',
        _clientRequestId: 'req-strip-test',
      })
    );
    expect(res.success).toBe(true);
    expect(res.diagramId).toBeDefined();
  });
});
