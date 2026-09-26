/**
 * Programmatic equivalents of the layout-snapshot fixture BPMN files.
 *
 * Each builder creates a diagram via the MCP handler API and returns a
 * typed object with named element IDs.  The builder-based approach is
 * transparent (readable names), maintainable, and ID-stable across
 * layout algorithm changes (layout is delegated to `bpmn-auto-layout`,
 * see ADR-020).
 */

import {
  handleAddElement,
  handleConnect,
  handleCreateLanes,
  handleCreateParticipant,
} from '../../src/handlers';
import { createDiagram, addElement, connect, parseResult } from '../utils/diagram';

// ── F01: Linear flow (5 elements) ─────────────────────────────────────────

export interface F01Ids {
  diagramId: string;
  start: string;
  task1: string;
  task2: string;
  task3: string;
  end: string;
  flow1: string;
  flow2: string;
  flow3: string;
  flow4: string;
}

export async function buildF01LinearFlow(): Promise<F01Ids> {
  const diagramId = await createDiagram('F01 Linear Flow');
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Validate Order' });
  const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
  const task3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Ship Order' });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
  const flow1 = await connect(diagramId, start, task1);
  const flow2 = await connect(diagramId, task1, task2);
  const flow3 = await connect(diagramId, task2, task3);
  const flow4 = await connect(diagramId, task3, end);
  return { diagramId, start, task1, task2, task3, end, flow1, flow2, flow3, flow4 };
}

// ── F02: Exclusive gateway diamond ────────────────────────────────────────

export interface F02Ids {
  diagramId: string;
  start: string;
  review: string;
  split: string;
  fulfill: string;
  reject: string;
  merge: string;
  end: string;
}

export async function buildF02ExclusiveGateway(): Promise<F02Ids> {
  const diagramId = await createDiagram('F02 Exclusive Gateway');
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const review = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
  const split = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
  const fulfill = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Fulfill Order' });
  const reject = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Reject Order' });
  const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
  await connect(diagramId, start, review);
  await connect(diagramId, review, split);
  await connect(diagramId, split, fulfill, { label: 'Yes' });
  await connect(diagramId, split, reject, { label: 'No' });
  await connect(diagramId, fulfill, merge);
  await connect(diagramId, reject, merge);
  await connect(diagramId, merge, end);
  return { diagramId, start, review, split, fulfill, reject, merge, end };
}

// ── F03: Parallel fork-join (3 branches) ──────────────────────────────────

export interface F03Ids {
  diagramId: string;
  start: string;
  fork: string;
  branch1: string;
  branch2: string;
  branch3: string;
  join: string;
  end: string;
}

export async function buildF03ParallelForkJoin(): Promise<F03Ids> {
  const diagramId = await createDiagram('F03 Parallel Fork-Join');
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const fork = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
  const branch1 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Notify Customer' });
  const branch2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Update Inventory' });
  const branch3 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Send Invoice' });
  const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
  await connect(diagramId, start, fork);
  await connect(diagramId, fork, branch1);
  await connect(diagramId, fork, branch2);
  await connect(diagramId, fork, branch3);
  await connect(diagramId, branch1, join);
  await connect(diagramId, branch2, join);
  await connect(diagramId, branch3, join);
  await connect(diagramId, join, end);
  return { diagramId, start, fork, branch1, branch2, branch3, join, end };
}

// ── F04: Nested subprocess ────────────────────────────────────────────────

export interface F04Ids {
  diagramId: string;
  start: string;
  subprocess: string;
  end: string;
  subStart: string;
  subTask: string;
  subEnd: string;
  internalFlow1: string;
  internalFlow2: string;
}

