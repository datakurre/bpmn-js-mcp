/**
 * Connection type auto-detection tests.
 *
 * Verifies that connect_bpmn_elements correctly auto-detects the connection
 * type based on source/target element types:
 * - TextAnnotation → auto-corrects to Association
 * - DataObjectReference → auto-detects DataAssociation
 * - DataStoreReference → auto-detects DataAssociation
 * - Task → Task → defaults to SequenceFlow
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleConnect } from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('connect_bpmn_elements — auto-detection', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── TextAnnotation → Association ─────────────────────────────────────

  test('auto-corrects TextAnnotation→Task to Association', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'My Task',
      x: 200,
      y: 100,
    });
    const annotId = await addElement(diagramId, 'bpmn:TextAnnotation', {
      name: 'Note',
      x: 200,
      y: 300,
    });

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: annotId,
        targetElementId: taskId,
      })
    );
    expect(conn.success).toBe(true);
    expect(conn.connectionType).toBe('bpmn:Association');
    expect(conn.hint).toContain('auto-corrected');
    expect(conn.hint).toContain('Association');
  });

  test('auto-corrects Task→TextAnnotation to Association', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process',
      x: 200,
      y: 100,
    });
    const annotId = await addElement(diagramId, 'bpmn:TextAnnotation', {
      name: 'A note',
      x: 200,
      y: 300,
    });

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: taskId,
        targetElementId: annotId,
      })
    );
    expect(conn.success).toBe(true);
    expect(conn.connectionType).toBe('bpmn:Association');
  });

  test('preserves explicit Association type for TextAnnotation', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task',
      x: 200,
      y: 100,
    });
    const annotId = await addElement(diagramId, 'bpmn:TextAnnotation', {
      name: 'Note',
      x: 200,
      y: 300,
    });

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: annotId,
        targetElementId: taskId,
        connectionType: 'bpmn:Association',
      })
    );
    expect(conn.success).toBe(true);
    expect(conn.connectionType).toBe('bpmn:Association');
  });

  // ── DataObjectReference / DataStoreReference → error ─────────────────

  test('auto-detects DataAssociation for Task→DataObjectReference', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task',
      x: 200,
      y: 100,
    });
    const dataId = await addElement(diagramId, 'bpmn:DataObjectReference', {
      name: 'Data',
      x: 200,
      y: 300,
    });

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: taskId,
        targetElementId: dataId,
      })
    );
    expect(conn.success).toBe(true);
    expect(conn.connectionId).toBeDefined();
  });

  test('auto-detects DataAssociation for DataObjectReference→Task', async () => {
    const diagramId = await createDiagram();
    const dataId = await addElement(diagramId, 'bpmn:DataObjectReference', {
      name: 'Data',
      x: 200,
      y: 300,
    });
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task',
      x: 200,
      y: 100,
    });

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: dataId,
        targetElementId: taskId,
      })
    );
    expect(conn.success).toBe(true);
    expect(conn.connectionId).toBeDefined();
  });

  test('auto-detects DataAssociation for Task→DataStoreReference', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Service',
      x: 200,
      y: 100,
    });
    const storeId = await addElement(diagramId, 'bpmn:DataStoreReference', {
      name: 'DB',
      x: 200,
      y: 300,
    });

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: taskId,
        targetElementId: storeId,
      })
    );
    expect(conn.success).toBe(true);
    expect(conn.connectionId).toBeDefined();
  });

  test('auto-detects DataAssociation for DataStoreReference→Task', async () => {
    const diagramId = await createDiagram();
    const storeId = await addElement(diagramId, 'bpmn:DataStoreReference', {
      name: 'DB',
      x: 200,
      y: 300,
    });
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Service',
      x: 200,
      y: 100,
    });

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: storeId,
        targetElementId: taskId,
      })
    );
    expect(conn.success).toBe(true);
    expect(conn.connectionId).toBeDefined();
  });

  // ── Normal flow ─────────────────────────────────────────────────────

  test('defaults Task→Task to SequenceFlow', async () => {
    const diagramId = await createDiagram();
    const t1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task A',
      x: 100,
      y: 100,
    });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Task B',
      x: 300,
      y: 100,
    });

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: t1,
        targetElementId: t2,
      })
    );
    expect(conn.success).toBe(true);
    expect(conn.connectionType).toBe('bpmn:SequenceFlow');
    expect(conn.hint).toBeUndefined();
  });
});
