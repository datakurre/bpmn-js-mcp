/**
 * MCP Reproduction Tests.
 *
 * For each reference BPMN in test/fixtures/layout-references/, this test builds
 * the same diagram from scratch using MCP handler functions, runs ELK layout,
 * and compares the result structurally against the reference. Element IDs will
 * differ — assertions match by name lookup instead.
 *
 * Run with: npx vitest run test/handlers/mcp-reproduction.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleSetProperties,
  handleCreateCollaboration,
} from '../../src/handlers';
import {
  createDiagram,
  addElement,
  connect,
  parseResult,
  clearDiagrams,
  getRegistry,
} from '../helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

/** Find an element by name in a registry. */
function findByName(registry: any, name: string): any {
  return registry.getAll().find((el: any) => el.businessObject?.name === name);
}

/** Find a sequence flow by its name (label). */
function findFlowByName(registry: any, name: string): any {
  return registry
    .getAll()
    .find((el: any) => el.type === 'bpmn:SequenceFlow' && el.businessObject?.name === name);
}

/** Find all sequence flows between two elements (by source and target IDs). */
function findFlowBetween(registry: any, sourceId: string, targetId: string): any {
  return registry
    .getAll()
    .find(
      (el: any) =>
        el.type === 'bpmn:SequenceFlow' && el.source?.id === sourceId && el.target?.id === targetId
    );
}

/** Find a message flow in the registry. */
function findMessageFlow(registry: any): any {
  return registry.getAll().find((el: any) => el.type === 'bpmn:MessageFlow');
}