export async function buildF04NestedSubprocess(): Promise<F04Ids> {
  const diagramId = await createDiagram('F04 Nested Subprocess');
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const subprocess = await addElement(diagramId, 'bpmn:SubProcess', {
    name: 'Main Process',
    isExpanded: true,
  });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
  await connect(diagramId, start, subprocess);
  await connect(diagramId, subprocess, end);

  const subStart = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Sub Start',
      parentId: subprocess,
    })
  ).elementId;
  const subTask = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Sub Task',
      parentId: subprocess,
    })
  ).elementId;
  const subEnd = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Sub End',
      parentId: subprocess,
    })
  ).elementId;
  const internalFlow1 = parseResult(
    await handleConnect({ diagramId, sourceElementId: subStart, targetElementId: subTask })
  ).connectionId;
  const internalFlow2 = parseResult(
    await handleConnect({ diagramId, sourceElementId: subTask, targetElementId: subEnd })
  ).connectionId;

  return {
    diagramId,
    start,
    subprocess,
    end,
    subStart,
    subTask,
    subEnd,
    internalFlow1,
    internalFlow2,
  };
}

// ── F05: Two-pool collaboration ───────────────────────────────────────────

export interface F05Ids {
  diagramId: string;
  pool1: string;
  pool2: string;
  p1Start: string;
  p1Task: string;
  p1End: string;
  p2Start: string;
  p2Task: string;
  p2End: string;
  messageFlow: string;
}

export async function buildF05Collaboration(): Promise<F05Ids> {
  const diagramId = await createDiagram('F05 Collaboration');

  const pool1Res = parseResult(await handleCreateParticipant({ diagramId, name: 'Customer' }));
  const pool1 = pool1Res.participantId as string;

  const pool2Res = parseResult(
    await handleCreateParticipant({ diagramId, name: 'Backend System' })
  );
  const pool2 = pool2Res.participantId as string;

  // Pool 1 elements
  const p1Start = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Order Placed',
      participantId: pool1,
    })
  ).elementId;
  const p1Task = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Review Order',
      participantId: pool1,
    })
  ).elementId;
  const p1End = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Order Confirmed',
      participantId: pool1,
    })
  ).elementId;
  await handleConnect({ diagramId, sourceElementId: p1Start, targetElementId: p1Task });
  await handleConnect({ diagramId, sourceElementId: p1Task, targetElementId: p1End });

  // Pool 2 elements
  const p2Start = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Request Received',
      participantId: pool2,
    })
  ).elementId;
  const p2Task = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:ServiceTask',
      name: 'Process Request',
      participantId: pool2,
    })
  ).elementId;
  const p2End = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Response Sent',
      participantId: pool2,
    })
  ).elementId;
  await handleConnect({ diagramId, sourceElementId: p2Start, targetElementId: p2Task });
  await handleConnect({ diagramId, sourceElementId: p2Task, targetElementId: p2End });

  // Message flow between pools
  const messageFlowRes = parseResult(
    await handleConnect({ diagramId, sourceElementId: p1Task, targetElementId: p2Start })
  );
  const messageFlow = messageFlowRes.connectionId as string;

  return { diagramId, pool1, pool2, p1Start, p1Task, p1End, p2Start, p2Task, p2End, messageFlow };
}

// ── F06: Boundary events ───────────────────────────────────────────────────

export interface F06Ids {
  diagramId: string;
  start: string;
  host: string;
  approve: string;
  end: string;
  boundaryEvent: string;
  escalate: string;
  escalatedEnd: string;
  exceptionFlow1: string;
  exceptionFlow2: string;
}

export async function buildF06BoundaryEvents(): Promise<F06Ids> {
  const diagramId = await createDiagram('F06 Boundary Events');
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const host = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Application' });
  const approve = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve Application' });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
  await connect(diagramId, start, host);
  await connect(diagramId, host, approve);
  await connect(diagramId, approve, end);

  // Boundary event on the host task
  const boundaryEvent = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      name: 'Timeout',
      hostElementId: host,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT2H' },
    })
  ).elementId;

  // Exception chain
  const escalate = await addElement(diagramId, 'bpmn:UserTask', { name: 'Escalate' });
  const escalatedEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Escalated' });
  const exceptionFlow1 = await connect(diagramId, boundaryEvent, escalate);
  const exceptionFlow2 = await connect(diagramId, escalate, escalatedEnd);

  return {
    diagramId,
    start,
    host,
    approve,
    end,
    boundaryEvent,
    escalate,
    escalatedEnd,
    exceptionFlow1,
    exceptionFlow2,
  };
}

