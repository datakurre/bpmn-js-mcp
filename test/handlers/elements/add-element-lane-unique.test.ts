/**
 * Tests for add_bpmn_elements's laneId, ensureUnique, and di response fields.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../utils/diagram';
import {
  handleAddElement,
  handleCreateParticipant,
  handleCreateLanes,
  handleCreateCollaboration,
} from '../../../src/handlers';

afterEach(() => clearDiagrams());

describe('add_bpmn_elements — laneId parameter', () => {
  test('rejects laneId that is not a Lane', async () => {
    const diagramId = await createDiagram('lane-test');
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task1' });

    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task2',
        laneId: task,
      })
    ).rejects.toThrow(/operation requires.*bpmn:Lane/);
  });

  test('rejects laneId that does not exist', async () => {
    const diagramId = await createDiagram('lane-test');

    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task1',
        laneId: 'nonexistent_lane',
      })
    ).rejects.toThrow();
  });
});

describe('add_bpmn_elements — ensureUnique flag', () => {
  test('rejects duplicate when ensureUnique is true', async () => {
    const diagramId = await createDiagram('unique-test');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Order',
        ensureUnique: true,
      })
    ).rejects.toThrow(/ensureUnique/);
  });

  test('allows duplicate when ensureUnique is false (default)', async () => {
    const diagramId = await createDiagram('unique-test');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    // Should succeed (with a warning)
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Order',
      })
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('already exists');
  });

  test('allows same name with different type when ensureUnique is true', async () => {
    const diagramId = await createDiagram('unique-test');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    // Different type — should succeed
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Review Order',
        ensureUnique: true,
      })
    );
    expect(result.success).toBe(true);
  });

  test('allows duplicate unnamed elements even with ensureUnique', async () => {
    const diagramId = await createDiagram('unique-test');
    await addElement(diagramId, 'bpmn:UserTask');

    // No name — ensureUnique only checks named elements
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        ensureUnique: true,
      })
    );
    expect(result.success).toBe(true);
  });
});

describe('add_bpmn_elements — di info in response', () => {
  test('returns di object with x, y, width, height', async () => {
    const diagramId = await createDiagram('di-test');
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'My Task',
      })
    );

    expect(result.di).toBeDefined();
    expect(result.di.x).toBeTypeOf('number');
    expect(result.di.y).toBeTypeOf('number');
    expect(result.di.width).toBeTypeOf('number');
    expect(result.di.height).toBeTypeOf('number');
    // UserTask default size is 100×80
    expect(result.di.width).toBe(100);
    expect(result.di.height).toBe(80);
  });

  test('returns correct di for start events', async () => {
    const diagramId = await createDiagram('di-test');
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
      })
    );

    expect(result.di).toBeDefined();
    // StartEvent default size is 36×36
    expect(result.di.width).toBe(36);
    expect(result.di.height).toBe(36);
  });

  test('returns correct di for gateways', async () => {
    const diagramId = await createDiagram('di-test');
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Approved?',
      })
    );

    expect(result.di).toBeDefined();
    // Gateway default size is 50×50
    expect(result.di.width).toBe(50);
    expect(result.di.height).toBe(50);
  });
});

describe('add_bpmn_elements — laneId warning when participantId has lanes (TODO #8)', () => {
  test('emits warning when participantId refers to a pool with lanes and no laneId given', async () => {
    const diagramId = await createDiagram();

    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'MyOrg', width: 800, height: 400 })
    );
    const poolId = poolRes.participantId as string;

    await handleCreateLanes({
      diagramId,
      participantId: poolId,
      lanes: [{ name: 'Engineering' }, { name: 'Management' }],
    });

    // Add element with participantId but no laneId — should warn
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review PR',
        participantId: poolId,
        // no laneId
      })
    );

    expect(result.success).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    const laneWarning = result.warnings.find(
      (w: string) => w.toLowerCase().includes('lane') && w.toLowerCase().includes('laneid')
    );
    expect(laneWarning).toBeDefined();
    // Warning should reference available lanes
    expect(laneWarning).toContain('Engineering');
  });

  test('no lane warning when participantId refers to a pool without lanes (even if another pool has lanes)', async () => {
    // Regression: in a 2-pool collaboration where Pool A has lanes and Pool B does not,
    // adding an element to Pool B (via participantId) must NOT warn about laneId.
    const diagramId = await createDiagram();

    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'PoolA' }, { name: 'PoolB' }],
      })
    );
    const poolAId = collabRes.participantIds[0];
    const poolBId = collabRes.participantIds[1];

    // Give Pool A two lanes
    await handleCreateLanes({
      diagramId,
      participantId: poolAId,
      lanes: [{ name: 'Lane1' }, { name: 'Lane2' }],
    });

    // Pool B has NO lanes — adding element with participantId=poolB should NOT warn
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Do Work',
        participantId: poolBId,
      })
    );

    expect(result.success).toBe(true);
    // No lane warning expected since participant poolB has no lanes
    const laneWarning = (result.warnings ?? []).find(
      (w: string) => w.toLowerCase().includes('lane') && w.toLowerCase().includes('laneid')
    );
    expect(laneWarning).toBeUndefined();
  });
});
