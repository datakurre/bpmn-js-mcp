/**
 * Unit tests for handlers/lane-helpers.ts
 *
 * Tests removeFromAllLanes, addToLane, getLaneElements, getSiblingLanes.
 * Uses a real bpmn-js modeler with a collaboration + lanes fixture.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  removeFromAllLanes,
  addToLane,
  getLaneElements,
  getSiblingLanes,
} from '../../src/handlers/lane-helpers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import { getService } from '../../src/bpmn-types';
import { handleCreateLanes, handleAddElement } from '../../src/handlers';

// ── Helpers ────────────────────────────────────────────────────────────────

function parseResult(result: any) {
  return JSON.parse(result.content[0].text);
}

let diagramId: string;
let participantId: string;

beforeEach(async () => {
  diagramId = await createDiagram('lane-helpers-test');
  // Create a participant (pool) then add 2 lanes inside it
  participantId = await addElement(diagramId, 'bpmn:Participant', {
    name: 'Pool',
    x: 300,
    y: 300,
  });
  await handleCreateLanes({
    diagramId,
    participantId,
    lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
  });
});

afterEach(() => {
  clearDiagrams();
});

function getElementRegistry() {
  return getService(getDiagram(diagramId)!.modeler, 'elementRegistry') as any;
}

function getLaneByName(name: string) {
  const registry = getElementRegistry();
  const lanes: any[] = registry.filter((el: any) => el.type === 'bpmn:Lane');
  return lanes.find((l: any) => l.businessObject?.name === name);
}

// ── addToLane / getLaneElements ────────────────────────────────────────────

describe('addToLane', () => {
  test('adds an element business object to a lane flowNodeRef', async () => {
    // Add a task to the diagram
    const taskResult = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:UserTask', name: 'Do Work' })
    );
    const registry = getElementRegistry();
    const task = registry.get(taskResult.elementId);
    const laneA = getLaneByName('Lane A');

    expect(laneA).toBeDefined();
    addToLane(laneA, task.businessObject);
    const refs = getLaneElements(laneA);
    expect(refs).toContain(task.businessObject);
  });

  test('is idempotent — adding the same element twice does not duplicate', async () => {
    const taskResult = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:Task', name: 'Idempotent Task' })
    );
    const registry = getElementRegistry();
    const task = registry.get(taskResult.elementId);
    const laneA = getLaneByName('Lane A');

    addToLane(laneA, task.businessObject);
    addToLane(laneA, task.businessObject);

    const refs = getLaneElements(laneA);
    const occurrences = refs.filter(
      (r: any) => r === task.businessObject || r?.id === task.businessObject?.id
    );
    expect(occurrences).toHaveLength(1);
  });

  test('does nothing when lane has no businessObject', () => {
    const fakeLane = {} as any;
    const bo = { id: 'Task_X' };
    expect(() => addToLane(fakeLane, bo)).not.toThrow();
  });
});

// ── getLaneElements ────────────────────────────────────────────────────────

describe('getLaneElements', () => {
  test('returns empty array for a lane with no flowNodeRef', () => {
    const emptyLane = { businessObject: {} } as any;
    expect(getLaneElements(emptyLane)).toEqual([]);
  });

  test('returns the flowNodeRef array', async () => {
    const taskResult = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:Task', name: 'Ref Task' })
    );
    const registry = getElementRegistry();
    const task = registry.get(taskResult.elementId);
    const laneA = getLaneByName('Lane A');

    addToLane(laneA, task.businessObject);
    const refs = getLaneElements(laneA);
    expect(Array.isArray(refs)).toBe(true);
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });
});

// ── removeFromAllLanes ─────────────────────────────────────────────────────

describe('removeFromAllLanes', () => {
  test('removes a business object from the lane that contains it', async () => {
    const taskResult = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:Task', name: 'Removable Task' })
    );
    const registry = getElementRegistry();
    const task = registry.get(taskResult.elementId);
    const laneA = getLaneByName('Lane A');

    addToLane(laneA, task.businessObject);
    expect(getLaneElements(laneA)).toContain(task.businessObject);

    removeFromAllLanes(registry, task.businessObject);
    expect(getLaneElements(laneA)).not.toContain(task.businessObject);
  });

  test('does not throw when element is not in any lane', async () => {
    const taskResult = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:Task', name: 'Orphan Task' })
    );
    const registry = getElementRegistry();
    const task = registry.get(taskResult.elementId);

    expect(() => removeFromAllLanes(registry, task.businessObject)).not.toThrow();
  });

  test('removes the element from all lanes if it somehow appears in multiple', async () => {
    const taskResult = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:Task', name: 'Multi Lane Task' })
    );
    const registry = getElementRegistry();
    const task = registry.get(taskResult.elementId);
    const laneA = getLaneByName('Lane A');
    const laneB = getLaneByName('Lane B');

    addToLane(laneA, task.businessObject);
    addToLane(laneB, task.businessObject);

    removeFromAllLanes(registry, task.businessObject);

    expect(getLaneElements(laneA)).not.toContain(task.businessObject);
    expect(getLaneElements(laneB)).not.toContain(task.businessObject);
  });
});

// ── getSiblingLanes ────────────────────────────────────────────────────────

describe('getSiblingLanes', () => {
  test('returns the other lane when there are 2 lanes', () => {
    const registry = getElementRegistry();
    const laneA = getLaneByName('Lane A');
    const laneB = getLaneByName('Lane B');

    expect(laneA).toBeDefined();
    expect(laneB).toBeDefined();

    const siblingsA = getSiblingLanes(registry, laneA);
    expect(siblingsA).toHaveLength(1);
    expect(siblingsA[0].id).toBe(laneB.id);

    const siblingsB = getSiblingLanes(registry, laneB);
    expect(siblingsB).toHaveLength(1);
    expect(siblingsB[0].id).toBe(laneA.id);
  });

  test('does not include the lane itself in siblings', () => {
    const registry = getElementRegistry();
    const laneA = getLaneByName('Lane A');
    const siblings = getSiblingLanes(registry, laneA);
    expect(siblings.map((s: any) => s.id)).not.toContain(laneA.id);
  });

  test('returns empty array for a lane with no parent', () => {
    const registry = getElementRegistry();
    const fakeLane = { id: 'Lane_fake', type: 'bpmn:Lane', parent: undefined } as any;
    expect(getSiblingLanes(registry, fakeLane)).toEqual([]);
  });
});