// ── F08: Collaboration with collapsed pool ────────────────────────────────

export interface F08Ids {
  diagramId: string;
  expandedPool: string;
  collapsedPool: string;
  start: string;
  task: string;
  end: string;
  messageFlow: string;
}

export async function buildF08CollaborationCollapsed(): Promise<F08Ids> {
  const diagramId = await createDiagram('F08 Collaboration Collapsed');

  const expandedRes = parseResult(
    await handleCreateParticipant({ diagramId, name: 'Order System' })
  );
  const expandedPool = expandedRes.participantId as string;

  const collapsedRes = parseResult(
    await handleCreateParticipant({ diagramId, name: 'External Partner', collapsed: true })
  );
  const collapsedPool = collapsedRes.participantId as string;

  const start = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Order Received',
      participantId: expandedPool,
    })
  ).elementId;
  const task = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:ServiceTask',
      name: 'Send Order',
      participantId: expandedPool,
    })
  ).elementId;
  const end = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Order Sent',
      participantId: expandedPool,
    })
  ).elementId;
  await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });
  await handleConnect({ diagramId, sourceElementId: task, targetElementId: end });

  const messageFlowRes = parseResult(
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: collapsedPool })
  );
  const messageFlow = messageFlowRes.connectionId as string;

  return { diagramId, expandedPool, collapsedPool, start, task, end, messageFlow };
}

// ── F09: Complex workflow (topology-test subset) ───────────────────────────
//
// Reproduces only the structural properties needed for topology-focused
// tests: Gateway_RegistrationType (exclusive split), ServiceTask_ProcessPayment
// (with error boundary), UserTask_ReviewAndConfirm (with timer boundary).
// Uses descriptive names that generate IDs matching the fixture where possible.

export interface F09Ids {
  diagramId: string;
  start: string;
  fillForm: string;
  validateEmail: string;
  regTypeGateway: string; // generates "Gateway_RegistrationType"
  selectSessions: string;
  selectPremium: string;
  mergeGateway: string;
  reviewTask: string; // generates "UserTask_ReviewAndConfirm"
  processPayment: string; // generates "ServiceTask_ProcessPayment"
  paymentBoundary: string;
  reviewBoundary: string;
  paymentEndError: string;
  reviewEndTimeout: string;
  end: string;
}

export async function buildF09ComplexWorkflow(): Promise<F09Ids> {
  const diagramId = await createDiagram('F09 Complex Workflow');

  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Registration Started' });
  const fillForm = await addElement(diagramId, 'bpmn:UserTask', { name: 'Fill Registration Form' });
  const validateEmail = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Validate Email' });
  // Name generates "Gateway_RegistrationType" per the ID convention
  const regTypeGateway = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
    name: 'Registration Type',
  });
  const selectSessions = await addElement(diagramId, 'bpmn:UserTask', { name: 'Select Sessions' });
  const selectPremium = await addElement(diagramId, 'bpmn:UserTask', {
    name: 'Select Premium Package',
  });
  const mergeGateway = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
    name: 'Merge Reg Type',
  });
  // Names generate IDs matching topology-test expectations
  const reviewTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review And Confirm' });
  const processPayment = await addElement(diagramId, 'bpmn:ServiceTask', {
    name: 'Process Payment',
  });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Registration Complete' });

  await connect(diagramId, start, fillForm);
  await connect(diagramId, fillForm, validateEmail);
  await connect(diagramId, validateEmail, regTypeGateway);
  await connect(diagramId, regTypeGateway, selectSessions, { label: 'Standard' });
  await connect(diagramId, regTypeGateway, selectPremium, { label: 'VIP' });
  await connect(diagramId, selectSessions, mergeGateway);
  await connect(diagramId, selectPremium, mergeGateway);
  await connect(diagramId, mergeGateway, reviewTask);
  await connect(diagramId, reviewTask, processPayment);
  await connect(diagramId, processPayment, end);

  // Error boundary on processPayment
  const paymentBoundary = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      name: 'Payment Error',
      hostElementId: processPayment,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
    })
  ).elementId;
  const paymentEndError = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Payment Failed' });
  await connect(diagramId, paymentBoundary, paymentEndError);

  // Timer boundary on reviewTask
  const reviewBoundary = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      name: 'Review Timeout',
      hostElementId: reviewTask,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT2H' },
    })
  ).elementId;
  const reviewEndTimeout = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Review Expired' });
  await connect(diagramId, reviewBoundary, reviewEndTimeout);

  return {
    diagramId,
    start,
    fillForm,
    validateEmail,
    regTypeGateway,
    selectSessions,
    selectPremium,
    mergeGateway,
    reviewTask,
    processPayment,
    paymentBoundary,
    reviewBoundary,
    paymentEndError,
    reviewEndTimeout,
    end,
  };
}

