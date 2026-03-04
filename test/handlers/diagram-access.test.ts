/**
 * Unit tests for handlers/diagram-access.ts
 *
 * Tests the shared helper functions: getVisibleElements, isConnectionElement,
 * isInfrastructureElement, buildElementCounts, getParticipants, getLanes,
 * getProcesses, getSequenceFlows, getMessageFlows, getElementsByType,
 * isCollaboration, buildConnectivityWarnings, and buildConnectivityNextSteps.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  getVisibleElements,
  isConnectionElement,
  isInfrastructureElement,
  buildElementCounts,
  getParticipants,
  getLanes,
  getProcesses,
  getSequenceFlows,
  getMessageFlows,
  getElementsByType,
  isCollaboration,
  buildConnectivityWarnings,
  buildConnectivityNextSteps,
} from '../../src/handlers/diagram-access';
import { createDiagram, addElement, createSimpleProcess, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import { getService } from '../../src/bpmn-types';

// ── Fixtures ───────────────────────────────────────────────────────────────

let diagramId: string;

function getRegistry() {
  return getService(getDiagram(diagramId)!.modeler, 'elementRegistry') as any;
}

beforeEach(async () => {
  diagramId = await createDiagram('diagram-access-test');
});

afterEach(() => {
  clearDiagrams();
});

// ── isConnectionElement ────────────────────────────────────────────────────

describe('isConnectionElement', () => {
  test('returns true for bpmn:SequenceFlow', () => {
    expect(isConnectionElement('bpmn:SequenceFlow')).toBe(true);
  });

  test('returns true for bpmn:MessageFlow', () => {
    expect(isConnectionElement('bpmn:MessageFlow')).toBe(true);
  });

  test('returns true for bpmn:Association', () => {
    expect(isConnectionElement('bpmn:Association')).toBe(true);
  });

  test('returns true for bpmn:DataInputAssociation', () => {
    expect(isConnectionElement('bpmn:DataInputAssociation')).toBe(true);
  });

  test('returns true for bpmn:DataOutputAssociation', () => {
    expect(isConnectionElement('bpmn:DataOutputAssociation')).toBe(true);
  });

  test('returns false for bpmn:Task', () => {
    expect(isConnectionElement('bpmn:Task')).toBe(false);
  });

  test('returns false for bpmn:Participant', () => {
    expect(isConnectionElement('bpmn:Participant')).toBe(false);
  });
});

// ── isInfrastructureElement ────────────────────────────────────────────────

describe('isInfrastructureElement', () => {
  test('returns true for all connection types', () => {
    expect(isInfrastructureElement('bpmn:SequenceFlow')).toBe(true);
    expect(isInfrastructureElement('bpmn:MessageFlow')).toBe(true);
    expect(isInfrastructureElement('bpmn:Association')).toBe(true);
  });

  test('returns true for container types', () => {
    expect(isInfrastructureElement('bpmn:Participant')).toBe(true);
    expect(isInfrastructureElement('bpmn:Lane')).toBe(true);
    expect(isInfrastructureElement('bpmn:Group')).toBe(true);
  });

  test('returns false for flow nodes', () => {
    expect(isInfrastructureElement('bpmn:Task')).toBe(false);
    expect(isInfrastructureElement('bpmn:UserTask')).toBe(false);
    expect(isInfrastructureElement('bpmn:StartEvent')).toBe(false);
    expect(isInfrastructureElement('bpmn:ExclusiveGateway')).toBe(false);
  });
});

// ── getVisibleElements ─────────────────────────────────────────────────────

describe('getVisibleElements', () => {
  test('returns an empty-ish list for a fresh diagram (only root present)', async () => {
    const registry = getRegistry();
    const visible = getVisibleElements(registry);
    // A fresh diagram has no visible elements beyond the process root which is filtered out
    expect(Array.isArray(visible)).toBe(true);
  });

  test('includes a task after adding one', async () => {
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'My Task' });
    const registry = getRegistry();
    const visible = getVisibleElements(registry);
    const ids = visible.map((el: any) => el.id);
    expect(ids).toContain(taskId);
  });

  test('excludes bpmn:Process elements', async () => {
    const registry = getRegistry();
    const visible = getVisibleElements(registry);
    expect(visible.every((el: any) => el.type !== 'bpmn:Process')).toBe(true);
  });

  test('excludes label elements', async () => {
    await addElement(diagramId, 'bpmn:Task', { name: 'Labelled' });
    const registry = getRegistry();
    const visible = getVisibleElements(registry);
    expect(visible.every((el: any) => el.type !== 'label')).toBe(true);
  });
});

// ── buildElementCounts ─────────────────────────────────────────────────────

describe('buildElementCounts', () => {
  test('returns zero counts for a fresh diagram', async () => {
    const registry = getRegistry();
    const counts = buildElementCounts(registry);
    expect(counts.tasks).toBe(0);
    expect(counts.events).toBe(0);
    expect(counts.gateways).toBe(0);
    expect(counts.flows).toBe(0);
  });

  test('counts tasks correctly', async () => {
    await addElement(diagramId, 'bpmn:Task', { name: 'T1' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'T2' });
    const registry = getRegistry();
    const counts = buildElementCounts(registry);
    expect(counts.tasks).toBe(2);
  });

  test('counts events correctly', async () => {
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'S' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'E' });
    const registry = getRegistry();
    const counts = buildElementCounts(registry);
    expect(counts.events).toBe(2);
  });

  test('counts gateways correctly', async () => {
    await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'G' });
    const registry = getRegistry();
    const counts = buildElementCounts(registry);
    expect(counts.gateways).toBe(1);
  });

  test('counts flows correctly after connecting', async () => {
    const { start, task, end } = await createSimpleProcess(diagramId);
    void start;
    void task;
    void end; // ensure process is built
    const registry = getRegistry();
    const counts = buildElementCounts(registry);
    expect(counts.flows).toBe(2); // start→task and task→end
  });

  test('total matches sum of categories', async () => {
    await addElement(diagramId, 'bpmn:Task', { name: 'T' });
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'S' });
    const registry = getRegistry();
    const counts = buildElementCounts(registry);
    expect(counts.total).toBe(
      counts.tasks + counts.events + counts.gateways + counts.flows + counts.other
    );
  });
});

// ── getParticipants / isCollaboration ─────────────────────────────────────

describe('getParticipants and isCollaboration', () => {
  test('returns no participants and isCollaboration=false for a plain process', async () => {
    const registry = getRegistry();
    expect(getParticipants(registry)).toHaveLength(0);
    expect(isCollaboration(registry)).toBe(false);
  });
});

// ── getProcesses ───────────────────────────────────────────────────────────

describe('getProcesses', () => {
  test('returns at least one process for a plain diagram', async () => {
    const registry = getRegistry();
    // A fresh diagram always has one bpmn:Process element
    const processes = getProcesses(registry);
    expect(processes.length).toBeGreaterThanOrEqual(1);
  });
});

// ── getSequenceFlows ───────────────────────────────────────────────────────

describe('getSequenceFlows', () => {
  test('returns empty array before any connections', async () => {
    const registry = getRegistry();
    expect(getSequenceFlows(registry)).toHaveLength(0);
  });

  test('returns the correct count after connecting elements', async () => {
    await createSimpleProcess(diagramId);
    const registry = getRegistry();
    expect(getSequenceFlows(registry)).toHaveLength(2);
  });
});

// ── getMessageFlows ────────────────────────────────────────────────────────

describe('getMessageFlows', () => {
  test('returns empty array in a plain process (no collaboration)', async () => {
    const registry = getRegistry();
    expect(getMessageFlows(registry)).toHaveLength(0);
  });
});

// ── getElementsByType ──────────────────────────────────────────────────────

describe('getElementsByType', () => {
  test('returns only elements of the requested type', async () => {
    await addElement(diagramId, 'bpmn:Task', { name: 'T' });
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'S' });
    const registry = getRegistry();

    const tasks = getElementsByType(registry, 'bpmn:Task');
    expect(tasks.every((el: any) => el.type === 'bpmn:Task')).toBe(true);

    const events = getElementsByType(registry, 'bpmn:StartEvent');
    expect(events.every((el: any) => el.type === 'bpmn:StartEvent')).toBe(true);
  });

  test('returns an empty array for a type not present', async () => {
    const registry = getRegistry();
    expect(getElementsByType(registry, 'bpmn:ScriptTask')).toHaveLength(0);
  });
});

// ── getLanes ───────────────────────────────────────────────────────────────

describe('getLanes', () => {
  test('returns empty array for a diagram without lanes', async () => {
    const registry = getRegistry();
    expect(getLanes(registry)).toHaveLength(0);
  });
});

// ── buildConnectivityWarnings ──────────────────────────────────────────────

describe('buildConnectivityWarnings', () => {
  test('returns no warnings for an empty diagram', async () => {
    const registry = getRegistry();
    const warnings = buildConnectivityWarnings(registry);
    expect(warnings).toHaveLength(0);
  });

  test('warns when elements exist but no flows', async () => {
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'S' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'E' });
    const registry = getRegistry();
    const warnings = buildConnectivityWarnings(registry);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('connect_bpmn_elements');
  });

  test('returns no warnings when elements are fully connected', async () => {
    await createSimpleProcess(diagramId);
    const registry = getRegistry();
    const warnings = buildConnectivityWarnings(registry);
    expect(warnings).toHaveLength(0);
  });
});

// ── buildConnectivityNextSteps ─────────────────────────────────────────────

describe('buildConnectivityNextSteps', () => {
  test('returns an empty array for an empty diagram', async () => {
    const registry = getRegistry();
    const steps = buildConnectivityNextSteps(registry, diagramId);
    expect(steps).toHaveLength(0);
  });

  test('returns connect steps when elements are not connected', async () => {
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'S' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'E' });
    const registry = getRegistry();
    const steps = buildConnectivityNextSteps(registry, diagramId);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].tool).toBe('connect_bpmn_elements');
    expect(steps[0].args.diagramId).toBe(diagramId);
  });

  test('returns no steps when diagram is fully connected', async () => {
    await createSimpleProcess(diagramId);
    const registry = getRegistry();
    const steps = buildConnectivityNextSteps(registry, diagramId);
    expect(steps).toHaveLength(0);
  });
});
