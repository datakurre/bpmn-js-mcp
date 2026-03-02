import {
  handleAddElement,
  handleAutosizePoolsAndLanes,
  handleConnect,
  handleCreateDiagram,
  handleCreateLanes,
  handleLayoutDiagram,
  handleSetProperties,
  handleSetEventDefinition,
  handleSetFormData,
} from '../handlers';
import { clearDiagrams } from '../diagram-manager';
import { parseToolJson } from './mcp-json';

export interface EvalScenario {
  scenarioId: string;
  name: string;
  build: () => Promise<{ diagramId: string }>;
}

async function createDiagram(name: string): Promise<string> {
  const created = parseToolJson<{ success: boolean; diagramId: string }>(
    await handleCreateDiagram({ name })
  );
  return created.diagramId;
}

async function add(
  diagramId: string,
  elementType: string,
  name?: string,
  extra?: Record<string, any>
) {
  const res = parseToolJson<{ success: boolean; elementId: string }>(
    await handleAddElement({ diagramId, elementType, name, ...extra })
  );
  return res.elementId;
}

async function connect(
  diagramId: string,
  sourceElementId: string,
  targetElementId: string,
  extra?: Record<string, any>
) {
  await handleConnect({ diagramId, sourceElementId, targetElementId, ...extra });
}

async function setProps(diagramId: string, elementId: string, properties: Record<string, any>) {
  await handleSetProperties({ diagramId, elementId, properties });
}

async function setEventDef(
  diagramId: string,
  elementId: string,
  eventDefinitionType: string,
  properties?: Record<string, any>
) {
  await handleSetEventDefinition({ diagramId, elementId, eventDefinitionType, properties });
}

async function layout(diagramId: string) {
  await handleLayoutDiagram({ diagramId });
}

const START_EVENT = 'bpmn:StartEvent';
const END_EVENT = 'bpmn:EndEvent';
const USER_TASK = 'bpmn:UserTask';
const SERVICE_TASK = 'bpmn:ServiceTask';
const SCRIPT_TASK = 'bpmn:ScriptTask';
const EXCLUSIVE_GATEWAY = 'bpmn:ExclusiveGateway';
const PARALLEL_GATEWAY = 'bpmn:ParallelGateway';
const INCLUSIVE_GATEWAY = 'bpmn:InclusiveGateway';
const PARTICIPANT = 'bpmn:Participant';
const BOUNDARY_EVENT = 'bpmn:BoundaryEvent';
const SUB_PROCESS = 'bpmn:SubProcess';