// ── F10: Pool with 2 lanes ────────────────────────────────────────────────

export interface F10Ids {
  diagramId: string;
  pool: string;
  laneCustomer: string;
  laneSystem: string;
  start: string;
  placeOrder: string;
  processOrder: string;
  orderComplete: string;
  crossLaneFlow: string;
}

export async function buildF10PoolWithLanes(): Promise<F10Ids> {
  const diagramId = await createDiagram('F10 Pool With Lanes');

  const poolRes = parseResult(await handleCreateParticipant({ diagramId, name: 'Order Process' }));
  const pool = poolRes.participantId as string;

  const lanesRes = parseResult(
    await handleCreateLanes({
      diagramId,
      participantId: pool,
      lanes: [{ name: 'Customer' }, { name: 'System' }],
    })
  );
  const [laneCustomer, laneSystem] = lanesRes.laneIds as string[];

  const start = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Start',
      participantId: pool,
      laneId: laneCustomer,
    })
  ).elementId;
  const placeOrder = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Place Order',
      participantId: pool,
      laneId: laneCustomer,
    })
  ).elementId;
  const processOrder = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:ServiceTask',
      name: 'Process Order',
      participantId: pool,
      laneId: laneSystem,
    })
  ).elementId;
  const orderComplete = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Order Complete',
      participantId: pool,
      laneId: laneSystem,
    })
  ).elementId;

  await handleConnect({ diagramId, sourceElementId: start, targetElementId: placeOrder });
  const crossLaneFlowRes = parseResult(
    await handleConnect({ diagramId, sourceElementId: placeOrder, targetElementId: processOrder })
  );
  const crossLaneFlow = crossLaneFlowRes.connectionId as string;
  await handleConnect({ diagramId, sourceElementId: processOrder, targetElementId: orderComplete });

  return {
    diagramId,
    pool,
    laneCustomer,
    laneSystem,
    start,
    placeOrder,
    processOrder,
    orderComplete,
    crossLaneFlow,
  };
}

// ── F11: Event subprocess ──────────────────────────────────────────────────

export interface F11Ids {
  diagramId: string;
  start: string;
  mainTask: string;
  end: string;
  eventSub: string;
  esStart: string;
  esTask: string;
  esEnd: string;
}

export async function buildF11EventSubprocess(): Promise<F11Ids> {
  const diagramId = await createDiagram('F11 Event Subprocess');

  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const mainTask = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
  await connect(diagramId, start, mainTask);
  await connect(diagramId, mainTask, end);

  // Event subprocess (triggeredByEvent = true)
  const eventSub = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:SubProcess',
      name: 'Error Handler',
      isExpanded: true,
    })
  ).elementId;

  const esStart = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Error Start',
      parentId: eventSub,
    })
  ).elementId;
  const esTask = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Handle Error',
      parentId: eventSub,
    })
  ).elementId;
  const esEnd = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Error End',
      parentId: eventSub,
    })
  ).elementId;
  await handleConnect({ diagramId, sourceElementId: esStart, targetElementId: esTask });
  await handleConnect({ diagramId, sourceElementId: esTask, targetElementId: esEnd });

  return { diagramId, start, mainTask, end, eventSub, esStart, esTask, esEnd };
}