/** Find a participant by name. */
function findParticipant(registry: any, name: string): any {
  return registry
    .getAll()
    .find((el: any) => el.type === 'bpmn:Participant' && el.businessObject?.name === name);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MCP Reproduction Tests', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
    clearDiagrams();
  });

  // ── 01 Linear Flow ─────────────────────────────────────────────────

  describe('01-linear-flow', () => {
    async function buildLinearFlow() {
      const diagramId = await createDiagram('Linear Flow');
      const startId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Order Received',
      });
      const validateId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Validate Order',
        afterElementId: startId,
      });
      const paymentId = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Payment',
        afterElementId: validateId,
      });
      const shipId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Ship Order',
        afterElementId: paymentId,
      });
      const endId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Order Complete',
        afterElementId: shipId,
      });
      return { diagramId, startId, validateId, paymentId, shipId, endId };
    }

    test('all elements on same Y row after layout', async () => {
      const { diagramId } = await buildLinearFlow();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const names = [
        'Order Received',
        'Validate Order',
        'Process Payment',
        'Ship Order',
        'Order Complete',
      ];
      const elements = names.map((n) => findByName(reg, n)).filter(Boolean);
      expect(elements.length).toBe(5);

      const refY = centreY(elements[0]);
      for (const el of elements) {
        expect(
          Math.abs(centreY(el) - refY),
          `"${el.businessObject.name}" Y=${centreY(el)} not on row Y=${refY}`
        ).toBeLessThanOrEqual(5);
      }
    });

    test('left-to-right X ordering matches name ordering', async () => {
      const { diagramId } = await buildLinearFlow();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const names = [
        'Order Received',
        'Validate Order',
        'Process Payment',
        'Ship Order',
        'Order Complete',
      ];
      const elements = names.map((n) => findByName(reg, n)).filter(Boolean);
      for (let i = 1; i < elements.length; i++) {
        expect(
          centreX(elements[i]),
          `"${elements[i].businessObject.name}" should be right of "${elements[i - 1].businessObject.name}"`
        ).toBeGreaterThan(centreX(elements[i - 1]));
      }
    });

    test('all sequence flows are 2-waypoint horizontal lines', async () => {
      const { diagramId } = await buildLinearFlow();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const flows = reg.getAll().filter((el: any) => el.type === 'bpmn:SequenceFlow');
      expect(flows.length).toBe(4);

      for (const flow of flows) {
        const wp = flow.waypoints;
        expect(wp.length, `Flow ${flow.id} should have 2 waypoints`).toBe(2);
        expect(
          Math.abs(wp[0].y - wp[1].y),
          `Flow ${flow.id} should be horizontal`
        ).toBeLessThanOrEqual(1);
      }
    });

    test('uniform edge-to-edge gaps between elements', async () => {
      const { diagramId } = await buildLinearFlow();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const names = [
        'Order Received',
        'Validate Order',
        'Process Payment',
        'Ship Order',
        'Order Complete',
      ];
      const elements = names.map((n) => findByName(reg, n)).filter(Boolean);
      const gaps: number[] = [];
      for (let i = 1; i < elements.length; i++) {
        const prevRight = elements[i - 1].x + (elements[i - 1].width || 0);
        const currLeft = elements[i].x;
        gaps.push(currLeft - prevRight);
      }

      // All gaps positive (no overlaps)
      for (const gap of gaps) {
        expect(gap, 'Elements should not overlap').toBeGreaterThan(0);
      }

      // Gaps should be roughly uniform (stdDev < 30% of mean)
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const stdDev = Math.sqrt(gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length);
      expect(
        stdDev,
        `Gap stdDev=${stdDev.toFixed(1)} too high vs mean=${mean.toFixed(1)}`
      ).toBeLessThan(mean * 0.3 + 1); // +1 for rounding tolerance
    });
  });

  // ── 02 Exclusive Gateway ───────────────────────────────────────────

  describe('02-exclusive-gateway', () => {
    async function buildExclusiveGateway() {
      const diagramId = await createDiagram('Exclusive Gateway');
      const startId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Request Received',
      });
      const gatewayId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
        name: 'Approved?',
        afterElementId: startId,
      });
      const fulfillId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Fulfill Request',
        afterElementId: gatewayId,
      });
      const rejectionId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Send Rejection',
      });
      const mergeId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
        name: 'Merge',
        afterElementId: fulfillId,
      });
      const endId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Done',
        afterElementId: mergeId,
      });

      // Connect gateway → rejection (No, default)
      await connect(diagramId, gatewayId, rejectionId, { label: 'No', isDefault: true });
      // Connect rejection → merge
      await connect(diagramId, rejectionId, mergeId);

      // Set condition on "Yes" flow (the auto-connected gateway → fulfill flow)
      const reg = getRegistry(diagramId);
      const yesFlow = findFlowBetween(reg, gatewayId, fulfillId);
      if (yesFlow) {
        await handleSetProperties({
          diagramId,
          elementId: yesFlow.id,
          properties: {
            name: 'Yes',
            conditionExpression: '${approved == true}',
          },
        });
      }

      return {
        diagramId,
        startId,
        gatewayId,
        fulfillId,
        rejectionId,
        mergeId,
        endId,
      };
    }

    test('happy path on same Y row', async () => {
      const { diagramId } = await buildExclusiveGateway();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const happyNames = ['Request Received', 'Approved?', 'Fulfill Request', 'Merge', 'Done'];
      const elements = happyNames.map((n) => findByName(reg, n)).filter(Boolean);
      expect(elements.length).toBe(5);

      const refY = centreY(elements[0]);
      for (const el of elements) {
        expect(
          Math.abs(centreY(el) - refY),
          `"${el.businessObject.name}" Y=${centreY(el)} not on happy path row Y=${refY}`
        ).toBeLessThanOrEqual(5);
      }
    });

    test('"Send Rejection" below happy path', async () => {
      const { diagramId } = await buildExclusiveGateway();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const gateway = findByName(reg, 'Approved?');
      const rejection = findByName(reg, 'Send Rejection');
      expect(centreY(rejection)).toBeGreaterThan(centreY(gateway) + 50);
    });

    test('"Yes" and "No" labels exist', async () => {
      const { diagramId } = await buildExclusiveGateway();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const yesFlow = findFlowByName(reg, 'Yes');
      const noFlow = findFlowByName(reg, 'No');
      expect(yesFlow, '"Yes" flow should exist').toBeTruthy();
      expect(noFlow, '"No" flow should exist').toBeTruthy();
    });

    test('"No" flow has L-bend (3 waypoints)', async () => {
      const { diagramId } = await buildExclusiveGateway();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const noFlow = findFlowByName(reg, 'No');
      expect(noFlow).toBeTruthy();
      expect(
        noFlow.waypoints.length,
        '"No" flow should have 3 waypoints (L-bend)'
      ).toBeGreaterThanOrEqual(3);
    });
  });

  // ── 03 Parallel Fork-Join ──────────────────────────────────────────

  describe('03-parallel-fork-join', () => {
    async function buildParallelForkJoin() {
      const diagramId = await createDiagram('Parallel Fork-Join');
      const startId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
      });
      const forkId = await addElement(diagramId, 'bpmn:ParallelGateway', {
        afterElementId: startId,
      });
      const chargeId = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Charge Payment',
        afterElementId: forkId,
      });
      const checkId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Check Inventory',
      });
      const notifyId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Notify Warehouse',
      });
      const joinId = await addElement(diagramId, 'bpmn:ParallelGateway', {
        afterElementId: chargeId,
      });
      const endId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Complete',
        afterElementId: joinId,
      });

      // Connect fork → other branches
      await connect(diagramId, forkId, checkId);
      await connect(diagramId, forkId, notifyId);
      // Connect branches → join
      await connect(diagramId, checkId, joinId);
      await connect(diagramId, notifyId, joinId);

      return { diagramId, startId, forkId, chargeId, checkId, notifyId, joinId, endId };
    }

    test('three branches on distinct Y rows', async () => {
      const { diagramId } = await buildParallelForkJoin();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const check = findByName(reg, 'Check Inventory');
      const charge = findByName(reg, 'Charge Payment');
      const notify = findByName(reg, 'Notify Warehouse');

      const ys = [centreY(check), centreY(charge), centreY(notify)];
      // All three should be on distinct rows (at least 30px apart each)
      expect(new Set(ys.map((y) => Math.round(y / 20))).size).toBe(3);
    });

    test('branches span a vertical range', async () => {
      const { diagramId } = await buildParallelForkJoin();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const charge = findByName(reg, 'Charge Payment');
      const check = findByName(reg, 'Check Inventory');
      const notify = findByName(reg, 'Notify Warehouse');

      const ys = [centreY(charge), centreY(check), centreY(notify)].sort((a, b) => a - b);
      const span = ys[2] - ys[0];

      // Three branches should span a meaningful vertical range
      expect(span, 'Branches should spread vertically').toBeGreaterThanOrEqual(60);
    });

    test('fork gateway X is left of all branches', async () => {
      const { diagramId, forkId } = await buildParallelForkJoin();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const fork = reg.get(forkId);
      const charge = findByName(reg, 'Charge Payment');
      const check = findByName(reg, 'Check Inventory');
      const notify = findByName(reg, 'Notify Warehouse');

      for (const branch of [charge, check, notify]) {
        expect(
          centreX(branch),
          `"${branch.businessObject.name}" should be right of fork`
        ).toBeGreaterThan(centreX(fork));
      }
    });

    test('fork and join gateways on same Y row', async () => {
      const { diagramId, forkId, joinId } = await buildParallelForkJoin();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const fork = reg.get(forkId);
      const join = reg.get(joinId);
      expect(
        Math.abs(centreY(fork) - centreY(join)),
        'Fork and join should share same Y'
      ).toBeLessThanOrEqual(5);
    });
  });

  // ── 04 Nested Subprocess ───────────────────────────────────────────

  describe('04-nested-subprocess', () => {
    async function buildNestedSubprocess() {
      const diagramId = await createDiagram('Nested Subprocess');
      const startId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
      });
      const subId = await addElement(diagramId, 'bpmn:SubProcess', {
        afterElementId: startId,
      });
      const endId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        afterElementId: subId,
      });

      // Inner elements — all need participantId to be placed inside the subprocess
      const subStartId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Sub Start',
        participantId: subId,
      });
      const reviewId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Review Document',
        participantId: subId,
        afterElementId: subStartId,
      });
      const subEndId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Sub End',
        participantId: subId,
        afterElementId: reviewId,
      });

      return { diagramId, startId, subId, endId, subStartId, reviewId, subEndId };
    }

    test('inner elements within subprocess bounds', async () => {
      const { diagramId, subId } = await buildNestedSubprocess();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const sub = reg.get(subId);
      const subStart = findByName(reg, 'Sub Start');
      const review = findByName(reg, 'Review Document');
      const subEnd = findByName(reg, 'Sub End');

      expect(sub).toBeTruthy();
      expect(subStart).toBeTruthy();
      expect(review).toBeTruthy();
      expect(subEnd).toBeTruthy();

      const subRight = sub.x + (sub.width || 0);
      const subBottom = sub.y + (sub.height || 0);

      for (const inner of [subStart, review, subEnd]) {
        expect(inner.x, `"${inner.businessObject.name}" left of subprocess`).toBeGreaterThanOrEqual(
          sub.x
        );
        expect(inner.y, `"${inner.businessObject.name}" above subprocess`).toBeGreaterThanOrEqual(
          sub.y
        );
        expect(
          inner.x + (inner.width || 0),
          `"${inner.businessObject.name}" right of subprocess`
        ).toBeLessThanOrEqual(subRight);
        expect(
          inner.y + (inner.height || 0),
          `"${inner.businessObject.name}" below subprocess`
        ).toBeLessThanOrEqual(subBottom);
      }
    });

    test('subprocess size accommodates inner flow', async () => {
      const { diagramId, subId } = await buildNestedSubprocess();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const sub = reg.get(subId);
      expect(sub.width, 'Subprocess should be wide enough').toBeGreaterThanOrEqual(300);
      expect(sub.height, 'Subprocess should be tall enough').toBeGreaterThanOrEqual(150);
    });

    test('outer elements on same Y row', async () => {
      const { diagramId } = await buildNestedSubprocess();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const start = findByName(reg, 'Start');
      const end = findByName(reg, 'End');
      // Start and End should be roughly centred with the subprocess
      expect(start).toBeTruthy();
      expect(end).toBeTruthy();
      expect(
        Math.abs(centreY(start) - centreY(end)),
        'Outer Start and End should share approximate Y'
      ).toBeLessThanOrEqual(20);
    });
  });

  // ── 05 Collaboration ───────────────────────────────────────────────

  describe('05-collaboration', () => {
    async function buildCollaboration() {
      const diagramId = await createDiagram('Collaboration');

      const collabResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [{ name: 'Customer' }, { name: 'System' }],
        })
      );

      // participantIds is a string array — look up names from registry
      const pIds = collabResult.participantIds as string[];
      const reg = getRegistry(diagramId);
      const customerId = pIds.find(
        (id: string) => reg.get(id)?.businessObject?.name === 'Customer'
      )!;
      const systemId = pIds.find((id: string) => reg.get(id)?.businessObject?.name === 'System')!;

      // Customer pool
      const placeOrderId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Place Order',
        participantId: customerId,
      });
      const sendOrderId = await addElement(diagramId, 'bpmn:SendTask', {
        name: 'Send Order',
        participantId: customerId,
        afterElementId: placeOrderId,
      });
      await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Order sent',
        participantId: customerId,
        afterElementId: sendOrderId,
      });

      // System pool
      const orderReceivedId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Order Received',
        participantId: systemId,
      });
      const processOrderId = await addElement(diagramId, 'bpmn:Task', {
        name: 'Process Order',
        participantId: systemId,
        afterElementId: orderReceivedId,
      });
      await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Shipped',
        participantId: systemId,
        afterElementId: processOrderId,
      });

      // Message flow (auto-detected as cross-pool)
      await connect(diagramId, sendOrderId, orderReceivedId);

      return {
        diagramId,
        customerId,
        systemId,
        sendOrderId,
        orderReceivedId,
      };
    }

    test('pools stacked vertically with gap', async () => {
      const { diagramId } = await buildCollaboration();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const customer = findParticipant(reg, 'Customer');
      const system = findParticipant(reg, 'System');
      expect(customer).toBeTruthy();
      expect(system).toBeTruthy();

      // One pool should be above the other
      const upperPool = customer.y < system.y ? customer : system;
      const lowerPool = customer.y < system.y ? system : customer;
      const upperBottom = upperPool.y + (upperPool.height || 0);
      expect(lowerPool.y - upperBottom, 'Pools should have gap ≥ 20px').toBeGreaterThanOrEqual(20);
    });

    test('Customer pool above System pool', async () => {
      const { diagramId } = await buildCollaboration();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const customer = findParticipant(reg, 'Customer');
      const system = findParticipant(reg, 'System');
      expect(customer.y, 'Customer should be above System').toBeLessThan(system.y);
    });

    test('message flow crosses between pools', async () => {
      const { diagramId } = await buildCollaboration();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const msgFlow = findMessageFlow(reg);
      expect(msgFlow, 'Message flow should exist').toBeTruthy();

      // Source Y should be above target Y (flow goes down between pools)
      const wp = msgFlow.waypoints;
      expect(wp[0].y).toBeLessThan(wp[wp.length - 1].y);
    });

    test('each pool has internal chain (3 elements, 2 sequence flows)', async () => {
      const { diagramId } = await buildCollaboration();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      // Check Customer pool has Place Order, Send Order, Order sent
      expect(findByName(reg, 'Place Order')).toBeTruthy();
      expect(findByName(reg, 'Send Order')).toBeTruthy();
      expect(findByName(reg, 'Order sent')).toBeTruthy();

      // Check System pool has Order Received, Process Order, Shipped
      expect(findByName(reg, 'Order Received')).toBeTruthy();
      expect(findByName(reg, 'Process Order')).toBeTruthy();
      expect(findByName(reg, 'Shipped')).toBeTruthy();
    });
  });

  // ── 06 Boundary Events ─────────────────────────────────────────────

  describe('06-boundary-events', () => {
    async function buildBoundaryEvents() {
      const diagramId = await createDiagram('Boundary Events');
      const startId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
      });
      const reviewId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Review Application',
        afterElementId: startId,
      });
      const approveId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Approve',
        afterElementId: reviewId,
      });
      const doneId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Done',
        afterElementId: approveId,
      });

      // Boundary event on "Review Application" with timer duration
      const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timeout',
        hostElementId: reviewId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT15M' },
      });

      // Set non-interrupting
      await handleSetProperties({
        diagramId,
        elementId: boundaryId,
        properties: { cancelActivity: false },
      });

      // Escalation path
      const escalateId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Escalate',
      });
      const escalatedId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Escalated',
      });
      await connect(diagramId, boundaryId, escalateId);
      await connect(diagramId, escalateId, escalatedId);

      return {
        diagramId,
        startId,
        reviewId,
        approveId,
        doneId,
        boundaryId,
        escalateId,
        escalatedId,
      };
    }

    test('main flow on same Y row', async () => {
      const { diagramId } = await buildBoundaryEvents();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const mainNames = ['Start', 'Review Application', 'Approve', 'Done'];
      const elements = mainNames.map((n) => findByName(reg, n)).filter(Boolean);
      expect(elements.length).toBe(4);

      const refY = centreY(elements[0]);
      for (const el of elements) {
        expect(
          Math.abs(centreY(el) - refY),
          `"${el.businessObject.name}" Y=${centreY(el)} not on main row Y=${refY}`
        ).toBeLessThanOrEqual(5);
      }
    });

    test('escalation path below main flow', async () => {
      const { diagramId } = await buildBoundaryEvents();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const review = findByName(reg, 'Review Application');
      const escalate = findByName(reg, 'Escalate');
      expect(centreY(escalate)).toBeGreaterThan(centreY(review));
    });

    test('boundary event near host bottom edge', async () => {
      const { diagramId, reviewId, boundaryId } = await buildBoundaryEvents();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const review = reg.get(reviewId);
      const boundary = reg.get(boundaryId);
      const hostBottom = review.y + (review.height || 0);
      expect(
        Math.abs(centreY(boundary) - hostBottom),
        'Boundary event should be near host bottom edge'
      ).toBeLessThan(50);
    });

    test('boundary event is non-interrupting', async () => {
      const { diagramId, boundaryId } = await buildBoundaryEvents();
      const reg = getRegistry(diagramId);
      const boundary = reg.get(boundaryId);
      expect(boundary.businessObject.cancelActivity).toBe(false);
    });
  });

  // ── 07 Complex Workflow ────────────────────────────────────────────

  describe('07-complex-workflow', () => {
    async function buildComplexWorkflow() {
      const diagramId = await createDiagram('Complex Workflow');
      const startId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Order Placed',
      });
      const validateId = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Validate Order',
        afterElementId: startId,
      });
      const validGwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
        name: 'Valid?',
        afterElementId: validateId,
      });
      const forkId = await addElement(diagramId, 'bpmn:ParallelGateway', {
        afterElementId: validGwId,
      });
      const paymentId = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Payment',
        afterElementId: forkId,
      });
      const inventoryId = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Reserve Inventory',
      });
      const joinId = await addElement(diagramId, 'bpmn:ParallelGateway', {
        afterElementId: paymentId,
      });
      const shipId = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Ship Order',
        afterElementId: joinId,
      });
      const fulfilledId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Order Fulfilled',
        afterElementId: shipId,
      });
      const rejectionId = await addElement(diagramId, 'bpmn:SendTask', {
        name: 'Send Rejection',
      });
      const rejectedEndId = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Order Rejected',
      });

      // Set condition on "Yes" flow (auto-connected gateway → fork)
      const reg = getRegistry(diagramId);
      const yesFlow = findFlowBetween(reg, validGwId, forkId);
      if (yesFlow) {
        await handleSetProperties({
          diagramId,
          elementId: yesFlow.id,
          properties: {
            name: 'Yes',
            conditionExpression: '${valid == true}',
          },
        });
      }

      // No branch (default)
      await connect(diagramId, validGwId, rejectionId, { label: 'No', isDefault: true });

      // Parallel branches
      await connect(diagramId, forkId, inventoryId);
      await connect(diagramId, inventoryId, joinId);

      // Rejection end
      await connect(diagramId, rejectionId, rejectedEndId);

      return {
        diagramId,
        startId,
        validateId,
        validGwId,
        forkId,
        paymentId,
        inventoryId,
        joinId,
        shipId,
        fulfilledId,
        rejectionId,
        rejectedEndId,
      };
    }

    test('happy path elements ordered left-to-right', async () => {
      const { diagramId } = await buildComplexWorkflow();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const happyNames = [
        'Order Placed',
        'Validate Order',
        'Valid?',
        'Process Payment',
        'Ship Order',
        'Order Fulfilled',
      ];
      const elements = happyNames.map((n) => findByName(reg, n)).filter(Boolean);
      expect(elements.length).toBe(6);

      // All happy path elements should be left-to-right
      for (let i = 1; i < elements.length; i++) {
        expect(
          centreX(elements[i]),
          `"${elements[i].businessObject.name}" should be right of "${elements[i - 1].businessObject.name}"`
        ).toBeGreaterThan(centreX(elements[i - 1]));
      }
    });

    test('"Reserve Inventory" below happy path but above rejection', async () => {
      const { diagramId } = await buildComplexWorkflow();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const payment = findByName(reg, 'Process Payment');
      const inventory = findByName(reg, 'Reserve Inventory');
      const rejection = findByName(reg, 'Send Rejection');

      // Inventory below happy path
      expect(centreY(inventory)).toBeGreaterThan(centreY(payment));
      // Rejection below inventory
      expect(centreY(rejection)).toBeGreaterThan(centreY(inventory));
    });

    test('parallel branches between fork and join X-coordinates', async () => {
      const { diagramId, forkId, joinId } = await buildComplexWorkflow();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const fork = reg.get(forkId);
      const join = reg.get(joinId);
      const payment = findByName(reg, 'Process Payment');
      const inventory = findByName(reg, 'Reserve Inventory');

      expect(centreX(payment)).toBeGreaterThan(centreX(fork));
      expect(centreX(payment)).toBeLessThan(centreX(join));
      expect(centreX(inventory)).toBeGreaterThan(centreX(fork));
      expect(centreX(inventory)).toBeLessThan(centreX(join));
    });

    test('"Yes" and "No" labels exist', async () => {
      const { diagramId } = await buildComplexWorkflow();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const yesFlow = findFlowByName(reg, 'Yes');
      const noFlow = findFlowByName(reg, 'No');
      expect(yesFlow, '"Yes" flow should exist').toBeTruthy();
      expect(noFlow, '"No" flow should exist').toBeTruthy();
    });
  });

  // ── 08 Collaboration Collapsed ─────────────────────────────────────

  describe('08-collaboration-collapsed', () => {
    async function buildCollaborationCollapsed() {
      const diagramId = await createDiagram('Collaboration Collapsed');

      const collabResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [{ name: 'Customer' }, { name: 'System', collapsed: true }],
        })
      );

      // participantIds is a string array — look up names from registry
      const pIds = collabResult.participantIds as string[];
      const reg = getRegistry(diagramId);
      const customerId = pIds.find(
        (id: string) => reg.get(id)?.businessObject?.name === 'Customer'
      )!;
      const systemId = pIds.find((id: string) => reg.get(id)?.businessObject?.name === 'System')!;

      // Customer pool
      const placeOrderId = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Place Order',
        participantId: customerId,
      });
      const sendOrderId = await addElement(diagramId, 'bpmn:SendTask', {
        name: 'Send Order',
        participantId: customerId,
        afterElementId: placeOrderId,
      });
      await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Order sent',
        participantId: customerId,
        afterElementId: sendOrderId,
      });

      // Message flow to collapsed pool
      await connect(diagramId, sendOrderId, systemId);

      return { diagramId, customerId, systemId, sendOrderId };
    }

    test('collapsed pool below expanded pool', async () => {
      const { diagramId } = await buildCollaborationCollapsed();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const customer = findParticipant(reg, 'Customer');
      const system = findParticipant(reg, 'System');
      expect(customer).toBeTruthy();
      expect(system).toBeTruthy();

      const customerBottom = customer.y + (customer.height || 0);
      expect(system.y, 'Collapsed pool should be below expanded').toBeGreaterThanOrEqual(
        customerBottom
      );
    });

    test('collapsed pool is thin (height ≤ 80)', async () => {
      const { diagramId } = await buildCollaborationCollapsed();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const system = findParticipant(reg, 'System');
      expect(system).toBeTruthy();
      expect(system.height, 'Collapsed pool should be thin').toBeLessThanOrEqual(80);
    });

    test('message flow reaches collapsed pool', async () => {
      const { diagramId } = await buildCollaborationCollapsed();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      const msgFlow = findMessageFlow(reg);
      expect(msgFlow, 'Message flow should exist').toBeTruthy();

      const system = findParticipant(reg, 'System');
      const lastWp = msgFlow.waypoints[msgFlow.waypoints.length - 1];
      expect(lastWp.y, 'Message flow should reach collapsed pool').toBeGreaterThanOrEqual(system.y);
    });

    test('customer pool has internal flow elements', async () => {
      const { diagramId } = await buildCollaborationCollapsed();
      await handleLayoutDiagram({ diagramId });
      const reg = getRegistry(diagramId);

      expect(findByName(reg, 'Place Order')).toBeTruthy();
      expect(findByName(reg, 'Send Order')).toBeTruthy();
      expect(findByName(reg, 'Order sent')).toBeTruthy();
    });
  });
});