function s01Linear(): EvalScenario {
  return {
    scenarioId: 'S01',
    name: 'Linear flow (5 elements)',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S01 Linear');
      const start = await add(diagramId, START_EVENT, 'Start');
      const t1 = await add(diagramId, USER_TASK, 'Collect Info', { afterElementId: start });
      await setProps(diagramId, t1, { 'camunda:assignee': 'user' });
      const t2 = await add(diagramId, SERVICE_TASK, 'Validate', { afterElementId: t1 });
      await setProps(diagramId, t2, { 'camunda:type': 'external', 'camunda:topic': 'validate' });
      const t3 = await add(diagramId, USER_TASK, 'Approve', { afterElementId: t2 });
      await setProps(diagramId, t3, { 'camunda:assignee': 'approver' });
      const end = await add(diagramId, END_EVENT, 'Done', { afterElementId: t3 });

      await connect(diagramId, start, t1);
      await connect(diagramId, t1, t2);
      await connect(diagramId, t2, t3);
      await connect(diagramId, t3, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

function s02Exclusive(): EvalScenario {
  return {
    scenarioId: 'S02',
    name: 'Exclusive gateway (split/merge)',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S02 Exclusive');
      const start = await add(diagramId, START_EVENT, 'Start');
      const gw = await add(diagramId, EXCLUSIVE_GATEWAY, 'Approved?', { afterElementId: start });
      const yes = await add(diagramId, USER_TASK, 'Process Approval', { afterElementId: gw });
      await setProps(diagramId, yes, { 'camunda:assignee': 'user' });
      const no = await add(diagramId, USER_TASK, 'Handle Rejection', { afterElementId: gw });
      await setProps(diagramId, no, { 'camunda:assignee': 'user' });
      const merge = await add(diagramId, EXCLUSIVE_GATEWAY, 'Merge', { afterElementId: yes });
      const end = await add(diagramId, END_EVENT, 'Done', { afterElementId: merge });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, yes, {
        label: 'Yes',
        conditionExpression: '${approved == true}',
      });
      await connect(diagramId, gw, no, { label: 'No', isDefault: true });
      await connect(diagramId, yes, merge);
      await connect(diagramId, no, merge);
      await connect(diagramId, merge, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

function s03Parallel(): EvalScenario {
  return {
    scenarioId: 'S03',
    name: 'Parallel gateway (fork/join, 3 branches)',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S03 Parallel');
      const start = await add(diagramId, START_EVENT, 'Start');
      const split = await add(diagramId, PARALLEL_GATEWAY, 'Split', { afterElementId: start });
      const b1 = await add(diagramId, USER_TASK, 'Complete Step A', { afterElementId: split });
      await setProps(diagramId, b1, { 'camunda:assignee': 'user' });
      const b2 = await add(diagramId, SERVICE_TASK, 'Validate Data', { afterElementId: split });
      await setProps(diagramId, b2, { 'camunda:type': 'external', 'camunda:topic': 'branch-2' });
      const b3 = await add(diagramId, USER_TASK, 'Send Notification', { afterElementId: split });
      await setProps(diagramId, b3, { 'camunda:assignee': 'user' });
      const join = await add(diagramId, PARALLEL_GATEWAY, 'Join', { afterElementId: b1 });
      const end = await add(diagramId, END_EVENT, 'Done', { afterElementId: join });

      await connect(diagramId, start, split);
      await connect(diagramId, split, b1);
      await connect(diagramId, split, b2);
      await connect(diagramId, split, b3);
      await connect(diagramId, b1, join);
      await connect(diagramId, b2, join);
      await connect(diagramId, b3, join);
      await connect(diagramId, join, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

function s06Lanes(): EvalScenario {
  return {
    scenarioId: 'S06',
    name: 'Two lanes with cross-lane flow',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S06 Lanes');
      const participant = await add(diagramId, PARTICIPANT, 'Two Lane Process', { x: 400, y: 300 });

      const lanes = parseToolJson<{ success: boolean; laneIds: string[] }>(
        await handleCreateLanes({
          diagramId,
          participantId: participant,
          lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
        })
      );
      const [laneA, laneB] = lanes.laneIds;

      const start = await add(diagramId, START_EVENT, 'Start', {
        participantId: participant,
        laneId: laneA,
      });
      const taskA = await add(diagramId, USER_TASK, 'Process Request', {
        participantId: participant,
        laneId: laneA,
        afterElementId: start,
      });
      await setProps(diagramId, taskA, { 'camunda:assignee': 'lane-a-user' });
      const taskB = await add(diagramId, USER_TASK, 'Handle Follow-up', {
        participantId: participant,
        laneId: laneB,
        afterElementId: taskA,
      });
      await setProps(diagramId, taskB, { 'camunda:assignee': 'lane-b-user' });
      const end = await add(diagramId, END_EVENT, 'Done', {
        participantId: participant,
        laneId: laneB,
        afterElementId: taskB,
      });

      await connect(diagramId, start, taskA);
      await connect(diagramId, taskA, taskB);
      await connect(diagramId, taskB, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

export function getEvalScenarios(): EvalScenario[] {
  return [
    s01Linear(),
    s02Exclusive(),
    s03Parallel(),
    s04Camunda7Executable(),
    s05TimerBoundary(),
    s06Lanes(),
    s07ThreeLanes(),
    s08TwoBoundaryEvents(),
    s09ExpandedSubprocess(),
    s10EventSubprocess(),
    s11InclusiveGateway(),
    s12FourLanes(),
  ];
}

/**
 * S04: Camunda 7 executable process with proper implementations.
 *
 * Tests Camunda 7 executability requirements:
 * - Service task with external task topic
 * - User task with assignee
 * - Proper gateway conditions
 */
function s04Camunda7Executable(): EvalScenario {
  return {
    scenarioId: 'S04',
    name: 'Camunda 7 executable process',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S04 Camunda7');
      const start = await add(diagramId, START_EVENT, 'Order Received');
      const validate = await add(diagramId, SERVICE_TASK, 'Validate Order', {
        afterElementId: start,
      });
      // Set external task topic for Camunda 7
      await setProps(diagramId, validate, {
        'camunda:type': 'external',
        'camunda:topic': 'validate-order',
      });

      const review = await add(diagramId, USER_TASK, 'Review Order', { afterElementId: validate });
      // Set assignee for Camunda 7
      await setProps(diagramId, review, { 'camunda:assignee': 'sales-team' });

      const decision = await add(diagramId, EXCLUSIVE_GATEWAY, 'Approved?', {
        afterElementId: review,
      });
      const approve = await add(diagramId, SERVICE_TASK, 'Process Order', {
        afterElementId: decision,
      });
      await setProps(diagramId, approve, {
        'camunda:type': 'external',
        'camunda:topic': 'process-order',
      });

      const reject = await add(diagramId, SERVICE_TASK, 'Send Rejection', {
        afterElementId: decision,
      });
      await setProps(diagramId, reject, {
        'camunda:type': 'external',
        'camunda:topic': 'send-rejection',
      });

      const merge = await add(diagramId, EXCLUSIVE_GATEWAY, 'Merge', { afterElementId: approve });
      const end = await add(diagramId, END_EVENT, 'Done', { afterElementId: merge });

      await connect(diagramId, start, validate);
      await connect(diagramId, validate, review);
      await connect(diagramId, review, decision);
      await connect(diagramId, decision, approve, {
        label: 'Yes',
        conditionExpression: '${approved == true}',
      });
      await connect(diagramId, decision, reject, { label: 'No', isDefault: true });
      await connect(diagramId, approve, merge);
      await connect(diagramId, reject, merge);
      await connect(diagramId, merge, end);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

/**
 * S05: Timer boundary event with escalation path.
 *
 * Tests boundary event layout and timer configuration:
 * - Timer boundary event attached to user task
 * - Escalation path from timeout
 * - Proper timer definition (ISO 8601)
 */
function s05TimerBoundary(): EvalScenario {
  return {
    scenarioId: 'S05',
    name: 'Timer boundary event escalation',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S05 Timer');
      const start = await add(diagramId, START_EVENT, 'Start');
      const task = await add(diagramId, USER_TASK, 'Wait for Approval', { afterElementId: start });
      await setProps(diagramId, task, { 'camunda:assignee': 'manager' });

      // Add timer boundary event
      const timer = await add(diagramId, BOUNDARY_EVENT, 'Timeout', { hostElementId: task });
      await setEventDef(diagramId, timer, 'bpmn:TimerEventDefinition', { timeDuration: 'PT1H' });

      const normalEnd = await add(diagramId, END_EVENT, 'Approved', { afterElementId: task });
      const escalate = await add(diagramId, SERVICE_TASK, 'Escalate', { afterElementId: timer });
      await setProps(diagramId, escalate, {
        'camunda:type': 'external',
        'camunda:topic': 'escalate-approval',
      });
      const escalateEnd = await add(diagramId, END_EVENT, 'Escalated', {
        afterElementId: escalate,
      });

      await connect(diagramId, start, task);
      await connect(diagramId, task, normalEnd);
      await connect(diagramId, timer, escalate);
      await connect(diagramId, escalate, escalateEnd);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

/**
 * S07: Three-lane order process with error boundary on payment.
 *
 * Tests:
 * - Three swimlanes (Customer / Approver / Finance)
 * - Cross-lane sequence flows at each lane boundary
 * - Exclusive gateway split/merge inside one lane
 * - Error boundary event on a Service Task in the Finance lane
 * - Exception chain (Log Error → Payment Error end) inside the same lane
 */
function s07ThreeLanes(): EvalScenario {
  return {
    scenarioId: 'S07',
    name: 'Three-lane order process with error boundary',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S07 ThreeLanes');
      const participant = await add(diagramId, PARTICIPANT, 'Order Handling');
      const lanes = parseToolJson<{ success: boolean; laneIds: string[] }>(
        await handleCreateLanes({
          diagramId,
          participantId: participant,
          lanes: [{ name: 'Customer' }, { name: 'Approver' }, { name: 'Finance' }],
        })
      );
      const [laneC, laneA, laneF] = lanes.laneIds;

      // Customer lane
      const start = await add(diagramId, START_EVENT, 'Order Placed', {
        participantId: participant,
        laneId: laneC,
      });
      const submitOrder = await add(diagramId, USER_TASK, 'Submit Order', {
        participantId: participant,
        laneId: laneC,
        afterElementId: start,
      });
      await setProps(diagramId, submitOrder, { 'camunda:assignee': 'customer' });

      // Approver lane
      const reviewOrder = await add(diagramId, USER_TASK, 'Review Order', {
        participantId: participant,
        laneId: laneA,
        afterElementId: submitOrder,
      });
      await setProps(diagramId, reviewOrder, { 'camunda:assignee': 'approver' });
      await handleSetFormData({
        diagramId,
        elementId: reviewOrder,
        fields: [{ id: 'approved', label: 'Approved', type: 'boolean' }],
      });
      const decision = await add(diagramId, EXCLUSIVE_GATEWAY, 'Approved?', {
        participantId: participant,
        laneId: laneA,
        afterElementId: reviewOrder,
      });
      const notifyReject = await add(diagramId, USER_TASK, 'Notify Rejection', {
        participantId: participant,
        laneId: laneA,
      });
      await setProps(diagramId, notifyReject, { 'camunda:assignee': 'approver' });
      const rejectedEnd = await add(diagramId, END_EVENT, 'Rejected', {
        participantId: participant,
        laneId: laneA,
        afterElementId: notifyReject,
      });

      // Finance lane
      const processPayment = await add(diagramId, SERVICE_TASK, 'Process Payment', {
        participantId: participant,
        laneId: laneF,
      });
      await setProps(diagramId, processPayment, {
        'camunda:type': 'external',
        'camunda:topic': 'process-payment',
      });
      const orderDone = await add(diagramId, END_EVENT, 'Order Complete', {
        participantId: participant,
        laneId: laneF,
        afterElementId: processPayment,
      });

      // Error boundary on Process Payment → exception chain in Finance lane
      const paymentError = await add(diagramId, BOUNDARY_EVENT, 'Payment Failed', {
        hostElementId: processPayment,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Error_Payment', name: 'Payment Failed', errorCode: 'ERR_PAYMENT' },
      });
      const logError = await add(diagramId, SERVICE_TASK, 'Log Payment Error', {
        participantId: participant,
        laneId: laneF,
        afterElementId: paymentError,
      });
      await setProps(diagramId, logError, {
        'camunda:type': 'external',
        'camunda:topic': 'log-payment-error',
      });
      const errorEnd = await add(diagramId, END_EVENT, 'Payment Error', {
        participantId: participant,
        laneId: laneF,
        afterElementId: logError,
      });

      await connect(diagramId, start, submitOrder);
      await connect(diagramId, submitOrder, reviewOrder);
      await connect(diagramId, reviewOrder, decision);
      await connect(diagramId, decision, processPayment, {
        label: 'Yes',
        conditionExpression: '${approved}',
      });
      await connect(diagramId, decision, notifyReject, { label: 'No', isDefault: true });
      await connect(diagramId, notifyReject, rejectedEnd);
      await connect(diagramId, processPayment, orderDone);
      await connect(diagramId, paymentError, logError);
      await connect(diagramId, logError, errorEnd);

      await layout(diagramId);
      await handleAutosizePoolsAndLanes({ diagramId, participantId: participant });
      return { diagramId };
    },
  };
}

/**
 * S08: Two boundary events on one user task.
 *
 * Tests:
 * - Non-interrupting timer boundary (cancelActivity: false) — SLA reminder
 * - Interrupting error boundary — claim rejection handling
 * - Both attached to the same host UserTask
 * - Each triggers an independent exception path to a distinct End Event
 * - Layout must place both boundary events without overlap on the host
 */
function s08TwoBoundaryEvents(): EvalScenario {
  return {
    scenarioId: 'S08',
    name: 'Two boundary events on one task (timer + error)',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S08 TwoBoundary');

      const start = await add(diagramId, START_EVENT, 'Claim Received');
      const processClaim = await add(diagramId, USER_TASK, 'Process Insurance Claim', {
        afterElementId: start,
      });
      await setProps(diagramId, processClaim, { 'camunda:assignee': 'claims-agent' });
      const claimApproved = await add(diagramId, END_EVENT, 'Claim Approved', {
        afterElementId: processClaim,
      });

      // Non-interrupting 48-hour SLA timer → send reminder
      const timerBoundary = await add(diagramId, BOUNDARY_EVENT, 'SLA Warning', {
        hostElementId: processClaim,
        cancelActivity: false,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT48H' },
      });
      const sendReminder = await add(diagramId, SERVICE_TASK, 'Send SLA Reminder', {
        afterElementId: timerBoundary,
      });
      await setProps(diagramId, sendReminder, {
        'camunda:type': 'external',
        'camunda:topic': 'send-sla-reminder',
      });
      const reminderSent = await add(diagramId, END_EVENT, 'Reminder Sent', {
        afterElementId: sendReminder,
      });

      // Interrupting error boundary → rejection handler
      const errorBoundary = await add(diagramId, BOUNDARY_EVENT, 'Claim Rejected', {
        hostElementId: processClaim,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Error_ClaimRejected', name: 'Claim Rejection', errorCode: 'ERR_CLAIM' },
      });
      const handleRejection = await add(diagramId, SERVICE_TASK, 'Handle Rejection', {
        afterElementId: errorBoundary,
      });
      await setProps(diagramId, handleRejection, {
        'camunda:type': 'external',
        'camunda:topic': 'handle-claim-rejection',
      });
      const rejected = await add(diagramId, END_EVENT, 'Claim Rejected', {
        afterElementId: handleRejection,
      });

      await connect(diagramId, start, processClaim);
      await connect(diagramId, processClaim, claimApproved);
      await connect(diagramId, timerBoundary, sendReminder);
      await connect(diagramId, sendReminder, reminderSent);
      await connect(diagramId, errorBoundary, handleRejection);
      await connect(diagramId, handleRejection, rejected);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

/**
 * S09: Expanded inline subprocess with parallel branches and error boundary.
 *
 * Tests:
 * - Expanded (inline) SubProcess containing a parallel fork/join
 * - Parent process flows through the subprocess: Start → Sub → Ship → End
 * - Error boundary on the subprocess itself triggers a separate exception path
 * - Layout must correctly size the subprocess around its children and position
 *   the boundary event on the subprocess edge
 */
function s09ExpandedSubprocess(): EvalScenario {
  return {
    scenarioId: 'S09',
    name: 'Expanded subprocess with parallel branches and error boundary',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S09 Subprocess');

      const start = await add(diagramId, START_EVENT, 'Order Received');
      const sub = await add(diagramId, SUB_PROCESS, 'Fulfill Order', { afterElementId: start });

      // Internal subprocess flow: parallel pick + pack
      const subStart = await add(diagramId, START_EVENT, 'Begin Fulfillment', { parentId: sub });
      const split = await add(diagramId, PARALLEL_GATEWAY, 'Start Tasks', {
        parentId: sub,
        afterElementId: subStart,
      });
      const pickItems = await add(diagramId, USER_TASK, 'Collect Items', {
        parentId: sub,
        afterElementId: split,
      });
      await setProps(diagramId, pickItems, { 'camunda:assignee': 'warehouse' });
      const packItems = await add(diagramId, SERVICE_TASK, 'Pack Items', {
        parentId: sub,
        afterElementId: split,
      });
      await setProps(diagramId, packItems, {
        'camunda:type': 'external',
        'camunda:topic': 'pack-items',
      });
      const join = await add(diagramId, PARALLEL_GATEWAY, 'Tasks Complete', {
        parentId: sub,
        afterElementId: pickItems,
      });
      const subEnd = await add(diagramId, END_EVENT, 'Fulfilled', {
        parentId: sub,
        afterElementId: join,
      });

      await connect(diagramId, subStart, split);
      await connect(diagramId, split, pickItems);
      await connect(diagramId, split, packItems);
      await connect(diagramId, pickItems, join);
      await connect(diagramId, packItems, join);
      await connect(diagramId, join, subEnd);

      // Main flow after subprocess
      const shipOrder = await add(diagramId, SERVICE_TASK, 'Ship Order', { afterElementId: sub });
      await setProps(diagramId, shipOrder, {
        'camunda:type': 'external',
        'camunda:topic': 'ship-order',
      });
      const done = await add(diagramId, END_EVENT, 'Shipped', { afterElementId: shipOrder });

      // Error boundary on the subprocess → shortage exception path
      const shortageError = await add(diagramId, BOUNDARY_EVENT, 'Stock Shortage', {
        hostElementId: sub,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Error_Shortage', name: 'Stock Shortage', errorCode: 'ERR_STOCK' },
      });
      const handleShortage = await add(diagramId, SERVICE_TASK, 'Handle Shortage', {
        afterElementId: shortageError,
      });
      await setProps(diagramId, handleShortage, {
        'camunda:type': 'external',
        'camunda:topic': 'handle-shortage',
      });
      const outOfStock = await add(diagramId, END_EVENT, 'Out of Stock', {
        afterElementId: handleShortage,
      });

      await connect(diagramId, start, sub);
      await connect(diagramId, sub, shipOrder);
      await connect(diagramId, shipOrder, done);
      await connect(diagramId, shortageError, handleShortage);
      await connect(diagramId, handleShortage, outOfStock);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

/**
 * S10: Event subprocess triggered by an error.
 *
 * Tests:
 * - Expanded event subprocess (triggeredByEvent: true)
 * - Error StartEvent inside the event subprocess
 * - Terminate EndEvent in the main process
 * - Event subprocess must be positioned below the main flow
 * - Internal elements of the event subprocess are connected sequentially
 */
function s10EventSubprocess(): EvalScenario {
  return {
    scenarioId: 'S10',
    name: 'Event subprocess triggered by error',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S10 EventSubprocess');

      // Main process
      const start = await add(diagramId, START_EVENT, 'Transaction Initiated');
      const processTx = await add(diagramId, SERVICE_TASK, 'Process Transaction', {
        afterElementId: start,
      });
      await setProps(diagramId, processTx, {
        'camunda:type': 'external',
        'camunda:topic': 'process-transaction',
      });
      const confirmOrder = await add(diagramId, USER_TASK, 'Confirm Order', {
        afterElementId: processTx,
      });
      await setProps(diagramId, confirmOrder, { 'camunda:assignee': 'sales' });
      const done = await add(diagramId, END_EVENT, 'Transaction Complete', {
        afterElementId: confirmOrder,
      });

      await connect(diagramId, start, processTx);
      await connect(diagramId, processTx, confirmOrder);
      await connect(diagramId, confirmOrder, done);

      // Event subprocess — positioned below main flow, triggered on error
      const evtSub = await add(diagramId, SUB_PROCESS, 'Handle Transaction Error', {
        x: 200,
        y: 370,
      });
      await setProps(diagramId, evtSub, { triggeredByEvent: true, isExpanded: true });

      const subStart = await add(diagramId, START_EVENT, 'Transaction Failed', {
        parentId: evtSub,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Error_TxFailed', name: 'Transaction Failed', errorCode: 'ERR_TX' },
      });
      const voidTx = await add(diagramId, SERVICE_TASK, 'Cancel Transaction', {
        parentId: evtSub,
        afterElementId: subStart,
      });
      await setProps(diagramId, voidTx, {
        'camunda:type': 'external',
        'camunda:topic': 'cancel-transaction',
      });
      const notifyFailure = await add(diagramId, SERVICE_TASK, 'Notify Customer of Failure', {
        parentId: evtSub,
        afterElementId: voidTx,
      });
      await setProps(diagramId, notifyFailure, {
        'camunda:type': 'external',
        'camunda:topic': 'notify-failure',
      });
      const subEnd = await add(diagramId, END_EVENT, 'Error Handled', {
        parentId: evtSub,
        afterElementId: notifyFailure,
      });

      await connect(diagramId, subStart, voidTx);
      await connect(diagramId, voidTx, notifyFailure);
      await connect(diagramId, notifyFailure, subEnd);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

/**
 * S11: Inclusive gateway (OR-split with 3 optional notification branches).
 *
 * Tests:
 * - InclusiveGateway split and merge (any subset of branches may be active)
 * - Three parallel optional paths: email / database / audit-log
 * - Condition expressions on all outgoing flows
 * - ScriptTask with scriptFormat and script body (Camunda 7 requirement)
 * - Layout must fan the 3 branches symmetrically around the gateway Y axis
 */
function s11InclusiveGateway(): EvalScenario {
  return {
    scenarioId: 'S11',
    name: 'Inclusive gateway — 3 optional notification branches',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S11 Inclusive');

      const start = await add(diagramId, START_EVENT, 'Evaluation Triggered');
      const evaluate = await add(diagramId, INCLUSIVE_GATEWAY, 'Conditions active?', {
        afterElementId: start,
      });

      // Branch A: email notification
      const sendEmail = await add(diagramId, SERVICE_TASK, 'Send Email Notification', {
        afterElementId: evaluate,
      });
      await setProps(diagramId, sendEmail, {
        'camunda:type': 'external',
        'camunda:topic': 'send-email',
      });

      // Branch B: database update
      const updateRecord = await add(diagramId, SERVICE_TASK, 'Update Database Record', {
        afterElementId: evaluate,
      });
      await setProps(diagramId, updateRecord, {
        'camunda:type': 'external',
        'camunda:topic': 'update-record',
      });

      // Branch C: audit log (ScriptTask)
      const auditLog = await add(diagramId, SCRIPT_TASK, 'Write Audit Log', {
        afterElementId: evaluate,
      });
      await setProps(diagramId, auditLog, {
        scriptFormat: 'groovy',
        script: "log.info('Audit: ' + execution.processInstanceId)",
      });

      const merge = await add(diagramId, INCLUSIVE_GATEWAY, 'All Actions Complete', {
        afterElementId: sendEmail,
      });
      const done = await add(diagramId, END_EVENT, 'Notifications Sent', {
        afterElementId: merge,
      });

      await connect(diagramId, start, evaluate);
      await connect(diagramId, evaluate, sendEmail, {
        label: 'Email',
        conditionExpression: '${notifyByEmail}',
      });
      await connect(diagramId, evaluate, updateRecord, {
        label: 'DB',
        conditionExpression: '${updateDb}',
      });
      await connect(diagramId, evaluate, auditLog, {
        label: 'Audit',
        conditionExpression: '${auditRequired}',
      });
      await connect(diagramId, sendEmail, merge);
      await connect(diagramId, updateRecord, merge);
      await connect(diagramId, auditLog, merge);
      await connect(diagramId, merge, done);

      await layout(diagramId);
      return { diagramId };
    },
  };
}

/**
 * S12: Four-lane support escalation process with non-interrupting timer.
 *
 * Tests:
 * - Four swimlanes: Customer / Support / Technical / Manager
 * - Multiple cross-lane sequence flows (zigzag handoff pattern)
 * - Non-interrupting timer boundary on a Support-lane task (status updates)
 * - Exclusive gateway split in Support lane with one branch going to Technical
 * - Explicit merge gateway in Support lane before the close step
 * - Cross-lane flow from Manager back to Support and from Support to Customer
 */
function s12FourLanes(): EvalScenario {
  return {
    scenarioId: 'S12',
    name: 'Four-lane escalation process with non-interrupting timer',
    build: async () => {
      clearDiagrams();
      const diagramId = await createDiagram('Eval S12 FourLanes');
      const participant = await add(diagramId, PARTICIPANT, 'Support Escalation');
      const lanes = parseToolJson<{ success: boolean; laneIds: string[] }>(
        await handleCreateLanes({
          diagramId,
          participantId: participant,
          lanes: [
            { name: 'Customer' },
            { name: 'Support' },
            { name: 'Technical' },
            { name: 'Manager' },
          ],
        })
      );
      const [laneCustomer, laneSupport, laneTechnical, laneManager] = lanes.laneIds;

      // Customer lane: submit and receive resolution
      const start = await add(diagramId, START_EVENT, 'Issue Reported', {
        participantId: participant,
        laneId: laneCustomer,
      });
      const submitTicket = await add(diagramId, USER_TASK, 'Submit Support Ticket', {
        participantId: participant,
        laneId: laneCustomer,
        afterElementId: start,
      });
      await setProps(diagramId, submitTicket, { 'camunda:assignee': 'customer' });
      const resolved = await add(diagramId, END_EVENT, 'Issue Resolved', {
        participantId: participant,
        laneId: laneCustomer,
      });

      // Support lane: triage → escalation decision
      const triage = await add(diagramId, USER_TASK, 'Triage Issue', {
        participantId: participant,
        laneId: laneSupport,
        afterElementId: submitTicket,
      });
      await setProps(diagramId, triage, { 'camunda:assignee': 'support-team' });
      await handleSetFormData({
        diagramId,
        elementId: triage,
        fields: [
          {
            id: 'priority',
            label: 'Priority',
            type: 'enum',
            values: [
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
          },
        ],
      });

      // Non-interrupting 4-hour timer on Triage → send status update
      const triageTimer = await add(diagramId, BOUNDARY_EVENT, 'Status Update Due', {
        hostElementId: triage,
        cancelActivity: false,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT4H' },
      });
      const sendStatus = await add(diagramId, SERVICE_TASK, 'Send Status Update', {
        participantId: participant,
        laneId: laneSupport,
        afterElementId: triageTimer,
      });
      await setProps(diagramId, sendStatus, {
        'camunda:type': 'external',
        'camunda:topic': 'send-status-update',
      });
      const statusSent = await add(diagramId, END_EVENT, 'Update Sent', {
        participantId: participant,
        laneId: laneSupport,
        afterElementId: sendStatus,
      });

      const priorityGw = await add(diagramId, EXCLUSIVE_GATEWAY, 'Priority?', {
        participantId: participant,
        laneId: laneSupport,
        afterElementId: triage,
      });

      // Low-priority: stay in Support lane (autoConnect:false avoids unconditional gateway flow)
      const handleDirectly = await add(diagramId, USER_TASK, 'Handle Request Directly', {
        participantId: participant,
        laneId: laneSupport,
        afterElementId: priorityGw,
        autoConnect: false,
      });
      await setProps(diagramId, handleDirectly, { 'camunda:assignee': 'support-agent' });

      const mergeGw = await add(diagramId, EXCLUSIVE_GATEWAY, 'Merge', {
        participantId: participant,
        laneId: laneSupport,
        afterElementId: handleDirectly,
      });
      const closeTicket = await add(diagramId, USER_TASK, 'Close Ticket', {
        participantId: participant,
        laneId: laneSupport,
        afterElementId: mergeGw,
      });
      await setProps(diagramId, closeTicket, { 'camunda:assignee': 'support-agent' });

      // High-priority: escalate to Technical then Manager
      const investigate = await add(diagramId, USER_TASK, 'Investigate Issue', {
        participantId: participant,
        laneId: laneTechnical,
      });
      await setProps(diagramId, investigate, { 'camunda:assignee': 'technical' });

      const approveFix = await add(diagramId, USER_TASK, 'Approve Fix', {
        participantId: participant,
        laneId: laneManager,
        afterElementId: investigate,
      });
      await setProps(diagramId, approveFix, { 'camunda:assignee': 'manager' });

      await connect(diagramId, start, submitTicket);
      await connect(diagramId, submitTicket, triage);
      await connect(diagramId, triageTimer, sendStatus);
      await connect(diagramId, sendStatus, statusSent);
      await connect(diagramId, triage, priorityGw);
      await connect(diagramId, priorityGw, investigate, {
        label: 'High',
        conditionExpression: "${priority == 'high'}",
      });
      await connect(diagramId, priorityGw, handleDirectly, { label: 'Low', isDefault: true });
      await connect(diagramId, investigate, approveFix);
      await connect(diagramId, approveFix, mergeGw);
      await connect(diagramId, handleDirectly, mergeGw);
      await connect(diagramId, mergeGw, closeTicket);
      await connect(diagramId, closeTicket, resolved);

      await layout(diagramId);
      await handleAutosizePoolsAndLanes({ diagramId, participantId: participant });
      return { diagramId };
    },
  };
}