// ── F12: Text annotation + data object ────────────────────────────────────

export interface F12Ids {
  diagramId: string;
  start: string; // StartEvent_Start
  reviewTask: string; // UserTask_ReviewApplication
  end: string; // EndEvent_Done
  annotation: string; // Annotation_SLA24hReviewTime
  dataObject: string; // DataObject_ApplicationData
  association: string;
  dataAssoc: string;
}

export async function buildF12TextAnnotation(): Promise<F12Ids> {
  const diagramId = await createDiagram('F12 Text Annotation');

  // Names chosen to match fixture IDs where possible
  const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
  const reviewTask = await addElement(diagramId, 'bpmn:UserTask', {
    name: 'Review Application',
  });
  const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
  await connect(diagramId, start, reviewTask);
  await connect(diagramId, reviewTask, end);

  const annotation = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:TextAnnotation',
      name: 'SLA24h Review Time',
    })
  ).elementId;

  const dataObject = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:DataObjectReference',
      name: 'Application Data',
    })
  ).elementId;

  const assocRes = parseResult(
    await handleConnect({ diagramId, sourceElementId: reviewTask, targetElementId: annotation })
  );
  const association = assocRes.connectionId as string;

  const dataAssocRes = parseResult(
    await handleConnect({ diagramId, sourceElementId: reviewTask, targetElementId: dataObject })
  );
  const dataAssoc = dataAssocRes.connectionId as string;

  return { diagramId, start, reviewTask, end, annotation, dataObject, association, dataAssoc };
}

// ── F13: Pool with non-interrupting boundary event ────────────────────────

export interface F13Ids {
  diagramId: string;
  pool: string;
  start: string;
  task: string;
  end: string;
  boundaryEvent: string;
  timeoutEnd: string;
  mainFlow1: string;
  mainFlow2: string;
  timeoutFlow: string;
}

/**
 * A participant pool with a service task that has a non-interrupting timer
 * boundary event.  The exception chain (boundary → timeout end) runs in
 * parallel with the main flow (start → task → done).
 *
 * Used to test that connection waypoints stay within pool Y bounds after layout.
 */
export async function buildF13PoolWithNonInterruptingBoundary(): Promise<F13Ids> {
  const diagramId = await createDiagram('F13 Pool With Non-Interrupting Boundary');

  const poolRes = parseResult(await handleCreateParticipant({ diagramId, name: 'Order Process' }));
  const pool = poolRes.participantId as string;

  const start = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Start',
      participantId: pool,
    })
  ).elementId;

  const task = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:ServiceTask',
      name: 'Process Payment',
      participantId: pool,
    })
  ).elementId;

  const end = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Done',
      participantId: pool,
    })
  ).elementId;

  const mainFlow1Res = parseResult(
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task })
  );
  const mainFlow1 = mainFlow1Res.connectionId as string;

  const mainFlow2Res = parseResult(
    await handleConnect({ diagramId, sourceElementId: task, targetElementId: end })
  );
  const mainFlow2 = mainFlow2Res.connectionId as string;

  // Non-interrupting timer boundary event (host task continues when timer fires)
  const boundaryEvent = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      name: 'Payment Timeout',
      hostElementId: task,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT30M' },
      cancelActivity: false,
    })
  ).elementId;

  const timeoutEnd = parseResult(
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'Payment Cancelled',
      participantId: pool,
    })
  ).elementId;

  const timeoutFlowRes = parseResult(
    await handleConnect({ diagramId, sourceElementId: boundaryEvent, targetElementId: timeoutEnd })
  );
  const timeoutFlow = timeoutFlowRes.connectionId as string;

  return {
    diagramId,
    pool,
    start,
    task,
    end,
    boundaryEvent,
    timeoutEnd,
    mainFlow1,
    mainFlow2,
    timeoutFlow,
  };
}
